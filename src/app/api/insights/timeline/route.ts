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
 * `?window=7|30|90` (V4, 28. 8. 2026): os sa zúži presne na okno prepínača
 * Prehľadu, aby sa okná zliav dali podfarbiť POD krivku predaja. Bez parametra
 * zostáva pôvodná 3-mesačná os stránky Zľavy — nezmenená, vrátane tvaru
 * odpovede. `windowDays` hovorí, ktorá z tých dvoch osí prišla: bez neho by
 * volajúci nevedel, či `from`/`to` môže priložiť ku krivke.
 *
 * Kampaň, ktorá do okna len ZASAHUJE, v odpovedi JE (dotaz je `date_from <= to
 * AND date_to >= from`) — orezanie na hranu osi je práca grafu. Keby ju route
 * zahodila, zľava bežiaca od minulého mesiaca by pod krivkou zmizla.
 *
 * Vlastník: B2; okno vlna V4-ENDPOINTY.
 */
import { z } from 'zod';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  anchorQuery,
  resolveInsightsDeps,
  timelineRange,
  todayOf,
  windowQuery,
  windowRange,
  type InsightsDeps,
} from '../_shared';

const querySchema = z.object({ anchor: anchorQuery, window: windowQuery });

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
        const windowDays = ctx.query.window ?? null;
        const range =
          windowDays === null ? timelineRange(today) : windowRange(today, windowDays);
        const campaigns = await d.insightsRepo.campaignWindows(range.from, range.to);
        return { today, from: range.from, to: range.to, windowDays, campaigns };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsTimelineGet();
