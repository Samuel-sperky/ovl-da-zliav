'use client';

/**
 * Aura Zľavy — ČÍTANIE A ZÁPIS TABU ZĽAVY (V11; kontrakt V3 K2–K8, I3, I11).
 *
 * Tenká vrstva nad endpointmi, ktoré tab Zľavy potrebuje:
 *
 *   `GET  /api/campaigns`            — zoznam zliav, pásma, odhad, rozpočet,
 *   `GET  /api/campaigns/[id]`       — detail: pásma, položky, audit stopa,
 *   `GET  /api/catalog/search`       — z čoho sa výber skladá (K7, K8),
 *   `POST /api/campaigns/preview`    — skúška naprázdno; jediný zdroj tokenu (I3),
 *   `POST /api/campaigns`            — zaradenie do fronty (token z dry-runu,
 *                                      I3; sudo z D70 zrušila D100 27. 8. 2026),
 *   `GET  /api/queue`                — ŽIVÝ stav fronty, rozpočtu a prekážok,
 *   `GET  /api/status`               — celý obraz stavu appky + prekážky,
 *   `GET  /api/campaigns/[id]/retry-failed` — popis toho, čo by zopakovanie urobilo.
 *
 * Posledné tri sú neskorší prírastok a majú spoločné jedno: ich odpoveď sa
 * NEBERIE naslepo. Parsovanie žije v `queue-model.ts` (čisté, testovateľné) a
 * čokoľvek, čo nesedí, skončí ako chyba obálky — nie ako prázdna fronta. Nula
 * čakajúcich položiek je tvrdenie a to sa z neznalosti povedať nesmie (P7).
 *
 * Pravidlá, ktoré tento modul drží:
 *
 *  · **Čo sa nedá prečítať, je `null`** — nikdy nula. Nula na obrazovke appky,
 *    ktorá zapisuje do produkčného eshopu, je tvrdenie, nie medzera (P7).
 *  · **Token je jediná cesta k zápisu.** `createDiscount()` nemá parameter,
 *    ktorý by sa dal zavolať bez `previewToken` — I3 nie je voliteľné.
 *  · Porovnáva sa explicitne (`=== null`, `typeof … !== 'number'`): Turbopack
 *    tu už raz vyhodnotil `if (!row)` ako compile-time falsy (pasca z CLAUDE.md).
 *
 * `getJson`/`postJson` a `Envelope` sa preberajú z `campaigns/api.ts` — je to
 * ten istý priečinok a duplikovať obálku odpovede by znamenalo dve miesta,
 * kde sa dá pokaziť spracovanie chyby.
 *
 * Vlastník: V11.
 */
import type { ApiError, Envelope } from '@/components/campaigns/api';
import { getJson, postJson } from '@/components/campaigns/api';
import {
  parseQueueSnapshot,
  parseRetryPlan,
  type QueueSnapshotView,
  type RetryPlanView,
} from '@/components/campaigns/queue-model';
import {
  asRecord,
  readCount,
  readFlag,
  readText,
  type JsonRecord,
} from '@/components/dashboard/json';
import { parseStatusPayload } from '@/components/dashboard/status-payload';
import {
  catalogSearchParams,
  type CatalogFilterState,
} from '@/components/products/catalog-filter';
import type { StatusPayload } from '@/lib/status/snapshot';

export type { ApiError, Envelope };
export type { QueueSnapshotView, RetryPlanView, StatusPayload };

/* ═══════════════════════════ 1. Zoznam zliav ══════════════════════════════ */

/** Pásmo zľavy (K3). `rule` je LEN na zobrazenie, nikdy na vyhodnocovanie. */
export interface TierView {
  readonly ord: number;
  readonly label: string;
  readonly percent: number;
  readonly itemsCount: number;
  readonly rule?: unknown;
}

