/**
 * Aura Zľavy — PRODUKČNÉ ZAPOJENIE obohacovania do ticku schedulera
 * (KONTRAKT-V4-2026-08-28 §2b: D118 bod 2, D120; I6, I11).
 *
 * PREČO TENTO SÚBOR EXISTUJE
 * --------------------------
 * `runEnrichBatch()` bolo napísané, otestované a malo NULA volajúcich. To je
 * presne pasca z CLAUDE.md: „integračné testy s fake závislosťou zamaskovali, že
 * produkčný wiring vôbec nefunguje (scheduler nikdy nezapisoval)". Preto tu nie
 * je ani jeden fake runner:
 *
 *  1. závislosti ticku pochádzajú z `schedulerTickDeps()` v `scheduler/boot.ts`,
 *     teda z TOHO ISTÉHO objektu, aký beží v `instrumentation`. Keby boot krok
 *     obohacovania zabudol zapojiť, `deps.enrich` je `null` a test padne,
 *  2. tick spúšťa skutočný `createTicker()` z `tick.ts`, takže padne aj vtedy,
 *     keď krok existuje, ale tick ho nezavolá,
 *  3. dávku vykonáva skutočný engine nad skutočným `catalogRepo` (MariaDB) a
 *     `getFull` odchádza cez SKUTOČNÉ HTTP na mock shop (I6).
 *
 * ČO SI TEST PODSÚVA A PREČO PRÁVE TO
 * -----------------------------------
 *  · **kľúč** — testovacia master key v repe neexistuje (`secrets/test-master.key`
 *    je gitignorovaný), takže produkčný `apiKeyRepo` nemá čo dešifrovať. Rovnaké
 *    obmedzenie má `scheduler-wiring.spec.ts` pri executore.
 *  · **`sleepFn`** — engine drží medzi dvoma `getFull` 3 750 ms (minútový strop
 *    kľúča). Bez podsunutej pauzy by test čakal minúty.
 *  · **`catalogSync: null`** — katalógový prechod má vlastný dôkaz
 *    (`scheduler-wiring.spec.ts`) a v tomto ticku by prečítal desiatky stránok
 *    mocku, čo s obohacovaním nemá nič spoločné.
 *
 * Všetko ostatné je produkčné: rozhodovanie runnera, DB advisory lock, počítadlo
 * `productReadBudget`, mapovanie odpovede na riadok `catalog_cache`.
 *
 * PRODUKČNÝ ESHOP SA NEVOLÁ NIKDY — stráži to `SHOP_BASE_URL_OVERRIDE` na
 * loopback aj globálny fetch guard v `test/setup.ts`.
 *
 * Vlastník: V4 (obohacovanie).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { SecretRef, UtcDate } from '@/contracts';

import { resetEnvCache } from '@/env';

import { catalogRepo } from '@/lib/repo/catalog.repo';
import { productReadBudget } from '@/lib/repo/read-budget.repo';
import { schedulerTickDeps } from '@/lib/scheduler/boot';
import { resetEnrichRunnerState } from '@/lib/scheduler/enrich-runner';
import { resetQueueGate } from '@/lib/scheduler/pause';
import { resetQueueReport } from '@/lib/scheduler/queue';
import { createTicker } from '@/lib/scheduler/tick';
import type { ShopScope } from '@/lib/shop/client';

import { dbAvailable, setupTestDb, withMigrationConn } from '../helpers/db';
import { fakeSecretRef } from '../helpers/factories';
import { startMockShopWithOverride, VALID_API_KEY, type RunningMockShop } from '../helpers/mock';

const available = await dbAvailable();

/** ID mimo dosahu ostatných testov — tento súbor po sebe upratuje sám. */
const P_ONE = 91_301;
const P_TWO = 91_302;
const PRODUCTS = [P_ONE, P_TWO];

