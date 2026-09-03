/**
 * Aura Zľavy — ŠTYRI STAVY DŇA TRŽBY PREŽIJÚ CESTU ODPOVEĎ → OBRAZOVKA
 * (D117, migrácia 0016, I11; oprava 3. 9. 2026).
 *
 * ČO BOLO ZLE
 * -----------
 * `GET /api/insights/revenue-daily` počíta a POSIELA tri poctivé pojmy:
 * `dayStates[]`, `emptyDays[]` a per-menové `measuredZeroDays[]`. Klient z nich
 * nečítal ANI JEDEN: `parseRevenueDaily()` bral len `series`, `scope`, `today`,
 * `window`, `missing` a `hasGap`. Deň bez riadku preto v `revenueDays()` vždy
 * spadol do `state: 'unknown'` a dostal POMLČKU — aj keď to bol deň, ktorý
 * appka DOČÍTALA a nepredalo sa v ňom nič.
 *
 * Je to I11 naopak: appka priznávala nevedomosť o niečom, čo zmerala, a robila
 * pokrytie vlastných dát HORŠÍM, než je. Repo má na to vlastné pravidlo —
 * **nameraná nula je fakt, medzera je priznanie** — a platí v OBA smery.
 *
 * PREČO SA TU MERIA TELO ODPOVEDE, A NIE MODEL
 * --------------------------------------------
 * Presne tejto triedy chyba už raz prežila 3756 testov: D121 (produkt
 * s neznámym predajom sa nezaradí do pásiem) fungoval v klientskom modeli, kým
 * route posielala `unitsSold: 0` namiesto `null`. Model bol správny a dostal
 * nepravdivý vstup. Tvrdenia nižšie preto začínajú SKUTOČNÝM JSON telom
 * z route handlera (`await response.json()`), nie ručne napísaným objektom, a
 * idú celú cestu:
 *
 *   route → telo odpovede → `parseRevenueDaily()` → `revenueDays()` → HTML
 *
 * Štyri stavy naraz nad JEDNÝM oknom (a to je zámer — každý z nich musí byť
 * odlíšiteľný od ostatných troch v tej istej odpovedi):
 *
 *   1. HODNOTA        — deň dočítaný, objednávky boli. Suma bez značky.
 *   2. NAMERANÁ NULA  — deň DOČÍTANÝ, objednávka v ňom nebola. `0.00`, nie „—".
 *   3. DOLNÁ HRANICA  — čítanie sa nedočítalo. `≈` pred sumou.
 *   4. NEMERANÝ DEŇ   — o dni appka nevie nič. Pomlčka, NIKDY nula.
 *
 * Bez DB a bez siete: route dostane náhradný `salesRepo`, komponent sa
 * vykresľuje cez `renderToStaticMarkup`.
 *
 * Vlastník: V6c (oprava nálezu „klient nečíta stavy dňa").
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DateOnly, MoneyString, ShopRevenueDayRecord } from '@/contracts';
/* Príznak prečítanosti dňa (0016) žije v repozitári, nie v kontraktoch. */
import type { ShopRevenueReadStateRecord } from '@/lib/repo/sales.repo';
import type { RouteDeps } from '@/lib/http/define-route';

import SalesSection from '@/components/dashboard/SalesSection';
import type { SalesDay, SalesSnapshot } from '@/components/dashboard/api';
import { revenueDays, windowDayList } from '@/components/dashboard/sales-view';
import { parseRevenueDaily } from '@/components/dashboard/window-api';
import { createInsightsRevenueDailyGet } from '@/app/api/insights/revenue-daily/route';
import { resetRateLimiter } from '@/lib/http/define-route';

const NOW = new Date('2026-08-19T09:00:00.000Z');
const TODAY = '2026-08-19';
const APP_ORIGIN = 'https://zlavy.local';

/** Okno smie byť len 7/30/90 (`windowQuery`), takže sedem dní do `TODAY`. */
const WEEK: readonly string[] = [
  '2026-08-13',
  '2026-08-14',
  '2026-08-15',
  '2026-08-16',
  '2026-08-17',
  '2026-08-18',
  TODAY,
];

const D_SUM = '2026-08-17'; // 1. hodnota
const D_ZERO = '2026-08-16'; // 2. nameraná nula
const D_BOUND = TODAY; // 3. dolná hranica
const D_UNKNOWN = '2026-08-18'; // 4. nemeraný deň

function routeDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J0000000000000TRZBA004',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

