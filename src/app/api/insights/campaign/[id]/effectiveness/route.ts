/**
 * Aura Zľavy — `GET /api/insights/campaign/[id]/effectiveness`
 * (D127 bod 4 — účinnosť zľavy; PODMIENENÁ, viď P1 kontraktu V5).
 *
 * DEFINÍCIA OKIEN — TU A NAHLAS, PRETOŽE PRÁVE TOTO SA V TOMTO REPE UŽ RAZ
 * POKAZILO
 * -----------------------------------------------------------------------
 * 26. 8. 2026 (commit `d00e081`) sekcia „Výkon" porovnávala DVE OKNÁ, KTORÉ
 * ZĽAVE OBE PREDCHÁDZALI, a nazývala to jej výkonom: obe končili dneškom a
 * `date_from` do výpočtu vôbec nevstupoval. Kým je zápis fronta, normálny stav
 * zľavy je „zapisuje sa" a jej okno je v BUDÚCNOSTI — graf teda kreslil dva
 * stĺpce pred zľavou a jeden z nich bol „silnejší".
 *
 * Táto route preto NEMÁ vlastnú definíciu okien. Používa `upliftFor()`
 * z `_shared.ts`, kde definícia žije RAZ a dá sa testovať bez HTTP:
 *
 *   · okno **POČAS** = `[date_from, min(date_to, dnes)]` — deň po dnešku sa doň
 *     nikdy nedostane, lebo sa ešte nestal. Keď zľava beží, okno je skrátené a
 *     `duringTruncated` to hovorí,
 *   · okno **PRED** = `[date_from − n, date_from − 1]`, kde `n` je dĺžka okna
 *     POČAS. Základňa teda končí DEŇ PRED začiatkom zľavy a je rovnako dlhá,
 *   · zľava, ktorá ešte nezačala, nedostane ČÍSLA — dostane `startsOn`.
 *
 * TRI STAVY, A ANI JEDEN Z NICH NIE JE NULA (I11)
 * ----------------------------------------------
 *   · `measured`      — obe okná stoja na dočítaných dňoch; čísla platia,
 *   · `coverage_gap`  — niektorý deň niektorého okna sa nesťahoval alebo sa
 *                       nedosťahoval. `missingBefore` / `missingDuring` menujú
 *                       KTORÉ dni chýbajú a ŽIADNE číslo sa nevracia,
 *   · `too_young`     — zľava ešte nezačala, alebo okno POČAS je kratšie než
 *                       `UPLIFT_MIN_WINDOW_DAYS`. Dva dni proti dvom dňom je
 *                       šum s dvoma desatinnými miestami, nie účinnosť.
 *
 * ČO TÁTO ROUTE NEROBÍ
 * --------------------
 *  1. **Žiadne eurá.** `product_sales_daily` drží VÝHRADNE kusy — ceny položiek
 *     objednávky API nevracia (D117), takže tržba na produkt neexistuje.
 *     Násobiť kusy cenníkovou cenou by vyrobilo číslo, ktoré vyzerá ako tržba.
 *  2. **Žiadny záver o príčine.** Vracajú sa dve čísla vedľa seba a rozdiel,
 *     nikdy veta „zľava priniesla +18 %" (P8): appka nevie oddeliť vplyv zľavy
 *     od sezóny, skladu a ostatných kampaní.
 *  3. **Nepozerá sa na INÉ zľavy tých istých produktov.** Porovnáva okná TEJTO
 *     zľavy. Keby v základni bežala iná zľava na tie isté produkty, tu to
 *     nevyjde; pri JEDNOM produkte to `upliftFor()` zachytí ako
 *     `baseline_overlaps_discount` v `GET /api/insights/product/[productId]`.
 *     Je to známa hranica, nie prehliadnutie.
 *
 * Čisto čítacie: `SELECT` z lokálnej DB, žiadne volanie shopu (K8), žiadny zápis.
 *
 * Vlastník: vlna V5-CITACIE.
 */
import type { DateOnly } from '@/contracts';

import { addDays } from '@/lib/domain/dates';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  campaignDailyUnits as defaultCampaignDailyUnits,
  syncDays as defaultSyncDays,
} from '@/lib/sales/insights';

import {
  campaignIdParamSchema,
  resolveInsightsDeps,
  todayOf,
  upliftFor,
  type InsightsDeps,
  type UpliftReason,
  type UpliftResult,
} from '../../../_shared';

/**
 * Najdlhšie okno „pred", aké môže vzniknúť: zľava smie trvať najviac 3 mesiace
 * (I7), takže 100 dní je strop s rezervou. Podľa neho sa dočítava rad dní — je
 * to len ROZSAH DOTAZU, nie definícia okna. Tú má `upliftFor()`.
 */
const MAX_BASELINE_SPAN_DAYS = 100;

/** Tri stavy z hlavičky plus dva, ktoré hovoria o zlom vstupe. */
export type EffectivenessState =
  | 'measured'
  | 'coverage_gap'
  | 'too_young'
  | 'baseline_overlaps'
  | 'invalid_window'
  | 'unknown_campaign';

