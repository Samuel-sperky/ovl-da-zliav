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
 *     `currentlyDiscounted`, `shopDiscounted`, `page`, `perPage`. Jeden slovník
 *     pre adresu obrazovky, pre volanie API aj pre odovzdanie do novej zľavy —
 *     takže
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
 * Triedenie je poradie, nie podmienka
 * ───────────────────────────────────
 * `sort` je súčasťou stavu (predvolene NAJHORŠIE LEŽIAKY PRVÉ — kontrakt V4
 * §5 K4; do 31. 8. 2026 najdrahšie prvé, kontrakt UI bod 19),
 * ale do query stringu sa dostane LEN na vyžiadanie (`sorting: true`), a to
 * z jediného miesta: z volaní tabuľky Produktov. Dôvod je, že ten istý reťazec
 * slúži aj ako kľúč filtra a ako odkaz do novej zľavy — tam znamená OTÁZKU,
 * a poradie riadkov otázku nemení. Keby sa započítalo, preklik na
 * „najlacnejšie prvé" by zrušil naklikaný výber (kontrakt UI, bod 17) a zmenil
 * by aj to, čo sa odovzdalo sprievodcovi.
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

/**
 * Stránkovanie po 50 alebo 100 riadkoch (architektúra §1; D10 pridalo 200,
 * kontrakt V4 §5 K4 ho 31. 8. 2026 zobral späť — pozri nižšie).
 *
 * Dôvod je zmeraný, nie odhadnutý: katalóg má 41 348 riadkov, čo je po 50
 * riadkoch 827 strán a po 100 riadkoch 414.
 *
 * PREČO 200 ZMIZLO
 * ────────────────
 * Riadok tabuľky už nie je len názov a cena — nesie KPI z
 * `GET /api/insights/product-kpi` (D114) a tá route má strop `MAX_KPI_IDS = 100`
 * na jeden dotaz. Dávka 200 by teda znamenala buď DVA dotazy na stránku, alebo
 * stránku, kde je polovica KPI stĺpcov prázdna. Prvé je N+1 v malom (a kontrakt
 * V4 ho výslovne zakazuje), druhé je horšie: prázdna bunka na obrazovke
 * neznamená „stránka je príliš veľká", znamená „o produkte nevieme".
 * Voľba 200 sa preto neponúka a `perPage` nemá ako prekročiť strop KPI.
 */
export const PER_PAGE_CHOICES = [50, 100] as const;

export type PerPage = (typeof PER_PAGE_CHOICES)[number];

/**
 * Stav produktu v eshope tak, ako sa naň dá pýtať (kontrakt produktov A3).
 *
 * Nie je to zoznam zaškrtávacích políčok, ale TRI vylučujúce sa možnosti — a je
 * to zámer. Repozitár aj API majú predvolený stav `ok` + `unknown`, takže
 * prázdny výber by ticho znamenal „a predsa ukáž bežné produkty"; políčka by
 * boli odškrtnuté a tabuľka plná. Tri možnosti, z ktorých vždy platí práve
 * jedna, ten rozpor nemajú.
 *
 *  · `known`        — čo eshop pri poslednom načítaní poznal (predvolené),
 *  · `withMissing`  — a navyše to, čo už nevracia,
 *  · `onlyMissing`  — VÝHRADNE to, čo už nevracia.
 */
export type ShopPresence = 'known' | 'withMissing' | 'onlyMissing';

export const SHOP_PRESENCES: readonly ShopPresence[] = ['known', 'withMissing', 'onlyMissing'];

/**
 * Ktoré stavy sa posielajú do API. Mená hodnôt sú tie isté ako v API, aby sa
 * adresa obrazovky dala poslať ďalej bez prekladu.
 */
export const SHOP_PRESENCE_STATUSES: Readonly<Record<ShopPresence, readonly string[]>> = {
  known: ['ok', 'unknown'],
  withMissing: ['ok', 'not_found', 'unknown'],
  onlyMissing: ['not_found'],
};

