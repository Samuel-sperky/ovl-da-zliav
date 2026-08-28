/**
 * Aura Zľavy — `GET /api/insights/top-products` (V4, D113).
 *
 * TOP 10 A FLOP 10 PRODUKTOV za okno 7/30/90 dní pre prvú stranu. Poradie stojí
 * VÝHRADNE na predaných KUSOCH z `product_sales_daily` (D117 — tržba per produkt
 * neexistuje, API ceny položiek nevracia).
 *
 * ═══ KOHO SA REBRÍČEK VÔBEC TÝKA (a prečo nie všetkých) ═══
 * Do rebríčka vstupuje LEN produkt, ktorý má v okne aspoň JEDEN nameraný predaj.
 * Produkt bez predaja NEPATRÍ ani do topu, ani do flopu — a to je vedomé
 * rozhodnutie, nie zaokrúhlenie:
 *
 *  · Kým okno nie je celé dočítané, „0 predaných" o ňom vôbec nie je meranie
 *    (I11). Postaviť ho na dno flopu by z výpadku sťahovania urobilo najhoršie
 *    predávaný produkt.
 *  · Aj pri dočítanom okne je „za 30 dní ani jeden kus" iná otázka než „ktorý
 *    z predávaných je najslabší". Prvá je zoznam ležiakov a odpovedá na ňu tab
 *    Produkty (vedro predajnosti `none` v bočnom paneli), kde sa dá filtrovať a
 *    stránkovať. Desať náhodných nulových riadkov z 41 348 by na Prehľade
 *    nepovedalo nič — a vyzeralo by to ako zistenie.
 *
 * Preto `flop` znamená „najslabší Z PREDÁVANÝCH", nie „nepredáva sa". Odpoveď to
 * hovorí aj strojovo: `excludes.zeroSales = true` a `cohort.size`.
 *
 * ═══ AKO SA OKNO POČÍTA ═══
 * Dve cesty, obe nad tými istými riadkami, len s iným plánom dotazu:
 *
 *  A. **Okno, ktoré zrkadlo katalógu vie triediť samo** (30 a 90 dní): poradie
 *     robí SQL (`sort: sold_desc` / `sold_asc`) a vráti presne `limit` riadkov.
 *     Dva dotazy na stranu, žiadny prechod katalógu v JS.
 *  B. **Okno, ktoré `catalog.repo.ts` v `ALLOWED_SOLD_WINDOWS` nemá** (dnes 7
 *     dní): zoberie sa CELÁ kohorta produktov s predajom za 30 dní — čo je
 *     nadmnožina kohorty 7 dní, lebo kto predal v posledných 7 dňoch, predal aj
 *     v posledných 30 — a súčty za skutočné okno sa dopočítajú z
 *     `product_sales_daily`. Poradie je tým PRESNÉ, nie približné.
 *     Keď je kohorta väčšia než `COHORT_MAX`, rebríček sa NEVRÁTI
 *     (`reason: 'cohort_too_large'`) — orezaná kohorta by dala poradie, ktoré
 *     vyzerá presne ako správne a nie je ním.
 *
 * Cesta B existuje len preto, že 7 dní nie je medzi povolenými oknami zrkadla;
 * keď tam pribudne, celá vetva zmizne a nič iné sa nezmení.
 *
 * ═══ ČO ODPOVEĎ PRIZNÁVA ═══
 *  · `gaps` — koľko dní okna appka nemá a ktoré to sú (D119).
 *  · `rankingState` — `measured` (celé okno dočítané), `lower_bound` (časť dní
 *    chýba, takže súčty aj PORADIE sú dolná hranica) alebo `unknown`. Pri
 *    `unknown` sa nevracia ani jeden riadok: bez jediného dočítaného dňa nie je
 *    čo radiť.
 *  · `reference` / `name` — D116 „ref · názov". Chýbajúca referencia je `null`
 *    (pomlčka + id v UI), nikdy prázdny string.
 *  · `marginPercent`, `qty` — z obohatenia `getFull`; `null` = neobohatené,
 *    teda „nevieme" (D118), NIKDY nula.
 *
 * ČISTO ČÍTACIE. Žiadne volanie shopu (K8), žiadny zápis, žiadny kľúč (I1).
 *
 * Vlastník: vlna V4-ENDPOINTY.
 */
import { z } from 'zod';

import type { DateOnly, MoneyString } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  catalogRepo as defaultCatalogRepo,
  type CatalogSearchRow,
} from '@/lib/repo/catalog.repo';
import {
  dailyUnits as defaultDailyUnits,
  syncDays as defaultSyncDays,
} from '@/lib/sales/insights';

import {
  DEFAULT_WINDOW_DAYS,
  anchorQuery,
  measurementState,
  resolveInsightsDeps,
  todayOf,
  windowCoverage,
  windowQuery,
  windowRange,
  type InsightsDeps,
  type MeasurementState,
  type WindowCoverage,
  type WindowRange,
} from '../_shared';

