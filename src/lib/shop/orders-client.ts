/**
 * Aura Zľavy — API KLIENT OBJEDNÁVOK (KONTRAKT-PREDAJNOST-2026-08-06, I8').
 *
 * Toto je JEDINÝ modul v celej appke, ktorý smie volať objednávkové endpointy
 * shopu. I8' bod 1 to vynucuje testom `test/unit/no-orders-scope.spec.ts`:
 * referencia na objednávkovú cestu odkiaľkoľvek inde je chyba, nie štýlový
 * prehrešok.
 *
 * Čo tento modul garantuje:
 *   - **I1 / D64** — kľúč prichádza VÝHRADNE ako `SecretRef` parameter funkcie.
 *     Modul si ho NIKDY nečíta z DB ani z disku, dešifruje ho tesne pred
 *     odoslaním, `release()` beží vo `finally`, hlavička sa okamžite maže
 *     a kľúč sa neobjaví v logu, v hláške ani v návratovej hodnote.
 *   - **I8' bod 3** — z odpovede sa ďalej NEVRACIA `country` ani `country_iso`.
 *     Zo zoznamu ide von len `id` (aby sa dal dotiahnuť detail) a deň
 *     z `date_add`; z detailu len `products[].id/qty`. Id objednávky teda žije
 *     výhradne v pamäti počas jedného behu.
 *
 *     **DOPLNENÉ D117 (28. 8. 2026):** `total_paid` a `currency` smú modul
 *     opustiť, ale VÝHRADNE cestou `listOrderTotals()` a výhradne preto, aby sa
 *     z nich urobil DENNÝ SÚČET ZA CELÝ ESHOP (`shop_revenue_daily`). Dôvod je
 *     meranie, nie zmena chuti: sonda 28. 8. 2026 potvrdila, že API ceny
 *     položiek objednávky NEVRACIA (`order/get` → `products: [{id, qty}]`), takže
 *     tržba per produkt sa poctivo povedať nedá a per produkt zostávajú KUSY.
 *     **Rozdeliť `total_paid` medzi položky je ZAKÁZANÉ** — v sume je poštovné,
 *     zľavy a kupóny, takže akékoľvek rozdelenie by bolo vymyslené číslo
 *     vydávané za obrat produktu (I11). Preto tu `OrderTotal` NEMÁ a nikdy
 *     nesmie mať pole s položkami a `OrderUnits` naopak NEMÁ a nikdy nesmie mať
 *     pole s peniazmi: tie dva tvary sa v tomto module zámerne nestretnú.
 *   - **I8' bod 4** — modul nepozná zápis zľavy. Názov zapisovacej akcie shopu
 *     sa v ňom nevyskytuje a vyskytovať nesmie (test to kontroluje);
 *     objednávkový kľúč sa tak k zápisu nemá ako dostať.
 *   - **§6** — HTTP 200 s `ok:false` NIKDY nie je úspech; HTTP 200 s tvarom,
 *     ktorý neprejde zod, je `schema_drift`, teda „stav neistý" (D54).
 *   - **E4 (poučenie z shop klienta)** — chyba autorizácie (401/403) je
 *     TERMINAL, nikdy opakovateľná sieťová chyba. Rovnako chyba `SecretRef`
 *     (expirovaný/wipnutý kľúč) preletí volajúcemu a NEODOŠLE sa request.
 *   - **R-2** — `rate_limited` je spomaľovacie, nie trvalé zlyhanie: opakuje sa
 *     s konzervatívnym exponenciálnym backoffom so stropom. `Retry-After` sa
 *     použije len keď je DLHŠIA než náš backoff (dokumentácia ju pri tomto
 *     endpointe nesľubuje, takže sa na ňu nesmieme spoliehať ani ju ignorovať).
 *
 * Vlastník: sales-sync.
 */
import { z } from 'zod';

import type {
  DateOnly,
  KeyProbeResult,
  Logger,
  MoneyString,
  SecretHandle,
  SecretRef,
  ShopCtx,
  ShopError,
  Ulid,
} from '@/contracts';

