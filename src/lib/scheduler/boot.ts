/**
 * Aura Zľavy — start in-process schedulera (D82, §9). Vlastník: A10
 * (prevzaté po stube od A0).
 *
 * Spúšťa sa z `src/instrumentation.ts` po úspešných boot assertions.
 * Kontrakt:
 *  - `startScheduler()` je idempotentný — druhé zavolanie nespustí druhý cyklus,
 *  - `SCHEDULER_ENABLED=false` scheduler úplne vypne (testy, dev),
 *  - výnimka v ticku NEZHODÍ proces — `tick.ts` ju zapisuje do
 *    `scheduler_state.last_error` (D87),
 *  - poradie krokov ticku je normatívne (§9) a implementuje ho `tick.ts`.
 *
 * Executor dávky (`engine/executor.ts`, A9) je pripojený STATICKY cez adaptér
 * `createSchedulerExecutor()` — dynamický import s `webpackIgnore` na `@/`
 * alias v standalone Node builde nikdy nefungoval a nekompatibilná signatúra
 * (`executeCampaign(campaignId, deps, opts)` vs `(campaign, key, ctx)`) by aj
 * po ňom zápis rozbila. Adaptér prekladá volanie schedulera na volanie engine.
 */
import { env, writesAllowedByEnv } from '@/env';

import { auditWriter } from '@/lib/audit/write';
import { executeCampaign, type ExecutorDeps } from '@/lib/engine/executor';
import { logger } from '@/lib/log/logger';
import { apiKeyRepo } from '@/lib/repo/api-key.repo';
import { auditRepo } from '@/lib/repo/audit.repo';
import { campaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepo } from '@/lib/repo/campaigns.repo';
import { schedulerStateRepo } from '@/lib/repo/scheduler-state.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings } from '@/lib/shop/client';

import type { ExecuteCampaignFn } from './due';
import { createTicker, type Ticker } from './tick';

const log = logger.child({ module: 'scheduler' });

let timer: ReturnType<typeof setInterval> | null = null;
let ticker: Ticker | null = null;

/**
 * Adaptér scheduler → engine (A10 → A9). Scheduler volá executor podpisom
 * `(campaign, key, ctx)`; engine má `executeCampaign(campaignId, deps, opts)`.
 * Kľúč z parametra sa NEPOUŽÍVA — executor si ho načíta sám cez
 * `apiKeyRepo.loadForUse()` (D21, D63), aby medzi guardom a zápisom nikdy
 * nežila kópia mimo repozitára. `overrides` sú výhradne pre testy (mock shop,
 * in-memory repozitáre); produkčný boot volá funkciu bez argumentov.
 */
export function createSchedulerExecutor(
  overrides: Partial<ExecutorDeps> = {},
): ExecuteCampaignFn {
  const shopClient = overrides.shopClient ?? createShopClientFromSettings(settingsRepo);
  return (campaign, _key, _ctx) =>
    executeCampaign(campaign.id, { ...overrides, shopClient }, { actor: 'scheduler' });
}

function buildTicker(executor: ExecuteCampaignFn | null): Ticker {
  const shop = createShopClientFromSettings(settingsRepo);
  return createTicker({
    campaigns: campaignsRepo,
    items: campaignItemsRepo,
    apiKey: apiKeyRepo,
    settings: settingsRepo,
    schedulerState: schedulerStateRepo,
    audit: auditWriter,
    auditReader: auditRepo,
    canary: (ctx) => shop.canary(ctx),
    executor,
    log,
    config: {
      writesEnabledByEnv: writesAllowedByEnv(),
      timeZone: env.LOGIC_TIMEZONE,
      midnightFreezeSeconds: env.MIDNIGHT_FREEZE_SECONDS,
    },
  });
}

export function startScheduler(): void {
  if (timer) return; // idempotencia — druhý cyklus sa nikdy nespustí
  if (!env.SCHEDULER_ENABLED) {
    log.info('scheduler_disabled', { detail: 'SCHEDULER_ENABLED=false' });
    return;
  }

  timer = setInterval(() => {
    void runOneTick();
  }, env.SCHEDULER_TICK_MS);
  // Interval nesmie držať proces pri shutdowne.
  timer.unref?.();

  log.info('scheduler_started', { tickMs: env.SCHEDULER_TICK_MS });
  // Prvý tick hneď po štarte — kvôli reconcile (D86) a TTL wipe (D63).
  void runOneTick();
}

async function runOneTick(): Promise<void> {
  try {
    if (!ticker) ticker = buildTicker(createSchedulerExecutor());
    await ticker.runTick(); // runTick nikdy nehodí výnimku (D87)
  } catch (error) {
    // Poistka poslednej inštancie — proces sa NESMIE zhodiť (D87).
    log.error('scheduler_tick_fatal_caught', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  ticker = null;
}

export function isSchedulerRunning(): boolean {
  return timer !== null;
}
