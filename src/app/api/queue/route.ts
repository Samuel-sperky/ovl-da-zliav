/**
 * Aura Zľavy — `GET /api/queue` (KONTRAKT V3: K2, K5, K6).
 *
 * Jedno číslo pre hlavičku (`Zápisy X/200 dnes`, `Fronta X/Y`) a jeden blok pre
 * Prehľad (dominanta, architektúra §1 TAB 1). Čisto čítacie, na shop neodíde
 * ani jeden request.
 *
 * Čo vracia a odkiaľ to berie:
 *
 *  - **`budget`** — koľko sa dnes zapísalo z denného rozpočtu. Spotreba sa
 *    počíta VÝHRADNE z auditu (`write_attempt` za UTC deň, K2); žiadny
 *    paralelný stĺpec, ktorý by sa mohol rozísť. `null` = rozpočet sa nepodarilo
 *    prečítať — potom sa NESMIE dopočítať odhad (P7).
 *  - **`queue`** — koľko položiek čaká a koľko ich živé zľavy majú spolu.
 *    Priamo z `campaign_items` cez `queueTotals()`.
 *  - **`estimate`** — kedy fronta dobehne. Je to ODHAD (P7): plán pri
 *    `daily_write_budget`/deň, ktorý nepočíta so zlyhaniami ani s odstávkami.
 *  - **`running`** — názov zľavy, ktorá sa práve zapisuje; keď žiadna nebeží,
 *    prvá zľava čakajúca vo fronte (`queued`). Bez toho by hlavička vedela
 *    povedať „koľko", ale nie „čoho".
 *
 * **Poctivá poznámka k `gate` (pozastavená fronta).** Brána po odstávke počítača
 * je in-process stav vo `lib/scheduler/pause.ts`. Next.js kompiluje
 * `instrumentation` do vlastného module grafu, takže objekt, ktorý vidí tento
 * route handler, NEMUSÍ byť ten istý, aký vidí tick schedulera (pasca z
 * CLAUDE.md, ktorá tu už raz prežila do produkcie). Preto:
 *   - `gate` je označená ako `bestEffort` a UI ju nesmie brať ako dôkaz,
 *   - `heartbeat.stale` je oproti tomu FAKT z DB: keď posledný tick chýba dlhšie
 *     než `DOWNTIME_GRACE_MS`, fronta určite nezapisuje, lebo scheduler nežije.
 * Trvalé riešenie (stĺpec v `settings`) je požiadavka na V7 — viď výstup V8.
 *
 * Vlastník: V8.
 */
