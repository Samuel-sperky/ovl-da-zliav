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

/** Voliteľné kotvenie „dneška" — testy nemajú prepisovať systémový čas. */
const querySchema = z.object({
  anchor: z
    .string()
    .refine((v) => isDateOnly(v), 'Očakáva sa existujúci kalendárny deň v tvare RRRR-MM-DD.')
    .optional(),
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

        const syncState = await sales.syncDays();
        const coverage = summarizeCoverage(syncState, { syncEnabled, windowDays });

        /* Dni, o ktorých appka NIEČO vie. `pending` medzi nimi nie je. */
        const covered = syncState
          .flatMap((row) =>
            row.status === 'complete' || row.status === 'partial'
              ? [{ saleDay: row.saleDay, status: row.status }]
              : [],
          )
          .sort((a, b) => (a.saleDay < b.saleDay ? -1 : a.saleDay > b.saleDay ? 1 : 0));

        if (!coverage.hasData || coverage.from == null || coverage.to == null) {
          return { today, coverage, days: [] as SalesDailyRow[] };
        }

        const products = (await insights.discountDepth())
          .filter((row) => row.shopStatus !== 'not_found')
          .map((row) => row.productId);

        const rows = await sales.dailyUnits(products, coverage.from, coverage.to);

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

        const statusByDay = new Map(covered.map((row) => [row.saleDay, row.status]));
        const days: SalesDailyRow[] = [...byDay.entries()]
          .map(([day, units]) => ({ day, units, status: statusByDay.get(day) ?? 'complete' }))
          .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

        return { today, coverage, days };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsSalesDailyGet();
