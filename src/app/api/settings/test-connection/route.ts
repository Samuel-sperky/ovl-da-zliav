/**
 * Aura Zľavy — `POST /api/settings/test-connection` (BUILD-SPEC §5, D55).
 *
 * Tlačidlo „Otestovať spojenie": canary `GET /api/products?per_page=1` proti
 * aktuálne uloženej doméne. Nič sa nezapisuje, kľúč sa NEPOUŽÍVA (čítanie je
 * verejné, D48). Výsledok ide do auditu (`canary_ok`/`canary_fail`).
 *
 * Vlastník: A11.
 */
import type { CanaryResult, ShopCtx } from '@/contracts';

import { appendAudit } from '@/lib/audit/write';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings } from '@/lib/shop/client';
import { newRequestId } from '@/lib/shop/correlation';

export interface TestConnectionRouteDeps {
  canary?: (ctx: ShopCtx) => Promise<CanaryResult>;
  audit?: typeof appendAudit;
  routeDeps?: RouteDeps;
}

export function createTestConnectionRoute(deps: TestConnectionRouteDeps = {}): NextRouteHandler {
  const canary =
    deps.canary ??
    ((ctx: ShopCtx) => createShopClientFromSettings(defaultSettingsRepo).canary(ctx));
  const audit = deps.audit ?? appendAudit;

  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'settings-test-connection' },
      handler: async (ctx) => {
        const operationId = newRequestId();
        const result = await canary({ operationId });
        await audit({
          actor: 'user',
          userId: ctx.claims.sub,
          eventType: result.ok ? 'canary_ok' : 'canary_fail',
          ok: result.ok,
          operationId,
          httpStatus: result.httpStatus ?? null,
          message: result.ok
            ? `test spojenia OK (total=${result.total}, ${result.latencyMs} ms)`
            : `test spojenia zlyhal: ${result.error?.message ?? 'neznáma chyba'}`,
          ip: ctx.info.ip,
          userAgent: ctx.info.userAgent,
        });
        return {
          ok: result.ok,
          httpStatus: result.httpStatus ?? null,
          total: result.total,
          latencyMs: result.latencyMs,
        };
      },
    },
    deps.routeDeps,
  );
}

export const POST = createTestConnectionRoute();
