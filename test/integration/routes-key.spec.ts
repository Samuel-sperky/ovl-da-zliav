/**
 * Aura Zľavy — integračné testy `/api/key` (A11, BUILD-SPEC §5, §7).
 *
 * Sonda `probeKey` beží proti REÁLNEMU mock shopu (A6, I6) — overuje sa tak
 * celá cesta route → shop klient (A3) → mock. Repozitáre sú in-memory fakes
 * kontraktov, executor je fake (zápisovú dávku vlastní A9 a má vlastné testy).
 *
 * Akceptačné kritériá:
 *  - GET nikdy nevráti viac než last4 + časy + verifyStatus (I1, D65),
 *  - PUT overí kľúč sondou `reduction=0` (D53), uloží s TTL ≤ 48 h a dopáli
 *    `needs_key` kampane, ktoré sú stále vo svojom okne (D24, D25),
 *  - kľúč bez scope sa NEULOŽÍ (403 → 409 `key_invalid`),
 *  - DELETE (panic, D67) vyžaduje heslo + literál `KLUC UNIKOL`, wipne kľúč,
 *    zruší čakajúce kampane a vráti runbook.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  ApiKeyMeta,
  AuditInput,
  CampaignRecord,
  CampaignStatus,
  ExecutorResult,
  KeyWipeReason,
  SecretRef,
  ShopCtx,
} from '@/contracts';

import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import { createShopClient } from '@/lib/shop/client';
import type { ApiKeyRepository } from '@/lib/repo/api-key.repo';
import {
  createKeyDeleteRoute,
  createKeyGetRoute,
  createKeyPutRoute,
  PANIC_CONFIRM_LITERAL,
  PANIC_RUNBOOK_URL,
  type KeyRouteDeps,
} from '@/app/api/key/route';

import { makeCampaign, fakeSecretRef, TEST_NOW, testDay } from '../helpers/factories';
import {
  startMockShopWithOverride,
  VALID_API_KEY,
  NO_SCOPE_API_KEY,
  type RunningMockShop,
} from '../helpers/mock';

/* ═══════════════════════════ pomôcky a fixtures ═══════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const APP_HOST = 'zlavy.local';
const NOW = TEST_NOW; // 2026-08-05T08:00:00Z → dnes je 2026-08-05
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

function makeRequest(options: {
  method?: string;
  origin?: string | null;
  body?: unknown;
} = {}): Request {
  const method = options.method ?? 'GET';
  const headers = new Headers({ host: APP_HOST, 'x-forwarded-for': '127.0.0.1' });
  if (options.origin !== null) headers.set('origin', APP_ORIGIN);
  headers.set('cookie', VALID_COOKIE);
  const init: RequestInit = { method, headers };
  if (options.body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(options.body);
    headers.set('content-type', 'application/json');
  }
  return new Request(`${APP_ORIGIN}/api/key`, init);
}

interface Body {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}
const readBody = async (r: Response): Promise<Body> => (await r.json()) as Body;

/* ────────────────────────── in-memory api_key repo ───────────────────────── */

interface ApiKeyFake {
  repo: ApiKeyRepository;
  stored: Array<{ last4: string; ttlHours: number }>;
  wipes: KeyWipeReason[];
  meta: () => ApiKeyMeta;
}

function makeApiKeyFake(initial?: { last4: string }): ApiKeyFake {
  let meta: ApiKeyMeta = initial
    ? {
        present: true,
        last4: initial.last4,
        savedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 48 * 3_600_000),
        secondsLeft: 48 * 3600,
        verifyStatus: 'valid',
        lastUsedAt: null,
      }
    : {
        present: false,
        last4: null,
        savedAt: null,
        expiresAt: null,
        secondsLeft: null,
        verifyStatus: null,
        lastUsedAt: null,
      };
  const stored: ApiKeyFake['stored'] = [];
  const wipes: KeyWipeReason[] = [];

  const repo: ApiKeyRepository = {
    async getMeta() {
      return meta;
    },
    async store(plain, _last4, ttlHours) {
      const last4 = plain.toString('utf8').slice(-4);
      plain.fill(0);
      const expiresAt = new Date(NOW.getTime() + ttlHours * 3_600_000);
      meta = {
        present: true,
        last4,
        savedAt: NOW,
        expiresAt,
        secondsLeft: ttlHours * 3600,
        verifyStatus: 'unverified',
        lastUsedAt: null,
      };
      stored.push({ last4, ttlHours });
      return { expiresAt, last4 };
    },
    async loadForUse(): Promise<SecretRef | null> {
      return meta.present ? fakeSecretRef() : null;
    },
    async wipe(reason: KeyWipeReason) {
      wipes.push(reason);
      const had = meta.present;
      meta = {
        present: false,
        last4: null,
        savedAt: null,
        expiresAt: null,
        secondsLeft: null,
        verifyStatus: null,
        lastUsedAt: null,
      };
      return had;
    },
    async setVerifyStatus(status) {
      meta = { ...meta, verifyStatus: status };
    },
    async touchLastUsed() {},
  };

  return { repo, stored, wipes, meta: () => meta };
}