import { env } from '@/env';
import type { OrdersKeyProbe } from '@/lib/keys/orders-key-probe';
import { logger as defaultLogger } from '@/lib/log/logger';
import { shopBaseUrlFromSettings, todayInTimeZone } from '@/lib/shop/client';
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
  isIpBanned,
  isShopRequestError,
  makeShopError,
  schemaDriftError,
  transportError,
} from '@/lib/shop/errors';
import {
  DEFAULT_READ_TIMEOUT_MS,
  parseRetryAfterSeconds,
  runWithRetry,
  sleep as defaultSleep,
  type RetryPolicy,
} from '@/lib/shop/retry';
import { bodySignalsFailure, parseShopPayload, readErrorBody } from '@/lib/shop/schemas';
import { APP_VERSION } from '@/version';

/* ═══════════════════════════ 1. Cesty a stropy ════════════════════════════ */

/**
 * Kompletný zoznam objednávkových ciest, ktoré appka pozná (I8' bod 1).
 * Nič iné sa nikdy nezostaví — cesta je vždy jedna z týchto dvoch konštánt.
 */
export const ORDERS_PATHS = {
  orderList: '/api/order',
  orderGet: '/api/order/get',
} as const;

/** Zdieľaný paginátor shopu: default 50, strop 100 (`docs/api/sperky-api.md`). */
export const ORDERS_DEFAULT_PER_PAGE = 50;
export const ORDERS_MAX_PER_PAGE = 100;

/**
 * Konzervatívny backoff pri `rate_limited` / 500 / sieťovej chybe (R-2).
 * Vyšší než u produktových čítaní: objednávkový beh je dlhý a jeho jediná
 * cena za pomalosť je neskorší report, kým cena za zabanovaný kľúč je výpadok.
 */
export const ORDERS_BACKOFF_MS: readonly number[] = [5_000, 20_000, 60_000];

/** Strop jedného čakania (aj pre `Retry-After`) — nikdy nečakáme dlhšie. */
export const ORDERS_RETRY_WAIT_CAP_S = 120;

/** Počet POKUSOV celkom na jeden request (prvý + 2 opakovania). */
export const ORDERS_MAX_ATTEMPTS = 3;

/* ══════════════════════════════ 2. Typy ═══════════════════════════════════ */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Položka zoznamu — ZÁMERNE len `id` a deň.
 *
 * `total_paid` a `currency` sa TU nečítajú: suma je za celú objednávku, nie za
 * položku, takže obrat na produkt sa priradiť NEDÁ (kontrakt §3 NIE) a appka
 * si nepredstiera dáta, ktoré nemá (I11). Kto potrebuje sumu, berie ju
 * z `OrderTotal` nižšie — a je to suma ESHOPU, nie produktu (D117).
 */
export interface OrderRef {
  /** Id objednávky. Slúži VÝHRADNE na dotiahnutie detailu v tom istom behu. */
  id: number;
  /** Kalendárny deň z `date_add` (`YYYY-MM-DD`) — kľúč denného súčtu. */
  day: DateOnly;
}

/**
 * Objednávka zredukovaná na SUMU ZA CELÚ OBJEDNÁVKU (D117).
 *
 * Zámerne samostatný tvar, nie rozšírený `OrderRef`: `OrderRef` slúži ceste,
 * ktorá počíta KUSY po produkte, a peniaze v nej nemajú čo robiť. Kto sem
 * niekedy pridá `lines`, `productId` alebo čokoľvek per položku, porušuje D117
 * a I11 — rozdelenie tejto sumy medzi položky je vymyslené číslo.
 */
export interface OrderTotal {
  /** Id objednávky. Slúži VÝHRADNE na deduplikáciu strán v jednom behu. */
  id: number;
  /** Kalendárny deň z `date_add` (`YYYY-MM-DD`) — kľúč denného súčtu. */
  day: DateOnly;
  /**
   * `total_paid` CELEJ objednávky v CENTOCH.
   *
   * Centy, nie float: denný súčet je sčítanie stoviek hodnôt a v `number`
   * s desatinami by sa po ceste nazbieral halier, ktorý by nikto neuvidel a
   * ktorý by sa nedal vysvetliť. Celé čísla sčítajú presne a `DECIMAL(12,2)`
   * v DB je presne to isté rozlíšenie.
   */
  totalPaidCents: number;
  /** Mena tak, ako prišla (ISO kód, veľkými). Meny sa NIKDY nesčítavajú. */
  currency: string;
}

/** Stránka zoznamu objednávok v tvare „suma za objednávku" (D117). */
export interface OrderTotalsPage {
  data: OrderTotal[];
  page: number;
  perPage: number;
  total: number;
}

/** Jedna položka objednávky zredukovaná na to, čo sa dá sčítať. */
export interface OrderLine {
  productId: number;
  qty: number;
}

