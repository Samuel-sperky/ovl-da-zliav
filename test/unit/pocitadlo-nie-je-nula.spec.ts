/**
 * Aura Zľavy — nečitateľné počítadlo auditu NIE JE nula (B4; D79, I12, K2).
 *
 * Obe počítadlá, o ktoré sa opierajú brzdy zápisu, čítajú `SELECT COUNT(*)` nad
 * `audit_log`:
 *
 *  - `audit.repo.countWritesInLastHour()` — runaway strop (D79, I12),
 *  - `budget.auditWriteAttemptCounter` — denný rozpočet (K2).
 *
 * Keď dotaz neodpovie číslom (prázdna odpoveď drivera, iný tvar riadku, `total`
 * ako nečíslo), pôvodný kód z toho urobil `0`. `0` je pritom najpovoľujúcejšia
 * možná odpoveď: „tento hodinu sa nezapisovalo" a „dnes sa nič neminulo".
 * Runaway zámok aj denný rozpočet nad pokazeným počítadlom prešli.
 *
 * Tieto testy merajú SPRÁVANIE (volajú funkcie s podvrhnutým spojením a
 * podvrhnutou odpoveďou pool-u), nie zdrojový text. Ku každému negatívnemu
 * tvrdeniu je pozitívne dvojča — inak by testy prešli aj vtedy, keby počítadlo
 * hádzalo vždy a nikdy nič nespočítalo.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Queryable } from '@/contracts';

import {
  BudgetUnavailableError,
  auditWriteAttemptCounter,
  budgetDay,
  createBudget,
  type WriteAttemptCounter,
} from '@/lib/engine/budget';
import { checkRunawayAndMaybeLock, type GuardFlags, type GuardsDeps } from '@/lib/engine/guards';
import { createMemoryAudit, createMemorySettingsRepo } from '@/lib/engine/testing';
import { AuditCountUnreadableError, countWritesInLastHour } from '@/lib/repo/audit.repo';

/** Odpoveď, ktorú vráti podvrhnutý `@/db/pool`. Nastavuje ju každý test sám. */
const pool = vi.hoisted(() => ({ answer: undefined as unknown }));

vi.mock('@/db/pool', () => ({
  query: async (): Promise<unknown> => pool.answer,
  getPool: (): never => {
    throw new Error('unit test nesmie otvoriť pool');
  },
  getConnection: (): never => {
    throw new Error('unit test nesmie otvoriť spojenie');
  },
  pingDb: async (): Promise<boolean> => false,
  closePool: async (): Promise<void> => {},
  resolveAppPassword: (): string => 'test',
}));

/** Spojenie, ktoré na každý dotaz vráti `rows`. */
function connReturning(rows: unknown): Queryable {
  return {
    async query<T>(): Promise<T> {
      return rows as T;
    },
  };
}

/** Počítadlo rozpočtu, ktoré vráti `value` — aj keď to nie je číslo. */
function counterReturning(value: unknown): WriteAttemptCounter {
  return {
    async countWriteAttemptsOn(): Promise<number> {
      return value as number;
    },
  };
}

/* ═══════════ 1. runaway počítadlo (audit.repo, D79/I12) ═══════════════════ */

describe('countWritesInLastHour — nečitateľná odpoveď nie je nula (D79, I12)', () => {
  it('prázdna odpoveď HODÍ, nevráti 0', async () => {
    await expect(countWritesInLastHour(connReturning([]))).rejects.toBeInstanceOf(
      AuditCountUnreadableError,
    );
  });

  it('riadok bez `total` HODÍ', async () => {
    await expect(countWritesInLastHour(connReturning([{}]))).rejects.toBeInstanceOf(
      AuditCountUnreadableError,
    );
  });

  it('`total` ako nečíslo HODÍ', async () => {
    await expect(countWritesInLastHour(connReturning([{ total: 'sedem' }]))).rejects.toBeInstanceOf(
      AuditCountUnreadableError,
    );
  });

  it('odpoveď, ktorá nie je poľom, HODÍ', async () => {
    await expect(countWritesInLastHour(connReturning({ affectedRows: 0 }))).rejects.toBeInstanceOf(
      AuditCountUnreadableError,
    );
  });

  it('číslo v odpovedi sa spočíta — aj keď ho driver pošle ako string', async () => {
    expect(await countWritesInLastHour(connReturning([{ total: 7 }]))).toBe(7);
    expect(await countWritesInLastHour(connReturning([{ total: '7' }]))).toBe(7);
    expect(await countWritesInLastHour(connReturning([{ total: 0 }]))).toBe(0);
  });
});

