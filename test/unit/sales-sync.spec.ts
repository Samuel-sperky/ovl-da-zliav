/**
 * Aura Zľavy — synchronizácia predajnosti (P6, P7, I1, I6, I8', I10).
 *
 * Beží proti LOKÁLNEMU mocku objednávok (I6) a proti in-memory repozitáru, teda
 * bez DB. Reálny eshop sa nikdy nedotkne.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DateOnly, LogFields, Logger } from '@/contracts';

import { salesSyncFlagsFromEnv, syncSales, type SalesSyncFlags } from '@/lib/engine/sales-sync';
import type {
  DailyUnitsRow,
  SalesSyncStateRecord,
  SalesSyncStateWrite,
} from '@/lib/repo/sales.repo';
import { createOrdersClient, type OrdersClient } from '@/lib/shop/orders-client';

import {
  NO_SCOPE_ORDERS_KEY,
  ORDERS_API_KEY,
  fakeSecretRef,
  order,
  startMockOrders,
  type MockOrdersServer,
} from '../helpers/mock-orders';

/* ─────────────────────── in-memory repozitár predajov ────────────────────── */

class FakeSalesRepo {
  /** `deň → (produkt → kusy)`. */
  readonly units = new Map<DateOnly, Map<number, number>>();
  readonly states = new Map<DateOnly, SalesSyncStateRecord>();
  /** Koľkokrát sa deň prepisoval — dôkaz, že upsert nie je inkrement naslepo. */
  readonly writes: DateOnly[] = [];

  async replaceDayUnits(day: DateOnly, rows: DailyUnitsRow[]): Promise<number> {
    this.writes.push(day);
    const bucket = new Map<number, number>();
    for (const row of rows) {
      if (row.day !== day) continue;
      bucket.set(row.productId, (bucket.get(row.productId) ?? 0) + row.units);
    }
    this.units.set(day, bucket);
    return bucket.size;
  }

  async getSyncState(day: DateOnly): Promise<SalesSyncStateRecord | null> {
    return this.states.get(day) ?? null;
  }

  async saveSyncState(day: DateOnly, state: SalesSyncStateWrite): Promise<void> {
    this.states.set(day, { day, ...state });
  }

  unitsFor(day: DateOnly): Record<number, number> {
    return Object.fromEntries(this.units.get(day) ?? new Map<number, number>());
  }
}

/* ─────────────────────────────── harness ─────────────────────────────────── */

interface CapturedLog {
  level: string;
  message: string;
  fields: LogFields;
}

function collectingLogger(sink: CapturedLog[]): Logger {
  const make = (base: LogFields): Logger => ({
    debug: (m, f) => sink.push({ level: 'debug', message: m, fields: { ...base, ...f } }),
    info: (m, f) => sink.push({ level: 'info', message: m, fields: { ...base, ...f } }),
    warn: (m, f) => sink.push({ level: 'warn', message: m, fields: { ...base, ...f } }),
    error: (m, f) => sink.push({ level: 'error', message: m, fields: { ...base, ...f } }),
    child: (f) => make({ ...base, ...f }),
  });
  return make({});
}

const TODAY: DateOnly = '2026-08-06';

/** 3-dňové okno: 4. 8. – 6. 8. 2026 (kontrakt P3). */
const ORDERS = [
  order(1, '2026-08-04 09:00:00', [{ id: 11, qty: 2 }]),
  order(2, '2026-08-04 18:00:00', [{ id: 11, qty: 1 }, { id: 12, qty: 3 }]),
  order(3, '2026-08-05 08:00:00', [{ id: 12, qty: 5 }]),
  order(4, '2026-08-06 07:00:00', [{ id: 11, qty: 4 }, { id: 13, qty: 1 }]),
  order(5, '2026-08-06 23:59:00', [{ id: 13, qty: 2 }]),
  // Mimo okna — nesmie sa dostať do žiadneho súčtu.
  order(6, '2026-07-01 10:00:00', [{ id: 99, qty: 50 }]),
];

let mock: MockOrdersServer;
let repo: FakeSalesRepo;
let logs: CapturedLog[];
let pauses: number[];
let client: OrdersClient;

function flags(overrides: Partial<SalesSyncFlags> = {}): SalesSyncFlags {
  return {
    enabled: true,
    windowDays: 3,
    maxRequestsPerRun: 1_500,
    pauseMs: 250,
    perPage: 100,
    ...overrides,
  };
}

