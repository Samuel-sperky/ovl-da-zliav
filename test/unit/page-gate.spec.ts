/**
 * Aura Zľavy — unit testy gatingu stránok v middleware (A4/A16, D69, I14 duchom).
 *
 * Reprodukovaná chyba (6.8.2026, čerstvá inštalácia, `users = 0`): GET na `/`,
 * `/nastavenia`, `/ai-agent` vrátil 200 s kompletným shellom appky a klient
 * potom dostal 401 na každé API volanie. Používateľ videl rozbitú appku
 * namiesto prihlasovacieho formulára.
 *
 * Tieto testy strážia, že request na akúkoľvek app stránku BEZ platnej session
 * skončí 307 presmerovaním na `/login` a že `/login`, `/api/*` a statické
 * assety zostávajú nedotknuté. API rúty MUSIA ďalej vracať JSON 401
 * (fail-closed, vlastní `defineRoute()` A5) — middleware ich nesmie
 * presmerovať.
 */
import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE_NAME, SessionError } from '@/lib/auth/session';
import {
  LOGIN_PATH,
  RETURN_TO_COOKIE_NAME,
  createPageGate,
  isGatedPagePath,
  middleware,
  sanitizeReturnTo,
} from '@/middleware';

import type { NextRequest } from 'next/server';

import type { SessionClaims } from '@/contracts';

/* ─────────────────────────────── pomôcky ────────────────────────────────── */

const ORIGIN = 'https://localhost:3070';

function request(path: string, cookie?: string): Request {
  const headers = new Headers({ Accept: 'text/html' });
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new Request(`${ORIGIN}${path}`, { method: 'GET', headers });
}

