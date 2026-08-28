/**
 * Aura Zľavy — `defineRoute()`, jediná cesta do route handlerov (A5, §5).
 *
 * Poradie vrstiev je NEMENNÉ (BUILD-SPEC §5):
 *
 *   1. **actor** — dohľadá sa lokálny actor (D102). Prihlásenie appka nemá
 *      (D99); actora vyžaduje DB (FK na `users.id`) aj audit (I11).
 *      **Mutácia** ho dohľadá HNEĎ a bez neho neprejde (fail-closed).
 *      **Čítanie** ho dohľadá fail-soft a len keď ho handler naozaj chce —
 *      dôvod je pri vrstve 1 nižšie (27. 8. 2026).
 *   2. **rateLimit** — `preflight` hook a voliteľný okenný limit per IP.
 *   3. **Origin check** — povinný na KAŽDEJ mutácii (POST/PUT/PATCH/DELETE),
 *      druhá vrstva CSRF obrany vedľa `SameSite=Strict` (D72).
 *   4. **zod** — `params`, `query`, `body`; zlyhanie = 400 so zoznamom polí.
 *   5. **handler** — dostane už zvalidovaný vstup a `LocalActor`.
 *   6. **mapovanie chýb** — `toAppError()` → `fail()`.
 *
 * Invarianty držané tu:
 *  - **I1** — do odpovede nejde nikdy stacktrace ani hodnota z denylistu
 *    redaktora: telo prechádza `redact()` (`responses.ts`), neznáma výnimka sa
 *    zredukuje na 500 `internal_error` bez detailu (`errors.ts`), a do logu ide
 *    len meno chyby + kód, nie jej message.
 *  - **I3** — od 27. 8. 2026 znie „žiadny zápis bez dry-runu a potvrdenia"
 *    (D100 zrušilo sudo). Sudo brána, ktorá tu stála, zmizla; potvrdenie
 *    zápisu drží `assertConfirmed()` v engine, nie táto pipeline. Fail-closed
 *    tu zostáva na actorovi: bez actora request skončí chybou, nie zápisom.
 *  - **I14** — chyba v pipeline nikdy nevedie k „prejdi ďalej": každá vetva
 *    končí buď `fail()`, alebo handlerom.
 *
 * Poznámka k rate limitu: okenný limiter je in-memory a tlmí hrubú silu proti
 * route-ám. Brute-force lockout na login tu kedysi bol povinný cez `preflight`
 * (KONTRAKT O4); prihlásenie zmizlo (D99), takže lockout s ním.
 *
 * Vlastník: A5.
 */
import { ZodError, type ZodType } from 'zod';

import type { LocalActor, Logger, Ulid } from '@/contracts';

import { newRequestId } from '@/lib/shop/correlation';
import { logger as rootLogger } from '@/lib/log/logger';
import {
  localActor as defaultLocalActor,
  localActorMissingError,
  type LocalActorLookupOptions,
} from '@/lib/auth/local-actor';
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

export interface RouteRequestInfo {
  method: string;
  path: string;
  ip: string;
  userAgent: string | null;
  origin: string | null;
}

/** Kontext, ktorý handler dostane. Vstupy sú už zvalidované zodom. */
export interface RouteContext<TBody, TQuery, TParams> {
  readonly request: Request;
  /** ULID, ktorý je aj v logu, aj v hlavičke `X-Request-Id` (D58). */
  readonly requestId: Ulid;
  readonly info: RouteRequestInfo;
  /**
   * Kto to robí (D102). Na mutácii je vždy prítomný — appka nemá prihlásenie
   * (D99), ale `campaigns.created_by` a `audit_log.user_id` actora vyžadujú
   * (FK), a audit bez actora by bol „nevieme" (I11).
   *
   * Na ČÍTACEJ ceste je to getter, ktorý HODÍ, keď sa actor nedal dohľadať
   * (napr. DB je dole). Read handler, ktorý actora nepotrebuje — a to je dnes
   * každý — sa o výpadku nedozvie a odpovie normálne; ten, ktorý ho číta,
   * skončí chybou. Nikdy nie vymysleným actorom (27. 8. 2026).
   */
  readonly actor: LocalActor;
  readonly body: TBody;
  readonly query: TQuery;
  readonly params: TParams;
  /** Logger s prilepeným `requestId` a `userId` lokálneho actora. */
  readonly log: Logger;
  /** Pridá `Set-Cookie` k odpovedi. */
  setCookie(serialized: string): void;
  /** Pridá vlastnú hlavičku k odpovedi. */
  setHeader(name: string, value: string): void;
}

/** Handler smie vrátiť dáta (obalia sa do `{ok:true,data}`) alebo vlastnú `Response`. */
export type RouteHandler<TBody, TQuery, TParams, TOut> = (
  ctx: RouteContext<TBody, TQuery, TParams>,
) => Promise<TOut | Response> | TOut | Response;

export interface RateLimitRule {
  /** Maximálny počet požiadaviek v okne. */
  limit: number;
  windowMs: number;
  /** Rozlišovací kľúč; default je cesta route. */
  bucket?: string;
}

