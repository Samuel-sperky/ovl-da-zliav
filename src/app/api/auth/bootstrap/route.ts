/**
 * Aura Zľavy — `GET /api/auth/bootstrap` (prvý beh appky).
 *
 * Jediná otázka, na ktorú tento route odpovedá: **existuje vôbec nejaký účet?**
 * Bez toho `/login` nemá ako vedieť, že po čerstvej inštalácii (`users=0`) sa
 * prihlásiť NEDÁ žiadnym menom ani heslom, a ukazuje slepý formulár.
 *
 * `auth: 'none'` je nevyhnutné — v stave `users=0` neexistuje session, ktorou by
 * sa dal route autentifikovať. Preto je zámerne maximálne úzky:
 *
 *  - Číta VÝHRADNE `countUsers()` (`SELECT COUNT(*)`), nikdy záznamy účtov —
 *    žiadne meno, žiadny hash, žiadny čas prihlásenia (I1).
 *  - Vracia jediný boolean `needsAdmin`. To NIE je enumerácia mien: „účtov je
 *    nula" je legitímna informácia o prvom behu, nie odpoveď na otázku, či
 *    konkrétny používateľ existuje. Hlášky NEúspešného prihlásenia zostávajú
 *    generické v `/api/auth/login` (D68).
 *  - Príkaz na vytvorenie admina route NEvracia ani nespúšťa: `seed-admin`
 *    potrebuje skutočné TTY, takže ho musí spustiť človek. Text príkazu má
 *    klient staticky v `lib/ui/first-run.ts`.
 *  - Fail-closed: keď sa počet nedá prečítať (DB dole), hlási `needsAdmin:false`
 *    — appka nikdy netvrdí „účet neexistuje", keď to nevie.
 *
 * Vlastník: A11.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { usersRepo as defaultUsersRepo } from '@/lib/repo/users.repo';

export interface BootstrapReport {
  /** `true` = v DB nie je ani jeden účet, treba spustiť `seed-admin`. */
  needsAdmin: boolean;
}

export interface BootstrapRouteDeps {
  /** Zámerne LEN počet — route nemá ako sa dostať k údajom účtov (I1). */
  users?: { countUsers(): Promise<number> };
  routeDeps?: RouteDeps;
}

export function createBootstrapRoute(deps: BootstrapRouteDeps = {}): NextRouteHandler {
  const users = deps.users ?? defaultUsersRepo;

  return defineRoute(
    {
      method: 'GET',
      auth: 'none',
      // Verejný route na lokálnej appke; limit len proti zbytočnému bušeniu.
      rateLimit: { limit: 60, windowMs: 60_000, bucket: 'auth-bootstrap' },
      handler: async (ctx): Promise<BootstrapReport> => {
        let needsAdmin = false;
        try {
          needsAdmin = (await users.countUsers()) === 0;
        } catch {
          // Fail-closed: neznámy počet sa hlási ako „účty existujú", takže
          // `/login` zobrazí bežný formulár a nič nesprávne netvrdí.
          needsAdmin = false;
        }
        ctx.log.debug('auth_bootstrap_checked', { httpStatus: 200 });
        return { needsAdmin };
      },
    },
    deps.routeDeps,
  );
}

export const GET = createBootstrapRoute();
