/**
 * Aura Zľavy — chybový model HTTP vrstvy (A5, BUILD-SPEC §5, §2).
 *
 * Jediný typ chyby, ktorý smie určiť HTTP status a kód odpovede, je `AppError`.
 * Všetko ostatné (`ZodError`, `ShopRequestError`, ľubovoľná neodchytená
 * výnimka) sa na `AppError` mapuje funkciou `toAppError()`.
 *
 * Do 27. 8. 2026 sa tu mapovali aj `SessionError`, `SudoRequiredError`
 * a `LockoutError`. Prihlásenie a lockout zmazala D99 (ruší D68, D69, D71),
 * sudo D100 (ruší D70) — a mapovanie chyby, ktorú nič neprodukuje, tvrdí
 * o appke niečo nepravdivé. (D101 je iná vec: „tabuľka `users` zostáva".)
 *
 * Invarianty držané tu:
 *  - **I1** — z chyby sa do odpovede NIKDY nedostane `stack`, `cause` ani raw
 *    hodnota výnimky. `detail` prechádza `redact()` a pri neznámej výnimke sa
 *    `detail` nevytvára vôbec (fail-closed). Message neznámej výnimky sa
 *    zahodí a nahradí generickou slovenskou vetou.
 *  - **I3** — po zrušení sudo (D100) znie „žiadny zápis bez dry-runu
 *    a potvrdenia"; potvrdenie drží `assertConfirmed()` v engine, nie tento súbor.
 *  - **I11** — hlášky o stave zľavy tu nevznikajú; slovenské vety pre chyby
 *    shopu vlastní A3 (`lib/shop/messages.sk.ts`) a my ich len preberáme.
 *
 * Vlastník: A5.
 */
import { ZodError, type ZodIssue } from 'zod';

import { redact } from '@/lib/log/redact';
import { isShopRequestError, ShopConfigError } from '@/lib/shop/errors';
import type { ShopError, ShopErrorKind } from '@/contracts';

/* ═══════════════════════════ 1. Katalóg kódov ═════════════════════════════ */

/**
 * Kódy chýb appky. Zoznam je úmyselne otvorený (`string` v `AppError`), pretože
 * doménové moduly (engine, repozitáre) prinášajú vlastné kódy typu
 * `allowlist_full`; tieto sú tie, ktoré vznikajú v samotnej pipeline.
 */
export const HTTP_ERROR_CODES = {
  /** Zod validácia vstupu zlyhala (§5). */
  validationFailed: 'validation_failed',
  /** Chýbajúca/neplatná/expirovaná session (D69). */
  unauthorized: 'unauthorized',
  /* 27. 8. 2026: `sudoRequired: 'sudo_required'` zmazané — sudo zrušila D100
     (I3 znie „dry-run + potvrdenie") a ten kód už nič nevyrobí. */
  /** Mutácia bez hlavičky `Origin` (D72). */
  originMissing: 'origin_missing',
  /** `Origin` nesúhlasí s hostom požiadavky (D72). */
  originMismatch: 'origin_mismatch',
  /** Route nepodporuje použitú HTTP metódu. */
  methodNotAllowed: 'method_not_allowed',
  /** Telo nie je platný JSON. */
  malformedJson: 'malformed_json',
  /** Lockout aj generický rate limit (D71). */
  tooManyRequests: 'too_many_attempts',
  /** Neznáma/neodchytená výnimka — nikdy nenesie detaily (I1). */
  internal: 'internal_error',
  /** Chyba komunikácie so shopom (hlášku vlastní A3). */
  shopError: 'shop_error',
  /** Lokálna konfigurácia shopu chýba (doména nie je potvrdená, D80). */
  shopNotConfigured: 'shop_not_configured',
} as const;

export type HttpErrorCode = (typeof HTTP_ERROR_CODES)[keyof typeof HTTP_ERROR_CODES];

/** Generická veta pre neznámu výnimku — nikdy neprezradí nič o príčine (I1). */
export const INTERNAL_ERROR_MESSAGE =
  'Nastala neočakávaná chyba. Nič sa nezapísalo do shopu; detaily sú v serverovom logu a v audite.';

/* ══════════════════════════════ 2. AppError ═══════════════════════════════ */

