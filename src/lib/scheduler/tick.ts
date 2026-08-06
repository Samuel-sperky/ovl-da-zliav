/**
 * Aura Zľavy — jadro schedulera: jeden tick (§9, D82, D87).
 *
 * Poradie krokov je NORMATÍVNE:
 *   1. heartbeat začiatok (meranie `t0`),
 *   2. TTL wipe kľúča (D63) — PRVÝ vecný krok, aby žiadny ďalší nepoužil
 *      expirovaný kľúč,
 *   3. reconcile pri PRVOM ticku po štarte (D86),
 *   4. missed detekcia (D33b) — ŽIADNY automatický catch-up,
 *   5. due výber + guardy + atomický claim + delegácia na executor (D21, D84),
 *   6. reminders 48/24/2 h (D26),
 *   7. heartbeat koniec (`scheduler_state`, D87).
 *
 * Tick je chránený in-process flagom (jeden tick naraz) a KAŽDÁ výnimka sa
 * zapíše do `scheduler_state.last_error` bez zhodenia procesu.
 *
 * Vlastník: A10.
 */
import type {
  ApiKeyRepo,
  AuditRepo,
  AuditWriter,
  CampaignItemsRepo,
  CampaignsRepo,
  CanaryResult,
  Logger,
  SchedulerStateRepo,
  SettingsRepo,
  ShopCtx,
  TickResult,
  UtcDate,
} from '@/contracts';

import { DEFAULT_MIDNIGHT_FREEZE_SECONDS, LOGIC_TIME_ZONE } from '@/lib/domain/dates';

import { processDue, type ExecuteCampaignFn } from './due';
import { detectMissed, MISSED_GRACE_MINUTES } from './missed';
import { reconcileAfterCrash } from './reconcile';
import { computeReminders, setActiveReminders } from './reminders';
import { runTtlWipe } from './ttl-wipe';

export interface Clock {
  now(): UtcDate;
}

export interface TickConfig {
  /** `writesAllowedByEnv()` (I13). */
  writesEnabledByEnv: boolean;
  timeZone: string;
  midnightFreezeSeconds: number;
  missedGraceMinutes: number;
}

export interface TickDeps {
  campaigns: Pick<
    CampaignsRepo,
    'findDue' | 'findMissedCandidates' | 'findNeedsKey' | 'findRunningUnfinished' | 'claim' | 'setStatus'
  > & {
    /**
     * Všetky `scheduled` kampane bez dátumovej podmienky (D26) — sentinel
     * dátum vo `findDue()` MariaDB skráti a porovnanie je vždy false.
     * Implementuje `CampaignsRepoExt` (`lib/repo/campaigns.repo.ts`).
     */
    findScheduled(): Promise<import('@/contracts').CampaignRecord[]>;
  };
  items: Pick<CampaignItemsRepo, 'listByCampaign' | 'update'>;
  apiKey: Pick<ApiKeyRepo, 'getMeta' | 'loadForUse' | 'wipe'>;
  settings: Pick<SettingsRepo, 'get'>;
  schedulerState: Pick<SchedulerStateRepo, 'heartbeat'>;
  audit: AuditWriter;
  auditReader: Pick<AuditRepo, 'findConfirmedWrites'>;
  canary: (ctx: ShopCtx) => Promise<CanaryResult>;
  executor: ExecuteCampaignFn | null;
  log: Logger;
  clock?: Clock;
  config?: Partial<TickConfig>;
}

export interface Ticker {
  /** Spustí jeden tick. Nikdy nehodí výnimku (D87). */
  runTick(): Promise<TickResult>;
  isTicking(): boolean;
}

export function createTicker(deps: TickDeps): Ticker {
  const clock: Clock = deps.clock ?? { now: () => new Date() };
  const config: TickConfig = {
    writesEnabledByEnv: deps.config?.writesEnabledByEnv ?? false,
    timeZone: deps.config?.timeZone ?? LOGIC_TIME_ZONE,
    midnightFreezeSeconds: deps.config?.midnightFreezeSeconds ?? DEFAULT_MIDNIGHT_FREEZE_SECONDS,
    missedGraceMinutes: deps.config?.missedGraceMinutes ?? MISSED_GRACE_MINUTES,
  };

  let ticking = false;
  let firstTickDone = false;

  return {
    isTicking: () => ticking,

    async runTick(): Promise<TickResult> {
      const startedAt = clock.now();
      const result: TickResult = {
        startedAt,
        durationMs: 0,
        keyWiped: false,
        reconciled: 0,
        missed: 0,
        fired: 0,
        needsKey: 0,
        error: null,
      };

      // Jeden tick naraz — prekrývajúci sa tick sa ticho preskočí.
      if (ticking) {
        result.error = 'tick_overlap_skipped';
        return result;
      }
      ticking = true;

      try {
        // 2. TTL wipe — PRVÝ vecný krok (D63).
        result.keyWiped = await runTtlWipe({ apiKey: deps.apiKey, log: deps.log }, startedAt);

        // 3. Reconcile výhradne pri prvom ticku po štarte (D86).
        if (!firstTickDone) {
          result.reconciled = await reconcileAfterCrash(
            {
              campaigns: deps.campaigns,
              items: deps.items,
              auditReader: deps.auditReader,
              audit: deps.audit,
              log: deps.log,
            },
            startedAt,
          );
        }

        // 4. Missed detekcia (D33b) — žiadny catch-up.
        result.missed = await detectMissed(
          { campaigns: deps.campaigns, audit: deps.audit, log: deps.log },
          startedAt,
          config.missedGraceMinutes,
        );

        // 5. Due + guardy + claim + executor.
        const due = await processDue(
          {
            campaigns: deps.campaigns,
            apiKey: deps.apiKey,
            settings: deps.settings,
            audit: deps.audit,
            canary: deps.canary,
            executor: deps.executor,
            log: deps.log,
          },
          {
            writesEnabledByEnv: config.writesEnabledByEnv,
            timeZone: config.timeZone,
            midnightFreezeSeconds: config.midnightFreezeSeconds,
          },
          startedAt,
        );
        result.fired = due.fired;
        result.needsKey = due.needsKey;

        // 6. Reminders (D26) — len výpočet, nikam sa nič neposiela (D17).
        // POZOR: žiadny sentinel dátum do `findDue()` — MariaDB by ho skrátila
        // s warningom a `fire_at <= ?` by bolo vždy false (banner D26 by neexistoval).
        const scheduled = await deps.campaigns.findScheduled();
        const needingKey = await deps.campaigns.findNeedsKey();
        setActiveReminders(computeReminders([...scheduled, ...needingKey], clock.now()));

        firstTickDone = true;
      } catch (error) {
        // Výnimka v ticku NESMIE zhodiť proces (D87) — ide do last_error.
        result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        deps.log.error('scheduler_tick_error', { error: result.error });
      } finally {
        result.durationMs = Math.max(0, clock.now().getTime() - startedAt.getTime());
        // 7. Heartbeat sa zapisuje KAŽDÝ tick, aj po výnimke (D87).
        try {
          await deps.schedulerState.heartbeat(result.durationMs, result.error);
        } catch (hbError) {
          const msg = hbError instanceof Error ? hbError.message : String(hbError);
          result.error = result.error ?? `heartbeat_failed: ${msg}`;
          deps.log.error('scheduler_heartbeat_error', { error: msg });
        }
        ticking = false;
      }

      return result;
    },
  };
}