/* ───────────────────────── in-memory campaigns repo ──────────────────────── */

interface CampaignsFake {
  campaigns: CampaignRecord[];
  statusChanges: Array<{ id: number; status: CampaignStatus }>;
  repo: NonNullable<KeyRouteDeps['campaigns']>;
}

function makeCampaignsFake(seed: CampaignRecord[]): CampaignsFake {
  const campaigns = seed.map((c) => ({ ...c }));
  const statusChanges: CampaignsFake['statusChanges'] = [];
  const repo: CampaignsFake['repo'] = {
    async findNeedsKey() {
      return campaigns.filter((c) => c.status === 'needs_key');
    },
    async list(filter) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : filter.status
          ? [filter.status]
          : null;
      const data = campaigns.filter((c) => statuses === null || statuses.includes(c.status));
      return { data, page: 1, perPage: data.length, total: data.length };
    },
    async setStatus(id, status, patch) {
      statusChanges.push({ id, status });
      const target = campaigns.find((c) => c.id === id);
      if (target) {
        target.status = status;
        if (patch?.dateFrom) target.dateFrom = patch.dateFrom;
      }
    },
  };
  return { campaigns, statusChanges, repo };
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

/** Sonda proti mocku — reálny klient A3, base URL mocku (I6). */
const probeAgainstMock = (key: SecretRef, ctx: ShopCtx) =>
  createShopClient({ baseUrl: mock.baseUrl }).probeKey(key, ctx);

function baseDeps(overrides: Partial<KeyRouteDeps> = {}): KeyRouteDeps {
  return {
    apiKey: makeApiKeyFake().repo,
    campaigns: makeCampaignsFake([]).repo,
    users: { getById: async () => ({ passwordHash: 'argon2-fake-hash' }) },
    verify: async (_hash, password) => password === GOOD_PASSWORD,
    audit: async () => {},
    probeKey: probeAgainstMock,
    execute: async (campaignId) =>
      ({ campaignId, status: 'done', itemsTotal: 0, itemsOk: 0, itemsFailed: 0, itemsUncertain: 0, items: [] }) as ExecutorResult,
    now: () => NOW,
    timeZone: 'Europe/Bratislava',
    routeDeps: routeDeps(claims(10)),
    ...overrides,
  };
}

/* ════════════════════════════════ GET ═════════════════════════════════════ */

describe('GET /api/key', () => {
  it('vracia výhradne last4 + časy + verifyStatus — nikdy celý kľúč (I1, D65)', async () => {
    const fake = makeApiKeyFake({ last4: '0001' });
    const route = createKeyGetRoute(baseDeps({ apiKey: fake.repo }));
    const response = await route(makeRequest());
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data).toMatchObject({ present: true, last4: '0001', verifyStatus: 'valid' });
    expect(Object.keys(body.data ?? {}).sort()).toEqual(
      ['expiresAt', 'last4', 'present', 'savedAt', 'secondsLeft', 'verifyStatus'].sort(),
    );
    expect(JSON.stringify(body)).not.toContain(VALID_API_KEY);
  });

  it('bez kľúča hlási present:false', async () => {
    const route = createKeyGetRoute(baseDeps());
    const body = await readBody(await route(makeRequest()));
    expect(body.data?.present).toBe(false);
    expect(body.data?.last4).toBeNull();
  });
});

/* ════════════════════════════════ PUT ═════════════════════════════════════ */

