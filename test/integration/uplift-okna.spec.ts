/**
 * Aura Zľavy — UPLIFT: DEFINÍCIA OKIEN „PRED / POČAS" (D115) a pasca d00e081.
 *
 * 26. 8. 2026 sa v tomto repe ukázalo, že sekcia „Výkon" porovnávala DVE OKNÁ,
 * KTORÉ ZĽAVE OBE PREDCHÁDZALI, a nazývala to výkonom zľavy: obe končili
 * dneškom a `date_from` do výpočtu nevstupoval vôbec. Nič nespadlo — graf
 * nakreslil dva stĺpce a jeden z nich bol „silnejší".
 *
 * Tento súbor preto nemeria tvar odpovede, ale PRESNE tie štyri veci, ktoré
 * kontrakt V4 žiada definovať explicitne:
 *
 *   1. čo je okno „počas" (a že zľava, ktorá nezačala, nedostane ČÍSLA),
 *   2. čo je okno „pred",
 *   3. čo s nerovnakou dĺžkou,
 *   4. čo s nestiahnutými dňami — a že vtedy route uplift PRIZNÁ, nie vráti.
 *
 * Meria sa dvakrát: nad čistou funkciou `upliftFor()` (tam definícia žije) aj
 * cez celý `GET /api/insights/product/[productId]`, aby sa nedalo stratiť po
 * ceste. Bez DB, bez siete; čas je vpichnutý, takže test neflakuje po 22:00 UTC.
 *
 * Vlastník: vlna V4-ENDPOINTY.
 */
import { describe, expect, it } from 'vitest';

import type { DateOnly, ItemStatus, ProductSalesDay, SalesSyncDay } from '@/contracts';
import type { ProductWriteRow } from '@/lib/repo/insights.repo';
import type { RouteDeps } from '@/lib/http/define-route';

import {
  UPLIFT_MIN_WINDOW_DAYS,
  upliftFor,
  type OwnDiscountWindow,
  type UpliftResult,
} from '@/app/api/insights/_shared';
import { resetRateLimiter } from '@/lib/http/define-route';
import {
  createInsightsProductGet,
  type ProductInsightsResponse,
} from '@/app/api/insights/product/[productId]/route';

