/**
 * Aura Zľavy — denný rozpočet zápisov (V5, KONTRAKT V3 K2).
 *
 * Čo sa tu dokazuje:
 *  - spotreba sa počíta z auditu (`write_attempt`) za **UTC** deň, nie z
 *    počítadlového stĺpca a nie za deň v `Europe/Bratislava`,
 *  - výška rozpočtu je fail-closed: „neviem" znamená 1/deň, nie 200/deň,
 *  - runaway strop je `rozpočet + 20 %` s podlahou 60/h (K2),
 *  - odhad dobehnutia fronty sedí na aritmetike z kontraktu:
 *    8 000 položiek pri 200/deň = 40 dní.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DAILY_WRITE_BUDGET,
  FAIL_CLOSED_DAILY_BUDGET,
  budgetDay,
  createBudget,
  estimateFinish,
  remainingToday,
  resolveDailyBudget,
  runawayLimitFor,
  spentToday,
  type WriteAttemptCounter,
} from '@/lib/engine/budget';

/** Počítadlo `write_attempt` podľa UTC dňa. */
function counterOf(byDay: Record<string, number>): WriteAttemptCounter {
  return {
    async countWriteAttemptsOn(day: string) {
      return byDay[day] ?? 0;
    },
  };
}

describe('budgetDay — deň rozpočtu je UTC deň (K2)', () => {
  it('o 23:30 v Bratislave je rozpočtový deň ešte ten predchádzajúci', () => {
    // 2026-08-10 23:30 CEST (UTC+2) = 2026-08-10T21:30Z → UTC deň je 10., nie 11.
    expect(budgetDay(new Date('2026-08-10T21:30:00.000Z'))).toBe('2026-08-10');
  });

  it('o 01:30 v Bratislave je rozpočtový deň už nový (UTC polnoc prebehla)', () => {
    // 2026-08-11 01:30 CEST = 2026-08-10T23:30Z → stále UTC 10.
    expect(budgetDay(new Date('2026-08-10T23:30:00.000Z'))).toBe('2026-08-10');
    // 2026-08-11 02:30 CEST = 2026-08-11T00:30Z → UTC deň sa prehupol.
    expect(budgetDay(new Date('2026-08-11T00:30:00.000Z'))).toBe('2026-08-11');
  });
});

describe('spentToday / remainingToday (K2)', () => {
  const now = () => new Date('2026-08-10T09:00:00.000Z');

  it('spotreba je počet write_attempt za aktuálny UTC deň', async () => {
    const spent = await spentToday({
      counter: counterOf({ '2026-08-09': 200, '2026-08-10': 37 }),
      now,
    });
    expect(spent).toBe(37);
  });

  it('zvyšok = rozpočet − spotreba a nikdy nie je záporný', async () => {
    const status = await remainingToday({
      counter: counterOf({ '2026-08-10': 205 }),
      dailyBudget: 200,
      now,
    });
    expect(status).toMatchObject({
      day: '2026-08-10',
      budget: 200,
      spent: 205,
      remaining: 0,
      exhausted: true,
    });
  });

  it('vyčerpanie nastáva presne na rozpočte, nie o jeden zápis neskôr', async () => {
    const budget = createBudget({
      counter: counterOf({ '2026-08-10': 199 }),
      dailyBudget: 200,
      now,
    });
    expect((await budget.remainingToday()).exhausted).toBe(false);

    const exhausted = createBudget({
      counter: counterOf({ '2026-08-10': 200 }),
      dailyBudget: 200,
      now,
    });
    expect((await exhausted.remainingToday()).exhausted).toBe(true);
  });
});

describe('resolveDailyBudget — fail-closed výška rozpočtu (K1 bod 1, K2)', () => {
  it('bez zdroja platí kontraktový default 200', async () => {
    expect(await resolveDailyBudget()).toBe(DEFAULT_DAILY_WRITE_BUDGET);
  });

  it('readScope() má prednosť pred get()', async () => {
    const source = {
      readScope: async () => ({ dailyWriteBudget: 120, failClosed: false }),
      get: async () => ({ dailyWriteBudget: 200 }),
    };
    expect(await resolveDailyBudget(source)).toBe(120);
  });

  it('nečitateľné nastavenia znamenajú 1 zápis na deň, nie 200', async () => {
    const source = {
      readScope: async (): Promise<never> => {
        throw new Error('DB nie je dostupná');
      },
    };
    expect(await resolveDailyBudget(source)).toBe(FAIL_CLOSED_DAILY_BUDGET);
  });

  it('hodnota mimo 1–200 sa neberie — platí fail-closed default', async () => {
    const source = { readScope: async () => ({ dailyWriteBudget: 5000, failClosed: false }) };
    expect(await resolveDailyBudget(source)).toBe(FAIL_CLOSED_DAILY_BUDGET);
  });

  it('starší tvar nastavení bez poľa dostane kontraktový default', async () => {
    const source = { get: async () => ({ writesLocked: false }) };
    expect(await resolveDailyBudget(source)).toBe(DEFAULT_DAILY_WRITE_BUDGET);
  });

  it('explicitný override (flags) vyhráva nad zdrojom', async () => {
    const source = { readScope: async () => ({ dailyWriteBudget: 200, failClosed: false }) };
    expect(await resolveDailyBudget(source, 25)).toBe(25);
  });
});

describe('runawayLimitFor — rozpočet + 20 % (K2)', () => {
  it('pri 200/deň je strop 240/h (60/h by zamklo normálnu prevádzku)', () => {
    expect(runawayLimitFor(200)).toBe(240);
  });

  it('nikdy neklesne pod podlahu 60/h', () => {
    expect(runawayLimitFor(1)).toBe(60);
    expect(runawayLimitFor(50)).toBe(60);
  });

  it('podlaha sa dá zvýšiť, nie obísť', () => {
    expect(runawayLimitFor(200, 300)).toBe(300);
    expect(runawayLimitFor(200, 10)).toBe(240);
  });
});

describe('estimateFinish — kedy fronta dobehne (K5, K6)', () => {
  const now = new Date('2026-08-10T09:00:00.000Z');

  it('8 000 položiek pri 200/deň dobehne o 39 ďalších dní (dnešok sa počíta)', () => {
    const estimate = estimateFinish(8000, 200, { now });
    expect(estimate).toMatchObject({ pending: 8000, perDay: 200, days: 39 });
    expect(estimate.date).toBe('2026-09-18');
  });

  it('čo sa zmestí do dneška, dobehne dnes', () => {
    expect(estimateFinish(200, 200, { now })).toMatchObject({ days: 0, date: '2026-08-10' });
    expect(estimateFinish(0, 200, { now })).toMatchObject({ days: 0, date: '2026-08-10' });
  });

  it('už minutý dnešok posunie odhad o deň', () => {
    // 200 položiek, rozpočet 200, ale dnes je voľných 0 → celé to padne na zajtra.
    expect(estimateFinish(200, 200, { now, remainingToday: 0 })).toMatchObject({
      days: 1,
      date: '2026-08-11',
    });
    expect(estimateFinish(201, 200, { now, remainingToday: 200 })).toMatchObject({
      days: 1,
      date: '2026-08-11',
    });
  });

  it('rozpočet mimo rozsahu nespôsobí NaN ani nekonečno', () => {
    expect(estimateFinish(10, 0, { now }).perDay).toBe(DEFAULT_DAILY_WRITE_BUDGET);
    expect(estimateFinish(Number.NaN, 200, { now })).toMatchObject({ pending: 0, days: 0 });
  });
});
