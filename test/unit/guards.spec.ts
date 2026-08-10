/**
 * Aura Zľavy — unit testy guardov engine (V5; I2, I7, I9, I12, I13, D77, D79;
 * KONTRAKT V3: K1, K2).
 *
 * Guardy sú fail-closed brána pred KAŽDÝM zápisom. Testy bežia bez DB —
 * repozitáre sú in-memory fakes.
 *
 * Čo sa oproti V2 zmenilo a PREČO sa tvrdenia prepísali (nie oslabili):
 *  - `checkAllowlist` → `checkScope` (K1). Tvrdenie „max 10 a všetko
 *    v allowliste" ZOSTÁVA — ale len pre režim `pilot`, ktorý je predvolený.
 *    Pribudlo tvrdenie pre režim `plny`: strop je `max_products_per_campaign`
 *    a rozsah overuje katalóg.
 *  - runaway strop nie je fixných 60/h, ale `daily_write_budget + 20 %` (K2)
 *    s podlahou 60/h. Pôvodný test „na 60 zamkne" preto stojí na rozpočte,
 *    ktorý 60 dáva — nie na konštante, ktorá už neplatí.
 */
import { describe, expect, it } from 'vitest';

import {
  GUARD_CODES,
  checkDailyBudget,
  checkRunawayAndMaybeLock,
  checkScope,
  checkWriteWindow,
  checkWritesEnabled,
  effectiveRunawayLimit,
  readScopeForWrite,
  runPreWriteGuards,
  type CatalogScopeSource,
  type GuardFlags,
  type GuardsDeps,
  type ScopeSettingsSource,
} from '@/lib/engine/guards';
import { budgetDay, type WriteAttemptCounter } from '@/lib/engine/budget';
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

/** Tvar, ktorý vracia `settings.repo.readScope()` (V4, K1). */
interface ScopeRow {
  mode: 'pilot' | 'plny';
  maxProductsPerCampaign: number;
  dailyWriteBudget: number;
  failClosed: boolean;
}

/** Katalóg pre režim `plny` — mapa ID → stav v shope (K1 bod 2). */
function memoryCatalog(
  rows: Array<[number, string]>,
  opts: { throws?: boolean } = {},
): CatalogScopeSource {
  const map = new Map(rows.map(([id, shopStatus]) => [id, { shopStatus }]));
  return {
    async getMany(productIds: number[]) {
      if (opts.throws === true) throw new Error('katalóg nie je dostupný');
      const result = new Map<number, { shopStatus?: string | null }>();
      for (const id of productIds) {
        const row = map.get(id);
        if (row !== undefined) result.set(id, row);
      }
      return result;
    },
  };
}

/** Počítadlo `write_attempt` za UTC deň (K2). */
function memoryCounter(byDay: Record<string, number>): WriteAttemptCounter {
  return {
    async countWriteAttemptsOn(day: string) {
      return byDay[day] ?? 0;
    },
  };
}

function world(
  opts: {
    flags?: Partial<GuardFlags>;
    activeIds?: number[];
    seededWrites?: number;
    writesLocked?: boolean;
    scope?: ScopeRow;
    scopeThrows?: boolean;
    catalog?: CatalogScopeSource;
    spentToday?: number;
  } = {},
) {
  const memorySettings = createMemorySettingsRepo(
    opts.writesLocked ? { writesLocked: true, writesLockedReason: 'test' } : {},
  );
  const settingsRepo: ScopeSettingsSource =
    opts.scope === undefined && opts.scopeThrows !== true
      ? memorySettings
      : Object.assign(memorySettings, {
          async readScope(): Promise<ScopeRow> {
            if (opts.scopeThrows === true) throw new Error('DB nie je dostupná');
            return opts.scope as ScopeRow;
          },
        });

  const allowlistRepo = createMemoryAllowlistRepo(opts.activeIds ?? [201, 202, 203]);
  const audit = createMemoryAudit();
  if (opts.seededWrites) audit.seedWrites(opts.seededWrites);

  const deps: GuardsDeps = {
    settingsRepo,
    allowlistRepo,
    auditRepo: audit,
    audit,
    flags: { ...PROD_FLAGS, ...(opts.flags ?? {}) },
    ...(opts.catalog !== undefined ? { catalogRepo: opts.catalog } : {}),
    writeAttemptCounter: memoryCounter({ [budgetDay()]: opts.spentToday ?? 0 }),
  };
  return { deps, settingsRepo: memorySettings, allowlistRepo, audit };
}

