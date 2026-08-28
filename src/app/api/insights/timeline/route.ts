/**
 * Aura Zľavy — `GET /api/insights/timeline` (graf G1, plán §4).
 *
 * Okná kampaní na 3-mesačnej osi. Čisto čítacie: `SELECT` nad `campaigns`
 * a `campaign_items`, žiadny zápis, žiadne volanie shopu, žiadny kľúč (I1, I3).
 *
 * Odpoveď nesie aj `productIds`, aby UI vedelo odlíšiť „prekrývajú sa v čase"
 * od „prekrývajú sa na tom istom produkte" — druhé je blokujúce (D28) a graf
 * ho označí prstencom.
 *
 * Vlastník: B2.
 */
import { z } from 'zod';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  anchorQuery,
  resolveInsightsDeps,
  timelineRange,
  todayOf,
  type InsightsDeps,
} from '../_shared';

const querySchema = z.object({ anchor: anchorQuery });

export function createInsightsTimelineGet(
  overrides: InsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      query: querySchema,
      handler: async (ctx) => {
        const today = ctx.query.anchor ?? todayOf(d);
        const range = timelineRange(today);
        const campaigns = await d.insightsRepo.campaignWindows(range.from, range.to);
        return { today, from: range.from, to: range.to, campaigns };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsTimelineGet();