describe('PUT /api/key', () => {
  it('platný kľúč: sonda valid → uloží s TTL ≤ 48 h a dopáli needs_key kampaň v okne (D24)', async () => {
    const apiKey = makeApiKeyFake();
    const inWindow = makeCampaign({
      id: 11,
      status: 'needs_key',
      dateFrom: testDay(1),
      dateTo: testDay(10),
    });
    const outOfWindow = makeCampaign({
      id: 12,
      status: 'needs_key',
      dateFrom: testDay(-20),
      dateTo: testDay(-10),
    });
    const campaigns = makeCampaignsFake([inWindow, outOfWindow]);
    const executed: number[] = [];
    const route = createKeyPutRoute(
      baseDeps({
        apiKey: apiKey.repo,
        campaigns: campaigns.repo,
        execute: async (campaignId) => {
          executed.push(campaignId);
          return {
            campaignId,
            status: 'done',
            itemsTotal: 1,
            itemsOk: 1,
            itemsFailed: 0,
            itemsUncertain: 0,
            items: [],
          };
        },
      }),
    );

    const response = await route(makeRequest({ method: 'PUT', body: { apiKey: VALID_API_KEY } }));
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data?.last4).toBe(VALID_API_KEY.slice(-4));
    expect(body.data?.verifyStatus).toBe('valid');
    expect(JSON.stringify(body)).not.toContain(VALID_API_KEY);

    expect(apiKey.stored).toHaveLength(1);
    expect(apiKey.stored[0]!.ttlHours).toBeLessThanOrEqual(48);
    expect(apiKey.meta().verifyStatus).toBe('valid');

    // D24/D25 — kampaň v okne sa dopálila, kampaň s oknom v minulosti prepadla.
    expect(executed).toEqual([11]);
    expect(campaigns.statusChanges).toContainEqual({ id: 12, status: 'lapsed' });
  });

  it('kľúč bez scope product:edit sa NEULOŽÍ (409 key_invalid)', async () => {
    const apiKey = makeApiKeyFake();
    const route = createKeyPutRoute(baseDeps({ apiKey: apiKey.repo }));
    const response = await route(
      makeRequest({ method: 'PUT', body: { apiKey: NO_SCOPE_API_KEY } }),
    );
    expect(response.status).toBe(409);
    expect((await readBody(response)).error?.code).toBe('key_invalid');
    expect(apiKey.stored).toHaveLength(0);
    expect(apiKey.meta().present).toBe(false);
  });

  it('neznámy kľúč (mock 401) sa NEULOŽÍ (409 key_invalid)', async () => {
    const apiKey = makeApiKeyFake();
    const route = createKeyPutRoute(baseDeps({ apiKey: apiKey.repo }));
    const response = await route(
      makeRequest({ method: 'PUT', body: { apiKey: 'fake-shop-key-unknown-9999' } }),
    );
    expect(response.status).toBe(409);
    expect(apiKey.stored).toHaveLength(0);
  });

  it('bez sudo okna je 401 sudo_required a sonda sa ani nespustí (I3)', async () => {
    let probed = false;
    const route = createKeyPutRoute(
      baseDeps({
        routeDeps: routeDeps(claims(null)),
        probeKey: async () => {
          probed = true;
          return 'valid';
        },
      }),
    );
    const response = await route(makeRequest({ method: 'PUT', body: { apiKey: VALID_API_KEY } }));
    expect(response.status).toBe(401);
    expect((await readBody(response)).error?.code).toBe('sudo_required');
    expect(probed).toBe(false);
  });

  it('prikrátky kľúč odmietne zod 400', async () => {
    const route = createKeyPutRoute(baseDeps());
    const response = await route(makeRequest({ method: 'PUT', body: { apiKey: 'kratky' } }));
    expect(response.status).toBe(400);
  });
});

/* ═══════════════════════════════ DELETE ═══════════════════════════════════ */

