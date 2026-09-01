/**
 * Aura Zľavy — `GET /api/insights/campaign/[id]/products`
 * (D127 bod 1 a 3 — rozklik zľavy: KTORÉ produkty v nej boli).
 *
 * Dnešná stránka Zliav povie „21 produktov" a tým to skončí. Táto route je
 * odpoveď na „ktorých 21": referencia, názov, cena pred, cena po a stav zápisu
 * pre každý riadok, stránkovane a JEDNÝM dotazom (`historyPage()`).
 *
 * TRI VECI, KTORÉ SA TU NESMÚ POKAZIŤ
 * -----------------------------------
 *  1. **Položka sa nesmie stratiť.** Produkt smie z katalógu zmiznúť; jeho
 *     riadok v zľave je dôkaz o tom, čo appka urobila, a `LEFT JOIN` v
 *     repozitári ho drží v zozname s `reference: null`. `inCatalog: false` to
 *     rozlíši od produktu, ktorý v zrkadle JE, ale nie je obohatený (D118) —
 *     dve rôzne nevedomosti, dva rôzne dôvody, prečo je referencia pomlčka.
 *
 *  2. **`priceAfter` je ORIENTAČNÉ číslo, nie cena zo shopu.** Počíta ho
 *     `discountedPrice()` ako `cena × (1 − percent/100)` (D4) a appka skutočnú
 *     zľavnenú cenu cez API NIKDY nevidela (I11, B1). Preto je pri každom
 *     riadku `priceAfterEstimated` a UI k nemu MUSÍ pripojiť
 *     `DISCOUNTED_PRICE_DISCLAIMER_SK`. Keď cena pred nie je známa, `priceAfter`
 *     je `null` — nulou by sa z neznámej ceny stala zľava na nulu.
 *
 *  3. **„Cena pred" má DVA rôzne zdroje a je rozdiel, ktorý z nich to je.**
 *     `priceAtWrite` je cena v okamihu zápisu, `priceAtPreview` cena z náhľadu.
 *     Kým sa nezapisovalo, existuje len druhá — a keď sa rozišli, `priceMismatch`
 *     je D39c, teda vec, ktorú tabuľka musí ukázať, nie zahladiť. Preto sa vracia
 *     `priceBeforeSource` a NIE JE to detail: percento sa počítalo z tej ceny.
 *
 * Čisto čítacie: samé `SELECT` z lokálnej DB, žiadne volanie shopu (K8), žiadna
 * cesta k zápisu — teda ani cesta, ktorá by obišla dry-run a potvrdenie (I3).
 *
 * Vlastník: vlna V5-CITACIE.
 */
import { z } from 'zod';

import type { DateOnly, DiscountPercent, ItemStatus, MoneyString } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { discountedPrice } from '@/lib/domain/pricing';

import { campaignIdParamSchema, resolveInsightsDeps, type InsightsDeps } from '../../../_shared';

/** Koľko riadkov ide na stranu, keď si klient nepýta inak. */
const DEFAULT_PER_PAGE = 100;
/** Strop strany. Vyššie čísla repozitár aj tak zovrie (`MAX_HISTORY_ROWS`). */
const MAX_PER_PAGE = 500;

const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  perPage: z.coerce.number().int().positive().max(MAX_PER_PAGE).optional(),
});

/** Odkiaľ je „cena pred". `null` = nevieme ju odnikiaľ. */
export type PriceBeforeSource = 'write' | 'preview';

