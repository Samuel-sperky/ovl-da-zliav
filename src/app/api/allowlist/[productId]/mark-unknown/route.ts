/**
 * Aura Zľavy — `POST /api/allowlist/[productId]/mark-unknown` (BUILD-SPEC §5, D38).
 *
 * Ručné priznanie „stav v shope nepoznáme": nastaví `shop_status='unknown'`.
 * Nič netvrdí o skutočnom stave zľavy (I11) a na shop sa nesiaha.
 *
 * Prepočet poradia obohacovania (D118) sa volá aj tu, hoci `shop_status`
 * dnešnú prioritu NEMENÍ (`SQL_ENRICH_PRIORITY_ALLOWLIST` sa pozerá výhradne
 * na `removed_at IS NULL`) — je to teda dnes prakticky prázdny prepočet. Drží sa
 * tu preto, že pravidlo „každá mutácia povoleného zoznamu končí prepočtom" má
 * strážcu v teste; keby sa výnimka pre túto jednu cestu napísala, nestrážil by
 * ju nikto a prvá zmena kritérií priority by ju ticho minula.
 *
 * Vlastník: A12.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  productIdParamSchema,
  refreshEnrichPriorityQuietly,
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
      // 30/min; vlastný `bucket` z rovnakého dôvodu ako pri odobraní —
      // cesta nesie `productId`, takže per-cestový kľúč by sa dal obísť.
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'allowlist-mark-unknown' },
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
          // D118 — až po zápise a audite, a ticho (viď helper aj docblock).
          await refreshEnrichPriorityQuietly(d, ctx.log);
          return { shopStatus: 'unknown' as const };
        }),
    },
    routeDeps,
  );
}

export const POST = createMarkUnknownPost();
