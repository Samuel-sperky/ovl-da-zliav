/**
 * Aura Zľavy — `GET /api/catalog/search` (KONTRAKT V3: K7, K8, I11;
 * KONTRAKT-UI-2026-08-13: body 20, 25–28).
 *
 * Jediná cesta, ktorou tab Produkty hľadá. Robí DVE veci, ktoré sa nesmú zliať:
 *
 *  1. **Číta zrkadlo katalógu** (`catalog_cache`) — stránka riadkov a počty do
 *     bočného panela. Nikdy celý katalóg, nikdy jediný request na shop.
 *  2. **Na vyžiadanie dohľadá v eshope, čo zrkadlo nemá** (`?lookup=1`).
 *     Zrkadlo je k 19. 8. 2026, 00:13 úplné — 41 220 z 41 220 riadkov — ale
 *     vie o produkte len NÁZOV a ČÍSLO. Kód produktu, popis a kategórie
 *     v ňom fyzicky nie sú (`raw` je `{id, name, price, has_attributes}`)
 *     a eshop medzitým pridáva a maže. Bez tohto kroku by teda „to zrkadlo
 *     nevie" vyzeralo presne ako „taký produkt neexistuje". Dohľadanie
 *     ide cez VEREJNÝ `searchIndex` + `get`, teda bez nového oprávnenia — ale
 *     míňa anonymný rozpočet čítaní, a preto sa NIKDY nespúšťa samo.
 *
 * ČO HĽADÁ ZRKADLO: SLOVÁ V `name`, `reference` A `ean13`, SPOJENÉ CEZ `AND`
 * -------------------------------------------------------------------------
 * Text z `?q=` sa v repozitári delí na slová (strop 6) a každé dostane vlastný
 * `LIKE` nad názvom, kódom produktu a EAN-om. Nie je to fráza: „náramok zirkón"
 * vráti 797 produktov, nie 10, ktoré vracal jeden súvislý podreťazec. Diakritika
 * sa nerieši nikde v kóde — kolácia `utf8mb4_unicode_ci` skladá `á` a `a` sama.
 * Prečo tu nie je FULLTEXT ani engine, hovorí hlavička `catalog.repo.ts`.
 *
 * `reference` a `ean13` sú v zrkadle vyplnené LEN pri OBOHATENÝCH produktoch
 * (migrácia 0014, D116) — pri ostatných sú `NULL` a `LIKE` na ne nesadne.
 * Hľadanie podľa kódu teda funguje, ale nad ČASŤOU katalógu, a odpoveď to
 * priznáva v `enrichedOnly` (koľko riadkov je obohatených, hovorí
 * `counts.enrichedRows`). Pre kód, ktorý zrkadlo nepozná, je tu `?lookup=1` —
 * eshop hľadá aj v kóde, popise a kategóriách.
 *
 * ŠTYRI VECI, NA KTORÝCH TÁTO ROUTE STOJÍ
 * ---------------------------------------
 *  1. **K8 — zamknuté filtre sa priznávajú, nie predstierajú.** Zrkadlo nevie
 *     kategóriu, kov, typ šperku, nákupnú cenu ani sklad. Keď taký filter
 *     príde v query, route ho NEAPLIKUJE a vráti ho v `lockedFilters` spolu
 *     s `lockedRequested`. To isté o stupeň vyššie robí `capabilities`: presné
 *     filtre eshopu, kategórie a kód produktu čakajú na oprávnenie, ktoré
 *     appka nemá — a odpoveď o tom hovorí vetou, nie mlčaním.
 *  2. **I11 — o každom produkte je vidieť, ODKIAĽ je.** `origin` je `mirror`
 *     (názov a cena z posledného prechodu synchronizácie) alebo `shop` (appka
 *     si ich práve vypýtala z eshopu, lebo v zrkadle nie sú). Bez toho by na
 *     jednej obrazovke stáli vedľa seba dva rôzne stupne istoty a vyzerali by
 *     rovnako. „V zľave" (`discountSource`) je naďalej výhradne podľa VLASTNÝCH
 *     zápisov — na ne sa pýta `?currentlyDiscounted=1`.
 *
 *     STAV ZĽAVY V SHOPE je od migrácie 0014 DRUHÁ, samostatná vec:
 *     `?shopDiscounted=1` filtruje podľa `catalog_cache.reduction_*`, teda podľa
 *     toho, čo o produkte povedal shop pri obohatení (`shopDiscountSource`).
 *     Dve vety, dva filtre, a kombinovať sa dajú („shop zlacnil, my nie").
 *     Neobohatený produkt do výsledku NESPADNE: o ňom appka stav shopu nepozná,
 *     a to je „nevieme", nie „nie je v zľave" (I11 — preto `enrichedOnly`).
 *  3. **P7 — meraný fakt a odhad sa nemiešajú.** `dataAsOf` je `MAX(fetched_at)`
 *     zrkadla, `lookup.shopTotal` je počet, ktorý eshop naozaj vrátil,
 *     `lookup.at` je čas, kedy sa hľadalo. Ani jedno nie je odhad, takže ani
 *     jedno sa neoznačuje `≈`. ALE: `total` je počet v ZRKADLE (`totalSource`),
 *     a kým zrkadlo nie je úplné (`GET /api/catalog/sync` → `complete`), je to
 *     dolná hranica — obrazovka ho vtedy musí označiť `≈` (kontrakt bod 8).
 *  4. **Rozpočet stráži jedno počítadlo.** Dohľadanie rezervuje anonymné
 *     čítania cez `catalogRepo` (A4), takže si so synchronizáciou katalógu
 *     nekradnú strop. Odpoveď nesie celý stav rozpočtu po hľadaní.
 *
 * KDE SA `capabilities[].note` SMIE VYKRESLIŤ
 * -------------------------------------------
 * VÝHRADNE v Nastaveniach → Zamknuté funkcie (`components/settings/LockedFeatures.tsx`).
 * Kontrakt bod 18 hovorí, že vysvetlenie chýbajúcich dát žije na JEDNOM mieste
 * a nerozširuje sa. Na obrazovke Produkty sa preto z `capabilities` používa len
 * `state` — zámok pri filtri, sivý a neklikateľný, s tooltipom `Čaká na dáta zo
 * shopu` (§5 architektúry). Veta by tam bola druhé vysvetlenie tej istej veci
 * a po prvej zmene by si obe protirečili.
 *
 * PORADIE RIADKOV V `data` (dôležité pre obrazovku)
 * ------------------------------------------------
 * Najprv stránka zo zrkadla v požadovanom triedení, POTOM súvislý blok toho,
 * čo pridalo dohľadanie — v poradí RELEVANCIE, tak ako ho vrátil eshop.
 * Blok sa nepremiešava do triedenia zámerne: pri hľadaní podľa kódu je prvý
 * výsledok eshopu ten správny a preusporiadanie podľa ceny by to zahodilo.
 * Koľko riadkov blok má, hovorí `lookup.addedRows`.
 *
 * Vlastník: V15 (hľadanie). Čítanie zrkadla a K8: V8.
 */
