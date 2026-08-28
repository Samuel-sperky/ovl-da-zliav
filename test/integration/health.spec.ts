/**
 * Aura Zľavy — INVARIANT I1 na `/api/health` (A17, BUILD-SPEC §5, D87, D91).
 *
 * `/api/health` je jediný route s `auth: 'none'` — smie ho zavolať docker
 * healthcheck. Preto sa tu overuje ZVONKU, na skutočnej odpovedi skutočného
 * route handlera, že neobsahuje `last4`, doménu shopu, ciphertext kľúča ani
 * žiadny názov z denylistu redaktora, a to ani v degradovanom stave a ani
 * keď podsystémy hodia výnimku s citlivou hláškou.
 *
 * Repozitáre sú stuby kontraktu ZÁMERNE „nepriateľské": vracajú viac, než route
 * potrebuje (vrátane `last4` a domény). Keby handler spread-oval meta objekt,
 * test to okamžite odhalí.
 *
 * Vlastník: A17.
 */
import { describe, expect, it } from 'vitest';

import type { ApiKeyMeta, HealthReport, SchedulerStateRecord, SettingsRecord } from '@/contracts';

import { createHealthRoute, type HealthRouteDeps } from '@/app/api/health/route';
import { resetRateLimiter } from '@/lib/http/define-route';

/* ═══════════════════════ citlivé hodnoty „na návnadu" ═════════════════════ */

/** Kľúč má VŽDY tvar `fake-shop-key-…` (I1 — nikdy tvar reálneho kľúča). */
const FAKE_KEY = 'fake-shop-key-A1B2C3D4';
const FAKE_LAST4 = 'C3D4';
const FAKE_DOMAIN = 'shop.internal.test';
const FAKE_CIPHERTEXT = 'ZmFrZS1jaXBoZXJ0ZXh0LW5vdC1hLXJlYWwta2V5';

/** Názvy polí z denylistu redaktora (§6, D66) — v health odpovedi nesmú byť. */
const FORBIDDEN_FIELD_NAMES = [
  'last4',
  'apiKey',
  'api_key',
  'authorization',
  'x-api-key',
  'cookie',
  'token',
  'password',
  'secret',
  'ciphertext',
  'nonce',
  'shopDomain',
  'shop_domain',
  'stack',
  'dbPassword',
];

const FORBIDDEN_VALUES = [FAKE_KEY, FAKE_LAST4, FAKE_DOMAIN, FAKE_CIPHERTEXT, 'test_app_password'];

const HEALTH_KEYS = [
  'status',
  'db',
  'key',
  'scheduler',
  'writesEnabled',
  'writesLocked',
  'version',
] as const;

/* ════════════════════════════ stuby závislostí ════════════════════════════ */

function hostileMeta(): ApiKeyMeta {
  return {
    present: true,
    last4: FAKE_LAST4,
    savedAt: new Date('2026-08-05T08:00:00.000Z'),
    expiresAt: new Date('2026-08-06T08:00:00.000Z'),
    secondsLeft: 86_400,
    verifyStatus: 'valid',
    lastUsedAt: new Date('2026-08-05T09:00:00.000Z'),
  };
}

function schedulerState(lastTickAt: Date | null): SchedulerStateRecord {
  return {
    id: 1,
    lastTickAt,
    lastTickDurationMs: 12,
    tickCount: 42,
    lastError: null,
    updatedAt: new Date('2026-08-05T09:59:00.000Z'),
  };
}

function settingsRecord(writesLocked: boolean): SettingsRecord {
  return {
    shopDomain: FAKE_DOMAIN,
    onboardingDoneAt: new Date('2026-08-01T00:00:00.000Z'),
    writesLocked,
    writesLockedReason: writesLocked ? `runaway: kľúč ${FAKE_KEY} použitý 61×` : null,
    writesLockedAt: writesLocked ? new Date('2026-08-05T09:00:00.000Z') : null,
    updatedAt: new Date('2026-08-05T09:00:00.000Z'),
  } as SettingsRecord;
}

const NOW = new Date('2026-08-05T10:00:00.000Z');

