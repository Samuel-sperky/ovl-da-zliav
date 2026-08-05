/**
 * Aura Zľavy — `GET /api/audit/[id]` (BUILD-SPEC §5, D18, D39c).
 *
 * Plný audit záznam vrátane `before_snapshot`/`after_snapshot` (obe strany už
 * prešli redakciou pri zápise aj pri serializácii odpovede, I1) + derivovaný
 * príznak `priceMismatch` — „rozhodoval si nad inou cenou" (D39c).
 *
 * Vlastník: A12.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { notFound } from '@/lib/http/errors';

import {
  idParamSchema,
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../campaigns/_shared';

/** D39c — `price_mismatch` sa hľadá v oboch snapshotoch, fail-open na `false`. */
export function snapshotPriceMismatch(snapshot: unknown): boolean {
  if (typeof snapshot !== 'object' || snapshot === null) return false;
  const rec = snapshot as Record<string, unknown>;
  return rec.price_mismatch === true || rec.priceMismatch === true;
}

export function createAuditDetailGet(
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
          const record = await d.auditRepo.getById(ctx.params.id);
          if (record === null) {
            throw notFound(`Audit záznam ${ctx.params.id} neexistuje.`);
          }
          return {
            ...record,
            priceMismatch:
              snapshotPriceMismatch(record.beforeSnapshot) ||
              snapshotPriceMismatch(record.afterSnapshot),
          };
        }),
    },
    routeDeps,
  );
}

export const GET = createAuditDetailGet();