/**
 * Odkiaľ je riadok, ako sa na to dá filtrovať (kontrakt produktov A3).
 *
 * POZOR — toto NIE JE parameter API a nesmie sa doň dostať. `origin` vzniká až
 * v odpovedi: `mirror` je riadok zo zrkadla, `shop` je riadok, ktorý appka
 * práve dohľadala v eshope (`lookup`). Dohľadané riadky žijú len v jednej
 * odpovedi — nové volanie API ich nemá odkiaľ zopakovať. Keby bol tento filter
 * súčasťou `CatalogFilterState`, jeho zmena by spustila nový dotaz, dohľadané
 * riadky by zmizli a voľba „len dohľadané" by vrátila prázdnu tabuľku. Preto sa
 * uplatňuje nad UŽ NAČÍTANÝMI riadkami cez `filterRowsByOrigin()` a drží sa
 * mimo filtra.
 */
export type OriginFilter = 'all' | 'mirror' | 'shop';

export const ORIGIN_FILTERS: readonly OriginFilter[] = ['all', 'mirror', 'shop'];

/**
 * Riadky podľa pôvodu. Je to výber nad tým, čo obrazovka práve drží — nie
 * stránkovaný dotaz, takže neklame ani pri neúplnom zrkadle: dohľadané riadky
 * prichádzajú v jednom celku, nie po stránkach.
 */
export function filterRowsByOrigin<T extends { readonly origin: 'mirror' | 'shop' }>(
  rows: readonly T[],
  origin: OriginFilter,
): readonly T[] {
  if (origin === 'all') return rows;
  return rows.filter((row) => row.origin === origin);
}

/**
 * Poradie riadkov. Mená sú tie isté, aké prijíma `GET /api/catalog/search`;
 * triedenia, ktoré appka na povrchu neponúka (`id`), tu zámerne nie sú — stav,
 * ktorý sa nedá naklikať, by bol len tichý sľub.
 */
export const CATALOG_SORTS = ['price_desc', 'price_asc', 'sold_desc', 'sold_asc', 'name'] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

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
  /**
   * Podľa STAVU V SHOPE (`catalog_cache.reduction_*` z obohatenia, D116) — teda
   * druhá veta než `currentlyDiscounted`. Platí LEN pre obohatené riadky:
   * o neobohatenom produkte appka stav shopu nepozná, a preto sa nevráti.
   * Koľko riadkov je obohatených, hovorí `counts.enrichedRows`.
   */
  readonly shopDiscounted: boolean;
  /** Čo eshop o produkte povedal pri poslednom načítaní (kontrakt produktov A3). */
  readonly shopPresence: ShopPresence;
  /** Poradie riadkov. Nie je to podmienka otázky — pozri hlavičku modulu. */
  readonly sort: CatalogSort;
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
  shopDiscounted: false,
  shopPresence: 'known',
  /**
   * NAJHORŠIE LEŽIAKY PRVÉ (kontrakt V4 §5 K4, 31. 8. 2026).
   *
   * Do V4 tu bolo `price_desc` („najdrahšie prvé", kontrakt UI bod 19). Tabuľka
   * Produktov je nástroj na hľadanie kusov, ktoré treba zlacniť, a najdrahší
   * produkt na tú otázku neodpovedá — najmenej predávaný áno. Bod 19 tým
   * NEZANIKÁ ako preferencia stĺpca ceny (prvý klik na cenu je stále
   * najdrahšie prvé), mení sa len to, s čím sa obrazovka otvára.
   *
   * POZOR, ČO TOTO PORADIE VIE A ČO NIE: triedi ho SQL nad `units_sold` z
   * `catalog/search`, teda nad súčtom, ktorý nemá bránu `status='complete'` —
   * nedočítaný deň sa v ňom počíta ako deň s nulou. Je to teda poradie, nie
   * tvrdenie o číslach, a preto sa ten súčet NIKDY nezobrazuje (zobrazené kusy
   * sú z KPI, kde brána je). Hlavička stĺpca to hovorí nahlas.
   */
  sort: 'sold_asc',
  page: 1,
  /** Kontrakt V4 §5 K4: „stránkovanie po 100" — a strop KPI je presne 100. */
  perPage: 100,
};

