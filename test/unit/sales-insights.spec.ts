/**
 * Aura Zľavy — testy odvodených metrík PREDAJNOSTI
 * (KONTRAKT-PREDAJNOST-2026-08-06, P1, P3, P4).
 *
 * `summarizeCoverage()`, `splitCoverage()` a `salesMetrics()` sú čisté funkcie:
 * testujú sa offline, bez DB a bez siete — presne ako pravidlový analytik.
 *
 * Okrem výpočtov sa tu stráži POCTIVOSŤ (I11):
 *   · bez pokrytého dňa nesmie vzniknúť `unitsPerDay` ani `hasData: true`,
 *   · nikde v predajnosti sa obrátkovosť nesmie tváriť ako vypočítaná —
 *     karta „Obrátkovosť" musí zostať zamknutá.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ProductSalesDay, Queryable, SalesSyncDay } from '@/contracts';

import {
  MIN_DAYS_FOR_TREND,
  describeCoverageSk,
  latestSyncStop,
  salesMetrics,
  splitCoverage,
  summarizeCoverage,
  syncDays,
} from '@/lib/sales/insights';

const TODAY = '2026-08-06';

function syncDay(saleDay: string, overrides: Partial<SalesSyncDay> = {}): SalesSyncDay {
  return {
    saleDay,
    status: 'complete',
    finishedAt: `${saleDay}T23:00:00.000Z`,
    updatedAt: `${saleDay}T23:00:00.000Z`,
    ordersSeen: 4,
    ...overrides,
  };
}

const coverageOf = (rows: SalesSyncDay[], windowDays = 3) =>
  summarizeCoverage(rows, { syncEnabled: true, windowDays });

const products = [
  { productId: 201, name: 'Prsteň', label: 'A' },
  { productId: 202, name: null, label: 'B' },
];

const day = (productId: number, saleDay: string, unitsSold: number): ProductSalesDay => ({
  productId,
  saleDay,
  unitsSold,
});

/* ══════════════════════════ 1. Pokrytie obdobia ═══════════════════════════ */