export interface CampaignProductRow {
  itemId: number;
  productId: number;
  /** Referencia zo zrkadla (D116). `null` = nevieme (I11), nie „nemá". */
  reference: string | null;
  /** Názov v zrkadle DNES. `null` = produkt v zrkadle nie je. */
  catalogName: string | null;
  /** Názov, ktorý appka videla V ČASE ZÁPISU. `null` = ešte sa nezapisovalo. */
  nameAtWrite: string | null;
  /** `false` = produkt v zrkadle katalógu VÔBEC NIE JE (zmizol z katalógu). */
  inCatalog: boolean;
  /** `true` = riadok zrkadla prešiel `getFull` (D118). */
  enriched: boolean;
  percent: DiscountPercent;
  status: ItemStatus;
  /** Cena, z ktorej sa percento počítalo. `null` = nevieme. */
  priceBefore: MoneyString | null;
  priceBeforeSource: PriceBeforeSource | null;
  /** ORIENTAČNÁ zľavnená cena (D4). `null`, keď `priceBefore` nie je známa. */
  priceAfter: MoneyString | null;
  /** `true` vždy, keď `priceAfter` nie je `null` — appka ju POČÍTALA. */
  priceAfterEstimated: boolean;
  /** Cenníková cena v zrkadle DNES — iný fakt než `priceBefore`. */
  catalogPrice: MoneyString | null;
  /** D39c: náhľad a zápis videli inú cenu. Tabuľka to musí ukázať. */
  priceMismatch: boolean;
  /** Shop na zápis odpovedal tak, že sa zľava nedala overiť (I11). */
  reductionUnverifiable: boolean;
  attemptCount: number;
  /** KÓD chyby, nikdy telo odpovede shopu (I1). */
  errorCode: string | null;
  /** Kedy sa pokus uzavrel (ISO). `null` = ešte sa nedobehol. */
  finishedAt: string | null;
}

export interface CampaignProductsResponse {
  campaignId: number;
  /** Hlavička zľavy pre rozklik. `null` = kampaň s týmto ID neexistuje. */
  campaign: {
    name: string;
    status: string;
    percent: DiscountPercent;
    dateFrom: DateOnly;
    dateTo: DateOnly;
  } | null;
  page: number;
  perPage: number;
  /** Koľko položiek zľava má SPOLU (nie koľko ich prišlo na tejto strane). */
  total: number;
  items: CampaignProductRow[];
}

export function createInsightsCampaignProductsGet(
  overrides: InsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      params: campaignIdParamSchema,
      query: querySchema,
      handler: async (ctx): Promise<CampaignProductsResponse> => {
        const campaignId = ctx.params.id;
        const page = ctx.query.page ?? 1;
        const perPage = ctx.query.perPage ?? DEFAULT_PER_PAGE;

        /*
         * Tri dotazy, ktoré nerastú s počtom položiek: hlavička, počet a JEDNA
         * strana riadkov. Žiadne N+1 — referencia, názov aj cena zo zrkadla sú
         * v tom istom `SELECT`-e ako položka (`historyPage()`).
         */
        const campaign = await d.campaignsRepo.getById(campaignId);
        const total = await d.campaignItemsRepo.countByCampaign(campaignId);
        const rows = await d.campaignItemsRepo.historyPage(
          campaignId,
          perPage,
          (page - 1) * perPage,
        );

        const items: CampaignProductRow[] = rows.map((row) => {
          /*
           * Cena zápisu má prednosť pred cenou náhľadu: percento sa v shope
           * uplatnilo na tú, ktorú videl executor. Kým sa nezapisovalo, je
           * známa len cena náhľadu — a keď nie je ani tá, `priceBefore` je
           * `null` a žiadna zľavnená cena sa NEVYRÁBA.
           */
          const priceBefore: MoneyString | null = row.priceAtWrite ?? row.priceAtPreview;
          const priceBeforeSource: PriceBeforeSource | null =
            row.priceAtWrite === null ? (row.priceAtPreview === null ? null : 'preview') : 'write';
          const priceAfter =
            priceBefore === null ? null : discountedPrice(priceBefore, row.percent);

          return {
            itemId: row.itemId,
            productId: row.productId,
            reference: row.reference,
            catalogName: row.catalogName,
            nameAtWrite: row.nameAtWrite,
            inCatalog: row.inCatalog,
            enriched: row.enriched,
            percent: row.percent,
            status: row.status,
            priceBefore,
            priceBeforeSource,
            priceAfter,
            priceAfterEstimated: priceAfter !== null,
            catalogPrice: row.catalogPrice,
            priceMismatch: row.priceMismatch,
            reductionUnverifiable: row.reductionUnverifiable,
            attemptCount: row.attemptCount,
            errorCode: row.errorCode,
            finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
          };
        });

        return {
          campaignId,
          campaign:
            campaign === null
              ? null
              : {
                  name: campaign.name,
                  status: campaign.status,
                  percent: campaign.percent,
                  dateFrom: campaign.dateFrom,
                  dateTo: campaign.dateTo,
                },
          page,
          perPage,
          total,
          items,
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsCampaignProductsGet();
