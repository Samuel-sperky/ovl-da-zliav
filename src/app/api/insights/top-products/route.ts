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
 * ═══ A HOVORÍ TO AJ ČÍSLOM (2. 9. 2026, D121) ═══
 * Príznak `excludes.zeroSales: true` je pravda, ale sám o sebe je NEMERATEĽNÝ:
 * obrazovka z neho nevie povedať, koho sa to týka — desiatich produktov, alebo
 * štyridsiatich tisíc. A práve to je dnes rozdiel medzi „rebríček je takmer
 * celý eshop" a „rebríček je stotina eshopu". Preto sa vracajú DVE čísla, obe
 * zo zrkadla katalógu (`catalogRepo.counts()`):
 *
 *  · `excludes.unknownSales` — koľko riadkov má za okno predaj NEZNÁMY, teda
 *    `unitsSold === null` (D121). To je „nemerali sme", nie nula.
 *  · `excludes.measuredZeroSales` — koľko ich má nameranú NULU (vedro `none`).
 *
 * Sú to dve rôzne veci a zliať ich do jedného „vylúčených" by bolo presne to,
 * čo I11 zakazuje. Obe sú `number | null` a `null` znamená „appka to číslo za
 * TOTO okno nemá" — nie nulu:
 *
 *   `counts()` vie triediť len okná z `ALLOWED_SOLD_WINDOWS` a mimo nich si
 *   okno TICHO prepíše na predvolené (`normalizeWindowDays`). Pri okne 7 dní
 *   (cesta B) preto počty platia za 30 dní a vydávať ich za sedemdňové by bolo
 *   vymyslené číslo. Rozhoduje o tom `excludesOf()` porovnaním
 *   `counts.soldWindowDays` s oknom odpovede — nie druhá kópia zoznamu
 *   povolených okien, ktorá by sa raz rozišla.
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
  ALLOWED_SOLD_WINDOWS,
  catalogRepo as defaultCatalogRepo,
  type CatalogCounts,
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
  WINDOW_DAYS_ALLOWED,
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
 * Okná, ktoré Prehľad ponúka A zrkadlo katalógu ich vie triediť v SQL — teda
 * PRIENIK `WINDOW_DAYS_ALLOWED` (7/30/90) a `ALLOWED_SOLD_WINDOWS` z
 * `catalog.repo.ts`. Dnes je to `[30, 90]`.
 *
 * Zoznam sa tu ZÁMERNE nepíše ručne: do 31. 8. 2026 tu stála kópia `[30, 90]`
 * a jediný zdroj pravdy pritom vlastní repozitár. Keď doň pribudne `7`, cesta B
 * sa prestane volať sama a nič sa tu meniť nemusí.
 */
export const MIRROR_SORTABLE_WINDOWS: readonly number[] = WINDOW_DAYS_ALLOWED.filter((days) =>
  ALLOWED_SOLD_WINDOWS.includes(days),
);

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

/**
 * Koho sa rebríček NETÝKA — príznakom aj číslom (D121, 2. 9. 2026).
 *
 * Príznaky sú konštanty typu, lebo to pravidlo sa nemení: nula ani nenájdený
 * produkt do poradia nevstupujú nikdy. Čísla sú trojstavové (`number | null`),
 * pretože ich appka za niektoré okná NEMÁ — pozri hlavičku modulu.
 */
export interface TopProductsExcludes {
  zeroSales: true;
  notFound: true;
  /**
   * Koľko riadkov zrkadla má za okno odpovede predaj NEZNÁMY (`unitsSold ===
   * null`). `null` = počet za toto okno appka nemá; NIKDY nula.
   */
  unknownSales: number | null;
  /**
   * Koľko riadkov má za okno nameranú NULU (vedro `none`). Iná vec než
   * `unknownSales` — jedno je meranie, druhé jeho absencia (I11).
   */
  measuredZeroSales: number | null;
}

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
  excludes: TopProductsExcludes;
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

