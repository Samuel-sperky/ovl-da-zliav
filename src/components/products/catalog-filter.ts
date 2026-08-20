/**
 * Aura Zľavy — filter katalógu ako ČISTÝ stav (V10; kontrakt V3 K7, K8, P7).
 *
 * Tab Produkty číta 40 483 riadkov cez `GET /api/catalog/search`. Aby sa ten
 * istý filter dal poslať aj do sprievodcu novou zľavou (a aby si ho používateľ
 * mohol uložiť), musí byť filter serializovateľný do query stringu a späť.
 * Preto je tu — bez Reactu, bez `fetch`, bez `process.env`, bez DB.
 *
 * Tri veci, na ktorých tento modul stojí:
 *
 *  1. **Mená parametrov sú tie isté ako v API.** `q`, `soldWindowDays`,
 *     `soldBuckets`, `priceFrom`, `priceTo`, `neverDiscounted`,
 *     `currentlyDiscounted`, `page`, `perPage`. Jeden slovník pre adresu
 *     obrazovky, pre volanie API aj pre odovzdanie do novej zľavy — takže
 *     `/produkty?soldWindowDays=180&soldBuckets=none` funguje ako odkaz
 *     z Prehľadu a ten istý reťazec sa dá poslať ďalej.
 *  2. **Zamknuté filtre tu NEEXISTUJÚ.** Kategória, kov, typ šperku, marža,
 *     obrátkovosť ani sklad nie sú súčasťou stavu — appka na ne nemá dáta
 *     (K8) a stav, ktorý sa nedá odoslať, by bol len tichý sľub. Zoznam
 *     zamknutých filtrov prichádza z odpovede API (`lockedFilters`), takže keď
 *     dáta zo shopu pribudnú, obrazovka ich prestane kresliť sivé sama.
 *  3. **Predvolené okno je 30 dní** (architektúra §1, odpoveď 53). Repozitár
 *     má vlastný default 180, preto sa okno posiela VŽDY explicitne.
 *
 * Vlastník: V10.
 */

/* ═══════════════════════════ 1. Hodnoty filtra ════════════════════════════ */

/** Vedrá predajnosti podľa bočného panela. Rovnaké kódy ako v repozitári. */
export type SoldBucket = 'none' | 'low' | 'mid' | 'high';

export const SOLD_BUCKETS: readonly SoldBucket[] = ['none', 'low', 'mid', 'high'];

/** Prepínač obdobia. Predvolené je 30 — najkratšie, nie najagresívnejšie. */
export const SOLD_WINDOWS = [30, 60, 90, 180, 360] as const;

export type SoldWindow = (typeof SOLD_WINDOWS)[number];

/** Stránkovanie po 50 alebo 100 riadkoch (architektúra §1). */
export const PER_PAGE_CHOICES = [50, 100] as const;

export type PerPage = (typeof PER_PAGE_CHOICES)[number];

export interface CatalogFilterState {
  /** Jedno pole nad tabuľkou: názov alebo číslo produktu. */
  readonly query: string;
  readonly soldWindowDays: SoldWindow;
  readonly soldBuckets: readonly SoldBucket[];
  /** Cena v EUR ako text z poľa; prázdne = bez hranice. */
  readonly priceFrom: string;
  readonly priceTo: string;
  /** Podľa VLASTNÝCH zápisov appky, nie podľa stavu shopu (I11). */
  readonly currentlyDiscounted: boolean;
  readonly neverDiscounted: boolean;
  readonly page: number;
  readonly perPage: PerPage;
}

export const DEFAULT_CATALOG_FILTER: CatalogFilterState = {
  query: '',
  soldWindowDays: 30,
  soldBuckets: [],
  priceFrom: '',
  priceTo: '',
  currentlyDiscounted: false,
  neverDiscounted: false,
  page: 1,
  perPage: 50,
};

/* ═══════════════════════════ 2. Rozpoznávanie ═════════════════════════════ */

const isSoldWindow = (value: number): value is SoldWindow =>
  (SOLD_WINDOWS as readonly number[]).includes(value);

const isSoldBucket = (value: string): value is SoldBucket =>
  (SOLD_BUCKETS as readonly string[]).includes(value);

const isPerPage = (value: number): value is PerPage =>
  (PER_PAGE_CHOICES as readonly number[]).includes(value);

/** Cena z poľa: `12`, `12,50`, `12.50`. Čokoľvek iné sa do API neposiela. */
const PRICE_RE = /^\d{1,8}([.,]\d{1,2})?$/;

/** `12,50` → `12.50`; nezmysel → `null` (filter potom odpadne, nie spadne). */
export function priceParam(raw: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  return PRICE_RE.test(text) ? text.replace(',', '.') : null;
}

/* ═══════════════════════ 3. Filter → query string ═════════════════════════ */

export interface CatalogQueryOptions {
  /** `false` vypne dopočet čísel do bočného panela (druhý dotaz navyše). */
  readonly counts?: boolean;
  /** `false` vynechá stránkovanie — používa sa pri odovzdaní filtra ďalej. */
  readonly paging?: boolean;
}

