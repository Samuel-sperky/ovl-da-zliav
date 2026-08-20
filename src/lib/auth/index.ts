/**
 * Aura Zľavy — verejné rozhranie autentifikačnej vrstvy (A4).
 *
 * Toto je odporúčaný import pre `defineRoute()` (A5) a pre route-y
 * `/api/auth/*` (A11):
 *
 * ```ts
 * import {
 *   SESSION_COOKIE_NAME, readSessionCookie, verifySession, verifyAndRefreshSession,
 *   checkSudo, requireSudo, SudoRequiredError, grantSudo,
 *   login, logout, LockoutError,
 * } from '@/lib/auth';
 * ```
 *
 * Poradie vrstiev, ktoré pipeline MUSÍ dodržať (§5, D71, D72, I3):
 *   1. `readSessionCookie(req.headers.get('cookie'))` → `verifySession()`
 *      (`auth: 'session' | 'sudo'`),
 *   2. lockout / rate limit (`assertLoginAllowed()` na login a sudo route),
 *   3. Origin check na všetkých mutáciách (vlastní A5, D72),
 *   4. pri `auth: 'sudo'` `requireSudo(claims)` — fail-closed (I3),
 *   5. zod validácia vstupu, potom handler.
 *
 * Idle okno session sa obnovuje pri KAŽDOM požiadaní (D69) — pipeline preto
 * použije `verifyAndRefreshSession()` a vrátenú cookie priloží k odpovedi.
 */
export {
  ARGON2_PARAMS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordError,
  assertPasswordPolicy,
  checkPasswordPolicy,
  hashPassword,
  isArgon2idHash,
  needsRehash,
  resetDummyHashCache,
  verifyPassword,
  type Argon2Params,
  type PasswordErrorCode,
  type PasswordPolicyResult,
} from '@/lib/auth/password';

export {
  SESSION_ALG,
  SESSION_AUDIENCE,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
  SESSION_ISSUER,
  SessionError,
  clearedSessionCookie,
  createSessionService,
  issueSession,
  readSessionCookie,
  refreshSession,
  resetDefaultSessionService,
  serializeSessionCookie,
  sessionConfigFromEnv,
  verifyAndRefreshSession,
  verifySession,
  type IssuedSession,
  type IssueSessionInput,
  type SessionConfig,
  type SessionCookie,
  type SessionCookieOptions,
  type SessionErrorCode,
  type SessionService,
} from '@/lib/auth/session';

export {
  SUDO_REQUIRED_CODE,
  SUDO_REQUIRED_MESSAGE,
  SudoRequiredError,
  checkSudo,
  createSudoService,
  grantSudo,
  requireSudo,
  resetDefaultSudoService,
  sudoSecondsLeft,
  sudoWindowMinutes,
  type GrantSudoInput,
  type GrantSudoResult,
  type SudoService,
  type SudoServiceOptions,
} from '@/lib/auth/sudo';

export {
  LOCKOUT_ERROR_CODE,
  LockoutError,
  assertLoginAllowed,
  createLockoutService,
  getLockoutState,
  lockoutMessage,
  lockoutPolicyFromEnv,
  recordLoginFailure,
  recordLoginSuccess,
  resetDefaultLockoutService,
  type AttemptContext,
  type LockoutService,
  type LockoutServiceOptions,
} from '@/lib/auth/lockout';

export {
  DEFAULT_LOCKOUT_POLICY,
  evaluateLockout,
  lockoutMinutesForLevel,
  type AttemptRow,
  type LockoutEvaluation,
  type LockoutPolicy,
} from '@/lib/auth/lockout-policy';

export {
  INVALID_CREDENTIALS_MESSAGE,
  createLoginService,
  login,
  logout,
  resetDefaultLoginService,
  type LoginFailureCode,
  type LoginInput,
  type LoginResult,
  type LoginService,
  type LoginServiceOptions,
} from '@/lib/auth/login';
