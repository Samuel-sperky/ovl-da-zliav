/**
 * Aura Zľavy — brute-force lockout (D71, KONTRAKT O4, I1).
 *
 * `5 pokusov / 15 min per IP + exponenciálne predlžovanie`, stav v tabuľke
 * `login_attempts` — NIKDY v pamäti procesu (O4). Restart appky blokádu
 * nezmaže, pretože sa počíta výhradne z DB riadkov.
 *
 * Rozdelenie zodpovednosti:
 *  - `lockout-policy.ts` — čistá matematika (koľko neúspechov = aká blokáda),
 *  - `repo/login-attempts.repo.ts` — riadky v DB,
 *  - tento modul — služba pre route-y a pipeline: „smie tento pokus prebehnúť?",
 *    zápis pokusu a **audit každého pokusu** (D71: úspešný aj neúspešný).
 *
 * Ďalšie rozhodnutia:
 *  - **CAPTCHA sa NEIMPLEMENTUJE** (D71) — jedinou obranou je toto počítadlo.
 *  - **Fail-closed:** keď sa stav lockoutu nedá zistiť (chyba DB), pokus sa
 *    ODMIETNE. Prihlásenie je jediná cesta k zápisom do produkcie (I3), takže
 *    „radšej nepustiť" je správny smer.
 *  - **I1** — do auditu ani do logu nikdy nejde heslo; len meno, IP, výsledok.
 *  - **I4** — audit ide výhradne cez `appendAudit()` z A2.
 *
 * Vlastník: A4.
 */
import type { AuditInput, LockoutState, Queryable } from '@/contracts';

import { env } from '@/env';
import { appendAudit } from '@/lib/audit/write';
import {
  DEFAULT_LOCKOUT_POLICY,
  type LockoutEvaluation,
  type LockoutPolicy,
} from '@/lib/auth/lockout-policy';
import { logger } from '@/lib/log/logger';
import { loginAttemptsRepo, normalizeIp, normalizeUsername } from '@/lib/repo/login-attempts.repo';

export type { LockoutPolicy } from '@/lib/auth/lockout-policy';

/** Kód, ktorý pipeline (A5) mapuje na HTTP 429 (§5). */
export const LOCKOUT_ERROR_CODE = 'too_many_attempts';

/**
 * Odmietnutý pokus o prihlásenie/sudo. `retryAfterSeconds` ide do hlavičky
 * `Retry-After` (§5, D71).
 */
export class LockoutError extends Error {
  readonly code = LOCKOUT_ERROR_CODE;
  readonly retryAfterSeconds: number;
  readonly until: Date | null;

  constructor(message: string, retryAfterSeconds: number, until: Date | null) {
    super(message);
    this.name = 'LockoutError';
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
    this.until = until;
  }
}

/** Politika z ENV (§11: `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES`). */
export function lockoutPolicyFromEnv(): LockoutPolicy {
  return {
    maxAttempts: env.LOGIN_MAX_ATTEMPTS,
    windowMinutes: env.LOGIN_WINDOW_MINUTES,
    maxLockMinutes: DEFAULT_LOCKOUT_POLICY.maxLockMinutes,
    decayMinutes: DEFAULT_LOCKOUT_POLICY.decayMinutes,
  };
}

/** Slovenská hláška pre UI aj pre `LockoutError`. */
export function lockoutMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return (
    `Príliš veľa neúspešných pokusov o prihlásenie. Skús to znova za ${minutes} ` +
    `${minutes === 1 ? 'minútu' : minutes < 5 ? 'minúty' : 'minút'} (D71).`
  );
}

/* ──────────────────────────────── kontext ──────────────────────────────── */

export interface AttemptContext {
  username: string;
  ip: string;
  userAgent?: string | null;
  /** ID usera, keď je známe (úspešné prihlásenie, sudo v existujúcej session). */
  userId?: number | null;
  /** Spojenie v transakcii; bez neho ide zápis cez pool. */
  conn?: Queryable;
}

/* ──────────────────────────────── služba ───────────────────────────────── */

type AttemptsRepoLike = Pick<typeof loginAttemptsRepo, 'record' | 'evaluate' | 'getState'>;

export interface LockoutServiceOptions {
  repo?: AttemptsRepoLike;
  audit?: (input: AuditInput, conn?: Queryable) => Promise<void>;
  policy?: LockoutPolicy;
  now?: () => Date;
}

export interface LockoutService {
  /** Stav pre UI a pre pipeline (tvar podľa kontraktu). */
  getState(ip: string, username: string, conn?: Queryable): Promise<LockoutState>;
  /**
   * Fail-closed vrátnik PRED overením hesla. Hodí `LockoutError`, keď je
   * blokáda aktívna, alebo keď sa stav nepodarilo zistiť.
   * Odmietnutý pokus zapíše audit `lockout`.
   */
  assertAllowed(context: AttemptContext): Promise<LockoutState>;
  /** Zaznamená neúspech: riadok v `login_attempts` + audit `login_fail` (+ `lockout`). */
  recordFailure(
    context: AttemptContext,
    detail?: { eventType?: 'login_fail' | 'sudo_fail'; message?: string },
  ): Promise<LockoutState>;
  /** Zaznamená úspech: riadok v `login_attempts` + audit `login_ok`/`sudo_ok`. */
  recordSuccess(
    context: AttemptContext,
    detail?: { eventType?: 'login_ok' | 'sudo_ok'; message?: string },
  ): Promise<void>;
}