import { z } from 'zod';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  LOOKUP_RESOLVE_MAX,
  lookupProductsInShop,
  type ProductOrigin,
  type ShopLookupResult,
} from '@/lib/catalog/shop-lookup';
import {
  recalledScopes,
  resolveProductCodes,
  shopCapabilities,
  type ProductCodeResult,
  type ShopCapabilities,
} from '@/lib/catalog/product-codes';
import {
  apiKeyRepo as defaultApiKeyRepo,
  type ApiKeyRepository,
} from '@/lib/repo/api-key.repo';
import {
  catalogRepo as defaultCatalogRepo,
  type CatalogProductFacts,
  type CatalogRepoExt,
  type CatalogSearchFilter,
  type CatalogSearchRow,
  type CatalogShopStatus,
  type CatalogSort,
  type EnrichedOnlyFeature,
  type LockedCatalogFilter,
  type SoldBucket,
} from '@/lib/repo/catalog.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings, type ShopClientV5 } from '@/lib/shop/client';
import type { ReadBudgetStatus } from '@/lib/shop/read-budget';

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

/**
 * Celé nezáporné číslo z query (`orderedTotal*`, `lastSaleOlderDays`).
 * `null` = nezmysel alebo nič neprišlo, a filter potom ODPADNE — nespadne.
 */
