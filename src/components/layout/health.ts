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

export interface HealthState {
  health: HealthData | null;
  /** `true` kým prebieha prvé načítanie. */
  loading: boolean;
  /** `true` keď health endpoint neodpovedá (degradovaný shell). */
  unreachable: boolean;
  refresh: () => void;
}

/** Polluje `/api/health` (default každých 30 s). */
export function useHealth(pollMs = 30_000): HealthState {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchJson<HealthData>('/api/health');
    setHealth(data);
    setUnreachable(data == null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);

  return { health, loading, unreachable, refresh: () => void load() };
}