const GET_FULL_PATH = '/api/products/getFull';
const SCOPES: readonly ShopScope[] = ['product:read', 'product:edit'];

/**
 * Kľúč pre dávku. Hodnota je kľúč MOCKU, aby ho mock uznal — v repe nie je
 * žiadny skutočný kľúč (I1).
 */
const keyStub = {
  loadForUse: async (): Promise<SecretRef | null> => fakeSecretRef(VALID_API_KEY),
  recallScopes: () => ({ scopes: SCOPES, checkedAt: new Date() }),
};

/** Stav dávky ani rozpočet čítaní nie sú v `DATA_TABLES` — `truncateAll()` ich nevyčistí. */
async function resetEnrichTables(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query(
      'UPDATE catalog_enrich_state SET batch_day = NULL, enriched_today = 0, ' +
        'daily_target = 150, last_product_id = NULL, enriched_total = 0, ' +
        'started_at = NULL, last_read_at = NULL, paused_until = NULL, ' +
        'pause_reason = NULL, last_error = NULL WHERE id = 1',
    );
    // Bez toho by test závisel na tom, koľko kvóty minul iný súbor v ten istý
    // UTC deň — dávka do rezervy nesmie, takže by sa vôbec nespustila.
    await conn.query('DELETE FROM shop_read_budget');
  });
}

async function cleanup(): Promise<void> {
  await withMigrationConn(async (conn) => {
    const placeholders = PRODUCTS.map(() => '?').join(', ');
    await conn.query(`DELETE FROM catalog_cache WHERE product_id IN (${placeholders})`, [
      ...PRODUCTS,
    ]);
  });
  await resetEnrichTables();
}

/** Zrkadlo katalógu pred obohatením: riadky sú, obohatenie v nich nie je (I11). */
async function seedMirror(): Promise<void> {
  await catalogRepo.upsertMany(
    PRODUCTS.map((productId) => ({
      productId,
      name: `Šperk ${String(productId)}`,
      price: '24.90',
      hasAttributes: false,
      source: 'list' as const,
      raw: { id: productId },
    })),
  );
}

