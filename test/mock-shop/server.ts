/**
 * Aura Zľavy — MOCK SHOP SERVER (BUILD-SPEC §12, INVARIANT I6).
 *
 * Samostatný `node:http` server na **ephemeral porte a výhradne na 127.0.0.1**.
 * Verne reprodukuje podmnožinu kontraktu z `docs/api/sperky-api.md`, ktorú appka
 * skutočne používa (I8 — objednávkové endpointy tu ÚMYSELNE neexistujú):
 *
 *   - `GET  /api/products`                 — paginácia `data/page/per_page/total`
 *   - `GET  /api/products/get?id=`         — `{ok:true,…}` / `{ok:false,errors:['not found']}`
 *   - `GET  /api/products/getFull?id=`     — back-office polia v obálke
 *                                            `{ok:true,result:{…}}` a kľúčom
 *   - `POST /api/products/setReduction`    — auth + scope + validácie, `{ok:true,id}`
 *   - `POST /api/batch`                    — max 25, positional `results`,
 *                                            `batch_not_allowed`, `invalid_item`
 *
 * Verný je aj v „nudných" veciach, na ktorých appka stojí:
 *   - **obe tvarové konvencie** shopu — `{ok:false,errors:[…]}` pri endpointoch
 *     na zdieľaných helperoch a `{error:'…'}` pri transportných chybách,
 *   - `405 method_not_allowed` pre správnu akciu pod nesprávnym verbom,
 *     `404 invalid_action` / `404 unknown_controller` pre zlú cestu,
 *   - `429 rate_limited` **s hlavičkou `Retry-After`** (D42),
 *   - HTTP 200 s nesmyselným tvarom (`returnGarbage`) — schema drift (D54),
 *   - „vis" pri zápise (`hangWrite`) — zápis sa vykoná, odpoveď nepríde (D45).
 *
 * Čo mock ZÁMERNE nevracia: aktuálnu zľavu. Reálny shop ju nevracia (backlog B1)
 * a keby ju vracal mock, testy by potvrdzovali neexistujúcu schopnosť (I11).
 * `state.getProduct(id).lastReduction` je dostupný len testu, nie appke.
 *
 * VÝNIMKA (28. 8. 2026): `getFull` zľavu vracia, lebo presne to je jeho dôvod
 * existencie v API v5 (bod B1) a `productFullSchema` tie tri kľúče VYŽADUJE
 * (nullable). Nezľahčuje to I11 — keď zľava nebeží, mock pošle `null`, a to je
 * meraný fakt „zľava nie je", nie zliate s „nevieme". Verejné `get` a zoznam
 * zľavu naďalej nevracajú.
 *
 * Vlastník: A6.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import {
  BATCHABLE_ACTIONS,
  BATCH_MAX_ITEMS,
  MockShopState,
  type MockFailureKind,
  type MockProduct,
  type MockShopStateOptions,
  type RecordedBatchItem,
  type RecordedRequest,
} from './state';

/** Mock NIKDY nepočúva na inom interfejse — invariant I6. */
export const MOCK_HOST = '127.0.0.1';

/** Strop tela požiadavky; nad ním shop vracia `400 invalid_input`. */
const MAX_BODY_BYTES = 1_000_000;

/** Cesty, ktoré mock implementuje. */
export const MOCK_PATHS = {
  productList: '/api/products',
  productGet: '/api/products/get',
  productGetFull: '/api/products/getFull',
  setReduction: '/api/products/setReduction',
  batch: '/api/batch',
} as const;

/* ═══════════════════════════ 1. Parsovanie tela ════════════════════════════ */

/**
 * Nastaví `obj[a][b][c] = value` z kľúča `a[b][c]` — PHP-ovská bracket notácia,
 * v ktorej klient (A3) posiela dávku: `requests[0][data][id]=123`.
 */
