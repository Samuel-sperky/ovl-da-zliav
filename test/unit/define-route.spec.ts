/**
 * Aura Zľavy — testy HTTP pipeline `defineRoute()` (A5).
 *
 * Pokrývajú akceptačné kritériá A5:
 *  - mutácia (POST/PUT/PATCH/DELETE) bez hlavičky `Origin` alebo s `Origin`,
 *    ktorý sa nerovná hostu požiadavky, je odmietnutá 403 ešte PRED
 *    handlerom (D72),
 *  - neplatný zod vstup vracia 400 so zoznamom polí,
 *  - neodchytená výnimka sa nikdy nedostane do odpovede ako stacktrace a nikdy
 *    nenesie hodnoty z denylistu redaktora (I1),
 *  - každé volanie je zalogované s `request_id`.
 *
 * Tabuľkové testy idú cez všetky kombinácie metóda × origin × zod.
 *
 * Bez DB a bez `fetch` (I6): lokálny actor (D102) je injektovaný cez
 * `RouteDeps`, takže sa testuje poradie a fail-closed chovanie pipeline.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { LogLine } from '@/lib/log/logger';

import { setLogLevel, setLogSink } from '@/lib/log/logger';
import { resetRedactionState, setActiveSecretForScan } from '@/lib/log/redact';
import {
  checkOrigin,
  consumeRateLimit,
  defineRoute,
  resetRateLimiter,
  type RouteDeps,
} from '@/lib/http/define-route';
import { AppError, toAppError } from '@/lib/http/errors';
import { fail, ok } from '@/lib/http/responses';

/* ═══════════════════════════ Pomôcky a fixtures ═══════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const APP_HOST = 'zlavy.local';

/** Nikdy nie tvar reálneho kľúča poskytovateľa (I1, GitHub push protection). */
const FAKE_KEY = 'fake-shop-key-ABCD1234';

const NOW = new Date('2026-08-05T10:00:00.000Z');

/** Id lokálneho actora, ktoré musí dojsť až do logu (`userId`). */
const ACTOR_ID = 7;

/**
 * Deps pipeline. Do 27. 8. 2026 tu bola falošná SESSION vrstva, ktorou si testy
 * vedeli vyrobiť aj stav „bez session" a „bez sudo okna" (D69, D70). Oboje
 * zmizlo (D99, D100) a zostal lokálny actor (D102).
 */
function actorDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J0000000000000000000TEST'.slice(0, 26),
    localActor: async () => ({ id: ACTOR_ID, username: 'samuel' }),
  };
}

interface RequestOptions {
  method?: string;
  origin?: string | null;
  body?: unknown;
  rawBody?: string;
  path?: string;
  ip?: string;
}

function makeRequest(options: RequestOptions = {}): Request {
  const method = options.method ?? 'GET';
  const headers = new Headers({ host: APP_HOST });
  if (options.origin !== null && options.origin !== undefined) {
    headers.set('origin', options.origin);
  }
  headers.set('x-forwarded-for', options.ip ?? '127.0.0.1');
  const init: RequestInit = { method, headers };
  if (options.rawBody !== undefined) {
    init.body = options.rawBody;
    headers.set('content-type', 'application/json');
  } else if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = JSON.stringify(options.body);
    headers.set('content-type', 'application/json');
  }
  return new Request(`${APP_ORIGIN}${options.path ?? '/api/test'}`, init);
}

/* 27. 8. 2026 (D99): `VALID_COOKIE` a voľba `cookie` v `makeRequest()` zmazané
   — app session je zmazaná a appka žiadny session cookie nevydáva. */

interface Body {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; detail?: unknown };
}

const readBody = async (response: Response): Promise<Body> =>
  (await response.json()) as Body;

/* ═════════════════════════════ Zber log riadkov ════════════════════════════ */

let lines: LogLine[] = [];

beforeEach(() => {
  lines = [];
  resetRateLimiter();
  resetRedactionState();
  // test/setup.ts drží LOG_LEVEL='error' — pipeline loguje na info/warn.
  setLogLevel('debug');
  setLogSink((line) => {
    lines.push(JSON.parse(line) as LogLine);
  });
});

afterEach(() => {
  setLogSink(null);
  setLogLevel(null);
  resetRedactionState();
});

/* ══════════════════════════════════ Testy ═════════════════════════════════ */

