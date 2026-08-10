/**
 * Aura Zľavy — `POST /api/campaigns/[id]/cancel` (BUILD-SPEC §5, §4; K2).
 *
 * Zrušenie zľavy — LEN zo stavov `draft`/`scheduled`/`needs_key`/`missed`
 * (stavový stroj A7) a `queued` (K2). Zrušenie NIKDY nesiaha na shop: už
 * zapísaná zľava sa zrušiť nedá (I7) a `cancel` je čisto lokálna zmena stavu
 * + audit. Položky, ktoré fronta stihla zapísať, v shope zostávajú a dobehnú
 * prirodzene — appka to nesmie predstierať inak (I7, D35).
 *
 * `queued` v stavovom stroji A7 (`src/lib/domain/status.ts`) zatiaľ nie je,
 * takže `assertTransition()` by ho odmietol ako neznámy stav. Kým sa doplní
 * (požiadavka vo výstupe V8), rieši ho táto route sama — v tom istom smere,
 * v akom by ho riešil stavový stroj: fronta je čakajúca kampaň, teda
 * zrušiteľná ako `scheduled`.
 *
 * Vlastník: V8.
 */
import { z } from 'zod';

import { assertTransition } from '@/lib/domain/status';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  idParamSchema,
  isQueuedStatus,
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
          // `queued` (K2) je zrušiteľný rovnako ako `scheduled`; ostatné stavy
          // rozhoduje stavový stroj, nie táto route.
          if (!isQueuedStatus(campaign.status)) {
            assertTransition(campaign.status, 'cancelled', { trigger: 'cancel' });
          }

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