export interface CampaignEffectivenessResponse {
  campaignId: number;
  today: DateOnly;
  /** `true` LEN pri `measured`. Inak sú `before.units` a `during.units` `null`. */
  available: boolean;
  state: EffectivenessState;
  /** Kód dôvodu z `upliftFor()`. `null` pri `measured`. */
  reason: UpliftReason | 'unknown_campaign' | null;
  campaign: {
    name: string | null;
    status: string | null;
    percent: number | null;
    dateFrom: DateOnly | null;
    dateTo: DateOnly | null;
    /** Koľko položiek zľava má podľa vlastnej hlavičky. `null` = kampaň nie je. */
    itemsTotal: number | null;
  };
  /** Merajú sa KUSY, nikdy eurá (D117). */
  unit: 'ks';
  spanDays: number | null;
  /** Odkedy zľava platí — aby obrazovka povedala KEDY, nie len „ešte nie". */
  startsOn: DateOnly | null;
  /** `true` = zľava ešte beží, takže okno POČAS je skrátené dneškom. */
  duringTruncated: boolean;
  before: UpliftResult['before'];
  during: UpliftResult['during'];
  deltaPercent: number | null;
  deltaReason: UpliftResult['deltaReason'];
  missingBefore: DateOnly[];
  missingDuring: DateOnly[];
  /** Panely, ktoré appka naplniť NEVIE — UI ich zamkne, nedopočíta. */
  locked: { revenue: string };
}

/** Preklad dôvodu `upliftFor()` na stav obrazovky. Jedno miesto, nie tri. */
export function stateFor(uplift: UpliftResult): EffectivenessState {
  if (uplift.reason === null) return uplift.available ? 'measured' : 'invalid_window';
  switch (uplift.reason) {
    case 'coverage_gap':
      return 'coverage_gap';
    case 'not_started':
    case 'window_too_short':
      return 'too_young';
    case 'baseline_overlaps_discount':
      return 'baseline_overlaps';
    case 'no_discount_window':
      return 'invalid_window';
  }
}

export interface CampaignEffectivenessDeps extends InsightsDeps {
  salesInsights?: {
    syncDays: typeof defaultSyncDays;
    campaignDailyUnits: typeof defaultCampaignDailyUnits;
  };
}

export function createInsightsCampaignEffectivenessGet(
  overrides: CampaignEffectivenessDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  const sales = overrides.salesInsights ?? {
    syncDays: defaultSyncDays,
    campaignDailyUnits: defaultCampaignDailyUnits,
  };

  return defineRoute(
    {
      method: 'GET',
      params: campaignIdParamSchema,
      handler: async (ctx): Promise<CampaignEffectivenessResponse> => {
        const campaignId = ctx.params.id;
        const today = todayOf(d);
        const campaign = await d.campaignsRepo.getById(campaignId);

        const locked = {
          /* Dôvod je LEN dôvod, bez mena uhla — rovnaký tvar ako v route
             „Výkon" (`performance`), ktorej pätku kreslí ten istý komponent. */
          revenue: 'shop ich cez API nevracia',
        };

        // Turbopack tu už raz zahodil `if (!row)` — porovnávame explicitne.
        if (campaign === null) {
          return {
            campaignId,
            today,
            available: false,
            state: 'unknown_campaign',
            reason: 'unknown_campaign',
            campaign: {
              name: null,
              status: null,
              percent: null,
              dateFrom: null,
              dateTo: null,
              itemsTotal: null,
            },
            unit: 'ks',
            spanDays: null,
            startsOn: null,
            duringTruncated: false,
            before: null,
            during: null,
            deltaPercent: null,
            deltaReason: null,
            missingBefore: [],
            missingDuring: [],
            locked,
          };
        }

        const syncState = await sales.syncDays();

        /*
         * ROZSAH DOTAZU (nie definícia okna): od `date_from` mínus najdlhšia
         * možná základňa po posledný deň, ktorý sa už stal. Zľava, ktorá ešte
         * nezačala, sa NEDOTAZUJE vôbec — `upliftFor()` na ňu odpovie
         * `not_started` a žiadne dni na to nepotrebuje.
         */
        const duringTo: DateOnly = campaign.dateTo < today ? campaign.dateTo : today;
        const started = campaign.dateFrom <= today;
        const queryFrom = addDays(campaign.dateFrom, -MAX_BASELINE_SPAN_DAYS);
        const rows = started
          ? await sales.campaignDailyUnits(campaignId, queryFrom, duringTo)
          : [];

        const uplift = upliftFor({
          today,
          windows: [
            {
              campaignId,
              campaignName: campaign.name,
              percent: campaign.percent,
              from: campaign.dateFrom,
              to: campaign.dateTo,
            },
          ],
          syncDays: syncState,
          days: rows.map((row) => ({ day: row.day, units: row.units })),
        });

        return {
          campaignId,
          today,
          available: uplift.available,
          state: stateFor(uplift),
          reason: uplift.reason,
          campaign: {
            name: campaign.name,
            status: campaign.status,
            percent: campaign.percent,
            dateFrom: campaign.dateFrom,
            dateTo: campaign.dateTo,
            itemsTotal: campaign.itemsTotal,
          },
          unit: 'ks',
          spanDays: uplift.spanDays,
          startsOn: uplift.startsOn,
          duringTruncated: uplift.duringTruncated,
          before: uplift.before,
          during: uplift.during,
          deltaPercent: uplift.deltaPercent,
          deltaReason: uplift.deltaReason,
          missingBefore: uplift.missingBefore,
          missingDuring: uplift.missingDuring,
          locked,
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsCampaignEffectivenessGet();
