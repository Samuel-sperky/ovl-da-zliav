'use client';

/**
 * Aura Zľavy — čítanie dát Prehľadu (V9).
 *
 * Prehľad je prístrojová doska nad štyrmi ČISTO ČÍTACÍMI endpointmi:
 *
 *   `/api/queue`        — stav fronty, denný rozpočet, odhad dobehnutia,
 *   `/api/campaigns`    — zoznam zliav s pásmami a príznakom meškania,
 *   `/api/sales`        — predaj za obdobie, ktoré je NAOZAJ pokryté,
 *   `/api/ai/insights`  — deterministické zistenia (riadky „Návrhy").
 *
 * JEDINÉ PRAVIDLO TOHTO MODULU: čo sa nedá prečítať, je `null` — nikdy nula,
 * nikdy dopočítaný odhad. Appka zapisuje do produkčného eshopu; číslo, ktoré si
 * obrazovka vymyslí, je horšie než priznaná medzera (P7).
 *
 * Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy, preto sa
 * všade porovnáva explicitne (`value === null`, `typeof … !== 'number'`).
 *
 * Vlastník: V9.
 */
import { fetchJson } from '@/components/layout/health';

/* ═════════════════════════ 0. Bezpečné čítanie JSON ═══════════════════════ */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

/** Celé nezáporné číslo, inak `null`. Záporný počet položiek je nezmysel. */
function count(source: Record<string, unknown>, key: string): number | null {
  const value = num(source, key);
  if (value === null || value < 0) return null;
  return Math.trunc(value);
}

