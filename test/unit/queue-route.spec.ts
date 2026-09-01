/**
 * Aura Zľavy — `GET /api/queue`: úplný obraz viacdňového behu (V8).
 *
 * Čo sa tu dokazuje:
 *
 *  1. Odpoveď nesie VŠETKO, čo používateľ potrebuje počas viacdňovej fronty:
 *     rozpad položiek (hotové / čaká / zlyhalo / NEISTÉ), minutý rozpočet, čas
 *     obnovy rozpočtu, odhad dobehnutia a stav kľúča.
 *  2. **Neisté nie je zlyhané (D45).** Obe skupiny sú v odpovedi oddelene a
 *     každá nesie vlastný ďalší krok.
 *  3. **Dva stropy, nie jeden (K2).** Strop shopu (200/UTC deň) a náš rozpočet
 *     (`daily_write_budget`) sú vedľa seba a nezlievajú sa.
 *  4. Keď fronta stojí, odpoveď povie PREČO — a dôvod sa berie z jediného
 *     zdroja pravdy `lib/status/blockers.ts`, nie z vlastnej kópie logiky.
 *  5. Fail-closed: nečitateľné nastavenia, chýbajúci heartbeat ani rozbitý
 *     rozpočet NIKDY nevedú k tvrdeniu „fronta beží".
 *  6. Tvar odpovede ostáva čitateľný pre OBOCH existujúcich klientov —
 *     hlavičku (`components/layout/queue.ts`) aj Prehľad
 *     (`components/dashboard/api.ts`).
 *
 * Bez DB a bez `fetch` (I6): všetky repozitáre sú in-memory fakes.
 */
import { describe, expect, it } from 'vitest';

import type {
  ApiKeyMeta,
  CampaignListFilter,
  Paged,
  SchedulerStateRecord,
  SettingsRecord,
} from '@/contracts';

import { createQueueRoute, resolveStandReason, keyFactsOf, buildAttention } from '@/app/api/queue/route';
import { parseQueueSnapshot } from '@/components/dashboard/api';
import { parseQueueHeader } from '@/components/layout/queue';
import { SHOP_KEYED_LIMIT } from '@/lib/shop/rate-limits';
import type { RouteDeps } from '@/lib/http/define-route';
import type { BudgetStatus } from '@/lib/engine/budget';
import type { ItemStatusCounts, QueueTotals } from '@/lib/repo/campaign-items.repo';
import type { CampaignRecordV3 } from '@/lib/repo/campaigns.repo';
import type { ScopeSettings } from '@/lib/repo/settings.repo';

/* ═══════════════════════════ 1. Fixtures ══════════════════════════════════ */

const NOW = new Date('2026-08-12T09:00:00.000Z');
const now = (): Date => NOW;

