/**
 * Aura Zľavy — repozitár singleton tabuľky `scheduler_state` (BUILD-SPEC §3, D87, O3).
 *
 * Heartbeat schedulera: každý tick zapíše `last_tick_at`, trvanie a inkrementuje
 * `tick_count`. Tabuľka má PRESNE jeden riadok (`id = 1`, CHECK) — repozitár
 * nikdy nevytvorí druhý; jediný `INSERT` je idempotentná obnova
 * `INSERT IGNORE (id) VALUES (1)`.
 *
 * I4: žiadny prístup k `audit_log`. Vlastník: A8.
 */
import type { Queryable, SchedulerStateRecord, SchedulerStateRepo } from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS = 'id, last_tick_at, last_tick_duration_ms, tick_count, last_error, updated_at';

const SQL_GET = `SELECT ${COLUMNS} FROM scheduler_state WHERE id = 1 LIMIT 1`;
const SQL_ENSURE = 'INSERT IGNORE INTO scheduler_state (id) VALUES (1)';
const SQL_HEARTBEAT =
  'UPDATE scheduler_state SET last_tick_at = UTC_TIMESTAMP(3), last_tick_duration_ms = ?, ' +
  'tick_count = tick_count + 1, last_error = ? WHERE id = 1';

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface SchedulerStateRow {
  id: number;
  last_tick_at: Date | string | null;
  last_tick_duration_ms: number | null;
  tick_count: number | bigint;
  last_error: string | null;
  updated_at: Date | string;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

function mapRow(row: SchedulerStateRow): SchedulerStateRecord {
  return {
    id: 1,
    lastTickAt: row.last_tick_at == null ? null : toDate(row.last_tick_at),
    lastTickDurationMs: row.last_tick_duration_ms == null ? null : Number(row.last_tick_duration_ms),
    tickCount: Number(row.tick_count),
    lastError: row.last_error,
    updatedAt: toDate(row.updated_at),
  };
}

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface SchedulerStateRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createSchedulerStateRepo(deps: SchedulerStateRepoDeps = {}): SchedulerStateRepo {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: SchedulerStateRepo = {
    async get(conn?: Queryable): Promise<SchedulerStateRecord> {
      let rows = await run<SchedulerStateRow[]>(conn, SQL_GET, []);
      if (!Array.isArray(rows) || rows.length === 0) {
        await run(conn, SQL_ENSURE, []);
        rows = await run<SchedulerStateRow[]>(conn, SQL_GET, []);
      }
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) throw new Error('Singleton riadok scheduler_state (id=1) sa nedá načítať.');
      return mapRow(row);
    },

    async heartbeat(durationMs: number, lastError: string | null, conn?: Queryable): Promise<void> {
      const duration = Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : 0;
      const error = lastError == null ? null : lastError.slice(0, 500);
      await run(conn, SQL_HEARTBEAT, [duration, error]);
    },
  };

  return repo;
}

/** Singleton pre scheduler a `/api/health`. */
export const schedulerStateRepo: SchedulerStateRepo = createSchedulerStateRepo();
