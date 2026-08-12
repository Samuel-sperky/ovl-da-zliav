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

/* ═══════ NEZNÁME POČÍTADLO NIE JE MINUTÝ ROZPOČET (A4, I11) ════════════════ */

describe('catalogRepo.syncStatus — neprečítané počítadlo sa nevydáva za fakt', () => {
  /** Počítadlo, ktoré sa nedá prečítať — presne to, čo robí spadnutá DB. */
  const brokenBudget = () =>
    createReadBudget({
      store: {
        async used() {
          throw new Error('DB je preč');
        },
        async add() {
          throw new Error('DB je preč');
        },
      },
      lane: 'anon',
      now: () => NOW,
    });

  const repoWithBrokenBudget = (state: FakeDbState) =>
    createCatalogRepo({ defaultConn: fakeConn(state), readBudget: brokenBudget() });

  it('`known: false` sa nehlási ako „dnešný rozpočet je minutý"', async () => {
    // `reserve()`/`status()` pri nedostupnom úložisku NEHÁDŽU — vrátia
    // fail-closed `exhausted: true` s `known: false`. Nečítať je správne, ale
    // tvrdiť, že rozpočet je minutý, znamená vydať domnienku za číslo, ktoré
    // appka nepozná: počítadlo môže stáť na 12 z 240. Domnienku hlási prekážka
    // `catalog_reads_day_exhausted` s `assumed: true`, nie tento stav.
    const repo = repoWithBrokenBudget({
      totalRows: 2_900,
      lastFetched: NOW,
      progress: progressRow(),
    });

    const status = await repo.syncStatus({ now: NOW });

    expect(status.reads.known).toBe(false);
    expect(status.waiting).toBeNull();
    expect(status.nextBatchAt).toBeNull();
  });

  it('odhad sa z neprečítaného počítadla nedopočítava ako z nuly', async () => {
    // Fail-closed `remaining: 0` by aj pri jednej chýbajúcej stránke tvrdilo
    // „ešte deň". Neznáme = odhad NIE JE (I11).
    const repo = repoWithBrokenBudget({
      totalRows: 41_000,
      lastFetched: NOW,
      progress: progressRow({ last_page: 410 }),
    });

    const status = await repo.syncStatus({ now: NOW });

    expect(status.pagesLeft).toBe(1);
    expect(status.estimatedDaysLeft).toBeNull();
    expect(status.estimatedFinishAt).toBeNull();
  });
});

/* ══════ OBNOVA NIE JE CHÝBAJÚCI KATALÓG (A5, I11) ══════════════════════════ */

describe('catalogRepo.syncStatus — obnova celého katalógu', () => {
  /**
   * Stav po KAŽDOM dokončenom prechode: `catalog_cache` má všetkých 41 082
   * riadkov, ale nový (obnovovací) prechod stojí na stránke 0. Predtým z toho
   * karta poskladala „0 chýba" vedľa „411 stránok ostáva, ešte 2 dni" — a na
   * Prehľade to stálo vedľa vety „katalóg je načítaný celý".
   */
  const refreshState = (lastPage: number): FakeDbState => ({
    totalRows: 41_082,
    lastFetched: NOW,
    progress: progressRow({ last_page: lastPage, completed: 0, rows_written: 41_082 }),
  });

  it('obnova od stránky 0 nehlási, že chýba 411 stránok', async () => {
    const status = await repoWith(refreshState(0)).syncStatus({ now: NOW });

    expect(status.loadedProducts).toBe(41_082);
    expect(status.percent).toBe(100);
    expect(status.refreshing).toBe(true);
    expect(status.pagesLeft).toBe(0);
    expect(status.estimatedDaysLeft).toBe(0);
    expect(status.estimatedFinishAt).toBeNull();
    // Pokrok prechodu sa nezahmlieva — `pagesDone` ostáva, čo naozaj je.
    expect(status.pagesDone).toBe(0);
    expect(status.pagesTotal).toBe(411);
  });

  it('rozbehnutá obnova hlási pokrok prechodu, nie chýbajúci katalóg', async () => {
    const status = await repoWith(refreshState(42)).syncStatus({ now: NOW });

    expect(status.refreshing).toBe(true);
    expect(status.pagesDone).toBe(42);
    expect(status.pagesLeft).toBe(0);
  });

  it('prvé napĺňanie sa NEMENÍ — chýbajúce stránky sa počítajú ďalej', async () => {
    const status = await repoWith({
      totalRows: 2_900,
      lastFetched: NOW,
      progress: progressRow(),
    }).syncStatus({ now: NOW });

    expect(status.refreshing).toBe(false);
    expect(status.pagesLeft).toBe(381);
    expect(status.estimatedDaysLeft).toBe(1);
  });

  it('prázdny katalóg nie je obnova — je to prvé napĺňanie', async () => {
    const status = await repoWith({
      totalRows: 0,
      lastFetched: null,
      progress: progressRow({ last_page: 0, rows_written: 0 }),
    }).syncStatus({ now: NOW });

    expect(status.refreshing).toBe(false);
    expect(status.pagesLeft).toBe(411);
  });

  it('dočítaný katalóg ostáva dočítaný, nie „obnovovaný"', async () => {
    const status = await repoWith({
      totalRows: 41_082,
      lastFetched: NOW,
      progress: progressRow({ completed: 1, last_page: 411, finished_at: NOW }),
    }).syncStatus({ now: NOW });

    expect(status.complete).toBe(true);
    expect(status.refreshing).toBe(false);
  });
});

/* ══════ ROZPOČET SPOJENÍ `GET /api/status` ═════════════════════════════════ */

describe('catalogRepo.syncStatus — koľko spojení si vezme z poolu', () => {
  it('dotazy idú po jednom, nie ako tri súbežné spojenia z ôsmich', async () => {
    // `GET /api/status` sa volá z každej obrazovky pri každom obnovení. Tri
    // súbežné dotazy = tri spojenia z poolu (`DB_CONNECTION_LIMIT`, default 8),
    // takže dve otvorené karty ho dostanú na hranu presne vtedy, keď má appka
    // povedať, čo sa deje. Fake spojenie má umelé „čakanie na sieť", aby sa
    // súbežné volania naozaj prekryli — bez neho by séria a `Promise.all`
    // vyzerali rovnako.
    const state: FakeDbState = { totalRows: 2_900, lastFetched: NOW, progress: progressRow() };
    const inner = fakeConn(state);
    let inFlight = 0;
    let maxConcurrent = 0;
    let queries = 0;

    const counting: Queryable = {
      async query<T>(sql: string, values?: unknown[]): Promise<T> {
        inFlight += 1;
        queries += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        try {
          await Promise.resolve();
          return await inner.query<T>(sql, values);
        } finally {
          inFlight -= 1;
        }
      },
    };

    const store = createMemoryReadBudgetStore();
    const repo = createCatalogRepo({
      defaultConn: counting,
      readBudget: createReadBudget({ store, lane: 'anon', now: () => NOW }),
    });

    await repo.syncStatus({ now: NOW });

    expect(queries).toBe(3);
    expect(maxConcurrent).toBe(1);
  });
});
