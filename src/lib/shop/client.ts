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
 *   - **D48 / D53** — `X-Api-Key` sa posiela len pri `setReduction` a pri
 *     `whoami` (overenie kľúča, API v5). Čítacie volania (`listProducts`,
 *     `getProduct`, `batchGetProducts`, `canary`) sú verejné a hlavičku vôbec
 *     nezostavia: čítacia cesta nemá parameter, ktorým by sa kľúč dal podstrčiť.
 *   - **I1 pri `whoami`** — odpoveď nesie `id`, `name` a `owner` kľúča. Tento
 *     modul ich ZÁMERNE ani neparsuje: von ide výhradne zoznam scopes (uzavretý
 *     číselník produktových scopes) a dve čísla zostatku. Z ničoho z toho sa kľúč
 *     odvodiť nedá, takže to smie ísť do logu, auditu aj do odpovede API.
 *   - **§6** — HTTP 200 s `ok:false` NIKDY nie je úspech; HTTP 200 s tvarom,
 *     ktorý neprejde zod, je `schema_drift`, teda „stav neistý" (D54).
 *   - **D45** — timeout po odoslaní zápisu = `uncertain` + PRESNE JEDEN
 *     identický resend; druhá odpoveď je konečná.
 *   - **I7** — neexistuje funkcia, ktorá zľavu ruší. Zápis s `to` v minulosti
 *     klient ODMIETNE ešte pred odoslaním (`local_to_in_past`).
 *   - **I8** — klient pozná výhradne cesty pod `/api/products`, `/api/batch`,
 *     `/api/whoami` a `/api/categories` (celý zoznam je `SHOP_PATHS`);
 *     objednávkové endpointy a ich scope sa v module nevyskytujú.
 *   - **I9** — percento 1–30, `to ≥ from`, okno ≤ 3 mesiace sa kontroluje aj tu
 *     (druhá obrana; prvá je `lib/engine/guards.ts`).
 *   - **D58** — každý request nesie `User-Agent: aura-zlavy/<verzia>`,
 *     `X-Request-Id` a je zalogovaný s `operation_id`/`request_id`.
 *
 * Vlastník: A3.
 */
import { z } from 'zod';

import type {
  CanaryResult,
  DateOnly,
  KeyProbeResult,
  Logger,
  Paged,
  ProductDetail,
  ProductFullDetail,
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
  isIpBanned,
  isTerminalKind,
  isUncertainKind,
  makeShopError,
  schemaDriftError,
  transportError,
  type RequestPhase,
} from '@/lib/shop/errors';
import {
  normalizeRemaining,
  type RemainingFromWhoami,
} from '@/lib/shop/rate-limits';
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
  productFullSchema,
  productListResponseSchema,
  readErrorBody,
  setReductionSuccessSchema,
  toProductDetail,
  toProductFull,
  toProductListItem,
  unwrapShopResult,
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
  /** `GET /api/products/getFull` (v5, bod A1) — čítanie so scope `product:read`. */
  productGetFull: '/api/products/getFull',
  /**
   * `GET /api/products/searchIndex` (v5) — fuzzy hľadanie cez Meilisearch.
   * VEREJNÉ, rovnako ako `productGet`: kľúč sa preň nezostavuje (D48, I1).
   */
  productSearchIndex: '/api/products/searchIndex',
  /** `GET /api/products/search` (v5) — presné filtre, so scope `product:read`. */
  productSearch: '/api/products/search',
  setReduction: '/api/products/setReduction',
  batch: '/api/batch',
  /** `GET /api/whoami` (v5) — introspekcia kľúča, nevyžaduje žiadny scope. */
  whoami: '/api/whoami',
  /** `GET /api/categories` (v5) — strom kategórií, so scope `product:read`. */
  categories: '/api/categories',
} as const;

/** `POST /api/batch` — max 25 položiek (D56). */
export const BATCH_MAX_ITEMS = 25;

/** Percento zľavy: celé číslo 1–30 (D11, I9). `0` je vyhradená pre sondu (D53). */
export const MIN_REDUCTION_PERCENT = 1;
export const MAX_REDUCTION_PERCENT = 30;

/** Maximálna dĺžka okna zľavy v mesiacoch (D29, shop `range_too_long`). */
export const MAX_WINDOW_MONTHS = 3;

/*
 * `PROBE_PRODUCT_ID` tu ZÁMERNE už nie je.
 *
 * Do API v4 sa platnosť kľúča nedala overiť inak než sondou na ZÁPISOVOM
 * endpointe: `POST /api/products/setReduction` s `id=0` a `reduction=0`, teda
 * požiadavkou, ktorú shop musí odmietnuť. Nikdy nič nezapísala, ale v štatistike
 * shopu vyzerala ako zápis — maintainer videl 22 volaní `setReduction`, z toho
 * 21 skutočných zápisov a jednu sondu, ktorú nikto nevedel vysvetliť.
 *
 * API v5 pridal `GET /api/whoami` (akýkoľvek platný kľúč, žiadny konkrétny
 * scope), takže sonda stratila dôvod existovať a je preč — aj konštanta, aj
 * parameter `probeProductId`. Overenie kľúča je odteraz ČÍTANIE. Nezakladaj ju
 * znova: `setReduction` smie volať výhradne skutočný zápis zľavy (I13 — zápis
 * len keď je `WRITES_ENABLED`; sonda ten prepínač obchádzala).
 */

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

