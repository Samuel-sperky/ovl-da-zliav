/**
 * Aura Zľavy — jednotný tvar odpovedí appky (A5, BUILD-SPEC §2, §5).
 *
 *   úspech:  `{ ok: true,  data: … }`
 *   chyba:   `{ ok: false, error: { code, message, detail? } }`
 *
 * Iný tvar odpovede route handler vrátiť NESMIE. `ok()`/`fail()` sú jediné dve
 * fabriky; `defineRoute()` ich používa interne, takže handler smie vrátiť aj
 * holé dáta.
 *
 * Invarianty držané tu:
 *  - **I1** — každé telo prechádza `redact()` (aj úspešné: `/api/audit/[id]`
 *    vracia `after_snapshot` s raw odpoveďou shopu, D50). Nikdy sa neposiela
 *    `stack`.
 *  - Odpovede sú vždy `no-store`: appka je lokálny nástroj a žiadna odpoveď
 *    nesmie skončiť v cache prehliadača ani v Caddy.
 *
 * Vlastník: A5.
 */
import type { ApiResponse } from '@/contracts';

import { redact } from '@/lib/log/redact';
import { AppError, toAppError } from '@/lib/http/errors';

/** Hlavička, v ktorej sa vracia `request_id` na koreláciu s logom a auditom (D58). */
export const REQUEST_ID_HEADER = 'X-Request-Id';

export interface ResponseInitLike {
  status?: number;
  headers?: Record<string, string>;
  /** `Set-Cookie` hodnoty — obnovená session cookie (D69). Môže byť viac. */
  cookies?: string[];
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function buildHeaders(init: ResponseInitLike): Headers {
  const headers = new Headers();
  headers.set('Content-Type', JSON_CONTENT_TYPE);
  // Žiadna odpoveď appky sa necachuje.
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    headers.set(name, value);
  }
  for (const cookie of init.cookies ?? []) {
    headers.append('Set-Cookie', cookie);
  }
  return headers;
}

/** Serializácia tela s redakciou (I1). */
function jsonResponse(body: unknown, status: number, init: ResponseInitLike): Response {
  return new Response(JSON.stringify(redact(body)), {
    status,
    headers: buildHeaders(init),
  });
}

/** `{ ok: true, data }`. `data === undefined` sa serializuje ako `{}` (§5). */
export function ok<T>(data: T, init: ResponseInitLike = {}): Response {
  const body: ApiResponse<T> = { ok: true, data: (data ?? {}) as T };
  return jsonResponse(body, init.status ?? 200, init);
}

/** Telo `{ok:false,error}` bez obálky `Response` — pre testy a pre logovanie. */
export function failBody(error: unknown): ApiResponse<never> {
  return { ok: false, error: toAppError(error).toBody() };
}

/**
 * `{ ok: false, error: { code, message, detail? } }`. Status berie z `AppError`
 * (neznáma výnimka = 500 `internal_error`), `Retry-After` doplní pri 429.
 */
export function fail(error: unknown, init: ResponseInitLike = {}): Response {
  const appError = error instanceof AppError ? error : toAppError(error);
  const headers = { ...(init.headers ?? {}) };
  if (appError.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(appError.retryAfterSeconds);
  }
  const body: ApiResponse<never> = { ok: false, error: appError.toBody() };
  return jsonResponse(body, init.status ?? appError.httpStatus, { ...init, headers });
}

/** Prázdna úspešná odpoveď — `{ok:true,data:{}}` (logout, ack, mark-unknown). */
export const okEmpty = (init: ResponseInitLike = {}): Response => ok({}, init);