function deps(
  overrides: { key?: () => Promise<{ value: Buffer; release(): void }> } = {},
): Parameters<typeof syncSales>[0] {
  return {
    ordersClient: client,
    key: overrides.key ?? fakeSecretRef(ORDERS_API_KEY),
    salesRepo: repo,
    logger: collectingLogger(logs),
    sleepFn: async (ms) => {
      pauses.push(ms);
    },
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    timeZone: 'Europe/Bratislava',
  };
}

beforeEach(async () => {
  mock = await startMockOrders({ orders: ORDERS });
  repo = new FakeSalesRepo();
  logs = [];
  pauses = [];
  client = createOrdersClient({
    baseUrl: mock.baseUrl,
    logger: collectingLogger(logs),
    sleepFn: async (ms) => {
      pauses.push(ms);
    },
  });
});

afterEach(async () => {
  await mock.close();
});

/* ─────────────────────────────── testy ───────────────────────────────────── */

describe('sales-sync — okno a súčty kusov', () => {
  it('sčíta kusy po produkte a dni za celé okno', async () => {
    const result = await syncSales({ ...deps(), flags: flags() }, { today: TODAY });

    expect(result.outcome).toBe('complete');
    expect(result.capReached).toBe(false);
    expect(result.error).toBeNull();
    expect(result.windowFrom).toBe('2026-08-04');
    expect(result.windowTo).toBe('2026-08-06');
    expect(result.days.map((d) => d.day)).toEqual(['2026-08-04', '2026-08-05', '2026-08-06']);

    expect(repo.unitsFor('2026-08-04')).toEqual({ 11: 3, 12: 3 });
    expect(repo.unitsFor('2026-08-05')).toEqual({ 12: 5 });
    expect(repo.unitsFor('2026-08-06')).toEqual({ 11: 4, 13: 3 });

    // Objednávka z 1. 7. je mimo okna — nikde sa neobjaví.
    expect(repo.unitsFor('2026-07-01')).toEqual({});
    for (const day of repo.units.keys()) expect(day >= '2026-08-04').toBe(true);
  });

  it('stránkuje zoznam (per_page 100) a nevynechá ani jednu objednávku', async () => {
    // 250 objednávok jedného dňa = 3 strany zoznamu + 250 detailov.
    const many = Array.from({ length: 250 }, (_, i) =>
      order(1_000 + i, '2026-08-06 10:00:00', [{ id: 7, qty: 1 }]),
    );
    mock.state.setOrders(many);

    const result = await syncSales({ ...deps(), flags: flags({ windowDays: 1 }) }, { today: TODAY });

    expect(result.outcome).toBe('complete');
    expect(repo.unitsFor('2026-08-06')).toEqual({ 7: 250 });
    expect(mock.state.listRequests()).toHaveLength(3);
    expect(mock.state.detailRequests()).toHaveLength(250);
    expect(mock.state.listRequests().map((r) => r.query.per_page)).toEqual(['100', '100', '100']);
    expect(result.requestsUsed).toBe(253);
  });

  it('deň sa počíta v `Europe/Bratislava`, nie v UTC', async () => {
    // 22:30 UTC = 00:30 nasledujúceho dňa v Bratislave (letný čas, +2).
    const result = await syncSales(
      {
        ...deps(),
        flags: flags({ windowDays: 1 }),
        now: () => new Date('2026-08-05T22:30:00.000Z'),
      },
      {},
    );
    expect(result.windowTo).toBe('2026-08-06');
  });

  it('sekvenčné tempo (I10) — medzi requestami je pauza `ORDERS_PAUSE_MS`', async () => {
    await syncSales({ ...deps(), flags: flags({ windowDays: 1, pauseMs: 250 }) }, { today: TODAY });
    // 1 strana + 2 detaily = 3 requesty → 2 pauzy (pred prvým sa nečaká).
    expect(pauses).toEqual([250, 250]);
  });

  it('vypnutá synchronizácia neodošle nič', async () => {
    const result = await syncSales({ ...deps(), flags: flags({ enabled: false }) }, { today: TODAY });
    expect(result.outcome).toBe('disabled');
    expect(mock.state.requestCount).toBe(0);
    expect(repo.writes).toEqual([]);
  });
});

