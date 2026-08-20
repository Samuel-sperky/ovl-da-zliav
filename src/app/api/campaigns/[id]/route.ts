/**
 * Aura Zľavy — `GET /api/campaigns/[id]` (BUILD-SPEC §5; KONTRAKT V3: K3, K5).
 *
 * Detail zľavy: záznam + pásma (K3) + odhad dobehnutia (K5) + položky + audit
 * stopa (D18). Čisto čítacie.
 *
 * Položky sa vracajú STRÁNKOVANE. Detail zľavy podľa architektúry §1 ukazuje
 * „len súhrn + zlyhané a podozrivé" (odpoveď 56), nie 8 000 riadkov — a 8 000
 * riadkov v jednej JSON odpovedi by aj tak nikto neprečítal.
 *
 * Vlastník: V8.
 */
import { z } from 'zod';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  campaignView,
  estimateFinishFor,
  idParamSchema,
  loadCampaignOr404,
  resolveRoutesDeps,
  tierView,
  todayOf,
  withRouteErrors,
  type RoutesDeps,
} from '../_shared';

const detailQuerySchema = z.object({
  /** Koľko položiek vrátiť. Default 100 — detail nie je export katalógu. */
  itemsLimit: z.coerce.number().int().min(0).max(1000).default(100),
  itemsOffset: z.coerce.number().int().min(0).default(0),
});

export function createCampaignGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      params: idParamSchema,
      query: detailQuerySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const record = await loadCampaignOr404(d, ctx.params.id);
          const view = campaignView(record, todayOf(d));
          const tiers = await d.tiersRepo.listByCampaign(record.id);
          const allItems = await d.campaignItemsRepo.listByCampaign(record.id);
          const audit = await d.auditRepo.list({ campaignId: record.id, perPage: 100 });

          const items = allItems.slice(
            ctx.query.itemsOffset,
            ctx.query.itemsOffset + ctx.query.itemsLimit,
          );

          return {
            campaign: view,
            tiers: tiers.map(tierView),
            estimate: await estimateFinishFor(d, view.itemsPending),
            items,
            itemsTotal: allItems.length,
            itemsOffset: ctx.query.itemsOffset,
            auditTrail: audit.data,
          };
        }),
    },
    routeDeps,
  );
}

export const GET = createCampaignGet();
