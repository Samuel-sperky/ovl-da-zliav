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

import type { ProductSalesDay, SalesSyncDay } from '@/contracts';

import {
  MIN_DAYS_FOR_TREND,
  describeCoverageSk,
  salesMetrics,
  splitCoverage,
  summarizeCoverage,
} from '@/lib/sales/insights';

const TODAY = '2026-08-06';

function syncDay(saleDay: string, overrides: Partial<SalesSyncDay> = {}): SalesSyncDay {
  return {
    saleDay,
    status: 'complete',
    finishedAt: `${saleDay}T23:00:00.000Z`,
    updatedAt: `${saleDay}T23:00:00.000Z`,
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

describe('predajnosť sa nikde nevydáva za obrátkovosť', () => {
  it('modul metrík ani karta Predajnosť nepočítajú obrátkovosť ani COGS', () => {
    for (const path of ['src/lib/sales/insights.ts', 'src/components/ai/SalesCard.tsx']) {
      const code = read(path);
      // Slovo smie padnúť len v popise toho, čo appka NEVIE — nikdy ako
      // názov metriky, premennej či vzorca.
      expect(/\bturnover\b/i.test(code), `${path} nesmie mať metriku obrátkovosti`).toBe(false);
      expect(/\bcogs\s*[=:]/i.test(code), `${path} nesmie dopočítavať COGS`).toBe(false);
    }
  });

  it('karta Predajnosť pomenúva metriku ako kusy a odmieta obrat', () => {
    const card = read('src/components/ai/SalesCard.tsx');
    expect(card).toContain('kusov');
    expect(card).toContain('Nie je');
    expect(card).toContain('obrátkovosť');
  });

  it('karta Obrátkovosť zostáva ZAMKNUTÁ a hovorí, čo ešte chýba', () => {
    const card = read('src/components/ai/TurnoverCard.tsx');
    expect(card).toContain('aria-disabled="true"');
    expect(card).toContain('zamknuté');
    // Chýba už len COGS a zásoba nevariantných produktov — predaje nie.
    expect(card).toContain('turnover-missing-cogs');
    expect(card).toContain('turnover-missing-stock');
    expect(card).toContain('turnover-sales-ok');
    expect(card).toContain('Predaje už nechýbajú');
    // Vzorec zostáva citovaný ako CIEĽ, nie ako výsledok.
    expect(card).toContain('turnover-formula');
  });
});
