/**
 * Aura Zľavy — `defineRoute()`, jediná cesta do route handlerov (A5, §5).
 *
 * Poradie vrstiev je NEMENNÉ (BUILD-SPEC §5):
 *
 *   1. **auth** — `none` / `session` / `sudo`; pri `session`/`sudo` sa session
 *      overí a idle okno sa hneď obnoví (D69), obnovená cookie ide k odpovedi.
 *   2. **lockout / rateLimit** — `preflight` hook (login, sudo: A4
 *      `assertLoginAllowed`) a voliteľný okenný rate limit per IP.
 *   3. **Origin check** — povinný na KAŽDEJ mutácii (POST/PUT/PATCH/DELETE),
 *      druhá vrstva CSRF obrany vedľa `SameSite=Strict` (D72).
 *   4. **zod** — `params`, `query`, `body`; zlyhanie = 400 so zoznamom polí.
 *   5. **handler** — dostane už zvalidovaný vstup a `SessionClaims`.
 *   6. **mapovanie chýb** — `toAppError()` → `fail()`.
 *
 * Invarianty držané tu:
 *  - **I1** — do odpovede nejde nikdy stacktrace ani hodnota z denylistu
 *    redaktora: telo prechádza `redact()` (`responses.ts`), neznáma výnimka sa
 *    zredukuje na 500 `internal_error` bez detailu (`errors.ts`), a do logu ide
 *    len meno chyby + kód, nie jej message.
 *  - **I3** — `auth: 'sudo'` je fail-closed: `requireSudo()` hodí
 *    `SudoRequiredError` (→ 401 `sudo_required`) vždy, keď okno nie je
 *    preukázateľne platné. Neexistuje vetva, ktorá by handler pustila bez sudo.
 *  - **I14** — chyba v pipeline nikdy nevedie k „prejdi ďalej": každá vetva
 *    končí buď `fail()`, alebo handlerom.
 *
 * Poznámka k rate limitu: okenný limiter je in-memory a je určený LEN na
 * tlmenie hrubej sily proti ostatným route-ám. Brute-force lockout na login
 * MUSÍ ísť cez `preflight` do `login_attempts` (KONTRAKT O4) — in-memory stav
 * pre lockout je zakázaný.
 *
 * Vlastník: A5.
 */
import { ZodError, type ZodType } from 'zod';

import type { Logger, SessionClaims, Ulid, UtcDate } from '@/contracts';

import { newRequestId } from '@/lib/shop/correlation';
import { logger as rootLogger } from '@/lib/log/logger';
import {
  readSessionCookie,
  serializeSessionCookie,
  verifyAndRefreshSession,
} from '@/lib/auth/session';
import { requireSudo } from '@/lib/auth/sudo';
import {
  AppError,
  HTTP_ERROR_CODES,
  badRequest,
  forbidden,
  toAppError,
  tooManyRequests,
  validationError,
} from '@/lib/http/errors';
import { fail, ok, REQUEST_ID_HEADER } from '@/lib/http/responses';

/* ═══════════════════════════════ 1. Typy ══════════════════════════════════ */

