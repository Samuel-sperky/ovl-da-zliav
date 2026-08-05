/**
 * Aura Zľavy — API KLIENT VOČI SHOPU (BUILD-SPEC §6, D41–D58).
 *
 * Jediné miesto v celej appke, ktoré volá shop. Všetko ostatné (engine,
 * scheduler, route-y) hovorí s ním cez rozhranie `ShopClient` zo
 * `src/contracts.ts`.
 *
 * Čo tento modul garantuje:
 *   - **I1 / D64** — API kľúč prichádza VÝHRADNE ako `SecretRef`; dešifruje sa
 *     tesne pred odoslaním, `release()` (a teda `Buffer.fill(0)`) beží vo
 *     `finally`, hlavička sa z objektu okamžite maže a NIKDY sa neloguje.
 *   - **D48 / D53** — `X-Api-Key` sa posiela len pri `setReduction` a pri sonde
 *     `probeKey`. Čítacie volania (`listProducts`, `getProduct`,
 *     `batchGetProducts`, `canary`) sú verejné a hlavičku vôbec nezostavia:
 *     čítacia cesta nemá parameter, ktorým by sa kľúč dal podstrčiť.
 *   - **§6** — HTTP 200 s `ok:false` NIKDY nie je úspech; HTTP 200 s tvarom,
 *     ktorý neprejde zod, je `schema_drift`, teda „stav neistý" (D54).
 *   - **D45** — timeout po odoslaní zápisu = `uncertain` + PRESNE JEDEN
 *     identický resend; druhá odpoveď je konečná.
 *   - **I7** — neexistuje funkcia, ktorá zľavu ruší. Zápis s `to` v minulosti
 *     klient ODMIETNE ešte pred odoslaním (`local_to_in_past`).
 *   - **I8** — klient pozná výhradne cesty pod `/api/products` a `/api/batch`;
 *     objednávkové endpointy a ich scope sa v module nevyskytujú.
 *   - **I9** — percento 1–30, `to ≥ from`, okno ≤ 3 mesiace sa kontroluje aj tu
 *     (druhá obrana; prvá je `lib/engine/guards.ts`).
 *   - **D58** — každý request nesie `User-Agent: aura-zlavy/<verzia>`,
 *     `X-Request-Id` a je zalogovaný s `operation_id`/`request_id`.
 *
 * Vlastník: A3.
 */
import type {
  CanaryResult,
  DateOnly,
  KeyProbeResult,
  Logger,
  Paged,
  ProductDetail,
  ProductListItem,
  SecretHandle,
  SecretRef,
  SetReductionParams,
  SetReductionResult,
  SettingsRecord,
  ShopClient,
  ShopCtx,
  ShopError,
  Ulid,
} from '@/contracts';

import { env } from '@/env';
import { logger as defaultLogger } from '@/lib/log/logger';
import { redact } from '@/lib/log/redact';
import {
  baseHeaders,
  correlationLogFields,
  newRequestId,
  requestContext,
} from '@/lib/shop/correlation';
import {
  ShopConfigError,
  ShopRequestError,
  classifyFailure,
  isTerminalKind,
  isUncertainKind,
  makeShopError,
  schemaDriftError,
  transportError,
  type RequestPhase,
} from '@/lib/shop/errors';
import {
  DEFAULT_READ_TIMEOUT_MS,
  DEFAULT_WRITE_TIMEOUT_MS,
  parseRetryAfterSeconds,
  runWithRetry,
  sleep as defaultSleep,
  type RetryPolicy,
} from '@/lib/shop/retry';
import {
  batchResponseSchema,
  bodySignalsFailure,
  parseShopPayload,
  productDetailSchema,
  productListResponseSchema,
  readErrorBody,
  setReductionSuccessSchema,
  toProductDetail,
  toProductListItem,
} from '@/lib/shop/schemas';
import { APP_VERSION } from '@/version';

/* ═══════════════════════════ 1. Cesty a stropy ════════════════════════════ */

/**
 * Kompletný zoznam ciest, ktoré appka voči shopu pozná (I8). Nič iné sa
 * nikdy nezostaví — cesta je vždy jedna z týchto konštánt.
 */
export const SHOP_PATHS = {
  productList: '/api/products',
  productGet: '/api/products/get',
  setReduction: '/api/products/setReduction',
  batch: '/api/batch',
} as const;

/** `POST /api/batch` — max 25 položiek (D56). */
export const BATCH_MAX_ITEMS = 25;

