/**
 * Aura Zľavy — fail-closed režim rozsahu a dávkové zápisy (V4, KONTRAKT V3).
 *
 * Testy bežia nad NÁHRADNÝM `Queryable`, nie nad DB — presne preto, že sa tu
 * overujú stavy, ktoré sa v zdravej DB nedajú vyrobiť: chýbajúci riadok,
 * neznáma hodnota v stĺpci a nečitateľná databáza. Integračná strana (skutočné
 * `settings`, skutočné migrácie) je v `test/integration/repo-fronta.spec.ts`.
 *
 * Čo sa tu dokazuje:
 *  - **K1 bod 1** — chýbajúca, neznáma aj nečitateľná hodnota `scope_mode`
 *    znamená `pilot`. Nie výnimka, nie `plny`.
 *  - **K1 tabuľka režimov** — v `pilot` je strop 10 bez ohľadu na to, čo je
 *    v `max_products_per_campaign`.
 *  - **K2** — položky a katalóg sa zapisujú po DÁVKACH, nie po riadkoch.
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { Queryable } from '@/contracts';
import { createCampaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { createCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { createCatalogRepo } from '@/lib/repo/catalog.repo';
import {
  createSettingsRepo,
  effectiveMaxProducts,
  PILOT_MAX_PRODUCTS,
} from '@/lib/repo/settings.repo';

/* ─────────────────────────── náhradné spojenia ─────────────────────────── */

/** Spojenie, ktoré na každý dotaz vráti tie isté riadky. */
function connWith(rows: unknown): Queryable {
  return { query: (async () => rows) as Queryable['query'] };
}

/** Spojenie, ktoré neodpovie — simuluje nedostupnú alebo rozbitú DB. */
const brokenConn: Queryable = {
  query: async () => {
    throw new Error('DB nie je dostupná');
  },
};

/** Spojenie, ktoré si pamätá odoslané SQL a parametre. */
function recordingConn(): { conn: Queryable; calls: Array<{ sql: string; values: unknown[] }> } {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  return {
    calls,
    conn: {
      query: (async (sql: string, values?: unknown) => {
        calls.push({ sql, values: Array.isArray(values) ? values : [] });
        return [];
      }) as Queryable['query'],
    },
  };
}

/** Riadok `settings` v tvare, v akom ho vracia driver. */
function settingsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    shop_domain: null,
    shop_domain_confirmed_at: null,
    eager_write_default: 1,
    scope_mode: 'pilot',
    max_products_per_campaign: 10000,
    daily_write_budget: 200,
    writes_locked: 0,
    writes_locked_reason: null,
    writes_locked_at: null,
    onboarding_done_at: null,
    updated_at: new Date('2026-08-10T10:00:00.000Z'),
    ...overrides,
  };
}

/* ═════════════════ K1 bod 1 — fail-closed režim rozsahu ══════════════════ */

describe('settings.repo — režim rozsahu je fail-closed (K1 bod 1)', () => {
  it('platná hodnota `plny` sa prečíta ako `plny`', async () => {
    const repo = createSettingsRepo({
      defaultConn: connWith([settingsRow({ scope_mode: 'plny', daily_write_budget: 120 })]),
    });
    const scope = await repo.readScope();
    expect(scope.mode).toBe('plny');
    expect(scope.dailyWriteBudget).toBe(120);
    expect(scope.failClosed).toBe(false);
  });

  it('CHÝBAJÚCI riadok settings znamená `pilot`, nie výnimku', async () => {
    const repo = createSettingsRepo({ defaultConn: connWith([]) });
    const scope = await repo.readScope();
    expect(scope.mode).toBe('pilot');
    expect(scope.failClosed).toBe(true);
    expect(scope.maxProductsPerCampaign).toBe(PILOT_MAX_PRODUCTS);
  });

  it('NEZNÁMA hodnota `scope_mode` znamená `pilot`, nikdy `plny`', async () => {
    for (const value of ['', 'PLNY', 'plny ', 'super', null, 0, undefined]) {
      const repo = createSettingsRepo({
        defaultConn: connWith([settingsRow({ scope_mode: value })]),
      });
      const scope = await repo.readScope();
      expect(scope.mode, `hodnota ${String(value)}`).toBe('pilot');
      expect(scope.failClosed).toBe(true);
    }
  });

  it('NEČITATEĽNÁ databáza znamená `pilot` — readScope() nehádže', async () => {
    const repo = createSettingsRepo({ defaultConn: brokenConn });
    const scope = await repo.readScope();
    expect(scope.mode).toBe('pilot');
    expect(scope.failClosed).toBe(true);
  });

  it('get() mapuje neznámy režim rovnako fail-closed (druhá cesta k tej istej hodnote)', async () => {
    const repo = createSettingsRepo({
      defaultConn: connWith([settingsRow({ scope_mode: 'nieco-ine' })]),
    });
    const record = await repo.get();
    expect(record.scopeMode).toBe('pilot');
  });

  it('get() na rozdiel od readScope() chybu DB NEskrýva', async () => {
    const repo = createSettingsRepo({ defaultConn: brokenConn });
    await expect(repo.get()).rejects.toThrow();
  });

  it('mimo rozsah idú hodnoty stropu a rozpočtu na fail-closed default', async () => {
    const repo = createSettingsRepo({
      defaultConn: connWith([
        settingsRow({ scope_mode: 'plny', max_products_per_campaign: 99999, daily_write_budget: 0 }),
      ]),
    });
    const scope = await repo.readScope();
    expect(scope.maxProductsPerCampaign).toBe(PILOT_MAX_PRODUCTS);
    expect(scope.dailyWriteBudget).toBe(1);
  });
});