describe('summarizeCoverage — za aké obdobie dáta NAOZAJ sú (P3)', () => {
  it('bez riadkov nie je pokrytý ani jeden deň a `hasData` je false', () => {
    const coverage = coverageOf([]);
    expect(coverage).toMatchObject({
      from: null,
      to: null,
      daysCovered: 0,
      daysPartial: 0,
      hasData: false,
      lastSyncedAt: null,
      syncEnabled: true,
      windowDays: 3,
    });
  });

  it('`pending` deň nie je pokrytie — sťahovanie ešte nebolo', () => {
    const coverage = coverageOf([
      syncDay('2026-08-04', { status: 'pending', finishedAt: null }),
      syncDay('2026-08-05'),
    ]);
    expect(coverage.daysCovered).toBe(1);
    expect(coverage.from).toBe('2026-08-05');
    expect(coverage.to).toBe('2026-08-05');
    expect(coverage.hasData).toBe(true);
  });

  it('`partial` deň sa počíta do pokrytia a zvlášť aj ako čiastočný (P6)', () => {
    const coverage = coverageOf([
      syncDay('2026-08-04'),
      syncDay('2026-08-05', { status: 'partial', finishedAt: null }),
    ]);
    expect(coverage.daysCovered).toBe(2);
    expect(coverage.daysPartial).toBe(1);
  });

  /**
   * Regres z 24. 8. 2026. `sales_sync_state` malo dva dni `complete`
   * (5. a 6. 8., spolu 1073 kusov) a ďalších štrnásť dní `partial`
   * s `orders_seen = 0` — dni, na ktorých shop čítanie odmietol. Kým sa
   * počítali ako pokryté, `unitsPerDay` sa delilo šestnástimi a každé číslo
   * o predajnosti bolo zhruba osemkrát nižšie než to, čo appka zmerala.
   */
  it('`partial` bez jedinej objednávky pokrytie NIE JE — je to dotyk, nie meranie', () => {
    const coverage = coverageOf([
      syncDay('2026-08-04'),
      syncDay('2026-08-05', { status: 'partial', finishedAt: null, ordersSeen: 0 }),
    ]);
    expect(coverage.daysCovered).toBe(1);
    expect(coverage.daysPartial).toBe(0);
    // Deň bez merania nesmie natiahnuť ani hranice pokrytia.
    expect(coverage.to).toBe('2026-08-04');
  });

  it('`complete` s nulou pokrytie JE — appka deň prečítala a nič sa nepredalo', () => {
    const coverage = coverageOf([syncDay('2026-08-04', { ordersSeen: 0 })]);
    expect(coverage.daysCovered).toBe(1);
    expect(coverage.hasData).toBe(true);
  });

  it('neznámy počet objednávok sa vyhodnotí prísnejšie, nie voľnejšie', () => {
    const coverage = coverageOf([
      syncDay('2026-08-04'),
      syncDay('2026-08-05', { status: 'partial', finishedAt: null, ordersSeen: undefined }),
    ]);
    expect(coverage.daysCovered).toBe(1);
  });

  it('nezmeraný deň neriedi priemer kusov na deň', () => {
    // Presne ten tvar, ktorý mala DB 24. 8. 2026: dva zmerané dni a k tomu
    // rad dní, ktoré shop odmietol.
    const rows = [
      syncDay('2026-08-04'),
      syncDay('2026-08-05'),
      ...['2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'].map((d) =>
        syncDay(d, { status: 'partial' as const, finishedAt: null, ordersSeen: 0 }),
      ),
    ];
    const coverage = coverageOf(rows, 3);
    const metrics = salesMetrics({
      products: [products[0]!],
      days: [day(201, '2026-08-04', 10), day(201, '2026-08-05', 10)],
      coverage,
      today: TODAY,
    });

    expect(coverage.daysCovered).toBe(2);
    expect(metrics[0]?.unitsPerDay).toBe(10);
  });

  it('`lastSyncedAt` je najnovší dotyk — aj z dňa, ktorý zostal pending', () => {
    const coverage = coverageOf([
      syncDay('2026-08-04'),
      syncDay('2026-08-06', {
        status: 'pending',
        finishedAt: null,
        updatedAt: '2026-08-06T05:30:00.000Z',
      }),
    ]);
    expect(coverage.lastSyncedAt).toBe('2026-08-06T05:30:00.000Z');
    // Pending deň pokrytie nerozšíril — od–do zostáva pri skutočných dátach.
    expect(coverage.to).toBe('2026-08-04');
  });

  it('vypnutá synchronizácia sa nesie do odpovede, nie sa mlčky obchádza', () => {
    expect(summarizeCoverage([], { syncEnabled: false, windowDays: 3 }).syncEnabled).toBe(false);
  });

  it('popis obdobia bez dát nikdy nevyzerá ako obdobie', () => {
    expect(describeCoverageSk(coverageOf([]))).toBe('zatiaľ bez dát');
    expect(describeCoverageSk(coverageOf([syncDay('2026-08-05')]))).toContain('2026-08-05');
  });
});

/* ═══════════════════════ 2. Delenie na polovice ═══════════════════════════ */

describe('splitCoverage — trend len keď je z čoho', () => {
  it('kratšie obdobie než minimum sa nedelí (žiadny falošný trend)', () => {
    for (let days = 1; days < MIN_DAYS_FOR_TREND; days += 1) {
      const rows = Array.from({ length: days }, (_, i) => syncDay(`2026-08-0${i + 1}`));
      expect(splitCoverage(coverageOf(rows))).toBeNull();
    }
  });

  it('štyri dni sa delia 2 : 2 (novšia polovica je na konci)', () => {
    const rows = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'].map((d) => syncDay(d));
    expect(splitCoverage(coverageOf(rows))).toEqual({
      previousFrom: '2026-08-01',
      previousTo: '2026-08-02',
      recentFrom: '2026-08-03',
      recentTo: '2026-08-04',
    });
  });

  it('nepárny počet dní dá deň navyše NOVŠEJ polovici', () => {
    const rows = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((d) =>
      syncDay(d),
    );
    const split = splitCoverage(coverageOf(rows));
    expect(split).toEqual({
      previousFrom: '2026-08-01',
      previousTo: '2026-08-02',
      recentFrom: '2026-08-03',
      recentTo: '2026-08-05',
    });
  });
});

/* ════════════════════════════ 3. Metriky ══════════════════════════════════ */