function str(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

function bool(source: Record<string, unknown>, key: string): boolean {
  return source[key] === true;
}

/* ══════════════════════════════ 1. Fronta ═════════════════════════════════ */

/** Denný rozpočet zápisov — zdrojom pravdy je audit, nie počítadlo. */
export interface BudgetView {
  day: string;
  budget: number;
  spent: number;
  remaining: number;
  exhausted: boolean;
}

/** Odhad dobehnutia fronty. Je to PLÁN, nie sľub — na povrchu vždy so `≈`. */
export interface FinishEstimateView {
  pending: number;
  perDay: number;
  days: number;
  date: string;
}

/** Zľava, ktorá dáva číslam vo fronte meno. */
export interface QueueCampaignView {
  campaignId: number;
  name: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain: number;
  itemsPending: number;
  late: boolean;
}

export interface QueueTotals {
  pending: number;
  total: number;
  /** Spracované položky — nie úspešné, inak by číslo pri opakovaniach skákalo. */
  done: number;
  campaigns: number;
}

export interface QueueSnapshot {
  budget: BudgetView | null;
  queue: QueueTotals;
  current: QueueCampaignView | null;
  estimate: FinishEstimateView | null;
  /** Fakt z databázy: keď tick dlho nebežal, fronta určite nezapisuje. */
  heartbeat: { lastTickAt: string | null; stale: boolean };
  /**
   * Brána po odstávke počítača. Server ju označuje ako orientačnú (beží
   * v inom module grafe než scheduler), preto sa nikdy nepoužíva ako jediný
   * dôkaz — obrazovka ju kombinuje s heartbeatom.
   */
  gate: { paused: boolean; since: string | null };
}

export function parseQueueSnapshot(raw: unknown): QueueSnapshot | null {
  const root = asRecord(raw);
  if (root === null) return null;

  const totalsRaw = asRecord(root['queue']);
  if (totalsRaw === null) return null;
  const pending = count(totalsRaw, 'pending');
  const total = count(totalsRaw, 'total');
  const done = count(totalsRaw, 'done');
  if (pending === null || total === null || done === null) return null;

  let budget: BudgetView | null = null;
  const budgetRaw = asRecord(root['budget']);
  if (budgetRaw !== null) {
    const day = str(budgetRaw, 'day');
    const limit = count(budgetRaw, 'budget');
    const spent = count(budgetRaw, 'spent');
    const remaining = count(budgetRaw, 'remaining');
    if (day !== null && limit !== null && limit > 0 && spent !== null && remaining !== null) {
      budget = { day, budget: limit, spent, remaining, exhausted: remaining === 0 };
    }
  }

  let current: QueueCampaignView | null = null;
  const currentRaw = asRecord(root['current']);
  if (currentRaw !== null) {
    const campaignId = count(currentRaw, 'campaignId');
    const name = str(currentRaw, 'name');
    const status = str(currentRaw, 'status');
    if (campaignId !== null && name !== null && status !== null) {
      current = {
        campaignId,
        name,
        status,
        dateFrom: str(currentRaw, 'dateFrom') ?? '',
        dateTo: str(currentRaw, 'dateTo') ?? '',
        itemsTotal: count(currentRaw, 'itemsTotal') ?? 0,
        itemsOk: count(currentRaw, 'itemsOk') ?? 0,
        itemsFailed: count(currentRaw, 'itemsFailed') ?? 0,
        itemsUncertain: count(currentRaw, 'itemsUncertain') ?? 0,
        itemsPending: count(currentRaw, 'itemsPending') ?? 0,
        late: bool(currentRaw, 'late'),
      };
    }
  }

  let estimate: FinishEstimateView | null = null;
  const estimateRaw = asRecord(root['estimate']);
  if (estimateRaw !== null) {
    const date = str(estimateRaw, 'date');
    const perDay = count(estimateRaw, 'perDay');
    const days = count(estimateRaw, 'days');
    const left = count(estimateRaw, 'pending');
    if (date !== null && perDay !== null && days !== null && left !== null) {
      estimate = { date, perDay, days, pending: left };
    }
  }

  const heartbeatRaw = asRecord(root['heartbeat']);
  const gateRaw = asRecord(root['gate']);

  return {
    budget,
    queue: { pending, total, done, campaigns: count(totalsRaw, 'campaigns') ?? 0 },
    current,
    estimate,
    heartbeat: {
      lastTickAt: heartbeatRaw === null ? null : str(heartbeatRaw, 'lastTickAt'),
      // Fail-closed: keď sa heartbeat nedá prečítať, tvrdíme, že fronta stojí.
      stale: heartbeatRaw === null ? true : heartbeatRaw['stale'] !== false,
    },
    gate: {
      paused: gateRaw !== null && bool(gateRaw, 'paused'),
      since: gateRaw === null ? null : str(gateRaw, 'since'),
    },
  };
}

export async function getQueue(): Promise<QueueSnapshot | null> {
  return parseQueueSnapshot(await fetchJson<unknown>('/api/queue'));
}

/* ═══════════════════════════════ 2. Zľavy ═════════════════════════════════ */

export interface TierView {
  ord: number;
  label: string;
  percent: number;
  itemsCount: number;
}

/** Riadok zoznamu zliav — presne polia, ktoré Prehľad kreslí. */
export interface CampaignRow {
  id: number;
  name: string;
  status: string;
  percent: number;
  dateFrom: string;
  dateTo: string;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain: number;
  itemsPending: number;
  late: boolean;
  tiers: TierView[];
  estimate: FinishEstimateView | null;
}

function parseTier(raw: unknown): TierView | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const ord = count(record, 'ord');
  const percent = count(record, 'percent');
  if (ord === null || percent === null) return null;
  return {
    ord,
    percent,
    label: str(record, 'label') ?? '',
    itemsCount: count(record, 'itemsCount') ?? 0,
  };
}