/** Odhad dobehnutia fronty (K5) — na povrchu vždy so `≈` (P7). */
export interface EstimateView {
  readonly pending: number;
  readonly perDay: number;
  readonly days: number;
  readonly date: string;
}

/** Denný rozpočet zápisov (K2). Spotreba sa počíta výhradne z auditu. */
export interface BudgetView {
  readonly day: string;
  readonly budget: number;
  readonly spent: number;
  readonly remaining: number;
}

export interface DiscountRow {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly statusReason: string | null;
  readonly percent: number;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly mode: string;
  readonly itemsTotal: number;
  readonly itemsOk: number;
  readonly itemsFailed: number;
  readonly itemsUncertain: number;
  readonly itemsPending: number;
  readonly late: boolean;
  readonly createdAt: string;
  readonly tiers: readonly TierView[];
  readonly estimate: EstimateView | null;
}

export interface DiscountsPage {
  readonly data: readonly DiscountRow[];
  readonly total: number;
  readonly budget: BudgetView | null;
}

/* ═══════════════════════════ 2. Detail zľavy ══════════════════════════════ */

export interface DiscountItemView {
  readonly id: number;
  readonly productId: number;
  readonly position: number;
  readonly status: string;
  readonly percent?: number;
  readonly nameAtWrite: string | null;
  readonly priceAtPreview: string | null;
  readonly priceAtWrite: string | null;
  readonly priceMismatch: boolean;
  readonly hasAttributes: boolean;
  readonly attemptCount: number;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly finishedAt: string | null;
}

export interface AuditRowView {
  readonly id: number;
  readonly ts: string;
  readonly actor: string;
  readonly eventType: string;
  readonly ok: boolean | null;
  readonly productId: number | null;
  readonly httpStatus: number | null;
  readonly message: string | null;
}

export interface DiscountDetailData {
  readonly campaign: DiscountRow;
  readonly tiers: readonly TierView[];
  readonly estimate: EstimateView | null;
  readonly items: readonly DiscountItemView[];
  readonly itemsTotal: number;
  readonly auditTrail: readonly AuditRowView[];
}

/* ═══════════════════════ 3. Skúška naprázdno (I3) ═════════════════════════ */

/** Položka náhľadu — percento nesie POLOŽKA, nie zľava (K3). */
export interface PreviewItemView {
  readonly productId: number;
  readonly name: string | null;
  readonly price: string | null;
  readonly discountedPrice: string | null;
  readonly percent?: number;
  readonly tierLabel?: string;
  readonly hasAttributes: boolean;
  readonly warnings: readonly string[];
}

export interface PreviewBlockerView {
  readonly code: string;
  readonly message: string;
  readonly productId?: number;
}

export interface PreviewData {
  /** Jednorazový podpísaný nosič potvrdenia. Bez neho neexistuje zápis (I3). */
  readonly previewToken: string;
  readonly items: readonly PreviewItemView[];
  readonly sample: readonly PreviewItemView[];
  readonly tiers: readonly { ord: number; label: string; percent: number; count: number }[];
  readonly itemsTotal: number;
  readonly itemsTruncated: boolean;
  readonly priceSource: 'shop' | 'catalog' | 'none';
  readonly dataAsOf: string | null;
  readonly blockers: readonly PreviewBlockerView[];
  readonly warnings: {
    readonly keyExpiresBeforeStart: boolean;
    readonly oneDayWindow: boolean;
    readonly overwrite: readonly number[];
    readonly hasAttributes: readonly number[];
  };
  readonly keyExpiresAt: string | null;
  readonly keyMissing: boolean;
}

export interface PreviewRequest {
  readonly productIds: readonly number[];
  readonly percent: number;
  readonly from: string;
  readonly to: string;
  readonly kind: 'new' | 'overwrite' | 'retry' | 'extend';
  readonly tiers?: readonly {
    ord: number;
    label: string;
    percent: number;
    productIds: readonly number[];
  }[];
  readonly parentCampaignId?: number;
  readonly oneDayAcknowledged?: boolean;
}

