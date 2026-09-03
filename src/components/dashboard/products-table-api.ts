'use client';

/**
 * Aura Zľavy — ČÍTANIE TABUĽKY PRODUKTOV NA PREHĽADE (V7, D159–D163, K8).
 *
 * Tabuľka Prehľadu je rozpis tretej KPI karty (D155) a číta DVE odpovede:
 *
 *   `GET /api/catalog/search?…`      → riadky zrkadla: id, názov, cena, stav
 *                                      vlastnej zľavy, počet a stránkovanie.
 *   `GET /api/insights/product-kpi?ids=…&long=N`
 *                                    → obohatené čísla pre PRÁVE ZOBRAZENÚ
 *                                      stránku: referencia, EAN, zľava
 *                                      v shope, sklad, marža, predané za okno.
 *
 * ANI JEDNA Z NICH NEVOLÁ SHOP (K8). Sú to `SELECT`-y nad miestnou kópiou;
 * cesty, ktoré shop naozaj volajú (`?lookup=1`, `POST /api/catalog/details`,
 * `POST /api/catalog/enrich`), sa odtiaľto NESPÚŠŤAJÚ ani raz — Prehľad je na
 * čítanie a render cesta nemá čo míňať kvótu.
 *
 * ═══ PREČO VLASTNÝ KLIENT A NIE TEN Z `components/products` ═══
 * `products/catalog-api.ts` je klient PRACOVNEJ obrazovky: nesie dohľadanie
 * v eshope, doťahovanie kódov, spúšťanie dávky synchronizácie a výber. Prehľad
 * z toho nesmie mať ani jednu vec — a keby zdieľal modul, prvé rozšírenie tam
 * by ticho pridalo shopové volanie sem. `components/dashboard/` preto nemá ani
 * jeden import z `components/products/` a tento modul to nemení.
 *
 * Cena je, že tvar odpovede sa čita na dvoch miestach. Platí sa vedome a je to
 * ten istý dôvod, pre ktorý má Prehľad vlastné `api.ts`, `status-api.ts`,
 * `window-api.ts`, `kpi-api.ts` a `sales-daily-api.ts`: rozsah toho, čo
 * obrazovka smie zavolať, je vlastnosť OBRAZOVKY.
 *
 * ═══ PRAVIDLO MODULU: ČO SA NEDÁ PREČÍTAŤ, JE `null` ═══
 * Nikdy nula, nikdy dopočítaný odhad (I11, P7). `fetchJson()` vracia `null` aj
 * na 404 aj na `{ ok: false }`, takže z chýbajúcej odpovede nakreslí tabuľka
 * pomlčky a vetu — a to je dnes BEŽNÝ stav (R4: appka je bez `shop_write`
 * kľúča a IP je zabanovaná).
 *
 * TRI POLIA, KTORÉ SA TU NESMÚ ZLIAŤ DO NULY
 *  1. `unitsSold` — `null` znamená „za toto okno to nevieme" (D121). `?? 0` je
 *     na ňom ZAKÁZANÉ: z nuly je vedro „0 predaných" a z neho 30 % zľava na
 *     tisícoch produktov. Tabuľka Prehľadu ho pritom NEPOUŽÍVA na stĺpec
 *     „predané za okno" — ten berie z KPI, kde je aj pokrytie okna — ale číta
 *     ho pre vetu o tom, koľko riadkov stránky je „nevieme".
 *  2. `soldUnknown` v počtoch — koľko riadkov nemá predaj za okno zmeraný.
 *     `null` = odpoveď to nepovedala; dosadená nula by tvrdila, že pásma
 *     pokrývajú celý katalóg (D121).
 *  3. `gap` v každom KPI poli — kontroluje sa PRED hodnotou. Odpoveď
 *     `{ value: 0, gap: 'days_missing' }` je pomlčka, nie nula.
 *
 * Vlastník: V7, krok 3/4 (tabuľka s filtrami).
 */
import { asRecord, readCount, readFlag, readNumber, readText } from '@/components/dashboard/json';
import { fetchJson } from '@/components/layout/health';

/* ═══════════════════════ 1. Riadok zrkadla katalógu ═══════════════════════ */

/**
 * Jeden riadok tak, ako ho posiela `/api/catalog/search`.
 *
 * Je to ZÁMERNE menšia množina polí než `CatalogRowView` na Produktoch:
 * Prehľad nekreslí `origin`, `shopStatus` ani `hasAttributes`, pretože nemá
 * dohľadávanie v eshope ani panel detailu (D163) — a pole, ktoré obrazovka
 * nekreslí, by tu bolo len ďalšie miesto, kde sa dá pokaziť význam prázdna.
 */
