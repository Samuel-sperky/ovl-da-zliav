/**
 * Aura Zľavy — in-memory svet pre integračné testy schedulera (A10).
 *
 * Testy schedulera bežia s RIADENÝM časom a FAKE tickom (SPRINT-PLAN A10):
 * repozitáre sú deterministické in-memory implementácie kontraktov z
 * `src/contracts.ts`, takže testy overujú poradie krokov, guardy a stavové
 * prechody bez závislosti na DB. Shop sa NIKDY nevolá (I6) — canary aj
 * executor sú injektované fake funkcie.
 *
 * Nie je to `.spec.ts` — žiadne testy tu nie sú, len zdieľané fixtures
 * pre `scheduler.spec.ts`, `deviation-33.spec.ts`, `ttl-wipe.spec.ts`
 * a `reconcile.spec.ts`.
 */
import type {
  ApiKeyMeta,
  AuditInput,
  CampaignItemRecord,
  CampaignRecord,
  CampaignStatus,
  CanaryResult,
  ExecutorResult,
  KeyWipeReason,
  SecretRef,
  SettingsRecord,
  UtcDate,
} from '@/contracts';

import { createLogger } from '@/lib/log/logger';
import { createTicker, type Ticker, type TickConfig } from '@/lib/scheduler/tick';
import type { ExecuteCampaignFn } from '@/lib/scheduler/due';

import { fakeSecretRef, TEST_NOW } from '../helpers/factories';

/* ─────────────────────────────── riadený čas ───────────────────────────── */

export interface TestClock {
  now(): UtcDate;
  set(next: Date): void;
  advanceMinutes(minutes: number): void;
}

export function makeClock(start: Date = TEST_NOW): TestClock {
  let current = new Date(start.getTime());
  return {
    now: () => new Date(current.getTime()),
    set: (next) => {
      current = new Date(next.getTime());
    },
    advanceMinutes: (minutes) => {
      current = new Date(current.getTime() + minutes * 60_000);
    },
  };
}

/* ─────────────────────────────── fake svet ─────────────────────────────── */

export interface WorldOptions {
  clock?: TestClock;
  /** Default: platný kľúč s TTL ďaleko v budúcnosti. */
  keyMeta?: Partial<ApiKeyMeta> | null;
  writesEnabledByEnv?: boolean;
  writesLocked?: boolean;
  canaryOk?: boolean;
  /** `null` = executor nezapojený (fail-closed vetva). */
  executor?: ExecuteCampaignFn | null | 'ok';
  /** Sabotáž pre test odolnosti: `setStatus` hodí výnimku. */
  failSetStatus?: boolean;
  config?: Partial<TickConfig>;
}

export interface World {
  clock: TestClock;
  ticker: Ticker;
  campaigns: Map<number, CampaignRecord>;
  items: Map<number, CampaignItemRecord>;
  auditLog: AuditInput[];
  heartbeats: Array<{ durationMs: number; lastError: string | null }>;
  executorCalls: CampaignRecord[];
  canaryCalls: number;
  wipes: KeyWipeReason[];
  keyMeta: ApiKeyMeta;
  settings: SettingsRecord;
  /** Pre reconcile: campaignId → potvrdené requestId. */
  confirmedWrites: Map<number, string[]>;
  addCampaign(c: CampaignRecord): void;
  addItem(i: CampaignItemRecord): void;
  statusOf(id: number): CampaignStatus | undefined;
  auditEvents(): string[];
}

const FAR_FUTURE = new Date('2030-01-01T00:00:00.000Z');

