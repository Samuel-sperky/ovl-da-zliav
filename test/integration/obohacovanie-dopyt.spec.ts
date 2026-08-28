/**
 * Aura Zľavy — OBOHACOVANIE KATALÓGU proti SKUTOČNEJ DB a SKUTOČNÉMU MOCKU
 * (KONTRAKT-V4-2026-08-28 §2b: D118, D119, D120; I1, I6, I11).
 *
 * Unit test (`test/unit/obohacovanie-katalogu.spec.ts`) dokazuje správanie nad
 * pamäťou. Tento dokazuje to, čo pamäť dokázať nemôže:
 *
 *  1. **Poradie priority je vlastnosť SQL a indexu, nie fake-u.** Dávka dostane
 *     tri produkty — jeden v povolenom zozname, jeden v plánovanej kampani,
 *     jeden nikde — a MUSÍ ich čítať presne v tomto poradí. Overuje sa poradím
 *     volaní klienta shopu, teda tým, čo naozaj odišlo.
 *  2. **`NULL` prežije MariaDB ako `NULL`.** Neobohatené pole sa v DB nesmie
 *     stať nulou a `qty = 0` sa nesmie stať `NULL` (I11).
 *  3. **`ip_banned` cez SKUTOČNÉ HTTP.** Mock shop odpovie `403 {"error":
 *     "ip_banned"}` presne ako produkčný eshop 28. 8. 2026. Dávka musí stáť,
 *     dôvod si zapísať do `catalog_enrich_state`, `paused_until` nechať `NULL`
 *     a **žiadny produkt neoznačiť ako obohatený**. Toto je dnešná realita —
 *     fail-closed chovanie nie je hypotéza, je to jediný stav, v ktorom sa appka
 *     dnes nachádza.
 *  4. **Kľúč ide výhradne do hlavičky** (I1, D64) — dokazuje sa zaznamenanou
 *     adresou requestu, nie prečítaním kódu.
 *  5. **Route `POST /api/catalog/enrich` je idempotentná.** Druhé otvorenie
 *     toho istého produktu nesmie poslať ANI JEDEN HTTP request.
 *
 * Shop je buď skutočný mock server na loopbacku (I6), alebo fake klient, keď je
 * potrebná odpoveď, ktorú mock nepozná (`getFull` v ňom nie je implementovaný —
 * vracia `404 invalid_action`). PRODUKČNÝ ESHOP SA NEVOLÁ NIKDY; stráži to aj
 * globálny fetch guard v `test/setup.ts`.
 *
 * Bez dostupnej DB sa blok korektne preskočí.
 *
 * Vlastník: V4 (obohacovanie).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Connection } from 'mariadb';

import type {
  ProductFullDetail,
  SecretHandle,
  SecretRef,
  UtcDate,
} from '@/contracts';

import { createCatalogEnrichRoute, type EnrichResponse } from '@/app/api/catalog/enrich/route';
import { runEnrichBatch, type EnrichBatchDeps } from '@/lib/engine/catalog-enrich';
import { resetRateLimiter } from '@/lib/http/define-route';
import {
  createCatalogRepo,
  ENRICH_PRIORITY_ALLOWLIST,
  ENRICH_PRIORITY_CAMPAIGN,
  ENRICH_PRIORITY_REST,
  type CatalogRepoExt,
} from '@/lib/repo/catalog.repo';
import { createShopClient, type ShopScope } from '@/lib/shop/client';
import { makeShopError, ShopRequestError } from '@/lib/shop/errors';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
} from '@/lib/shop/read-budget';

import { dbAvailable, setupTestDb, withAppConn, withMigrationConn } from '../helpers/db';
import { startMockShopWithOverride, type RunningMockShop } from '../helpers/mock';
import { actorRouteDeps, makeRequest, parse } from './routes-harness';

const available = await dbAvailable();

const NOW = new Date('2026-08-28T09:00:00.000Z');
const now = (): UtcDate => NOW;
const SCOPES: readonly ShopScope[] = ['product:read', 'product:edit'];

/** ID mimo dosahu ostatných testov — tento súbor po sebe upratuje sám. */
const P_ALLOW = 91_201;
const P_CAMPAIGN = 91_202;
const P_REST = 91_203;
const ALL_PRODUCTS = [P_ALLOW, P_CAMPAIGN, P_REST];