function sessionDeps(): RouteDeps {
  return {
    now,
    newRequestId: () => '01J0000000000000000QUEUE01',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

const EMPTY_COUNTS: ItemStatusCounts = {
  pending: 0,
  skipped: 0,
  ok: 0,
  failed: 0,
  uncertain: 0,
  interrupted: 0,
  not_found: 0,
  blocked: 0,
};

function campaign(patch: Partial<CampaignRecordV3> = {}): CampaignRecordV3 {
  return {
    id: 1,
    operationId: '01J000000000000000000000C1',
    name: 'Letná zľava',
    kind: 'new',
    parentCampaignId: null,
    percent: 20,
    dateFrom: '2026-08-12',
    dateTo: '2026-08-31',
    dateFromOriginal: null,
    mode: 'eager',
    status: 'running',
    statusReason: null,
    late: false,
    fireAt: null,
    scheduledAt: NOW,
    needsKeySince: null,
    claimedAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    itemsTotal: 150,
    itemsOk: 40,
    itemsFailed: 3,
    itemsUncertain: 2,
    confirmedAt: NOW,
    confirmPayloadHash: 'hash',
    sudoAt: NOW,
    resultAckAt: null,
    createdBy: 7,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

const HEALTHY_SETTINGS: SettingsRecord = {
  id: 1,
  shopDomain: 'sperky-eshop.sk',
  shopDomainConfirmedAt: NOW,
  eagerWriteDefault: true,
  writesLocked: false,
  writesLockedReason: null,
  writesLockedAt: null,
  onboardingDoneAt: NOW,
  updatedAt: NOW,
};

const FULL_SCOPE: ScopeSettings = {
  mode: 'plny',
  maxProductsPerCampaign: 500,
  dailyWriteBudget: 200,
  failClosed: false,
};

const VALID_KEY: ApiKeyMeta = {
  present: true,
  last4: '1234',
  savedAt: NOW,
  // 30 hodín platnosti — kľúč prežije aj zajtrajšok.
  expiresAt: new Date(NOW.getTime() + 30 * 3_600_000),
  secondsLeft: 30 * 3600,
  verifyStatus: 'valid',
  lastUsedAt: NOW,
};

const SCHEDULER_ALIVE: SchedulerStateRecord = {
  id: 1,
  lastTickAt: new Date(NOW.getTime() - 30_000),
  lastTickDurationMs: 120,
  tickCount: 42,
  lastError: null,
  updatedAt: NOW,
};

interface WorldPatch {
  totals?: Partial<QueueTotals>;
  counts?: Partial<ItemStatusCounts>;
  running?: CampaignRecordV3[];
  queued?: CampaignRecordV3[];
  live?: CampaignRecordV3[];
  unacked?: CampaignRecordV3[];
  budget?: BudgetStatus | null;
  budgetThrows?: boolean;
  settings?: SettingsRecord | null;
  scope?: ScopeSettings | null;
  keyMeta?: ApiKeyMeta | null;
  scheduler?: SchedulerStateRecord | null;
  writesEnabled?: boolean | null;
  gatePaused?: boolean;
}

const DEFAULT_BUDGET: BudgetStatus = {
  day: '2026-08-12',
  budget: 200,
  spent: 45,
  remaining: 155,
  exhausted: false,
};

/** Celý svet route-y ako in-memory fake. Bez DB, bez fetchu (I6). */
function makeRoute(patch: WorldPatch = {}) {
  const head = campaign();
  const running = patch.running ?? [head];
  const live = patch.live ?? [...running, ...(patch.queued ?? [])];

  const fail = async (): Promise<never> => {
    throw new Error('DB nie je dostupná');
  };

  return createQueueRoute({
    now,
    campaigns: {
      findRunningUnfinished: async () => running,
      findQueued: async () => patch.queued ?? [],
      findUnacked: async () => patch.unacked ?? [],
      list: async (filter: CampaignListFilter): Promise<Paged<CampaignRecordV3>> => ({
        data: live,
        page: filter.page ?? 1,
        perPage: filter.perPage ?? 100,
        total: live.length,
      }),
    },
    items: {
      queueTotals: async () => ({
        pending: 105,
        total: 150,
        campaigns: 1,
        ...patch.totals,
      }),
      countByStatus: async () => ({
        ...EMPTY_COUNTS,
        pending: 105,
        ok: 40,
        failed: 3,
        uncertain: 2,
        ...patch.counts,
      }),
    },
    schedulerState: {
      get: async () => {
        if (patch.scheduler === null) return fail();
        return patch.scheduler ?? SCHEDULER_ALIVE;
      },
    },
    settings: {
      get: async () => {
        if (patch.settings === null) return fail();
        return patch.settings ?? HEALTHY_SETTINGS;
      },
      readScope: async () => {
        if (patch.scope === null) return fail();
        return patch.scope ?? FULL_SCOPE;
      },
    },
    apiKey: {
      getMeta: async () => {
        if (patch.keyMeta === null) return fail();
        return patch.keyMeta ?? VALID_KEY;
      },
    },
    budget: {
      spentToday: async () => 45,
      remainingToday: async () => {
        if (patch.budgetThrows === true) return fail();
        return patch.budget ?? DEFAULT_BUDGET;
      },
    },
    writesEnabled: () => (patch.writesEnabled === undefined ? true : patch.writesEnabled),
    gate: () => ({
      paused: patch.gatePaused === true,
      reason: patch.gatePaused === true ? 'pc_downtime' : null,
      since: patch.gatePaused === true ? new Date(NOW.getTime() - 3_600_000) : null,
      downtimeMs: patch.gatePaused === true ? 3_600_000 : null,
    }),
    lastRun: () => null,
    routeDeps: sessionDeps(),
  });
}

interface QueueBody {
  ok: boolean;
  data: Record<string, unknown>;
}

async function callQueue(patch: WorldPatch = {}): Promise<QueueBody> {
  const handler = makeRoute(patch);
  const response = await handler(
    new Request('https://zlavy.local/api/queue', {
      headers: { cookie: 'ovl_zliav_session=x' },
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as QueueBody;
}

const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

/* ═════════════════ 2. Úplný obraz behu — čo fronta hovorí ═════════════════ */

describe('GET /api/queue — kde je fronta', () => {
  it('rozpad položiek rozlišuje hotové, čakajúce, zlyhané a NEISTÉ', async () => {
    const body = await callQueue();
    const items = record(body.data.items);

    expect(items).toMatchObject({
      total: 150,
      pending: 105,
      done: 45,
      ok: 40,
      failed: 3,
      uncertain: 2,
    });
    // Preskočené a prerušené sa nezahadzujú — inak by čísla nesedeli a nikto
    // by nevedel prečo (150 − 105 − 40 − 3 − 2 = 0 pri tomto stave).
    expect(items.otherResolved).toBe(0);
  });

  it('preskočené a prerušené položky sa priznávajú, nie stratia', async () => {
    const body = await callQueue({
      totals: { total: 150, pending: 100 },
      live: [campaign({ itemsOk: 30, itemsFailed: 5, itemsUncertain: 1 })],
    });
    // 150 − 100 − 30 − 5 − 1 = 14 preskočených/prerušených.
    expect(record(body.data.items).otherResolved).toBe(14);
  });

  it('bežiaca zľava nesie PRESNÝ rozpad z campaign_items, nie z počítadiel', async () => {
    const body = await callQueue({
      counts: { pending: 90, ok: 40, failed: 3, uncertain: 2, skipped: 10, interrupted: 5 },
    });
    const current = record(body.data.current);
    expect(record(current.itemCounts)).toMatchObject({
      pending: 90,
      skipped: 10,
      interrupted: 5,
    });
    // `itemsPending` berie presné číslo, nie odvodeninu 150−40−3−2 = 105.
    expect(current.itemsPending).toBe(90);
  });

  it('odhad dobehnutia počíta s tým, čo sa DNES ešte zmestí', async () => {
    const body = await callQueue({
      totals: { pending: 400 },
      budget: { day: '2026-08-12', budget: 200, spent: 190, remaining: 10, exhausted: false },
    });
    // 400 položiek, dnes voľných 10, potom 200/deň → 2 ďalšie dni.
    expect(record(body.data.estimate)).toMatchObject({ pending: 400, perDay: 200, days: 2 });
  });

  it('bez rozpočtu sa odhad NEVYMÝŠĽA (P7)', async () => {
    const body = await callQueue({ budgetThrows: true });
    expect(body.data.estimate).toBeNull();
    expect(body.data.budget).toBeNull();
    expect(body.data.writes).toBeNull();
  });
});

/* ═══════════ 3. Dva stropy: shop vs. naše nastavenie (K2, bod 5) ══════════ */

describe('GET /api/queue — strop shopu a náš rozpočet sa nezlievajú', () => {
  it('odpoveď uvádza OBOJE: denný strop shopu aj náš nastavený strop', async () => {
    const body = await callQueue({
      budget: { day: '2026-08-12', budget: 120, spent: 45, remaining: 75, exhausted: false },
    });
    const limits = record(body.data.limits);

    expect(limits.shopPerUtcDay).toBe(SHOP_KEYED_LIMIT.perUtcDay);
    expect(limits.shopPerMinute).toBe(SHOP_KEYED_LIMIT.perMinute);
    expect(limits.configuredPerDay).toBe(120);
    expect(limits.belowShopCap).toBe(true);
  });

  it('nastavený strop na úrovni shopu nie je „pribrzdené"', async () => {
    /*
     * Strop nastavíme PRESNE na strop shopu — inak test nemeria, čo má v názve.
     * Do 1. 9. 2026 sa spoliehal na to, že predvolený rozpočet (200) strop
     * shopu je; po zdvihnutí kvóty na 1000 to prestalo platiť a `belowShopCap`
     * správne hlásilo `true`. Hodnota je odvodená, takže ďalšie zdvihnutie ju
     * nezhodí.
     */
    const naUrovniShopu = SHOP_KEYED_LIMIT.perUtcDay;
    const body = await callQueue({
      budget: {
        day: '2026-08-12',
        budget: naUrovniShopu,
        spent: 0,
        remaining: naUrovniShopu,
        exhausted: false,
      },
    });
    expect(record(body.data.limits).configuredPerDay).toBe(naUrovniShopu);
    expect(record(body.data.limits).belowShopCap).toBe(false);
  });

  it('rozpočet sa obnovuje o UTC polnoci a čas je v odpovedi', async () => {
    const body = await callQueue();
    const limits = record(body.data.limits);
    expect(limits.nextResetAt).toBe('2026-08-13T00:00:00.000Z');
    // 09:00 UTC → do polnoci ostáva 15 hodín.
    expect(limits.secondsToReset).toBe(15 * 3600);
    expect(record(body.data.writes).resumeAt).toBe('2026-08-13T00:00:00.000Z');
  });
});

/* ═════════════════ 4. Prečo fronta stojí (blockers.ts) ════════════════════ */

describe('GET /api/queue — prečo to stojí', () => {
  it('zdravý stav: nič nebráni zapisovať', async () => {
    const body = await callQueue();
    const standing = record(body.data.standing);
    expect(standing.writing).toBe(true);
    expect(standing.reason).toBeNull();
  });

  it('vyčerpaný rozpočet je dôvod, nie chyba — a vie sa, kedy sa uvoľní', async () => {
    const body = await callQueue({
      budget: { day: '2026-08-12', budget: 200, spent: 200, remaining: 0, exhausted: true },
    });
    const standing = record(body.data.standing);
    expect(standing.reason).toBe('budget_exhausted');
    expect(standing.writing).toBe(false);
    expect(standing.waitUntil).toBe('2026-08-13T00:00:00.000Z');

    // Veta prichádza z blockers.ts a nesie ČÍSLA, nie kód.
    const blockers = body.data.standing as { blockers: Array<Record<string, unknown>> };
    const exhausted = blockers.blockers.find((b) => b.id === 'write_budget_exhausted');
    expect(exhausted).toBeDefined();
    expect(String(exhausted?.what)).toContain('200');
    expect(String(exhausted?.nextStep)).toContain('polnoci');
  });

  it('expirovaný kľúč má vlastný dôvod — nie je to to isté ako „kľúč chýba"', async () => {
    const body = await callQueue({
      keyMeta: { ...VALID_KEY, expiresAt: new Date(NOW.getTime() - 3_600_000), secondsLeft: 0 },
    });
    expect(record(body.data.standing).reason).toBe('key_expired');
    expect(record(body.data.keyStatus)).toMatchObject({ present: true, expired: true, usable: false });
  });

  it('chýbajúci kľúč vedie na Nastavenia a sľubuje pokračovanie fronty', async () => {
    const body = await callQueue({
      keyMeta: { ...VALID_KEY, present: false, expiresAt: null, secondsLeft: null, verifyStatus: null },
    });
    expect(record(body.data.standing).reason).toBe('key_missing');

    const blockers = (body.data.standing as { blockers: Array<Record<string, unknown>> }).blockers;
    const missing = blockers.find((b) => b.id === 'key_missing');
    expect(missing).toBeDefined();
    expect(missing?.path).toBe('/nastavenia');
    expect(String(missing?.nextStep)).toContain('pokračuje');
  });

  it('pilotný strop zastaví frontu so 150 produktmi a povie to číslami (K1)', async () => {
    const body = await callQueue({
      scope: { mode: 'pilot', maxProductsPerCampaign: 10, dailyWriteBudget: 200, failClosed: false },
    });
    const blockers = (body.data.standing as { blockers: Array<Record<string, unknown>> }).blockers;
    const cap = blockers.find((b) => b.id === 'scope_pilot_cap');
    expect(cap?.severity).toBe('blokuje');
    expect(String(cap?.what)).toContain('150');
    // Kód prekážky sa 27. 8. 2026 prekrstil zo 'sudo' na 'potvrdenie' (D105).
    expect(cap?.resolution).toBe('potvrdenie');
  });

  it('o katalógu sa NETVRDÍ nič — táto route ho nečíta', async () => {
    // V plnom režime by fail-closed `collectOperationBlockers()` vrátilo
    // `catalog_unknown` so závažnosťou `blokuje`. Route katalóg neoveruje, tak
    // radšej mlčí, než by tvrdila prekážku, ktorá by tu bola vždy.
    const body = await callQueue();
    const blockers = (body.data.standing as { blockers: Array<Record<string, unknown>> }).blockers;
    expect(blockers.some((b) => b.area === 'katalog')).toBe(false);
  });
});

/* ══════════════════════ 5. Fail-closed pri neznalosti ═════════════════════ */

describe('GET /api/queue — „neviem" nikdy neznamená „beží to"', () => {
  it('nečitateľné nastavenia = state_unknown, nie „všetko v poriadku"', async () => {
    const body = await callQueue({ settings: null });
    expect(record(body.data.standing).reason).toBe('state_unknown');
    expect(record(body.data.standing).writing).toBe(false);
    expect(record(body.data.standing).writesLocked).toBeNull();
  });

  it('chýbajúci heartbeat znamená mŕtvy scheduler, nie bežiacu frontu', async () => {
    const body = await callQueue({ scheduler: null });
    expect(record(body.data.heartbeat).stale).toBe(true);
    expect(record(body.data.standing).reason).toBe('scheduler_down');
  });

  it('zamknuté zápisy (runaway, D79) sú vlastný dôvod aj s vysvetlením', async () => {
    const body = await callQueue({
      settings: { ...HEALTHY_SETTINGS, writesLocked: true, writesLockedReason: 'runaway 300/h' },
    });
    const standing = record(body.data.standing);
    expect(standing.reason).toBe('writes_locked');
    expect(standing.writesLockedReason).toBe('runaway 300/h');
  });

  it('vypnuté zápisy (I13) zastavia frontu skôr než čokoľvek iné v shope', async () => {
    const body = await callQueue({ writesEnabled: false });
    expect(record(body.data.standing).reason).toBe('writes_disabled');
  });

  it('zavretá brána po odstávke je dôvod, aj keď je označená ako orientačná', async () => {
    const body = await callQueue({ gatePaused: true });
    expect(record(body.data.standing).reason).toBe('queue_paused');
    expect(record(body.data.gate).bestEffort).toBe(true);
  });
});

/* ════════════ 6. Neisté vs. zlyhané — dve veci, dva ďalšie kroky ══════════ */

describe('GET /api/queue — neisté NIE JE zlyhané (D45)', () => {
  it('obe skupiny sú oddelene a každá má vlastný ďalší krok', async () => {
    const body = await callQueue({
      live: [campaign({ id: 1, name: 'Letná zľava', itemsFailed: 3, itemsUncertain: 2 })],
      unacked: [
        campaign({ id: 2, name: 'Jarná zľava', status: 'partial', itemsFailed: 7, itemsUncertain: 0 }),
      ],
    });
    const attention = record(body.data.attention);
    const uncertain = record(attention.uncertain);
    const failed = record(attention.failed);

    expect(uncertain.items).toBe(2);
    expect(failed.items).toBe(10);
    expect(uncertain.what).not.toBe(failed.what);
    expect(uncertain.nextStep).not.toBe(failed.nextStep);

    // Neisté sa najprv OVERUJÚ v eshope; zlyhané sa rovno opakujú.
    expect(String(uncertain.nextStep)).toContain('eshope');
    expect(String(failed.nextStep)).toContain('Zopakovať zlyhané');
    // I7 — appka zľavu nikdy neruší, a pri neistých to musí zaznieť.
    expect(String(uncertain.nextStep)).toContain('nikdy');
  });

  it('zľava, ktorá je aj živá aj neodkliknutá, sa nepočíta dvakrát', () => {
    const same = campaign({ id: 5, itemsFailed: 4, itemsUncertain: 1 });
    const attention = buildAttention([same, { ...same }]);
    expect(attention.failed.items).toBe(4);
    expect(attention.failed.campaigns).toHaveLength(1);
    expect(attention.uncertain.items).toBe(1);
  });

  it('zľavy bez problému sa v pozornosti vôbec neobjavia', () => {
    const attention = buildAttention([campaign({ id: 9, itemsFailed: 0, itemsUncertain: 0 })]);
    expect(attention.failed.campaigns).toHaveLength(0);
    expect(attention.uncertain.campaigns).toHaveLength(0);
    expect(attention.failed.items).toBe(0);
  });
});

/* ═══════════════════ 7. Kompatibilita s klientmi appky ════════════════════ */

describe('GET /api/queue — tvar odpovede, ktorý klienti naozaj čítajú', () => {
  it('hlavička konečne dostane rozpočet (predtým kreslila natrvalo pomlčku)', async () => {
    const body = await callQueue();
    const header = parseQueueHeader(body.data);

    expect(header.writes).toEqual({
      spentToday: 45,
      budget: 200,
      resumeAt: '2026-08-13T00:00:00.000Z',
    });
    expect(header.queue).toEqual({ done: 45, total: 150, campaigns: 1 });
  });

  it('Prehľad prečíta rovnaký obraz ako doteraz — nič sa mu nerozbilo', async () => {
    const body = await callQueue();
    const snapshot = parseQueueSnapshot(body.data);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.budget).toMatchObject({ budget: 200, spent: 45, remaining: 155 });
    expect(snapshot?.queue).toMatchObject({ pending: 105, total: 150, done: 45 });
    expect(snapshot?.current?.name).toBe('Letná zľava');
    expect(snapshot?.heartbeat.stale).toBe(false);
  });

  it('kľúč sa nevracia pod menom, ktoré by redaktor zamaskoval (I1)', async () => {
    const body = await callQueue();
    // Pole `key` by centrálny redaktor nahradil maskou a UI by tvrdilo, že
    // kľúč chýba — presne ten bug, ktorý riešila výnimka v `redact.ts`.
    expect(body.data).not.toHaveProperty('key');
    expect(record(body.data.keyStatus).present).toBe(true);
    expect(JSON.stringify(body.data)).not.toContain('REDACTED');
    // A samotný kľúč (ani jeho koniec) v odpovedi nie je (D65, I1).
    expect(JSON.stringify(body.data)).not.toContain('1234');
  });
});

/* ══════════════════════ 8. Čisté funkcie rozhodovania ═════════════════════ */

describe('resolveStandReason — poradie dôvodov kopíruje `processQueue()`', () => {
  const base = {
    pending: 100,
    schedulerDown: false,
    gatePaused: false,
    writesEnabled: true,
    writesLocked: false,
    keyUsable: true,
    keyExpired: false,
    budget: DEFAULT_BUDGET,
  };

  it('nič nebráni → null', () => {
    expect(resolveStandReason(base)).toBeNull();
  });

  it('prázdna fronta nie je porucha, ale ani „zapisuje sa"', () => {
    expect(resolveStandReason({ ...base, pending: 0 })).toBe('queue_empty');
  });

  it('mŕtvy scheduler prebije všetko ostatné — bez ticku sa nezapisuje nič', () => {
    expect(
      resolveStandReason({ ...base, schedulerDown: true, gatePaused: true, pending: 0 }),
    ).toBe('scheduler_down');
  });

  it('zamknuté zápisy majú prednosť pred vypnutými (rovnako ako v ticku)', () => {
    expect(resolveStandReason({ ...base, writesLocked: true, writesEnabled: false })).toBe(
      'writes_locked',
    );
  });

  it('nevieme o env poistke → fail-closed „vypnuté", nikdy „beží"', () => {
    expect(resolveStandReason({ ...base, writesEnabled: null })).toBe('writes_disabled');
  });

  it('nevieme o rozpočte → dôvod, nie ticho', () => {
    expect(resolveStandReason({ ...base, budget: null })).toBe('budget_unknown');
  });
});

describe('keyFactsOf — definícia použiteľného kľúča je zhodná s tickom', () => {
  it('neoverený kľúč sa nepoužije, ani keď ešte platí', () => {
    expect(keyFactsOf({ ...VALID_KEY, verifyStatus: 'unverified' }, NOW)).toEqual({
      usable: false,
      expired: false,
    });
  });

  it('expirovaný kľúč je „vložený, ale po platnosti" — iná veta než „chýba"', () => {
    const meta = { ...VALID_KEY, expiresAt: new Date(NOW.getTime() - 1) };
    expect(keyFactsOf(meta, NOW)).toEqual({ usable: false, expired: true });
  });

  it('nečitateľná metadáta kľúča = kľúč nepoužiteľný (fail-closed)', () => {
    expect(keyFactsOf(null, NOW)).toEqual({ usable: false, expired: false });
  });
});