function countParam(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (!/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

const SOLD_BUCKETS: readonly SoldBucket[] = ['none', 'low', 'mid', 'high'];
const SHOP_STATUSES: readonly CatalogShopStatus[] = ['ok', 'not_found', 'unknown'];
const SORTS: readonly CatalogSort[] = ['name', 'price_asc', 'price_desc', 'sold_asc', 'sold_desc', 'id'];

/**
 * Filtre, na ktoré appka nemá dáta (K8). Zoznam je zámerne v repozitári
 * (`LOCKED_FILTERS`) — tu sú len názvy, na ktoré sa počúva v query, aby route
 * vedela povedať „tento si poslal a ja som ho NEPOUŽILA".
 *
 * D125 (1. 9. 2026) — `stock`, `margin` a `turnover` z tohto zoznamu ODIŠLI,
 * lebo sa filtrovať DAJÚ (`stock`, `marginPercentFrom/To`,
 * `orderedTotalFrom/To`, `lastSaleOlderDays` nižšie). Zostali tri, ktoré nemajú
 * zdroj vôbec; na obrazovke sa už nekreslia ani sivé (K4).
 */
const LOCKED_QUERY_KEYS: readonly LockedCatalogFilter[] = ['category', 'metal', 'jewelryType'];

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
  /**
   * `shopDiscounted=1` — len produkty, na ktorých beží zľava PODĽA SHOPU (D116).
   *
   * Meno je zámerne iné než `currentlyDiscounted`: to sa pýta na vlastné zápisy
   * appky. Zliať ich do jedného parametra by znamenalo, že obrazovka nevie
   * povedať, čie tvrdenie práve ukazuje.
   */
  shopDiscounted: boolQuery,
  /*
   * ── Filtre nad obohatením (D125, K4) ──────────────────────────────────────
   *
   * Štyri veci, ktoré `getFull` naozaj dáva a migrácia 0014 drží v zrkadle.
   * Mená sú tie isté ako v `catalog-filter.ts`, aby sa adresa obrazovky dala
   * poslať ďalej bez prekladu — a hovoria PRESNE to, čo stĺpec vie:
   *
   *  · `marginPercentFrom/To` — `margin_percent` zo shopu (appka maržu nepočíta),
   *  · `stock=in|out`         — `qty`; `NULL` nespadne ani do jednej možnosti,
   *  · `orderedTotalFrom/To`  — `qty_in_orders`, teda CELKOVO objednané kusy
   *                             za celú históriu shopu, NIE za okno (R3),
   *  · `lastSaleOlderDays`    — `last_time_in_order` starší než N dní.
   *
   * Všetky štyri platia LEN nad obohatenými riadkami; odpoveď to priznáva
   * v `enrichedOnly` a číslom `counts.enrichedRows` (I11).
   *
   * Prečo sú tu SAMÉ REŤAZCE a čísla sa parsujú až v handleri: `z.coerce.number()`
   * by z nezmyslu urobil `NaN` a z celej odpovede 400. Uložený filter ani starší
   * odkaz nesmú obrazovku zhodiť — nezmysel má FILTER ODPADNÚŤ, nie požiadavka
   * spadnúť (tá istá zásada ako pri `priceFrom`/`priceTo`).
   */
  marginPercentFrom: z.string().max(20).optional(),
  marginPercentTo: z.string().max(20).optional(),
  stock: z.string().max(10).optional(),
  orderedTotalFrom: z.string().max(10).optional(),
  orderedTotalTo: z.string().max(10).optional(),
  lastSaleOlderDays: z.string().max(10).optional(),
  productIds: csvQuery,
  sort: z.string().max(20).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  /** `counts=0` vypne počty do bočného panela (druhý dotaz navyše). */
  counts: z
    .union([z.literal(''), z.enum(['0', '1', 'true', 'false'])])
    .optional()
    .transform((value) => value !== '0' && value !== 'false'),
  /**
   * `lookup=1` — dohľadaj v eshope aj to, čo zrkadlo nemá.
   *
   * Je to VÝSLOVNÁ akcia a nie predvolené správanie, lebo míňa anonymný
   * rozpočet čítaní (30/min, 300/UTC deň na IP) — ten istý, z ktorého sa
   * načítava katalóg. Hľadanie, ktoré by sa spúšťalo pri každom písmene, by
   * denný strop minulo za pár minút a shop by zabanoval celú IP aj so
   * synchronizáciou. Kontrakt bod 4 to hovorí aj o obrazovke: nič sa
   * neobnovuje samo.
   */
  lookup: boolQuery,
  /** Koľko neznámych ID naraz dotiahnuť. Strop drží modul, nie táto route. */
  lookupLimit: z.coerce.number().int().min(0).max(LOOKUP_RESOLVE_MAX).optional(),
  /**
   * `codes=1` — dotiahni kód produktu pre `productIds` (kontrakt bod 20).
   * Vyžaduje oprávnenie, ktoré appka zatiaľ nemá; odpoveď to povie vetou.
   */
  codes: boolQuery,
});