/* ══════════════ 3b. `whoami` — scopes a živé limity (v5, bod D) ═══════════ */

/**
 * Scopes, ktoré tento klient pozná — VÝHRADNE produktové.
 *
 * `product:read` pribudol vo v5 pre `getFull`, `search` a `categories`. Appka
 * doteraz poznala len `product:edit` (zápis zľavy), takže kľúč bez
 * `product:read` sa prejavil ako mlčanie — funkcia sa jednoducho nedala použiť
 * a nikto nevedel prečo. Odteraz sa to dá povedať vetou (`missingScopeSentence`).
 *
 * Scope objednávok v tomto zozname ZÁMERNE nie je a nesmie tu byť ani ako text:
 * I8' hovorí, že objednávkovú cestu vlastní `orders-client.ts` a tento modul
 * o nej nevie ani slovo (stráži to grep test `test/unit/shop-errors.spec.ts`).
 * Objednávkový kľúč sa neoveruje cez `whoami`, ale čítaním objednávok, takže
 * tu jeho scope nemá čo robiť. Scope, ktorý sem nepatrí, sa preto len SPOČÍTA
 * ako „iný" — nie je to chyba, len to nie je vec produktovej cesty.
 */
export const SHOP_SCOPES = ['product:read', 'product:edit'] as const;

export type ShopScope = (typeof SHOP_SCOPES)[number];

const SHOP_SCOPE_SET: ReadonlySet<string> = new Set<string>(SHOP_SCOPES);

export function isShopScope(value: unknown): value is ShopScope {
  return typeof value === 'string' && SHOP_SCOPE_SET.has(value);
}

/**
 * Čo si z `whoami` odnášame.
 *
 * ZÁMERNE tu NIE JE `id`, `name` ani `owner` (I1). Odpoveď shopu ich nesie, ale
 * meno kľúča a meno jeho vlastníka sú metadáta kľúča: nemajú v tejto appke
 * jediného spotrebiteľa a v logu alebo v odpovedi API by boli len zbytočnou
 * stopou po tom, ktorý kľúč sa práve používa. Von ide uzavretý číselník scopes
 * a dve čísla zostatku — a nič z toho sa nedá spätne priradiť ku kľúču.
 */
export interface WhoamiInfo {
  /** Produktové scopes, ktoré tento klient pozná. Poradie je z odpovede shopu. */
  readonly scopes: readonly ShopScope[];
  /**
   * Koľko scopes shop poslal navyše — či už mimo produktovej cesty (objednávky,
   * I8'), alebo úplne neznámych. Ukladá sa POČET, nie hodnoty: je to signál
   * „kľúč vie aj niečo iné", nie údaj do UI.
   */
  readonly otherScopeCount: number;
  /** Živý zostatok rozpočtu tohto kľúča; `null` v poli = „nevieme". */
  readonly remaining: RemainingFromWhoami;
}

/**
 * Výsledok `whoami`. Fail-closed: čokoľvek, čo nie je jednoznačná odpoveď
 * shopu, je `unknown` — nikdy sa z neistoty nestane „kľúč je v poriadku".
 */
export type WhoamiOutcome =
  | { readonly status: 'ok'; readonly info: WhoamiInfo }
  /** 401 — shop kľúč nepozná. */
  | { readonly status: 'invalid'; readonly error: ShopError }
  /** 403 — kľúč existuje, ale shop mu volanie zakázal. */
  | { readonly status: 'forbidden'; readonly error: ShopError }
  /**
   * 403 s kódom `ip_banned` — shop odmieta našu ADRESU, nie náš kľúč. Kľúč
   * v tomto stave nie je platný ani neplatný; je NEOVERENÝ.
   */
  | { readonly status: 'address_banned'; readonly error: ShopError }
  /** 429, 500, timeout, zmenený tvar odpovede, nedostupná doména. */
  | { readonly status: 'unknown'; readonly error: ShopError };

/**
 * Tvar odpovede `GET /api/whoami` (v5).
 *
 * `looseObject` podľa konvencie §2 — shop smie pridať pole, nesmie odobrať
 * povinné. Povinné je preň `ok` a `scopes`; `remaining` je zámerne NEPOVINNÉ,
 * lebo jeho absencia je legitímne „nevieme" a nie `schema_drift` — appka vtedy
 * spadne na zálohu (`resolveKeyedBudget`) namiesto toho, aby overenie kľúča
 * zlyhalo pre chýbajúce číslo. `id`, `name` a `owner` sa neuvádzajú, takže sa
 * ani neparsujú (I1).
 */