function assignNested(target: Record<string, unknown>, rawKey: string, value: string): void {
  const match = /^([^[\]]+)((\[[^[\]]*\])*)$/.exec(rawKey);
  if (match === null) {
    target[rawKey] = value;
    return;
  }
  const segments: string[] = [match[1]];
  const rest = match[2] ?? '';
  for (const part of rest.matchAll(/\[([^[\]]*)\]/g)) segments.push(part[1]);

  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    const existing = cursor[key];
    if (typeof existing !== 'object' || existing === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

/** Objekt s číselnými kľúčmi `{0:…,1:…}` → pole (form-encoded pole položiek). */
function objectToArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'object' || value === null) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  if (!entries.every(([key]) => /^\d+$/.test(key))) return null;
  return entries
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, itemValue]) => itemValue);
}

/** Rozparsuje telo: JSON aj `application/x-www-form-urlencoded` (aj bracketové). */
export function parseBody(raw: string, contentType: string | undefined): Record<string, unknown> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  const type = (contentType ?? '').toLowerCase();

  if (type.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
      return { _raw: parsed };
    } catch {
      return { _malformed: true };
    }
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of new URLSearchParams(trimmed)) assignNested(out, key, value);
  return out;
}

/* ═══════════════════════════ 2. Pomôcky validácie ══════════════════════════ */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** Kalendárne „+3 mesiace" s klampingom dňa (31.1. + 3M = 30.4.), nie 90 dní. */
function addMonths(dateOnly: string, months: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const monthIndex = m - 1 + months;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Je okno `from`–`to` dlhšie než 3 kalendárne mesiace? */
export function windowTooLong(from: string, to: string): boolean {
  return to > addMonths(from, 3);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/* ═══════════════════════════ 3. Tvary odpovedí ═════════════════════════════ */

interface MockResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** Transportná chyba — konvencia `{error:'…'}`. */
function transport(status: number, error: string, headers?: Record<string, string>): MockResponse {
  return { status, body: { error }, headers };
}

/** Endpointová chyba — konvencia `{ok:false,errors:[…]}`. */
function failure(status: number, errors: string[]): MockResponse {
  return { status, body: { ok: false, errors } };
}

/** Odpoveď vynúteného scenára (`failNth`, `rateLimit`, …). */
function scenarioResponse(kind: MockFailureKind, retryAfterSeconds?: number): MockResponse {
  switch (kind) {
    case 'rate_limited':
      return transport(429, 'rate_limited', {
        'Retry-After': String(retryAfterSeconds ?? 30),
      });
    case 'server_error':
      return transport(500, 'request_failed');
    case 'unauthorized':
      return transport(401, 'unauthorized');
    case 'forbidden':
      return transport(403, 'forbidden');
    case 'ip_banned':
      return transport(403, 'ip_banned');
    case 'invalid_input':
      return transport(400, 'invalid_input');
    case 'not_found':
      return failure(404, ['not found']);
    case 'invalid_dates':
      return failure(400, ['invalid_dates']);
    case 'invalid_reduction':
      return failure(400, ['invalid_reduction']);
    case 'range_too_long':
      return failure(400, ['range_too_long']);
    case 'garbage':
      return { status: 200, body: { nonsense: true, data: 'not-a-list' } };
    case 'hang':
      // Rieši sa vyššie — sem sa nikdy nedostane.
      return transport(500, 'request_failed');
  }
}

/** Detail produktu v tvare `GET /api/products/get` (bez zľavy — B1, I11). */
function productDetailBody(product: MockProduct): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ok: true,
    id: product.id,
    name: product.name,
    price: product.price,
    has_attributes: product.has_attributes,
  };
  if (product.description !== undefined) body.description = product.description;
  if (product.description_short !== undefined) body.description_short = product.description_short;
  if (product.has_attributes) body.attributes = product.attributes ?? [];
  return body;
}

/* ═══════════════════════════ 4. Handler endpointov ═════════════════════════ */

interface HandlerInput {
  state: MockShopState;
  method: string;
  controller: string;
  action: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  apiKey: string | null;
  /** Beží položka vnútri `/api/batch`? Dávka nesmie byť vnorená do dávky. */
  inBatch: boolean;
}

