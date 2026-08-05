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
 * Vlastník: A12.
 */
import { z } from 'zod';

import type { MoneyString, PreviewBlocker, PreviewItem } from '@/contracts';

import { checkExtension } from '@/lib/domain/campaign-rules';
import { discountedPrice, DISCOUNTED_PRICE_DISCLAIMER_SK } from '@/lib/domain/pricing';
import { startOfDayUtc } from '@/lib/domain/dates';
import { checkAllowlist } from '@/lib/engine/guards';
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
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../../_shared';

const bodySchema = z.object({
  to: dateOnlySchema,
});

/** Stavy, z ktorých má predĺženie zmysel: zľava bola (aspoň sčasti) zapísaná. */
const EXTENDABLE = ['done', 'partial'] as const;

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

          /* 3. Čerstvé detaily zo shopu (D57) — len čítanie. */
          const items: PreviewItem[] = [];
          const pricesAtPreview: Record<string, MoneyString> = {};
          const hasAttributesIds: number[] = [];
          const ctxShop = newOperationContext();

          let details = new Map<number, unknown>();
          if (allow.ok) {
            try {
              const fetched = await d.shopClient.batchGetProducts(productIds, ctxShop);
              details = fetched.results;
            } catch {
              blockers.push({
                code: 'shop_unreachable',
                message: 'Shop sa nepodarilo prečítať — dry-run sa nedá zostaviť (fail-closed).',
              });
            }
          }

          for (const productId of productIds) {
            const detail = details.get(productId);
            const lastOwnWrite = await d.campaignsRepo.lastOwnWrite(productId);
            const warnings: string[] = [];

            if (
              detail === undefined ||
              typeof detail !== 'object' ||
              detail === null ||
              isShopError(detail)
            ) {
              blockers.push({
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
