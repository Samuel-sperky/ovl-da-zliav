/**
 * Aura Zľavy — SPÚŠŤAČ obohacovania katalógu
 * (KONTRAKT-V4-2026-08-28 §2b: D118 bod 2, D120).
 *
 * Tu sa dokazuje ROZHODOVANIE: kedy sa dávka spustí, kedy ustúpi, čo sa stane
 * pri obsadenom zámku a že `ip_banned` dávku zastaví bez zmeny dát. Samotný
 * engine (`runEnrichBatch`) sa NEPODSÚVA — runner ho volá naozaj, len s fake
 * shopom a pamäťovým zrkadlom. Keby sa dal podsunúť, test by dokazoval fake
 * a presne to je nález E1 z CLAUDE.md.
 *
 * Čo tu NIE JE: poradie priority (vlastnosť SQL, dokazuje integračný test) a
 * produkčné zapojenie do ticku (`test/integration/scheduler-obohacovanie.spec.ts`).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  CatalogEnrichmentRecord,
  ProductFullDetail,
  SecretHandle,
  SecretRef,
  UtcDate,
} from '@/contracts';

import type { EnrichCatalogRepo } from '@/lib/engine/catalog-enrich';
import {
  ENRICH_PRIORITY_REST,
  emptyCatalogEnrichState,
  type CatalogEnrichState,
  type CatalogEnrichWrite,
} from '@/lib/repo/catalog.repo';
import {
  ENRICH_PRODUCTS_PER_BATCH,
  resetEnrichRunnerState,
  runEnrichBatchIfDue,
  type EnrichRunnerDeps,
} from '@/lib/scheduler/enrich-runner';
import type { ShopScope } from '@/lib/shop/client';
import { makeShopError, ShopRequestError } from '@/lib/shop/errors';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
} from '@/lib/shop/read-budget';

const NOW = new Date('2026-08-28T09:00:00.000Z');
const SCOPES: readonly ShopScope[] = ['product:read', 'product:edit'];

/** `SecretRef` nad textom — kľúč v testoch nikdy nie je skutočný (I1). */
const testKey: SecretRef = async (): Promise<SecretHandle> => {
  const value = Buffer.from('test-key', 'utf8');
  return { value, release: () => value.fill(0) };
};

/* ═══════════════════ 1. Pamäťové zrkadlo obohatenia ═══════════════════════ */

interface MirrorRow {
  enrichedAt: UtcDate | null;
  attemptedAt: UtcDate | null;
  write: CatalogEnrichWrite | null;
}

interface Mirror extends EnrichCatalogRepo {
  readonly rows: Map<number, MirrorRow>;
  state: CatalogEnrichState;
}

const emptyRecord = (productId: number, row: MirrorRow | undefined): CatalogEnrichmentRecord => ({
  productId,
  reference: null,
  ean13: null,
  purchasePrice: null,
  margin: null,
  marginPercent: null,
  sellPriceWithVat: null,
  lastTimeInOrder: null,
  qty: null,
  qtyInOrders: null,
  supplier: null,
  reductionPercent: null,
  reductionFrom: null,
  reductionTo: null,
  active: null,
  categories: null,
  enrichedAt: row?.enrichedAt ?? null,
  enrichAttemptedAt: row?.attemptedAt ?? null,
  enrichPriority: ENRICH_PRIORITY_REST,
});

/**
 * Zrkadlo v pamäti. `nextToEnrich()` vydáva poradie, v akom mu produkty vložil
 * test — poradie priority je vlastnosť SQL a indexu (migrácia 0014), takže ho
 * dokazuje integračný test, nie tento fake.
 */
function mirror(productIds: readonly number[]): Mirror {
  const rows = new Map<number, MirrorRow>(
    productIds.map((id) => [id, { enrichedAt: null, attemptedAt: null, write: null }]),
  );
  const self: Mirror = {
    rows,
    state: emptyCatalogEnrichState(),

    async saveEnrichment(productId, data) {
      const row = rows.get(productId);
      // Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy.
      if (row === undefined) return false;
      const at = data.enrichedAt ?? NOW;
      row.write = data;
      row.enrichedAt = at;
      row.attemptedAt = at;
      return true;
    },

    async enrichmentFor(ids) {
      const out = new Map<number, CatalogEnrichmentRecord>();
      for (const productId of ids) out.set(productId, emptyRecord(productId, rows.get(productId)));
      return out;
    },

    async markEnrichAttempt(productId, at) {
      const row = rows.get(productId);
      if (row === undefined) return;
      row.attemptedAt = at ?? NOW;
    },

    async nextToEnrich(limit) {
      return [...rows.entries()]
        .filter(([, row]) => row.enrichedAt === null)
        .slice(0, Math.max(0, limit))
        .map(([id]) => id);
    },

    async refreshEnrichPriority() {
      return { allowlist: 0, campaigns: 0, demoted: 0 };
    },

    async loadEnrichState() {
      return { ...self.state };
    },

    async saveEnrichState(next) {
      self.state = { ...next };
    },
  };
  return self;
}