describe('effectiveMaxProducts — strop režimu (K1, tabuľka režimov)', () => {
  it('v `pilot` je strop vždy 10, aj keď nastavenia hovoria 10 000', () => {
    expect(
      effectiveMaxProducts({
        mode: 'pilot',
        maxProductsPerCampaign: 10_000,
        dailyWriteBudget: 200,
        failClosed: false,
      }),
    ).toBe(10);
  });

  it('v `plny` platí uložený strop, zastropovaný tvrdým DB stropom', () => {
    expect(
      effectiveMaxProducts({
        mode: 'plny',
        maxProductsPerCampaign: 8000,
        dailyWriteBudget: 200,
        failClosed: false,
      }),
    ).toBe(8000);
    expect(
      effectiveMaxProducts({
        mode: 'plny',
        maxProductsPerCampaign: 999_999,
        dailyWriteBudget: 200,
        failClosed: false,
      }),
    ).toBe(10_000);
  });
});

describe('settings.repo — zápisy nastavení sa nedajú prestreliť', () => {
  it('setScopeMode() odmietne hodnotu mimo ENUMu', async () => {
    const repo = createSettingsRepo({ defaultConn: connWith([]) });
    await expect(repo.setScopeMode('plne' as never)).rejects.toThrow(/Neznámy režim/);
  });

  it('setDailyWriteBudget() drží 1–200 (strop shopu, nie náš)', async () => {
    const repo = createSettingsRepo({ defaultConn: connWith([]) });
    await expect(repo.setDailyWriteBudget(0)).rejects.toThrow();
    await expect(repo.setDailyWriteBudget(201)).rejects.toThrow();
    await expect(repo.setDailyWriteBudget(200)).resolves.toBeUndefined();
  });

  it('setMaxProductsPerCampaign() drží 1–10 000 (K1 bod 3)', async () => {
    const repo = createSettingsRepo({ defaultConn: connWith([]) });
    await expect(repo.setMaxProductsPerCampaign(0)).rejects.toThrow();
    await expect(repo.setMaxProductsPerCampaign(10_001)).rejects.toThrow();
    await expect(repo.setMaxProductsPerCampaign(10_000)).resolves.toBeUndefined();
  });
});

/* ═══════════════════ K2 — zápis po dávkach, nie po riadkoch ══════════════ */

