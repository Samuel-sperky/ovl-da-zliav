/**
 * Aura Zľavy — `GET /api/insights/product/[productId]` (graf G3, plán §4;
 * rozšírené pre detail panel V4, D115).
 *
 * Čo route vracia:
 *   1. `writes` — história VLASTNÝCH zápisov appky na produkt (pôvodný G3):
 *      kedy sa zapisovalo, s akým percentom a s akým výsledkom.
 *   2. `series` — DENNÁ KRIVKA predaných kusov TOHO PRODUKTU (default 90 dní)
 *      s pokrytím po dňoch, takže graf vie nakresliť dieru, nie nulu.
 *   3. `discountWindows` — okná zliav TOHO PRODUKTU, ktoré appka naozaj
 *      úspešne zapísala (`status = 'ok'`), na podfarbenie krivky.
 *   4. `uplift` — porovnanie „pred / počas" poslednej ZAČATEJ zľavy.
 *
 * I11: ani jedno z toho NIE JE história zliav v shope — je to história toho, čo
 * appka sama urobila. Komponent grafu to musí takto aj pomenovať.
 *
 * DVE VECI, KTORÉ SA TU NESMÚ POKAZIŤ
 * -----------------------------------
 *  A. **Nestiahnutý deň v krivke CHÝBA, nedostane nulu.** `series.days` má
 *     riadok pre KAŽDÝ deň okna, ale `units` je `null` všade, kde deň nie je
 *     `complete` — a `coverage` pri každom dni hovorí, prečo. Deň, ktorý sa
 *     stiahol celý a produkt sa v ňom nepredal, dostane `0`: to je meranie.
 *  B. **Do `discountWindows` ide LEN `status = 'ok'`.** `uncertain` znamená, že
 *     appka nevie, či zápis v shope pristál; podfarbiť ním krivku by bolo
 *     tvrdenie o shope (I11). Ostatné stavy zľavu nezapísali vôbec.
 *
 * Definícia okien uplift-u (a pasca commitu `d00e081`) je v `upliftFor()`
 * v `../../_shared.ts` — je tam preto, aby existovala RAZ a dala sa testovať
 * bez HTTP.
 *
 * Čisto čítacie; žiadny zápis, žiadne volanie shopu (K8).
 *
 * Vlastník: B2; sekcie krivky a uplift-u vlna V4-ENDPOINTY.
 */
import { z } from 'zod';

import type { DateOnly, SalesDayCoverage } from '@/contracts';

import { addDays } from '@/lib/domain/dates';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import type { ProductWriteRow } from '@/lib/repo/insights.repo';
import {
  dailyUnits as defaultDailyUnits,
  syncDays as defaultSyncDays,
} from '@/lib/sales/insights';

import {
  anchorQuery,
  measurementState,
  productIdParamSchema,
  resolveInsightsDeps,
  todayOf,
  upliftFor,
  windowCoverage,
  windowQuery,
  windowRange,
  type InsightsDeps,
  type MeasurementState,
  type OwnDiscountWindow,
  type UpliftResult,
  type WindowCoverage,
  type WindowRange,
} from '../../_shared';

/** D115: detail panel kreslí 90 dní. Prepínač okna zostáva k dispozícii. */
const DETAIL_WINDOW_DAYS = 90;

/**
 * Najdlhšie okno „pred", aké môže vzniknúť: zľava smie trvať najviac 3 mesiace
 * (I9), takže 100 dní je strop s rezervou. Podľa neho sa dočítava rad pre
 * uplift, keď zľava začala pred oknom krivky.
 */
const MAX_UPLIFT_SPAN_DAYS = 100;

const querySchema = z.object({ anchor: anchorQuery, window: windowQuery });

/** Jeden deň krivky. `units: null` = ten deň sa nesťahoval (NIE nula). */
export interface ProductSeriesDay {
  day: DateOnly;
  units: number | null;
  coverage: SalesDayCoverage;
}

