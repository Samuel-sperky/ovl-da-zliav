/**
 * Aura Zľavy — in-memory svet pre integračné testy schedulera (A10, V7).
 *
 * Testy schedulera bežia s RIADENÝM časom a FAKE tickom (SPRINT-PLAN A10):
 * repozitáre sú deterministické in-memory implementácie kontraktov z
 * `src/contracts.ts`, takže testy overujú poradie krokov, guardy a stavové
 * prechody bez závislosti na DB. Shop sa NIKDY nevolá (I6) — canary aj
 * executor sú injektované fake funkcie.
 *
 * Kontrakt V3 pridal do sveta frontu: kampane so stavom `queued`, denný
 * rozpočet (K2) a bránu po odstávke počítača (odpoveď 43). Fake rozpočet
 * počíta spotrebu tak, ako ju počíta produkcia — z auditných záznamov
 * `write_attempt` — nie z vlastného počítadla, ktoré by sa mohlo rozísť.
 *
 * Nie je to `.spec.ts` — žiadne testy tu nie sú, len zdieľané fixtures
 * pre `scheduler.spec.ts`, `scheduler-queue.spec.ts`, `deviation-33.spec.ts`,
 * `ttl-wipe.spec.ts` a `reconcile.spec.ts`.
 */
import type {
  ApiKeyMeta,
  AuditInput,
  CampaignItemRecord,
  CanaryResult,
  DateOnly,
  ExecutorResult,
  KeyWipeReason,
  SchedulerStateRecord,
  SecretRef,
  SettingsRecord,
  UtcDate,
} from '@/contracts';

import { budgetDay, type BudgetSource, type BudgetStatus } from '@/lib/engine/budget';
import type { ExecutorResultV3 } from '@/lib/engine/executor';
import { createLogger } from '@/lib/log/logger';
import type { CatalogRunReport } from '@/lib/scheduler/catalog-runner';
import type { ExecuteCampaignFn } from '@/lib/scheduler/due';
import type { ExecuteQueuedCampaignFn } from '@/lib/scheduler/queue';
import { createTicker, type Ticker, type TickConfig } from '@/lib/scheduler/tick';
import type { CampaignStatusV3, SchedulerCampaign } from '@/lib/scheduler/types';

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
  /** K2 — executor fronty. `null` = nezapojený, `'ok'` = default fake. */
  queueExecutor?: ExecuteQueuedCampaignFn | null | 'ok';
  /** K2 — denný rozpočet. Default 200 ako v kontrakte. */
  dailyBudget?: number;
  /** Sabotáž pre test odolnosti: `setStatus` hodí výnimku. */
  failSetStatus?: boolean;
  /** Heartbeat predchádzajúceho behu (odpoveď 43 — odstávka počítača). */
  lastTickAt?: UtcDate | null;
  /** K7 — fake synchronizácie katalógu; `null` = v ticku nebeží. */
  catalogSync?: ((opts: { now: UtcDate; queueBusy: boolean }) => Promise<CatalogRunReport>) | null;
  config?: Partial<TickConfig>;
}

export interface World {
  clock: TestClock;
  ticker: Ticker;
  campaigns: Map<number, SchedulerCampaign>;
  items: Map<number, CampaignItemRecord>;
  auditLog: AuditInput[];
  heartbeats: Array<{ durationMs: number; lastError: string | null }>;
  executorCalls: SchedulerCampaign[];
  /** K2 — kampane, ktoré prešli frontou. */
  queueCalls: SchedulerCampaign[];
  canaryCalls: number;
  catalogCalls: Array<{ queueBusy: boolean }>;
  wipes: KeyWipeReason[];
  keyMeta: ApiKeyMeta;
  settings: SettingsRecord;
  /** Pre reconcile: campaignId → potvrdené requestId. */
  confirmedWrites: Map<number, string[]>;
  /** K5 — kampane, ktorým sa nastavil príznak meškania. */
  lateMarked: number[];
  addCampaign(c: SchedulerCampaign): void;
  addItem(i: CampaignItemRecord): void;
  statusOf(id: number): CampaignStatusV3 | undefined;
  auditEvents(): string[];
  /** Koľko `write_attempt` je v audite za daný deň (rozpočet, K2). */
  writeAttempts(): number;
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

  const campaigns = new Map<number, SchedulerCampaign>();
  const items = new Map<number, CampaignItemRecord>();
  const auditLog: AuditInput[] = [];
  const heartbeats: Array<{ durationMs: number; lastError: string | null }> = [];
  const executorCalls: SchedulerCampaign[] = [];
  const queueCalls: SchedulerCampaign[] = [];
  const catalogCalls: Array<{ queueBusy: boolean }> = [];
  const wipes: KeyWipeReason[] = [];
  const confirmedWrites = new Map<number, string[]>();
  const lateMarked: number[] = [];

