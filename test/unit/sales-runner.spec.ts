/**
 * Aura Zľavy — spúšťač synchronizácie predajov (`lib/sales/sync-runner.ts`).
 *
 * Testuje sa PRODUKČNÉ ROZHODOVANIE „beží / nebeží": scheduler volá
 * `runSalesSyncIfDue()` každý tick a jediné, čo o predajoch vie, je jeho
 * návratová hodnota. Kľúč aj samotná synchronizácia sú nahradené mockom —
 * shopu sa test nedotkne (I6) a k DB nesiahne.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadForUse = vi.fn<() => Promise<(() => Promise<never>) | null>>();
const syncSales = vi.fn();
const reserve = vi.fn();

vi.mock('@/lib/repo/api-key.repo', () => ({
  ordersKeyRepo: { loadForUse: () => loadForUse() },
}));

vi.mock('@/lib/engine/sales-sync', () => ({
  syncSales: (...args: unknown[]) => syncSales(...args),
}));

// A4 — runner zapája ZDIEĽANÉ počítadlo čítaní. Mockuje sa, aby sa test
// nedotkol DB; dôležité je, že sa `syncSales` dostane rozpočet, nie čo vráti.
vi.mock('@/lib/repo/read-budget.repo', () => ({
  ordersReadBudget: { reserve: (count: number) => reserve(count) },
}));

const {
  runSalesSyncIfDue,
  lastSalesRun,
  resetSalesRunnerState,
  SALES_MIN_INTERVAL_MS,
  SALES_NO_KEY_RETRY_MS,
  SALES_RESUME_MS,
} = await import('@/lib/sales/sync-runner');

const OK_SYNC = {
  outcome: 'complete',
  windowFrom: '2026-08-04',
  windowTo: '2026-08-06',
  days: [],
  requestsUsed: 3,
  readsUsed: 3,
  capReached: false,
  dailyBudgetReached: false,
  stoppedBy: 'done',
  resumeAt: null,
  error: null,
};

/** Beh, ktorý sa pokojne zastavil na minutom dennom rozpočte (A4). */
function pausedSync(resumeAt: Date) {
  return {
    ...OK_SYNC,
    outcome: 'paused',
    days: [],
    requestsUsed: 0,
    readsUsed: 0,
    dailyBudgetReached: true,
    stoppedBy: 'daily_budget',
    resumeAt,
  };
}

const T0 = 1_760_000_000_000;

const withKey = (): void => {
  loadForUse.mockResolvedValue(async () => {
    throw new Error('kľúč sa v teste nikdy nedešifruje');
  });
};

beforeEach(() => {
  resetSalesRunnerState();
  loadForUse.mockReset();
  syncSales.mockReset();
  syncSales.mockResolvedValue(OK_SYNC);
  reserve.mockReset();
  reserve.mockResolvedValue({ requested: 1, granted: 1, status: { remaining: 159 } });
});

afterEach(() => {
  resetSalesRunnerState();
});

describe('sync-runner — chýbajúci objednávkový kľúč nesmie synchronizáciu uspať na 20 hodín', () => {
  it('po vložení kľúča sa synchronizácia rozbehne v rozumnom čase, nie až po celom intervale', async () => {
    // Boot: kľúč ešte nie je vložený (presne to, čo appka loguje ako
    // `sales_sync_skipped reason=no_orders_key`).
    loadForUse.mockResolvedValue(null);
    expect((await runSalesSyncIfDue(T0)).outcome).toBe('no_orders_key');
    expect(syncSales).not.toHaveBeenCalled();

    // Používateľ o pár minút vloží kľúč v UI. Keby si runner po „bez kľúča"
    // nasadil plný 20-hodinový odstup, appka by sa o kľúči dozvedela až
    // nasledujúci deň (alebo až po restarte) a karta Predajnosť by celý ten čas
    // pravdivo, ale zbytočne hlásila „zatiaľ bez dát".
    loadForUse.mockResolvedValue(async () => {
      throw new Error('kľúč sa v teste nikdy nedešifruje');
    });
    const soon = await runSalesSyncIfDue(T0 + SALES_NO_KEY_RETRY_MS + 1);
    expect(soon.outcome).toBe('ran');
    expect(syncSales).toHaveBeenCalledTimes(1);
  });

  it('bez kľúča sa DB nekontroluje každý tick — krátky odstup platí aj tak', async () => {
    loadForUse.mockResolvedValue(null);
    expect((await runSalesSyncIfDue(T0)).outcome).toBe('no_orders_key');
    // Ďalší tick schedulera o minútu: kľúč sa znova nehľadá.
    expect((await runSalesSyncIfDue(T0 + 60_000)).outcome).toBe('too_soon');
    expect(loadForUse).toHaveBeenCalledTimes(1);
  });

  it('po ÚSPEŠNOM behu platí plný interval podľa P3', async () => {
    loadForUse.mockResolvedValue(async () => {
      throw new Error('kľúč sa v teste nikdy nedešifruje');
    });
    expect((await runSalesSyncIfDue(T0)).outcome).toBe('ran');
    expect((await runSalesSyncIfDue(T0 + SALES_NO_KEY_RETRY_MS + 1)).outcome).toBe('too_soon');
    expect(syncSales).toHaveBeenCalledTimes(1);
  });

  it('interval bez kľúča je výrazne krátší než interval po úspešnom behu', () => {
    expect(SALES_NO_KEY_RETRY_MS).toBeLessThan(SALES_MIN_INTERVAL_MS);
  });
});

