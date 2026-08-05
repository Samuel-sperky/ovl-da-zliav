/**
 * Aura Zľavy — `GET /api/auth/session` (BUILD-SPEC §5, D69, D70).
 *
 * Vracia stav prihlásenia pre UI: meno, absolútny a idle konec session a konec
 * sudo okna. Idle okno pipeline pri tomto volaní zároveň obnoví (D69).
 * `sudoUntil` sa vyhodnocuje fail-closed cez `checkSudo()` — pozmenené alebo
 * expirované okno sa hlási ako `null`, nikdy nie ako platné (I3).
 *
 * Vlastník: A11.
 */
import { checkSudo } from '@/lib/auth';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

export function createSessionRoute(routeDeps: RouteDeps = {}): NextRouteHandler {
  const now = routeDeps.now ?? (() => new Date());

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: (ctx) => {
        const sudo = checkSudo(ctx.claims, now());
        return {
          username: ctx.claims.username,
          absoluteExpiresAt: ctx.claims.absoluteExpiresAt,
          idleExpiresAt: ctx.claims.idleExpiresAt,
          sudoUntil: sudo.valid ? sudo.sudoUntil : null,
        };
      },
    },
    routeDeps,
  );
}

export const GET = createSessionRoute();