function revenueRow(
  day: string,
  totalPaidSum: string,
  ordersCount: number,
  dayComplete = true,
  currency = 'EUR',
): ShopRevenueDayRecord {
  return {
    day: day as DateOnly,
    currency,
    totalPaidSum: totalPaidSum as MoneyString,
    ordersCount,
    dayComplete,
    pagesRead: 1,
    updatedAt: new Date(`${day}T23:00:00.000Z`),
  };
}

/**
 * Príznak prečítanosti dňa (`shop_revenue_read_state`, 0016). Deň bez tohto
 * riadku appka NEPOZNÁ; deň s `dayComplete: true` a bez sumy je prečítaný deň,
 * v ktorom sa nepredalo nič.
 */
function readState(
  day: string,
  ordersSeen: number,
  dayComplete = true,
): ShopRevenueReadStateRecord {
  return {
    day: day as DateOnly,
    dayComplete,
    ordersSeen,
    pagesRead: 1,
    lastError: null,
    firstReadAt: new Date(`${day}T23:00:00.000Z`),
    updatedAt: new Date(`${day}T23:00:00.000Z`),
  };
}

/**
 * SKUTOČNÉ telo odpovede route. Vracia sa ako `unknown` úplne zámerne: parser
 * dole tak dostane presne to, čo dostane v prehliadači, a nie typ, ktorý by
 * zamlčal, že pole v tele chýba.
 */
async function revenueBody(
  rows: readonly ShopRevenueDayRecord[],
  states: readonly ShopRevenueReadStateRecord[],
  query = '?window=7',
): Promise<unknown> {
  const handler = createInsightsRevenueDailyGet(
    {
      now: () => NOW,
      timeZone: 'Europe/Bratislava',
      salesRepo: {
        listRevenue: async () => [...rows],
        listRevenueReadStates: async () => [...states],
      },
    },
    routeDeps(),
  );
  const response = await handler(
    new Request(`${APP_ORIGIN}/api/insights/revenue-daily${query}`, { method: 'GET' }),
  );
  expect(response.status).toBe(200);
  const envelope = (await response.json()) as { ok: boolean; data?: unknown };
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  return envelope.data;
}

/**
 * Okno so VŠETKÝMI ŠTYRMI stavmi naraz:
 *  · 17. 8. dočítaný riadok        → hodnota,
 *  · 16. 8. dočítaný, bez objednávky → nameraná nula,
 *  · 19. 8. nedočítaný riadok      → dolná hranica,
 *  · 13.–15. a 18. 8. bez stavu    → nemerané dni.
 */
const ALL_FOUR_ROWS: readonly ShopRevenueDayRecord[] = [
  revenueRow(D_SUM, '412.50', 9),
  revenueRow(D_BOUND, '61.00', 1, false),
];
const ALL_FOUR_STATES: readonly ShopRevenueReadStateRecord[] = [
  readState(D_ZERO, 0),
  readState(D_SUM, 9),
  readState(D_BOUND, 1, false),
];

const NAMERANE: SalesDay[] = [
  { day: '2026-08-05', units: 578 },
  { day: '2026-08-06', units: 495 },
];

function snapshot(): SalesSnapshot {
  return {
    today: TODAY,
    coverage: {
      syncEnabled: true,
      from: '2026-08-05',
      to: '2026-08-06',
      daysCovered: 2,
      lastSyncedAt: '2026-08-07T02:10:00.000Z',
      hasData: true,
    },
    windowUnits: 1073,
    unitsPerDay: null,
    recentUnits: null,
    previousUnits: null,
    days: NAMERANE,
  };
}

beforeEach(() => {
  resetRateLimiter();
});

/* ═══════ 1. Telo odpovede tie štyri stavy naozaj NESIE ═══════════════════ */

describe('1. route posiela štyri stavy dňa, nie dva', () => {
  it('`dayStates[]` má riadok pre každý deň okna a pomenuje všetky štyri stavy', async () => {
    const data = (await revenueBody(ALL_FOUR_ROWS, ALL_FOUR_STATES)) as {
      dayStates: Array<{ day: string; state: string; ordersSeen: number | null }>;
    };
    expect(data.dayStates.map((row) => [row.day, row.state])).toEqual([
      ['2026-08-13', 'unknown'],
      ['2026-08-14', 'unknown'],
      ['2026-08-15', 'unknown'],
      [D_ZERO, 'empty'],
      [D_SUM, 'measured'],
      [D_UNKNOWN, 'unknown'],
      [D_BOUND, 'lower_bound'],
    ]);
    // Nula je MERANÝ počet objednávok, `null` je „stav appka nemá".
    expect(data.dayStates.find((row) => row.day === D_ZERO)?.ordersSeen).toBe(0);
    expect(data.dayStates.find((row) => row.day === D_UNKNOWN)?.ordersSeen).toBeNull();
  });

  it('`emptyDays` a `measuredZeroDays` menujú PREČÍTANÝ prázdny deň', async () => {
    const data = (await revenueBody(ALL_FOUR_ROWS, ALL_FOUR_STATES)) as {
      emptyDays: string[];
      missing: string[];
      series: Array<{ measuredZeroDays: string[] }>;
    };
    expect(data.emptyDays).toEqual([D_ZERO]);
    expect(data.series[0]?.measuredZeroDays).toEqual([D_ZERO]);
    // A ten deň NIE JE medzera — do `missing` nesmie spadnúť.
    expect(data.missing).not.toContain(D_ZERO);
    expect(data.missing).toEqual(['2026-08-13', '2026-08-14', '2026-08-15', D_UNKNOWN]);
  });
});