const USER_ID = 9821;
const CAMPAIGN_ID = 9822;
/** Kampaň má okno v budúcnosti, takže je „plánovaná" bez ohľadu na deň behu. */
const CAMPAIGN_TO = '2099-12-31';

/** `SecretRef` nad textom — kľúč v testoch nikdy nie je skutočný (I1). */
const testKey: SecretRef = async (): Promise<SecretHandle> => {
  const value = Buffer.from('test-key', 'utf8');
  return { value, release: () => value.fill(0) };
};

const apiKeyStub = (scopes: readonly ShopScope[] | null = SCOPES) => ({
  loadForUse: async (): Promise<SecretRef | null> => testKey,
  recallScopes: () => ({ scopes, checkedAt: scopes === null ? null : NOW }),
});

/* ═══════════════════════════ 1. Fake shop ═════════════════════════════════ */

interface FakeShop {
  readonly calls: number[];
  getProductFull(id: number, key: SecretRef): Promise<ProductFullDetail>;
}

function fakeShop(reply: (id: number) => ProductFullDetail | ShopRequestError): FakeShop {
  const calls: number[] = [];
  return {
    calls,
    async getProductFull(id: number, key: SecretRef): Promise<ProductFullDetail> {
      calls.push(id);
      // Kľúč sa dešifruje a uvoľní rovnako ako v produkcii (I1, D64).
      const handle = await key();
      handle.release();
      const value = reply(id);
      if (value instanceof ShopRequestError) throw value;
      return value;
    },
  };
}

/** Bohatá odpoveď `getFull` v tvare zmeranom sondou 28. 8. 2026 (fakt 4). */
const richFull = (id: number): ProductFullDetail => ({
  id,
  name: `Šperk ${String(id)}`,
  price: 24.9,
  has_attributes: false,
  reduction: { state: 'active', percent: 15, from: '2026-08-20', to: '2026-09-02' },
  reference: 'SP-1042',
  ean13: '8595000000019',
  purchase_price: 11.2,
  margin: 13.7,
  margin_percent: 55.02,
  sell_price_with_vat: 29.88,
  last_time_in_order: '2026-07-28 12:29:28',
  // Vypredané — PLATNÁ NULA, nie „nevieme".
  qty: 0,
  qty_in_orders: 37,
  supplier: 'Kovoshop s.r.o.',
  active: true,
  categories: [11, 24],
});

/** Odpoveď, v ktorej shop o back-office poliach nepovedal nič. */
const bareFull = (id: number): ProductFullDetail => ({
  id,
  name: `Šperk ${String(id)}`,
  price: 24.9,
  has_attributes: false,
  reduction: { state: 'none' },
});

/* ═══════════════════════════ 2. Príprava DB ═══════════════════════════════ */

function batchDeps(
  repo: CatalogRepoExt,
  shop: FakeShop,
  reads: ReadBudget,
  opts: { refreshPriority?: boolean; maxProducts?: number } = {},
): EnrichBatchDeps {
  return {
    shop,
    catalog: repo,
    reads,
    apiKey: apiKeyStub(),
    now,
    sleepFn: async () => {},
    refreshPriority: opts.refreshPriority ?? true,
    ...(opts.maxProducts !== undefined ? { maxProducts: opts.maxProducts } : {}),
  };
}

function memoryBudget(): ReadBudget {
  return createReadBudget({ store: createMemoryReadBudgetStore(), lane: 'anon', now });
}

async function seed(conn: Connection): Promise<void> {
  const repo = createCatalogRepo({ defaultConn: conn });
  await repo.upsertMany(
    ALL_PRODUCTS.map((productId) => ({
      productId,
      name: `Šperk ${String(productId)}`,
      price: '24.90',
      hasAttributes: false,
      source: 'list' as const,
      raw: { id: productId },
    })),
  );
  await conn.query('INSERT INTO products_allowlist (product_id, slot, label) VALUES (?, 1, ?)', [
    P_ALLOW,
    'test obohacovanie',
  ]);
  // `password_hash` je výplň, nie tajomstvo — appka heslá nemá (D99, D104).
  await conn.query('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'test-enrich',
    'nepouzite',
  ]);
  await conn.query(
    'INSERT INTO campaigns (id, operation_id, name, percent, date_from, date_to, mode, ' +
      'status, created_by) VALUES (?, ?, ?, 10, ?, ?, ?, ?, ?)',
    [
      CAMPAIGN_ID,
      '01J0000000000000000TSTE1',
      'Test obohacovanie',
      '2026-08-28',
      CAMPAIGN_TO,
      'scheduled',
      'scheduled',
      USER_ID,
    ],
  );
  await conn.query(
    'INSERT INTO campaign_items (campaign_id, product_id, percent, position) VALUES (?, ?, 10, 1)',
    [CAMPAIGN_ID, P_CAMPAIGN],
  );
}

