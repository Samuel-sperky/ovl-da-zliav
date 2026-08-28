/**
 * Aura Zľavy — integračné testy `/api/settings*` (A11, BUILD-SPEC §5).
 *
 * Canary volania bežia proti REÁLNEMU mock shopu (A6, I6) cez shop klienta
 * (A3); repozitáre sú in-memory fakes kontraktov z `src/contracts.ts`.
 *
 * Akceptačné kritériá:
 *  - `PUT /api/settings/domain` prijme len `https://` URL a PRED uložením
 *    spustí canary GET proti NOVEJ doméne (D55, D80) — pri zlyhaní canary sa
 *    doména NEULOŽÍ,
 *  - `POST /api/settings/test-connection` vráti `{ok, httpStatus, total,
 *    latencyMs}` (D55),
 *  - `POST /api/settings/unlock-writes` odomkne runaway zámok VÝHRADNE
 *    s výslovným `confirmed: true` (D79) a zapíše audit `writes_unlocked`.
 *
 * Heslo a sudo okno tu boli do 27. 8. 2026 (D99, D100). Potvrdenie zápisu tým
 * nezmizlo — I3 ho vyžaduje ďalej, len ho namiesto hesla drží `confirmed`
 * v tele. Testy nižšie preto strážia „bez potvrdenia sa nič nezmení a nič sa
 * nezapíše do auditu" (fail-closed, I12) a to, že audit nesie lokálneho
 * actora (`samuel`, id 1, D102).
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

/**
 * Deps pre `defineRoute()`. Do 27. 8. 2026 tu bol stub SESSION vrstvy
 * (`verifySession`) a testy si ním vedeli vyrobiť aj stav „bez session" alebo
 * „bez sudo okna". Prihlásenie zmizlo (D99, D100), takže tie stavy neexistujú
 * a stub sa zúžil na lokálneho actora, ktorého route potrebuje pre FK a audit.
 */
