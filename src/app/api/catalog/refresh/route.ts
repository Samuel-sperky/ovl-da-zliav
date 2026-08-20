/**
 * Aura Zľavy — `POST /api/catalog/refresh` (BUILD-SPEC §5, D56, D57).
 *
 * Obnova cache `name`/`price` z shopu pre produkty allowlistu — čisto čítacie
 * volania (`batchGetProducts` s fallbackom na jednotlivé GETy, D56).
 * `not_found` produkt sa označí v allowliste (D49/D38); produkt, ktorý sa
 * nepodarilo prečítať, zvyšuje `staleCount` a jeho cache sa NEmení.
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import type { ProductDetail } from '@/contracts';

import { badRequest } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { isShopError } from '@/lib/shop/errors';
import { numberToMoney } from '@/lib/engine/snapshot';
import { newOperationContext } from '@/lib/shop/correlation';

import {
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../../campaigns/_shared';

const bodySchema = z
  .object({
    productIds: z.array(z.number().int().positive()).min(1).max(10).optional(),
  })
  .optional();

export function createCatalogRefreshPost(
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
          const active = await d.allowlistRepo.listActive();
          const activeIds = new Set(active.map((r) => r.productId));

          const requested = ctx.body?.productIds ?? [...activeIds];
          const outside = requested.filter((id) => !activeIds.has(id));
          if (outside.length > 0) {
            throw badRequest(
              'Obnoviť sa dajú len produkty z aktívneho allowlistu (I2).',
              'not_allowlisted_refresh',
              { detail: { productIds: outside }, logAsError: false },
            );
          }
          if (requested.length === 0) {
            return { items: [], via: 'batch' as const, staleCount: 0 };
          }

          const shopCtx = newOperationContext();
          const { results, via } = await d.shopClient.batchGetProducts(
            [...requested].sort((a, b) => a - b),
            shopCtx,
          );

          const items: Array<{
            productId: number;
            name: string | null;
            price: string | null;
            hasAttributes: boolean;
            refreshed: boolean;
            error: string | null;
          }> = [];
          let staleCount = 0;

          for (const productId of [...requested].sort((a, b) => a - b)) {
            const result = results.get(productId);
            if (result === undefined || isShopError(result)) {
              staleCount += 1;
              if (result !== undefined && result.kind === 'not_found') {
                await d.allowlistRepo.markShopStatus(
                  productId,
                  'not_found',
                  'Obnova katalógu: shop produkt nenašiel (D49).',
                );
              }
              items.push({
                productId,
                name: null,
                price: null,
                hasAttributes: false,
                refreshed: false,
                error: result === undefined ? 'unreadable' : result.kind,
              });
              continue;
            }

            const detail = result as ProductDetail;
            const price = numberToMoney(detail.price);
            await d.catalogRepo.upsert({
              productId,
              name: detail.name,
              price,
              hasAttributes: detail.has_attributes,
              source: via === 'batch' ? 'batch' : 'get',
              raw: detail,
            });
            await d.allowlistRepo.markShopStatus(productId, 'ok', null);
            items.push({
              productId,
              name: detail.name,
              price,
              hasAttributes: detail.has_attributes,
              refreshed: true,
              error: null,
            });
          }

          await d.audit.appendAudit({
            actor: 'user',
            eventType: 'catalog_refreshed',
            ok: staleCount === 0,
            userId: ctx.claims.sub,
            operationId: shopCtx.operationId,
            message: `Katalóg obnovený (${items.length - staleCount}/${items.length} produktov, via=${via}).`,
          });

          return { items, via, staleCount };
        }),
    },
    routeDeps,
  );
}

export const POST = createCatalogRefreshPost();
