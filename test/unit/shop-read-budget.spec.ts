/**
 * Aura Zľavy — zdieľaný denný rozpočet čítaní zo shopu
 * (KONTRAKT-DOKONCENIE-2026-08-12: A4).
 *
 * Čo sa tu drží:
 *  - stropy sa NEODVODZUJÚ znova, berú sa z `@/lib/shop/rate-limits` (raz sa
 *    na zámene „300 za deň" a „300 za minútu" rozbil celý katalóg),
 *  - počítadlo je ZDIEĽANÉ: čo minie jeden čitateľ, druhému nezostane,
 *    ale dráhy `anon` a `orders` sa NEZLIEVAJÚ (majú rôzne stropy shopu),
 *  - deň je UTC deň — o polnoci UTC sa rozpočet obnoví,
 *  - nečitateľné počítadlo je fail-closed: nerezervuje sa nič a `known` je
 *    `false`, aby to appka vedela priznať.
 */
import { describe, expect, it } from 'vitest';

import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  SHOP_KEYED_LIMIT,
  RATE_SAFETY_FACTOR,
} from '@/lib/shop/rate-limits';
import {
  READ_LANE_LIMITS,
  createMemoryReadBudgetStore,
  createReadBudget,
  readDaysNeeded,
  type ReadBudgetStore,
} from '@/lib/shop/read-budget';

const at = (iso: string): (() => Date) => () => new Date(iso);

describe('READ_LANE_LIMITS — stropy sa preberajú, nie prepočítavajú', () => {
  it('anonymná dráha má presne čísla z rate-limits', () => {
    expect(READ_LANE_LIMITS.anon.perUtcDay).toBe(ANON_READS_PER_UTC_DAY);
    expect(READ_LANE_LIMITS.anon.perMinute).toBe(ANON_READS_PER_MINUTE);
  });

  it('objednávková dráha má strop kľúča, nie anonymný', () => {
    expect(READ_LANE_LIMITS.orders.perUtcDay).toBe(
      Math.floor(SHOP_KEYED_LIMIT.perUtcDay * RATE_SAFETY_FACTOR),
    );
    /*
     * Tvrdenie je o ZDROJI stropu, nie o jeho veľkosti. Do 1. 9. 2026 tu stálo
     * `toBeLessThan(anon)` — bola to pravda (160 < 240), ale iba náhodou: kľúč
     * mal vtedy nižšiu kvótu než anonymná vetva. Po zdvihnutí kvóty na
     * 1000/deň je kľúčová dráha VOĽNEJŠIA (800 > 240) a tá nerovnosť by test
     * zhodila, hoci kód je správny. Čo naozaj musí platiť: dráha si strop
     * PREBERÁ z kľúča a nie z anonymnej vetvy.
     */
    expect(READ_LANE_LIMITS.orders.perUtcDay).not.toBe(READ_LANE_LIMITS.anon.perUtcDay);
  });
});