/** `GET /api/products` — zdieľaný paginátor shopu (bare objekt, bez `ok`). */
function handleProductList(input: HandlerInput): MockResponse {
  const { state, query } = input;
  const page = Math.max(1, toNumber(query.page) ?? 1);
  const requested = toNumber(query.per_page) ?? state.defaultPerPage;
  const perPage = Math.min(Math.max(1, Math.trunc(requested)), state.maxPerPage);
  const all = state.listProducts();
  const start = (page - 1) * perPage;
  return {
    status: 200,
    body: {
      data: all.slice(start, start + perPage).map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        has_attributes: product.has_attributes,
      })),
      page,
      per_page: perPage,
      total: all.length,
    },
  };
}

/** `GET /api/products/get?id=` */
function handleProductGet(input: HandlerInput): MockResponse {
  const raw = input.query.id ?? input.body.id;
  const id = toNumber(raw);
  if (id === null || !Number.isInteger(id)) return failure(400, ['no id']);
  const product = input.state.getProduct(id);
  if (product === undefined) return failure(404, ['not found']);
  return { status: 200, body: productDetailBody(product) };
}

/**
 * Back-office polia `getFull` odvodené z mock produktu.
 *
 * `MockProduct` (v `state.ts`, ktorý táto úloha needituje) nesie len `id`,
 * `name`, `price` a `has_attributes`, takže ostatné polia mock POČÍTA — vždy
 * rovnako pre to isté `id`, aby boli asserty stabilné. Nie sú to „skutočné"
 * hodnoty shopu, ale ich TVAR aj typová tolerancia sú verné: peniaze idú ako
 * string (PHP serializuje `DECIMAL` občas takto), počty ako číslo, `active`
 * ako `1`.
 *
 * **Maržu mock nepočíta ako appka** — dáva ju hotovú, presne ako reálny shop:
 * appka ju z ceny a nákupu dopočítavať NESMIE.
 */
function productFullBody(product: MockProduct): Record<string, unknown> {
  const purchase = product.price * 0.4;
  const margin = product.price - purchase;
  const reduction = product.lastReduction ?? null;

  return {
    ...productDetailBody(product),
    // Stav zľavy — jediné miesto, kde ho mock priznáva (bod B1). `null` = zľava
    // nebeží; je to MERANÝ fakt, nie „nevieme" (I11).
    reduction_percent: reduction === null ? null : reduction.reduction,
    reduction_from: reduction === null ? null : reduction.from,
    reduction_to: reduction === null ? null : reduction.to,

    reference: `REF-${product.id}`,
    ean13: String(8_590_000_000_000 + product.id),
    purchase_price: purchase.toFixed(2),
    margin: margin.toFixed(2),
    margin_percent: ((margin / product.price) * 100).toFixed(2),
    sell_price: product.price.toFixed(2),
    sell_price_with_vat: (product.price * 1.2).toFixed(2),
    active: 1,
    date_add: '2026-01-15 09:30:00',
    last_time_in_order: '2026-08-20 14:05:00',
    qty: 10 + (product.id % 7),
    qty_in_orders: product.id % 5,
    supplier: 'Mock Supplier s.r.o.',
    categories: [2, 11],
  };
}

/**
 * `GET /api/products/getFull?id=` — prvé ČÍTANIE, ktoré nesie kľúč (v5, A1).
 *
 * Poradie kontrol je ako pri zápise: identita → scope → validácia → existencia.
 * Úspech ide v obálke `{ok:true,result:{…}}`, teda v tom tvare, ktorý
 * `unwrapShopResult()` rozbaľuje — dovtedy bol krytý len unit testom nad
 * telom, nie skutočným HTTP.
 *
 * SCOPE: `MockScope` v `state.ts` (iná úloha, needitujem) `product:read` ešte
 * nepozná, takže mock berie ako čítajúci každý kľúč, ktorý má `product:read`
 * ALEBO `product:edit`. Vetva `403 forbidden` je tým naďalej dosiahnuteľná —
 * kľúčom, ktorý má len `orders:read`.
 *
 * `ip_banned` a `429` + `Retry-After` sem NEPÍŠEM znova: `decideFailure()` ich
 * na čítacej ceste už rozhoduje pred routovaním, takže test si ich zapne cez
 * `state.ipBanned({ reads: true })` a `state.rateLimit(n)` a dopadnú aj na
 * `getFull`. Duplicitná vetva v handleri by len umožnila, aby sa obe rozišli.
 */
