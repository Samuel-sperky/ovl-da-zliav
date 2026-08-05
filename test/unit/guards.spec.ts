/**
 * Aura Zľavy — unit testy guardov engine (A9; I2, I7, I9, I12, I13, D77, D79).
 *
 * Guardy sú fail-closed brána pred KAŽDÝM zápisom. Testy bežia bez DB —
 * všetko dodáva in-memory svet z `src/lib/engine/testing.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  GUARD_CODES,
  checkAllowlist,
  checkRunawayAndMaybeLock,
  checkWriteWindow,
  checkWritesEnabled,
  runPreWriteGuards,
  type GuardFlags,
  type GuardsDeps,
} from '@/lib/engine/guards';
import {
  createMemoryAllowlistRepo,
  createMemoryAudit,
  createMemorySettingsRepo,
} from '@/lib/engine/testing';

const PROD_FLAGS: GuardFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
};

function world(opts: {
  flags?: Partial<GuardFlags>;
  activeIds?: number[];
  seededWrites?: number;
  writesLocked?: boolean;
} = {}) {
  const settingsRepo = createMemorySettingsRepo(
    opts.writesLocked ? { writesLocked: true, writesLockedReason: 'test' } : {},
  );
  const allowlistRepo = createMemoryAllowlistRepo(opts.activeIds ?? [201, 202, 203]);
  const audit = createMemoryAudit();
  if (opts.seededWrites) audit.seedWrites(opts.seededWrites);
  const deps: GuardsDeps = {
    settingsRepo,
    allowlistRepo,
    auditRepo: audit,
    audit,
    flags: { ...PROD_FLAGS, ...(opts.flags ?? {}) },
  };
  return { deps, settingsRepo, allowlistRepo, audit };
}

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const validParams = {
  productIds: [201, 202, 203],
  percent: 15,
  from: day(1),
  to: day(10),
};

describe('checkWritesEnabled (I13, D77)', () => {
  it('mimo produkcie odmietne zápis bez ohľadu na WRITES_ENABLED', () => {
    for (const nodeEnv of ['test', 'development']) {
      const result = checkWritesEnabled({ ...PROD_FLAGS, nodeEnv });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe(GUARD_CODES.writesDisabled);
    }
  });

  it('v produkcii bez WRITES_ENABLED=true odmietne', () => {
    const result = checkWritesEnabled({ ...PROD_FLAGS, writesEnabled: false });
    expect(result.ok).toBe(false);
  });

  it('prejde len pri NODE_ENV=production A WRITES_ENABLED=true', () => {
    expect(checkWritesEnabled(PROD_FLAGS).ok).toBe(true);
  });
});

describe('writes_locked (D79)', () => {
  it('zamknuté zápisy odmietnu celú dávku', async () => {
    const { deps } = world({ writesLocked: true });
    const result = await runPreWriteGuards(validParams, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.writesLocked);
  });
});

describe('runaway strop 60/h (D79, I12)', () => {
  it('pod stropom prejde', async () => {
    const { deps } = world({ seededWrites: 59 });
    expect((await checkRunawayAndMaybeLock(deps)).ok).toBe(true);
  });

  it('na strope fail-closed ZAMKNE zápisy a zapíše audit writes_locked', async () => {
    const { deps, settingsRepo, audit } = world({ seededWrites: 60 });
    const result = await checkRunawayAndMaybeLock(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.runawayLimit);
    expect(settingsRepo.record.writesLocked).toBe(true);
    expect(settingsRepo.record.writesLockedReason).toContain('runaway');
    expect(audit.byEvent('writes_locked')).toHaveLength(1);
  });

  it('write_uncertain sa počíta do stropu rovnako ako write_ok', async () => {
    const { deps, audit } = world();
    for (let i = 0; i < 60; i += 1) {
      audit.records.push({ actor: 'system', eventType: 'write_uncertain', ok: null });
    }
    expect((await checkRunawayAndMaybeLock(deps)).ok).toBe(false);
  });
});

describe('allowlist (I2, fail-closed)', () => {
  it('produkt mimo aktívneho allowlistu je odmietnutý', async () => {
    const { deps } = world({ activeIds: [201, 202] });
    const result = await checkAllowlist([201, 202, 999], deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.notInAllowlist);
  });

  it('viac než 10 produktov je odmietnutých', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => 201 + i);
    const { deps } = world({ activeIds: ids });
    const result = await checkAllowlist(ids, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.tooManyProducts);
  });

  it('prázdna dávka a duplicity sú odmietnuté', async () => {
    const { deps } = world();
    expect((await checkAllowlist([], deps)).ok).toBe(false);
    expect((await checkAllowlist([201, 201], deps)).ok).toBe(false);
  });

  it('výnimka repozitára = fail-closed odmietnutie (pri pochybnosti sa nezapisuje)', async () => {
    const { deps } = world();
    const broken: GuardsDeps = {
      ...deps,
      allowlistRepo: {
        areAllActive: async () => {
          throw new Error('db down');
        },
      },
    };
    expect((await checkAllowlist([201], broken)).ok).toBe(false);
  });
});

describe('percento a okno (I9, I7)', () => {
  it.each([0, 31, 2.5, -5, NaN])('percento %s je odmietnuté', (percent) => {
    const result = checkWriteWindow({ percent: percent as number, from: day(1), to: day(5) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.percentInvalid);
  });

  it('`to < from` je odmietnuté', () => {
    const result = checkWriteWindow({ percent: 10, from: day(5), to: day(1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.invalidDates);
  });

  it('okno dlhšie než 3 kalendárne mesiace je odmietnuté', () => {
    const result = checkWriteWindow({ percent: 10, from: day(1), to: day(120) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.rangeTooLong);
  });

  it('`to` v minulosti je odmietnuté — tvar zakázaného rušenia zľavy (I7)', () => {
    const result = checkWriteWindow({ percent: 10, from: day(-10), to: day(-1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.toInPast);
  });

  it('platné parametre prejdú (vrátane from = dnes)', () => {
    expect(checkWriteWindow({ percent: 30, from: day(0), to: day(0) }).ok).toBe(true);
  });
});

describe('runPreWriteGuards — poradie a celok (§9)', () => {
  it('env poistka má prednosť pred všetkým ostatným', async () => {
    const { deps } = world({ flags: { nodeEnv: 'test' }, writesLocked: true });
    const result = await runPreWriteGuards(validParams, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.writesDisabled);
  });

  it('čistá dávka prejde všetkými guardmi', async () => {
    const { deps } = world();
    expect((await runPreWriteGuards(validParams, deps)).ok).toBe(true);
  });
});