/* ═══════════════════════════ 2. Fake shop a listy ═════════════════════════ */

interface FakeShop {
  readonly calls: number[];
  getProductFull(id: number, key: SecretRef): Promise<ProductFullDetail>;
}

const plainFull = (id: number): ProductFullDetail => ({
  id,
  name: `Šperk ${String(id)}`,
  price: 19.99,
  has_attributes: false,
  reduction: { state: 'none' },
});

/** Kľúč sa dešifruje a uvoľní rovnako ako v produkcii (I1, D64). */
function fakeShop(reply: (id: number) => ProductFullDetail | ShopRequestError): FakeShop {
  const calls: number[] = [];
  return {
    calls,
    async getProductFull(id: number, key: SecretRef): Promise<ProductFullDetail> {
      calls.push(id);
      const handle = await key();
      handle.release();
      const value = reply(id);
      if (value instanceof ShopRequestError) throw value;
      return value;
    },
  };
}

const ipBanned = (): ShopRequestError =>
  new ShopRequestError(makeShopError({ kind: 'forbidden', code: 'ip_banned', httpStatus: 403 }));

/** Skutočný rozpočet nad pamäťou — aritmetika je tá, ktorá chráni produkciu. */
function memoryBudget(): ReadBudget {
  return createReadBudget({
    store: createMemoryReadBudgetStore(),
    lane: 'product_read',
    now: () => NOW,
  });
}

interface LockSpy {
  readonly acquired: number[];
  readonly released: number[];
  lock: () => Promise<{ release(): Promise<void> } | null>;
}

function lockSpy(mode: 'free' | 'busy' | 'broken' = 'free'): LockSpy {
  const acquired: number[] = [];
  const released: number[] = [];
  const spy: LockSpy = {
    acquired,
    released,
    lock: async () => {
      acquired.push(acquired.length + 1);
      if (mode === 'busy') return null;
      if (mode === 'broken') throw new Error('GET_LOCK: DB je mimo');
      const id = acquired.length;
      return {
        release: async () => {
          released.push(id);
        },
      };
    },
  };
  return spy;
}

function deps(opts: {
  shop: FakeShop;
  catalog: Mirror;
  lock?: LockSpy;
  maxProducts?: number;
}): EnrichRunnerDeps {
  return {
    shop: opts.shop,
    catalog: opts.catalog,
    reads: memoryBudget(),
    apiKey: {
      loadForUse: async () => testKey,
      recallScopes: () => ({ scopes: SCOPES, checkedAt: NOW }),
    },
    now: () => NOW,
    // Bez toho by dávka čakala 3 750 ms na každý produkt.
    sleepFn: async () => {},
    ...(opts.lock !== undefined ? { lock: opts.lock.lock } : {}),
    ...(opts.maxProducts !== undefined ? { maxProducts: opts.maxProducts } : {}),
  };
}

/* ═══════════════════════════ 3. Testy ═════════════════════════════════════ */

beforeEach(() => {
  // Odstup aj `running` sú in-process stav — testy si ho nesmú podávať.
  resetEnrichRunnerState();
});