export interface CreateRequest {
  readonly previewToken: string;
  readonly name: string;
  readonly mode: 'eager' | 'scheduled';
  readonly tiers?: readonly {
    ord: number;
    label: string;
    percent: number;
    rule?: unknown;
    itemsCount?: number;
  }[];
  readonly acknowledgements: { irreversible: true; oneDay?: true };
}

export interface CreateResult {
  readonly campaignId: number;
  readonly status: string;
  readonly itemsTotal: number;
  readonly estimate: EstimateView | null;
  /** K6 — kľúč na zápis vyprší skôr, než fronta dobehne. Nie je to brzda. */
  readonly keyExpiresBeforeFinish?: boolean;
}

/* ═══════════════════════════ 4. Katalóg a kľúč ════════════════════════════ */

export interface CatalogRowView {
  readonly productId: number;
  readonly name: string | null;
  readonly price: string | null;
  readonly unitsSold: number;
  readonly everDiscounted: boolean;
  readonly discountedNow: boolean;
  readonly shopStatus: string;
}

export interface CatalogPageView {
  readonly data: readonly CatalogRowView[];
  readonly page: number;
  readonly perPage: number;
  readonly total: number;
  readonly soldWindowDays: number;
  readonly catalogTotal: number;
  /** P7 — meraný čas posledného načítania katalógu; `null` = prázdny katalóg. */
  readonly dataAsOf: string | null;
  readonly counts: {
    readonly total: number;
    readonly sold: Readonly<Record<string, number>>;
    readonly discountedNow: number;
  } | null;
}

/** Metadáta kľúča na zápis (D65, I1) — nikdy samotný kľúč. */
export interface KeyMetaView {
  readonly present: boolean;
  readonly expiresAt: string | null;
  readonly secondsLeft: number | null;
}

/** K1 — účinný strop produktov na jednu zľavu a denný rozpočet. */
export interface ScopeView {
  readonly maxProducts: number;
  readonly dailyWriteBudget: number;
  readonly scopeFailClosed: boolean;
  readonly writesLocked: boolean;
}

/* ═════════════════ 5. Overenie tvaru odpovede (nie pretypovanie) ══════════ */

/*
 * TU SA NEPRETYPOVÁVA. Do 24. 8. 2026 väčšina volaní nižšie robila
 * `getJson<DiscountRow[]>(…)` — celá odpoveď sa jedným `as` stala „overenou",
 * hoci ju neprečítal nikto. Práve tadiaľto prišiel kód stavu `writing`, ktorý
 * zhodil celý tab Zľavy na bielu stránku.
 *
 * Vzor je ten istý, ktorý tu už dávno používajú `fetchQueue()` a `retryPlan()`
 * a ktorý drží aj Prehľad (`dashboard/api.ts`, `dashboard/status-api.ts`):
 * surové telo → `parse*()` → hotový pohľad, a čo sa prečítať nedá, je chyba
 * obálky. Primitíva (`asRecord`, `readCount`, `readText`, …) sa NEPÍŠU znovu,
 * berú sa z `dashboard/json.ts` — druhá kópia tých istých piatich funkcií by sa
 * o mesiac rozišla s prvou a jedna obrazovka by začala čítať voľnejšie.
 */

/** Nečitateľné telo → chyba obálky. Prázdny pohľad je tvrdenie, nie medzera. */
function shaped<T>(
  res: Envelope<unknown>,
  parse: (raw: unknown) => T | null,
  sentence: string,
): Envelope<T> {
  if (!res.ok) return res;
  const data = parse(res.data);
  if (data === null) return { ok: false, error: { code: 'shape', message: sentence } };
  return { ok: true, data };
}

