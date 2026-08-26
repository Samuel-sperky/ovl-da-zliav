/**
 * Aura Zľavy — `POST /api/catalog/refresh` (BUILD-SPEC §5, D56, D57).
 *
 * Obnova cache `name`/`price` z shopu pre produkty allowlistu — čisto čítacie
 * volania (`batchGetProducts` s fallbackom na jednotlivé GETy, D56).
 * `not_found` produkt sa označí v allowliste (D49/D38); produkt, ktorý sa
 * nepodarilo prečítať, zvyšuje `staleCount` a jeho cache sa NEmení.
 *
 * ROZPOČET ČÍTANÍ (K7). Sada je ohraničená rozsahom allowlistu (I2), takže
 * jedno kliknutie stojí `anonReadCost(≤10)` = najviac 11 anonymných čítaní.
 * Ohraničený NIE JE počet kliknutí — a kým sa tu rozpočet nerezervoval, dvadsať
 * kliknutí ticho vyčerpalo denný strop 240, ktorý appka delí so synchronizáciou
 * katalógu a s náhľadmi. Rezervuje sa preto CELÁ sada naraz, PRED volaním
 * shopu; keď sa nezmestí, shop sa nevolá vôbec a odpoveď to PRIZNÁ na každom
 * riadku (`error`), namiesto aby tvrdila, že sa produkt nepodarilo prečítať.
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
  reserveShopReadsForSet,
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
          const sorted = [...requested].sort((a, b) => a - b);

          /* K7 — bez rezervácie sa shop nevolá. `known: false` (nečitateľné
           * počítadlo) sa od vyčerpaného stropu ZÁMERNE odlišuje: druhé je
           * meraný fakt, prvé je medzera v poznaní (rovnako ako `budget_day`
           * vs `budget_unknown` v `catalog/product-details`). */
          const clearance = await reserveShopReadsForSet(d, sorted.length);
          if (!clearance.granted) {
            const reason = clearance.status.known ? 'read_budget' : 'read_budget_unknown';
            await d.audit.appendAudit({
              actor: 'user',
              eventType: 'catalog_refreshed',
              ok: false,
              userId: ctx.claims.sub,
              operationId: shopCtx.operationId,
              message: clearance.status.known
                ? `Katalóg sa neobnovil: dnešný rozpočet čítaní zo shopu nestačí (potrebných ${clearance.cost}, voľných ${clearance.status.remaining} z ${clearance.status.limit}). Shop sa nevolal.`
                : 'Katalóg sa neobnovil: rozpočet čítaní zo shopu sa nedá prečítať, takže appka nevie, či smie shop osloviť. Shop sa nevolal.',
            });
            return {
              items: sorted.map((productId) => ({
                productId,
                name: null,
                price: null,
                hasAttributes: false,
                refreshed: false,
                error: reason,
              })),
              via: 'batch' as const,
              staleCount: sorted.length,
            };
          }

          const { results, via } = await d.shopClient.batchGetProducts(sorted, shopCtx);

          const items: Array<{
            productId: number;
            name: string | null;
            price: string | null;
            hasAttributes: boolean;
            refreshed: boolean;
            error: string | null;
          }> = [];
          let staleCount = 0;

          for (const productId of sorted) {
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
