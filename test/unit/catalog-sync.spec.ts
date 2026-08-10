/**
 * Aura Zľavy — synchronizácia katalógu a jej spúšťač (V7; KONTRAKT V3 K7).
 *
 * Čo sa tu drží:
 *  - stránkovanie ide SEKVENČNE cez celý katalóg a skončí, keď je hotovo,
 *  - synchronizácia je ČÍTANIE: v module sa nevyskytuje `setReduction` ani
 *    `write_attempt`, takže nemá ako minúť zápisový rozpočet (K7 vs. K2),
 *  - zlyhanie uprostred nechá zapísané riadky platné (`partial`) a NIKDY
 *    nehádže,
 *  - shop, ktorý ignoruje `page`, sa nezacyklí,
 *  - spúšťač beží mimo špičky, ale „raz denne" nesmie znamenať „nikdy" na
 *    počítači, ktorý je v noci vypnutý.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type { Paged, ProductListItem, ShopCtx } from '@/contracts';

import type { CatalogUpsertInput } from '@/lib/repo/catalog.repo';
import {
  isOffPeak,
  resetCatalogRunnerState,
  runCatalogSyncIfDue,
  runCatalogSyncNow,
  CATALOG_MIN_INTERVAL_MS,
  CATALOG_STALE_MS,
} from '@/lib/scheduler/catalog-runner';
import { syncCatalog, toCatalogRow, type CatalogSyncSink } from '@/lib/shop/catalog-sync';

/* ───────────────────────────── fake shop a sink ────────────────────────── */

const product = (id: number): ProductListItem => ({
  id,
  name: `Šperk ${id}`,
  price: 19.9,
  has_attributes: false,
});

interface FakeShop {
  listProducts(params: { page?: number; perPage?: number }, ctx: ShopCtx): Promise<Paged<ProductListItem>>;
  pagesRequested: number[];
}

function fakeShop(total: number, opts: { stuck?: boolean; failOnPage?: number } = {}): FakeShop {
  const all = Array.from({ length: total }, (_, index) => product(1000 + index));
  const pagesRequested: number[] = [];
  return {
    pagesRequested,
    async listProducts(params) {
      const page = params.page ?? 1;
      const perPage = params.perPage ?? 100;
      pagesRequested.push(page);
      if (opts.failOnPage === page) throw new Error('shop_unreachable');
      const start = opts.stuck === true ? 0 : (page - 1) * perPage;
      return { data: all.slice(start, start + perPage), page, perPage, total: all.length };
    },
  };
}

function memorySink(opts: { failOnCall?: number } = {}): CatalogSyncSink & {
  rows: Map<number, CatalogUpsertInput>;
  calls: number;
} {
  const rows = new Map<number, CatalogUpsertInput>();
  const sink = {
    rows,
    calls: 0,
    async upsertMany(records: CatalogUpsertInput[]): Promise<number> {
      sink.calls += 1;
      if (opts.failOnCall === sink.calls) throw new Error('DB je preč');
      for (const record of records) rows.set(record.productId, record);
      return records.length;
    },
  };
  return sink;
}

const noSleep = async (): Promise<void> => undefined;

/* ═════════════════════════════ mapovanie riadku ═══════════════════════════ */

describe('toCatalogRow — riadok katalógu', () => {
  it('cena ide do DECIMAL ako string, nie ako float', () => {
    const fetchedAt = new Date('2026-08-10T10:00:00.000Z');
    const row = toCatalogRow({ id: 42, name: 'Prsteň', price: 1234.5, has_attributes: true }, fetchedAt);

    expect(row.price).toBe('1234.50');
    expect(typeof row.price).toBe('string');
    expect(row.productId).toBe(42);
    expect(row.hasAttributes).toBe(true);
    expect(row.source).toBe('list');
    // K1 bod 2 — produkt, ktorý zoznam vrátil, v shope existuje.
    expect(row.shopStatus).toBe('ok');
    // K7 — `fetched_at` je meraný fakt, nie odhad.
    expect(row.fetchedAt).toBe(fetchedAt);
  });
});

/* ═════════════════════════════ stránkovanie ═══════════════════════════════ */

