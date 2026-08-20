/**
 * Aura Zľavy — TAXONÓMIA CHÝB shopu (D41, BUILD-SPEC §6).
 *
 * D41: „Taxonómia chýb MUSÍ byť na jednom mieste v module api-clienta …
 * NESMIE byť konfigurovateľná z DB." Preto je celé zaradenie chyby (retryable /
 * terminal / uncertain) tu a nikde inde; klient (`client.ts`), retry politika
 * (`retry.ts`) ani engine (A9) nesmú mať vlastnú tabuľku výnimiek.
 *
 * Tri kategórie dôsledku:
 *   - **retryable** — 429, 500, sieťová chyba, timeout PRED odoslaním (D41–D44),
 *   - **terminal**  — 400, 401, 403, 404 (a smerovacie chyby shopu),
 *   - **uncertain** — timeout PO odoslaní (D45) a `schema_drift` (D54): appka
 *     NESMIE tvrdiť, že zápis prebehol, ani že neprebehol.
 *
 * Fail-closed pravidlá tohto modulu:
 *   - HTTP 200 s `ok:false` NIKDY nie je úspech (§6),
 *   - HTTP 200 s neznámym tvarom je `schema_drift`, teda „stav neistý", nie
 *     úspech (D54),
 *   - timeout pri ZÁPISE sa vyhodnocuje ako `timeout_after` (uncertain), pokiaľ
 *     sa nepreukáže, že požiadavka odísť nemohla — nepoznať stav je bezpečnejšie
 *     než predpokladať, že sa nič nestalo.
 *
 * Vlastník: A3.
 */
import type { ShopError, ShopErrorKind, Ulid } from '@/contracts';

import { redact } from '@/lib/log/redact';
import { shopMessageText, shopMessageTextForCodes } from '@/lib/shop/messages.sk';

export type { ShopError, ShopErrorKind };

/* ═══════════════════════════ 1. Kategórie druhov ══════════════════════════ */

/** Všetky druhy v poradí z BUILD-SPEC §6. Zoznam je uzavretý (D41). */
export const SHOP_ERROR_KINDS: readonly ShopErrorKind[] = [
  'rate_limited',
  'server_error',
  'network',
  'timeout_before',
  'timeout_after',
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'schema_drift',
  'batch_not_allowed',
];

/** Retryable podľa D41–D44. `batch_not_allowed` sa nerobí znova — rieši ho fallback (D56). */
export const RETRYABLE_KINDS: ReadonlySet<ShopErrorKind> = new Set<ShopErrorKind>([
  'rate_limited',
  'server_error',
  'network',
  'timeout_before',
]);

/** Terminal podľa D41: žiadny retry, chyba ide do reportu. */
export const TERMINAL_KINDS: ReadonlySet<ShopErrorKind> = new Set<ShopErrorKind>([
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'batch_not_allowed',
]);

/** „Stav neistý" (D45, D54) — nikdy sa nesmie agregovať do OK ani do „nič sa nestalo". */
export const UNCERTAIN_KINDS: ReadonlySet<ShopErrorKind> = new Set<ShopErrorKind>([
  'timeout_after',
  'schema_drift',
]);

/** Druhy, po ktorých MUSÍ nasledovať wipe kľúča (D51, D52). Wipe robí volajúci, nie klient. */
export const KEY_REJECTED_KINDS: ReadonlySet<ShopErrorKind> = new Set<ShopErrorKind>([
  'unauthorized',
  'forbidden',
]);

export function isRetryableKind(kind: ShopErrorKind): boolean {
  return RETRYABLE_KINDS.has(kind);
}

export function isTerminalKind(kind: ShopErrorKind): boolean {
  return TERMINAL_KINDS.has(kind);
}

export function isUncertainKind(kind: ShopErrorKind): boolean {
  return UNCERTAIN_KINDS.has(kind);
}

export function isKeyRejectedKind(kind: ShopErrorKind): boolean {
  return KEY_REJECTED_KINDS.has(kind);
}

/* ══════════════════════ 2. Konštrukcia `ShopError` ════════════════════════ */