describe('salesMetrics — kusy, kusy/deň, dni od posledného predaja', () => {
  const coverage = coverageOf(
    ['2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((d) => syncDay(d)),
  );

  it('spočíta kusy za obdobie a vydelí ich POKRYTÝMI dňami', () => {
    const rows = salesMetrics({
      products,
      days: [day(201, '2026-08-02', 3), day(201, '2026-08-05', 5)],
      coverage,
      today: TODAY,
    });
    const first = rows.find((r) => r.productId === 201);
    expect(first?.unitsSold).toBe(8);
    expect(first?.unitsPerDay).toBe(2); // 8 / 4 pokryté dni
    expect(first?.lastSaleDay).toBe('2026-08-05');
    expect(first?.daysSinceLastSale).toBe(1);
  });

  it('produkt bez predaja je v zozname s nulou a bez „dní od predaja"', () => {
    const rows = salesMetrics({ products, days: [], coverage, today: TODAY });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.unitsSold).toBe(0);
      expect(row.unitsPerDay).toBe(0);
      expect(row.lastSaleDay).toBeNull();
      expect(row.daysSinceLastSale).toBeNull();
    }
  });

  it('bez pokrytého dňa sa `unitsPerDay` NEDOPOČÍTAVA (delenie nulou, I11)', () => {
    const rows = salesMetrics({ products, days: [], coverage: coverageOf([]), today: TODAY });
    for (const row of rows) {
      expect(row.unitsPerDay).toBeNull();
      expect(row.recentUnits).toBeNull();
      expect(row.previousUnits).toBeNull();
    }
  });

  it('riadky mimo pokrytého obdobia sa ignorujú (staré dáta neposúvajú súčet)', () => {
    const rows = salesMetrics({
      products,
      days: [day(201, '2026-07-01', 100), day(201, '2026-08-03', 2)],
      coverage,
      today: TODAY,
    });
    expect(rows.find((r) => r.productId === 201)?.unitsSold).toBe(2);
  });

  it('deň s nulou neposúva „posledný predaj" — nula nie je predaj', () => {
    const rows = salesMetrics({
      products,
      days: [day(202, '2026-08-02', 1), day(202, '2026-08-05', 0)],
      coverage,
      today: TODAY,
    });
    expect(rows.find((r) => r.productId === 202)?.lastSaleDay).toBe('2026-08-02');
  });

  it('polovice obdobia sú rozdelené podľa dní, nie podľa počtu riadkov', () => {
    const rows = salesMetrics({
      products,
      days: [
        day(201, '2026-08-02', 4),
        day(201, '2026-08-03', 4),
        day(201, '2026-08-04', 1),
        day(201, '2026-08-05', 0),
      ],
      coverage,
      today: TODAY,
    });
    const first = rows.find((r) => r.productId === 201);
    expect(first?.previousUnits).toBe(8);
    expect(first?.recentUnits).toBe(1);
  });

  it('neznámy produkt v riadkoch nevytvorí nový výstupný riadok', () => {
    const rows = salesMetrics({
      products,
      days: [day(999, '2026-08-03', 50)],
      coverage,
      today: TODAY,
    });
    expect(rows.map((r) => r.productId)).toEqual([201, 202]);
  });

  it('nezmyselné „dnes" nezhodí výpočet, len nezmeria vek predaja', () => {
    const rows = salesMetrics({
      products,
      days: [day(201, '2026-08-03', 1)],
      coverage,
      today: 'zajtra',
    });
    const first = rows.find((r) => r.productId === 201);
    expect(first?.unitsSold).toBe(1);
    expect(first?.daysSinceLastSale).toBeNull();
  });
});

/* ═════════════════ 4. Predajnosť nie je obrátkovosť (I11) ═════════════════ */

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

/**
 * ZMENA V3 (K9): karty `components/ai/SalesCard.tsx` a `TurnoverCard.tsx`
 * zanikli spolu s tabom `/ai-agent`. Predané kusy sa dnes zobrazujú
 * v Produktoch (tabuľka + bočný panel) a zoznam toho, čo je zamknuté a prečo,
 * má jediné miesto v Nastaveniach (`LockedFeatures`, K8). Tvrdenie I11
 * zostáva to isté — mení sa len súbor, na ktorom sa dokazuje.
 */