describe('sales-sync — idempotencia (P7)', () => {
  it('opakovaný beh nezdvojnásobí čísla', async () => {
    await syncSales({ ...deps(), flags: flags() }, { today: TODAY });
    const first = {
      d4: repo.unitsFor('2026-08-04'),
      d5: repo.unitsFor('2026-08-05'),
      d6: repo.unitsFor('2026-08-06'),
    };

    await syncSales({ ...deps(), flags: flags() }, { today: TODAY });

    expect(repo.unitsFor('2026-08-04')).toEqual(first.d4);
    expect(repo.unitsFor('2026-08-05')).toEqual(first.d5);
    expect(repo.unitsFor('2026-08-06')).toEqual(first.d6);
  });

  it('uzavretý deň v minulosti sa druhý raz nesťahuje, dnes a včera vždy', async () => {
    await syncSales({ ...deps(), flags: flags() }, { today: TODAY });
    mock.state.reset();

    const second = await syncSales({ ...deps(), flags: flags() }, { today: TODAY });

    const statuses = Object.fromEntries(second.days.map((d) => [d.day, d.status]));
    expect(statuses['2026-08-04']).toBe('skipped'); // uzavretý (starší než včera)
    expect(statuses['2026-08-05']).toBe('complete'); // včera — prepočítava sa vždy
    expect(statuses['2026-08-06']).toBe('complete'); // dnes — prepočítava sa vždy

    // Zoznam sa v druhom behu ťahal len pre dva dni.
    expect(mock.state.listRequests().map((r) => r.query.date_from)).toEqual([
      '2026-08-05',
      '2026-08-06',
    ]);
  });

  it('`force` prepočíta aj uzavretý deň', async () => {
    await syncSales({ ...deps(), flags: flags() }, { today: TODAY });
    mock.state.reset();

    const second = await syncSales({ ...deps(), flags: flags() }, { today: TODAY, force: true });
    expect(second.days.every((d) => d.status === 'complete')).toBe(true);
    expect(mock.state.listRequests()).toHaveLength(3);
  });

  it('nová objednávka v dnešnom dni sa dopočíta pri ďalšom behu', async () => {
    await syncSales({ ...deps(), flags: flags() }, { today: TODAY });
    expect(repo.unitsFor('2026-08-06')).toEqual({ 11: 4, 13: 3 });

    mock.state.orders.set(7, order(7, '2026-08-06 12:00:00', [{ id: 11, qty: 10 }]));
    await syncSales({ ...deps(), flags: flags() }, { today: TODAY });

    expect(repo.unitsFor('2026-08-06')).toEqual({ 11: 14, 13: 3 });
  });
});

