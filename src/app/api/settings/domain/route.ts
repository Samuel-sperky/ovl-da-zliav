/**
 * Aura Zľavy — `PUT /api/settings/domain` (BUILD-SPEC §5, D55, D80).
 *
 *  - prijíma VÝHRADNE `https://` URL (zod + `normalizeShopBaseUrl`, D80),
 *  - vyžaduje sudo okno A navyše explicitné heslo v tele (D80),
 *  - PRED uložením spustí canary `GET /api/products?per_page=1` proti NOVEJ
 *    doméne (D55) — pri zlyhaní sa doména NEULOŽÍ (fail-closed),
 *  - audit: `canary_ok`/`canary_fail` + `domain_changed` (I4 cez `appendAudit`).
 *
 * Vlastník: A11.
 */
import { z } from 'zod';

import type { CanaryResult, ShopCtx, Ulid } from '@/contracts';

import { verifyPassword } from '@/lib/auth';
import { appendAudit } from '@/lib/audit/write';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { AppError, badRequest, unauthorized } from '@/lib/http/errors';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { usersRepo as defaultUsersRepo } from '@/lib/repo/users.repo';
import { createShopClient, normalizeShopBaseUrl } from '@/lib/shop/client';
import { ShopConfigError } from '@/lib/shop/errors';
import { newRequestId } from '@/lib/shop/correlation';

export const domainBodySchema = z.object({
  domain: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), {
      message: 'Doména shopu musí začínať na https:// (D80).',
    }),
  password: z.string().min(1).max(200),
});

/** Canary funkcia proti KANDIDÁTSKEJ doméne (ešte neuloženej). */
export type CanaryForBaseUrl = (baseUrl: string, ctx: ShopCtx) => Promise<CanaryResult>;

const defaultCanary: CanaryForBaseUrl = (baseUrl, ctx) =>
  createShopClient({ baseUrl }).canary(ctx);

export interface DomainRouteDeps {
  settings?: {
    setShopDomain(domain: string, confirmedAt: Date | null): Promise<void>;
  };
  users?: { getById(id: number): Promise<{ passwordHash: string } | null> };
  verify?: typeof verifyPassword;
  audit?: typeof appendAudit;
  canary?: CanaryForBaseUrl;
  routeDeps?: RouteDeps;
}

export function createDomainRoute(deps: DomainRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;
  const users = deps.users ?? defaultUsersRepo;
  const verify = deps.verify ?? verifyPassword;
  const audit = deps.audit ?? appendAudit;
  const canary = deps.canary ?? defaultCanary;

  return defineRoute(
    {
      method: 'PUT',
      auth: 'sudo',
      body: domainBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'settings-domain' },
      handler: async (ctx) => {
        const now = (deps.routeDeps?.now ?? (() => new Date()))();

        /* 1. Heslo znova, aj v platnom sudo okne (D80). */
        const user = await users.getById(ctx.claims.sub);
        const matches = await verify(user?.passwordHash ?? null, ctx.body.password);
        if (!matches) {
          throw unauthorized('Nesprávne heslo.', 'invalid_password', { logAsError: false });
        }

        /* 2. Normalizácia — len https, bez query/fragmentu/credentials (D80). */
        let normalized: string;
        try {
          normalized = normalizeShopBaseUrl(ctx.body.domain);
        } catch (error) {
          if (error instanceof ShopConfigError) {
            throw badRequest(error.shopError.message, 'invalid_domain', { logAsError: false });
          }
          throw error;
        }

        /* 3. Canary GET proti novej doméne PRED uložením (D55). */
        const operationId: Ulid = newRequestId();
        const result = await canary(normalized, { operationId });
        await audit({
          actor: 'user',
          userId: ctx.claims.sub,
          eventType: result.ok ? 'canary_ok' : 'canary_fail',
          ok: result.ok,
          operationId,
          httpStatus: result.httpStatus ?? null,
          message: result.ok
            ? `canary pri zmene domény OK (total=${result.total}, ${result.latencyMs} ms)`
            : `canary pri zmene domény zlyhal: ${result.error?.message ?? 'neznáma chyba'}`,
          ip: ctx.info.ip,
          userAgent: ctx.info.userAgent,
        });
        if (!result.ok) {
          throw new AppError(
            502,
            'canary_failed',
            `Doména sa NEULOŽILA: testovacie čítanie zo shopu zlyhalo (D55). ${result.error?.message ?? ''}`.trim(),
            { logAsError: false },
          );
        }

        /* 4. Uloženie + audit `domain_changed`. */
        await settings.setShopDomain(normalized, now);
        await audit({
          actor: 'user',
          userId: ctx.claims.sub,
          eventType: 'domain_changed',
          ok: true,
          operationId,
          message: `doména shopu nastavená na ${normalized}`,
          ip: ctx.info.ip,
          userAgent: ctx.info.userAgent,
        });

        return { shopDomain: normalized, canary: { ok: true, total: result.total } };
      },
    },
    deps.routeDeps,
  );
}

export const PUT = createDomainRoute();