/** Percento zľavy: celé číslo 1–30 (D11, I9). `0` je vyhradená pre sondu (D53). */
export const MIN_REDUCTION_PERCENT = 1;
export const MAX_REDUCTION_PERCENT = 30;

/** Maximálna dĺžka okna zľavy v mesiacoch (D29, shop `range_too_long`). */
export const MAX_WINDOW_MONTHS = 3;

/**
 * ID produktu pre sondu (D53). `0` neexistuje, takže ani teoretická zmena
 * shopu (ktorá by prijala `reduction=0`) nemôže nič prepísať — sonda je
 * dvojnásobne neškodná: neplatný produkt A neplatné percento.
 */
export const PROBE_PRODUCT_ID = 0;

/* ══════════════════════════ 2. Base URL (D80, I6) ═════════════════════════ */

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Normalizuje doménu shopu na base URL bez trailing slash (§6, D80).
 *
 * `https` je povinné. Jediná výnimka je lokálny mock (`127.0.0.1`/`localhost`)
 * mimo produkcie — bez nej by testy nemali proti čomu bežať (I6), a v produkcii
 * ju zakazuje aj zod schéma ENV (`SHOP_BASE_URL_OVERRIDE`).
 */
export function normalizeShopBaseUrl(
  raw: string,
  opts: { allowLoopbackHttp?: boolean } = {},
): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new ShopConfigError('doména je prázdna');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ShopConfigError('doména nie je platná URL');
  }

  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const httpsRequired = !(opts.allowLoopbackHttp === true && loopback);
  if (httpsRequired && url.protocol !== 'https:') {
    throw new ShopConfigError('doména musí začínať na https://');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ShopConfigError('nepodporovaný protokol');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new ShopConfigError('doména nesmie obsahovať prihlasovacie údaje');
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new ShopConfigError('doména nesmie obsahovať query ani fragment');
  }

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * Base URL pre klienta: `SHOP_BASE_URL_OVERRIDE` (len mimo produkcie, I6),
 * inak `settings.shop_domain` (R5, D80). Doména sa NIKDY nečíta z repozitára.
 */
export function shopBaseUrlFromSettings(record: Pick<SettingsRecord, 'shopDomain'>): string {
  const override = env.SHOP_BASE_URL_OVERRIDE;
  if (override !== undefined && env.NODE_ENV !== 'production') {
    return normalizeShopBaseUrl(override, { allowLoopbackHttp: true });
  }
  if (record.shopDomain === null || record.shopDomain.trim().length === 0) {
    throw new ShopConfigError('doména shopu nie je nastavená');
  }
  return normalizeShopBaseUrl(record.shopDomain);
}

/* ═════════════════════ 3. Lokálna validácia zápisu (I7, I9) ═══════════════ */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/** Kalendárne pripočítanie mesiacov s klampingom dňa (31.11. → 30.11.). */
export function addMonthsDateOnly(value: DateOnly, months: number): DateOnly {
  const [y, m, d] = value.split('-').map(Number);
  const targetMonthIndex = m - 1 + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTargetMonth);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(day)}`;
}

/**
 * Dnešný kalendárny deň v logickej zóne (D31 — Europe/Bratislava).
 *
 * Klient si ho počíta sám (bez `lib/domain/dates.ts`), pretože potrebuje len
 * porovnanie „`to` nie je pred dneškom" ako obranu I7; celá dátumová logika
 * kampaní zostáva v doménovom module (A7).
 */
export function todayInTimeZone(timeZone: string, nowMs: number = Date.now()): DateOnly {
  const pad = (n: number): string => String(n).padStart(2, '0');
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(nowMs));
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const y = get('year');
    const m = get('month');
    const d = get('day');
    if (y.length === 4 && m.length === 2 && d.length === 2) return `${y}-${m}-${d}`;
  } catch {
    // Neplatná zóna — fail-closed na UTC, nikdy nepustíme nevalidovaný zápis.
  }
  const utc = new Date(nowMs);
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`;
}

/**
 * Kontrola parametrov zápisu PRED odoslaním (I9) a obrana I7.
 *
 * Vracia `ShopError` (kind `bad_request`, kód s prefixom `local_`) alebo `null`.
 * Klient pri chybe NEODOSIELA nič — „pri pochybnosti sa NESMIE zapísať".
 */
