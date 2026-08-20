'use client';

/**
 * Aura Zľavy — klientske čítanie `/api/health` a `/api/settings` (§5).
 *
 * Typy zodpovedajú NORMATÍVNEMU API kontraktu z BUILD-SPEC §5 — route-y
 * dodávajú A11/A12, tento modul proti kontraktu len číta. `/api/health`
 * nikdy nevracia `last4` ani detaily kľúča (I1); UI si vystačí s
 * `present` + `expiresAt`.
 */
import { useCallback, useEffect, useState } from 'react';

/** Odpoveď `GET /api/health` podľa §5. */
export interface HealthData {
  status: 'ok' | 'degraded';
  db: boolean;
  key: { present: boolean; expiresAt: string | null };
  scheduler: { lastTickAt: string | null; ageSec: number | null };
  writesEnabled: boolean;
  writesLocked: boolean;
  version: string;
}

/** Odpoveď `GET /api/settings` podľa §5 (len polia potrebné pre shell). */
export interface SettingsData {
  shopDomain: string | null;
  writesLocked: boolean;
  writesLockedReason: string | null;
}

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: unknown };

export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as ApiEnvelope<T> | T;
    if (body && typeof body === 'object' && 'ok' in (body as object)) {
      const env = body as ApiEnvelope<T>;
      return env.ok ? env.data : null;
    }
    return body as T;
  } catch {
    return null;
  }
}

/**
 * Kategória výsledku načítania stavu.
 *
 * `unauthenticated` je zámerne oddelené od `unreachable`: keď shell ťahá stav
 * bez session, dostane 401 — appka pri tom môže bežať úplne v poriadku. Zliať
 * tieto dva prípady do jedného znamenalo, že hlavička hlásila poruchu, ktorá
 * neexistovala, a posielala používateľa hľadať neexistujúcu chybu.
 */
export type HealthOutcomeKind = 'ok' | 'unauthenticated' | 'unreachable';

/**
 * Čistá klasifikácia HTTP statusu odpovede `/api/health`.
 *
 * 401/403 = chýbajúca session alebo oprávnenie → o stave appky to nevypovedá
 * NIČ. Všetko ostatné mimo 2xx je skutočne degradovaný / nedostupný stav.
 */
export function classifyHealthStatus(status: number): HealthOutcomeKind {
  if (status === 401 || status === 403) return 'unauthenticated';
  if (status >= 200 && status < 300) return 'ok';
  return 'unreachable';
}

export type HealthOutcome =
  | { kind: 'ok'; data: HealthData }
  | { kind: 'unauthenticated' }
  | { kind: 'unreachable' };

/**
 * Načíta `/api/health` a rozlíši „nie si prihlásený" od „appka nedostupná".
 * Sieťová chyba (fetch throw) = appka je naozaj nedostupná.
 */
export async function fetchHealthOutcome(url = '/api/health'): Promise<HealthOutcome> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    return { kind: 'unreachable' };
  }

  const kind = classifyHealthStatus(res.status);
  if (kind !== 'ok') return { kind };

  try {
    const body = (await res.json()) as ApiEnvelope<HealthData> | HealthData;
    if (body && typeof body === 'object' && 'ok' in (body as object)) {
      const env = body as ApiEnvelope<HealthData>;
      return env.ok ? { kind: 'ok', data: env.data } : { kind: 'unreachable' };
    }
    return { kind: 'ok', data: body as HealthData };
  } catch {
    return { kind: 'unreachable' };
  }
}

export interface HealthState {
  health: HealthData | null;
  /** `true` kým prebieha prvé načítanie. */
  loading: boolean;
  /** `true` keď health endpoint naozaj neodpovedá (degradovaný shell). */
  unreachable: boolean;
  /** `true` keď stav nie je známy LEN pre chýbajúcu session (401/403). */
  unauthenticated: boolean;
  refresh: () => void;
}

/** Polluje `/api/health` (default každých 30 s). */
export function useHealth(pollMs = 30_000): HealthState {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [unauthenticated, setUnauthenticated] = useState(false);

  const load = useCallback(async () => {
    const outcome = await fetchHealthOutcome();
    setHealth(outcome.kind === 'ok' ? outcome.data : null);
    setUnreachable(outcome.kind === 'unreachable');
    setUnauthenticated(outcome.kind === 'unauthenticated');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { health, loading, unreachable, unauthenticated, refresh: () => void load() };
}