describe('campaign-items.repo — dávkové vkladanie (K2)', () => {
  it('1 200 položiek ide na 3 príkazy, nie na 1 200', async () => {
    const { conn, calls } = recordingConn();
    const repo = createCampaignItemsRepo({ defaultConn: conn });
    const items = Array.from({ length: 1200 }, (_, i) => ({
      productId: 1000 + i,
      position: i + 1,
      percent: 20,
      priceAtPreview: null,
      hasAttributes: false,
    }));

    await repo.createMany(7, items);

    expect(calls).toHaveLength(3);
    // 500 + 500 + 200 riadkov po 6 stĺpcoch.
    expect(calls.map((call) => call.values.length)).toEqual([3000, 3000, 1200]);
    for (const call of calls) {
      expect(call.sql.startsWith('INSERT INTO campaign_items')).toBe(true);
      // Do SQL sa neinterpoluje žiadna hodnota — len `?`.
      expect(call.sql).not.toMatch(/1000|VALUES \(\d/);
    }
  });

  it('percento sa nedá zmeniť cez update() — rozhodlo sa pri potvrdení (K3)', async () => {
    const { conn } = recordingConn();
    const repo = createCampaignItemsRepo({ defaultConn: conn });
    await expect(repo.update(1, { percent: 30 } as never)).rejects.toThrow(/Neznáme pole/);
  });

  it('položka bez platného percenta zhodí celú dávku ešte pred SQL (K3)', async () => {
    const { conn, calls } = recordingConn();
    const repo = createCampaignItemsRepo({ defaultConn: conn });
    await expect(
      repo.createMany(7, [
        { productId: 1, position: 1, percent: 10, priceAtPreview: null, hasAttributes: false },
        { productId: 2, position: 2, percent: 0, priceAtPreview: null, hasAttributes: false },
      ]),
    ).rejects.toThrow(/percento/i);
    expect(calls).toHaveLength(0);
  });

  it('percento 31 a desatinné percento sú rovnako neplatné (I9)', async () => {
    const { conn } = recordingConn();
    const repo = createCampaignItemsRepo({ defaultConn: conn });
    for (const percent of [31, 10.5, -5, Number.NaN]) {
      await expect(
        repo.createMany(7, [
          { productId: 1, position: 1, percent, priceAtPreview: null, hasAttributes: false },
        ]),
      ).rejects.toThrow(/percento/i);
    }
  });
});

/* ═══════════ D13/D31 — `DATE` stĺpec sa nesmie posunúť o celý deň ════════ */

describe('campaigns.repo — okno zľavy prežije zónu stroja (D13, D31)', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  /** Riadok `campaigns` v tvare, v akom ho vracia driver. */
  function campaignRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const ts = new Date('2026-08-10T10:00:00.000Z');
    return {
      id: 1,
      operation_id: '01JTESTTESTTESTTESTTESTTES',
      name: 'Jesenná akcia',
      kind: 'new',
      parent_campaign_id: null,
      percent: 30,
      date_from: '2026-09-01',
      date_to: '2026-09-30',
      date_from_original: null,
      mode: 'scheduled',
      status: 'queued',
      status_reason: null,
      late: 0,
      fire_at: null,
      scheduled_at: null,
      needs_key_since: null,
      claimed_at: null,
      started_at: null,
      finished_at: null,
      items_total: 0,
      items_ok: 0,
      items_failed: 0,
      items_uncertain: 0,
      confirmed_at: null,
      confirm_payload_hash: null,
      sudo_at: null,
      result_ack_at: null,
      created_by: 1,
      created_at: ts,
      updated_at: ts,
      ...overrides,
    };
  }

  /**
   * REGRESIA. `DATE` je kalendárny deň bez zóny a driver ho skladá ako LOKÁLNU
   * polnoc. Pôvodné `toISOString().slice(0, 10)` preto na stroji v
   * `Europe/Bratislava` — teda tam, kde appka naozaj beží — vracalo
   * PREDCHÁDZAJÚCI deň a posunulo tým celé okno zľavy.
   */
  it('`date_from` z DATE stĺpca zostane tým istým dňom aj mimo UTC', async () => {
    process.env.TZ = 'Europe/Bratislava';
    const localMidnight = new Date(2026, 8, 1); // 1. 9. 2026 lokálneho času

    // Dôkaz, že pasca je skutočná a nie hypotetická:
    expect(localMidnight.toISOString().slice(0, 10)).toBe('2026-08-31');

    const repo = createCampaignsRepo({
      defaultConn: connWith([
        campaignRow({ date_from: localMidnight, date_to: new Date(2026, 8, 30) }),
      ]),
    });
    const record = await repo.getById(1);
    expect(record?.dateFrom).toBe('2026-09-01');
    expect(record?.dateTo).toBe('2026-09-30');
  });

  it('`late` a `queued` sa namapujú z riadku', async () => {
    const repo = createCampaignsRepo({
      defaultConn: connWith([campaignRow({ late: 1, status: 'queued' })]),
    });
    const record = await repo.getById(1);
    expect(record?.late).toBe(true);
    expect(record?.status).toBe('queued');
  });
});