// Deň počítaný v zóne appky (Europe/Bratislava), nie v UTC — guardy porovnávajú
// `to` proti dnešku v zóne, takže UTC helper by medzi 22:00 a 24:00 UTC posielal
// včerajší dátum a test by flakoval presne v tom okne.
const day = (offset: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

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

describe('runaway strop = rozpočet + 20 % (K2, D79, I12)', () => {
  it('pri rozpočte 200/deň je strop 240/h, nie 60/h', async () => {
    const { deps } = world({ flags: { dailyWriteBudget: 200 } });
    expect(await effectiveRunawayLimit(deps)).toBe(240);
  });

  it('239 zápisov v hodine pri rozpočte 200 ešte prejde (60/h by tu už zamklo)', async () => {
    const { deps } = world({ flags: { dailyWriteBudget: 200 }, seededWrites: 239 });
    expect((await checkRunawayAndMaybeLock(deps)).ok).toBe(true);
  });

  it('na strope fail-closed ZAMKNE zápisy a zapíše audit writes_locked', async () => {
    const { deps, settingsRepo, audit } = world({
      flags: { dailyWriteBudget: 200 },
      seededWrites: 240,
    });
    const result = await checkRunawayAndMaybeLock(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.runawayLimit);
    expect(settingsRepo.record.writesLocked).toBe(true);
    expect(settingsRepo.record.writesLockedReason).toContain('runaway');
    expect(audit.byEvent('writes_locked')).toHaveLength(1);
  });

  it('rozpočet nastavený nadol NEZNÍŽI runaway strop pod podlahu 60/h', async () => {
    // Pri rozpočte 10/deň by 12/h zamklo zápisy pri prvom manuálnom retry.
    const { deps } = world({ flags: { dailyWriteBudget: 10 }, seededWrites: 59 });
    expect(await effectiveRunawayLimit(deps)).toBe(60);
    expect((await checkRunawayAndMaybeLock(deps)).ok).toBe(true);
  });

  it('write_uncertain sa počíta do stropu rovnako ako write_ok', async () => {
    const { deps, audit } = world({ flags: { dailyWriteBudget: 50 } });
    for (let i = 0; i < 60; i += 1) {
      audit.records.push({ actor: 'system', eventType: 'write_uncertain', ok: null });
    }
    expect((await checkRunawayAndMaybeLock(deps)).ok).toBe(false);
  });
});

describe('checkDailyBudget — denný rozpočet (K2)', () => {
  it('pod rozpočtom prejde a povie, koľko ešte zostáva', async () => {
    const { deps } = world({ flags: { dailyWriteBudget: 200 }, spentToday: 199 });
    const result = await checkDailyBudget(deps);
    expect(result.ok).toBe(true);
    expect(result.status).toMatchObject({ budget: 200, spent: 199, remaining: 1 });
  });

  it('na rozpočte vráti budget_exhausted — informáciu, nie chybu', async () => {
    const { deps } = world({ flags: { dailyWriteBudget: 200 }, spentToday: 200 });
    const result = await checkDailyBudget(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.budgetExhausted);
    expect(result.status).toMatchObject({ remaining: 0, exhausted: true });
  });

  it('rozpočet NIE JE súčasťou runPreWriteGuards — brána ho neodmieta (K2)', async () => {
    const { deps } = world({ flags: { dailyWriteBudget: 1 }, spentToday: 999 });
    // Vyčerpaný rozpočet znamená `queued`, o čom rozhoduje executor. Keby to
    // brána odmietla, kampaň by skončila ako chyba — presne to K2 zakazuje.
    expect((await runPreWriteGuards(validParams, deps)).ok).toBe(true);
  });
});

describe('checkScope — režim pilot (K1, I2, fail-closed)', () => {
  it('produkt mimo aktívneho allowlistu je odmietnutý', async () => {
    const { deps } = world({ activeIds: [201, 202] });
    const result = await checkScope([201, 202, 999], deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.notInAllowlist);
  });

  it('viac než 10 produktov je odmietnutých', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => 201 + i);
    const { deps } = world({ activeIds: ids });
    const result = await checkScope(ids, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.tooManyProducts);
  });

  it('prázdna dávka a duplicity sú odmietnuté', async () => {
    const { deps } = world();
    expect((await checkScope([], deps)).ok).toBe(false);
    expect((await checkScope([201, 201], deps)).ok).toBe(false);
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
    expect((await checkScope([201], broken)).ok).toBe(false);
  });

  it('strop 10 platí aj keď nastavenia hovoria o 10 000 (K1, tabuľka režimov)', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => 301 + i);
    const { deps } = world({
      activeIds: ids,
      scope: {
        mode: 'pilot',
        maxProductsPerCampaign: 10_000,
        dailyWriteBudget: 200,
        failClosed: false,
      },
    });
    const result = await checkScope(ids, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.tooManyProducts);
  });
});

