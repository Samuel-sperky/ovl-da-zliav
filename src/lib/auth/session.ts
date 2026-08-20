/**
 * Aura Zľavy — session (BUILD-SPEC §1/§5/§11, R10, D69, D72, I1).
 *
 * Session je **jose JWT (HS256)** v cookie `ovl_zliav_session` (R10). Server si
 * o session nedrží žiadny stav — všetko je v podpísaných claimoch:
 *
 * ```
 * { sub, username, abs, sudo, iat, exp, iss: 'ovl-zliav', aud: 'ovl-zliav:session' }
 *   abs  = absolútny konec platnosti (8 h od prihlásenia, D69) — NIKDY sa nepredlžuje
 *   exp  = idle konec (30 min, D69) — obnovuje sa pri každom požiadaní, ale
 *          vždy zastropovaný na `abs`
 *   sudo = konec sudo okna (15 min, D70) alebo `null`
 * ```
 *
 * Invarianty a rozhodnutia držané tu:
 *  - **D69** — 8 h absolútna platnosť a 30 min idle timeout súčasne. Refresh
 *    predlžuje výhradne idle; `abs` sa prenáša z pôvodného tokenu a nedá sa
 *    natiahnuť ani vlastným podpisom (kontroluje sa `abs - iat ≤ 8 h`).
 *  - **D69/D72** — cookie je VŽDY `httpOnly`, `Secure`, `SameSite=Strict`.
 *    Nie je to konfigurovateľné a neexistuje „dev" varianta bez `Secure`
 *    (lokálne beží Caddy s `tls internal`, D94). `SameSite=Strict` je prvá
 *    vrstva CSRF obrany; druhou je Origin check v pipeline A5 (D72).
 *  - **I3** — `sudoUntil` je súčasťou podpísaných claimov, takže pipeline
 *    (`auth: 'sudo'`) vie o sudo okne rozhodnúť bez ďalšieho stavu. Pri
 *    akejkoľvek pochybnosti sa vyhodnocuje ako neplatné (viď `sudo.ts`).
 *  - **I1** — token ani cookie sa nikdy nelogujú; `cookie` je v denylistě
 *    redaktora (A2), takže aj náhodný `logger.info({ cookie })` je maskovaný.
 *
 * Podpisový materiál je `SESSION_SECRET_FILE` (§11) — ten istý súbor, z ktorého
 * je podpísaný preview token (§7, O2). Aby sa jeden typ tokenu NIKDY nedal
 * použiť namiesto druhého, session má vlastné `aud` (`ovl-zliav:session`)
 * a overuje ho striktne.
 *
 * Vlastník: A4.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import type { SessionClaims, UtcDate } from '@/contracts';
import { env } from '@/env';
import { loadSessionSecret } from '@/lib/crypto/master-key';

/** R10 — presné meno cookie. */
export const SESSION_COOKIE_NAME = 'ovl_zliav_session';

export const SESSION_ALG = 'HS256';
export const SESSION_ISSUER = 'ovl-zliav';
/** Odlišuje session od preview tokenu podpísaného tým istým secretom (O2). */
export const SESSION_AUDIENCE = 'ovl-zliav:session';

/** Cesta cookie — celá appka. */
export const SESSION_COOKIE_PATH = '/';

export type SessionErrorCode =
  | 'missing'
  | 'invalid'
  | 'idle_expired'
  | 'absolute_expired'
  | 'malformed';

/**
 * Fail-closed chyba session. Pipeline (A5) ju mapuje na 401 — nikdy sa
 * neprehltá a nikdy neobsahuje token (I1).
 */
export class SessionError extends Error {
  readonly code: SessionErrorCode;