export interface ProductInsightsResponse {
  productId: number;
  today: DateOnly;
  /** Pôvodný G3 — nezmenený tvar, aby existujúci panel ďalej fungoval. */
  writes: ProductWriteRow[];
  series: {
    window: WindowRange;
    days: ProductSeriesDay[];
    /** Súčet kusov za dočítané dni okna. `null` = ani jeden deň dočítaný. */
    windowUnits: number | null;
    unitsState: MeasurementState;
    gaps: WindowCoverage;
  };
  /** Okná zliav TOHO PRODUKTU podľa úspešných VLASTNÝCH zápisov (I11). */
  discountWindows: OwnDiscountWindow[];
  uplift: UpliftResult;
}

export interface ProductInsightsDeps extends InsightsDeps {
  salesInsights?: {
    syncDays: typeof defaultSyncDays;
    dailyUnits: typeof defaultDailyUnits;
  };
}

export function createInsightsProductGet(
  overrides: ProductInsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  const sales = overrides.salesInsights ?? {
    syncDays: defaultSyncDays,
    dailyUnits: defaultDailyUnits,
  };

  return defineRoute(
    {
      method: 'GET',
      params: productIdParamSchema,
      query: querySchema,
      handler: async (ctx): Promise<ProductInsightsResponse> => {
        const productId = ctx.params.productId;
        const today = ctx.query.anchor ?? todayOf(d);
        const range = windowRange(today, ctx.query.window ?? DETAIL_WINDOW_DAYS);

        const writes = await d.insightsRepo.productWrites(productId);
        const syncState = await sales.syncDays();
        const gaps = windowCoverage(syncState, range);

        /*
         * Krivka aj uplift čítajú TEN ISTÝ rad dní — jeden dotaz, jeden zdroj.
         * Dva dotazy nad tým istým oknom by sa dali rozladiť a nikto by si to
         * nevšimol, kým by čísla nezačali protirečiť.
         */
        const rows = await sales.dailyUnits([productId], range.from, range.to);
        const soldByDay = new Map<DateOnly, number>();
        for (const row of rows) {
          soldByDay.set(row.saleDay, (soldByDay.get(row.saleDay) ?? 0) + row.unitsSold);
        }

        const days: ProductSeriesDay[] = gaps.days.map((entry) => ({
          day: entry.day,
          // Deň, ktorý nie je dočítaný, NEMÁ číslo. Nula by tvrdila, že sa
          // v ten deň nepredalo — a to appka nevie.
          units: entry.coverage === 'complete' ? (soldByDay.get(entry.day) ?? 0) : null,
          coverage: entry.coverage,
        }));

        const unitsState = measurementState(gaps);
        const windowUnits =
          unitsState === 'unknown'
            ? null
            : days.reduce((sum, row) => (row.units === null ? sum : sum + row.units), 0);

        /* Len úspešné zápisy — viď bod B v hlavičke. */
        const discountWindows: OwnDiscountWindow[] = writes
          .filter((row) => row.status === 'ok')
          .map((row) => ({
            campaignId: row.campaignId,
            campaignName: row.campaignName,
            percent: row.percent,
            from: row.dateFrom,
            to: row.dateTo,
          }))
          .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

        /*
         * Uplift potrebuje dni PRED oknom krivky: okno „pred" leží pred
         * začiatkom zľavy, takže keby dostal len orezaný rad, vyšla by mu
         * z chýbajúcich riadkov NULA namiesto „nevieme". Preto sa rad pre
         * uplift dočíta až od `chosen.from − MAX_UPLIFT_SPAN_DAYS` — zľava smie
         * trvať najviac 3 mesiace (I9), takže dlhšie okno „pred" nevznikne.
         * (Že sú dni naozaj stiahnuté, si `upliftFor()` overuje sám.)
         */
        const startedFrom = discountWindows
          .filter((row) => row.from <= today)
          .reduce<DateOnly | null>((best, row) => (best === null || row.from > best ? row.from : best), null);
        const needFrom =
          startedFrom === null ? range.from : addDays(startedFrom, -MAX_UPLIFT_SPAN_DAYS);
        const upliftDays =
          needFrom >= range.from ? rows : await sales.dailyUnits([productId], needFrom, range.to);

        const uplift = upliftFor({
          today,
          windows: discountWindows,
          syncDays: syncState,
          days: upliftDays.map((row) => ({ day: row.saleDay, units: row.unitsSold })),
        });

        return {
          productId,
          today,
          writes,
          series: { window: range, days, windowUnits, unitsState, gaps },
          discountWindows,
          uplift,
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsProductGet();
