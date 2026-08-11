'use client';

/**
 * Aura Zľavy — klientske typy a volania nastavení (A16, §5).
 *
 * Kľúč sa z API nikdy nevracia — len `last4`, časy a odpočet (I1, D65).
 * Citlivé mutácie (`domain`, `key` PUT/DELETE, `unlock-writes`) sú `auth:'sudo'`;
 * pri `401 sudo_required` volajúci zobrazí `SudoPrompt` a akciu zopakuje.
 */
import type { Envelope } from '@/components/campaigns/api';
import { getJson, postJson } from '@/components/campaigns/api';

/** Kód chyby, pri ktorom treba znova overiť heslo (D70, I3). */
export const SUDO_REQUIRED_CODE = 'sudo_required';

/** Presný literál potvrdenia panic buttonu (D67) — bez diakritiky. */
export const PANIC_CONFIRM_LITERAL = 'KLUC UNIKOL';

/** Režim rozsahu podľa kontraktu V3 (bod K-jedna). Na povrchu nikdy surový. */
export type ScopeModeValue = 'pilot' | 'plny';

/** Slovenské meno režimu — obrazovka si ho nevymýšľa. */
export const SCOPE_MODE_LABELS: Readonly<Record<ScopeModeValue, string>> = {
  pilot: 'pilotný',
  plny: 'plný',
};

export interface SettingsView {
  shopDomain: string | null;
  domainConfirmedAt: string | null;
  eagerWriteDefault: boolean;
  writesLocked: boolean;
  writesLockedReason: string | null;
  onboardingDoneAt: string | null;
  /* ── rozsah a rozpočet (kontrakt V3) ─────────────────────────────────── */
  scopeMode: ScopeModeValue;
  /** Koľko produktov smie mať jedna zľava v platnom režime. */
  maxProducts: number;
  /** Uložený strop pre plný režim (v pilotnom sa nepoužíva). */
  maxProductsPerCampaign: number;
  /** Strop pilotného režimu — desať, a je vynútený aj v databáze. */
  pilotMaxProducts: number;
  /** `true` = hodnoty sú bezpečný predvolený stav, nie čítanie z databázy. */
  scopeFailClosed: boolean;
  /** Koľko zápisov smie appka minúť za jeden deň. */
  dailyWriteBudget: number;
}

/** Odpoveď prepnutia režimu rozsahu. */
export interface ScopeModeResult {
  scopeMode: ScopeModeValue;
  maxProducts: number;
  maxProductsPerCampaign: number;
  dailyWriteBudget: number;
  previousScopeMode: ScopeModeValue;
  pilotMaxProducts: number;
}

/** Stav rozpočtu zápisov za dnešný deň (čítané, nikdy dopočítavané). */
export interface BudgetStatusView {
  day: string;
  budget: number;
  spent: number;
  remaining: number;
  exhausted: boolean;
}

/** To, čo z fronty potrebujú Nastavenia: rozpočet a veľkosť fronty. */
export interface QueueView {
  budget: BudgetStatusView | null;
  queue: { pending: number; total: number; done: number; campaigns: number };
  estimate: { pending: number; perDay: number; days: number; date: string } | null;
  heartbeat: { lastTickAt: string | null; staleMs: number | null; stale: boolean };
}

export interface KeyMetaView {
  present: boolean;
  last4: string | null;
  savedAt: string | null;
  expiresAt: string | null;
  secondsLeft: number | null;
  verifyStatus: 'unverified' | 'valid' | 'invalid' | 'forbidden' | null;
}

export interface CanaryView {
  ok: boolean;
  httpStatus: number | null;
  total: number;
  latencyMs: number;
}

export interface PanicResult {
  wiped: true;
  cancelledCampaigns: number;
  runbookUrl: string;
}

async function sendJson<T>(
  url: string,
  method: 'PUT' | 'DELETE',
  body?: unknown,
): Promise<Envelope<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    try {
      const parsed = (await res.json()) as Envelope<T>;
      if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    } catch {
      /* neplatný JSON */
    }
    return {
      ok: false,
      error: { code: `http_${res.status}`, message: 'Server vrátil neočakávanú odpoveď.' },
    };
  } catch {
    return { ok: false, error: { code: 'network', message: 'Server neodpovedá. Skús znova.' } };
  }
}