/** Stav dávky nie je v `DATA_TABLES`, takže ho `truncateAll()` nevyčistí. */
async function resetEnrichState(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query(
      'UPDATE catalog_enrich_state SET batch_day = NULL, enriched_today = 0, ' +
        'daily_target = 150, last_product_id = NULL, enriched_total = 0, ' +
        'started_at = NULL, last_read_at = NULL, paused_until = NULL, ' +
        'pause_reason = NULL, last_error = NULL WHERE id = 1',
    );
  });
}

async function cleanup(): Promise<void> {
  await withMigrationConn(async (conn) => {
    const products = ALL_PRODUCTS.map(() => '?').join(', ');
    await conn.query('DELETE FROM campaign_items WHERE campaign_id = ?', [CAMPAIGN_ID]);
    await conn.query('DELETE FROM campaigns WHERE id = ?', [CAMPAIGN_ID]);
    await conn.query(`DELETE FROM products_allowlist WHERE product_id IN (${products})`, [
      ...ALL_PRODUCTS,
    ]);
    await conn.query(`DELETE FROM catalog_cache WHERE product_id IN (${products})`, [
      ...ALL_PRODUCTS,
    ]);
    await conn.query('DELETE FROM users WHERE id = ?', [USER_ID]);
  });
  await resetEnrichState();
}

/* ═══════════════════════════ 3. Testy ═════════════════════════════════════ */

