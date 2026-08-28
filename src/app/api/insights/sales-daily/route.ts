/**
 * Aura Zľavy — `GET /api/insights/sales-daily` (V1).
 *
 * DENNÝ PRIEBEH PREDAJA pre graf v Prehľade. `/api/sales` vracia súčty na
 * PRODUKT (koľko kusov za celé okno), nie rad po dňoch — sekcia „Predaj" preto
 * do 19. 8. 2026 čítala `days` z odpovede, ktorá ho nikdy neposielala, a graf sa
 * nenakreslil ani raz. Nespadlo nič: obrazovka pokojne ukazovala prázdny stav
 * „denný priebeh zatiaľ nemáme", hoci dáta v tabuľkách boli.
 *
 * ROZDIEL, KVÔLI KTORÉMU TÁTO ROUTE VÔBEC EXISTUJE
 * ────────────────────────────────────────────────
 *
 * Vracia LEN dni, ktoré `sales_sync_state` označuje za stiahnuté
 * (`complete`/`partial`). Deň, ktorý sa nikdy nesťahoval, v odpovedi CHÝBA —
 * nedostane nulu. Deň, ktorý sa stiahol a nemá ani jeden riadok predaja,
 * naopak nulu dostane, lebo nula je vtedy meraný fakt.
 *
 * Každý deň nesie aj `status` (24. 8. 2026). Bez neho sa `complete` s nulou
 * a `partial`, ktorému sťahovanie spadlo skôr, než čokoľvek priniesol, čítali
 * v UI rovnako — ako nula. K 24. 8. 2026 je taká presne polovica mesiaca:
 * 5. a 6. 8. sú `complete`, 7.–22. 8. sú `partial` po chybe `forbidden`
 * a `ip_banned`, teda BEZ RIADKOV. Kto `status` z odpovede odstráni, vráti na
 * prístrojovú dosku dva týždne vymyslených núl. Rozhodnutie, čo z toho je
 * meraná nula a čo diera, robí `sales-view.ts`; route len nezahadzuje fakt,
 * na ktorom to rozhodnutie stojí.
 *
 * Tie dve veci sa nesmú zliať: „predalo sa 0 kusov" je tvrdenie o eshope,
 * „ten deň sme nesťahovali" je tvrdenie o appke. Graf z toho prvého kreslí bod
 * na nule a z toho druhého dieru. Kto sem doplní chýbajúce dni nulami, urobí
 * z výpadku sťahovania prepad predaja — a bude to vyzerať vierohodne.
 *
 * ROZSAH: tie isté produkty ako `/api/sales`, teda aktívny výber bez tých,
 * ktoré v shope neexistujú. NIE celý katalóg. Volajúci to musí v UI pomenovať;
 * rad kusov bez uvedeného rozsahu vyzerá ako obrat celého eshopu.
 *
 * OKNO 7/30/90 A PRIZNANÁ MEDZERA (28. 8. 2026, D113/D119)
 * -------------------------------------------------------
 * `?window=7|30|90` (default 30) je prepínač Prehľadu. Dve veci, ktoré sa na
 * ňom nesmú pokaziť:
 *
 *  1. **`days` je odteraz OREZANÉ na okno.** Bez toho by si okno filtrovala
 *     obrazovka sama a `gaps` (spočítané tu) by hovorili o inom úseku než
 *     nakreslený rad — dve odpovede na jednu otázku. Semantika riadku je
 *     nezmenená: v `days` je LEN deň, ktorý sa naozaj sťahoval.
 *  2. **`gaps` je prvotriedny údaj, nie poznámka.** `gaps.unknownDays` je
 *     presne to „koľko dní okna nemáme", `gaps.missing` menuje ktoré, a
 *     `gaps.days` má riadok pre KAŽDÝ deň okna — takže graf vie nakresliť
 *     dieru na správnom mieste, nie len vypísať počet.
 *
 * `unitsState` hovorí, čím je `windowUnits`: `measured` (celé okno dočítané),
 * `lower_bound` (časť dní chýba, súčet je dolná hranica) alebo `unknown`
 * (nedočítal sa ani jeden deň → `windowUnits` je `null`, NIE nula).
 *
 * TRŽBA TU NIE JE. Denná tržba eshopu má vlastnú route
 * (`/api/insights/revenue-daily`, D117) a je to zámerné: tržba je EŠOPOVÁ, kusy
 * sú za VÝBER produktov. Jedna odpoveď s oboma číslami by ich postavila vedľa
 * seba ako dve strany tej istej veci a niekto by z nich vydelil cenu za kus.
 *
 * ČISTO ČÍTACIE. Žiadne volanie shopu (sťahovanie objednávok má na starosti
 * jediný povolený modul a beží nočne), žiadny zápis, teda ani cesta, ktorá by
 * obišla potvrdenie. Nesiaha na `/api/order*` ani na zákaznícke dáta.
 *
 * Vlastník: V1.
 */
