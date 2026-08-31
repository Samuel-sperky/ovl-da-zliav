'use client';

/**
 * Aura Zľavy — klientske volania tabu Produkty (V10; kontrakt V3 K7, K8, I11).
 *
 * Modul zámerne NEIMPORTUJE nič z `components/campaigns` ani z `products/api.ts`
 * (správa povolených produktov). Tab Produkty číta katalóg a do shopu NIKDY
 * nezapisuje; keby zdieľal klienta so zápisovou obrazovkou, jedna zmena tam by
 * mohla ticho zmeniť správanie tu.
 *
 * JEDNA VÝNIMKA A PREČO NIE JE ZÁPIS
 * ----------------------------------
 * `runCatalogBatch()` posiela `POST /api/catalog/sync`. Je to jediné `POST`
 * v tomto module a je to ČÍTANIE zo shopu: načíta ďalšiu stránku katalógu do
 * `catalog_cache`. Nedotkne sa zápisového rozpočtu ani zliav a nemá ako —
 * synchronizácia sa ku klientovi shopu dostane len cez `listProducts`. Tlačidlo
 * tu musí byť preto, že vety prekážok posielajú používateľa načítať katalóg
 * PRÁVE do Produktov (`BLOCKER_PATHS.products`); obrazovka bez toho tlačidla by
 * z tej vety urobila slepú uličku.
 *
 * Čo tento modul NEROBÍ:
 *
 *  · nevymýšľa dáta pre zamknuté filtre — `lockedFilters` z odpovede sa
 *    predáva ďalej tak, ako prišli (K8),
 *  · nedopočítava „Dáta k …" — `dataAsOf` je meraný fakt, `null` znamená
 *    prázdny katalóg a obrazovka to má povedať, nie odhadnúť (P7),
 *  · netvrdí, že pozná stav zľavy v shope — `discountedNow` je náš vlastný
 *    zápis (I11) a tak sa aj pomenúva na povrchu,
 *  · neskladá vety o prekážkach — `GET /api/status` ich vracia hotové
 *    z `lib/status/blockers.ts` a obrazovka ich len vykreslí.
 *
 * JEDINÉ MIESTO, KTORÉ POSIELA PORADIE
 * ------------------------------------
 * `sorting: true` je tu, a inde v appke nie. Query string filtra slúži aj ako
 * kľúč uloženého výberu a ako odkaz do novej zľavy — tam znamená OTÁZKU, a tú
 * poradie riadkov nemení. Repozitár má vlastný default `name`, takže tabuľka
 * svoje poradie (predvolene najdrahšie prvé) posiela vždy explicitne.
 *
 * Vlastník: V10.
 */
import {
  asRecord,
  readCode,
  readCount,
  readFlag,
  readNumber,
  readText,
} from '@/components/dashboard/json';
import { parseStatusPayload } from '@/components/dashboard/status-payload';
import type { CatalogFilterState } from '@/components/products/catalog-filter';
import { catalogSearchQuery } from '@/components/products/catalog-filter';
import type {
  CatalogReadsView,
  CatalogRunOutcomeView,
  CatalogRunReportView,
  CatalogStatusView,
  CatalogWaiting,
} from '@/components/products/catalog-status';
import type { StatusPayload } from '@/lib/status/snapshot';

/* ═══════════════════════════ 1. Obálka odpovede ═══════════════════════════ */

export interface ApiErrorView {
  readonly code: string;
  readonly message: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiErrorView };

/** Hláška, keď server odpovie inak, než appka čaká. Bez kódu, bez čísla. */
const UNEXPECTED: ApiErrorView = {
  code: 'unexpected',
  message: 'Server odpovedal inak, než sme čakali. Skúste to znova.',
};

const OFFLINE: ApiErrorView = {
  code: 'network',
  message: 'Server neodpovedá. Skúste to znova.',
};

/**
 * Telo prišlo, obálka sedí — ale obsah nie.
 *
 * Znenie je to isté ako pri `UNEXPECTED` (používateľ vidí ten istý problém:
 * server odpovedal inak, než appka čaká), kód je iný, aby sa dva rôzne dôvody
 * dali od seba odlíšiť v logu a v teste.
 */
const UNREADABLE: ApiErrorView = { code: 'shape', message: UNEXPECTED.message };

/** Zrušený dotaz nie je chyba — používateľ len rýchlo klikol ďalej. */
const ABORTED: ApiErrorView = { code: 'aborted', message: '' };

/**
 * Surové telo odpovede. `unknown`, nie `T` — TU SA NEPRETYPOVÁVA.
 *
 * Do 24. 8. 2026 tu stálo `await res.json() as Result<T>` a celá odpoveď sa tým
 * stala „overenou" bez toho, aby ju ktokoľvek prečítal. Práve tadiaľto prišiel
 * kód stavu `writing`, ktorý zhodil obrazovku Zľavy: obrazovka verila typu,
 * typ neveril ničomu. Tvar overujú `parse*()` funkcie nižšie, rovnako ako
 * v `dashboard/api.ts` a `dashboard/status-api.ts`.
 */
async function readBody(url: string, signal?: AbortSignal): Promise<Result<unknown>> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
    return envelopeOf(await bodyOf(res));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: ABORTED };
    }
    return { ok: false, error: OFFLINE };
  }
}

/**
 * `POST` s prázdnym telom. Používa ho výhradne `runCatalogBatch()` — pozri
 * hlavičku modulu, prečo je jedno `POST` v čítacom klientovi v poriadku.
 */