export const whoamiResponseSchema = z.looseObject({
  ok: z.literal(true),
  scopes: z.array(z.unknown()),
  remaining: z
    .looseObject({
      per_minute: z.unknown().optional(),
      per_day: z.unknown().optional(),
    })
    .optional(),
});

/** Rozdelí scopes zo shopu na produktové (známe) a spočíta tie ostatné. */
export function parseShopScopes(raw: readonly unknown[]): {
  scopes: ShopScope[];
  otherScopeCount: number;
} {
  const scopes: ShopScope[] = [];
  let otherScopeCount = 0;
  for (const value of raw) {
    if (isShopScope(value)) {
      if (!scopes.includes(value)) scopes.push(value);
      continue;
    }
    otherScopeCount += 1;
  }
  return { scopes, otherScopeCount };
}

/**
 * Má kľúč tento scope? Tri stavy, nie dva.
 *
 * `null` znamená „nevieme" — `whoami` sa nedalo prečítať, alebo sa od uloženia
 * kľúča nevolalo. Vracať pri tom `false` by bola lož („kľúč to nemá"), vracať
 * `true` by bolo nebezpečné. Volajúci MUSÍ rozlíšiť všetky tri.
 */
export function hasShopScope(
  scopes: readonly ShopScope[] | null | undefined,
  scope: ShopScope,
): boolean | null {
  if (scopes === null || scopes === undefined) return null;
  return scopes.includes(scope);
}

/** Slovenské pomenovanie toho, čo scope odomyká — pre vetu používateľovi. */
const SCOPE_PURPOSE: Readonly<Record<ShopScope, string>> = {
  'product:read': 'čítanie skladu, marže a kategórií produktu',
  'product:edit': 'zápis zľavy',
};

/**
 * Veta o scope, ktorý kľúču chýba alebo o ktorom nevieme.
 *
 * Mlčanie je najhoršia možnosť: funkcia sa nedá použiť a používateľ nemá ako
 * zistiť prečo. Názov scope vo vete zostáva zámerne — je to presne to slovo,
 * ktoré má používateľ napísať správcovi shopu, keď o kľúč žiada.
 */
export function missingScopeSentence(scope: ShopScope, known: boolean): string {
  const co = SCOPE_PURPOSE[scope];
  if (!known) {
    return `Nevieme, či kľúč má oprávnenie ${scope} (${co}) — shop sa na to zatiaľ nepodarilo opýtať. Kým to nevieme, appka sa oň neopiera.`;
  }
  return `Kľúč nemá oprávnenie ${scope}, takže ${co} zatiaľ nefunguje. Vypýtaj si od správcu shopu kľúč s týmto oprávnením (alebo rozšírenie toho súčasného).`;
}

/* ═════════════ 3c. Hľadanie produktov (v5, kontrakt UI body 25–28) ════════ */

/**
 * Celé číslo zo shopu, tolerantne.
 *
 * ZÁMERNE sa nepreberá `numberLike` zo `schemas.ts`: ten je stavaný na PENIAZE
 * (`'1 234,50'` aj `'1,234.50'` je to isté číslo) a tá tolerancia pri ID a pri
 * stránkovaní nie je cnosť, ale diera — `'1,234'` je ako cena nejednoznačné,
 * ako ID je to nezmysel a má sa priznať ako `schema_drift` (D54). Tu preto
 * prejde len číslo alebo číslica v stringu, nič iné.
 */
const shopIntLike = z
  .union([z.number(), z.string().regex(/^\s*-?\d+\s*$/)])
  .transform((value) => (typeof value === 'number' ? value : Number(value.trim())))
  .refine((n) => Number.isInteger(n), 'nie je celé číslo');

/**
 * Odpoveď oboch hľadacích endpointov (`search`, `searchIndex`).
 *
 * Obidva vracajú **LEN ID** — `{ok, data: [id, id, …], page, per_page, total}`.
 * Nie je to zabudnutá polovica odpovede: shop tým hovorí „názov si vypýtaj
 * zvlášť", a práve preto je hľadanie v tejto appke dvojkrokové a rozpočtované.
 *
 * `ok` je nepovinné z rovnakého dôvodu ako v `productDetailSchema` — keď
 * príde, `readErrorBody()` už `ok:false` odchytil skôr (§6).
 */
export const productIdPageSchema = z.looseObject({
  ok: z.literal(true).optional(),
  data: z.array(shopIntLike),
  page: shopIntLike,
  per_page: shopIntLike,
  total: shopIntLike,
});

/** Stránka ID-čiek z hľadania. Názvy a ceny sa dopĺňajú samostatne. */
export interface ShopIdPage {
  /** ID v poradí, v akom ich shop poslal. Pri `searchIndex` je to RELEVANCIA. */
  readonly ids: readonly number[];
  readonly page: number;
  readonly perPage: number;
  /** Koľko produktov shop na túto otázku našiel celkovo — MERANÝ fakt, nie odhad. */
  readonly total: number;
}

/** Tvrdý strop `per_page` na oboch hľadacích endpointoch (v5). */
export const SHOP_SEARCH_MAX_PER_PAGE = 100;