describe('DELETE /api/key (panic button, D67)', () => {
  it('heslo + literál KLUC UNIKOL: wipe, zrušené čakajúce kampane, runbook', async () => {
    const apiKey = makeApiKeyFake({ last4: '0001' });
    const audits: AuditInput[] = [];
    const campaigns = makeCampaignsFake([
      makeCampaign({ id: 21, status: 'scheduled' }),
      makeCampaign({ id: 22, status: 'needs_key' }),
      makeCampaign({ id: 23, status: 'done' }),
    ]);
    const route = createKeyDeleteRoute(
      baseDeps({
        apiKey: apiKey.repo,
        campaigns: campaigns.repo,
        audit: async (input) => {
          audits.push(input);
        },
      }),
    );

    const response = await route(
      makeRequest({
        method: 'DELETE',
        body: { password: GOOD_PASSWORD, confirm: PANIC_CONFIRM_LITERAL },
      }),
    );
    expect(response.status).toBe(200);
    const body = await readBody(response);
    expect(body.data).toEqual({
      wiped: true,
      cancelledCampaigns: 2,
      runbookUrl: PANIC_RUNBOOK_URL,
    });

    expect(apiKey.wipes).toEqual(['panic_button']);
    expect(apiKey.meta().present).toBe(false);
    // `done` kampaň sa nezrušila; čakajúce áno.
    expect(campaigns.campaigns.find((c) => c.id === 21)?.status).toBe('cancelled');
    expect(campaigns.campaigns.find((c) => c.id === 22)?.status).toBe('cancelled');
    expect(campaigns.campaigns.find((c) => c.id === 23)?.status).toBe('done');
    expect(audits.filter((a) => a.eventType === 'campaign_cancelled')).toHaveLength(2);
  });

  it('zruší aj viac než 100 čakajúcich kampaní napriek clampu perPage (E9)', async () => {
    const apiKey = makeApiKeyFake({ last4: '0001' });
    const campaigns = Array.from({ length: 150 }, (_, i) =>
      makeCampaign({ id: i + 1, status: 'scheduled' }),
    );
    // Repo s rovnakým clampom ako produkčný `campaigns.repo`: perPage max 100.
    const repo: NonNullable<KeyRouteDeps['campaigns']> = {
      async findNeedsKey() {
        return [];
      },
      async list(filter) {
        const perPage = Math.min(100, Math.max(1, Math.trunc(filter.perPage ?? 20)));
        const page = Math.max(1, Math.trunc(filter.page ?? 1));
        const statuses = Array.isArray(filter.status)
          ? filter.status
          : filter.status
            ? [filter.status]
            : null;
        const matching = campaigns.filter(
          (c) => statuses === null || statuses.includes(c.status),
        );
        return {
          data: matching.slice((page - 1) * perPage, page * perPage),
          page,
          perPage,
          total: matching.length,
        };
      },
      async setStatus(id, status) {
        const target = campaigns.find((c) => c.id === id);
        if (target) target.status = status;
      },
    };
    const route = createKeyDeleteRoute(baseDeps({ apiKey: apiKey.repo, campaigns: repo }));

    const response = await route(
      makeRequest({
        method: 'DELETE',
        body: { password: GOOD_PASSWORD, confirm: PANIC_CONFIRM_LITERAL },
      }),
    );

    expect(response.status).toBe(200);
    const body = await readBody(response);
    // Pred opravou: perPage 1000 → clamp 100 → 50 kampaní zostalo čakať.
    expect(body.data?.cancelledCampaigns).toBe(150);
    expect(campaigns.every((c) => c.status === 'cancelled')).toBe(true);
  });

  it('zlý literál odmietne zod 400 a nič sa newipne', async () => {
    const apiKey = makeApiKeyFake({ last4: '0001' });
    const route = createKeyDeleteRoute(baseDeps({ apiKey: apiKey.repo }));
    const response = await route(
      makeRequest({ method: 'DELETE', body: { password: GOOD_PASSWORD, confirm: 'nie' } }),
    );
    expect(response.status).toBe(400);
    expect(apiKey.wipes).toHaveLength(0);
  });

  it('zlé heslo vráti 401 a nič sa newipne', async () => {
    const apiKey = makeApiKeyFake({ last4: '0001' });
    const route = createKeyDeleteRoute(baseDeps({ apiKey: apiKey.repo }));
    const response = await route(
      makeRequest({
        method: 'DELETE',
        body: { password: 'Zle-Heslo-12345', confirm: PANIC_CONFIRM_LITERAL },
      }),
    );
    expect(response.status).toBe(401);
    expect(apiKey.wipes).toHaveLength(0);
  });
});