/** Pásmo (K3). `rule` sa preberá tak, ako prišlo — je LEN na zobrazenie. */
function parseTier(raw: unknown): TierView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const ord = readCount(record, 'ord');
  const percent = readCount(record, 'percent');
  if (ord === null || percent === null) return null;
  return {
    ord,
    label: readText(record, 'label') ?? '',
    percent,
    itemsCount: readCount(record, 'itemsCount') ?? 0,
    ...(record['rule'] === undefined ? {} : { rule: record['rule'] }),
  };
}

function parseTiers(raw: unknown): TierView[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseTier).filter((tier): tier is TierView => tier !== null);
}

/** Odhad dobehnutia. Bez dátumu odhad neexistuje — nedopočítava sa (P7). */
function parseEstimate(raw: unknown): EstimateView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const date = readText(record, 'date');
  if (date === null) return null;
  return {
    date,
    pending: readCount(record, 'pending') ?? 0,
    perDay: readCount(record, 'perDay') ?? 0,
    days: readCount(record, 'days') ?? 0,
  };
}

/** Denný rozpočet. Nulový strop nie je rozpočet, je to nečitateľná odpoveď. */
function parseBudget(raw: unknown): BudgetView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const budget = readCount(record, 'budget');
  const spent = readCount(record, 'spent');
  const remaining = readCount(record, 'remaining');
  if (budget === null || budget <= 0 || spent === null || remaining === null) return null;
  return { day: readText(record, 'day') ?? '', budget, spent, remaining };
}

/**
 * Riadok zoznamu zliav.
 *
 * `status` sa preberá SUROVÝ a je to zámer: kód prekladá slovník
 * (`lib/ui/vocabulary.ts`), ktorý neznámu hodnotu ošetrí sám a prizná ju
 * príznakom. Keby sa tu zahodil alebo nahradil, obrazovka by o zľave tvrdila
 * niečo, čo z odpovede nevyplýva. Bez `id` a `name` sa riadok zahadzuje — nedá
 * sa otvoriť ani pomenovať.
 */
export function parseDiscountRow(raw: unknown): DiscountRow | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = readCount(record, 'id');
  const name = readText(record, 'name');
  const status = readText(record, 'status');
  if (id === null || name === null || status === null) return null;

  const itemsTotal = readCount(record, 'itemsTotal') ?? 0;
  const itemsOk = readCount(record, 'itemsOk') ?? 0;
  const itemsFailed = readCount(record, 'itemsFailed') ?? 0;
  const itemsUncertain = readCount(record, 'itemsUncertain') ?? 0;

  return {
    id,
    name,
    status,
    statusReason: readText(record, 'statusReason'),
    percent: readCount(record, 'percent') ?? 0,
    dateFrom: readText(record, 'dateFrom') ?? '',
    dateTo: readText(record, 'dateTo') ?? '',
    mode: readText(record, 'mode') ?? '',
    itemsTotal,
    itemsOk,
    itemsFailed,
    itemsUncertain,
    itemsPending:
      readCount(record, 'itemsPending') ??
      Math.max(0, itemsTotal - itemsOk - itemsFailed - itemsUncertain),
    late: readFlag(record, 'late'),
    createdAt: readText(record, 'createdAt') ?? '',
    tiers: parseTiers(record['tiers']),
    estimate: parseEstimate(record['estimate']),
  };
}

export function parseDiscountsPage(raw: unknown): DiscountsPage | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const rows = record['data'];
  // Prázdny zoznam znamená „žiadna zľava neexistuje" a otvára prázdny stav
  // s výzvou založiť prvú. Z nečitateľnej odpovede sa to povedať nesmie.
  if (!Array.isArray(rows)) return null;
  const data = rows.map(parseDiscountRow).filter((row): row is DiscountRow => row !== null);
  return {
    data,
    total: readCount(record, 'total') ?? data.length,
    budget: parseBudget(record['budget']),
  };
}

/**
 * Položka detailu. `status` opäť surový — vetu z neho skladá `itemSentence()`
 * v slovníku a ten neznámy kód rieši sám.
 */