/** Detail objednávky zredukovaný na kusy — bez krajiny, sumy a meny (I8'). */
export interface OrderUnits {
  id: number;
  day: DateOnly;
  lines: OrderLine[];
}

/** Stránka zoznamu objednávok. */
export interface OrdersPage {
  data: OrderRef[];
  page: number;
  perPage: number;
  total: number;
}

export interface ListOrdersParams {
  /** `YYYY-MM-DD`, inclusive. */
  dateFrom: DateOnly;
  /** `YYYY-MM-DD`, inclusive. */
  dateTo: DateOnly;
  /** 1-based; default 1. */
  page?: number;
  /** Default 50, strop 100. */
  perPage?: number;
}

/**
 * Rozhranie klienta objednávok. Kľúč je VŽDY parameter — modul nemá a nesmie
 * mať cestu, ktorou by si ho zaobstaral sám (I1).
 */
export interface OrdersClient {
  listOrders(params: ListOrdersParams, key: SecretRef, ctx: ShopCtx): Promise<OrdersPage>;
  getOrderUnits(id: number, key: SecretRef, ctx: ShopCtx): Promise<OrderUnits>;
}

/**
 * Čítanie objednávok na SUMY ZA ESHOP (D117) — ZÁMERNE samostatné rozhranie,
 * nie ďalšia metóda v `OrdersClient`.
 *
 * Dôvod nie je štýl, ale to, čo si volajúci môže vypýtať: cesta, ktorá počíta
 * KUSY po produkte (`lib/engine/sales-sync.ts` → `syncSales`), dostane
 * `OrdersClient` a k peniazom sa tým typom NEDOSTANE ani omylom. Cesta, ktorá
 * počíta dennú tržbu eshopu, dostane `OrderTotalsClient` a k položkám
 * objednávky sa nedostane. Jedno rozhranie s oboma metódami by tú hranicu
 * zmazalo a rozdelenie `total_paid` medzi položky by bolo na jeden riadok od
 * pravdy (I11).
 */
export interface OrderTotalsClient {
  /**
   * Tá istá strana zoznamu ako `listOrders()`, ale prečítaná na SUMU za
   * objednávku (D117).
   */
  listOrderTotals(params: ListOrdersParams, key: SecretRef, ctx: ShopCtx): Promise<OrderTotalsPage>;
}

/** Čo `createOrdersClient()` naozaj vracia — obe čítania nad jedným transportom. */
export type OrdersReadClient = OrdersClient & OrderTotalsClient;

/* ═════════════════════════════ 3. Schémy ══════════════════════════════════ */

const numberLike = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v : Number(v.trim())))
  .refine((n) => Number.isFinite(n), 'nie je číslo');

const intLike = numberLike.refine((n) => Number.isInteger(n), 'nie je celé číslo');

/**
 * Položka zoznamu. `looseObject` (§2): shop smie pridať pole, nesmie odobrať
 * povinné. Polia `total_paid`/`currency` sa tu ZÁMERNE nedeklarujú — čo modul
 * nepozná, to nemôže ani omylom poslať ďalej.
 */
const orderListItemSchema = z.looseObject({
  id: intLike,
  date_add: z.string(),
});

const orderListResponseSchema = z.looseObject({
  data: z.array(orderListItemSchema),
  page: intLike,
  per_page: intLike,
  total: intLike,
});

/**
 * Položka zoznamu v tvare „suma za objednávku" (D117).
 *
 * `total_paid` sa TU zámerne nekonvertuje na `number`: konverziu robí
 * `moneyToCents()`, ktorá nečitateľnú hodnotu odmietne, a odmietnutie musí byť
 * vidieť ako `schema_drift`, nie ako ticho nulová objednávka.
 */
const orderTotalItemSchema = z.looseObject({
  id: intLike,
  date_add: z.string(),
  total_paid: z.union([z.number(), z.string()]),
  currency: z.string(),
});

const orderTotalsResponseSchema = z.looseObject({
  data: z.array(orderTotalItemSchema),
  page: intLike,
  per_page: intLike,
  total: intLike,
});

const orderProductSchema = z.looseObject({
  id: intLike,
  qty: intLike,
});

/**
 * Detail objednávky. `ok` je nepovinné (zdieľané helpery ho pridávajú
 * nekonzistentne), ale keď je prítomné, musí byť `true` — `ok:false` sem
 * nikdy nedorazí, odchytí ho `readErrorBody()` skôr.
 */
