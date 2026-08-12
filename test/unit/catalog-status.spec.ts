/**
 * Aura Zľavy — stav katalógu pre UI (`catalogRepo.syncStatus()`, A5).
 *
 * Test beží nad FALOŠNÝM spojením (`Queryable`), nie nad DB: overuje sa
 * aritmetika a pravdivosť stavu, nie SQL. Čo sa tu drží:
 *  - „koľko z koľkých" je meraný fakt (`COUNT(*)` vs. `total` od shopu), nikdy
 *    dopočítaný odhad (I11),
 *  - „prečo sa čaká" pomenuje pauzu po 429 aj minutý denný rozpočet, a rozlíši
 *    ich — pre používateľa je to rozdiel medzi „o minútu" a „po polnoci",
 *  - odhad dokončenia rátа s tým, čo z dnešného rozpočtu ostalo,
 *  - dočítaný katalóg nepýta ďalšiu dávku.
 */
import { describe, expect, it } from 'vitest';

import type { Queryable } from '@/contracts';

import { createCatalogRepo } from '@/lib/repo/catalog.repo';
import { ANON_READS_PER_UTC_DAY } from '@/lib/shop/rate-limits';
import { createMemoryReadBudgetStore, createReadBudget } from '@/lib/shop/read-budget';

/* ───────────────────────────── falošné spojenie ───────────────────────────── */

interface FakeDbState {
  totalRows: number;
  lastFetched: Date | null;
  progress: Record<string, unknown> | null;
}

function fakeConn(state: FakeDbState): Queryable {
  return {
    async query<T>(sql: string): Promise<T> {
      if (sql.includes('COUNT(*) AS total FROM catalog_cache')) {
        return [{ total: state.totalRows }] as T;
      }
      if (sql.includes('MAX(fetched_at)')) {
        return [{ last_fetched: state.lastFetched }] as T;
      }
      if (sql.includes('FROM catalog_sync_state')) {
        return (state.progress === null ? [] : [state.progress]) as T;
      }
      throw new Error(`Neočakávaný dotaz v teste: ${sql.slice(0, 60)}`);
    },
  };
}

const NOW = new Date('2026-08-12T10:00:00.000Z');

function repoWith(state: FakeDbState, readsUsed = 0) {
  const store = createMemoryReadBudgetStore();
  if (readsUsed > 0) void store.add('anon', '2026-08-12', readsUsed);
  return createCatalogRepo({
    defaultConn: fakeConn(state),
    readBudget: createReadBudget({ store, lane: 'anon', now: () => NOW }),
  });
}

/** Riadok `catalog_sync_state` tak, ako ho vracia MariaDB. */
function progressRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    per_page: 100,
    last_page: 30,
    shop_total: 41_082,
    rows_written: 3_000,
    completed: 0,
    started_at: new Date('2026-08-11T21:00:00.000Z'),
    last_read_at: new Date('2026-08-12T09:59:00.000Z'),
    finished_at: null,
    paused_until: null,
    pause_reason: null,
    last_error: null,
    updated_at: new Date('2026-08-12T09:59:00.000Z'),
    ...overrides,
  };
}

/* ═══════════════════════════════ testy ════════════════════════════════════ */

