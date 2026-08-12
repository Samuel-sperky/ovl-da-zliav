/**
 * Aura Zľavy — ROZSAH A ZÁPISY na serverovej strane (K1, K1 bod 4, I13).
 *
 * Dôkaz, nie report agenta. Testuje sa presne to, čo používateľa zastavilo:
 *
 *  A. **Strop desiatich produktov je len prepínač** — a appka to musí povedať.
 *     Odmietnutie pre strop rozsahu nesmie byť holý text; musí niesť strojový
 *     dôvod, z ktorého sa dá postaviť ponuka „prepnúť do plného rozsahu".
 *  B. **Úplný obraz rozsahu z jedného čítania** — `GET /api/settings` vracia
 *     platný režim, efektívny strop, pilotný strop, tvrdý strop DB a to, či
 *     prepnutie vypýta heslo. Bez toho sa obrazovka musí domýšľať.
 *  C. **Cesta `pilot → plny` funguje celá vrátane auditu** — `scope_mode_changed`
 *     je riadny typ udalosti so slovenským popisom, nie neznámy reťazec.
 *  D. **Vypnuté zápisy sú VEDOMÉ nastavenie, nie tichý neúspech** — appka
 *     povie, že sa to z obrazovky prepnúť nedá, a kde to teda je.
 *  E. **Asymetria K1 bodu 4 sa nesmie oslabiť** — uvoľnenie chce heslo VŽDY
 *     (aj zdvihnutie stropu v rámci `plny`), sprísnenie NIKDY.
 *
 * Bez DB a bez siete: repozitáre sú in-memory, session vrstva injektovaná cez
 * `RouteDeps`, env poistka cez `deps.writesEnabled`. Testuje sa správanie
 * a poradie, nie JWT podpis (ten vlastní A4).
 *
 * Vlastník: A11 / V5.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { AuditInput, SessionClaims, SettingsRecord } from '@/contracts';

import { createSettingsRoute } from '@/app/api/settings/route';
import { createScopeModeRoute } from '@/app/api/settings/scope-mode/route';
import { createUnlockWritesRoute } from '@/app/api/settings/unlock-writes/route';
import { AUDIT_EVENT_LABEL_SK, auditEventLabelSk, isAuditEventType } from '@/lib/audit/events';
import { SudoRequiredError } from '@/lib/auth/sudo';
import {
  GUARD_CODES,
  checkScope,
  checkWritesEnabled,
  writesBlockers,
  type GuardFlags,
  type GuardsDeps,
  type ScopeRefusalDetail,
  type ScopeSettingsSource,
} from '@/lib/engine/guards';
import {
  createMemoryAllowlistRepo,
  createMemoryAudit,
  createMemorySettingsRepo,
} from '@/lib/engine/testing';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import {
  HARD_MAX_PRODUCTS,
  PILOT_MAX_PRODUCTS,
  scopeChangeRequiresSudo,
  type ScopeMode,
  type ScopeSettings,
} from '@/lib/repo/settings.repo';
import type { Blocker } from '@/lib/status/blockers';

/* ═══════════════════════════ 0. Pomôcky a fixtures ════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const APP_HOST = 'zlavy.local';
const NOW = new Date('2026-08-12T10:00:00.000Z');

const claims: SessionClaims = {
  sub: 7,
  username: 'admin',
  absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
  idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
  sudoUntil: new Date(NOW.getTime() + 10 * 60_000),
};

/** Falošná session vrstva — route nesmie na test siahnuť do DB ani do JWT. */
function sessionRouteDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J0000000000000000TESTAB',
    verifySession: async () => ({
      claims,
      refreshed: {
        token: 'refreshed-token',
        claims,
        cookie: {
          name: 'ovl_zliav_session' as const,
          value: 'refreshed-token',
          options: {
            httpOnly: true as const,
            secure: true as const,
            sameSite: 'strict' as const,
            path: '/',
            maxAge: 1800,
          },
        },
      },
    }),
  };
}

function makeRequest(method: string, path: string, body?: unknown): Request {
  const headers = new Headers({ host: APP_HOST, cookie: 'ovl_zliav_session=x' });
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('origin', APP_ORIGIN);
    headers.set('content-type', 'application/json');
    init.body = JSON.stringify(body ?? {});
  }
  return new Request(`${APP_ORIGIN}${path}`, init);
}

interface ParsedResponse {
  status: number;
  body: { ok: boolean; data?: unknown; error?: { code: string; message: string; detail?: unknown } };
}