export function makeWorld(options: WorldOptions = {}): World {
  const clock = options.clock ?? makeClock();

  const keyMeta: ApiKeyMeta =
    options.keyMeta === null
      ? {
          present: false,
          last4: null,
          savedAt: null,
          expiresAt: null,
          secondsLeft: null,
          verifyStatus: null,
          lastUsedAt: null,
        }
      : {
          present: true,
          last4: '0001',
          savedAt: TEST_NOW,
          expiresAt: FAR_FUTURE,
          secondsLeft: 3600,
          verifyStatus: 'valid',
          lastUsedAt: null,
          ...options.keyMeta,
        };

  const settings: SettingsRecord = {
    id: 1,
    shopDomain: 'https://127.0.0.1',
    shopDomainConfirmedAt: TEST_NOW,
    eagerWriteDefault: true,
    writesLocked: options.writesLocked ?? false,
    writesLockedReason: options.writesLocked ? 'runaway' : null,
    writesLockedAt: options.writesLocked ? TEST_NOW : null,
    onboardingDoneAt: TEST_NOW,
    updatedAt: TEST_NOW,
  };

  const campaigns = new Map<number, CampaignRecord>();
  const items = new Map<number, CampaignItemRecord>();
  const auditLog: AuditInput[] = [];
  const heartbeats: Array<{ durationMs: number; lastError: string | null }> = [];
  const executorCalls: CampaignRecord[] = [];
  const wipes: KeyWipeReason[] = [];
  const confirmedWrites = new Map<number, string[]>();

  const world: World = {
    clock,
    ticker: undefined as unknown as Ticker,
    campaigns,
    items,
    auditLog,
    heartbeats,
    executorCalls,
    canaryCalls: 0,
    wipes,
    keyMeta,
    settings,
    confirmedWrites,
    addCampaign: (c) => campaigns.set(c.id, { ...c }),
    addItem: (i) => items.set(i.id, { ...i }),
    statusOf: (id) => campaigns.get(id)?.status,
    auditEvents: () => auditLog.map((a) => a.eventType),
  };

  const defaultExecutor: ExecuteCampaignFn = async (campaign) => {
    executorCalls.push({ ...campaign });
    const record = campaigns.get(campaign.id);
    if (record) {
      record.status = 'done';
      record.finishedAt = clock.now();
    }
    const result: ExecutorResult = {
      campaignId: campaign.id,
      status: 'done',
      itemsTotal: campaign.itemsTotal,
      itemsOk: campaign.itemsTotal,
      itemsFailed: 0,
      itemsUncertain: 0,
      items: [],
    };
    return result;
  };

  const executor: ExecuteCampaignFn | null =
    options.executor === 'ok' || options.executor === undefined
      ? defaultExecutor
      : options.executor;

  world.ticker = createTicker({
    campaigns: {
      async findDue(now) {
        return [...campaigns.values()].filter(
          (c) => c.status === 'scheduled' && c.fireAt != null && c.fireAt.getTime() <= now.getTime(),
        );
      },
      async findScheduled() {
        return [...campaigns.values()].filter((c) => c.status === 'scheduled');
      },
      async findMissedCandidates(threshold) {
        return [...campaigns.values()].filter(
          (c) =>
            c.status === 'scheduled' && c.fireAt != null && c.fireAt.getTime() < threshold.getTime(),
        );
      },
      async findNeedsKey() {
        return [...campaigns.values()].filter((c) => c.status === 'needs_key');
      },
      async findRunningUnfinished() {
        return [...campaigns.values()].filter((c) => c.status === 'running' && c.finishedAt == null);
      },
      async claim(id, allowedFrom) {
        const c = campaigns.get(id);
        if (!c || !allowedFrom.includes(c.status)) return false;
        c.status = 'running';
        c.claimedAt = clock.now();
        return true;
      },
      async setStatus(id, status, patch) {
        if (options.failSetStatus) throw new Error('setStatus sabotovaný testom');
        const c = campaigns.get(id);
        if (!c) return;
        c.status = status;
        Object.assign(c, patch ?? {});
        c.updatedAt = clock.now();
      },
    },
    items: {
      async listByCampaign(campaignId) {
        return [...items.values()]
          .filter((i) => i.campaignId === campaignId)
          .sort((a, b) => a.position - b.position);
      },
      async update(id, patch) {
        const item = items.get(id);
        if (item) Object.assign(item, patch);
      },
    },
    apiKey: {
      async getMeta() {
        return { ...keyMeta };
      },
      async loadForUse(): Promise<SecretRef | null> {
        if (!keyMeta.present) return null;
        if (keyMeta.expiresAt && keyMeta.expiresAt.getTime() <= clock.now().getTime()) return null;
        return fakeSecretRef('fake-shop-key-0001');
      },
      async wipe(reason) {
        if (!keyMeta.present) return false;
        wipes.push(reason);
        keyMeta.present = false;
        keyMeta.last4 = null;
        keyMeta.expiresAt = null;
        keyMeta.verifyStatus = null;
        auditLog.push({ actor: 'system', eventType: 'key_wiped', ok: true, message: reason });
        return true;
      },
    },
    settings: {
      async get() {
        return { ...settings };
      },
    },
    schedulerState: {
      async heartbeat(durationMs, lastError) {
        heartbeats.push({ durationMs, lastError });
      },
    },
    audit: {
      async appendAudit(input) {
        auditLog.push(input);
      },
    },
    auditReader: {
      async findConfirmedWrites(campaignId) {
        return (confirmedWrites.get(campaignId) ?? []).map((requestId) => ({
          requestId,
          productId: null,
        }));
      },
    },
    canary: async (): Promise<CanaryResult> => {
      world.canaryCalls += 1;
      return options.canaryOk === false
        ? { ok: false, total: 0, latencyMs: 5, httpStatus: null }
        : { ok: true, total: 1, latencyMs: 5, httpStatus: 200 };
    },
    executor,
    log: createLogger({ module: 'scheduler-test' }),
    clock,
    config: {
      writesEnabledByEnv: options.writesEnabledByEnv ?? true,
      midnightFreezeSeconds: 60,
      ...options.config,
    },
  });

  return world;
}