/* ═══════════════════════════ 2. Rozpoznávanie ═════════════════════════════ */

const isSoldWindow = (value: number): value is SoldWindow =>
  (SOLD_WINDOWS as readonly number[]).includes(value);

const isSoldBucket = (value: string): value is SoldBucket =>
  (SOLD_BUCKETS as readonly string[]).includes(value);

const isPerPage = (value: number): value is PerPage =>
  (PER_PAGE_CHOICES as readonly number[]).includes(value);

const isCatalogSort = (value: string): value is CatalogSort =>
  (CATALOG_SORTS as readonly string[]).includes(value);

/**
 * Zoznam stavov z adresy → jedna z troch možností. Rozhoduje sa podľa toho, čo
 * v zozname JE, nie podľa presnej zhody — adresa z uloženého filtra alebo
 * z odkazu môže mať stavy v inom poradí a nesmie kvôli tomu spadnúť inam.
 */
function parseShopPresence(raw: string): ShopPresence {
  const values = new Set(
    raw
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  );
  if (!values.has('not_found')) return 'known';
  return values.has('ok') ? 'withMissing' : 'onlyMissing';
}

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
  /**
   * `true` pridá triedenie. Je to VÝSLOVNÁ voľba, nie predvolené správanie:
   * query string filtra znamená OTÁZKU (kľúč filtra, odkaz do novej zľavy,
   * dotazy sprievodcu) a poradie riadkov otázku nemení. Posiela ho jediné
   * miesto — tabuľka Produktov cez `catalog-api.ts`.
   */
  readonly sorting?: boolean;
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
  // Meno je to isté ako v API (bod 1 v hlavičke) a zámerne INÉ než
  // `currentlyDiscounted` — sú to dve rôzne tvrdenia o tom istom produkte.
  if (filter.shopDiscounted) params.set('shopDiscounted', '1');

  // Predvolená možnosť sa NEPOSIELA: je to presne to, čo repozitár urobí sám,
  // a prázdny parameter drží adresy krátke a staršie uložené filtre platné.
  if (filter.shopPresence !== 'known') {
    params.set('shopStatus', SHOP_PRESENCE_STATUSES[filter.shopPresence].join(','));
  }

  // Výslovne a len na vyžiadanie — repozitár má vlastný default `name`,
  // takže obrazovka Produktov posiela svoje poradie vždy (kontrakt UI, bod 19),
  // kdežto otázka odovzdaná ďalej ho nenesie vôbec.
  if (options.sorting === true) params.set('sort', filter.sort);

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
 * Kľúč filtra bez stránkovania a bez triedenia — dve stránky toho istého
 * filtra sú ten istý filter a preusporiadanie riadkov tiež. Používa sa na
 * rozoznanie uloženého filtra a na zrušenie výberu, keď sa filter naozaj
 * zmenil.
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
  const sort = first(params, 'sort') ?? '';

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
    shopDiscounted: flag(params, 'shopDiscounted'),
    shopPresence: parseShopPresence(first(params, 'shopStatus') ?? ''),
    sort: isCatalogSort(sort) ? sort : DEFAULT_CATALOG_FILTER.sort,
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
 *
 * Triedenie sa do odkazu NEPOSIELA: zľava sa robí na množinu, nie na poradie,
 * a keby v odkaze bolo, prehodenie stĺpca v tabuľke by ticho zmenilo, čo sa
 * sprievodcovi odovzdalo.
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