describe('checkOrigin (D72)', () => {
  it('čítacie metódy Origin nevyžadujú', () => {
    for (const method of ['GET', 'HEAD']) {
      expect(checkOrigin(makeRequest({ method, origin: null })).ok).toBe(true);
    }
  });

  it('mutácia bez Origin je odmietnutá', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const verdict = checkOrigin(makeRequest({ method, origin: null }));
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('origin_missing');
    }
  });

  it.each([
    ['https://zlodej.example', 'origin_mismatch'],
    ['null', 'origin_missing'],
    ['nie-je-url', 'origin_mismatch'],
    ['https://zlavy.local:8443', 'origin_mismatch'],
  ])('cudzí Origin %s → %s', (origin, code) => {
    const verdict = checkOrigin(makeRequest({ method: 'POST', origin }));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe(code);
  });

  it('vlastný Origin prejde', () => {
    expect(checkOrigin(makeRequest({ method: 'POST', origin: APP_ORIGIN })).ok).toBe(true);
  });
});

describe('tabuľka metóda × origin (D72)', () => {
  /*
   * Do 27. 8. 2026 to bola tabuľka `auth × metóda × origin` a niesla tri osi:
   * session, sudo okno a Origin. Prihlásenie aj sudo zmizli (D99, D100), takže
   * ostala tá jedna os, ktorá appku pred cudzím zápisom naozaj chráni — a je
   * dôležitejšia než predtým, lebo je posledná.
   *
   * ČO SA TU MERÍ: mutácia z cudzieho (alebo chýbajúceho) Originu sa NESMIE
   * dostať k handleru. Čítanie Origin nepotrebuje — GET nič nemení a prehliadač
   * pri navigácii hlavičku neposiela.
   */
  const cases: Array<{
    method: 'GET' | 'POST';
    origin: string | null;
    expected: number;
    code?: string;
  }> = [
    // Čítanie: Origin sa nevyžaduje ani nekontroluje.
    { method: 'GET', origin: null, expected: 200 },
    { method: 'GET', origin: 'https://zlodej.example', expected: 200 },
    // Mutácia: Origin sa musí presne zhodovať s hostom požiadavky.
    { method: 'POST', origin: APP_ORIGIN, expected: 200 },
    { method: 'POST', origin: null, expected: 403, code: 'origin_missing' },
    { method: 'POST', origin: 'https://zlodej.example', expected: 403, code: 'origin_mismatch' },
    // Poddomena nie je ten istý host.
    { method: 'POST', origin: 'https://sub.zlavy.local', expected: 403, code: 'origin_mismatch' },
  ];

  it.each(cases)('$method origin=$origin → $expected', async (testCase) => {
    let handlerRan = false;
    const route = defineRoute(
      {
        method: testCase.method,
        handler: () => {
          handlerRan = true;
          return { hello: 'svet' };
        },
      },
      actorDeps(),
    );

    const response = await route(
      makeRequest({ method: testCase.method, origin: testCase.origin }),
    );

    expect(response.status).toBe(testCase.expected);
    const body = await readBody(response);
    if (testCase.expected === 200) {
      expect(handlerRan).toBe(true);
      expect(body).toEqual({ ok: true, data: { hello: 'svet' } });
    } else {
      // Odmietnutie MUSÍ prebehnúť pred handlerom.
      expect(handlerRan).toBe(false);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe(testCase.code);
    }
  });
});

describe('metóda a tvar odpovede', () => {
  it('nepovolená metóda je 405 a handler nebeží', async () => {
    let handlerRan = false;
    const route = defineRoute(
      {
        method: 'GET',
        handler: () => {
          handlerRan = true;
          return {};
        },
      },
      actorDeps(),
    );
    const response = await route(makeRequest({ method: 'DELETE', origin: APP_ORIGIN }));
    expect(response.status).toBe(405);
    expect(handlerRan).toBe(false);
    expect((await readBody(response)).error?.code).toBe('method_not_allowed');
  });

  it('úspešná odpoveď má jednotný tvar, no-store a X-Request-Id', async () => {
    const route = defineRoute(
      { method: 'GET', handler: () => ({ a: 1 }) },
      actorDeps(),
    );
    const response = await route(makeRequest());
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-Request-Id')).toHaveLength(26);
    expect(await readBody(response)).toEqual({ ok: true, data: { a: 1 } });
  });

});