/* ═══════════════ D84 — claim() je fail-closed aj pri súboji o zámok ══════ */

describe('campaigns.repo — claim() pri súboji o zámok (D84, I12)', () => {
  /** Chyba v tvare, v akom ju dáva `mariadb` driver. */
  function sqlError(errno: number): Error & { errno: number } {
    return Object.assign(new Error(`SQL chyba ${errno}`), { errno });
  }

  function failingConn(errno: number): Queryable {
    return {
      query: async () => {
        throw sqlError(errno);
      },
    };
  }

  it('deadlock (1213) znamená „nezabral som", nie výnimku', async () => {
    const repo = createCampaignsRepo({ defaultConn: failingConn(1213) });
    expect(await repo.claim(1, ['queued'])).toBe(false);
  });

  it('vypršaný zámok (1205) znamená to isté', async () => {
    const repo = createCampaignsRepo({ defaultConn: failingConn(1205) });
    expect(await repo.claim(1, ['queued'])).toBe(false);
  });

  it('iná chyba DB sa NEskrýva — pustí sa von', async () => {
    const repo = createCampaignsRepo({ defaultConn: failingConn(1054) });
    await expect(repo.claim(1, ['queued'])).rejects.toThrow(/1054/);
  });

  it('prázdny alebo neznámy zoznam stavov neclaimuje nič', async () => {
    const { conn, calls } = recordingConn();
    const repo = createCampaignsRepo({ defaultConn: conn });
    expect(await repo.claim(1, [])).toBe(false);
    expect(await repo.claim(1, ['vymyslene' as never])).toBe(false);
    expect(await repo.claim(0, ['queued'])).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('catalog.repo — dávkový upsert a parametrizované SQL (K7)', () => {
  it('1 200 riadkov katalógu ide na 3 upserty', async () => {
    const { conn, calls } = recordingConn();
    const repo = createCatalogRepo({ defaultConn: conn });
    const records = Array.from({ length: 1200 }, (_, i) => ({
      productId: 5000 + i,
      name: `Šperk ${5000 + i}`,
      price: '19.90',
      hasAttributes: false,
      source: 'list' as const,
      raw: null,
    }));

    const written = await repo.upsertMany(records);

    expect(written).toBe(1200);
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.values.length)).toEqual([4000, 4000, 1600]);
    expect(calls[0]?.sql).toContain('ON DUPLICATE KEY UPDATE');
  });

  it('vyhľadávanie posiela hodnoty výhradne ako `?` parametre', async () => {
    const { conn, calls } = recordingConn();
    const repo = createCatalogRepo({ defaultConn: conn });

    await repo.search({
      query: "100% zľava'; DROP TABLE catalog_cache; --",
      priceFrom: 10,
      priceTo: '50.00',
      soldWindowDays: 90,
      soldBuckets: ['none'],
      neverDiscounted: true,
      page: 2,
      perPage: 25,
      today: '2026-08-10',
    });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      expect(call.sql).not.toContain('DROP TABLE');
      expect(call.sql).not.toContain('100%');
    }
    // Text ide ako parametre a `%` v nich je escapnutý, nie wildcard. Od
    // 19. 8. 2026 sa hľadá SLOVO PO SLOVE (tvar `WHERE` stráži
    // `hladanie-viac-slov.spec.ts`), takže je to viac parametrov než jeden —
    // invariant „hodnota sa do SQL nikdy neinterpoluje" platí ďalej.
    const values = calls.flatMap((call) => call.values.map(String));
    expect(values).toContain('100\\%');
    expect(values).toContain("zľava';");
    expect(values).toContain('DROP');
  });

  it('prázdny zoznam productIds znamená prázdny výsledok, nie „bez filtra"', async () => {
    const { conn, calls } = recordingConn();
    const repo = createCatalogRepo({ defaultConn: conn });
    await repo.search({ productIds: [] });
    expect(calls[0]?.sql).toContain('1 = 0');
  });

  it('zamknuté filtre sa priznávajú, nie predstierajú (K8)', async () => {
    const { conn } = recordingConn();
    const repo = createCatalogRepo({ defaultConn: conn });
    const result = await repo.search({});
    expect(result.lockedFilters).toContain('stock');
    expect(result.lockedFilters).toContain('margin');
  });
});