async function postBody(url: string, signal?: AbortSignal): Promise<Result<unknown>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    });
    return envelopeOf(await bodyOf(res));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, error: ABORTED };
    }
    return { ok: false, error: OFFLINE };
  }
}

/** Telo ako `unknown`; neplatný JSON je `undefined`, nie výnimka. */
async function bodyOf(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  }
}

/** Obálka `{ok, data}` → `Result<unknown>`. Čokoľvek iné je neprečítateľné. */
function envelopeOf(body: unknown): Result<unknown> {
  const record = asRecord(body);
  if (record === null || !('ok' in record)) return { ok: false, error: UNEXPECTED };
  if (record['ok'] !== true) {
    const error = asRecord(record['error']);
    const message = error === null ? null : readText(error, 'message');
    const code = error === null ? null : readText(error, 'code');
    return {
      ok: false,
      error: {
        code: code ?? UNEXPECTED.code,
        message: message ?? UNEXPECTED.message,
      },
    };
  }
  return { ok: true, data: record['data'] };
}

/**
 * Surová odpoveď → overený pohľad, alebo chyba obálky.
 *
 * Nečitateľné telo NIKDY nekončí ako prázdny pohľad: prázdna tabuľka je
 * tvrdenie („nič také nemáme") a to sa z neznalosti povedať nesmie (P7).
 */
function shaped<T>(res: Result<unknown>, parse: (raw: unknown) => T | null): Result<T> {
  if (!res.ok) return res;
  const data = parse(res.data);
  return data === null ? { ok: false, error: UNREADABLE } : { ok: true, data };
}

export const isAborted = (error: ApiErrorView): boolean => error.code === 'aborted';

/* ═══════════════════════════ 2. Katalóg ═══════════════════════════════════ */

export type ShopStatus = 'ok' | 'not_found' | 'unknown';

export interface CatalogRowView {
  readonly productId: number;
  readonly name: string | null;
  readonly price: string | null;
  readonly hasAttributes: boolean;
  readonly shopStatus: ShopStatus;
  /** Predané kusy za zvolené okno — jediné číslo predajnosti, ktoré máme. */
  readonly unitsSold: number;
  /** I11 — z vlastných úspešných zápisov, nie zo shopu. */
  readonly everDiscounted: boolean;
  readonly discountedNow: boolean;
  readonly fetchedAt: string;
  /**
   * I11 — ODKIAĽ je tento riadok. `mirror` = názov a cena z posledného
   * prechodu synchronizácie katalógu. `shop` = appka si ich práve vypýtala
   * z eshopu, lebo v zrkadle neboli.
   *
   * Bez tohto poľa by na jednej obrazovke stáli vedľa seba dva rôzne stupne
   * istoty a vyzerali by rovnako.
   */
  readonly origin: ProductOrigin;
}

/** Odkiaľ pochádza riadok katalógu (I11). */
export type ProductOrigin = 'mirror' | 'shop';

export interface CatalogCountsView {
  readonly total: number;
  readonly sold: Readonly<Record<'none' | 'low' | 'mid' | 'high', number>>;
  readonly neverDiscounted: number;
  readonly discountedNow: number;
  /**
   * Koľko riadkov má zľavu PODĽA SHOPU (D116). Je to DOLNÁ HRANICA: neobohatené
   * riadky sa doň nepočítajú, preto sa vedľa neho kreslí `enrichedRows`.
   */
  readonly shopDiscountedNow: number;
  /** Z `total` tie, ktoré sú obohatené — koľkých sa stav shopu vôbec týka. */
  readonly enrichedRows: number;
  readonly soldWindowDays: number;
}

/** Jeden zamknutý filter (K8). `requested` = poslali sme ho a nepoužil sa. */
export interface LockedFilterView {
  readonly locked: true;
  readonly requested: boolean;
}

