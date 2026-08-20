/**
 * Aura Zľavy — `GET /api/insights/product/[productId]` (graf G3, plán §4).
 *
 * História VLASTNÝCH zápisov appky na jeden produkt: kedy sa zapisovalo,
 * s akým percentom a s akým výsledkom. Odpovedá na „prečo je tento produkt
 * v akcii", čo dnes vyžaduje ručné filtrovanie auditu.
 *
 * I11: toto NIE JE história zliav v shope — je to história toho, čo appka
 * sama urobila. Komponent grafu to musí takto aj pomenovať.
 *
 * Čisto čítacie; žiadny zápis, žiadne volanie shopu.
 *
 * Vlastník: B2.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  productIdParamSchema,
  resolveInsightsDeps,
  todayOf,
  type InsightsDeps,
} from '../../_shared';

export function createInsightsProductGet(
  overrides: InsightsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      params: productIdParamSchema,
      handler: async (ctx) => {
        const writes = await d.insightsRepo.productWrites(ctx.params.productId);
        return { productId: ctx.params.productId, today: todayOf(d), writes };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsProductGet();