function parseDiscountItem(raw: unknown): DiscountItemView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = readCount(record, 'id');
  const productId = readCount(record, 'productId');
  if (id === null || productId === null) return null;
  const percent = readCount(record, 'percent');
  return {
    id,
    productId,
    position: readCount(record, 'position') ?? 0,
    status: readText(record, 'status') ?? '',
    ...(percent === null ? {} : { percent }),
    nameAtWrite: readText(record, 'nameAtWrite'),
    priceAtPreview: readText(record, 'priceAtPreview'),
    priceAtWrite: readText(record, 'priceAtWrite'),
    priceMismatch: readFlag(record, 'priceMismatch'),
    hasAttributes: readFlag(record, 'hasAttributes'),
    attemptCount: readCount(record, 'attemptCount') ?? 0,
    // `null` = odpoveď shopu nemáme. Nula by bola vymyslený HTTP status.
    httpStatus: readCount(record, 'httpStatus'),
    errorCode: readText(record, 'errorCode'),
    errorMessage: readText(record, 'errorMessage'),
    finishedAt: readText(record, 'finishedAt'),
  };
}

function parseAuditRow(raw: unknown): AuditRowView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = readCount(record, 'id');
  const ts = readText(record, 'ts');
  if (id === null || ts === null) return null;
  const ok = record['ok'];
  return {
    id,
    ts,
    actor: readText(record, 'actor') ?? '',
    eventType: readText(record, 'eventType') ?? '',
    // Tri stavy: podarilo sa, nepodarilo sa, nevieme. `null` nie je „nie".
    ok: typeof ok === 'boolean' ? ok : null,
    productId: readCount(record, 'productId'),
    httpStatus: readCount(record, 'httpStatus'),
    message: readText(record, 'message'),
  };
}

export function parseDiscountDetail(raw: unknown): DiscountDetailData | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const campaign = parseDiscountRow(record['campaign']);
  if (campaign === null) return null;
  const itemsRaw = record['items'];
  const items = Array.isArray(itemsRaw)
    ? itemsRaw.map(parseDiscountItem).filter((item): item is DiscountItemView => item !== null)
    : [];
  const auditRaw = record['auditTrail'];
  return {
    campaign,
    tiers: parseTiers(record['tiers']),
    estimate: parseEstimate(record['estimate']),
    items,
    // Detail zobrazuje len prvých `itemsLimit` položiek — celkový počet preto
    // radšej zo zľavy než z dĺžky poľa, inak by tabuľka tvrdila menej.
    itemsTotal: readCount(record, 'itemsTotal') ?? campaign.itemsTotal,
    auditTrail: Array.isArray(auditRaw)
      ? auditRaw.map(parseAuditRow).filter((row): row is AuditRowView => row !== null)
      : [],
  };
}

function parseCatalogRow(raw: unknown): CatalogRowView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const productId = readCount(record, 'productId');
  if (productId === null) return null;
  return {
    productId,
    name: readText(record, 'name'),
    price: readText(record, 'price'),
    unitsSold: readCount(record, 'unitsSold') ?? 0,
    everDiscounted: readFlag(record, 'everDiscounted'),
    discountedNow: readFlag(record, 'discountedNow'),
    // Fail-closed: netvrdíme, že shop produkt pozná, kým to nepovie.
    shopStatus: readText(record, 'shopStatus') ?? 'unknown',
  };
}

/** Počty nad výsledkom hľadania; nečitateľné počty sú `null`, nie nuly (P7). */
function parseCatalogCounts(raw: unknown): CatalogPageView['counts'] {
  const record = asRecord(raw);
  if (record === null) return null;
  const total = readCount(record, 'total');
  if (total === null) return null;
  const soldRaw = asRecord(record['sold']);
  const sold: Record<string, number> = {};
  if (soldRaw !== null) {
    for (const key of Object.keys(soldRaw)) {
      const value = readCount(soldRaw, key);
      if (value !== null) sold[key] = value;
    }
  }
  return { total, sold, discountedNow: readCount(record, 'discountedNow') ?? 0 };
}