export const getSettings = () => getJson<SettingsView>('/api/settings');
export const getKeyMeta = () => getJson<KeyMetaView>('/api/key');

/** Rozpočet a fronta pre sekciu Rozpočet. Čisto čítacie. */
export const getQueue = () => getJson<QueueView>('/api/queue');

/**
 * Prepnutie režimu rozsahu. Uvoľnenie (pilotný → plný) si server vypýta heslom;
 * sprísnenie späť je vždy voľné, aby sa dalo pribrzdiť aj v núdzi.
 */
export const postScopeMode = (mode: ScopeModeValue, maxProductsPerCampaign?: number) =>
  postJson<ScopeModeResult>(
    '/api/settings/scope-mode',
    maxProductsPerCampaign === undefined ? { mode } : { mode, maxProductsPerCampaign },
  );

/**
 * Stav OBJEDNÁVKOVÉHO kľúča (`orders_read`, P2/P5). Tvar odpovede je rovnaký
 * ako pri zápisovom kľúči a obsahuje výhradne `present`, `last4` a časy (D65, I1).
 */
export const getOrdersKeyMeta = () => getJson<KeyMetaView>('/api/key?kind=orders_read');

export const putDomain = (domain: string, password: string) =>
  sendJson<{ shopDomain: string; canary: { ok: boolean; total: number } }>(
    '/api/settings/domain',
    'PUT',
    { domain, password },
  );

export const testConnection = () => postJson<CanaryView>('/api/settings/test-connection');

export const putEagerWriteDefault = (enabled: boolean) =>
  sendJson<{ eagerWriteDefault: boolean }>('/api/settings/eager-write-default', 'PUT', { enabled });

/** Odhlásenie — session cookie ruší server, klient sa potom prekreslí. */
export const logout = () => postJson<Record<string, never>>('/api/auth/logout');

export const unlockWrites = (password: string) =>
  postJson<{ writesLocked: false }>('/api/settings/unlock-writes', { password });

export const putKey = (apiKey: string) =>
  sendJson<{ last4: string; expiresAt: string; verifyStatus: string }>('/api/key', 'PUT', {
    apiKey,
  });

/**
 * Vloženie objednávkového kľúča. Server ho uloží LEN vtedy, keď mu shop skutočne
 * povolí čítanie objednávok — inak vráti chybu a v DB sa nič nezmení.
 */
export const putOrdersKey = (apiKey: string) =>
  sendJson<{ last4: string; expiresAt: string; verifyStatus: string; kind: string }>(
    '/api/key',
    'PUT',
    { apiKey, kind: 'orders_read' },
  );

export const panicWipeKey = (password: string) =>
  sendJson<PanicResult>('/api/key', 'DELETE', {
    password,
    confirm: PANIC_CONFIRM_LITERAL,
  });

/* ── lokálna validácia pred odoslaním ─────────────────────────────────── */

/** Doména shopu MUSÍ byť jedna a výhradne `https://` (D80). */
export function validateDomain(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return 'Zadaj doménu shopu.';
  if (!value.startsWith('https://')) {
    return 'Doména musí začínať na https:// — http ani iné schémy appka neprijme.';
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Doména nie je platná URL adresa.';
  }
  if (url.protocol !== 'https:') return 'Doména musí používať https.';
  if (url.hostname === '') return 'Doména neobsahuje názov hostiteľa.';
  return null;
}

/** API kľúč: 16–256 znakov podľa §5; obsah kľúča sa nikde nezobrazuje (I1). */
export function validateApiKey(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return 'Vlož API kľúč zo shopu.';
  if (value.length < 16) return 'Kľúč je príliš krátky (minimum 16 znakov) — skopíruj ho celý.';
  if (value.length > 256) return 'Kľúč je príliš dlhý (maximum 256 znakov).';
  return null;
}