export interface RouteDefinition<
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
  TOut = unknown,
> {
  /** Povolené metódy. Default: `GET` pre route bez tela, inak `POST`. */
  method?: HttpMethod | readonly HttpMethod[];
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  params?: ZodType<TParams>;
  /** Vrstva 2: lockout (A4) alebo iná kontrola pred Origin checkom a zodom. */
  preflight?: (info: RouteRequestInfo) => Promise<void> | void;
  /** Vrstva 2: okenný limit per IP (nie lockout — ten je v `preflight`). */
  rateLimit?: RateLimitRule;
  /** HTTP status úspešnej odpovede. Default 200. */
  successStatus?: number;
  handler: RouteHandler<TBody, TQuery, TParams, TOut>;
}

/** Injektovateľné závislosti — testy nahradia session vrstvu a čas. */
export interface RouteDeps {
  /**
   * Výhradne pre testy: actor namiesto dohľadania v DB. Pipeline posiela
   * `{ create: true }` na mutácii a `{ create: false }` na čítaní; testový stub
   * argument bežne ignoruje.
   */
  localActor?: (opts?: LocalActorLookupOptions) => Promise<LocalActor | null>;
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
    // `X-Forwarded-For` je zoznam „client, proxy1, proxy2, …": ĽAVÉ tokeny
    // posiela klient a môže si ich podvrhnúť (rotáciou by obišiel rate limit
    // a zašpinil IP v audite — S1). Dôveryhodný je len PRAVÝ (posledný)
    // token: ten pridal náš Caddy, jediná proxy priamo pred appkou.
    const parts = forwarded.split(',');
    const last = parts[parts.length - 1]?.trim();
    if (last) return last;
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
  TBody = undefined,
  TQuery = undefined,
  TParams = undefined,
  TOut = unknown,
>(
  def: RouteDefinition<TBody, TQuery, TParams, TOut>,
  deps: RouteDeps = {},
): NextRouteHandler {
  const methods = allowedMethods(def);
  const resolveActor = deps.localActor ?? defaultLocalActor;
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

      /* ── 1. actor (D102) ───────────────────────────────────────────────── */
      /*
       * Tu do 27. 8. 2026 stálo overenie session a sudo okna. Appka prihlásenie
       * nemá (D99) — ostáva otázka „kto to zapísal", ktorú DB vynucuje cez FK
       * na `users(id)` a I11 vyžaduje pre audit. Odpoveď dáva local-actor.
       *
       * Fail-closed sa NEZMENILO, len sa presunulo: keď actor na MUTÁCII
       * neexistuje a nedá sa vyrobiť, request skončí chybou — nikdy nie
       * anonymným zápisom.
       *
       * ČÍTANIE JE FAIL-SOFT (27. 8. 2026, druhá vlna). Dohľadanie actora ide
       * do DB poolu, takže kým bolo bezpodmienečné, mala táto vrstva dva
       * nechcené dôsledky:
       *
       *  1. Pri nedostupnej MariaDB skončil `GET /api/health` ako 500
       *     `internal_error`, hoci route sľubuje, že kvôli DB výpadku 500
       *     nikdy nehodí. Docker healthcheck by appku poslal do restart loopu
       *     presne vtedy, keď má appka povedať „DB je dole" — a „nevieme" je
       *     horšia odpoveď než odpoveď (I11).
       *  2. Na čerstvej inštalácii spravil obyčajný `GET` `INSERT INTO users`.
       *     Riadok patrí zápisovej ceste, nie otázke „ako sa appke vodí".
       *
       * Preto sa na čítaní actor len DOHĽADÁ (`create: false`, teda žiadny
       * INSERT) a chyba sa odloží do `ctx.actor`. Read handler, ktorý actora
       * nečíta, odpovie; ten, ktorý ho číta, dostane chybu. Dnes ho nečíta ani
       * jeden — všetkých 33 miest s `ctx.actor.id` sú mutácie.
       */
      const needsActorUpfront = MUTATION_METHODS.has(method);
      let resolvedActor: LocalActor | null = null;
      let actorFailure: unknown = null;
      if (needsActorUpfront) {
        resolvedActor = await resolveActor({ create: true });
        // Stub alebo budúca implementácia môže vrátiť `null` — na zápisovej
        // ceste je to to isté ako výnimka, nie dôvod pokračovať (I14).
        if (resolvedActor === null) throw localActorMissingError();
      } else {
        try {
          resolvedActor = await resolveActor({ create: false });
        } catch (error) {
          actorFailure = error;
        }
      }
      if (resolvedActor !== null) log = log.child({ userId: resolvedActor.id });

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
      if (def.preflight) await def.preflight(info);

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
      const ctx: RouteContext<TBody, TQuery, TParams> = {
        request,
        requestId,
        info,
        get actor(): LocalActor {
          if (resolvedActor !== null) return resolvedActor;
          // Fail-closed: handler, ktorý actora chce, ho nedostane vymysleného.
          if (actorFailure !== null) throw actorFailure;
          throw localActorMissingError();
        },
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
