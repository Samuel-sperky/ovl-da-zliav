/**
 * Aura Zľavy — migrácia 0013 a pokrok dvojdňového behu katalógu
 * (KONTRAKT-DOKONCENIE-2026-08-12: A2, A4; KONTRAKT V3: K7).
 *
 * Prečo tento súbor existuje popri `test/unit/catalog-sync.spec.ts`: unit testy
 * dokazujú SPRÁVANIE nad pamäťou, tento dokazuje, že pokrok naozaj prežije —
 * teda že tabuľky vznikli, že do nich aplikačný user smie písať (D89, granty
 * z 0013) a že hodnoty prejdú cez MariaDB tam a späť bez straty.
 *
 * Čo sa tu overuje:
 *  1. `catalog_sync_state` je singleton — druhý riadok DB odmietne (CHECK).
 *  2. Pokrok prežije „reštart appky": nová inštancia repozitára ho prečíta.
 *  3. `shop_read_budget` počíta na (dráhu, UTC deň) a PRIPOČÍTAVA, nikdy
 *    neprepisuje — dva zdroje čítaní si spotrebu nesmú vynulovať.
 *  4. Dráhy `anon` a `orders` sa nezlievajú.
 *  5. Aplikačný user má na oboch tabuľkách presne to, čo potrebuje.
 *
 * Beží proti REÁLNEJ testovacej MariaDB tým istým runnerom ako produkcia.
 * Bez dostupnej DB sa blok korektne preskočí.
 *
 * Vlastník: V7.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCatalogRepo, emptyCatalogProgress } from '@/lib/repo/catalog.repo';
import { createReadBudgetStore } from '@/lib/repo/read-budget.repo';
import { createReadBudget } from '@/lib/shop/read-budget';

import { dbAvailable, setupTestDb, withAppConn, withMigrationConn } from '../helpers/db';

const available = await dbAvailable();

/** Tento súbor po sebe upratuje sám — `truncateAll()` tieto tabuľky nepozná. */
async function resetCatalogState(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('DELETE FROM shop_read_budget');
    await conn.query('UPDATE catalog_sync_state SET per_page = 100, last_page = 0, ' +
      'shop_total = NULL, rows_written = 0, completed = 0, started_at = NULL, ' +
      'last_read_at = NULL, finished_at = NULL, paused_until = NULL, ' +
      'pause_reason = NULL, last_error = NULL WHERE id = 1');
  });
}