/* ═══════ 2. Parser tie polia PREČÍTA (jadro nálezu) ══════════════════════ */

describe('2. klient prečíta všetky stavy, ktoré route posiela', () => {
  it('`dayStates`, `emptyDays` aj `measuredZeroDays` prejdú parserom', async () => {
    const parsed = parseRevenueDaily(await revenueBody(ALL_FOUR_ROWS, ALL_FOUR_STATES));
    expect(parsed).not.toBeNull();
    // JADRO NÁLEZU: do 3. 9. 2026 tu boli tri `undefined` a deň sa tým stratil.
    expect(parsed!.dayStates).not.toBeNull();
    expect(parsed!.dayStates!.map((row) => row.state)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'empty',
      'measured',
      'unknown',
      'lower_bound',
    ]);
    expect(parsed!.emptyDays).toBe(1);
    expect(parsed!.series[0]!.measuredZeroDays).toEqual([D_ZERO]);
  });

  it('trojstavovosť `ordersSeen` prežije parser (nula ≠ „nevieme")', async () => {
    const parsed = parseRevenueDaily(await revenueBody(ALL_FOUR_ROWS, ALL_FOUR_STATES));
    const zero = parsed!.dayStates!.find((row) => row.day === D_ZERO);
    const unknown = parsed!.dayStates!.find((row) => row.day === D_UNKNOWN);
    expect(zero?.ordersSeen).toBe(0);
    expect(unknown?.ordersSeen).toBeNull();
    expect(unknown?.ordersSeen).not.toBe(0);
  });
});

/* ═══════ 3. Štyri stavy na riadkoch dňa — každý inak ═════════════════════ */

describe('3. riadky dňa rozlíšia hodnotu, nameranú nulu, dolnú hranicu a medzeru', () => {
  async function rows() {
    const parsed = parseRevenueDaily(await revenueBody(ALL_FOUR_ROWS, ALL_FOUR_STATES))!;
    const series = parsed.series[0]!;
    const days = revenueDays(
      windowDayList(parsed.from, parsed.to),
      series.days,
      series.measuredZeroDays,
    );
    return new Map(days.map((row) => [row.day, row]));
  }

  it('1. HODNOTA — dočítaný deň je suma bez značky', async () => {
    expect((await rows()).get(D_SUM)).toEqual({
      day: D_SUM,
      amount: '412.50',
      state: 'measured',
      text: '412.50',
      ordersCount: 9,
    });
  });

  it('2. NAMERANÁ NULA — prečítaný deň bez objednávky je `0.00`, nie pomlčka', async () => {
    const row = (await rows()).get(D_ZERO)!;
    expect(row.state).toBe('measured_zero');
    expect(row.amount).toBe('0.00');
    expect(row.text).toBe('0.00');
    expect(row.text).not.toBe('—');
    // Prečítali sme celý deň, takže nula objednávok je MERANIE, nie `null`.
    expect(row.ordersCount).toBe(0);
  });

  it('3. DOLNÁ HRANICA — nedočítaný deň nesie `≈` a nie je to pokles', async () => {
    const row = (await rows()).get(D_BOUND)!;
    expect(row.state).toBe('lower_bound');
    expect(row.amount).toBe('61.00');
    expect(row.text).toBe('≈ 61.00');
  });

  it('4. NEMERANÝ DEŇ — deň bez stavu je pomlčka, NIKDY nula', async () => {
    const row = (await rows()).get(D_UNKNOWN)!;
    expect(row.state).toBe('unknown');
    expect(row.amount).toBeNull();
    expect(row.text).toBe('—');
    expect(row.text).not.toBe('0.00');
    expect(row.ordersCount).toBeNull();
  });

  it('štyri stavy sú v jednom okne naozaj štyri rôzne', async () => {
    const map = await rows();
    const states = [D_SUM, D_ZERO, D_BOUND, D_UNKNOWN].map((day) => map.get(day)!.state);
    expect(states).toEqual(['measured', 'measured_zero', 'lower_bound', 'unknown']);
    expect(new Set(states).size).toBe(4);
    // Riadok je na KAŽDÝ deň okna, aj na ten, ktorý v odpovedi nie je.
    expect([...map.keys()]).toEqual([...WEEK]);
  });
});

