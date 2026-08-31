/**
 * Aura Zľavy — jadro schedulera: jeden tick (§9, D82, D87; KONTRAKT V3 K2, K6, K7).
 *
 * Poradie krokov je NORMATÍVNE:
 *   1. heartbeat začiatok (meranie `t0`),
 *   2. TTL wipe kľúča (D63) — PRVÝ vecný krok, aby žiadny ďalší nepoužil
 *      expirovaný kľúč,
 *   3. reconcile pri PRVOM ticku po štarte (D86) + brána fronty po odstávke
 *      počítača (odpoveď 43) — obe veci sa vyhodnocujú z DB skôr, než sa
 *      čokoľvek zapíše,
 *   4. missed detekcia (D33b) — ŽIADNY automatický catch-up,
 *   5. due výber + guardy + atomický claim + delegácia na executor (D21, D84),
 *   5b. FRONTA (K2) — `queued` kampane dobehnú denný rozpočet cez executor,
 *   6. reminders 48/24/2 h (D26) + pripomienka o kľúči vs. fronte (K6),
 *   7. synchronizácia katalógu (K7) — ČÍTANIE, mimo zápisového rozpočtu, ako
 *      posledná: zápisy majú prednosť pred syncom,
 *   7b. dávka OBOHACOVANIA katalógu (KONTRAKT V4 §2b, D118 bod 2) — tiež
 *      ČÍTANIE, a to až po katalógu: bez zrkadla katalógu nie je čo obohacovať,
 *   8. heartbeat koniec (`scheduler_state`, D87).
 *
 * Tick je chránený in-process flagom (jeden tick naraz) a KAŽDÁ výnimka sa
 * zapíše do `scheduler_state.last_error` bez zhodenia procesu.
 *
 * Vlastník: A10, prestavba fronty V7.
 */
import type {
  ApiKeyRepo,
  AuditRepo,
  AuditWriter,
  CampaignItemsRepo,
  CanaryResult,
  Logger,
  SchedulerStateRepo,
  SettingsRepo,
  ShopCtx,
  TickResult,
  UtcDate,
} from '@/contracts';

import type { BudgetSource } from '@/lib/engine/budget';
import { DEFAULT_MIDNIGHT_FREEZE_SECONDS, LOGIC_TIME_ZONE } from '@/lib/domain/dates';

import type { CatalogRunReport } from './catalog-runner';
import { processDue, type ExecuteCampaignFn } from './due';
import type { EnrichRunReport } from './enrich-runner';
import { detectMissed, MISSED_GRACE_MINUTES } from './missed';
import {
  assessDowntimeOnce,
  assessDowntimeUnknown,
  isQueuePaused,
  DOWNTIME_GRACE_MS,
} from './pause';
import {
  processQueue,
  type ExecuteQueuedCampaignFn,
  type QueueOutcome,
  type QueueSkipReason,
} from './queue';
import { reconcileAfterCrash } from './reconcile';
import {
  computeKeyExpiryReminder,
  computeReminders,
  setActiveKeyExpiryReminder,
  setActiveReminders,
} from './reminders';
import { runTtlWipe } from './ttl-wipe';
import type { SchedulerCampaignsRepo } from './types';

export interface Clock {
  now(): UtcDate;
}

export interface TickConfig {
  /** `writesAllowedByEnv()` (I13). */
  writesEnabledByEnv: boolean;
  timeZone: string;
  midnightFreezeSeconds: number;
  missedGraceMinutes: number;
  /** K2 — koľko kampaní z fronty sa v jednom ticku vôbec zvažuje. */
  maxQueueCampaignsPerTick: number;
  /** Odpoveď 43 — dlhšia diera v heartbeate = odstávka počítača. */
  downtimeGraceMs: number;
}

/**
 * Výsledok ticku po KONTRAKTE V3. `TickResult` v `src/contracts.ts` (vlastník
 * A0) frontu ani katalóg nepozná, preto je tu ROZŠÍRENIE — nie druhý tvar.
 * Keď kontrakt polia dostane, zmizne toto rozhranie a nič iné.
 */
