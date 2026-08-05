/**
 * Aura Zľavy — `GET /api/campaigns/[id]` (BUILD-SPEC §5).
 *
 * Detail kampane: záznam + položky + audit stopa (D18). Čisto čítacie.
 *
 * Vlastník: A12.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  campaignView,
  idParamSchema,
  loadCampaignOr404,
  resolveRoutesDeps,
  todayOf,
  withRouteErrors,
  type RoutesDeps,
} from '../_shared';

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
      handler: (ctx) =>
        withRouteErrors(async () => {
          const record = await loadCampaignOr404(d, ctx.params.id);
          const items = await d.campaignItemsRepo.listByCampaign(record.id);
          const audit = await d.auditRepo.list({ campaignId: record.id, perPage: 100 });
          return {
            campaign: campaignView(record, todayOf(d)),
            items,
            auditTrail: audit.data,
          };
        }),
    },
    routeDeps,
  );
}

export const GET = createCampaignGet();