function handleProductGetFull(input: HandlerInput): MockResponse {
  const { state, apiKey } = input;
  if (!state.isKnownKey(apiKey)) return transport(401, 'unauthorized');

  const scopes: readonly string[] = state.scopesOf(apiKey) ?? [];
  const canRead = scopes.includes('product:read') || scopes.includes('product:edit');
  if (!canRead) return transport(403, 'forbidden');

  const id = toNumber(input.query.id ?? input.body.id);
  if (id === null || !Number.isInteger(id)) return failure(400, ['no id']);

  const product = state.getProduct(id);
  if (product === undefined) return failure(404, ['not found']);

  return { status: 200, body: { ok: true, result: productFullBody(product) } };
}

/**
 * `POST /api/products/setReduction` — jediný zápisový endpoint, ktorý appka volá.
 * Poradie kontrol kopíruje shop: identita → scope → validácia → existencia.
 */
function handleSetReduction(input: HandlerInput): MockResponse {
  const { state, apiKey, body } = input;
  if (!state.isKnownKey(apiKey)) return transport(401, 'unauthorized');
  if (!state.hasScope(apiKey, 'product:edit')) return transport(403, 'forbidden');

  const id = toNumber(body.id);
  if (id === null || !Number.isInteger(id)) return failure(400, ['no id']);

  const errors: string[] = [];
  const reduction = toNumber(body.reduction);
  if (reduction === null || reduction <= 0 || reduction > 30) errors.push('invalid_reduction');

  const from = body.from;
  const to = body.to;
  const datesValid = isValidDateOnly(from) && isValidDateOnly(to);
  if (!datesValid || (to as string) < (from as string)) errors.push('invalid_dates');
  else if (windowTooLong(from as string, to as string)) errors.push('range_too_long');

  if (errors.length > 0) return failure(400, errors);

  const product = state.getProduct(id);
  if (product === undefined) return failure(404, ['not found']);

  product.lastReduction = {
    reduction: reduction as number,
    from: from as string,
    to: to as string,
    at: Date.now(),
  };
  return { status: 200, body: { ok: true, id } };
}

/**
 * `GET /api/whoami` (API v5) — introspekcia kľúča.
 *
 * Vyžaduje AKÝKOĽVEK platný kľúč, ale ŽIADNY konkrétny scope; presne preto
 * ním appka nahradila sondu na zápisovom endpointe. Pozor na dôsledok, ktorý
 * mock musí vedieť zahrať: kľúč BEZ `product:edit` tu prejde s 200 a zoznamom
 * svojich scopes — odmietnuť ho musí až appka, nie shop.
 */
function handleWhoami(input: HandlerInput): MockResponse {
  const { state, apiKey } = input;
  const scopes = state.scopesOf(apiKey);
  if (scopes === null) return transport(401, 'unauthorized');

  return {
    status: 200,
    body: {
      ok: true,
      id: 20,
      name: 'mock-key',
      owner: null,
      expires_at: null,
      scopes,
      remaining: { per_minute: 59, per_day: 9987 },
    },
  };
}

