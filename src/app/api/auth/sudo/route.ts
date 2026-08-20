/**
 * Aura Zľavy — `POST /api/auth/sudo` (BUILD-SPEC §5, D70, D71).
 *
 * Znovupotvrdenie heslom otvára 15-minútové sudo okno. Overenie hesla,
 * lockout (rovnaký ako pri logine — sudo nesmie byť tichý obchvat) a vydanie
 * novej session cookie vlastní `lib/auth/sudo.ts` (`grantSudo()`).
 *
 * Vlastník: A11.
 */
import { z } from 'zod';

import { grantSudo as defaultGrantSudo, serializeSessionCookie } from '@/lib/auth';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { tooManyRequests, unauthorized } from '@/lib/http/errors';

export const sudoBodySchema = z.object({
  password: z.string().min(1).max(200),
});

export interface SudoRouteDeps {
  grantSudo?: typeof defaultGrantSudo;
  routeDeps?: RouteDeps;
}

export function createSudoRoute(deps: SudoRouteDeps = {}): NextRouteHandler {
  const grant = deps.grantSudo ?? defaultGrantSudo;

  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      body: sudoBodySchema,
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'auth-sudo' },
      handler: async (ctx) => {
        const result = await grant({
          claims: ctx.claims,
          password: ctx.body.password,
          ip: ctx.info.ip,
          userAgent: ctx.info.userAgent,
        });

        if (!result.ok) {
          if (result.code === 'locked_out') {
            throw tooManyRequests(result.message, result.retryAfterSeconds);
          }
          throw unauthorized(result.message, 'invalid_password', { logAsError: false });
        }

        // Sudo okno žije v podpísaných claimoch — nová cookie je povinná (D70).
        ctx.setCookie(serializeSessionCookie(result.session.cookie));
        return { sudoUntil: result.sudoUntil };
      },
    },
    deps.routeDeps,
  );
}

export const POST = createSudoRoute();