export function parseCatalogPage(raw: unknown): CatalogPageView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const rows = record['data'];
  if (!Array.isArray(rows)) return null;
  return {
    data: rows.map(parseCatalogRow).filter((row): row is CatalogRowView => row !== null),
    page: readCount(record, 'page') ?? 1,
    perPage: readCount(record, 'perPage') ?? 0,
    total: readCount(record, 'total') ?? 0,
    soldWindowDays: readCount(record, 'soldWindowDays') ?? 0,
    catalogTotal: readCount(record, 'catalogTotal') ?? 0,
    dataAsOf: readText(record, 'dataAsOf'),
    counts: parseCatalogCounts(record['counts']),
  };
}

export function parseKeyMeta(raw: unknown): KeyMetaView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  return {
    // Fail-closed: kým odpoveď nepovie, že kľúč JE, appka tvrdí, že nie je.
    present: readFlag(record, 'present'),
    expiresAt: readText(record, 'expiresAt'),
    secondsLeft: readCount(record, 'secondsLeft'),
  };
}

/**
 * K1 — strop a rozpočet. Bez oboch čísel sa vráti `null` a sprievodca to
 * PRIZNÁ: strop, ktorý si obrazovka vymyslí, pustí do fronty viac produktov,
 * než smie, a to sa v produkčnom eshope nedá vrátiť späť.
 */
export function parseScope(raw: unknown): ScopeView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const maxProducts = readCount(record, 'maxProducts');
  const dailyWriteBudget = readCount(record, 'dailyWriteBudget');
  if (maxProducts === null || dailyWriteBudget === null) return null;
  return {
    maxProducts,
    dailyWriteBudget,
    // Fail-closed: kým sa nedozvieme opak, čísla rozsahu sú domnienka.
    scopeFailClosed: record['scopeFailClosed'] !== false,
    writesLocked: readFlag(record, 'writesLocked'),
  };
}

function parsePerformanceWindow(raw: JsonRecord | null): PerformanceWindow {
  if (raw === null) return { from: '', to: '', units: null };
  return {
    from: readText(raw, 'from') ?? '',
    to: readText(raw, 'to') ?? '',
    // `null` = za toto obdobie nemáme dáta. NIE JE to nula predaných kusov.
    units: readCount(raw, 'units'),
  };
}

export function parsePerformance(raw: unknown): PerformanceView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const coverage = asRecord(record['coverage']);
  const locked = asRecord(record['locked']);
  return {
    available: readFlag(record, 'available'),
    // Chýbajúce `started` = staršia odpoveď; nepredstierame priznanie, ktoré
    // server neposlal, ale ani neblokujeme sekciu, ktorá fungovala.
    started: record['started'] === undefined ? true : readFlag(record, 'started'),
    startsOn: readText(record, 'startsOn'),
    unit: 'ks',
    spanDays: readCount(record, 'spanDays') ?? 0,
    recent: parsePerformanceWindow(asRecord(record['recent'])),
    prior: parsePerformanceWindow(asRecord(record['prior'])),
    coverage: {
      from: coverage === null ? null : readText(coverage, 'from'),
      to: coverage === null ? null : readText(coverage, 'to'),
      syncEnabled: coverage !== null && readFlag(coverage, 'syncEnabled'),
    },
    locked: {
      revenue: locked === null ? '' : (readText(locked, 'revenue') ?? ''),
      lastYear: locked === null ? '' : (readText(locked, 'lastYear') ?? ''),
    },
  };
}

/* ═══════════════════════════ 6. Volania ═══════════════════════════════════ */