describe('createReadBudget — rezervácia a denný strop', () => {
  it('rezervuje, kým je z čoho, a potom prestane', async () => {
    const budget = createReadBudget({
      store: createMemoryReadBudgetStore(),
      lane: 'anon',
      now: at('2026-08-12T08:00:00.000Z'),
    });

    const first = await budget.reserve(ANON_READS_PER_UTC_DAY - 1);
    expect(first.granted).toBe(ANON_READS_PER_UTC_DAY - 1);
    expect(first.status.remaining).toBe(1);

    // Pýtame si päť, k dispozícii je jedno — dostaneme jedno, nie chybu.
    const second = await budget.reserve(5);
    expect(second.granted).toBe(1);
    expect(second.status.exhausted).toBe(true);

    const third = await budget.reserve(1);
    expect(third.granted).toBe(0);
    expect(third.status.remaining).toBe(0);
  });

  it('rozpočet sa obnoví o polnoci UTC, nie o polnoci v Bratislave', async () => {
    const store = createMemoryReadBudgetStore();
    // 23:30 miestneho času (21:30 UTC) — deň v Bratislave sa už láme, UTC nie.
    const evening = createReadBudget({ store, lane: 'anon', now: at('2026-08-12T21:30:00.000Z') });
    await evening.reserve(ANON_READS_PER_UTC_DAY);
    expect((await evening.status()).exhausted).toBe(true);

    const beforeMidnightUtc = createReadBudget({
      store,
      lane: 'anon',
      now: at('2026-08-12T23:59:00.000Z'),
    });
    expect((await beforeMidnightUtc.status()).exhausted).toBe(true);

    const afterMidnightUtc = createReadBudget({
      store,
      lane: 'anon',
      now: at('2026-08-13T00:01:00.000Z'),
    });
    const fresh = await afterMidnightUtc.status();
    expect(fresh.used).toBe(0);
    expect(fresh.exhausted).toBe(false);
    expect(fresh.day).toBe('2026-08-13');
  });

  it('`resetAt` je najbližšia polnoc UTC', async () => {
    const budget = createReadBudget({
      store: createMemoryReadBudgetStore(),
      now: at('2026-08-12T10:00:00.000Z'),
    });
    expect((await budget.status()).resetAt.toISOString()).toBe('2026-08-13T00:00:00.000Z');
  });

  it('dvaja čitatelia nad jedným úložiskom si rozpočet delia', async () => {
    const store = createMemoryReadBudgetStore();
    const now = at('2026-08-12T10:00:00.000Z');
    const catalog = createReadBudget({ store, lane: 'anon', now });
    const other = createReadBudget({ store, lane: 'anon', now });

    await other.reserve(200);
    const left = await catalog.status();
    expect(left.used).toBe(200);
    expect(left.remaining).toBe(ANON_READS_PER_UTC_DAY - 200);
  });

  it('dráhy sa nezlievajú — objednávkové čítania neuberajú katalógu', async () => {
    const store = createMemoryReadBudgetStore();
    const now = at('2026-08-12T10:00:00.000Z');
    const orders = createReadBudget({ store, lane: 'orders', now });
    const anon = createReadBudget({ store, lane: 'anon', now });

    await orders.reserve(50);
    expect((await anon.status()).used).toBe(0);
    expect((await orders.status()).used).toBe(50);
  });

  it('minútové počítadlo vidí len posledných 60 sekúnd', async () => {
    let clock = new Date('2026-08-12T10:00:00.000Z');
    const budget = createReadBudget({
      store: createMemoryReadBudgetStore(),
      lane: 'anon',
      now: () => clock,
    });

    await budget.reserve(3);
    expect((await budget.status()).usedThisMinute).toBe(3);

    clock = new Date('2026-08-12T10:01:30.000Z');
    expect((await budget.status()).usedThisMinute).toBe(0);
  });

  it('nečitateľné počítadlo nerezervuje nič a prizná, že nevie (fail-closed)', async () => {
    const broken: ReadBudgetStore = {
      async used(): Promise<number> {
        throw new Error('DB je preč');
      },
      async add(): Promise<number> {
        throw new Error('DB je preč');
      },
    };
    const budget = createReadBudget({ store: broken, lane: 'anon', now: at('2026-08-12T10:00:00.000Z') });

    const status = await budget.status();
    expect(status.known).toBe(false);
    expect(status.exhausted).toBe(true);

    const reservation = await budget.reserve(1);
    expect(reservation.granted).toBe(0);
    expect(reservation.status.known).toBe(false);
  });
});

describe('readDaysNeeded — koľko ďalších UTC dní to potrvá', () => {
  it('čo sa zmestí do dneška, netrvá ani deň', () => {
    expect(readDaysNeeded(10, 240)).toBe(0);
    expect(readDaysNeeded(0, 0)).toBe(0);
  });

  it('411 stránok katalógu je pri prázdnom dni dvojdňový beh', () => {
    // Presne prípad z kontraktu: 41 082 produktov po 100 na stránku.
    expect(readDaysNeeded(411, ANON_READS_PER_UTC_DAY, ANON_READS_PER_UTC_DAY)).toBe(1);
    // A keď je dnešok už minutý, sú to dva ďalšie dni.
    expect(readDaysNeeded(411, 0, ANON_READS_PER_UTC_DAY)).toBe(2);
  });
});