describe('zod validácia (vrstva 4)', () => {
  const bodySchema = z.object({
    percent: z.number().int().min(1).max(30),
    productIds: z.array(z.number().int().positive()).min(1).max(10),
  });

  it('neplatné telo je 400 so zoznamom polí', async () => {
    let handlerRan = false;
    const route = defineRoute(
      {
        method: 'POST',
        body: bodySchema,
        handler: () => {
          handlerRan = true;
          return {};
        },
      },
      actorDeps(),
    );

    const response = await route(
      makeRequest({ method: 'POST', origin: APP_ORIGIN, body: { percent: 99, productIds: [] } }),
    );

    expect(response.status).toBe(400);
    expect(handlerRan).toBe(false);
    const body = await readBody(response);
    expect(body.error?.code).toBe('validation_failed');
    const detail = body.error?.detail as { source: string; fields: Array<{ path: string }> };
    expect(detail.source).toBe('body');
    expect(detail.fields.map((f) => f.path).sort()).toEqual(['percent', 'productIds']);
  });

  it('platné telo prejde a handler dostane typovaný vstup', async () => {
    const route = defineRoute(
      {
        method: 'POST',
        body: bodySchema,
        handler: (ctx) => ({ sum: ctx.body.percent + ctx.body.productIds.length }),
      },
      actorDeps(),
    );
    const response = await route(
      makeRequest({ method: 'POST', origin: APP_ORIGIN, body: { percent: 20, productIds: [1, 2] } }),
    );
    expect(await readBody(response)).toEqual({ ok: true, data: { sum: 22 } });
  });

  it('Origin check je PRED zodom — neplatné telo z cudzieho originu dá 403', async () => {
    const route = defineRoute(
      { method: 'POST', body: bodySchema, handler: () => ({}) },
      actorDeps(),
    );
    const response = await route(
      makeRequest({ method: 'POST', origin: 'https://zlodej.example', body: { percent: 999 } }),
    );
    expect(response.status).toBe(403);
  });

  it('nevalidný JSON je 400 malformed_json', async () => {
    const route = defineRoute(
      { method: 'POST', body: bodySchema, handler: () => ({}) },
      actorDeps(),
    );
    const response = await route(
      makeRequest({ method: 'POST', origin: APP_ORIGIN, rawBody: '{nie json' }),
    );
    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe('malformed_json');
  });

  it('query a params sa validujú a chyba nesie správny `source`', async () => {
    const route = defineRoute(
      {
        method: 'GET',
        query: z.object({ page: z.coerce.number().int().positive() }),
        params: z.object({ productId: z.coerce.number().int().positive() }),
        handler: (ctx) => ({ page: ctx.query.page, productId: ctx.params.productId }),
      },
      actorDeps(),
    );

    const okResponse = await route(makeRequest({ path: '/api/x?page=2' }), {
      params: Promise.resolve({ productId: '55' }),
    });
    expect(await readBody(okResponse)).toEqual({ ok: true, data: { page: 2, productId: 55 } });

    const badQuery = await route(makeRequest({ path: '/api/x?page=0' }), {
      params: Promise.resolve({ productId: '55' }),
    });
    expect(badQuery.status).toBe(400);
    expect(
      (((await readBody(badQuery)).error?.detail as { source: string }) ?? {}).source,
    ).toBe('query');

    const badParams = await route(makeRequest({ path: '/api/x?page=2' }), {
      params: Promise.resolve({ productId: 'abc' }),
    });
    expect(badParams.status).toBe(400);
    expect(
      (((await readBody(badParams)).error?.detail as { source: string }) ?? {}).source,
    ).toBe('params');
  });
});

describe('mapovanie chýb (vrstva 6, I1)', () => {
  it('neodchytená výnimka je 500 bez stacktrace, message a kľúča', async () => {
    setActiveSecretForScan(FAKE_KEY);
    const route = defineRoute(
      {
        method: 'GET',
        handler: () => {
          throw new Error(`zlyhalo pri kľúči ${FAKE_KEY} v /home/user/ovl-da-zliav/src/x.ts`);
        },
      },
      actorDeps(),
    );

    const response = await route(makeRequest());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain(FAKE_KEY.slice(-8));
    expect(text).not.toContain('at ');
    expect(text).not.toContain('stack');
    expect(text).not.toContain('.ts');
    const body = JSON.parse(text) as Body;
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('internal_error');
    expect(body.error?.detail).toBeUndefined();
  });

  it('hodnoty z denylistu sa v úspešnej odpovedi nikdy neobjavia', async () => {
    setActiveSecretForScan(FAKE_KEY);
    const route = defineRoute(
      {
        method: 'GET',
        handler: () => ({ apiKey: FAKE_KEY, note: `hlavička X-Api-Key: ${FAKE_KEY}` }),
      },
      actorDeps(),
    );
    const text = await (await route(makeRequest())).text();
    expect(text).not.toContain(FAKE_KEY);
    expect(text).toContain('***REDACTED***');
  });

  it('AppError z handlera si nesie svoj status a kód', async () => {
    const route = defineRoute(
      {
        method: 'POST',
        handler: () => {
          throw new AppError(409, 'allowlist_full', 'Allowlist je plný (10/10).');
        },
      },
      actorDeps(),
    );
    const response = await route(makeRequest({ method: 'POST', origin: APP_ORIGIN }));
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('allowlist_full');
  });

  it('doménová chyba s kódom sa mapuje na status podľa katalógu', async () => {
    const route = defineRoute(
      {
        method: 'POST',
        handler: () => {
          const error = new Error('Zápisy sú zamknuté (runaway strop).') as Error & {
            code: string;
          };
          error.code = 'write_locked';
          throw error;
        },
      },
      actorDeps(),
    );
    const response = await route(makeRequest({ method: 'POST', origin: APP_ORIGIN }));
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('write_locked');
  });

  it('neznámy objekt ako výnimka je 500, nie 200', async () => {
    const route = defineRoute(
      {
        method: 'GET',
        handler: () => {
          throw { nieje: 'error', apiKey: FAKE_KEY };
        },
      },
      actorDeps(),
    );
    const response = await route(makeRequest());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(FAKE_KEY);
  });
});