/* ═══════════════════════════ 2. Závislosti ════════════════════════════════ */

export interface CatalogSearchRouteDeps {
  catalog?: Pick<CatalogRepoExt, 'search' | 'counts' | 'totalRows' | 'lastFetchedAt'>;
  /**
   * Časť repozitára, ktorú potrebuje LEN dohľadanie v eshope.
   *
   * Je to zámerne druhý parameter, a nie širší `catalog`: pôvodná štvorica
   * metód je kontrakt, o ktorý sa opierajú existujúce testy, a rozšíriť ju by
   * znamenalo prepísať cudzí súbor. Produkčne je to ten istý repozitár.
   */
  catalogLookup?: Pick<
    CatalogRepoExt,
    'search' | 'getMany' | 'factsFor' | 'reserveShopReads' | 'shopReadBudget'
  >;
  /** VÝHRADNE čítacia časť klienta shopu — zápis sa sem nedá podstrčiť. */
  shop?: Pick<ShopClientV5, 'searchIndex' | 'getProduct' | 'getProductFull'>;
  apiKey?: Pick<ApiKeyRepository, 'loadForUse' | 'recallScopes'>;
  now?: () => Date;
  routeDeps?: RouteDeps;
}

/* ═══════════════════════════ 3. Tvar odpovede ═════════════════════════════ */

/** Jeden zamknutý filter v odpovedi (K8). `locked` je vždy `true`. */
export interface LockedFilterView {
  locked: true;
  /** `true` = klient tento filter poslal a route ho NEAPLIKOVALA. */
  requested: boolean;
}

/**
 * Riadok tabuľky.
 *
 * `origin` je povinné pole a nesie ho KAŽDÝ riadok — aj tie, ktoré prišli zo
 * zrkadla bez dohľadávania. Voliteľné pole by znamenalo, že obrazovka musí
 * hádať, čo znamená jeho neprítomnosť.
 */
export interface CatalogRowView {
  productId: number;
  name: string | null;
  price: string | null;
  hasAttributes: boolean;
  shopStatus: CatalogShopStatus;
  /**
   * Predané kusy za `soldWindowDays` z vlastných tabuliek, alebo `null` = **„za
   * toto okno to NEVIEME"** (D121, 31. 8. 2026).
   *
   * Číslo je meraný fakt o dňoch, ktoré sú naozaj stiahnuté
   * (`sales_sync_state.status = 'complete'`) — pri neúplnom okne je to DOLNÁ
   * HRANICA a povrch ju hovorí znakom `≥`. `null` sa NESMIE nahradiť nulou:
   * z nuly je vedro „0 predaných" a z neho 30 % zľava (D121, `soldBucketOf`).
   *
   * Do 31. 8. 2026 tu bolo `number` a route posielala `fact?.unitsSold ?? 0`,
   * takže obrazovka Nová zľava hlásila „10 000 produktov dostane zľavu · 30 %"
   * o predajoch, ktoré appka nikdy nezmerala.
   */
  unitsSold: number | null;
  /** I11 — z NAŠICH úspešných zápisov, nie zo shopu. */
  everDiscounted: boolean;
  discountedNow: boolean;
  /** Kedy sa údaje o produkte naozaj čítali (P7). */
  fetchedAt: string;
  /** Odkiaľ je názov a cena: zo zrkadla, alebo z eshopu (I11). */
  origin: ProductOrigin;
}

/** Stav rozpočtu čítaní v JSON. `null` = počítadlo sa nedalo prečítať. */
export interface ReadBudgetView {
  day: string;
  limit: number;
  used: number;
  remaining: number;
  exhausted: boolean;
  resetAt: string;
  minuteLimit: number;
  usedThisMinute: number;
  /** `false` = čísla sú fail-closed domnienka, nie merané (I11). */
  known: boolean;
}