  constructor(code: SessionErrorCode, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

/* ────────────────────────────────── cookie ─────────────────────────────── */

/**
 * Atribúty cookie v tvare, ktorý zje `cookies().set()` z Next.js aj vlastná
 * serializácia do hlavičky `Set-Cookie`.
 */
export interface SessionCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: 'strict';
  path: string;
  maxAge: number;
}

export interface SessionCookie {
  name: typeof SESSION_COOKIE_NAME;
  value: string;
  options: SessionCookieOptions;
}

function cookieOptions(maxAgeSeconds: number): SessionCookieOptions {
  return {
    // Všetky tri atribúty sú povinné a nekonfigurovateľné (D69, D72).
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: SESSION_COOKIE_PATH,
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

/** Serializácia do hlavičky `Set-Cookie` (pre `defineRoute()` bez Next cookies API). */
export function serializeSessionCookie(cookie: SessionCookie): string {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Path=${cookie.options.path}`,
    `Max-Age=${cookie.options.maxAge}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ];
  return parts.join('; ');
}

/** Cookie, ktorá session okamžite zruší (logout, D69). */
export function clearedSessionCookie(): SessionCookie {
  return { name: SESSION_COOKIE_NAME, value: '', options: cookieOptions(0) };
}

/**
 * Vytiahne token z hlavičky `Cookie`. Vracia `null`, keď tam nie je — volajúci
 * to má vyhodnotiť ako „neprihlásený" (fail-closed).
 */
export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return null;
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=');
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = pair.slice(index + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/* ────────────────────────────── konfigurácia ───────────────────────────── */

export interface SessionConfig {
  /** D69 — absolútna platnosť v hodinách (default `SESSION_ABSOLUTE_HOURS` = 8). */
  absoluteHours: number;
  /** D69 — idle timeout v minútach (default `SESSION_IDLE_MINUTES` = 30). */
  idleMinutes: number;
  /** D70 — sudo okno v minútach (default `SUDO_WINDOW_MINUTES` = 15). */
  sudoWindowMinutes: number;
}

/** Konfigurácia z ENV (§11). Číta sa lazy, aby import nezhodil build. */
export function sessionConfigFromEnv(): SessionConfig {
  return {
    absoluteHours: env.SESSION_ABSOLUTE_HOURS,
    idleMinutes: env.SESSION_IDLE_MINUTES,
    sudoWindowMinutes: env.SUDO_WINDOW_MINUTES,
  };
}

export interface IssuedSession {
  token: string;
  claims: SessionClaims;
  cookie: SessionCookie;
}

export interface IssueSessionInput {
  userId: number;
  username: string;
  /** Konec sudo okna. `undefined` = odvodí sa z konfigurácie (prihlásenie = sudo OK). */
  sudoUntil?: UtcDate | null;
  /** Zachovanie absolútneho konca pri refreshi. Bez neho `now + absoluteHours`. */
  absoluteExpiresAt?: UtcDate;
}

const SECOND = 1000;

const toEpochSeconds = (date: Date): number => Math.floor(date.getTime() / SECOND);

/* ──────────────────────────────── služba ───────────────────────────────── */

export interface SessionServiceOptions {
  /** Podpisový materiál. Default = `SESSION_SECRET_FILE` (§11). */
  secret?: Buffer | (() => Buffer);
  /** Prepis konfigurácie (testy). Default = ENV. */
  config?: Partial<SessionConfig>;
  /** Injektovateľný čas pre testy. */
  now?: () => Date;
}

export interface SessionService {
  readonly config: SessionConfig;
  /** Nová session po úspešnom prihlásení alebo po refreshi (D69). */
  issue(input: IssueSessionInput): Promise<IssuedSession>;
  /**
   * Overí podpis, `aud`/`iss`, idle `exp` aj absolútny `abs` (D69).
   * Hodí `SessionError` — nikdy nevracia „skoro platnú" session (fail-closed).
   */
  verify(token: string | null | undefined): Promise<SessionClaims>;
  /**
   * Obnoví idle okno pri každom požiadaní (D69). `abs` sa prenáša nezmenený,
   * takže po 8 h od prihlásenia už refresh session neudrží.
   */
  refresh(claims: SessionClaims): Promise<IssuedSession>;
  /** Overí token a hneď obnoví idle okno — to, čo potrebuje pipeline (A5). */
  verifyAndRefresh(token: string | null | undefined): Promise<{
    claims: SessionClaims;
    refreshed: IssuedSession;
  }>;
}

export function createSessionService(options: SessionServiceOptions = {}): SessionService {
  const now = options.now ?? (() => new Date());

  /**
   * Konfigurácia: dodané hodnoty majú prednosť, zvyšok ide z ENV. Keď test dodá
   * všetky tri, `env` sa vôbec nečíta (a naopak — zlý ENV nikto neprehltá, I14).
   */
  const configOf = (): SessionConfig => {
    const given = options.config;
    if (
      given &&
      given.absoluteHours !== undefined &&
      given.idleMinutes !== undefined &&
      given.sudoWindowMinutes !== undefined
    ) {
      return {
        absoluteHours: given.absoluteHours,
        idleMinutes: given.idleMinutes,
        sudoWindowMinutes: given.sudoWindowMinutes,
      };
    }
    const fromEnv = sessionConfigFromEnv();
    return {
      absoluteHours: given?.absoluteHours ?? fromEnv.absoluteHours,
      idleMinutes: given?.idleMinutes ?? fromEnv.idleMinutes,
      sudoWindowMinutes: given?.sudoWindowMinutes ?? fromEnv.sudoWindowMinutes,
    };
  };

  const secretOf = (): Uint8Array => {
    const raw = typeof options.secret === 'function' ? options.secret() : options.secret;
    const material = raw ?? loadSessionSecret();
    // Kópia — memoizovaný session secret nikto nesmie omylom prepísať.
    return Uint8Array.from(material);
  };

  const service: SessionService = {
    get config() {
      return configOf();
    },

    async issue(input: IssueSessionInput): Promise<IssuedSession> {
      const config = configOf();
      if (!Number.isInteger(input.userId) || input.userId <= 0) {
        throw new SessionError('malformed', 'Session potrebuje ID prihláseného usera.');
      }
      if (typeof input.username !== 'string' || input.username.length === 0) {
        throw new SessionError('malformed', 'Session potrebuje prihlasovacie meno.');
      }

      const issuedAt = now();
      const absoluteExpiresAt =
        input.absoluteExpiresAt ??
        new Date(issuedAt.getTime() + config.absoluteHours * 3_600 * SECOND);

      // Idle okno nikdy nesmie presiahnuť absolútny konec (D69).
      const idleCandidate = new Date(issuedAt.getTime() + config.idleMinutes * 60 * SECOND);
      const idleExpiresAt =
        idleCandidate.getTime() > absoluteExpiresAt.getTime() ? absoluteExpiresAt : idleCandidate;

      if (absoluteExpiresAt.getTime() <= issuedAt.getTime()) {
        throw new SessionError(
          'absolute_expired',
          'Absolútna platnosť session už uplynula — vyžaduje sa nové prihlásenie (D69).',
        );
      }

      // Sudo okno sa nikdy nesmie tiahnuť za absolútny konec session.
      const sudoRequested =
        input.sudoUntil === undefined
          ? new Date(issuedAt.getTime() + config.sudoWindowMinutes * 60 * SECOND)
          : input.sudoUntil;
      let sudoUntil: UtcDate | null = null;
      if (sudoRequested) {
        const capped = Math.min(sudoRequested.getTime(), absoluteExpiresAt.getTime());
        sudoUntil = capped > issuedAt.getTime() ? new Date(capped) : null;
      }

      const iat = toEpochSeconds(issuedAt);
      const token = await new SignJWT({
        username: input.username,
        abs: toEpochSeconds(absoluteExpiresAt),
        sudo: sudoUntil ? toEpochSeconds(sudoUntil) : null,
      })
        .setProtectedHeader({ alg: SESSION_ALG, typ: 'JWT' })
        .setIssuer(SESSION_ISSUER)
        .setAudience(SESSION_AUDIENCE)
        .setSubject(String(input.userId))
        .setIssuedAt(iat)
        .setNotBefore(iat)
        .setExpirationTime(toEpochSeconds(idleExpiresAt))
        .sign(secretOf());

      const claims: SessionClaims = {
        sub: input.userId,
        username: input.username,
        absoluteExpiresAt,
        idleExpiresAt,
        sudoUntil,
      };

      const maxAge = Math.max(
        0,
        Math.floor((idleExpiresAt.getTime() - issuedAt.getTime()) / SECOND),
      );

      return { token, claims, cookie: { name: SESSION_COOKIE_NAME, value: token, options: cookieOptions(maxAge) } };
    },

    async verify(token: string | null | undefined): Promise<SessionClaims> {
      if (typeof token !== 'string' || token.length === 0) {
        throw new SessionError('missing', 'Chýba session cookie — prihlás sa (D69).');
      }
      const config = configOf();

      let payload: JWTPayload;
      try {
        const result = await jwtVerify(token, secretOf(), {
          algorithms: [SESSION_ALG],
          issuer: SESSION_ISSUER,
          audience: SESSION_AUDIENCE,
          clockTolerance: 0,
          currentDate: now(),
        });
        payload = result.payload;
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code === 'ERR_JWT_EXPIRED') {
          throw new SessionError(
            'idle_expired',
            `Session vypršala nečinnosťou (${config.idleMinutes} min) — prihlás sa znova (D69).`,
          );
        }
        throw new SessionError(
          'invalid',
          'Session cookie je neplatná alebo pozmenená — prihlás sa znova (D69).',
        );
      }

      const sub = Number(payload.sub);
      const username = payload.username;
      const abs = payload.abs;
      const exp = payload.exp;
      const iat = payload.iat;
      const sudo = payload.sudo ?? null;

      if (
        !Number.isInteger(sub) ||
        sub <= 0 ||
        typeof username !== 'string' ||
        username.length === 0 ||
        typeof abs !== 'number' ||
        typeof exp !== 'number' ||
        typeof iat !== 'number' ||
        (sudo !== null && typeof sudo !== 'number')
      ) {
        throw new SessionError('malformed', 'Session cookie nemá očakávané claims (D69).');
      }

      // Ani vlastný podpis nesmie natiahnuť okná nad limity z D69.
      const maxIdleSeconds = config.idleMinutes * 60;
      const maxAbsoluteSeconds = config.absoluteHours * 3_600;
      if (exp - iat > maxIdleSeconds || abs - iat > maxAbsoluteSeconds) {
        throw new SessionError(
          'malformed',
          `Session má neplatnú životnosť — idle max ${config.idleMinutes} min, ` +
            `absolútne max ${config.absoluteHours} h (D69).`,
        );
      }

      const nowSeconds = toEpochSeconds(now());
      if (nowSeconds >= abs) {
        throw new SessionError(
          'absolute_expired',
          `Session prekročila absolútnu platnosť ${config.absoluteHours} h — prihlás sa znova (D69).`,
        );
      }

      const sudoUntil = typeof sudo === 'number' ? new Date(sudo * SECOND) : null;

      return {
        sub,
        username,
        absoluteExpiresAt: new Date(abs * SECOND),
        idleExpiresAt: new Date(exp * SECOND),
        // Expirované sudo okno sa nesie ako `null` — `sudo.ts` aj tak overuje čas.
        sudoUntil: sudoUntil && sudoUntil.getTime() > now().getTime() ? sudoUntil : null,
      };
    },

    async refresh(claims: SessionClaims): Promise<IssuedSession> {
      return service.issue({
        userId: claims.sub,
        username: claims.username,
        // `abs` sa PRENÁŠA — refresh nikdy nepredlžuje absolútnu platnosť (D69).
        absoluteExpiresAt: claims.absoluteExpiresAt,
        sudoUntil: claims.sudoUntil,
      });
    },

    async verifyAndRefresh(token: string | null | undefined) {
      const claims = await service.verify(token);
      const refreshed = await service.refresh(claims);
      return { claims: refreshed.claims, refreshed };
    },
  };

  return service;
}

/* ───────────────────────────── default instancia ───────────────────────── */

let defaultService: SessionService | null = null;

function getDefaultService(): SessionService {
  if (!defaultService) defaultService = createSessionService();
  return defaultService;
}

/** Nová session (po prihlásení / po sudo potvrdení). */
export const issueSession = (input: IssueSessionInput): Promise<IssuedSession> =>
  getDefaultService().issue(input);

/** Overenie session cookie. Hodí `SessionError` (fail-closed). */
export const verifySession = (token: string | null | undefined): Promise<SessionClaims> =>
  getDefaultService().verify(token);

/** Obnovenie idle okna pri každom požiadaní (D69). */
export const refreshSession = (claims: SessionClaims): Promise<IssuedSession> =>
  getDefaultService().refresh(claims);

/** Overenie + obnova v jednom kroku — pre `defineRoute()` (A5). */
export const verifyAndRefreshSession = (
  token: string | null | undefined,
): Promise<{ claims: SessionClaims; refreshed: IssuedSession }> =>
  getDefaultService().verifyAndRefresh(token);

/** Výhradne pre testy — zabudne default instanciu (napr. po zmene ENV). */
export function resetDefaultSessionService(): void {
  defaultService = null;
}
