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
const getMeta = vi.fn<() => Promise<{ savedAt: Date | null }>>();
const syncSales = vi.fn();
const reserve = vi.fn();
const latestSyncStop =
  vi.fn<() => Promise<{ code: string | null; at: Date | null; since: Date | null }>>();

vi.mock('@/lib/repo/api-key.repo', () => ({
  ordersKeyRepo: { loadForUse: () => loadForUse(), getMeta: () => getMeta() },
}));

vi.mock('@/lib/engine/sales-sync', () => ({
  syncSales: (...args: unknown[]) => syncSales(...args),
  // Runner si pre overovaciu požiadavku skladá vlastné nastavenia — mock musí
  // dodať aj tento kus, inak by test testoval iný kód než produkcia.
  salesSyncFlagsFromEnv: () => ({
    enabled: true,
    windowDays: 3,
    maxRequestsPerRun: 1500,
    pauseMs: 250,
    perPage: 100,
  }),
}));

// Trvalá prekážka sa číta z DB (`sales_sync_state`). Mock drží test bez
// kontajnera; dôležité je, ČO runner s prečítaným faktom urobí.
vi.mock('@/lib/sales/insights', () => ({
  latestSyncStop: () => latestSyncStop(),
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
  SALES_BLOCK_RECHECK_MS,
  SALES_MIN_INTERVAL_MS,
  SALES_NO_KEY_RETRY_MS,
  SALES_RESUME_MS,
} = await import('@/lib/sales/sync-runner');

const { IP_BAN_MIN_WAIT_MS } = await import('@/lib/sales/stop-policy');

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

/** Beh, ktorý shop odmietol trvalou chybou (401/403, zablokovaná IP). */
function blockedSync(code: string) {
  return { ...OK_SYNC, outcome: 'partial', stoppedBy: 'error', error: code };
}

beforeEach(() => {
  resetSalesRunnerState();
  loadForUse.mockReset();
  getMeta.mockReset();
  getMeta.mockResolvedValue({ savedAt: null });
  syncSales.mockReset();
  syncSales.mockResolvedValue(OK_SYNC);
  reserve.mockReset();
  reserve.mockResolvedValue({ requested: 1, granted: 1, status: { remaining: 159 } });
  latestSyncStop.mockReset();
  latestSyncStop.mockResolvedValue({ code: null, at: null, since: null });
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

/**
 * Regres z 24. 8. 2026. `sales_sync_state` má dvanásť riadkov (7. 8. – 18. 8.)
 * so `status='partial'`, `orders_seen=0`, `requests_used=1` a `last_error`
 * `forbidden` — dvanásť dní po sebe tá istá odmietnutá požiadavka. Od 19. 8.
 * shop na tú istú cestu odpovedá kódom `ip_banned`.
 *
 * Testuje sa jediná vec, ktorú appka na tom vie zmeniť: že sa trvalá prekážka
 * neopakuje na rozvrhu a že sa z nej dá dostať.
 */
describe('sync-runner — trvalá prekážka sa neopakuje na rozvrhu', () => {
  it('403 zastaví rozvrh: žiadny beh, dôvod a krok pre človeka', async () => {
    withKey();
    latestSyncStop.mockResolvedValue({
      code: 'forbidden',
      at: new Date(T0 - 20 * 60 * 60 * 1000),
      since: new Date(T0 - 12 * 24 * 60 * 60 * 1000),
    });

    const report = await runSalesSyncIfDue(T0);

    expect(report.outcome).toBe('blocked');
    expect(syncSales).not.toHaveBeenCalled();
    expect(report.block?.kind).toBe('permission');
    // Bez oprávnenia sa NESKÚŠA. Termín ďalšieho pokusu neexistuje — a to je
    // celý rozdiel oproti stavu, ktorý vyrobil dvanásť riadkov v DB.
    expect(report.block?.probeAt).toBeNull();
    expect(report.block?.what.length).toBeGreaterThan(0);
    expect(report.block?.nextStep.length).toBeGreaterThan(0);
  });

  it('prekážka prežije reštart appky — číta sa z DB, nie z pamäte', async () => {
    withKey();
    latestSyncStop.mockResolvedValue({
      code: 'forbidden',
      at: new Date(T0 - 20 * 60 * 60 * 1000),
      since: new Date(T0 - 20 * 60 * 60 * 1000),
    });

    await runSalesSyncIfDue(T0);
    // Reštart: pamäť runnera je čistá, ako po každom zapnutí počítača.
    resetSalesRunnerState();
    const afterBoot = await runSalesSyncIfDue(T0 + 1_000);

    expect(afterBoot.outcome).toBe('blocked');
    expect(syncSales).not.toHaveBeenCalled();
  });

  it('počas prekážky sa do shopu nechodí, len sa raz za pár minút pozrie do DB', async () => {
    withKey();
    latestSyncStop.mockResolvedValue({
      code: 'forbidden',
      at: new Date(T0),
      since: new Date(T0),
    });

    await runSalesSyncIfDue(T0);
    expect((await runSalesSyncIfDue(T0 + SALES_BLOCK_RECHECK_MS - 1)).outcome).toBe('too_soon');
    expect((await runSalesSyncIfDue(T0 + SALES_BLOCK_RECHECK_MS)).outcome).toBe('blocked');
    expect(syncSales).not.toHaveBeenCalled();
  });

  it('nový objednávkový kľúč prekážku uvoľní — inak by to bola slepá ulička', async () => {
    withKey();
    latestSyncStop.mockResolvedValue({
      code: 'forbidden',
      at: new Date(T0 - 60 * 60 * 1000),
      since: new Date(T0 - 60 * 60 * 1000),
    });
    getMeta.mockResolvedValue({ savedAt: new Date(T0 - 60_000) });

    const report = await runSalesSyncIfDue(T0);

    expect(report.outcome).toBe('ran');
    expect(syncSales).toHaveBeenCalledTimes(1);
  });

  it('beh, ktorý skončí na 403, sa neplánuje na 20 hodín ako predtým', async () => {
    withKey();
    syncSales.mockResolvedValue(blockedSync('forbidden'));
    latestSyncStop
      .mockResolvedValueOnce({ code: null, at: null, since: null })
      .mockResolvedValue({ code: 'forbidden', at: new Date(T0), since: new Date(T0) });

    const first = await runSalesSyncIfDue(T0);
    expect(first.outcome).toBe('blocked');
    expect(first.block?.kind).toBe('permission');

    // Presne tu sa to dvanásť dní kazilo: nasledujúci deň sa poslala tá istá
    // odmietnutá požiadavka. Teraz sa nepošle ani po dvadsiatich hodinách.
    expect((await runSalesSyncIfDue(T0 + SALES_MIN_INTERVAL_MS)).outcome).toBe('blocked');
    expect(syncSales).toHaveBeenCalledTimes(1);
  });

  it('zablokovaná IP: appka sa ozve jednou požiadavkou a až po šiestich hodinách', async () => {
    withKey();
    latestSyncStop.mockResolvedValue({
      code: 'ip_banned',
      at: new Date(T0),
      since: new Date(T0),
    });

    const blocked = await runSalesSyncIfDue(T0);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.block?.kind).toBe('ip_ban');
    expect(blocked.block?.probeAt?.getTime()).toBe(T0 + IP_BAN_MIN_WAIT_MS);

    // Tesne pred termínom sa nič nedeje — ani request, ani dotaz do DB.
    expect((await runSalesSyncIfDue(T0 + IP_BAN_MIN_WAIT_MS - 1)).outcome).toBe('too_soon');
    expect(syncSales).not.toHaveBeenCalled();
    // Tlmený tick dôvod NEPREPÍŠE: appka stále vie povedať, na čom stojí.
    expect(lastSalesRun()?.block?.kind).toBe('ip_ban');

    // …a v termíne ide JEDNA požiadavka za JEDEN deň, nie celé okno.
    const probe = await runSalesSyncIfDue(T0 + IP_BAN_MIN_WAIT_MS);
    expect(probe.outcome).toBe('ran');
    const flags = (syncSales.mock.calls[0]?.[0] as { flags?: { windowDays: number; maxRequestsPerRun: number } })
      .flags;
    expect(flags).toEqual(expect.objectContaining({ windowDays: 1, maxRequestsPerRun: 1 }));
  });

  it('odstup po zablokovanej IP rastie s tým, ako dlho prekážka stojí', async () => {
    withKey();
    const since = new Date(T0 - 48 * 60 * 60 * 1000);
    latestSyncStop.mockResolvedValue({ code: 'ip_banned', at: new Date(T0), since });

    const report = await runSalesSyncIfDue(T0);

    // Dva dni stojaca blokáda si vypýta dvojdňové ticho, nie šesťhodinové.
    expect(report.block?.probeAt?.getTime()).toBe(T0 + 48 * 60 * 60 * 1000);
  });

  it('bežná chyba behu (429, sieť) rozvrh nemení — opakovanie ju vylieči', async () => {
    withKey();
    syncSales.mockResolvedValue(blockedSync('rate_limited'));

    const report = await runSalesSyncIfDue(T0);

    expect(report.outcome).toBe('ran');
    expect((await runSalesSyncIfDue(T0 + SALES_MIN_INTERVAL_MS - 1)).outcome).toBe('too_soon');
  });
});