/** Ako dopadlo dohľadanie v eshope. */
export interface LookupView {
  /** Pýtal si klient dohľadanie? */
  requested: boolean;
  /**
   * `off` · `no_query` · `not_first_page` · `done` · `budget_day` ·
   * `budget_minute` · `budget_unknown` · `failed`.
   */
  outcome: ShopLookupResult['outcome'] | 'off' | 'not_first_page';
  /** Koľko produktov eshop na túto otázku našiel. MERANÝ fakt, `null` = nevieme. */
  shopTotal: number | null;
  /** Koľko ID eshop poslal (strop jedného hľadania). */
  candidates: number;
  /** Z nich tie, ktoré zrkadlo už má. */
  inMirror: number;
  /** Z nich tie, ktoré zrkadlo nemá — kvôli nim sa hľadá. */
  missingFromMirror: number;
  /** Koľko riadkov dohľadanie do `data` pridalo (na konci, v poradí relevancie). */
  addedRows: number;
  /** Z toho riadky, ktorých názov a cena prišli živé z eshopu. */
  addedFromShop: number;
  /** Z toho riadky, ktoré appka mala v zrkadle, len ich text hľadania nenašiel. */
  addedFromMirror: number;
  /** ID, ktoré index pozná, ale eshop na ne odpovedal „taký produkt nemám". */
  notInShop: number;
  /** ID, na ktoré sa už nedostalo. */
  notFetched: number;
  /** Prečo: `none` · `limit` · `budget_minute` · `budget_day` · `budget_unknown` · `failed`. */
  notFetchedReason: ShopLookupResult['notFetchedReason'];
  /** Koľko anonymných čítaní hľadanie minulo. */
  readsUsed: number;
  reads: ReadBudgetView | null;
  /** Kedy sa hľadalo — konkrétny čas (kontrakt bod 10). `null` = nehľadalo sa. */
  at: string | null;
  /** KÓD chyby (I1). `null` = nič nespadlo. */
  error: string | null;
}

/** Kód produktu pre vybrané produkty (kontrakt bod 20). */
export interface CodesView {
  requested: boolean;
  outcome: ProductCodeResult['outcome'] | 'off';
  /** Kód podľa ID produktu. `null` = shop ho pri produkte nevedie. */
  data: Record<string, { reference: string | null; variantReferences: string[] }>;
  /** ID, na ktoré sa nedostalo (strop, chýbajúce oprávnenie, chyba). */
  skipped: number[];
  error: string | null;
  at: string | null;
}

