/**
 * Aura Zľavy — `GET /api/notifications` (BUILD-SPEC §5, D17, O6).
 *
 * Notifikačný panel bez SMTP: dobehnuté/zmeškané kampane bez `result_ack_at`.
 * Odkliknutie robí `POST /api/campaigns/[id]/ack`.
 *
 * Vlastník: A12.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../campaigns/_shared';

export function createNotificationsGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: (ctx) =>
        withRouteErrors(async () => {
          void ctx;
          const unacked = await d.campaignsRepo.findUnacked();
          return {
            unacked: unacked.map((c) => ({
              campaignId: c.id,
              name: c.name,
              status: c.status,
              finishedAt: c.finishedAt === null ? null : c.finishedAt.toISOString(),
            })),
          };
        }),
    },
    routeDeps,
  );
}

export const GET = createNotificationsGet();
