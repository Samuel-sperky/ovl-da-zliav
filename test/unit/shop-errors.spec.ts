/**
 * Aura Zľavy — taxonómia chýb shopu, tvary odpovedí a hlavičky (A3).
 *
 * Overuje akceptačné kritérium A3:
 *   - taxonómia presne podľa BUILD-SPEC §6 (retryable / terminal / uncertain),
 *   - obe tvarové konvencie shopu (`{ok:false,errors:[…]}` aj `{error:'…'}`),
 *   - HTTP 200 s `ok:false` NIKDY nie je úspech,
 *   - HTTP 200 s tvarom, ktorý neprejde zod, je `schema_drift` → `uncertain`,
 *   - `batchGetProducts` padá na jednotlivé GETy pri `batch_not_allowed`
 *     aj pri chybe celého batchu,
 *   - `X-Api-Key` sa posiela LEN pri `setReduction` a `probeKey`,
 *   - lokálna validácia (I9) a zákaz zápisu s `to` v minulosti (I7),
 *   - I8: modul nepozná objednávkové endpointy ani ich scope.
 *
 * Beží výhradne s fake fetch — žiadny request neopustí proces (I6).
 *
 * Vlastník: A3.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { SecretRef, ShopClient, ShopCtx } from '@/contracts';

import { setActiveSecretForScan, resetRedactionState } from '@/lib/log/redact';
import {
  RETRYABLE_KINDS,
  SHOP_ERROR_KINDS,
  TERMINAL_KINDS,
  UNCERTAIN_KINDS,
  ShopRequestError,
  classifyFailure,
  classifyTransportFailure,
  isRetryableKind,
  isShopError,
  makeShopError,
} from '@/lib/shop/errors';
import {
  BATCH_MAX_ITEMS,
  SHOP_PATHS,
  addMonthsDateOnly,
  createShopClient,
  normalizeShopBaseUrl,
  setReductionPayload,
  todayInTimeZone,
  validateWriteParams,
  type FetchLike,
} from '@/lib/shop/client';
import { CODE_MESSAGES, shopMessageText } from '@/lib/shop/messages.sk';
import { bodySignalsFailure, readErrorBody } from '@/lib/shop/schemas';
import { isUlid, newOperationContext } from '@/lib/shop/correlation';

/* ═════════════════════════ 0. Testovací harness ═══════════════════════════ */

/** Loopback base URL — ani omylom sa nedá trafiť reálna doména (I6). */
const BASE = 'https://127.0.0.1:8443';

const TEST_KEY = 'TESTKEY-abc123deadbeef99';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

type Handler = (req: Recorded, index: number) => Response | Promise<Response>;

interface Harness {
  fetchImpl: FetchLike;
  calls: Recorded[];
}