describe.skipIf(!available)('0013 — pokrok katalógu a zdieľaný rozpočet čítaní', () => {
  beforeAll(async () => {
    await setupTestDb();
    await resetCatalogState();
  });

  afterAll(async () => {
    await resetCatalogState();
  });

  it('migrácia založila riadok pokroku a je práve jeden', async () => {
    await withAppConn(async (conn) => {
      const rows = (await conn.query('SELECT id FROM catalog_sync_state')) as Array<{ id: number }>;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.id)).toBe(1);
    });
  });

  it('druhý riadok pokroku DB odmietne — jeden katalóg, jeden pokrok', async () => {
    await withAppConn(async (conn) => {
      await expect(
        conn.query('INSERT INTO catalog_sync_state (id) VALUES (2)'),
      ).rejects.toThrow();
    });
  });

  it('pokrok prežije reštart appky — nová inštancia repozitára ho prečíta', async () => {
    await withAppConn(async (conn) => {
      const writer = createCatalogRepo({ defaultConn: conn });
      await writer.saveSyncProgress({
        ...emptyCatalogProgress(),
        perPage: 100,
        lastPage: 30,
        shopTotal: 41_082,
        rowsWritten: 3_000,
        completed: false,
        startedAt: new Date('2026-08-11T21:00:00.000Z'),
        lastReadAt: new Date('2026-08-12T09:59:00.000Z'),
        pausedUntil: new Date('2026-08-13T00:00:00.000Z'),
        pauseReason: 'daily_budget',
        lastError: null,
      });

      // Iná inštancia = to isté, čo appka po reštarte.
      const reader = createCatalogRepo({ defaultConn: conn });
      const progress = await reader.loadSyncProgress();

      expect(progress.lastPage).toBe(30);
      expect(progress.perPage).toBe(100);
      expect(progress.shopTotal).toBe(41_082);
      expect(progress.rowsWritten).toBe(3_000);
      expect(progress.completed).toBe(false);
      expect(progress.pauseReason).toBe('daily_budget');
      expect(progress.pausedUntil?.toISOString()).toBe('2026-08-13T00:00:00.000Z');
      // A2 — z takého pokroku beh pokračuje stránkou 31, nie stránkou 1.
      expect(progress.lastPage + 1).toBe(31);
    });
  });

  it('`last_error` je kód a orezáva sa na dĺžku stĺpca (I1)', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      await repo.saveSyncProgress({
        ...emptyCatalogProgress(),
        lastError: 'x'.repeat(500),
      });
      const progress = await repo.loadSyncProgress();
      expect(progress.lastError?.length).toBe(200);
    });
  });

  it('rozpočet sa PRIPOČÍTAVA a je zdieľaný medzi čitateľmi', async () => {
    await withAppConn(async (conn) => {
      const store = createReadBudgetStore({ defaultConn: conn });
      const now = (): Date => new Date('2026-08-12T10:00:00.000Z');
      const catalog = createReadBudget({ store, lane: 'anon', now });
      const other = createReadBudget({ store, lane: 'anon', now });

      const first = await catalog.reserve(10);
      expect(first.granted).toBe(10);
      const second = await other.reserve(5);
      expect(second.status.used).toBe(15);

      // Tretí pohľad na to isté počítadlo vidí súčet oboch, nie posledný zápis.
      expect((await catalog.status()).used).toBe(15);
    });
  });

  it('dráhy sa nezlievajú — objednávkové čítania neuberajú katalógu', async () => {
    await withAppConn(async (conn) => {
      const store = createReadBudgetStore({ defaultConn: conn });
      const now = (): Date => new Date('2026-08-12T10:00:00.000Z');
      await createReadBudget({ store, lane: 'orders', now }).reserve(7);

      const anon = await createReadBudget({ store, lane: 'anon', now }).status();
      const orders = await createReadBudget({ store, lane: 'orders', now }).status();

      expect(orders.used).toBe(7);
      // `anon` je z predchádzajúceho testu na 15 — dôležité je, že sa nezmenil.
      expect(anon.used).toBe(15);
      /*
       * Stropy sú RÔZNE — to je celé tvrdenie. Do 1. 9. 2026 tu stálo
       * `toBeLessThan` a bola to pravda (160 < 240) len náhodou: kľúč mal vtedy
       * nižšiu kvótu než anonymná vetva. Po zdvihnutí kvóty na 1000/deň je
       * kľúčová dráha voľnejšia (800 > 240), a poradie stropov nikdy nebolo to,
       * čo tento test stráži.
       */
      expect(orders.limit).not.toBe(anon.limit);
    });
  });

  it('rozpočet sa počíta na UTC deň — zajtrajšok začína od nuly', async () => {
    await withAppConn(async (conn) => {
      const store = createReadBudgetStore({ defaultConn: conn });
      const tomorrow = createReadBudget({
        store,
        lane: 'anon',
        now: () => new Date('2026-08-13T00:30:00.000Z'),
      });
      const status = await tomorrow.status();
      expect(status.day).toBe('2026-08-13');
      expect(status.used).toBe(0);
    });
  });

  it('stav katalógu sa dá prečítať jedným volaním (A5)', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      await repo.saveSyncProgress({
        ...emptyCatalogProgress(),
        perPage: 100,
        lastPage: 30,
        shopTotal: 41_082,
        rowsWritten: 3_000,
      });

      const status = await repo.syncStatus({ now: new Date('2026-08-12T10:00:00.000Z'), conn });

      expect(status.shopTotalProducts).toBe(41_082);
      expect(status.pagesTotal).toBe(411);
      expect(status.pagesDone).toBe(30);
      expect(status.pagesLeft).toBe(381);
      expect(status.complete).toBe(false);
    });
  });
});
