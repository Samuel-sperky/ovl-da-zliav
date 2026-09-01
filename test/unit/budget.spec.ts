/**
 * Aura Zľavy — denný rozpočet zápisov (V5, KONTRAKT V3 K2).
 *
 * Čo sa tu dokazuje:
 *  - spotreba sa počíta z auditu (`write_attempt`) za **UTC** deň, nie z
 *    počítadlového stĺpca a nie za deň v `Europe/Bratislava`,
 *  - výška rozpočtu je fail-closed: „neviem" znamená 1/deň, nie 200/deň,
 *  - runaway strop je `rozpočet + 20 %` s podlahou 60/h (K2),
 *  - odhad dobehnutia fronty sedí na aritmetike z kontraktu:
 *    8 000 položiek pri 200/deň = 40 dní,
 *  - **strop SHOPU a NÁŠ rozpočet sú dve rôzne čísla** a limity shopu sa
 *    neopisujú ručne — importujú sa z `shop/rate-limits.ts` (K2).
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DAILY_WRITE_BUDGET,
  FAIL_CLOSED_DAILY_BUDGET,
  MAX_DAILY_WRITE_BUDGET,
  WRITE_QUOTA_RESERVE,
  budgetDay,
  createBudget,
  describeWriteBudgetLimits,
  estimateFinish,
  remainingToday,
  resolveDailyBudget,
  runawayLimitFor,
  spentToday,
  type WriteAttemptCounter,
} from '@/lib/engine/budget';
import { SHOP_KEYED_LIMIT } from '@/lib/shop/rate-limits';

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

describe('jeden kľúč, jedna kvóta — čítania míňajú strop zápisov (31. 8. 2026)', () => {
  const now = () => new Date('2026-08-10T09:00:00.000Z');

  /**
   * Nález I3: `shop_write` má scope `product:read` aj `product:edit` a shop
   * účtuje ~200 volaní/UTC deň NA KĽÚČ. Od D118 na ňom beží obohacovanie
   * katalógu (dráha `product_read`, 160/deň), o ktorom rozpočet zápisov
   * nevedel — takže hlásil „ostáva 200" v deň, keď kľúč mal minutých 160,
   * fronta sa rozbehla a shop ju uprostred kampane odmietol (429).
   */
  /*
   * Vstupy sú ODVODENÉ od stropov, nie napísané. Do 1. 9. 2026 tu stálo
   * `dailyBudget: 200` a `used: 160` — po zdvihnutí kvóty na 1000/deň je 200
   * pod rezervou (`WRITE_QUOTA_RESERVE` = 200), takže by sa čítania neúčtovali
   * vôbec a test by meral opačnú vetvu, než má v názve.
   */
  const PLNY_ROZPOCET = MAX_DAILY_WRITE_BUDGET;
  const ZDIELANE = PLNY_ROZPOCET - WRITE_QUOTA_RESERVE;

  it('minuté čítania sa od stropu odpočítajú', async () => {
    const status = await remainingToday({
      counter: counterOf({ '2026-08-10': 20 }),
      dailyBudget: PLNY_ROZPOCET,
      keyedReads: { status: async () => ({ used: ZDIELANE, known: true }) },
      now,
    });
    expect(status.spent).toBe(20);
    expect(status.keyedReadsToday).toBe(ZDIELANE);
    // Čítania zjedli celú zdieľanú časť; zostáva rezerva mínus zapísané.
    expect(status.remaining).toBe(WRITE_QUOTA_RESERVE - 20);
    expect(status.exhausted).toBe(false);
  });

  it('čítania samé rozpočet NEVYČERPAJÚ — rezerva zápisov ostane (D 31. 8. 2026)', async () => {
    /*
     * Toto je celý zmysel `WRITE_QUOTA_RESERVE`: aj keď čítania zjedia celú
     * zdieľanú časť, zápisom zostane rezerva. Vyčerpá ju až to, čo sa NAOZAJ
     * zapísalo. Test to preto tvrdí v dvoch krokoch.
     */
    const poCitaniach = await remainingToday({
      counter: counterOf({ '2026-08-10': 0 }),
      dailyBudget: PLNY_ROZPOCET,
      keyedReads: { status: async () => ({ used: ZDIELANE, known: true }) },
      now,
    });
    expect(poCitaniach.remaining).toBe(WRITE_QUOTA_RESERVE);
    expect(poCitaniach.exhausted).toBe(false);

    const ajSoZapismi = await remainingToday({
      counter: counterOf({ '2026-08-10': WRITE_QUOTA_RESERVE }),
      dailyBudget: PLNY_ROZPOCET,
      keyedReads: { status: async () => ({ used: ZDIELANE, known: true }) },
      now,
    });
    expect(ajSoZapismi.remaining).toBe(0);
    expect(ajSoZapismi.exhausted).toBe(true);
  });

  it('nečitateľné počítadlo čítaní je fail-closed, nie nula', async () => {
    // `ReadBudget.status()` pri nečitateľnom počítadle vracia `known: false`
    // a `used = strop dráhy`. Rozpočet to preberie tak, ako to prišlo —
    // domnienku si tu nevyrába, ale ani ju neprepisuje na nulu.
    const status = await remainingToday({
      counter: counterOf({ '2026-08-10': 0 }),
      dailyBudget: PLNY_ROZPOCET,
      keyedReads: { status: async () => ({ used: ZDIELANE, known: false }) },
      now,
    });
    expect(status.remaining).toBe(WRITE_QUOTA_RESERVE);
  });

  it('`keyedReads: null` znamená „nesledujem" — nie „nič sa neminulo naslepo"', async () => {
    const status = await remainingToday({
      counter: counterOf({ '2026-08-10': 10 }),
      dailyBudget: 200,
      keyedReads: null,
      now,
    });
    expect(status.remaining).toBe(190);
    expect(status.keyedReadsToday).toBe(0);
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

describe('describeWriteBudgetLimits — dva stropy, nie jeden (K2)', () => {
  const now = new Date('2026-08-12T09:00:00.000Z');

  it('limity shopu sa neopisujú ručne, berú sa z `shop/rate-limits.ts`', () => {
    // Jedna ručne prepísaná kópia limitu už raz zabila synchronizáciu katalógu;
    // na zápisovej strane by tá istá chyba stála ban kľúča.
    expect(MAX_DAILY_WRITE_BUDGET).toBe(SHOP_KEYED_LIMIT.perUtcDay);
    expect(DEFAULT_DAILY_WRITE_BUDGET).toBe(SHOP_KEYED_LIMIT.perUtcDay);

    const limits = describeWriteBudgetLimits(200, now);
    expect(limits.shopPerUtcDay).toBe(SHOP_KEYED_LIMIT.perUtcDay);
    expect(limits.shopPerMinute).toBe(SHOP_KEYED_LIMIT.perMinute);
  });

  it('náš rozpočet pod stropom shopu je vedomá brzda a je to vidieť', () => {
    const limits = describeWriteBudgetLimits(120, now);
    expect(limits.configuredPerDay).toBe(120);
    expect(limits.belowShopCap).toBe(true);
  });

  it('rozpočet na úrovni stropu shopu nie je „pribrzdené"', () => {
    // Odvodené: „na úrovni stropu" je strop shopu, nie číslo 200.
    expect(describeWriteBudgetLimits(MAX_DAILY_WRITE_BUDGET, now).belowShopCap).toBe(false);
  });

  it('hodnota mimo 1…strop shopu je „neviem", nie platné číslo (fail-closed)', () => {
    expect(describeWriteBudgetLimits(0, now).configuredPerDay).toBeNull();
    expect(describeWriteBudgetLimits(5000, now).configuredPerDay).toBeNull();
    expect(describeWriteBudgetLimits(Number.NaN, now).configuredPerDay).toBeNull();
    expect(describeWriteBudgetLimits(null, now).configuredPerDay).toBeNull();
    // A „neviem" sa nikdy netvári ako pribrzdené.
    expect(describeWriteBudgetLimits(null, now).belowShopCap).toBe(false);
  });

  it('strop shopu sa obnovuje o UTC polnoci, nie o polnoci v Bratislave', () => {
    const limits = describeWriteBudgetLimits(200, now);
    expect(limits.nextResetAt.toISOString()).toBe('2026-08-13T00:00:00.000Z');
    expect(limits.secondsToReset).toBe(15 * 3600);
  });

  it('tesne pred polnocou UTC je do obnovy sekunda, nikdy záporné číslo', () => {
    const late = new Date('2026-08-12T23:59:59.000Z');
    expect(describeWriteBudgetLimits(200, late).secondsToReset).toBe(1);
    const midnight = new Date('2026-08-13T00:00:00.000Z');
    expect(describeWriteBudgetLimits(200, midnight).secondsToReset).toBe(24 * 3600);
  });
});
