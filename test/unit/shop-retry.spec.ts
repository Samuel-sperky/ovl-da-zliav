/**
 * Aura Zľavy — retry politika, timeouty a korelácia (A3).
 *
 * Overuje akceptačné kritérium A3:
 *   - 429 čaká `min(Retry-After, 90 s)`, maximálne 3 pokusy (D42),
 *   - 500 / sieťová chyba / timeout pred odoslaním: backoff 2/4/8 s, max 3 (D43),
 *   - terminal chyby a `schema_drift` sa neopakujú nikdy (D41, D54),
 *   - timeout PO odoslaní zápisu = `uncertain` + PRESNE JEDEN identický resend,
 *     druhá odpoveď je konečná (D45),
 *   - timeouty 10 s čítanie / 30 s zápis (D44) a `AbortSignal` je naozaj zapojený,
 *   - `operation_id` je stabilné, `request_id` je nové pre každé HTTP volanie (D58).
 *
 * Beží s fake fetch a fake `sleep` — žiadny request neopustí proces (I6)
 * a test nikdy nečaká reálnych 8 sekúnd.
 *
 * Vlastník: A3.
 */
import { describe, expect, it } from 'vitest';

import type { SecretRef, ShopClient, ShopCtx } from '@/contracts';

import {
  BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_RETRY_AFTER_CAP_S,
  DEFAULT_WRITE_PAUSE_MS,
  DEFAULT_WRITE_TIMEOUT_MS,
  parseRetryAfterSeconds,
  planRetry,
  runWithRetry,
} from '@/lib/shop/retry';
import { makeShopError } from '@/lib/shop/errors';
import {
  addMonthsDateOnly,
  createShopClient,
  todayInTimeZone,
  type FetchLike,
} from '@/lib/shop/client';
import { isUlid, newOperationContext } from '@/lib/shop/correlation';

/* ═════════════════════════ 0. Testovací harness ═══════════════════════════ */

const BASE = 'https://127.0.0.1:8443';
const TEST_KEY = 'TESTKEY-abc123deadbeef99';

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

type Handler = (
  req: Recorded,
  index: number,
  signal: AbortSignal | null,
) => Response | Promise<Response>;

function harness(handlers: Handler | Handler[]): { fetchImpl: FetchLike; calls: Recorded[] } {
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
    const signal = init.signal instanceof AbortSignal ? init.signal : null;
    return list[Math.min(index, list.length - 1)](record, index, signal);
  };
  return { fetchImpl, calls };
}

/**
 * Requestu, ktorý nikdy neodpovie — presne ako `hangWrite()` v mock shope.
 * Odpoveď dorazí len ako zrušenie z `AbortSignal`, ktorý zostavil klient, takže
 * test overuje, že timeout je naozaj zapojený (D44).
 */