export interface OverviewCatalogRow {
  readonly productId: number;
  /** `null` = zrkadlo názov nemá; bunka z toho urobí `#id`, nie prázdno (D151). */
  readonly name: string | null;
  /** Cena zo zoznamového prechodu ako TEXT — appka ju neprepočítava. */
  readonly price: string | null;
  /**
   * Predané kusy za okno, alebo `null` = „za toto okno to nevieme" (D121).
   * Pozri bod 1 v hlavičke modulu — `?? 0` je tu zakázaný.
   */
  readonly unitsSold: number | null;
  /** I11 — z VLASTNÝCH úspešných zápisov appky, nie zo stavu v shope. */
  readonly everDiscounted: boolean;
  readonly discountedNow: boolean;
}

/** Počty do vety pod tabuľkou. Každé pole smie byť `null` = „nevieme". */
export interface OverviewCatalogCounts {
  readonly total: number | null;
  /**
   * Koľko riadkov filtra nemá predaj za okno ZMERANÝ (D121). Pásma + toto =
   * `total`; bez tohto čísla by nula v pásme „0 predaných" vyzerala ako „také
   * produkty tu nie sú", hoci ich môže byť celý katalóg.
   */
  readonly soldUnknown: number | null;
  /** Z `total` tie, ktoré sú obohatené — koľkých sa referencia a EAN týkajú. */
  readonly enrichedRows: number | null;
}

export interface OverviewCatalogPage {
  readonly rows: readonly OverviewCatalogRow[];
  readonly page: number;
  readonly perPage: number;
  /**
   * Počet riadkov v ZRKADLE, ktoré vyhovujú filtru. Nie je to počet v eshope —
   * kým zrkadlo nie je úplné, je to dolná hranica a stránkovač to označí `≈`
   * (P7, `Pagination.totalIsLowerBound`).
   */
  readonly total: number;
  /** Okno, za ktoré je `unitsSold`, TAK AKO HO POVEDALA odpoveď — nie ako ho chcela obrazovka. */
  readonly soldWindowDays: number;
  readonly counts: OverviewCatalogCounts | null;
  /** Riadky zrkadla celkom (bez filtra) — menovateľ vety „z 41 348". */
  readonly catalogTotal: number | null;
  /**
   * Zamknuté filtre TAK, AKO ICH POVEDAL SERVER (K8). Kľúče sú kódy rozmerov
   * (`category`, `metal`, `jewelryType`); obrazovka si zoznam NEVYMÝŠĽA a
   * NEDOPĹŇA — mená a dôvod má `lib/ui/locked-dimensions.ts`.
   */
  readonly lockedFilters: readonly string[];
}

function parseRow(raw: unknown): OverviewCatalogRow | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const productId = readCount(record, 'productId');
  // Bez ID sa riadok nedá pripojiť ani nahlásiť (D151) — zahodí sa celý.
  if (productId === null) return null;
  return {
    productId,
    name: readText(record, 'name'),
    price: readText(record, 'price'),
    /* `readNumber`, nie `readCount`: nula je platná hodnota a `null` musí
       zostať `null`. Pozri bod 1 hlavičky. */
    unitsSold: readNumber(record, 'unitsSold'),
    everDiscounted: readFlag(record, 'everDiscounted'),
    discountedNow: readFlag(record, 'discountedNow'),
  };
}

function parseCounts(raw: unknown): OverviewCatalogCounts | null {
  const record = asRecord(raw);
  if (record === null) return null;
  return {
    total: readCount(record, 'total'),
    soldUnknown: readCount(record, 'soldUnknown'),
    enrichedRows: readCount(record, 'enrichedRows'),
  };
}

/**
 * Zamknuté filtre z odpovede. Server posiela mapu `{ category: { locked: true,
 * requested: false } }`; obrazovku zaujímajú KĽÚČE, pretože mená aj dôvod
 * vlastní `locked-dimensions.ts` (D125) a druhý zoznam vedľa neho by sa s ním
 * rozišiel.
 */
function parseLocked(raw: unknown): readonly string[] {
  const record = asRecord(raw);
  if (record === null) return [];
  return Object.keys(record).filter((key) => {
    const entry = asRecord(record[key]);
    return entry !== null && entry.locked === true;
  });
}

export function parseCatalogPage(raw: unknown): OverviewCatalogPage | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const rows = record['data'];
  /*
   * Odpoveď bez poľa riadkov je NEČITATEĽNÁ, nie prázdna stránka. Prázdna
   * tabuľka by tvrdila „taký produkt tu nie je" a to je pri 41 348 riadkoch
   * nebezpečná lož.
   */
  if (!Array.isArray(rows)) return null;
  return {
    rows: rows.map(parseRow).filter((row): row is OverviewCatalogRow => row !== null),
    page: readCount(record, 'page') ?? 1,
    perPage: readCount(record, 'perPage') ?? 0,
    total: readCount(record, 'total') ?? 0,
    soldWindowDays: readCount(record, 'soldWindowDays') ?? 0,
    counts: parseCounts(record['counts']),
    catalogTotal: readCount(record, 'catalogTotal'),
    lockedFilters: parseLocked(record['lockedFilters']),
  };
}