async function parse(response: Response): Promise<ParsedResponse> {
  return { status: response.status, body: (await response.json()) as ParsedResponse['body'] };
}

const dataOf = <T>(parsed: ParsedResponse): T => parsed.body.data as T;

const scope = (
  mode: ScopeMode,
  maxProductsPerCampaign: number,
  failClosed = false,
): ScopeSettings => ({ mode, maxProductsPerCampaign, dailyWriteBudget: 200, failClosed });

/** Nájde prekážku podľa stabilného ID; `undefined` = v zozname nie je. */
const byId = (list: readonly Blocker[], id: Blocker['id']): Blocker | undefined =>
  list.find((blocker) => blocker.id === id);

beforeEach(() => {
  // Okenný limiter je modulovo globálny — bez resetu by sa testy medzi sebou
  // zrážali podľa poradia spustenia.
  resetRateLimiter();
});

/* ════════ 1. Asymetria uvoľnenia a sprísnenia (K1 bod 4) — čistá funkcia ═══ */

describe('scopeChangeRequiresSudo — uvoľnenie chce heslo, sprísnenie nikdy', () => {
  it('`pilot → plny` je uvoľnenie a heslo si vypýta', () => {
    expect(scopeChangeRequiresSudo(scope('pilot', 10_000), { mode: 'plny' })).toBe(true);
  });

  it('`pilot → plny` chce heslo aj pri rovnakom čísle stropu', () => {
    // V `plny` sa prestáva vynucovať allowlist a nastupuje katalóg (K1 bod 2) —
    // mení sa, KTORÉ produkty prejdú, nie len koľko ich prejde.
    expect(
      scopeChangeRequiresSudo(scope('pilot', 10), { mode: 'plny', maxProductsPerCampaign: 10 }),
    ).toBe(true);
  });

  it('`plny → pilot` je sprísnenie a heslo NEPÝTA (poistka sa musí dať dotiahnuť)', () => {
    expect(scopeChangeRequiresSudo(scope('plny', 10_000), { mode: 'pilot' })).toBe(false);
  });

  it('zdvihnutie stropu v rámci `plny` je tiež uvoľnenie — heslo si vypýta', () => {
    expect(
      scopeChangeRequiresSudo(scope('plny', 8_000), {
        mode: 'plny',
        maxProductsPerCampaign: 10_000,
      }),
    ).toBe(true);
  });

  it('zníženie stropu v rámci `plny` heslo nepýta', () => {
    expect(
      scopeChangeRequiresSudo(scope('plny', 10_000), {
        mode: 'plny',
        maxProductsPerCampaign: 5_000,
      }),
    ).toBe(false);
  });

  it('zmena stropu v `pilot` nie je uvoľnenie — tam sa uložený strop nepoužíva', () => {
    expect(
      scopeChangeRequiresSudo(scope('pilot', 10), {
        mode: 'pilot',
        maxProductsPerCampaign: 10_000,
      }),
    ).toBe(false);
  });

  it('fail-closed „neviem" → `plny` je uvoľnenie (K1 bod 1 sa nedá obísť výpadkom)', () => {
    expect(scopeChangeRequiresSudo(scope('pilot', 10, true), { mode: 'plny' })).toBe(true);
  });
});

/* ═════════════ 2. `POST /api/settings/scope-mode` — celá cesta ═════════════ */

interface ScopeWorld {
  audit: AuditInput[];
  readonly mode: ScopeMode;
  readonly cap: number;
  deps: {
    settings: {
      readScope(): Promise<ScopeSettings>;
      setScopeMode(next: ScopeMode): Promise<void>;
      setMaxProductsPerCampaign(value: number): Promise<void>;
    };
    audit(input: AuditInput): Promise<void>;
  };
}

function scopeWorld(initial: ScopeMode, initialCap = 10_000): ScopeWorld {
  let mode: ScopeMode = initial;
  let cap = initialCap;
  const audit: AuditInput[] = [];
  return {
    audit,
    get mode(): ScopeMode {
      return mode;
    },
    get cap(): number {
      return cap;
    },
    deps: {
      settings: {
        readScope: async () => scope(mode, cap),
        setScopeMode: async (next: ScopeMode) => {
          mode = next;
        },
        setMaxProductsPerCampaign: async (value: number) => {
          cap = value;
        },
      },
      audit: async (input: AuditInput) => {
        audit.push(input);
      },
    },
  };
}