/* ═══════════════════════════ 1. Konštanty ═════════════════════════════════ */

/** Koľko riadkov má top aj flop. Prehľad ich podľa kontraktu V4 §2 ukazuje 10. */
export const DEFAULT_TOP_LIMIT = 10;

/** Strop riadkov — Prehľad nie je analytická platforma. */
const MAX_TOP_LIMIT = 50;

/**
 * Okná, ktoré zrkadlo katalógu vie triediť v SQL (`ALLOWED_SOLD_WINDOWS`
 * v `catalog.repo.ts`). Nie je to náš zoznam a nesmie sa rozšíriť tu — keď
 * niekto pridá 7 do repozitára, pridá ho AJ sem, a cesta B prestane byť
 * potrebná.
 */
const MIRROR_SORTABLE_WINDOWS: readonly number[] = [30, 90];

/**
 * Nadmnožinové okno pre cestu B. Musí byť z `MIRROR_SORTABLE_WINDOWS` a musí
 * byť DLHŠIE než každé okno, ktoré ňou obsluhujeme (kto predal v 7 dňoch,
 * predal aj v 30).
 */
const COHORT_WINDOW_DAYS = 30;

/** Najväčšia kohorta, ktorú je cesta B ochotná prejsť (3 strany po 200). */
const COHORT_MAX = 600;

/** Strana zrkadla; `MAX_PER_PAGE` v `catalog.repo.ts` je 200. */
const COHORT_PAGE = 200;

/* ═══════════════════════════════ 2. Typy ══════════════════════════════════ */

/** Jeden riadok rebríčka. Kusy, nikdy eurá per produkt (D117). */
export interface TopProductRow {
  productId: number;
  /** D116 — kód produktu. `null` = zrkadlo ho nemá (pomlčka + id v UI). */
  reference: string | null;
  name: string | null;
  price: MoneyString | null;
  /** Predané kusy za okno. Vždy ≥ 1 — nula do rebríčka nevstupuje. */
  units: number;
  /** Podľa VLASTNÉHO zápisu je produkt dnes v okne zľavy (I11). */
  discountedNow: boolean;
  /** Marža v % z `getFull`. `null` = neobohatené, teda „nevieme" (D118). */
  marginPercent: number | null;
  /** Sklad z `getFull`. `0` je platná nula, `null` je „nevieme". */
  qty: number | null;
  /** `false` = produkt sa nikdy neobohatil, takže marža a sklad sú „nevieme". */
  enriched: boolean;
}

export type TopProductsReason = 'no_coverage' | 'cohort_too_large';

export interface TopProductsResponse {
  today: DateOnly;
  window: WindowRange;
  /** `false` = rebríček sa poctivo zostaviť nedá; `reason` hovorí prečo. */
  available: boolean;
  reason: TopProductsReason | null;
  /** Najviac predávané, zoradené zostupne. Prázdne, keď `available` je `false`. */
  top: TopProductRow[];
  /** Najmenej predávané Z PREDÁVANÝCH, zoradené vzostupne. */
  flop: TopProductRow[];
  /**
   * Koho sa rebríček týka: koľko produktov má v okne aspoň jeden NAMERANÝ
   * predaj. Je to presný počet nad tým, čo appka stiahla — nie počet
   * predávaných produktov eshopu; to hovorí `rankingState` a `gaps`.
   */
  cohort: { size: number };
  /** Čo do rebríčka ZÁMERNE nevstupuje — aby to obrazovka mohla povedať. */
  excludes: { zeroSales: true; notFound: true };
  gaps: WindowCoverage;
  rankingState: MeasurementState;
}

export interface TopProductsDeps extends InsightsDeps {
  catalogRepo?: Pick<typeof defaultCatalogRepo, 'search' | 'counts' | 'enrichmentFor'>;
  salesInsights?: {
    syncDays: typeof defaultSyncDays;
    dailyUnits: typeof defaultDailyUnits;
  };
}

const querySchema = z.object({
  anchor: anchorQuery,
  window: windowQuery,
  limit: z.coerce.number().int().min(1).max(MAX_TOP_LIMIT).optional(),
});

/* ═══════════════════════════ 3. Pomocníci ════════════════════════════════ */

/** Vedrá predajnosti BEZ nuly — presne tie produkty, o ktorých niečo vieme. */
const SOLD_BUCKETS = ['low', 'mid', 'high'] as const;

function toRow(
  source: Pick<CatalogSearchRow, 'productId' | 'name' | 'price' | 'discountedNow'>,
  units: number,
  enrichment: { reference: string | null; marginPercent: number | null; qty: number | null; enrichedAt: unknown } | undefined,
): TopProductRow {
  return {
    productId: source.productId,
    reference: enrichment?.reference ?? null,
    name: source.name,
    price: source.price,
    units,
    discountedNow: source.discountedNow,
    marginPercent: enrichment?.marginPercent ?? null,
    qty: enrichment?.qty ?? null,
    // `enrichedAt === null` znamená „nikdy sa neobohatil" (I11) — porovnáva sa
    // explicitne, `!enrichment.enrichedAt` už raz Turbopack zahodil.
    enriched: enrichment !== undefined && enrichment.enrichedAt !== null,
  };
}

