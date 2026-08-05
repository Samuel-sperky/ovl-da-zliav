/**
 * Aura Zľavy — `/api/allowlist` (BUILD-SPEC §5, I2, D7).
 *
 *  - `GET`  (session): 10 slotov s cache-ovaným `name`/`price` a s „posledným
 *    VLASTNÝM zápisom" — nikdy sa netvrdí, že poznáme stav shopu (I11).
 *  - `POST` (session): pridanie produktu; 11. produkt je odmietnutý 409
 *    (`allowlist_full`, I2 — strop drží repozitár + DB CHECK).
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../campaigns/_shared';

/* ═══════════════════════════════ GET ══════════════════════════════════════ */

export function createAllowlistGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: (ctx) =>
        withRouteErrors(async () => {
          void ctx;
          const records = await d.allowlistRepo.listActive();
          const catalog = await d.catalogRepo.getMany(records.map((r) => r.productId));

          const out = [];
          for (const r of records) {
            const cached = catalog.get(r.productId) ?? null;
            const lastOwnWrite = await d.campaignsRepo.lastOwnWrite(r.productId);
            out.push({
              productId: r.productId,
              slot: r.slot,
              label: r.label,
              shopStatus: r.shopStatus,
              name: cached?.name ?? null,
              price: cached?.price ?? null,
              hasAttributes: cached?.hasAttributes ?? false,
              lastOwnWrite:
                lastOwnWrite === null
                  ? null
                  : {
                      percent: lastOwnWrite.percent,
                      from: lastOwnWrite.from,
                      to: lastOwnWrite.to,
                      at: lastOwnWrite.at.toISOString(),
                    },
            });
          }
          return out;
        }),
    },
    routeDeps,
  );
}

/* ═══════════════════════════════ POST ═════════════════════════════════════ */

const addBodySchema = z.object({
  productId: z.number().int().positive(),
  label: z.string().min(1).max(200).optional(),
});

export function createAllowlistPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      body: addBodySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          // Repozitár hodí doménovú chybu `allowlist_full` pri 10 obsadených
          // slotoch (I2) — A5 ju mapuje na 409.
          const record = await d.allowlistRepo.addProduct(
            ctx.body.productId,
            ctx.body.label ?? null,
          );
          await d.audit.appendAudit({
            actor: 'user',
            eventType: 'allowlist_added',
            ok: true,
            userId: ctx.claims.sub,
            productId: record.productId,
            message: `Produkt ${record.productId} pridaný do allowlistu (slot ${record.slot}).`,
          });
          return { productId: record.productId, slot: record.slot };
        }),
    },
    routeDeps,
  );
}

export const GET = createAllowlistGet();
export const POST = createAllowlistPost();