export interface AppErrorOptions {
  /** Doplnkové (už bezpečné) dáta pre UI — prechádzajú `redact()`. */
  detail?: unknown;
  /** Hodnota hlavičky `Retry-After` v sekundách (429, D71, D42). */
  retryAfterSeconds?: number;
  /** Pôvodná výnimka. Zostáva LEN pre log — do odpovede sa nikdy nedostane. */
  cause?: unknown;
  /** `false` = chybu netreba logovať ako `error` (očakávané 4xx). */
  logAsError?: boolean;
}

/**
 * Chyba s explicitným HTTP statusom a kódom. Iba tieto sa serializujú do
 * `{ok:false,error:{code,message,detail?}}`.
 */
export class AppError extends Error {
  readonly httpStatus: number;
  readonly code: string;
  readonly detail: unknown;
  readonly retryAfterSeconds: number | undefined;
  readonly logAsError: boolean;

  constructor(httpStatus: number, code: string, message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = 'AppError';
    this.httpStatus = httpStatus;
    this.code = code;
    // Redakcia už tu, aby sa neredigovaný detail nedal vytiahnuť ani cez log (I1).
    this.detail = options.detail === undefined ? undefined : redact(options.detail);
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.logAsError = options.logAsError ?? httpStatus >= 500;
    if (options.cause !== undefined) {
      // `cause` je neenumerovateľné, takže sa nedostane do JSON serializácie.
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false });
    }
  }

  /** Tvar pre `fail()` — bez `stack`, bez `cause` (I1). */
  toBody(): { code: string; message: string; detail?: unknown } {
    return this.detail === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, detail: this.detail };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/* ════════════════════════════ 3. Fabriky 4xx/5xx ══════════════════════════ */

export const badRequest = (
  message: string,
  code = 'bad_request',
  options: AppErrorOptions = {},
): AppError => new AppError(400, code, message, options);

export const unauthorized = (
  message = 'Prihlásenie je neplatné alebo vypršalo. Prihlás sa znova.',
  code: string = HTTP_ERROR_CODES.unauthorized,
  options: AppErrorOptions = {},
): AppError => new AppError(401, code, message, options);

export const forbidden = (
  message: string,
  code = 'forbidden',
  options: AppErrorOptions = {},
): AppError => new AppError(403, code, message, options);

export const notFound = (
  message = 'Požadovaný záznam neexistuje.',
  code = 'not_found',
  options: AppErrorOptions = {},
): AppError => new AppError(404, code, message, options);

export const conflict = (
  message: string,
  code = 'conflict',
  options: AppErrorOptions = {},
): AppError => new AppError(409, code, message, options);

export const tooManyRequests = (
  message: string,
  retryAfterSeconds: number,
  code: string = HTTP_ERROR_CODES.tooManyRequests,
  options: AppErrorOptions = {},
): AppError =>
  new AppError(429, code, message, {
    ...options,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
  });

export const internalError = (options: AppErrorOptions = {}): AppError =>
  new AppError(500, HTTP_ERROR_CODES.internal, INTERNAL_ERROR_MESSAGE, {
    ...options,
    // Detail neznámej výnimky sa NIKDY neposiela (I1).
    detail: undefined,
    logAsError: true,
  });

export const serviceUnavailable = (
  message: string,
  code = 'service_unavailable',
  options: AppErrorOptions = {},
): AppError => new AppError(503, code, message, options);

/* ═════════════════════════ 4. Zod → 400 so poľami ═════════════════════════ */

/** Jedno pole v `detail.fields` — cesta + kód + slovenská/zod hláška. */
export interface FieldIssue {
  path: string;
  code: string;
  message: string;
}

const issuePath = (issue: ZodIssue): string =>
  issue.path.length === 0 ? '(root)' : issue.path.map((p) => String(p)).join('.');

/**
 * Zod issues → zoznam polí. Do odpovede ide LEN cesta, kód a hláška — nikdy
 * `received`/`input`, ktoré by mohli obsahovať samotný API kľúč (I1, `/api/key`).
 */
export function fieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issuePath(issue),
    code: String(issue.code),
    message: issue.message,
  }));
}

export interface ValidationSource {
  /** Kde vstup zlyhal — pre UI aj pre log. */
  source: 'body' | 'query' | 'params';
}

