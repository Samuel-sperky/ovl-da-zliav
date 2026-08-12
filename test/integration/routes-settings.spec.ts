/**
 * Aura Zľavy — integračné testy `/api/settings*` (A11, BUILD-SPEC §5).
 *
 * Canary volania bežia proti REÁLNEMU mock shopu (A6, I6) cez shop klienta
 * (A3); repozitáre sú in-memory fakes kontraktov z `src/contracts.ts`.
 *
 * Akceptačné kritériá:
 *  - `PUT /api/settings/domain` prijme len `https://` URL, vyžaduje sudo
 *    + heslo a PRED uložením spustí canary GET (D55, D80) — pri zlyhaní
 *    canary sa doména NEULOŽÍ,
 *  - `POST /api/settings/test-connection` vráti `{ok, httpStatus, total,
 *    latencyMs}` (D55),
 *  - `POST /api/settings/unlock-writes` odomkne runaway zámok len s heslom
 *    (D79) a zapíše audit `writes_unlocked`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuditInput, SettingsRecord, ShopCtx } from '@/contracts';

import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import { createShopClient } from '@/lib/shop/client';
import { createSettingsRoute } from '@/app/api/settings/route';
import { createDomainRoute } from '@/app/api/settings/domain/route';
import { createTestConnectionRoute } from '@/app/api/settings/test-connection/route';
import { createEagerWriteDefaultRoute } from '@/app/api/settings/eager-write-default/route';
import { createUnlockWritesRoute } from '@/app/api/settings/unlock-writes/route';

import { makeSettings, TEST_NOW } from '../helpers/factories';
import { startMockShopWithOverride, type RunningMockShop } from '../helpers/mock';

/* ═══════════════════════════ pomôcky a fixtures ═══════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const APP_HOST = 'zlavy.local';
const NOW = TEST_NOW;
const GOOD_PASSWORD = 'Spravne-Heslo-123';
const VALID_COOKIE = 'ovl_zliav_session=token';

function claims(sudoMinutes: number | null) {
  return {
    sub: 7,
    username: 'admin',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: sudoMinutes === null ? null : new Date(NOW.getTime() + sudoMinutes * 60_000),
  };
}

function routeDeps(sessionClaims: ReturnType<typeof claims> | null): RouteDeps {
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
        refreshed: {
          token: 'refreshed',
          claims: sessionClaims,
          cookie: {
            name: 'ovl_zliav_session' as const,
            value: 'refreshed',
            options: {
              httpOnly: true as const,
              secure: true as const,
              sameSite: 'strict' as const,
              path: '/',
              maxAge: 1800,
            },
          },
        },
      };
    },
  };
}

function makeRequest(options: { method?: string; path?: string; body?: unknown } = {}): Request {
  const method = options.method ?? 'GET';
  const headers = new Headers({
    host: APP_HOST,
    'x-forwarded-for': '127.0.0.1',
    origin: APP_ORIGIN,
    cookie: VALID_COOKIE,
  });
  const init: RequestInit = { method, headers };
  if (options.body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(options.body);
    headers.set('content-type', 'application/json');
  }
  return new Request(`${APP_ORIGIN}${options.path ?? '/api/settings'}`, init);
}

interface Body {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}
const readBody = async (r: Response): Promise<Body> => (await r.json()) as Body;

/* ─────────────────────── in-memory settings repo fake ────────────────────── */

function makeSettingsFake(overrides: Partial<SettingsRecord> = {}) {
  let record = makeSettings(overrides);
  const domainWrites: Array<{ domain: string; confirmedAt: Date | null }> = [];
  let unlockCalls = 0;
  return {
    domainWrites,
    unlockCalls: () => unlockCalls,
    record: () => record,
    repo: {
      async get() {
        return record;
      },
      async setShopDomain(domain: string, confirmedAt: Date | null) {
        domainWrites.push({ domain, confirmedAt });
        record = { ...record, shopDomain: domain, shopDomainConfirmedAt: confirmedAt };
      },
      async setEagerWriteDefault(enabled: boolean) {
        record = { ...record, eagerWriteDefault: enabled };
      },
      async unlockWrites() {
        unlockCalls += 1;
        record = { ...record, writesLocked: false, writesLockedReason: null };
      },
    },
  };
}

/* ═════════════════════════════ mock shop (I6) ═════════════════════════════ */

let mock: RunningMockShop;

beforeAll(async () => {
  mock = await startMockShopWithOverride();
});

afterAll(async () => {
  await mock.stop();
});

beforeEach(() => {
  resetRateLimiter();
  mock.state.reset();
});

// `sleepFn` no-op: retry backoff klienta nesmie spomaľovať testy.
const canaryAgainstMock = (ctx: ShopCtx) =>
  createShopClient({ baseUrl: mock.baseUrl, sleepFn: async () => {} }).canary(ctx);

/* ════════════════════════════ GET /api/settings ═══════════════════════════ */

