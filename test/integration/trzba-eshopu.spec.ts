/**
 * Aura Zľavy — DENNÁ TRŽBA ESHOPU (KONTRAKT-V4-2026-08-28 §2b, D117; I6, I8', I11).
 *
 * Beží proti LOKÁLNEMU mocku objednávok (I6) a proti REÁLNEJ testovacej MariaDB.
 * Produkčný eshop sa nedotkne ani raz — a nesmie: k 28. 8. 2026 vracia
 * `{"error":"ip_banned"}` na všetko vrátane verejného čítania katalógu.
 *
 * Čo sa tu dokazuje:
 *  1. Denná suma `total_paid` a POČET objednávok sa spočítajú správne zo
 *     STRÁNKOVANÝCH odpovedí a v DB skončia ako `DECIMAL(12,2)` znak za znakom.
 *  2. `order/get` sa NEZAVOLÁ ANI RAZ (D117: tržba je zo zoznamu, nie z detailu)
 *     a `product_sales_daily` zostane nedotknutá — tržba NIE JE per produkt.
 *  3. Čiastočný deň je označený `day_complete = 0` a po dotiahnutí zvyšku sa
 *     preklopí na `1` BEZ duplikácie riadku a bez zdvojenia sumy.
 *  4. `ip_banned` beh zastaví, dôvod je v návratovej hodnote aj v logu, a deň
 *     zostane BEZ RIADKU — teda „nevieme", nikdy nula (I11).
 *  5. Prerušenie a pokračovanie riadky nezduplikuje (PK je `(deň, mena)`).
 *  6. Objednávka za polnocou padne do správneho dňa v zóne shopu — test má
 *     `now` vpichnutý, takže NEFLAKUJE medzi 22:00 a 24:00 UTC.
 *  7. Dve meny = dva riadky; súčet mien do jedného čísla NIKDE nevznikne.
 *  8. Nečitateľná suma je `schema_drift` (stav neistý), nie ticho nižšia tržba.
 *  9. Neúplné čítanie NEPREPÍŠE deň, ktorý už bol dočítaný.
 *
 * ČO TENTO SÚBOR ZÁMERNE NETVRDÍ
 * ------------------------------
 * Že sa dôvod zastavenia (`ip_banned`) uloží do DB. Neuloží sa — beh tržby do
 * `sales_sync_state` NEZAPISUJE, pretože je to iný fakt (dočítaný ZOZNAM verzus
 * dočítané POLOŽKY, migrácia 0014 §3). Prekážku do DB zapíše cesta na KUSY,
 * ktorá beží v tom istom ticku (`lib/sales/sync-runner.ts`), a runner si ju
 * odtiaľ po reštarte prečíta. Tu sa preto overuje návratová hodnota a log.
 *
 * OTVORENÁ KOLÍZIA S GUARDOM I8' (28. 8. 2026) — NEZATVORENÁ TÝMTO SÚBOROM
 * ------------------------------------------------------------------------
 * `test/unit/no-orders-scope.spec.ts` (vlastník A17) je červený kvôli piatim
 * identifikátorom v migrácii 0014 (`total_paid_sum`, `orders_count`,
 * `last_time_in_order`, `qty_in_orders`, `ix_catalog_last_order`). Je to nález
 * vlny SCHÉMA, nie tejto — a platí to isté odôvodnenie: ide o DENNÉ SÚČTY ZA
 * CELÝ ESHOP, nie o riadky objednávok. Guard má na to `ALLOWED_DDL_IDENTIFIERS`.
 *
 * Vlastník: sales-sync (V4, denná tržba).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DateOnly, LogFields, Logger } from '@/contracts';

import {
  SHOP_REVENUE_WINDOW_DAYS,
  syncShopRevenue,
  type SalesReadBudgetGate,
  type SalesSyncFlags,
} from '@/lib/engine/sales-sync';
import { createSalesRepo } from '@/lib/repo/sales.repo';
import { classifySalesStop } from '@/lib/sales/stop-policy';
import { todayInTimeZone } from '@/lib/shop/client';
import {
  centsToMoneyString,
  createOrdersClient,
  moneyToCents,
  type OrderTotalsClient,
} from '@/lib/shop/orders-client';
import type { ReadBudgetStatus, ReadReservation } from '@/lib/shop/read-budget';

import { dbAvailable, setupTestDb, withAppConn, withMigrationConn } from '../helpers/db';
import { ORDERS_API_KEY, fakeSecretRef, order, startMockOrders, type MockOrder, type MockOrdersServer } from '../helpers/mock-orders';

const available = await dbAvailable();

/* ═════════════ dni mimo dosahu ostatných testov (upratuje sa sám) ═════════ */

