/**
 * Aura Zľavy — SMOKE TEST MOCK SHOPU (A6, BUILD-SPEC §12).
 *
 * Pre každý endpoint porovná odpoveď mocku s príkladmi v `docs/api/sperky-api.md`
 * a overí programovateľné scenáre. Bez tohto testu by ostatné úlohy stavali
 * integračné testy na neverifikovanom mocku.
 *
 * Zvlášť sa overuje aj to, čo mock garantuje invariantom:
 *   - I6 — mock beží výhradne na `127.0.0.1`,
 *   - I1 — `recordedRequests[]` uchová hlavičky vrátane `x-api-key`,
 *   - I10 — každý záznam má monotónny timestamp, takže sa dá zmerať tempo.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PRODUCT_123, TEN_PRODUCTS, VALID_API_KEY, NO_SCOPE_API_KEY } from './fixtures';
import { MOCK_PATHS, startMockShop, windowTooLong } from './server';
import type { MockShopServer } from './server';

let mock: MockShopServer;

beforeEach(async () => {
  mock = await startMockShop({
    products: [PRODUCT_123, ...TEN_PRODUCTS],
    keys: [
      { key: VALID_API_KEY, scopes: ['product:edit'] },
      { key: NO_SCOPE_API_KEY, scopes: [] },
    ],
  });
});

afterEach(async () => {
  await mock.close();
});

function url(path: string, query: Record<string, string> = {}): string {
  const u = new URL(path, mock.baseUrl);
  for (const [key, value] of Object.entries(query)) u.searchParams.set(key, value);
  return u.toString();
}

async function form(
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(url(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

describe('mock shop — bind a základné garancie', () => {
  it('beží výhradne na 127.0.0.1 (I6)', () => {
    expect(mock.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(mock.port).toBeGreaterThan(0);
  });
});

describe('GET /api/products', () => {
  it('vracia data/page/per_page/total podľa dokumentácie', async () => {
    const res = await fetch(url(MOCK_PATHS.productList));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['data', 'page', 'per_page', 'total']);
    expect(body.page).toBe(1);
    expect(body.per_page).toBe(50);
    expect(body.total).toBe(11);
    const first = (body.data as Array<Record<string, unknown>>)[0];
    expect(Object.keys(first).sort()).toEqual(['has_attributes', 'id', 'name', 'price']);
  });

  it('stránkuje a `per_page` stropuje na 100', async () => {
    const res = await fetch(url(MOCK_PATHS.productList, { page: '2', per_page: '5' }));
    const body = (await res.json()) as { data: unknown[]; page: number; per_page: number };
    expect(body.page).toBe(2);
    expect(body.data).toHaveLength(5);

    const capped = await fetch(url(MOCK_PATHS.productList, { per_page: '500' }));
    expect(((await capped.json()) as { per_page: number }).per_page).toBe(100);
  });

  it('POST na list vracia 405 method_not_allowed', async () => {
    const res = await form(MOCK_PATHS.productList, {});
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'method_not_allowed' });
  });

  it('nikdy nevracia stav zľavy (backlog B1, I11)', async () => {
    await form(
      MOCK_PATHS.setReduction,
      { id: '123', from: '2026-08-05', to: '2026-09-05', reduction: '15' },
      { 'X-Api-Key': VALID_API_KEY },
    );
    const res = await fetch(url(MOCK_PATHS.productGet, { id: '123' }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).some((k) => k.startsWith('reduction'))).toBe(false);
    // Test však stav zľavy vidí — priamo v stave mocku.
    expect(mock.state.getProduct(123)?.lastReduction?.reduction).toBe(15);
  });
});

describe('GET /api/products/get', () => {
  it('vracia detail v dokumentovanom tvare', async () => {
    const res = await fetch(url(MOCK_PATHS.productGet, { id: '123' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      id: 123,
      name: 'Product name',
      price: 19.99,
      has_attributes: true,
      description: '<p>Full HTML description</p>',
      description_short: 'Short description',
      attributes: PRODUCT_123.attributes,
    });
  });

  it('bez `id` vracia 400 {ok:false,errors:["no id"]}', async () => {
    const res = await fetch(url(MOCK_PATHS.productGet));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, errors: ['no id'] });
  });

  it('neznámy produkt vracia 404 {ok:false,errors:["not found"]}', async () => {
    const res = await fetch(url(MOCK_PATHS.productGet, { id: '999999' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, errors: ['not found'] });
  });
});

describe('POST /api/products/setReduction', () => {
  const ok = { id: '201', from: '2026-08-05', to: '2026-09-05', reduction: '15' };

  it('úspech vracia {ok:true,id}', async () => {
    const res = await form(MOCK_PATHS.setReduction, ok, { 'X-Api-Key': VALID_API_KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 201 });
    expect(mock.state.getProduct(201)?.lastReduction).toMatchObject({
      reduction: 15,
      from: '2026-08-05',
      to: '2026-09-05',
    });
  });

  it('prijme aj `Authorization: Bearer` a JSON telo', async () => {
    const res = await fetch(url(MOCK_PATHS.setReduction), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VALID_API_KEY}`,
      },
      body: JSON.stringify({ id: 202, from: '2026-08-05', to: '2026-08-06', reduction: 10 }),
    });
    expect(await res.json()).toEqual({ ok: true, id: 202 });
  });

  it('bez kľúča 401 unauthorized, s kľúčom bez scope 403 forbidden', async () => {
    const noKey = await form(MOCK_PATHS.setReduction, ok);
    expect(noKey.status).toBe(401);
    expect(await noKey.json()).toEqual({ error: 'unauthorized' });

    const noScope = await form(MOCK_PATHS.setReduction, ok, { 'X-Api-Key': NO_SCOPE_API_KEY });
    expect(noScope.status).toBe(403);
    expect(await noScope.json()).toEqual({ error: 'forbidden' });
  });

  it('validuje reduction 0 < x ≤ 30 a kombinuje chyby', async () => {
    for (const reduction of ['0', '31', '-5']) {
      const res = await form(
        MOCK_PATHS.setReduction,
        { ...ok, reduction },
        { 'X-Api-Key': VALID_API_KEY },
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, errors: ['invalid_reduction'] });
    }

    const combined = await form(
      MOCK_PATHS.setReduction,
      { id: '201', from: '2026-09-05', to: '2026-08-05', reduction: '99' },
      { 'X-Api-Key': VALID_API_KEY },
    );
    expect(combined.status).toBe(400);
    expect(await combined.json()).toEqual({
      ok: false,
      errors: ['invalid_reduction', 'invalid_dates'],
    });
  });

  it('okno nad 3 kalendárne mesiace je range_too_long', async () => {
    expect(windowTooLong('2026-01-31', '2026-04-30')).toBe(false);
    expect(windowTooLong('2026-01-31', '2026-05-01')).toBe(true);

    const res = await form(
      MOCK_PATHS.setReduction,
      { id: '201', from: '2026-08-05', to: '2026-12-05', reduction: '15' },
      { 'X-Api-Key': VALID_API_KEY },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, errors: ['range_too_long'] });
  });

  it('neznámy produkt 404 not found; GET na zápis 405', async () => {
    const missing = await form(
      MOCK_PATHS.setReduction,
      { ...ok, id: '999999' },
      { 'X-Api-Key': VALID_API_KEY },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, errors: ['not found'] });

    const wrongVerb = await fetch(url(MOCK_PATHS.setReduction));
    expect(wrongVerb.status).toBe(405);
  });
});

describe('POST /api/batch', () => {
  it('vracia positional results v tvare cieľového endpointu', async () => {
    const res = await form(MOCK_PATHS.batch, {
      'requests[0][controller]': 'products',
      'requests[0][action]': 'get',
      'requests[0][data][id]': '123',
      'requests[1][controller]': 'products',
      'requests[1][action]': 'get',
      'requests[1][data][id]': '999999',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; results: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.results[0]).toMatchObject({ ok: true, id: 123, name: 'Product name' });
    expect(body.results[1]).toEqual({ ok: false, errors: ['not found'] });
  });

  it('setReduction v dávke dostane batch_not_allowed vo svojom slote', async () => {
    const res = await form(MOCK_PATHS.batch, {
      'requests[0][controller]': 'products',
      'requests[0][action]': 'setReduction',
      'requests[0][method]': 'POST',
      'requests[0][data][id]': '201',
      'requests[1][controller]': 'products',
      'requests[1][action]': 'get',
      'requests[1][data][id]': '123',
    });
    const body = (await res.json()) as { results: Array<Record<string, unknown>> };
    expect(body.results[0]).toEqual({ ok: false, error: 'batch_not_allowed' });
    // Chyba položky dávku nezhodí.
    expect(body.results[1]).toMatchObject({ ok: true, id: 123 });
  });

  it('malformed položka a vnorená dávka končia ako invalid_item', async () => {
    const res = await form(MOCK_PATHS.batch, {
      'requests[0][action]': 'get',
      'requests[1][controller]': 'batch',
      'requests[1][action]': 'index',
    });
    const body = (await res.json()) as { results: unknown[] };
    expect(body.results).toEqual([
      { ok: false, error: 'invalid_item' },
      { ok: false, error: 'invalid_item' },
    ]);
  });

  it('prázdna dávka je no_requests, nad 25 položiek too_many_requests', async () => {
    const empty = await form(MOCK_PATHS.batch, {});
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ ok: false, errors: ['no_requests'] });

    const tooMany: Record<string, string> = {};
    for (let i = 0; i < 26; i += 1) {
      tooMany[`requests[${i}][controller]`] = 'products';
      tooMany[`requests[${i}][action]`] = 'get';
      tooMany[`requests[${i}][data][id]`] = '123';
    }
    const res = await form(MOCK_PATHS.batch, tooMany);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, errors: ['too_many_requests'] });
  });
});

describe('smerovacie chyby', () => {
  it('unknown_controller a invalid_action', async () => {
    const controller = await fetch(url('/api/nieco'));
    expect(controller.status).toBe(404);
    expect(await controller.json()).toEqual({ error: 'unknown_controller' });

    const action = await fetch(url('/api/products/neexistuje'));
    expect(action.status).toBe(404);
    expect(await action.json()).toEqual({ error: 'invalid_action' });
  });

  it('/api/order neexistuje — appka ho volať nesmie (I8)', async () => {
    const res = await fetch(url('/api/order'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_controller' });
  });
});

describe('programovateľné scenáre', () => {
  it('rateLimit vracia 429 s hlavičkou Retry-After', async () => {
    mock.state.rateLimit(42);
    const res = await fetch(url(MOCK_PATHS.productList));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect(await res.json()).toEqual({ error: 'rate_limited' });
  });

  it('unauthorizedAfter(n) prepne na 401 po n-tej požiadavke', async () => {
    mock.state.unauthorizedAfter(2);
    expect((await fetch(url(MOCK_PATHS.productList))).status).toBe(200);
    expect((await fetch(url(MOCK_PATHS.productList))).status).toBe(200);
    const third = await fetch(url(MOCK_PATHS.productList));
    expect(third.status).toBe(401);
    expect(await third.json()).toEqual({ error: 'unauthorized' });
  });

  it('failNth(n, kind) zhodí presne n-tý zápis', async () => {
    mock.state.failNth(2, 'server_error');
    const body = (id: string) => ({ id, from: '2026-08-05', to: '2026-08-10', reduction: '15' });
    const first = await form(MOCK_PATHS.setReduction, body('201'), {
      'X-Api-Key': VALID_API_KEY,
    });
    const second = await form(MOCK_PATHS.setReduction, body('202'), {
      'X-Api-Key': VALID_API_KEY,
    });
    const third = await form(MOCK_PATHS.setReduction, body('203'), {
      'X-Api-Key': VALID_API_KEY,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(500);
    expect(await second.json()).toEqual({ error: 'request_failed' });
    expect(third.status).toBe(200);
    // Zlyhaný zápis sa NEODRAZIL v stave.
    expect(mock.state.getProduct(202)?.lastReduction).toBeNull();
  });

  it('forbidden() zhodí zápis, čítanie nechá', async () => {
    mock.state.forbidden();
    expect((await fetch(url(MOCK_PATHS.productList))).status).toBe(200);
    const write = await form(
      MOCK_PATHS.setReduction,
      { id: '201', from: '2026-08-05', to: '2026-08-10', reduction: '15' },
      { 'X-Api-Key': VALID_API_KEY },
    );
    expect(write.status).toBe(403);
  });

  it('returnGarbage() vracia HTTP 200 s nesmyselným tvarom (D54)', async () => {
    mock.state.returnGarbage();
    const res = await fetch(url(MOCK_PATHS.productList));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nonsense: true, data: 'not-a-list' });
  });

  it('hangWrite() zápis vykoná, ale odpoveď nepošle (D45)', async () => {
    mock.state.hangWrite();
    const controller = new AbortController();
    const pending = fetch(url(MOCK_PATHS.setReduction), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Api-Key': VALID_API_KEY,
      },
      body: new URLSearchParams({
        id: '201',
        from: '2026-08-05',
        to: '2026-08-10',
        reduction: '20',
      }).toString(),
      signal: controller.signal,
    });
    // Klientský „timeout" — presne to, čo appka vyhodnotí ako `uncertain`.
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(mock.state.getProduct(201)?.lastReduction?.reduction).toBe(20);
    expect(mock.state.writeRequests()).toHaveLength(1);
    expect(mock.state.writeRequests()[0].responseStatus).toBeUndefined();
  });

  it('delay(ms) zdrží odpoveď', async () => {
    mock.state.delay(120);
    const started = performance.now();
    await fetch(url(MOCK_PATHS.productList));
    expect(performance.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('changePrice() zmení cenu medzi dvoma GETmi (D39c)', async () => {
    const before = (await (await fetch(url(MOCK_PATHS.productGet, { id: '201' }))).json()) as {
      price: number;
    };
    const previous = mock.state.changePrice(201, before.price + 5);
    expect(previous).toBe(before.price);
    const after = (await (await fetch(url(MOCK_PATHS.productGet, { id: '201' }))).json()) as {
      price: number;
    };
    expect(after.price).toBe(before.price + 5);
  });
});

describe('recordedRequests[] (I1, I10)', () => {
  it('zaznamená hlavičky vrátane X-Api-Key, telo aj timestampy', async () => {
    await form(
      MOCK_PATHS.setReduction,
      { id: '201', from: '2026-08-05', to: '2026-08-10', reduction: '15' },
      { 'X-Api-Key': VALID_API_KEY, 'X-Request-Id': 'RID-1' },
    );
    const [record] = mock.state.writeRequests();
    expect(record.headers['x-api-key']).toBe(VALID_API_KEY);
    expect(record.headers['x-request-id']).toBe('RID-1');
    expect(record.apiKey).toBe(VALID_API_KEY);
    expect(record.body).toMatchObject({ id: '201', reduction: '15' });
    expect(record.at).toBeGreaterThan(0);
    expect(record.atIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.responseStatus).toBe(200);
    expect(mock.state.seenApiKeys()).toEqual([VALID_API_KEY]);
  });

  it('meria odstupy medzi zápismi, takže sa dá overiť tempo 250 ms (I10)', async () => {
    const write = async (id: string): Promise<void> => {
      await form(
        MOCK_PATHS.setReduction,
        { id, from: '2026-08-05', to: '2026-08-10', reduction: '15' },
        { 'X-Api-Key': VALID_API_KEY },
      );
    };
    await write('201');
    await new Promise((resolve) => setTimeout(resolve, 260));
    await write('202');

    const gaps = mock.state.writeGapsMs();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toBeGreaterThanOrEqual(250);
    expect(mock.state.keyLeakedToReads()).toBe(false);
  });

  it('reset() vyčistí históriu aj scenáre', async () => {
    mock.state.rateLimit(10);
    await fetch(url(MOCK_PATHS.productList));
    expect(mock.state.recordedRequests).toHaveLength(1);
    mock.state.reset();
    expect(mock.state.recordedRequests).toHaveLength(0);
    expect(mock.state.rateLimitRetryAfter).toBeNull();
    expect((await fetch(url(MOCK_PATHS.productList))).status).toBe(200);
  });
});