describe('rateLimit (vrstva 2)', () => {
  it('okno tlmí ďalšie požiadavky a vracia Retry-After', async () => {
    const route = defineRoute(
      {
        method: 'POST',
        rateLimit: { limit: 2, windowMs: 60_000, bucket: 'test' },
        handler: () => ({}),
      },
      actorDeps(),
    );
    const send = () => route(makeRequest({ method: 'POST', origin: APP_ORIGIN }));
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const third = await send();
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('consumeRateLimit otvorí nové okno po expirácii', () => {
    const rule = { limit: 1, windowMs: 1000 };
    expect(consumeRateLimit('k', rule, 0).allowed).toBe(true);
    expect(consumeRateLimit('k', rule, 500).allowed).toBe(false);
    expect(consumeRateLimit('k', rule, 1500).allowed).toBe(true);
  });

});

describe('logovanie (akceptačné kritérium: každé volanie s request_id)', () => {
  it('úspech aj odmietnutie majú v logu requestId a status', async () => {
    const route = defineRoute(
      { method: 'POST', handler: () => ({}) },
      actorDeps(),
    );

    /*
     * Odmietnutie sa tu do 27. 8. 2026 vyrábalo chýbajúcim sudo oknom. Sudo
     * zmizlo (D100), tak sa berie odmietnutie, ktoré appka má ďalej: mutácia
     * bez hlavičky Origin (D72).
     */
    await route(makeRequest({ method: 'POST', origin: null }));

    const request = lines.filter((l) => l.msg === 'http_request');
    expect(request).toHaveLength(1);
    expect(request[0]!.requestId).toHaveLength(26);
    expect(request[0]!.httpStatus).toBe(403);
    expect(request[0]!.level).toBe('warn');
    expect(request[0]!.errorCode).toBe('origin_missing');
    // Do logu nesmie ísť message chyby (mohla by nesť vstup, I1).
    expect(JSON.stringify(request[0])).not.toContain('CSRF');
  });

  it('úspešné volanie sa loguje na úrovni info s userId', async () => {
    const route = defineRoute(
      { method: 'GET', handler: () => ({}) },
      actorDeps(),
    );
    await route(makeRequest());
    const line = lines.find((l) => l.msg === 'http_request');
    expect(line?.level).toBe('info');
    expect(line?.httpStatus).toBe(200);
    expect(line?.userId).toBe(7);
    expect(typeof line?.durationMs).toBe('number');
  });
});

describe('ok() / fail() / toAppError()', () => {
  it('ok() vracia {ok:true,data}, fail() {ok:false,error}', async () => {
    expect(await (await ok({ a: 1 })).json()).toEqual({ ok: true, data: { a: 1 } });
    const failed = fail(new AppError(404, 'not_found', 'Nenašlo sa.'));
    expect(failed.status).toBe(404);
    expect(await failed.json()).toEqual({
      ok: false,
      error: { code: 'not_found', message: 'Nenašlo sa.' },
    });
  });

  it('ok(undefined) serializuje prázdny objekt', async () => {
    expect(await (await ok(undefined)).json()).toEqual({ ok: true, data: {} });
  });

  it('toAppError() z neznámej hodnoty nikdy nevracia 2xx', () => {
    for (const value of [null, undefined, 'text', 42, new Error('x')]) {
      expect(toAppError(value).httpStatus).toBe(500);
      expect(toAppError(value).detail).toBeUndefined();
    }
  });
});
