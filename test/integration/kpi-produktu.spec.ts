/**
 * Aura Zľavy — KPI produktu nad SKUTOČNOU MariaDB (KONTRAKT-V4-2026-08-28,
 * D114 v revízii D117–D119; invariant I11).
 *
 * Unit test (`test/unit/kpi-produktu.spec.ts`) dokazuje, že skladanie KPI vie
 * tri stavy. Tento súbor dokazuje to, čo bez DB dokázať NEDÁ:
 *
 *  1. **Kusy za okno sčítajú VÝHRADNE dočítané dni.** Seed má päť dní, z toho
 *     dva `complete`, jeden `partial`, jeden bez riadku a jeden `pending`, a
 *     kusy sú na štyroch z nich. Súčet MUSÍ vyjsť 5 (dva dočítané dni), nie 23
 *     (všetky riadky). Keby niekto z dotazu odstránil `JOIN sales_sync_state …
 *     status = 'complete'`, tento test zčervená — a presne tá zámena sa v tomto
 *     repe už raz dostala do produkcie.
 *  2. **Dočítanie dní preklopí „nevieme" na číslo.** Ten istý seed po označení
 *     všetkých dní ako `complete` dá 23 s `gap: null` a produkt BEZ predaja dá
 *     zmeranú nulu — a až vtedy vzniká značka „bez predaja".
 *  3. **Hodnoty prežijú MariaDB.** `qty = 0` sa vráti ako nula (nie `null`),
 *     `NULL` ako „nevieme", marža presne tak, ako bola zapísaná.
 *  4. **Strana 100 produktov je TRI dotazy.** Spojenie sa obalí počítadlom,
 *     takže N+1 nie je otázka názoru.
 *
 * Deň je VPICHNUTÝ (`today`), takže test neflakuje medzi 22:00 a 24:00 UTC ani
 * na prechode mesiaca. Dni aj ID sú zámerne mimo dosahu ostatných integračných
 * testov (júl 2026, ID 90 2xx) — jednu testovaciu MariaDB zdieľa celý repo.
 *
 * Žiadny shop: KPI čítajú výhradne lokálnu DB (K8), takže tento súbor nepotrebuje
 * ani mock shopu. Žiadny API kľúč sa tu nevyskytuje (I1).
 *
 * Vlastník: V4 (čítacia vrstva KPI).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Connection } from 'mariadb';

import type { DateOnly, Queryable } from '@/contracts';

import { addDays } from '@/lib/domain/dates';
import { createCatalogRepo } from '@/lib/repo/catalog.repo';
import { createSalesRepo } from '@/lib/repo/sales.repo';
import { kpiUnitsInCompleteDays, productKpis } from '@/lib/sales/insights';

import { dbAvailable, setupTestDb, withAppConn, withMigrationConn } from '../helpers/db';

const available = await dbAvailable();

/* ── Vpichnutý deň a okná: 5 dní dlhé, 3 dni krátke ─────────────────────── */

const TODAY = '2026-07-14' as DateOnly;
const LONG_DAYS = 5;
const SHORT_DAYS = 3;

const D1 = '2026-07-10' as DateOnly; // complete, 2 ks
const D2 = '2026-07-11' as DateOnly; // complete, 3 ks
const D3 = '2026-07-12' as DateOnly; // partial,  7 ks → do súčtu NESMIE
const D4 = '2026-07-13' as DateOnly; // bez riadku stavu, 11 ks → tiež NESMIE
const D5 = TODAY; //                    pending, bez predaja
const ALL_DAYS = [D1, D2, D3, D4, D5];

/* ── ID mimo dosahu ostatných testov ────────────────────────────────────── */

const P_SOLD = 90_201; // obohatený, s predajmi
const P_PLAIN = 90_202; // v zrkadle, NEOBOHATENÝ, bez predajov
const P_MISSING = 90_203; // v zrkadle vôbec nie je
const P_DEAD = 90_204; // obohatený, shop o ňom nemá ani jednu objednávku
const ALL_PRODUCTS = [P_SOLD, P_PLAIN, P_MISSING, P_DEAD];

/** Presne to, čo by na produkte prečítal človek v administrácii eshopu. */
const SHOP_LAST_ORDER = '2026-07-04 12:29:28';