  const countWriteAttempts = (): number =>
    auditLog.filter((a) => a.eventType === 'write_attempt').length;

  const world: World = {
    clock,
    ticker: undefined as unknown as Ticker,
    campaigns,
    items,
    auditLog,
    heartbeats,
    executorCalls,
    queueCalls,
    canaryCalls: 0,
    catalogCalls,
    wipes,
    keyMeta,
    settings,
    confirmedWrites,
    lateMarked,
    addCampaign: (c) => campaigns.set(c.id, { ...c }),
    addItem: (i) => items.set(i.id, { ...i }),
    statusOf: (id) => campaigns.get(id)?.status,
    auditEvents: () => auditLog.map((a) => a.eventType),
    writeAttempts: countWriteAttempts,
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

  /**
   * K2 — fake dávky z fronty. Míňa rozpočet rovnako ako produkcia: za každú
   * položku zapíše audit `write_attempt`, takže rozpočet sa počíta z auditu,
   * nie z premennej v teste.
   */
  const defaultQueueExecutor: ExecuteQueuedCampaignFn = async (campaign) => {
    queueCalls.push({ ...campaign });
    const record = campaigns.get(campaign.id);
    const total = campaign.itemsTotal;
    for (let index = 0; index < total; index += 1) {
      auditLog.push({
        actor: 'scheduler',
        eventType: 'write_attempt',
        campaignId: campaign.id,
        productId: index + 1,
      });
    }
    if (record) {
      record.status = 'done';
      record.finishedAt = clock.now();
    }
    const result: ExecutorResultV3 = {
      campaignId: campaign.id,
      status: 'done',
      itemsTotal: total,
      itemsOk: total,
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

  const queueExecutor: ExecuteQueuedCampaignFn | null =
    options.queueExecutor === 'ok' || options.queueExecutor === undefined
      ? defaultQueueExecutor
      : options.queueExecutor;

  /** K2 — rozpočet nad fake auditom; spotreba je počet `write_attempt`. */
  const dailyBudget = options.dailyBudget ?? 200;
  const budget: BudgetSource = {
    async spentToday() {
      return countWriteAttempts();
    },
    async remainingToday(): Promise<BudgetStatus> {
      const spent = countWriteAttempts();
      const remaining = Math.max(0, dailyBudget - spent);
      return {
        // Rozpočtový deň je UTC deň (K2) — cez `budgetDay()`, nie cez vlastný
        // `toISOString().slice()`, aby fake nemal druhú cestu k dátumu.
        day: budgetDay(clock.now()),
        budget: dailyBudget,
        spent,
        remaining,
        exhausted: remaining === 0,
      };
    },
  };

  const schedulerState: SchedulerStateRecord = {
    id: 1,
    lastTickAt: options.lastTickAt ?? null,
    lastTickDurationMs: null,
    tickCount: 0,
    lastError: null,
    updatedAt: TEST_NOW,
  };

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
      /** K2 — najskorší `date_from` prvý, `id` ako deterministický tie-break. */
      async findQueued(limit = 50) {
        return [...campaigns.values()]
          .filter((c) => c.status === 'queued')
          .sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : a.id - b.id))
          .slice(0, limit);
      },
      /** K5 — okno už nabehlo a kampaň má stále `pending` položky. */
      async findLateCandidates(today: DateOnly) {
        return [...campaigns.values()].filter(
          (c) =>
            c.late !== true &&
            c.dateFrom <= today &&
            ['scheduled', 'needs_key', 'running', 'missed', 'queued'].includes(c.status) &&
            [...items.values()].some((i) => i.campaignId === c.id && i.status === 'pending'),
        );
      },
      async markLate(id) {
        const c = campaigns.get(id);
        if (!c || c.late === true) return false;
        c.late = true;
        lateMarked.push(id);
        return true;
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
      async get() {
        return { ...schedulerState };
      },
      async heartbeat(durationMs, lastError) {
        heartbeats.push({ durationMs, lastError });
        schedulerState.lastTickAt = clock.now();
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
    queueExecutor,
    budget,
    catalogSync:
      options.catalogSync === undefined
        ? async ({ queueBusy }): Promise<CatalogRunReport> => {
            catalogCalls.push({ queueBusy });
            return { outcome: queueBusy ? 'writes_first' : 'too_soon', sync: null };
          }
        : options.catalogSync,
    /*
     * Obohacovanie (D118 bod 2) v tomto svete NEBEŽÍ a nebude: fake dávky by
     * dokazoval len sám seba. Produkčné zapojenie kroku má vlastný dôkaz —
     * `test/integration/scheduler-obohacovanie.spec.ts` beží s krokom
     * z `scheduler/boot.ts` a proti skutočnému mocku.
     */
    enrich: null,
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