export interface CatalogSearchResponse {
  data: CatalogRowView[];
  page: number;
  perPage: number;
  /** Koľko riadkov vyhovuje filtru v ZRKADLE — viď `totalSource`. */
  total: number;
  /** Čoho sa `total` týka. Konštanta; je tu, aby sa to nedalo prehliadnuť. */
  totalSource: 'mirror';
  soldWindowDays: number;
  soldFrom: string;
  soldTo: string;
  counts: Awaited<ReturnType<CatalogRepoExt['counts']>> | null;
  catalogTotal: number;
  dataAsOf: string | null;
  lockedFilters: Record<string, LockedFilterView>;
  discountSource: 'own_writes';
  /** Odkiaľ je `?shopDiscounted=1` — z obohatenia zrkadla, nie z vlastných zápisov. */
  shopDiscountSource: 'shop_enrichment';
  /**
   * Čo appka vie LEN o obohatených riadkoch (I11, D116): hľadanie podľa kódu
   * a EAN-u a filter `shopDiscounted`. Tieto filtre sa APLIKOVALI a vrátili
   * pravdivé riadky — ale nad časťou katalógu. Koľko je tá časť, hovorí
   * `counts.enrichedRows` (a teda `counts=0` ju vypne aj tu).
   */
  enrichedOnly: EnrichedOnlyFeature[];
  lookup: LookupView;
  codes: CodesView;
  capabilities: ShopCapabilities;
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

export function readBudgetView(status: ReadBudgetStatus | null): ReadBudgetView | null {
  if (status === null) return null;
  return {
    day: status.day,
    limit: status.limit,
    used: status.used,
    remaining: status.remaining,
    exhausted: status.exhausted,
    resetAt: status.resetAt.toISOString(),
    minuteLimit: status.minuteLimit,
    usedThisMinute: status.usedThisMinute,
    known: status.known,
  };
}

/** Dohľadanie sa nekonalo. Tvar odpovede je vždy rovnaký, len čísla sú nuly. */
export function lookupOff(outcome: LookupView['outcome'], requested: boolean): LookupView {
  return {
    requested,
    outcome,
    shopTotal: null,
    candidates: 0,
    inMirror: 0,
    missingFromMirror: 0,
    addedRows: 0,
    addedFromShop: 0,
    addedFromMirror: 0,
    notInShop: 0,
    notFetched: 0,
    notFetchedReason: 'none',
    readsUsed: 0,
    reads: null,
    at: null,
    error: null,
  };
}

const CODES_OFF: CodesView = {
  requested: false,
  outcome: 'off',
  data: {},
  skipped: [],
  error: null,
  at: null,
};

function mirrorRowView(row: CatalogSearchRow): CatalogRowView {
  return {
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
    origin: 'mirror',
  };
}

/* ═══════════════════════════ 4. Route ═════════════════════════════════════ */

export function createCatalogSearchRoute(deps: CatalogSearchRouteDeps = {}): NextRouteHandler {
  const catalog = deps.catalog ?? defaultCatalogRepo;
  const catalogLookup = deps.catalogLookup ?? defaultCatalogRepo;
  const apiKey = deps.apiKey ?? defaultApiKeyRepo;
  const now = deps.now ?? ((): Date => new Date());
  // Klient sa zostavuje až keď je naozaj treba: `settings.shop_domain` sa číta
  // lazy a čítanie zrkadla ho nepotrebuje vôbec (D80).
  const shop = (): Pick<ShopClientV5, 'searchIndex' | 'getProduct' | 'getProductFull'> =>
    deps.shop ?? createShopClientFromSettings(defaultSettingsRepo);

  return defineRoute(
    {
      method: 'GET',
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
          shopDiscounted: q.shopDiscounted,
        };
        const term = q.q === undefined ? '' : q.q.trim();
        if (term.length > 0) filter.query = term;
        if (q.priceFrom !== undefined) filter.priceFrom = q.priceFrom;
        if (q.priceTo !== undefined) filter.priceTo = q.priceTo;
        if (q.soldWindowDays !== undefined) filter.soldWindowDays = q.soldWindowDays;

        /* D125 — filtre nad obohatením. Nezmyselná hodnota tu ODPADNE (filter sa
         * neaplikuje); repozitár si ju rovnako neprevezme. */
        if (q.marginPercentFrom !== undefined) filter.marginPercentFrom = q.marginPercentFrom;
        if (q.marginPercentTo !== undefined) filter.marginPercentTo = q.marginPercentTo;
        if (q.stock === 'in' || q.stock === 'out') filter.stock = q.stock;
        const orderedFrom = countParam(q.orderedTotalFrom);
        if (orderedFrom !== null) filter.orderedTotalFrom = orderedFrom;
        const orderedTo = countParam(q.orderedTotalTo);
        if (orderedTo !== null) filter.orderedTotalTo = orderedTo;
        const olderDays = countParam(q.lastSaleOlderDays);
        if (olderDays !== null && olderDays > 0) filter.lastSaleOlderDays = olderDays;

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

        const rows: CatalogRowView[] = result.data.map(mirrorRowView);
        const shown = new Set<number>(rows.map((row) => row.productId));

        /* ── Dohľadanie v eshope (kontrakt body 25–28) ──────────────────── */

        let lookup: LookupView = lookupOff('off', q.lookup);
        if (q.lookup) {
          if (term.length === 0) {
            lookup = lookupOff('no_query', true);
          } else if (q.page !== 1) {
            // Dohľadanie je doplnok k PRVEJ stránke, nie ďalšia stránkovaná
            // vec. Spúšťať ho pri každom preklikaní strán by minulo rozpočet
            // za odpoveď, ktorá by bola zakaždým tá istá.
            lookup = lookupOff('not_first_page', true);
          } else {
            lookup = await runLookup({
              term,
              filter,
              result,
              rows,
              shown,
              catalogLookup,
              shop: shop(),
              logger: ctx.log,
              now,
              ...(q.lookupLimit !== undefined ? { resolveLimit: q.lookupLimit } : {}),
            });
          }
        }

        /* ── Kód produktu pre VYBRANÉ produkty (kontrakt bod 20) ────────── */

        let codes: CodesView = CODES_OFF;
        if (q.codes) {
          const outcome = await resolveProductCodes(filter.productIds ?? [], {
            shop: shop(),
            apiKey,
            logger: ctx.log,
            now,
          });
          codes = {
            requested: true,
            outcome: outcome.outcome,
            data: Object.fromEntries(
              outcome.codes.map((entry) => [
                String(entry.productId),
                {
                  reference: entry.reference,
                  variantReferences: [...entry.variantReferences],
                },
              ]),
            ),
            skipped: [...outcome.skippedIds],
            error: outcome.error,
            at: outcome.at.toISOString(),
          };
        }

        const response: CatalogSearchResponse = {
          data: rows,
          page: result.page,
          perPage: result.perPage,
          total: result.total,
          /** `total` je počet v zrkadle; koľko ich má eshop, hovorí `lookup.shopTotal`. */
          totalSource: 'mirror',
          /** Okno, za ktoré je `unitsSold` — bez neho je číslo nečitateľné (P7). */
          soldWindowDays: result.soldWindowDays,
          soldFrom: result.soldFrom,
          soldTo: result.soldTo,
          counts,
          /** Koľko riadkov má zrkadlo vôbec („z 41 220 produktov"). */
          catalogTotal,
          /** P7 — meraný fakt „Dáta k …", nie odhad. `null` = zrkadlo je prázdne. */
          dataAsOf: dataAsOf === null ? null : dataAsOf.toISOString(),
          /**
           * K8 — filtre bez dát. VŽDY prítomné (aj keď si o ne nikto nepýtal),
           * vždy `locked: true` a nikdy k nim nie sú žiadne hodnoty. `requested`
           * hovorí, že klient taký filter poslal a route ho NEPOUŽILA.
           */
          lockedFilters: lockedFiltersView(result.lockedFilters, lockedRequested),
          /** Čo znamená „v zľave" — nikdy netvrdíme, že poznáme stav shopu (I11). */
          discountSource: 'own_writes',
          /** …a keď sa pýtame na shop, hovorí sa to menovite (D116). */
          shopDiscountSource: 'shop_enrichment',
          /**
           * I11 — filtre, ktoré PLATIA len pre obohatené riadky. Nie sú zamknuté
           * (tie sú v `lockedFilters` a neaplikujú sa vôbec); toto je tretí stav:
           * aplikované, pravdivé, ale nad časťou katalógu.
           */
          enrichedOnly: result.enrichedOnly,
          lookup,
          codes,
          /**
           * Čo appka zatiaľ nevie a prečo. Tri stavy, nikdy dva: `available`
           * (kľúč to má) · `locked` (shop povedal nie) · `unknown` (nevieme).
           * `note` patrí VÝHRADNE do `LockedFeatures.tsx` (kontrakt bod 18) —
           * na Produktoch sa z toho kreslí len zámok, nie veta.
           */
          capabilities: shopCapabilities(recalledScopes(apiKey)),
        };
        return response;
      },
    },
    deps.routeDeps,
  );
}