const DAY_PAGED: DateOnly = '2026-05-04';
const DAY_PARTIAL: DateOnly = '2026-05-05';
/**
 * Trojica dní VÝHRADNE pre test zabanovanej IP. Musia byť vlastné: test tvrdí,
 * že po `ip_banned` NEEXISTUJE ani jeden riadok, a keby okno zachádzalo do dní
 * iných testov, tvrdenie by padalo na ich dátach namiesto na tom, čo meria.
 */
const DAY_BANNED_FROM: DateOnly = '2026-05-25';
const DAY_BANNED_MID: DateOnly = '2026-05-26';
const DAY_BANNED: DateOnly = '2026-05-27';
const DAY_CURRENCIES: DateOnly = '2026-05-07';
const DAY_DRIFT: DateOnly = '2026-05-08';
/** Polnočná dvojica — deň pred a deň po polnoci v zóne shopu. */
const DAY_BEFORE_MIDNIGHT: DateOnly = '2026-05-14';
const DAY_AFTER_MIDNIGHT: DateOnly = '2026-05-15';

const ALL_DAYS: readonly DateOnly[] = [
  DAY_PAGED,
  DAY_PARTIAL,
  DAY_BANNED_FROM,
  DAY_BANNED_MID,
  DAY_BANNED,
  DAY_CURRENCIES,
  DAY_DRIFT,
  DAY_BEFORE_MIDNIGHT,
  DAY_AFTER_MIDNIGHT,
];

/**
 * Zóna shopu. Je to tá istá hodnota ako `LOGIC_TIMEZONE` (D31) a je tu napísaná
 * NAHLAS, pretože dokumentácia shopu zónu `date_add` NIKDE nemenuje — appka
 * berie dátumovú časť reťazca tak, ako prišla, a „dnes" počíta v tejto zóne.
 * Test to preto nemôže overiť oproti dokumentácii, len oproti vlastnému
 * rozhodnutiu — a to rozhodnutie tu je vidieť.
 */
const SHOP_TIME_ZONE = 'Europe/Bratislava';

/* ═══════════════════════════════ pomôcky ═════════════════════════════════ */

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

const OPEN_STATUS: ReadBudgetStatus = {
  lane: 'orders',
  day: DAY_PAGED,
  limit: 160,
  used: 0,
  remaining: 160,
  exhausted: false,
  resetAt: new Date('2026-05-05T00:00:00.000Z'),
  minuteLimit: 16,
  usedThisMinute: 0,
  known: true,
};

/** Rozpočet, ktorý dá vždy všetko — testy tu merajú tržbu, nie strop (A4). */
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

/**
 * Server, ktorý na `/api/order` odpovie vždy tým istým — na dôkazy, ktoré
 * spoločný mock objednávok neponúka (`ip_banned`, nečitateľná suma).
 *
 * Prečo tu a nie rozšírením `test/helpers/mock-orders.ts`: ten helper zdieľajú
 * ďalšie sady a tento súbor si nemá pridávať právo meniť cudzie nástroje.
 * Konvencie sú tie isté — `node:http`, výhradne `127.0.0.1`, ephemeral port,
 * počítadlo requestov ako jediný zdroj pravdy o tom, čo naozaj odišlo.
 */
interface CannedShop {
  baseUrl: string;
  /** Koľko requestov naozaj dorazilo. */
  requests: number;
  close(): Promise<void>;
}