describe('sales-sync — fail-soft (P6)', () => {
  it('strop requestov: uloží pokrok, ohlási to a NEHODÍ výnimku', async () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      order(2_000 + i, '2026-08-06 10:00:00', [{ id: 7, qty: 1 }]),
    );
    mock.state.setOrders(many);

    const result = await syncSales(
      { ...deps(), flags: flags({ windowDays: 1, maxRequestsPerRun: 11 }) },
      { today: TODAY },
    );

    expect(result.capReached).toBe(true);
    expect(result.outcome).toBe('partial');
    expect(result.error).toBeNull(); // strop nie je chyba
    expect(result.requestsUsed).toBe(11);
    expect(mock.state.requestCount).toBe(11);

    // Pokrok je uložený: 3 strany zoznamu + 8 detailov = 8 objednávok.
    const state = await repo.getSyncState('2026-08-06');
    expect(state?.status).toBe('partial');
    expect(state?.ordersSeen).toBe(8);
    expect(state?.requestsUsed).toBe(11);
    expect(repo.unitsFor('2026-08-06')).toEqual({ 7: 8 });

    // A beh to ohlásil.
    expect(logs.some((l) => l.message === 'sales_sync_request_cap_reached')).toBe(true);
  });

  it('po strope ďalší beh dopočíta zvyšok', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      order(3_000 + i, '2026-08-06 10:00:00', [{ id: 7, qty: 1 }]),
    );
    mock.state.setOrders(many);
    const runFlags = flags({ windowDays: 1, maxRequestsPerRun: 6 });

    const first = await syncSales({ ...deps(), flags: runFlags }, { today: TODAY });
    expect(first.capReached).toBe(true);
    expect(repo.unitsFor('2026-08-06')).toEqual({ 7: 5 });

    const second = await syncSales(
      { ...deps(), flags: flags({ windowDays: 1, maxRequestsPerRun: 1_500 }) },
      { today: TODAY },
    );
    expect(second.capReached).toBe(false);
    expect(second.outcome).toBe('complete');
    expect(repo.unitsFor('2026-08-06')).toEqual({ 7: 20 });
  });

  it('neúplný prepočet už uzavretého dňa nezhorší uložené čísla', async () => {
    await syncSales({ ...deps(), flags: flags({ windowDays: 1 }) }, { today: TODAY });
    expect(repo.unitsFor('2026-08-06')).toEqual({ 11: 4, 13: 3 });

    // Druhý beh narazí na strop hneď po prvej strane zoznamu.
    const second = await syncSales(
      { ...deps(), flags: flags({ windowDays: 1, maxRequestsPerRun: 1 }) },
      { today: TODAY },
    );

    expect(second.capReached).toBe(true);
    expect(second.days[0].written).toBe(false);
    expect(repo.unitsFor('2026-08-06')).toEqual({ 11: 4, 13: 3 });
  });

  it('`forbidden` beh ukončí kódom chyby, nikdy výnimkou (a nepovažuje sa za sieťovú chybu)', async () => {
    const result = await syncSales(
      { ...deps({ key: fakeSecretRef(NO_SCOPE_ORDERS_KEY) }), flags: flags() },
      { today: TODAY },
    );

    expect(result.outcome).toBe('partial');
    expect(result.error).toBe('forbidden');
    // Terminal chyba sa neopakuje: presne jeden request, žiadny backoff.
    expect(mock.state.requestCount).toBe(1);
    expect(pauses).toEqual([]);

    const state = await repo.getSyncState('2026-08-04');
    expect(state?.status).toBe('partial');
    expect(state?.lastError).toBe('forbidden');
  });

  it('trvalý `rate_limited` beh ukončí fail-soft s kódom, po backoffe', async () => {
    mock.state.always('rate_limited');

    const result = await syncSales({ ...deps(), flags: flags() }, { today: TODAY });

    expect(result.outcome).toBe('partial');
    expect(result.error).toBe('rate_limited');
    expect(mock.state.requestCount).toBe(3); // 3 pokusy jedného requestu
    expect(pauses.filter((ms) => ms >= 5_000)).toEqual([5_000, 20_000]);
    expect((await repo.getSyncState('2026-08-04'))?.lastError).toBe('rate_limited');
  });

  it('objednávka, ktorá medzitým zmizla, deň nezhodí — len ho zneúplní', async () => {
    mock.state.setOrders([
      order(10, '2026-08-06 09:00:00', [{ id: 11, qty: 2 }]),
      order(11, '2026-08-06 10:00:00', [{ id: 12, qty: 4 }]),
    ]);
    // Detail #11 sa medzi zoznamom a detailom „stratí".
    const shrinking = createOrdersClient({
      baseUrl: mock.baseUrl,
      logger: collectingLogger(logs),
      sleepFn: async () => {},
    });
    const result = await syncSales(
      {
        ...deps(),
        ordersClient: {
          listOrders: (params, key, ctx) => shrinking.listOrders(params, key, ctx),
          getOrderUnits: (id, key, ctx) => {
            if (id === 11) mock.state.orders.delete(11);
            return shrinking.getOrderUnits(id, key, ctx);
          },
        },
        flags: flags({ windowDays: 1 }),
      },
      { today: TODAY },
    );

    expect(result.outcome).toBe('partial');
    expect(result.error).toBeNull(); // beh dobehol
    expect(result.days[0].lastError).toBe('not found');
    expect(repo.unitsFor('2026-08-06')).toEqual({ 11: 2 });
  });

  it('chyba repozitára beh nezhodí — vráti kód a nechá scheduler žiť', async () => {
    const brokenRepo = {
      replaceDayUnits: async (): Promise<number> => {
        throw new Error('DbError');
      },
      getSyncState: async (): Promise<null> => null,
      saveSyncState: async (): Promise<void> => {},
    };
    const result = await syncSales(
      { ...deps(), salesRepo: brokenRepo, flags: flags({ windowDays: 1 }) },
      { today: TODAY },
    );
    expect(result.outcome).toBe('partial');
    expect(result.error).toBe('local_Error');
  });
});