describe('D118 bod 2 — spúšťač dávky obohacovania', () => {
  it('dávka sa naozaj spustí a obohatí produkty (žiadny fake runner)', async () => {
    const shop = fakeShop(plainFull);
    const catalog = mirror([501, 502]);

    const report = await runEnrichBatchIfDue(deps({ shop, catalog }), { now: NOW });

    expect(report.outcome).toBe('ran');
    expect(report.batch?.outcome).toBe('done');
    expect(report.batch?.enriched).toBe(2);
    expect(shop.calls).toEqual([501, 502]);
    expect(catalog.rows.get(501)?.enrichedAt).not.toBeNull();
  });

  it('bez `maxProducts` berie jedna dávka najviac `ENRICH_PRODUCTS_PER_BATCH`', async () => {
    const ids = Array.from({ length: ENRICH_PRODUCTS_PER_BATCH + 5 }, (_, i) => 600 + i);
    const shop = fakeShop(plainFull);
    const catalog = mirror(ids);

    const report = await runEnrichBatchIfDue(deps({ shop, catalog }), { now: NOW });

    expect(report.batch?.planned).toBe(ENRICH_PRODUCTS_PER_BATCH);
    expect(shop.calls).toHaveLength(ENRICH_PRODUCTS_PER_BATCH);
  });

  it('zápisy majú prednosť — pri `queueBusy` neodíde ani jeden request', async () => {
    const shop = fakeShop(plainFull);
    const report = await runEnrichBatchIfDue(deps({ shop, catalog: mirror([501]) }), {
      now: NOW,
      queueBusy: true,
    });

    expect(report.outcome).toBe('writes_first');
    expect(report.batch).toBeNull();
    expect(shop.calls).toEqual([]);
  });

  it('katalógový prechod má prednosť — pri `catalogBusy` sa dávka preskočí', async () => {
    const shop = fakeShop(plainFull);
    const report = await runEnrichBatchIfDue(deps({ shop, catalog: mirror([501]) }), {
      now: NOW,
      catalogBusy: true,
    });

    expect(report.outcome).toBe('catalog_first');
    expect(shop.calls).toEqual([]);
  });

  it('druhá dávka v tej istej minúte sa nespustí (`too_soon`)', async () => {
    const shop = fakeShop(plainFull);
    const catalog = mirror([501, 502, 503]);
    const runnerDeps = deps({ shop, catalog, maxProducts: 1 });

    const first = await runEnrichBatchIfDue(runnerDeps, { now: NOW });
    const second = await runEnrichBatchIfDue(runnerDeps, { now: NOW });

    expect(first.outcome).toBe('ran');
    expect(second.outcome).toBe('too_soon');
    expect(second.batch).toBeNull();
    expect(shop.calls).toHaveLength(1);
  });

  it('obsadený DB lock (druhý module graf) dávku nespustí', async () => {
    const shop = fakeShop(plainFull);
    const lock = lockSpy('busy');
    const report = await runEnrichBatchIfDue(deps({ shop, catalog: mirror([501]), lock }), {
      now: NOW,
    });

    expect(report.outcome).toBe('already_running');
    expect(shop.calls).toEqual([]);
    expect(lock.acquired).toHaveLength(1);
  });

  it('nedostupný lock je fail-closed (`failed`), nie „voľno"', async () => {
    const shop = fakeShop(plainFull);
    const lock = lockSpy('broken');
    const report = await runEnrichBatchIfDue(deps({ shop, catalog: mirror([501]), lock }), {
      now: NOW,
    });

    expect(report.outcome).toBe('failed');
    expect(shop.calls).toEqual([]);
  });

  it('lock sa uvoľní aj po úspešnej dávke', async () => {
    const lock = lockSpy('free');
    await runEnrichBatchIfDue(deps({ shop: fakeShop(plainFull), catalog: mirror([501]), lock }), {
      now: NOW,
    });

    expect(lock.acquired).toHaveLength(1);
    expect(lock.released).toEqual([1]);
  });

  it('D120 — `ip_banned` dávku zastaví s dôvodom a NEZMENÍ dáta', async () => {
    const shop = fakeShop(() => ipBanned());
    const catalog = mirror([501, 502]);

    const report = await runEnrichBatchIfDue(deps({ shop, catalog }), { now: NOW });

    expect(report.outcome).toBe('ran');
    expect(report.batch?.outcome).toBe('ip_banned');
    expect(report.batch?.enriched).toBe(0);
    // Jeden pokus, potom stop — ban platí pre všetko, druhý request je zbytočne
    // minutá kvóta.
    expect(shop.calls).toEqual([501]);
    // Ani obohatenie, ani pokus: poradie fronty sa nesmie prehodiť za chybu,
    // ktorá s produktom nemá nič spoločné.
    expect(catalog.rows.get(501)?.enrichedAt).toBeNull();
    expect(catalog.rows.get(501)?.attemptedAt).toBeNull();
    expect(catalog.rows.get(502)?.enrichedAt).toBeNull();
    // Dôvod prežije v trvalom stave, nie v pamäti runnera.
    expect(catalog.state.pauseReason).toBe('ip_banned');
    expect(catalog.state.pausedUntil).toBeNull();
  });

  it('po `ip_banned` sa ďalší pokus k shopu vôbec nedostane', async () => {
    const shop = fakeShop(() => ipBanned());
    const catalog = mirror([501, 502]);
    const runnerDeps = deps({ shop, catalog });

    await runEnrichBatchIfDue(runnerDeps, { now: NOW });
    // Odstup runnera sa vynuluje — dokazuje sa brána v engine, nie tlmič ticku.
    resetEnrichRunnerState();
    const second = await runEnrichBatchIfDue(runnerDeps, { now: NOW });

    expect(second.batch?.outcome).toBe('paused');
    expect(shop.calls).toEqual([501]);
  });
});