function harness(handlers: Handler | Handler[]): Harness {
  const list = Array.isArray(handlers) ? handlers : [handlers];
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    const record: Recorded = {
      url: input,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : null,
    };
    const index = calls.length;
    calls.push(record);
    const handler = list[Math.min(index, list.length - 1)];
    return handler(record, index);
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

interface FakeKey {
  ref: SecretRef;
  releases: number;
  zeroed: boolean[];
}

function fakeKey(value = TEST_KEY): FakeKey {
  const state: FakeKey = {
    releases: 0,
    zeroed: [],
    ref: async () => {
      const buf = Buffer.from(value, 'utf8');
      return {
        value: buf,
        release: () => {
          buf.fill(0);
          state.releases += 1;
          state.zeroed.push(buf.every((b) => b === 0));
        },
      };
    },
  };
  return state;
}

function client(fetchImpl: FetchLike, extra: Partial<Parameters<typeof createShopClient>[0]> = {}): ShopClient {
  return createShopClient({
    baseUrl: BASE,
    fetchImpl,
    version: '0.0.0-test',
    readTimeoutMs: 5000,
    writeTimeoutMs: 5000,
    timeZone: 'Europe/Bratislava',
    sleepFn: async () => {},
    policy: { maxAttempts: 3, retryAfterCapSeconds: 90, backoffMs: [1, 1, 1] },
    ...extra,
  });
}

const ctx = (): ShopCtx => newOperationContext();

/** Zľava, ktorá je vždy v budúcnosti a v okne ≤ 3 mesiace. */
function futureWindow(): { from: string; to: string } {
  const today = todayInTimeZone('Europe/Bratislava');
  return { from: today, to: addMonthsDateOnly(today, 1) };
}

/* ═══════════════════ 1. Taxonómia druhov chýb (D41, §6) ═══════════════════ */

describe('taxonómia chýb (D41, BUILD-SPEC §6)', () => {
  it('pozná presne 11 druhov zo špecifikácie', () => {
    expect([...SHOP_ERROR_KINDS].sort()).toEqual(
      [
        'bad_request',
        'batch_not_allowed',
        'forbidden',
        'network',
        'not_found',
        'rate_limited',
        'schema_drift',
        'server_error',
        'timeout_after',
        'timeout_before',
        'unauthorized',
      ].sort(),
    );
  });

  it('retryable = 429 / 500 / network / timeout_before', () => {
    expect([...RETRYABLE_KINDS].sort()).toEqual(
      ['network', 'rate_limited', 'server_error', 'timeout_before'].sort(),
    );
  });

  it('terminal = 400 / 401 / 403 / 404 / batch_not_allowed a nikdy sa neopakuje', () => {
    for (const kind of TERMINAL_KINDS) expect(isRetryableKind(kind)).toBe(false);
    expect(TERMINAL_KINDS.has('bad_request')).toBe(true);
    expect(TERMINAL_KINDS.has('unauthorized')).toBe(true);
    expect(TERMINAL_KINDS.has('forbidden')).toBe(true);
    expect(TERMINAL_KINDS.has('not_found')).toBe(true);
  });

  it('uncertain = timeout_after + schema_drift a ani jeden nie je retryable', () => {
    expect([...UNCERTAIN_KINDS].sort()).toEqual(['schema_drift', 'timeout_after'].sort());
    expect(isRetryableKind('timeout_after')).toBe(false);
    expect(isRetryableKind('schema_drift')).toBe(false);
  });

  it('každý druh je zaradený do práve jednej kategórie dôsledku', () => {
    for (const kind of SHOP_ERROR_KINDS) {
      const categories = [RETRYABLE_KINDS.has(kind), TERMINAL_KINDS.has(kind), UNCERTAIN_KINDS.has(kind)];
      expect(categories.filter(Boolean)).toHaveLength(1);
    }
  });

  it('mapuje HTTP status na druh chyby', () => {
    expect(classifyFailure(429)).toBe('rate_limited');
    expect(classifyFailure(500)).toBe('server_error');
    expect(classifyFailure(503)).toBe('server_error');
    expect(classifyFailure(400, ['invalid_dates'])).toBe('bad_request');
    expect(classifyFailure(401, ['unauthorized'])).toBe('unauthorized');
    expect(classifyFailure(403, ['forbidden'])).toBe('forbidden');
    expect(classifyFailure(404, ['not found'])).toBe('not_found');
    expect(classifyFailure(405, ['method_not_allowed'])).toBe('bad_request');
    expect(classifyFailure(403, ['batch_not_allowed'])).toBe('batch_not_allowed');
    // „not found" pri HTTP 200 (staršia konvencia) je stále not_found.
    expect(classifyFailure(200, ['not found'])).toBe('not_found');
  });

  it('sieťová chyba je network, timeout pri čítaní timeout_before a pri zápise timeout_after', () => {
    const abort = new DOMException('aborted', 'TimeoutError');
    expect(classifyTransportFailure(abort, 'read')).toBe('timeout_before');
    expect(classifyTransportFailure(abort, 'write')).toBe('timeout_after');
    // Zrušenie ešte pred odoslaním nie je neistý stav.
    expect(classifyTransportFailure(abort, 'write', { alreadyAborted: true })).toBe('timeout_before');

    const dns = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }),
    });
    expect(classifyTransportFailure(dns, 'write')).toBe('network');
    expect(classifyTransportFailure(new TypeError('fetch failed'), 'read')).toBe('network');
  });

  it('makeShopError odvodí retryable z taxonómie a redaguje raw (I1)', () => {
    resetRedactionState();
    setActiveSecretForScan(TEST_KEY);
    try {
      const error = makeShopError({
        kind: 'server_error',
        code: 'request_failed',
        httpStatus: 500,
        raw: { echo: `X-Api-Key: ${TEST_KEY}` },
      });
      expect(error.retryable).toBe(true);
      expect(JSON.stringify(error.raw)).not.toContain(TEST_KEY);
      expect(JSON.stringify(error.raw)).not.toContain(TEST_KEY.slice(-8));
      expect(isShopError(error)).toBe(true);
    } finally {
      resetRedactionState();
    }
  });
});