/**
 * Dve čísla o vylúčených riadkoch — alebo dve `null`, keď počty platia za INÉ
 * okno, než za aké je rebríček.
 *
 * Porovnáva sa `counts.soldWindowDays` (čo zrkadlo naozaj počítalo) s oknom
 * odpovede. `counts()` si okno mimo `ALLOWED_SOLD_WINDOWS` ticho prepíše na
 * predvolené, takže bez tejto brány by odpoveď za 7 dní niesla tridsaťdňové
 * počty a nikto by sa to nedozvedel.
 */
function excludesOf(
  counts: Pick<CatalogCounts, 'soldWindowDays' | 'soldUnknown' | 'sold'> | null,
  windowDays: number,
): TopProductsExcludes {
  const base = { zeroSales: true, notFound: true } as const;
  // Explicitné `=== null`: skrátený guard tu Turbopack už raz zahodil.
  if (counts === null || counts.soldWindowDays !== windowDays) {
    return { ...base, unknownSales: null, measuredZeroSales: null };
  }
  return { ...base, unknownSales: counts.soldUnknown, measuredZeroSales: counts.sold.none };
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
          /*
           * Kým sa `counts()` nezavolá, appka počty vylúčených NEVIE — a `null`
           * to hovorí. Nula by tvrdila „nevylučuje sa nič", čo je pri vetve
           * `no_coverage` (ani jeden dočítaný deň) presne naopak: vylučuje sa
           * VŠETKO.
           */
          excludes: excludesOf(null, range.days),
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
        /*
         * Počty CELÉHO zrkadla, z ktorých sa odvodia čísla vylúčených. Cesta B
         * ich má aj tak (potrebuje veľkosť kohorty), cesta A si ich vypýta
         * zvlášť — je to tretí `SELECT` nad lokálnou databázou, žiadne volanie
         * shopu (K8). `null` znamená „nepýtali sme sa", nie nulu.
         */
        let windowCounts: CatalogCounts | null = null;

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
          /*
           * BEZ `soldBuckets`: počty majú byť nad celým zrkadlom, nie nad tým,
           * čo do rebríčka vstúpilo. S filtrom vedier by `soldUnknown` vyšlo
           * nula — teda „netýka sa to nikoho" — a to je práve tá nepravda,
           * ktorú toto číslo má odstrániť.
           */
          windowCounts = await catalog.counts({ soldWindowDays: range.days, today });
          /*
           * Riadok s neznámym predajom (`unitsSold === null`, D121) do rebríčka
           * NEVSTUPUJE — rovnaký dôvod, prečo sa neradí bez jediného dočítaného
           * dňa: bolo by to poradie nevedomosti, nie predaja.
           */
          topRows = desc.data.flatMap((row) =>
            row.unitsSold === null ? [] : [{ row, units: row.unitsSold }],
          );
          flopRows = asc.data.flatMap((row) =>
            row.unitsSold === null ? [] : [{ row, units: row.unitsSold }],
          );
          cohortSize = desc.total;
        } else {
          /* ── Cesta B: presné súčty nad nadmnožinovou kohortou. ───────── */
          const counts = await catalog.counts({
            soldWindowDays: COHORT_WINDOW_DAYS,
            today,
          });
          /*
           * Počty sú za NADMNOŽINOVÉ okno (30 dní), nie za okno odpovede.
           * Odovzdávajú sa aj tak — `excludesOf()` ich podľa
           * `counts.soldWindowDays` zahodí na `null`. Prepočítať ich na 7 dní
           * sa nedá a odhadnúť ich by znamenalo vymyslené číslo.
           */
          windowCounts = counts;
          const size = counts.sold.low + counts.sold.mid + counts.sold.high;
          if (size > COHORT_MAX) {
            return {
              ...empty,
              reason: 'cohort_too_large',
              cohort: { size },
              excludes: excludesOf(counts, range.days),
            };
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
          excludes: excludesOf(windowCounts, range.days),
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsTopProductsGet();