export interface CatalogSearchView {
  readonly data: readonly CatalogRowView[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly soldWindowDays: number;
  readonly soldFrom: string;
  readonly soldTo: string;
  readonly counts: CatalogCountsView | null;
  readonly catalogTotal: number;
  /** P7 — meraný čas posledného načítania katalógu; `null` = katalóg je prázdny. */
  readonly dataAsOf: string | null;
  readonly lockedFilters: Readonly<Record<string, LockedFilterView>>;
  readonly discountSource: 'own_writes';
  /**
   * `total` je počet v ZRKADLE, nie v eshope. Kým zrkadlo nie je úplné, je to
   * DOLNÁ HRANICA a obrazovka ho musí označiť znakom `≈` (P7).
   */
  readonly totalSource: 'mirror';
  /** Výsledok dohľadania v eshope. Spúšťa sa VÝHRADNE na vyžiadanie. */
  readonly lookup: LookupView;
  /** Čo appka zatiaľ nesmie — presné filtre, kategórie, kód produktu. */
  readonly capabilities: readonly CapabilityView[];
}

/**
 * Dohľadanie v eshope (`?lookup=1`). Míňa anonymný rozpočet čítaní, preto sa
 * NIKDY nespúšťa samo — vždy až na kliknutie.
 */
export interface LookupView {
  readonly requested: boolean;
  readonly outcome: string;
  /** Koľko produktov hlási eshop pre túto otázku. `null` = nevieme. */
  readonly shopTotal: number | null;
  /** Koľko riadkov pribudlo z eshopu (v zrkadle neboli). */
  readonly addedFromShop: number;
  /** Koľko sa ich nestihlo dotiahnuť — zvyčajne pre rozpočet. */
  readonly notFetched: number;
  readonly readsUsed: number;
  /** Meraný čas hľadania, nie odhad. */
  readonly at: string | null;
  readonly error: string | null;
}

/** Funkcia, ktorú appka pozná, ale zatiaľ na ňu nemá oprávnenie (K8). */
export interface CapabilityView {
  readonly id: string;
  readonly available: boolean;
  /** Slovenská veta, prečo nie je dostupná. `null` = dostupná je. */
  readonly note: string | null;
}

/* ── Overenie tvaru (§ „tu sa nepretypováva") ──────────────────────────── */

const SHOP_STATUSES = ['ok', 'not_found', 'unknown'] as const satisfies readonly ShopStatus[];
const ORIGINS = ['mirror', 'shop'] as const satisfies readonly ProductOrigin[];
const SOLD_BANDS = ['none', 'low', 'mid', 'high'] as const;

/**
 * Riadok katalógu. Bez `productId` riadok neexistuje — nedá sa otvoriť ani
 * vybrať do zľavy, takže sa zahodí celý; kreslený riadok bez identity by bol
 * ponuka, ktorá pri kliknutí nič neurobí.
 *
 * `shopStatus` a `origin` sú UZAVRETÉ zoznamy a fail-closed padajú na to menej
 * sebavedomé tvrdenie: „nevieme, čo na to shop" a „je to zo zrkadla, nie
 * čerstvé z eshopu".
 */
function parseCatalogRow(raw: unknown): CatalogRowView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const productId = readCount(record, 'productId');
  if (productId === null) return null;
  return {
    productId,
    name: readText(record, 'name'),
    price: readText(record, 'price'),
    hasAttributes: readFlag(record, 'hasAttributes'),
    shopStatus: readCode(record, 'shopStatus', SHOP_STATUSES) ?? 'unknown',
    unitsSold: readCount(record, 'unitsSold') ?? 0,
    everDiscounted: readFlag(record, 'everDiscounted'),
    discountedNow: readFlag(record, 'discountedNow'),
    fetchedAt: readText(record, 'fetchedAt') ?? '',
    origin: readCode(record, 'origin', ORIGINS) ?? 'mirror',
  };
}

/** Počty nad celým výsledkom. Nečitateľné počty sú `null`, nie samé nuly (P7). */
function parseCounts(raw: unknown): CatalogCountsView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const total = readCount(record, 'total');
  if (total === null) return null;
  const soldRaw = asRecord(record['sold']);
  const sold: Record<'none' | 'low' | 'mid' | 'high', number> = {
    none: 0,
    low: 0,
    mid: 0,
    high: 0,
  };
  if (soldRaw !== null) {
    for (const band of SOLD_BANDS) sold[band] = readCount(soldRaw, band) ?? 0;
  }
  return {
    total,
    sold,
    neverDiscounted: readCount(record, 'neverDiscounted') ?? 0,
    discountedNow: readCount(record, 'discountedNow') ?? 0,
    shopDiscountedNow: readCount(record, 'shopDiscountedNow') ?? 0,
    enrichedRows: readCount(record, 'enrichedRows') ?? 0,
    soldWindowDays: readCount(record, 'soldWindowDays') ?? 0,
  };
}

/** K8 — zamknuté filtre sa preberajú tak, ako prišli; tvar sa len overí. */
function parseLockedFilters(raw: unknown): Record<string, LockedFilterView> {
  const record = asRecord(raw);
  if (record === null) return {};
  const out: Record<string, LockedFilterView> = {};
  for (const [key, value] of Object.entries(record)) {
    const entry = asRecord(value);
    if (entry === null || entry['locked'] !== true) continue;
    out[key] = { locked: true, requested: readFlag(entry, 'requested') };
  }
  return out;
}

function parseLookup(raw: unknown): LookupView {
  const record = asRecord(raw);
  if (record === null) {
    return {
      requested: false,
      outcome: '',
      shopTotal: null,
      addedFromShop: 0,
      notFetched: 0,
      readsUsed: 0,
      at: null,
      error: null,
    };
  }
  return {
    requested: readFlag(record, 'requested'),
    outcome: readText(record, 'outcome') ?? '',
    // `null` = koľko ich shop má, nevieme. Nula by tvrdila, že nemá žiadne.
    shopTotal: readCount(record, 'shopTotal'),
    addedFromShop: readCount(record, 'addedFromShop') ?? 0,
    notFetched: readCount(record, 'notFetched') ?? 0,
    readsUsed: readCount(record, 'readsUsed') ?? 0,
    at: readText(record, 'at'),
    error: readText(record, 'error'),
  };
}

function parseCapabilities(raw: unknown): CapabilityView[] {
  if (!Array.isArray(raw)) return [];
  const out: CapabilityView[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = readText(record, 'id');
    if (id === null) continue;
    out.push({ id, available: readFlag(record, 'available'), note: readText(record, 'note') });
  }
  return out;
}

export function parseCatalogSearch(raw: unknown): CatalogSearchView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const rows = record['data'];
  // Bez poľa riadkov to nie je odpoveď katalógu. Prázdna tabuľka by tvrdila
  // „taký produkt tu nie je" a to je pri 41 082 produktoch nebezpečná lož.
  if (!Array.isArray(rows)) return null;
  return {
    data: rows.map(parseCatalogRow).filter((row): row is CatalogRowView => row !== null),
    page: readCount(record, 'page') ?? 1,
    perPage: readCount(record, 'perPage') ?? 0,
    total: readCount(record, 'total') ?? 0,
    soldWindowDays: readCount(record, 'soldWindowDays') ?? 0,
    soldFrom: readText(record, 'soldFrom') ?? '',
    soldTo: readText(record, 'soldTo') ?? '',
    counts: parseCounts(record['counts']),
    catalogTotal: readCount(record, 'catalogTotal') ?? 0,
    // P7 — `null` znamená prázdny katalóg a obrazovka to má povedať pomlčkou.
    dataAsOf: readText(record, 'dataAsOf'),
    lockedFilters: parseLockedFilters(record['lockedFilters']),
    discountSource: 'own_writes',
    totalSource: 'mirror',
    lookup: parseLookup(record['lookup']),
    capabilities: parseCapabilities(record['capabilities']),
  };
}

