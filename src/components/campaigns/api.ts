'use client';

/**
 * Aura Zľavy — klientske typy a volania pre UI kampaní (A15, §5).
 *
 * Route-y dodáva A12 — tento modul programuje proti NORMATÍVNEMU API
 * kontraktu z BUILD-SPEC §5. Všetky mutácie idú výhradne cez `fetch` na
 * `/api/campaigns/*` (žiadny Server Action, I3) a lokálna validácia (I9)
 * beží VŽDY pred odoslaním na server.
 */
import type {
  CampaignKind,
  CampaignMode,
  CampaignStatus,
  DerivedCampaignView,
  ItemStatus,
} from '@/contracts';

/* ── typy podľa §5 ─────────────────────────────────────────────────────── */

export interface ApiError {
  code: string;
  message: string;
  detail?: unknown;
}

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface LastOwnWriteView {
  percent: number;
  from: string;
  to: string;
  at: string;
  campaignId?: number;
}

export interface PreviewItemView {
  productId: number;
  name: string | null;
  price: string | null;
  discountedPrice: string | null;
  hasAttributes: boolean;
  lastOwnWrite: LastOwnWriteView | null;
  reductionUnverifiable?: true;
  warnings: string[];
}

export interface PreviewWarningsView {
  keyExpiresBeforeStart: boolean;
  oneDayWindow: boolean;
  overwrite: number[];
  hasAttributes: number[];
}

export interface PreviewBlockerView {
  code: string;
  message: string;
  productId?: number;
}

export interface PreviewResponse {
  previewToken: string;
  items: PreviewItemView[];
  warnings: PreviewWarningsView;
  blockers: PreviewBlockerView[];
}

export interface CampaignListRow {
  id: number;
  name: string;
  kind: CampaignKind;
  status: CampaignStatus;
  /** Derivovaný UI stav zo `_shared.campaignView()` (§4). */
  derived?: DerivedCampaignView;
  statusReason?: string | null;
  percent: number;
  dateFrom: string;
  dateTo: string;
  mode: CampaignMode;
  fireAt?: string | null;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain?: number;
  createdAt?: string;
}

export interface CampaignsPageData {
  data: CampaignListRow[];
  page: number;
  perPage: number;
  total: number;
}

export interface CampaignItemView {
  id: number;
  productId: number;
  position: number;
  status: ItemStatus;
  nameAtWrite: string | null;
  priceAtPreview: string | null;
  priceAtWrite: string | null;
  priceMismatch: boolean;
  hasAttributes: boolean;
  reductionUnverifiable: boolean;
  requestId: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
}

export interface CampaignDetailView {
  id: number;
  name: string;
  kind: CampaignKind;
  parentCampaignId: number | null;
  status: CampaignStatus;
  /** Derivovaný UI stav zo `_shared.campaignView()` (§4). */
  derived?: DerivedCampaignView;
  statusReason: string | null;
  percent: number;
  dateFrom: string;
  dateTo: string;
  dateFromOriginal: string | null;
  mode: CampaignMode;
  fireAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain: number;
  confirmedAt?: string | null;
  createdAt: string;
}

export interface AuditTrailRow {
  id: number;
  ts: string;
  actor: string;
  eventType: string;
  ok: boolean | null;
  productId: number | null;
  requestId: string | null;
  httpStatus: number | null;
  message: string | null;
}

export interface CampaignDetailResponse {
  campaign: CampaignDetailView;
  items: CampaignItemView[];
  /** Kľúč z `GET /api/campaigns/[id]` (A12) — audit stopa kampane. */
  auditTrail: AuditTrailRow[];
}

export interface AllowlistProduct {
  productId: number;
  slot: number | null;
  label: string | null;
  shopStatus: 'ok' | 'not_found' | 'unknown';
  name: string | null;
  price: string | null;
  hasAttributes: boolean;
  lastOwnWrite: LastOwnWriteView | null;
}

export interface SessionInfo {
  username: string;
  absoluteExpiresAt: string;
  idleExpiresAt: string;
  sudoUntil: string | null;
}

/* ── fetch helpery ─────────────────────────────────────────────────────── */