export interface TickResultV3 extends TickResult {
  /** Koľko kampaní z fronty PREŠLO executorom (K2). */
  queueProcessed: number;
  /**
   * Koľko kampaní fronta v tomto tiku VZALA — nie koľko ich čaká.
   *
   * Číslo pochádza z dotazu s `LIMIT maxCampaignsPerTick` (20), takže pri 25
   * čakajúcich kampaniach je to 20. Do 26. 8. 2026 sa menovalo `queueWaiting`
   * a doc riadok tvrdil „koľko čakalo", čo je počet, ktorý appka nezmerala.
   * Premenované, aby meno hovorilo, čo to je; `queueWaitingCapped` povie, či sa
   * strop naozaj dosiahol.
   *
   * Prečo sa nedopočítava skutočný počet: tento tik ho na svoju prácu
   * nepotrebuje a druhý dotaz za tik nie je zadarmo. Kto ho bude potrebovať,
   * dopýta sa naň zvlášť — a bude vedieť, že to robí.
   */
  queueTaken: number;
  /** `true` = `queueTaken` narazilo na strop tiku, teda je to menšie než skutočnosť. */
  queueWaitingCapped: boolean;
  /** Fronta čaká na potvrdenie po odstávke počítača (odpoveď 43). */
  queuePaused: boolean;
  /** Prečo sa vo fronte nezapisovalo; `null` = zapisovalo sa. */
  queueSkipped: QueueSkipReason | null;
  /** Výsledok synchronizácie katalógu (K7); `null` = v tomto ticku nebežala. */
  catalog: CatalogRunReport | null;
  /**
   * Výsledok dávky obohacovania (D118 bod 2); `null` = v tomto ticku nebežala.
   *
   * `null` NIE JE „nič sa neobohatilo" — to hovorí `enrich.batch.enriched`.
   * Rozdiel je celý zmysel I11: „nebežalo" a „bežalo a nič nenašlo" sú dve
   * rôzne vety a zliať ich znamená klamať stavovým pásom.
   */
  enrich: EnrichRunReport | null;
}

export interface TickDeps {
  /**
   * Produkčne `campaignsRepoV3` (V4). Metódy fronty (`findQueued`,
   * `findLateCandidates`, `markLate`) sú POVINNÉ — keby boli voliteľné,
   * nezapojená fronta by sa ticho preskočila a bol by to znovu nález E1.
   */
  campaigns: SchedulerCampaignsRepo;
  items: Pick<CampaignItemsRepo, 'listByCampaign' | 'update'>;
  apiKey: Pick<ApiKeyRepo, 'getMeta' | 'loadForUse' | 'wipe'>;
  settings: Pick<SettingsRepo, 'get'>;
  schedulerState: Pick<SchedulerStateRepo, 'get' | 'heartbeat'>;
  audit: AuditWriter;
  auditReader: Pick<AuditRepo, 'findConfirmedWrites'>;
  canary: (ctx: ShopCtx) => Promise<CanaryResult>;
  /** Fire naplánovanej kampane (D32). */
  executor: ExecuteCampaignFn | null;
  /** K2 — dávka kampane z fronty. Ten istý engine, iný vstupný bod. */
  queueExecutor: ExecuteQueuedCampaignFn | null;
  /** K2 — denný rozpočet zo `settings` + spotreba z auditu. */
  budget: BudgetSource;
  /**
   * K7 — synchronizácia katalógu. `null` = v tomto procese sa nesynchronizuje
   * (testy ticku); produkčný boot ju zapája vždy.
   */
  catalogSync: ((opts: { now: UtcDate; queueBusy: boolean }) => Promise<CatalogRunReport>) | null;
  /**
   * Dávka obohacovania katalógu (D118 bod 2). `null` = v tomto procese sa
   * neobohacuje (testy ticku); produkčný boot ju zapája vždy.
   *
   * `queueBusy` aj `catalogBusy` sú tu preto, že obohacovanie je NAJNIŽŠIA
   * priorita v ticku: ustúpi zápisom aj katalógovému prechodu.
   */
  enrich:
    | ((opts: {
        now: UtcDate;
        queueBusy: boolean;
        catalogBusy: boolean;
      }) => Promise<EnrichRunReport>)
    | null;
  log: Logger;
  clock?: Clock;
  /** D85 — SIGTERM: fronta sa medzi kampaňami zastaví. */
  isStopping?: () => boolean;
  config?: Partial<TickConfig>;
}

