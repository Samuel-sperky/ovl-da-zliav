/**
 * Aura Zľavy — MOCK OBJEDNÁVKOVÝCH ENDPOINTOV SHOPU (INVARIANT I6).
 *
 * Prečo samostatný server a nie rozšírenie `test/mock-shop/server.ts`:
 * ten mock objednávky ZÁMERNE nepozná (jeho komentár to hovorí priamo) a jeho
 * vlastníkom je iná úloha. Tento harness je preto aditívny — rovnaké konvencie
 * (`node:http`, výhradne `127.0.0.1`, ephemeral port, `recordedRequests` ako
 * jediný zdroj pravdy o tom, čo naozaj odišlo), len iné cesty.
 *
 * Verne reprodukuje podmnožinu kontraktu z `docs/api/sperky-api.md`:
 *   - `GET /api/order`      — `data/page/per_page/total`, filter na `date_add`
 *   - `GET /api/order/get`  — `{ok:true,…,products:[…]}` / `{ok:false,error:'not found'}`
 *     (tento endpoint vracia „not found" s HTTP **200** — dokumentácia to priznáva)
 *   - `401 unauthorized` / `403 forbidden` / `429 rate_limited` / `500`
 *   - obal `{"result":{…}}` aj bare objekt (obe konvencie shopu)
 *
 * Odpovede úmyselne nesú aj `total_paid`, `country` a `country_iso` — bez nich
 * by sa nedalo dokázať, že klient tieto polia NEPREPÚŠŤA ďalej (I8' bod 3).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export const MOCK_HOST = '127.0.0.1';

/** Kľúč, ktorý mock považuje za platný a so správnym scope. Nie je reálny (I1). */
export const ORDERS_API_KEY = 'fake-orders-key-0001';
/** Platný kľúč BEZ scope na objednávky → 403. */
export const NO_SCOPE_ORDERS_KEY = 'fake-noscope-key-0002';
/** Kľúč, ktorý mock nepozná → 401. */
export const UNKNOWN_ORDERS_KEY = 'fake-unknown-key-0003';

const ORDERS_SCOPE = 'orders' + ':' + 'read';

export interface MockOrderLine {
  id: number;
  qty: number;
}

export interface MockOrder {
  id: number;
  /** `YYYY-MM-DD HH:mm:ss` — presne tvar, ktorý vracia shop. */
  date_add: string;
  total_paid: number;
  currency: string;
  country: string;
  country_iso: string;
  products: MockOrderLine[];
}

export type MockOrdersFailure =
  | 'rate_limited'
  | 'server_error'
  | 'unauthorized'
  | 'forbidden'
  | 'garbage';

export interface RecordedOrdersRequest {
  seq: number;
  method: string;
  path: string;
  /** Celé `req.url` vrátane query — podklad pre kontrolu, že kľúč tam nie je (I1). */
  url: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  apiKey: string | null;
  responseStatus?: number;
}

export interface MockOrdersOptions {
  orders?: MockOrder[];
  /** Obaliť odpovede do `{"result":{…}}`? Default `false` (bare objekt). */
  wrapInResult?: boolean;
  defaultPerPage?: number;
  maxPerPage?: number;
}

/* ═══════════════════════════════ stav ═════════════════════════════════════ */

export class MockOrdersState {
  readonly orders = new Map<number, MockOrder>();
  readonly keys = new Map<string, string[]>();
  readonly recordedRequests: RecordedOrdersRequest[] = [];

  wrapInResult: boolean;
  defaultPerPage: number;
  maxPerPage: number;

  requestCount = 0;
  /** Prvých N requestov skončí daným zlyhaním (`failFirst`). */
  failFirstKind: MockOrdersFailure | null = null;
  failFirstCount = 0;
  failFirstApplied = 0;
  /** `Retry-After` pri `rate_limited`; `null` = hlavičku vôbec neposlať. */
  retryAfterSeconds: number | null = null;
  /** Trvalé zlyhanie každého requestu. */
  failAlways: MockOrdersFailure | null = null;
  /** Zlyhá detail práve tejto objednávky. */
  failDetailFor: number | null = null;

