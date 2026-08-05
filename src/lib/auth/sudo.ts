/**
 * Aura Zľavy — sudo mód (D70, INVARIANT I3).
 *
 * D70: „Pred ostrým zápisom MUSÍ appka vyžiadať heslo znova, ak je od poslednej
 * autentifikácie viac než 15 minút." Sudo okno je preto priamou súčasťou I3
 * („žiadny zápis bez potvrdenia") a tento modul musí vedieť **jednoznačne**
 * odpovedať, či okno platí.
 *
 * **PRI POCHYBNOSTI VŽDY „NIE".** `checkSudo()` vracia `valid: false`, keď:
 *  - session chýba alebo je neplatná (`claims === null`),
 *  - `sudoUntil` je `null`,
 *  - `sudoUntil` už uplynul,
 *  - `sudoUntil` je ďalej než okno dovoľuje (pozmenený/chybne vydaný token),
 *  - `sudoUntil` presahuje absolútny konec session (D69),
 *  - čas sa nedá vyhodnotiť (neplatný `Date`).
 *
 * Sudo okno žije v podpísaných claimoch session (`sudo`), takže:
 *  - nepotrebuje žiadny serverový stav ani tabuľku,
 *  - `logout` ho zruší spolu so session,
 *  - pipeline `auth: 'sudo'` (A5) si vystačí s cookie.
 *
 * Predĺžiť okno sa dá VÝHRADNE opätovným zadaním hesla (`grantSudo()`), nikdy
 * aktivitou používateľa — inak by 15-minútové okno nebolo obmedzením (D70).
 *
 * Vlastník: A4.
 */
import type { SessionClaims, SudoCheck, UtcDate } from '@/contracts';

import { env } from '@/env';
import { createLockoutService, LockoutError, type LockoutService } from '@/lib/auth/lockout';
import { verifyPassword } from '@/lib/auth/password';
import {
  createSessionService,
  type IssuedSession,
  type SessionService,
} from '@/lib/auth/session';
import { usersRepo, type UsersRepository } from '@/lib/repo/users.repo';

/** Kód, ktorý pipeline (A5) mapuje na 401 `sudo_required` (§5). */
export const SUDO_REQUIRED_CODE = 'sudo_required';

export const SUDO_REQUIRED_MESSAGE =
  'Pred ostrým zápisom je potrebné znova zadať heslo (sudo mód, platnosť 15 minút, D70).';

/** Chyba pre `auth: 'sudo'` route-y. Fail-closed — nikdy sa neprehlta (I3). */
export class SudoRequiredError extends Error {
  readonly code = SUDO_REQUIRED_CODE;

  constructor(message: string = SUDO_REQUIRED_MESSAGE) {
    super(message);
    this.name = 'SudoRequiredError';
  }
}

/** Okno v minútach z ENV (§11, `SUDO_WINDOW_MINUTES`, default 15). */
export function sudoWindowMinutes(): number {
  try {
    return env.SUDO_WINDOW_MINUTES;
  } catch {
    // Bez ENV sa nechováme voľnejšie než D70.
    return 15;
  }
}

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date && !Number.isNaN(value.getTime());

/**
 * Jednoznačná odpoveď na otázku „je sudo okno platné?" (I3).
 * `windowMinutes` má prednosť pred ENV (testy, budúca konfigurácia).
 */
export function checkSudo(
  claims: SessionClaims | null | undefined,
  now: Date = new Date(),
  windowMinutes: number = sudoWindowMinutes(),
): SudoCheck {
  if (!claims) return { valid: false, sudoUntil: null };

  const until = claims.sudoUntil;
  if (!isValidDate(until)) return { valid: false, sudoUntil: null };
  if (!isValidDate(now)) return { valid: false, sudoUntil: null };

  // Uplynulo → nie.
  if (until.getTime() <= now.getTime()) return { valid: false, sudoUntil: null };

  // Dlhšie než okno dovoľuje → považujeme za pozmenené a odmietneme.
  const maxUntil = now.getTime() + windowMinutes * 60_000;
  if (until.getTime() > maxUntil) return { valid: false, sudoUntil: null };

  // Nikdy nesmie prežiť absolútny konec session (D69).
  if (isValidDate(claims.absoluteExpiresAt) && until.getTime() > claims.absoluteExpiresAt.getTime()) {
    return { valid: false, sudoUntil: null };
  }

  return { valid: true, sudoUntil: until };
}

/** Koľko sekúnd sudo okna zostáva (0 keď neplatí). Pre UI odpočet. */
export function sudoSecondsLeft(
  claims: SessionClaims | null | undefined,
  now: Date = new Date(),
  windowMinutes: number = sudoWindowMinutes(),
): number {
  const check = checkSudo(claims, now, windowMinutes);
  if (!check.valid || !check.sudoUntil) return 0;
  return Math.max(0, Math.ceil((check.sudoUntil.getTime() - now.getTime()) / 1000));
}