async function parse<T>(res: Response): Promise<Envelope<T>> {
  try {
    const body = (await res.json()) as Envelope<T>;
    if (body && typeof body === 'object' && 'ok' in body) return body;
  } catch {
    /* neplatný JSON — spadne nižšie */
  }
  return {
    ok: false,
    error: { code: `http_${res.status}`, message: 'Server vrátil neočakávanú odpoveď.' },
  };
}

export async function getJson<T>(url: string): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return await parse<T>(res);
  } catch {
    return { ok: false, error: { code: 'network', message: 'Server neodpovedá. Skús znova.' } };
  }
}

export async function postJson<T>(url: string, body?: unknown): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return await parse<T>(res);
  } catch {
    return { ok: false, error: { code: 'network', message: 'Server neodpovedá. Skús znova.' } };
  }
}

/* ── lokálna validácia (I9) — VŽDY pred odoslaním na server ────────────── */

export const PERCENT_MIN = 1;
export const PERCENT_MAX = 30;
export const WINDOW_MAX_MONTHS = 3;

/** Dnešný deň ako `YYYY-MM-DD` (lokálny čas prehliadača). */
export function todayDateOnly(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** `from` + N dní → `YYYY-MM-DD`. */
export function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d! + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** Posledný deň mesiaca dňa `dateOnly`. */
export function endOfMonth(dateOnly: string): string {
  const [y, m] = dateOnly.split('-').map(Number);
  const dt = new Date(y!, m!, 0);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** `from` + 3 mesiace (strop okna, I9). */
function plusThreeMonths(dateOnly: string): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const dt = new Date(y!, m! - 1 + WINDOW_MAX_MONTHS, d!);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

export function isValidDateOnly(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y!, m! - 1, d!);
  return dt.getFullYear() === y && dt.getMonth() === m! - 1 && dt.getDate() === d;
}

/** Percento: celé číslo 1–30 (D11, I9). */
export function validatePercent(value: unknown): string | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'Zadaj percento zľavy.';
  if (!Number.isInteger(n)) return 'Percento musí byť celé číslo (bez desatín).';
  if (n < PERCENT_MIN || n > PERCENT_MAX) return `Percento musí byť ${PERCENT_MIN}–${PERCENT_MAX}.`;
  return null;
}

/**
 * Okno: `to ≥ from`, `from ≥ dnes`, dĺžka ≤ 3 mesiace (I9, D29, D30).
 * `minFrom` umožňuje predĺženiu zamknúť pôvodné `from` (D19/D27 rieši volajúci).
 */
export function validateWindow(from: string, to: string): string | null {
  if (!isValidDateOnly(from)) return 'Dátum OD nie je platný deň (YYYY-MM-DD).';
  if (!isValidDateOnly(to)) return 'Dátum DO nie je platný deň (YYYY-MM-DD).';
  if (to < from) return 'Dátum DO musí byť rovnaký alebo neskorší než dátum OD.';
  if (from < todayDateOnly()) return 'Dátum OD nesmie byť v minulosti.';
  if (to > plusThreeMonths(from)) return 'Okno zľavy môže trvať najviac 3 mesiace od dátumu OD.';
  return null;
}

/** Predĺženie: nové `to` proti zamknutému `from` (D27) — bez podmienky `from ≥ dnes`. */
export function validateExtendTo(lockedFrom: string, currentTo: string, newTo: string): string | null {
  if (!isValidDateOnly(newTo)) return 'Nový dátum DO nie je platný deň.';
  if (newTo <= currentTo) return 'Nový dátum DO musí byť neskorší než súčasný koniec.';
  if (newTo > plusThreeMonths(lockedFrom)) {
    return 'Predĺženie by prekročilo 3-mesačný strop od pôvodného OD. Vytvor namiesto toho prepis s novým OD.';
  }
  return null;
}

/* ── sudo okno (D70) ───────────────────────────────────────────────────── */

/** `true`, keď je sudo okno platné (menej než 15 min od autentifikácie). */
export function sudoValid(sudoUntil: string | null | undefined): boolean {
  if (!sudoUntil) return false;
  const t = new Date(sudoUntil).getTime();
  return Number.isFinite(t) && t > Date.now();
}

export async function fetchSession(): Promise<SessionInfo | null> {
  const res = await getJson<SessionInfo>('/api/auth/session');
  return res.ok ? res.data : null;
}
