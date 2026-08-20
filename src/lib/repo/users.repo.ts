/**
 * Aura Zľavy — repozitár tabuľky `users` (BUILD-SPEC §3, R9, D68, I1).
 *
 * Jediný user je admin (Samuel) — roly sa neimplementujú (R9). Repozitár drží
 * výhradne prácu s riadkom; politiku hesla, hashovanie a overovanie vlastní
 * `src/lib/auth/password.ts`, aby sa argon2 nikdy nevolal z dvoch miest.
 *
 * Invarianty držané tu:
 *  - **I1** — `password_hash` sa nikdy neloguje ani nevracia do UI; do
 *    `UserRecord` patrí, pretože ho potrebuje `verifyPassword()`, ale meno poľa
 *    `passwordHash` je v denylistě redaktora (A2), takže aj náhodné logovanie
 *    celého recordu je maskované.
 *  - **I4** — tento súbor NEOBSAHUJE žiadny prístup k `audit_log`; auditné
 *    eventy `login_ok`/`login_fail`/`sudo_*` zapisuje `lib/auth/*` cez
 *    `appendAudit()`.
 *  - **§2** — časy sú v DB v UTC (`DATETIME(3)`), driver ich vracia ako `Date`.
 *
 * Vlastník: A4.
 */
import type { Queryable, UserRecord, UsersRepo } from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS = 'id, username, password_hash, created_at, updated_at, last_login_at';

const SQL_BY_USERNAME = `SELECT ${COLUMNS} FROM users WHERE username = ? LIMIT 1`;
const SQL_BY_ID = `SELECT ${COLUMNS} FROM users WHERE id = ? LIMIT 1`;
const SQL_UPSERT =
  'INSERT INTO users (username, password_hash) VALUES (?, ?) ' +
  'ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)';
const SQL_TOUCH_LOGIN = 'UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?';
const SQL_SET_HASH = 'UPDATE users SET password_hash = ? WHERE id = ?';
const SQL_COUNT = 'SELECT COUNT(*) AS total FROM users';

/** `users.username` je `VARCHAR(64)` (§3). */
export const USERNAME_MAX_LENGTH = 64;
/** Minimum kopíruje `scripts/seed-admin.ts` (A0). */
export const USERNAME_MIN_LENGTH = 3;

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

function mapRow(row: UserRow): UserRecord {
  return {
    id: Number(row.id),
    username: row.username,
    passwordHash: row.password_hash,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    lastLoginAt: row.last_login_at ? toDate(row.last_login_at) : null,
  };
}

function firstRow(result: unknown): UserRow | null {
  if (!Array.isArray(result) || result.length === 0) return null;
  return result[0] as UserRow;
}

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface UsersRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export interface UsersRepository extends UsersRepo {
  /** Existuje vôbec admin? Podklad pre onboarding (D20) a boot kontroly. */
  countUsers(conn?: Queryable): Promise<number>;
  /** Zmena hesla existujúceho usera (hash počíta `lib/auth/password.ts`). */
  setPasswordHash(id: number, passwordHash: string, conn?: Queryable): Promise<boolean>;
}

export function createUsersRepo(deps: UsersRepoDeps = {}): UsersRepository {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: UsersRepository = {
    async getByUsername(username: string, conn?: Queryable): Promise<UserRecord | null> {
      if (typeof username !== 'string' || username.length === 0) return null;
      // Dlhší vstup než stĺpec sa do DB neposiela — nemá čo trafiť.
      if (username.length > USERNAME_MAX_LENGTH) return null;
      const row = firstRow(await run(conn, SQL_BY_USERNAME, [username]));
      return row ? mapRow(row) : null;
    },

    async getById(id: number, conn?: Queryable): Promise<UserRecord | null> {
      if (!Number.isInteger(id) || id <= 0) return null;
      const row = firstRow(await run(conn, SQL_BY_ID, [id]));
      return row ? mapRow(row) : null;
    },

    /**
     * Vytvorí alebo prepíše admina. Volá to `scripts/seed-admin.ts` (A0 má
     * vlastnú kópiu SQL, aby skript nemusel importovať `src/`) a onboarding.
     * `passwordHash` MUSÍ byť už hotový argon2id hash — plaintext sem nikdy
     * nechodí (I1).
     */
    async upsertAdmin(username: string, passwordHash: string, conn?: Queryable): Promise<UserRecord> {
      const name = typeof username === 'string' ? username.trim() : '';
      if (name.length < USERNAME_MIN_LENGTH || name.length > USERNAME_MAX_LENGTH) {
        throw new Error(
          `Prihlasovacie meno musí mať ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} znakov.`,
        );
      }
      if (typeof passwordHash !== 'string' || !passwordHash.startsWith('$argon2id$')) {
        throw new Error('Do users.password_hash sa smie zapísať výhradne argon2id hash (D68).');
      }
      await run(conn, SQL_UPSERT, [name, passwordHash]);
      const row = firstRow(await run(conn, SQL_BY_USERNAME, [name]));
      if (!row) throw new Error(`User "${name}" sa po zápise nedá načítať.`);
      return mapRow(row);
    },

    async touchLastLogin(id: number, conn?: Queryable): Promise<void> {
      if (!Number.isInteger(id) || id <= 0) return;
      await run(conn, SQL_TOUCH_LOGIN, [id]);
    },

    async countUsers(conn?: Queryable): Promise<number> {
      const result = await run<Array<{ total: number | bigint }>>(conn, SQL_COUNT, []);
      const total = Array.isArray(result) ? result[0]?.total : 0;
      return Number(total ?? 0);
    },

    async setPasswordHash(id: number, passwordHash: string, conn?: Queryable): Promise<boolean> {
      if (!Number.isInteger(id) || id <= 0) return false;
      if (typeof passwordHash !== 'string' || !passwordHash.startsWith('$argon2id$')) {
        throw new Error('Do users.password_hash sa smie zapísať výhradne argon2id hash (D68).');
      }
      const result = (await run<{ affectedRows?: number }>(conn, SQL_SET_HASH, [passwordHash, id])) ?? {};
      return typeof result.affectedRows === 'number' ? result.affectedRows > 0 : false;
    },
  };

  return repo;
}

/** Singleton pre route-y a auth vrstvu. */
export const usersRepo: UsersRepository = createUsersRepo();
