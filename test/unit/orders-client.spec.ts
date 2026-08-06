/**
 * Aura Zľavy — klient objednávok (I8', I1, I6, R-2, E4).
 *
 * Všetko beží proti LOKÁLNEMU mocku (I6) — `test/helpers/mock-orders.ts`.
 * Reálny eshop má 1,76 M objednávok a produkčné dáta; sem sa nikdy nesiaha.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LogFields, Logger } from '@/contracts';

import { ShopRequestError } from '@/lib/shop/errors';
import {
  ORDERS_MAX_PER_PAGE,
  ORDERS_PATHS,
  createOrdersClient,
  dayFromDateAdd,
  unwrapEnvelope,
  type OrdersClient,
} from '@/lib/shop/orders-client';

import {
  ORDERS_API_KEY,
  NO_SCOPE_ORDERS_KEY,
  UNKNOWN_ORDERS_KEY,
  fakeSecretRef,
  order,
  startMockOrders,
  type MockOrdersServer,
} from '../helpers/mock-orders';

/* ─────────────────────────────── harness ─────────────────────────────────── */

interface CapturedLog {
  level: string;
  message: string;
  fields: LogFields;
}

function collectingLogger(sink: CapturedLog[]): Logger {
  const make = (base: LogFields): Logger => ({
    debug: (message, fields) => sink.push({ level: 'debug', message, fields: { ...base, ...fields } }),
    info: (message, fields) => sink.push({ level: 'info', message, fields: { ...base, ...fields } }),
    warn: (message, fields) => sink.push({ level: 'warn', message, fields: { ...base, ...fields } }),
    error: (message, fields) => sink.push({ level: 'error', message, fields: { ...base, ...fields } }),
    child: (fields) => make({ ...base, ...fields }),
  });
  return make({});
}

const ORDERS = [
  order(101, '2026-08-04 09:00:00', [{ id: 11, qty: 2 }]),
  order(102, '2026-08-04 11:30:00', [{ id: 11, qty: 1 }, { id: 12, qty: 3 }]),
  order(103, '2026-08-05 08:15:00', [{ id: 12, qty: 5 }]),
];

let mock: MockOrdersServer;
let logs: CapturedLog[];
let delays: number[];
let releases: number;
let client: OrdersClient;

const ctx = { operationId: '01J0000000000000000000000A' };

function build(): OrdersClient {
  return createOrdersClient({
    baseUrl: mock.baseUrl,
    logger: collectingLogger(logs),
    sleepFn: async (ms) => {
      delays.push(ms);
    },
  });
}

beforeEach(async () => {
  mock = await startMockOrders({ orders: ORDERS });
  logs = [];
  delays = [];
  releases = 0;
  client = build();
});

afterEach(async () => {
  await mock.close();
});

const key = (): ReturnType<typeof fakeSecretRef> =>
  fakeSecretRef(ORDERS_API_KEY, () => {
    releases += 1;
  });

/* ─────────────────────────────── testy ───────────────────────────────────── */

describe('orders-client — čisté pomôcky', () => {
  it('`date_add` → deň, nečitateľný vstup → null', () => {
    expect(dayFromDateAdd('2026-08-04 09:00:00')).toBe('2026-08-04');
    expect(dayFromDateAdd('2026-08-04')).toBe('2026-08-04');
    expect(dayFromDateAdd('nezmysel')).toBeNull();
    expect(dayFromDateAdd('')).toBeNull();
  });

  it('obal `{"result":…}` sa rozbalí, bare objekt zostane', () => {
    expect(unwrapEnvelope({ result: { data: [] } })).toEqual({ data: [] });
    expect(unwrapEnvelope({ data: [] })).toEqual({ data: [] });
    expect(unwrapEnvelope(null)).toBeNull();
  });

  it('pozná presne dve objednávkové cesty', () => {
    expect(Object.values(ORDERS_PATHS)).toEqual(['/api/order', '/api/order/get']);
  });
});

