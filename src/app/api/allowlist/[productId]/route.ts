/**
 * Aura Zľavy — `DELETE /api/allowlist/[productId]` (BUILD-SPEC §5, D40, I2).
 *
 * Odobranie produktu z allowlistu je BLOKOVANÉ, kým na produkte existuje
 * kampaň v stave `scheduled`/`needs_key`/`missed` (alebo práve `running`) —
 * 409 `campaign_planned` (D40). Fail-closed: pri pochybnosti sa neodoberá.
 *
 * Po úspešnom odobraní sa TICHO prepočíta poradie obohacovania (D118) — inak by
 * front navždy vozil dopredu produkt, ktorý už v povolenom zozname nie je.
 *
 * Vlastník: A12.
 */
import type { CampaignStatus } from '@/contracts';

import { conflict, notFound } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  productIdParamSchema,
  refreshEnrichPriorityQuietly,
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../campaigns/_shared';

/** Stavy, ktoré odobranie blokujú (D40 + bežiaca dávka). */
const BLOCKING_STATUSES: readonly CampaignStatus[] = [
  'scheduled',
  'needs_key',
  'missed',
  'running',
];

export function createAllowlistDelete(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'DELETE',
      params: productIdParamSchema,
      // 30/min ako pri porovnateľných lokálnych mutáciách (settings/*).
      // `bucket` je POVINNÝ: predvolený kľúč je cesta, a tá tu obsahuje
      // `productId`, takže strop by platil per produkt a stačilo by meniť ID.
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'allowlist-remove' },
      handler: (ctx) =>
        withRouteErrors(async () => {
          const planned = await d.campaignsRepo.findPlannedForProduct(ctx.params.productId);
          const blocking = planned.filter((c) => BLOCKING_STATUSES.includes(c.status));
          if (blocking.length > 0) {
            throw conflict(
              'Produkt má naplánovanú alebo čakajúcu kampaň — najprv ju zruš, potom sa dá produkt odobrať (D40).',
              'campaign_planned',
              {
                detail: {
                  campaigns: blocking.map((c) => ({ campaignId: c.id, status: c.status })),
                },
                logAsError: false,
              },
            );
          }

          const removed = await d.allowlistRepo.removeProduct(ctx.params.productId);
          if (!removed) {
            throw notFound(`Produkt ${ctx.params.productId} nie je v aktívnom allowliste.`);
          }
          await d.audit.appendAudit({
            actor: 'user',
            eventType: 'allowlist_removed',
            ok: true,
            userId: ctx.actor.id,
            productId: ctx.params.productId,
            message: `Produkt ${ctx.params.productId} odobraný z allowlistu.`,
          });
          // D118 — až po zápise a audite, a ticho (viď helper): odobranie
          // produktu nesmie padnúť na tom, že sa nedal preusporiadať front.
          await refreshEnrichPriorityQuietly(d, ctx.log);
          return { removed: true as const };
        }),
    },
    routeDeps,
  );
}

export const DELETE = createAllowlistDelete();
