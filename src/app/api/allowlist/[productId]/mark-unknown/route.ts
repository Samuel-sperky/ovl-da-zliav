/**
 * Aura Zľavy — `POST /api/allowlist/[productId]/mark-unknown` (BUILD-SPEC §5, D38).
 *
 * Ručné priznanie „stav v shope nepoznáme": nastaví `shop_status='unknown'`.
 * Nič netvrdí o skutočnom stave zľavy (I11) a na shop sa nesiaha.
 *
 * Vlastník: A12.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  productIdParamSchema,
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../../campaigns/_shared';

export function createMarkUnknownPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      params: productIdParamSchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          await d.allowlistRepo.markShopStatus(
            ctx.params.productId,
            'unknown',
            'Označené ručne používateľom (D38).',
          );
          await d.audit.appendAudit({
            actor: 'user',
            eventType: 'allowlist_marked_unknown',
            ok: true,
            userId: ctx.actor.id,
            productId: ctx.params.productId,
            message: `Stav produktu ${ctx.params.productId} označený ako neznámy (D38).`,
          });
          return { shopStatus: 'unknown' as const };
        }),
    },
    routeDeps,
  );
}

export const POST = createMarkUnknownPost();
