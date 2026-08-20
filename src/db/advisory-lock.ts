/**
 * Aura Zľavy — DB advisory locky (D37, D88, I12).
 *
 * MariaDB `GET_LOCK()` je viazaný na SPOJENIE, nie na transakciu. Preto si každý
 * lock drží vlastné spojenie z poolu po celú dobu držania a uvoľní ho až spolu
 * s lockom.
 *
 * Použitie:
 *  - `ovl_zliav_migrate` — migrácie pri štarte (D88), drží `scripts/migrate.ts`.
 *  - `ovl_zliav_write`   — zápisový mutex, druhá poistka vedľa in-process
 *    semaforu, aby ani omylom spustená druhá inštancia nezapisovala (D37, I12).
 */
import type { PoolConnection } from 'mariadb';

import { getConnection } from '@/db/pool';

export interface HeldLock {
  readonly name: string;
  release(): Promise<void>;
}

/**
 * Pokus o získanie locku. `timeoutSeconds = 0` znamená „neblokuj, odmietni hneď"
 * — presne to, čo chce D37 (druhá súbežná operácia sa odmietne, nečaká).
 *
 * Vracia `null`, ak lock drží niekto iný.
 */
export async function tryAcquireLock(
  name: string,
  timeoutSeconds = 0,
): Promise<HeldLock | null> {
  const conn: PoolConnection = await getConnection();
  let acquired = false;
  try {
    const rows = (await conn.query('SELECT GET_LOCK(?, ?) AS got', [
      name,
      timeoutSeconds,
    ])) as Array<{ got: number | null }>;
    acquired = rows[0]?.got === 1;

    if (!acquired) return null;

    return {
      name,
      release: async () => {
        try {
          await conn.query('SELECT RELEASE_LOCK(?) AS released', [name]);
        } finally {
          conn.release();
        }
      },
    };
  } finally {
    if (!acquired) conn.release();
  }
}

/**
 * Získa lock alebo hodí výnimku (fail-closed, I12/I14).
 */
export async function acquireLock(name: string, timeoutSeconds = 0): Promise<HeldLock> {
  const lock = await tryAcquireLock(name, timeoutSeconds);
  if (!lock) {
    throw new Error(
      `Advisory lock "${name}" je obsadený (timeout ${timeoutSeconds} s) — operácia sa odmieta.`,
    );
  }
  return lock;
}

/** Spustí `fn` pod lockom a lock vždy uvolní. */
export async function withLock<T>(
  name: string,
  timeoutSeconds: number,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireLock(name, timeoutSeconds);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