/* ══════════════════ 2. Slovenské hlášky a raw kódy (D47) ══════════════════ */

describe('hlášky (D47)', () => {
  it('známy kód má slovenskú vetu s odporúčaním', () => {
    const text = shopMessageText('bad_request', 'range_too_long');
    expect(text).toContain('3 mesiace');
    expect(text.length).toBeGreaterThan(20);
  });

  it('neznámy kód sa zobrazí SUROVO a nemaskuje sa', () => {
    const text = shopMessageText('bad_request', 'zahadny_novy_kod');
    expect(text).toContain('zahadny_novy_kod');
  });

  it('`not found` s medzerou má rovnakú hlášku ako `not_found`', () => {
    expect(shopMessageText('not_found', 'not found')).toBe(shopMessageText('not_found', 'not_found'));
  });

  it('hláška pre 403 hovorí o scope product:edit (D52)', () => {
    expect(CODE_MESSAGES.forbidden.message).toContain('product:edit');
  });
});

/* ═══════════════ 3. Obe tvarové konvencie shopu (§6, D54) ═════════════════ */

describe('tvary odpovedí shopu (§6)', () => {
  it('číta `{ok:false,errors:[…]}`, `{ok:false,error:"…"}` aj `{error:"…"}`', () => {
    expect(readErrorBody({ ok: false, errors: ['invalid_dates', 'invalid_reduction'] }).codes).toEqual([
      'invalid_dates',
      'invalid_reduction',
    ]);
    expect(readErrorBody({ ok: false, error: 'not found' }).codes).toEqual(['not found']);
    expect(readErrorBody({ error: 'rate_limited' }).codes).toEqual(['rate_limited']);
    expect(readErrorBody({ ok: true, id: 1 }).codes).toEqual([]);
  });

  it('`ok:false` je neúspech aj pri HTTP 200', () => {
    expect(bodySignalsFailure({ ok: false, errors: ['invalid_dates'] })).toBe(true);
    expect(bodySignalsFailure({ error: 'not found' })).toBe(true);
    expect(bodySignalsFailure({ ok: true, id: 5 })).toBe(false);
    expect(bodySignalsFailure({ data: [], page: 1, per_page: 1, total: 0 })).toBe(false);
  });

  it('HTTP 200 s `ok:false` pri zápise NIE JE úspech', async () => {
    const h = harness(() => json({ ok: false, errors: ['invalid_dates'] }, 200));
    const shop = client(h.fetchImpl);
    const key = fakeKey();
    const result = await shop.setReduction(
      { id: 123, reduction: 15, ...futureWindow() },
      key.ref,
      ctx(),
    );
    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') {
      expect(result.error.kind).toBe('bad_request');
      expect(result.error.code).toBe('invalid_dates');
    }
  });

  it('HTTP 200 v nečakanom tvare je schema_drift → uncertain (D54)', async () => {
    const drift = vi.fn();
    const h = harness(() => json({ ok: true, produkt: 'nieco ine' }, 200));
    const shop = client(h.fetchImpl, { onSchemaDrift: drift });
    const result = await shop.setReduction(
      { id: 123, reduction: 15, ...futureWindow() },
      fakeKey().ref,
      ctx(),
    );
    expect(result.outcome).toBe('uncertain');
    if (result.outcome === 'uncertain') expect(result.error.kind).toBe('schema_drift');
    expect(drift).toHaveBeenCalledTimes(1);
    // Drift sa NEOPAKUJE (nie je retryable).
    expect(h.calls).toHaveLength(1);
  });

  it('HTTP 200 s nečitateľným JSON je schema_drift pri čítaní', async () => {
    const h = harness(() => new Response('<html>500</html>', { status: 200 }));
    const shop = client(h.fetchImpl);
    await expect(shop.getProduct(123, ctx())).rejects.toMatchObject({
      shopError: { kind: 'schema_drift' },
    });
  });

  it('tolerantne prijme cenu ako string a `has_attributes` ako 0/1', async () => {
    const h = harness(() =>
      json({ ok: true, id: 7, name: 'Prsteň', price: '19.99', has_attributes: 1 }),
    );
    const detail = await client(h.fetchImpl).getProduct(7, ctx());
    expect(detail).toMatchObject({ id: 7, price: 19.99, has_attributes: true });
  });

  it('chýbajúce povinné pole je schema_drift, nie úspech', async () => {
    const h = harness(() => json({ ok: true, id: 7, price: 19.99, has_attributes: false }));
    await expect(client(h.fetchImpl).getProduct(7, ctx())).rejects.toBeInstanceOf(ShopRequestError);
  });
});

