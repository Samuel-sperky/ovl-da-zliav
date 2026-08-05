/**
 * Aura Zľavy — `GET /api/insights/campaign/[id]/items` (graf G5, plán §4).
 *
 * Rozpad položiek kampane po stavoch. Rieši U6: dnešné počítadlá nesedia,
 * lebo `nenájdený` a `preskočený` v súhrne kolónku nemajú. Táto odpoveď vracia
 * VŠETKÝCH osem stavov vrátane núl, takže súčet vždy sedí so `spolu`.
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
        const tally = await d.insightsRepo.campaignItemTally(ctx.params.id);
        const total = Object.values(tally).reduce((sum, n) => sum + n, 0);
        return { campaignId: ctx.params.id, total, tally };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsCampaignItemsGet();
