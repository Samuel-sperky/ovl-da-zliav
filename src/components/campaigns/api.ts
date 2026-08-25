'use client';

/**
 * Aura Zľavy — klientske typy a volania pre UI kampaní (A15, §5).
 *
 * Route-y dodáva A12 — tento modul programuje proti NORMATÍVNEMU API
 * kontraktu z BUILD-SPEC §5. Všetky mutácie idú výhradne cez `fetch` na
 * `/api/campaigns/*` (žiadny Server Action, I3) a lokálna validácia (I9)
 * beží VŽDY pred odoslaním na server.
 *
 * ČO TENTO MODUL O ODPOVEDI SERVERA OVERUJE
 * -----------------------------------------
 * Presne jednu vec: že OBÁLKA je obálka. Do 24. 8. 2026 stačilo, aby v tele
 * stál kľúč `ok` — čokoľvek ďalšie sa pretypovalo na `Envelope<T>` a poslalo
 * volajúcemu. Znamenalo to tri crashe, ktoré vyzerali ako biela obrazovka
 * a nie ako chyba servera:
 *
 *  - `{ ok: true }` bez `data` → volajúci robí `res.data.items` nad `undefined`,
 *  - `{ ok: false }` bez `error` → volajúci robí `res.error.message`,
 *  - `{ ok: 'yes' }` → `body.ok` je truthy string, takže sa vetva `ok === true`
 *    v TypeScripte tvári ako splnená a `data` je zase `undefined`.
 *
 * Od 24. 8. 2026 sa každý z tých troch prípadov zmení na REGULÁRNU chybovú
 * obálku s kódom `bad_envelope`, takže obrazovka ukáže vetu a nie prázdno.
 * Stráži to `test/unit/api-citanie-odpovedi.spec.ts` nad `getJson()`
 * a `postJson()`, teda nad správaním — nie nad textom tohto súboru.
 *
 * ČO TENTO MODUL O ODPOVEDI SERVERA NEOVERUJE
 * -------------------------------------------
 * Obsah `data`. `getJson<T>()` je generický prenos a `T` v ňom za behu
 * neexistuje — kto potrebuje overený OBSAH, dostane ho tak, ako `fetchSession()`
 * nižšie alebo `getAudit()` v `components/audit/api.ts`: `getJson<unknown>()`
 * a k tomu `parseX()` postavené z `components/dashboard/json.ts`. Tá cesta je
 * jediná; druhá implementácia tých istých piatich funkcií by sa o mesiac
 * rozišla s prvou a jedna obrazovka by začala čítať voľnejšie než druhá.
 *
 * Čo sa tým smie TICHO pokaziť: obálka overená neznamená obsah overený.
 * `getJson<CampaignDetailResponse>()` naďalej vráti `data`, ktoré nikto
 * nečítal — len už nikdy `undefined`. Zoznam obrazoviek, ktoré na ten obsah
 * ešte len čakajú, je v hlavičke `test/unit/api-citanie-odpovedi.spec.ts`.
 */
import { asRecord, readText } from '@/components/dashboard/json';
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

/** Kolízia s inou budúcou kampaňou na konkrétnom produkte (D28). */
export interface PreviewConflictView {
  productId: number;
  campaignId: number;
  campaignName: string;
  from: string;
  to: string;
  /**
   * Vrátane `queued` (25. 8. 2026). Server tu posiela `CampaignStatusV3`
   * a tento typ dovtedy hovoril `CampaignStatus` — čo bola nepravda o dátach,
   * ktoré cez HTTP naozaj chodia. Tie dva typy nie sú štrukturálne spojené,
   * takže `tsc` ten rozpor nevidel a videl by ho až človek pri prvej kampani
   * vo fronte. Kolízia s čakajúcou kampaňou je plnohodnotná kolízia.
   */
  status: CampaignStatus | 'queued';
}

export interface PreviewResponse {
  previewToken: string;
  items: PreviewItemView[];
  warnings: PreviewWarningsView;
  blockers: PreviewBlockerView[];
  /** Prekryvy per produkt — `engine/preview` (voliteľné pre staršie odpovede). */
  conflicts?: PreviewConflictView[];
  /** Kedy expiruje kľúč — varovanie D8 vie povedať KEDY, nie len „skôr". */
  keyExpiresAt?: string | null;
  /** `true` = kľúč chýba/expiroval; sada sa dá uložiť len ako koncept. */
  keyMissing?: boolean;
}

/** Kód blokátora „chýba API kľúč" — pozná ho `engine/preview`. */
export const KEY_MISSING_CODE = 'key_missing';

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

/** Objekt prečítaný z JSON, ktorého kľúče ešte nikto neoveril. */
type UncheckedBody = Record<string, unknown>;

/** Telo odpovede ako objekt, alebo `null` pri čomkoľvek inom (aj pri poli). */
function asBody(value: unknown): UncheckedBody | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as UncheckedBody;
}

/**
 * Chybová obálka z toho, čo sa v tele dalo prečítať.
 *
 * Kód a vetu si berie zo servera, KEĎ sú to naozaj neprázdne reťazce. Inak
 * vlastný kód a vlastnú vetu — volajúci vykresľuje `error.message`, takže
 * `undefined` v ňom je prázdny riadok, nie hlásenie.
 */