export async function searchCatalog(
  filter: CatalogFilterState,
  signal?: AbortSignal,
): Promise<Result<CatalogSearchView>> {
  return shaped(
    await readBody(
      `/api/catalog/search?${catalogSearchQuery(filter, { sorting: true })}`,
      signal,
    ),
    parseCatalogSearch,
  );
}

/**
 * To isté hľadanie, ale s dohľadaním v eshope (`?lookup=1`).
 *
 * Zrkadlo katalógu má 2 900 zo 41 082 produktov, takže „ešte som to nenačítal"
 * vyzerá presne ako „taký produkt neexistuje". Toto ten rozdiel odstráni:
 * pýta sa verejného `searchIndex` a chýbajúce riadky dotiahne cez `get`.
 *
 * MÍŇA ANONYMNÝ ROZPOČET ČÍTANÍ (30/min, 300/UTC deň na IP), preto sa NIKDY
 * nevolá samo pri písaní — výhradne na kliknutie. Kontrakt UI, bod 26.
 */
export async function lookupInShop(
  filter: CatalogFilterState,
  signal?: AbortSignal,
): Promise<Result<CatalogSearchView>> {
  return shaped(
    await readBody(
      `/api/catalog/search?${catalogSearchQuery(filter, { sorting: true })}&lookup=1`,
      signal,
    ),
    parseCatalogSearch,
  );
}

/**
 * Jeden produkt v inom okne predajnosti — do bočného panela („za 360 dní 11").
 * Je to ten istý meraný údaj, len iné okno; nič sa nedopočítava.
 */
export async function catalogRow(
  productId: number,
  soldWindowDays: number,
  signal?: AbortSignal,
): Promise<Result<CatalogSearchView>> {
  const params = new URLSearchParams({
    productIds: String(productId),
    soldWindowDays: String(soldWindowDays),
    perPage: '1',
    counts: '0',
  });
  return shaped(
    await readBody(`/api/catalog/search?${params.toString()}`, signal),
    parseCatalogSearch,
  );
}

/* ═══════════════════════ 3. História zliav produktu ═══════════════════════ */

/**
 * Jeden VLASTNÝ zápis appky na produkt (I11). Nie je to história zliav
 * v shope — je to história toho, čo appka sama urobila, a tak sa to na
 * povrchu aj volá.
 */
export interface ProductWriteView {
  readonly itemId: number;
  readonly campaignId: number;
  readonly campaignName: string;
  readonly status: string;
  readonly percent: number;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly at: string | null;
}

export interface ProductWritesView {
  readonly productId: number;
  readonly today: string;
  readonly writes: readonly ProductWriteView[];
}

/**
 * Jeden vlastný zápis. Bez `itemId` a `campaignId` sa riadok nedá otvoriť ani
 * priradiť k zľave, preto sa zahodí. `status` ide ďalej surový — vetu z neho
 * skladá `itemSentence()` v slovníku a ten neznámy kód rieši sám.
 */
function parseProductWrite(raw: unknown): ProductWriteView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const itemId = readCount(record, 'itemId');
  const campaignId = readCount(record, 'campaignId');
  if (itemId === null || campaignId === null) return null;
  return {
    itemId,
    campaignId,
    campaignName: readText(record, 'campaignName') ?? '',
    status: readText(record, 'status') ?? '',
    percent: readCount(record, 'percent') ?? 0,
    dateFrom: readText(record, 'dateFrom') ?? '',
    dateTo: readText(record, 'dateTo') ?? '',
    at: readText(record, 'at'),
  };
}

export function parseProductWrites(raw: unknown): ProductWritesView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const productId = readCount(record, 'productId');
  const today = readText(record, 'today');
  if (productId === null || today === null) return null;
  const writes = record['writes'];
  // Prázdny zoznam znamená „appka do tohto produktu nikdy nepísala" (I11).
  // To sa nesmie povedať o odpovedi, ktorej sme nerozumeli.
  if (!Array.isArray(writes)) return null;
  return {
    productId,
    today,
    writes: writes
      .map(parseProductWrite)
      .filter((write): write is ProductWriteView => write !== null),
  };
}

export async function productWrites(
  productId: number,
  signal?: AbortSignal,
): Promise<Result<ProductWritesView>> {
  return shaped(
    await readBody(`/api/insights/product/${productId}`, signal),
    parseProductWrites,
  );
}

/* ═════════════════ 4. Stav katalógu (koľko z koľkých, prečo sa čaká) ══════ */

/**
 * Odpoveď `GET /api/catalog/sync`.
 *
 * Route posiela aj `lastRun` — posledný beh synchronizácie. Obrazovka ho
 * ZÁMERNE ignoruje: pri otvorení tabu by to bola veta o dávke, ktorú spustil
 * scheduler o tretej v noci, a používateľ by hľadal, čo práve urobil on. Vetu
 * o behu ukazujeme len ako odpoveď na kliknutie (`runCatalogBatch`).
 */
export interface CatalogSyncView {
  readonly catalog: CatalogStatusView;
}