export interface ShopErrorInit {
  kind: ShopErrorKind;
  /** Surové kódy zo shopu; prvý ide do `ShopError.code` (D47). */
  codes?: readonly string[];
  code?: string | null;
  httpStatus?: number | null;
  requestId?: Ulid;
  /** Sekundy z `Retry-After`, UŽ zastropované (D42). */
  retryAfterSeconds?: number;
  /** Raw odpoveď — prejde `redact()` (I1, D50). */
  raw?: unknown;
  /** Prebije slovenskú vetu; používa sa len pre skladané hlášky. */
  message?: string;
}

/**
 * Jediná fabrika `ShopError`. Garantuje, že `retryable` vždy zodpovedá
 * taxonómii (nikto ho nesmie nastaviť ručne) a že `raw` je redigované (I1).
 */
export function makeShopError(init: ShopErrorInit): ShopError {
  const codes = init.codes ?? (init.code != null ? [init.code] : []);
  const code = codes.length > 0 ? codes[0] : null;
  const message =
    init.message ??
    (codes.length > 1
      ? shopMessageTextForCodes(init.kind, codes)
      : shopMessageText(init.kind, code));

  const error: ShopError = {
    kind: init.kind,
    code,
    message,
    httpStatus: init.httpStatus ?? null,
    retryable: isRetryableKind(init.kind),
  };
  if (init.requestId !== undefined) error.requestId = init.requestId;
  if (init.retryAfterSeconds !== undefined) error.retryAfterSeconds = init.retryAfterSeconds;
  if (init.raw !== undefined) error.raw = redact(init.raw);
  return error;
}

/** Výnimka pre volania, ktoré vracajú dáta (`getProduct`, `listProducts`). */
export class ShopRequestError extends Error {
  readonly shopError: ShopError;

  constructor(shopError: ShopError) {
    super(shopError.message);
    this.name = 'ShopRequestError';
    this.shopError = shopError;
  }

  get kind(): ShopErrorKind {
    return this.shopError.kind;
  }

  get retryable(): boolean {
    return this.shopError.retryable;
  }
}

export function isShopRequestError(value: unknown): value is ShopRequestError {
  return value instanceof ShopRequestError;
}

/** Rozlíšenie `ProductDetail` vs `ShopError` v mape z `batchGetProducts`. */
export function isShopError(value: unknown): value is ShopError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'retryable' in value &&
    typeof (value as ShopError).kind === 'string' &&
    (SHOP_ERROR_KINDS as readonly string[]).includes((value as ShopError).kind)
  );
}

/** Chyba konfigurácie (chýbajúca/neplatná doména) — nikdy neopustí appku k shopu. */
export class ShopConfigError extends Error {
  readonly shopError: ShopError;

  constructor(detail: string) {
    const shopError = makeShopError({ kind: 'bad_request', code: 'local_no_base_url' });
    super(`${shopError.message} (${detail})`);
    this.name = 'ShopConfigError';
    this.shopError = shopError;
  }
}

/* ═════════════════════ 3. Zaradenie HTTP odpovede ═════════════════════════ */

/** Kódy, ktoré shop vracia v slote dávky namiesto spustenia akcie (D56). */
const BATCH_NOT_ALLOWED_CODES: ReadonlySet<string> = new Set(['batch_not_allowed']);

/** Kódy, ktoré znamenajú „produkt neexistuje" bez ohľadu na HTTP status (D49). */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set(['not found', 'not_found']);

function normalized(codes: readonly string[]): string[] {
  return codes.map((c) => c.trim().toLowerCase());
}

/**
 * HTTP status + kódy z tela → druh chyby (D41).
 *
 * Volá sa VÝHRADNE pre neúspech: pre non-2xx odpoveď alebo pre 2xx s `ok:false`
 * (tá sa nikdy nepovažuje za úspech, §6). Pre 2xx s `ok:false` sa zaradenie
 * odvodí z kódov, nie zo statusu.
 */
export function classifyFailure(httpStatus: number, codes: readonly string[] = []): ShopErrorKind {
  const lower = normalized(codes);

  if (lower.some((c) => BATCH_NOT_ALLOWED_CODES.has(c))) return 'batch_not_allowed';
  if (lower.some((c) => NOT_FOUND_CODES.has(c))) return 'not_found';

  if (httpStatus === 429) return 'rate_limited';
  if (httpStatus >= 500) return 'server_error';
  if (httpStatus === 401) return 'unauthorized';
  if (httpStatus === 403) return 'forbidden';
  if (httpStatus === 404) return 'not_found';

  // 400, 405, 409, 422 a všetko ostatné 4xx → terminal „neplatná požiadavka".
  // 405/404 na úrovni smerovania sú tiež terminal: opakovanie ich nevylieči.
  if (httpStatus >= 400) return 'bad_request';

  // HTTP 2xx s `ok:false` bez rozpoznateľného kódu: shop hlási neúspech, ale
  // nevieme prečo → terminal `bad_request`, NIKDY úspech (§6).
  return 'bad_request';
}