export type AuthMode = 'none' | 'session' | 'sudo';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Metódy, na ktorých je Origin check povinný (D72). */
export const MUTATION_METHODS: ReadonlySet<string> = new Set<string>([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);

/** Metódy bez tela — telo sa pri nich ani nečíta. */
const BODYLESS_METHODS: ReadonlySet<string> = new Set<string>(['GET', 'HEAD']);

/** Pri `auth:'none'` môže byť session `null`; inak je vždy prítomná. */
type ClaimsFor<TAuth extends AuthMode> = TAuth extends 'none'
  ? SessionClaims | null
  : SessionClaims;

export interface RouteRequestInfo {
  method: string;
  path: string;
  ip: string;
  userAgent: string | null;
  origin: string | null;
}

/** Kontext, ktorý handler dostane. Vstupy sú už zvalidované zodom. */
export interface RouteContext<TAuth extends AuthMode, TBody, TQuery, TParams> {
  readonly request: Request;
  /** ULID, ktorý je aj v logu, aj v hlavičke `X-Request-Id` (D58). */
  readonly requestId: Ulid;
  readonly info: RouteRequestInfo;
  readonly claims: ClaimsFor<TAuth>;
  /** Konec platného sudo okna — nenulový iba pri `auth:'sudo'` (D70). */
  readonly sudoUntil: UtcDate | null;
  readonly body: TBody;
  readonly query: TQuery;
  readonly params: TParams;
  /** Logger s prilepeným `requestId` (a `userId`, keď je session). */
  readonly log: Logger;
  /** Pridá `Set-Cookie` k odpovedi (login, logout). */
  setCookie(serialized: string): void;
  /** Pridá vlastnú hlavičku k odpovedi. */
  setHeader(name: string, value: string): void;
}

/** Handler smie vrátiť dáta (obalia sa do `{ok:true,data}`) alebo vlastnú `Response`. */
export type RouteHandler<TAuth extends AuthMode, TBody, TQuery, TParams, TOut> = (
  ctx: RouteContext<TAuth, TBody, TQuery, TParams>,
) => Promise<TOut | Response> | TOut | Response;

export interface RateLimitRule {
  /** Maximálny počet požiadaviek v okne. */
  limit: number;
  windowMs: number;
  /** Rozlišovací kľúč; default je cesta route. */
  bucket?: string;
}

export interface RouteDefinition<
  TAuth extends AuthMode,
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
  TOut = unknown,
> {
  /** Povolené metódy. Default: `GET` pre route bez tela, inak `POST`. */
  method?: HttpMethod | readonly HttpMethod[];
  auth: TAuth;
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  params?: ZodType<TParams>;
  /** Vrstva 2: lockout (A4) alebo iná kontrola pred Origin checkom a zodom. */
  preflight?: (info: RouteRequestInfo, claims: SessionClaims | null) => Promise<void> | void;
  /** Vrstva 2: okenný limit per IP (nie lockout — ten je v `preflight`). */
  rateLimit?: RateLimitRule;
  /** HTTP status úspešnej odpovede. Default 200. */
  successStatus?: number;
  handler: RouteHandler<TAuth, TBody, TQuery, TParams, TOut>;
}

/** Injektovateľné závislosti — testy nahradia session vrstvu a čas. */
export interface RouteDeps {
  verifySession?: typeof verifyAndRefreshSession;
  requireSudo?: typeof requireSudo;
  newRequestId?: () => Ulid;
  now?: () => Date;
  logger?: Logger;
}

/** Druhý argument Next.js route handlera (Next 16: `params` je Promise). */
export interface NextRouteArgs {
  params?: Record<string, string | string[]> | Promise<Record<string, string | string[]>>;
}

export type NextRouteHandler = (request: Request, args?: NextRouteArgs) => Promise<Response>;

/* ═════════════════════════ 2. Pomocné funkcie ═════════════════════════════ */

/** IP z proxy hlavičiek (Caddy) s fallbackom na `unknown` — nikdy nie prázdny string. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real && real.trim()) return real.trim();
  return 'unknown';
}

/** Host, s ktorým sa `Origin` porovnáva. Za Caddy je to `X-Forwarded-Host`. */
export function expectedHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host');
  if (forwarded && forwarded.trim()) return forwarded.split(',')[0]!.trim().toLowerCase();
  const host = request.headers.get('host');
  if (host && host.trim()) return host.trim().toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

export type OriginVerdict =
  | { ok: true }
  | { ok: false; code: string; message: string; detail?: unknown };

/**
 * Origin check (D72). Fail-closed:
 *  - chýbajúci alebo `null` Origin na mutácii → odmietnuté,
 *  - neparsovateľný Origin → odmietnuté,
 *  - host (vrátane portu) sa musí presne rovnať hostu požiadavky.
 *
 * Zámerne sa NEPOUŽÍVA zoznam povolených originov z ENV: appka je single-origin
 * lokálny nástroj a každý ďalší povolený origin by bola diera v CSRF obrane.
 */
export function checkOrigin(request: Request): OriginVerdict {
  if (!MUTATION_METHODS.has(request.method.toUpperCase())) return { ok: true };

  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') {
    return {
      ok: false,
      code: HTTP_ERROR_CODES.originMissing,
      message:
        'Požiadavka bola odmietnutá: chýba hlavička Origin. Zmeny sa dajú robiť len z otvoreného okna aplikácie (CSRF obrana, D72).',
    };
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return {
      ok: false,
      code: HTTP_ERROR_CODES.originMismatch,
      message:
        'Požiadavka bola odmietnutá: hlavička Origin nie je platná adresa (CSRF obrana, D72).',
    };
  }

  const host = expectedHost(request);
  if (!host || originHost !== host) {
    return {
      ok: false,
      code: HTTP_ERROR_CODES.originMismatch,
      // Do hlášky ani do detailu nedávame prijatý origin celý — stačí, že sa nezhoduje.
      message:
        'Požiadavka bola odmietnutá: Origin nesúhlasí s adresou aplikácie (CSRF obrana, D72).',
    };
  }
  return { ok: true };
}