function claims(now = new Date()): SessionClaims {
  return {
    sub: 1,
    username: 'samuel',
    absoluteExpiresAt: new Date(now.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(now.getTime() + 30 * 60_000),
    sudoUntil: null,
  };
}

/** Gate s platnou session — session vrstva sa tu netestuje (vlastní ju A4). */
const authedGate = createPageGate({ verifySession: async () => claims() });

/** Gate bez platnej session — presne to, čo urobí `verifySession()` bez cookie. */
const anonGate = createPageGate({
  verifySession: async () => {
    throw new SessionError('missing', 'Chýba session cookie — prihlás sa (D69).');
  },
});

/** Cesty, ktoré appka reálne vystavuje (page.tsx pod `src/app`). */
const APP_PAGES = [
  '/',
  '/nastavenia',
  '/ai-agent',
  '/analytika',
  '/audit',
  '/kampane',
  '/kampane/nova',
  '/produkty',
  '/onboarding',
] as const;

/* ═══════════════ 1. neprihlásený sa NESMIE dostať na stránky ═════════════ */

describe('gating stránok — neprihlásený používateľ', () => {
  it.each(APP_PAGES)('GET %s bez session presmeruje na /login', async (path) => {
    const res = await anonGate(request(path));

    // Kľúčová regresia: dnes tu bolo 200 s vyrenderovaným shellom appky.
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(new URL(location as string).pathname).toBe(LOGIN_PATH);
  });

  it('zachová zamýšľanú cestu v parametri `next`', async () => {
    const res = await anonGate(request('/kampane/nova'));
    const url = new URL(res.headers.get('location') as string);
    expect(url.pathname).toBe(LOGIN_PATH);
    expect(url.searchParams.get('next')).toBe('/kampane/nova');
  });

  it('zachová aj query string zamýšľanej cesty', async () => {
    const res = await anonGate(request('/audit?limit=50'));
    const url = new URL(res.headers.get('location') as string);
    expect(url.searchParams.get('next')).toBe('/audit?limit=50');
  });

  it('zapamätá si zamýšľanú cestu v cookie, aby sa po prihlásení dala vrátiť', async () => {
    const res = await anonGate(request('/nastavenia'));
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${RETURN_TO_COOKIE_NAME}=`);
    expect(decodeURIComponent(setCookie)).toContain('/nastavenia');
    // Cookie je servisná — nikdy nie čitateľná z JS a nikdy bez Secure (D72).
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
  });

  it('prázdna alebo pozmenená session cookie je to isté ako žiadna (fail-closed)', async () => {
    for (const cookie of [
      '',
      `${SESSION_COOKIE_NAME}=`,
      `${SESSION_COOKIE_NAME}=nie-je-to-jwt`,
      'ine_cookie=hodnota',
    ]) {
      const res = await anonGate(request('/', cookie));
      expect(res.status).toBe(307);
    }
  });

  it('gate je fail-closed aj keď session vrstva hodí neočakávanú chybu', async () => {
    const brokenGate = createPageGate({
      verifySession: async () => {
        throw new Error('session secret sa nedá načítať');
      },
    });
    const res = await brokenGate(request('/nastavenia'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') as string).pathname).toBe(LOGIN_PATH);
  });

  it('default export middleware používa reálnu session vrstvu a bez cookie presmeruje', async () => {
    const res = await middleware(request('/nastavenia') as unknown as NextRequest);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') as string).pathname).toBe(LOGIN_PATH);
  });
});

/* ══════════════════ 2. /login a statické assety zostávajú ════════════════ */

describe('gating stránok — verejné cesty', () => {
  it('/login je bez session dostupný', async () => {
    const res = await anonGate(request(LOGIN_PATH));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it.each([
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/favicon.ico',
    '/robots.txt',
  ])('statický asset %s middleware nepresmeruje', async (path) => {
    const res = await anonGate(request(path));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});

/* ═══════════ 3. API rúty MUSIA ostať na JSON 401 (fail-closed) ═══════════ */

describe('gating stránok — /api/* sa nesmie presmerovať', () => {
  const API_PATHS = [
    '/api/settings',
    '/api/key',
    '/api/audit',
    '/api/ai/insights',
    '/api/insights/discount-depth',
    '/api/auth/login',
    '/api/health',
    '/api/campaigns',
  ] as const;

  it.each(API_PATHS)('%s prejde na handler aj bez session', async (path) => {
    const res = await anonGate(request(path));
    // Middleware nesmie do API zasahovať — 401 JSON vydáva `defineRoute()`.
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('isGatedPagePath nikdy neoznačí /api/* za gatovanú stránku', () => {
    for (const path of API_PATHS) expect(isGatedPagePath(path)).toBe(false);
    for (const path of APP_PAGES) expect(isGatedPagePath(path)).toBe(true);
    expect(isGatedPagePath(LOGIN_PATH)).toBe(false);
  });
});

/* ═════════════════════ 4. prihlásený používateľ prejde ══════════════════ */

describe('gating stránok — prihlásený používateľ', () => {
  it.each(APP_PAGES)('GET %s s platnou session prejde', async (path) => {
    const res = await authedGate(request(path, `${SESSION_COOKIE_NAME}=platny.jwt.token`));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('/login s platnou session presmeruje na dashboard', async () => {
    const res = await authedGate(request(LOGIN_PATH, `${SESSION_COOKIE_NAME}=platny.jwt.token`));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/');
  });

  it('po prihlásení vráti používateľa na zapamätanú cestu a cookie zahodí', async () => {
    const res = await authedGate(
      request('/', `${SESSION_COOKIE_NAME}=platny.jwt.token; ${RETURN_TO_COOKIE_NAME}=%2Fnastavenia`),
    );
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/nastavenia');
    // Cookie sa spotrebuje práve raz — inak by používateľ nikdy neuvidel dashboard.
    expect(res.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0|Expires=/i);
  });

  it('zapamätaná cesta rovná aktuálnej nespôsobí smyčku', async () => {
    const res = await authedGate(
      request('/', `${SESSION_COOKIE_NAME}=platny.jwt.token; ${RETURN_TO_COOKIE_NAME}=%2F`),
    );
    expect(res.status).toBe(200);
  });
});

/* ═══════════════════════ 5. sanitizácia `next` cesty ════════════════════ */

describe('sanitizeReturnTo — open-redirect a smyčky', () => {
  it('prijme len lokálne app cesty', () => {
    expect(sanitizeReturnTo('/nastavenia')).toBe('/nastavenia');
    expect(sanitizeReturnTo('/audit?limit=50')).toBe('/audit?limit=50');
    expect(sanitizeReturnTo('/')).toBe('/');
  });

  it.each([
    '//zlomyselny.example',
    '/\\zlomyselny.example',
    'https://zlomyselny.example/',
    'http://zlomyselny.example/',
    'nastavenia',
    '',
    '/login',
    '/login?next=/login',
    '/api/settings',
    '/_next/static/x.js',
    '/nastavenia\nSet-Cookie: x=y',
    `/${'a'.repeat(2_000)}`,
  ])('odmietne %j', (raw) => {
    expect(sanitizeReturnTo(raw)).toBeNull();
  });

  it('odmietne aj nereťazcové vstupy', () => {
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo(null)).toBeNull();
  });
});
