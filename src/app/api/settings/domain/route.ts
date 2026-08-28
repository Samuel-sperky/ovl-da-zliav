/**
 * Aura Zľavy — `PUT /api/settings/domain` (BUILD-SPEC §5, D55, D80).
 *
 *  - prijíma VÝHRADNE `https://` URL (zod + `normalizeShopBaseUrl`, D80),
 *  - do 27. 8. 2026 vyžadovala sudo okno A navyše heslo v tele (D80). Sudo
 *    zrušilo D100 a heslá D99; 28. 8. 2026 heslo vystriedalo výslovné
 *    `confirmed: true` zo zaškrtávacieho poľa (D106) — viď schéma nižšie,
 *  - PRED uložením spustí canary `GET /api/products?per_page=1` proti NOVEJ
 *    doméne (D55) — pri zlyhaní sa doména NEULOŽÍ (fail-closed),
 *  - audit: `canary_ok`/`canary_fail` + `domain_changed` (I4 cez `appendAudit`).
 *
 * Vlastník: A11.
 */
import { z } from 'zod';

import type { CanaryResult, ShopCtx, Ulid } from '@/contracts';

import { appendAudit } from '@/lib/audit/write';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { AppError, badRequest } from '@/lib/http/errors';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { createShopClient, normalizeShopBaseUrl } from '@/lib/shop/client';
import { ShopConfigError } from '@/lib/shop/errors';
import { newRequestId } from '@/lib/shop/correlation';

/**
 * Telo požiadavky.
 *
 * PREČO TU JE `confirmed` (D106, 28. 8. 2026)
 * -------------------------------------------
 * Heslo (D80) bolo do 27. 8. 2026 jediné, čo túto mutáciu držalo, a jeho
 * vytrhnutie z nej urobilo tichý jeden POST. To NIE JE „bez hesla", to je
 * „bez potvrdenia" — a pri tejto konkrétnej route je to najdrahšie miesto
 * celej appky: kto prepíše doménu, tomu zápisová cesta pošle DEŠIFROVANÝ
 * produkčný API kľúč v `X-Api-Key` na jeho adresu. Canary to nezastaví,
 * lebo je `phase: 'read'` bez kľúča a cudzí host si ju uspokojí sám.
 *
 * `z.literal(true)` je zámer: chýbajúce aj `false` skončí 400, nikdy zmenou
 * domény. Nie je to prihlásenie — nič si nepamätáš a nič nezadávaš, len raz
 * zaškrtneš (D99 zostáva v platnosti).
 */
export const domainBodySchema = z.object({
  domain: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), {
      message: 'Doména shopu musí začínať na https:// (D80).',
    }),
  confirmed: z.literal(true),
});

/** Canary funkcia proti KANDIDÁTSKEJ doméne (ešte neuloženej). */
export type CanaryForBaseUrl = (baseUrl: string, ctx: ShopCtx) => Promise<CanaryResult>;

const defaultCanary: CanaryForBaseUrl = (baseUrl, ctx) =>
  createShopClient({ baseUrl }).canary(ctx);

export interface DomainRouteDeps {
  settings?: {
    setShopDomain(domain: string, confirmedAt: Date | null): Promise<void>;
  };
  audit?: typeof appendAudit;
  canary?: CanaryForBaseUrl;
  routeDeps?: RouteDeps;
}

export function createDomainRoute(deps: DomainRouteDeps = {}): NextRouteHandler {
  const settings = deps.settings ?? defaultSettingsRepo;
  const audit = deps.audit ?? appendAudit;
  const canary = deps.canary ?? defaultCanary;

  return defineRoute(
    {
      method: 'PUT',
      body: domainBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'settings-domain' },
      handler: async (ctx) => {
        const now = (deps.routeDeps?.now ?? (() => new Date()))();

        /* 1. Normalizácia — len https, bez query/fragmentu/credentials (D80). */
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
          userId: ctx.actor.id,
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
          userId: ctx.actor.id,
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