describe.skipIf(!available)('obohacovanie katalógu nad skutočnou DB', () => {
  let mock: RunningMockShop;

  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
    mock = await startMockShopWithOverride();
  });

  afterAll(async () => {
    await cleanup();
    await mock.stop();
  });

  beforeEach(async () => {
    resetRateLimiter();
    mock.state.reset();
    // Celý úklid, nie len `catalog_cache`: `products_allowlist` má UNIQUE na
    // `slot`, takže druhé osadenie by spadlo na 1062, a `campaign_items` visí
    // na kampani cudzím kľúčom — poradie mazania patrí do `cleanup()`.
    await cleanup();
    await withAppConn(seed);
  });

  /* ══════════ 1. Poradie priority je vlastnosť SQL, nie fake-u ══════════ */

  it('dávka čerpá frontu v poradí: povolený zoznam → kampaň → zvyšok', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const shop = fakeShop((id) => bareFull(id));

      const result = await runEnrichBatch(batchDeps(repo, shop, memoryBudget()));

      expect(result.outcome).toBe('done');
      expect(result.enriched).toBe(3);
      // Toto je celý dôkaz D118: poradie sa nedopočítava v kóde, vydáva ho index
      // `ix_catalog_enrich_queue`, a dávka ho DODRŽÍ.
      expect(shop.calls).toEqual([P_ALLOW, P_CAMPAIGN, P_REST]);

      // Priority naozaj vznikli — dávka si ich prepočítala sama pred výberom.
      expect(result.priority).not.toBeNull();
      const rows = await repo.enrichmentFor(ALL_PRODUCTS);
      expect(rows.get(P_ALLOW)?.enrichPriority).toBe(ENRICH_PRIORITY_ALLOWLIST);
      expect(rows.get(P_CAMPAIGN)?.enrichPriority).toBe(ENRICH_PRIORITY_CAMPAIGN);
      expect(rows.get(P_REST)?.enrichPriority).toBe(ENRICH_PRIORITY_REST);
    });
  });

  it('obohatený produkt z fronty vypadne — druhý beh ho nečíta znova', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const reads = memoryBudget();

      const first = fakeShop((id) => bareFull(id));
      await runEnrichBatch(batchDeps(repo, first, reads, { maxProducts: 1 }));
      expect(first.calls).toEqual([P_ALLOW]);

      const second = fakeShop((id) => bareFull(id));
      await runEnrichBatch(batchDeps(repo, second, reads));
      // Pokračuje tam, kde stálo — a už prečítané ID sa neplatí druhýkrát.
      expect(second.calls).toEqual([P_CAMPAIGN, P_REST]);
    });
  });

  /* ══════════ 2. `NULL` prežije MariaDB ako „nevieme" (I11) ══════════════ */

  it('všetky polia z faktu 4 sa uložia; `qty = 0` zostane nulou', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const shop = fakeShop((id) => richFull(id));

      await runEnrichBatch(batchDeps(repo, shop, memoryBudget(), { maxProducts: 1 }));

      const row = (await repo.enrichmentFor([P_ALLOW])).get(P_ALLOW);
      expect(row?.reference).toBe('SP-1042');
      expect(row?.ean13).toBe('8595000000019');
      expect(row?.purchasePrice).toBe(11.2);
      expect(row?.margin).toBe(13.7);
      expect(row?.marginPercent).toBe(55.02);
      expect(row?.sellPriceWithVat).toBe(29.88);
      expect(row?.lastTimeInOrder).not.toBeNull();
      // Vypredané, nie neznáme. Práve táto zámena sa v tomto repe už raz stala.
      expect(row?.qty).toBe(0);
      expect(row?.qtyInOrders).toBe(37);
      expect(row?.supplier).toBe('Kovoshop s.r.o.');
      expect(row?.reductionPercent).toBe(15);
      expect(row?.reductionFrom).not.toBeNull();
      expect(row?.reductionTo).not.toBeNull();
      expect(row?.active).toBe(true);
      expect(row?.categories).toEqual([11, 24]);
      expect(row?.enrichedAt).not.toBeNull();
    });
  });

  it('čo shop neposlal, je v DB `NULL` — nikdy nula ani prázdny string', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const shop = fakeShop((id) => bareFull(id));

      await runEnrichBatch(batchDeps(repo, shop, memoryBudget(), { maxProducts: 1 }));

      const row = (await repo.enrichmentFor([P_ALLOW])).get(P_ALLOW);
      // Riadok JE obohatený — a napriek tomu je väčšina polí „nevieme".
      expect(row?.enrichedAt).not.toBeNull();
      expect(row?.reference).toBeNull();
      expect(row?.purchasePrice).toBeNull();
      expect(row?.margin).toBeNull();
      expect(row?.qty).toBeNull();
      expect(row?.qtyInOrders).toBeNull();
      expect(row?.supplier).toBeNull();
      expect(row?.categories).toBeNull();
      expect(row?.active).toBeNull();
      // Zľava nebeží: tri `NULL` NARAZ, nikdy len percento.
      expect(row?.reductionPercent).toBeNull();
      expect(row?.reductionFrom).toBeNull();
      expect(row?.reductionTo).toBeNull();
    });
  });

  it('neobohatený produkt má všetko `NULL` a `enrichedAt === null`', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const row = (await repo.enrichmentFor([P_REST])).get(P_REST);
      expect(row?.enrichedAt).toBeNull();
      expect(row?.enrichAttemptedAt).toBeNull();
      expect(row?.reference).toBeNull();
      expect(row?.qty).toBeNull();
    });
  });

  /* ══════════ 3. `ip_banned` cez SKUTOČNÉ HTTP (D120, dnešná realita) ════ */

  it('`ip_banned` zastaví dávku, zapíše dôvod a NEOZNAČÍ nič ako obohatené', async () => {
    // Presne dnešný stav shopu: `403 {"error":"ip_banned"}` na VŠETKO, vrátane
    // verejného čítania. `reads: true` znamená, že sa banujú aj čítania.
    mock.state.ipBanned(true, { reads: true });

    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const reads = memoryBudget();
      const result = await runEnrichBatch({
        // Skutočný klient A3 proti skutočnému mocku (I6) — nič sa nestubuje.
        shop: createShopClient({
          baseUrl: mock.baseUrl,
          policy: { maxAttempts: 1, retryAfterCapSeconds: 1 },
        }),
        catalog: repo,
        reads,
        apiKey: apiKeyStub(),
        now,
        sleepFn: async () => {},
        refreshPriority: true,
      });

      expect(result.outcome).toBe('ip_banned');
      expect(result.error).toBe('ip_banned');
      expect(result.enriched).toBe(0);
      // Ban sa zistí prvým volaním a dávka po ňom NEPOKRAČUJE.
      expect(result.attempted).toBe(1);
      expect(mock.state.recordedRequests).toHaveLength(1);
      // Kvóta sa minula — request, ktorý skončil na 403, ju shop účtuje rovnako.
      expect(result.readsUsed).toBe(1);
      expect((await reads.status()).used).toBe(1);

      // ŽIADNY produkt nie je obohatený a ŽIADNY nemá zaznačený pokus: ban nie
      // je vina produktu a posun v poradí fronty by za neho bol nespravodlivý.
      const rows = await repo.enrichmentFor(ALL_PRODUCTS);
      for (const productId of ALL_PRODUCTS) {
        expect(rows.get(productId)?.enrichedAt).toBeNull();
        expect(rows.get(productId)?.enrichAttemptedAt).toBeNull();
      }

      // Dôvod pauzy je v DB a `paused_until` je `NULL` = kým nezasiahne človek.
      const state = await repo.loadEnrichState();
      expect(state.pauseReason).toBe('ip_banned');
      expect(state.pausedUntil).toBeNull();
      expect(state.lastError).toBe('ip_banned');
      expect(state.enrichedToday).toBe(0);
    });

    // Druhý beh sa shopu už NEPÝTA — pauza platí a vidí ju aj nový proces.
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const again = await runEnrichBatch(
        batchDeps(repo, fakeShop((id) => bareFull(id)), memoryBudget()),
      );
      expect(again.outcome).toBe('paused');
      expect(again.attempted).toBe(0);
      expect(mock.state.recordedRequests).toHaveLength(1);
    });
  });

  it('429 zastaví dávku a `Retry-After` z hlavičky určí, dokedy stojí', async () => {
    mock.state.rateLimit(45);

    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const result = await runEnrichBatch({
        shop: createShopClient({
          baseUrl: mock.baseUrl,
          policy: { maxAttempts: 1, retryAfterCapSeconds: 300 },
        }),
        catalog: repo,
        reads: memoryBudget(),
        apiKey: apiKeyStub(),
        now,
        sleepFn: async () => {},
        refreshPriority: true,
      });

      expect(result.outcome).toBe('rate_limited');
      const state = await repo.loadEnrichState();
      expect(state.pauseReason).toBe('rate_limited');
      expect(state.pausedUntil).not.toBeNull();
      // Hlavička sa REŠPEKTUJE: pauza nesmie byť kratšia než 45 s.
      const waitMs = (state.pausedUntil?.getTime() ?? 0) - NOW.getTime();
      expect(waitMs).toBeGreaterThanOrEqual(45_000);
      expect(waitMs).toBeLessThanOrEqual(60 * 60 * 1000);
    });
  });

  it('kľúč ide výhradne do hlavičky, nikdy do adresy (I1, D64)', async () => {
    mock.state.ipBanned(true, { reads: true });

    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      await runEnrichBatch({
        shop: createShopClient({
          baseUrl: mock.baseUrl,
          policy: { maxAttempts: 1, retryAfterCapSeconds: 1 },
        }),
        catalog: repo,
        reads: memoryBudget(),
        apiKey: apiKeyStub(),
        now,
        sleepFn: async () => {},
        refreshPriority: false,
      });
    });

    const request = mock.state.recordedRequests[0];
    expect(request?.path).toBe('/api/products/getFull');
    expect(request?.apiKey).toBe('test-key');
    expect(request?.url).not.toContain('test-key');
    expect(JSON.stringify(request?.query ?? {})).not.toContain('test-key');
  });

  it('bez oprávnenia `product:read` neodíde na mock ani jeden request', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const result = await runEnrichBatch({
        shop: createShopClient({ baseUrl: mock.baseUrl, policy: { maxAttempts: 1, retryAfterCapSeconds: 1 } }),
        catalog: repo,
        reads: memoryBudget(),
        apiKey: apiKeyStub([]),
        now,
        sleepFn: async () => {},
        refreshPriority: false,
      });
      expect(result.outcome).toBe('locked');
      expect(mock.state.recordedRequests).toHaveLength(0);
    });
  });

  /* ══════════ 4. Route na dopyt: idempotentná a lacná ═══════════════════ */

  it('POST /api/catalog/enrich obohatí produkt a druhý raz už nič nevolá', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const shop = fakeShop((id) => richFull(id));
      const route = createCatalogEnrichRoute({
        shop,
        catalog: repo,
        reads: memoryBudget(),
        apiKey: apiKeyStub(),
        now,
        routeDeps: actorRouteDeps({ now }),
      });

      const first = await parse(
        await route(makeRequest('POST', '/api/catalog/enrich', { productId: P_REST })),
      );
      expect(first.status).toBe(200);
      const firstData = first.body.data as EnrichResponse;
      expect(firstData.outcome).toBe('enriched');
      expect(firstData.fresh).toBe(false);
      expect(firstData.readsUsed).toBe(1);
      // Panel dostane celý riadok hneď — nemusí sa pýtať druhou cestou.
      expect(firstData.enrichment?.reference).toBe('SP-1042');
      expect(firstData.enrichment?.qty).toBe(0);
      expect(firstData.enrichment?.enrichedAt).not.toBeNull();

      const second = await parse(
        await route(makeRequest('POST', '/api/catalog/enrich', { productId: P_REST })),
      );
      const secondData = second.body.data as EnrichResponse;
      expect(secondData.outcome).toBe('fresh');
      expect(secondData.fresh).toBe(true);
      expect(secondData.readsUsed).toBe(0);
      // Celý dôkaz idempotencie: počítadlo volaní klienta sa NEPOHNULO.
      expect(shop.calls).toEqual([P_REST]);
      // A riadok je aj tak v odpovedi celý — `fresh` nie je chyba.
      expect(secondData.enrichment?.reference).toBe('SP-1042');
    });
  });

  it('route je mutácia: bez hlavičky Origin ju odmietne (D72)', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const shop = fakeShop((id) => richFull(id));
      const route = createCatalogEnrichRoute({
        shop,
        catalog: repo,
        reads: memoryBudget(),
        apiKey: apiKeyStub(),
        now,
        routeDeps: actorRouteDeps({ now }),
      });

      const response = await parse(
        await route(
          makeRequest('POST', '/api/catalog/enrich', { productId: P_REST }, { origin: null }),
        ),
      );
      expect(response.status).toBe(403);
      expect(shop.calls).toEqual([]);
    });
  });

  it('route prijme JEDEN produkt, nie zoznam — plošné obohatenie neexistuje', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const shop = fakeShop((id) => richFull(id));
      const route = createCatalogEnrichRoute({
        shop,
        catalog: repo,
        reads: memoryBudget(),
        apiKey: apiKeyStub(),
        now,
        routeDeps: actorRouteDeps({ now }),
      });

      for (const body of [
        { productIds: ALL_PRODUCTS },
        { productId: ALL_PRODUCTS },
        { productId: 0 },
        {},
      ]) {
        const response = await parse(
          await route(makeRequest('POST', '/api/catalog/enrich', body)),
        );
        expect(response.status).toBe(400);
      }
      expect(shop.calls).toEqual([]);
    });
  });

  it('route pri `ip_banned` povie dôvod a nechá riadok neobohatený (D120)', async () => {
    await withAppConn(async (conn) => {
      const repo = createCatalogRepo({ defaultConn: conn });
      const banned = new ShopRequestError(
        makeShopError({ kind: 'forbidden', code: 'ip_banned', httpStatus: 403 }),
      );
      const shop = fakeShop(() => banned);
      const route = createCatalogEnrichRoute({
        shop,
        catalog: repo,
        reads: memoryBudget(),
        apiKey: apiKeyStub(),
        now,
        routeDeps: actorRouteDeps({ now }),
      });

      const parsed = await parse(
        await route(makeRequest('POST', '/api/catalog/enrich', { productId: P_REST })),
      );
      expect(parsed.status).toBe(200);
      const data = parsed.body.data as EnrichResponse;
      expect(data.outcome).toBe('ip_banned');
      expect(data.error).toBe('ip_banned');
      // Riadok sa vráti aj tak — samé `null`, teda priznaná medzera, nie nula.
      expect(data.enrichment?.enrichedAt).toBeNull();
      expect(data.enrichment?.reference).toBeNull();
      expect(data.enrichment?.qty).toBeNull();

      const state = await repo.loadEnrichState();
      expect(state.pauseReason).toBe('ip_banned');
      expect(state.pausedUntil).toBeNull();
    });
  });
});