/* ═══════ 4. Fail-closed: nula sa nikdy nevyrobí z ticha ══════════════════ */

describe('4. odpoveď bez zoznamu prečítaných núl nedostane nulu, ale pomlčku', () => {
  it('chýbajúce `measuredZeroDays` je `null` a deň zostáva „nevieme"', async () => {
    const data = (await revenueBody(ALL_FOUR_ROWS, ALL_FOUR_STATES)) as Record<string, unknown>;
    const series = (data.series as Array<Record<string, unknown>>)[0]!;
    delete series.measuredZeroDays;
    const parsed = parseRevenueDaily(data)!;
    expect(parsed.series[0]!.measuredZeroDays).toBeNull();

    const days = revenueDays(
      windowDayList(parsed.from, parsed.to),
      parsed.series[0]!.days,
      parsed.series[0]!.measuredZeroDays,
    );
    const row = days.find((entry) => entry.day === D_ZERO)!;
    expect(row.state).toBe('unknown');
    expect(row.text).toBe('—');
    expect(row.amount).toBeNull();
  });

  it('nečitateľné `dayStates` je `null`, nie prázdne okno', async () => {
    const data = (await revenueBody(ALL_FOUR_ROWS, ALL_FOUR_STATES)) as Record<string, unknown>;
    expect(parseRevenueDaily({ ...data, dayStates: 'sedem' })!.dayStates).toBeNull();
    expect(parseRevenueDaily({ ...data, emptyDays: 'jeden' })!.emptyDays).toBeNull();
  });

  it('riadok s neznámym kódom stavu sa ZAHODÍ, nedosadí sa `measured`', async () => {
    const data = (await revenueBody(ALL_FOUR_ROWS, ALL_FOUR_STATES)) as Record<string, unknown>;
    const states = (data.dayStates as Array<Record<string, unknown>>).map((row) =>
      row.day === D_SUM ? { ...row, state: 'dokoncene' } : row,
    );
    const parsed = parseRevenueDaily({ ...data, dayStates: states })!;
    expect(parsed.dayStates!.map((row) => row.day)).not.toContain(D_SUM);
    expect(parsed.dayStates!.every((row) => row.state !== 'measured')).toBe(true);
  });
});

/* ═══════ 5. Obrazovka to POVIE, nie zamlčí ══════════════════════════════ */

describe('5. sekcia Predaja prečítaný prázdny deň priznáva ako meranie', () => {
  const html = async (
    rows: readonly ShopRevenueDayRecord[],
    states: readonly ShopRevenueReadStateRecord[],
  ): Promise<string> =>
    renderToStaticMarkup(
      createElement(SalesSection, {
        sales: snapshot(),
        windowDays: 7,
        revenue: parseRevenueDaily(await revenueBody(rows, states)),
      }),
    );

  it('veta o prečítaných prázdnych dňoch je na obrazovke', async () => {
    const markup = await html(ALL_FOUR_ROWS, ALL_FOUR_STATES);
    expect(markup).toContain('data-testid="revenue-empty"');
    expect(markup).toContain('prečítala a nepredalo sa v nich nič');
    expect(markup).toContain('nameraná nula, nie medzera');
    // Medzera zostáva medzerou — obe vety stoja vedľa seba, žiadna nezmizla.
    expect(markup).toContain('data-testid="revenue-gap"');
  });

  it('bez prečítaného prázdneho dňa sekcia o ňom NEPÍŠE nič', async () => {
    const markup = await html([revenueRow(D_SUM, '412.50', 9)], [readState(D_SUM, 9)]);
    expect(markup).not.toContain('data-testid="revenue-empty"');
  });

  it('posledný deň okna ako prečítaná nula NIE JE mlčanie', async () => {
    /* Celé okno dočítané, v poslednom dni ani jedna objednávka. Dovtedy tento
       deň vyzeral presne ako deň, ktorý appka nesťahovala. */
    const markup = await html(
      [revenueRow(D_SUM, '412.50', 9)],
      WEEK.map((day) => readState(day, day === D_SUM ? 9 : 0)),
    );
    expect(markup).toContain('posledný deň sme prečítali celý');
    expect(markup).toContain('v tejto mene sa nepredalo nič');
    expect(markup).not.toContain('nie je to pokles');
  });
});