/** Route so sudo oknom, ktoré vždy zlyhá — dokazuje, že sa NEPÝTA. */
const refusingSudo = (): never => {
  throw new SudoRequiredError();
};

describe('POST /api/settings/scope-mode — prepnutie rozsahu (K1 bod 4)', () => {
  it('`pilot → plny` bez hesla neprejde a NIČ sa nezmení ani nezapíše do auditu', async () => {
    const world = scopeWorld('pilot');
    const route = createScopeModeRoute({
      ...world.deps,
      requireSudo: refusingSudo,
      routeDeps: sessionRouteDeps(),
    });

    const res = await parse(
      await route(makeRequest('POST', '/api/settings/scope-mode', { mode: 'plny' })),
    );

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('sudo_required');
    expect(world.mode).toBe('pilot');
    expect(world.audit).toHaveLength(0);
  });

  it('`pilot → plny` s heslom prejde, zapíše audit a vráti celý obraz rozsahu', async () => {
    const world = scopeWorld('pilot');
    const route = createScopeModeRoute({
      ...world.deps,
      requireSudo: () => new Date(NOW.getTime() + 600_000),
      routeDeps: sessionRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 8_000,
        }),
      ),
    );
    expect(res.status).toBe(200);

    const data = dataOf<{
      scopeMode: ScopeMode;
      maxProducts: number;
      pilotMaxProducts: number;
      hardMaxProducts: number;
      previousScopeMode: ScopeMode;
      requiredSudo: boolean;
      scopeFailClosed: boolean;
    }>(res);
    expect(data.scopeMode).toBe('plny');
    expect(data.previousScopeMode).toBe('pilot');
    expect(data.maxProducts).toBe(8_000);
    expect(data.pilotMaxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(data.hardMaxProducts).toBe(HARD_MAX_PRODUCTS);
    expect(data.requiredSudo).toBe(true);
    expect(data.scopeFailClosed).toBe(false);
    expect(world.mode).toBe('plny');
    expect(world.cap).toBe(8_000);

    // Audit nesie STARÝ aj NOVÝ stav — inak sa spätne nedá zistiť, čo sa zmenilo.
    expect(world.audit).toHaveLength(1);
    const event = world.audit[0] as AuditInput;
    expect(event.eventType).toBe('scope_mode_changed');
    expect(event.ok).toBe(true);
    expect(event.userId).toBe(claims.sub);
    expect(event.beforeSnapshot).toMatchObject({ scopeMode: 'pilot', effectiveMaxProducts: 10 });
    expect(event.afterSnapshot).toMatchObject({
      scopeMode: 'plny',
      effectiveMaxProducts: 8_000,
      requiredSudo: true,
    });
    expect(event.message ?? '').toContain('plny');
  });

  it('`plny → pilot` heslo NEPÝTA — sprísnenie je vždy voľné', async () => {
    const world = scopeWorld('plny');
    const route = createScopeModeRoute({
      ...world.deps,
      requireSudo: refusingSudo,
      routeDeps: sessionRouteDeps(),
    });

    const res = await parse(
      await route(makeRequest('POST', '/api/settings/scope-mode', { mode: 'pilot' })),
    );

    expect(res.status).toBe(200);
    expect(world.mode).toBe('pilot');
    expect(dataOf<{ maxProducts: number }>(res).maxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(dataOf<{ requiredSudo: boolean }>(res).requiredSudo).toBe(false);
    expect(world.audit).toHaveLength(1);
  });

  it('zdvihnutie stropu v rámci `plny` bez hesla NEPREJDE a strop ostane', async () => {
    const world = scopeWorld('plny', 8_000);
    const route = createScopeModeRoute({
      ...world.deps,
      requireSudo: refusingSudo,
      routeDeps: sessionRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 10_000,
        }),
      ),
    );

    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('sudo_required');
    expect(world.cap).toBe(8_000);
    expect(world.audit).toHaveLength(0);
  });

  it('zníženie stropu v rámci `plny` heslo nepýta a zapíše sa', async () => {
    const world = scopeWorld('plny', 10_000);
    const route = createScopeModeRoute({
      ...world.deps,
      requireSudo: refusingSudo,
      routeDeps: sessionRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 5_000,
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(world.cap).toBe(5_000);
    expect(world.audit).toHaveLength(1);
  });
});

/* ═════════ 3. Audit `scope_mode_changed` je riadny typ (K1 bod 4) ═════════ */

