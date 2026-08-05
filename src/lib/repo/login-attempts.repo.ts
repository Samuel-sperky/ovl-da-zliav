/**
 * Aura Zľavy — repozitár tabuľky `login_attempts` (BUILD-SPEC §3, D71, O4).
 *
 * Toto je JEDINÉ miesto, kde býva stav brute-force lockoutu. KONTRAKT O4 to
 * hovorí normatívne: **in-memory riešenie je zakázané**, blokáda musí prežiť
 * restart appky. Repozitár preto nemá žiadnu cache ani počítadlo v pamäti —
 * každé `getState()` sa pýta DB.
 *
 * Vyhodnotenie („je zamknuté a dokedy") robí čistá politika
 * `src/lib/auth/lockout-policy.ts`, aby sa dala testovať bez DB a aby existovala
 * len jedna definícia exponenciálneho predlžovania.
 *
 * Invarianty držané tu:
 *  - **I1** — do `login_attempts` sa NIKDY nezapisuje heslo ani jeho hash; len
 *    meno, IP a výsledok (§3).
 *  - **I4** — žiadny prístup k `audit_log`; auditné eventy `login_ok`,
 *    `login_fail` a `lockout` zapisuje `lib/auth/lockout.ts` cez `appendAudit()`.
 *
 * Vlastník: A4.
 */
import type { LockoutState, LoginAttemptRecord, LoginAttemptsRepo, Queryable } from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import {
  DEFAULT_LOCKOUT_POLICY,
  evaluateLockout,
  type AttemptRow,
  type LockoutEvaluation,
  type LockoutPolicy,
} from '@/lib/auth/lockout-policy';

/* ─────────────────────────────────── SQL ───────────────────────────────── */

/** `ts` ide z DB ako `UTC_TIMESTAMP(3)` — nie z Node (§2, D31). */
const SQL_INSERT =
  'INSERT INTO login_attempts (username, ip, success, ts) VALUES (?, ?, ?, UTC_TIMESTAMP(3))';

/**
 * Posledné pokusy z danej IP. `ORDER BY ts DESC` + `LIMIT` — séria neúspechov
 * je krátka a tabuľka má index `ix_attempts_ip_ts`.
 */
const SQL_RECENT_BY_IP =
  'SELECT id, username, ip, success, ts FROM login_attempts WHERE ip = ? ORDER BY ts DESC, id DESC LIMIT ?';

/** To isté pre meno (index `ix_attempts_user_ts`) — obrana pri rotujúcich IP. */
const SQL_RECENT_BY_USERNAME =
  'SELECT id, username, ip, success, ts FROM login_attempts WHERE username = ? ORDER BY ts DESC, id DESC LIMIT ?';

const SQL_DELETE_OLDER = 'DELETE FROM login_attempts WHERE ts < ?';

/** Koľko riadkov sa naraz číta. Séria pre level 6 má 30 riadkov, 200 je rezerva. */
export const RECENT_ATTEMPTS_LIMIT = 200;

/** `login_attempts.username` je `VARCHAR(64)`, `ip` je `VARCHAR(45)` (§3). */
export const USERNAME_COLUMN_MAX = 64;
export const IP_COLUMN_MAX = 45;

/** Náhrada za neznámu IP — nikdy `null`, stĺpec je `NOT NULL` (§3). */
export const UNKNOWN_IP = 'unknown';

/**
 * Normalizuje IP pre uloženie: skráti na dĺžku stĺpca, prázdnu hodnotu zmení na
 * `unknown`. Fail-closed: neznáma IP sa počíta ako jedna „spoločná" IP, takže
 * pokusy bez IP nespadnú mimo lockoutu.
 */
export function normalizeIp(ip: unknown): string {
  if (typeof ip !== 'string') return UNKNOWN_IP;
  const trimmed = ip.trim();
  if (trimmed.length === 0) return UNKNOWN_IP;
  return trimmed.slice(0, IP_COLUMN_MAX);
}

