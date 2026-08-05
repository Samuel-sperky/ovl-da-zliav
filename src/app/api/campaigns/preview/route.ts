/**
 * Aura Zľavy — `POST /api/campaigns/preview` (BUILD-SPEC §5, D3, D4, D60, I3).
 *
 * Dry-run: zostaví diff sadu cez `engine/preview` (A9) a pri čistej sade vydá
 * jednorazový `previewToken` (O2). NIKDY nič nezapisuje — všetky volania shopu
 * sú čítacie. Bez tokenu z tejto route neexistuje cesta k zápisu (I3).
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import { buildPreview } from '@/lib/engine/preview';
import { CAMPAIGN_KINDS } from '@/lib/domain/status';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { newOperationContext } from '@/lib/shop/correlation';

import {
  dateOnlySchema,
  previewResultResponse,
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../_shared';

const bodySchema = z.object({
  productIds: z.array(z.number().int().positive()).min(1).max(10),
  percent: z.number().int().min(1).max(30),
  from: dateOnlySchema,
  to: dateOnlySchema,
  kind: z.enum(CAMPAIGN_KINDS),
  parentCampaignId: z.number().int().positive().optional(),
  /** D30 — potvrdenie „naozaj 1 deň?". Bez neho je `from = to` blokátor. */
  oneDayAcknowledged: z.boolean().optional(),
});

export function createPreviewPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      body: bodySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const result = await buildPreview(
            {
              userId: ctx.claims.sub,
              kind: ctx.body.kind,
              productIds: ctx.body.productIds,
              percent: ctx.body.percent,
              from: ctx.body.from,
              to: ctx.body.to,
              ...(ctx.body.oneDayAcknowledged !== undefined
                ? { oneDayAcknowledged: ctx.body.oneDayAcknowledged }
                : {}),
              // D15/D16 — rodič opakovania sa z kontroly prekryvu vylučuje.
              ...(ctx.body.parentCampaignId !== undefined
                ? { parentCampaignId: ctx.body.parentCampaignId }
                : {}),
            },
            {
              shopClient: d.shopClient,
              allowlistRepo: d.allowlistRepo,
              campaignsRepo: d.campaignsRepo,
              catalogRepo: d.catalogRepo,
              apiKeyMeta: d.apiKeyRepo,
              previewTokens: d.previewTokens,
              now: d.now,
              timeZone: d.timeZone,
            },
            newOperationContext(),
          );
          // Redaktor by `previewToken` v tele zamaskoval — vlastná Response (O2).
          return previewResultResponse(result);
        }),
    },
    routeDeps,
  );
}

export const POST = createPreviewPost();