/** `POST /api/batch` — položky bežia jedna po druhej, chyba položky dávku nezhodí. */
function handleBatch(input: HandlerInput): { response: MockResponse; items: RecordedBatchItem[] } {
  const { state, body } = input;
  const requests = objectToArray(body.requests);
  if (requests === null || requests.length === 0) {
    return { response: failure(400, ['no_requests']), items: [] };
  }
  if (requests.length > BATCH_MAX_ITEMS) {
    return { response: failure(400, ['too_many_requests']), items: [] };
  }

  const items: RecordedBatchItem[] = [];
  const results: unknown[] = [];

  for (const entry of requests) {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    const controller = typeof item.controller === 'string' ? item.controller : null;
    const action = typeof item.action === 'string' ? item.action : null;
    const method = (typeof item.method === 'string' ? item.method : 'GET').toUpperCase();
    const data =
      typeof item.data === 'object' && item.data !== null
        ? (item.data as Record<string, unknown>)
        : {};
    items.push({ controller, action, method, data });

    // Malformed položka ani vnorená dávka sa nespúšťa — chyba žije vo svojom slote.
    if (controller === null || action === null || controller === 'batch') {
      results.push({ ok: false, error: 'invalid_item' });
      continue;
    }
    if (!BATCHABLE_ACTIONS.includes(`${controller}.${action}`)) {
      results.push({ ok: false, error: 'batch_not_allowed' });
      continue;
    }

    // Každá položka je samostatný zásah do rate-limit budgetu (dokumentácia §Batch).
    state.readCount += 1;
    const sub = handleProductGet({
      ...input,
      controller,
      action,
      method,
      query: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, String(value)]),
      ),
      body: data,
      inBatch: true,
    });
    results.push(sub.body);
  }

  return { response: { status: 200, body: { ok: true, results } }, items };
}

/** Smerovanie podľa `controller`/`action`/verbu — vrátane 404/405 ciest shopu. */
function route(input: HandlerInput): { response: MockResponse; batchItems?: RecordedBatchItem[] } {
  const { controller, action, method } = input;

  if (controller === 'products') {
    if (action === 'index') {
      if (method !== 'GET') return { response: transport(405, 'method_not_allowed') };
      return { response: handleProductList(input) };
    }
    if (action === 'get') {
      if (method !== 'GET') return { response: transport(405, 'method_not_allowed') };
      return { response: handleProductGet(input) };
    }
    if (action === 'getFull') {
      if (method !== 'GET') return { response: transport(405, 'method_not_allowed') };
      return { response: handleProductGetFull(input) };
    }
    if (action === 'setReduction') {
      if (method !== 'POST') return { response: transport(405, 'method_not_allowed') };
      return { response: handleSetReduction(input) };
    }
    return { response: transport(404, 'invalid_action') };
  }

  if (controller === 'whoami') {
    if (action !== 'index') return { response: transport(404, 'invalid_action') };
    if (method !== 'GET') return { response: transport(405, 'method_not_allowed') };
    return { response: handleWhoami(input) };
  }

  if (controller === 'batch') {
    if (action !== 'index') return { response: transport(404, 'invalid_action') };
    if (method !== 'POST') return { response: transport(405, 'method_not_allowed') };
    const { response, items } = handleBatch(input);
    return { response, batchItems: items };
  }

  // `/api/order/*` a `/api/cart/*` mock ÚMYSELNE nepozná: appka ich nesmie volať
  // (I8), takže by ich implementácia len umožnila napísať test na zakázanú cestu.
  return { response: transport(404, 'unknown_controller') };
}

/* ═══════════════════════════ 5. HTTP server ════════════════════════════════ */

export interface MockShopServer {
  /** `http://127.0.0.1:<port>` — hodnota pre `SHOP_BASE_URL_OVERRIDE`. */
  readonly baseUrl: string;
  readonly port: number;
  readonly state: MockShopState;
  /** Ukončí server a zhodí aj spojenia visiace na `hangWrite()`. */
  close(): Promise<void>;
}

export interface StartMockShopOptions extends MockShopStateOptions {
  /** Existujúci stav (napr. zdieľaný medzi testami v súbore). */
  state?: MockShopState;
}

function headerString(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : value;
}

function extractApiKey(req: IncomingMessage): string | null {
  const direct = headerString(req.headers['x-api-key']).trim();
  if (direct.length > 0) return direct;
  const auth = headerString(req.headers.authorization).trim();
  if (/^bearer\s+/i.test(auth)) {
    const token = auth.replace(/^bearer\s+/i, '').trim();
    if (token.length > 0) return token;
  }
  return null;
}