describe('sales-sync — kľúč a stav (I1)', () => {
  it('kľúč sa neobjaví v žiadnom logu ani vo výsledku', async () => {
    const result = await syncSales({ ...deps(), flags: flags() }, { today: TODAY });

    const haystacks = [JSON.stringify(logs), JSON.stringify(result), JSON.stringify([...repo.states])];
    for (const haystack of haystacks) {
      expect(haystack).not.toContain(ORDERS_API_KEY);
      expect(haystack).not.toContain(ORDERS_API_KEY.slice(-8));
    }
    // Kľúč pritom do shopu naozaj odišiel — inak by test nič nedokazoval.
    expect(mock.state.seenApiKeys()).toEqual([ORDERS_API_KEY]);
  });

  it('do stavu ani do výsledku sa nedostane id objednávky, krajina ani suma', async () => {
    const result = await syncSales({ ...deps(), flags: flags() }, { today: TODAY });
    const serialized = JSON.stringify({ result, states: [...repo.states], units: [...repo.units] });
    for (const forbidden of ['total_paid', 'country', 'country_iso', 'Slovakia']) {
      expect(serialized).not.toContain(forbidden);
    }
    // `orders_seen` je POČET, nie odkaz na objednávku.
    expect((await repo.getSyncState('2026-08-04'))?.ordersSeen).toBe(2);
  });

  it('`salesSyncFlagsFromEnv()` drží kontraktné defaulty', () => {
    const fromEnv = salesSyncFlagsFromEnv();
    expect(fromEnv.windowDays).toBe(3);
    expect(fromEnv.maxRequestsPerRun).toBe(1_500);
    expect(fromEnv.pauseMs).toBe(250);
    expect(fromEnv.perPage).toBe(100);
  });
});

/* ═══════ „nikdy nezhorš dáta" a poctivá paginácia (review 6. 8. 2026) ══════ */

describe('sales-sync — neúplný beh nesmie zhoršiť už uložený deň', () => {
  it('prerušený beh NEPREPÍŠE deň, ktorý mal predtým viac spracovaných objednávok', async () => {
    // 1. beh: detail objednávky 5 spadne na 500 → deň je `partial`, ale kusy
    //    z objednávky 4 sú uložené a `ordersSeen` je 1.
    mock.state.failDetailFor = 5;
    const first = await syncSales({ ...deps(), flags: flags({ windowDays: 1 }) }, { today: TODAY });
    expect(first.days[0]?.status).toBe('partial');
    const savedUnits = repo.unitsFor('2026-08-06');
    expect(savedUnits).toEqual({ 11: 4, 13: 1 });
    expect((await repo.getSyncState('2026-08-06'))?.ordersSeen).toBe(1);

    // 2. beh: shop odpovedá už len `rate_limited`, takže sa nespracuje ANI JEDNA
    //    objednávka. Absolútny prepis by deň vymazal a UI by tvrdilo „0 kusov" —
    //    to je nesprávne dáta, nie fail-soft.
    mock.state.reset().always('rate_limited');
    const second = await syncSales({ ...deps(), flags: flags({ windowDays: 1 }) }, { today: TODAY });

    expect(second.days[0]?.status).toBe('partial');
    expect(second.days[0]?.written).toBe(false);
    expect(repo.unitsFor('2026-08-06')).toEqual(savedUnits);
  });

  it('lepší beh deň prepísať SMIE — ochrana nesmie dáta zamrznúť', async () => {
    mock.state.failDetailFor = 5;
    await syncSales({ ...deps(), flags: flags({ windowDays: 1 }) }, { today: TODAY });

    mock.state.reset();
    const second = await syncSales({ ...deps(), flags: flags({ windowDays: 1 }) }, { today: TODAY });

    expect(second.days[0]?.status).toBe('complete');
    expect(second.days[0]?.written).toBe(true);
    expect(repo.unitsFor('2026-08-06')).toEqual({ 11: 4, 13: 3 });
  });
});

describe('sales-sync — paginácia verí odpovedi, nie svojmu prianiu', () => {
  it('shop, ktorý `per_page` zmenší, nesmie spôsobiť tichú stratu objednávok', async () => {
    // Appka pýta 100 na stranu, shop dovolí len 5. Keby sa strany počítali
    // podľa PÝTANEJ hodnoty, po prvej strane by `1 × 100 >= 12` ukončilo
    // čítanie a deň by sa uzavrel ako `complete` so 7 chýbajúcimi objednávkami.
    const small = await startMockOrders({
      maxPerPage: 5,
      orders: Array.from({ length: 12 }, (_, i) =>
        order(2_000 + i, '2026-08-06 10:00:00', [{ id: 7, qty: 1 }]),
      ),
    });
    try {
      const smallClient = createOrdersClient({
        baseUrl: small.baseUrl,
        logger: collectingLogger(logs),
        sleepFn: async (ms) => {
          pauses.push(ms);
        },
      });
      const result = await syncSales(
        { ...deps(), ordersClient: smallClient, flags: flags({ windowDays: 1 }) },
        { today: TODAY },
      );

      expect(result.days[0]?.status).toBe('complete');
      expect(repo.unitsFor('2026-08-06')).toEqual({ 7: 12 });
      expect(small.state.detailRequests()).toHaveLength(12);
    } finally {
      await small.close();
    }
  });
});