import { z } from 'zod';

import type { DateOnly } from '@/contracts';

import { env } from '@/env';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { isDateOnly, todayInZone } from '@/lib/domain/dates';
import { insightsRepo as defaultInsightsRepo } from '@/lib/repo/insights.repo';
import {
  dailyUnits as defaultDailyUnits,
  summarizeCoverage,
  syncDays as defaultSyncDays,
} from '@/lib/sales/insights';

import {
  DEFAULT_WINDOW_DAYS,
  measurementState,
  windowCoverage,
  windowQuery,
  windowRange,
  type MeasurementState,
  type WindowCoverage,
  type WindowRange,
} from '../_shared';

/** Voliteľné kotvenie „dneška" — testy nemajú prepisovať systémový čas. */
const querySchema = z.object({
  anchor: z
    .string()
    .refine((v) => isDateOnly(v), 'Očakáva sa existujúci kalendárny deň v tvare RRRR-MM-DD.')
    .optional(),
  /** Prepínač okna Prehľadu (D113). Nepovolená hodnota je 400, nie fallback. */
  window: windowQuery,
});

/**
 * Jeden deň odpovede. `status` je tu preto, lebo `units: 0` sám o sebe
 * nerozlíši „stiahli sme deň a nepredalo sa nič" od „sťahovanie spadlo
 * a neprinieslo ani riadok".
 */
export interface SalesDailyRow {
  day: DateOnly;
  units: number;
  status: 'complete' | 'partial';
}

/**
 * Celá odpoveď route. Je tu ako typ zámerne: obrazovka si má vedieť overiť, že
 * `gaps` a `unitsState` NEIGNORUJE — bez nich je `windowUnits` číslo bez vety.
 */
export interface SalesDailyResponse {
  today: DateOnly;
  /** Okno prepínača (7/30/90) tak, ako sa naozaj použilo. */
  window: WindowRange;
  /** Pokrytie podľa `lib/sales/insights` — celé sťahované obdobie, nie okno. */
  coverage: ReturnType<typeof summarizeCoverage>;
  /** Medzera OKNA po dňoch (D119) — koľko dní nemáme a ktoré to sú. */
  gaps: WindowCoverage;
  /** Súčet kusov za dočítané dni okna. `null` = ani jeden deň nie je dočítaný. */
  windowUnits: number | null;
  unitsState: MeasurementState;
  days: SalesDailyRow[];
}

export interface SalesDailyDeps {
  salesInsights?: {
    syncDays: typeof defaultSyncDays;
    dailyUnits: typeof defaultDailyUnits;
  };
  insightsRepo?: Pick<typeof defaultInsightsRepo, 'discountDepth'>;
  now?: () => Date;
  timeZone?: string;
  syncEnabled?: boolean;
  windowDays?: number;
}