/** Zoznam zliav aj s pásmami, odhadom a rozpočtom. */
export async function listDiscounts(perPage = 50): Promise<Envelope<DiscountsPage>> {
  return shaped(
    await getJson<unknown>(`/api/campaigns?perPage=${perPage}`),
    parseDiscountsPage,
    'Zoznam zliav sa nepodarilo prečítať.',
  );
}

export async function getDiscount(
  id: number,
  itemsLimit = 200,
): Promise<Envelope<DiscountDetailData>> {
  return shaped(
    await getJson<unknown>(`/api/campaigns/${id}?itemsLimit=${itemsLimit}`),
    parseDiscountDetail,
    'Detail zľavy sa nepodarilo prečítať.',
  );
}

/** Zastavenie fronty — zapísané zľavy v shope ZOSTÁVAJÚ (I7, D35). */
export function stopDiscountQueue(id: number, reason: string): Promise<Envelope<unknown>> {
  return postJson(`/api/campaigns/${id}/cancel`, { reason });
}

/** Skúška naprázdno. NIKDY nič nezapisuje — všetky volania shopu sú čítacie. */
export function previewDiscount(body: PreviewRequest): Promise<Envelope<PreviewData>> {
  return postJson<PreviewData>('/api/campaigns/preview', body);
}

/** Zaradenie do fronty. Bez `previewToken` sa cesta k zápisu nedá zavolať (I3). */
export function createDiscount(body: CreateRequest): Promise<Envelope<CreateResult>> {
  return postJson<CreateResult>('/api/campaigns', body);
}

/** Opakovanie toho, čo sa nepodarilo — vždy s NOVÝM tokenom (D16, I3). */
export function retryFailed(
  id: number,
  previewToken: string,
): Promise<Envelope<{ campaignId: number }>> {
  return postJson<{ campaignId: number }>(`/api/campaigns/${id}/retry-failed`, { previewToken });
}

/**
 * POPIS toho, čo by zopakovanie urobilo — čisto čítacie, nič nezapisuje a
 * žiadny token nevydáva.
 *
 * Existuje preto, že samotný `POST` sa bez čerstvého potvrdenia odmietne (I3,
 * D16) a odmietnutie bez vysvetlenia je na povrchu neprijateľné. Táto odpoveď
 * nesie sadu produktov, jej rozpad na „nezapísalo sa" a „nevieme, či sa
 * zapísalo" (D45), okno opravnej zľavy a vetu s ďalším krokom.
 */
export async function retryPlan(id: number): Promise<Envelope<RetryPlanView>> {
  const res = await getJson<unknown>(`/api/campaigns/${id}/retry-failed`);
  if (!res.ok) return res;
  const plan = parseRetryPlan(res.data);
  if (plan === null) {
    return {
      ok: false,
      error: { code: 'shape', message: 'Popis opakovania sa nepodarilo prečítať.' },
    };
  }
  return { ok: true, data: plan };
}

/* ═════════════ 7. Živý stav fronty a celý obraz stavu appky ═══════════════ */

/**
 * `GET /api/queue` — kde je fronta, koľko rozpočtu ostáva, čo bude zajtra a
 * prečo to prípadne stojí. Lacný, čisto čítací endpoint; volá sa aj periodicky.
 *
 * Nečitateľná odpoveď končí ako chyba obálky, NIE ako prázdna fronta: nula
 * čakajúcich položiek je tvrdenie a to sa z neznalosti povedať nesmie (P7).
 */
export async function fetchQueue(): Promise<Envelope<QueueSnapshotView>> {
  const res = await getJson<unknown>('/api/queue');
  if (!res.ok) return res;
  const snapshot = parseQueueSnapshot(res.data);
  if (snapshot === null) {
    return {
      ok: false,
      error: { code: 'shape', message: 'Stav fronty sa nepodarilo prečítať.' },
    };
  }
  return { ok: true, data: snapshot };
}