describe('predajnosť sa nikde nevydáva za obrátkovosť', () => {
  it('modul metrík ani povrch s predanými kusmi nepočítajú obrátkovosť ani COGS', () => {
    for (const path of [
      'src/lib/sales/insights.ts',
      'src/components/products/ProductDetailPanel.tsx',
      'src/components/products/CatalogTable.tsx',
    ]) {
      const code = read(path);
      // Slovo smie padnúť len v popise toho, čo appka NEVIE — nikdy ako
      // názov metriky, premennej či vzorca.
      expect(/\bturnover\b/i.test(code), `${path} nesmie mať metriku obrátkovosti`).toBe(false);
      expect(/\bcogs\s*[=:]/i.test(code), `${path} nesmie dopočítavať COGS`).toBe(false);
    }
  });

  it('povrch s predajnosťou pomenúva metriku ako KUSY, nikdy ako obrat', () => {
    const panel = read('src/components/products/ProductDetailPanel.tsx');
    expect(panel).toContain('predaných za posledných');
    const table = read('src/components/products/CatalogTable.tsx');
    expect(table).toContain('Predané');
    // Obrat na produkt sa priradiť nedá (P4) — nesmie sa objaviť ani ako slovo.
    for (const code of [panel, table]) {
      expect(/\bobrat\b/i.test(code)).toBe(false);
      expect(/\bobrátkovosť\b/i.test(code)).toBe(false);
    }
  });

  it('Obrátkovosť zostáva ZAMKNUTÁ a na jedinom mieste hovorí, čo chýba', () => {
    const locked = read('src/components/settings/LockedFeatures.tsx');
    expect(locked).toContain('Obrátkovosť');
    // Chýbajú nákupné ceny (COGS) — nie predaje.
    expect(locked).toContain('nákupné ceny');
    expect(locked).toContain('Predané kusy fungujú vždy');
    // Vo filtroch je viditeľná, ale neklikateľná (K8) — nie skrytá.
    const filters = read('src/components/products/CatalogFilters.tsx');
    expect(filters).toContain("turnover: 'Obrátkovosť'");
    expect(filters).toContain('aria-disabled="true"');
  });
});

/* ════════ Čítanie stavu z DB — bez kontajnera, cez podstrčené spojenie ═════ */

/** Spojenie, ktoré zapíše dotaz a vráti pripravené riadky. Žiadna DB. */
function fakeConn(rows: unknown[]): Queryable & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    query: async <T,>(text: string): Promise<T> => {
      sql.push(text);
      return rows as T;
    },
  };
}

describe('syncDays — riadok DB → stav dňa', () => {
  it('prenesie počet objednávok, inak sa pokrytie nedá rozhodnúť', async () => {
    const conn = fakeConn([
      { sale_day: '2026-08-05', status: 'complete', orders_seen: 298, finished_at: null, updated_at: null },
      { sale_day: '2026-08-07', status: 'partial', orders_seen: 0, finished_at: null, updated_at: null },
    ]);

    const rows = await syncDays(conn);

    expect(conn.sql[0]).toContain('orders_seen');
    expect(rows.map((r) => r.ordersSeen)).toEqual([298, 0]);
    // A rovno dôkaz, že sa to prepíše do pokrytia: zmeraný je len prvý deň.
    expect(summarizeCoverage(rows, { syncEnabled: true, windowDays: 3 }).daysCovered).toBe(1);
  });

  it('nečitateľný počet je nula, nie NaN — pokrytie sa oň nesmie potknúť', async () => {
    const conn = fakeConn([
      { sale_day: '2026-08-05', status: 'partial', orders_seen: null, finished_at: null, updated_at: null },
    ]);

    const rows = await syncDays(conn);

    expect(rows[0]?.ordersSeen).toBe(0);
  });
});

describe('latestSyncStop — na čom stojí synchronizácia', () => {
  it('prečíta posledný kód aj vek prekážky', async () => {
    const at = new Date('2026-08-24T06:58:08.497Z');
    const since = new Date('2026-08-09T07:18:54.533Z');
    const conn = fakeConn([{ last_code: 'ip_banned', last_at: at, since }]);

    const stop = await latestSyncStop(conn);

    expect(stop).toEqual({ code: 'ip_banned', at, since });
  });

  it('prázdna tabuľka nie je prekážka — appka ešte nikdy nebežala', async () => {
    const stop = await latestSyncStop(fakeConn([{ last_code: null, last_at: null, since: null }]));

    expect(stop).toEqual({ code: null, at: null, since: null });
  });
});