describe('GET /api/settings', () => {
  it('vracia polia podľa §5', async () => {
    const settings = makeSettingsFake({
      shopDomain: 'https://www.sperky-shop.example',
      writesLocked: true,
      writesLockedReason: 'runaway',
    });
    const route = createSettingsRoute({ settings: settings.repo, routeDeps: routeDeps(claims(null)) });
    const body = await readBody(await route(makeRequest()));
    expect(body.data).toMatchObject({
      shopDomain: 'https://www.sperky-shop.example',
      eagerWriteDefault: true,
      writesLocked: true,
      writesLockedReason: 'runaway',
    });
  });

  it('bez session vráti 401', async () => {
    const route = createSettingsRoute({ settings: makeSettingsFake().repo, routeDeps: routeDeps(null) });
    expect((await route(makeRequest())).status).toBe(401);
  });
});

/* ════════════════════════ PUT /api/settings/domain ════════════════════════ */

describe('PUT /api/settings/domain', () => {
  const NEW_DOMAIN = 'https://www.sperky-eshop.example';

  function domainRoute(settings: ReturnType<typeof makeSettingsFake>, options: {
    sudo?: number | null;
    canaryOk?: boolean;
    audits?: AuditInput[];
  } = {}) {
    return createDomainRoute({
      settings: settings.repo,
      users: { getById: async () => ({ passwordHash: 'argon2-fake-hash' }) },
      verify: async (_hash, password) => password === GOOD_PASSWORD,
      audit: async (input) => {
        options.audits?.push(input);
      },
      // Canary proti kandidátskej doméne — v teste presmerovaná na mock (I6).
      canary: (_baseUrl, ctx) =>
        options.canaryOk === false
          ? Promise.resolve({
              ok: false,
              total: 0,
              latencyMs: 5,
              httpStatus: 503,
              error: {
                kind: 'server_error' as const,
                code: null,
                message: 'Shop je nedostupný.',
                httpStatus: 503,
                retryable: true,
              },
            })
          : canaryAgainstMock(ctx),
      routeDeps: routeDeps(claims(options.sudo === undefined ? 10 : options.sudo)),
    });
  }

  it('uloží doménu až PO úspešnom canary a zapíše audit (D55, D80)', async () => {
    const settings = makeSettingsFake({ shopDomain: null });
    const audits: AuditInput[] = [];
    const route = domainRoute(settings, { audits });
    const response = await route(
      makeRequest({ method: 'PUT', body: { domain: NEW_DOMAIN, password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data?.shopDomain).toBe(NEW_DOMAIN);
    expect((body.data?.canary as { ok: boolean; total: number }).ok).toBe(true);
    expect((body.data?.canary as { ok: boolean; total: number }).total).toBeGreaterThan(0);
    expect(settings.domainWrites).toEqual([{ domain: NEW_DOMAIN, confirmedAt: NOW }]);
    expect(audits.map((a) => a.eventType)).toEqual(['canary_ok', 'domain_changed']);
  });

  it('pri zlyhaní canary sa doména NEULOŽÍ (fail-closed)', async () => {
    const settings = makeSettingsFake({ shopDomain: null });
    const audits: AuditInput[] = [];
    const route = domainRoute(settings, { canaryOk: false, audits });
    const response = await route(
      makeRequest({ method: 'PUT', body: { domain: NEW_DOMAIN, password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(502);
    expect((await readBody(response)).error?.code).toBe('canary_failed');
    expect(settings.domainWrites).toHaveLength(0);
    expect(audits.map((a) => a.eventType)).toEqual(['canary_fail']);
  });

  it('http:// doménu odmietne zod 400 ešte pred heslom a canary', async () => {
    const settings = makeSettingsFake();
    const route = domainRoute(settings);
    const response = await route(
      makeRequest({
        method: 'PUT',
        body: { domain: 'http://www.sperky-eshop.example', password: GOOD_PASSWORD },
      }),
    );
    expect(response.status).toBe(400);
    expect(settings.domainWrites).toHaveLength(0);
  });

  it('zlé heslo vráti 401 a doména sa neuloží (D80)', async () => {
    const settings = makeSettingsFake();
    const route = domainRoute(settings);
    const response = await route(
      makeRequest({ method: 'PUT', body: { domain: NEW_DOMAIN, password: 'Zle-Heslo-12345' } }),
    );
    expect(response.status).toBe(401);
    expect((await readBody(response)).error?.code).toBe('invalid_password');
    expect(settings.domainWrites).toHaveLength(0);
  });

  it('bez sudo okna je 401 sudo_required (D70)', async () => {
    const settings = makeSettingsFake();
    const route = domainRoute(settings, { sudo: null });
    const response = await route(
      makeRequest({ method: 'PUT', body: { domain: NEW_DOMAIN, password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(401);
    expect((await readBody(response)).error?.code).toBe('sudo_required');
  });
});

/* ═══════════════════ POST /api/settings/test-connection ═══════════════════ */

describe('POST /api/settings/test-connection', () => {
  it('proti mocku vráti ok:true, total a latenciu (D55)', async () => {
    const audits: AuditInput[] = [];
    const route = createTestConnectionRoute({
      canary: canaryAgainstMock,
      audit: async (input) => {
        audits.push(input);
      },
      routeDeps: routeDeps(claims(null)),
    });
    const response = await route(makeRequest({ method: 'POST', body: {} }));
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data?.ok).toBe(true);
    expect(body.data?.httpStatus).toBe(200);
    expect(body.data?.total).toBeGreaterThan(0);
    expect(typeof body.data?.latencyMs).toBe('number');
    expect(audits.map((a) => a.eventType)).toEqual(['canary_ok']);
  });

  it('pri výpadku shopu vráti ok:false a audit canary_fail', async () => {
    mock.state.failNth(1, 'server_error', { target: 'read', times: 99 });
    const audits: AuditInput[] = [];
    const route = createTestConnectionRoute({
      canary: canaryAgainstMock,
      audit: async (input) => {
        audits.push(input);
      },
      routeDeps: routeDeps(claims(null)),
    });
    const response = await route(makeRequest({ method: 'POST', body: {} }));
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data?.ok).toBe(false);
    expect(audits.map((a) => a.eventType)).toEqual(['canary_fail']);
  });
});

/* ═══════════════ PUT /api/settings/eager-write-default (D22) ══════════════ */

describe('PUT /api/settings/eager-write-default', () => {
  it('prepne default a vráti novú hodnotu', async () => {
    const settings = makeSettingsFake({ eagerWriteDefault: true });
    const route = createEagerWriteDefaultRoute({
      settings: settings.repo,
      routeDeps: routeDeps(claims(null)),
    });
    const response = await route(
      makeRequest({ method: 'PUT', body: { enabled: false } }),
    );
    expect(response.status).toBe(200);
    expect((await readBody(response)).data).toEqual({ eagerWriteDefault: false });
    expect(settings.record().eagerWriteDefault).toBe(false);
  });

  it('nie-boolean odmietne zod 400', async () => {
    const route = createEagerWriteDefaultRoute({
      settings: makeSettingsFake().repo,
      routeDeps: routeDeps(claims(null)),
    });
    const response = await route(makeRequest({ method: 'PUT', body: { enabled: 'ano' } }));
    expect(response.status).toBe(400);
  });
});

/* ═══════════════════ POST /api/settings/unlock-writes (D79) ═══════════════ */

describe('POST /api/settings/unlock-writes', () => {
  function unlockRoute(settings: ReturnType<typeof makeSettingsFake>, options: {
    sudo?: number | null;
    audits?: AuditInput[];
  } = {}) {
    return createUnlockWritesRoute({
      settings: settings.repo,
      users: { getById: async () => ({ passwordHash: 'argon2-fake-hash' }) },
      verify: async (_hash, password) => password === GOOD_PASSWORD,
      audit: async (input) => {
        options.audits?.push(input);
      },
      routeDeps: routeDeps(claims(options.sudo === undefined ? 10 : options.sudo)),
    });
  }

  it('heslo + sudo odomkne zámok a zapíše audit writes_unlocked', async () => {
    const settings = makeSettingsFake({ writesLocked: true, writesLockedReason: 'runaway (D79)' });
    const audits: AuditInput[] = [];
    const route = unlockRoute(settings, { audits });
    const response = await route(
      makeRequest({ method: 'POST', body: { password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(200);
    const data = (await readBody(response)).data as {
      writesLocked: boolean;
      blockers?: readonly { id: string }[];
    };
    expect(data.writesLocked).toBe(false);
    expect(settings.unlockCalls()).toBe(1);
    expect(settings.record().writesLocked).toBe(false);
    expect(audits.map((a) => a.eventType)).toEqual(['writes_unlocked']);

    // Odomknutie runaway zámku (D79) NIE JE to isté ako zapnuté zápisy (I13).
    // Odpoveď preto nesie aj zvyšné prekážky — bez toho by obrazovka po
    // úspešnom odomknutí tvrdila „hotovo", hoci `WRITES_ENABLED` je vypnuté
    // a nezapísal by sa ani jeden produkt.
    expect(data.blockers?.some((b) => b.id === 'writes_disabled')).toBe(true);
  });

  it('zlé heslo vráti 401 a zámok zostáva (fail-closed, I12)', async () => {
    const settings = makeSettingsFake({ writesLocked: true });
    const route = unlockRoute(settings);
    const response = await route(
      makeRequest({ method: 'POST', body: { password: 'Zle-Heslo-12345' } }),
    );
    expect(response.status).toBe(401);
    expect(settings.unlockCalls()).toBe(0);
    expect(settings.record().writesLocked).toBe(true);
  });

  it('bez sudo okna je 401 sudo_required', async () => {
    const settings = makeSettingsFake({ writesLocked: true });
    const route = unlockRoute(settings, { sudo: null });
    const response = await route(
      makeRequest({ method: 'POST', body: { password: GOOD_PASSWORD } }),
    );
    expect(response.status).toBe(401);
    expect(settings.unlockCalls()).toBe(0);
  });
});