const orderDetailSchema = z.looseObject({
  ok: z.literal(true).optional(),
  id: intLike,
  date_add: z.string(),
  products: z.array(orderProductSchema).optional(),
});

/**
 * Niektoré nasadenia shopu obaľujú odpoveď do `{"result":{…}}`, iné vracajú
 * bare objekt. Rozbalíme oboje — obal nie je `schema_drift`, len konvencia.
 */
export function unwrapEnvelope(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  const inner = (body as Record<string, unknown>).result;
  return typeof inner === 'object' && inner !== null ? inner : body;
}

/**
 * `"2026-08-01 10:22:00"` → `"2026-08-01"`; nečitateľný vstup → `null`.
 *
 * ZÓNA: `date_add` je HODINA SHOPU a appka ju NEPREPOČÍTAVA — z reťazca sa
 * odreže dátumová časť, takže deň objednávky je vždy ten, ktorý by na tej
 * objednávke prečítal človek v administrácii eshopu. Dokumentácia shopu
 * (`docs/api/sperky-api-v5.md`) zónu `date_add` NIKDE nemenuje, takže akýkoľvek
 * prevod na UTC alebo do `LOGIC_TIMEZONE` by bol domnienka, ktorá by pri
 * objednávkach okolo polnoci ticho presúvala tržbu o deň. Vedomé rozhodnutie:
 * radšej ponechať zónu zdroja a povedať to nahlas, než hádať.
 */
export function dayFromDateAdd(dateAdd: string): DateOnly | null {
  const head = dateAdd.trim().slice(0, 10);
  return DATE_ONLY_RE.test(head) ? head : null;
}

/** Suma s najviac 12 celými a 6 desatinnými miestami; `,` aj `.` (D117). */
const MONEY_RE = /^-?\d{1,12}(?:[.,]\d{1,6})?$/;

/** Mena je ISO kód — nič iné sa do primárneho kľúča tržby nedostane (D117). */
const CURRENCY_RE = /^[A-Za-z]{3}$/;

/**
 * `total_paid` → CENTY. `null` = hodnota sa nedá prečítať.
 *
 * `null` NIE JE nula a volajúci ho tak nesmie brať: pre denný súčet je jediná
 * poctivá odpoveď na nečitateľnú sumu `schema_drift` (stav neistý, D54). Keby sa
 * taká objednávka len preskočila, deň by sa uzavrel ako úplný so sumou, ktorá je
 * TICHO nižšia — presne tá lož, ktorú I11 zakazuje.
 *
 * Zaokrúhľuje sa na centy, pretože `DECIMAL(12,2)` v `shop_revenue_daily` má to
 * isté rozlíšenie; shop podľa dokumentácie posiela dve desatiny.
 */
