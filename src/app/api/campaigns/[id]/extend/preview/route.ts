/**
 * Aura Zľavy — `POST /api/campaigns/[id]/extend/preview` (BUILD-SPEC §5, D19, D27).
 *
 * Dry-run predĺženia: `from` aj percento sú ZAMKNUTÉ na hodnoty pôvodnej
 * kampane, mení sa výhradne `to` dopredu, so stropom 3 kalendárnych mesiacov
 * od PÔVODNÉHO `from` (D27). `engine/preview` sa tu nedá použiť priamo —
 * validuje `from ≥ dnes`, kým predĺženie bežiacej zľavy má `from` legitímne
 * v minulosti — preto route stavia náhľad sám z tých istých stavebných blokov
 * (čerstvé detaily zo shopu, orientačná cena, jednorazový token, fail-closed
 * blokátory). Stále platí: ŽIADEN zápis, len čítanie.
 *
 * ROZPOČET ČÍTANÍ (K7). „Len čítanie" nie je „zadarmo". Sada predĺženia je
 * celá sada pôvodnej kampane, teda v plnom rozsahu (K1) aj tisíce produktov:
 * `batchGetProducts()` z nich urobí `počet + počet/25` volaní proti dennému
 * stropu 240 anonymných čítaní. Kým sa tu rozpočet nerezervoval, appka o tých
 * čítaniach nevedela ani spätne — a presne tak si privolala IP ban, ktorý
 * zoberie so sebou synchronizáciu katalógu aj bežiacu frontu. Route sa preto
 * drží tých istých dvoch pravidiel ako `engine/preview`:
 *
 *  1. sada nad `PREVIEW_SHOP_DETAIL_MAX` sa NEČÍTA zo shopu vôbec — ceny idú zo
 *     zrkadla katalógu (K7), ktoré je na to navrhnuté,
 *  2. menšia sada sa zo shopu čerpá LEN po rezervácii celej ceny naraz; keď sa
 *     nezmestí, shop sa nevolá (minie sa 0 čítaní), ceny idú zo zrkadla a
 *     pribudne BLOKÁTOR — token sa nevydá, takže do potvrdenia nikdy nemôžu ísť
 *     ceny, ktoré appka nevidela (I3, D39c).
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import type {
  CatalogCacheRecord,
  LastOwnWrite,
  MoneyString,
  PreviewBlocker,
  PreviewItem,
} from '@/contracts';

import { checkExtension } from '@/lib/domain/campaign-rules';
import { discountedPrice, DISCOUNTED_PRICE_DISCLAIMER_SK } from '@/lib/domain/pricing';
import { startOfDayUtc } from '@/lib/domain/dates';
import { checkAllowlist } from '@/lib/engine/guards';
import {
  PREVIEW_MAX_ITEM_BLOCKERS,
  PREVIEW_SHOP_DETAIL_MAX,
  SHOP_READ_BUDGET_BLOCKER_CODE,
  shopReadBudgetMessage,
} from '@/lib/engine/preview';
import { numberToMoney } from '@/lib/engine/snapshot';
import { badRequest } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { isShopError } from '@/lib/shop/errors';
import { newOperationContext } from '@/lib/shop/correlation';

import {
  assertStatusIn,
  dateOnlySchema,
  idParamSchema,
  loadCampaignOr404,
  previewResultResponse,
  reserveShopReadsForSet,
  resolveRoutesDeps,
  withRouteErrors,
  type ResolvedRoutesDeps,
  type RoutesDeps,
} from '../../../_shared';

const bodySchema = z.object({
  to: dateOnlySchema,
});

/** Stavy, z ktorých má predĺženie zmysel: zľava bola (aspoň sčasti) zapísaná. */
const EXTENDABLE = ['done', 'partial'] as const;

/**
 * I11 — posledné vlastné zápisy pre celú sadu JEDNÝM dotazom.
 *
 * Doteraz sa `lastOwnWrite()` volalo v cykle nad položkami, teda raz na produkt:
 * pri sade 8 000 produktov 8 000 sekvenčných dotazov na jeden náhľad. Rovnaký
 * vzor `engine/preview` už opustil a dávkový tvar v repozitári existuje presne
 * na toto. Postupný fallback zostáva len pre staršie fakes v testoch, ktoré
 * dávkovú metódu nepoznajú — produkčný repozitár ju má.
 */
async function lastOwnWritesFor(
  d: ResolvedRoutesDeps,
  productIds: number[],
): Promise<Map<number, LastOwnWrite>> {
  const batch = d.campaignsRepo.lastOwnWrites;
  if (batch !== undefined) return batch.call(d.campaignsRepo, productIds);
  const out = new Map<number, LastOwnWrite>();
  for (const productId of productIds) {
    const found = await d.campaignsRepo.lastOwnWrite(productId);
    if (found !== null) out.set(productId, found);
  }
  return out;
}