describe('orders-client — zoznam objednávok', () => {
  it('pošle `date_from`/`date_to`/`page`/`per_page` a vráti len id + deň', async () => {
    const page = await client.listOrders(
      { dateFrom: '2026-08-04', dateTo: '2026-08-04', page: 1, perPage: 50 },
      key(),
      ctx,
    );

    expect(page.total).toBe(2);
    expect(page.page).toBe(1);
    expect(page.perPage).toBe(50);
    expect(page.data).toEqual([
      { id: 101, day: '2026-08-04' },
      { id: 102, day: '2026-08-04' },
    ]);

    const sent = mock.state.listRequests()[0];
    expect(sent.query).toMatchObject({
      date_from: '2026-08-04',
      date_to: '2026-08-04',
      page: '1',
      per_page: '50',
    });
  });

  it('`per_page` nad 100 sa zastropuje na 100 (paginátor shopu)', async () => {
    await client.listOrders(
      { dateFrom: '2026-08-04', dateTo: '2026-08-05', perPage: 500 },
      key(),
      ctx,
    );
    expect(mock.state.listRequests()[0].query.per_page).toBe(String(ORDERS_MAX_PER_PAGE));
  });

  it('stránkuje — druhá strana nesie ďalšie objednávky, `total` je celý rozsah', async () => {
    const first = await client.listOrders(
      { dateFrom: '2026-08-04', dateTo: '2026-08-05', page: 1, perPage: 2 },
      key(),
      ctx,
    );
    const second = await client.listOrders(
      { dateFrom: '2026-08-04', dateTo: '2026-08-05', page: 2, perPage: 2 },
      key(),
      ctx,
    );

    expect(first.total).toBe(3);
    expect(first.data.map((o) => o.id)).toEqual([101, 102]);
    expect(second.data.map((o) => o.id)).toEqual([103]);
  });

  it('odmietne nezmyselný dátum ešte pred odoslaním', async () => {
    await expect(
      client.listOrders({ dateFrom: '4.8.2026', dateTo: '2026-08-04' }, key(), ctx),
    ).rejects.toThrow(ShopRequestError);
    expect(mock.state.requestCount).toBe(0);
  });

  it('zvláda obal `{"result":…}` aj bare objekt', async () => {
    mock.state.wrapInResult = true;
    const page = await client.listOrders(
      { dateFrom: '2026-08-04', dateTo: '2026-08-04' },
      key(),
      ctx,
    );
    expect(page.data.map((o) => o.id)).toEqual([101, 102]);
  });
});