describe('audit udalosti `scope_mode_changed`', () => {
  it('je členom zoznamu typov — nezapíše sa ako neznáma udalosť', () => {
    expect(isAuditEventType('scope_mode_changed')).toBe(true);
  });

  it('má slovenský popis, nie surový kód (K10)', () => {
    const label = auditEventLabelSk('scope_mode_changed');
    expect(label).toBe(AUDIT_EVENT_LABEL_SK.scope_mode_changed);
    expect(label).not.toBe('scope_mode_changed');
    expect(label.length).toBeGreaterThan(0);
  });
});

/* ═════════════ 4. `GET /api/settings` — úplný obraz rozsahu ═══════════════ */

interface SettingsData {
  scopeMode: ScopeMode;
  maxProducts: number;
  maxProductsPerCampaign: number;
  pilotMaxProducts: number;
  hardMaxProducts: number;
  scopeFailClosed: boolean;
  scopeSwitchToFullRequiresSudo: boolean;
  scopeSwitchToPilotRequiresSudo: boolean;
  dailyWriteBudget: number;
  writesEnabled: boolean;
  writesLocked: boolean;
  blockers: Blocker[];
}

function settingsRoute(options: {
  scope?: ScopeSettings;
  scopeThrows?: boolean;
  writesEnabled?: boolean;
  record?: Partial<SettingsRecord>;
}) {
  const memory = createMemorySettingsRepo(options.record ?? {});
  return createSettingsRoute({
    settings: {
      get: memory.get,
      readScope: async () => {
        if (options.scopeThrows === true) throw new Error('DB nie je dostupná');
        return options.scope ?? scope('pilot', 10_000);
      },
    },
    writesEnabled: () => options.writesEnabled ?? false,
    routeDeps: sessionRouteDeps(),
  });
}

const getSettings = async (options: Parameters<typeof settingsRoute>[0]): Promise<SettingsData> => {
  const parsed = await parse(await settingsRoute(options)(makeRequest('GET', '/api/settings')));
  expect(parsed.status).toBe(200);
  return dataOf<SettingsData>(parsed);
};

