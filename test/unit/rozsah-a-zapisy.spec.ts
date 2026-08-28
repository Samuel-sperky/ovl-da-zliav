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
 *     prepnutie rozsah uvoľňuje. Bez toho sa obrazovka musí domýšľať.
 *  C. **Cesta `pilot → plny` funguje celá vrátane auditu** — `scope_mode_changed`
 *     je riadny typ udalosti so slovenským popisom, nie neznámy reťazec.
 *  D. **Vypnuté zápisy sú VEDOMÉ nastavenie, nie tichý neúspech** — appka
 *     povie, že sa to z obrazovky prepnúť nedá, a kde to teda je.
 *  E. **Asymetria K1 bodu 4 sa nesmie oslabiť** — uvoľnením je VŽDY aj
 *     zdvihnutie stropu v rámci `plny`, sprísnenie uvoľnením NIKDY. Do
 *     27. 8. 2026 od toho záviselo sudo (D70); po D100 je to rozlíšenie pre
 *     audit a pre dopredné ohlásenie na obrazovke.
 *
 * Bez DB a bez siete: repozitáre sú in-memory, lokálny actor (D102) injektovaný
 * cez `RouteDeps`, env poistka cez `deps.writesEnabled`. Testuje sa správanie
 * a poradie.
 *
 * Vlastník: A11 / V5.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { AuditInput, SettingsRecord } from '@/contracts';

import { createSettingsRoute } from '@/app/api/settings/route';
import { createScopeModeRoute } from '@/app/api/settings/scope-mode/route';
import { createUnlockWritesRoute } from '@/app/api/settings/unlock-writes/route';
import { AUDIT_EVENT_LABEL_SK, auditEventLabelSk, isAuditEventType } from '@/lib/audit/events';
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
  scopeChangeIsLoosening,
  type ScopeMode,
  type ScopeSettings,
} from '@/lib/repo/settings.repo';
import type { Blocker } from '@/lib/status/blockers';

/* ═══════════════════════════ 0. Pomôcky a fixtures ════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const APP_HOST = 'zlavy.local';
const NOW = new Date('2026-08-12T10:00:00.000Z');

/** Lokálny actor — route nesmie na test siahnuť do DB (D102). */
function actorRouteDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J0000000000000000TESTAB',
    localActor: async () => ({ id: 1, username: 'samuel' }),
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

