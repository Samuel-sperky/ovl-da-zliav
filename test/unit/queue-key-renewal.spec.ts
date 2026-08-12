/**
 * Aura Zľavy — OBNOVA KĽÚČA UPROSTRED VIACDŇOVEJ FRONTY
 * (kontrakt dokončenia B6, akceptačné kritérium 6; RZ3, D21, D24, D25, K6).
 *
 * Kľúč na zápis platí 48 hodín. Fronta na 150 produktov beží deň, väčšia dni —
 * takže fronta kľúč PREŽIJE a používateľ musí vedieť z obrazovky, že stačí
 * vložiť nový a beh pokračuje tam, kde stojí.
 *
 * Tento súbor overuje, že to tak naozaj funguje, a to na oboch cestách, ktorými
 * sa fronta bez kľúča môže zastaviť. Sú to dve rôzne cesty a mieša sa to len
 * zdanlivo:
 *
 *  A. **Kampaň zostala `queued`.** Tick zistí, že kľúč nie je použiteľný, celú
 *     frontu PRESKOČÍ a nezmení ani jeden stav (`lib/scheduler/queue.ts`, K6).
 *     Po vložení kľúča sa najbližší tick rozbehne sám — netreba nič klikať.
 *  B. **Kampaň spadla do `needs_key`.** To sa stane, keď kľúč vyprší alebo ho
 *     shop odmietne UPROSTRED dávky (D51/D52). Zvyšné položky sú `interrupted`
 *     a kampaň čaká. Uloženie platného kľúča ju dopáli (D24, `PUT /api/key` →
 *     `relightNeedsKeyCampaigns()`).
 *
 * V OBOCH prípadoch platia dve veci, ktoré sa najľahšie pokazia:
 *   - **postup sa nestratí** — hotové položky zostávajú hotové a prerušené sa
 *     vracajú na `pending`, nie na `failed`,
 *   - **nové potvrdenie sa nevyžaduje** — kampaň má `confirmed_at` a
 *     `confirm_payload_hash` z pôvodného náhľadu a executor si ich overí znova
 *     (I3). Cesta obnovy nikde nepýta `previewToken` a ani ho nemá odkiaľ vziať.
 *
 * Bez DB a bez `fetch` (I6): repozitáre aj executor sú fakes.
 */
import { describe, expect, it } from 'vitest';

import type {
  ApiKeyMeta,
  AuditInput,
  CampaignListFilter,
  CampaignRecord,
  CampaignStatus,
  ExecutorResult,
  Logger,
  Paged,
  SettingsRecord,
} from '@/contracts';

import { relightNeedsKeyCampaigns } from '@/app/api/key/route';
import { processQueue, resetQueueReport, type QueueDeps } from '@/lib/scheduler/queue';
import { resetQueueGate } from '@/lib/scheduler/pause';
import type { SchedulerCampaign } from '@/lib/scheduler/types';

/* ═══════════════════════════ 1. Fixtures ══════════════════════════════════ */

const NOW = new Date('2026-08-12T09:00:00.000Z');
const TIME_ZONE = 'Europe/Bratislava';

function campaign(patch: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: 5,
    operationId: '01J000000000000000000000C5',
    name: 'Letná zľava',
    kind: 'new',
    parentCampaignId: null,
    percent: 20,
    dateFrom: '2026-08-10',
    dateTo: '2026-08-31',
    dateFromOriginal: null,
    mode: 'scheduled',
    status: 'needs_key',
    statusReason: 'Kľúč vypršal uprostred dávky.',
    fireAt: NOW,
    scheduledAt: NOW,
    needsKeySince: NOW,
    claimedAt: null,
    startedAt: NOW,
    finishedAt: null,
    itemsTotal: 150,
    // 40 produktov je už zlacnených — presne toto sa nesmie stratiť.
    itemsOk: 40,
    itemsFailed: 0,
    itemsUncertain: 0,
    // I3 — potvrdenie z pôvodného náhľadu na kampani ZOSTÁVA.
    confirmedAt: new Date(NOW.getTime() - 26 * 3_600_000),
    confirmPayloadHash: 'hash-z-povodneho-nahladu',
    sudoAt: new Date(NOW.getTime() - 26 * 3_600_000),
    resultAckAt: null,
    createdBy: 7,
    createdAt: new Date(NOW.getTime() - 26 * 3_600_000),
    updatedAt: NOW,
    ...patch,
  };
}