describe('GET /api/settings — obraz rozsahu na jedno čítanie (B1, C2)', () => {
  it('v pilotnom režime povie efektívny, pilotný aj tvrdý strop', async () => {
    const data = await getSettings({ scope: scope('pilot', 10_000) });

    expect(data.scopeMode).toBe('pilot');
    // Uložených 10 000 v pilote NEPLATÍ — efektívny strop je desať (K1).
    expect(data.maxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(data.maxProductsPerCampaign).toBe(10_000);
    expect(data.pilotMaxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(data.hardMaxProducts).toBe(HARD_MAX_PRODUCTS);
    expect(data.scopeFailClosed).toBe(false);
  });

  it('povie dopredu, že prepnutie do plného rozsahu vypýta heslo a späť nie', async () => {
    const data = await getSettings({ scope: scope('pilot', 10_000) });
    expect(data.scopeSwitchToFullRequiresSudo).toBe(true);
    expect(data.scopeSwitchToPilotRequiresSudo).toBe(false);
  });

  it('v plnom režime už prepnutie do plného rozsahu heslo nepýta', async () => {
    const data = await getSettings({ scope: scope('plny', 8_000) });
    expect(data.scopeMode).toBe('plny');
    expect(data.maxProducts).toBe(8_000);
    expect(data.scopeSwitchToFullRequiresSudo).toBe(false);
    expect(data.scopeSwitchToPilotRequiresSudo).toBe(false);
  });

  it('nečitateľné nastavenia sa priznajú ako pilotný rozsah, nie ako plný (K1 bod 1)', async () => {
    const data = await getSettings({ scopeThrows: true });
    expect(data.scopeMode).toBe('pilot');
    expect(data.maxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(data.scopeFailClosed).toBe(true);
    expect(data.scopeSwitchToFullRequiresSudo).toBe(true);
  });

  it('nesie prekážku rozsahu slovami blockers.ts — aj s cestou a heslom', async () => {
    const data = await getSettings({ scope: scope('pilot', 10_000) });
    const cap = byId(data.blockers, 'scope_pilot_cap');

    expect(cap).toBeDefined();
    expect(cap?.area).toBe('rozsah');
    expect(cap?.resolution).toBe('sudo');
    expect(cap?.path).toBe('/nastavenia');
    // Veta musí niesť číslo, inak je to zase log.
    expect(cap?.what).toContain('10');
    expect(cap?.nextStep.length ?? 0).toBeGreaterThan(0);
  });

  it('hovorí LEN o oblastiach, ktoré naozaj prečítal — kľúč a rozpočet sem nepatria', async () => {
    const data = await getSettings({ scope: scope('pilot', 10_000) });
    const areas = new Set(data.blockers.map((blocker) => blocker.area));

    expect([...areas].every((area) => area === 'zapisy' || area === 'rozsah')).toBe(true);
    expect(byId(data.blockers, 'key_missing')).toBeUndefined();
    expect(byId(data.blockers, 'write_budget_exhausted')).toBeUndefined();
    expect(byId(data.blockers, 'catalog_unknown')).toBeUndefined();
  });
});

/* ═══════ 5. Vypnuté zápisy sú vedomé nastavenie, nie tichý neúspech ═══════ */

describe('WRITES_ENABLED — appka povie, že je to nastavenie a kde je (I13, D)', () => {
  it('GET /api/settings priznáva, že zápisy sú vypnuté', async () => {
    const data = await getSettings({ writesEnabled: false });
    expect(data.writesEnabled).toBe(false);
  });

  it('prekážka hovorí, že sa to z obrazovky prepnúť NEDÁ — rieši sa mimo appky', async () => {
    const data = await getSettings({ writesEnabled: false });
    const disabled = byId(data.blockers, 'writes_disabled');

    expect(disabled).toBeDefined();
    expect(disabled?.severity).toBe('blokuje');
    expect(disabled?.resolution).toBe('mimo_appky');
    // `path: null` je celé posolstvo: v appke naň nevedie žiadna obrazovka.
    expect(disabled?.path).toBeNull();
    expect(disabled?.nextStep.length ?? 0).toBeGreaterThan(0);
    expect(disabled?.assumed).toBe(false);
  });

  it('so zapnutými zápismi prekážka zmizne — nie je to trvalé varovanie', async () => {
    const data = await getSettings({ writesEnabled: true });
    expect(data.writesEnabled).toBe(true);
    expect(byId(data.blockers, 'writes_disabled')).toBeUndefined();
  });

  it('`writesBlockers()` je ten istý zdroj pravdy pre bránu aj pre obrazovku', () => {
    expect(writesBlockers(true)).toHaveLength(0);
    const off = writesBlockers(false);
    expect(off).toHaveLength(1);
    expect(off[0]?.id).toBe('writes_disabled');
  });

  it('odmietnutie brány nesie ten istý strojový dôvod (I13)', () => {
    const flags: GuardFlags = {
      nodeEnv: 'production',
      writesEnabled: false,
      maxProductsPerOperation: 10,
      runawayLimitPerHour: 60,
    };
    const result = checkWritesEnabled(flags);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(GUARD_CODES.writesDisabled);
    const detail = result.detail as { blockers: Blocker[] };
    expect(detail.blockers[0]?.id).toBe('writes_disabled');
    expect(detail.blockers[0]?.resolution).toBe('mimo_appky');
  });
});

describe('POST /api/settings/unlock-writes — odomknutie nie je zapnutie (I12 vs I13)', () => {
  function unlockRoute(writesEnabled: boolean, audit: AuditInput[]) {
    const memory = createMemorySettingsRepo({ writesLocked: true, writesLockedReason: 'runaway' });
    return createUnlockWritesRoute({
      settings: { get: memory.get, unlockWrites: memory.unlockWrites },
      users: { getById: async () => ({ passwordHash: 'hash' }) },
      verify: async () => true,
      audit: async (input: AuditInput) => {
        audit.push(input);
      },
      writesEnabled: () => writesEnabled,
      routeDeps: sessionRouteDeps(),
    });
  }

  it('po odomknutí povie, že druhá poistka (env) je stále vypnutá', async () => {
    const audit: AuditInput[] = [];
    const res = await parse(
      await unlockRoute(false, audit)(
        makeRequest('POST', '/api/settings/unlock-writes', { password: 'x' }),
      ),
    );

    expect(res.status).toBe(200);
    const data = dataOf<{ writesLocked: boolean; writesEnabled: boolean; blockers: Blocker[] }>(res);
    expect(data.writesLocked).toBe(false);
    expect(data.writesEnabled).toBe(false);
    expect(byId(data.blockers, 'writes_disabled')?.resolution).toBe('mimo_appky');
    expect(audit[0]?.eventType).toBe('writes_unlocked');
  });

  it('so zapnutou env poistkou už po odomknutí nič nebráni', async () => {
    const audit: AuditInput[] = [];
    const res = await parse(
      await unlockRoute(true, audit)(
        makeRequest('POST', '/api/settings/unlock-writes', { password: 'x' }),
      ),
    );

    const data = dataOf<{ writesEnabled: boolean; blockers: Blocker[] }>(res);
    expect(data.writesEnabled).toBe(true);
    expect(data.blockers).toHaveLength(0);
  });
});

/* ═════ 6. Odmietnutie pre strop rozsahu nesie strojový dôvod (B1, C2) ═════ */

const PROD_FLAGS: GuardFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
};

function guardWorld(current: ScopeSettings, activeIds: number[]): GuardsDeps {
  const memory = createMemorySettingsRepo();
  const settingsRepo: ScopeSettingsSource = Object.assign(memory, {
    async readScope(): Promise<ScopeSettings> {
      return current;
    },
  });
  return {
    settingsRepo,
    allowlistRepo: createMemoryAllowlistRepo(activeIds),
    auditRepo: createMemoryAudit(),
    audit: createMemoryAudit(),
    flags: PROD_FLAGS,
    catalogRepo: {
      async getMany(productIds: number[]) {
        return new Map(productIds.map((id) => [id, { shopStatus: 'ok' }]));
      },
    },
  };
}

describe('checkScope — strop rozsahu odmietne strojovo, nie holým textom', () => {
  const ids = (count: number): number[] => Array.from({ length: count }, (_, i) => 201 + i);

  it('v pilotnom režime nesie celý obraz rozsahu vrátane tvrdého stropu', async () => {
    const result = await checkScope(ids(11), guardWorld(scope('pilot', 10_000), ids(11)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(GUARD_CODES.tooManyProducts);

    const detail = result.detail as ScopeRefusalDetail;
    expect(detail.mode).toBe('pilot');
    expect(detail.count).toBe(11);
    expect(detail.max).toBe(PILOT_MAX_PRODUCTS);
    expect(detail.pilotMaxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(detail.hardMaxProducts).toBe(HARD_MAX_PRODUCTS);
    expect(detail.failClosed).toBe(false);
    // Zúženie výberu nie je jediná odpoveď — strop sa dá zdvihnúť, chce to heslo.
    expect(detail.requiresSudoToRelease).toBe(true);
  });

  it('nesie prekážku `scope_pilot_cap`, ktorá vedie do Nastavení a pýta heslo', async () => {
    const result = await checkScope(ids(150), guardWorld(scope('pilot', 10_000), ids(150)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const detail = result.detail as ScopeRefusalDetail;
    const cap = byId(detail.blockers, 'scope_pilot_cap');

    expect(cap).toBeDefined();
    expect(cap?.severity).toBe('blokuje');
    expect(cap?.resolution).toBe('sudo');
    expect(cap?.path).toBe('/nastavenia');
    // Veta musí obsahovať OBE čísla — strop aj veľkosť výberu (blockers.ts, bod 1).
    expect(cap?.what).toContain('10');
    expect(cap?.what).toContain('150');
  });

  it('detail nesie LEN prekážky rozsahu — o kľúči a rozpočte tu brána nič nečítala', async () => {
    const result = await checkScope(ids(11), guardWorld(scope('pilot', 10_000), ids(11)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const detail = result.detail as ScopeRefusalDetail;
    expect(detail.blockers.every((blocker) => blocker.area === 'rozsah')).toBe(true);
    expect(byId(detail.blockers, 'key_missing')).toBeUndefined();
    expect(byId(detail.blockers, 'writes_disabled')).toBeUndefined();
  });

  it('v plnom režime nad stropom sa už heslo nepýta — strop sa mení priamo', async () => {
    const result = await checkScope(ids(4), guardWorld(scope('plny', 3), ids(4)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const detail = result.detail as ScopeRefusalDetail;
    expect(detail.mode).toBe('plny');
    expect(detail.max).toBe(3);
    const cap = byId(detail.blockers, 'scope_full_cap');
    expect(cap?.severity).toBe('blokuje');
    expect(cap?.resolution).toBe('sam');
  });

  it('fail-closed rozsah sa v detaile prizná ako domnienka, nie ako fakt', async () => {
    const result = await checkScope(ids(11), guardWorld(scope('pilot', 10, true), ids(11)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const detail = result.detail as ScopeRefusalDetail;
    expect(detail.failClosed).toBe(true);
    expect(byId(detail.blockers, 'scope_unknown')).toBeDefined();
    expect(byId(detail.blockers, 'scope_pilot_cap')?.assumed).toBe(true);
  });
});