/* ═════════════ 4. `X-Api-Key` len pri zápise a sonde (D48, D53) ═══════════ */

describe('hlavičky a kľúč (D48, D53, D58, I1)', () => {
  it('čítacie volania NEPOSIELAJÚ X-Api-Key', async () => {
    const h = harness([
      () => json({ data: [], page: 1, per_page: 50, total: 0 }),
      () => json({ ok: true, id: 1, name: 'A', price: 1, has_attributes: false }),
      () => json({ ok: true, results: [{ ok: true, id: 1, name: 'A', price: 1, has_attributes: false }] }),
      () => json({ data: [], page: 1, per_page: 1, total: 3 }),
    ]);
    const shop = client(h.fetchImpl);
    const c = ctx();
    await shop.listProducts({ page: 1, perPage: 50 }, c);
    await shop.getProduct(1, c);
    await shop.batchGetProducts([1], c);
    await shop.canary(c);

    expect(h.calls).toHaveLength(4);
    for (const call of h.calls) {
      expect(call.headers['x-api-key']).toBeUndefined();
      expect(call.headers.authorization).toBeUndefined();
      expect(call.headers['user-agent']).toBe('aura-zlavy/0.0.0-test');
      expect(isUlid(call.headers['x-request-id'])).toBe(true);
    }
  });

  it('setReduction a probeKey posielajú X-Api-Key a kľúč hneď wipnú (D64)', async () => {
    const h = harness([
      () => json({ ok: true, id: 123 }),
      () => json({ ok: false, errors: ['invalid_reduction'] }, 400),
    ]);
    const shop = client(h.fetchImpl);
    const key = fakeKey();

    const write = await shop.setReduction({ id: 123, reduction: 15, ...futureWindow() }, key.ref, ctx());
    expect(write.outcome).toBe('ok');

    const probe = await shop.probeKey(key.ref, ctx());
    expect(probe).toBe('valid');

    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) {
      expect(call.headers['x-api-key']).toBe(TEST_KEY);
      expect(call.method).toBe('POST');
      expect(call.url).toContain(SHOP_PATHS.setReduction);
    }
    expect(key.releases).toBe(2);
    expect(key.zeroed).toEqual([true, true]);
  });

  it('sonda posiela reduction=0 a neexistujúce id — nikdy nič nezapíše (D53)', async () => {
    const h = harness(() => json({ ok: false, errors: ['invalid_reduction'] }, 400));
    await client(h.fetchImpl).probeKey(fakeKey().ref, ctx());
    const body = new URLSearchParams(h.calls[0].body ?? '');
    expect(body.get('reduction')).toBe('0');
    expect(body.get('id')).toBe('0');
  });

  it('sonda mapuje odpovede fail-closed', async () => {
    const cases: Array<[Response, string]> = [
      [json({ ok: false, errors: ['invalid_reduction'] }, 400), 'valid'],
      [json({ ok: false, errors: ['not found'] }, 404), 'valid'],
      [json({ error: 'unauthorized' }, 401), 'invalid'],
      [json({ error: 'forbidden' }, 403), 'forbidden'],
      [json({ error: 'request_failed' }, 500), 'unknown'],
      [json({ ok: true, id: 0 }, 200), 'unknown'],
    ];
    for (const [response, expected] of cases) {
      const h = harness(() => response.clone());
      expect(await client(h.fetchImpl).probeKey(fakeKey().ref, ctx())).toBe(expected);
    }
  });

  it('401 a 403 pri zápise ohlásia odmietnutie kľúča (D51, D52)', async () => {
    for (const [status, kind] of [
      [401, 'unauthorized'],
      [403, 'forbidden'],
    ] as const) {
      const onKeyRejected = vi.fn();
      const h = harness(() => json({ error: kind }, status));
      const shop = client(h.fetchImpl, { onKeyRejected });
      const result = await shop.setReduction(
        { id: 123, reduction: 20, ...futureWindow() },
        fakeKey().ref,
        ctx(),
      );
      expect(result.outcome).toBe('failed');
      expect(onKeyRejected).toHaveBeenCalledTimes(1);
      expect(onKeyRejected.mock.calls[0][0].kind).toBe(kind);
      // Terminal → žiadny retry.
      expect(h.calls).toHaveLength(1);
    }
  });

  it('payload zápisu je presne id/from/to/reduction (D50)', () => {
    expect(setReductionPayload({ id: 5, from: '2026-08-05', to: '2026-09-05', reduction: 15 })).toEqual({
      id: '5',
      from: '2026-08-05',
      to: '2026-09-05',
      reduction: '15',
    });
  });
});