/**
 * Parametre verejného `searchIndex`. Index vie filtrovať VÝHRADNE `active`
 * a `price` — kategórie, výrobcovia ani vlastné triedenie sa doň poslať nedajú
 * a nikdy sa sem nesmú prepašovať, lebo shop ich ticho ignoruje (a používateľ
 * by dostal „výsledok filtra", ktorý filter nikdy nevidel — presne to, čo
 * zakazuje K8).
 */
export interface ShopSearchIndexParams {
  /** Voľný text: názov, popis, **kód produktu** aj kategórie; znáša preklepy. */
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  perPage?: number;
}

/** Podľa čoho vie triediť `search` (verejný `searchIndex` triediť nevie). */
export type ShopSearchSortBy = 'id' | 'name' | 'price' | 'date_add';
export type ShopSearchSortDir = 'asc' | 'desc';

/**
 * Parametre `search` — presné filtre za scope `product:read`.
 *
 * Nadmnožina `searchIndex`: čo je tu navyše, to je presne to, čo appka
 * bez `product:read` NEVIE, a čo preto musí vedieť pomenovať ako zamknuté.
 */
export interface ShopSearchParams extends ShopSearchIndexParams {
  categories?: readonly number[];
  manufacturers?: readonly number[];
  suppliers?: readonly number[];
  /** Len produkty, ktoré v shope práve majú zľavu. */
  onlyDiscounted?: boolean;
  sortBy?: ShopSearchSortBy;
  sortDir?: ShopSearchSortDir;
}

/** Jedna kategória z `GET /api/categories` (scope `product:read`). */
export interface ShopCategory {
  readonly id: number;
  readonly name: string;
  /** `0` = koreň stromu. */
  readonly parentId: number;
  readonly depth: number;
}

export const categoryListSchema = z.looseObject({
  ok: z.literal(true).optional(),
  data: z.array(
    z.looseObject({
      id: shopIntLike,
      name: z.string(),
      id_parent: shopIntLike,
      level_depth: shopIntLike,
    }),
  ),
});