/**
 * Stav katalógu BEZ toho, aby sa čokoľvek spustilo — na shop neodíde ani jeden
 * request, takže sa to dá volať aj opakovane pri otvorení obrazovky.
 */
const WAITING_KINDS = [
  'rate_limited',
  'daily_budget',
  'error',
  'catalog_complete',
] as const satisfies readonly CatalogWaiting[];

/**
 * Rozpočet čítaní katalógu.
 *
 * Keď sa blok nedá prečítať, čísla NIE SÚ pravda a typ na to má vlastné pole:
 * `known: false` znamená „toto je fail-closed domnienka" a karta katalógu to
 * na obrazovke prizná. Preto sa tu vracia hodnota a nie `null` — inak by sa
 * o rozpočte nedalo povedať vôbec nič.
 */
function parseCatalogReads(raw: unknown): CatalogReadsView {
  const record = asRecord(raw);
  if (record === null) {
    return {
      day: '',
      limit: 0,
      used: 0,
      remaining: 0,
      exhausted: false,
      resetAt: '',
      minuteLimit: 0,
      usedThisMinute: 0,
      known: false,
    };
  }
  return {
    day: readText(record, 'day') ?? '',
    limit: readCount(record, 'limit') ?? 0,
    used: readCount(record, 'used') ?? 0,
    remaining: readCount(record, 'remaining') ?? 0,
    exhausted: readFlag(record, 'exhausted'),
    resetAt: readText(record, 'resetAt') ?? '',
    minuteLimit: readCount(record, 'minuteLimit') ?? 0,
    usedThisMinute: readCount(record, 'usedThisMinute') ?? 0,
    known: readFlag(record, 'known'),
  };
}

/**
 * Stav katalógu. `shopTotalProducts`, `percent`, `pagesTotal`, `pagesLeft`
 * a odhady zostávajú `null`, keď ich odpoveď nenesie — karta vtedy kreslí
 * pomlčku. Dopočítať ich by znamenalo vymyslieť, koľko z eshopu appka má.
 */
function parseCatalogStatus(raw: unknown): CatalogStatusView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const loadedProducts = readCount(record, 'loadedProducts');
  if (loadedProducts === null) return null;
  return {
    loadedProducts,
    shopTotalProducts: readCount(record, 'shopTotalProducts'),
    percent: readNumber(record, 'percent'),
    complete: readFlag(record, 'complete'),
    refreshing: readFlag(record, 'refreshing'),
    lastFetchedAt: readText(record, 'lastFetchedAt'),
    lastReadAt: readText(record, 'lastReadAt'),
    pagesDone: readCount(record, 'pagesDone') ?? 0,
    pagesTotal: readCount(record, 'pagesTotal'),
    pagesLeft: readCount(record, 'pagesLeft'),
    perPage: readCount(record, 'perPage') ?? 0,
    reads: parseCatalogReads(record['reads']),
    waiting: readCode(record, 'waiting', WAITING_KINDS),
    nextBatchAt: readText(record, 'nextBatchAt'),
    estimatedDaysLeft: readCount(record, 'estimatedDaysLeft'),
    estimatedFinishAt: readText(record, 'estimatedFinishAt'),
    lastError: readText(record, 'lastError'),
  };
}

export function parseCatalogSync(raw: unknown): CatalogSyncView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const catalog = parseCatalogStatus(record['catalog']);
  return catalog === null ? null : { catalog };
}

export async function catalogSyncStatus(signal?: AbortSignal): Promise<Result<CatalogSyncView>> {
  return shaped(await readBody('/api/catalog/sync', signal), parseCatalogSync);
}

/** Odpoveď `POST` — čo urobil TENTO beh, plus stav katalógu po ňom. */
export interface CatalogBatchView extends CatalogRunReportView {
  readonly catalog: CatalogStatusView;
}

/**
 * Načíta ďalšiu dávku katalógu. Jeden `POST` NIE JE celý katalóg — prečíta, čo
 * sa zmestí do rozpočtu čítaní, uloží pokrok a povie, kde skončil. Pokračovanie
 * od poslednej strany je vlastnosť servera, nie tohto volania.
 */
const RUN_OUTCOMES = [
  'already_running',
  'too_soon',
  'peak_hours',
  'writes_first',
  'paused',
  'budget_exhausted',
  'ran',
  'failed',
] as const satisfies readonly CatalogRunOutcomeView[];

export function parseCatalogBatch(raw: unknown): CatalogBatchView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const catalog = parseCatalogStatus(record['catalog']);
  const outcome = readCode(record, 'outcome', RUN_OUTCOMES);
  // Bez rozpoznaného výsledku behu sa nedá povedať, čo sa práve stalo — a to je
  // jediná otázka, na ktorú toto tlačidlo odpovedá.
  if (catalog === null || outcome === null) return null;
  const syncRaw = asRecord(record['sync']);
  return {
    outcome,
    // `null` = beh sa vôbec nerozbehol. Nula stránok je iné tvrdenie.
    sync:
      syncRaw === null
        ? null
        : {
            pages: readCount(syncRaw, 'pages') ?? 0,
            products: readCount(syncRaw, 'products') ?? 0,
          },
    resumeAt: readText(record, 'resumeAt'),
    catalog,
  };
}

export async function runCatalogBatch(signal?: AbortSignal): Promise<Result<CatalogBatchView>> {
  return shaped(await postBody('/api/catalog/sync', signal), parseCatalogBatch);
}

/* ═══════════ 5. Prekážky a stropy — jeden endpoint pre celý obraz ═════════ */

