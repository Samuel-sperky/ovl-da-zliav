/**
 * Aura Zľavy — `POST /api/auth/login` (BUILD-SPEC §5, D68–D71).
 *
 * Route má jedinú prácu: zod validáciu vstupu, zavolať `login()` (A4) a
 * nastaviť vrátenú session cookie. Poradie lockout → heslo → audit → session
 * vlastní `lib/auth/login.ts` — tu sa NIČ z toho nereimplementuje.
 *
 *  - 429 pri lockoute (D71) s hlavičkou `Retry-After`,
 *  - 401 `invalid_credentials` pre zlé meno AJ zlé heslo (bez enumerácie mien),
 *  - heslo neopustí handler — neloguje sa a do odpovede nejde nikdy (I1).
 *
 * Vlastník: A11.
 */
import { z } from 'zod';

import { login as defaultLogin, serializeSessionCookie } from '@/lib/auth';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { tooManyRequests, unauthorized } from '@/lib/http/errors';

/** `{username:string(1..64), password:string(12..200)}` (§5). */
export const loginBodySchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(12).max(200),
});

export interface LoginRouteDeps {
  login?: typeof defaultLogin;
  routeDeps?: RouteDeps;
}

export function createLoginRoute(deps: LoginRouteDeps = {}): NextRouteHandler {
  const doLogin = deps.login ?? defaultLogin;

  return defineRoute(
    {
      method: 'POST',
      auth: 'none',
      body: loginBodySchema,
      // Tlmenie hrubej sily nad rámec DB lockoutu (ten je vnútri `login()`, O4).
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'auth-login' },
      handler: async (ctx) => {
        const result = await doLogin({
          username: ctx.body.username,
          password: ctx.body.password,
          ip: ctx.info.ip,
          userAgent: ctx.info.userAgent,
        });

        if (!result.ok) {
          if (result.code === 'locked_out') {
            // 429 + Retry-After (D71).
            throw tooManyRequests(result.message, result.retryAfterSeconds);
          }
          throw unauthorized(result.message, 'invalid_credentials', { logAsError: false });
        }

        ctx.setCookie(serializeSessionCookie(result.session.cookie));
        return { user: result.user };
      },
    },
    deps.routeDeps,
  );
}

export const POST = createLoginRoute();