/* ══════════════ 5. Dávkové čítanie a fallback (D56) ═══════════════════════ */

describe('batchGetProducts (D56)', () => {
  const detail = (id: number) => ({ ok: true, id, name: `P${id}`, price: 10 + id, has_attributes: false });

  it('použije jedno batch volanie a vráti via="batch"', async () => {
    const h = harness(() => json({ ok: true, results: [detail(1), detail(2)] }));
    const out = await client(h.fetchImpl).batchGetProducts([1, 2], ctx());
    expect(out.via).toBe('batch');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toContain(SHOP_PATHS.batch);
    expect(out.results.get(2)).toMatchObject({ id: 2, name: 'P2' });
  });

  it('`batch_not_allowed` v slote spadne na jednotlivé GETy (via="single")', async () => {
    const h = harness([
      () => json({ ok: true, results: [{ ok: false, error: 'batch_not_allowed' }, detail(2)] }),
      () => json(detail(1)),
      () => json(detail(2)),
    ]);
    const out = await client(h.fetchImpl).batchGetProducts([1, 2], ctx());
    expect(out.via).toBe('single');
    expect(h.calls).toHaveLength(3);
    expect(h.calls[1].url).toContain(SHOP_PATHS.productGet);
    expect(out.results.get(1)).toMatchObject({ id: 1 });
  });

  it('chyba celého batchu spadne na jednotlivé GETy', async () => {
    const h = harness([
      () => json({ error: 'invalid_input' }, 400),
      () => json(detail(1)),
      () => json({ ok: false, errors: ['not found'] }, 404),
    ]);
    const out = await client(h.fetchImpl).batchGetProducts([1, 2], ctx());
    expect(out.via).toBe('single');
    expect(out.results.get(1)).toMatchObject({ id: 1 });
    const missing = out.results.get(2);
    expect(isShopError(missing)).toBe(true);
    if (isShopError(missing)) expect(missing.kind).toBe('not_found');
  });

  it('nenájdený produkt v slote je chyba len pre tento produkt (D49)', async () => {
    const h = harness(() => json({ ok: true, results: [detail(1), { ok: false, errors: ['not found'] }] }));
    const out = await client(h.fetchImpl).batchGetProducts([1, 2], ctx());
    expect(out.via).toBe('batch');
    expect(out.results.get(1)).toMatchObject({ id: 1 });
    const missing = out.results.get(2);
    expect(isShopError(missing) && missing.kind).toBe('not_found');
  });

  it('neúplný počet slotov je drift a spadne na jednotlivé GETy', async () => {
    const h = harness([() => json({ ok: true, results: [detail(1)] }), () => json(detail(1)), () => json(detail(2))]);
    const out = await client(h.fetchImpl).batchGetProducts([1, 2], ctx());
    expect(out.via).toBe('single');
  });

  it('rozdelí viac ako 25 ID na dávky po 25', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);
    const h = harness((req) => {
      const form = new URLSearchParams(req.body ?? '');
      const count = [...form.keys()].filter((k) => k.endsWith('[controller]')).length;
      expect(count).toBeLessThanOrEqual(BATCH_MAX_ITEMS);
      return json({ ok: true, results: Array.from({ length: count }, (_, i) => detail(i + 1)) });
    });
    const out = await client(h.fetchImpl).batchGetProducts(ids, ctx());
    expect(h.calls).toHaveLength(2);
    expect(out.via).toBe('batch');
  });
});