/** Stránka zrkadla pre naklikaný filter. Query skladá `products-table-view.ts`. */
export async function getCatalogPage(query: string): Promise<OverviewCatalogPage | null> {
  return parseCatalogPage(await fetchJson(`/api/catalog/search?${query}`));
}

/* ═══════════════════════ 2. KPI zobrazenej stránky ════════════════════════ */

/** Prečo hodnota nie je. Tie isté kódy, aké posiela `productKpis()`. */
export const OVERVIEW_KPI_GAPS = [
  'not_enriched',
  'shop_has_none',
  'days_missing',
  'not_computable',
] as const;

export type OverviewKpiGap = (typeof OVERVIEW_KPI_GAPS)[number];

/** Jedno KPI: hodnota, alebo dôvod, prečo ju nemáme (I11). */
export interface OverviewKpiValue<T> {
  readonly value: T | null;
  readonly gap: OverviewKpiGap | null;
}

export const OVERVIEW_DISCOUNT_STATES = [
  'running',
  'scheduled',
  'ended',
  'none',
  'unknown',
] as const;

export type OverviewDiscountState = (typeof OVERVIEW_DISCOUNT_STATES)[number];

/** Stav zľavy PODĽA SHOPU k času obohatenia — nie podľa vlastných zápisov. */
export interface OverviewKpiDiscount {
  readonly state: OverviewDiscountState;
  readonly activePercent: OverviewKpiValue<number>;
  readonly from: string | null;
  readonly to: string | null;
  /** `null` = produkt NIE JE obohatený, takže stav shopu appka nepozná. */
  readonly measuredAt: string | null;
}

/** Predané kusy za okno a to, koľko dní okna appka NEMÁ (D119, D121). */
export interface OverviewKpiWindow {
  readonly windowDays: number;
  readonly completeDays: number;
  readonly unknownDays: number;
  readonly units: OverviewKpiValue<number>;
  /** `true` ⇔ `units.value` je len DOLNÁ HRANICA (`≥`). */
  readonly lowerBound: boolean;
}

export interface OverviewKpiRow {
  readonly productId: number;
  readonly reference: OverviewKpiValue<string>;
  /** EAN-13 z obohatenia (D150, V7). Vyplnený LEN pri obohatených riadkoch. */
  readonly ean13: OverviewKpiValue<string>;
  readonly discount: OverviewKpiDiscount;
  readonly stock: OverviewKpiValue<number>;
  readonly soldTotal: OverviewKpiValue<number>;
  readonly soldPerStock: OverviewKpiValue<number>;
  readonly margin: OverviewKpiValue<number>;
  readonly marginPercent: OverviewKpiValue<number>;
  /**
   * DLHÉ okno odpovede (`window90`), teda to, o ktoré si obrazovka požiadala
   * cez `?long=`. Meno `units90` je menovka DLHÉHO okna, nie sľub 90 dní —
   * skutočnú dĺžku hovorí `windowDays` vnútri.
   */
  readonly unitsWindow: OverviewKpiWindow;
}

export interface OverviewKpiPage {
  /** Dĺžka okna TAK, AKO JU POVEDALA odpoveď. Nadpis stĺpca sa berie z nej. */
  readonly windowDays: number;
  readonly byId: ReadonlyMap<number, OverviewKpiRow>;
}

/**
 * Strop route (`MAX_KPI_IDS = 100`). Je tu druhýkrát zámerne: keby klient
 * poslal dlhší zoznam, route odpovie 400 a CELÁ stránka zostane bez KPI.
 * Preto `PER_PAGE_CHOICES` na Prehľade končí na 100 (D161) — 200 by znamenalo
 * sto riadkov s pomlčkami, ktoré nič nepriznávajú.
 */
export const OVERVIEW_KPI_IDS_MAX = 100;

function readGap(record: Record<string, unknown>): OverviewKpiGap | null {
  const value = record['gap'];
  if (typeof value !== 'string') return null;
  return (OVERVIEW_KPI_GAPS as readonly string[]).includes(value)
    ? (value as OverviewKpiGap)
    : null;
}

function parseKpiNumber(raw: unknown): OverviewKpiValue<number> {
  const record = asRecord(raw);
  if (record === null) return { value: null, gap: null };
  return { value: readNumber(record, 'value'), gap: readGap(record) };
}

function parseKpiText(raw: unknown): OverviewKpiValue<string> {
  const record = asRecord(raw);
  if (record === null) return { value: null, gap: null };
  return { value: readText(record, 'value'), gap: readGap(record) };
}