/** Spojenie s počítadlom dotazov — N+1 sa tým dá zmerať, nie odhadnúť. */
function countingConn(conn: Connection): { wrapped: Queryable; calls: string[] } {
  const calls: string[] = [];
  const wrapped: Queryable = {
    query: async <T>(sql: string, values?: unknown): Promise<T> => {
      calls.push(sql);
      return (await conn.query(sql, values)) as T;
    },
  };
  return { wrapped, calls };
}

async function seed(conn: Connection): Promise<void> {
  const catalog = createCatalogRepo({ defaultConn: conn });
  const sales = createSalesRepo({ defaultConn: conn });

  await catalog.upsertMany(
    [P_SOLD, P_PLAIN, P_DEAD].map((productId) => ({
      productId,
      name: `Testovací šperk ${String(productId)}`,
      price: '19.99',
      hasAttributes: false,
      source: 'list' as const,
      raw: { id: productId },
    })),
  );

  // Obohatenie: `qty = 0` je platná nula, marža je TAKÁ, AKÁ PRIŠLA (z cien by
  // vyšlo iné číslo), časová pečiatka ide v hodinách shopu ako string.
  await catalog.saveEnrichment(P_SOLD, {
    reference: 'SP-90201',
    ean13: '8590000000017',
    purchasePrice: 6.3,
    margin: 7.77,
    marginPercent: 11.11,
    sellPriceWithVat: 23.99,
    lastTimeInOrder: SHOP_LAST_ORDER,
    qty: 0,
    qtyInOrders: 12,
    supplier: 'Dodávateľ s. r. o.',
    reductionPercent: 20,
    reductionFrom: '2026-07-12 00:00:00',
    reductionTo: '2026-07-20 00:00:00',
    active: true,
    categories: [11, 22],
    enrichedAt: new Date('2026-07-14T06:00:00Z'),
  });

  await catalog.saveEnrichment(P_DEAD, {
    reference: 'SP-90204',
    ean13: null,
    purchasePrice: 4.1,
    margin: 5.9,
    marginPercent: 59,
    sellPriceWithVat: 12,
    lastTimeInOrder: null,
    qty: 3,
    qtyInOrders: 0,
    supplier: null,
    reductionPercent: null,
    reductionFrom: null,
    reductionTo: null,
    active: true,
    categories: null,
    enrichedAt: new Date('2026-07-14T06:00:00Z'),
  });

  // Stav sťahovania: dva dočítané dni, jeden čiastočný, jeden bez riadku, jeden
  // rozbehnutý. Presne tá zmes, v ktorej `SUM()` bez `JOIN`-u klame.
  const state = (ordersSeen: number, status: 'pending' | 'partial' | 'complete') => ({
    ordersSeen,
    status,
    requestsUsed: 1,
    lastError: null,
    startedAt: new Date('2026-07-14T01:00:00Z'),
    finishedAt: status === 'complete' ? new Date('2026-07-14T01:05:00Z') : null,
  });
  await sales.saveSyncState(D1, state(4, 'complete'));
  await sales.saveSyncState(D2, state(6, 'complete'));
  await sales.saveSyncState(D3, state(2, 'partial'));
  await sales.saveSyncState(D5, state(0, 'pending'));

  await sales.replaceDayUnits(D1, [{ productId: P_SOLD, day: D1, units: 2 }]);
  await sales.replaceDayUnits(D2, [{ productId: P_SOLD, day: D2, units: 3 }]);
  await sales.replaceDayUnits(D3, [{ productId: P_SOLD, day: D3, units: 7 }]);
  await sales.replaceDayUnits(D4, [{ productId: P_SOLD, day: D4, units: 11 }]);
}

async function cleanup(): Promise<void> {
  await withMigrationConn(async (conn) => {
    const products = ALL_PRODUCTS.map(() => '?').join(', ');
    const days = ALL_DAYS.map(() => '?').join(', ');
    await conn.query(`DELETE FROM catalog_cache WHERE product_id IN (${products})`, [
      ...ALL_PRODUCTS,
    ]);
    await conn.query(`DELETE FROM product_sales_daily WHERE sale_day IN (${days})`, [...ALL_DAYS]);
    await conn.query(`DELETE FROM sales_sync_state WHERE sale_day IN (${days})`, [...ALL_DAYS]);
  });
}

