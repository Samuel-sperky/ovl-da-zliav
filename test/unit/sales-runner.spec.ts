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

vi.mock('@/lib/repo/api-key.repo', () => ({
  ordersKeyRepo: { loadForUse: () => loadForUse() },
}));

vi.mock('@/lib/engine/sales-sync', () => ({
  syncSales: (...args: unknown[]) => syncSales(...args),
}));

const {
  runSalesSyncIfDue,
  resetSalesRunnerState,
  SALES_MIN_INTERVAL_MS,
  SALES_NO_KEY_RETRY_MS,
} = await import('@/lib/sales/sync-runner');

const OK_SYNC = {
  outcome: 'complete',
  windowFrom: '2026-08-04',
  windowTo: '2026-08-06',
  days: [],
  requestsUsed: 3,
  capReached: false,
  error: null,
};

const T0 = 1_760_000_000_000;

beforeEach(() => {
  resetSalesRunnerState();
  loadForUse.mockReset();
  syncSales.mockReset();
  syncSales.mockResolvedValue(OK_SYNC);
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
