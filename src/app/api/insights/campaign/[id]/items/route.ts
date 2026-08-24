/**
 * Aura Zľavy — `GET /api/insights/campaign/[id]/items` (graf G5, plán §4).
 *
 * Rozpad položiek kampane po stavoch. Rieši U6: dnešné počítadlá nesedia,
 * lebo `nenájdený` a `preskočený` v súhrne kolónku nemajú. Táto odpoveď vracia
 * VŠETKÝCH osem stavov vrátane núl, takže súčet vždy sedí so `spolu`.
 *
 * `total` sa počíta z tally PLUS `unrecognized` — z položiek, ktorých stav
 * appka nepozná. Do 24. 8. 2026 sa sčítavala len tally, do ktorej sa neznámy
 * stav nedostal: `total` bol nižší než skutočnosť a nikde to nebolo vidieť.
 * Také číslo je horšie než chýbajúce, lebo vyzerá ako meranie. Keď je
 * `unrecognized > 0`, obrazovka to musí priznať — počet položiek, ktorým appka
 * nerozumie, na povrch patrí, samotný kód stavu nie (K10).
 *
 * Čisto čítacie; žiadny zápis, žiadne volanie shopu.
 *
 * Vlastník: B2.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import { campaignIdParamSchema, resolveInsightsDeps, type InsightsDeps } from '../../../_shared';

export function createInsightsCampaignItemsGet(
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
        const { tally, unrecognized } = await d.insightsRepo.campaignItemTally(ctx.params.id);
        const known = Object.values(tally).reduce((sum, n) => sum + n, 0);
        return { campaignId: ctx.params.id, total: known + unrecognized, tally, unrecognized };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsCampaignItemsGet();