/**
 * Fakty o stave appky aj HOTOVÝ zoznam prekážok z `lib/status/blockers.ts`.
 * Obrazovka Produkty si z neho berie tri veci: účinný strop na jednu zľavu
 * (K1), prekážky okolo katalógu a podklad na prepočet prekážok nad VLASTNÝM
 * výberom (`statusSnapshotFromPayload`). Endpoint je lacný a nevolá shop.
 *
 * Doteraz sa strop čítal z `/api/settings`; dvom zdrojom toho istého čísla sa
 * obrazovka vyhýba zámerne — rozišli by sa v okamihu, keď jeden z nich
 * fail-closed spadne na pilotnú desiatku a druhý nie.
 */
export async function appStatus(signal?: AbortSignal): Promise<Result<StatusPayload>> {
  return shaped(await readBody('/api/status', signal), parseStatusPayload);
}

/* ═════════════ 6. Rozdelenie cien — podklad pre histogram ════════════════ */

/**
 * Odpoveď `GET /api/insights/catalog-prices`.
 *
 * PREČO SA VOLÁ ENDPOINT Z `insights`, A NIE Z `catalog`
 * ------------------------------------------------------
 * Agregácia cien nad `catalog_cache` už existuje (`app/api/insights/_prices.ts`)
 * a šírku aj počet pásiem tam fixujú `PRICE_BIN_WIDTH` / `PRICE_BIN_COUNT`,
 * ktoré si priamo odtiaľ importuje `test/unit/grafy-ceny.spec.ts`. Druhý dotaz
 * pod `/api/catalog/**` by bol DRUHÝ ZDROJ PRAVDY o tom istom čísle — dve
 * rozdelenia tej istej tabuľky, obe dôveryhodné. Preto sa tu žiadny nový
 * endpoint nezakladá.
 *
 * `bins` sa preberajú TAK, AKO PRIŠLI. Prázdne pásmo má nulu zámerne (dotaz
 * prešiel celú tabuľku, takže „nič v tomto pásme" je meraný fakt) a posledné
 * pásmo je ZBERNÉ (`to: null`). Klient ich nedopočítava ani nezlučuje.
 *
 * Odpoveď nesie aj `selection` (ceny POVOLENÝCH produktov) a `today`. Tab
 * Produkty ani jedno nečíta, preto to tu ani nie je v type: značky pod osou
 * majú na tejto obrazovke ukazovať to, čo si používateľ naklikal PRÁVE TERAZ,
 * nie obsah allowlistu — inak by graf odpovedal na inú otázku, než ktorú si
 * pri výbere kladie.
 */
export interface CatalogPricesView {
  readonly bins: ReadonlyArray<{ from: number; to: number | null; count: number }>;
  /** Koľko riadkov má zrkadlo katalógu spolu. */
  readonly rows: number;
  /** Z toho bez ceny — do pásiem nevstupujú a graf ich musí priznať. */
  readonly withoutPrice: number;
  readonly minPrice: number | null;
  readonly maxPrice: number | null;
  readonly oldestFetchedAt: string | null;
  readonly newestFetchedAt: string | null;
}

/**
 * Rozdelenie cien v zrkadle katalógu. Na shop neodíde ani jeden request — je to
 * čisto `SELECT` nad `catalog_cache`, takže volanie nemíňa rozpočet čítaní.
 */
export function parseCatalogPrices(raw: unknown): CatalogPricesView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const binsRaw = record['bins'];
  // Histogram bez pásiem sa nekreslí. Prázdne pole by tvrdilo, že v katalógu
  // nie je ani jedna cena — a to je meraný fakt, nie náhrada za nečitateľnosť.
  if (!Array.isArray(binsRaw)) return null;
  const bins: { from: number; to: number | null; count: number }[] = [];
  for (const entry of binsRaw) {
    const bin = asRecord(entry);
    if (bin === null) continue;
    const from = readNumber(bin, 'from');
    const count = readCount(bin, 'count');
    if (from === null || count === null) continue;
    // Posledné pásmo je ZBERNÉ (`to: null`) — chýbajúca horná hranica je
    // súčasť tvaru, nie chyba.
    bins.push({ from, to: readNumber(bin, 'to'), count });
  }
  return {
    bins,
    rows: readCount(record, 'rows') ?? 0,
    withoutPrice: readCount(record, 'withoutPrice') ?? 0,
    minPrice: readNumber(record, 'minPrice'),
    maxPrice: readNumber(record, 'maxPrice'),
    oldestFetchedAt: readText(record, 'oldestFetchedAt'),
    newestFetchedAt: readText(record, 'newestFetchedAt'),
  };
}

export async function catalogPrices(signal?: AbortSignal): Promise<Result<CatalogPricesView>> {
  return shaped(await readBody('/api/insights/catalog-prices', signal), parseCatalogPrices);
}

/* ═════════ 8. KPI riadkov (kontrakt V4 D114, D117–D119; I11) ══════════════ */