export function createExtendPreviewPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      body: bodySchema,
      params: idParamSchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const campaign = await loadCampaignOr404(d, ctx.params.id);
          assertStatusIn(campaign, EXTENDABLE, 'extend');

          const blockers: PreviewBlocker[] = [];

          /* 1. D27 — nové `to` za doterajším, ≤ 3 mesiace od pôvodného `from`. */
          const check = checkExtension({
            originalFrom: campaign.dateFrom,
            originalPercent: campaign.percent,
            currentTo: campaign.dateTo,
            newTo: ctx.body.to,
          });
          if (!check.ok) {
            throw badRequest(check.message, check.code, {
              detail: { offerOverwrite: check.offerOverwrite },
              logAsError: false,
            });
          }

          /* 2. Sada = produkty pôvodnej kampane; allowlist fail-closed (I2). */
          const campaignItems = await d.campaignItemsRepo.listByCampaign(campaign.id);
          const productIds = [...new Set(campaignItems.map((i) => i.productId))].sort(
            (a, b) => a - b,
          );
          const allow = await checkAllowlist(productIds, { allowlistRepo: d.allowlistRepo });
          if (!allow.ok) blockers.push({ code: allow.code, message: allow.message });

          /* 3. Zdroj cien a rozpočet čítaní (K7, D57) — stále len čítanie.
           *
           *    Zo shopu sa číta LEN malá sada a LEN po rezervácii celej ceny;
           *    inak je zdrojom zrkadlo katalógu. `wantShop` je zámerne tá istá
           *    hranica ako v `engine/preview`, aby dve cesty k tomu istému
           *    shopu nemali dva rôzne stropy. */
          const items: PreviewItem[] = [];
          const pricesAtPreview: Record<string, MoneyString> = {};
          const hasAttributesIds: number[] = [];
          const ctxShop = newOperationContext();

          /**
           * Blokátor viazaný na jeden produkt. Pri sade v tisícoch by prázdne
           * zrkadlo znamenalo tisíce hlášok v jednej odpovedi. Blokovací účinok
           * sa tým nestráca — stačí jediný blokátor a token sa nevydá.
           */
          let itemBlockerCount = 0;
          let suppressedItemBlockers = 0;
          const pushItemBlocker = (blocker: PreviewBlocker): void => {
            if (itemBlockerCount < PREVIEW_MAX_ITEM_BLOCKERS) {
              blockers.push(blocker);
              itemBlockerCount += 1;
              return;
            }
            suppressedItemBlockers += 1;
          };

          const wantShop = allow.ok && productIds.length <= PREVIEW_SHOP_DETAIL_MAX;
          let useShop = false;
          if (wantShop) {
            const clearance = await reserveShopReadsForSet(d, productIds.length);
            useShop = clearance.granted;
            if (!clearance.granted) {
              blockers.push({
                code: SHOP_READ_BUDGET_BLOCKER_CODE,
                message: shopReadBudgetMessage(
                  productIds.length,
                  clearance.cost,
                  clearance.status,
                ),
              });
            }
          }

          let details = new Map<number, unknown>();
          let cached = new Map<number, CatalogCacheRecord>();
          if (useShop) {
            try {
              const fetched = await d.shopClient.batchGetProducts(productIds, ctxShop);
              details = fetched.results;
            } catch {
              blockers.push({
                code: 'shop_unreachable',
                message: 'Shop sa nepodarilo prečítať — dry-run sa nedá zostaviť (fail-closed).',
              });
            }
          } else if (allow.ok) {
            try {
              cached = await d.catalogRepo.getMany(productIds);
            } catch {
              cached = new Map();
            }
          }

          /* I11 — jeden dotaz na celú sadu, nie jeden na produkt. */
          const lastWrites = await lastOwnWritesFor(d, productIds);

          for (const productId of productIds) {
            const lastOwnWrite = lastWrites.get(productId) ?? null;
            const warnings: string[] = [];

            /* Shop sa nevolal (veľká sada, rozpočet alebo rozsah) — ceny sú zo
             * zrkadla katalógu, presne ako v `engine/preview`. Do tokenu sa
             * dostanú len vtedy, keď v zozname nezostal ani jeden blokátor:
             * pri veľkej sade je zrkadlo NAVRHNUTÝ zdroj (K7), pri vyčerpanom
             * rozpočte je to núdza a blokátor tam už je, takže token nevznikne
             * (I3, D39c). */
            if (!useShop) {
              const record = cached.get(productId) ?? null;
              if (record?.price != null) pricesAtPreview[String(productId)] = record.price;
              if (allow.ok && record === null) {
                pushItemBlocker({
                  code: 'product_not_in_catalog',
                  productId,
                  message: `Produkt ${productId} nie je v zrkadle katalógu — predĺženie sa nedá potvrdiť, kým katalóg nedobehne (K1 bod 2).`,
                });
              }
              if (record?.hasAttributes === true) hasAttributesIds.push(productId);
              items.push({
                productId,
                name: record?.name ?? null,
                price: record?.price ?? null,
                discountedPrice:
                  record?.price == null ? null : discountedPrice(record.price, campaign.percent),
                hasAttributes: record?.hasAttributes ?? false,
                lastOwnWrite,
                reductionUnverifiable: true,
                // Bez platného rozsahu (K1) sa zrkadlo ani nečítalo — tvrdiť
                // „nemáme cenu" by bola veta o niečom, čo nikto nezisťoval.
                warnings: !allow.ok
                  ? ['Produkt nie je v povolenom rozsahu — jeho cenu appka nezisťovala.']
                  : record === null
                    ? ['Appka o tomto produkte nemá ani uloženú cenu.']
                    : [
                        'Cena je z posledného známeho zrkadla katalógu, nie zo shopu.',
                        DISCOUNTED_PRICE_DISCLAIMER_SK,
                      ],
              });
              continue;
            }

            const detail = details.get(productId);
            if (
              detail === undefined ||
              typeof detail !== 'object' ||
              detail === null ||
              isShopError(detail)
            ) {
              pushItemBlocker({
                code: 'product_unreadable',
                message: `Produkt ${productId} sa nepodarilo prečítať zo shopu — predĺženie sa nedá potvrdiť.`,
                productId,
              });
              items.push({
                productId,
                name: null,
                price: null,
                discountedPrice: null,
                hasAttributes: false,
                lastOwnWrite,
                reductionUnverifiable: true,
                warnings: ['Produkt sa nedá prečítať.'],
              });
              continue;
            }

            const product = detail as { name: string; price: number; has_attributes: boolean };
            const price = numberToMoney(product.price);
            pricesAtPreview[String(productId)] = price;
            if (product.has_attributes) {
              hasAttributesIds.push(productId);
              warnings.push(
                'Produkt má varianty — zľava sa v shope uplatní podľa jeho pravidiel pre varianty (D60).',
              );
            }
            warnings.push(
              'Predĺženie prepíše zľavu identickými parametrami s novým koncom (D27).',
            );
            warnings.push(DISCOUNTED_PRICE_DISCLAIMER_SK);

            items.push({
              productId,
              name: product.name,
              price,
              discountedPrice: discountedPrice(price, campaign.percent),
              hasAttributes: product.has_attributes,
              lastOwnWrite,
              reductionUnverifiable: true,
              warnings,
            });
          }

          if (suppressedItemBlockers > 0) {
            blockers.push({
              code: 'more_blocked_products',
              message: `Rovnaký problém má ešte ďalších ${suppressedItemBlockers} produktov — v detaile je prvých ${PREVIEW_MAX_ITEM_BLOCKERS}.`,
            });
          }

          /* 4. Varovanie D8 — kľúč expiruje pred začiatkom platnosti zápisu. */
          let keyExpiresBeforeStart = false;
          try {
            const meta = await d.apiKeyRepo.getMeta();
            keyExpiresBeforeStart =
              !meta.present ||
              (meta.expiresAt !== null &&
                meta.expiresAt.getTime() < startOfDayUtc(check.to, d.timeZone).getTime());
          } catch {
            keyExpiresBeforeStart = true;
          }

          /* 5. Token len pre čistú sadu (I3, O2) — `from`/percento zamknuté. */
          let previewToken = '';
          if (blockers.length === 0) {
            const issued = await d.previewTokens.issue({
              sub: ctx.claims.sub,
              kind: 'extend',
              productIds,
              percent: campaign.percent,
              from: campaign.dateFrom,
              to: check.to,
              pricesAtPreview,
            });
            previewToken = issued.token;
          }

          // Redaktor by `previewToken` v tele zamaskoval — vlastná Response (O2).
          return previewResultResponse({
            previewToken,
            items,
            warnings: {
              keyExpiresBeforeStart,
              oneDayWindow: campaign.dateFrom === check.to,
              overwrite: productIds,
              hasAttributes: hasAttributesIds,
            },
            blockers,
          });
        }),
    },
    routeDeps,
  );
}

export const POST = createExtendPreviewPost();