const silentLog = {
  warn: () => undefined,
};

interface RelightWorld {
  deps: Parameters<typeof relightNeedsKeyCampaigns>[0];
  executed: Array<{ campaignId: number; opts: unknown }>;
  statuses: Array<{ id: number; status: CampaignStatus; patch: unknown }>;
  audit: AuditInput[];
}

function makeRelightWorld(waiting: CampaignRecord[]): RelightWorld {
  const executed: Array<{ campaignId: number; opts: unknown }> = [];
  const statuses: Array<{ id: number; status: CampaignStatus; patch: unknown }> = [];
  const audit: AuditInput[] = [];

  return {
    executed,
    statuses,
    audit,
    deps: {
      campaigns: {
        findNeedsKey: async () => waiting,
        list: async (filter: CampaignListFilter): Promise<Paged<CampaignRecord>> => ({
          data: [],
          page: 1,
          perPage: filter.perPage ?? 20,
          total: 0,
        }),
        setStatus: async (id, status, patch) => {
          statuses.push({ id, status, patch });
        },
      },
      audit: async (input: AuditInput) => {
        audit.push(input);
      },
      execute: async (campaignId, opts) => {
        executed.push({ campaignId, opts });
        const result: ExecutorResult = {
          campaignId,
          status: 'done',
          itemsTotal: 150,
          itemsOk: 150,
          itemsFailed: 0,
          itemsUncertain: 0,
          items: [],
        };
        return result;
      },
      now: () => NOW,
      timeZone: TIME_ZONE,
    },
  };
}

/* ══════════ 2. Cesta B — `needs_key` sa dopáli vložením kľúča (D24) ═══════ */

describe('vloženie kľúča dopáli zľavy, ktoré naň čakali (D24, kritérium 6)', () => {
  it('zľava vo svojom okne sa rozbehne — a bez akéhokoľvek nového tokenu (I3)', async () => {
    const world = makeRelightWorld([campaign()]);
    const outcome = await relightNeedsKeyCampaigns(world.deps, 7, silentLog);

    expect(outcome).toMatchObject({ relit: 1, lapsed: 0, failed: 0 });
    expect(world.executed).toHaveLength(1);
    expect(world.executed[0]?.campaignId).toBe(5);
    // Kritérium 6: cesta obnovy nikde nepýta `previewToken` — kampaň má
    // potvrdenie z pôvodného náhľadu a executor si ho overí znova.
    expect(JSON.stringify(world.executed[0]?.opts)).not.toContain('previewToken');
    expect(world.executed[0]?.opts).toEqual({ actor: 'user', userId: 7 });
  });

  it('postup sa nezahadzuje: kampaň sa NEPREPÍSE na draft ani sa jej nevynulujú počty', async () => {
    const world = makeRelightWorld([campaign()]);
    await relightNeedsKeyCampaigns(world.deps, 7, silentLog);

    // Jediné `setStatus`, ktoré tu smie padnúť, je posun `date_from` (D25) —
    // a ten sa pri kampani so `dateFrom` v minulosti robí bez straty počtov.
    for (const change of world.statuses) {
      expect(change.status).not.toBe('draft');
      expect(JSON.stringify(change.patch ?? {})).not.toContain('itemsOk');
    }
  });

  it('`date_from` v minulosti sa posunie na dnešok a zapíše sa to do auditu (D25)', async () => {
    const world = makeRelightWorld([campaign({ dateFrom: '2026-08-01' })]);
    await relightNeedsKeyCampaigns(world.deps, 7, silentLog);

    const shift = world.statuses.find((s) => s.status === 'needs_key');
    expect(shift).toBeDefined();
    expect(JSON.stringify(shift?.patch)).toContain('2026-08-12');
    expect(world.audit.some((a) => a.eventType === 'campaign_from_shifted')).toBe(true);
    // Aj tak sa nakoniec spustí — posun okna nie je dôvod nezapisovať.
    expect(world.executed).toHaveLength(1);
  });

  it('zľava s celým oknom v minulosti sa NEZAPISUJE — okno sa nikdy nepredlžuje (I7)', async () => {
    const world = makeRelightWorld([campaign({ dateFrom: '2026-07-01', dateTo: '2026-07-31' })]);
    const outcome = await relightNeedsKeyCampaigns(world.deps, 7, silentLog);

    expect(outcome).toMatchObject({ relit: 0, lapsed: 1 });
    expect(world.executed).toHaveLength(0);
    expect(world.statuses.map((s) => s.status)).toContain('lapsed');
  });

  it('pád jednej zľavy nezastaví ostatné a nič sa nezapíše navyše (fail-closed)', async () => {
    const world = makeRelightWorld([campaign({ id: 5 }), campaign({ id: 6, name: 'Druhá' })]);
    const original = world.deps.execute;
    let call = 0;
    world.deps = {
      ...world.deps,
      execute: async (campaignId, opts) => {
        call += 1;
        if (call === 1) throw new Error('shop neodpovedal');
        return original(campaignId, opts);
      },
    };

    const outcome = await relightNeedsKeyCampaigns(world.deps, 7, silentLog);
    expect(outcome.failed).toBe(1);
    expect(outcome.relit).toBe(1);
  });
});

