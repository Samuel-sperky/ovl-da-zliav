'use client';

/**
 * Aura Zľavy — klientske čítanie API pre chróm (§5).
 *
 * Zostali tu tri veci, ktoré chróm naozaj potrebuje: tenký `fetchJson()` cez
 * obálku `{ ok, data }`, typ nastavení pre pruh PRODUKCIA a klasifikácia
 * HTTP odpovede na „nie si prihlásený" vs. „appka neodpovedá".
 *
 * ČO ODTIAĽTO ZMIZLO A PREČO
 * --------------------------
 * Hook `useHealth()` ťahal `/api/health` každých 30 s a bol druhým zdrojom
 * tých istých faktov, ktoré dodáva `/api/status` (stav kľúča, zápisy). Dve
 * predstavy o jednej pravde a k tomu časovač, ktorý kontrakt UI (bod 4) ruší —
 * chróm preto stojí výhradne na `layout/status.ts` a jednom čítaní stavu.
 * Endpoint `/api/health` žije ďalej, je to kontrola pre dohľad, nie pre UI.
 */

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
 * Čistá klasifikácia HTTP statusu odpovede stavového endpointu.
 *
 * 401/403 = chýbajúca session alebo oprávnenie → o stave appky to nevypovedá
 * NIČ. Všetko ostatné mimo 2xx je skutočne degradovaný / nedostupný stav.
 */
export function classifyHealthStatus(status: number): HealthOutcomeKind {
  if (status === 401 || status === 403) return 'unauthenticated';
  if (status >= 200 && status < 300) return 'ok';
  return 'unreachable';
}
