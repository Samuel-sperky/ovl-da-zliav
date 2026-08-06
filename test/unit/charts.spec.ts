/**
 * Aura Zľavy — testy čistej matematiky grafov G1–G6 (plán 32 §4, sekcia C2).
 *
 * Testuje `chart-utils.ts` (bez Reactu a DOM) a `fillDays` z G4:
 *   · sekvenčná rampa vracia VÝHRADNE tokeny `--seq-teal-*` (žiadny hex),
 *   · stav nikdy nie je len farba — vizuál nesie tón + glyf + slovenský text,
 *   · TTL prahy 6 h / 1 h (D5) a fail-closed „kľúč chýba" pri null/0,
 *   · súčet segmentov G5 sedí s tally (U6),
 *   · G4 os je spojitá — chýbajúce dni sa dopĺňajú nulami, nie preskočia.
 */
import { describe, expect, it } from 'vitest';

import { fillDays } from '@/components/charts/AuditActivity';
import {
  PERCENT_CAP,
  arcDash,
  campaignVisual,
  itemSegments,
  itemVisual,
  monogram,
  niceTicks,
  overlappingIds,
  sequentialColor,
  sequentialStep,
  tallyTotal,
  toneColor,
  ttlArc,
  windowLengthDays,
} from '@/components/charts/chart-utils';

describe('sekvenčná rampa G2 (magnitúda, nie stav)', () => {
  it('mapuje 1–30 % na kroky 1–5 a hranice drží', () => {
    expect(sequentialStep(1)).toBe(1);
    expect(sequentialStep(6)).toBe(1);
    expect(sequentialStep(7)).toBe(2);
    expect(sequentialStep(15)).toBe(3);
    expect(sequentialStep(30)).toBe(5);
    expect(sequentialStep(999)).toBe(5); // nad strop — clamp, nie pretečenie
    expect(sequentialStep(0)).toBe(1);
    expect(sequentialStep(Number.NaN)).toBe(1);
  });

  it('vracia výhradne tokeny --seq-teal-*, nikdy hex', () => {
    for (const p of [1, 10, 20, PERCENT_CAP]) {
      expect(sequentialColor(p)).toMatch(/^var\(--seq-teal-[1-5]\)$/);
    }
  });
});

describe('stav nie je nikdy len farba (§3.3)', () => {
  it('toneColor vracia stavové tokeny --st-*', () => {
    expect(toneColor('good')).toBe('var(--st-good)');
    expect(toneColor('critical')).toBe('var(--st-critical)');
  });

  it('vizuál kampane aj položky nesie tón + glyf + slovenský text', () => {
    for (const v of [campaignVisual('active'), itemVisual('failed'), campaignVisual('neznámy')]) {
      expect(v.tone).toBeTruthy();
      expect(v.glyph).toBeTruthy();
      expect(v.label.length).toBeGreaterThan(0);
    }
  });
});

describe('TTL oblúk G6 (D5)', () => {
  it('null/0 = kľúč chýba — critical, fail-closed', () => {
    expect(ttlArc(null).tone).toBe('critical');
    expect(ttlArc(0).fraction).toBe(0);
  });

  it('prahy: ≤1 h critical, ≤6 h attention, inak good', () => {
    expect(ttlArc(3600).tone).toBe('critical');
    expect(ttlArc(6 * 3600).tone).toBe('attention');
    expect(ttlArc(7 * 3600).tone).toBe('good');
  });

  it('arcDash: dash + gap = obvod', () => {
    const { dash, gap } = arcDash(0.25, 40);
    expect(dash + gap).toBeCloseTo(2 * Math.PI * 40, 6);
  });
});

describe('G5 segmenty a G1 pomôcky', () => {
  it('súčet segmentov sedí s tally (U6)', () => {
    const tally = { ok: 2, failed: 1, not_found: 1, skipped: 1, pending: 0 };
    const segments = itemSegments(tally);
    expect(segments.reduce((s, x) => s + x.count, 0)).toBe(tallyTotal(tally));
    expect(segments.some((s) => s.key === 'pending')).toBe(false); // nuly sa nekreslia
  });

  it('okno vrátane oboch koncov: 1.–3. = 3 dni', () => {
    expect(windowLengthDays('2026-08-01', '2026-08-03')).toBe(3);
  });

  it('prekryv okien hlási len kampane so spoločným produktom', () => {
    const spans = [
      { id: 1, dateFrom: '2026-08-01', dateTo: '2026-08-10', productIds: [7] },
      { id: 2, dateFrom: '2026-08-05', dateTo: '2026-08-12', productIds: [7] },
      { id: 3, dateFrom: '2026-08-05', dateTo: '2026-08-12', productIds: [9] },
    ];
    const hit = overlappingIds(spans);
    expect(hit.has(1)).toBe(true);
    expect(hit.has(2)).toBe(true);
    expect(hit.has(3)).toBe(false);
  });

  it('monogram: iniciály z názvu, fallback na # pri produkte bez názvu', () => {
    expect(monogram('Náhrdelník Aura', 12)).toBe('NA');
    expect(monogram(null, 12)).toContain('#');
  });
});

describe('osi', () => {
  it('niceTicks začína nulou a pokrýva maximum', () => {
    const ticks = niceTicks(7);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(7);
  });

  it('fillDays (G4) doplní chýbajúce dni nulami — os je spojitá', () => {
    const days = fillDays({
      today: '2026-08-05',
      from: '2026-08-01',
      to: '2026-08-05',
      truncated: false,
      days: [
        { day: '2026-08-01', ok: 1, failed: 0, uncertain: 0, skipped: 0 },
        { day: '2026-08-04', ok: 0, failed: 2, uncertain: 0, skipped: 0 },
      ],
    });
    expect(days).toHaveLength(5);
    expect(days.map((d) => d.day)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ]);
    expect(days[1]).toMatchObject({ ok: 0, failed: 0 });
  });
});