describe('orders-client — detail objednávky', () => {
  it('vráti VÝHRADNE id, deň a kusy po produkte (I8\' bod 3)', async () => {
    const units = await client.getOrderUnits(102, key(), ctx);

    expect(Object.keys(units).sort()).toEqual(['day', 'id', 'lines']);
    expect(units).toEqual({
      id: 102,
      day: '2026-08-04',
      lines: [
        { productId: 11, qty: 1 },
        { productId: 12, qty: 3 },
      ],
    });

    // Krajina, suma ani mena sa z modulu nedostanú ani ako „nepoužité pole".
    const serialized = JSON.stringify(units);
    for (const forbidden of ['total_paid', 'country', 'country_iso', 'currency', 'Slovakia', 'EUR']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('`not found` (HTTP 200 s `ok:false`) je terminal `not_found`, nie úspech', async () => {
    await expect(client.getOrderUnits(999, key(), ctx)).rejects.toMatchObject({
      shopError: { kind: 'not_found', retryable: false },
    });
    // Terminal chyba sa NEOPAKUJE.
    expect(mock.state.detailRequests()).toHaveLength(1);
  });

  it('`no id` — nezmyselné id sa neodošle vôbec', async () => {
    await expect(client.getOrderUnits(0, key(), ctx)).rejects.toThrow(ShopRequestError);
    await expect(client.getOrderUnits(-3, key(), ctx)).rejects.toThrow(ShopRequestError);
    expect(mock.state.requestCount).toBe(0);
  });

  it('HTTP 200 s nezmyselným tvarom je `schema_drift`, nikdy úspech (D54)', async () => {
    mock.state.always('garbage');
    await expect(client.getOrderUnits(101, key(), ctx)).rejects.toMatchObject({
      shopError: { kind: 'schema_drift' },
    });
  });
});

describe('orders-client — chyby a politika opakovania', () => {
  it('E4 — `forbidden` je TERMINAL, nikdy opakovaná sieťová chyba', async () => {
    const forbiddenKey = fakeSecretRef(NO_SCOPE_ORDERS_KEY);
    const rejected: string[] = [];
    const strict = createOrdersClient({
      baseUrl: mock.baseUrl,
      logger: collectingLogger(logs),
      sleepFn: async (ms) => {
        delays.push(ms);
      },
      onKeyRejected: (info) => rejected.push(info.kind),
    });

    await expect(
      strict.listOrders({ dateFrom: '2026-08-04', dateTo: '2026-08-04' }, forbiddenKey, ctx),
    ).rejects.toMatchObject({
      shopError: { kind: 'forbidden', retryable: false },
    });

    expect(mock.state.requestCount).toBe(1); // ani jeden retry
    expect(delays).toEqual([]); // ani jeden backoff
    expect(rejected).toEqual(['forbidden']);
  });

  it('neznámy kľúč je `unauthorized` — terminal, bez opakovania', async () => {
    await expect(
      client.listOrders(
        { dateFrom: '2026-08-04', dateTo: '2026-08-04' },
        fakeSecretRef(UNKNOWN_ORDERS_KEY),
        ctx,
      ),
    ).rejects.toMatchObject({ shopError: { kind: 'unauthorized', retryable: false } });
    expect(mock.state.requestCount).toBe(1);
  });

  it('R-2 — `rate_limited` je spomaľovacie: konzervatívny backoff a potom úspech', async () => {
    mock.state.failFirst(1, 'rate_limited', null); // bez `Retry-After`
    const page = await client.listOrders(
      { dateFrom: '2026-08-04', dateTo: '2026-08-04' },
      key(),
      ctx,
    );

    expect(page.total).toBe(2);
    expect(mock.state.requestCount).toBe(2);
    expect(delays).toEqual([5_000]); // prvý stupeň exponenciálneho backoffu
  });

  it('`Retry-After` dlhšia než náš backoff sa rešpektuje, ale zastropuje', async () => {
    mock.state.failFirst(1, 'rate_limited', 9_999);
    await client.listOrders({ dateFrom: '2026-08-04', dateTo: '2026-08-04' }, key(), ctx);
    expect(delays).toEqual([120_000]); // ORDERS_RETRY_WAIT_CAP_S
  });

  it('trvalý `rate_limited` skončí po 3 pokusoch chybou, nie nekonečným cyklom', async () => {
    mock.state.always('rate_limited');
    await expect(
      client.listOrders({ dateFrom: '2026-08-04', dateTo: '2026-08-04' }, key(), ctx),
    ).rejects.toMatchObject({ shopError: { kind: 'rate_limited', retryable: true } });
    expect(mock.state.requestCount).toBe(3);
    expect(delays).toEqual([5_000, 20_000]);
  });

  it('500 sa opakuje s backoffom (spomaľovacie, nie trvalé)', async () => {
    mock.state.failFirst(2, 'server_error');
    const page = await client.listOrders(
      { dateFrom: '2026-08-04', dateTo: '2026-08-04' },
      key(),
      ctx,
    );
    expect(page.total).toBe(2);
    expect(mock.state.requestCount).toBe(3);
    expect(delays).toEqual([5_000, 20_000]);
  });
});

describe('orders-client — kľúč (I1)', () => {
  it('kľúč ide výhradne v hlavičke `X-Api-Key` a `release()` beží vždy', async () => {
    await client.listOrders({ dateFrom: '2026-08-04', dateTo: '2026-08-04' }, key(), ctx);

    const sent = mock.state.listRequests()[0];
    expect(sent.headers['x-api-key']).toBe(ORDERS_API_KEY);
    expect(sent.url).not.toContain(ORDERS_API_KEY);
    expect(releases).toBe(1);
  });

  it('`release()` beží aj keď request skončí chybou', async () => {
    mock.state.always('server_error');
    await expect(
      client.listOrders({ dateFrom: '2026-08-04', dateTo: '2026-08-04' }, key(), ctx),
    ).rejects.toThrow(ShopRequestError);
    expect(releases).toBe(3); // jeden na každý pokus
  });

  it('kľúč sa neobjaví v žiadnej chybovej hláške ani v žiadnom logu', async () => {
    mock.state.always('forbidden');
    let caught: unknown = null;
    try {
      await client.listOrders({ dateFrom: '2026-08-04', dateTo: '2026-08-04' }, key(), ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ShopRequestError);

    const error = caught as ShopRequestError;
    const haystacks = [
      error.message,
      JSON.stringify(error.shopError),
      JSON.stringify(logs),
    ];
    for (const haystack of haystacks) {
      expect(haystack).not.toContain(ORDERS_API_KEY);
      expect(haystack).not.toContain(ORDERS_API_KEY.slice(-8));
    }
  });

  it('chyba `SecretRef` (expirovaný/wipnutý kľúč) NIE JE sieťová chyba a nič neodošle', async () => {
    const brokenKey = async (): Promise<never> => {
      throw new Error('ApiKeyError');
    };
    await expect(
      client.listOrders({ dateFrom: '2026-08-04', dateTo: '2026-08-04' }, brokenKey, ctx),
    ).rejects.toThrow('ApiKeyError');
    expect(mock.state.requestCount).toBe(0);
    expect(delays).toEqual([]);
  });
});