/**
 * KPI JEDNEJ STRÁNKY TABUĽKY, JEDNÝM DOTAZOM.
 *
 * `GET /api/insights/product-kpi?ids=…` vráti pre až sto ID naraz to, čo D114
 * menuje: predané kusy za krátke a dlhé okno, obrátkovosť, posledný predaj,
 * cenu, aktívnu zľavu podľa SHOPU a maržu. Jeden dotaz na stránku — nie sto
 * dotazov po jednom; to by pri stránkovaní po 100 bolo N+1, ktoré kontrakt V4
 * výslovne zakazuje.
 *
 * TRI STAVY KAŽDÉHO ČÍSLA SEM PRICHÁDZAJÚ HOTOVÉ (I11)
 * ────────────────────────────────────────────────────
 * `KpiValueView.gap` nesie DÔVOD, prečo hodnota nie je: `not_enriched`
 * (`getFull` sa na produkt nikdy nepýtalo — D118), `shop_has_none` (pýtalo sa a
 * shop o poli nič nevie), `days_missing` (okno nie je stiahnuté — D119),
 * `not_computable` (pomer, ktorého menovateľ je nula). Klient ich NEZLIEVA do
 * nuly ani do prázdna: hodnota a dôvod idú spolu až do bunky
 * (`sold-coverage.ts`), pretože z holého `null` sa `?? 0` spraví v jednom
 * riadku kódu.
 *
 * NEZNÁMY DÔVOD SA NEPREPOSIELA
 * ─────────────────────────────
 * `gap` je uzavretý zoznam. Kód, ktorý appka nepozná, spadne na `null` a
 * hodnota zostane `null` — bunka teda povie „nevieme" bez dôvodu, nikdy nie
 * číslo. Fail-closed je tu jediná bezpečná strana: vymyslený dôvod by z medzery
 * urobil vetu, ktorú nikto nemeral.
 */
export const KPI_GAPS = [
  'not_enriched',
  'shop_has_none',
  'days_missing',
  'not_computable',
] as const;

export type KpiGapCode = (typeof KPI_GAPS)[number];

/** Jedno KPI: hodnota, alebo dôvod, prečo ju nemáme. */
export interface KpiValueView<T> {
  readonly value: T | null;
  readonly gap: KpiGapCode | null;
}

/** Stav zľavy PODĽA SHOPU (nie podľa našich zápisov — sú to dve rôzne vety). */
export const KPI_DISCOUNT_STATES = ['running', 'scheduled', 'ended', 'none', 'unknown'] as const;

export type KpiDiscountStateCode = (typeof KPI_DISCOUNT_STATES)[number];

export interface KpiDiscountView {
  readonly state: KpiDiscountStateCode;
  /** % zľavy, ktorá v posudzovaný deň NAOZAJ beží. Mimo `running` vždy prázdne. */
  readonly activePercent: KpiValueView<number>;
  readonly from: string | null;
  readonly to: string | null;
  /** Kedy sa stav zmeral (`enriched_at`); `null` = produkt nie je obohatený. */
  readonly measuredAt: string | null;
}

/** Predané kusy za okno a to, koľko dní okna appka NEMÁ (D119). */
export interface KpiWindowUnitsView {
  readonly windowDays: number;
  readonly completeDays: number;
  readonly unknownDays: number;
  readonly units: KpiValueView<number>;
  /** `true` ⇔ `units.value` je len DOLNÁ HRANICA. */
  readonly lowerBound: boolean;
}

/** Čím je značka „bez predaja" DOKÁZANÁ. Bez dôkazu značka nevzniká (D119). */
export const KPI_NO_SALE_PROOFS = ['shop_never_ordered', 'no_sale_in_covered_days'] as const;

export type KpiNoSaleProofCode = (typeof KPI_NO_SALE_PROOFS)[number];

export interface KpiNoSaleView {
  readonly mark: boolean;
  /** `null` ⇔ značka nevzniká. NEOBOHATENÝ PRODUKT NIE JE MŔTVY PRODUKT. */
  readonly proof: KpiNoSaleProofCode | null;
}

export interface ProductKpiRowView {
  readonly productId: number;
  /** `true` = zrkadlo katalógu tento produkt vôbec nemá. */
  readonly missing: boolean;
  readonly reference: KpiValueView<string>;
  readonly supplier: KpiValueView<string>;
  readonly priceWithVat: KpiValueView<number>;
  /** Marža v EUR TAK, AKO JU POSLAL SHOP. Nikdy dopočítaná (D117). */
  readonly margin: KpiValueView<number>;
  /** Marža v % TAK, AKO JU POSLAL SHOP. Nikdy dopočítaná (D117). */
  readonly marginPercent: KpiValueView<number>;
  readonly discount: KpiDiscountView;
  readonly stock: KpiValueView<number>;
  /** Celkovo predané za celú históriu (`qty_in_orders`, D119). */
  readonly soldTotal: KpiValueView<number>;
  readonly lastSaleAt: KpiValueView<string>;
  readonly daysSinceLastSale: KpiValueView<number>;
  /** Koľkokrát sa AKTUÁLNA zásoba už predala. NIE je to účtovná obrátkovosť. */
  readonly soldPerStock: KpiValueView<number>;
  readonly units30: KpiWindowUnitsView;
  readonly units90: KpiWindowUnitsView;
  readonly noSale: KpiNoSaleView;
  /** `null` = produkt NIE JE obohatený (I11). */
  readonly enrichedAt: string | null;
}

export interface ProductKpiPageView {
  readonly today: string | null;
  /** Dĺžky okien tak, ako ich POVEDALA odpoveď — nie ako ich chcela obrazovka. */
  readonly shortWindowDays: number;
  readonly longWindowDays: number;
  readonly byId: ReadonlyMap<number, ProductKpiRowView>;
}

/**
 * Strop route (`MAX_KPI_IDS`). Je tu druhýkrát zámerne: keby klient poslal
 * dlhší zoznam, route by odpovedala 400 a CELÁ stránka by ostala bez KPI.
 * `PER_PAGE_CHOICES` je preto zhora zarovnané na toto číslo.
 */
export const KPI_IDS_PER_REQUEST = 100;

function parseKpiNumber(source: unknown): KpiValueView<number> {
  const record = asRecord(source);
  if (record === null) return { value: null, gap: null };
  return { value: readNumber(record, 'value'), gap: readCode(record, 'gap', KPI_GAPS) };
}

