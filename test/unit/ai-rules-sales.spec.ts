/**
 * Aura Zľavy — testy pravidiel analytika nad REÁLNYMI PREDAJMI
 * (KONTRAKT-PREDAJNOST-2026-08-06, P1, P3, P4).
 *
 * Samostatný spec súbor zámerne: `ai-rules.spec.ts` vlastní sekcia C3 pre V1
 * a import medzi spec súbormi by jeho testy registroval dvakrát.
 *
 * Čo sa tu stráži:
 *   · bez predajov (`sales: null`) pravidlá o predaji MLČIA — nula bez dát by
 *     vyzerala ako „nepredáva sa" (I11),
 *   · každé zistenie o predaji povie obdobie, za ktoré platí (P3),
 *   · každé zistenie má akciu, ktorá otvára drawer novej kampane — analytik
 *     sám nikdy nezapisuje (I3),
 *   · nikde sa nehovorí o obrate ani o obrátkovosti (P4, I11).
 */
import { describe, expect, it } from 'vitest';

import {
  SALES_DROP_MIN_PREVIOUS,
  analyze,
  type Finding,
  type RuleProductSales,
  type RuleSalesWindow,
  type RuleSnapshot,
} from '@/lib/ai/rules';

const TODAY = '2026-08-06';

function product(overrides: Partial<RuleProductSales> = {}): RuleProductSales {
  return {
    productId: 201,
    name: 'Prsteň',
    label: 'A',
    unitsSold: 6,
    unitsPerDay: 1.5,
    lastSaleDay: '2026-08-05',
    daysSinceLastSale: 1,
    recentUnits: 3,
    previousUnits: 3,
    ...overrides,
  };
}

function salesWindow(overrides: Partial<RuleSalesWindow> = {}): RuleSalesWindow {
  return {
    from: '2026-08-02',
    to: '2026-08-05',
    daysCovered: 4,
    lastSyncedAt: '2026-08-06T02:00:00.000Z',
    products: [product()],
    ...overrides,
  };
}

function snapshot(sales: RuleSalesWindow | null): RuleSnapshot {
  return {
    today: TODAY,
    keyPresent: true,
    keyExpiresAt: '2026-09-30T12:00:00.000Z',
    campaigns: [],
    allowlist: [],
    variantStock: [],
    sales,
  };
}

const kinds = (findings: Finding[]): string[] => findings.map((f) => f.kind);

/* ═════════════════════════ 1. Mlčanie bez dát ═════════════════════════════ */

describe('bez predajov pravidlá o predajnosti mlčia (I11)', () => {
  it('`sales: null` nevygeneruje ani jedno zistenie o predaji', () => {
    expect(analyze(snapshot(null))).toEqual([]);
  });

  it('chýbajúce pole `sales` sa chová rovnako ako `null`', () => {
    const s = snapshot(null);
    delete s.sales;
    expect(analyze(s)).toEqual([]);
  });

  it('pokrytie 0 dní nič nehlási, ani keď zoznam produktov nie je prázdny', () => {
    const findings = analyze(
      snapshot(salesWindow({ daysCovered: 0, products: [product({ unitsSold: 0 })] })),
    );
    expect(findings).toEqual([]);
  });

  it('nezmyselné obdobie je fail-closed (žiadne zistenie)', () => {
    const findings = analyze(
      snapshot(salesWindow({ from: 'nikdy', products: [product({ unitsSold: 0 })] })),
    );
    expect(findings).toEqual([]);
  });
});

/* ══════════════════ 2. Produkt sa ani raz nepredal ════════════════════════ */

describe('no_units_sold — za sledované obdobie ani jeden kus', () => {
  const findings = analyze(
    snapshot(
      salesWindow({
        products: [product({ unitsSold: 0, unitsPerDay: 0, lastSaleDay: null, daysSinceLastSale: null, recentUnits: 0, previousUnits: 0 })],
      }),
    ),
  );

  it('zistenie vznikne a je návrh, nie zásah', () => {
    expect(kinds(findings)).toContain('no_units_sold');
    expect(findings.find((f) => f.kind === 'no_units_sold')?.tone).toBe('info');
  });

  it('text uvádza obdobie aj to, že je krátke (P3)', () => {
    const text = findings.find((f) => f.kind === 'no_units_sold')?.text ?? '';
    // Obdobie sa uvádzať MUSÍ (P3) — už nie v ISO, ale v jedinom tvare
    // dátumu, ktorý appka na povrchu používa (kontrakt UI bod 10).
    expect(text).toContain('2. 8. 2026');
    expect(text).toContain('5. 8. 2026');
    expect(text).toContain('4 sledované dni');
    expect(text).toContain('krátke');
  });

  it('akcia otvára drawer novej kampane s predvyplneným produktom (I3)', () => {
    const action = findings.find((f) => f.kind === 'no_units_sold')?.action;
    expect(action?.href).toBe('/zlavy/nova?produkty=201');
  });

  it('produkt s aspoň jedným kusom sa nehlási', () => {
    expect(kinds(analyze(snapshot(salesWindow())))).not.toContain('no_units_sold');
  });
});