describe('checkScope — režim plny (K1 bod 2)', () => {
  const plny: ScopeRow = {
    mode: 'plny',
    maxProductsPerCampaign: 3,
    dailyWriteBudget: 200,
    failClosed: false,
  };

  it('produkt v katalógu prejde aj keď v allowliste nie je', async () => {
    const { deps } = world({
      scope: plny,
      activeIds: [], // allowlist sa v `plny` nevynucuje
      catalog: memoryCatalog([
        [501, 'ok'],
        [502, 'ok'],
      ]),
    });
    expect((await checkScope([501, 502], deps)).ok).toBe(true);
  });

  it('produkt, ktorý appka nikdy nevidela, je odmietnutý', async () => {
    const { deps } = world({ scope: plny, catalog: memoryCatalog([[501, 'ok']]) });
    const result = await checkScope([501, 999], deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(GUARD_CODES.notInCatalog);
      expect(result.detail).toMatchObject({ productIds: [999] });
    }
  });

  it('produkt označený not_found je odmietnutý (D49)', async () => {
    const { deps } = world({
      scope: plny,
      catalog: memoryCatalog([
        [501, 'ok'],
        [502, 'not_found'],
      ]),
    });
    const result = await checkScope([501, 502], deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.notInCatalog);
  });

  it('nečitateľný katalóg = fail-closed odmietnutie', async () => {
    const { deps } = world({ scope: plny, catalog: memoryCatalog([], { throws: true }) });
    const result = await checkScope([501], deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.notInCatalog);
  });

  it('strop je max_products_per_campaign, nie 10', async () => {
    const { deps } = world({
      scope: plny,
      catalog: memoryCatalog([
        [501, 'ok'],
        [502, 'ok'],
        [503, 'ok'],
        [504, 'ok'],
      ]),
    });
    expect((await checkScope([501, 502, 503], deps)).ok).toBe(true);
    const tooMany = await checkScope([501, 502, 503, 504], deps);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.code).toBe(GUARD_CODES.tooManyProducts);
  });
});

describe('režim rozsahu je fail-closed (K1 bod 1)', () => {
  it('nečitateľné nastavenia znamenajú pilot, nie plny', async () => {
    const { deps } = world({ scopeThrows: true, activeIds: [201] });
    const scope = await readScopeForWrite(deps);
    expect(scope).toMatchObject({ mode: 'pilot', maxProducts: 10, failClosed: true });
  });

  it('neznáma hodnota režimu znamená pilot (allowlist sa vynucuje ďalej)', async () => {
    const { deps } = world({
      activeIds: [201],
      scope: {
        mode: 'nieco_ine' as unknown as 'plny',
        maxProductsPerCampaign: 10_000,
        dailyWriteBudget: 200,
        failClosed: false,
      },
    });
    expect((await readScopeForWrite(deps)).mode).toBe('pilot');
    // Produkt mimo allowlistu teda NEPREJDE — fail-closed sa nedá obísť
    // rozbitou hodnotou v stĺpci.
    expect((await checkScope([999], deps)).ok).toBe(false);
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

describe('D59 — polnočné zamrznutie manuálnych zápisov (midnight freeze)', () => {
  // 2026-08-05 23:59:30 Europe/Bratislava (CEST, UTC+2) = 21:59:30Z.
  const FROZEN_NOW = new Date('2026-08-05T21:59:30.000Z');
  // 23:58:00 lokálne — mimo pásma ±60 s.
  const SAFE_NOW = new Date('2026-08-05T21:58:00.000Z');

  it('o 23:59:30 sa zápis odmietne kódom midnight_freeze (fail-closed)', async () => {
    const { deps } = world();
    const result = await runPreWriteGuards(validParams, { ...deps, now: () => FROZEN_NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.midnightFreeze);
  });

  it('tesne po polnoci (00:00:30) je zápis rovnako zamrznutý', async () => {
    const { deps } = world();
    // 2026-08-06 00:00:30 lokálne = 2026-08-05T22:00:30Z.
    const result = await runPreWriteGuards(validParams, {
      ...deps,
      now: () => new Date('2026-08-05T22:00:30.000Z'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GUARD_CODES.midnightFreeze);
  });

  it('mimo pásma ±60 s zápis prechádza', async () => {
    const { deps } = world();
    const result = await runPreWriteGuards(validParams, { ...deps, now: () => SAFE_NOW });
    expect(result.ok).toBe(true);
  });
});