export function moneyToCents(value: unknown): number | null {
  const text =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  // `String(1e21)` je `"1e+21"` — exponent regex neprejde a hodnota skončí ako
  // „nečitateľná" (fail-closed), nie ako pretečené číslo.
  if (!MONEY_RE.test(text)) return null;
  const parsed = Number(text.replace(',', '.'));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

/** CENTY → `"12345.67"` pre `DECIMAL(12,2)`. Nikdy float, nikdy locale. */
export function centsToMoneyString(cents: number): MoneyString {
  const whole = Math.trunc(Math.abs(Math.trunc(cents)) / 100);
  const rest = Math.abs(Math.trunc(cents)) % 100;
  return `${cents < 0 ? '-' : ''}${whole}.${String(rest).padStart(2, '0')}`;
}

/* ══════════════════════════ 4. Závislosti klienta ═════════════════════════ */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OrdersClientDeps {
  /** Base URL alebo jej (async) resolver — doména nikdy nežije v module (D80). */
  baseUrl: string | (() => string | Promise<string>);
  fetchImpl?: FetchLike;
  logger?: Logger;
  version?: string;
  readTimeoutMs?: number;
  policy?: RetryPolicy;
  sleepFn?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Eskalácia „API sa zmenilo" (D54). */
  onSchemaDrift?: (info: { path: string; ctx: ShopCtx; error: ShopError }) => void;
  /**
   * 401/403 pri čítaní objednávok. Klient kľúč sám NEWIPUJE (nevlastní
   * `api-key.repo.ts`) — len ohlási, že shop kľúč odmietol.
   */
  onKeyRejected?: (info: {
    kind: 'unauthorized' | 'forbidden';
    ctx: ShopCtx;
    error: ShopError;
  }) => void;
}

interface RequestSpec {
  path: string;
  query: Record<string, string | number>;
  /** Kľúč sa zostaví do hlavičky VÝHRADNE keď je tu uvedený (D48). */
  key: SecretRef;
  ctx: ShopCtx;
  requestId?: Ulid;
}

interface SuccessEnvelope {
  httpStatus: number;
  body: unknown;
  requestId: Ulid;
}

/* ══════════════════════════════ 5. Klient ═════════════════════════════════ */

export function createOrdersClient(deps: OrdersClientDeps): OrdersReadClient {
  const log = deps.logger ?? defaultLogger;
  const fetchImpl: FetchLike =
    deps.fetchImpl ?? ((input, init) => fetch(input, init) as Promise<Response>);
  const nowMs = deps.now ?? Date.now;
  const sleepFn = deps.sleepFn ?? defaultSleep;
  const version = (): string => deps.version ?? env.APP_VERSION ?? APP_VERSION;
  const timeoutMs = (): number =>
    deps.readTimeoutMs ?? env.SHOP_TIMEOUT_READ_MS ?? DEFAULT_READ_TIMEOUT_MS;

  const policy = (): RetryPolicy => ({
    maxAttempts: deps.policy?.maxAttempts ?? ORDERS_MAX_ATTEMPTS,
    retryAfterCapSeconds: deps.policy?.retryAfterCapSeconds ?? ORDERS_RETRY_WAIT_CAP_S,
    backoffMs: deps.policy?.backoffMs ?? ORDERS_BACKOFF_MS,
  });

  /** Čakanie pre `attempt`-ý pokus podľa nášho backoffu (1-based). */
  function backoffSecondsFor(attempt: number): number {
    const table = policy().backoffMs ?? ORDERS_BACKOFF_MS;
    if (table.length === 0) return 0;
    const index = Math.min(Math.max(attempt, 1), table.length) - 1;
    return Math.ceil((table[index] ?? 0) / 1000);
  }

  async function resolveBaseUrl(): Promise<string> {
    const raw = typeof deps.baseUrl === 'function' ? await deps.baseUrl() : deps.baseUrl;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new ShopConfigError('resolver nevrátil base URL');
    }
    return raw.replace(/\/+$/, '');
  }

  function buildUrl(base: string, path: string, query: RequestSpec['query']): string {
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    return url.toString();
  }

  /* ─────────────────── 5.1 jeden HTTP pokus (bez retry) ─────────────────── */

  async function sendOnce(
    spec: RequestSpec,
    requestId: Ulid,
    attempt: number,
  ): Promise<{ status: 'ok'; value: SuccessEnvelope } | { status: 'error'; error: ShopError }> {
    const base = await resolveBaseUrl();
    const url = buildUrl(base, spec.path, spec.query);
    const startedAt = nowMs();

    // Hlavičky sa zostavujú pre KAŽDÝ pokus nanovo — objekt s kľúčom nikdy
    // neprežije jeden request (I1, D64).
    const headers: Record<string, string> = baseHeaders(requestId, version());
    const signal = AbortSignal.timeout(timeoutMs());
    let handle: SecretHandle | null = null;
    let response: Response;

    // D64: dešifrovanie tesne pred odoslaním, ale MIMO transportného
    // try/catch. Chyba `SecretRef` (expirovaný/wipnutý kľúč) NIE JE sieťová
    // chyba: nesmie sa klasifikovať ako retryable `network` a točiť backoff —
    // preletí volajúcemu a request sa NEODOŠLE.
    handle = await spec.key();

    try {
      // Plaintext existuje ako string len v tejto hlavičke a len po dobu
      // jedného requestu; `finally` ho maže a `release()` prepíše Buffer
      // nulami. NIKDY sa neloguje (I1).
      headers['X-Api-Key'] = handle.value.toString('utf8');

      if (signal.aborted) {
        return {
          status: 'error',
          error: transportError(signal.reason, 'read', { requestId, alreadyAborted: true }),
        };
      }

      response = await fetchImpl(url, {
        method: 'GET',
        headers,
        signal,
        redirect: 'error', // presmerovanie by odniesol kľúč na cudzí host (I1)
        cache: 'no-store',
      });
    } catch (error) {
      const shopError = transportError(error, 'read', { requestId });
      log.warn('orders_request_transport_failed', {
        ...correlationLogFields(spec.ctx, requestId),
        path: spec.path,
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
      return { status: 'error', error: transportError(error, 'read', { requestId }) };
    }

    let parsed: unknown;
    let jsonOk = true;
    try {
      parsed = text.length === 0 ? null : JSON.parse(text);
    } catch {
      jsonOk = false;
      parsed = { nonJsonBody: text.slice(0, 512) };
    }

    const payload = unwrapEnvelope(parsed);
    const durationMs = nowMs() - startedAt;
    const ok2xx = httpStatus >= 200 && httpStatus < 300;
    const failureInBody = bodySignalsFailure(payload) || bodySignalsFailure(parsed);

    log.debug('orders_request_done', {
      ...correlationLogFields(spec.ctx, requestId),
      path: spec.path,
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
          raw: payload,
        }),
      };
    }

    // §6: HTTP 200 s `ok:false` sa NIKDY nepovažuje za úspech. `not found`
    // vracia tento endpoint dokonca s HTTP 200 (dokumentácia to priznáva).
    if (!ok2xx || failureInBody) {
      const read = readErrorBody(payload);
      const codes = read.codes.length > 0 ? read.codes : readErrorBody(parsed).codes;
      const kind = classifyFailure(httpStatus, codes);

      // R-2: `rate_limited` je spomaľovacie. Čakáme dlhšiu z dvoch hodnôt —
      // hlavičky shopu (keď vôbec príde) a nášho backoffu — a zastropujeme.
      let retryAfterSeconds: number | undefined;
      if (kind === 'rate_limited') {
        const fromHeader =
          parseRetryAfterSeconds(response.headers.get('retry-after'), {
            capSeconds: ORDERS_RETRY_WAIT_CAP_S,
            now: nowMs,
          }) ?? 0;
        retryAfterSeconds = Math.min(
          Math.max(fromHeader, backoffSecondsFor(attempt)),
          ORDERS_RETRY_WAIT_CAP_S,
        );
      }

      return {
        status: 'error',
        error: makeShopError({
          kind,
          codes,
          httpStatus,
          requestId,
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
          raw: payload,
        }),
      };
    }

    return { status: 'ok', value: { httpStatus, body: payload, requestId } };
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
        sendOnce(spec, attempt === 1 ? firstRequestId : newRequestId(), attempt),
      onRetry: ({ attempt, delayMs, error }) => {
        log.warn('orders_request_retry', {
          ...correlationLogFields(spec.ctx, error.requestId),
          path: spec.path,
          attempt,
          delayMs,
          kind: error.kind,
          httpStatus: error.httpStatus ?? undefined,
        });
      },
    });
  }

  function reportDrift(path: string, ctx: ShopCtx, error: ShopError): void {
    log.error('orders_schema_drift', {
      ...correlationLogFields(ctx, error.requestId),
      path,
      httpStatus: error.httpStatus ?? undefined,
    });
    deps.onSchemaDrift?.({ path, ctx, error });
  }

  /** E4 — 401/403 je TERMINAL. Ohlásime ho, nikdy z neho nerobíme retry. */
  function reportIfKeyRejected(ctx: ShopCtx, error: ShopError): void {
    if (error.kind !== 'unauthorized' && error.kind !== 'forbidden') return;
    log.error('orders_key_rejected', {
      ...correlationLogFields(ctx, error.requestId),
      kind: error.kind,
      httpStatus: error.httpStatus ?? undefined,
    });
    deps.onKeyRejected?.({ kind: error.kind, ctx, error });
  }

  function fail(error: ShopError): never {
    throw new ShopRequestError(error);
  }

  /* ─────────────────────────── 5.3 zoznam objednávok ────────────────────── */

  /** Jedna strana zoznamu — spoločná pre cestu na kusy aj pre cestu na sumy. */
  async function fetchOrderListPage(
    params: ListOrdersParams,
    key: SecretRef,
    ctx: ShopCtx,
  ): Promise<SuccessEnvelope> {
    if (!DATE_ONLY_RE.test(params.dateFrom) || !DATE_ONLY_RE.test(params.dateTo)) {
      fail(makeShopError({ kind: 'bad_request', code: 'local_invalid_dates' }));
    }
    const page = Number.isInteger(params.page) && (params.page as number) > 0 ? (params.page as number) : 1;
    const requested = Number.isInteger(params.perPage)
      ? (params.perPage as number)
      : ORDERS_DEFAULT_PER_PAGE;
    const perPage = Math.min(Math.max(1, requested), ORDERS_MAX_PER_PAGE);

    const result = await send({
      path: ORDERS_PATHS.orderList,
      query: {
        date_from: params.dateFrom,
        date_to: params.dateTo,
        page,
        per_page: perPage,
      },
      key,
      ctx,
    });
    if (result.outcome === 'error') {
      reportIfKeyRejected(ctx, result.error);
      fail(result.error);
    }
    return result.value;
  }

  async function listOrders(
    params: ListOrdersParams,
    key: SecretRef,
    ctx: ShopCtx,
  ): Promise<OrdersPage> {
    const envelope = await fetchOrderListPage(params, key, ctx);

    const parsed = parseShopPayload(orderListResponseSchema, envelope.body);
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: envelope.requestId,
        httpStatus: envelope.httpStatus,
        issues: parsed.issues,
        raw: envelope.body,
      });
      reportDrift(ORDERS_PATHS.orderList, ctx, error);
      fail(error);
    }

    // Tu sa objednávka redukuje na `(id, deň)` — všetko ostatné (suma, mena,
    // krajina) zostáva v odpovedi a modul ho ďalej nepodá (I8' bod 3).
    const data: OrderRef[] = [];
    for (const item of parsed.value.data) {
      const day = dayFromDateAdd(item.date_add);
      if (day === null) continue; // nečitateľný `date_add` — objednávku preskočíme
      data.push({ id: item.id, day });
    }

    return {
      data,
      page: parsed.value.page,
      perPage: parsed.value.per_page,
      total: parsed.value.total,
    };
  }

  /* ───────── 5.3b zoznam objednávok ako SUMY ZA ESHOP (D117) ─────────────── */

  /**
   * Tá istá strana zoznamu, prečítaná na `(deň, mena, suma)`.
   *
   * Prečo je nečitateľná položka `schema_drift`, a nie preskočená objednávka
   * (na rozdiel od `listOrders()` vyššie): tam sa počítajú kusy a vynechaná
   * objednávka deň ZNEÚPLNÍ, čo volajúci vidí. Tu sa počítajú peniaze a
   * vynechaná objednávka by deň nechala vyzerať úplný so sumou TICHO nižšou.
   * Stav neistý sa preto priznáva (D54), nikdy sa neodhaduje (I11).
   */
  async function listOrderTotals(
    params: ListOrdersParams,
    key: SecretRef,
    ctx: ShopCtx,
  ): Promise<OrderTotalsPage> {
    const envelope = await fetchOrderListPage(params, key, ctx);

    const parsed = parseShopPayload(orderTotalsResponseSchema, envelope.body);
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: envelope.requestId,
        httpStatus: envelope.httpStatus,
        issues: parsed.issues,
        raw: envelope.body,
      });
      reportDrift(ORDERS_PATHS.orderList, ctx, error);
      fail(error);
    }

    const data: OrderTotal[] = [];
    const issues: string[] = [];
    for (const item of parsed.value.data) {
      const day = dayFromDateAdd(item.date_add);
      const cents = moneyToCents(item.total_paid);
      const currency = item.currency.trim().toUpperCase();
      if (day === null) issues.push(`date_add: invalid_format`);
      else if (cents === null) issues.push(`total_paid: unreadable`);
      else if (!CURRENCY_RE.test(currency)) issues.push(`currency: invalid_format`);
      else data.push({ id: item.id, day, totalPaidCents: cents, currency });
    }
    if (issues.length > 0) {
      const error = schemaDriftError({
        requestId: envelope.requestId,
        httpStatus: envelope.httpStatus,
        // Do chyby ide len ZARADENIE problému, nikdy hodnota z odpovede (I1).
        issues: [...new Set(issues)],
      });
      reportDrift(ORDERS_PATHS.orderList, ctx, error);
      fail(error);
    }

    return {
      data,
      page: parsed.value.page,
      perPage: parsed.value.per_page,
      total: parsed.value.total,
    };
  }

  /* ──────────────────────── 5.4 detail objednávky ───────────────────────── */

  async function getOrderUnits(id: number, key: SecretRef, ctx: ShopCtx): Promise<OrderUnits> {
    if (!Number.isInteger(id) || id <= 0) {
      fail(makeShopError({ kind: 'bad_request', code: 'local_invalid_order_id' }));
    }

    const result = await send({
      path: ORDERS_PATHS.orderGet,
      query: { id },
      key,
      ctx,
    });
    if (result.outcome === 'error') {
      reportIfKeyRejected(ctx, result.error);
      fail(result.error);
    }

    const parsed = parseShopPayload(orderDetailSchema, result.value.body);
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: parsed.issues,
        raw: result.value.body,
      });
      reportDrift(ORDERS_PATHS.orderGet, ctx, error);
      fail(error);
    }

    const day = dayFromDateAdd(parsed.value.date_add);
    if (day === null) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: ['date_add: invalid_format'],
      });
      reportDrift(ORDERS_PATHS.orderGet, ctx, error);
      fail(error);
    }

    const lines: OrderLine[] = [];
    for (const product of parsed.value.products ?? []) {
      if (product.id <= 0 || product.qty <= 0) continue;
      lines.push({ productId: product.id, qty: product.qty });
    }

    return { id: parsed.value.id, day, lines };
  }

  return { listOrders, getOrderUnits, listOrderTotals };
}

