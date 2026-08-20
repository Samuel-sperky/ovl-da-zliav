/**
 * Aura Zľavy — `POST /api/campaigns/[id]/retry-failed` (BUILD-SPEC §5, D15, D16, D36).
 *
 * „Zopakovať zlyhané": `partial`/`failed` kampaň sa NIKDY neopravuje na mieste
 * — vytvorí sa NOVÁ kampaň `kind='retry'` s `parent_campaign_id` a s presne
 * tou sadou produktov, ktoré neskončili `ok`/`skipped` (D15). Vyžaduje NOVÝ
 * dry-run a jednorazový `previewToken` nad touto zúženou sadou (D16, I3).
 * Idempotenciu identických zápisov rieši executor (D36 skip).
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import { maxDateOnly } from '@/lib/domain/dates';
import { conflict } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  assertStatusIn,
  idParamSchema,
  loadCampaignOr404,
  makeExecutor,
  resolveRoutesDeps,
  todayOf,
  verifyPreviewTokenFor,
  insertConfirmedCampaign,
  withRouteErrors,
  type RoutesDeps,
} from '../../_shared';

const bodySchema = z.object({
  previewToken: z.string().min(1),
});

export function createRetryFailedPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'sudo',
      body: bodySchema,
      params: idParamSchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const parent = await loadCampaignOr404(d, ctx.params.id);
          assertStatusIn(parent, ['partial', 'failed'], 'retry-failed');

          const today = todayOf(d);
          if (parent.dateTo < today) {
            throw conflict(
              'Okno pôvodnej kampane už uplynulo — zlyhané produkty sa nedajú dopísať (D25, I7).',
              'window_lapsed',
              { logAsError: false },
            );
          }

          /* Sada retry = položky, ktoré nemajú potvrdený úspech (D15). */
          const items = await d.campaignItemsRepo.listByCampaign(parent.id);
          const failedIds = items
            .filter((i) => i.status !== 'ok' && i.status !== 'skipped')
            .map((i) => i.productId)
            .sort((a, b) => a - b);
          if (failedIds.length === 0) {
            throw conflict(
              'Kampaň nemá žiadnu zlyhanú položku — niet čo zopakovať.',
              'nothing_to_retry',
              { logAsError: false },
            );
          }

          /* NOVÝ token nad zúženou sadou; `from` v minulosti = dnešok (D25). */
          const effectiveFrom = maxDateOnly(parent.dateFrom, today);
          const claims = await verifyPreviewTokenFor(
            d,
            ctx.body.previewToken,
            {
              kind: 'retry',
              productIds: failedIds,
              percent: parent.percent,
              from: effectiveFrom,
              to: parent.dateTo,
            },
            ctx.claims.sub,
          );

          const record = await insertConfirmedCampaign(d, {
            claims,
            name: `${parent.name} — oprava`,
            kind: 'retry',
            mode: 'eager',
            status: 'draft',
            fireAt: null,
            parentCampaignId: parent.id,
            createdBy: ctx.claims.sub,
          });

          await makeExecutor(d).executeCampaign(record.id, {
            actor: 'user',
            userId: ctx.claims.sub,
          });
          return { campaignId: record.id };
        }),
    },
    routeDeps,
  );
}

export const POST = createRetryFailedPost();
