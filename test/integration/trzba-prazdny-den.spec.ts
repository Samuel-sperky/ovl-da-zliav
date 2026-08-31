/**
 * Aura Zľavy — „PREČÍTANÉ, NIČ SA NEPREDALO" verzus „NEČÍTANÉ, NEVIEME"
 * (KONTRAKT-V4-2026-08-28 §2b → D117; migrácia 0016; invarianty I6, I8', I11).
 *
 * Beží proti LOKÁLNEMU mocku objednávok (I6) a proti REÁLNEJ testovacej MariaDB.
 * Produkčný eshop sa nedotkne ani raz — a nesmie: k 28. 8. 2026 vracia
 * `{"error":"ip_banned"}` na všetko vrátane verejného čítania katalógu.
 *
 * ČO TU BOLO ZLE (a čo tento súbor stráži)
 * ----------------------------------------
 * `shop_revenue_daily` (0014) má menu V KĽÚČI, takže deň bez jedinej objednávky
 * žiadnu menu neprinesie a riadok NEDOSTANE. Čítacia strana ho preto videla ako
 * `missing`, teda „nevieme", hoci sme ho dočítali — appka nikdy nepovedala
 * „v tento deň sa nepredalo nič". Migrácia 0016 pridala PRÍZNAK PREČÍTANOSTI
 * DŇA (`shop_revenue_read_state`) oddelený od sumy a bez meny.
 *
 * Tri stavy, ktoré sa tu dokazujú, a to naraz nad jedným oknom:
 *   1. SUMA               — deň dočítaný, objednávky boli,
 *   2. PREČÍTANÁ NULA     — deň DOČÍTANÝ a objednávka v ňom NEBOLA (meraný fakt),
 *   3. NEVIEME            — o dni nie je ani riadok tržby, ani stav čítania.
 *
 * A štyri veci, ktoré sa tým NESMELI uvoľniť:
 *   · chýbajúci deň NEDOSTANE nulu ani vtedy, keď susedné dni prečítané sú,
 *   · ČIASTOČNE prečítaný deň bez objednávok zostáva „nevieme" (`≥ 0` je prázdna
 *     veta, nie priznanie nuly),
 *   · v `shop_revenue_daily` NEVZNIKNE nulový riadok s vymyslenou menou,
 *   · prečítaná nula sa neúplným čítaním nestratí (zápis nikdy nezhorší DB).
 *
 * Vlastník: sales-sync (V4, denná tržba — medzera prázdneho dňa).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DateOnly } from '@/contracts';

import {
  syncShopRevenue,
  type SalesReadBudgetGate,
  type SalesSyncFlags,
} from '@/lib/engine/sales-sync';
import { createSalesRepo, salesRepo } from '@/lib/repo/sales.repo';
import { createOrdersClient, type OrderTotalsClient } from '@/lib/shop/orders-client';
import type { ReadBudgetStatus, ReadReservation } from '@/lib/shop/read-budget';

import {
  createInsightsRevenueDailyGet,
  type RevenueDailyResponse,
} from '@/app/api/insights/revenue-daily/route';
import { resetRateLimiter } from '@/lib/http/define-route';

import { dbAvailable, setupTestDb, withMigrationConn } from '../helpers/db';
import {
  ORDERS_API_KEY,
  fakeSecretRef,
  order,
  startMockOrders,
  type MockOrder,
  type MockOrdersFailure,
  type MockOrdersServer,
} from '../helpers/mock-orders';

const available = await dbAvailable();

/*
 * Dni VÝHRADNE pre tento súbor — overené `grep -rho '2026-0[0-9]-[0-9][0-9]' test/`,
 * že ich nepoužíva žiadna iná sada. Tvrdenia tu hovoria o PRÍTOMNOSTI a ABSENCII
 * riadkov, takže cudzí riadok v tom istom dni by ich zhodil na cudzích dátach.
 */
const DAY_UNREAD: DateOnly = '2026-06-18';
const DAY_EMPTY: DateOnly = '2026-06-19';
const DAY_SOLD: DateOnly = '2026-06-20';

/**
 * Okno čítacej route smie byť len 7/30/90 (`windowQuery` — nepovolená hodnota je
 * 400, nie tichý fallback), takže route sa tu vždy pýta na SEDEM dní
 * `2026-06-14` … `2026-06-20`. Štyri dni pred trojicou vyššie sa nikdy nesťahujú
 * a zostávajú `unknown`; je to zámer — ticho v DB je nevedomosť, nie nula.
 */
const WEEK_FROM: readonly DateOnly[] = ['2026-06-14', '2026-06-15', '2026-06-16', '2026-06-17'];

