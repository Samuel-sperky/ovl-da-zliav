/**
 * Aura Zľavy — `POST /api/auth/logout` (BUILD-SPEC §5).
 *
 * Audit `logout` + cookie, ktorá session okamžite ruší, vlastní `lib/auth`
 * (`logout()`). Cookie sa ruší vždy — fail-closed.
 *
 * Vlastník: A11.
 */
import { logout as defaultLogout, serializeSessionCookie } from '@/lib/auth';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

export interface LogoutRouteDeps {
  logout?: typeof defaultLogout;
  routeDeps?: RouteDeps;
}

export function createLogoutRoute(deps: LogoutRouteDeps = {}): NextRouteHandler {
  const doLogout = deps.logout ?? defaultLogout;

  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      handler: async (ctx) => {
        const { cookie } = await doLogout({
          claims: ctx.claims,
          ip: ctx.info.ip,
          userAgent: ctx.info.userAgent,
        });
        // Rušiaca cookie sa pridáva AŽ PO obnovovacej z pipeline — posledná vyhráva.
        ctx.setCookie(serializeSessionCookie(cookie));
        return {};
      },
    },
    deps.routeDeps,
  );
}

export const POST = createLogoutRoute();