export function createInsightsSalesDailyGet(
  overrides: SalesDailyDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const sales = overrides.salesInsights ?? {
    syncDays: defaultSyncDays,
    dailyUnits: defaultDailyUnits,
  };
  const insights = overrides.insightsRepo ?? defaultInsightsRepo;
  const now = overrides.now ?? (() => new Date());

  return defineRoute(
    {
      method: 'GET',
      query: querySchema,
      handler: async (ctx) => {
        // LAZY čítanie ENV — eager by spustilo validáciu už počas zostavenia.
        const timeZone = overrides.timeZone ?? env.LOGIC_TIMEZONE;
        const syncEnabled = overrides.syncEnabled ?? env.SALES_SYNC_ENABLED;
        const windowDays = overrides.windowDays ?? env.SALES_WINDOW_DAYS;
        const today = ctx.query.anchor ?? todayInZone(now(), timeZone);

        const range = windowRange(today, ctx.query.window ?? DEFAULT_WINDOW_DAYS);

        const syncState = await sales.syncDays();
        const coverage = summarizeCoverage(syncState, { syncEnabled, windowDays });
        /* Medzera okna sa počíta VŽDY — aj keď nie je ani jeden stiahnutý deň. */
        const gaps = windowCoverage(syncState, range);

        /* Dni, o ktorých appka NIEČO vie, ORÉZANÉ na okno prepínača. */
        const covered = syncState
          .flatMap((row) =>
            (row.status === 'complete' || row.status === 'partial') &&
            row.saleDay >= range.from &&
            row.saleDay <= range.to
              ? [{ saleDay: row.saleDay, status: row.status }]
              : [],
          )
          .sort((a, b) => (a.saleDay < b.saleDay ? -1 : a.saleDay > b.saleDay ? 1 : 0));

        if (
          !coverage.hasData ||
          coverage.from == null ||
          coverage.to == null ||
          covered.length === 0
        ) {
          return {
            today,
            window: range,
            coverage,
            gaps,
            windowUnits: null,
            unitsState: 'unknown' as MeasurementState,
            days: [] as SalesDailyRow[],
          };
        }

        const products = (await insights.discountDepth())
          .filter((row) => row.shopStatus !== 'not_found')
          .map((row) => row.productId);

        /*
         * Dotaz sa pýta na PRIESEČNÍK okna a pokrytia. Pýtať sa na celé okno by
         * bolo čítanie dní, o ktorých vieme, že riadky nemajú; pýtať sa na celé
         * pokrytie by prinieslo dni mimo okna, ktoré by sa do `days` aj tak
         * nedostali.
         */
        const from = coverage.from > range.from ? coverage.from : range.from;
        const to = coverage.to < range.to ? coverage.to : range.to;
        const rows = await sales.dailyUnits(products, from, to);

        /*
         * Kľúčom je STIAHNUTÝ deň, nie deň s riadkom predaja. Preto sa mapa
         * zakladá zo `covered` a až potom sa do nej sčítavajú kusy: stiahnutý
         * deň bez predaja tak vyjde 0 (meraný fakt) a nestiahnutý deň
         * v odpovedi vôbec nebude (appka o ňom nič netvrdí).
         */
        const byDay = new Map<DateOnly, number>(covered.map((row) => [row.saleDay, 0]));
        for (const row of rows) {
          const current = byDay.get(row.saleDay);
          if (current === undefined) continue;
          byDay.set(row.saleDay, current + row.unitsSold);
        }

        /*
         * Riadky sa skladajú PRIAMO zo `covered`, ktoré nesie deň AJ jeho
         * skutočný `status` — nie spojením dvoch paralelných máp s náhradnou
         * hodnotou. Dovtedy tu bolo `statusByDay.get(day) ?? 'complete'`:
         * nedosiahnuteľné (obe mapy vznikali z toho istého poľa), ale náhradná
         * hodnota mierila NESPRÁVNYM smerom. Deň, o ktorého stiahnutí by sa
         * status nenašiel, by sa vydával za DOČÍTANÝ a `windowUnits` nižšie by
         * ho zrátalo ako MERANIE — presne to zliatie „nevieme" do nuly, ktoré
         * zakazuje I11 a ktoré sa v tomto repe raz už do produkcie dostalo.
         * Takto sa `status` nedá vymyslieť, lebo tu nie je čo dopĺňať.
         *
         * `?? 0` pri kusoch zostáva a je to iná vec: `byDay` je nasadená zo
         * `covered` s nulou, takže nula znamená „deň sa sťahoval a predaj v ňom
         * nebol" — MERANÝ fakt, nie dosadená hodnota.
         */
        const days: SalesDailyRow[] = covered
          .map(({ saleDay, status }) => ({ day: saleDay, units: byDay.get(saleDay) ?? 0, status }))
          .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

        /*
         * Súčet okna sa počíta VÝHRADNE z dní `complete`. `partial` deň je
         * dolná hranica; keby sa pripočítal, `windowUnits` by miešalo meranie
         * s odhadom a `unitsState` by o tej zmesi nič nepovedalo.
         */
        const state = measurementState(gaps);
        const windowUnits =
          state === 'unknown'
            ? null
            : days.reduce((sum, row) => (row.status === 'complete' ? sum + row.units : sum), 0);

        return { today, window: range, coverage, gaps, windowUnits, unitsState: state, days };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsSalesDailyGet();
