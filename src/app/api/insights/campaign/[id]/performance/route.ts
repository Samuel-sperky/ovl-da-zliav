/**
 * Aura Zľavy — `GET /api/insights/campaign/[id]/performance`
 * (architektúra §1 TAB 3 sekcia „Výkon", odpoveď 86).
 *
 * Porovnanie predaja produktov zľavy: okno rovnako dlhé ako okno platnosti,
 * zakončené dnešným dňom, proti rovnako dlhému oknu tesne pred ním.
 *
 * ČO TU NIE JE A PREČO — čítaj, kým sa to niekto nepokúsi „doplniť":
 *
 *  1. **Žiadne eurá.** `product_sales_daily` drží VÝHRADNE počty kusov; cenu,
 *     za ktorú sa produkt naozaj predal, appka nikdy nevidela. Násobiť kusy
 *     dnešnou cenníkovou cenou by vyrobilo číslo, ktoré vyzerá ako tržba, ale
 *     nie je ňou — a K8 predstieranie dát zakazuje. Mockup `zlava-detail.html`
 *     eurá ukazuje; mockup sa mýli, nie tento súbor.
 *  2. **Žiadne „vlani".** Synchronizácia predajov si okno dopĺňa postupne
 *     a rok dozadu nesiaha. Namiesto vymysleného porovnania vracia route
 *     pokrytie a UI ten panel viditeľne ZAMKNE.
 *  3. **Žiadny záver o príčine.** Vracajú sa dve čísla vedľa seba, nikdy veta
 *     „zľava priniesla +18 %" (P8) — appka nevie oddeliť vplyv zľavy od
 *     sezóny a tváriť sa, že vie, by bolo klamstvo s číslom v ruke.
 *
 * Čisto čítacie: žiadny zápis, žiadne volanie shopu.
 *
 * Vlastník: V11 (doplnené po prestavbe).
 */
import { env } from '@/env';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { addDays, diffDays } from '@/lib/domain/dates';
import { campaignUnits, summarizeCoverage, syncDays } from '@/lib/sales/insights';

import { campaignIdParamSchema, resolveInsightsDeps, todayOf, type InsightsDeps } from '../../../_shared';

/** Najdlhšie porovnávané okno — zľava smie trvať najviac 3 mesiace (I7). */
const MAX_WINDOW_DAYS = 100;

export function createInsightsCampaignPerformanceGet(
  overrides: InsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      params: campaignIdParamSchema,
      handler: async (ctx) => {
        // LAZY env — eager čítanie na module scope by spustilo validáciu ENV
        // už počas `next build` (rovnaký dôvod ako v `_shared.ts`).
        const coverage = summarizeCoverage(await syncDays(), {
          syncEnabled: env.SALES_SYNC_ENABLED,
          windowDays: env.SALES_WINDOW_DAYS,
        });
        const campaign = await d.campaignsRepo.getById(ctx.params.id);

        if (campaign === null) {
          return { campaignId: ctx.params.id, available: false, reason: 'unknown_campaign' };
        }

        // Dĺžka okna zľavy; `diffDays` je inkluzívny, preto +1 nie je potrebné.
        const span = Math.min(
          MAX_WINDOW_DAYS,
          Math.max(1, diffDays(campaign.dateFrom, campaign.dateTo) + 1),
        );

        const today = todayOf(d);
        const recentFrom = addDays(today, -(span - 1));
        const priorTo = addDays(recentFrom, -1);
        const priorFrom = addDays(priorTo, -(span - 1));

        /*
         * Pokrytie rozhoduje, či sa číslo vôbec smie ukázať. Bez tejto kontroly
         * by okno, ktoré synchronizácia ešte nestihla, vyzeralo ako „predalo sa
         * nula kusov" — a nula je tvrdenie, nie „neviem".
         */
        const covers = (from: string): boolean =>
          coverage.from !== null && coverage.to !== null && from >= coverage.from;

        const recent = covers(recentFrom)
          ? await campaignUnits(ctx.params.id, recentFrom, today)
          : null;
        const prior = covers(priorFrom) ? await campaignUnits(ctx.params.id, priorFrom, priorTo) : null;

        return {
          campaignId: ctx.params.id,
          available: recent !== null,
          unit: 'ks' as const,
          spanDays: span,
          recent: { from: recentFrom, to: today, units: recent },
          prior: { from: priorFrom, to: priorTo, units: prior },
          coverage: { from: coverage.from, to: coverage.to, syncEnabled: coverage.syncEnabled },
          /** Panely, ktoré appka dnes naplniť nevie (K8) — UI ich zamkne. */
          locked: {
            revenue: 'Tržby v eurách shop cez API nevracia — appka pozná len počty kusov.',
            lastYear: 'Predaje sa dopĺňajú postupne a rok dozadu zatiaľ nesiahajú.',
          },
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsCampaignPerformanceGet();