export function validateWriteParams(
  params: SetReductionParams,
  opts: { timeZone?: string; now?: () => number } = {},
): ShopError | null {
  const fail = (code: string): ShopError => makeShopError({ kind: 'bad_request', code });

  if (!Number.isInteger(params.id) || params.id <= 0) return fail('local_invalid_product_id');

  if (!Number.isInteger(params.reduction)) return fail('local_invalid_reduction');
  if (params.reduction < MIN_REDUCTION_PERCENT || params.reduction > MAX_REDUCTION_PERCENT) {
    return fail('local_invalid_reduction');
  }

  if (typeof params.from !== 'string' || !isValidDateOnly(params.from)) {
    return fail('local_invalid_dates');
  }
  if (typeof params.to !== 'string' || !isValidDateOnly(params.to)) return fail('local_invalid_dates');
  if (params.to < params.from) return fail('local_invalid_dates');

  if (params.to > addMonthsDateOnly(params.from, MAX_WINDOW_MONTHS)) {
    return fail('local_range_too_long');
  }

  // I7 — zľava sa NERUŠÍ. Zápis s dátumom „do" v minulosti je presne tvar
  // zakázaného hacku, preto ho klient odmietne bez ohľadu na to, kto ho volá.
  const timeZone = opts.timeZone ?? env.LOGIC_TIMEZONE;
  const today = todayInTimeZone(timeZone, (opts.now ?? Date.now)());
  if (params.to < today) return fail('local_to_in_past');

  return null;
}

/** Presný payload, ktorý ide na shop — audit (D50) ho ukladá bez zmeny. */
export function setReductionPayload(params: SetReductionParams): Record<string, string> {
  return {
    id: String(params.id),
    from: params.from,
    to: params.to,
    reduction: String(params.reduction),
  };
}

/* ═══════════════════════════ 4. Závislosti klienta ════════════════════════ */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ShopClientDeps {
  /** Base URL alebo jej (async) resolver — `settings.shop_domain` sa číta lazy. */
  baseUrl: string | (() => string | Promise<string>);
  fetchImpl?: FetchLike;
  logger?: Logger;
  /** `User-Agent: aura-zlavy/<version>` (D58). */
  version?: string;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  policy?: RetryPolicy;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Zóna pre kontrolu „`to` nie je v minulosti" (D31). */
  timeZone?: string;
  /** ID produktu pre sondu (D53) — prepisovateľné pre mock. */
  probeProductId?: number;
  /**
   * 401/403 pri ZÁPISE (D51, D52). Klient sám kľúč NEWIPUJE (nevlastní
   * `api-key.repo.ts`) — len ohlási, že kľúč shop odmietol.
   */
  onKeyRejected?: (info: { kind: 'unauthorized' | 'forbidden'; ctx: ShopCtx; error: ShopError }) => void;
  /** Eskalácia „API sa zmenilo" (D54). */
  onSchemaDrift?: (info: { path: string; ctx: ShopCtx; error: ShopError }) => void;
}

interface RequestSpec {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  form?: Record<string, string>;
  phase: RequestPhase;
  /** Kľúč sa zostaví do hlavičky VÝHRADNE keď je tu uvedený (D48). */
  key?: SecretRef;
  ctx: ShopCtx;
  /** Predpísané `request_id` pre prvý pokus; ďalšie pokusy dostanú nové (D58). */
  requestId?: Ulid;
}

interface SuccessEnvelope {
  httpStatus: number;
  body: unknown;
  requestId: Ulid;
}

/* ══════════════════════════════ 5. Klient ═════════════════════════════════ */