const hangUntilAborted: Handler = (_req, _index, signal) =>
  new Promise<Response>((_resolve, reject) => {
    if (signal === null) return; // klient bez signálu = chyba, test spadne timeoutom
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => {
      reject(signal.reason);
    });
  });

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Simuluje `AbortSignal.timeout()` — presne to, čo hodí `fetch` pri timeoute. */
function timeoutRejection(): never {
  throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

function fakeKey(): SecretRef {
  return async () => {
    const buf = Buffer.from(TEST_KEY, 'utf8');
    return { value: buf, release: () => buf.fill(0) };
  };
}

interface ClientBundle {
  shop: ShopClient;
  delays: number[];
  calls: Recorded[];
}

function client(
  handlers: Handler | Handler[],
  extra: Partial<Parameters<typeof createShopClient>[0]> = {},
): ClientBundle {
  const h = harness(handlers);
  const delays: number[] = [];
  const shop = createShopClient({
    baseUrl: BASE,
    fetchImpl: h.fetchImpl,
    version: '0.0.0-test',
    readTimeoutMs: 5000,
    writeTimeoutMs: 5000,
    timeZone: 'Europe/Bratislava',
    sleepFn: async (ms) => {
      delays.push(ms);
    },
    ...extra,
  });
  return { shop, delays, calls: h.calls };
}

const ctx = (): ShopCtx => newOperationContext();

function futureWindow(): { from: string; to: string } {
  const today = todayInTimeZone('Europe/Bratislava');
  return { from: today, to: addMonthsDateOnly(today, 1) };
}

const writeParams = () => ({ id: 123, reduction: 15, ...futureWindow() });

/* ═══════════════════ 1. Konštanty politiky (D42–D46) ══════════════════════ */

describe('konštanty retry politiky (D42, D43, D44, D46)', () => {
  it('backoff je 2/4/8 s, max 3 pokusy, strop Retry-After 90 s', () => {
    expect(BACKOFF_MS).toEqual([2000, 4000, 8000]);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(3);
    expect(DEFAULT_RETRY_AFTER_CAP_S).toBe(90);
  });

  it('timeouty sú 10 s čítanie a 30 s zápis (D44)', () => {
    expect(DEFAULT_READ_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_WRITE_TIMEOUT_MS).toBe(30_000);
  });

  it('pauza medzi zápismi je 250 ms (D46, I10)', () => {
    expect(DEFAULT_WRITE_PAUSE_MS).toBe(250);
  });
});

/* ══════════════════════════ 2. `Retry-After` (D42) ════════════════════════ */

describe('parseRetryAfterSeconds (D42)', () => {
  it('prečíta sekundy a zastropuje na 90 s', () => {
    expect(parseRetryAfterSeconds('5')).toBe(5);
    expect(parseRetryAfterSeconds('90')).toBe(90);
    expect(parseRetryAfterSeconds('600')).toBe(90);
    expect(parseRetryAfterSeconds('0')).toBe(0);
  });

  it('prečíta HTTP dátum a prepočíta na sekundy', () => {
    const now = Date.parse('2026-08-05T12:00:00Z');
    expect(parseRetryAfterSeconds('Wed, 05 Aug 2026 12:00:30 GMT', { now: () => now })).toBe(30);
    // dátum v minulosti → 0, nie negatívne čakanie
    expect(parseRetryAfterSeconds('Wed, 05 Aug 2026 11:59:00 GMT', { now: () => now })).toBe(0);
    // ďaleká budúcnosť → strop
    expect(parseRetryAfterSeconds('Wed, 05 Aug 2026 13:00:00 GMT', { now: () => now })).toBe(90);
  });

  it('nezmysel a chýbajúca hlavička dávajú null (použije sa backoff)', () => {
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds(undefined)).toBeNull();
    expect(parseRetryAfterSeconds('   ')).toBeNull();
    expect(parseRetryAfterSeconds('neskoro')).toBeNull();
  });
});

/* ══════════════════════════ 3. planRetry (D41–D43) ════════════════════════ */

describe('planRetry (D41, D42, D43)', () => {
  it('429 čaká Retry-After so stropom 90 s', () => {
    expect(planRetry({ kind: 'rate_limited', attempt: 1, retryAfterSeconds: 5 })).toEqual({
      retry: true,
      delayMs: 5000,
      reason: 'retry_after',
    });
    expect(planRetry({ kind: 'rate_limited', attempt: 1, retryAfterSeconds: 3600 }).delayMs).toBe(90_000);
  });

  it('429 bez hlavičky použije backoff', () => {
    expect(planRetry({ kind: 'rate_limited', attempt: 1, retryAfterSeconds: null })).toEqual({
      retry: true,
      delayMs: 2000,
      reason: 'backoff',
    });
  });

  it('500 / network / timeout_before idú 2 s → 4 s a po 3. pokuse končia', () => {
    for (const kind of ['server_error', 'network', 'timeout_before'] as const) {
      expect(planRetry({ kind, attempt: 1 }).delayMs).toBe(2000);
      expect(planRetry({ kind, attempt: 2 }).delayMs).toBe(4000);
      expect(planRetry({ kind, attempt: 3 })).toEqual({
        retry: false,
        delayMs: 0,
        reason: 'attempts_exhausted',
      });
    }
  });

  it('so zvýšeným stropom pokračuje 8 s (tabuľka 2/4/8)', () => {
    expect(planRetry({ kind: 'server_error', attempt: 3, policy: { maxAttempts: 4 } }).delayMs).toBe(8000);
  });

  it('terminal chyby a neisté stavy sa neopakujú', () => {
    for (const kind of [
      'bad_request',
      'unauthorized',
      'forbidden',
      'not_found',
      'batch_not_allowed',
      'schema_drift',
      'timeout_after',
    ] as const) {
      expect(planRetry({ kind, attempt: 1 })).toEqual({
        retry: false,
        delayMs: 0,
        reason: 'not_retryable',
      });
    }
  });
});

/* ═════════════════════════ 4. runWithRetry (§6) ═══════════════════════════ */

