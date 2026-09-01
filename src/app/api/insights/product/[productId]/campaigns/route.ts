/**
 * Aura Zľavy — `GET /api/insights/product/[productId]/campaigns`
 * (D127 bod 3, opačný smer — „v ktorých zľavách bol TENTO produkt").
 *
 * Druhá polovica histórie produkt ↔ zľava. Prvá je
 * `GET /api/insights/campaign/[id]/products`; obe čítajú tú istú tabuľku tým
 * istým repozitárom, aby sa nemohli rozísť v tom, čo je „položka zľavy".
 *
 * PREČO TO NIE JE TO ISTÉ, ČO `GET /api/insights/product/[productId]`
 * ------------------------------------------------------------------
 * Tá route kreslí graf G3 a berie `insightsRepo.productWrites()`, ktorý
 * ZAHADZUJE položky so stavom `pending`: graf dokončených pokusov taký riadok
 * nemá kam nakresliť. História je iná otázka — zľava naplánovaná na zajtra je
 * platná odpoveď na „bol tento produkt v zľave", nie medzera. Preto tu ide
 * `campaignItemsRepo.historyForProduct()`, ktorý vracia VŠETKY stavy, a preto
 * tá druhá route zostáva nezmenená.
 *
 * ČO TU JE PRIZNANIE, NIE ÚDAJ
 * ----------------------------
 *  · `ownWriteCoversToday` je o VLASTNOM zápise appky (I11): `true` znamená
 *    „appka na tento produkt úspešne zapísala zľavu, ktorej okno pokrýva dnešný
 *    deň", NIKDY „v shope na produkte beží zľava". Shop stav zľavy cez API
 *    nevracia a nikdy sa tu tváriť nebude, že vracia.
 *  · `priceAfter` je ORIENTAČNÉ číslo z `discountedPrice()` (D4) — rovnaké
 *    pravidlo aj disclaimer ako v route položiek zľavy.
 *  · `truncated` hovorí, že strop histórie sa dosiahol. Zoznam sa ticho
 *    neoreže: orezaný chvost bez priznania je zapísaná pasca tohto repa.
 *
 * Deň sa počíta cez `todayOf()` (logické pásmo), NIKDY v UTC — inak by test
 * medzi 22:00 a 24:00 UTC flakoval a appka by pred polnocou tvrdila iný deň.
 *
 * Čisto čítacie: `SELECT` z lokálnej DB, žiadne volanie shopu (K8), žiadny zápis.
 *
 * Vlastník: vlna V5-CITACIE.
 */
import { z } from 'zod';

import type { DateOnly, DiscountPercent, ItemStatus, MoneyString } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { discountedPrice } from '@/lib/domain/pricing';

import {
  anchorQuery,
  productIdParamSchema,
  resolveInsightsDeps,
  todayOf,
  type InsightsDeps,
} from '../../../_shared';

/** Koľko riadkov histórie sa vracia, keď si klient nepýta inak. */
const DEFAULT_LIMIT = 50;
/** Strop; repozitár má vlastný (`MAX_PRODUCT_HISTORY_ROWS`) a ten rozhoduje. */
const MAX_LIMIT = 200;

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  anchor: anchorQuery,
});

export interface ProductCampaignRow {
  itemId: number;
  campaignId: number;
  campaignName: string;
  campaignStatus: string;
  campaignKind: string;
  /** Percento v hlavičke zľavy. */
  campaignPercent: DiscountPercent;
  /** Percento pásma NA POLOŽKE (K3) — to, ktoré sa naozaj zapisovalo. */
  percent: DiscountPercent;
  dateFrom: DateOnly;
  dateTo: DateOnly;
  /** Stav ZÁPISU na tomto produkte — nie stav celej zľavy. */
  itemStatus: ItemStatus;
  /**
   * `true` = VLASTNÝ úspešný zápis appky, ktorého okno pokrýva dnešný deň (I11).
   * NIE tvrdenie o stave zľavy v shope.
   */
  ownWriteCoversToday: boolean;
  priceBefore: MoneyString | null;
  priceBeforeSource: 'write' | 'preview' | null;
  /** ORIENTAČNÁ zľavnená cena (D4). `null`, keď `priceBefore` nie je známa. */
  priceAfter: MoneyString | null;
  priceAfterEstimated: boolean;
  priceMismatch: boolean;
  attemptCount: number;
  errorCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ProductCampaignsResponse {
  productId: number;
  today: DateOnly;
  /** Koľko riadkov prišlo. Celkový počet sa ZÁMERNE nepočíta — viď `truncated`. */
  returned: number;
  /** `true` = strop sa dosiahol a starších zliav môže byť viac. */
  truncated: boolean;
  rows: ProductCampaignRow[];
}

export function createInsightsProductCampaignsGet(
  overrides: InsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      params: productIdParamSchema,
      query: querySchema,
      handler: async (ctx): Promise<ProductCampaignsResponse> => {
        const productId = ctx.params.productId;
        const limit = ctx.query.limit ?? DEFAULT_LIMIT;
        const today = ctx.query.anchor ?? todayOf(d);

        const history = await d.campaignItemsRepo.historyForProduct(productId, limit);

        const rows: ProductCampaignRow[] = history.map((row) => {
          const priceBefore: MoneyString | null = row.priceAtWrite ?? row.priceAtPreview;
          const priceBeforeSource: ProductCampaignRow['priceBeforeSource'] =
            row.priceAtWrite === null ? (row.priceAtPreview === null ? null : 'preview') : 'write';
          const priceAfter =
            priceBefore === null ? null : discountedPrice(priceBefore, row.percent);

          return {
            itemId: row.itemId,
            campaignId: row.campaignId,
            campaignName: row.campaignName,
            campaignStatus: row.campaignStatus,
            campaignKind: row.campaignKind,
            campaignPercent: row.campaignPercent,
            percent: row.percent,
            dateFrom: row.dateFrom,
            dateTo: row.dateTo,
            itemStatus: row.itemStatus,
            /* Len úspešný zápis smie tvrdiť, že zľava na produkte niekedy
               naozaj bola — `uncertain` znamená, že appka nevie, či v shope
               pristál, a `pending` že sa ešte nestal. */
            ownWriteCoversToday:
              row.itemStatus === 'ok' && row.dateFrom <= today && row.dateTo >= today,
            priceBefore,
            priceBeforeSource,
            priceAfter,
            priceAfterEstimated: priceAfter !== null,
            priceMismatch: row.priceMismatch,
            attemptCount: row.attemptCount,
            errorCode: row.errorCode,
            startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
            finishedAt: row.finishedAt === null ? null : row.finishedAt.toISOString(),
          };
        });

        return {
          productId,
          today,
          returned: rows.length,
          truncated: rows.length >= limit,
          rows,
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsProductCampaignsGet();