export function parseCampaignRow(raw: unknown): CampaignRow | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = count(record, 'id');
  const name = str(record, 'name');
  const status = str(record, 'status');
  if (id === null || name === null || status === null) return null;

  const tiersRaw = record['tiers'];
  const tiers = Array.isArray(tiersRaw)
    ? tiersRaw.map(parseTier).filter((tier): tier is TierView => tier !== null)
    : [];

  const itemsTotal = count(record, 'itemsTotal') ?? 0;
  const itemsOk = count(record, 'itemsOk') ?? 0;
  const itemsFailed = count(record, 'itemsFailed') ?? 0;
  const itemsUncertain = count(record, 'itemsUncertain') ?? 0;

  let estimate: FinishEstimateView | null = null;
  const estimateRaw = asRecord(record['estimate']);
  if (estimateRaw !== null) {
    const date = str(estimateRaw, 'date');
    if (date !== null) {
      estimate = {
        date,
        perDay: count(estimateRaw, 'perDay') ?? 0,
        days: count(estimateRaw, 'days') ?? 0,
        pending: count(estimateRaw, 'pending') ?? 0,
      };
    }
  }

  return {
    id,
    name,
    status,
    percent: count(record, 'percent') ?? 0,
    dateFrom: str(record, 'dateFrom') ?? '',
    dateTo: str(record, 'dateTo') ?? '',
    itemsTotal,
    itemsOk,
    itemsFailed,
    itemsUncertain,
    itemsPending:
      count(record, 'itemsPending') ??
      Math.max(0, itemsTotal - itemsOk - itemsFailed - itemsUncertain),
    late: bool(record, 'late'),
    tiers,
    estimate,
  };
}

export function parseCampaignList(raw: unknown): CampaignRow[] | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const data = root['data'];
  if (!Array.isArray(data)) return null;
  return data.map(parseCampaignRow).filter((row): row is CampaignRow => row !== null);
}

export async function getCampaigns(perPage = 50): Promise<CampaignRow[] | null> {
  return parseCampaignList(await fetchJson<unknown>(`/api/campaigns?perPage=${perPage}`));
}

/* ══════════════════════════════ 3. Predaj ═════════════════════════════════ */

/**
 * Jeden deň predaja. `units` sú KUSY — appka peniaze na produkt nepozná
 * a nikdy ich nedopočítava (zaplatená suma patrí objednávke, nie položke).
 */
export interface SalesDay {
  day: string;
  units: number;
}

export interface SalesCoverageView {
  syncEnabled: boolean;
  from: string | null;
  to: string | null;
  daysCovered: number;
  lastSyncedAt: string | null;
  hasData: boolean;
}

export interface SalesSnapshot {
  today: string;
  coverage: SalesCoverageView;
  /** Súčty za celé pokryté obdobie, poskladané z metrík produktov. */
  windowUnits: number;
  unitsPerDay: number | null;
  recentUnits: number | null;
  previousUnits: number | null;
  /**
   * Denný priebeh. Dnešné API ho ešte nedodáva (požiadavka na vlastníka
   * `/api/sales`); kým nepríde, je prázdny a graf sa nekreslí — nie
   * dopočítaný z priemeru.
   */
  days: SalesDay[];
}

function parseDays(raw: unknown): SalesDay[] {
  if (!Array.isArray(raw)) return [];
  const out: SalesDay[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === null) continue;
    const day = str(record, 'day');
    const units = count(record, 'units');
    if (day === null || units === null) continue;
    out.push({ day, units });
  }
  out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return out;
}

export function parseSalesSnapshot(raw: unknown): SalesSnapshot | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const today = str(root, 'today');
  const coverageRaw = asRecord(root['coverage']);
  if (today === null || coverageRaw === null) return null;

  const coverage: SalesCoverageView = {
    syncEnabled: bool(coverageRaw, 'syncEnabled'),
    from: str(coverageRaw, 'from'),
    to: str(coverageRaw, 'to'),
    daysCovered: count(coverageRaw, 'daysCovered') ?? 0,
    lastSyncedAt: str(coverageRaw, 'lastSyncedAt'),
    hasData: bool(coverageRaw, 'hasData'),
  };

  let windowUnits = 0;
  let unitsPerDay: number | null = null;
  let recentUnits: number | null = null;
  let previousUnits: number | null = null;

  const products = root['products'];
  if (Array.isArray(products)) {
    for (const entry of products) {
      const record = asRecord(entry);
      if (record === null) continue;
      windowUnits += count(record, 'unitsSold') ?? 0;
      const perDay = num(record, 'unitsPerDay');
      if (perDay !== null) unitsPerDay = (unitsPerDay ?? 0) + perDay;
      const recent = count(record, 'recentUnits');
      if (recent !== null) recentUnits = (recentUnits ?? 0) + recent;
      const previous = count(record, 'previousUnits');
      if (previous !== null) previousUnits = (previousUnits ?? 0) + previous;
    }
  }

  return {
    today,
    coverage,
    windowUnits,
    unitsPerDay,
    recentUnits,
    previousUnits,
    days: parseDays(root['days'] ?? root['daily']),
  };
}

