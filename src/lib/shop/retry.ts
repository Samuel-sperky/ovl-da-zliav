/**
 * Aura Zľavy — RETRY POLITIKA voči shopu (D42–D45, BUILD-SPEC §6).
 *
 * Politika je čistá funkcia nad taxonómiou z `errors.ts` (D41) — nič sa nečíta
 * z DB a nič nie je konfigurovateľné za behu okrem stropov z ENV (§11):
 *
 * | Situácia                          | Politika                                            |
 * | --------------------------------- | --------------------------------------------------- |
 * | 429                               | `min(Retry-After, 90 s)`, max 3 pokusy (D42)         |
 * | 500 / network / timeout_before    | backoff 2 s → 4 s → 8 s, max 3 pokusy (D43)         |
 * | timeout_after (zápis)             | žiadny retry tu; presne 1 resend rieši `client.ts` (D45) |
 * | 400 / 401 / 403 / 404 / drift     | žiadny retry (D41, D54)                             |
 *
 * „max 3 pokusy" znamená **3 pokusy celkom** (prvý + 2 opakovania), presne ako
 * D42 („skúsiť maximálne 3× a potom zlyhať s reportom"). Tabuľka backoffu má
 * tri hodnoty, aby zvýšenie `SHOP_RETRY_MAX` na 4 fungovalo bez zmeny kódu;
 * pri stope 3 sa teda čaká 2 s a 4 s.
 *
 * Retry sa počíta **per request**; nad tým už žiadna ďalšia vrstva opakovania
 * neexistuje (§6, D34) — dávka sa nikdy neopakuje celá.
 *
 * Vlastník: A3.
 */
import type { ShopError, ShopErrorKind } from '@/contracts';

import { isRetryableKind } from '@/lib/shop/errors';

/* ═══════════════════════════ 1. Konštanty politiky ════════════════════════ */

/** Backoff pre 500 / network / timeout_before (D43). */
export const BACKOFF_MS: readonly number[] = [2000, 4000, 8000];

/** Default počet POKUSOV celkom (nie opakovaní) — D42, D43. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/** Strop čakania podľa `Retry-After` (D42). */
export const DEFAULT_RETRY_AFTER_CAP_S = 90;

/** Timeouty (D44): čítanie 10 s, zápis 30 s. */
export const DEFAULT_READ_TIMEOUT_MS = 10_000;
export const DEFAULT_WRITE_TIMEOUT_MS = 30_000;

/** Pauza medzi zápismi v dávke (D46, I10). Dodržuje ju executor (A9). */
export const DEFAULT_WRITE_PAUSE_MS = 250;

/* ═══════════════════════════ 2. `Retry-After` ═════════════════════════════ */

/**
 * Prečíta hlavičku `Retry-After` (sekundy alebo HTTP dátum) a zastropuje ju
 * na `capSeconds` (D42). Vracia `null`, keď hlavička chýba alebo je nezmyselná
 * — vtedy sa použije backoff.
 */
export function parseRetryAfterSeconds(
  header: string | null | undefined,
  opts: { capSeconds?: number; now?: () => number } = {},
): number | null {
  if (header === null || header === undefined) return null;
  const cap = opts.capSeconds ?? DEFAULT_RETRY_AFTER_CAP_S;
  const raw = header.trim();
  if (raw.length === 0) return null;

  // 1. celé sekundy
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Math.min(Math.max(seconds, 0), cap);
  }

  // 2. HTTP dátum
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  const now = (opts.now ?? Date.now)();
  const seconds = Math.ceil((at - now) / 1000);
  return Math.min(Math.max(seconds, 0), cap);
}

/* ═══════════════════════════ 3. Plán opakovania ═══════════════════════════ */

export interface RetryPolicy {
  /** Počet pokusov celkom (default 3). */
  maxAttempts?: number;
  /** Strop `Retry-After` v sekundách (default 90). */
  retryAfterCapSeconds?: number;
  /** Backoff tabuľka (default 2/4/8 s). */
  backoffMs?: readonly number[];
}