/** `URLSearchParams` → objekt; opakovaný kľúč sa zbalí do poľa. */
export function queryToObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    out[key] = values.length > 1 ? values : values[0]!;
  }
  return out;
}

/* ─────────────────────────── rate limiter (vrstva 2) ────────────────────── */

interface RateWindow {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateWindow>();

/** Len pre testy a pre reštart procesu — limiter je zámerne bez perzistencie. */
export function resetRateLimiter(): void {
  rateBuckets.clear();
}

export function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  nowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= nowMs) {
    rateBuckets.set(key, { count: 1, resetAt: nowMs + rule.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  if (existing.count > rule.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/* ═══════════════════════════ 3. defineRoute() ═════════════════════════════ */

function allowedMethods(def: { method?: HttpMethod | readonly HttpMethod[] }): Set<string> {
  if (!def.method) return new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  const list = Array.isArray(def.method) ? def.method : [def.method as HttpMethod];
  const set = new Set<string>(list.map((m) => m.toUpperCase()));
  if (set.has('GET')) set.add('HEAD');
  return set;
}

async function resolveParams(args: NextRouteArgs | undefined): Promise<Record<string, unknown>> {
  const raw = args?.params;
  if (!raw) return {};
  return (await raw) as Record<string, unknown>;
}

function parseWith<T>(
  schema: ZodType<T> | undefined,
  value: unknown,
  where: 'body' | 'query' | 'params',
): T {
  if (!schema) return undefined as T;
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) throw validationError(error, where);
    throw error;
  }
}

/**
 * Vytvorí Next.js route handler s celou pipeline. Handler dostane iba
 * zvalidovaný vstup; o statusy, cookie, hlavičky, log a chyby sa stará pipeline.
 */
export function defineRoute<
  TAuth extends AuthMode,
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
  TOut = unknown,
>(
  def: RouteDefinition<TAuth, TBody, TQuery, TParams, TOut>,
  deps: RouteDeps = {},
): NextRouteHandler {
  const methods = allowedMethods(def);
  const verify = deps.verifySession ?? verifyAndRefreshSession;
  const sudoGate = deps.requireSudo ?? requireSudo;
  const makeRequestId = deps.newRequestId ?? newRequestId;
  const now = deps.now ?? (() => new Date());
  const baseLogger = deps.logger ?? rootLogger;

  return async function routeHandler(request: Request, args?: NextRouteArgs): Promise<Response> {
    const startedAt = Date.now();
    const requestId = makeRequestId();
    const method = request.method.toUpperCase();

    let url: URL | null = null;
    try {
      url = new URL(request.url);
    } catch {
      url = null;
    }
    const path = url ? url.pathname : '(neznáma cesta)';

    const info: RouteRequestInfo = {
      method,
      path,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      origin: request.headers.get('origin'),
    };

    const cookies: string[] = [];
    const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };
    let log: Logger = baseLogger.child({ requestId, method, path });

    const finish = (response: Response, status: number, outcome: string, extra: object = {}) => {
      // Každé volanie je zalogované — aj odmietnuté (akceptačné kritérium A5).
      const fields = {
        requestId,
        httpStatus: status,
        durationMs: Date.now() - startedAt,
        outcome,
        ...extra,
      };
      if (status >= 500) log.error('http_request', fields);
      else if (status >= 400) log.warn('http_request', fields);
      else log.info('http_request', fields);
      return response;
    };

    const failWith = (error: unknown, outcome: string): Response => {
      const appError = toAppError(error);
      const response = fail(appError, { headers, cookies });
      return finish(response, appError.httpStatus, outcome, {
        errorCode: appError.code,
        // Message chyby do logu nedávame — mohla by nesť vstup (I1).
        errorName: error instanceof Error ? error.name : typeof error,
      });
    };

    try {
      /* ── 0. metóda ─────────────────────────────────────────────────────── */
      if (!methods.has(method)) {
        return failWith(
          new AppError(
            405,
            HTTP_ERROR_CODES.methodNotAllowed,
            `Metóda ${method} nie je na tejto ceste povolená.`,
            { detail: { allow: [...methods].sort() }, logAsError: false },
          ),
          'method_not_allowed',
        );
      }

      /* ── 1. auth ───────────────────────────────────────────────────────── */
      let claims: SessionClaims | null = null;
      let sudoUntil: UtcDate | null = null;

      if (def.auth !== 'none') {
        const token = readSessionCookie(request.headers.get('cookie'));
        const verified = await verify(token);
        claims = verified.claims;
        cookies.push(serializeSessionCookie(verified.refreshed.cookie));
        log = log.child({ userId: claims.sub });

        if (def.auth === 'sudo') {
          // I3 — fail-closed; `SudoRequiredError` → 401 `sudo_required`.
          sudoUntil = sudoGate(claims, now());
        }
      }

      /* ── 2. lockout / rateLimit ────────────────────────────────────────── */
      if (def.rateLimit) {
        const key = `${def.rateLimit.bucket ?? path}|${info.ip}`;
        const verdict = consumeRateLimit(key, def.rateLimit, now().getTime());
        if (!verdict.allowed) {
          return failWith(
            tooManyRequests(
              `Priveľa požiadaviek. Skús to znova za ${verdict.retryAfterSeconds} s.`,
              verdict.retryAfterSeconds,
            ),
            'rate_limited',
          );
        }
      }
      if (def.preflight) await def.preflight(info, claims);

      /* ── 3. Origin check (D72) ─────────────────────────────────────────── */
      const originVerdict = checkOrigin(request);
      if (!originVerdict.ok) {
        return failWith(
          forbidden(originVerdict.message, originVerdict.code, { logAsError: false }),
          'origin_rejected',
        );
      }

      /* ── 4. zod ────────────────────────────────────────────────────────── */
      const params = parseWith(def.params, await resolveParams(args), 'params');
      const query = parseWith(def.query, url ? queryToObject(url) : {}, 'query');

      let rawBody: unknown = undefined;
      if (def.body && !BODYLESS_METHODS.has(method)) {
        const text = await request.text();
        if (text.length === 0) {
          rawBody = undefined;
        } else {
          try {
            rawBody = JSON.parse(text);
          } catch {
            return failWith(
              badRequest(
                'Telo požiadavky nie je platný JSON.',
                HTTP_ERROR_CODES.malformedJson,
                { logAsError: false },
              ),
              'malformed_json',
            );
          }
        }
      }
      const body = parseWith(def.body, rawBody, 'body');

      /* ── 5. handler ────────────────────────────────────────────────────── */
      const ctx: RouteContext<TAuth, TBody, TQuery, TParams> = {
        request,
        requestId,
        info,
        claims: claims as ClaimsFor<TAuth>,
        sudoUntil,
        body,
        query,
        params,
        log,
        setCookie: (serialized: string) => {
          cookies.push(serialized);
        },
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      };

      const result = await def.handler(ctx);

      if (result instanceof Response) {
        // Handler si vzal serializáciu do vlastných rúk (napr. stream) — doplníme
        // len naše hlavičky a cookie, telo nechávame tak.
        for (const [name, value] of Object.entries(headers)) {
          if (!result.headers.has(name)) result.headers.set(name, value);
        }
        for (const cookie of cookies) result.headers.append('Set-Cookie', cookie);
        return finish(result, result.status, 'ok');
      }

      const status = def.successStatus ?? 200;
      return finish(ok(result, { status, headers, cookies }), status, 'ok');
    } catch (error) {
      /* ── 6. mapovanie chýb ─────────────────────────────────────────────── */
      return failWith(error, 'error');
    }
  };
}