/** Hodí `SudoRequiredError`, keď okno nie je preukázateľne platné (I3). */
export function requireSudo(
  claims: SessionClaims | null | undefined,
  now: Date = new Date(),
  windowMinutes: number = sudoWindowMinutes(),
): UtcDate {
  const check = checkSudo(claims, now, windowMinutes);
  if (!check.valid || !check.sudoUntil) throw new SudoRequiredError();
  return check.sudoUntil;
}

/* ───────────────────────── znovupotvrdenie heslom ──────────────────────── */

export interface GrantSudoInput {
  /** Platná session, v ktorej sa sudo okno otvára. */
  claims: SessionClaims;
  password: string;
  ip: string;
  userAgent?: string | null;
}

export type GrantSudoResult =
  | { ok: true; sudoUntil: UtcDate; session: IssuedSession }
  | { ok: false; code: 'invalid_password'; message: string; retryAfterSeconds: number }
  | { ok: false; code: 'locked_out'; message: string; retryAfterSeconds: number };

export interface SudoServiceOptions {
  users?: Pick<UsersRepository, 'getById'>;
  lockout?: LockoutService;
  session?: SessionService;
  verify?: typeof verifyPassword;
  now?: () => Date;
  windowMinutes?: number;
}

export interface SudoService {
  check(claims: SessionClaims | null | undefined): SudoCheck;
  /**
   * Overí heslo a otvorí sudo okno. Vracia NOVÚ session cookie (sudo okno je
   * v claimoch), takže volajúca route ju MUSÍ nastaviť.
   *
   * Neúspešné pokusy idú do `login_attempts` a podliehajú tomu istému lockoutu
   * ako prihlásenie (D71) — inak by bol sudo endpoint tichým obchvatom.
   */
  grant(input: GrantSudoInput): Promise<GrantSudoResult>;
}

export function createSudoService(options: SudoServiceOptions = {}): SudoService {
  const users = options.users ?? usersRepo;
  const lockout = options.lockout ?? createLockoutService();
  const session = options.session ?? createSessionService();
  const verify = options.verify ?? verifyPassword;
  const now = options.now ?? (() => new Date());
  const windowOf = (): number => options.windowMinutes ?? sudoWindowMinutes();

  return {
    check(claims) {
      return checkSudo(claims, now(), windowOf());
    },

    async grant(input: GrantSudoInput): Promise<GrantSudoResult> {
      const context = {
        username: input.claims.username,
        ip: input.ip,
        userAgent: input.userAgent ?? null,
        userId: input.claims.sub,
      };

      // 1. Lockout PRED overením hesla (D71, fail-closed).
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

      // 2. Heslo sa overuje proti userovi zo session, nie proti menu z requestu.
      const user = await users.getById(input.claims.sub);
      const matches = await verify(user?.passwordHash ?? null, input.password);

      if (!matches) {
        const state = await lockout.recordFailure(context, {
          eventType: 'sudo_fail',
          message: 'nesprávne heslo pri potvrdzovaní sudo módu',
        });
        return {
          ok: false,
          code: 'invalid_password',
          message: 'Nesprávne heslo.',
          retryAfterSeconds: state.retryAfterSeconds,
        };
      }

      // 3. Úspech: nové sudo okno od TOHTO momentu (D70).
      const at = now();
      const sudoUntil = new Date(at.getTime() + windowOf() * 60_000);
      const issued = await session.issue({
        userId: input.claims.sub,
        username: input.claims.username,
        // Absolútny konec session sa NEPREDLŽUJE ani sudo potvrdením (D69).
        absoluteExpiresAt: input.claims.absoluteExpiresAt,
        sudoUntil,
      });

      // Audit `sudo_ok` + riadok v `login_attempts` (úspech vynuluje sériu, D71).
      await lockout.recordSuccess(context, {
        eventType: 'sudo_ok',
        message: `sudo okno otvorené na ${windowOf()} min`,
      });

      return {
        ok: true,
        // Skutočné okno môže byť skrátené absolútnym koncom session (D69).
        sudoUntil: issued.claims.sudoUntil ?? sudoUntil,
        session: issued,
      };
    },
  };
}

/* ───────────────────────────── default instancia ───────────────────────── */

let defaultService: SudoService | null = null;

function getDefaultService(): SudoService {
  if (!defaultService) defaultService = createSudoService();
  return defaultService;
}

/** Otvorenie sudo okna heslom — pre `POST /api/auth/sudo` (§5). */
export const grantSudo = (input: GrantSudoInput): Promise<GrantSudoResult> =>
  getDefaultService().grant(input);

/** Výhradne pre testy — zabudne default instanciu. */
export function resetDefaultSudoService(): void {
  defaultService = null;
}