import type { SchedulerStateRepo } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  createBudget,
  estimateFinish,
  type BudgetSource,
  type BudgetStatus,
} from '@/lib/engine/budget';
import { campaignItemsRepo as defaultItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepoV3 as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { schedulerStateRepo as defaultSchedulerState } from '@/lib/repo/scheduler-state.repo';
import { DOWNTIME_GRACE_MS, getQueueGate, type QueueGate } from '@/lib/scheduler/pause';
import { lastQueueReport, type QueueOutcome } from '@/lib/scheduler/queue';

import type { CampaignsRepoExt } from '@/lib/repo/campaigns.repo';
import type { CampaignItemsRepoExt } from '@/lib/repo/campaign-items.repo';

/* ═══════════════════════════ 1. Závislosti ════════════════════════════════ */

export interface QueueRouteDeps {
  campaigns?: Pick<CampaignsRepoExt, 'findRunningUnfinished' | 'findQueued'>;
  items?: Pick<CampaignItemsRepoExt, 'queueTotals'>;
  schedulerState?: Pick<SchedulerStateRepo, 'get'>;
  budget?: BudgetSource;
  /** Best-effort brána — viď poznámku v hlavičke súboru. */
  gate?: () => QueueGate;
  /** Best-effort posledný krok fronty — rovnaká výhrada ako pri `gate`. */
  lastRun?: () => QueueOutcome | null;
  now?: () => Date;
  routeDeps?: RouteDeps;
}

/** Zľava, ktorá dáva číslam vo fronte meno (K10 — na povrchu je to „zľava"). */
export interface QueueCampaignView {
  campaignId: number;
  name: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain: number;
  itemsPending: number;
  /** K5 — okno už nabehlo a fronta ešte nedobehla. Fakt o čase, nie chyba. */
  late: boolean;
}

/* ═══════════════════════════ 2. Route ═════════════════════════════════════ */

export function createQueueRoute(deps: QueueRouteDeps = {}): NextRouteHandler {
  const campaigns = deps.campaigns ?? defaultCampaignsRepo;
  const items = deps.items ?? defaultItemsRepo;
  const schedulerState = deps.schedulerState ?? defaultSchedulerState;
  const now = deps.now ?? ((): Date => new Date());
  const budget =
    deps.budget ?? createBudget({ settingsRepo: defaultSettingsRepo, now });
  const gate = deps.gate ?? getQueueGate;
  const lastRun = deps.lastRun ?? lastQueueReport;

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async () => {
        /* 1. Rozpočet (K2). Zlyhanie nie je chyba requestu — hlavička vie
         * povedať „neviem", ale nesmie si číslo vymyslieť (P7). */
        let budgetStatus: BudgetStatus | null = null;
        try {
          budgetStatus = await budget.remainingToday();
        } catch {
          budgetStatus = null;
        }

        /* 2. Fronta z `campaign_items` — jediný zdroj pravdy o tom, koľko
         * položiek ešte čaká (K2: žiadne paralelné počítadlo). */
        const totals = await items.queueTotals();

        /* 3. Ktorá zľava dáva číslam meno: najprv tá, ktorá práve zapisuje,
         * inak prvá čakajúca vo fronte (najskorší `date_from`). */
        const running = await campaigns.findRunningUnfinished();
        const queued = running.length > 0 ? [] : await campaigns.findQueued(1);
        const head = running[0] ?? queued[0] ?? null;

        const current: QueueCampaignView | null =
          head === null
            ? null
            : {
                campaignId: head.id,
                name: head.name,
                status: head.status,
                dateFrom: head.dateFrom,
                dateTo: head.dateTo,
                itemsTotal: head.itemsTotal,
                itemsOk: head.itemsOk,
                itemsFailed: head.itemsFailed,
                itemsUncertain: head.itemsUncertain,
                itemsPending: Math.max(
                  0,
                  head.itemsTotal - head.itemsOk - head.itemsFailed - head.itemsUncertain,
                ),
                late: head.late,
              };

        /* 4. Odhad dobehnutia CELEJ fronty (K5). Bez rozpočtu žiadny odhad. */
        const estimate =
          budgetStatus === null || totals.pending === 0
            ? null
            : estimateFinish(totals.pending, budgetStatus.budget, {
                remainingToday: budgetStatus.remaining,
                now: now(),
              });

        /* 5. Heartbeat — FAKT z DB. Keď tick dlho nebežal, fronta nezapisuje
         * bez ohľadu na to, čo si o bráne myslí tento module graph. */
        let lastTickAt: Date | null = null;
        try {
          lastTickAt = (await schedulerState.get()).lastTickAt;
        } catch {
          lastTickAt = null;
        }
        const staleMs = lastTickAt === null ? null : now().getTime() - lastTickAt.getTime();

        return {
          budget: budgetStatus,
          queue: {
            pending: totals.pending,
            total: totals.total,
            /** Koľko položiek už fronta spracovala (pruh `3 420 / 8 000`). */
            done: Math.max(0, totals.total - totals.pending),
            campaigns: totals.campaigns,
          },
          current,
          estimate,
          heartbeat: {
            lastTickAt: lastTickAt === null ? null : lastTickAt.toISOString(),
            staleMs,
            /** `true` = scheduler nedáva o sebe vedieť, takže fronta stojí. */
            stale: staleMs === null || staleMs > DOWNTIME_GRACE_MS,
          },
          /** Best-effort (viď hlavička súboru) — nikdy jediný dôkaz o stave. */
          gate: { ...gate(), bestEffort: true as const },
          lastRun: lastRun(),
        };
      },
    },
    deps.routeDeps,
  );
}

export const GET = createQueueRoute();