/** Normalizuje meno pre uloženie (nikdy neodmietneme zápis pokusu). */
export function normalizeUsername(username: unknown): string {
  if (typeof username !== 'string') return '';
  return username.trim().slice(0, USERNAME_COLUMN_MAX);
}

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface AttemptDbRow {
  id: number;
  username: string;
  ip: string;
  success: number | boolean;
  ts: Date | string;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

function mapRow(row: AttemptDbRow): LoginAttemptRecord {
  return {
    id: Number(row.id),
    username: row.username,
    ip: row.ip,
    success: Boolean(row.success),
    ts: toDate(row.ts),
  };
}

function mapRows(result: unknown): LoginAttemptRecord[] {
  if (!Array.isArray(result)) return [];
  return (result as AttemptDbRow[]).map(mapRow);
}

const toAttemptRows = (records: readonly LoginAttemptRecord[]): AttemptRow[] =>
  records.map((record) => ({ success: record.success, ts: record.ts }));

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface LoginAttemptsRepoDeps {
  /** Politika lockoutu; ENV prepis dodáva `lib/auth/lockout.ts`. */
  policy?: LockoutPolicy;
  /** Injektovateľný čas pre testy. */
  now?: () => Date;
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export interface LoginAttemptsRepository extends LoginAttemptsRepo {
  /** Vyhodnotenie s detailom (úroveň eskalácie) — potrebuje ho audit `lockout`. */
  evaluate(
    ip: string,
    username: string,
    conn?: Queryable,
    policy?: LockoutPolicy,
  ): Promise<LockoutEvaluation>;
  /** Surové posledné pokusy (diagnostika, testy). */
  recentByIp(ip: string, limit?: number, conn?: Queryable): Promise<LoginAttemptRecord[]>;
  recentByUsername(
    username: string,
    limit?: number,
    conn?: Queryable,
  ): Promise<LoginAttemptRecord[]>;
  /** Údržba: pokusy staršie než `days` sa dajú zmazať (nie je to audit, D75). */
  deleteOlderThan(days: number, conn?: Queryable): Promise<number>;
}

/** Prísnejší z dvoch výsledkov — fail-closed (D71). */
function stricter(a: LockoutEvaluation, b: LockoutEvaluation): LockoutEvaluation {
  if (a.locked !== b.locked) return a.locked ? a : b;
  if (a.retryAfterSeconds !== b.retryAfterSeconds) {
    return a.retryAfterSeconds > b.retryAfterSeconds ? a : b;
  }
  return a.failedAttempts >= b.failedAttempts ? a : b;
}

export function createLoginAttemptsRepo(
  deps: LoginAttemptsRepoDeps = {},
): LoginAttemptsRepository {
  const now = deps.now ?? (() => new Date());
  const basePolicy = deps.policy ?? DEFAULT_LOCKOUT_POLICY;

  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: LoginAttemptsRepository = {
    async record(username: string, ip: string, success: boolean, conn?: Queryable): Promise<void> {
      await run(conn, SQL_INSERT, [
        normalizeUsername(username),
        normalizeIp(ip),
        success ? 1 : 0,
      ]);
    },

    async recentByIp(ip: string, limit = RECENT_ATTEMPTS_LIMIT, conn?: Queryable) {
      const rows = await run(conn, SQL_RECENT_BY_IP, [normalizeIp(ip), limit]);
      return mapRows(rows);
    },

    async recentByUsername(username: string, limit = RECENT_ATTEMPTS_LIMIT, conn?: Queryable) {
      const name = normalizeUsername(username);
      if (name.length === 0) return [];
      const rows = await run(conn, SQL_RECENT_BY_USERNAME, [name, limit]);
      return mapRows(rows);
    },

    /**
     * Vyhodnotí IP aj meno a vráti PRÍSNEJŠÍ výsledok. D71 predpisuje lockout
     * per IP; séria na mene je bonus, ktorý zachytí rotujúce IP a nikdy
     * blokádu nezmierňuje.
     */
    async evaluate(ip: string, username: string, conn?: Queryable, policy?: LockoutPolicy) {
      const active = policy ?? basePolicy;
      const at = now();
      const byIp = evaluateLockout(
        toAttemptRows(await repo.recentByIp(ip, RECENT_ATTEMPTS_LIMIT, conn)),
        at,
        active,
      );
      const name = normalizeUsername(username);
      if (name.length === 0) return byIp;
      const byUser = evaluateLockout(
        toAttemptRows(await repo.recentByUsername(name, RECENT_ATTEMPTS_LIMIT, conn)),
        at,
        active,
      );
      return stricter(byIp, byUser);
    },

    /** Tvar podľa kontraktu (`LoginAttemptsRepo.getState`). */
    async getState(ip: string, username: string, conn?: Queryable): Promise<LockoutState> {
      const evaluation = await repo.evaluate(ip, username, conn);
      return {
        locked: evaluation.locked,
        until: evaluation.until,
        failedAttempts: evaluation.failedAttempts,
        retryAfterSeconds: evaluation.retryAfterSeconds,
      };
    },

    async deleteOlderThan(days: number, conn?: Queryable): Promise<number> {
      if (!Number.isFinite(days) || days <= 0) return 0;
      const threshold = new Date(now().getTime() - days * 86_400_000);
      const result = (await run<{ affectedRows?: number }>(conn, SQL_DELETE_OLDER, [threshold])) ?? {};
      return typeof result.affectedRows === 'number' ? result.affectedRows : 0;
    },
  };

  return repo;
}

/** Singleton pre auth vrstvu a route-y. */
export const loginAttemptsRepo: LoginAttemptsRepository = createLoginAttemptsRepo();