describe.skipIf(!available)('produkčné zapojenie obohacovania do ticku schedulera', () => {
  let mock: RunningMockShop;

  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
    mock = await startMockShopWithOverride();
    // ENV sa memoizuje pri prvom čítaní; override sa nastavil až teraz.
    resetEnvCache();
    mock.state.setProducts(
      PRODUCTS.map((id) => ({ id, name: `Šperk ${String(id)}`, price: 24.9, has_attributes: false })),
    );
  });

  afterAll(async () => {
    await cleanup();
    await mock.stop();
    resetEnvCache();
  });

  beforeEach(async () => {
    // In-process stav schedulera si testy nesmú podávať medzi sebou.
    resetEnrichRunnerState();
    resetQueueGate();
    resetQueueReport();
    mock.state.reset();
    mock.state.setProducts(
      PRODUCTS.map((id) => ({ id, name: `Šperk ${String(id)}`, price: 24.9, has_attributes: false })),
    );
    await cleanup();
    await seedMirror();
  });

  it('boot krok obohacovania naozaj zapája (`deps.enrich` nie je null)', () => {
    expect(schedulerTickDeps().enrich).not.toBeNull();
  });

  it('jeden tick s PRODUKČNÝM zapojením obohatí riadky cez skutočné HTTP', async () => {
    const deps = schedulerTickDeps({
      tick: { catalogSync: null },
      enrich: { apiKey: keyStub, sleepFn: async () => {}, maxProducts: 2 },
    });
    const ticker = createTicker(deps);

    const result = await ticker.runTick();

    // 1. Tick prebehol a obohacovanie sa v ňom NAOZAJ zavolalo.
    expect(result.error).toBeNull();
    expect(result.enrich).not.toBeNull();
    expect(result.enrich?.outcome).toBe('ran');
    expect(result.enrich?.batch?.outcome).toBe('done');
    expect(result.enrich?.batch?.enriched).toBe(2);

    // 2. `getFull` odišlo cez skutočné HTTP na mock, dvakrát a s kľúčom
    //    v hlavičke (I1, D64) — nie „podľa reportu agenta".
    const calls = mock.state.requestsTo(GET_FULL_PATH);
    expect(calls).toHaveLength(2);
    expect(mock.state.seenApiKeys()).toEqual([VALID_API_KEY]);

    // 3. Riadky v `catalog_cache` sú obohatené produkčným repozitárom.
    const records = await catalogRepo.enrichmentFor(PRODUCTS);
    for (const productId of PRODUCTS) {
      const record = records.get(productId) ?? null;
      // Turbopack tu už raz zahodil `if (!record)` ako compile-time falsy.
      expect(record === null).toBe(false);
      expect(record?.enrichedAt).not.toBeNull();
      expect(record?.reference).toBe(`REF-${String(productId)}`);
      expect(record?.supplier).toBe('Mock Supplier s.r.o.');
      // `qty_in_orders` mocku je `id % 5` — pri P_ONE je to 1, pri P_TWO 2.
      expect(record?.qtyInOrders).toBe(productId % 5);
    }

    // 4. Spotreba sa zapísala do PRODUKČNÉHO počítadla dráhy `product_read`.
    const budget = await productReadBudget.status();
    expect(budget.used).toBeGreaterThanOrEqual(2);
  });

  it('D120 — pri `ip_banned` sa dávka zastaví s dôvodom a NEZMENÍ dáta', async () => {
    // Presne to, čo produkčný eshop vracia od 19. 8. 2026: ban aj na čítanie.
    mock.state.ipBanned(true, { reads: true });

    const ticker = createTicker(
      schedulerTickDeps({
        tick: { catalogSync: null },
        enrich: { apiKey: keyStub, sleepFn: async () => {}, maxProducts: 2 },
      }),
    );

    const result = await ticker.runTick();

    expect(result.error).toBeNull();
    expect(result.enrich?.outcome).toBe('ran');
    expect(result.enrich?.batch?.outcome).toBe('ip_banned');
    expect(result.enrich?.batch?.enriched).toBe(0);
    // Jeden pokus, potom stop.
    expect(mock.state.requestsTo(GET_FULL_PATH)).toHaveLength(1);

    // Dáta sa nezmenili: ani obohatenie, ani značka pokusu.
    const records = await catalogRepo.enrichmentFor(PRODUCTS);
    for (const productId of PRODUCTS) {
      expect(records.get(productId)?.enrichedAt ?? null).toBeNull();
      expect(records.get(productId)?.enrichAttemptedAt ?? null).toBeNull();
    }

    // Dôvod prežije v DB — `paused_until = NULL` znamená „stojí, kým do toho
    // nezasiahne človek" (odblokovanie IP je akcia Samuela).
    const state = await catalogRepo.loadEnrichState();
    expect(state.pauseReason).toBe('ip_banned');
    expect(state.pausedUntil).toBeNull();
  });

  it('zápisy majú prednosť — po fire/fronte sa dávka v tom ticku nespustí', async () => {
    // `queueBusy` počíta tick sám z `fired`/`queueProcessed`, takže sa to tu
    // dokazuje na úrovni kroku: rovnaký krok z bootu, len s príznakom.
    const deps = schedulerTickDeps({
      tick: { catalogSync: null },
      enrich: { apiKey: keyStub, sleepFn: async () => {}, maxProducts: 2 },
    });
    const enrich = deps.enrich;
    expect(enrich).not.toBeNull();

    const now: UtcDate = new Date();
    const report = await enrich?.({ now, queueBusy: true, catalogBusy: false });

    expect(report?.outcome).toBe('writes_first');
    expect(mock.state.requestsTo(GET_FULL_PATH)).toHaveLength(0);
  });
});
