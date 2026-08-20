/**
 * Aura Zľavy — prihlásenie a odhlásenie (D68–D71, §5, I1).
 *
 * Zlepuje dokopy štyri veci, ktoré musia ísť VŽDY v tomto poradí:
 *   1. **lockout** — `login_attempts` sa pýtame PRED overením hesla (D71),
 *   2. **heslo** — argon2id verify (D68) s konštantným časom aj pri neznámom mene,
 *   3. **audit** — každý pokus, úspešný aj neúspešný (D71, I4 cez `appendAudit`),
 *   4. **session** — jose JWT cookie `ovl_zliav_session` s 8 h / 30 min (D69)
 *      a otvoreným sudo oknom (prihlásenie JE autentifikácia, D70).
 *
 * Route `/api/auth/login` (A11) má teda jedinú prácu: zod validácia vstupu,
 * zavolať `login()` a nastaviť vrátenú cookie. Žiadna časť tohto poradia sa
 * nesmie preskočiť v inej ceste kódu.
 *
 * Ďalšie rozhodnutia:
 *  - **2FA/TOTP sa NEIMPLEMENTUJE** (D73), **CAPTCHA tiež nie** (D71).
 *  - **I1** — heslo neopustí `login()`; nikdy sa neloguje ani neukladá.
 *  - Rozlišovanie „neznáme meno" vs. „zlé heslo" sa NEVRACIA — odpoveď je vždy
 *    rovnaká (`invalid_credentials`), aby sa nedali enumerovať mená.
 *
 * Vlastník: A4.
 */
import type { SessionClaims, UserRecord } from '@/contracts';

import { createLockoutService, LockoutError, type LockoutService } from '@/lib/auth/lockout';
import { checkPasswordPolicy, verifyPassword } from '@/lib/auth/password';
import {
  clearedSessionCookie,
  createSessionService,
  type IssuedSession,
  type SessionCookie,
  type SessionService,
} from '@/lib/auth/session';
import { appendAudit } from '@/lib/audit/write';
import { usersRepo, type UsersRepository } from '@/lib/repo/users.repo';

export interface LoginInput {
  username: string;
  password: string;
  ip: string;
  userAgent?: string | null;
}

export type LoginFailureCode = 'invalid_credentials' | 'locked_out';

export type LoginResult =
  | {
      ok: true;
      user: { id: number; username: string };
      session: IssuedSession;
      claims: SessionClaims;
    }
  | {
      ok: false;
      code: LoginFailureCode;
      message: string;
      /** Pre hlavičku `Retry-After` (§5, D71). */
      retryAfterSeconds: number;
    };

/** Jediná hláška pre zlé meno aj zlé heslo — bez enumerácie userov. */
export const INVALID_CREDENTIALS_MESSAGE = 'Nesprávne prihlasovacie meno alebo heslo.';

export interface LoginServiceOptions {
  users?: Pick<UsersRepository, 'getByUsername' | 'touchLastLogin'>;
  lockout?: LockoutService;
  session?: SessionService;
  verify?: typeof verifyPassword;
  audit?: typeof appendAudit;
  now?: () => Date;
}

export interface LoginService {
  login(input: LoginInput): Promise<LoginResult>;
  /** Odhlásenie: audit `logout` + cookie, ktorá session okamžite ruší. */
  logout(input: {
    claims: SessionClaims | null;
    ip: string;
    userAgent?: string | null;
  }): Promise<{ cookie: SessionCookie }>;
}

export function createLoginService(options: LoginServiceOptions = {}): LoginService {
  const users = options.users ?? usersRepo;
  const lockout = options.lockout ?? createLockoutService();
  const session = options.session ?? createSessionService();
  const verify = options.verify ?? verifyPassword;
  const audit = options.audit ?? appendAudit;

  return {
    async login(input: LoginInput): Promise<LoginResult> {
      const context = {
        username: input.username,
        ip: input.ip,
        userAgent: input.userAgent ?? null,
      };

      /* 1. lockout — fail-closed vrátnik pred akoukoľvek prácou s heslom (D71) */
      try {
        await lockout.assertAllowed(context);
      } catch (error) {
        if (error instanceof LockoutError) {
          return {
            ok: false,
            code: 'locked_out',
            message: error.message,
            retryAfterSeconds: error.retryAfterSeconds,
          };
        }
        throw error;
      }

      /* 2. heslo — politika (D68) a argon2id verify s konštantným časom */
      const policy = checkPasswordPolicy(input.password);
      // Chyba DB pri čítaní usera NIE JE „zlé heslo" — výnimka ide nahor a route
      // z nej urobí 500. Appka nesmie fungovať degradovane (I14).
      const user: UserRecord | null = await users.getByUsername(input.username);

      // Aj pri neznámom mene/krátkom hesle sa spáli čas na dummy hashi.
      const matches = policy.ok
        ? await verify(user?.passwordHash ?? null, input.password)
        : await verify(user?.passwordHash ?? null, 'x'.repeat(12));

      if (!policy.ok || !user || !matches) {
        /* 3a. audit neúspechu + zápis pokusu (D71) */
        const state = await lockout.recordFailure(context, {
          eventType: 'login_fail',
          message: !policy.ok
            ? 'heslo nesplnilo politiku (min. 12 znakov, D68)'
            : !user
              ? 'neznáme prihlasovacie meno'
              : 'nesprávne heslo',
        });
        return {
          ok: false,
          code: 'invalid_credentials',
          message: INVALID_CREDENTIALS_MESSAGE,
          retryAfterSeconds: state.retryAfterSeconds,
        };
      }

      /* 3b. audit úspechu (D71) */
      await lockout.recordSuccess(
        { ...context, userId: user.id },
        { eventType: 'login_ok', message: `úspešné prihlásenie (meno "${user.username}")` },
      );

      try {
        await users.touchLastLogin(user.id);
      } catch {
        // `last_login_at` je informatívne — jeho zlyhanie nesmie zhodiť login.
      }

      /* 4. session + otvorené sudo okno (D69, D70) */
      const issued = await session.issue({ userId: user.id, username: user.username });

      return {
        ok: true,
        user: { id: user.id, username: user.username },
        session: issued,
        claims: issued.claims,
      };
    },

    async logout(input): Promise<{ cookie: SessionCookie }> {
      if (input.claims) {
        await audit({
          actor: 'user',
          eventType: 'logout',
          ok: true,
          userId: input.claims.sub,
          message: `odhlásenie (meno "${input.claims.username}")`,
          ip: input.ip,
          userAgent: input.userAgent ?? null,
        });
      }
      // Cookie sa ruší vždy — aj keď session už bola neplatná (fail-closed).
      return { cookie: clearedSessionCookie() };
    },
  };
}

/* ───────────────────────────── default instancia ───────────────────────── */

let defaultService: LoginService | null = null;

function getDefaultService(): LoginService {
  if (!defaultService) defaultService = createLoginService();
  return defaultService;
}

/** Prihlásenie — pre `POST /api/auth/login` (§5). */
export const login = (input: LoginInput): Promise<LoginResult> => getDefaultService().login(input);

/** Odhlásenie — pre `POST /api/auth/logout` (§5). */
export const logout = (input: {
  claims: SessionClaims | null;
  ip: string;
  userAgent?: string | null;
}): Promise<{ cookie: SessionCookie }> => getDefaultService().logout(input);

/** Výhradne pre testy — zabudne default instanciu. */
export function resetDefaultLoginService(): void {
  defaultService = null;
}