export interface RetryPlan {
  retry: boolean;
  delayMs: number;
  /** Prečo sa (ne)opakuje — ide do logu a do auditu. */
  reason:
    | 'retry_after'
    | 'backoff'
    | 'not_retryable'
    | 'attempts_exhausted';
}

function backoffFor(attempt: number, table: readonly number[]): number {
  if (table.length === 0) return 0;
  const index = Math.min(Math.max(attempt, 1), table.length) - 1;
  return table[index];
}

/**
 * Rozhodne, či sa `attempt`-ý pokus (1-based) má zopakovať a po akej pauze.
 *
 * `retryAfterSeconds` sa berie do úvahy len pri `rate_limited` (D42) — u 500
 * a sieťových chýb má prednosť backoff, aby sa server nezaťažoval podľa vlastnej
 * hlavičky do nekonečna.
 */
export function planRetry(input: {
  kind: ShopErrorKind;
  attempt: number;
  retryAfterSeconds?: number | null;
  policy?: RetryPolicy;
}): RetryPlan {
  const maxAttempts = input.policy?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const cap = input.policy?.retryAfterCapSeconds ?? DEFAULT_RETRY_AFTER_CAP_S;
  const table = input.policy?.backoffMs ?? BACKOFF_MS;

  if (!isRetryableKind(input.kind)) return { retry: false, delayMs: 0, reason: 'not_retryable' };
  if (input.attempt >= maxAttempts) return { retry: false, delayMs: 0, reason: 'attempts_exhausted' };

  if (input.kind === 'rate_limited') {
    const seconds = input.retryAfterSeconds;
    if (seconds !== null && seconds !== undefined && Number.isFinite(seconds)) {
      const capped = Math.min(Math.max(seconds, 0), cap);
      return { retry: true, delayMs: capped * 1000, reason: 'retry_after' };
    }
  }

  return { retry: true, delayMs: backoffFor(input.attempt, table), reason: 'backoff' };
}

/* ══════════════════════════ 4. Vykonanie s retry ══════════════════════════ */

export type AttemptOutcome<T> = { status: 'ok'; value: T } | { status: 'error'; error: ShopError };

export type RetryRunResult<T> =
  | { outcome: 'ok'; value: T; attempts: number }
  | { outcome: 'error'; error: ShopError; attempts: number };

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface RunWithRetryOptions<T> {
  /** Jeden pokus. Nesmie sám nič opakovať (retry je výhradne tu). */
  attempt: (info: { attempt: number }) => Promise<AttemptOutcome<T>>;
  policy?: RetryPolicy;
  /** Injektovateľné pre testy — nikdy sa nečaká reálnych 8 sekúnd. */
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: ShopError; plan: RetryPlan }) => void;
  onGiveUp?: (info: { attempt: number; error: ShopError; plan: RetryPlan }) => void;
}

/**
 * Spustí pokus a podľa taxonómie ho opakuje. Nič nehodí — chyba je hodnota
 * (`ShopError`), aby volajúci vždy mohol rozhodnúť fail-closed.
 */
export async function runWithRetry<T>(opts: RunWithRetryOptions<T>): Promise<RetryRunResult<T>> {
  const doSleep = opts.sleepFn ?? sleep;
  const maxAttempts = opts.policy?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const result = await opts.attempt({ attempt });
    if (result.status === 'ok') return { outcome: 'ok', value: result.value, attempts: attempt };

    const plan = planRetry({
      kind: result.error.kind,
      attempt,
      retryAfterSeconds: result.error.retryAfterSeconds ?? null,
      policy: opts.policy,
    });

    if (!plan.retry) {
      opts.onGiveUp?.({ attempt, error: result.error, plan });
      return { outcome: 'error', error: result.error, attempts: attempt };
    }

    opts.onRetry?.({ attempt, delayMs: plan.delayMs, error: result.error, plan });
    await doSleep(plan.delayMs);

    if (attempt >= maxAttempts) {
      // Obrana proti nezmyselnej politike (maxAttempts < 1 a pod.).
      return { outcome: 'error', error: result.error, attempts: attempt };
    }
  }
}
