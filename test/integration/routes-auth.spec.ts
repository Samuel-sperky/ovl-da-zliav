/**
 * Aura Zľavy — integračné testy route-ov `/api/auth/*` (A11, BUILD-SPEC §5).
 *
 * Overuje sa lepenie route → `lib/auth` (A4) cez `defineRoute()` (A5):
 *  - login: 200 + session cookie, 401 `invalid_credentials`, 429 lockout
 *    s `Retry-After`, 400 zod, 403 chýbajúci Origin (D72),
 *  - session: obnovené idle okno + fail-closed `sudoUntil`,
 *  - sudo: nová cookie s oknom, 401 pri zlom hesle,
 *  - logout: rušiaca cookie.
 *
 * Bez DB (I6): auth vrstva je injektovaná fake implementáciou kontraktov A4,
 * session vrstva pipeline cez `RouteDeps` — testuje sa route, nie argon2/jose.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { SessionClaims } from '@/contracts';

import { clearedSessionCookie, type IssuedSession } from '@/lib/auth';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import { createLoginRoute } from '@/app/api/auth/login/route';
import { createLogoutRoute } from '@/app/api/auth/logout/route';
import { createSessionRoute } from '@/app/api/auth/session/route';
import { createSudoRoute } from '@/app/api/auth/sudo/route';

/* ═══════════════════════════ pomôcky a fixtures ═══════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const APP_HOST = 'zlavy.local';
const NOW = new Date('2026-08-05T10:00:00.000Z');
const GOOD_PASSWORD = 'Spravne-Heslo-123';

function claims(sudoMinutes: number | null): SessionClaims {
  return {
    sub: 7,
    username: 'admin',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: sudoMinutes === null ? null : new Date(NOW.getTime() + sudoMinutes * 60_000),
  };
}

function issuedSession(forClaims: SessionClaims): IssuedSession {
  const cookie = clearedSessionCookie();
  return {
    token: 'fresh-token',
    claims: forClaims,
    cookie: { ...cookie, value: 'fresh-token', options: { ...cookie.options, maxAge: 1800 } },
  };
}

/** Fake session vrstva pipeline (rovnaký princíp ako `define-route.spec.ts`). */
function routeDeps(sessionClaims: SessionClaims | null): RouteDeps {
  return {
    now: () => NOW,
    verifySession: async (token) => {
      if (!token || !sessionClaims) {
        const error = new Error('Session chýba alebo je neplatná.');
        error.name = 'SessionError';
        (error as Error & { code: string }).code = 'missing';
        throw error;
      }
      return {
        claims: sessionClaims,
        refreshed: issuedSession(sessionClaims),
      };
    },
  };
}

interface RequestOptions {
  method?: string;
  origin?: string | null;
  cookie?: string | null;
  body?: unknown;
  path?: string;
}

function makeRequest(options: RequestOptions = {}): Request {
  const method = options.method ?? 'POST';
  const headers = new Headers({ host: APP_HOST, 'x-forwarded-for': '127.0.0.1' });
  if (options.origin !== null) headers.set('origin', options.origin ?? APP_ORIGIN);
  if (options.cookie) headers.set('cookie', options.cookie);
  const init: RequestInit = { method, headers };
  if (options.body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(options.body);
    headers.set('content-type', 'application/json');
  }
  return new Request(`${APP_ORIGIN}${options.path ?? '/api/auth/x'}`, init);
}