/* ════════════════════ 4. Zaradenie chyby dopravy (fetch) ══════════════════ */

/** Fáza volania — určuje, či timeout znamená „neistý stav" (D45). */
export type RequestPhase = 'read' | 'write';

const ABORT_ERROR_NAMES: ReadonlySet<string> = new Set(['AbortError', 'TimeoutError']);

/** True pre `AbortSignal.timeout()` aj pre ručný abort. */
export function isAbortLike(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (typeof name === 'string' && ABORT_ERROR_NAMES.has(name)) return true;
  const code = (error as { code?: unknown }).code;
  if (code === 'ABORT_ERR' || code === 'UND_ERR_ABORTED' || code === 23) return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause !== undefined && cause !== error ? isAbortLike(cause) : false;
}

/** Chybové kódy, ktoré dokazujú, že spojenie NEVZNIKLO (požiadavka neodišla). */
const CONNECT_PHASE_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EACCES',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
]);

function errorCodeChain(error: unknown, depth = 0): string[] {
  if (depth > 5 || typeof error !== 'object' || error === null) return [];
  const out: string[] = [];
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') out.push(code);
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== error) out.push(...errorCodeChain(cause, depth + 1));
  return out;
}

/**
 * Výnimka z `fetch()` → druh chyby (D41, D45).
 *
 * Pravidlá (fail-closed):
 *   - timeout/abort pri ČÍTANÍ → `timeout_before` (čítanie je bezpečné zopakovať),
 *   - timeout/abort pri ZÁPISE → `timeout_after`, teda „stav neistý" a presne
 *     jeden identický resend (D45). Výnimka: keď z chybového kódu vieme, že
 *     spojenie vôbec nevzniklo, ide o `network` (požiadavka odísť nemohla),
 *   - `alreadyAborted` = signál bol zrušený ešte pred zavolaním `fetch()`, teda
 *     požiadavka sa NEODOSLALA → `timeout_before` aj pri zápise.
 */
export function classifyTransportFailure(
  error: unknown,
  phase: RequestPhase,
  opts: { alreadyAborted?: boolean } = {},
): ShopErrorKind {
  const codes = errorCodeChain(error);
  if (codes.some((c) => CONNECT_PHASE_CODES.has(c))) return 'network';

  if (isAbortLike(error)) {
    if (opts.alreadyAborted === true) return 'timeout_before';
    return phase === 'write' ? 'timeout_after' : 'timeout_before';
  }

  return 'network';
}

/** Zloží `ShopError` z výnimky `fetch()`. Text výnimky sa do hlášky NEDÁVA (I1). */
export function transportError(
  error: unknown,
  phase: RequestPhase,
  meta: { requestId: Ulid; alreadyAborted?: boolean },
): ShopError {
  const kind = classifyTransportFailure(error, phase, { alreadyAborted: meta.alreadyAborted });
  return makeShopError({
    kind,
    httpStatus: null,
    requestId: meta.requestId,
    // Do `raw` ide len názov a kód chyby — hlášky z knižníc môžu obsahovať URL
    // s parametrami, preto nič viac (I1). `redact()` sa spustí v `makeShopError`.
    raw: {
      transport: {
        name: error instanceof Error ? error.name : typeof error,
        codes: errorCodeChain(error),
      },
    },
  });
}

/** `schema_drift` (D54): HTTP 200, ale tvar neprešiel zod validáciou. */
export function schemaDriftError(meta: {
  requestId: Ulid;
  httpStatus: number | null;
  issues: readonly string[];
  raw?: unknown;
}): ShopError {
  return makeShopError({
    kind: 'schema_drift',
    code: 'local_schema_drift',
    httpStatus: meta.httpStatus,
    requestId: meta.requestId,
    raw: { schemaIssues: meta.issues.slice(0, 20), body: meta.raw },
  });
}