describe('runWithRetry (§6)', () => {
  it('vráti prvý úspech a nepočíta ďalšie pokusy', async () => {
    let attempts = 0;
    const result = await runWithRetry<string>({
      attempt: async () => {
        attempts += 1;
        return { status: 'ok', value: 'hotovo' };
      },
      sleepFn: async () => {},
    });
    expect(result).toEqual({ outcome: 'ok', value: 'hotovo', attempts: 1 });
    expect(attempts).toBe(1);
  });

  it('opakuje retryable chybu do stropu a vráti poslednú chybu', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await runWithRetry<string>({
      attempt: async () => {
        attempts += 1;
        return { status: 'error', error: makeShopError({ kind: 'server_error', httpStatus: 500 }) };
      },
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    });
    expect(attempts).toBe(3);
    expect(delays).toEqual([2000, 4000]);
    expect(result.outcome).toBe('error');
    if (result.outcome === 'error') expect(result.error.kind).toBe('server_error');
  });

  it('po úspešnom opakovaní vráti hodnotu s počtom pokusov', async () => {
    let attempts = 0;
    const result = await runWithRetry<number>({
      attempt: async ({ attempt }) => {
        attempts = attempt;
        if (attempt < 3) {
          return { status: 'error', error: makeShopError({ kind: 'network' }) };
        }
        return { status: 'ok', value: 42 };
      },
      sleepFn: async () => {},
    });
    expect(result).toEqual({ outcome: 'ok', value: 42, attempts: 3 });
    expect(attempts).toBe(3);
  });

  it('terminal chybu nezopakuje ani raz', async () => {
    let attempts = 0;
    const result = await runWithRetry<string>({
      attempt: async () => {
        attempts += 1;
        return { status: 'error', error: makeShopError({ kind: 'bad_request', httpStatus: 400 }) };
      },
      sleepFn: async () => {
        throw new Error('nesmie sa čakať');
      },
    });
    expect(attempts).toBe(1);
    expect(result.attempts).toBe(1);
  });
});

/* ════════════════ 5. Retry v klientovi — čítanie a zápis ══════════════════ */

describe('retry v klientovi (D42, D43)', () => {
  it('429 pri čítaní: 3 pokusy, čaká Retry-After', async () => {
    const c = client(() => json({ error: 'rate_limited' }, 429, { 'retry-after': '7' }));
    await expect(c.shop.getProduct(1, ctx())).rejects.toMatchObject({
      shopError: { kind: 'rate_limited', retryable: true, retryAfterSeconds: 7 },
    });
    expect(c.calls).toHaveLength(3);
    expect(c.delays).toEqual([7000, 7000]);
  });

  it('429 s obrovským Retry-After čaká najviac 90 s', async () => {
    const c = client(() => json({ error: 'rate_limited' }, 429, { 'retry-after': '3600' }));
    await expect(c.shop.getProduct(1, ctx())).rejects.toMatchObject({ shopError: { kind: 'rate_limited' } });
    expect(c.delays).toEqual([90_000, 90_000]);
  });

  it('500 pri čítaní: backoff 2 s → 4 s, potom chyba', async () => {
    const c = client(() => json({ error: 'request_failed' }, 500));
    await expect(c.shop.getProduct(1, ctx())).rejects.toMatchObject({ shopError: { kind: 'server_error' } });
    expect(c.calls).toHaveLength(3);
    expect(c.delays).toEqual([2000, 4000]);
  });

  it('sieťová chyba sa opakuje a po úspechu vráti dáta', async () => {
    const c = client([
      () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
        });
      },
      () => json({ ok: true, id: 1, name: 'Prsteň', price: 12.5, has_attributes: false }),
    ]);
    const detail = await c.shop.getProduct(1, ctx());
    expect(detail.id).toBe(1);
    expect(c.calls).toHaveLength(2);
    expect(c.delays).toEqual([2000]);
  });

  it('timeout pri čítaní je timeout_before a opakuje sa', async () => {
    const c = client(() => timeoutRejection());
    await expect(c.shop.getProduct(1, ctx())).rejects.toMatchObject({
      shopError: { kind: 'timeout_before', retryable: true },
    });
    expect(c.calls).toHaveLength(3);
    expect(c.delays).toEqual([2000, 4000]);
  });

  it('500 pri zápise: 3 pokusy s identickým payloadom, výsledok failed', async () => {
    const c = client(() => json({ error: 'request_failed' }, 500));
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('failed');
    expect(result.attempts).toBe(3);
    expect(c.calls).toHaveLength(3);
    expect(c.delays).toEqual([2000, 4000]);
    // D43 sa opiera o idempotenciu identického setReduction.
    expect(new Set(c.calls.map((call) => call.body))).toHaveProperty('size', 1);
  });

  it('429 pri zápise po úspechu vráti ok', async () => {
    const c = client([
      () => json({ error: 'rate_limited' }, 429, { 'retry-after': '2' }),
      () => json({ ok: true, id: 123 }),
    ]);
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(c.delays).toEqual([2000]);
  });

  it('400 pri zápise sa neopakuje', async () => {
    const c = client(() => json({ ok: false, errors: ['invalid_dates', 'range_too_long'] }, 400));
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('failed');
    expect(c.calls).toHaveLength(1);
    if (result.outcome === 'failed') {
      expect(result.error.code).toBe('invalid_dates');
      expect(result.error.message).toContain('3 mesiace');
    }
    expect(c.delays).toEqual([]);
  });
});