/** Spoločná časť query pre obe hľadania — jediné miesto, kde sa skladá. */
function searchIndexQuery(params: ShopSearchIndexParams): RequestSpec['query'] {
  const perPage =
    params.perPage === undefined
      ? undefined
      : Math.min(SHOP_SEARCH_MAX_PER_PAGE, Math.max(1, Math.trunc(params.perPage)));
  return {
    ...(params.search !== undefined ? { search: params.search } : {}),
    ...(params.minPrice !== undefined ? { minPrice: params.minPrice } : {}),
    ...(params.maxPrice !== undefined ? { maxPrice: params.maxPrice } : {}),
    ...(params.page !== undefined ? { page: Math.max(1, Math.trunc(params.page)) } : {}),
    ...(perPage !== undefined ? { per_page: perPage } : {}),
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
  /**
   * Query. Pole sa serializuje ako opakovaný kľúč (`categories[]=1&categories[]=2`),
   * pretože tak ho PHP číta ako pole — `set()` by z dvoch kategórií nechal jednu.
   */
  query?: Record<string, string | number | readonly (string | number)[] | undefined>;
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

/**
 * `ShopClient` (A0) rozšírený o to, čo pribudlo s API v5.
 *
 * Kontrakt `src/contracts.ts` vlastní iný agent, preto rozšírenie žije tu.
 * Je to nadmnožina — všade, kde sa čaká `ShopClient`, sa táto hodnota dosadí
 * bez pretypovania.
 */
export interface ShopClientV5 extends ShopClient {
  /** Introspekcia kľúča: scopes a živý zostatok rozpočtu (v5). */
  whoami(key: SecretRef, ctx: ShopCtx): Promise<WhoamiOutcome>;
  /** VEREJNÉ fuzzy hľadanie cez celý katalóg. Vracia len ID (v5). */
  searchIndex(params: ShopSearchIndexParams, ctx: ShopCtx): Promise<ShopIdPage>;
  /** Presné filtre za scope `product:read`. Vracia len ID (v5). */
  searchProducts(params: ShopSearchParams, key: SecretRef, ctx: ShopCtx): Promise<ShopIdPage>;
  /** Strom kategórií za scope `product:read` (v5). */
  listCategories(key: SecretRef, ctx: ShopCtx): Promise<readonly ShopCategory[]>;
}

export function createShopClient(deps: ShopClientDeps): ShopClientV5 {
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
        if (Array.isArray(value)) {
          // Prázdne pole = filter sa neposiela vôbec. `categories[]=` (prázdna
          // hodnota) by shop mohol prečítať ako „kategória 0" a vrátiť nič.
          for (const item of value as readonly (string | number)[]) {
            url.searchParams.append(key, String(item));
          }
          continue;
        }
        url.searchParams.set(key, String(value as string | number));
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

    // D64: dešifrovanie tesne pred odoslaním — ale MIMO transportného
    // try/catch. Chyba `SecretRef` (typicky `ApiKeyError`: kľúč expiroval
    // alebo bol wipnutý) NIE JE sieťová chyba: nesmie sa klasifikovať ako
    // retryable `network` a točiť backoff — nechá sa preletieť volajúcemu,
    // ktorý ju mapuje na `needs_key` (D21). Request sa v tom prípade
    // NEODOŠLE, takže niet čo upratovať.
    if (spec.key !== undefined) {
      handle = await spec.key();
    }

    try {
      if (handle !== null) {
        // Plaintext existuje ako string len v tejto hlavičke a len po dobu
        // jedného requestu; `finally` ho maže a `release()` prepíše Buffer
        // nulami. NIKDY sa neloguje (I1).
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

    const parsed = parseShopPayload(productListResponseSchema, unwrapShopResult(result.value.body));
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

    const parsed = parseShopPayload(productDetailSchema, unwrapShopResult(result.value.body));
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

  /* ────────── 5.3a čítanie S KĽÚČOM — `getFull` (v5, bod A1/B1) ─────────── */

  /**
   * `GET /api/products/getFull?id=` — všetko, čo `get`, plus back-office polia
   * vrátane SKUTOČNÉHO stavu zľavy (`reduction_percent/_from/_to`, bod B1).
   *
   * PREČO BERIE `SecretRef`, KEĎ JE TO ČÍTANIE
   * ------------------------------------------
   * Endpoint vyžaduje scope `product:read`; bez hlavičky odpovie `forbidden`.
   * Je to teda prvé ČÍTANIE, ktoré nesie kľúč — dovtedy platilo, že kľúč sa
   * posiela len pri `setReduction` a pri sonde (D48, D53).
   *
   * Pravidlo D48/I1 sa tým NEUVOĽŇUJE, len sa ukazuje, čo naozaj chránilo:
   * nie „čítanie nikdy nemá kľúč", ale „čítacia cesta katalógu nemá parameter,
   * ktorým by sa kľúč dal podstrčiť". `listProducts`, `getProduct`,
   * `batchGetProducts` a `canary` žiadny `SecretRef` naďalej neprijímajú —
   * anonymná cesta zostáva anonymná. Tu je kľúč VÝSLOVNÝ parameter, takže
   * volajúci ho musí vedome podať a je na prvý pohľad vidieť, ktoré volanie
   * kľúč minie.
   *
   * Zaobchádzanie s kľúčom je identické so zápisom, lebo ide cez ten istý
   * `sendOnce()`: dešifruje sa tesne pred odoslaním, hlavička sa vo `finally`
   * maže, `release()` prepíše Buffer nulami, `redirect: 'error'` bráni tomu,
   * aby ho presmerovanie odnieslo na cudzí host, a NIKDY sa neloguje (I1, D64).
   * Kľúč ide výhradne do hlavičky — do query sa nedostane, `query` nesie len
   * `id`.
   *
   * PREČO `phase: 'read'`, A NIE `'write'`
   * -------------------------------------
   * Rozhoduje účinok volania, nie prítomnosť kľúča. `GET` je idempotentný,
   * takže platí čítací timeout a bežná retry politika; opakovanie nič nezmení.
   * Pravidlo D45 („po timeoute PRESNE JEDEN identický resend, stav neistý")
   * sa sem nevzťahuje — neistota po zápise je neistota o TOM, ČO SA STALO
   * V SHOPE, a tu sa nestane nič. Z rovnakého dôvodu sa volanie netýka I13
   * (`WRITES_ENABLED`) ani I3 (čerstvé potvrdenie): nič nezapisuje.
   *
   * Rozpočet je iná vec: volanie s kľúčom spadá do rozpočtu NA KĽÚČ, nie do
   * anonymného rozpočtu na IP (`rate-limits.ts`). Overovanie preto nesmie ísť
   * cez celý katalóg (riziko RZ3) a rozpočtovanie patrí volajúcemu.
   *
   * 401/403 sa hlási len do logu a chybou; `deps.onKeyRejected` sa ZÁMERNE
   * NEVOLÁ. Ten callback je viazaný na životný cyklus ZÁPISOVÉHO kľúča
   * (D51/D52 — volajúci ho na jeho základe wipuje). `getFull` beží s iným
   * kľúčom (`product:read`), takže spustiť ho by znamenalo zmazať kľúč, ktorý
   * shop vôbec neodmietol.
   */
  async function getProductFull(
    id: number,
    key: SecretRef,
    ctx: ShopCtx,
  ): Promise<ProductFullDetail> {
    if (!Number.isInteger(id) || id <= 0) {
      throw new ShopRequestError(
        makeShopError({ kind: 'bad_request', code: 'local_invalid_product_id' }),
      );
    }
    const result = await send({
      method: 'GET',
      path: SHOP_PATHS.productGetFull,
      query: { id },
      phase: 'read',
      key,
      ctx,
    });

    if (result.outcome === 'error') {
      if (result.error.kind === 'unauthorized' || result.error.kind === 'forbidden') {
        // Bez `product:read` je endpoint nedostupný. Nie je to chyba údajov ani
        // dôvod čokoľvek wipovať — je to chýbajúce oprávnenie, ktoré musí
        // volajúci ukázať používateľovi ako „nevieme overiť", nie ako „zľava
        // nebeží" (I11).
        log.warn('shop_full_read_key_rejected', {
          ...correlationLogFields(ctx, result.error.requestId),
          productId: id,
          kind: result.error.kind,
          httpStatus: result.error.httpStatus ?? undefined,
        });
      }
      throw new ShopRequestError(result.error);
    }

    const parsed = parseShopPayload(productFullSchema, unwrapShopResult(result.value.body));
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: parsed.issues,
        raw: result.value.body,
      });
      reportDrift(SHOP_PATHS.productGetFull, ctx, error);
      throw new ShopRequestError(error);
    }
    return toProductFull(parsed.value);
  }

  /* ────────── 5.3b hľadanie: `searchIndex`, `search`, `categories` ──────── */

  /** Spoločné rozbalenie odpovede oboch hľadaní — vracajú ten istý tvar. */
  function readIdPage(
    path: string,
    value: SuccessEnvelope,
    ctx: ShopCtx,
  ): ShopIdPage {
    const parsed = parseShopPayload(productIdPageSchema, unwrapShopResult(value.body));
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: value.requestId,
        httpStatus: value.httpStatus,
        issues: parsed.issues,
        raw: value.body,
      });
      reportDrift(path, ctx, error);
      throw new ShopRequestError(error);
    }
    return {
      ids: parsed.value.data,
      page: parsed.value.page,
      perPage: parsed.value.per_page,
      total: parsed.value.total,
    };
  }

  /**
   * `GET /api/products/searchIndex` — fuzzy hľadanie cez celý katalóg. VEREJNÉ.
   *
   * PREČO JE TO NAJDÔLEŽITEJŠIE ČÍTANIE V CELEJ APPKE
   * -------------------------------------------------
   * Zrkadlo katalógu má 2 900 zo 41 082 produktov, lebo anonymný denný strop
   * dovolí prečítať 240 stránok za UTC deň a celý prechod trvá dva dni. Až
   * dovtedy platilo, že produkt, ktorý zrkadlo ešte nemá, sa v appke NEDAL
   * nájsť — a prázdna tabuľka vyzerá rovnako ako „taký produkt neexistuje".
   *
   * Tento endpoint to obchádza bez jediného nového oprávnenia: hľadá vo VŠETKÝCH
   * 41 082 produktoch, v názve, popise, **kóde produktu** aj v kategóriách,
   * znáša preklepy a poradie slov. Kľúč nepotrebuje (rovnako ako `get`), takže
   * `spec.key` tu ZÁMERNE nie je a byť nesmie — anonymná čítacia cesta zostáva
   * anonymná (D48, I1).
   *
   * ČO ZA TO PLATÍME
   * ----------------
   *  1. **Vracia LEN ID.** Názov a cena sa doťahujú `getProduct()` po jednom,
   *     každý za jedno anonymné čítanie. Rozpočet preto MUSÍ strážiť volajúci
   *     (`@/lib/shop/read-budget`, dráha `anon`) — tento modul počítadlo nemá
   *     a mať nesmie, inak by vznikli dve.
   *  2. **Nie je batchable** (`/api/batch` ho neprijme), takže dávka na
   *     zrýchlenie neexistuje. Kto potrebuje menej volaní, musí sa menej pýtať.
   *  3. **Poradie je RELEVANCIA a nedá sa zmeniť.** Vlastné triedenie vie len
   *     `search` za `product:read`. Preusporiadať výsledok na strane appky by
   *     znamenalo zahodiť jedinú vec, kvôli ktorej sa fuzzy hľadanie volá —
   *     pri hľadaní podľa kódu je prvý výsledok ten správny.
   */
  async function searchIndex(params: ShopSearchIndexParams, ctx: ShopCtx): Promise<ShopIdPage> {
    const result = await send({
      method: 'GET',
      path: SHOP_PATHS.productSearchIndex,
      query: searchIndexQuery(params),
      phase: 'read',
      ctx,
    });
    if (result.outcome === 'error') throw new ShopRequestError(result.error);
    return readIdPage(SHOP_PATHS.productSearchIndex, result.value, ctx);
  }

  /**
   * `GET /api/products/search` — presné filtre za scope `product:read`.
   *
   * Appka tento scope zatiaľ NEMÁ, takže volanie dnes skončí na `forbidden`.
   * Metóda napriek tomu existuje celá a hotová: keď kľúč s oprávnením pribudne,
   * zapne sa filter podľa kategórie, výrobcu, dodávateľa a `onlyDiscounted`
   * bez toho, aby sa čokoľvek dopisovalo. Dovtedy je úlohou volajúceho povedať,
   * že to nefunguje a prečo (`missingScopeSentence`) — nie mlčať.
   *
   * Kľúč je VÝSLOVNÝ parameter z rovnakého dôvodu ako pri `getProductFull`:
   * na prvý pohľad má byť vidieť, ktoré volanie kľúč minie. Zaobchádzanie
   * s ním je identické (dešifrovanie tesne pred odoslaním, hlavička sa vo
   * `finally` maže, `redirect: 'error'`, nikdy do logu — I1, D64).
   *
   * `deps.onKeyRejected` sa ZÁMERNE nevolá: ten callback wipuje ZÁPISOVÝ kľúč
   * (D51/D52) a odmietnuté čítanie nie je dôvod zmazať kľúč, ktorý shop pri
   * zápise nikdy neodmietol.
   */
  async function searchProducts(
    params: ShopSearchParams,
    key: SecretRef,
    ctx: ShopCtx,
  ): Promise<ShopIdPage> {
    const query: RequestSpec['query'] = {
      ...searchIndexQuery(params),
      ...(params.categories !== undefined && params.categories.length > 0
        ? { 'categories[]': [...params.categories] }
        : {}),
      ...(params.manufacturers !== undefined && params.manufacturers.length > 0
        ? { 'manufacturers[]': [...params.manufacturers] }
        : {}),
      ...(params.suppliers !== undefined && params.suppliers.length > 0
        ? { 'suppliers[]': [...params.suppliers] }
        : {}),
      // `false` sa NEPOSIELA: „nechcem len zlacnené" a „je mi to jedno" je pre
      // shop tá istá otázka a `onlyDiscounted=0` by PHP mohlo prečítať ako `true`.
      ...(params.onlyDiscounted === true ? { onlyDiscounted: '1' } : {}),
      ...(params.sortBy !== undefined ? { sortBy: params.sortBy } : {}),
      ...(params.sortDir !== undefined ? { sortDir: params.sortDir } : {}),
    };

    const result = await send({
      method: 'GET',
      path: SHOP_PATHS.productSearch,
      query,
      phase: 'read',
      key,
      ctx,
    });
    if (result.outcome === 'error') {
      if (result.error.kind === 'unauthorized' || result.error.kind === 'forbidden') {
        log.warn('shop_search_key_rejected', {
          ...correlationLogFields(ctx, result.error.requestId),
          kind: result.error.kind,
          httpStatus: result.error.httpStatus ?? undefined,
        });
      }
      throw new ShopRequestError(result.error);
    }
    return readIdPage(SHOP_PATHS.productSearch, result.value, ctx);
  }

  /**
   * `GET /api/categories` — plochý zoznam aktívnych kategórií (scope `product:read`).
   *
   * Je to druhá polovica zamknutého filtra podľa kategórie: bez tohto zoznamu
   * by sa `search(categories[])` nedalo ani ponúknuť, lebo appka nemá odkiaľ
   * vziať ID kategórií. Rovnako ako `searchProducts` je hotové a dnes nedostupné.
   */
  async function listCategories(key: SecretRef, ctx: ShopCtx): Promise<readonly ShopCategory[]> {
    const result = await send({
      method: 'GET',
      path: SHOP_PATHS.categories,
      phase: 'read',
      key,
      ctx,
    });
    if (result.outcome === 'error') throw new ShopRequestError(result.error);

    const parsed = parseShopPayload(categoryListSchema, unwrapShopResult(result.value.body));
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: parsed.issues,
        raw: result.value.body,
      });
      reportDrift(SHOP_PATHS.categories, ctx, error);
      throw new ShopRequestError(error);
    }
    return parsed.value.data.map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.id_parent,
      depth: row.level_depth,
    }));
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

    const envelope = parseShopPayload(batchResponseSchema, unwrapShopResult(result.value.body));
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

      const parsed = parseShopPayload(productDetailSchema, unwrapShopResult(slot));
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

    const parsed = parseShopPayload(productListResponseSchema, unwrapShopResult(result.value.body));
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
    const parsed = parseShopPayload(setReductionSuccessSchema, unwrapShopResult(value.body));
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
      /* `ip_banned` je 403, ale NIE JE to výrok o kľúči — shop ho vráti aj na
       * volanie bez kľúča. `onKeyRejected` vedie na wipe kľúča (D51/D52), takže
       * ohlásiť ho tu by znamenalo zmazať kľúč, ktorý je možno v poriadku, a to
       * v stave, v ktorom sa nový overiť ani nedá. Zablokovaná adresa nie je
       * odmietnutý kľúč — hlási sa preto len do logu, iným menom.
       *
       * Callback dnes nikto nezapája, ale mína je nastražená na deň, keď sa
       * D51/D52 dopojí; strážia to `test/unit/shop-errors.spec.ts`. */
      const addressBanned = isIpBanned(error);
      log.error(addressBanned ? 'shop_address_banned' : 'shop_key_rejected', {
        ...correlationLogFields(ctx, error.requestId),
        kind: error.kind,
        httpStatus: error.httpStatus ?? undefined,
      });
      if (!addressBanned) deps.onKeyRejected?.({ kind: error.kind, ctx, error });
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

  /* ────────────── 5.7 overenie kľúča cez `whoami` (v5, bod D1) ──────────── */

  /**
   * `GET /api/whoami` — introspekcia kľúča.
   *
   * Nahradilo sondu na `POST /api/products/setReduction` s `reduction=0`. Tá
   * bola vedomý trik z čias, keď shop introspekciu nemal: nikdy nič nezapísala,
   * ale v štatistike shopu vyzerala ako zápis (tá jedna 22. požiadavka, ktorú
   * maintainer nevedel vysvetliť) a POSTovala na produkčný zápisový endpoint
   * bez ohľadu na `WRITES_ENABLED`. `whoami` je oproti tomu čítanie a shop pri
   * ňom nevyžaduje žiadny konkrétny scope — stačí platný kľúč.
   *
   * Fail-closed vyhodnotenie: 200 s očakávaným tvarom = `ok`; 401 = `invalid`;
   * 403 = `forbidden`; čokoľvek iné (429, 500, timeout, `schema_drift`,
   * nedostupná doména) = `unknown`. Z neistoty sa NIKDY nestane „kľúč platí".
   *
   * Fáza je `read`, takže timeout je `timeout_before` a volanie sa smie
   * bezpečne zopakovať — `whoami` nič nemení.
   */
  async function whoami(key: SecretRef, ctx: ShopCtx): Promise<WhoamiOutcome> {
    let result: Awaited<ReturnType<typeof send>>;
    try {
      result = await send({
        method: 'GET',
        path: SHOP_PATHS.whoami,
        phase: 'read',
        key,
        ctx,
      });
    } catch (error) {
      // Chyba `SecretRef` (expirovaný/wipnutý kľúč) ani zlá doména nesmú zhodiť
      // overenie — sú to dôvody povedať „nevieme", nie spadnúť.
      if (error instanceof ShopConfigError) {
        return { status: 'unknown', error: error.shopError };
      }
      if (error instanceof ShopRequestError) {
        return { status: 'unknown', error: error.shopError };
      }
      throw error;
    }

    if (result.outcome === 'error') {
      const { kind } = result.error;
      log.info('shop_whoami_done', {
        ...correlationLogFields(ctx, result.error.requestId),
        kind,
        httpStatus: result.error.httpStatus ?? undefined,
      });
      if (kind === 'unauthorized') return { status: 'invalid', error: result.error };
      if (kind === 'forbidden') {
        // Dve rôzne odpovede v jednom stavovom kóde. Rozlíšenie robí telo
        // (`ip_banned`), nie status — viď `isIpBanned()` v `errors.ts`.
        return isIpBanned(result.error)
          ? { status: 'address_banned', error: result.error }
          : { status: 'forbidden', error: result.error };
      }
      return { status: 'unknown', error: result.error };
    }

    const parsed = parseShopPayload(whoamiResponseSchema, unwrapShopResult(result.value.body));
    if (!parsed.ok) {
      const error = schemaDriftError({
        requestId: result.value.requestId,
        httpStatus: result.value.httpStatus,
        issues: parsed.issues,
        raw: result.value.body,
      });
      reportDrift(SHOP_PATHS.whoami, ctx, error);
      return { status: 'unknown', error };
    }

    const { scopes, otherScopeCount } = parseShopScopes(parsed.value.scopes);
    const remaining: RemainingFromWhoami = {
      perMinute: normalizeRemaining(parsed.value.remaining?.per_minute),
      perUtcDay: normalizeRemaining(parsed.value.remaining?.per_day),
    };

    // Do logu ide počet scopes a to, či shop povedal zostatok — nikdy `name`
    // ani `owner` (tie sa ani neparsujú) a nikdy nič z kľúča (I1).
    log.info('shop_whoami_done', {
      ...correlationLogFields(ctx, result.value.requestId),
      httpStatus: result.value.httpStatus,
      scopeCount: scopes.length,
      otherScopeCount,
      remainingKnown: remaining.perMinute !== null || remaining.perUtcDay !== null,
    });

    return { status: 'ok', info: { scopes, otherScopeCount, remaining } };
  }

  /**
   * Kontrakt `ShopClient.probeKey` (D53) — odteraz postavený nad `whoami`.
   *
   * Zostáva, lebo volajúcich zaujíma len „platí kľúč?" a nemajú dôvod poznať
   * scopes ani zostatok. Kto ich potrebuje (`/api/key`), volá `whoami` priamo.
   */
  async function probeKey(key: SecretRef, ctx: ShopCtx): Promise<KeyProbeResult> {
    const result = await whoami(key, ctx);
    switch (result.status) {
      case 'ok':
        return 'valid';
      case 'invalid':
        return 'invalid';
      case 'forbidden':
        return 'forbidden';
      case 'address_banned':
        return 'address_banned';
      default:
        return 'unknown';
    }
  }

  return {
    listProducts,
    getProduct,
    getProductFull,
    batchGetProducts,
    setReduction,
    probeKey,
    canary,
    whoami,
    searchIndex,
    searchProducts,
    listCategories,
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
): ShopClientV5 {
  return createShopClient({
    ...deps,
    baseUrl: async () => shopBaseUrlFromSettings(await settings.get()),
  });
}
