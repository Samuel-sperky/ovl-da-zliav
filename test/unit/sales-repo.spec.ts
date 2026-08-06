/**
 * Aura Zľavy — repozitár predajnosti: tvar SQL a idempotencia (P4, P7, I8').
 *
 * Bez DB: `Queryable` je fake, ktorý zachytáva presné SQL a hodnoty. Testuje sa
 * to, čo je na repozitári kritické — že upsert je ABSOLÚTNY (nie inkrement),
 * že je parametrizovaný a že sa v ňom nevyskytne ani jeden zákaznícky stĺpec.
 */
import { describe, expect, it } from 'vitest';

import type { DbRow, Queryable } from '@/contracts';

import { createSalesRepo } from '@/lib/repo/sales.repo';

interface Captured {
  sql: string;
  values: unknown[];
}

function fakeConn(rowsFor: (sql: string) => DbRow[] = () => []): {
  conn: Queryable;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  return {
    calls,
    conn: {
      async query<T = unknown>(sql: string, values?: unknown): Promise<T> {
        calls.push({ sql, values: Array.isArray(values) ? values : [] });
        return rowsFor(sql) as T;
      },
    },
  };
}

describe('sales.repo — denné súčty kusov', () => {
  it('upsert je ABSOLÚTNY, nie inkrement (P7)', async () => {
    const { conn, calls } = fakeConn();
    const repo = createSalesRepo({ defaultConn: conn });

    await repo.replaceDayUnits('2026-08-06', [
      { productId: 12, day: '2026-08-06', units: 3 },
      { productId: 11, day: '2026-08-06', units: 7 },
    ]);

    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO product_sales_daily'));
    expect(insert).toBeDefined();
    expect(insert?.sql).toContain('ON DUPLICATE KEY UPDATE units_sold = VALUES(units_sold)');
    // Ani náhodou `units_sold + ?` — to by opakovaný beh zdvojnásobil.
    expect(insert?.sql).not.toMatch(/units_sold\s*=\s*units_sold/);
    // Deterministické poradie produktov a parametrizované hodnoty.
    expect(insert?.values).toEqual([11, '2026-08-06', 7, 12, '2026-08-06', 3]);
  });

  it('sčíta duplicitné riadky toho istého produktu a zahodí cudzí deň', async () => {
    const { conn, calls } = fakeConn();
    const repo = createSalesRepo({ defaultConn: conn });

    const written = await repo.replaceDayUnits('2026-08-06', [
      { productId: 11, day: '2026-08-06', units: 2 },
      { productId: 11, day: '2026-08-06', units: 5 },
      { productId: 99, day: '2026-08-05', units: 100 },
      { productId: 0, day: '2026-08-06', units: 4 },
    ]);

    expect(written).toBe(1);
    const insert = calls.find((c) => c.sql.startsWith('INSERT INTO product_sales_daily'));
    expect(insert?.values).toEqual([11, '2026-08-06', 7]);
  });

  it('produkt, ktorý po prepočte dňa vypadol, sa pre daný deň zmaže', async () => {
    const { conn, calls } = fakeConn();
    const repo = createSalesRepo({ defaultConn: conn });

    await repo.replaceDayUnits('2026-08-06', [{ productId: 11, day: '2026-08-06', units: 1 }]);

    const del = calls.find((c) => c.sql.startsWith('DELETE FROM product_sales_daily'));
    expect(del?.sql).toContain('WHERE sale_day = ? AND product_id NOT IN (?)');
    expect(del?.values).toEqual(['2026-08-06', 11]);
  });

  it('deň bez predaja len zmaže staré súčty', async () => {
    const { conn, calls } = fakeConn();
    const repo = createSalesRepo({ defaultConn: conn });

    expect(await repo.replaceDayUnits('2026-08-06', [])).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe('DELETE FROM product_sales_daily WHERE sale_day = ?');
    expect(calls[0].values).toEqual(['2026-08-06']);
  });

  it('nezmyselný deň sa do dotazu vôbec nedostane', async () => {
    const { conn, calls } = fakeConn();
    const repo = createSalesRepo({ defaultConn: conn });
    expect(await repo.replaceDayUnits('6.8.2026', [{ productId: 1, day: '6.8.2026', units: 1 }])).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('sales.repo — stav synchronizácie', () => {
  it('zápis stavu je upsert celého dňa', async () => {
    const { conn, calls } = fakeConn();
    const repo = createSalesRepo({ defaultConn: conn });
    const startedAt = new Date('2026-08-06T00:05:00.000Z');

    await repo.saveSyncState('2026-08-06', {
      ordersSeen: 42,
      status: 'partial',
      requestsUsed: 45,
      lastError: 'rate_limited',
      startedAt,
      finishedAt: null,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('INSERT INTO sales_sync_state');
    expect(calls[0].sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(calls[0].values).toEqual([
      '2026-08-06',
      42,
      'partial',
      45,
      'rate_limited',
      startedAt,
      null,
    ]);
  });

  it('`last_error` sa skráti na dĺžku stĺpca — telo odpovede sa tam nezmestí (I1)', async () => {
    const { conn, calls } = fakeConn();
    const repo = createSalesRepo({ defaultConn: conn });

    await repo.saveSyncState('2026-08-06', {
      ordersSeen: 0,
      status: 'partial',
      requestsUsed: 1,
      lastError: 'x'.repeat(500),
      startedAt: null,
      finishedAt: null,
    });

    expect(String(calls[0].values[4])).toHaveLength(200);
  });

  it('čítanie stavu mapuje riadok na záznam a bráni sa neplatnému stavu', async () => {
    const { conn } = fakeConn(() => [
      {
        sale_day: '2026-08-06',
        orders_seen: 7,
        status: 'nezmysel',
        requests_used: 9,
        last_error: null,
        started_at: null,
        finished_at: null,
      },
    ]);
    const repo = createSalesRepo({ defaultConn: conn });

    const state = await repo.getSyncState('2026-08-06');
    expect(state).toEqual({
      day: '2026-08-06',
      ordersSeen: 7,
      status: 'pending', // neznámy stav sa nikdy nevydá za `complete`
      requestsUsed: 9,
      lastError: null,
      startedAt: null,
      finishedAt: null,
    });
  });

  it('rozsah stavov je zastropovaný a odmietne obrátené okno', async () => {
    const { conn, calls } = fakeConn(() => []);
    const repo = createSalesRepo({ defaultConn: conn });

    expect(await repo.listSyncStates('2026-08-08', '2026-08-06')).toEqual([]);
    expect(calls).toEqual([]);

    await repo.listSyncStates('2026-08-04', '2026-08-06');
    expect(calls[0].sql).toContain('LIMIT ?');
    expect(calls[0].values).toEqual(['2026-08-04', '2026-08-06', 400]);
  });
});

describe('sales.repo — I8\': žiadny zákaznícky stĺpec', () => {
  it('v žiadnom dotaze sa nevyskytne objednávka, krajina ani suma', async () => {
    const { conn, calls } = fakeConn(() => []);
    const repo = createSalesRepo({ defaultConn: conn });

    await repo.replaceDayUnits('2026-08-06', [{ productId: 11, day: '2026-08-06', units: 1 }]);
    await repo.saveSyncState('2026-08-06', {
      ordersSeen: 1,
      status: 'complete',
      requestsUsed: 2,
      lastError: null,
      startedAt: null,
      finishedAt: null,
    });
    await repo.getSyncState('2026-08-06');
    await repo.listSyncStates('2026-08-04', '2026-08-06');

    const forbidden =
      /\b(order_id|id_order|customer|cart|invoice|email|phone|address|iban|payment|country|country_iso|total_paid)\b/i;
    for (const call of calls) expect(call.sql).not.toMatch(forbidden);
    expect(calls.length).toBeGreaterThan(3);
  });
});