/* ═══════════════ 5. Dohľadanie: zloženie riadkov a čísel ══════════════════ */

interface RunLookupInput {
  term: string;
  filter: CatalogSearchFilter;
  result: Awaited<ReturnType<CatalogRepoExt['search']>>;
  /** Riadky zo zrkadla — dopĺňa sa do nich blok dohľadaného (mutuje sa zámerne). */
  rows: CatalogRowView[];
  shown: Set<number>;
  catalogLookup: NonNullable<CatalogSearchRouteDeps['catalogLookup']>;
  shop: Pick<ShopClientV5, 'searchIndex' | 'getProduct'>;
  logger: Parameters<typeof lookupProductsInShop>[1]['logger'];
  now: () => Date;
  resolveLimit?: number;
}

/**
 * Spustí dohľadanie a pripojí jeho výsledok NA KONIEC `rows`.
 *
 * Poradie pripojeného bloku je poradie relevancie z eshopu (`candidateIds`).
 * Riadok, ktorý už v tabuľke je, sa preskočí — hľadanie nesmie vyrobiť ten istý
 * produkt dvakrát.
 *
 * Dve skupiny v bloku, obe pripojené v jednom poradí:
 *  · produkt, ktorý zrkadlo MÁ, len ho textové hľadanie nad názvom nenašlo
 *    (eshop hľadá aj v popise, v kóde a v kategóriách) → `origin: 'mirror'`,
 *    so všetkými číslami zo zrkadla,
 *  · produkt, ktorý zrkadlo NEMÁ → `origin: 'shop'`, s názvom a cenou z eshopu
 *    a s predajnosťou aj históriou vlastných zliav z vlastných tabuliek
 *    (obe sú kľúčované produktom, nie zrkadlom — preto sa dajú spočítať aj tu).
 */