/* ═══════════ 6. Timeout po odoslaní zápisu — 1 resend (D45) ═══════════════ */

describe('timeout po odoslaní zápisu (D45)', () => {
  it('pošle PRESNE JEDEN identický resend a druhú odpoveď považuje za konečnú', async () => {
    const c = client([() => timeoutRejection(), () => json({ ok: true, id: 123 })]);
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('ok');
    expect(c.calls).toHaveLength(2);
    expect(c.calls[0].body).toBe(c.calls[1].body);
    // Timeout po odoslaní NIE JE retryable → medzi pokusmi sa nečaká backoff.
    expect(c.delays).toEqual([]);
    expect(result.attempts).toBe(2);
  });

  it('keď resend znovu vyprší, stav je uncertain a viac sa neskúša', async () => {
    const c = client(() => timeoutRejection());
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('uncertain');
    if (result.outcome === 'uncertain') expect(result.error.kind).toBe('timeout_after');
    expect(c.calls).toHaveLength(2);
  });

  it('keď resend vráti terminal chybu, výsledok je failed', async () => {
    const c = client([() => timeoutRejection(), () => json({ ok: false, errors: ['not found'] }, 404)]);
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') expect(result.error.kind).toBe('not_found');
    expect(c.calls).toHaveLength(2);
  });

  it('keď resend vráti 500, stav zostáva uncertain (nevieme, čo sa zapísalo)', async () => {
    const c = client([() => timeoutRejection(), () => json({ error: 'request_failed' }, 500)]);
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('uncertain');
    expect(c.calls).toHaveLength(2);
  });

  it('sieťová chyba pri zápise NIE JE neistý stav — opakuje sa ako network', async () => {
    const c = client(() => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('dns'), { code: 'ENOTFOUND' }),
      });
    });
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') expect(result.error.kind).toBe('network');
    expect(c.calls).toHaveLength(3);
  });
});

/* ══════════════════════ 7. AbortSignal je zapojený (D44) ══════════════════ */

describe('timeouty sú naozaj vynútené (D44)', () => {
  it('visiace čítanie skončí timeoutom podľa nastaveného limitu', async () => {
    const c = client(hangUntilAborted, { readTimeoutMs: 25, policy: { maxAttempts: 1 } });
    await expect(c.shop.getProduct(1, ctx())).rejects.toMatchObject({
      shopError: { kind: 'timeout_before' },
    });
    expect(c.calls).toHaveLength(1);
  });

  it('visiaci zápis skončí ako timeout_after a jedným resendom', async () => {
    const c = client(hangUntilAborted, { writeTimeoutMs: 25, policy: { maxAttempts: 1 } });
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(result.outcome).toBe('uncertain');
    expect(c.calls).toHaveLength(2);
  });
});

/* ════════════════════════ 8. Korelácia (D58) ═════════════════════════════ */

describe('korelácia operácií a volaní (D58)', () => {
  it('operation_id je stabilné, request_id je nové pre každý pokus', async () => {
    const c = client([
      () => json({ error: 'request_failed' }, 500),
      () => json({ error: 'request_failed' }, 500),
      () => json({ ok: true, id: 1, name: 'A', price: 1, has_attributes: false }),
    ]);
    const operation = ctx();
    await c.shop.getProduct(1, operation);

    const ids = c.calls.map((call) => call.headers['x-request-id']);
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(isUlid(id)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expect(isUlid(operation.operationId)).toBe(true);
  });

  it('vracia request_id rozhodujúceho pokusu', async () => {
    const c = client(() => json({ ok: true, id: 123 }));
    const result = await c.shop.setReduction(writeParams(), fakeKey(), ctx());
    expect(isUlid(result.requestId)).toBe(true);
    expect(result.requestId).toBe(c.calls[0].headers['x-request-id']);
  });

  it('canary meria latenciu a vracia total (D55)', async () => {
    let clock = 1000;
    const c = client(() => json({ data: [{ id: 1, name: 'A', price: 1, has_attributes: false }], page: 1, per_page: 1, total: 240 }), {
      now: () => {
        clock += 25;
        return clock;
      },
    });
    const result = await c.shop.canary(ctx());
    expect(result.ok).toBe(true);
    expect(result.total).toBe(240);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(c.calls[0].url).toContain('per_page=1');
  });

  it('canary pri nedostupnom shope vráti ok:false s chybou (D55)', async () => {
    const c = client(() => json({ error: 'request_failed' }, 500));
    const result = await c.shop.canary(ctx());
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('server_error');
    expect(result.total).toBe(0);
  });
});