describe('sync-runner — zdieľaný denný rozpočet čítaní (A4)', () => {
  it('synchronizácii sa odovzdá ZDIEĽANÉ počítadlo, nie vlastné', async () => {
    withKey();
    await runSalesSyncIfDue(T0);

    const deps = syncSales.mock.calls[0]?.[0] as {
      budget?: { reserveShopReads(count?: number): Promise<unknown> };
    };
    expect(deps.budget).toBeDefined();

    // Rezervácia naozaj vedie do zdieľaného počítadla dráhy `orders`.
    await deps.budget?.reserveShopReads(1);
    expect(reserve).toHaveBeenCalledWith(1);
  });

  it('minutý rozpočet nie je chyba: hlási sa ako `budget_exhausted`', async () => {
    withKey();
    const resumeAt = new Date(T0 + 6 * 60 * 60 * 1000);
    syncSales.mockResolvedValue(pausedSync(resumeAt));

    const report = await runSalesSyncIfDue(T0);

    expect(report.outcome).toBe('budget_exhausted');
    expect(report.resumeAt).toBe(resumeAt);
    expect(report.sync?.error).toBeNull();
  });

  it('po minutom rozpočte sa čaká na obnovu stropu, nie celých 20 hodín', async () => {
    withKey();
    // Rozpočet sa obnoví o 6 hodín — 20-hodinový odstup by okno nechal
    // nedopočítané ešte 14 hodín po tom, čo sa už zase dalo čítať.
    const resumeAt = new Date(T0 + 6 * 60 * 60 * 1000);
    syncSales.mockResolvedValue(pausedSync(resumeAt));
    await runSalesSyncIfDue(T0);

    // Tesne pred obnovou sa ešte nečíta…
    expect((await runSalesSyncIfDue(resumeAt.getTime() - 1)).outcome).toBe('too_soon');
    // …a hneď po nej áno.
    syncSales.mockResolvedValue(OK_SYNC);
    expect((await runSalesSyncIfDue(resumeAt.getTime())).outcome).toBe('ran');
    expect(syncSales).toHaveBeenCalledTimes(2);
  });

  it('obnova v minulosti runner nezacyklí — platí podlaha `SALES_RESUME_MS`', async () => {
    withKey();
    syncSales.mockResolvedValue(pausedSync(new Date(T0 - 60 * 60 * 1000)));
    await runSalesSyncIfDue(T0);

    expect((await runSalesSyncIfDue(T0 + SALES_RESUME_MS - 1)).outcome).toBe('too_soon');
    expect((await runSalesSyncIfDue(T0 + SALES_RESUME_MS)).outcome).not.toBe('too_soon');
  });

  it('posledné rozhodnutie sa dá prečítať bez logov (C1)', async () => {
    expect(lastSalesRun()).toBeNull();

    loadForUse.mockResolvedValue(null);
    await runSalesSyncIfDue(T0);
    expect(lastSalesRun()?.outcome).toBe('no_orders_key');

    // Tlmený tick dôvod NEPREPÍŠE — inak by appka ukázala „ešte nie je čas"
    // namiesto toho, čo používateľ potrebuje vedieť.
    expect((await runSalesSyncIfDue(T0 + 1_000)).outcome).toBe('too_soon');
    expect(lastSalesRun()?.outcome).toBe('no_orders_key');
  });
});