describe('catalogRepo.syncStatus — koľko z koľkých (A5)', () => {
  it('povie načítané, celkové aj percentá — bez dopočítavania', async () => {
    const repo = repoWith({
      totalRows: 2_900,
      lastFetched: new Date('2026-08-12T09:59:00.000Z'),
      progress: progressRow(),
    });

    const status = await repo.syncStatus({ now: NOW });

    expect(status.loadedProducts).toBe(2_900);
    expect(status.shopTotalProducts).toBe(41_082);
    expect(status.percent).toBe(7);
    expect(status.pagesDone).toBe(30);
    expect(status.pagesTotal).toBe(411);
    expect(status.pagesLeft).toBe(381);
    expect(status.complete).toBe(false);
  });

  it('keď shop nepovedal `total`, appka si ho nevymyslí', async () => {
    const repo = repoWith({
      totalRows: 500,
      lastFetched: null,
      progress: progressRow({ shop_total: null }),
    });

    const status = await repo.syncStatus({ now: NOW });

    expect(status.shopTotalProducts).toBeNull();
    expect(status.percent).toBeNull();
    expect(status.pagesTotal).toBeNull();
    expect(status.estimatedDaysLeft).toBeNull();
    expect(status.estimatedFinishAt).toBeNull();
  });

  it('chýbajúci riadok pokroku je „ešte sa nezačalo", nie výnimka', async () => {
    const repo = repoWith({ totalRows: 0, lastFetched: null, progress: null });

    const status = await repo.syncStatus({ now: NOW });

    expect(status.loadedProducts).toBe(0);
    expect(status.pagesDone).toBe(0);
    expect(status.waiting).toBeNull();
    expect(status.nextBatchAt).toBeNull();
  });
});

describe('catalogRepo.syncStatus — prečo sa čaká a dokedy', () => {
  it('pauza po 429 sa pomenuje a nesie čas, kedy sa pokračuje', async () => {
    const until = new Date('2026-08-12T10:00:45.000Z');
    const repo = repoWith({
      totalRows: 2_900,
      lastFetched: NOW,
      progress: progressRow({ paused_until: until, pause_reason: 'rate_limited' }),
    });

    const status = await repo.syncStatus({ now: NOW });

    expect(status.waiting).toBe('rate_limited');
    expect(status.nextBatchAt?.toISOString()).toBe(until.toISOString());
  });

  it('minutý denný rozpočet ukazuje na polnoc UTC', async () => {
    const repo = repoWith(
      { totalRows: 2_900, lastFetched: NOW, progress: progressRow() },
      ANON_READS_PER_UTC_DAY,
    );

    const status = await repo.syncStatus({ now: NOW });

    expect(status.reads.exhausted).toBe(true);
    expect(status.waiting).toBe('daily_budget');
    expect(status.nextBatchAt?.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });

  it('odhad dokončenia počíta s tým, čo z dnešného rozpočtu ostalo', async () => {
    // 381 stránok chýba, dnes je celý rozpočet voľný (240) → dnes 240, zajtra
    // zvyšok, teda ešte jeden ďalší UTC deň.
    const repo = repoWith({ totalRows: 2_900, lastFetched: NOW, progress: progressRow() });

    const status = await repo.syncStatus({ now: NOW });

    expect(status.estimatedDaysLeft).toBe(1);
    expect(status.estimatedFinishAt?.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });

  it('dočítaný katalóg nepýta ďalšiu dávku', async () => {
    const finished = new Date('2026-08-12T05:00:00.000Z');
    const repo = repoWith({
      totalRows: 41_082,
      lastFetched: finished,
      progress: progressRow({
        completed: 1,
        last_page: 411,
        finished_at: finished,
        rows_written: 41_082,
      }),
    });

    const status = await repo.syncStatus({ now: NOW });

    expect(status.complete).toBe(true);
    expect(status.percent).toBe(100);
    expect(status.pagesLeft).toBe(0);
    expect(status.waiting).toBe('catalog_complete');
    expect(status.nextBatchAt).toBeNull();
    expect(status.estimatedFinishAt?.toISOString()).toBe(finished.toISOString());
  });

  it('stav rozpočtu je zdieľaný — čo minul niekto iný, tu je vidieť', async () => {
    const repo = repoWith({ totalRows: 100, lastFetched: NOW, progress: progressRow() }, 40);

    const status = await repo.syncStatus({ now: NOW });

    expect(status.reads.used).toBe(40);
    expect(status.reads.remaining).toBe(ANON_READS_PER_UTC_DAY - 40);
    expect(status.reads.limit).toBe(ANON_READS_PER_UTC_DAY);
    expect(status.reads.known).toBe(true);
  });
});