/** KPI strana nad daným spojením s vpichnutým dňom a krátkymi oknami. */
async function page(conn: Queryable, ids: readonly number[] = ALL_PRODUCTS) {
  return productKpis(ids, {
    today: TODAY,
    shortWindowDays: SHORT_DAYS,
    longWindowDays: LONG_DAYS,
    catalog: createCatalogRepo({ defaultConn: conn }),
    sales: createSalesRepo({ defaultConn: conn }),
    conn,
  });
}

function rowOf(rows: Awaited<ReturnType<typeof page>>['rows'], productId: number) {
  const row = rows.find((candidate) => candidate.productId === productId);
  if (row === undefined) throw new Error(`riadok ${String(productId)} chýba`);
  return row;
}

describe.skipIf(!available)('KPI produktu nad MariaDB — dočítané dni, nie všetky', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  /* ═════ 1. Súčet za okno berie VÝHRADNE dni so `status = 'complete'` ════ */

  it('kusy za okno sčítajú len dočítané dni — 5, nie 23', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const units = await kpiUnitsInCompleteDays(
        [P_SOLD, P_PLAIN],
        { shortFrom: addDays(TODAY, -(SHORT_DAYS - 1)), longFrom: D1, to: TODAY },
        conn,
      );

      const sold = units.get(P_SOLD);
      expect(sold).toBeDefined();
      /*
       * 2 (complete) + 3 (complete) = 5. Deň `partial` so 7 kusmi a deň bez
       * riadku stavu s 11 kusmi do súčtu NEPATRIA: o prvom vieme, že sme ho
       * neprečítali celý, o druhom nevieme nič. Bez `JOIN`-u by tu bolo 23.
       */
      expect(sold?.longUnits).toBe(5);
      // Krátke okno (12.–14. 7.) nemá ani jeden dočítaný deň → nula requestov
      // do súčtu, teda 0 — a že to NIE JE „nepredalo sa", povie pokrytie nižšie.
      expect(sold?.shortUnits).toBe(0);
      // Produkt bez jediného predaja v dotaze vôbec nie je (chýbajúci kľúč).
      expect(units.has(P_PLAIN)).toBe(false);
    });
  });

  it('nedočítané okno hlási „nevieme", nie nulu — a povie, koľko dní chýba', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const result = await page(conn);

      // Dlhé okno: 5 dní, z toho 2 dočítané.
      expect(result.window90.windowDays).toBe(LONG_DAYS);
      expect(result.window90.completeDays).toBe(2);
      expect(result.window90.unknownDays).toBe(3);
      // Krátke okno (12.–14. 7.): ani jeden dočítaný deň.
      expect(result.window30.windowDays).toBe(SHORT_DAYS);
      expect(result.window30.completeDays).toBe(0);
      expect(result.window30.unknownDays).toBe(SHORT_DAYS);

      const sold = rowOf(result.rows, P_SOLD);
      // Dlhé okno: hodnota JE, ale je to dolná hranica.
      expect(sold.units90.units.value).toBe(5);
      expect(sold.units90.units.gap).toBe('days_missing');
      expect(sold.units90.lowerBound).toBe(true);
      // Krátke okno: žiadny dočítaný deň → NULL a dôvod, nikdy nula.
      expect(sold.units30.units.value).toBeNull();
      expect(sold.units30.units.gap).toBe('days_missing');
      expect(sold.units30.units.value).not.toBe(0);

      /*
       * Produkt bez predaja: v dlhom okne sú dva dočítané dni, takže nula JE
       * meraná — ale len za tie dva dni, preto `days_missing` a `lowerBound`.
       * V krátkom okne nie je dočítaný ani jeden deň, takže tam je to `null`.
       * Toto sú presne tie dve rôzne nuly, ktoré sa nesmú zliať.
       */
      const plain = rowOf(result.rows, P_PLAIN);
      expect(plain.units90.units.value).toBe(0);
      expect(plain.units90.units.gap).toBe('days_missing');
      expect(plain.units90.lowerBound).toBe(true);
      expect(plain.units30.units.value).toBeNull();
      expect(plain.units30.units.gap).toBe('days_missing');
      // A značka „bez predaja" NEVZNIKNE, kým okno nie je celé dočítané.
      expect(plain.noSale.mark).toBe(false);
      expect(plain.noSale.proof).toBeNull();
    });
  });

  it('po dočítaní všetkých dní sa „nevieme" preklopí na číslo a na zmeranú nulu', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const sales = createSalesRepo({ defaultConn: conn });
      for (const day of ALL_DAYS) {
        await sales.saveSyncState(day, {
          ordersSeen: 4,
          status: 'complete',
          requestsUsed: 1,
          lastError: null,
          startedAt: new Date('2026-07-14T01:00:00Z'),
          finishedAt: new Date('2026-07-14T01:05:00Z'),
        });
      }

      const result = await page(conn);
      expect(result.window90.unknownDays).toBe(0);

      const sold = rowOf(result.rows, P_SOLD);
      // Teraz už do súčtu patria všetky štyri dni s predajom: 2+3+7+11.
      expect(sold.units90.units.value).toBe(23);
      expect(sold.units90.units.gap).toBeNull();
      expect(sold.units90.lowerBound).toBe(false);
      // Krátke okno (12.–14. 7.) je tiež celé dočítané: 7 + 11 + 0.
      expect(sold.units30.units.value).toBe(18);
      expect(sold.units30.units.gap).toBeNull();

      // Dočítané okno bez riadku v `product_sales_daily` je ZMERANÁ nula…
      const plain = rowOf(result.rows, P_PLAIN);
      expect(plain.units90.units.value).toBe(0);
      expect(plain.units90.units.gap).toBeNull();
      // …a až teraz smie vzniknúť značka „bez predaja".
      expect(plain.noSale.mark).toBe(true);
      expect(plain.noSale.proof).toBe('no_sale_in_covered_days');
    });
  });

  /* ═════════ 2. Obohatenie: hodnoty prežijú DB, NULL zostane NULL ════════ */

  it('obohatený riadok vydá KPI presne tak, ako sú v DB', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const sold = rowOf((await page(conn)).rows, P_SOLD);

      expect(sold.missing).toBe(false);
      expect(sold.name).toBe(`Testovací šperk ${String(P_SOLD)}`);
      expect(sold.listPrice).toBe('19.99');
      expect(sold.reference.value).toBe('SP-90201');
      expect(sold.supplier.value).toBe('Dodávateľ s. r. o.');
      expect(sold.priceWithVat.value).toBe(23.99);
      expect(sold.purchasePrice.value).toBe(6.3);
      // MARŽA SA NEPREPOČÍTAVA: z 23.99 a 6.30 by vyšlo 17.69, resp. ~73.7 %.
      expect(sold.margin.value).toBe(7.77);
      expect(sold.marginPercent.value).toBe(11.11);
      // `qty = 0` je vypredané, nie „nevieme" — nula musí prejsť DB ako nula.
      expect(sold.stock.value).toBe(0);
      expect(sold.stock.gap).toBeNull();
      expect(sold.soldTotal.value).toBe(12);
      // Pomer pri sklade 0 hodnotu NEMÁ — a to je iný dôvod než „nevieme".
      expect(sold.soldPerStock.value).toBeNull();
      expect(sold.soldPerStock.gap).toBe('not_computable');
      // Posledný predaj: 4. 7. → k 14. 7. je to desať dní.
      expect(sold.daysSinceLastSale.value).toBe(10);
      expect(sold.enrichedAt).not.toBeNull();
    });
  });

  it('aktívna zľava je stav PODĽA SHOPU aj s časom merania (I11)', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const rows = (await page(conn)).rows;

      const sold = rowOf(rows, P_SOLD);
      expect(sold.discount.state).toBe('running');
      expect(sold.discount.activePercent.value).toBe(20);
      expect(sold.discount.measuredAt).not.toBeNull();

      // Obohatený bez zľavy = MERANÉ „nič nebeží", nie 0 %.
      const dead = rowOf(rows, P_DEAD);
      expect(dead.discount.state).toBe('none');
      expect(dead.discount.activePercent.value).toBeNull();
      expect(dead.discount.activePercent.gap).toBe('shop_has_none');
      expect(dead.discount.measuredAt).not.toBeNull();

      // Neobohatený o zľave nevie nič a nemá ani čas merania.
      const plain = rowOf(rows, P_PLAIN);
      expect(plain.discount.state).toBe('unknown');
      expect(plain.discount.activePercent.gap).toBe('not_enriched');
      expect(plain.discount.measuredAt).toBeNull();
    });
  });

  it('NEOBOHATENÝ produkt v zrkadle: všade `not_enriched`, nikde nula', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const plain = rowOf((await page(conn)).rows, P_PLAIN);

      expect(plain.missing).toBe(false);
      expect(plain.enrichedAt).toBeNull();
      // Názov a cenníková cena zo zoznamového prechodu známe sú — obohatenie nie.
      expect(plain.name).toBe(`Testovací šperk ${String(P_PLAIN)}`);
      expect(plain.listPrice).toBe('19.99');
      for (const [label, value] of [
        ['referencia', plain.reference],
        ['dodávateľ', plain.supplier],
        ['cena s DPH', plain.priceWithVat],
        ['nákupná cena', plain.purchasePrice],
        ['marža €', plain.margin],
        ['marža %', plain.marginPercent],
        ['sklad', plain.stock],
        ['celkovo predané', plain.soldTotal],
        ['posledný predaj', plain.lastSaleAt],
        ['dni od predaja', plain.daysSinceLastSale],
        ['predané / sklad', plain.soldPerStock],
      ] as const) {
        expect(value.value, `${label}: musí byť null`).toBeNull();
        expect(value.gap, `${label}: musí povedať dôvod`).toBe('not_enriched');
        expect(value.value, `${label}: nula je zakázaná (I11)`).not.toBe(0);
      }
    });
  });

  it('produkt, ktorý zrkadlo NEMÁ, je `missing` — a nie mŕtvy produkt', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const missing = rowOf((await page(conn)).rows, P_MISSING);

      expect(missing.missing).toBe(true);
      expect(missing.name).toBeNull();
      expect(missing.listPrice).toBeNull();
      expect(missing.reference.gap).toBe('not_enriched');
      expect(missing.noSale.mark).toBe(false);
    });
  });

  it('shop o produkte nemá ani jednu objednávku → dôkaz `shop_never_ordered`', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const dead = rowOf((await page(conn)).rows, P_DEAD);

      expect(dead.lastSaleAt.value).toBeNull();
      expect(dead.lastSaleAt.gap).toBe('shop_has_none');
      expect(dead.soldTotal.value).toBe(0);
      expect(dead.soldTotal.gap).toBeNull();
      expect(dead.noSale.mark).toBe(true);
      expect(dead.noSale.proof).toBe('shop_never_ordered');
      // Sklad 3 pri nule predaných → pomer je 0, a to je MERANÁ hodnota.
      expect(dead.soldPerStock.value).toBe(0);
      expect(dead.soldPerStock.gap).toBeNull();
    });
  });

  it('shop hodiny posledného predaja sa neposunú (uloží sa znak za znakom)', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const rows = (await conn.query(
        'SELECT CAST(last_time_in_order AS CHAR) AS stamp FROM catalog_cache WHERE product_id = ?',
        [P_SOLD],
      )) as Array<{ stamp: string }>;
      const first = rows[0];
      expect(first === undefined ? null : first.stamp).toBe(SHOP_LAST_ORDER);
    });
  });

  /* ═══════════ 3. Sto produktov = TRI dotazy, žiadne N+1 (D114) ══════════ */

  it('strana 100 produktov prečíta presne tri dotazy', async () => {
    await withAppConn(async (conn) => {
      await seed(conn);
      const { wrapped, calls } = countingConn(conn);
      const ids = Array.from({ length: 100 }, (_, i) => 90_201 + i);

      const result = await productKpis(ids, {
        today: TODAY,
        shortWindowDays: SHORT_DAYS,
        longWindowDays: LONG_DAYS,
        catalog: createCatalogRepo({ defaultConn: wrapped }),
        sales: createSalesRepo({ defaultConn: wrapped }),
        conn: wrapped,
      });

      expect(result.rows).toHaveLength(100);
      /*
       * Tri dotazy: riadky zrkadla s obohatením, stav dní okna, kusy za obe
       * okná. Nič nezávisí od počtu produktov — pri N+1 by tu bolo 101 a viac.
       */
      expect(calls).toHaveLength(3);
      expect(calls.filter((sql) => sql.includes('FROM catalog_cache'))).toHaveLength(1);
      expect(calls.filter((sql) => sql.includes('FROM sales_sync_state'))).toHaveLength(1);
      expect(calls.filter((sql) => sql.includes('FROM product_sales_daily'))).toHaveLength(1);
      // A ten jeden dotaz na kusy MUSÍ mať bránu dočítaných dní.
      const unitsSql = calls.find((sql) => sql.includes('FROM product_sales_daily s'));
      expect(unitsSql).toContain("status = 'complete'");
    });
  });
});