/* ═══════════ 2. runaway strop nad nečitateľným počítadlom ═════════════════ */

const RUNAWAY_FLAGS: GuardFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
  dailyWriteBudget: 200,
};

/** Guard so SKUTOČNÝM repo počítadlom nad podvrhnutým spojením. */
function runawayWorld(rows: unknown) {
  const settingsRepo = createMemorySettingsRepo();
  const audit = createMemoryAudit();
  const conn = connReturning(rows);
  const deps: GuardsDeps = {
    settingsRepo,
    audit,
    auditRepo: { countWritesInLastHour: () => countWritesInLastHour(conn) },
    flags: RUNAWAY_FLAGS,
  };
  return { deps, settingsRepo, audit };
}

describe('checkRunawayAndMaybeLock nad nečitateľným počítadlom (D79, I12)', () => {
  it('nepovie „ok" — nečitateľné počítadlo zastaví zápis', async () => {
    const { deps } = runawayWorld([]);
    await expect(checkRunawayAndMaybeLock(deps)).rejects.toBeInstanceOf(AuditCountUnreadableError);
  });

  it('a NEZAMKNE zápisy natrvalo — zámok patrí prekročenému stropu, nie chybe čítania', async () => {
    const { deps, settingsRepo, audit } = runawayWorld([]);
    await expect(checkRunawayAndMaybeLock(deps)).rejects.toThrow();
    expect(settingsRepo.record.writesLocked).toBe(false);
    expect(audit.byEvent('writes_locked')).toHaveLength(0);
  });

  it('čitateľné počítadlo pod stropom stále prejde (strop 240/h pri rozpočte 200)', async () => {
    const { deps } = runawayWorld([{ total: 239 }]);
    expect((await checkRunawayAndMaybeLock(deps)).ok).toBe(true);
  });

  it('čitateľné počítadlo na strope stále zamkne', async () => {
    const { deps, settingsRepo } = runawayWorld([{ total: 240 }]);
    expect((await checkRunawayAndMaybeLock(deps)).ok).toBe(false);
    expect(settingsRepo.record.writesLocked).toBe(true);
  });
});

/* ═══════════ 3. denný rozpočet (budget.ts, K2) ════════════════════════════ */

describe('auditWriteAttemptCounter — nečitateľná spotreba nie je nula (K2)', () => {
  it('prázdna odpoveď pool-u HODÍ BudgetUnavailableError', async () => {
    pool.answer = [];
    await expect(auditWriteAttemptCounter.countWriteAttemptsOn(budgetDay())).rejects.toBeInstanceOf(
      BudgetUnavailableError,
    );
  });

  it('odpoveď, ktorá nie je poľom, HODÍ', async () => {
    pool.answer = { affectedRows: 0 };
    await expect(auditWriteAttemptCounter.countWriteAttemptsOn(budgetDay())).rejects.toBeInstanceOf(
      BudgetUnavailableError,
    );
  });

  it('`total` ako nečíslo HODÍ', async () => {
    pool.answer = [{ total: 'sedem' }];
    await expect(auditWriteAttemptCounter.countWriteAttemptsOn(budgetDay())).rejects.toBeInstanceOf(
      BudgetUnavailableError,
    );
  });

  it('číslo v odpovedi sa spočíta', async () => {
    pool.answer = [{ total: '12' }];
    expect(await auditWriteAttemptCounter.countWriteAttemptsOn(budgetDay())).toBe(12);
    pool.answer = [{ total: 0 }];
    expect(await auditWriteAttemptCounter.countWriteAttemptsOn(budgetDay())).toBe(0);
  });
});

describe('createBudget nad nečitateľným počítadlom (K2)', () => {
  it('`remainingToday()` HODÍ — netvrdí, že je celý rozpočet voľný', async () => {
    const budget = createBudget({
      counter: counterReturning(Number.NaN),
      dailyBudget: 200,
    });
    await expect(budget.remainingToday()).rejects.toBeInstanceOf(BudgetUnavailableError);
  });

  it('`spentToday()` HODÍ — netvrdí, že sa dnes nič neminulo', async () => {
    const budget = createBudget({ counter: counterReturning(undefined), dailyBudget: 200 });
    await expect(budget.spentToday()).rejects.toBeInstanceOf(BudgetUnavailableError);
  });

  it('čitateľné počítadlo naďalej dá zvyšok', async () => {
    const budget = createBudget({ counter: counterReturning(5), dailyBudget: 200 });
    expect(await budget.spentToday()).toBe(5);
    expect(await budget.remainingToday()).toMatchObject({
      budget: 200,
      spent: 5,
      remaining: 195,
      exhausted: false,
    });
  });
});