function errorEnvelope(body: UncheckedBody | null, fallbackCode: string): Envelope<never> {
  const raw = body === null ? null : asBody(body['error']);
  const code = raw === null ? null : raw['code'];
  const message = raw === null ? null : raw['message'];
  return {
    ok: false,
    error: {
      code: typeof code === 'string' && code !== '' ? code : fallbackCode,
      message:
        typeof message === 'string' && message !== ''
          ? message
          : 'Server vrátil neočakávanú odpoveď.',
      ...(raw !== null && 'detail' in raw ? { detail: raw['detail'] } : {}),
    },
  };
}

/**
 * Telo odpovede → obálka, o ktorej sa dá tvrdiť, že to obálka JE.
 *
 * `ok` sa porovnáva EXPLICITNE proti `true`/`false` (nie truthy): Turbopack tu
 * v tomto projekte už raz zahodil skratkové porovnanie a `ok: 'yes'` by inak
 * prešlo ako úspech s `data: undefined`. A úspešná obálka musí `data` naozaj
 * NIESŤ — kľúč, nie hodnotu, aby `data: null` zostalo legitímnou odpoveďou
 * „niet čo vrátiť" a nezliala sa s „server to pole vôbec neposlal".
 */
async function parse<T>(res: Response): Promise<Envelope<T>> {
  let body: UncheckedBody | null = null;
  try {
    body = asBody(await res.json());
  } catch {
    /* neplatný JSON — `body` zostáva `null` a spadne to nižšie */
  }

  if (body !== null) {
    if (body['ok'] === true && Object.prototype.hasOwnProperty.call(body, 'data')) {
      return { ok: true, data: body['data'] as T };
    }
    if (body['ok'] === false) return errorEnvelope(body, `http_${res.status}`);
  }
  return errorEnvelope(body, res.ok ? 'bad_envelope' : `http_${res.status}`);
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

/** Neskorší z dvoch dní (`YYYY-MM-DD` sa dá porovnávať lexikograficky). */
export function maxDateOnly(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Počet dní okna vrátane oboch hraníc (D13 — „od 00:00 OD do 23:59 DO"). */
export function windowDays(from: string, to: string): number {
  if (!isValidDateOnly(from) || !isValidDateOnly(to)) return 0;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = Date.UTC(fy!, fm! - 1, fd!);
  const end = Date.UTC(ty!, tm! - 1, td!);
  if (end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/** Slovenský tvar počtu dní: `1 deň` / `3 dni` / `15 dní`. */
export function daysLabelSk(days: number): string {
  if (days === 1) return '1 deň';
  if (days >= 2 && days <= 4) return `${days} dni`;
  return `${days} dní`;
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

/* ── sudo okno (D70, plán §7 — 30 min, heslo raz) ──────────────────────── */

/** `true`, keď sudo okno ešte platí (server ho vyhodnocuje fail-closed sám). */
export function sudoValid(sudoUntil: string | null | undefined): boolean {
  if (!sudoUntil) return false;
  const t = new Date(sudoUntil).getTime();
  return Number.isFinite(t) && t > Date.now();
}

/** Koľko sekúnd sudo okna zostáva (0 = neplatí) — pre odpočet v UI. */
export function sudoSecondsLeft(sudoUntil: string | null | undefined): number {
  if (!sudoUntil) return 0;
  const t = new Date(sudoUntil).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

/**
 * Session tak, ako ju appka naozaj prečítala — nie ako ju pretypovala.
 *
 * `sudoValid()` a `sudoSecondsLeft()` nižšie stoja na `sudoUntil`, a zámok
 * sudo okna je poistka proti nechcenému zápisu do ostrého eshopu (D70). Keby
 * server poslal `sudoUntil: 12345` (číslo, nie reťazec), `new Date(…)` z toho
 * vyrobí platný čas z roku 1970, `sudoValid()` povie `false` a používateľ
 * dostane heslové okno navyše. Naopak `absoluteExpiresAt`, ktoré chýba, dnes
 * prejde ako `undefined` a odpočet v UI ukáže „NaN".
 *
 * Preto sa obsah overuje TU: `null` znamená „session sa nedá prečítať", čo je
 * ten istý výsledok, aký volajúci dostane pri chýbajúcej session — a to je
 * fail-closed správne, nie strata informácie.
 */
export function parseSession(raw: unknown): SessionInfo | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const username = readText(record, 'username');
  const absoluteExpiresAt = readText(record, 'absoluteExpiresAt');
  const idleExpiresAt = readText(record, 'idleExpiresAt');
  // Bez týchto troch nie je čo zobraziť ani čo odpočítavať.
  if (username === null || absoluteExpiresAt === null || idleExpiresAt === null) return null;
  return {
    username,
    absoluteExpiresAt,
    idleExpiresAt,
    // `sudoUntil` chýbať SMIE — znamená to „sudo okno neplatí" a `sudoValid()`
    // to tak aj číta. Nesmie byť len niečím iným než reťazcom.
    sudoUntil: readText(record, 'sudoUntil'),
  };
}

export async function fetchSession(): Promise<SessionInfo | null> {
  const res = await getJson<unknown>('/api/auth/session');
  return res.ok ? parseSession(res.data) : null;
}