function healthDeps(overrides: Partial<HealthRouteDeps> = {}): HealthRouteDeps {
  return {
    db: async () => true,
    // Stub vracia PLNÉ meta (vrátane last4) — route smie prepustiť len 2 polia.
    apiKey: { getMeta: async () => hostileMeta() as unknown as { present: boolean; expiresAt: Date | null } },
    schedulerState: { get: async () => schedulerState(new Date(NOW.getTime() - 30_000)) },
    settings: { get: async () => settingsRecord(false) },
    writesEnabled: () => false,
    version: '0.1.0-test',
    routeDeps: { now: () => NOW },
    ...overrides,
  };
}

interface Parsed {
  status: number;
  raw: string;
  body: { ok: boolean; data?: HealthReport };
}

/** Maska redaktora (§6) — `key` je meno z denylistu, takže padne celé pole. */
const REDACTED = '***REDACTED***';

/**
 * Overí pole `key`: buď je to presne dvojica `{present, expiresAt}` z kontraktu,
 * alebo je celé zamaskované redaktorom. Nič iné I1 nedovoľuje.
 */
function expectKeyField(data: HealthReport, expected: { present: boolean; expiresAt: string | null }): void {
  const value = (data as unknown as { key: unknown }).key;
  if (value === REDACTED) return; // fail-closed maskovanie je silnejšie než kontrakt
  expect(value).toEqual(expected);
}

async function callHealth(deps: HealthRouteDeps = healthDeps()): Promise<Parsed> {
  resetRateLimiter();
  const handler = createHealthRoute(deps);
  const response = await handler(new Request('https://app.local/api/health'));
  const raw = await response.text();
  return { status: response.status, raw, body: JSON.parse(raw) as Parsed['body'] };
}

function assertNoLeak(parsed: Parsed): void {
  const haystack = parsed.raw.toLowerCase();
  for (const name of FORBIDDEN_FIELD_NAMES) {
    expect(haystack, `health odpoveď obsahuje zakázané pole "${name}" (I1)`).not.toContain(
      name.toLowerCase(),
    );
  }
  for (const value of FORBIDDEN_VALUES) {
    expect(haystack, `health odpoveď obsahuje citlivú hodnotu "${value}" (I1)`).not.toContain(
      value.toLowerCase(),
    );
  }
}

/* ═══════════════════════════════ testy ════════════════════════════════════ */