/* ═══════════════════════════ 0. Pomôcky ══════════════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const TODAY = '2026-08-19' as DateOnly;
const NOW = new Date('2026-08-19T09:00:00.000Z');

function syncDay(day: string, status: SalesSyncDay['status'] = 'complete'): SalesSyncDay {
  return {
    saleDay: day as DateOnly,
    status,
    finishedAt: status === 'complete' ? `${day}T23:00:00.000Z` : null,
    updatedAt: `${day}T23:30:00.000Z`,
    ordersSeen: status === 'pending' ? 0 : 4,
  };
}

/** Súvislý úsek dní s daným stavom (pohodlný spôsob, ako dať/vziať pokrytie). */
function range(from: string, to: string, status: SalesSyncDay['status'] = 'complete'): SalesSyncDay[] {
  const out: SalesSyncDay[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    out.push(syncDay(cursor.toISOString().slice(0, 10), status));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function win(from: string, to: string, campaignId = 7, percent = 15): OwnDiscountWindow {
  return { campaignId, campaignName: `Zľava ${campaignId}`, percent, from: from as DateOnly, to: to as DateOnly };
}

function day(d: string, units: number): { day: DateOnly; units: number } {
  return { day: d as DateOnly, units };
}

/* ══════════ 1. Čistá definícia okien (tam, kde naozaj žije) ═══════════════ */

describe('upliftFor — 1. čo je okno „počas"', () => {
  it('ZĽAVA, KTORÁ NEZAČALA, NEDOSTANE ČÍSLA (pasca d00e081)', () => {
    const result = upliftFor({
      today: TODAY,
      windows: [win('2026-08-25', '2026-09-08')],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [day('2026-08-15', 9), day('2026-08-10', 4)],
    });

    expect(result.available).toBe(false);
    expect(result.reason).toBe('not_started');
    expect(result.startsOn).toBe('2026-08-25');
    /*
     * Toto je celá oprava d00e081: v odpovedi NIE JE ani jedno číslo, ktoré by
     * sa dalo nakresliť ako stĺpec. Predaj za posledné dni je legitímny údaj a
     * je v `series` tej istej route — ale výkonom tejto zľavy NIE JE.
     */
    expect(result.before).toBeNull();
    expect(result.during).toBeNull();
    expect(result.deltaPercent).toBeNull();
    expect(result.spanDays).toBeNull();
  });

  it('„počas" končí DNESKOM, keď zľava ešte beží, a hovorí to príznakom', () => {
    const result = upliftFor({
      today: TODAY,
      windows: [win('2026-08-15', '2026-08-29')],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [],
    });

    expect(result.available).toBe(true);
    expect(result.duringTruncated).toBe(true);
    // 15.–19. 8. je päť dní; deň po dnešku sa do okna nedostane.
    expect(result.during).toMatchObject({ from: '2026-08-15', to: '2026-08-19', days: 5 });
  });

  it('dobehnutá zľava má „počas" po svojom poslednom dni, nie po dnešok', () => {
    const result = upliftFor({
      today: TODAY,
      windows: [win('2026-08-01', '2026-08-10')],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [],
    });
    expect(result.duringTruncated).toBe(false);
    expect(result.during).toMatchObject({ from: '2026-08-01', to: '2026-08-10', days: 10 });
  });

  it('z viacerých ZAČATÝCH okien sa berie to najnovšie', () => {
    const result = upliftFor({
      today: TODAY,
      windows: [win('2026-06-01', '2026-06-10', 1), win('2026-08-05', '2026-08-14', 2)],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [],
    });
    expect(result.campaignId).toBe(2);
    expect(result.during).toMatchObject({ from: '2026-08-05', to: '2026-08-14' });
  });

  it('bez jediného vlastného zápisu nie je čo porovnávať', () => {
    const result = upliftFor({
      today: TODAY,
      windows: [],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [day('2026-08-15', 9)],
    });
    expect(result.reason).toBe('no_discount_window');
    expect(result.during).toBeNull();
  });
});

describe('upliftFor — 2. a 3. okno „pred" a jeho dĺžka', () => {
  it('„pred" končí DEŇ PRED začiatkom zľavy a je rovnako dlhé', () => {
    const result = upliftFor({
      today: TODAY,
      windows: [win('2026-08-11', '2026-08-20')],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [],
    });

    // „počas" = 11.–19. 8. (9 dní, orezané dneškom).
    expect(result.during).toMatchObject({ from: '2026-08-11', to: '2026-08-19', days: 9 });
    // „pred" = 9 dní končiacich 10. 8., teda 2.–10. 8.
    expect(result.before).toMatchObject({ from: '2026-08-02', to: '2026-08-10', days: 9 });
    expect(result.spanDays).toBe(9);
  });

  it('nerovnaká dĺžka nemôže nastať — „pred" sa STAVIA z dĺžky „počas"', () => {
    /*
     * Kampaň trvá 30 dní, ale prebehlo z nej 5. Keby sa „pred" postavilo
     * z dĺžky KAMPANE (30 dní), porovnávalo by 5 dní predaja proti 30 dňom
     * a zľava by vždy vyzerala ako prepad. Preto sa obe okná viažu na to,
     * čo sa naozaj stalo.
     */
    const result = upliftFor({
      today: TODAY,
      windows: [win('2026-08-15', '2026-09-13')],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [],
    });
    expect(result.before?.days).toBe(result.during?.days);
    expect(result.spanDays).toBe(5);
    expect(result.before).toMatchObject({ from: '2026-08-10', to: '2026-08-14' });
  });

  it(`okno kratšie než ${UPLIFT_MIN_WINDOW_DAYS} dni sa neporovnáva vôbec`, () => {
    const result = upliftFor({
      today: TODAY,
      windows: [win('2026-08-18', '2026-08-19')],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [day('2026-08-18', 50)],
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('window_too_short');
    expect(result.spanDays).toBe(2);
    expect(result.during).toBeNull();
  });

  it('zľava sa nesmie porovnávať so zľavou', () => {
    const result = upliftFor({
      today: TODAY,
      // Základňa pre okno od 11. 8. je 2.–10. 8., a do nej zasahuje staršia zľava.
      windows: [win('2026-08-11', '2026-08-19', 2), win('2026-08-05', '2026-08-09', 1)],
      syncDays: range('2026-05-01', '2026-08-19'),
      days: [],
    });
    expect(result.available).toBe(false);
    expect(result.reason).toBe('baseline_overlaps_discount');
    expect(result.campaignId).toBe(2);
    // Dátumy sa vracajú aj tak — obrazovka má povedať, čo by porovnávala.
    expect(result.before).toMatchObject({ from: '2026-08-02', to: '2026-08-10' });
    expect(result.before?.units).toBeNull();
  });
});

describe('upliftFor — 4. nestiahnuté dni', () => {
  const windows = [win('2026-08-11', '2026-08-15')];

  it('chýbajúci deň v „počas" znamená NEVIEME, nie číslo', () => {
    const result = upliftFor({
      today: TODAY,
      windows,
      // 13. 8. sa nesťahoval vôbec.
      syncDays: [...range('2026-08-01', '2026-08-12'), ...range('2026-08-14', '2026-08-19')],
      days: [day('2026-08-11', 10), day('2026-08-12', 10)],
    });

    expect(result.available).toBe(false);
    expect(result.reason).toBe('coverage_gap');
    expect(result.missingDuring).toEqual(['2026-08-13']);
    expect(result.missingBefore).toEqual([]);
    expect(result.during?.units).toBeNull();
    expect(result.during?.perDay).toBeNull();
    expect(result.deltaPercent).toBeNull();
  });

  it('`partial` deň v „pred" tiež zablokuje výpočet (dolná hranica nie je meranie)', () => {
    const result = upliftFor({
      today: TODAY,
      windows,
      syncDays: [
        ...range('2026-08-01', '2026-08-05'),
        syncDay('2026-08-06', 'partial'),
        ...range('2026-08-07', '2026-08-19'),
      ],
      days: [],
    });
    expect(result.reason).toBe('coverage_gap');
    expect(result.missingBefore).toEqual(['2026-08-06']);
    expect(result.before?.units).toBeNull();
  });

  it('pri úplnom pokrytí vyjde číslo — a je to rozdiel kusov na deň', () => {
    const result = upliftFor({
      today: TODAY,
      windows,
      syncDays: range('2026-07-01', '2026-08-19'),
      days: [
        // „pred" = 6.–10. 8. (5 dní): 10 kusov → 2/deň
        day('2026-08-06', 4),
        day('2026-08-08', 6),
        // „počas" = 11.–15. 8. (5 dní): 15 kusov → 3/deň
        day('2026-08-11', 9),
        day('2026-08-13', 6),
        // mimo oboch okien — nesmie sa započítať
        day('2026-08-18', 100),
      ],
    });

    expect(result.available).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.before).toMatchObject({ units: 10, perDay: 2 });
    expect(result.during).toMatchObject({ units: 15, perDay: 3 });
    expect(result.deltaPercent).toBe(50);
    expect(result.deltaReason).toBeNull();
  });

  it('nulová základňa nie je „nekonečný rast" — percento chýba s dôvodom', () => {
    const result = upliftFor({
      today: TODAY,
      windows,
      syncDays: range('2026-07-01', '2026-08-19'),
      days: [day('2026-08-12', 7)],
    });

    expect(result.available).toBe(true);
    expect(result.before).toMatchObject({ units: 0, perDay: 0 });
    expect(result.during).toMatchObject({ units: 7 });
    expect(result.deltaPercent).toBeNull();
    expect(result.deltaReason).toBe('zero_baseline');
  });

  it('odpoveď neobsahuje ŽIADNU vetu o príčine (P8)', () => {
    const result: UpliftResult = upliftFor({
      today: TODAY,
      windows,
      syncDays: range('2026-07-01', '2026-08-19'),
      days: [day('2026-08-12', 7)],
    });
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/priniesla|vďaka|spôsobil|because|caused/i);
  });
});

/* ═════════ 2. Tá istá definícia cez celú route (nesmie sa stratiť) ════════ */

function write(
  overrides: Partial<ProductWriteRow> & { dateFrom: string; dateTo: string },
): ProductWriteRow {
  return {
    itemId: 1,
    campaignId: 7,
    campaignName: 'Zľava 7',
    status: 'ok' as ItemStatus,
    percent: 15 as never,
    at: '2026-08-11T00:05:00.000Z',
    ...overrides,
    dateFrom: overrides.dateFrom as DateOnly,
    dateTo: overrides.dateTo as DateOnly,
  };
}

interface ProductWorld {
  unitsQueries: Array<[string, string]>;
}

async function callProduct(opts: {
  writes: ProductWriteRow[];
  sync: SalesSyncDay[];
  days: ProductSalesDay[];
  query?: string;
}): Promise<{ data: ProductInsightsResponse; world: ProductWorld }> {
  resetRateLimiter();
  const world: ProductWorld = { unitsQueries: [] };
  const handler = createInsightsProductGet(
    {
      now: () => NOW,
      timeZone: 'Europe/Bratislava',
      insightsRepo: {
        productWrites: async () => opts.writes,
        campaignWindows: async () => [],
        discountDepth: async () => [],
        writeActivity: async (from, to) => ({ from, to, days: [], truncated: false }),
        campaignItemTally: async () => ({
          tally: {
            pending: 0,
            skipped: 0,
            ok: 0,
            failed: 0,
            uncertain: 0,
            interrupted: 0,
            not_found: 0,
            blocked: 0,
          },
          unrecognized: 0,
        }),
      },
      salesInsights: {
        syncDays: async () => opts.sync,
        dailyUnits: async (ids, from, to) => {
          world.unitsQueries.push([from, to]);
          const set = new Set(ids);
          return opts.days.filter(
            (row) => set.has(row.productId) && row.saleDay >= from && row.saleDay <= to,
          );
        },
      },
    },
    { now: () => NOW, localActor: async () => ({ id: 1, username: 'samuel' }) } as RouteDeps,
  );
  const response = await handler(
    new Request(`${APP_ORIGIN}/api/insights/product/321${opts.query ?? ''}`, { method: 'GET' }),
    { params: Promise.resolve({ productId: '321' }) },
  );
  const parsed = (await response.json()) as { ok: boolean; data?: ProductInsightsResponse };
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  return { data: parsed.data as ProductInsightsResponse, world };
}

describe('GET /api/insights/product/[productId] — krivka, okná zliav, uplift', () => {
  it('nestiahnutý deň krivky má `units: null`, dočítaný bez predaja `0`', async () => {
    const { data } = await callProduct({
      writes: [],
      sync: [...range('2026-08-17', '2026-08-18'), syncDay('2026-08-19', 'pending')],
      days: [{ productId: 321, saleDay: '2026-08-17' as DateOnly, unitsSold: 5 }],
      query: '?window=7',
    });

    const byDay = new Map(data.series.days.map((row) => [row.day, row]));
    expect(data.series.days).toHaveLength(7);
    expect(byDay.get('2026-08-17' as DateOnly)).toEqual({
      day: '2026-08-17',
      units: 5,
      coverage: 'complete',
    });
    expect(byDay.get('2026-08-18' as DateOnly)?.units).toBe(0);
    expect(byDay.get('2026-08-19' as DateOnly)?.units).toBeNull();
    expect(byDay.get('2026-08-13' as DateOnly)).toEqual({
      day: '2026-08-13',
      units: null,
      coverage: 'missing',
    });
    expect(data.series.gaps.unknownDays).toBe(5);
    expect(data.series.windowUnits).toBe(5);
    expect(data.series.unitsState).toBe('lower_bound');
  });

  it('default okno detailu je 90 dní (D115)', async () => {
    const { data } = await callProduct({ writes: [], sync: [], days: [] });
    expect(data.series.window).toEqual({ days: 90, from: '2026-05-22', to: '2026-08-19' });
    expect(data.series.windowUnits).toBeNull();
    expect(data.series.unitsState).toBe('unknown');
  });

  it('do okien zliav ide LEN úspešný vlastný zápis (I11)', async () => {
    const { data } = await callProduct({
      writes: [
        write({ itemId: 1, dateFrom: '2026-08-01', dateTo: '2026-08-05', status: 'ok' as ItemStatus }),
        write({ itemId: 2, dateFrom: '2026-08-07', dateTo: '2026-08-09', status: 'uncertain' as ItemStatus }),
        write({ itemId: 3, dateFrom: '2026-08-10', dateTo: '2026-08-12', status: 'failed' as ItemStatus }),
      ],
      sync: range('2026-05-01', '2026-08-19'),
      days: [],
    });

    expect(data.discountWindows).toHaveLength(1);
    expect(data.discountWindows[0]).toMatchObject({ from: '2026-08-01', to: '2026-08-05' });
    // Pôvodný G3 zostáva úplný — panel ďalej vidí aj neúspešné pokusy.
    expect(data.writes).toHaveLength(3);
  });

  it('route prizná, že uplift sa spočítať nedá, namiesto čísla', async () => {
    const { data } = await callProduct({
      writes: [write({ dateFrom: '2026-08-11', dateTo: '2026-08-15' })],
      // 13. 8. chýba.
      sync: [...range('2026-08-01', '2026-08-12'), ...range('2026-08-14', '2026-08-19')],
      days: [{ productId: 321, saleDay: '2026-08-11' as DateOnly, unitsSold: 20 }],
    });

    expect(data.uplift.available).toBe(false);
    expect(data.uplift.reason).toBe('coverage_gap');
    expect(data.uplift.missingDuring).toEqual(['2026-08-13']);
    expect(data.uplift.during?.units).toBeNull();
  });

  it('uplift prejde celou route aj s číslami', async () => {
    const { data } = await callProduct({
      writes: [write({ dateFrom: '2026-08-11', dateTo: '2026-08-15' })],
      sync: range('2026-06-01', '2026-08-19'),
      days: [
        { productId: 321, saleDay: '2026-08-07' as DateOnly, unitsSold: 5 },
        { productId: 321, saleDay: '2026-08-12' as DateOnly, unitsSold: 15 },
      ],
    });

    expect(data.uplift.available).toBe(true);
    expect(data.uplift.before).toMatchObject({ from: '2026-08-06', to: '2026-08-10', units: 5 });
    expect(data.uplift.during).toMatchObject({ from: '2026-08-11', to: '2026-08-15', units: 15 });
    expect(data.uplift.deltaPercent).toBe(200);
  });

  it('rad pre uplift sa dočíta aj PRED oknom krivky, inak by vyšla nula', async () => {
    /*
     * Zľava začala 12. 6., okno krivky (7 dní) je až 13.–19. 8. Keby uplift
     * dostal len orezaný rad, obe jeho okná by mali nula riadkov — a nula by sa
     * tvárila ako meranie. Route preto pre uplift dočíta rad od
     * `chosen.from − 100 dní`.
     */
    const { data, world } = await callProduct({
      writes: [write({ dateFrom: '2026-06-12', dateTo: '2026-06-16' })],
      sync: range('2026-02-01', '2026-08-19'),
      days: [
        { productId: 321, saleDay: '2026-06-08' as DateOnly, unitsSold: 5 },
        { productId: 321, saleDay: '2026-06-14' as DateOnly, unitsSold: 10 },
      ],
      query: '?window=7',
    });

    expect(world.unitsQueries).toEqual([
      ['2026-08-13', '2026-08-19'],
      ['2026-03-04', '2026-08-19'],
    ]);
    expect(data.uplift.available).toBe(true);
    expect(data.uplift.before?.units).toBe(5);
    expect(data.uplift.during?.units).toBe(10);
  });

  it('bez zľavy pred oknom krivky sa druhý dotaz NEROBÍ', async () => {
    const { world } = await callProduct({
      writes: [],
      sync: range('2026-08-13', '2026-08-19'),
      days: [],
      query: '?window=7',
    });
    expect(world.unitsQueries).toEqual([['2026-08-13', '2026-08-19']]);
  });
});
