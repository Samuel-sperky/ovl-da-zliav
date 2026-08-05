/**
 * Aura Zľavy — `GET /api/audit` (BUILD-SPEC §5, D18, I4).
 *
 * Stránkovaný, filtrovateľný zoznam audit logu. Čisto čítacie — `audit_log`
 * je append-only a jediná cesta zápisu je `appendAudit()` (I4).
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import type { AuditFilter } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  dateOnlySchema,
  pageQuery,
  perPageQuery,
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../campaigns/_shared';

const querySchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  campaignId: z.coerce.number().int().positive().optional(),
  eventType: z.string().min(1).max(64).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  ok: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: pageQuery,
  perPage: perPageQuery,
});

export function createAuditGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      query: querySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const filter: AuditFilter = {
            page: ctx.query.page,
            perPage: ctx.query.perPage,
          };
          if (ctx.query.productId !== undefined) filter.productId = ctx.query.productId;
          if (ctx.query.campaignId !== undefined) filter.campaignId = ctx.query.campaignId;
          if (ctx.query.eventType !== undefined) filter.eventType = ctx.query.eventType;
          if (ctx.query.from !== undefined) filter.from = ctx.query.from;
          if (ctx.query.to !== undefined) filter.to = ctx.query.to;
          if (ctx.query.ok !== undefined) filter.ok = ctx.query.ok;

          return d.auditRepo.list(filter);
        }),
    },
    routeDeps,
  );
}

export const GET = createAuditGet();