/* ═══════════════════════════════ 4. Route ═════════════════════════════════ */

export function createInsightsTopProductsGet(
  overrides: TopProductsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  const catalog = overrides.catalogRepo ?? defaultCatalogRepo;
  const sales = overrides.salesInsights ?? {
    syncDays: defaultSyncDays,
    dailyUnits: defaultDailyUnits,
  };

  return defineRoute(
    {
      method: 'GET',
      query: querySchema,
      handler: async (ctx): Promise<TopProductsResponse> => {
        const today = ctx.query.anchor ?? todayOf(d);
        const range = windowRange(today, ctx.query.window ?? DEFAULT_WINDOW_DAYS);
        const limit = ctx.query.limit ?? DEFAULT_TOP_LIMIT;

        const gaps = windowCoverage(await sales.syncDays(), range);
        const rankingState = measurementState(gaps);

        const empty: TopProductsResponse = {
          today,
          window: range,
          available: false,
          reason: null,
          top: [],
          flop: [],
          cohort: { size: 0 },
          excludes: { zeroSales: true, notFound: true },
          gaps,
          rankingState,
        };

        /*
         * Bez jediného dočítaného dňa sa neradí nič. Poradie postavené výhradne
         * na `partial` dňoch by bolo poradie výpadkov sťahovania.
         */
        if (rankingState === 'unknown') return { ...empty, reason: 'no_coverage' };

        const sortable = MIRROR_SORTABLE_WINDOWS.includes(range.days);

        let topRows: Array<{ row: CatalogSearchRow; units: number }>;
        let flopRows: Array<{ row: CatalogSearchRow; units: number }>;
        let cohortSize: number;

        if (sortable) {
          /* ── Cesta A: triedi SQL. ─────────────────────────────────────── */
          const filter = {
            soldWindowDays: range.days,
            soldBuckets: [...SOLD_BUCKETS],
            today,
            perPage: limit,
            page: 1,
          };
          const desc = await catalog.search({ ...filter, sort: 'sold_desc' as const });
          const asc = await catalog.search({ ...filter, sort: 'sold_asc' as const });
          topRows = desc.data.map((row) => ({ row, units: row.unitsSold }));
          flopRows = asc.data.map((row) => ({ row, units: row.unitsSold }));
          cohortSize = desc.total;
        } else {
          /* ── Cesta B: presné súčty nad nadmnožinovou kohortou. ───────── */
          const counts = await catalog.counts({
            soldWindowDays: COHORT_WINDOW_DAYS,
            today,
          });
          const size = counts.sold.low + counts.sold.mid + counts.sold.high;
          if (size > COHORT_MAX) {
            return { ...empty, reason: 'cohort_too_large', cohort: { size } };
          }

          const cohort: CatalogSearchRow[] = [];
          for (let page = 1; page <= Math.ceil(COHORT_MAX / COHORT_PAGE); page += 1) {
            const chunk = await catalog.search({
              soldWindowDays: COHORT_WINDOW_DAYS,
              soldBuckets: [...SOLD_BUCKETS],
              today,
              sort: 'sold_desc' as const,
              perPage: COHORT_PAGE,
              page,
            });
            cohort.push(...chunk.data);
            if (cohort.length >= chunk.total || chunk.data.length === 0) break;
          }

          const byId = new Map(cohort.map((row) => [row.productId, row]));
          const units = new Map<number, number>();
          for (const row of await sales.dailyUnits([...byId.keys()], range.from, range.to)) {
            units.set(row.productId, (units.get(row.productId) ?? 0) + row.unitsSold);
          }

          /* Nula v skutočnom okne do rebríčka nevstupuje — viď hlavička. */
          const ranked = [...units.entries()]
            .filter(([, sum]) => sum > 0)
            .map(([productId, sum]) => ({ row: byId.get(productId)!, units: sum }))
            .sort((a, b) =>
              b.units - a.units !== 0 ? b.units - a.units : a.row.productId - b.row.productId,
            );

          topRows = ranked.slice(0, limit);
          flopRows = ranked
            .slice()
            .sort((a, b) =>
              a.units - b.units !== 0 ? a.units - b.units : a.row.productId - b.row.productId,
            )
            .slice(0, limit);
          cohortSize = ranked.length;
        }

        /* Jeden dotaz na obohatenie pre oba rebríčky — žiadne N+1. */
        const ids = [...new Set([...topRows, ...flopRows].map((entry) => entry.row.productId))];
        const enrichment = await catalog.enrichmentFor(ids);

        return {
          ...empty,
          available: true,
          top: topRows.map((entry) => toRow(entry.row, entry.units, enrichment.get(entry.row.productId))),
          flop: flopRows.map((entry) => toRow(entry.row, entry.units, enrichment.get(entry.row.productId))),
          cohort: { size: cohortSize },
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsTopProductsGet();