/**
 * Filter → `URLSearchParams` v poradí, ktoré je stabilné (kľúč sa dá porovnať
 * ako text — na to stojí rozoznávanie uloženého filtra).
 */
export function catalogSearchParams(
  filter: CatalogFilterState,
  options: CatalogQueryOptions = {},
): URLSearchParams {
  const params = new URLSearchParams();
  const query = filter.query.trim();
  if (query !== '') params.set('q', query);

  params.set('soldWindowDays', String(filter.soldWindowDays));

  const buckets = SOLD_BUCKETS.filter((bucket) => filter.soldBuckets.includes(bucket));
  if (buckets.length > 0) params.set('soldBuckets', buckets.join(','));

  const from = priceParam(filter.priceFrom);
  if (from !== null) params.set('priceFrom', from);
  const to = priceParam(filter.priceTo);
  if (to !== null) params.set('priceTo', to);

  if (filter.currentlyDiscounted) params.set('currentlyDiscounted', '1');
  if (filter.neverDiscounted) params.set('neverDiscounted', '1');

  if (options.paging !== false) {
    params.set('page', String(filter.page));
    params.set('perPage', String(filter.perPage));
  }
  if (options.counts === false) params.set('counts', '0');

  return params;
}

export function catalogSearchQuery(
  filter: CatalogFilterState,
  options: CatalogQueryOptions = {},
): string {
  return catalogSearchParams(filter, options).toString();
}

/**
 * Kľúč filtra bez stránkovania — dve stránky toho istého filtra sú ten istý
 * filter. Používa sa na rozoznanie uloženého filtra a na zrušenie výberu, keď
 * sa filter naozaj zmenil.
 */
export function catalogFilterKey(filter: CatalogFilterState): string {
  return catalogSearchQuery(filter, { paging: false });
}

/* ═══════════════════════ 4. Query string → filter ═════════════════════════ */

type RawParams = Readonly<Record<string, string | readonly string[] | undefined>>;

function first(params: RawParams, key: string): string | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : (value as string);
}

/** `?flag`, `?flag=1`, `?flag=true` → `true`; všetko ostatné → `false`. */
function flag(params: RawParams, key: string): boolean {
  const value = first(params, key);
  if (value === undefined) return false;
  return value === '' || value === '1' || value === 'true';
}

/**
 * Adresa → filter. Nič sa nevynucuje: neznáma hodnota spadne na predvolenú,
 * pretože odkaz z Prehľadu ani uložený filter nesmú obrazovku zhodiť.
 */
export function parseCatalogFilter(params: RawParams): CatalogFilterState {
  const window = Number(first(params, 'soldWindowDays'));
  const perPage = Number(first(params, 'perPage'));
  const page = Number(first(params, 'page'));

  const bucketsRaw = first(params, 'soldBuckets') ?? '';
  const buckets = bucketsRaw
    .split(',')
    .map((part) => part.trim())
    .filter(isSoldBucket);

  return {
    query: (first(params, 'q') ?? '').slice(0, 191),
    soldWindowDays: isSoldWindow(window) ? window : DEFAULT_CATALOG_FILTER.soldWindowDays,
    soldBuckets: SOLD_BUCKETS.filter((bucket) => buckets.includes(bucket)),
    priceFrom: first(params, 'priceFrom') ?? '',
    priceTo: first(params, 'priceTo') ?? '',
    currentlyDiscounted: flag(params, 'currentlyDiscounted'),
    neverDiscounted: flag(params, 'neverDiscounted'),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    perPage: isPerPage(perPage) ? perPage : DEFAULT_CATALOG_FILTER.perPage,
  };
}

/** Ten istý parser nad hotovým query stringom (uložený filter, odkaz). */
export function parseCatalogFilterQuery(query: string): CatalogFilterState {
  const search = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const raw: Record<string, string> = {};
  for (const [key, value] of search.entries()) raw[key] = value;
  return parseCatalogFilter(raw);
}

/* ═════════════════════ 5. Odovzdanie do novej zľavy ═══════════════════════ */

/**
 * Kam vedie tlačidlo `Zlacniť`. Dva tvary, oba pre sprievodcu novou zľavou:
 *
 *   · `?produkty=18342,21170` — používateľ označil konkrétne riadky,
 *   · `?filter=…&pocet=11640` — používateľ vybral všetko, čo vyhovuje filtru.
 *
 * Zoznam desiatich tisícov čísel by sa do adresy nezmestil, preto sa pri
 * hromadnom výbere posiela FILTER, nie položky. Sprievodca si ho rozbalí tým
 * istým `parseCatalogFilterQuery()` a spýta sa API na tie isté riadky.
 */
export function newDiscountHref(
  selection:
    | { readonly kind: 'products'; readonly productIds: readonly number[] }
    | { readonly kind: 'filter'; readonly filter: CatalogFilterState; readonly total: number },
): string {
  const params = new URLSearchParams();
  if (selection.kind === 'products') {
    params.set('produkty', selection.productIds.join(','));
  } else {
    params.set('filter', catalogSearchQuery(selection.filter, { paging: false, counts: false }));
    params.set('pocet', String(selection.total));
  }
  return `/zlavy/nova?${params.toString()}`;
}