export function createLockoutService(options: LockoutServiceOptions = {}): LockoutService {
  const repo = options.repo ?? loginAttemptsRepo;
  const audit = options.audit ?? appendAudit;

  const policyOf = (): LockoutPolicy => {
    if (options.policy) return options.policy;
    try {
      return lockoutPolicyFromEnv();
    } catch {
      // Bez ENV sa nechováme voľnejšie než default (fail-closed).
      return DEFAULT_LOCKOUT_POLICY;
    }
  };

  const evaluate = async (
    ip: string,
    username: string,
    conn?: Queryable,
  ): Promise<LockoutEvaluation> => repo.evaluate(normalizeIp(ip), normalizeUsername(username), conn, policyOf());

  const service: LockoutService = {
    async getState(ip: string, username: string, conn?: Queryable): Promise<LockoutState> {
      const evaluation = await evaluate(ip, username, conn);
      return {
        locked: evaluation.locked,
        until: evaluation.until,
        failedAttempts: evaluation.failedAttempts,
        retryAfterSeconds: evaluation.retryAfterSeconds,
      };
    },

    async assertAllowed(context: AttemptContext): Promise<LockoutState> {
      const ip = normalizeIp(context.ip);
      const username = normalizeUsername(context.username);

      let evaluation: LockoutEvaluation;
      try {
        evaluation = await evaluate(ip, username, context.conn);
      } catch (error) {
        // Nevieme, či je zamknuté → NEPUSTÍME (fail-closed, I3).
        logger.error('lockout_state_unavailable', {
          ip,
          reason: error instanceof Error ? error.message : String(error),
        });
        const policy = policyOf();
        throw new LockoutError(
          'Stav ochrany proti hádaniu hesla sa nedá zistiť — prihlásenie je zablokované (D71).',
          policy.windowMinutes * 60,
          null,
        );
      }

      if (!evaluation.locked) {
        return {
          locked: false,
          until: evaluation.until,
          failedAttempts: evaluation.failedAttempts,
          retryAfterSeconds: evaluation.retryAfterSeconds,
        };
      }

      await audit(
        {
          actor: 'user',
          eventType: 'lockout',
          ok: false,
          userId: context.userId ?? null,
          message:
            `pokus zamietnutý — blokáda do ${evaluation.until?.toISOString() ?? '?'} ` +
            `(neúspechov ${evaluation.failedAttempts}, úroveň ${evaluation.level})`,
          ip,
          userAgent: context.userAgent ?? null,
        },
        context.conn,
      );

      throw new LockoutError(
        lockoutMessage(evaluation.retryAfterSeconds),
        evaluation.retryAfterSeconds,
        evaluation.until,
      );
    },

    async recordFailure(context, detail): Promise<LockoutState> {
      const ip = normalizeIp(context.ip);
      const username = normalizeUsername(context.username);

      await repo.record(username, ip, false, context.conn);

      const evaluation = await evaluate(ip, username, context.conn);

      // D71 — KAŽDÝ pokus je v audite. Heslo v ňom nikdy nie je (I1).
      await audit(
        {
          actor: 'user',
          eventType: detail?.eventType ?? 'login_fail',
          ok: false,
          userId: context.userId ?? null,
          message:
            detail?.message ??
            `neúspešný pokus (${evaluation.failedAttempts}. v sérii, meno "${username}")`,
          ip,
          userAgent: context.userAgent ?? null,
        },
        context.conn,
      );

      // Prechod do blokády je samostatný event, aby bol v audite viditeľný.
      if (evaluation.locked) {
        await audit(
          {
            actor: 'user',
            eventType: 'lockout',
            ok: false,
            userId: context.userId ?? null,
            message:
              `blokáda aktivovaná do ${evaluation.until?.toISOString() ?? '?'} ` +
              `(úroveň ${evaluation.level}, neúspechov ${evaluation.failedAttempts})`,
            ip,
            userAgent: context.userAgent ?? null,
          },
          context.conn,
        );
      }

      return {
        locked: evaluation.locked,
        until: evaluation.until,
        failedAttempts: evaluation.failedAttempts,
        retryAfterSeconds: evaluation.retryAfterSeconds,
      };
    },

    async recordSuccess(context, detail): Promise<void> {
      const ip = normalizeIp(context.ip);
      const username = normalizeUsername(context.username);

      // Úspešný pokus vynuluje sériu (viď `lockout-policy.ts`).
      await repo.record(username, ip, true, context.conn);

      await audit(
        {
          actor: 'user',
          eventType: detail?.eventType ?? 'login_ok',
          ok: true,
          userId: context.userId ?? null,
          message: detail?.message ?? `úspešné prihlásenie (meno "${username}")`,
          ip,
          userAgent: context.userAgent ?? null,
        },
        context.conn,
      );
    },
  };

  return service;
}

/* ───────────────────────────── default instancia ───────────────────────── */

let defaultService: LockoutService | null = null;

function getDefaultService(): LockoutService {
  if (!defaultService) defaultService = createLockoutService();
  return defaultService;
}

export const getLockoutState = (
  ip: string,
  username: string,
  conn?: Queryable,
): Promise<LockoutState> => getDefaultService().getState(ip, username, conn);

export const assertLoginAllowed = (context: AttemptContext): Promise<LockoutState> =>
  getDefaultService().assertAllowed(context);

export const recordLoginFailure = (
  context: AttemptContext,
  detail?: { eventType?: 'login_fail' | 'sudo_fail'; message?: string },
): Promise<LockoutState> => getDefaultService().recordFailure(context, detail);

export const recordLoginSuccess = (
  context: AttemptContext,
  detail?: { eventType?: 'login_ok' | 'sudo_ok'; message?: string },
): Promise<void> => getDefaultService().recordSuccess(context, detail);

/** Výhradne pre testy — zabudne default instanciu. */
export function resetDefaultLockoutService(): void {
  defaultService = null;
}
