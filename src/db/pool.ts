/**
 * Aura Zľavy — MariaDB pool (D89, D91, §2).
 *
 * - Pripája sa VÝHRADNE aplikačným userom (`DB_USER`), ktorý nemá DDL práva
 *   ani `UPDATE`/`DELETE` na `audit_log` (I4). Migrácie beží oddelený user
 *   v `scripts/migrate.ts`.
 * - Heslo sa číta zo súboru (`DB_PASSWORD_FILE`) — v produkcii je to jediná
 *   povolená cesta (D89, I1). Plaintext hesla sa nikdy neloguje.
 * - Retry pripájania podľa D91 (DB kontajner môže nabiehať dlhšie).
 * - `timezone: 'Z'` — všetky `DATETIME` sú v DB v UTC (D31, §2).
 * - `decimalAsNumber: false` — `DECIMAL(10,2)` prichádza ako string, aby sa
 *   s peniazmi nikdy nepočítalo vo float (§2).
 */
import { readFileSync } from 'node:fs';

import mariadb from 'mariadb';
import type { Pool, PoolConnection } from 'mariadb';

import { env } from '@/env';

let pool: Pool | null = null;

function readSecretFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  } catch (cause) {
    // Cesta áno, obsah NIKDY (I1).
    throw new Error(`Nedá sa prečítať súbor s DB heslom: ${path}`, { cause });
  }
}

/** Heslo aplikačného usera — zo súboru, mimo produkcie aj z env (D89). */
export function resolveAppPassword(): string {
  if (env.DB_PASSWORD_FILE) return readSecretFile(env.DB_PASSWORD_FILE);
  if (env.DB_PASSWORD !== undefined) return env.DB_PASSWORD;
  throw new Error('Chýba DB_PASSWORD_FILE (v produkcii povinné) alebo DB_PASSWORD (dev/test).');
}

export function getPool(): Pool {
  if (pool) return pool;
  pool = mariadb.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: resolveAppPassword(),
    connectionLimit: env.DB_CONNECTION_LIMIT,
    // UTC v DB, konverzia do Europe/Bratislava len v domain/dates.ts a v UI (D31).
    timezone: 'Z',
    decimalAsNumber: false,
    bigIntAsNumber: true,
    insertIdAsNumber: true,
    // Vypnuté multi-statement: každý repozitár posiela jeden príkaz (obrana
    // proti SQL injection cez zlepené príkazy).
    multipleStatements: false,
    acquireTimeout: 10_000,
    connectTimeout: 10_000,
    idleTimeout: 60,
    trace: env.NODE_ENV !== 'production',
  });
  return pool;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Spojenie z poolu s retry (D91). Volajúci MUSÍ `release()` vo `finally`.
 */
export async function getConnection(): Promise<PoolConnection> {
  const retries = env.DB_CONNECT_RETRIES;
  const delay = env.DB_CONNECT_RETRY_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await getPool().getConnection();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(delay);
    }
  }
  throw new Error(
    `Nepodarilo sa pripojiť k DB ${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME} ` +
      `po ${retries + 1} pokusoch.`,
    { cause: lastError },
  );
}

/** Jednorazový dotaz s automatickým `release()`. */
export async function query<T = unknown>(sql: string, values?: unknown): Promise<T> {
  const conn = await getConnection();
  try {
    return (await conn.query(sql, values)) as T;
  } finally {
    conn.release();
  }
}

/** Healthcheck DB pre `/api/health` (D91). Nikdy nehodí výnimku. */
export async function pingDb(): Promise<boolean> {
  try {
    const conn = await getPool().getConnection();
    try {
      await conn.ping();
      return true;
    } finally {
      conn.release();
    }
  } catch {
    return false;
  }
}

/** Zavretie poolu — pri `SIGTERM` (D85) a v testoch. */
export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