export interface Ticker {
  /** Spustí jeden tick. Nikdy nehodí výnimku (D87). */
  runTick(): Promise<TickResultV3>;
  isTicking(): boolean;
}

/** Koľko kampaní z fronty sa v jednom ticku zvažuje (K2). */
export const DEFAULT_QUEUE_CAMPAIGNS_PER_TICK = 20;

export function createTicker(deps: TickDeps): Ticker {
  const clock: Clock = deps.clock ?? { now: () => new Date() };
  const config: TickConfig = {
    writesEnabledByEnv: deps.config?.writesEnabledByEnv ?? false,
    timeZone: deps.config?.timeZone ?? LOGIC_TIME_ZONE,
    midnightFreezeSeconds: deps.config?.midnightFreezeSeconds ?? DEFAULT_MIDNIGHT_FREEZE_SECONDS,
    missedGraceMinutes: deps.config?.missedGraceMinutes ?? MISSED_GRACE_MINUTES,
    maxQueueCampaignsPerTick:
      deps.config?.maxQueueCampaignsPerTick ?? DEFAULT_QUEUE_CAMPAIGNS_PER_TICK,
    downtimeGraceMs: deps.config?.downtimeGraceMs ?? DOWNTIME_GRACE_MS,
  };

  let ticking = false;
  let firstTickDone = false;

  return {
    isTicking: () => ticking,

    async runTick(): Promise<TickResultV3> {
      const startedAt = clock.now();
      const result: TickResultV3 = {
        startedAt,
        durationMs: 0,
        keyWiped: false,
        reconciled: 0,
        missed: 0,
        fired: 0,
        needsKey: 0,
        queueProcessed: 0,
        queueTaken: 0,
        queueWaitingCapped: false,
        queuePaused: false,
        queueSkipped: null,
        catalog: null,
        enrich: null,
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

        // 3. Reconcile a brána fronty výhradne pri prvom ticku po štarte
        //    (D86, odpoveď 43). Heartbeat sa číta PRED tým, než ho tento tick
        //    prepíše na konci — inak by diera po odstávke nikdy nebola vidieť.
        if (!firstTickDone) {
          try {
            const state = await deps.schedulerState.get();
            const paused = assessDowntimeOnce(
              state.lastTickAt,
              startedAt,
              config.downtimeGraceMs,
            );
            if (paused) {
              deps.log.warn('queue_paused_after_downtime', {
                lastTickAt: state.lastTickAt?.toISOString(),
                graceMs: config.downtimeGraceMs,
              });
            }
          } catch (error) {
            // Nečitateľný heartbeat = nevieme, či bola odstávka. Fail-closed
            // smer je NEZAPISOVAŤ, takže sa brána zatvorí rovnako ako po nej.
            assessDowntimeUnknown(startedAt);
            deps.log.error('scheduler_state_read_failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          }

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

        // 5b. FRONTA (K2) — `queued` kampane dobehnú denný rozpočet.
        const queue: QueueOutcome = await processQueue(
          {
            campaigns: deps.campaigns,
            apiKey: deps.apiKey,
            settings: deps.settings,
            budget: deps.budget,
            audit: deps.audit,
            executor: deps.queueExecutor,
            log: deps.log,
            ...(deps.isStopping !== undefined ? { isStopping: deps.isStopping } : {}),
          },
          {
            writesEnabledByEnv: config.writesEnabledByEnv,
            timeZone: config.timeZone,
            maxCampaignsPerTick: config.maxQueueCampaignsPerTick,
          },
          startedAt,
        );
        result.queueProcessed = queue.processed;
        result.queueTaken = queue.queuedCampaigns;
        result.queueWaitingCapped = queue.queuedCampaignsCapped;
        result.queuePaused = queue.paused;
        result.queueSkipped = queue.skipped;
        result.needsKey += queue.needsKey;

        // 6. Reminders (D26) — len výpočet, nikam sa nič neposiela (D17).
        // POZOR: žiadny sentinel dátum do `findDue()` — MariaDB by ho skrátila
        // s warningom a `fire_at <= ?` by bolo vždy false (banner D26 by neexistoval).
        const scheduled = await deps.campaigns.findScheduled();
        const needingKey = await deps.campaigns.findNeedsKey();
        setActiveReminders(computeReminders([...scheduled, ...needingKey], clock.now()));

        // K6 — kľúč vyprší skôr, než fronta dobehne. Meta sa číta AŽ TU, teda
        // po prípadnom TTL wipe: pripomienka nesmie hovoriť o kľúči, ktorý
        // tento tick práve zmazal.
        const keyMeta = await deps.apiKey.getMeta();
        setActiveKeyExpiryReminder(
          computeKeyExpiryReminder({
            keyExpiresAt: keyMeta.present ? keyMeta.expiresAt : null,
            queuedCampaigns: queue.queuedCampaigns,
            now: clock.now(),
          }),
        );

        firstTickDone = true;
      } catch (error) {
        // Výnimka v ticku NESMIE zhodiť proces (D87) — ide do last_error.
        result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        deps.log.error('scheduler_tick_error', { error: result.error });
      } finally {
        // 7. Katalóg (K7). Je to ČÍTANIE mimo zápisového rozpočtu a beží
        //    posledné: zápisy majú prednosť pred syncom. Vlastný try/catch má
        //    preto, aby zlyhanie katalógu neprepísalo `last_error` o zľavách —
        //    runner sám síce nikdy nehádže, ale spoliehať sa na to je málo.
        if (deps.catalogSync !== null) {
          try {
            result.catalog = await deps.catalogSync({
              now: clock.now(),
              queueBusy: result.queueProcessed > 0 || result.fired > 0,
            });
          } catch (catalogError) {
            deps.log.error('catalog_sync_tick_error', {
              error: catalogError instanceof Error ? catalogError.message : String(catalogError),
            });
          }
        }

        // 7b. Obohacovanie katalógu (D118 bod 2). Posledný krok a najnižšia
        //     priorita: ustupuje zápisom aj katalógovému prechodu, a keď práve
        //     v tomto ticku katalóg naozaj čítal (`ran`), obohacovanie sa
        //     preskočí — dva čítacie behy za sebou by tick natiahli nad jeho
        //     vlastný interval. Vlastný try/catch má z toho istého dôvodu ako
        //     katalóg: zlyhanie podkladu nesmie prepísať `last_error` o zľavách.
        if (deps.enrich !== null) {
          try {
            result.enrich = await deps.enrich({
              now: clock.now(),
              queueBusy: result.queueProcessed > 0 || result.fired > 0,
              // Explicitne `!== null`, nie `?.` — Turbopack tu už raz zahodil
              // guard, ktorý vyhodnotil ako compile-time falsy.
              catalogBusy: result.catalog !== null && result.catalog.outcome === 'ran',
            });
          } catch (enrichError) {
            deps.log.error('catalog_enrich_tick_error', {
              error: enrichError instanceof Error ? enrichError.message : String(enrichError),
            });
          }
        }

        result.durationMs = Math.max(0, clock.now().getTime() - startedAt.getTime());
        // 8. Heartbeat sa zapisuje KAŽDÝ tick, aj po výnimke (D87).
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

/** Re-export, aby UI/route nemuseli poznať vnútorné členenie schedulera. */
export { isQueuePaused };
