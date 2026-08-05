/**
 * Aura Zľavy — repozitár singleton tabuľky `settings` (BUILD-SPEC §3, D79, D80).
 *
 * Tabuľka má PRESNE jeden riadok (`id = 1`, CHECK `ck_settings_singleton`).
 * Tento repozitár NIKDY nevytvorí druhý riadok — všetky zápisy sú
 * `UPDATE … WHERE id = 1` a jediný `INSERT` je `INSERT IGNORE (id) VALUES (1)`
 * ako obnova po prípadnom TRUNCATE (idempotentný, druhý riadok nevznikne).
 *
 * Invarianty držané tu:
 *  - **I4** — žiadny prístup k `audit_log`; event `writes_locked`/`writes_unlocked`
 *    zapisuje volajúci cez `appendAudit()` (A2).
 *  - **I12** — `lockWrites()` je fail-closed runaway zámok (D79); odomknutie je
 *    výhradne explicitné `unlockWrites()`.
 *
 * Vlastník: A8.
 */
import type { Queryable, SettingsRecord, SettingsRepo, UtcDate } from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS =
  'id, shop_domain, shop_domain_confirmed_at, eager_write_default, writes_locked, ' +
  'writes_locked_reason, writes_locked_at, onboarding_done_at, updated_at';

const SQL_GET = `SELECT ${COLUMNS} FROM settings WHERE id = 1 LIMIT 1`;
/** Idempotentná obnova singletonu — NIKDY nevytvorí druhý riadok. */
const SQL_ENSURE = 'INSERT IGNORE INTO settings (id) VALUES (1)';
const SQL_SET_DOMAIN =
  'UPDATE settings SET shop_domain = ?, shop_domain_confirmed_at = ? WHERE id = 1';
const SQL_SET_EAGER = 'UPDATE settings SET eager_write_default = ? WHERE id = 1';
const SQL_LOCK =
  'UPDATE settings SET writes_locked = 1, writes_locked_reason = ?, ' +
  'writes_locked_at = UTC_TIMESTAMP(3) WHERE id = 1';
const SQL_UNLOCK =
  'UPDATE settings SET writes_locked = 0, writes_locked_reason = NULL, ' +
  'writes_locked_at = NULL WHERE id = 1';
const SQL_ONBOARDING = 'UPDATE settings SET onboarding_done_at = UTC_TIMESTAMP(3) WHERE id = 1';

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface SettingsRow {
  id: number;
  shop_domain: string | null;
  shop_domain_confirmed_at: Date | string | null;
  eager_write_default: number | boolean;
  writes_locked: number | boolean;
  writes_locked_reason: string | null;
  writes_locked_at: Date | string | null;
  onboarding_done_at: Date | string | null;
  updated_at: Date | string;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));
const toDateOrNull = (value: Date | string | null): Date | null =>
  value == null ? null : toDate(value);

function mapRow(row: SettingsRow): SettingsRecord {
  return {
    id: 1,
    shopDomain: row.shop_domain,
    shopDomainConfirmedAt: toDateOrNull(row.shop_domain_confirmed_at),
    eagerWriteDefault: Boolean(row.eager_write_default),
    writesLocked: Boolean(row.writes_locked),
    writesLockedReason: row.writes_locked_reason,
    writesLockedAt: toDateOrNull(row.writes_locked_at),
    onboardingDoneAt: toDateOrNull(row.onboarding_done_at),
    updatedAt: toDate(row.updated_at),
  };
}

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface SettingsRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createSettingsRepo(deps: SettingsRepoDeps = {}): SettingsRepo {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: SettingsRepo = {
    async get(conn?: Queryable): Promise<SettingsRecord> {
      let rows = await run<SettingsRow[]>(conn, SQL_GET, []);
      if (!Array.isArray(rows) || rows.length === 0) {
        // Riadok vytvára migrácia 0001; toto je len obnova po TRUNCATE v testoch.
        await run(conn, SQL_ENSURE, []);
        rows = await run<SettingsRow[]>(conn, SQL_GET, []);
      }
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) throw new Error('Singleton riadok settings (id=1) sa nedá načítať.');
      return mapRow(row);
    },

    async setShopDomain(
      domain: string,
      confirmedAt: UtcDate | null,
      conn?: Queryable,
    ): Promise<void> {
      // Normalizáciu a validáciu domény vlastní A7 — tu len zápis.
      await run(conn, SQL_SET_DOMAIN, [domain, confirmedAt]);
    },

    async setEagerWriteDefault(enabled: boolean, conn?: Queryable): Promise<void> {
      await run(conn, SQL_SET_EAGER, [enabled ? 1 : 0]);
    },

    async lockWrites(reason: string, conn?: Queryable): Promise<void> {
      // Fail-closed (D79, I12): dôvod sa oreže na dĺžku stĺpca, zámok padne vždy.
      await run(conn, SQL_LOCK, [reason.slice(0, 191)]);
    },

    async unlockWrites(conn?: Queryable): Promise<void> {
      await run(conn, SQL_UNLOCK, []);
    },

    async markOnboardingDone(conn?: Queryable): Promise<void> {
      await run(conn, SQL_ONBOARDING, []);
    },
  };

  return repo;
}

/** Singleton pre route-y, engine a scheduler. */
export const settingsRepo: SettingsRepo = createSettingsRepo();
