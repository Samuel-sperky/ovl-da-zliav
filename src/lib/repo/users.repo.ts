/**
 * Aura Zľavy — repozitár tabuľky `users` (BUILD-SPEC §3, R9, D101, I1).
 *
 * 27. 8. 2026 (D99, D100) appka prišla o prihlásenie aj o sudo, a s nimi
 * o `src/lib/auth/password.ts`. Tabuľka `users` a jediný riadok v nej
 * (`samuel`, id 1) ZOSTALI (D101): `campaigns.created_by` a `audit_log.user_id`
 * na ňu majú FK `ON DELETE RESTRICT`, takže bez nej sa nezapíše ani kampaň, ani
 * auditný riadok. Odteraz je jedinou úlohou tohto repozitára ČÍTANIE riadku —
 * heslo tu už nikto nemení.
 *
 * POZOR PRI ČÍTANÍ: k 27. 8. 2026 tento modul NEIMPORTUJE nikto. Dohľadanie
 * lokálneho actora (D102) si `src/lib/auth/local-actor.ts` robí vlastným SQL,
 * lebo potrebuje aj INSERT na čerstvej inštalácii. Súbor zostáva podľa §5
 * kontraktu `KONTRAKT-BEZ-LOGINU-2026-08-27.md` ako jediná čítacia cesta
 * k `users` — nie preto, že ho niečo volá. Keď sa sem actor raz presunie,
 * začne sa volať `getById()`/`getByUsername()`.
 *
 * Invarianty držané tu:
 *  - **I1** — `password_hash` sa nikdy neloguje ani nevracia do UI; do
 *    `UserRecord` patrí, pretože ho nesie stĺpec, ale meno poľa `passwordHash`
 *    je v denylistě redaktora (A2), takže aj náhodné logovanie celého recordu
 *    je maskované.
 *  - **I4** — tento súbor NEOBSAHUJE žiadny prístup k `audit_log`.
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

/* 27. 8. 2026 (D99): `SQL_UPSERT` a `SQL_TOUCH_LOGIN` zmazané spolu s
   `upsertAdmin()`/`touchLastLogin()` — tento repozitár už do `users` NEZAPISUJE
   vôbec. Riadok (`samuel`, id 1) zakladá `src/lib/auth/local-actor.ts` (D102). */

/** `users.username` je `VARCHAR(64)` (§3). */
export const USERNAME_MAX_LENGTH = 64;
/* `USERNAME_MIN_LENGTH` zmazaná 27. 8. 2026 (D99): dolnú hranicu kontroloval
   len `upsertAdmin()`, a ten je zmazaný. Čítanie hranicu nepotrebuje. */

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

/**
 * Zhoda s kontraktom `UsersRepo`. `countUsers()` (onboarding D20),
 * `setPasswordHash()` (zmena hesla), `upsertAdmin()` a `touchLastLogin()` tu
 * stáli do 27. 8. 2026 — po D99 ich nemalo čo volať, tak sú zmazané.
 */
export type UsersRepository = UsersRepo;

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

    /* 27. 8. 2026 (D99): `upsertAdmin()` a `touchLastLogin()` zmazané spolu so
       svojimi deklaráciami v `UsersRepo` (`src/contracts.ts`). Nevolalo ich nič
       — `seed-admin`, onboarding aj prihlásenie zmizli — a `upsertAdmin()`
       navyše držal jediný živý výskyt argon2-hash prefixu v `src/`, čo je
       proti K6 kontraktu `KONTRAKT-BEZ-LOGINU-2026-08-27.md`. Stĺpce
       `password_hash` a `last_login_at` v DB zostali nedotknuté (D101). */
  };

  return repo;
}

/** Singleton pre route-y a dohľadanie lokálneho actora (D102). */
export const usersRepo: UsersRepository = createUsersRepo();
