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
 *   `POST /api/campaigns`            — zaradenie do fronty (sudo, D70),
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

/* ═══════════════════════════ 5. Volania ═══════════════════════════════════ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Nezáporné celé číslo, inak `fallback`. Záporný počet položiek je nezmysel. */
function intOr(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.trunc(value);
}

function budgetOf(value: unknown): BudgetView | null {
  if (!isRecord(value)) return null;
  const budget = value['budget'];
  const spent = value['spent'];
  const remaining = value['remaining'];
  const day = value['day'];
  if (typeof budget !== 'number' || budget <= 0) return null;
  if (typeof spent !== 'number' || typeof remaining !== 'number') return null;
  return {
    day: typeof day === 'string' ? day : '',
    budget: Math.trunc(budget),
    spent: Math.max(0, Math.trunc(spent)),
    remaining: Math.max(0, Math.trunc(remaining)),
  };
}

/** Zoznam zliav aj s pásmami, odhadom a rozpočtom. */
export async function listDiscounts(perPage = 50): Promise<Envelope<DiscountsPage>> {
  const res = await getJson<{
    data: DiscountRow[];
    total: number;
    budget: unknown;
  }>(`/api/campaigns?perPage=${perPage}`);
  if (!res.ok) return res;
  const rows = Array.isArray(res.data.data) ? res.data.data : [];
  return {
    ok: true,
    data: {
      data: rows,
      total: intOr(res.data.total, rows.length),
      budget: budgetOf(res.data.budget),
    },
  };
}

export function getDiscount(
  id: number,
  itemsLimit = 200,
): Promise<Envelope<DiscountDetailData>> {
  return getJson<DiscountDetailData>(`/api/campaigns/${id}?itemsLimit=${itemsLimit}`);
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

/* ═════════════ 6. Živý stav fronty a celý obraz stavu appky ═══════════════ */

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
export function fetchStatus(): Promise<Envelope<StatusPayload>> {
  return getJson<StatusPayload>('/api/status');
}

/**
 * Jedna strana katalógu. `productIds` a `sort` sa pridávajú nad rámec filtra
 * z tabu Produkty — sprievodca vyberá „najhoršie ležiaky prvé", teda podľa
 * predajnosti vzostupne.
 */
export function searchCatalog(
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
  return getJson<CatalogPageView>(`/api/catalog/search?${params.toString()}`);
}

/** Metadáta kľúča na zápis — pre varovanie K6. */
export function keyMeta(): Promise<Envelope<KeyMetaView>> {
  return getJson<KeyMetaView>('/api/key');
}

/** Strop na jednu zľavu a denný rozpočet (K1, K2). */
export function scopeLimits(): Promise<Envelope<ScopeView>> {
  return getJson<ScopeView>('/api/settings');
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
export function discountPerformance(id: number): Promise<Envelope<PerformanceView>> {
  return getJson<PerformanceView>(`/api/insights/campaign/${id}/performance`);
}