/**
 * Okno predajov. Nečitateľné okno je MEDZERA, nie plné pokrytie: `unknownDays`
 * padá na celú dĺžku okna, takže bunka povie „nevieme", nie nulu.
 */
function parseKpiWindow(raw: unknown, fallbackDays: number): OverviewKpiWindow {
  const record = asRecord(raw);
  if (record === null) {
    return {
      windowDays: fallbackDays,
      completeDays: 0,
      unknownDays: fallbackDays,
      units: { value: null, gap: 'days_missing' },
      lowerBound: false,
    };
  }
  const unknownDays = readCount(record, 'unknownDays');
  return {
    windowDays: readCount(record, 'windowDays') ?? fallbackDays,
    completeDays: readCount(record, 'completeDays') ?? 0,
    unknownDays: unknownDays ?? fallbackDays,
    units: parseKpiNumber(record['units']),
    lowerBound: readFlag(record, 'lowerBound') || (unknownDays !== null && unknownDays > 0),
  };
}

function parseKpiDiscount(raw: unknown): OverviewKpiDiscount {
  const record = asRecord(raw);
  if (record === null) {
    return {
      state: 'unknown',
      activePercent: { value: null, gap: null },
      from: null,
      to: null,
      measuredAt: null,
    };
  }
  const state = record['state'];
  return {
    /* Neznámy kód je `unknown`, teda „nevieme" — nikdy „žiadna zľava nebeží".
       Porovnáva sa výslovne: Turbopack tu už raz skrátený guard zahodil. */
    state:
      typeof state === 'string' && (OVERVIEW_DISCOUNT_STATES as readonly string[]).includes(state)
        ? (state as OverviewDiscountState)
        : 'unknown',
    activePercent: parseKpiNumber(record['activePercent']),
    from: readText(record, 'from'),
    to: readText(record, 'to'),
    measuredAt: readText(record, 'measuredAt'),
  };
}

function parseKpiRow(raw: unknown, fallbackDays: number): OverviewKpiRow | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const productId = readCount(record, 'productId');
  // Bez ID by sa čísla pripísali cudziemu riadku — riadok sa zahodí celý.
  if (productId === null) return null;
  return {
    productId,
    reference: parseKpiText(record['reference']),
    ean13: parseKpiText(record['ean13']),
    discount: parseKpiDiscount(record['discount']),
    stock: parseKpiNumber(record['stock']),
    soldTotal: parseKpiNumber(record['soldTotal']),
    soldPerStock: parseKpiNumber(record['soldPerStock']),
    margin: parseKpiNumber(record['margin']),
    marginPercent: parseKpiNumber(record['marginPercent']),
    unitsWindow: parseKpiWindow(record['units90'], fallbackDays),
  };
}

export function parseKpiPage(raw: unknown, requestedDays: number): OverviewKpiPage | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const rows = record['rows'];
  /*
   * Odpoveď bez poľa riadkov je NEČITATEĽNÁ. Prázdna mapa by znamenala
   * „o žiadnom produkte nič nevieme", a to je tvrdenie — vráti sa `null` a
   * tabuľka nakreslí pomlčky s dôvodom „ešte sa nenačítali".
   */
  if (!Array.isArray(rows)) return null;
  const window = asRecord(record['window90']);
  const byId = new Map<number, OverviewKpiRow>();
  const windowDays =
    window === null ? requestedDays : (readCount(window, 'windowDays') ?? requestedDays);
  for (const entry of rows) {
    const row = parseKpiRow(entry, windowDays);
    if (row === null) continue;
    byId.set(row.productId, row);
  }
  return { windowDays, byId };
}

/**
 * KPI pre PRÁVE ZOBRAZENÚ stránku, jedným dotazom.
 *
 * `?long=` je okno prepínača kariet (30/60/90/180/360, D149). Krátke okno
 * odpovede sa NEPOUŽÍVA — tabuľka je rozpis TRETEJ KARTY a tá hovorí o okne
 * prepínača, takže druhé okno v tej istej tabuľke by bolo druhé číslo za druhé
 * obdobie (D155).
 *
 * Dlhší zoznam než strop route sa NEODREŽE: odrezaná stránka vyzerá presne
 * ako stránka, o ktorej appka nič nevie, a tie dve veci sa rozlíšiť musia.
 */
export async function getKpiPage(
  productIds: readonly number[],
  windowDays: number,
): Promise<OverviewKpiPage | null> {
  if (productIds.length === 0) return { windowDays, byId: new Map() };
  if (productIds.length > OVERVIEW_KPI_IDS_MAX) return null;
  const params = new URLSearchParams({
    ids: productIds.join(','),
    long: String(windowDays),
  });
  return parseKpiPage(await fetchJson(`/api/insights/product-kpi?${params.toString()}`), windowDays);
}