interface Body {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const readBody = async (response: Response): Promise<Body> =>
  (await response.json()) as Body;

const VALID_COOKIE = 'ovl_zliav_session=token';

beforeEach(() => {
  resetRateLimiter();
});

/* ════════════════════════════ POST /api/auth/login ════════════════════════ */

describe('POST /api/auth/login', () => {
  const okLogin = (async (input: { username: string; password: string }) => {
    if (input.username === 'admin' && input.password === GOOD_PASSWORD) {
      const c = claims(15);
      return { ok: true as const, user: { id: 7, username: 'admin' }, session: issuedSession(c), claims: c };
    }
    return {
      ok: false as const,
      code: 'invalid_credentials' as const,
      message: 'Nesprávne prihlasovacie meno alebo heslo.',
      retryAfterSeconds: 0,
    };
  }) as never;

  it('úspešný login vráti usera a nastaví session cookie', async () => {
    const route = createLoginRoute({ login: okLogin, routeDeps: routeDeps(null) });
    const response = await route(
      makeRequest({ body: { username: 'admin', password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ user: { id: 7, username: 'admin' } });
    expect(response.headers.get('set-cookie')).toContain('ovl_zliav_session=fresh-token');
    // Heslo sa nikdy nedostane do odpovede (I1).
    expect(JSON.stringify(body)).not.toContain(GOOD_PASSWORD);
  });

  it('zlé heslo vráti 401 invalid_credentials bez enumerácie mien', async () => {
    const route = createLoginRoute({ login: okLogin, routeDeps: routeDeps(null) });
    const response = await route(
      makeRequest({ body: { username: 'admin', password: 'Zle-Heslo-12345' } }),
    );
    expect(response.status).toBe(401);
    const body = await readBody(response);
    expect(body.error?.code).toBe('invalid_credentials');
  });

  it('lockout vráti 429 s Retry-After (D71)', async () => {
    const locked = (async () => ({
      ok: false as const,
      code: 'locked_out' as const,
      message: 'Priveľa neúspešných pokusov.',
      retryAfterSeconds: 120,
    })) as never;
    const route = createLoginRoute({ login: locked, routeDeps: routeDeps(null) });
    const response = await route(
      makeRequest({ body: { username: 'admin', password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
  });

  it('heslo kratšie než 12 znakov odmietne zod 400 ešte pred login()', async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      throw new Error('nemá sa volať');
    }) as never;
    const route = createLoginRoute({ login: spy, routeDeps: routeDeps(null) });
    const response = await route(
      makeRequest({ body: { username: 'admin', password: 'kratke' } }),
    );
    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe('validation_failed');
    expect(called).toBe(false);
  });

  it('mutácia bez Origin hlavičky je odmietnutá 403 (D72)', async () => {
    const route = createLoginRoute({ login: okLogin, routeDeps: routeDeps(null) });
    const response = await route(
      makeRequest({ origin: null, body: { username: 'admin', password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(403);
  });
});

/* ════════════════════════════ GET /api/auth/session ═══════════════════════ */

describe('GET /api/auth/session', () => {
  it('vracia meno, konce platnosti a platné sudo okno', async () => {
    const route = createSessionRoute(routeDeps(claims(10)));
    const response = await route(makeRequest({ method: 'GET', cookie: VALID_COOKIE }));
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data?.username).toBe('admin');
    expect(body.data?.sudoUntil).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString());
    expect(body.data?.absoluteExpiresAt).toBe(claims(0).absoluteExpiresAt.toISOString());
  });

  it('expirované sudo okno hlási null (fail-closed, I3)', async () => {
    const route = createSessionRoute(routeDeps(claims(-1)));
    const response = await route(makeRequest({ method: 'GET', cookie: VALID_COOKIE }));
    expect((await readBody(response)).data?.sudoUntil).toBeNull();
  });

  it('bez session cookie vráti 401', async () => {
    const route = createSessionRoute(routeDeps(null));
    const response = await route(makeRequest({ method: 'GET' }));
    expect(response.status).toBe(401);
  });
});

/* ════════════════════════════ POST /api/auth/sudo ═════════════════════════ */

describe('POST /api/auth/sudo', () => {
  const sudoUntil = new Date(NOW.getTime() + 15 * 60_000);
  const grant = (async (input: { password: string }) => {
    if (input.password === GOOD_PASSWORD) {
      return { ok: true as const, sudoUntil, session: issuedSession(claims(15)) };
    }
    return {
      ok: false as const,
      code: 'invalid_password' as const,
      message: 'Nesprávne heslo.',
      retryAfterSeconds: 0,
    };
  }) as never;

  it('správne heslo otvorí sudo okno a vráti novú cookie', async () => {
    const route = createSudoRoute({ grantSudo: grant, routeDeps: routeDeps(claims(null)) });
    const response = await route(
      makeRequest({ cookie: VALID_COOKIE, body: { password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data?.sudoUntil).toBe(sudoUntil.toISOString());
    expect(response.headers.get('set-cookie')).toContain('ovl_zliav_session=fresh-token');
  });

  it('zlé heslo vráti 401 invalid_password', async () => {
    const route = createSudoRoute({ grantSudo: grant, routeDeps: routeDeps(claims(null)) });
    const response = await route(
      makeRequest({ cookie: VALID_COOKIE, body: { password: 'Zle-Heslo-12345' } }),
    );
    expect(response.status).toBe(401);
    expect((await readBody(response)).error?.code).toBe('invalid_password');
  });

  it('bez session je 401 ešte pred overením hesla', async () => {
    const route = createSudoRoute({ grantSudo: grant, routeDeps: routeDeps(null) });
    const response = await route(makeRequest({ body: { password: GOOD_PASSWORD } }));
    expect(response.status).toBe(401);
  });
});

/* ════════════════════════════ POST /api/auth/logout ═══════════════════════ */

describe('POST /api/auth/logout', () => {
  it('zruší session cookie a vráti {}', async () => {
    const seen: Array<number | undefined> = [];
    const fakeLogout = (async (input: { claims: SessionClaims | null }) => {
      seen.push(input.claims?.sub);
      return { cookie: clearedSessionCookie() };
    }) as never;
    const route = createLogoutRoute({ logout: fakeLogout, routeDeps: routeDeps(claims(null)) });
    const response = await route(makeRequest({ cookie: VALID_COOKIE, body: {} }));
    expect(response.status).toBe(200);
    expect((await readBody(response)).data).toEqual({});
    expect(seen).toEqual([7]);
    // Posledná Set-Cookie je rušiaca (Max-Age=0).
    const cookies = response.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('Max-Age=0');
  });

  it('bez session vráti 401 (auth: session podľa §5)', async () => {
    const route = createLogoutRoute({ routeDeps: routeDeps(null) });
    const response = await route(makeRequest({ body: {} }));
    expect(response.status).toBe(401);
  });
});