async function runLookup(input: RunLookupInput): Promise<LookupView> {
  const outcome = await lookupProductsInShop(
    { query: input.term },
    {
      shop: input.shop,
      catalog: input.catalogLookup,
      ...(input.logger !== undefined ? { logger: input.logger } : {}),
      now: input.now,
      ...(input.resolveLimit !== undefined ? { resolveLimit: input.resolveLimit } : {}),
    },
  );

  const view: LookupView = {
    requested: true,
    outcome: outcome.outcome,
    shopTotal: outcome.shopTotal,
    candidates: outcome.candidateIds.length,
    inMirror: outcome.knownIds.length,
    missingFromMirror: outcome.missingIds.length,
    addedRows: 0,
    addedFromShop: 0,
    addedFromMirror: 0,
    notInShop: outcome.notInShopIds.length,
    notFetched: outcome.notFetchedIds.length,
    notFetchedReason: outcome.notFetchedReason,
    readsUsed: outcome.readsUsed,
    reads: readBudgetView(outcome.reads),
    at: outcome.at.toISOString(),
    error: outcome.error,
  };
  if (outcome.outcome !== 'done') return view;

  /* ── a) riadky zo zrkadla, ktoré textové hľadanie nenašlo ──────────────── */

  const fromMirrorIds = outcome.knownIds.filter((id) => !input.shown.has(id));
  const mirrorRows = new Map<number, CatalogSearchRow>();
  if (fromMirrorIds.length > 0) {
    // Zámerne BEZ `query`: tie ID už našiel eshop a opakovať nad nimi hľadanie
    // podľa názvu by ich zase vyhodilo. Stavy shopu sú tu všetky tri — ide
    // o konkrétne produkty, nie o ponuku na zlacnenie.
    const extra = await input.catalogLookup.search({
      productIds: [...fromMirrorIds],
      shopStatus: ['ok', 'not_found', 'unknown'],
      soldWindowDays: input.result.soldWindowDays,
      today: input.result.soldTo,
      page: 1,
      perPage: fromMirrorIds.length,
    });
    for (const row of extra.data) mirrorRows.set(row.productId, row);
  }

  /* ── b) predajnosť a vlastné zľavy pre to, čo prišlo živé z eshopu ─────── */

  let facts = new Map<number, CatalogProductFacts>();
  if (outcome.fetched.length > 0) {
    const resolved = await input.catalogLookup.factsFor(
      outcome.fetched.map((product) => product.productId),
      { soldWindowDays: input.result.soldWindowDays, today: input.result.soldTo },
    );
    facts = resolved.facts;
  }
  const fetchedById = new Map(outcome.fetched.map((product) => [product.productId, product]));

  /* ── c) pripojenie v poradí relevancie ─────────────────────────────────── */

  for (const productId of outcome.candidateIds) {
    if (input.shown.has(productId)) continue;

    const fromMirror = mirrorRows.get(productId);
    if (fromMirror !== undefined) {
      input.rows.push(mirrorRowView(fromMirror));
      input.shown.add(productId);
      view.addedFromMirror += 1;
      continue;
    }

    const fromShop = fetchedById.get(productId);
    if (fromShop === undefined) continue;
    const fact = facts.get(productId);
    input.rows.push({
      productId: fromShop.productId,
      name: fromShop.name,
      price: fromShop.price,
      hasAttributes: fromShop.hasAttributes,
      // Eshop na produkt práve odpovedal, takže v ňom existuje — meraný fakt.
      shopStatus: 'ok',
      /*
       * D121 — `?? 0` tu STÁŤ NESMIE. Produkt práve prišiel živý z eshopu,
       * takže o jeho predajoch appka vie presne to, čo jej povedali VLASTNÉ
       * tabuľky: `factsFor()` vracia riadok pre každé platné ID a `null` v ňom
       * znamená „za toto okno to nevieme". Dosadená nula z toho robila meraný
       * fakt, z ktorého `soldBucketOf` odvodil vedro `none` a 30 % zľavu.
       */
      unitsSold: fact === undefined ? null : fact.unitsSold,
      everDiscounted: fact?.everDiscounted ?? false,
      discountedNow: fact?.discountedNow ?? false,
      fetchedAt: fromShop.fetchedAt.toISOString(),
      origin: 'shop',
    });
    input.shown.add(productId);
    view.addedFromShop += 1;
  }

  view.addedRows = view.addedFromMirror + view.addedFromShop;
  return view;
}

export const GET = createCatalogSearchRoute();
