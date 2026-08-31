/**
 * Aura Zľavy — brána pokrytia nad `catalogRepo` a SKUTOČNOU MariaDB
 * (KONTRAKT-V4-2026-08-28 §2b, D121; invariant I11).
 *
 * ČO SA TU DOKAZUJE A PREČO TO BEZ DB DOKÁZAŤ NEDÁ
 * ────────────────────────────────────────────────
 * `GET /api/catalog/search` posielalo `unitsSold` ako ČÍSLO vždy: SQL malo
 * `COALESCE(s.units, 0)` bez brány `status = 'complete'` a route k tomu ešte
 * `fact?.unitsSold ?? 0`. Pri okne 180 dní a dvoch stiahnutých prišiel KAŽDÝ
 * produkt ako meraná nula, `soldBucketOf(0)` ho zaradil do vedra `none` a
 * obrazovka Nová zľava hlásila „10 000 produktov dostane zľavu · 30 %" o
 * predajoch, ktoré appka nikdy nezmerala. Model D121 bol pripravený (`null` sa
 * doň vyjadriť DÁ), len mu server nikdy `null` neposlal — a to je vec SQL-u,
 * takže sa dá overiť výhradne nad databázou.
 *
 * Tri stavy jedného čísla (`soldUnitsForWindow`), každý má tu vlastnú sekciu:
 *
 *  1. **Ani jeden dočítaný deň** → `null` pre všetky produkty. `partial` deň sa
 *     za dočítaný NEPOČÍTA (rovnaká definícia ako `salesRepo.coverageFor()`).
 *  2. **Okno dočítané z časti** → zmerané kusy z dočítaných dní (dolná hranica,
 *     povrch ju hovorí znakom `≥`), ale produkt BEZ predaja je `null`: nula pri
 *     neúplnom okne nie je fakt, a práve z nej vzniklo vedro `none` s 30 %.
 *  3. **Okno celé dočítané** → čísla vrátane MERANEJ nuly, a až vtedy vedro
 *     „0 predaných" niekoho legitímne zaradí do pásma.
 *
 * K tomu dve veci, ktoré z toho čísla plynú:
 *  · filter „0 predaných" nesmie vyberať produkty, o ktorých appka nič nevie,
 *  · `buildTiers()` nad odpoveďou tejto cesty nesmie neznámy predaj zaradiť do
 *    pásma — teda D121 platí až po povrch, nie len v modeli.
 *
 * Deň je VPICHNUTÝ (`today: 2026-04-30`), takže test neflakuje medzi 22:00 a
 * 24:00 UTC. Apríl 2026 a ID 90 5xx sú zámerne mimo dosahu ostatných
 * integračných testov — jednu testovaciu MariaDB zdieľa celý repo.
 *
 * Žiadny shop a žiadny API kľúč: hľadanie je čisté čítanie lokálnej DB (K8, I1).
 *
 * Vlastník: V4 (čítacia vrstva katalógu).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Connection } from 'mariadb';

import type { DateOnly } from '@/contracts';

import { buildTiers, type SelectableRow } from '@/components/campaigns/discounts-model';
import { addDays } from '@/lib/domain/dates';
import { createCatalogRepo, type CatalogSearchRow } from '@/lib/repo/catalog.repo';
import { createSalesRepo } from '@/lib/repo/sales.repo';

import { dbAvailable, setupTestDb, withMigrationConn } from '../helpers/db';

const available = await dbAvailable();

/* ── Vpichnuté okno: 30 dní, apríl 2026 ─────────────────────────────────── */

const TODAY = '2026-04-30' as DateOnly;
const WINDOW_DAYS = 30;
const FIRST_DAY = '2026-04-01' as DateOnly; // TODAY − 29
const DAY_SOLD = '2026-04-02' as DateOnly; //  predaj, v čiastočnom okne dočítaný
const DAY_LATE = '2026-04-20' as DateOnly; //  predaj, dočítaný až v plnom okne

