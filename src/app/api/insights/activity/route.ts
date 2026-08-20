/**
 * Aura Zľavy — `GET /api/insights/activity` (graf G4, plán §4).
 *
 * Denné počítadlá výsledkov zápisu z `audit_log` (append-only, I4 — tu sa len
 * číta). Dni sa bucketujú v logickom pásme, nie v UTC: plánovaný zápis beží
 * o 00:05 bratislavského času, čo je v UTC ešte predchádzajúci deň.
 *
 * Graf kreslí DVE série (zapísané / zlyhané) na JEDNEJ osi — druhá y-škála je
 * zakázaná (plán §4). `uncertain` a `skipped` sa vracajú tiež, ale patria do
 * tabuľkovej alternatívy pod grafom, nie do tretej série.
 *
 * Vlastník: B2.
 */
import { z } from 'zod';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  activityRange,
  anchorQuery,
  resolveInsightsDeps,
  todayOf,
  type InsightsDeps,
} from '../_shared';

const querySchema = z.object({
  anchor: anchorQuery,
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export function createInsightsActivityGet(
  overrides: InsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      query: querySchema,
      handler: async (ctx) => {
        const today = ctx.query.anchor ?? todayOf(d);
        const range = activityRange(today, ctx.query.days);
        const activity = await d.insightsRepo.writeActivity(range.from, range.to);
        return { today, ...activity };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsActivityGet();
