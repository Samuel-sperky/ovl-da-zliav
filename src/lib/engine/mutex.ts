/**
 * Aura Zľavy — GLOBÁLNY ZÁPISOVÝ MUTEX (BUILD-SPEC §9, D37, I12).
 *
 * Žiadne dve zápisové operácie nesmú bežať súbežne. Mutex má dve vrstvy:
 *   1. **in-process semafor** — jediná inštancia appky (R4/I5) drží boolean;
 *      druhá operácia sa ODMIETNE okamžite, nikdy nečaká (D37),
 *   2. **DB poistka `SELECT GET_LOCK('ovl_zliav_write', 0)`** — keby omylom
 *      bežala druhá inštancia procesu, zastaví ju databáza.
 *
 * Obe vrstvy sú fail-closed: keď sa nedá získať ČOKOĽVEK z nich, operácia
 * nezačne. `tryAcquire()` vracia `null`, `acquire()` hodí `WriteMutexBusyError`.
 *
 * Vlastník: A9.
 */
import type { WriteMutex } from '@/contracts';

import { tryAcquireLock, type HeldLock } from '@/db/advisory-lock';

/** Meno DB advisory locku — zdieľané s dokumentáciou v `db/advisory-lock.ts`. */
export const WRITE_MUTEX_LOCK_NAME = 'ovl_zliav_write';

export class WriteMutexBusyError extends Error {
  readonly code = 'write_in_progress';

  constructor(holder: string | null) {
    super(
      holder === null
        ? 'Prebieha iná zápisová operácia — počkaj, kým dobehne (I12).'
        : `Prebieha iná zápisová operácia („${holder}") — počkaj, kým dobehne (I12).`,
    );
    this.name = 'WriteMutexBusyError';
  }
}

export interface WriteMutexDeps {
  /**
   * DB vrstva locku. Default = `tryAcquireLock` z `db/advisory-lock.ts`.
   * `null` vypne DB vrstvu — VÝHRADNE pre unit testy bez databázy.
   */
  dbLock?: ((name: string, timeoutSeconds: number) => Promise<HeldLock | null>) | null;
  lockName?: string;
}

export interface WriteMutexInstance extends WriteMutex {
  /** Kto mutex práve drží (`null` = voľný). Len na diagnostiku/testy. */
  currentOwner(): string | null;
}

export function createWriteMutex(deps: WriteMutexDeps = {}): WriteMutexInstance {
  const lockName = deps.lockName ?? WRITE_MUTEX_LOCK_NAME;
  const dbLock = deps.dbLock === undefined ? tryAcquireLock : deps.dbLock;

  /** In-process semafor (vrstva 1). */
  let owner: string | null = null;

  async function tryAcquire(who: string): Promise<{ release(): Promise<void> } | null> {
    if (owner !== null) return null;
    // Semafor sa obsadí PRED async DB krokom — medzi `if` a priradením nie je
    // žiadny await, takže dve súbežné volania sa nepredbehnú.
    owner = who;

    let held: HeldLock | null = null;
    if (dbLock !== null) {
      try {
        held = await dbLock(lockName, 0);
      } catch (error) {
        owner = null;
        throw error;
      }
      if (held === null) {
        // DB lock drží niekto iný (druhá inštancia?) — fail-closed.
        owner = null;
        return null;
      }
    }

    let released = false;
    return {
      async release(): Promise<void> {
        if (released) return;
        released = true;
        try {
          await held?.release();
        } finally {
          owner = null;
        }
      },
    };
  }

  return {
    tryAcquire,
    async acquire(who: string): Promise<{ release(): Promise<void> }> {
      const handle = await tryAcquire(who);
      if (handle === null) throw new WriteMutexBusyError(owner);
      return handle;
    },
    currentOwner(): string | null {
      return owner;
    },
  };
}

/** Singleton pre executor, scheduler a route-y — jeden semafor na proces (I12). */
export const writeMutex: WriteMutexInstance = createWriteMutex();