/** Celé okno — po ňom sa upratuje a v ňom sa čítajú stavy. */
const ALL_DAYS: readonly DateOnly[] = [...WEEK_FROM, DAY_UNREAD, DAY_EMPTY, DAY_SOLD];
const WEEK_START: DateOnly = '2026-06-14';

/** Zóna shopu — tá istá hodnota ako `LOGIC_TIMEZONE` (D31). */
const SHOP_TIME_ZONE = 'Europe/Bratislava';

const OPEN_STATUS: ReadBudgetStatus = {
  lane: 'orders',
  day: DAY_SOLD,
  limit: 160,
  used: 0,
  remaining: 160,
  exhausted: false,
  resetAt: new Date('2026-06-21T00:00:00.000Z'),
  minuteLimit: 16,
  usedThisMinute: 0,
  known: true,
};

/** Rozpočet, ktorý dá vždy všetko — tu sa meria prázdny deň, nie strop (A4). */
function openBudget(): SalesReadBudgetGate {
  return {
    async reserveShopReads(count = 1): Promise<ReadReservation> {
      return { requested: count, granted: count, status: OPEN_STATUS };
    },
  };
}

function flags(overrides: Partial<SalesSyncFlags> = {}): SalesSyncFlags {
  return {
    enabled: true,
    windowDays: 1,
    maxRequestsPerRun: 1_000,
    pauseMs: 250,
    perPage: 100,
    ...overrides,
  };
}

/** Objednávka s vlastnou sumou; položky sú tu bez významu (D117). */
function paidOrder(id: number, dateAdd: string, totalPaid: number): MockOrder {
  return order(id, dateAdd, [{ id: 777, qty: 1 }], { total_paid: totalPaid, currency: 'EUR' });
}

async function cleanup(): Promise<void> {
  await withMigrationConn(async (conn) => {
    const days = ALL_DAYS.map(() => '?').join(', ');
    await conn.query(`DELETE FROM shop_revenue_daily WHERE revenue_day IN (${days})`, [...ALL_DAYS]);
    await conn.query(
      `DELETE FROM shop_revenue_read_state WHERE revenue_day IN (${days})`,
      [...ALL_DAYS],
    );
  });
}

let mock: MockOrdersServer;
let pauses: number[];

function clientFor(baseUrl: string): OrderTotalsClient {
  return createOrdersClient({
    baseUrl,
    // I10 — pauza sa v teste nikdy naozaj nečaká.
    sleepFn: async (ms) => {
      pauses.push(ms);
    },
  });
}

/** Beh tržby nad mockom. `today` je vpichnutý, takže NEFLAKUJE cez polnoc UTC. */
async function runRevenue(
  orders: MockOrder[],
  options: {
    windowDays?: number;
    force?: boolean;
    maxRequests?: number;
    perPage?: number;
    /** Trvalé zlyhanie shopu. Nastavuje sa PO `reset()`, ten ho inak zmaže. */
    fail?: MockOrdersFailure;
  } = {},
) {
  mock.state.reset().setOrders(orders);
  if (options.fail !== undefined) mock.state.always(options.fail);
  return syncShopRevenue(
    {
      ordersClient: clientFor(mock.baseUrl),
      key: fakeSecretRef(ORDERS_API_KEY),
      budget: openBudget(),
      salesRepo: createSalesRepo(),
      flags: flags({
        ...(options.maxRequests === undefined ? {} : { maxRequestsPerRun: options.maxRequests }),
        ...(options.perPage === undefined ? {} : { perPage: options.perPage }),
      }),
      timeZone: SHOP_TIME_ZONE,
      sleepFn: async () => {},
    },
    {
      today: DAY_SOLD,
      windowDays: options.windowDays ?? 3,
      ...(options.force === true ? { force: true } : {}),
    },
  );
}

/** Čítacia strana nad SKUTOČNOU DB — žiadny fake repozitár (K8: bez API). */
async function readRevenue(windowDays = 7): Promise<RevenueDailyResponse> {
  const handler = createInsightsRevenueDailyGet({ salesRepo });
  const response = await handler(
    new Request(
      `http://localhost:3070/api/insights/revenue-daily?anchor=${DAY_SOLD}&window=${windowDays}`,
      { method: 'GET' },
    ),
  );
  expect(response.status).toBe(200);
  // `defineRoute` obaľuje telo do `{ ok, data }` — bez rozbalenia by tvrdenia
  // porovnávali `undefined` s `undefined` a test by bol zelený bez merania.
  const parsed = (await response.json()) as { ok: boolean; data?: RevenueDailyResponse };
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  return parsed.data as RevenueDailyResponse;
}