function routeDeps(): RouteDeps {
  return {
    now: () => NOW,
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

function makeRequest(options: { method?: string; path?: string; body?: unknown } = {}): Request {
  const method = options.method ?? 'GET';
  const headers = new Headers({
    host: APP_HOST,
    'x-forwarded-for': '127.0.0.1',
    origin: APP_ORIGIN,
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
    const route = createSettingsRoute({ settings: settings.repo, routeDeps: routeDeps() });
    const body = await readBody(await route(makeRequest()));
    expect(body.data).toMatchObject({
      shopDomain: 'https://www.sperky-shop.example',
      eagerWriteDefault: true,
      writesLocked: true,
      writesLockedReason: 'runaway',
    });
  });

});

/* ════════════════════════ PUT /api/settings/domain ════════════════════════ */

describe('PUT /api/settings/domain', () => {
  const NEW_DOMAIN = 'https://www.sperky-eshop.example';

  function domainRoute(settings: ReturnType<typeof makeSettingsFake>, options: {
    canaryOk?: boolean;
    audits?: AuditInput[];
    /** Base URL, proti ktorým route canary naozaj spustila (D55). */
    canaryBaseUrls?: string[];
  } = {}) {
    return createDomainRoute({
      settings: settings.repo,
      audit: async (input) => {
        options.audits?.push(input);
      },
      // Canary proti kandidátskej doméne — v teste presmerovaná na mock (I6).
      canary: (baseUrl, ctx) => {
        options.canaryBaseUrls?.push(baseUrl);
        return options.canaryOk === false
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
          : canaryAgainstMock(ctx);
      },
      routeDeps: routeDeps(),
    });
  }

  /*
   * D106 (28. 8. 2026) — bez potvrdenia sa NESMIE stať NIČ.
   *
   * Toto je najdrahšie miesto appky: na uloženú adresu ide zápisová cesta
   * s dešifrovaným produkčným API kľúčom v hlavičke, takže kto prepíše
   * adresu, prepíše aj to, komu appka kľúč pošle. Canary to nezachytí —
   * číta bez kľúča, takže cudzí host si ju uspokojí sám.
   *
   * Strážime preto všetky štyri následky naraz: status, NEuloženú doménu,
   * NEspustený canary a PRÁZDNY audit. Keby ktorýkoľvek z nich vypadol,
   * `confirmed` by sa dalo z routy odstrániť a tento test by to nezachytil.
   */
  for (const [nazov, body] of [
    ['chýbajúce potvrdenie', { domain: NEW_DOMAIN }],
    ['potvrdenie `false`', { domain: NEW_DOMAIN, confirmed: false }],
  ] as const) {
    it(`${nazov}: 400 a adresa sa NEZMENÍ (fail-closed, D106)`, async () => {
      const settings = makeSettingsFake({ shopDomain: null });
      const audits: AuditInput[] = [];
      const canaryBaseUrls: string[] = [];
      const route = domainRoute(settings, { audits, canaryBaseUrls });

      const response = await route(makeRequest({ method: 'PUT', body }));

      expect(response.status).toBe(400);
      expect(settings.domainWrites).toEqual([]);
      /* Canary sa nesmela spustiť ani raz — cudzí host by inak z appky
         dostal request ešte pred tým, než ho zod odmietol. */
      expect(canaryBaseUrls).toEqual([]);
      expect(audits).toEqual([]);
    });
  }

  it('uloží doménu až PO úspešnom canary a zapíše audit (D55, D80)', async () => {
    const settings = makeSettingsFake({ shopDomain: null });
    const audits: AuditInput[] = [];
    const route = domainRoute(settings, { audits });
    const response = await route(makeRequest({ method: 'PUT', body: { domain: NEW_DOMAIN, confirmed: true } }));
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
    const response = await route(makeRequest({ method: 'PUT', body: { domain: NEW_DOMAIN, confirmed: true } }));
    expect(response.status).toBe(502);
    expect((await readBody(response)).error?.code).toBe('canary_failed');
    expect(settings.domainWrites).toHaveLength(0);
    expect(audits.map((a) => a.eventType)).toEqual(['canary_fail']);
  });

  it('http:// doménu odmietne zod 400 ešte pred canary', async () => {
    const settings = makeSettingsFake();
    const canaryBaseUrls: string[] = [];
    const route = domainRoute(settings, { canaryBaseUrls });
    const response = await route(
      makeRequest({
        method: 'PUT',
        body: { domain: 'http://www.sperky-eshop.example', confirmed: true },
      }),
    );
    expect(response.status).toBe(400);
    expect(settings.domainWrites).toHaveLength(0);
    expect(canaryBaseUrls).toHaveLength(0);
  });

  /*
   * Tu do 27. 8. 2026 stáli dva testy hesla a sudo okna (D70, D80). Heslo
   * zmizlo (D99, D100) a táto route potvrdenie NEMÁ — čo doménu chráni odteraz,
   * je canary PROTI KANDIDÁTSKEJ doméne pred uložením (D55) a audit s lokálnym
   * actorom (D102). Presne to strážia dva testy nižšie: bez nich by sa dalo
   * canary spustiť proti STAREJ doméne a uložiť novú, ktorá nikdy neodpovedala.
   */
  it('canary beží proti NOVEJ (normalizovanej) doméne, nie proti uloženej (D55)', async () => {
    const settings = makeSettingsFake({ shopDomain: 'https://www.stara-domena.example' });
    const canaryBaseUrls: string[] = [];
    const route = domainRoute(settings, { canaryBaseUrls });
    const response = await route(
      // Koncové lomítko normalizácia zahodí (D80) — canary musí dostať presne
      // tú hodnotu, ktorá sa potom uloží, inak sa testuje niečo iné.
      makeRequest({ method: 'PUT', body: { domain: `${NEW_DOMAIN}/`, confirmed: true } }),
    );
    expect(response.status).toBe(200);
    expect(canaryBaseUrls).toEqual([NEW_DOMAIN]);
    expect(settings.domainWrites).toEqual([{ domain: NEW_DOMAIN, confirmedAt: NOW }]);
  });

  it('audit zmeny domény nesie lokálneho actora (userId 1, D102)', async () => {
    const settings = makeSettingsFake({ shopDomain: null });
    const audits: AuditInput[] = [];
    const route = domainRoute(settings, { audits });
    const response = await route(makeRequest({ method: 'PUT', body: { domain: NEW_DOMAIN, confirmed: true } }));
    expect(response.status).toBe(200);
    expect(audits).toHaveLength(2);
    // I11 — audit nesmie po zrušení prihlásenia odpovedať „nevieme kto".
    expect(audits.every((a) => a.actor === 'user' && a.userId === 1)).toBe(true);
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
      routeDeps: routeDeps(),
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
      routeDeps: routeDeps(),
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
      routeDeps: routeDeps(),
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
      routeDeps: routeDeps(),
    });
    const response = await route(makeRequest({ method: 'PUT', body: { enabled: 'ano' } }));
    expect(response.status).toBe(400);
  });
});

