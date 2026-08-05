/**
 * Aura Zľavy — `/api/campaigns` (BUILD-SPEC §5).
 *
 *  - `GET`  (session): stránkovaný zoznam kampaní + DERIVOVANÉ UI stavy
 *    „aktívna"/„expirovaná" (O1, D14) — derivát sa nikdy neukladá do DB.
 *  - `POST` (sudo): potvrdenie dry-runu → vytvorenie kampane (I3, D2, D22).
 *    Bez platného jednorazového `previewToken` so zhodným hashom parametrov
 *    sa NEODOŠLE ani jeden request na shop — token sa overuje PRED akýmkoľvek
 *    dotykom shopu aj pred vložením kampane. `mode='eager'` spustí zápis hneď
 *    (cez `engine/executor`, jedinú zápisovú cestu), `mode='scheduled'` len
 *    naplánuje `fire_at` (D32).
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import type { CampaignStatus } from '@/contracts';

import { fireAtUtc } from '@/lib/domain/dates';
import { CAMPAIGN_KINDS, CAMPAIGN_MODES } from '@/lib/domain/status';
import { badRequest } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  campaignStatusSchema,
  campaignView,
  insertConfirmedCampaign,
  makeExecutor,
  pageQuery,
  peekPreviewToken,
  perPageQuery,
  resolveRoutesDeps,
  todayOf,
  verifyPreviewTokenFor,
  withRouteErrors,
  type RoutesDeps,
} from './_shared';

/* ═══════════════════════════════ GET ══════════════════════════════════════ */

const listQuerySchema = z.object({
  status: z
    .union([campaignStatusSchema, z.array(campaignStatusSchema)])
    .optional(),
  page: pageQuery,
  perPage: perPageQuery,
});

export function createCampaignsGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      query: listQuerySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const filter: {
            status?: CampaignStatus | CampaignStatus[];
            page: number;
            perPage: number;
          } = { page: ctx.query.page, perPage: ctx.query.perPage };
          if (ctx.query.status !== undefined) filter.status = ctx.query.status;

          const paged = await d.campaignsRepo.list(filter);
          const today = todayOf(d);
          return {
            data: paged.data.map((c) => campaignView(c, today)),
            page: paged.page,
            perPage: paged.perPage,
            total: paged.total,
          };
        }),
    },
    routeDeps,
  );
}

/* ═══════════════════════════════ POST ═════════════════════════════════════ */

const createBodySchema = z.object({
  previewToken: z.string().min(1),
  name: z.string().min(1).max(200),
  mode: z.enum(CAMPAIGN_MODES),
  acknowledgements: z.object({
    /** Veta o nevratnosti — bez nej sa kampaň nevytvorí (D2). */
    irreversible: z.literal(true),
    /** Povinné pri jednodňovej zľave `from = to` (D30). */
    oneDay: z.literal(true).optional(),
  }),
});

export function createCampaignsPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'sudo',
      body: createBodySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          /* 1. Nahliadnutie do tokenu (neoverené) — len na zostavenie
           *    `expected` sady a kontrolu D30. Pravda je až `verify()`. */
          const peeked = peekPreviewToken(ctx.body.previewToken);
          if (
            peeked === null ||
            !Array.isArray(peeked.productIds) ||
            typeof peeked.percent !== 'number' ||
            typeof peeked.from !== 'string' ||
            typeof peeked.to !== 'string' ||
            !(CAMPAIGN_KINDS as readonly string[]).includes(peeked.kind as string)
          ) {
            throw badRequest(
              'Preview token je neplatný alebo pozmenený — zápis sa odmieta (I3).',
              'preview_token_invalid',
            );
          }

          // D30 — jednodňová zľava vyžaduje explicitné potvrdenie. Kontrola je
          // PRED verify(), aby chýbajúce potvrdenie nespálilo jednorazový token.
          if (peeked.from === peeked.to && ctx.body.acknowledgements.oneDay !== true) {
            throw badRequest(
              'Zľava platí len jediný deň — potvrď „naozaj 1 deň?" (D30).',
              'one_day_not_acknowledged',
            );
          }

          /* 2. I3 — podpis, TTL, payloadHash, jednorazovosť, vlastník. */
          const claims = await verifyPreviewTokenFor(
            d,
            ctx.body.previewToken,
            {
              kind: peeked.kind as (typeof CAMPAIGN_KINDS)[number],
              productIds: peeked.productIds,
              percent: peeked.percent,
              from: peeked.from,
              to: peeked.to,
            },
            ctx.claims.sub,
          );

          /* 3. Vloženie kampane s doloženým potvrdením (I3, I10, D39c). */
          const eager = ctx.body.mode === 'eager';
          const record = await insertConfirmedCampaign(d, {
            claims,
            name: ctx.body.name,
            kind: claims.kind,
            mode: ctx.body.mode,
            // `draft` pre eager: executor si kampaň claimne sám (D84);
            // `scheduled` čaká na tick (D32).
            status: eager ? 'draft' : 'scheduled',
            fireAt: eager ? null : fireAtUtc(claims.from, d.fireTime, d.timeZone),
            createdBy: ctx.claims.sub,
          });

          /* 4. `eager` = zápis okamžite — VÝHRADNE cez executor (D22, §9). */
          if (eager) {
            const result = await makeExecutor(d).executeCampaign(record.id, {
              actor: 'user',
              userId: ctx.claims.sub,
            });
            return { campaignId: record.id, status: result.status };
          }
          return { campaignId: record.id, status: 'scheduled' as const };
        }),
    },
    routeDeps,
  );
}

export const GET = createCampaignsGet();
export const POST = createCampaignsPost();