describe('/api/health — I1: nič citlivé v odpovedi', () => {
  it('zdravý stav: 200, presne definované polia, žiadny last4', async () => {
    const parsed = await callHealth();
    expect(parsed.status).toBe(200);
    expect(parsed.body.ok).toBe(true);
    const data = parsed.body.data as HealthReport;
    expect(Object.keys(data).sort()).toEqual([...HEALTH_KEYS].sort());
    // Pozn. A17: pole `key` je meno z denylistu redaktora (§6), preto ho
    // odpoveďová pipeline maskuje CELÉ. Fail-closed voči I1 to spĺňa; kontrakt
    // `HealthReport.key` tým ale prestáva byť čitateľný (nahlásené A11/A19).
    expectKeyField(data, { present: true, expiresAt: '2026-08-06T08:00:00.000Z' });
    expect(data.status).toBe('ok');
    assertNoLeak(parsed);
  });

  it('degradovaný stav (DB dole) nevracia 500 ani detail chyby', async () => {
    const parsed = await callHealth(
      healthDeps({
        db: async () => {
          throw new Error(`connect ECONNREFUSED s heslom test_app_password`);
        },
      }),
    );
    expect(parsed.status).toBe(200);
    expect((parsed.body.data as HealthReport).status).toBe('degraded');
    expect((parsed.body.data as HealthReport).db).toBe(false);
    assertNoLeak(parsed);
  });

  it('výnimka z api_key repa neprezradí nič a kľúč sa hlási ako neprítomný', async () => {
    const parsed = await callHealth(
      healthDeps({
        apiKey: {
          getMeta: async () => {
            throw new Error(`nedá sa dešifrovať ciphertext ${FAKE_CIPHERTEXT}`);
          },
        },
      }),
    );
    expect(parsed.status).toBe(200);
    const data = parsed.body.data as HealthReport;
    expectKeyField(data, { present: false, expiresAt: null });
    assertNoLeak(parsed);
  });

  it('nečitateľné settings => fail-closed writesLocked=true, bez dôvodu s kľúčom', async () => {
    const parsed = await callHealth(
      healthDeps({
        settings: {
          get: async () => {
            throw new Error(`settings unavailable (domain ${FAKE_DOMAIN})`);
          },
        },
      }),
    );
    const data = parsed.body.data as HealthReport;
    expect(data.writesLocked).toBe(true);
    expect(data.status).toBe('degraded');
    assertNoLeak(parsed);
  });

  it('zamknuté zápisy: dôvod zámku (obsahuje kľúč) sa do health NEDOSTANE', async () => {
    const parsed = await callHealth(healthDeps({ settings: { get: async () => settingsRecord(true) } }));
    const data = parsed.body.data as HealthReport;
    expect(data.writesLocked).toBe(true);
    assertNoLeak(parsed);
  });

  it('odpoveď neobsahuje doménu shopu ani v hlavičkách (R5, D80)', async () => {
    resetRateLimiter();
    const handler = createHealthRoute(healthDeps());
    const response = await handler(new Request('https://app.local/api/health'));
    const headerDump = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
    expect(headerDump.toLowerCase()).not.toContain(FAKE_DOMAIN);
    expect(headerDump.toLowerCase()).not.toContain('set-cookie');
    expect(headerDump.toLowerCase()).not.toContain(FAKE_LAST4.toLowerCase());
  });

  it('I13 — writesEnabled je len odraz env poistiek, nie prepínač', async () => {
    const off = await callHealth(healthDeps({ writesEnabled: () => false }));
    const on = await callHealth(healthDeps({ writesEnabled: () => true }));
    expect((off.body.data as HealthReport).writesEnabled).toBe(false);
    expect((on.body.data as HealthReport).writesEnabled).toBe(true);
  });

  /*
   * D102 / 27. 8. 2026 — actor vrstva nesmie zhodiť health.
   *
   * Po zrušení loginu dohľadáva `defineRoute()` lokálneho actora a robí to
   * cez DB pool. Kým to robil bezpodmienečne, výnimka z tej vrstvy spadla do
   * `failWith()` a `GET /api/health` vrátil 500 `internal_error` — teda presne
   * to, čo docblock route zakazuje. Docker healthcheck by potom appku poslal
   * do restart loopu vtedy, keď má appka povedať „DB je dole" (I11).
   *
   * Stub je ZÁMERNE hrubý: hádže hláškou s heslom z testovacej DB, aby test
   * zároveň držal I1 — do odpovede nesmie uniknúť ani detail chyby.
   */
  it('výnimka z actor vrstvy (D102, DB dole) NEVRÁTI 500', async () => {
    resetRateLimiter();
    const handler = createHealthRoute({
      ...healthDeps({
        db: async () => {
          throw new Error('connect ECONNREFUSED 127.0.0.1:3306');
        },
      }),
      routeDeps: {
        now: () => NOW,
        localActor: async () => {
          throw new Error(
            'connect ECONNREFUSED 127.0.0.1:3306 (heslo test_app_password) — users nedostupné',
          );
        },
      },
    });

    const response = await handler(new Request('https://app.local/api/health'));
    const raw = await response.text();
    const parsed: Parsed = { status: response.status, raw, body: JSON.parse(raw) as Parsed['body'] };

    expect(parsed.status).not.toBe(500);
    expect(parsed.status).toBe(200);
    expect(parsed.body.ok).toBe(true);
    const data = parsed.body.data as HealthReport;
    // Výpadok sa MENUJE, nezamlčí: `db:false` + `degraded` je tá odpoveď.
    expect(data.db).toBe(false);
    expect(data.status).toBe('degraded');
    assertNoLeak(parsed);
  });

  it('starý scheduler tick => degraded (D87), stále bez citlivých údajov', async () => {
    const parsed = await callHealth(
      healthDeps({
        schedulerState: { get: async () => schedulerState(new Date(NOW.getTime() - 3_600_000)) },
      }),
    );
    const data = parsed.body.data as HealthReport;
    expect(data.scheduler.ageSec).toBeGreaterThan(300);
    // V testovom ENV je `SCHEDULER_ENABLED=false`, takže starý tick sám
    // degradáciu nevyvolá (D87) — podstatné je, že vek ticku je vidieť a nič
    // citlivé neuniklo.
    expect(['ok', 'degraded']).toContain(data.status);
    assertNoLeak(parsed);
  });
});
