/**
 * Aura Zľavy — `GET /api/catalog/search` (KONTRAKT V3: K7, K8, I11).
 *
 * Jediná cesta, ktorou tab Produkty číta zrkadlo katalógu (40 483 riadkov).
 * Vracia STRÁNKU riadkov + počty do bočného panela — nikdy celý katalóg.
 *
 * Tri veci, na ktorých táto route stojí:
 *
 *  1. **K8 — zamknuté filtre sa priznávajú, nie predstierajú.** Shop API dnes
 *     nevracia kategóriu, kov, typ šperku, nákupnú cenu ani sklad. Keď taký
 *     filter príde v query, route ho NEAPLIKUJE a vráti ho v `lockedFilters`
 *     spolu s `lockedRequested`. Tichá nula alebo ignorovanie filtra bez slova
 *     by bolo presne to klamstvo, ktoré K8 zakazuje — používateľ by dostal
 *     „výsledok filtra", ktorý filter nikdy nevidel.
 *  2. **I11 — „v zľave" znamená „podľa VLASTNÉHO zápisu".** Shop skutočný stav
 *     zľavy cez API nevracia (backlog B1), takže `discountedNow`
 *     a `everDiscounted` sú dopočítané z `campaign_items.status = 'ok'`.
 *     Route to nesmie prezentovať ako pravdu o shope a preto to nesie aj názov
 *     poľa `source: 'own_writes'`.
 *  3. **P7 — „Dáta k …" je meraný fakt.** `dataAsOf` je `MAX(fetched_at)`
 *     z katalógu, nie odhad; keď je katalóg prázdny, je `null` a UI to má
 *     povedať, nie dopočítať.
 *
 * Čisto čítacie — na shop neodíde ani jeden request.
 *
 * Vlastník: V8.
 */
import { z } from 'zod';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  catalogRepo as defaultCatalogRepo,
  type CatalogRepoExt,
  type CatalogSearchFilter,
  type CatalogShopStatus,
  type CatalogSort,
  type LockedCatalogFilter,
  type SoldBucket,
} from '@/lib/repo/catalog.repo';

/* ═══════════════════════════ 1. Zod pre query ═════════════════════════════ */

/** `?flag`, `?flag=1`, `?flag=true` → `true`; `0`/`false`/chýba → `false`. */
const boolQuery = z
  .union([z.literal(''), z.enum(['0', '1', 'true', 'false'])])
  .optional()
  .transform((value) => value === '' || value === '1' || value === 'true');

/** Jedna hodnota alebo zoznam oddelený čiarkou (`?soldBuckets=none,low`). */
const csvQuery = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value): string[] => {
    if (value === undefined) return [];
    const parts = Array.isArray(value) ? value : [value];
    return parts.flatMap((part) => part.split(',')).map((s) => s.trim()).filter((s) => s.length > 0);
  });

const SOLD_BUCKETS: readonly SoldBucket[] = ['none', 'low', 'mid', 'high'];
const SHOP_STATUSES: readonly CatalogShopStatus[] = ['ok', 'not_found', 'unknown'];
const SORTS: readonly CatalogSort[] = ['name', 'price_asc', 'price_desc', 'sold_asc', 'sold_desc', 'id'];

/**
 * Filtre, na ktoré appka nemá dáta (K8). Zoznam je zámerne v repozitári
 * (`LOCKED_FILTERS`) — tu sú len názvy, na ktoré sa počúva v query, aby route
 * vedela povedať „tento si poslal a ja som ho NEPOUŽILA".
 */
const LOCKED_QUERY_KEYS: readonly LockedCatalogFilter[] = [
  'stock',
  'category',
  'metal',
  'jewelryType',
  'margin',
  'turnover',
];

const searchQuerySchema = z.object({
  /** Názov, ID alebo SKU — jedno pole nad tabuľkou (odpoveď 71). */
  q: z.string().max(191).optional(),
  priceFrom: z.string().max(20).optional(),
  priceTo: z.string().max(20).optional(),
  /** Prepínač obdobia 30/60/90/180/360; nezmysel spadne na default repozitára. */
  soldWindowDays: z.coerce.number().int().optional(),
  soldBuckets: csvQuery,
  shopStatus: csvQuery,
  neverDiscounted: boolQuery,
  currentlyDiscounted: boolQuery,
  productIds: csvQuery,
  sort: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  /** `counts=0` vypne počty do bočného panela (druhý dotaz navyše). */
  counts: z
    .union([z.literal(''), z.enum(['0', '1', 'true', 'false'])])
    .optional()
    .transform((value) => value !== '0' && value !== 'false'),
});

/* ═══════════════════════════ 2. Závislosti ════════════════════════════════ */

export interface CatalogSearchRouteDeps {
  catalog?: Pick<CatalogRepoExt, 'search' | 'counts' | 'totalRows' | 'lastFetchedAt'>;
  routeDeps?: RouteDeps;
}