/* ═════════ 6. Lokálna validácia zápisu (I9) a zákaz rušenia (I7) ══════════ */

describe('lokálna validácia zápisu (I7, I9)', () => {
  const window = futureWindow();

  it('odmietne percento mimo 1–30 a desatinné percento BEZ volania shopu', async () => {
    for (const reduction of [0, -5, 31, 12.5]) {
      const h = harness(() => json({ ok: true, id: 1 }));
      const result = await client(h.fetchImpl).setReduction(
        { id: 1, reduction, ...window },
        fakeKey().ref,
        ctx(),
      );
      expect(result.outcome).toBe('failed');
      expect(h.calls).toHaveLength(0);
      if (result.outcome === 'failed') expect(result.error.code).toBe('local_invalid_reduction');
    }
  });

  it('odmietne `to` pred `from`, neplatný dátum a okno nad 3 mesiace', () => {
    expect(validateWriteParams({ id: 1, reduction: 10, from: '2026-08-10', to: '2026-08-09' })?.code).toBe(
      'local_invalid_dates',
    );
    expect(validateWriteParams({ id: 1, reduction: 10, from: '2026-02-30', to: '2026-03-01' })?.code).toBe(
      'local_invalid_dates',
    );
    expect(validateWriteParams({ id: 1, reduction: 10, from: '5.8.2026', to: '2026-09-05' })?.code).toBe(
      'local_invalid_dates',
    );
    expect(
      validateWriteParams(
        { id: 1, reduction: 10, from: '2026-08-05', to: '2026-11-06' },
        { now: () => Date.parse('2026-08-05T10:00:00Z') },
      )?.code,
    ).toBe('local_range_too_long');
    expect(
      validateWriteParams(
        { id: 1, reduction: 10, from: '2026-08-05', to: '2026-11-05' },
        { now: () => Date.parse('2026-08-05T10:00:00Z') },
      ),
    ).toBeNull();
  });

  it('I7: zápis s `to` v minulosti sa NIKDY neodošle', async () => {
    const h = harness(() => json({ ok: true, id: 1 }));
    const result = await client(h.fetchImpl).setReduction(
      { id: 1, reduction: 10, from: '2020-01-01', to: '2020-01-31' },
      fakeKey().ref,
      ctx(),
    );
    expect(h.calls).toHaveLength(0);
    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') expect(result.error.code).toBe('local_to_in_past');
  });

  it('kalendárne pripočítanie mesiacov klampuje deň', () => {
    expect(addMonthsDateOnly('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsDateOnly('2026-12-15', 3)).toBe('2027-03-15');
    expect(addMonthsDateOnly('2024-11-30', 3)).toBe('2025-02-28');
  });

  it('dnešný deň sa počíta v Europe/Bratislava (D31)', () => {
    // 31.12.2026 23:30 UTC = už 1.1.2027 v Bratislave (UTC+1).
    expect(todayInTimeZone('Europe/Bratislava', Date.parse('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayInTimeZone('Europe/Bratislava', Date.parse('2026-08-05T12:00:00Z'))).toBe('2026-08-05');
  });
});

/* ════════════════════ 7. Base URL a konfigurácia (D80) ═══════════════════ */

describe('base URL (D80)', () => {
  it('vyžaduje https a odstrihne trailing slash', () => {
    expect(normalizeShopBaseUrl('https://sperky.example/')).toBe('https://sperky.example');
    expect(normalizeShopBaseUrl(' https://sperky.example/podshop/ ')).toBe('https://sperky.example/podshop');
    expect(() => normalizeShopBaseUrl('http://sperky.example')).toThrow();
    expect(() => normalizeShopBaseUrl('sperky.example')).toThrow();
    expect(() => normalizeShopBaseUrl('https://user:pass@sperky.example')).toThrow();
    expect(() => normalizeShopBaseUrl('https://sperky.example?x=1')).toThrow();
  });

  it('http povolí len pre lokálny mock (I6)', () => {
    expect(normalizeShopBaseUrl('http://127.0.0.1:3001', { allowLoopbackHttp: true })).toBe(
      'http://127.0.0.1:3001',
    );
    expect(() => normalizeShopBaseUrl('http://sperky.example', { allowLoopbackHttp: true })).toThrow();
  });
});

/* ══════════════════════ 8. Invarianty I7 a I8 v kóde ═════════════════════ */

describe('invarianty v zdrojoch modulu (I7, I8)', () => {
  const dir = resolve(process.cwd(), 'src/lib/shop');
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: f, text: readFileSync(resolve(dir, f), 'utf8') }));

  /**
   * I8' (KONTRAKT-PREDAJNOST-2026-08-06 §5) povolil objednávky, ale VÝHRADNE
   * v jedinom module. Ten je preto zo skenu vyňatý menovite — uvoľnenie je
   * úzke a menované, nie plošné. Celý invariant vynucuje
   * `test/unit/no-orders-scope.spec.ts`.
   */
  const ORDERS_CLIENT_FILE = 'orders-client.ts';
  const withoutOrdersClient = sources.filter((s) => s.file !== ORDERS_CLIENT_FILE);

  /**
   * Zoznam je ÚMYSELNE vymenovaný: nový súbor v `src/lib/shop` musí zhodiť
   * tento test, aby sa naň pozrel človek. Skeny nižšie (I7, I8') bežia nad
   * `sources`, takže každý pribudnutý súbor im automaticky podlieha.
   *
   * V3 pridala `catalog-sync.ts` (K7 — stránkované zrkadlenie katalógu, číta,
   * nezapisuje). Prijatá vedome; I7 aj I8' nad ňou platia.
   */
  it('má všetkých 8 súborov modulu', () => {
    expect(sources.map((s) => s.file).sort()).toEqual([
      'catalog-sync.ts',
      'client.ts',
      'correlation.ts',
      'errors.ts',
      'messages.sk.ts',
      ORDERS_CLIENT_FILE,
      'retry.ts',
      'schemas.ts',
    ]);
  });

  it("I8': objednávkový endpoint je len v orders-client.ts, scope nikde", () => {
    const ordersPath = `/api/${'order'}`;
    const ordersScope = `orders${':'}read`;
    for (const { file, text } of withoutOrdersClient) {
      expect(text.includes(ordersPath), `${file} nesmie volať objednávky`).toBe(false);
    }
    for (const { file, text } of sources) {
      expect(text.includes(ordersScope), `${file} nesmie pýtať scope objednávok`).toBe(false);
    }
  });

  it('I7: žiadna funkcia na rušenie zľavy', () => {
    const forbidden = [`clear${'Reduction'}`, `cancel${'Reduction'}`, `remove${'Reduction'}`];
    for (const { file, text } of sources) {
      for (const name of forbidden) {
        expect(text.includes(name), `${file} nesmie obsahovať ${name}`).toBe(false);
      }
    }
  });

  it('cesty pozná len pre produkty a dávku', () => {
    expect(Object.values(SHOP_PATHS).sort()).toEqual(
      ['/api/batch', '/api/products', '/api/products/get', '/api/products/setReduction'].sort(),
    );
  });
});