async function startCannedShop(status: number, body: unknown): Promise<CannedShop> {
  const sockets = new Set<Socket>();
  const shop = { baseUrl: '', requests: 0 } as { baseUrl: string; requests: number };
  const server: Server = createServer((req, res) => {
    shop.requests += 1;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  });
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  shop.baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    get baseUrl(): string {
      return shop.baseUrl;
    },
    get requests(): number {
      return shop.requests;
    },
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

async function cleanup(): Promise<void> {
  await withMigrationConn(async (conn) => {
    const days = ALL_DAYS.map(() => '?').join(', ');
    await conn.query(`DELETE FROM shop_revenue_daily WHERE revenue_day IN (${days})`, [...ALL_DAYS]);
    await conn.query(`DELETE FROM product_sales_daily WHERE sale_day IN (${days})`, [...ALL_DAYS]);
    await conn.query(`DELETE FROM sales_sync_state WHERE sale_day IN (${days})`, [...ALL_DAYS]);
  });
}

/** Objednávka s vlastnou sumou a menou; položky sú tu bez významu (D117). */
function paidOrder(id: number, dateAdd: string, totalPaid: number, currency = 'EUR'): MockOrder {
  return order(id, dateAdd, [{ id: 555, qty: 1 }], { total_paid: totalPaid, currency });
}

let mock: MockOrdersServer;
let logs: CapturedLog[];
let pauses: number[];

/** Klient nad mockom + zberač páuz (I10 — pauza sa v teste nikdy naozaj nečaká). */
function clientFor(baseUrl: string): OrderTotalsClient {
  return createOrdersClient({
    baseUrl,
    logger: collectingLogger(logs),
    sleepFn: async (ms) => {
      pauses.push(ms);
    },
  });
}

interface RunOptions {
  today: DateOnly;
  windowDays?: number;
  flags?: Partial<SalesSyncFlags>;
  now?: Date;
  baseUrl?: string;
  force?: boolean;
}

/** Jeden beh tržby nad SKUTOČNOU DB a mockom shopu. */
async function runRevenue(options: RunOptions): ReturnType<typeof syncShopRevenue> {
  return withAppConn(async (conn) =>
    syncShopRevenue(
      {
        ordersClient: clientFor(options.baseUrl ?? mock.baseUrl),
        key: fakeSecretRef(ORDERS_API_KEY),
        budget: openBudget(),
        salesRepo: createSalesRepo({ defaultConn: conn }),
        logger: collectingLogger(logs),
        flags: flags(options.flags ?? {}),
        sleepFn: async (ms) => {
          pauses.push(ms);
        },
        now: () => options.now ?? new Date('2026-05-04T10:00:00.000Z'),
        timeZone: SHOP_TIME_ZONE,
      },
      {
        today: options.today,
        windowDays: options.windowDays ?? 1,
        ...(options.force === true ? { force: true } : {}),
      },
    ),
  );
}

/** Riadky tržby za deň priamo z DB — nie z návratovej hodnoty behu. */
async function revenueRows(day: DateOnly): Promise<
  { currency: string; total: string; orders: number; complete: number; pages: number }[]
> {
  return withAppConn(async (conn) => {
    const rows = (await conn.query(
      'SELECT currency, CAST(total_paid_sum AS CHAR) AS total, orders_count AS orders_count, ' +
        'day_complete AS complete, pages_read AS pages FROM shop_revenue_daily ' +
        'WHERE revenue_day = ? ORDER BY currency ASC',
      [day],
    )) as Record<string, unknown>[];
    return rows.map((row) => ({
      currency: String(row.currency),
      total: String(row.total),
      orders: Number(row.orders_count),
      complete: Number(row.complete),
      pages: Number(row.pages),
    }));
  });
}

/* ══════════════════════════════════ testy ════════════════════════════════ */

describe.skipIf(!available)('D117 — denná tržba ESHOPU z objednávok', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  beforeEach(() => {
    logs = [];
    pauses = [];
  });

  afterEach(async () => {
    if (mock !== undefined) await mock.close();
  });

  /* ─────────── 1. suma a počet zo stránkovaných odpovedí ───────────────── */

  it('spočíta dennú sumu aj počet objednávok zo VIACERÝCH strán zoznamu', async () => {
    mock = await startMockOrders({
      orders: [
        paidOrder(1, `${DAY_PAGED} 08:00:00`, 10.01),
        paidOrder(2, `${DAY_PAGED} 09:00:00`, 20.02),
        paidOrder(3, `${DAY_PAGED} 10:00:00`, 0.07),
        paidOrder(4, `${DAY_PAGED} 23:59:59`, 1.1),
        paidOrder(5, `${DAY_PAGED} 23:59:59`, 2.2),
        // Mimo dňa — do súčtu nesmie vstúpiť ani cez filter shopu.
        paidOrder(6, '2026-05-03 12:00:00', 999.99),
      ],
    });

    // `per_page = 2` vynúti tri strany. Bez viacerých strán by sa nedalo
    // dokázať, že sa deň dočítal celý.
    const result = await runRevenue({ today: DAY_PAGED, flags: { perPage: 2 } });

    expect(result.outcome).toBe('complete');
    expect(result.error).toBeNull();
    expect(result.stoppedBy).toBe('done');
    expect(result.days).toHaveLength(1);

    const day = result.days[0];
    expect(day?.day).toBe(DAY_PAGED);
    expect(day?.complete).toBe(true);
    expect(day?.pagesRead).toBe(3);
    expect(day?.currencies).toEqual([
      // 10.01 + 20.02 + 0.07 + 1.10 + 2.20 = 33.40
      { currency: 'EUR', totalPaidSum: '33.40', ordersCount: 5 },
    ]);

    const rows = await revenueRows(DAY_PAGED);
    expect(rows).toEqual([
      { currency: 'EUR', total: '33.40', orders: 5, complete: 1, pages: 3 },
    ]);

    // Stránkovanie naozaj bežalo po 2 a naozaj išlo o tri requesty.
    expect(mock.state.listRequests()).toHaveLength(3);
    expect(mock.state.listRequests().map((r) => r.query.page)).toEqual(['1', '2', '3']);
    expect(mock.state.listRequests().map((r) => r.query.per_page)).toEqual(['2', '2', '2']);
    // I10 — medzi requestami sa pauzovalo (sekvenčné tempo, žiadny `Promise.all`).
    expect(pauses.filter((ms) => ms === 250).length).toBeGreaterThanOrEqual(2);
  });

  it('NEVOLÁ `order/get` ani raz a tržbu nepripisuje produktu (D117)', async () => {
    mock = await startMockOrders({
      orders: [paidOrder(11, `${DAY_PAGED} 08:00:00`, 50)],
    });

    await runRevenue({ today: DAY_PAGED, force: true });

    // Detail objednávky by stál 1 request na KAŽDÚ objednávku a ceny položiek
    // aj tak nevracia — preto sa nesmie zavolať vôbec.
    expect(mock.state.detailRequests()).toHaveLength(0);

    // Tržba je ESHOPOVÁ. Do `product_sales_daily` beh nesiahol — tam žijú KUSY
    // a rozdelenie `total_paid` medzi položky je zakázané (I11).
    const units = await withAppConn(
      async (conn) =>
        (await conn.query('SELECT COUNT(*) AS n FROM product_sales_daily WHERE sale_day = ?', [
          DAY_PAGED,
        ])) as { n: number | bigint }[],
    );
    expect(Number(units[0]?.n ?? -1)).toBe(0);
  });

  /* ─────────── 2. čiastočný deň a jeho preklopenie na úplný ───────────── */

  it('čiastočný deň je NEÚPLNÝ a po dotiahnutí zvyšku sa preklopí bez duplikácie', async () => {
    const orders: MockOrder[] = [
      paidOrder(21, `${DAY_PARTIAL} 08:00:00`, 30),
      paidOrder(22, `${DAY_PARTIAL} 09:00:00`, 40),
      paidOrder(23, `${DAY_PARTIAL} 10:00:00`, 50),
      paidOrder(24, `${DAY_PARTIAL} 11:00:00`, 60),
    ];
    mock = await startMockOrders({ orders });

    // Prvý beh: strop 1 request → prečíta sa PRVÁ strana z dvoch.
    const first = await runRevenue({
      today: DAY_PARTIAL,
      flags: { perPage: 2, maxRequestsPerRun: 1 },
    });
    expect(first.capReached).toBe(true);
    expect(first.stoppedBy).toBe('run_cap');
    expect(first.outcome).toBe('partial');
    expect(first.days[0]?.complete).toBe(false);
    expect(first.days[0]?.written).toBe(true);

    const afterFirst = await revenueRows(DAY_PARTIAL);
    expect(afterFirst).toEqual([
      // 30 + 40 — a `complete = 0` to priznáva. Bez toho by graf kreslil pokles.
      { currency: 'EUR', total: '70.00', orders: 2, complete: 0, pages: 1 },
    ]);

    // Druhý beh: rozpočet aj strop stačia → deň sa dočíta.
    const second = await runRevenue({ today: DAY_PARTIAL, flags: { perPage: 2 } });
    expect(second.outcome).toBe('complete');
    expect(second.days[0]?.complete).toBe(true);

    const afterSecond = await revenueRows(DAY_PARTIAL);
    // JEDEN riadok, nie dva — a suma je 180, nie 250 (70 + 180). Absolútny
    // upsert, nikdy inkrement.
    expect(afterSecond).toEqual([
      { currency: 'EUR', total: '180.00', orders: 4, complete: 1, pages: 2 },
    ]);
  });

  it('prerušenie a pokračovanie NEZDUPLIKUJE riadky ani po troch behoch', async () => {
    mock = await startMockOrders({
      orders: [
        paidOrder(31, `${DAY_PARTIAL} 08:00:00`, 5),
        paidOrder(32, `${DAY_PARTIAL} 09:00:00`, 5),
      ],
    });

    for (let i = 0; i < 3; i += 1) {
      await runRevenue({ today: DAY_PARTIAL, force: true });
    }

    const rows = await revenueRows(DAY_PARTIAL);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.total).toBe('10.00');
    expect(rows[0]?.orders).toBe(2);
    expect(rows[0]?.complete).toBe(1);
  });

  it('neúplné čítanie NEPREPÍŠE deň, ktorý už bol dočítaný', async () => {
    mock = await startMockOrders({
      orders: [
        paidOrder(41, `${DAY_PAGED} 08:00:00`, 11),
        paidOrder(42, `${DAY_PAGED} 09:00:00`, 22),
      ],
    });
    await runRevenue({ today: DAY_PAGED, force: true });
    expect((await revenueRows(DAY_PAGED))[0]).toEqual({
      currency: 'EUR',
      total: '33.00',
      orders: 2,
      complete: 1,
      pages: 1,
    });

    // Teraz beh, ktorý stihne len prvú z dvoch strán. Deň už dočítaný JE, takže
    // sa NESMIE prepísať horším (a nižším) výsledkom.
    const partial = await runRevenue({
      today: DAY_PAGED,
      force: true,
      flags: { perPage: 1, maxRequestsPerRun: 1 },
    });
    expect(partial.days[0]?.complete).toBe(false);
    expect(partial.days[0]?.written).toBe(false);

    expect((await revenueRows(DAY_PAGED))[0]).toEqual({
      currency: 'EUR',
      total: '33.00',
      orders: 2,
      complete: 1,
      pages: 1,
    });
  });

  /* ─────────── 3. `ip_banned` zastaví beh a deň zostane neoznačený ─────── */

  it('`ip_banned` zastaví sync, dôvod je v návratovej hodnote aj v logu, deň zostane BEZ riadku', async () => {
    mock = await startMockOrders({ orders: [] });
    // Presne to, čo shop k 28. 8. 2026 vracia na VŠETKO.
    const banned = await startCannedShop(403, { error: 'ip_banned' });
    try {
      const result = await runRevenue({
        today: DAY_BANNED,
        windowDays: 3,
        baseUrl: banned.baseUrl,
      });

      expect(result.stoppedBy).toBe('error');
      expect(result.outcome).toBe('partial');
      expect(result.error).toBe('ip_banned');
      // Dôvod musí byť čitateľný aj pre rozvrh — je to trvalá prekážka.
      expect(classifySalesStop(result.error)).toBe('ip_ban');

      // 403 je TERMINAL: žiadny retry, žiadne točenie backoffu.
      expect(banned.requests).toBe(1);

      // Log to hlási NAHLAS a s dôvodom, nie len ako „chyba behu".
      const blocked = logs.find((l) => l.message === 'shop_revenue_blocked');
      expect(blocked?.level).toBe('warn');
      expect(blocked?.fields.block).toBe('ip_ban');
      expect(blocked?.fields.errorCode).toBe('ip_banned');

      // A hlavne: dni zostávajú NEOZNAČENÉ. Žiadny riadok = „nevieme" (I11).
      for (const day of [DAY_BANNED_FROM, DAY_BANNED_MID, DAY_BANNED]) {
        expect(await revenueRows(day)).toEqual([]);
      }
      // Beh sa zastavil na PRVOM dni okna a ďalšie dva ani neskúsil.
      expect(result.days).toHaveLength(1);
      expect(result.days[0]?.day).toBe(DAY_BANNED_FROM);
      expect(result.days[0]?.written).toBe(false);
      expect(result.days[0]?.pagesRead).toBe(0);
    } finally {
      await banned.close();
    }
  });

  it('nečitateľná suma je `schema_drift`, nie ticho nižšia tržba', async () => {
    mock = await startMockOrders({ orders: [] });
    const nonsense = await startCannedShop(200, {
      data: [
        { id: 51, date_add: `${DAY_DRIFT} 08:00:00`, total_paid: 'tridsať eur', currency: 'EUR' },
      ],
      page: 1,
      per_page: 50,
      total: 1,
    });
    try {
      const result = await runRevenue({ today: DAY_DRIFT, baseUrl: nonsense.baseUrl });

      expect(result.stoppedBy).toBe('error');
      expect(result.error).toBe('local_schema_drift');
      // Deň sa NEZAPÍŠE. Zapísať ho ako „úplný, 0.00" by bola presne tá lož,
      // ktorú I11 zakazuje.
      expect(await revenueRows(DAY_DRIFT)).toEqual([]);
    } finally {
      await nonsense.close();
    }
  });

  /* ─────────── 4. polnoc v zóne shopu (NIKDY v UTC) ───────────────────── */

  it('objednávka za polnocou padne do správneho dňa v zóne shopu', async () => {
    /*
     * `now` je 22:30 UTC. V zóne shopu (`Europe/Bratislava`, v máji UTC+2) je
     * vtedy už 00:30 NASLEDUJÚCEHO dňa. Test je preto deterministický: `now` je
     * vpichnuté, takže neflakuje medzi 22:00 a 24:00 UTC — a práve to je ten
     * interval, v ktorom by beh počítajúci deň v UTC písal tržbu do včerajška.
     */
    const now = new Date(`${DAY_BEFORE_MIDNIGHT}T22:30:00.000Z`);
    expect(todayInTimeZone('UTC', now.getTime())).toBe(DAY_BEFORE_MIDNIGHT);
    expect(todayInTimeZone(SHOP_TIME_ZONE, now.getTime())).toBe(DAY_AFTER_MIDNIGHT);

    mock = await startMockOrders({
      orders: [
        // Ešte pred polnocou v hodinách shopu.
        paidOrder(61, `${DAY_BEFORE_MIDNIGHT} 23:50:00`, 7),
        // Už po polnoci v hodinách shopu.
        paidOrder(62, `${DAY_AFTER_MIDNIGHT} 00:15:00`, 10),
      ],
    });

    // `today` sa ZÁMERNE nepodsúva — počíta ho beh z `now` a zóny (D31).
    const result = await withAppConn(async (conn) =>
      syncShopRevenue(
        {
          ordersClient: clientFor(mock.baseUrl),
          key: fakeSecretRef(ORDERS_API_KEY),
          budget: openBudget(),
          salesRepo: createSalesRepo({ defaultConn: conn }),
          logger: collectingLogger(logs),
          flags: flags(),
          sleepFn: async (ms) => {
            pauses.push(ms);
          },
          now: () => now,
          timeZone: SHOP_TIME_ZONE,
        },
        { windowDays: 2 },
      ),
    );

    expect(result.windowTo).toBe(DAY_AFTER_MIDNIGHT);
    expect(result.windowFrom).toBe(DAY_BEFORE_MIDNIGHT);
    expect(result.days.map((d) => d.day)).toEqual([DAY_BEFORE_MIDNIGHT, DAY_AFTER_MIDNIGHT]);

    // Každá objednávka v SVOJOM dni — nikdy obe v jednom.
    expect(await revenueRows(DAY_BEFORE_MIDNIGHT)).toEqual([
      { currency: 'EUR', total: '7.00', orders: 1, complete: 1, pages: 1 },
    ]);
    expect(await revenueRows(DAY_AFTER_MIDNIGHT)).toEqual([
      { currency: 'EUR', total: '10.00', orders: 1, complete: 1, pages: 1 },
    ]);
  });

  /* ─────────── 5. dve meny sa NIKDY nesčítajú ─────────────────────────── */

  it('dve meny sú dva riadky a súčet mien nikde nevznikne', async () => {
    mock = await startMockOrders({
      orders: [
        paidOrder(71, `${DAY_CURRENCIES} 08:00:00`, 100, 'EUR'),
        paidOrder(72, `${DAY_CURRENCIES} 09:00:00`, 25.5, 'EUR'),
        paidOrder(73, `${DAY_CURRENCIES} 10:00:00`, 2500, 'CZK'),
      ],
    });

    const result = await runRevenue({ today: DAY_CURRENCIES });

    expect(result.days[0]?.currencies).toEqual([
      { currency: 'CZK', totalPaidSum: '2500.00', ordersCount: 1 },
      { currency: 'EUR', totalPaidSum: '125.50', ordersCount: 2 },
    ]);

    const rows = await revenueRows(DAY_CURRENCIES);
    expect(rows).toEqual([
      { currency: 'CZK', total: '2500.00', orders: 1, complete: 1, pages: 1 },
      { currency: 'EUR', total: '125.50', orders: 2, complete: 1, pages: 1 },
    ]);
    // Nikde nesmie stáť 2625.50 — to by bola nepravda vydávaná za tržbu.
    expect(rows.map((r) => r.total)).not.toContain('2625.50');
  });

  /* ─────────── 6. drobnosti, ktoré držia čísla poctivé ────────────────── */

  it('okno tržby je 30 dní a je to iné číslo než okno pre kusy', () => {
    // Zoznam po 100 sa dá čítať za mesiac; kusy stoja 1 request na objednávku.
    expect(SHOP_REVENUE_WINDOW_DAYS).toBe(30);
  });

  it('suma sa prenáša v centoch, takže float po ceste nič nestratí', () => {
    expect(moneyToCents(64.15)).toBe(6415);
    expect(moneyToCents('64.15')).toBe(6415);
    expect(moneyToCents('1 234,50')).toBeNull();
    expect(moneyToCents('nonsense')).toBeNull();
    expect(moneyToCents(null)).toBeNull();
    // 0.1 + 0.2 v centoch je presne 30, nie 30.000000000000004.
    expect(centsToMoneyString(moneyToCents(0.1)! + moneyToCents(0.2)!)).toBe('0.30');
    expect(centsToMoneyString(0)).toBe('0.00');
    expect(centsToMoneyString(-505)).toBe('-5.05');
  });
});
