/**
 * Aura Zľavy — `GET /api/insights/discount-depth` (graf G2, plán §4).
 *
 * Hĺbka zľavy na aktívnom allowliste: pre každý produkt POSLEDNÝ VLASTNÝ ZÁPIS
 * appky (I11 — nikdy „stav zľavy v shope"). Produkt bez zápisu má `null`
 * a v grafe prázdnu dráhu; appka o ňom netvrdí nič.
 *
 * Čisto čítacie, žiadne volanie shopu. Strop 10 produktov (I2) tu netreba
 * vynucovať — allowlist ho drží na úrovni DB a route nič nezapisuje.
 *
 * Vlastník: B2.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import { resolveInsightsDeps, todayOf, type InsightsDeps } from '../_shared';

export function createInsightsDiscountDepthGet(
  overrides: InsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async () => {
        const products = await d.insightsRepo.discountDepth();
        return { today: todayOf(d), products };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsDiscountDepthGet();