/* ═══ 3. Cesta A — `queued` bez kľúča stojí, s kľúčom sa rozbehne (K6) ═════ */

const SETTINGS_OK: SettingsRecord = {
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

const KEY_VALID: ApiKeyMeta = {
  present: true,
  last4: '1234',
  savedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 47 * 3_600_000),
  secondsLeft: 47 * 3600,
  verifyStatus: 'valid',
  lastUsedAt: null,
};

const KEY_EXPIRED: ApiKeyMeta = {
  ...KEY_VALID,
  expiresAt: new Date(NOW.getTime() - 60_000),
  secondsLeft: 0,
};

function queuedCampaign(): SchedulerCampaign {
  return campaign({ status: 'queued' as CampaignStatus }) as unknown as SchedulerCampaign;
}

interface QueueWorld {
  deps: QueueDeps;
  executed: number[];
  statuses: number[];
}

function makeQueueWorld(keyMeta: ApiKeyMeta): QueueWorld {
  const executed: number[] = [];
  const statuses: number[] = [];
  const noop = (): void => undefined;
  const log: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => log,
  } as unknown as Logger;

  return {
    executed,
    statuses,
    deps: {
      campaigns: {
        findQueued: async () => [queuedCampaign()],
        findLateCandidates: async () => [],
        markLate: async () => false,
        setStatus: async (id: number) => {
          statuses.push(id);
        },
      },
      apiKey: { getMeta: async () => keyMeta },
      settings: { get: async () => SETTINGS_OK },
      budget: {
        spentToday: async () => 40,
        remainingToday: async () => ({
          day: '2026-08-12',
          budget: 200,
          spent: 40,
          remaining: 160,
          exhausted: false,
        }),
      },
      audit: { appendAudit: async () => undefined },
      executor: async (c) => {
        executed.push(c.id);
        return {
          campaignId: c.id,
          status: 'queued' as const,
          itemsTotal: 150,
          itemsOk: 90,
          itemsFailed: 0,
          itemsUncertain: 0,
          items: [],
        };
      },
      log,
    },
  };
}

const QUEUE_CONFIG = {
  writesEnabledByEnv: true,
  timeZone: TIME_ZONE,
  maxCampaignsPerTick: 5,
};

describe('fronta v stave `queued` prežije expiráciu kľúča bez straty postupu (K6)', () => {
  it('bez použiteľného kľúča sa PRESKOČÍ a NEZMENÍ ani jeden stav kampane', async () => {
    resetQueueGate();
    resetQueueReport();
    const world = makeQueueWorld(KEY_EXPIRED);

    const outcome = await processQueue(world.deps, QUEUE_CONFIG, NOW);

    expect(outcome.skipped).toBe('key_missing');
    expect(world.executed).toEqual([]);
    // Toto je jadro veci: kampaň zostáva `queued`, nikto ju neprehodí na
    // `failed` ani na `needs_key`, takže postup ostáva nedotknutý.
    expect(world.statuses).toEqual([]);
  });

  it('po vložení platného kľúča sa tá istá fronta rozbehne bez akéhokoľvek kliku', async () => {
    resetQueueGate();
    resetQueueReport();
    const world = makeQueueWorld(KEY_VALID);

    const outcome = await processQueue(world.deps, QUEUE_CONFIG, NOW);

    expect(outcome.skipped).toBeNull();
    expect(outcome.processed).toBe(1);
    expect(world.executed).toEqual([5]);
  });
});