/* ════════════════════════ 3. Predajnosť klesla ════════════════════════════ */

describe('sales_declining — novšia polovica obdobia proti staršej', () => {
  const declining = (overrides: Partial<RuleProductSales>) =>
    analyze(snapshot(salesWindow({ products: [product({ unitsSold: 9, ...overrides })] })));

  it('pokles na polovicu a menej sa hlási', () => {
    const findings = declining({ recentUnits: 2, previousUnits: 7 });
    expect(kinds(findings)).toContain('sales_declining');
    const text = findings.find((f) => f.kind === 'sales_declining')?.text ?? '';
    expect(text).toContain('2 kusy');
    expect(text).toContain('7');
    expect(text).toContain('2. 8. 2026');
    // P4 — merajú sa kusy, nikdy obrat.
    expect(text).toContain('nie o obrat');
  });

  it('rovnaká alebo vyššia predajnosť sa nehlási', () => {
    expect(kinds(declining({ recentUnits: 5, previousUnits: 4 }))).not.toContain('sales_declining');
    expect(kinds(declining({ recentUnits: 4, previousUnits: 4 }))).not.toContain('sales_declining');
  });

  it('mierny pokles nad hranicou pomeru sa nehlási (žiadny šum)', () => {
    expect(kinds(declining({ recentUnits: 5, previousUnits: 8 }))).not.toContain('sales_declining');
  });

  it('pokles z jedného kusa nie je trend', () => {
    expect(SALES_DROP_MIN_PREVIOUS).toBe(2);
    expect(kinds(declining({ recentUnits: 0, previousUnits: 1 }))).not.toContain('sales_declining');
  });

  it('nemeriteľné polovice (`null`) nič nehlásia', () => {
    expect(kinds(declining({ recentUnits: null, previousUnits: null }))).not.toContain(
      'sales_declining',
    );
  });

  it('akcia otvára drawer novej kampane (I3)', () => {
    const action = declining({ recentUnits: 1, previousUnits: 8 }).find(
      (f) => f.kind === 'sales_declining',
    )?.action;
    expect(action?.href).toBe('/zlavy/nova?produkty=201');
  });
});

/* ════════════════════════ 4. Poctivosť a determinizmus ════════════════════ */

describe('poctivosť textov o predaji', () => {
  const findings = analyze(
    snapshot(
      salesWindow({
        products: [
          product({ productId: 201, unitsSold: 0, recentUnits: 0, previousUnits: 0 }),
          product({ productId: 202, name: null, label: null, unitsSold: 3, recentUnits: 1, previousUnits: 2 }),
        ],
      }),
    ),
  );

  it('žiadne zistenie o predaji nepoužije slovo obrátkovosť', () => {
    for (const f of findings) expect(f.text.toLowerCase()).not.toContain('obrátkovosť');
  });

  it('žiadne zistenie o predaji nehovorí o eurách ani o obrate ako o dátach', () => {
    for (const f of findings) {
      expect(f.text).not.toContain('€');
      expect(f.text).not.toMatch(/obrat je|tržba|zarobil/i);
    }
  });

  it('produkt bez názvu sa označí ID, nie prázdnym miestom', () => {
    const text = findings.find((f) => f.id.endsWith(':202'))?.text ?? '';
    expect(text).toContain('produkt #202');
  });

  it('rovnaký vstup dáva rovnaký výstup (žiadna náhodnosť)', () => {
    const s = snapshot(salesWindow({ products: [product({ unitsSold: 0 })] }));
    expect(analyze(s)).toEqual(analyze(s));
  });

  it('každé zistenie o predaji má akciu do drawera, nikdy nie zápis', () => {
    for (const f of findings) {
      expect(f.action?.href.startsWith('/zlavy/nova')).toBe(true);
    }
  });
});