/* ═══════════════════ POST /api/settings/unlock-writes (D79) ═══════════════ */

describe('POST /api/settings/unlock-writes', () => {
  function unlockRoute(settings: ReturnType<typeof makeSettingsFake>, options: {
    audits?: AuditInput[];
  } = {}) {
    return createUnlockWritesRoute({
      settings: settings.repo,
      audit: async (input) => {
        options.audits?.push(input);
      },
      routeDeps: routeDeps(),
    });
  }

  it('confirmed: true odomkne zámok a zapíše audit writes_unlocked s actorom 1', async () => {
    const settings = makeSettingsFake({ writesLocked: true, writesLockedReason: 'runaway (D79)' });
    const audits: AuditInput[] = [];
    const route = unlockRoute(settings, { audits });
    const response = await route(makeRequest({ method: 'POST', body: { confirmed: true } }));
    expect(response.status).toBe(200);
    const data = (await readBody(response)).data as {
      writesLocked: boolean;
      blockers?: readonly { id: string }[];
    };
    expect(data.writesLocked).toBe(false);
    expect(settings.unlockCalls()).toBe(1);
    expect(settings.record().writesLocked).toBe(false);
    expect(audits.map((a) => a.eventType)).toEqual(['writes_unlocked']);
    // Odomknutie zápisov do produkčného eshopu je presne ten krok, o ktorom sa
    // audit nesmie prestať pýtať „kto" (I11). Od 27. 8. 2026 je to lokálny
    // actor `samuel` s id 1 (D102), nie `sub` zo session (D99).
    expect(audits[0]).toMatchObject({ actor: 'user', userId: 1 });

    // Odomknutie runaway zámku (D79) NIE JE to isté ako zapnuté zápisy (I13).
    // Odpoveď preto nesie aj zvyšné prekážky — bez toho by obrazovka po
    // úspešnom odomknutí tvrdila „hotovo", hoci `WRITES_ENABLED` je vypnuté
    // a nezapísal by sa ani jeden produkt.
    expect(data.blockers?.some((b) => b.id === 'writes_disabled')).toBe(true);
  });

  /*
   * Do 27. 8. 2026 tu stáli testy „zlé heslo → 401" a „bez sudo okna → 401
   * sudo_required". Heslo bolo JEDINÉ potvrdenie tejto akcie a D99 ho zmazalo;
   * potvrdenie ale I3 vyžaduje ďalej (D100), takže ho drží `confirmed`. Oba
   * testy nižšie preto strážia to isté, čo strážili predtým: bez potvrdenia sa
   * zámok NEODOMKNE, nič sa nezmení a do auditu nepribudne riadok (I12).
   */
  it('confirmed: false zámok NEODOMKNE (400, fail-closed, I12)', async () => {
    const settings = makeSettingsFake({ writesLocked: true });
    const audits: AuditInput[] = [];
    const route = unlockRoute(settings, { audits });
    const response = await route(makeRequest({ method: 'POST', body: { confirmed: false } }));
    expect(response.status).toBe(400);
    expect((await readBody(response)).error?.code).toBe('validation_failed');
    expect(settings.unlockCalls()).toBe(0);
    expect(settings.record().writesLocked).toBe(true);
    expect(audits).toHaveLength(0);
  });

  it('chýbajúce potvrdenie zámok NEODOMKNE (400, fail-closed, I12)', async () => {
    const settings = makeSettingsFake({ writesLocked: true });
    const audits: AuditInput[] = [];
    const route = unlockRoute(settings, { audits });
    const response = await route(makeRequest({ method: 'POST', body: {} }));
    expect(response.status).toBe(400);
    expect(settings.unlockCalls()).toBe(0);
    expect(settings.record().writesLocked).toBe(true);
    expect(audits).toHaveLength(0);
  });
});