describe('syncCatalog — stránkovanie celého katalógu (K7)', () => {
  it('prejde všetky stránky sekvenčne a zapíše každý produkt práve raz', async () => {
    const shop = fakeShop(23);
    const sink = memorySink();

    const result = await syncCatalog({
      shopClient: shop,
      catalog: sink,
      perPage: 5,
      pausePerPageMs: 0,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('ok');
    expect(result.products).toBe(23);
    expect(result.total).toBe(23);
    expect(result.pages).toBe(5);
    expect(sink.rows.size).toBe(23);
    // Stránky idú po sebe a v poradí — žiadny paralelný výbuch requestov.
    expect(shop.pagesRequested).toEqual([1, 2, 3, 4, 5]);
  });

  it('prázdny katalóg je `empty`, nie chyba', async () => {
    const result = await syncCatalog({
      shopClient: fakeShop(0),
      catalog: memorySink(),
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('empty');
    expect(result.products).toBe(0);
    expect(result.error).toBeNull();
  });

  it('shop, ktorý ignoruje `page`, sa nezacyklí', async () => {
    const shop = fakeShop(50, { stuck: true });
    const sink = memorySink();

    const result = await syncCatalog({
      shopClient: shop,
      catalog: sink,
      perPage: 5,
      maxPages: 100,
      sleepFn: noSleep,
    });

    expect(result.error).toBe('pagination_stuck');
    expect(result.outcome).toBe('partial');
    // Druhá stránka odhalila, že sa nič neposunulo — ďalej sa nešlo.
    expect(shop.pagesRequested).toEqual([1, 2]);
  });

  it('výpadok shopu uprostred nechá zapísané riadky platné (partial) a nehádže', async () => {
    const shop = fakeShop(23, { failOnPage: 3 });
    const sink = memorySink();

    const result = await syncCatalog({
      shopClient: shop,
      catalog: sink,
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('partial');
    expect(result.error).toContain('shop_unreachable');
    expect(result.products).toBe(10);
    expect(sink.rows.size).toBe(10);
  });

  it('zlyhanie prvej stránky je `failed`, nie výnimka', async () => {
    const result = await syncCatalog({
      shopClient: fakeShop(23, { failOnPage: 1 }),
      catalog: memorySink(),
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('failed');
    expect(result.products).toBe(0);
  });

  it('zlyhanie zápisu do DB zastaví beh, ale nezhodí ho', async () => {
    const result = await syncCatalog({
      shopClient: fakeShop(23),
      catalog: memorySink({ failOnCall: 2 }),
      perPage: 5,
      sleepFn: noSleep,
    });

    expect(result.outcome).toBe('partial');
    expect(result.error).toContain('upsert_failed');
    expect(result.products).toBe(5);
  });

  it('medzi stránkami sa čaká — čítací limit shopu je 300/60 s', async () => {
    const pauses: number[] = [];
    await syncCatalog({
      shopClient: fakeShop(12),
      catalog: memorySink(),
      perPage: 5,
      pausePerPageMs: 250,
      sleepFn: async (ms) => {
        pauses.push(ms);
      },
    });

    // Tri stránky = dve pauzy; po poslednej sa nečaká.
    expect(pauses).toEqual([250, 250]);
  });
});

/* ═════════════ K7 vs. K2 — sync nesmie minúť zápisový rozpočet ════════════ */

describe('K7 — synchronizácia nekonzumuje zápisový rozpočet', () => {
  it('modul neobsahuje setReduction ani write_attempt', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/shop/catalog-sync.ts'),
      'utf8',
    );
    // Sken zdroja, nie správania: keby sem niekto pridal zápis alebo audit
    // event `write_attempt`, ticho by ukradol rozpočet fronte (K2) a žiadny
    // behový test by si toho nemusel všimnúť.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/setReduction/);
    expect(withoutComments).not.toMatch(/write_attempt/);
  });
});

/* ═══════════════════════════ okno mimo špičky ═════════════════════════════ */

describe('isOffPeak — okno sa počíta v miestnom čase, nikdy v UTC', () => {
  it('22:00 miestneho času je mimo špičky, 12:00 nie', () => {
    // August = UTC+2 v Bratislave.
    expect(isOffPeak(new Date('2026-08-05T20:00:00.000Z'))).toBe(true);
    expect(isOffPeak(new Date('2026-08-05T10:00:00.000Z'))).toBe(false);
  });

  it('okno prechádza polnocou — 05:00 miestneho času je stále mimo špičky', () => {
    expect(isOffPeak(new Date('2026-08-05T03:00:00.000Z'))).toBe(true);
    expect(isOffPeak(new Date('2026-08-05T05:30:00.000Z'))).toBe(false); // 07:30
  });

  it('v zime (UTC+1) sa okno posúva s časom, nie s UTC', () => {
    // 21:30 miestneho času v januári = 20:30 UTC.
    expect(isOffPeak(new Date('2026-01-15T20:30:00.000Z'))).toBe(true);
    expect(isOffPeak(new Date('2026-01-15T19:30:00.000Z'))).toBe(false); // 20:30
  });
});

/* ═════════════════════════════ spúšťač ════════════════════════════════════ */

describe('runCatalogSyncIfDue — kedy sa sync spustí (K7)', () => {
  const peak = new Date('2026-08-05T10:00:00.000Z'); // 12:00 miestneho času
  const offPeak = new Date('2026-08-05T20:00:00.000Z'); // 22:00 miestneho času

  function deps(lastFetchedAt: Date | null, total = 12) {
    const shop = fakeShop(total);
    const sink = memorySink();
    return {
      shop,
      sink,
      runner: {
        shopClient: shop,
        catalog: { ...sink, async lastFetchedAt(): Promise<Date | null> { return lastFetchedAt; } },
        perPage: 5,
        pausePerPageMs: 0,
        sleepFn: noSleep,
      },
    };
  }

  beforeEach(() => {
    resetCatalogRunnerState();
  });

  it('prázdny katalóg sa načíta HNEĎ, aj v špičke — bez neho appka nemá z čoho vyberať', async () => {
    const { runner, sink } = deps(null);

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('ran');
    expect(sink.rows.size).toBe(12);
  });

  it('čerstvé dáta sa znova neťahajú', async () => {
    const { runner, sink } = deps(new Date(peak.getTime() - 60_000));

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('too_soon');
    expect(sink.calls).toBe(0);
  });

  it('v špičke sa nesynchronizuje, mimo špičky áno', async () => {
    const lastFetched = new Date(peak.getTime() - (CATALOG_MIN_INTERVAL_MS + 60_000));

    const inPeak = deps(lastFetched);
    expect((await runCatalogSyncIfDue(inPeak.runner, { now: peak })).outcome).toBe('peak_hours');
    expect(inPeak.sink.calls).toBe(0);

    resetCatalogRunnerState();
    const outOfPeak = deps(new Date(offPeak.getTime() - (CATALOG_MIN_INTERVAL_MS + 60_000)));
    expect((await runCatalogSyncIfDue(outOfPeak.runner, { now: offPeak })).outcome).toBe('ran');
    expect(outOfPeak.sink.rows.size).toBe(12);
  });

  it('staré dáta sa načítajú aj v špičke — počítač býva v noci vypnutý', async () => {
    const { runner, sink } = deps(new Date(peak.getTime() - (CATALOG_STALE_MS + 60_000)));

    const report = await runCatalogSyncIfDue(runner, { now: peak });

    expect(report.outcome).toBe('ran');
    expect(sink.rows.size).toBe(12);
  });

  it('zápisy majú prednosť — keď fronta pracuje, sync čaká', async () => {
    const { runner, sink } = deps(new Date(offPeak.getTime() - (CATALOG_STALE_MS + 60_000)));

    const report = await runCatalogSyncIfDue(runner, { now: offPeak, queueBusy: true });

    expect(report.outcome).toBe('writes_first');
    expect(sink.calls).toBe(0);
  });

  it('po úspešnom behu sa ďalší pokus odloží', async () => {
    const { runner, sink } = deps(new Date(offPeak.getTime() - (CATALOG_STALE_MS + 60_000)));

    expect((await runCatalogSyncIfDue(runner, { now: offPeak })).outcome).toBe('ran');
    const second = await runCatalogSyncIfDue(runner, { now: new Date(offPeak.getTime() + 60_000) });

    expect(second.outcome).toBe('too_soon');
    expect(sink.calls).toBe(3); // 12 produktov po 5 = 3 dávky z prvého behu
  });

  it('manuálne načítanie ignoruje špičku aj odstup', async () => {
    const { runner, sink } = deps(new Date(peak.getTime() - 60_000));

    const report = await runCatalogSyncNow(runner, { now: peak });

    expect(report.outcome).toBe('ran');
    expect(sink.rows.size).toBe(12);
  });

  it('nečitateľná DB sync nespustí — fail-closed', async () => {
    const shop = fakeShop(12);
    const sink = memorySink();
    const report = await runCatalogSyncIfDue(
      {
        shopClient: shop,
        catalog: {
          ...sink,
          async lastFetchedAt(): Promise<Date | null> {
            throw new Error('DB je preč');
          },
        },
        sleepFn: noSleep,
      },
      { now: offPeak },
    );

    expect(report.outcome).toBe('failed');
    expect(shop.pagesRequested).toHaveLength(0);
  });
});