function parseKpiText(source: unknown): KpiValueView<string> {
  const record = asRecord(source);
  if (record === null) return { value: null, gap: null };
  return { value: readText(record, 'value'), gap: readCode(record, 'gap', KPI_GAPS) };
}

/**
 * Okno predajov. Nečitateľné okno je MEDZERA, nie plné pokrytie: `unknownDays`
 * padá na celú dĺžku okna, takže bunka povie „nevieme", nie nulu.
 */
function parseKpiWindow(source: unknown, fallbackDays: number): KpiWindowUnitsView {
  const record = asRecord(source);
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

function parseKpiDiscount(source: unknown): KpiDiscountView {
  const record = asRecord(source);
  if (record === null) {
    return {
      state: 'unknown',
      activePercent: { value: null, gap: null },
      from: null,
      to: null,
      measuredAt: null,
    };
  }
  return {
    // Neznámy stav je `unknown`, teda „nevieme" — nikdy „žiadna zľava nebeží".
    state: readCode(record, 'state', KPI_DISCOUNT_STATES) ?? 'unknown',
    activePercent: parseKpiNumber(record['activePercent']),
    from: readText(record, 'from'),
    to: readText(record, 'to'),
    measuredAt: readText(record, 'measuredAt'),
  };
}

/**
 * Značka „bez predaja". `mark` bez `proof` sa zahodí: značka je tvrdenie o tom,
 * že sa produkt nepredáva, a bez dôkazu ho appka povedať nesmie (D119).
 */
function parseKpiNoSale(source: unknown): KpiNoSaleView {
  const record = asRecord(source);
  if (record === null) return { mark: false, proof: null };
  const proof = readCode(record, 'proof', KPI_NO_SALE_PROOFS);
  const mark = readFlag(record, 'mark');
  if (!mark || proof === null) return { mark: false, proof: null };
  return { mark: true, proof };
}

function parseProductKpiRow(raw: unknown): ProductKpiRowView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const productId = readCount(record, 'productId');
  // Bez ID sa riadok nedá pripojiť k produktu — pripojiť ho „nejako" by
  // znamenalo napísať cudzie čísla do cudzieho riadku.
  if (productId === null) return null;
  return {
    productId,
    missing: readFlag(record, 'missing'),
    reference: parseKpiText(record['reference']),
    supplier: parseKpiText(record['supplier']),
    priceWithVat: parseKpiNumber(record['priceWithVat']),
    margin: parseKpiNumber(record['margin']),
    marginPercent: parseKpiNumber(record['marginPercent']),
    discount: parseKpiDiscount(record['discount']),
    stock: parseKpiNumber(record['stock']),
    soldTotal: parseKpiNumber(record['soldTotal']),
    lastSaleAt: parseKpiText(record['lastSaleAt']),
    daysSinceLastSale: parseKpiNumber(record['daysSinceLastSale']),
    soldPerStock: parseKpiNumber(record['soldPerStock']),
    units30: parseKpiWindow(record['units30'], 30),
    units90: parseKpiWindow(record['units90'], 90),
    noSale: parseKpiNoSale(record['noSale']),
    enrichedAt: readText(record, 'enrichedAt'),
  };
}

export function parseProductKpiPage(raw: unknown): ProductKpiPageView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const rowsRaw = record['rows'];
  // Odpoveď bez poľa riadkov je NEČITATEĽNÁ, nie prázdna stránka. Prázdna mapa
  // by znamenala „o žiadnom produkte nič nevieme", a to je tvrdenie.
  if (!Array.isArray(rowsRaw)) return null;
  const byId = new Map<number, ProductKpiRowView>();
  for (const entry of rowsRaw) {
    const row = parseProductKpiRow(entry);
    if (row === null) continue;
    byId.set(row.productId, row);
  }
  const window30 = asRecord(record['window30']);
  const window90 = asRecord(record['window90']);
  return {
    today: readText(record, 'today'),
    shortWindowDays: window30 === null ? 30 : (readCount(window30, 'windowDays') ?? 30),
    longWindowDays: window90 === null ? 90 : (readCount(window90, 'windowDays') ?? 90),
    byId,
  };
}

/**
 * KPI pre práve zobrazenú stránku. Čisto čítacie — `/api/insights/*` nesiaha na
 * shop (K8), takže volanie nemíňa ani rozpočet čítaní, ani kvótu kľúča.
 *
 * Dlhší zoznam než `KPI_IDS_PER_REQUEST` sa NEODREŽE. Odrezaná stránka by
 * vyzerala presne ako stránka, o ktorej appka nič nevie, a tie dve veci sa
 * rozlíšiť musia.
 */
export async function fetchProductKpis(
  productIds: readonly number[],
  signal?: AbortSignal,
): Promise<Result<ProductKpiPageView>> {
  if (productIds.length === 0) {
    return {
      ok: true,
      data: { today: null, shortWindowDays: 30, longWindowDays: 90, byId: new Map() },
    };
  }
  if (productIds.length > KPI_IDS_PER_REQUEST) {
    return {
      ok: false,
      error: {
        code: 'kpi_page_too_large',
        message: `KPI sa dajú načítať pre najviac ${KPI_IDS_PER_REQUEST} riadkov na jeden dotaz.`,
      },
    };
  }
  const params = new URLSearchParams({ ids: productIds.join(',') });
  return shaped(
    await readBody(`/api/insights/product-kpi?${params.toString()}`, signal),
    parseProductKpiPage,
  );
}
