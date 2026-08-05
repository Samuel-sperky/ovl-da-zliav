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
 * Executor dávky (`engine/executor.ts`, A9) sa pripája dynamicky — kým nie je
 * k dispozícii, due kampane idú fail-closed do `needs_key`
 * (dôvod `executor_unavailable`), NIKDY sa nezapisuje do shopu odtiaľto.
 */
import { env, writesAllowedByEnv } from '@/env';

import { auditWriter } from '@/lib/audit/write';
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
 * Dynamické pripojenie `engine/executor.ts` (A9). Cesta je zámerne
 * v premennej — modul môže v čase buildu tejto úlohy ešte neexistovať
 * a scheduler musí zostať fail-closed funkčný aj bez neho.
 */
async function resolveExecutor(): Promise<ExecuteCampaignFn | null> {
  const modulePath = '@/lib/engine/executor';
  try {
    const mod = (await import(/* webpackIgnore: true */ `${modulePath}`)) as Record<
      string,
      unknown
    >;
    const candidate = mod.executeCampaign ?? mod.default;
    if (typeof candidate === 'function') return candidate as ExecuteCampaignFn;
  } catch {
    // engine ešte nie je k dispozícii — fail-closed režim.
  }
  log.warn('scheduler_executor_unavailable', {
    detail: 'engine/executor (A9) sa nenašiel — due kampane pôjdu do needs_key (fail-closed).',
  });
  return null;
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
    if (!ticker) ticker = buildTicker(await resolveExecutor());
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