  constructor(options: MockOrdersOptions = {}) {
    this.wrapInResult = options.wrapInResult ?? false;
    this.defaultPerPage = options.defaultPerPage ?? 50;
    this.maxPerPage = options.maxPerPage ?? 100;
    for (const order of options.orders ?? []) this.orders.set(order.id, order);
    this.keys.set(ORDERS_API_KEY, [ORDERS_SCOPE]);
    this.keys.set(NO_SCOPE_ORDERS_KEY, ['product' + ':' + 'edit']);
  }

  setOrders(orders: MockOrder[]): this {
    this.orders.clear();
    for (const order of orders) this.orders.set(order.id, order);
    return this;
  }

  /** Objednávky daného dňa v deterministickom poradí (paginácia musí byť stabilná). */
  ordersForRange(from: string | undefined, to: string | undefined): MockOrder[] {
    return [...this.orders.values()]
      .filter((order) => {
        const day = order.date_add.slice(0, 10);
        if (from !== undefined && day < from) return false;
        if (to !== undefined && day > to) return false;
        return true;
      })
      .sort((a, b) => a.id - b.id);
  }

  failFirst(count: number, kind: MockOrdersFailure, retryAfterSeconds: number | null = null): this {
    this.failFirstKind = kind;
    this.failFirstCount = count;
    this.failFirstApplied = 0;
    this.retryAfterSeconds = retryAfterSeconds;
    return this;
  }

  always(kind: MockOrdersFailure | null): this {
    this.failAlways = kind;
    return this;
  }

  reset(): this {
    this.recordedRequests.length = 0;
    this.requestCount = 0;
    this.failFirstKind = null;
    this.failFirstCount = 0;
    this.failFirstApplied = 0;
    this.failAlways = null;
    this.failDetailFor = null;
    this.retryAfterSeconds = null;
    return this;
  }

  listRequests(): RecordedOrdersRequest[] {
    return this.recordedRequests.filter((r) => r.path === '/api/order');
  }

  detailRequests(): RecordedOrdersRequest[] {
    return this.recordedRequests.filter((r) => r.path === '/api/order/get');
  }

  seenApiKeys(): string[] {
    const seen = new Set<string>();
    for (const r of this.recordedRequests) if (r.apiKey !== null) seen.add(r.apiKey);
    return [...seen];
  }
}

/* ══════════════════════════════ server ════════════════════════════════════ */

interface MockOrdersResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** Obal `{"result":…}` sa na chybové transportné tvary neaplikuje. */
  wrappable?: boolean;
}

export interface MockOrdersServer {
  readonly baseUrl: string;
  readonly port: number;
  readonly state: MockOrdersState;
  close(): Promise<void>;
}

function headerString(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}

function failureResponse(
  kind: MockOrdersFailure,
  retryAfterSeconds: number | null,
): MockOrdersResponse {
  switch (kind) {
    case 'rate_limited':
      return {
        status: 429,
        body: { error: 'rate_limited' },
        ...(retryAfterSeconds === null
          ? {}
          : { headers: { 'Retry-After': String(retryAfterSeconds) } }),
      };
    case 'server_error':
      return { status: 500, body: { error: 'request_failed' } };
    case 'unauthorized':
      return { status: 401, body: { error: 'unauthorized' } };
    case 'forbidden':
      return { status: 403, body: { error: 'forbidden' } };
    case 'garbage':
      return { status: 200, body: { nonsense: true, data: 'not-a-list' } };
  }
}

