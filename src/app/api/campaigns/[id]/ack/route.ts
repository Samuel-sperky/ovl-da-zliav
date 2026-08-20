/**
 * Aura Zľavy — `POST /api/campaigns/[id]/ack` (BUILD-SPEC §5, D17, O6).
 *
 * Odkliknutie výsledku kampane v notifikačnom paneli. Bez SMTP — notifikácie
 * žijú výhradne v UI a `ack` ich odstráni z panelu (`result_ack_at`).
 *
 * Vlastník: A12.
 */
import { needsAcknowledgement } from '@/lib/domain/status';
import { conflict } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  idParamSchema,
  loadCampaignOr404,
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../_shared';

export function createAckPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      params: idParamSchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const campaign = await loadCampaignOr404(d, ctx.params.id);
          if (!needsAcknowledgement(campaign.status, campaign.resultAckAt)) {
            throw conflict(
              `Kampaň v stave „${campaign.status}" nemá nepotvrdený výsledok na odkliknutie (D17).`,
              'nothing_to_ack',
              { logAsError: false },
            );
          }
          await d.campaignsRepo.ack(campaign.id);
          return { acked: true as const };
        }),
    },
    routeDeps,
  );
}

export const POST = createAckPost();