export async function getSales(): Promise<SalesSnapshot | null> {
  return parseSalesSnapshot(await fetchJson<unknown>('/api/sales'));
}

/* ═════════════════════════════ 4. Zistenia ════════════════════════════════ */

/** Riadok „Návrhy" / „Vyžaduje pozornosť". Vetu skladá server, nie obrazovka. */
export interface InsightRow {
  id: string;
  tone: 'attention' | 'info';
  text: string;
  href: string;
  action: { label: string; href: string } | null;
}

export function parseInsights(raw: unknown): InsightRow[] | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const findings = root['findings'];
  if (!Array.isArray(findings)) return null;

  const out: InsightRow[] = [];
  for (const entry of findings) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = str(record, 'id');
    const text = str(record, 'text');
    if (id === null || text === null) continue;
    const actionRaw = asRecord(record['action']);
    const actionLabel = actionRaw === null ? null : str(actionRaw, 'label');
    const actionHref = actionRaw === null ? null : str(actionRaw, 'href');
    out.push({
      id,
      tone: record['tone'] === 'attention' ? 'attention' : 'info',
      text,
      href: str(record, 'href') ?? '/zlavy',
      action:
        actionLabel !== null && actionHref !== null
          ? { label: actionLabel, href: actionHref }
          : null,
    });
  }
  return out;
}

export async function getInsights(): Promise<InsightRow[] | null> {
  return parseInsights(await fetchJson<unknown>('/api/ai/insights'));
}

/* ═══════════════════════════════ 5. Akcie ═════════════════════════════════ */

/**
 * Výsledok akcie. Prehľad má presne dve akcie, ktoré niečo menia — zastavenie
 * fronty a pokračovanie po odstávke. Obe hlásia pravdu aj vtedy, keď zlyhajú;
 * tichý neúspech je pri appke, ktorá píše do produkčného eshopu, neprípustný.
 */
export type ActionResult = { ok: true } | { ok: false; message: string };

async function post(url: string, body?: unknown): Promise<ActionResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, message: 'Appka neodpovedala — akcia sa nevykonala.' };
  }
  if (res.ok) return { ok: true };

  let message = 'Akcia sa nepodarila.';
  try {
    const parsed = asRecord(await res.json());
    const error = parsed === null ? null : asRecord(parsed['error']);
    const text = error === null ? null : str(error, 'message');
    if (text !== null) message = text;
  } catch {
    // Telo sa nedá prečítať — zostáva neutrálna veta vyššie.
  }
  return { ok: false, message };
}

/**
 * Zastavenie fronty. Zapísané zľavy v eshope ZOSTÁVAJÚ — appka ich zrušiť
 * nevie ani nesmie; zastavuje sa len to, čo sa ešte nezapísalo.
 */
export function stopQueue(campaignId: number): Promise<ActionResult> {
  return post(`/api/campaigns/${campaignId}/cancel`, { reason: 'Zastavené z Prehľadu' });
}

/** Pokračovanie fronty po odstávke počítača — fronta sa sama nikdy nerozbehne. */
export function resumeQueue(): Promise<ActionResult> {
  return post('/api/queue/resume');
}