export async function startMockOrders(options: MockOrdersOptions = {}): Promise<MockOrdersServer> {
  const state = new MockOrdersState(options);
  const sockets = new Set<Socket>();

  const server = createServer((req, res) => {
    handle(req, res);
  });

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${MOCK_HOST}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      headers[name.toLowerCase()] = headerString(value);
    }
    const apiKey = headers['x-api-key'] !== undefined && headers['x-api-key'].length > 0
      ? headers['x-api-key']
      : null;

    state.requestCount += 1;
    const record: RecordedOrdersRequest = {
      seq: state.requestCount,
      method,
      path,
      url: req.url ?? path,
      query: Object.fromEntries(url.searchParams),
      headers,
      apiKey,
    };
    state.recordedRequests.push(record);

    const send = (response: MockOrdersResponse): void => {
      record.responseStatus = response.status;
      const body =
        state.wrapInResult && response.wrappable === true
          ? { result: response.body }
          : response.body;
      res.writeHead(response.status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...(response.headers ?? {}),
      });
      res.end(JSON.stringify(body));
    };

    /* vynútené scenáre pred akoukoľvek business logikou */
    if (state.failAlways !== null) {
      send(failureResponse(state.failAlways, state.retryAfterSeconds));
      return;
    }
    if (state.failFirstKind !== null && state.failFirstApplied < state.failFirstCount) {
      state.failFirstApplied += 1;
      send(failureResponse(state.failFirstKind, state.retryAfterSeconds));
      return;
    }

    /* identita a scope */
    if (apiKey === null || !state.keys.has(apiKey)) {
      send({ status: 401, body: { error: 'unauthorized' } });
      return;
    }
    if (!(state.keys.get(apiKey) ?? []).includes(ORDERS_SCOPE)) {
      send({ status: 403, body: { error: 'forbidden' } });
      return;
    }
    if (method !== 'GET') {
      send({ status: 405, body: { error: 'method_not_allowed' } });
      return;
    }

    if (path === '/api/order') {
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const requested = Number(url.searchParams.get('per_page') ?? String(state.defaultPerPage));
      const perPage = Math.min(
        Math.max(1, Number.isFinite(requested) ? Math.trunc(requested) : state.defaultPerPage),
        state.maxPerPage,
      );
      const all = state.ordersForRange(
        url.searchParams.get('date_from') ?? undefined,
        url.searchParams.get('date_to') ?? undefined,
      );
      const start = (page - 1) * perPage;
      send({
        status: 200,
        wrappable: true,
        body: {
          data: all.slice(start, start + perPage).map((order) => ({
            id: order.id,
            date_add: order.date_add,
            total_paid: order.total_paid,
            currency: order.currency,
          })),
          page,
          per_page: perPage,
          total: all.length,
        },
      });
      return;
    }

    if (path === '/api/order/get') {
      const raw = url.searchParams.get('id');
      if (raw === null || raw.trim().length === 0 || !/^\d+$/.test(raw.trim())) {
        send({ status: 400, wrappable: true, body: { ok: false, error: 'no id' } });
        return;
      }
      const id = Number(raw);
      if (state.failDetailFor === id) {
        send({ status: 500, body: { error: 'request_failed' } });
        return;
      }
      const order = state.orders.get(id);
      if (order === undefined) {
        // Pozor: HTTP **200** s `ok:false` — tento endpoint predchádza konvencii
        // so status kódmi (`docs/api/sperky-api.md`).
        send({ status: 200, wrappable: true, body: { ok: false, error: 'not found' } });
        return;
      }
      send({
        status: 200,
        wrappable: true,
        body: {
          ok: true,
          id: order.id,
          date_add: order.date_add,
          total_paid: order.total_paid,
          currency: order.currency,
          products: order.products.map((line) => ({ id: line.id, qty: line.qty })),
          country: order.country,
          country_iso: order.country_iso,
        },
      });
      return;
    }

    send({ status: 404, body: { error: 'unknown_controller' } });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, MOCK_HOST, () => resolve());
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://${MOCK_HOST}:${address.port}`,
    port: address.port,
    state,
    async close(): Promise<void> {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

/* ═════════════════════════ pomôcky pre testy ══════════════════════════════ */

/** `SecretRef` nad fake kľúčom — rovnaký kontrakt ako produkčný (I1, D64). */
export function fakeSecretRef(key: string, onRelease?: () => void): () => Promise<{
  value: Buffer;
  release(): void;
}> {
  return async () => {
    const value = Buffer.from(key, 'utf8');
    return {
      value,
      release(): void {
        value.fill(0);
        onRelease?.();
      },
    };
  };
}

/** Objednávka s rozumnými defaultmi — testy prepisujú len to, čo ich zaujíma. */
export function order(
  id: number,
  dateAdd: string,
  products: MockOrderLine[],
  extra: Partial<MockOrder> = {},
): MockOrder {
  return {
    id,
    date_add: dateAdd,
    total_paid: 59.9,
    currency: 'EUR',
    country: 'Slovakia',
    country_iso: 'SK',
    products,
    ...extra,
  };
}