async function stateRows(): Promise<
  Array<{ revenue_day: unknown; day_complete: number; orders_seen: number }>
> {
  return withMigrationConn(async (conn) =>
    (await conn.query(
      'SELECT revenue_day, day_complete, orders_seen FROM shop_revenue_read_state ' +
        'WHERE revenue_day >= ? AND revenue_day <= ? ORDER BY revenue_day',
      [WEEK_START, DAY_SOLD],
    )) as Array<{ revenue_day: unknown; day_complete: number; orders_seen: number }>,
  );
}

describe.skipIf(!available)('tržba — prečítaný prázdny deň nie je „nevieme" (0016)', () => {
  beforeAll(async () => {
    await setupTestDb();
    mock = await startMockOrders();
  });

  afterAll(async () => {
    await cleanup();
    await mock.close();
  });

  beforeEach(async () => {
    pauses = [];
    resetRateLimiter();
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('deň bez objednávok dostane STAV, ale žiadny riadok tržby (mena sa nevymyslí)', async () => {
    const result = await runRevenue([paidOrder(9601, `${DAY_SOLD} 11:00:00`, 12.34)]);
    expect(result.error).toBeNull();

    // Suma je len tam, kde objednávka naozaj bola.
    const revenue = await createSalesRepo().listRevenue(WEEK_START, DAY_SOLD);
    expect(revenue.map((row) => [row.day, row.currency, row.totalPaidSum])).toEqual([
      [DAY_SOLD, 'EUR', '12.34'],
    ]);

    // Stav má KAŽDÝ deň, ktorý sa čítal — vrátane tých dvoch prázdnych.
    const states = await stateRows();
    expect(states.map((row) => [String(row.day_complete), String(row.orders_seen)])).toEqual([
      ['1', '0'],
      ['1', '0'],
      ['1', '1'],
    ]);
    expect(states).toHaveLength(3);

    // A beh to hovorí aj vo svojom reporte.
    const empty = result.days.filter((row) => row.emptyDay).map((row) => row.day);
    expect(empty).toEqual([DAY_UNREAD, DAY_EMPTY]);
    expect(result.days.every((row) => row.stateWritten)).toBe(true);
  });

  it('tri stavy sa nad tým istým oknom dajú rozlíšiť (suma · prečítaná nula · nevieme)', async () => {
    /*
     * Okno 2 dni: prečíta sa DAY_EMPTY (bez objednávok) a DAY_SOLD (s jednou).
     * DAY_UNREAD zostane nečítaný, takže o ňom appka nemá vedieť NIČ.
     */
    await runRevenue([paidOrder(9602, `${DAY_SOLD} 09:30:00`, 40.00)], { windowDays: 2 });

    const data = await readRevenue();
    expect(data.dayStates.map((row) => [row.day, row.state])).toEqual([
      ...WEEK_FROM.map((day) => [day, 'unknown']),
      [DAY_UNREAD, 'unknown'],
      [DAY_EMPTY, 'empty'],
      [DAY_SOLD, 'measured'],
    ]);
    expect(data.missing).toEqual([...WEEK_FROM, DAY_UNREAD]);
    expect(data.emptyDays).toEqual([DAY_EMPTY]);
    expect(data.readDays).toBe(2);

    // Prečítaný prázdny deň sa NESMIE objaviť ako „nevieme" — to je celý fix.
    expect(data.missing).not.toContain(DAY_EMPTY);
    // Ani ako riadok s nulou. Suma je len tá, ktorú sme videli.
    expect(data.series[0]?.days.map((row) => row.day)).toEqual([DAY_SOLD]);
    expect(data.series[0]?.sum).toBe('40.00');
    // Deň s medzerou v okne drží súčet na dolnej hranici (I11).
    expect(data.series[0]?.sumState).toBe('lower_bound');
    expect(data.series[0]?.measuredZeroDays).toEqual([DAY_EMPTY]);
  });

  it('celé prečítané okno = MERANIE, aj keď väčšina dní bola prázdna', async () => {
    // Sedem dní čítania, jediná objednávka v poslednom dni.
    await runRevenue([paidOrder(9603, `${DAY_SOLD} 20:00:00`, 5.05)], { windowDays: 7 });

    const data = await readRevenue();
    expect(data.missing).toEqual([]);
    expect(data.emptyDays).toEqual([...WEEK_FROM, DAY_UNREAD, DAY_EMPTY]);
    expect(data.readDays).toBe(7);
    expect(data.hasGap).toBe(false);
    expect(data.series[0]?.sumState).toBe('measured');
    expect(data.series[0]?.sum).toBe('5.05');
    expect(data.series[0]?.missing).toEqual([]);
  });

  it('ČIASTOČNE prečítaný deň bez objednávok zostáva „nevieme" (≥ 0 nie je priznanie)', async () => {
    // Rozpočet na JEDEN request: prvý deň okna dostane stranu 1 a beh sa zastaví,
    // takže deň NIE JE dočítaný. Dve objednávky pri `perPage: 1` znamenajú, že
    // strana 2 by ešte existovala.
    const result = await runRevenue(
      [
        paidOrder(9604, `${DAY_UNREAD} 08:00:00`, 3.00),
        paidOrder(9605, `${DAY_UNREAD} 18:00:00`, 4.00),
      ],
      { windowDays: 3, maxRequests: 1, perPage: 1 },
    );
    expect(result.days[0]?.complete).toBe(false);
    expect(result.days[0]?.emptyDay).toBe(false);

    const states = await stateRows();
    expect(states).toHaveLength(1);
    expect(String(states[0]?.day_complete)).toBe('0');

    const data = await readRevenue();
    // Deň má riadok, ale nie je dočítaný → dolná hranica, nie meranie.
    expect(data.dayStates.map((row) => [row.day, row.state])).toEqual([
      ...WEEK_FROM.map((day) => [day, 'unknown']),
      [DAY_UNREAD, 'lower_bound'],
      [DAY_EMPTY, 'unknown'],
      [DAY_SOLD, 'unknown'],
    ]);
    // Nedočítaný deň sa NEPOČÍTA ako prečítaná nula pre inú menu.
    expect(data.emptyDays).toEqual([]);
    expect(data.series[0]?.sumState).toBe('lower_bound');
  });

  it('prečítaná nula prežije neúspešné dočítanie (zápis nikdy nezhorší DB)', async () => {
    await runRevenue([paidOrder(9606, `${DAY_SOLD} 10:00:00`, 1.00)], { windowDays: 7 });
    expect((await stateRows()).map((row) => String(row.day_complete))).toEqual(
      WEEK_FROM.map(() => '1').concat(['1', '1', '1']),
    );

    // Shop teraz odmieta všetko. Deň sa nečíta (`pagesRead = 0`), takže sa NIČ
    // nezapíše — a prečítaná nula zostane prečítanou nulou.
    const again = await runRevenue([paidOrder(9606, `${DAY_SOLD} 10:00:00`, 1.00)], {
      force: true,
      fail: 'server_error',
    });
    mock.state.always(null);
    expect(again.days.every((row) => row.stateWritten === false)).toBe(true);

    const data = await readRevenue();
    expect(data.emptyDays).toEqual([...WEEK_FROM, DAY_UNREAD, DAY_EMPTY]);
    expect(data.missing).toEqual([]);
  });

  it('dočítaný prázdny deň sa v ďalšom behu už NEČÍTA (P7, šetrí rozpočet)', async () => {
    await runRevenue([paidOrder(9607, `${DAY_SOLD} 12:00:00`, 2.00)], { windowDays: 3 });
    const firstRun = mock.state.listRequests().length;
    expect(firstRun).toBeGreaterThanOrEqual(3);

    /*
     * DAY_UNREAD je viac než dva dni pred „dnes"? Nie — okno má 3 dni, takže
     * DAY_UNREAD je predvčerom a P7 ho preskočiť SMIE. DAY_EMPTY je včera a
     * DAY_SOLD dnes, tie sa prepočítavajú vždy.
     */
    const second = await runRevenue([paidOrder(9607, `${DAY_SOLD} 12:00:00`, 2.00)], {
      windowDays: 3,
    });
    const skipped = second.days.filter((row) => row.skipped).map((row) => row.day);
    expect(skipped).toEqual([DAY_UNREAD]);
    // Bez 0016 by prázdny deň nemal ako byť „dočítaný" a čítal by sa každú noc.
    expect(mock.state.listRequests().length).toBeLessThan(firstRun);
  });

  it('v `shop_revenue_daily` nevznikne ani jeden nulový riadok pre prázdny deň', async () => {
    await runRevenue([paidOrder(9608, `${DAY_SOLD} 07:00:00`, 9.99)]);
    const rows = await withMigrationConn(async (conn) =>
      (await conn.query(
        'SELECT revenue_day, currency, total_paid_sum FROM shop_revenue_daily ' +
          'WHERE revenue_day >= ? AND revenue_day <= ?',
        [WEEK_START, DAY_SOLD],
      )) as Array<{ total_paid_sum: string }>,
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.total_paid_sum)).toBe('9.99');
  });
});