async function readBody(req: IncomingMessage): Promise<{ raw: string; tooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ raw: Buffer.concat(chunks).toString('utf8'), tooLarge }));
    req.on('error', reject);
  });
}

/**
 * Spustí mock shop. Port je ephemeral (0) a host vždy `127.0.0.1` — testy tak
 * nemajú ako siahnuť na reálnu doménu (I6).
 */
export async function startMockShop(
  options: StartMockShopOptions = {},
): Promise<MockShopServer> {
  const state = options.state ?? new MockShopState(options);
  const sockets = new Set<Socket>();
  /** Odpovede, ktoré `hangWrite()` nechal visieť — pri `close()` sa zahodia. */
  const hanging = new Set<ServerResponse>();

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const startedAt = performance.now();
    const url = new URL(req.url ?? '/', `http://${MOCK_HOST}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const segments = path.split('/').filter((segment) => segment.length > 0);
    const method = (req.method ?? 'GET').toUpperCase();

    const { raw, tooLarge } = await readBody(req);
    const body = parseBody(raw, headerString(req.headers['content-type']) || undefined);
    const apiKey = extractApiKey(req);

    const controller = segments[0] === 'api' ? (segments[1] ?? '') : '';
    const action = segments[0] === 'api' ? (segments[2] ?? 'index') : '';
    const isWrite = controller === 'products' && action === 'setReduction';

    state.requestCount += 1;
    if (isWrite) state.writeCount += 1;
    else state.readCount += 1;

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      headers[name.toLowerCase()] = headerString(value);
    }

    const record: RecordedRequest = {
      seq: state.requestCount,
      method,
      path,
      url: req.url ?? path,
      query: Object.fromEntries(url.searchParams),
      headers,
      apiKey,
      rawBody: raw,
      body,
      at: Date.now(),
      atMonotonic: startedAt,
      atIso: new Date().toISOString(),
      isWrite,
    };
    state.recordedRequests.push(record);

    const send = (response: MockResponse): void => {
      record.responseStatus = response.status;
      record.responseBody = response.body;
      record.durationMs = performance.now() - startedAt;
      if (res.writableEnded) return;
      res.writeHead(response.status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...(response.headers ?? {}),
      });
      res.end(JSON.stringify(response.body));
    };

    if (state.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    }

    // Iba `/api/*` je územie shopu; čokoľvek iné je zlý controller.
    if (segments[0] !== 'api' || controller.length === 0) {
      send(transport(404, 'unknown_controller'));
      return;
    }

    if (tooLarge || body._malformed === true) {
      send(transport(400, 'invalid_input'));
      return;
    }

    const forced = state.decideFailure({
      isWrite,
      seq: record.seq,
      targetSeq: isWrite ? state.writeCount : state.readCount,
    });

    if (forced !== null) {
      if (forced.kind === 'hang') {
        // D45: požiadavka je PRIJATÁ a zápis sa vykoná — len odpoveď nepríde.
        // Presne toto musí appka vyhodnotiť ako `uncertain`, nikdy ako „nič sa nestalo".
        handleSetReduction({
          state,
          method,
          controller,
          action,
          query: record.query,
          body,
          apiKey,
          inBatch: false,
        });
        hanging.add(res);
        res.on('close', () => hanging.delete(res));
        return;
      }
      send(scenarioResponse(forced.kind, forced.retryAfterSeconds));
      return;
    }

    const routed = route({
      state,
      method,
      controller,
      action,
      query: record.query,
      body,
      apiKey,
      inBatch: false,
    });
    if (routed.batchItems !== undefined) record.batchItems = routed.batchItems;
    send(routed.response);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, MOCK_HOST, () => resolve());
  });

  const address = server.address() as AddressInfo;
  const port = address.port;

  return {
    baseUrl: `http://${MOCK_HOST}:${port}`,
    port,
    state,
    async close(): Promise<void> {
      for (const res of hanging) res.destroy();
      hanging.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