/** Všetky dni okna — cez `addDays()`, nie pripočítavaním milisekúnd. */
const WINDOW: DateOnly[] = (() => {
  const days: DateOnly[] = [];
  let cursor = FIRST_DAY;
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
})();

/* ── ID mimo dosahu ostatných testov ────────────────────────────────────── */

const P_SOLD = 90_501; // 4 ks v dočítaný deň + 9 ks v deň, ktorý dočítaný nie je
const P_ONE = 90_502; //  1 ks v dočítaný deň → vedro `low`
const P_ZERO = 90_503; // ani jeden riadok v `product_sales_daily`
const ALL_PRODUCTS = [P_SOLD, P_ONE, P_ZERO];

function syncState(status: 'pending' | 'partial' | 'complete') {
  return {
    ordersSeen: status === 'complete' ? 3 : 1,
    status,
    requestsUsed: 1,
    lastError: null,
    startedAt: new Date('2026-04-30T01:00:00Z'),
    finishedAt: status === 'complete' ? new Date('2026-04-30T01:05:00Z') : null,
  };
}

async function seed(conn: Connection): Promise<void> {
  const catalog = createCatalogRepo({ defaultConn: conn });
  const sales = createSalesRepo({ defaultConn: conn });

  await catalog.upsertMany(
    ALL_PRODUCTS.map((productId) => ({
      productId,
      name: `Testovací šperk ${String(productId)}`,
      price: '29.90',
      hasAttributes: false,
      source: 'list' as const,
      raw: { id: productId },
    })),
  );

  await sales.replaceDayUnits(DAY_SOLD, [
    { productId: P_SOLD, day: DAY_SOLD, units: 4 },
    { productId: P_ONE, day: DAY_SOLD, units: 1 },
  ]);
  await sales.replaceDayUnits(DAY_LATE, [{ productId: P_SOLD, day: DAY_LATE, units: 9 }]);
}

/**
 * Prestaví pokrytie okna: dni v `completeDays` sú `complete`, `DAY_SOLD` je
 * inak `partial`. `partial` je tu zámerne — deň, ktorý sa začal čítať a
 * nedočítal, je „nevieme", a keby ho brána počítala, sekcia 1 by prešla
 * s nesprávnym dôvodom.
 *
 * Seed sa opakuje pri KAŽDOM teste, nie raz na súbor: jednu testovaciu MariaDB
 * zdieľa celý repo a `repo-fronta.spec.ts` maže `product_sales_daily` celé.
 */
async function prepare(completeDays: readonly DateOnly[]): Promise<void> {
  await withMigrationConn(async (conn) => {
    await seed(conn);
    const sales = createSalesRepo({ defaultConn: conn });
    const days = WINDOW.map(() => '?').join(', ');
    await conn.query(`DELETE FROM sales_sync_state WHERE sale_day IN (${days})`, [...WINDOW]);
    for (const day of completeDays) await sales.saveSyncState(day, syncState('complete'));
    if (!completeDays.includes(DAY_SOLD)) {
      await sales.saveSyncState(DAY_SOLD, syncState('partial'));
    }
  });
}

async function cleanup(): Promise<void> {
  await withMigrationConn(async (conn) => {
    const products = ALL_PRODUCTS.map(() => '?').join(', ');
    const days = WINDOW.map(() => '?').join(', ');
    await conn.query(`DELETE FROM catalog_cache WHERE product_id IN (${products})`, [
      ...ALL_PRODUCTS,
    ]);
    await conn.query(`DELETE FROM product_sales_daily WHERE sale_day IN (${days})`, [...WINDOW]);
    await conn.query(`DELETE FROM sales_sync_state WHERE sale_day IN (${days})`, [...WINDOW]);
  });
}

/** Stránka hľadania nad vpichnutým dňom a oknom, len nad testovacími ID. */
async function search(conn: Connection, extra: Record<string, unknown> = {}) {
  const catalog = createCatalogRepo({ defaultConn: conn });
  return catalog.search({
    productIds: [...ALL_PRODUCTS],
    soldWindowDays: WINDOW_DAYS,
    today: TODAY,
    perPage: 50,
    ...extra,
  });
}