/* ═══════════════════ 6. Konštrukcia z nastavení (D80) ═════════════════════ */

/** Minimálne rozhranie, ktoré klient potrebuje od `settings.repo` (A8). */
export interface OrdersSettingsSource {
  get(): Promise<{ shopDomain: string | null }>;
}

/**
 * Klient, ktorý si base URL prečíta z `settings` pri KAŽDOM volaní — zmena
 * domény tak platí okamžite a doména nikdy nežije v module (R5, D80).
 *
 * Normalizácia domény je zdieľaná so shop klientom, aby existovalo jediné
 * miesto, ktoré rozhoduje, čo je platná doména shopu.
 */
export function createOrdersClientFromSettings(
  settings: OrdersSettingsSource,
  deps: Omit<OrdersClientDeps, 'baseUrl'> = {},
): OrdersReadClient {
  return createOrdersClient({
    ...deps,
    baseUrl: async () => shopBaseUrlFromSettings(await settings.get()),
  });
}

/* ═════════════ 7. Sonda kľúča na objednávky (KONTRAKT-PREDAJNOST) ══════════ */

/**
 * Overí, či kľúč na shope skutočne prejde čítaním objednávok. Býva tu, a nie
 * v `src/lib/keys/`, pretože invariant I8' dovoluje `/api/order` výhradne
 * tomuto modulu — sonda je len najlacnejšie možné čítanie (jedna strana,
 * jedna položka, jeden deň).
 *
 * Vyhodnotenie kopíruje sondu zápisového kľúča (`client.ts probeKey`):
 * úspech = `valid`, 401 = `invalid`, 403 = `forbidden`, čokoľvek iné
 * (429, 500, timeout, drift, zlá doména) = `unknown`. Fail-closed — kľúč sa
 * NIKDY nevyhodnotí ako platný na základe nejasnej odpovede, takže sa neuloží
 * kľúč, o ktorom nevieme, či funguje.
 *
 * Kľúč sa odtiaľ nikam nevracia ani neloguje (I1) a s `setReduction` nemá tento
 * modul nič spoločné — objednávkový kľúč sa preto k zápisu zliav nedostane.
 */
export function createOrdersKeyProbe(client: OrdersClient, timeZone?: string): OrdersKeyProbe {
  return async (key: SecretRef, ctx: ShopCtx): Promise<KeyProbeResult> => {
    const day = todayInTimeZone(timeZone ?? env.LOGIC_TIMEZONE, Date.now());
    try {
      await client.listOrders({ dateFrom: day, dateTo: day, page: 1, perPage: 1 }, key, ctx);
      return 'valid';
    } catch (error) {
      if (!isShopRequestError(error)) return 'unknown';
      const { kind } = error.shopError;
      if (kind === 'unauthorized') return 'invalid';
      if (kind === 'forbidden') {
        // `ip_banned` je tiež 403, ale o kľúči nehovorí nič — shop ho vráti aj
        // na volanie bez kľúča. Rozlišuje telo, nie status.
        return isIpBanned(error.shopError) ? 'address_banned' : 'forbidden';
      }
      return 'unknown';
    }
  };
}

/** Sonda nad produkčnými nastaveniami — to, čo zapája `/api/key`. */
export function probeOrdersKeyFromSettings(settings: OrdersSettingsSource): OrdersKeyProbe {
  return createOrdersKeyProbe(createOrdersClientFromSettings(settings));
}