describe('scopeChangeIsLoosening — čo je uvoľnenie a čo sprísnenie', () => {
  it('`pilot → plny` je uvoľnenie', () => {
    expect(scopeChangeIsLoosening(scope('pilot', 10_000), { mode: 'plny' })).toBe(true);
  });

  it('`pilot → plny` je uvoľnenie aj pri rovnakom čísle stropu', () => {
    // V `plny` sa prestáva vynucovať allowlist a nastupuje katalóg (K1 bod 2) —
    // mení sa, KTORÉ produkty prejdú, nie len koľko ich prejde.
    expect(
      scopeChangeIsLoosening(scope('pilot', 10), { mode: 'plny', maxProductsPerCampaign: 10 }),
    ).toBe(true);
  });

  it('`plny → pilot` je sprísnenie, NIKDY uvoľnenie (poistka sa musí dať dotiahnuť)', () => {
    expect(scopeChangeIsLoosening(scope('plny', 10_000), { mode: 'pilot' })).toBe(false);
  });

  it('návrat do `pilot` nie je uvoľnenie ANI pri uloženom strope pod desať', () => {
    // Našiel review 12. 8.: pri `plny` so stropom 5 je efektívny strop 5,
    // v `pilot` je 10, takže porovnanie čísel spravilo z brzdy „uvoľnenie"
    // — presne vo chvíli, keď človek appku zastavuje.
    // `pilot` je pritom užší rozsah aj s vyšším číslom: vynucuje allowlist.
    for (const strop of [1, 5, 9, 10, 11, 10_000]) {
      expect(scopeChangeIsLoosening(scope('plny', strop), { mode: 'pilot' })).toBe(false);
    }
    // Aj vtedy, keď sa pri sprísnení pošle strop, ktorý by inak bol uvoľnením.
    expect(
      scopeChangeIsLoosening(scope('plny', 5), { mode: 'pilot', maxProductsPerCampaign: 10_000 }),
    ).toBe(false);
  });

  /*
   * Zdvihnutie stropu je UVOĽNENIE, aj keď režim zostáva plny. Do 27. 8. 2026
   * z toho vyplývalo „vypýta si heslo" (sudo, D70); po D100 už z toho nevyplýva
   * nič okrem zápisu do auditu — ale samotné ROZLÍŠENIE musí zostať pravdivé,
   * inak sa z histórie nedá prečítať, kto rozsah rozšíril.
   */
  it('zdvihnutie stropu v rámci `plny` je tiež uvoľnenie', () => {
    expect(
      scopeChangeIsLoosening(scope('plny', 8_000), {
        mode: 'plny',
        maxProductsPerCampaign: 10_000,
      }),
    ).toBe(true);
  });
  it('zníženie stropu v rámci `plny` nie je uvoľnenie', () => {
    expect(
      scopeChangeIsLoosening(scope('plny', 10_000), {
        mode: 'plny',
        maxProductsPerCampaign: 5_000,
      }),
    ).toBe(false);
  });

  it('zmena stropu v `pilot` nie je uvoľnenie — tam sa uložený strop nepoužíva', () => {
    expect(
      scopeChangeIsLoosening(scope('pilot', 10), {
        mode: 'pilot',
        maxProductsPerCampaign: 10_000,
      }),
    ).toBe(false);
  });

  it('fail-closed „neviem" → `plny` je uvoľnenie (K1 bod 1 sa nedá obísť výpadkom)', () => {
    expect(scopeChangeIsLoosening(scope('pilot', 10, true), { mode: 'plny' })).toBe(true);
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

describe('POST /api/settings/scope-mode — prepnutie rozsahu (K1 bod 4)', () => {
  /*
   * Test „`pilot → plny` bez hesla neprejde" tu stál do 27. 8. 2026 a meral
   * sudo bránu (D70). Sudo zrušilo D100 a heslá D99, ale 28. 8. 2026 bránu
   * OBNOVILO D106 — nie heslom, ale výslovným `confirmed: true`. Uvoľnenie
   * rozsahu zdvihne strop z desiatok na tisíce produktov na jednu zľavu,
   * a to nesmie byť jeden tichý POST.
   *
   * Strážia to tri testy nižšie, ktoré držia spolu ASYMETRIU (od D79):
   *  - uvoľnenie BEZ potvrdenia → 409 a nezmení sa nič (fail-closed),
   *  - uvoľnenie S potvrdením → prejde,
   *  - sprísnenie bez potvrdenia → prejde ĎALEJ, lebo appku sa musí dať
   *    pribrzdiť aj v núdzi, keď na obradnosť nie je čas.
   * Plus to, čo z K1 bodu 4 pretrváva: rozdiel uvoľnenie/sprísnenie sa
   * zapisuje do auditu ako `looseningScope`.
   */

  it('uvoľnenie BEZ potvrdenia je 409 a rozsah zostane `pilot` (D106)', async () => {
    /* Uložený strop je zámerne INÝ než požadovaný (7 000 vs. 8 000 nižšie),
       aby sa dalo dokázať, že `setMaxProductsPerCampaign()` sa nezavolala —
       pri zhodných číslach by test prešel aj vtedy, keby sa strop prepísal. */
    const world = scopeWorld('pilot', 7_000);
    const route = createScopeModeRoute({
      ...world.deps,
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 8_000,
        }),
      ),
    );

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('confirmation_required');
    /* Fail-closed PRED prvým zápisom: ani režim, ani strop, a žiadny audit
       riadok o zmene, ktorá sa nekonala. */
    expect(world.mode).toBe('pilot');
    expect(world.cap).toBe(7_000);
    expect(world.audit).toEqual([]);
  });

  it('`pilot → plny` prejde, zapíše audit a vráti celý obraz rozsahu', async () => {
    const world = scopeWorld('pilot');
    const route = createScopeModeRoute({
      ...world.deps,
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 8_000,
          confirmed: true,
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
      looseningScope: boolean;
      scopeFailClosed: boolean;
    }>(res);
    expect(data.scopeMode).toBe('plny');
    expect(data.previousScopeMode).toBe('pilot');
    expect(data.maxProducts).toBe(8_000);
    expect(data.pilotMaxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(data.hardMaxProducts).toBe(HARD_MAX_PRODUCTS);
    expect(data.looseningScope).toBe(true);
    expect(data.scopeFailClosed).toBe(false);
    expect(world.mode).toBe('plny');
    expect(world.cap).toBe(8_000);

    // Audit nesie STARÝ aj NOVÝ stav — inak sa spätne nedá zistiť, čo sa zmenilo.
    expect(world.audit).toHaveLength(1);
    const event = world.audit[0] as AuditInput;
    expect(event.eventType).toBe('scope_mode_changed');
    expect(event.ok).toBe(true);
    expect(event.userId).toBe(1);
    expect(event.beforeSnapshot).toMatchObject({ scopeMode: 'pilot', effectiveMaxProducts: 10 });
    expect(event.afterSnapshot).toMatchObject({
      scopeMode: 'plny',
      effectiveMaxProducts: 8_000,
      looseningScope: true,
    });
    expect(event.message ?? '').toContain('plny');
  });

  it('`plny → pilot` prejde a zapíše sa ako sprísnenie — je vždy voľné', async () => {
    const world = scopeWorld('plny');
    const route = createScopeModeRoute({
      ...world.deps,
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(makeRequest('POST', '/api/settings/scope-mode', { mode: 'pilot' })),
    );

    expect(res.status).toBe(200);
    expect(world.mode).toBe('pilot');
    expect(dataOf<{ maxProducts: number }>(res).maxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(dataOf<{ looseningScope: boolean }>(res).looseningScope).toBe(false);
    expect(world.audit).toHaveLength(1);
  });

  /*
   * Route test „zdvihnutie stropu bez hesla NEPREJDE" tu bol do 27. 8. 2026 a
   * meral sudo bránu (401 sudo_required). Sudo zrušilo D100. Uvoľnenie rozsahu
   * teda prejde — a to je vyžiadaná zmena, nie regresia. Čo route ĎALEJ musí
   * robiť a je strážené v testoch okolo: zapísať do auditu STARÝ aj NOVÝ stav
   * a označiť, že šlo o uvoľnenie (looseningScope).
   */

  it('zníženie stropu v rámci `plny` prejde a zapíše sa ako sprísnenie', async () => {
    const world = scopeWorld('plny', 10_000);
    const route = createScopeModeRoute({
      ...world.deps,
      routeDeps: actorRouteDeps(),
    });

    const res = await parse(
      await route(
        makeRequest('POST', '/api/settings/scope-mode', {
          mode: 'plny',
          maxProductsPerCampaign: 5_000,
          confirmed: true,
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
  scopeSwitchToFullIsLoosening: boolean;
  scopeSwitchToPilotIsLoosening: boolean;
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
    routeDeps: actorRouteDeps(),
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

  it('povie dopredu, že prepnutie do plného rozsahu je uvoľnenie a späť nie', async () => {
    const data = await getSettings({ scope: scope('pilot', 10_000) });
    expect(data.scopeSwitchToFullIsLoosening).toBe(true);
    expect(data.scopeSwitchToPilotIsLoosening).toBe(false);
  });

  it('v plnom režime už prepnutie do plného rozsahu nie je uvoľnenie', async () => {
    const data = await getSettings({ scope: scope('plny', 8_000) });
    expect(data.scopeMode).toBe('plny');
    expect(data.maxProducts).toBe(8_000);
    expect(data.scopeSwitchToFullIsLoosening).toBe(false);
    expect(data.scopeSwitchToPilotIsLoosening).toBe(false);
  });

  it('nečitateľné nastavenia sa priznajú ako pilotný rozsah, nie ako plný (K1 bod 1)', async () => {
    const data = await getSettings({ scopeThrows: true });
    expect(data.scopeMode).toBe('pilot');
    expect(data.maxProducts).toBe(PILOT_MAX_PRODUCTS);
    expect(data.scopeFailClosed).toBe(true);
    expect(data.scopeSwitchToFullIsLoosening).toBe(true);
  });

  it('nesie prekážku rozsahu slovami blockers.ts — aj s cestou a potvrdením', async () => {
    const data = await getSettings({ scope: scope('pilot', 10_000) });
    const cap = byId(data.blockers, 'scope_pilot_cap');

    expect(cap).toBeDefined();
    expect(cap?.area).toBe('rozsah');
    // Kód prekážky sa 27. 8. 2026 prekrstil zo 'sudo' na 'potvrdenie' (D105).
    expect(cap?.resolution).toBe('potvrdenie');
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
      audit: async (input: AuditInput) => {
        audit.push(input);
      },
      writesEnabled: () => writesEnabled,
      routeDeps: actorRouteDeps(),
    });
  }

  it('po odomknutí povie, že druhá poistka (env) je stále vypnutá', async () => {
    const audit: AuditInput[] = [];
    const res = await parse(
      await unlockRoute(false, audit)(
        makeRequest('POST', '/api/settings/unlock-writes', { confirmed: true }),
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
        makeRequest('POST', '/api/settings/unlock-writes', { confirmed: true }),
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
    /*
     * `requiresSudoToRelease: true` tu bolo do 27. 8. 2026 a znamenalo „strop sa
     * dá zdvihnúť, ale chce to heslo". Po D100 by to bolo tvrdenie, ktoré route
     * nedodrží — heslo si nevypýta —, tak pole zmizlo. Odpoveď „strop sa dá
     * zdvihnúť" nesie ďalej `hardMaxProducts` a prekážka `scope_pilot_cap`.
     */
    expect(detail).not.toHaveProperty('requiresSudoToRelease');
  });

  it('nesie prekážku `scope_pilot_cap`, ktorá vedie do Nastavení a pýta potvrdenie', async () => {
    const result = await checkScope(ids(150), guardWorld(scope('pilot', 10_000), ids(150)));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const detail = result.detail as ScopeRefusalDetail;
    const cap = byId(detail.blockers, 'scope_pilot_cap');

    expect(cap).toBeDefined();
    expect(cap?.severity).toBe('blokuje');
    // 'sudo' → 'potvrdenie' (D105, 27. 8. 2026).
    expect(cap?.resolution).toBe('potvrdenie');
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

  it('v plnom režime nad stropom sa neponúka prepnutie — strop sa mení priamo', async () => {
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