function unitsOf(rows: readonly CatalogSearchRow[], productId: number): number | null {
  const row = rows.find((candidate) => candidate.productId === productId);
  if (row === undefined) throw new Error(`riadok ${String(productId)} chýba`);
  return row.unitsSold;
}

/** Riadky odpovede v tvare, v akom ich obrazovka Nová zľava dáva `buildTiers()`. */
function selectable(rows: readonly CatalogSearchRow[]): SelectableRow[] {
  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    price: row.price,
    unitsSold: row.unitsSold,
    discountedNow: row.discountedNow,
  }));
}

describe.skipIf(!available)('brána pokrytia — „nevieme" verzus meraná nula (D121)', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  /* ═════════════ 1. Ani jeden dočítaný deň → `null`, nie nula ════════════ */

  describe('okno bez jediného dočítaného dňa', () => {
    beforeEach(async () => {
      await prepare([]);
    });

    it('každý riadok má `unitsSold === null` — aj ten s predajom v `partial` dni', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn);
        expect(result.soldCoverage).toEqual({
          windowDays: 30,
          completeDays: 0,
          unknownDays: 30,
        });
        // Presne `null`, nie falsy: `?? 0` na tejto ceste by dalo `0` a test by
        // s `toBeFalsy()` prešiel. `partial` deň nesie 4 ks a NESMIE ich pustiť.
        expect(unitsOf(result.data, P_SOLD)).toBeNull();
        expect(unitsOf(result.data, P_ONE)).toBeNull();
        expect(unitsOf(result.data, P_ZERO)).toBeNull();
      });
    });

    it('filter „0 predaných" nevyberie NIČ — nevieme nie je nula', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn, { soldBuckets: ['none'] });
        expect(result.data).toEqual([]);
        expect(result.total).toBe(0);
      });
    });

    it('počty priznajú „nevieme" ako vlastné číslo, nie ako vedro `none`', async () => {
      await withMigrationConn(async (conn) => {
        const catalog = createCatalogRepo({ defaultConn: conn });
        const counts = await catalog.counts({
          productIds: [...ALL_PRODUCTS],
          soldWindowDays: WINDOW_DAYS,
          today: TODAY,
        });
        expect(counts.total).toBe(3);
        expect(counts.sold).toEqual({ none: 0, low: 0, mid: 0, high: 0 });
        expect(counts.soldUnknown).toBe(3);
      });
    });

    it('`buildTiers()` nezaradí do pásma ani jeden produkt', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn);
        const partition = buildTiers(selectable(result.data), WINDOW_DAYS);
        expect(partition.tiers).toEqual([]);
        expect([...partition.unknownProductIds].sort((a, b) => a - b)).toEqual(ALL_PRODUCTS);
      });
    });

    it('`factsFor()` (cesta route pre živý eshop) vracia `null`, nie nulu', async () => {
      await withMigrationConn(async (conn) => {
        const catalog = createCatalogRepo({ defaultConn: conn });
        const facts = await catalog.factsFor(ALL_PRODUCTS, {
          soldWindowDays: WINDOW_DAYS,
          today: TODAY,
        });
        for (const productId of ALL_PRODUCTS) {
          expect(facts.facts.get(productId)?.unitsSold).toBeNull();
        }
        expect(facts.soldCoverage.completeDays).toBe(0);
      });
    });
  });

  /* ══════ 2. Čiastočne dočítané okno → dolná hranica, nula je `null` ═════ */

  describe('okno dočítané z časti (1 deň z 30)', () => {
    beforeEach(async () => {
      await prepare([DAY_SOLD]);
    });

    it('sčíta VÝHRADNE dočítaný deň — 4, nie 13', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn);
        expect(result.soldCoverage).toEqual({
          windowDays: 30,
          completeDays: 1,
          unknownDays: 29,
        });
        // 9 ks z `DAY_LATE` sa do súčtu dostať NESMIE: ten deň stiahnutý nie je.
        expect(unitsOf(result.data, P_SOLD)).toBe(4);
        expect(unitsOf(result.data, P_ONE)).toBe(1);
      });
    });

    it('produkt bez predaja je `null` — `≥ 0` nie je priznanie, ale prázdna veta', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn);
        expect(unitsOf(result.data, P_ZERO)).toBeNull();
      });
    });

    it('filter „0 predaných" ho NEVYBERIE (bola to cesta k 30 % zľave)', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn, { soldBuckets: ['none'] });
        expect(result.data.map((row) => row.productId)).toEqual([]);
      });
    });

    it('do pásma idú len zmerané kusy; neznámy produkt je preskočený', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn);
        const partition = buildTiers(selectable(result.data), WINDOW_DAYS);
        expect(partition.unknownProductIds).toEqual([P_ZERO]);
        // Ani jedno pásmo nesmie byť `none` — najhlbšia zľava (30 %) je
        // dosiahnuteľná výhradne z celého dočítaného okna.
        expect(partition.tiers.map((tier) => tier.bucket)).not.toContain('none');
        expect(
          partition.tiers.map((tier) => [tier.bucket, tier.percent, [...tier.productIds]]),
        ).toEqual([
          ['low', 20, [P_ONE]],
          ['mid', 15, [P_SOLD]],
        ]);
      });
    });

    it('`factsFor()` drží to isté pravidlo ako hľadanie', async () => {
      await withMigrationConn(async (conn) => {
        const catalog = createCatalogRepo({ defaultConn: conn });
        const facts = await catalog.factsFor(ALL_PRODUCTS, {
          soldWindowDays: WINDOW_DAYS,
          today: TODAY,
        });
        expect(facts.facts.get(P_SOLD)?.unitsSold).toBe(4);
        expect(facts.facts.get(P_ONE)?.unitsSold).toBe(1);
        expect(facts.facts.get(P_ZERO)?.unitsSold).toBeNull();
      });
    });
  });

  /* ═══════════ 3. Celé okno dočítané → nula JE meraný fakt ══════════════ */

  describe('okno dočítané celé (30 z 30)', () => {
    beforeEach(async () => {
      await prepare(WINDOW);
    });

    it('sčíta oba dni predaja — 13 kusov', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn);
        expect(result.soldCoverage).toEqual({
          windowDays: 30,
          completeDays: 30,
          unknownDays: 0,
        });
        expect(unitsOf(result.data, P_SOLD)).toBe(13);
        expect(unitsOf(result.data, P_ONE)).toBe(1);
      });
    });

    it('produkt bez predaja je MERANÁ nula, nie pomlčka', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn);
        expect(unitsOf(result.data, P_ZERO)).toBe(0);
      });
    });

    it('filter „0 predaných" ho NÁJDE a počty ho majú vo vedre `none`', async () => {
      await withMigrationConn(async (conn) => {
        const catalog = createCatalogRepo({ defaultConn: conn });
        const result = await search(conn, { soldBuckets: ['none'] });
        expect(result.data.map((row) => row.productId)).toEqual([P_ZERO]);

        const counts = await catalog.counts({
          productIds: [...ALL_PRODUCTS],
          soldWindowDays: WINDOW_DAYS,
          today: TODAY,
        });
        expect(counts.sold).toEqual({ none: 1, low: 1, mid: 0, high: 1 });
        expect(counts.soldUnknown).toBe(0);
      });
    });

    it('až TERAZ smie vzniknúť pásmo `none` s 30 % — a stojí na meraní', async () => {
      await withMigrationConn(async (conn) => {
        const result = await search(conn);
        const partition = buildTiers(selectable(result.data), WINDOW_DAYS);
        expect(partition.unknownProductIds).toEqual([]);
        expect(
          partition.tiers.map((tier) => [tier.bucket, tier.percent, [...tier.productIds]]),
        ).toEqual([
          ['none', 30, [P_ZERO]],
          ['low', 20, [P_ONE]],
          ['high', 10, [P_SOLD]],
        ]);
      });
    });
  });
});