/**
 * `GET /api/status` — fakty o stave appky plus hotový zoznam prekážok pre
 * PRÁZDNY výber. Obrazovka s výberom si prekážky prepočíta nad vlastnou sadou
 * cez `statusSnapshotFromPayload()`; to je jediná podporovaná cesta, ako to
 * urobiť bez druhého volania servera.
 */
export async function fetchStatus(): Promise<Envelope<StatusPayload>> {
  return shaped(
    await getJson<unknown>('/api/status'),
    parseStatusPayload,
    'Stav appky sa nepodarilo prečítať.',
  );
}

/**
 * Jedna strana katalógu. `productIds` a `sort` sa pridávajú nad rámec filtra
 * z tabu Produkty — sprievodca vyberá „najhoršie ležiaky prvé", teda podľa
 * predajnosti vzostupne.
 */
export async function searchCatalog(
  filter: CatalogFilterState,
  options: {
    readonly page?: number;
    readonly perPage?: number;
    readonly counts?: boolean;
    readonly sort?: string;
    readonly productIds?: readonly number[];
  } = {},
): Promise<Envelope<CatalogPageView>> {
  const params = catalogSearchParams(filter, { paging: false, counts: options.counts !== false });
  params.set('page', String(options.page ?? 1));
  params.set('perPage', String(options.perPage ?? 200));
  if (options.sort !== undefined) params.set('sort', options.sort);
  if (options.productIds !== undefined && options.productIds.length > 0) {
    params.set('productIds', options.productIds.join(','));
  }
  return shaped(
    await getJson<unknown>(`/api/catalog/search?${params.toString()}`),
    parseCatalogPage,
    'Katalóg sa nepodarilo prečítať.',
  );
}

/** Metadáta kľúča na zápis — pre varovanie K6. */
export async function keyMeta(): Promise<Envelope<KeyMetaView>> {
  return shaped(
    await getJson<unknown>('/api/key'),
    parseKeyMeta,
    'Stav kľúča na zápis sa nepodarilo prečítať.',
  );
}

/** Strop na jednu zľavu a denný rozpočet (K1, K2). */
export async function scopeLimits(): Promise<Envelope<ScopeView>> {
  return shaped(
    await getJson<unknown>('/api/settings'),
    parseScope,
    'Strop na jednu zľavu sa nepodarilo prečítať.',
  );
}

/* ═══════════════════════ Výkon výberu (architektúra §1 TAB 3) ═════════════ */

export interface PerformanceWindow {
  readonly from: string;
  readonly to: string;
  /** `null` = za toto obdobie nemáme dáta. NIE JE to nula. */
  readonly units: number | null;
}

export interface PerformanceView {
  readonly available: boolean;
  /**
   * `false` = zľava sa ešte NEZAČALA, takže čísla nižšie nie sú jej výkon.
   * Chýbajúce pole (staršia odpoveď) sa berie ako `true`, aby sa obrazovka
   * nezmenila spätne — je to priznanie navyše, nie nová podmienka.
   */
  readonly started: boolean;
  /** Odkedy zľava platí (`YYYY-MM-DD`), aby veta mohla povedať KEDY. */
  readonly startsOn: string | null;
  readonly unit: 'ks';
  readonly spanDays: number;
  readonly recent: PerformanceWindow;
  readonly prior: PerformanceWindow;
  readonly coverage: { from: string | null; to: string | null; syncEnabled: boolean };
  readonly locked: { revenue: string; lastYear: string };
}

/**
 * Predaj produktov zľavy v kusoch — dve rovnako dlhé okná vedľa seba.
 * Tržby v eurách appka nemá (shop ich cez API nevracia), preto ich tu
 * nehľadaj: sú medzi zamknutými panelmi.
 */
export async function discountPerformance(id: number): Promise<Envelope<PerformanceView>> {
  return shaped(
    await getJson<unknown>(`/api/insights/campaign/${id}/performance`),
    parsePerformance,
    'Predaj produktov zľavy sa nepodarilo prečítať.',
  );
}