/** Jeden zamknutý filter v odpovedi (K8). `locked` je vždy `true`. */
export interface LockedFilterView {
  locked: true;
  /** `true` = klient tento filter poslal a route ho NEAPLIKOVALA. */
  requested: boolean;
}

/**
 * K8 — zamknuté filtre ako mapa, aby ich UI vedelo vykresliť sivé a neklikateľné
 * bez toho, aby ich zoznam duplikovalo. Keď dáta zo shopu pribudnú, filter zmizne
 * z `LOCKED_FILTERS` v repozitári a odtiaľto sám od seba.
 */
export function lockedFiltersView(
  locked: readonly LockedCatalogFilter[],
  requested: readonly LockedCatalogFilter[],
): Record<string, LockedFilterView> {
  const out: Record<string, LockedFilterView> = {};
  for (const key of locked) {
    out[key] = { locked: true, requested: requested.includes(key) };
  }
  return out;
}

/* ═══════════════════════════ 3. Route ═════════════════════════════════════ */

export function createCatalogSearchRoute(deps: CatalogSearchRouteDeps = {}): NextRouteHandler {
  const catalog = deps.catalog ?? defaultCatalogRepo;

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      query: searchQuerySchema,
      handler: async (ctx) => {
        const q = ctx.query;

        /* K8 — ktoré zamknuté filtre klient poslal. NEAPLIKUJÚ sa; vraciame ich,
         * aby UI vedelo povedať „čaká na dáta zo shopu", nie mlčky vrátiť iné
         * čísla, než o aké si používateľ pýtal. */
        const url = new URL(ctx.request.url);
        const lockedRequested = LOCKED_QUERY_KEYS.filter((key) => url.searchParams.has(key));

        const filter: CatalogSearchFilter = {
          page: q.page,
          perPage: q.perPage,
          neverDiscounted: q.neverDiscounted,
          currentlyDiscounted: q.currentlyDiscounted,
        };
        if (q.q !== undefined && q.q.trim().length > 0) filter.query = q.q.trim();
        if (q.priceFrom !== undefined) filter.priceFrom = q.priceFrom;
        if (q.priceTo !== undefined) filter.priceTo = q.priceTo;
        if (q.soldWindowDays !== undefined) filter.soldWindowDays = q.soldWindowDays;

        const buckets = q.soldBuckets.filter((v): v is SoldBucket =>
          (SOLD_BUCKETS as readonly string[]).includes(v),
        );
        if (buckets.length > 0) filter.soldBuckets = buckets;

        const statuses = q.shopStatus.filter((v): v is CatalogShopStatus =>
          (SHOP_STATUSES as readonly string[]).includes(v),
        );
        if (statuses.length > 0) filter.shopStatus = statuses;

        if (q.productIds.length > 0) {
          // Neplatné ID sa zahodí tu; prázdny výber je v repozitári fail-closed
          // prázdny výsledok, nie „bez filtra".
          filter.productIds = q.productIds
            .map((v) => Number(v))
            .filter((v) => Number.isInteger(v) && v > 0);
        }

        if (q.sort !== undefined && (SORTS as readonly string[]).includes(q.sort)) {
          filter.sort = q.sort as CatalogSort;
        }

        const result = await catalog.search(filter);
        const counts = q.counts ? await catalog.counts(filter) : null;
        const catalogTotal = await catalog.totalRows();
        const dataAsOf = await catalog.lastFetchedAt();

        return {
          data: result.data.map((row) => ({
            productId: row.productId,
            name: row.name,
            price: row.price,
            hasAttributes: row.hasAttributes,
            shopStatus: row.shopStatus,
            unitsSold: row.unitsSold,
            // I11 — obe polia sú z NAŠICH zápisov, nie zo shopu (backlog B1).
            everDiscounted: row.everDiscounted,
            discountedNow: row.discountedNow,
            fetchedAt: row.fetchedAt.toISOString(),
          })),
          page: result.page,
          perPage: result.perPage,
          total: result.total,
          /** Okno, za ktoré je `unitsSold` — bez neho je číslo nečitateľné (P7). */
          soldWindowDays: result.soldWindowDays,
          soldFrom: result.soldFrom,
          soldTo: result.soldTo,
          counts,
          /** Koľko riadkov má katalóg vôbec („z 40 483 produktov"). */
          catalogTotal,
          /** P7 — meraný fakt „Dáta k …", nie odhad. `null` = katalóg je prázdny. */
          dataAsOf: dataAsOf === null ? null : dataAsOf.toISOString(),
          /**
           * K8 — filtre bez dát. VŽDY prítomné (aj keď si o ne nikto nepýtal),
           * vždy `locked: true` a nikdy k nim nie sú žiadne hodnoty. `requested`
           * hovorí, že klient taký filter poslal a route ho NEPOUŽILA.
           */
          lockedFilters: lockedFiltersView(result.lockedFilters, lockedRequested),
          /** Čo znamená „v zľave" — nikdy netvrdíme, že poznáme stav shopu (I11). */
          discountSource: 'own_writes' as const,
        };
      },
    },
    deps.routeDeps,
  );
}

export const GET = createCatalogSearchRoute();
