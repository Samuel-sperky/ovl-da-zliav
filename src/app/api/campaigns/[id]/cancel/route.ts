/**
 * Aura Zľavy — `POST /api/campaigns/[id]/cancel` (BUILD-SPEC §5, §4).
 *
 * Zrušenie kampane — LEN zo stavov `draft`/`scheduled`/`needs_key`/`missed`
 * (stavový stroj A7). Zrušenie NIKDY nesiaha na shop: už zapísaná zľava sa
 * zrušiť nedá (I7) a `cancel` je čisto lokálna zmena stavu + audit.
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import { assertTransition } from '@/lib/domain/status';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  idParamSchema,
  loadCampaignOr404,
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../_shared';

const bodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export function createCancelPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      body: bodySchema,
      params: idParamSchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const campaign = await loadCampaignOr404(d, ctx.params.id);

          // §4 — nepovolený prechod letí ako `invalid_transition` (409).
          assertTransition(campaign.status, 'cancelled', { trigger: 'cancel' });

          const reason = ctx.body.reason ?? 'Zrušené používateľom.';
          await d.campaignsRepo.setStatus(campaign.id, 'cancelled', {
            statusReason: reason,
          });
          await d.audit.appendAudit({
            actor: 'user',
            eventType: 'campaign_cancelled',
            ok: true,
            userId: ctx.claims.sub,
            campaignId: campaign.id,
            operationId: campaign.operationId,
            message: reason,
          });
          return { status: 'cancelled' as const };
        }),
    },
    routeDeps,
  );
}

export const POST = createCancelPost();