export function validationError(error: ZodError, where: ValidationSource['source']): AppError {
  const fields = fieldIssues(error);
  return new AppError(
    400,
    HTTP_ERROR_CODES.validationFailed,
    `Vstup nie je platný (${fields.length} ${fields.length === 1 ? 'pole' : 'polí'}). Oprav vyznačené polia a skús to znova.`,
    { detail: { source: where, fields }, cause: error, logAsError: false },
  );
}

/* ═════════════════════════ 5. Shop chyby → HTTP ═══════════════════════════ */

/**
 * Mapovanie taxonómie A3 na HTTP status appky. Slovenské hlášky NEDUPLIKUJEME —
 * berieme `ShopError.message` (D47, vlastní A3).
 */
const SHOP_KIND_STATUS: Record<ShopErrorKind, number> = {
  rate_limited: 429,
  server_error: 502,
  network: 502,
  timeout_before: 504,
  timeout_after: 504,
  bad_request: 400,
  unauthorized: 502,
  forbidden: 502,
  not_found: 404,
  schema_drift: 502,
  batch_not_allowed: 502,
};

export function shopErrorToAppError(shopError: ShopError): AppError {
  const status = SHOP_KIND_STATUS[shopError.kind] ?? 502;
  const detail: Record<string, unknown> = {
    kind: shopError.kind,
    shopCode: shopError.code,
    httpStatus: shopError.httpStatus,
    retryable: shopError.retryable,
  };
  if (shopError.requestId !== undefined) detail.requestId = shopError.requestId;
  const options: AppErrorOptions = { detail, logAsError: status >= 500 };
  if (status === 429 && shopError.retryAfterSeconds !== undefined) {
    options.retryAfterSeconds = shopError.retryAfterSeconds;
  }
  return new AppError(status, HTTP_ERROR_CODES.shopError, shopError.message, options);
}

/* ═══════════════════ 6. Univerzálne mapovanie výnimky ═════════════════════ */

interface CodedError {
  code: string;
  message: string;
}

const hasStringCode = (value: unknown): value is CodedError =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { code?: unknown }).code === 'string' &&
  typeof (value as { message?: unknown }).message === 'string';

const hasNumericRetryAfter = (value: unknown): value is { retryAfterSeconds: number } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { retryAfterSeconds?: unknown }).retryAfterSeconds === 'number';

/**
 * Kódy doménových chýb (A7–A10, repozitáre) mapované na HTTP status. Neznámy
 * doménový kód skončí ako 400 — nikdy nie 500 s detailmi a nikdy nie 200.
 */
const DOMAIN_CODE_STATUS: Record<string, number> = {
  // A4 — `sudo_required` odtiaľ zmizlo 27. 8. 2026 (D100), nič ho už nevyrobí.
  too_many_attempts: 429,
  invalid_credentials: 401,
  // I2 / allowlist
  allowlist_full: 409,
  not_allowlisted: 409,
  campaign_planned: 409,
  // I3 / potvrdenie
  preview_token_invalid: 400,
  preview_token_expired: 400,
  preview_token_used: 409,
  confirmation_required: 409,
  // I12 / I13
  write_locked: 409,
  writes_disabled: 409,
  write_in_progress: 409,
  runaway_limit: 409,
  // kľúč
  key_missing: 409,
  key_expired: 409,
  key_invalid: 409,
  // stavový stroj
  invalid_transition: 409,
  not_found: 404,
};

/**
 * Ľubovoľná výnimka → `AppError`.
 *
 * Fail-closed: čokoľvek, čo sa nedá rozpoznať, je 500 `internal_error` s
 * generickou vetou. Message, `stack` ani `cause` neznámej výnimky sa do
 * odpovede nedostanú (I1).
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;

  if (error instanceof ZodError) return validationError(error, 'body');

  if (isShopRequestError(error)) return shopErrorToAppError(error.shopError);
  if (error instanceof ShopConfigError) {
    return new AppError(
      409,
      HTTP_ERROR_CODES.shopNotConfigured,
      error.shopError.message,
      { cause: error, logAsError: false },
    );
  }

  if (hasStringCode(error)) {
    const status = DOMAIN_CODE_STATUS[error.code];
    if (status !== undefined) {
      const options: AppErrorOptions = { cause: error, logAsError: status >= 500 };
      if (status === 429 && hasNumericRetryAfter(error)) {
        options.retryAfterSeconds = error.retryAfterSeconds;
      }
      return new AppError(status, error.code, error.message, options);
    }
  }

  return internalError({ cause: error });
}