export function createShopClient(deps: ShopClientDeps): ShopClient {
  const log = deps.logger ?? defaultLogger;
  const fetchImpl: FetchLike =
    deps.fetchImpl ??
    ((input, init) => fetch(input, init) as Promise<Response>);
  const nowMs = deps.now ?? Date.now;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const version = (): string => deps.version ?? env.APP_VERSION ?? APP_VERSION;
  const timeoutFor = (phase: RequestPhase): number =>
    phase === 'write'
      ? (deps.writeTimeoutMs ?? env.SHOP_TIMEOUT_WRITE_MS ?? DEFAULT_WRITE_TIMEOUT_MS)
      : (deps.readTimeoutMs ?? env.SHOP_TIMEOUT_READ_MS ?? DEFAULT_READ_TIMEOUT_MS);

  const policy = (): RetryPolicy => ({
    maxAttempts: deps.policy?.maxAttempts ?? env.SHOP_RETRY_MAX,
    retryAfterCapSeconds: deps.policy?.retryAfterCapSeconds ?? env.SHOP_RETRY_AFTER_CAP_S,
    ...(deps.policy?.backoffMs !== undefined ? { backoffMs: deps.policy.backoffMs } : {}),
  });

  async function resolveBaseUrl(): Promise<string> {
    const raw = typeof deps.baseUrl === 'function' ? await deps.baseUrl() : deps.baseUrl;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new ShopConfigError('resolver nevrátil base URL');
    }
    return raw.replace(/\/+$/, '');
  }

  function buildUrl(base: string, path: string, query?: RequestSpec['query']): string {
    const url = new URL(`${base}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /* ─────────────────── 5.1 jeden HTTP pokus (bez retry) ─────────────────── */

  async function sendOnce(
    spec: RequestSpec,
    requestId: Ulid,
  ): Promise<{ status: 'ok'; value: SuccessEnvelope } | { status: 'error'; error: ShopError }> {
    const base = await resolveBaseUrl();
    const url = buildUrl(base, spec.path, spec.query);
    const timeoutMs = timeoutFor(spec.phase);
    const startedAt = nowMs();

    // Hlavičky sa zostavujú pre KAŽDÝ pokus nanovo — objekt s kľúčom nikdy
    // neprežije jeden request (I1, D64).
    const headers: Record<string, string> = baseHeaders(requestId, version());
    let body: string | undefined;
    if (spec.form !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(spec.form).toString();
    }

    const signal = AbortSignal.timeout(timeoutMs);
    let handle: SecretHandle | null = null;
    let response: Response;

    try {
      if (spec.key !== undefined) {
        // D64: dešifrovanie tesne pred odoslaním. Plaintext existuje ako string
        // len v tejto hlavičke a len po dobu jedného requestu; `finally` ho maže
        // a `release()` prepíše Buffer nulami. NIKDY sa neloguje (I1).
        handle = await spec.key();
        headers['X-Api-Key'] = handle.value.toString('utf8');
      }

      if (signal.aborted) {
        return {
          status: 'error',
          error: transportError(signal.reason, spec.phase, { requestId, alreadyAborted: true }),
        };
      }

      response = await fetchImpl(url, {
        method: spec.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal,
        redirect: 'error', // presmerovanie by odniesol kľúč na cudzí host (I1)
        cache: 'no-store',
      });
    } catch (error) {
      const shopError = transportError(error, spec.phase, { requestId });
      log.warn('shop_request_transport_failed', {
        ...correlationLogFields(spec.ctx, requestId),
        path: spec.path,
        method: spec.method,
        phase: spec.phase,
        kind: shopError.kind,
        durationMs: nowMs() - startedAt,
      });
      return { status: 'error', error: shopError };
    } finally {
      delete headers['X-Api-Key'];
      handle?.release();
      handle = null;
    }

    /* ── telo odpovede ── */
    const httpStatus = response.status;
    let text = '';
    try {
      text = await response.text();
    } catch (error) {
      const shopError = transportError(error, spec.phase, { requestId });
      return { status: 'error', error: shopError };
    }

    let parsed: unknown;
    let jsonOk = true;
    try {
      parsed = text.length === 0 ? null : JSON.parse(text);
    } catch {
      jsonOk = false;
      parsed = { nonJsonBody: text.slice(0, 512) };
    }

    const durationMs = nowMs() - startedAt;
    const ok2xx = httpStatus >= 200 && httpStatus < 300;
    const failureInBody = bodySignalsFailure(parsed);

    log.debug('shop_request_done', {
      ...correlationLogFields(spec.ctx, requestId),
      path: spec.path,
      method: spec.method,
      phase: spec.phase,
      httpStatus,
      durationMs,
      bodyOkFalse: failureInBody,
    });

    // HTTP 200 a nečitateľné telo → `schema_drift`, nie úspech (D54).
    if (ok2xx && !jsonOk) {
      return {
        status: 'error',
        error: schemaDriftError({
          requestId,
          httpStatus,
          issues: ['(root): non_json_body'],
          raw: parsed,
        }),
      };
    }

    // §6: HTTP 200 s `ok:false` sa NIKDY nepovažuje za úspech.
    if (!ok2xx || failureInBody) {
      const read = readErrorBody(parsed);
      const kind = classifyFailure(httpStatus, read.codes);
      const retryAfterSeconds =
        kind === 'rate_limited'
          ? parseRetryAfterSeconds(response.headers.get('retry-after'), {
              capSeconds: policy().retryAfterCapSeconds,
              now: nowMs,
            })
          : null;
      return {
        status: 'error',
        error: makeShopError({
          kind,
          codes: read.codes,
          httpStatus,
          requestId,
          ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
          raw: parsed,
        }),
      };
    }

    return { status: 'ok', value: { httpStatus, body: parsed, requestId } };
  }

  /* ──────────────── 5.2 HTTP volanie s retry politikou (§6) ─────────────── */

  async function send(spec: RequestSpec): Promise<
    | { outcome: 'ok'; value: SuccessEnvelope; attempts: number }
    | { outcome: 'error'; error: ShopError; attempts: number }
  > {
    const firstRequestId = spec.requestId ?? requestContext(spec.ctx).requestId;
    return runWithRetry<SuccessEnvelope>({
      policy: policy(),
      sleepFn,
      attempt: ({ attempt }) =>
        // D58: `request_id` per HTTP volanie — každý pokus má vlastné.
        sendOnce(spec, attempt === 1 ? firstRequestId : newRequestId()),
      onRetry: ({ attempt, delayMs, error }) => {
        log.warn('shop_request_retry', {
          ...correlationLogFields(spec.ctx, error.requestId),
          path: spec.path,
          phase: spec.phase,
          attempt,
          delayMs,
          kind: error.kind,
          httpStatus: error.httpStatus ?? undefined,
        });
      },
    });
  }

  /** Presne jeden pokus, bez opakovania — pre resend po `timeout_after` (D45). */
  async function sendExactlyOnce(spec: RequestSpec): Promise<
    | { outcome: 'ok'; value: SuccessEnvelope; attempts: number }
    | { outcome: 'error'; error: ShopError; attempts: number }
  > {
    const requestId = spec.requestId ?? newRequestId();
    const result = await sendOnce(spec, requestId);
    return result.status === 'ok'
      ? { outcome: 'ok', value: result.value, attempts: 1 }
      : { outcome: 'error', error: result.error, attempts: 1 };
  }

  function reportDrift(path: string, ctx: ShopCtx, error: ShopError): void {
    log.error('shop_schema_drift', {
      ...correlationLogFields(ctx, error.requestId),
      path,
      httpStatus: error.httpStatus ?? undefined,
    });
    deps.onSchemaDrift?.({ path, ctx, error });
  }

  /* ─────────────────────────── 5.3 čítacie volania ──────────────────────── */

  async function listProducts(
    params: { page?: number; perPage?: number },
    ctx: ShopCtx,
  ): Promise<Paged<ProductListItem>> {
    const result = await send({
      method: 'GET',
      path: SHOP_PATHS.productList,
      query: { page: params.page, per_page: params.perPage },
      phase: 'read',
      ctx,
    });
    if (result.outcome === 'error') throw new ShopRequestError(result.error);

    const parsed = parseShopPayload(productListResponseSchema, result.value.body);
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: parsed.issues,
        raw: result.value.body,
      });
      reportDrift(SHOP_PATHS.productList, ctx, error);
      throw new ShopRequestError(error);
    }

    return {
      data: parsed.value.data.map(toProductListItem),
      page: parsed.value.page,
      perPage: parsed.value.per_page,
      total: parsed.value.total,
    };
  }

  async function getProduct(id: number, ctx: ShopCtx): Promise<ProductDetail> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new ShopRequestError(makeShopError({ kind: 'bad_request', code: 'local_invalid_product_id' }));
    }
    const result = await send({
      method: 'GET',
      path: SHOP_PATHS.productGet,
      query: { id },
      phase: 'read',
      ctx,
    });
    if (result.outcome === 'error') throw new ShopRequestError(result.error);

    const parsed = parseShopPayload(productDetailSchema, result.value.body);
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: parsed.issues,
        raw: result.value.body,
      });
      reportDrift(SHOP_PATHS.productGet, ctx, error);
      throw new ShopRequestError(error);
    }
    return toProductDetail(parsed.value);
  }

  /** `getProduct`, ktorý chybu vracia namiesto hádzania — pre dávku a fallback. */
  async function getProductSafe(id: number, ctx: ShopCtx): Promise<ProductDetail | ShopError> {
    try {
      return await getProduct(id, ctx);
    } catch (error) {
      if (error instanceof ShopRequestError) return error.shopError;
      if (error instanceof ShopConfigError) return error.shopError;
      throw error;
    }
  }

  /* ─────────────────── 5.4 dávkové čítanie s fallbackom (D56) ───────────── */

  function batchForm(ids: readonly number[]): Record<string, string> {
    // Dokumentácia shopu (`docs/api/sperky-api.md`) ukazuje dávku ako
    // form-encoded bracket notáciu — držíme sa presne jej.
    const form: Record<string, string> = {};
    ids.forEach((id, index) => {
      form[`requests[${index}][controller]`] = 'products';
      form[`requests[${index}][action]`] = 'get';
      form[`requests[${index}][method]`] = 'GET';
      form[`requests[${index}][data][id]`] = String(id);
    });
    return form;
  }

  type ChunkOutcome =
    | { via: 'batch'; results: Map<number, ProductDetail | ShopError> }
    | { via: 'fallback'; reason: string };

  async function batchChunk(ids: number[], ctx: ShopCtx): Promise<ChunkOutcome> {
    const result = await send({
      method: 'POST',
      path: SHOP_PATHS.batch,
      form: batchForm(ids),
      phase: 'read',
      ctx,
    });

    // Chyba celého batchu → fallback na jednotlivé GETy (D56).
    if (result.outcome === 'error') {
      return { via: 'fallback', reason: `batch_${result.error.kind}` };
    }

    const envelope = parseShopPayload(batchResponseSchema, result.value.body);
    if (!envelope.ok) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: envelope.issues,
        raw: result.value.body,
      });
      reportDrift(SHOP_PATHS.batch, ctx, error);
      return { via: 'fallback', reason: 'batch_schema_drift' };
    }
    if (envelope.value.results.length !== ids.length) {
      return { via: 'fallback', reason: 'batch_length_mismatch' };
    }

    const results = new Map<number, ProductDetail | ShopError>();
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const slot = envelope.value.results[index];
      const read = readErrorBody(slot);

      if (bodySignalsFailure(slot)) {
        const kind = classifyFailure(200, read.codes);
        // `batch_not_allowed` = akcia nie je opt-in; celý chunk ide jednotlivo (D56).
        if (kind === 'batch_not_allowed') return { via: 'fallback', reason: 'batch_not_allowed' };
        results.set(
          id,
          makeShopError({
            kind,
            codes: read.codes,
            httpStatus: result.value.httpStatus,
            requestId: result.value.requestId,
            raw: slot,
          }),
        );
        continue;
      }

      const parsed = parseShopPayload(productDetailSchema, slot);
      if (!parsed.ok) {
        const error = schemaDriftError({
          requestId: result.value.requestId,
          httpStatus: result.value.httpStatus,
          issues: parsed.issues,
          raw: slot,
        });
        reportDrift(SHOP_PATHS.batch, ctx, error);
        results.set(id, error);
        continue;
      }
      results.set(id, toProductDetail(parsed.value));
    }
    return { via: 'batch', results };
  }

  async function batchGetProducts(
    ids: number[],
    ctx: ShopCtx,
  ): Promise<{ results: Map<number, ProductDetail | ShopError>; via: 'batch' | 'single' }> {
    const unique = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
    const results = new Map<number, ProductDetail | ShopError>();
    if (unique.length === 0) return { results, via: 'batch' };

    let via: 'batch' | 'single' = 'batch';
    for (let start = 0; start < unique.length; start += BATCH_MAX_ITEMS) {
      const chunk = unique.slice(start, start + BATCH_MAX_ITEMS);
      const outcome = await batchChunk(chunk, ctx);

      if (outcome.via === 'batch') {
        for (const [id, value] of outcome.results) results.set(id, value);
        continue;
      }

      log.warn('shop_batch_fallback_single', {
        ...correlationLogFields(ctx),
        reason: outcome.reason,
        count: chunk.length,
      });
      via = 'single';
      // Sekvenčne — aj čítanie drží deterministické poradie a nezaťaží limit
      // 300 volaní / 60 s naraz.
      for (const id of chunk) {
        results.set(id, await getProductSafe(id, ctx));
      }
    }

    return { results, via };
  }

  /* ─────────────────────────── 5.5 canary (D55) ─────────────────────────── */

  async function canary(ctx: ShopCtx): Promise<CanaryResult> {
    const startedAt = nowMs();
    const result = await send({
      method: 'GET',
      path: SHOP_PATHS.productList,
      query: { per_page: 1 },
      phase: 'read',
      ctx,
    });
    const latencyMs = nowMs() - startedAt;

    if (result.outcome === 'error') {
      return {
        ok: false,
        total: 0,
        latencyMs,
        httpStatus: result.error.httpStatus,
        error: result.error,
      };
    }

    const parsed = parseShopPayload(productListResponseSchema, result.value.body);
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: parsed.issues,
        raw: result.value.body,
      });
      reportDrift(SHOP_PATHS.productList, ctx, error);
      return { ok: false, total: 0, latencyMs, httpStatus: result.value.httpStatus, error };
    }

    return {
      ok: true,
      total: parsed.value.total,
      latencyMs,
      httpStatus: result.value.httpStatus,
    };
  }

  /* ──────────────────────── 5.6 zápis zľavy (D43, D45) ──────────────────── */

  async function setReduction(
    params: SetReductionParams,
    key: SecretRef,
    ctx: ShopCtx,
  ): Promise<SetReductionResult> {
    const requestId = requestContext(ctx).requestId;

    // I9/I7 — fail-closed pred odoslaním. Nič sa neposiela.
    const local = validateWriteParams(params, {
      ...(deps.timeZone !== undefined ? { timeZone: deps.timeZone } : {}),
      now: nowMs,
    });
    if (local !== null) {
      log.error('shop_write_rejected_locally', {
        ...correlationLogFields(ctx, requestId),
        productId: params.id,
        code: local.code ?? undefined,
      });
      return {
        outcome: 'failed',
        httpStatus: null,
        requestId,
        raw: redact({ localValidation: local.code, sentPayload: null }),
        attempts: 0,
        error: { ...local, requestId },
      };
    }

    const form = setReductionPayload(params);
    const spec: RequestSpec = {
      method: 'POST',
      path: SHOP_PATHS.setReduction,
      form,
      phase: 'write',
      key,
      ctx,
      requestId,
    };

    const first = await send(spec);
    let attempts = first.attempts;

    if (first.outcome === 'ok') {
      return finishWrite(first.value, attempts, ctx);
    }

    // D45 — timeout PO odoslaní: stav neistý, PRESNE JEDEN identický resend.
    if (first.error.kind === 'timeout_after') {
      log.warn('shop_write_timeout_after_resend', {
        ...correlationLogFields(ctx, first.error.requestId),
        productId: params.id,
        attempts,
      });
      const second = await sendExactlyOnce({ ...spec, requestId: newRequestId() });
      attempts += second.attempts;

      if (second.outcome === 'ok') {
        const finished = finishWrite(second.value, attempts, ctx);
        if (finished.outcome === 'ok') {
          return {
            ...finished,
            raw: redact({ resendAfterTimeout: true, response: finished.raw }),
          };
        }
        return finished;
      }

      // Druhá odpoveď je konečná (§6): terminal chyba = `failed`,
      // čokoľvek neisté (ďalší timeout, drift, 429/500) = `uncertain`.
      return writeFailure(second.error, attempts, ctx, { resendAfterTimeout: true });
    }

    return writeFailure(first.error, attempts, ctx, { resendAfterTimeout: false });
  }

  function finishWrite(value: SuccessEnvelope, attempts: number, ctx: ShopCtx): SetReductionResult {
    const parsed = parseShopPayload(setReductionSuccessSchema, value.body);
    if (!parsed.ok) {
      // D54 — HTTP 200 v nečakanom tvare NIE JE úspech, je to neistý stav.
      const error = schemaDriftError({
        requestId: value.requestId,
        httpStatus: value.httpStatus,
        issues: parsed.issues,
        raw: value.body,
      });
      reportDrift(SHOP_PATHS.setReduction, ctx, error);
      return {
        outcome: 'uncertain',
        httpStatus: value.httpStatus,
        requestId: value.requestId,
        raw: redact(value.body),
        attempts,
        error,
      };
    }
    return {
      outcome: 'ok',
      httpStatus: value.httpStatus,
      requestId: value.requestId,
      raw: redact(value.body),
      attempts,
    };
  }

  function writeFailure(
    error: ShopError,
    attempts: number,
    ctx: ShopCtx,
    meta: { resendAfterTimeout: boolean },
  ): SetReductionResult {
    if (error.kind === 'unauthorized' || error.kind === 'forbidden') {
      // D51/D52 — wipe kľúča robí volajúci (A9/A11); klient len ohlási.
      log.error('shop_key_rejected', {
        ...correlationLogFields(ctx, error.requestId),
        kind: error.kind,
        httpStatus: error.httpStatus ?? undefined,
      });
      deps.onKeyRejected?.({ kind: error.kind, ctx, error });
    }
    if (error.kind === 'schema_drift') reportDrift(SHOP_PATHS.setReduction, ctx, error);

    // D45 — po timeoute PO odoslaní je konečná druhá odpoveď, ale „konečná"
    // znamená len vtedy jednoznačná, keď shop sám povedal, že požiadavku
    // odmietol (terminal 400/401/403/404). Keď druhá odpoveď opäť nič nehovorí
    // (ďalší timeout, 429, 500, drift), stav prvého zápisu je stále NEZNÁMY —
    // fail-closed `uncertain`, nikdy „nič sa nestalo" (I11).
    const outcome =
      isUncertainKind(error.kind) || (meta.resendAfterTimeout && !isTerminalKind(error.kind))
        ? 'uncertain'
        : 'failed';
    return {
      outcome,
      httpStatus: error.httpStatus,
      requestId: error.requestId ?? newRequestId(),
      raw: redact({ error: error.raw ?? null, ...meta }),
      attempts,
      error,
    };
  }

  /* ───────────────────────── 5.7 sonda kľúča (D53) ──────────────────────── */

  /**
   * Overenie kľúča sondou `POST /api/products/setReduction` s `reduction=0`.
   *
   * **Vedomý trik (D53, backlog B4):** shop nemá `whoami` endpoint, takže
   * platnosť kľúča sa dá overiť len na zapisovacom endpointe. Sonda je
   * konštruovaná tak, aby NIKDY nič nezapísala:
   *   - `reduction = 0` je mimo povoleného rozsahu (`0 < x <= 30`) → shop
   *     odpovie `400 invalid_reduction`,
   *   - `id = 0` neexistuje → aj keby budúca verzia shopu `reduction=0`
   *     prijala, nie je čo prepísať.
   * Vyhodnotenie: 400 alebo „not found" = kľúč prešiel autentifikáciou a má
   * scope (teda `valid`); 401 = `invalid`; 403 = `forbidden`; čokoľvek iné
   * (429, 500, timeout, drift) = `unknown` — fail-closed, nikdy `valid`.
   *
   * HTTP 200 by znamenalo, že shop zápis prijal — to je vážna zmena API, preto
   * `unknown` + `error` do logu (nikdy `valid`).
   */
  async function probeKey(key: SecretRef, ctx: ShopCtx): Promise<KeyProbeResult> {
    const today = todayInTimeZone(deps.timeZone ?? env.LOGIC_TIMEZONE, nowMs());
    const probeId = deps.probeProductId ?? PROBE_PRODUCT_ID;
    const result = await send({
      method: 'POST',
      path: SHOP_PATHS.setReduction,
      form: { id: String(probeId), from: today, to: today, reduction: '0' },
      phase: 'write',
      key,
      ctx,
    });

    if (result.outcome === 'ok') {
      log.error('shop_probe_unexpected_success', {
        ...correlationLogFields(ctx, result.value.requestId),
        httpStatus: result.value.httpStatus,
      });
      return 'unknown';
    }

    const { kind } = result.error;
    log.info('shop_probe_done', {
      ...correlationLogFields(ctx, result.error.requestId),
      kind,
      httpStatus: result.error.httpStatus ?? undefined,
    });

    if (kind === 'bad_request' || kind === 'not_found') return 'valid';
    if (kind === 'unauthorized') return 'invalid';
    if (kind === 'forbidden') return 'forbidden';
    return 'unknown';
  }

  return {
    listProducts,
    getProduct,
    batchGetProducts,
    setReduction,
    probeKey,
    canary,
  };
}

/* ═══════════════════ 6. Konštrukcia z nastavení (D80) ═════════════════════ */

/** Minimálne rozhranie, ktoré klient potrebuje od `settings.repo` (A8). */
export interface SettingsSource {
  get(): Promise<Pick<SettingsRecord, 'shopDomain'>>;
}

/**
 * Klient, ktorý si base URL prečíta z `settings` pri KAŽDOM volaní — zmena
 * domény tak platí okamžite a doména nikdy nežije v module (R5, D80).
 */
export function createShopClientFromSettings(
  settings: SettingsSource,
  deps: Omit<ShopClientDeps, 'baseUrl'> = {},
): ShopClient {
  return createShopClient({
    ...deps,
    baseUrl: async () => shopBaseUrlFromSettings(await settings.get()),
  });
}
