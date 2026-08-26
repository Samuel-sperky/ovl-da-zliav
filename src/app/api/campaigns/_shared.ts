/**
 * Aura Zľavy — SPOLOČNÉ ZÁZEMIE ROUTE-OV A12 (kampane, allowlist, katalóg,
 * audit, notifikácie). NIE JE to route — Next.js registruje len `route.ts`.
 *
 * Čo tu žije:
 *  1. `RoutesDeps` / `resolveRoutesDeps()` — injektovateľné závislosti route-ov
 *     (repozitáre, shop klient, preview tokeny, executor). Default = produkčné
 *     singletony; testy si prinesú in-memory svet a mock shop.
 *  2. Zod schémy zdieľané viacerými route-mi (dátum, ID, stránkovanie).
 *  3. Mapovanie chýb, ktoré `toAppError()` v A5 nepozná menovite
 *     (`PreviewTokenError`, `EngineError`, `DomainError` s kódmi mimo tabuľky)
 *     na správne 4xx — NIKDY nie 500 a NIKDY nie „prejde" (I3, fail-closed).
 *  4. Serializácia kampane s DERIVOVANÝMI UI stavmi „aktívna"/„expirovaná"
 *     (O1, D14) — derivát sa nikdy neukladá do DB.
 *  5. `insertConfirmedCampaign()` — jediná cesta, ktorou route-y vkladajú
 *     zľavu: vždy s `confirmed_at` + `confirm_payload_hash` z OVERENÉHO preview
 *     tokenu (I3), s pásmami (K3) a s položkami v deterministickom poradí (I10).
 *  6. Most na stav `queued` a príznak `late` (K2, K5) — `src/contracts.ts` ich
 *     zatiaľ nevie pomenovať, tak pre ne existuje presne jedno miesto.
 *  7. Odhad dobehnutia fronty z denného rozpočtu (K5) — rozpočet sa číta RAZ
 *     na požiadavku, nie raz na riadok zoznamu.
 *
 * Route handlery NEOBSAHUJÚ zápisovú logiku — skúšku naprázdno stavia
 * `engine/preview`, zápis výhradne `engine/executor` (BUILD-SPEC §5, K11 bod 2).
 *
 * Vlastník: A12, prestavba na frontu V8.
 */
import { decodeJwt } from 'jose';
import { z } from 'zod';

import type {
  AllowlistRepo,
  ApiKeyRepo,
  AuditRepo,
  AuditWriter,
  CampaignItemRecord,
  CampaignKind,
  CampaignMode,
  CampaignRecord,
  CampaignStatus,
  CampaignsRepo,
  CatalogRepo,
  DateOnly,
  DiscountPercent,
  ItemStatus,
  MoneyString,
  PreviewTokenClaims,
  PreviewTokenService,
  Queryable,
  SettingsRepo,
  ShopClient,
  Ulid,
  WriteMutex,
} from '@/contracts';

import { env } from '@/env';
import { auditWriter as defaultAuditWriter } from '@/lib/audit/write';
import { anonReadCost } from '@/lib/catalog/product-details';
import { previewTokenService as defaultPreviewTokens, PreviewTokenError } from '@/lib/crypto/preview-token';
import { isDateOnly, todayInZone } from '@/lib/domain/dates';
import { DomainError } from '@/lib/domain/errors';
import { CAMPAIGN_STATUSES, deriveCampaignView, isCampaignStatus } from '@/lib/domain/status';
import {
  createBudget,
  estimateFinish,
  type BudgetSource,
  type BudgetStatus,
  type FinishEstimate,
} from '@/lib/engine/budget';
import { createExecutor, EngineError, executorFlagsFromEnv, type ExecutorFlags } from '@/lib/engine/executor';
import { writeMutex as defaultWriteMutex } from '@/lib/engine/mutex';
import { AppError, badRequest, conflict, notFound } from '@/lib/http/errors';
import { redact } from '@/lib/log/redact';
import { allowlistRepo as defaultAllowlistRepo } from '@/lib/repo/allowlist.repo';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { auditRepo as defaultAuditRepo } from '@/lib/repo/audit.repo';
import {
  campaignItemsRepo as defaultCampaignItemsRepo,
  type NewCampaignItem,
} from '@/lib/repo/campaign-items.repo';
import {
  campaignsRepo as defaultCampaignsRepo,
  type CampaignsRepoExt,
} from '@/lib/repo/campaigns.repo';
import {
  catalogRepo as defaultCatalogRepo,
  type CatalogRepoExt,
} from '@/lib/repo/catalog.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import {
  tiersRepo as defaultTiersRepo,
  type CampaignTierRecord,
  type NewCampaignTier,
  type TiersRepoContract,
} from '@/lib/repo/tiers.repo';
import { createShopClientFromSettings } from '@/lib/shop/client';
import { newOperationId } from '@/lib/shop/correlation';
import type { ReadBudgetStatus } from '@/lib/shop/read-budget';

/* ═════════════ 0. Most na stav `queued` a príznak `late` (K2, K5) ═════════ */

/**
 * `CampaignStatus` v `src/contracts.ts` (vlastník A0) `queued` nepozná a V8
 * kontrakty needituje. Presne ako `campaigns.repo.ts` (V4) preto existuje JEDEN
 * most namiesto castov roztrúsených po route-och:
 *
 *  - `QUEUED` je hodnota, ktorú DB enum má (migrácia `0010_fronta_a_pasma.sql`)
 *    a repozitár ju prijíma aj vracia; typ pre ňu zatiaľ nemá meno.
 *  - `lateOf()` číta príznak `late` obranne — starý fake bez neho vráti `false`,
 *    nie `undefined`, takže UI nikdy nedostane „neviem".
 *
 * Požiadavka na doplnenie `'queued'` a `late` do kontraktu je vo výstupe V8.
 */
export const QUEUED = 'queued' as CampaignStatus;

/** Príznak meškania fronty (K5) z hociktorého tvaru záznamu kampane. */
export const lateOf = (record: CampaignRecord): boolean =>
  (record as { late?: unknown }).late === true;

/** `true` = kampaň čaká vo fronte na denný rozpočet (K2). */
export const isQueuedStatus = (status: string): boolean => status === 'queued';

/* ═══════════════════════ 1. Závislosti route-ov ═══════════════════════════ */

/**
 * Repozitár položiek, ako ho vidia route-y.
 *
 * ZÁMERNE to NIE JE `Pick<CampaignItemsRepo, …>`: `createMany()` musí prijať
 * `percent` (K3 — percento sa rozhoduje pri POTVRDENÍ), ale `listByCampaign()`
 * smie vrátiť aj záznam bez neho, aby staršie fakes v testoch zostali platné.
 */
export interface RoutesItemsRepo {
  createMany(campaignId: number, items: NewCampaignItem[], conn?: Queryable): Promise<void>;
  listByCampaign(campaignId: number, conn?: Queryable): Promise<CampaignItemRecord[]>;
  update(
    id: number,
    patch: Partial<Omit<CampaignItemRecord, 'id' | 'campaignId' | 'productId'>>,
    conn?: Queryable,
  ): Promise<void>;
  markRemaining(
    campaignId: number,
    fromPosition: number,
    status: ItemStatus,
    reason: string,
    conn?: Queryable,
  ): Promise<void>;
}

/** Podmnožiny kontraktov, ktoré A12 skutočne používa — testy dodajú len tieto. */
export interface RoutesDeps {
  campaignsRepo?: Pick<
    CampaignsRepo,
    | 'create'
    | 'getById'
    | 'list'
    | 'claim'
    | 'setStatus'
    | 'findUnacked'
    | 'ack'
    | 'findPlannedForProduct'
    | 'findFutureOverlaps'
    | 'lastOwnWrite'
  > &
    // `requeueMissed` (K2) a dávkový `lastOwnWrites` (I11) žijú až v rozšírenom
    // repozitári, nie v kontrakte A0. VOLITEĽNÉ zámerne: staršie fakes v testoch
    // ich nemajú a nemá zmysel nútiť ich dopisovať metódu, ktorú netestujú.
    // Keď chýba `requeueMissed`, `resolveRoutesDeps()` doplní fail-closed
    // náhradu, ktorá nevráti do fronty nič; keď chýba `lastOwnWrites`, volajúci
    // sa vráti k dotazu na produkt (a v produkcii sa to nikdy nestane).
    Partial<Pick<CampaignsRepoExt, 'requeueMissed' | 'lastOwnWrites'>>;
  campaignItemsRepo?: RoutesItemsRepo;
  allowlistRepo?: Pick<
    AllowlistRepo,
    'listActive' | 'addProduct' | 'removeProduct' | 'markShopStatus' | 'areAllActive'
  >;
  catalogRepo?: Pick<CatalogRepo, 'get' | 'getMany' | 'upsert'>;
  /**
   * K7 — zdieľaný denný rozpočet ANONYMNÝCH čítaní shopu.
   *
   * Zámerne samostatná závislosť, nie širší `catalogRepo`: trojica
   * `get`/`getMany`/`upsert` je kontrakt, o ktorý sa opierajú existujúce testy,
   * a rozšíriť ju by znamenalo prepísať cudzie fakes (tá istá úvaha ako
   * `catalogLookup` v `catalog/search`). Produkčne je to ten istý repozitár.
   */
  readBudget?: Pick<CatalogRepoExt, 'reserveShopReads' | 'shopReadBudget'>;
  auditRepo?: Pick<AuditRepo, 'list' | 'getById' | 'countWritesInLastHour'>;
  settingsRepo?: Pick<SettingsRepo, 'get' | 'lockWrites'>;
  apiKeyRepo?: Pick<ApiKeyRepo, 'getMeta' | 'loadForUse' | 'wipe' | 'touchLastUsed'>;
  /** K3 — pásma zľavy. Zapisujú sa pri potvrdení spolu s položkami. */
  tiersRepo?: Pick<TiersRepoContract, 'createMany' | 'listByCampaign'>;
  /** K2 — denný rozpočet z auditu; slúži len na ODHAD, nikdy nepovoľuje zápis. */
  budget?: BudgetSource;
  audit?: AuditWriter;
  previewTokens?: PreviewTokenService;
  shopClient?: Pick<ShopClient, 'batchGetProducts' | 'getProduct' | 'setReduction'>;
  mutex?: WriteMutex;
  /** Env poistky executora (I13, D79) — testy nastavia produkčný režim explicitne. */
  executorFlags?: ExecutorFlags | (() => ExecutorFlags);
  now?: () => Date;
  timeZone?: string;
  /** `HH:mm` lokálneho času pre `fire_at` (D32). Default `SCHEDULER_FIRE_TIME`. */
  fireTime?: string;
}

export type ResolvedRoutesDeps = Required<
  Omit<RoutesDeps, 'executorFlags' | 'fireTime' | 'timeZone' | 'campaignsRepo'>
> & {
  campaignsRepo: ResolvedCampaignsRepo;
  executorFlags: ExecutorFlags | (() => ExecutorFlags);
  timeZone: string;
  fireTime: string;
};

/** Repozitár kampaní, ako ho route-y prijímajú (s voliteľným `requeueMissed`). */
type RoutesCampaignsRepo = NonNullable<RoutesDeps['campaignsRepo']>;

/** Repozitár po doplnení — `requeueMissed` je tu už vždy. */
export type ResolvedCampaignsRepo = RoutesCampaignsRepo &
  Pick<CampaignsRepoExt, 'requeueMissed'>;

/** Doplní `requeueMissed` fake repozitárom, ktoré ho nemajú (K2, fail-closed). */
function withRequeue(repo: RoutesCampaignsRepo): ResolvedCampaignsRepo {
  return repo.requeueMissed === undefined
    ? { ...repo, requeueMissed: async () => false }
    : (repo as ResolvedCampaignsRepo);
}

export function resolveRoutesDeps(overrides: RoutesDeps = {}): ResolvedRoutesDeps {
  const settingsRepo = overrides.settingsRepo ?? defaultSettingsRepo;
  return {
    // K2: fake bez `requeueMissed` dostane náhradu, ktorá nevráti do fronty
    // NIČ. Fail-closed — chýbajúca schopnosť nesmie znamenať tichý zápis.
    campaignsRepo: withRequeue(overrides.campaignsRepo ?? defaultCampaignsRepo),
    campaignItemsRepo: overrides.campaignItemsRepo ?? defaultCampaignItemsRepo,
    allowlistRepo: overrides.allowlistRepo ?? defaultAllowlistRepo,
    catalogRepo: overrides.catalogRepo ?? defaultCatalogRepo,
    // K7: rovnaké počítadlo, z ktorého berie synchronizácia katalógu aj
    // `catalog/search`. Druhý zdroj by znamenal dva stropy proti jednému shopu.
    readBudget: overrides.readBudget ?? defaultCatalogRepo,
    auditRepo: overrides.auditRepo ?? defaultAuditRepo,
    settingsRepo,
    apiKeyRepo: overrides.apiKeyRepo ?? defaultApiKeyRepo,
    tiersRepo: overrides.tiersRepo ?? defaultTiersRepo,
    // Rozpočet číta `settings.daily_write_budget` (fail-closed vo V4) a
    // spotrebu VÝHRADNE z auditu (K2) — žiadne paralelné počítadlo.
    budget: overrides.budget ?? createBudget({ settingsRepo, now: overrides.now }),
    audit: overrides.audit ?? defaultAuditWriter,
    previewTokens: overrides.previewTokens ?? defaultPreviewTokens,
    shopClient:
      overrides.shopClient ??
      // Base URL sa číta z `settings` pri každom volaní (R5, D80).
      createShopClientFromSettings({ get: () => settingsRepo.get() }),
    mutex: overrides.mutex ?? defaultWriteMutex,
    executorFlags: overrides.executorFlags ?? executorFlagsFromEnv,
    now: overrides.now ?? (() => new Date()),
    // LAZY (A19): route moduly volajú `resolveRoutesDeps()` na module scope
    // (`export const GET = createXGet()`), takže eager čítanie `env.*` by
    // spustilo zod validáciu už počas `next build` (collect page data) a build
    // by padol na produkčne povinných `DB_*_PASSWORD_FILE`. Gettery držia
    // vyhodnotenie ENV až na moment requestu — presne ako to zamýšľa lazy Proxy
    // v `src/env.ts` aj komentár v `Dockerfile` („build nesmie vyžadovať ENV").
    get timeZone(): string {
      return overrides.timeZone ?? env.LOGIC_TIMEZONE;
    },
    get fireTime(): string {
      return overrides.fireTime ?? env.SCHEDULER_FIRE_TIME;
    },
  };
}

/** Executor nad tými istými závislosťami — JEDINÁ zápisová cesta route-ov. */
export function makeExecutor(d: ResolvedRoutesDeps): ReturnType<typeof createExecutor> {
  return createExecutor({
    shopClient: d.shopClient,
    campaignsRepo: d.campaignsRepo,
    campaignItemsRepo: d.campaignItemsRepo,
    allowlistRepo: d.allowlistRepo,
    settingsRepo: d.settingsRepo,
    auditRepo: d.auditRepo,
    apiKeyRepo: d.apiKeyRepo,
    audit: d.audit,
    mutex: d.mutex,
    // K2 — rozpočet MUSÍ ísť ďalej. Bez neho si executor vyrobil vlastný nad
    // produkčným auditom a ten, ktorý mu route podala, ticho ignoroval: route
    // a executor by potom počítali spotrebu z dvoch rôznych zdrojov.
    budget: d.budget,
    flags: d.executorFlags,
    now: d.now,
    timeZone: d.timeZone,
  });
}

export const todayOf = (d: ResolvedRoutesDeps): DateOnly => todayInZone(d.now(), d.timeZone);

/* ═══════════════════════════ 2. Zod schémy ════════════════════════════════ */

export const dateOnlySchema = z
  .string()
  .refine((v) => isDateOnly(v), 'Očakáva sa existujúci kalendárny deň v tvare RRRR-MM-DD.');

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const productIdParamSchema = z.object({
  productId: z.coerce.number().int().positive(),
});

export const pageQuery = z.coerce.number().int().min(1).default(1);
export const perPageQuery = z.coerce.number().int().min(1).max(100).default(20);

/**
 * Stavy zľavy pre filter v zozname. `queued` (K2) je v DB enume od migrácie
 * `0010`, ale `CAMPAIGN_STATUSES` (A7) ho zatiaľ nemá — bez neho by sa zľavy
 * čakajúce vo fronte nedali vyfiltrovať a tab Zľavy by o nich nevedel.
 */
export const campaignStatusSchema = z.enum([...CAMPAIGN_STATUSES, 'queued']);

/* ═══════════════ 3. Mapovanie chýb engine/token/domény na 4xx ═════════════ */

const PREVIEW_TOKEN_HTTP: Record<PreviewTokenError['code'], { status: number; code: string }> = {
  bad_input: { status: 400, code: 'preview_token_invalid' },
  invalid_token: { status: 400, code: 'preview_token_invalid' },
  expired: { status: 400, code: 'preview_token_expired' },
  payload_mismatch: { status: 400, code: 'preview_token_invalid' },
  replayed: { status: 409, code: 'preview_token_used' },
};

const ENGINE_HTTP: Record<string, { status: number; code: string }> = {
  campaign_not_found: { status: 404, code: 'not_found' },
  campaign_not_claimable: { status: 409, code: 'invalid_transition' },
  confirmation_missing: { status: 409, code: 'confirmation_required' },
  confirmation_mismatch: { status: 409, code: 'confirmation_required' },
  write_in_progress: { status: 409, code: 'write_in_progress' },
};

/**
 * Chyby, ktoré `toAppError()` (A5) nepozná menovite, prekladá A12 sám — inak
 * by z nich bolo 500 `internal_error` a UI by stratilo príčinu. VŽDY 4xx,
 * nikdy „prejde" (I3, fail-closed).
 */
export function toRouteError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof PreviewTokenError) {
    const m = PREVIEW_TOKEN_HTTP[error.code];
    return new AppError(m.status, m.code, error.message, { cause: error, logAsError: false });
  }
  if (error instanceof EngineError) {
    const m = ENGINE_HTTP[error.code] ?? { status: 409, code: error.code };
    return new AppError(m.status, m.code, error.message, {
      cause: error,
      logAsError: false,
      ...(error.detail !== undefined ? { detail: error.detail } : {}),
    });
  }
  if (error instanceof DomainError) {
    // `invalid_transition` a spol. pozná aj A5; zvyšné doménové kódy sú 400.
    const conflictCodes: readonly string[] = [
      'invalid_transition',
      'confirmation_required',
      'fresh_confirmation_required',
      'future_overlap',
      'overwrite_required',
      'midnight_freeze',
    ];
    const status = conflictCodes.includes(error.code) ? 409 : 400;
    return new AppError(status, error.code, error.message, {
      cause: error,
      logAsError: false,
      ...(error.detail !== undefined ? { detail: { ...error.detail } } : {}),
    });
  }
  throw error;
}

/** Obal handlera: preloží chyby A12 a zvyšok nechá pipeline A5. */
export async function withRouteErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toRouteError(error);
  }
}

/* ═════════════════════ 4. Preview token v route (I3) ══════════════════════ */

export interface ExpectedTokenParams {
  kind: CampaignKind;
  productIds: number[];
  percent: DiscountPercent;
  from: DateOnly;
  to: DateOnly;
}

/**
 * Bezpečné NEoverené nahliadnutie do tokenu — používa sa len na zostavenie
 * `expected` sady a na predbežné kontroly (napr. D30 „naozaj 1 deň?").
 * Pravda je až výsledok `previewTokens.verify()` (podpis + hash + replay).
 */
export function peekPreviewToken(token: string): Partial<PreviewTokenClaims> | null {
  try {
    return decodeJwt(token) as Partial<PreviewTokenClaims>;
  } catch {
    return null;
  }
}

/**
 * Overí token proti POŽADOVANEJ operácii (I3): podpis, TTL 15 min, zhodu
 * `payloadHash`, jednorazovosť (replay) a vlastníka (`sub` = prihlásený user).
 * Každé zlyhanie je 4xx — na shop nesmie odísť ani jeden request.
 */
export async function verifyPreviewTokenFor(
  d: ResolvedRoutesDeps,
  token: string,
  expected: ExpectedTokenParams,
  userId: number,
): Promise<PreviewTokenClaims> {
  let claims: PreviewTokenClaims;
  try {
    claims = await d.previewTokens.verify(token, expected);
  } catch (error) {
    throw toRouteError(error);
  }
  if (claims.sub !== userId) {
    throw badRequest(
      'Preview token patrí inému prihláseniu — spusti dry-run znova (I3).',
      'preview_token_invalid',
    );
  }
  return claims;
}

/* ═══════════ 5. Serializácia kampane + derivované stavy (O1, D14) ═════════ */

export interface CampaignView {
  id: number;
  operationId: Ulid;
  name: string;
  kind: CampaignKind;
  parentCampaignId: number | null;
  percent: DiscountPercent;
  dateFrom: DateOnly;
  dateTo: DateOnly;
  dateFromOriginal: DateOnly | null;
  mode: CampaignMode;
  status: CampaignStatus;
  statusReason: string | null;
  fireAt: string | null;
  scheduledAt: string | null;
  needsKeySince: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain: number;
  resultAckAt: string | null;
  createdAt: string;
  /**
   * K5 — fronta nedobehla do `date_from`. Je to FAKT O ČASE, nie chyba: okno
   * sa nemení (I7) a zvyšné produkty sa aj tak zapíšu.
   */
  late: boolean;
  /** K2 — koľko položiek ešte čaká na zápis (`items_total − ok − failed − uncertain`). */
  itemsPending: number;
  /** Derivovaný UI stav — NIKDY nie je v DB a NIKDY netvrdí, čo má shop (I11). */
  derived: 'aktivna' | 'expirovana' | null;
}

const iso = (v: Date | null): string | null => (v === null ? null : v.toISOString());

export function campaignView(record: CampaignRecord, today: DateOnly): CampaignView {
  return {
    id: record.id,
    operationId: record.operationId,
    name: record.name,
    kind: record.kind,
    parentCampaignId: record.parentCampaignId,
    percent: record.percent,
    dateFrom: record.dateFrom,
    dateTo: record.dateTo,
    dateFromOriginal: record.dateFromOriginal,
    mode: record.mode,
    status: record.status,
    statusReason: record.statusReason,
    fireAt: iso(record.fireAt),
    scheduledAt: iso(record.scheduledAt),
    needsKeySince: iso(record.needsKeySince),
    startedAt: iso(record.startedAt),
    finishedAt: iso(record.finishedAt),
    itemsTotal: record.itemsTotal,
    itemsOk: record.itemsOk,
    itemsFailed: record.itemsFailed,
    itemsUncertain: record.itemsUncertain,
    resultAckAt: iso(record.resultAckAt),
    createdAt: record.createdAt.toISOString(),
    late: lateOf(record),
    itemsPending: Math.max(
      0,
      record.itemsTotal - record.itemsOk - record.itemsFailed - record.itemsUncertain,
    ),
    // `queued` (K2) `deriveCampaignView()` v A7 nepozná — a nemá čo derivovať:
    // kampaň vo fronte nie je ani „aktívna", ani „expirovaná". Bez tejto stráže
    // by neznámy stav skončil ako `invalid_transition` v cudzom module.
    derived: isCampaignStatus(record.status)
      ? deriveCampaignView(record.status, record.dateTo, today)
      : null,
  };
}

/* ═════════════════ 5b. Pásma a odhad dobehnutia (K3, K5) ══════════════════ */

/** Pásmo, ako ho vidí UI. `rule` je LEN na zobrazenie, nikdy na zápis (K3). */
export interface CampaignTierView {
  ord: number;
  label: string;
  percent: DiscountPercent;
  itemsCount: number;
  rule: unknown;
}

export const tierView = (record: CampaignTierRecord): CampaignTierView => ({
  ord: record.ord,
  label: record.label,
  percent: record.percent,
  itemsCount: record.itemsCount,
  rule: record.rule,
});

/**
 * K2 — stav denného rozpočtu. `null` = nepodarilo sa prečítať; volajúci potom
 * NESMIE odhad vyrobiť (P7: odhad, ktorý si appka vymyslí, je horší než žiadny).
 * Chyba sa neposiela ďalej — rozpočet je informácia do UI, nie brzda zápisu
 * (tou je `guards.checkDailyBudget()` v engine).
 */
export async function readBudgetStatus(d: ResolvedRoutesDeps): Promise<BudgetStatus | null> {
  try {
    return await d.budget.remainingToday();
  } catch {
    return null;
  }
}

/**
 * K5/K6 — kedy fronta dobehne. Rozpočet sa číta RAZ na požiadavku a odovzdáva
 * sem, aby zoznam 20 zliav nespravil 20 dotazov na to isté číslo.
 */
export function estimateWith(
  budget: BudgetStatus | null,
  pending: number,
  now: Date,
): FinishEstimate | null {
  if (pending <= 0 || budget === null) return null;
  return estimateFinish(pending, budget.budget, { remainingToday: budget.remaining, now });
}

/* ═════════ 5b. Rozpočet ČÍTANÍ shopu (K7) — spoločná brána route-ov ═══════ */

/** Výsledok pokusu zaplatiť čítanie celej sady zo zdieľaného rozpočtu (K7). */
export interface ShopReadClearance {
  /** `true` = celá sada je zaplatená a shop sa SMIE volať. */
  granted: boolean;
  /** Koľko anonymných čítaní by celá sada stála (`anonReadCost`). */
  cost: number;
  /** Stav počítadla po pokuse. `known: false` = počítadlo sa nedá prečítať. */
  status: ReadBudgetStatus;
}

/**
 * K7 — rezervácia zdieľaného denného rozpočtu anonymných čítaní PRED volaním
 * shopu. Doteraz z tejto kvóty brali `engine/preview`, synchronizácia katalógu
 * aj `catalog/search`, kým route-y `extend/preview` a `catalog/refresh` čítali
 * mimo počítadla — a práve tým sa denný strop prekročil bez toho, aby o tom
 * appka vedela.
 *
 * REZERVUJE SA VŠETKO NARAZ ALEBO NIČ, presne ako v `engine/preview`:
 * `batchGetProducts()` číta celú sadu a čiastočná rezervácia by znamenala obraz
 * postavený nad jej časťou. Stav sa najprv PREČÍTA (`reserveShopReads(0)` nič
 * nemíňa) a rezervuje sa až vtedy, keď je na celú cenu miesto — inak by
 * odmietnuté čítanie ešte aj minulo zvyšok kvóty.
 *
 * Nečitateľné počítadlo je fail-closed: `known: false` znamená „nevieme", a to
 * nie je povolenie volať shop.
 */
export async function reserveShopReadsForSet(
  d: ResolvedRoutesDeps,
  productCount: number,
): Promise<ShopReadClearance> {
  const cost = anonReadCost(productCount);
  const peek = await d.readBudget.reserveShopReads(0);
  if (cost === 0) return { granted: false, cost, status: peek.status };
  if (!peek.status.known || peek.status.remaining < cost) {
    return { granted: false, cost, status: peek.status };
  }
  const reservation = await d.readBudget.reserveShopReads(cost);
  // Súbeh s iným čítačom medzi náhľadom a rezerváciou. Pridelené čítania sa
  // NEVRACAJÚ — chyba smerom k opatrnosti, rovnako ako v `product-details`.
  return { granted: reservation.granted >= cost, cost, status: reservation.status };
}

/** Jednorazový odhad (POST) — jedno čítanie rozpočtu, jeden výsledok. */
export async function estimateFinishFor(
  d: ResolvedRoutesDeps,
  pending: number,
): Promise<FinishEstimate | null> {
  return estimateWith(await readBudgetStatus(d), pending, d.now());
}

/* ═══════════ 6. Vloženie potvrdenej kampane (I3, I10, D39c) ═══════════════ */

export interface InsertCampaignArgs {
  claims: PreviewTokenClaims;
  /** K3 — percento POLOŽKY z overeného tokenu. Chýbajúci kľúč = hlavičkové %. */
  percents?: Readonly<Record<string, DiscountPercent>> | undefined;
  /** K3 — pásma na zobrazenie a zopakovanie filtra (`campaign_tiers`). */
  tiers?: NewCampaignTier[];
  name: string;
  kind: CampaignKind;
  mode: CampaignMode;
  /** `queued` je stav fronty (K2) — kontrakty ho zatiaľ nevedia pomenovať. */
  status: CampaignStatus;
  fireAt: Date | null;
  parentCampaignId?: number | null;
  createdBy: number;
}

/**
 * Vloží kampaň + pásma + položky z OVERENÝCH claims preview tokenu.
 * `confirmed_at`, `confirm_payload_hash` a `sudo_at` sa zapisujú hneď pri
 * vzniku — executor si ich pri štarte dávky znova prepočíta a overí (I3).
 *
 * Položky dostanú `position` podľa vzostupného `product_id` (I10),
 * `price_at_preview` z tokenu (D39c) a **`percent` svojho pásma** (K3).
 * Percento sa berie VÝHRADNE z overeného tokenu — nie z tela požiadavky a nie
 * z pásiem, ktoré klient poslal vedľa neho. Keby sa bralo odinakiaľ, dal by sa
 * potvrdiť jeden náhľad a zapísať iné číslo, a I3 by prestalo niečo znamenať.
 */
export async function insertConfirmedCampaign(
  d: ResolvedRoutesDeps,
  args: InsertCampaignArgs,
): Promise<CampaignRecord> {
  const now = d.now();
  const operationId = newOperationId();
  const sortedIds = [...args.claims.productIds].sort((a, b) => a - b);
  const percents = args.percents ?? {};

  const record = await d.campaignsRepo.create({
    operationId,
    name: args.name,
    kind: args.kind,
    parentCampaignId: args.parentCampaignId ?? null,
    percent: args.claims.percent,
    dateFrom: args.claims.from,
    dateTo: args.claims.to,
    mode: args.mode,
    status: args.status,
    fireAt: args.fireAt,
    scheduledAt: now,
    confirmedAt: now,
    confirmPayloadHash: args.claims.payloadHash,
    sudoAt: now,
    createdBy: args.createdBy,
  });

  if (args.tiers !== undefined && args.tiers.length > 0) {
    await d.tiersRepo.createMany(record.id, args.tiers);
  }

  await d.campaignItemsRepo.createMany(
    record.id,
    sortedIds.map((productId, index) => ({
      productId,
      position: index + 1,
      percent: percents[String(productId)] ?? args.claims.percent,
      priceAtPreview: (args.claims.pricesAtPreview[String(productId)] ?? null) as
        | MoneyString
        | null,
      hasAttributes: false,
    })),
  );

  await d.audit.appendAudit({
    actor: 'user',
    eventType: 'campaign_created',
    ok: true,
    userId: args.createdBy,
    campaignId: record.id,
    operationId,
    message: `Kampaň „${args.name}" (${args.kind}, ${args.mode}) vytvorená s potvrdeným dry-runom: ${sortedIds.length} produktov, ${args.claims.percent} %, ${args.claims.from} → ${args.claims.to}${args.tiers !== undefined && args.tiers.length > 1 ? `, ${args.tiers.length} pásiem` : ''}.`,
  });

  return record;
}

/* ═══════════════ 7. Odpoveď dry-runu s preview tokenom (O2) ═══════════════ */

/**
 * Centrálny redaktor (A2) maskuje KAŽDÉ pole končiace na „token" — vrátane
 * `previewToken`, ktorý ale §5 v odpovedi `/preview` VYŽADUJE (bez neho
 * neexistuje cesta k potvrdeniu, I3). Preto preview route vracia vlastnú
 * `Response`: celý zvyšok tela prejde `redact()` ako inde (I1) a až potom sa
 * doň vloží samotný token. Token je podpísaný JWT bez tajomstiev — je to
 * ten nosič, ktorý sa klientovi poslať MUSÍ.
 */
export function previewResultResponse<T extends { previewToken: string }>(result: T): Response {
  const redacted = redact({ ...result, previewToken: '' });
  const body = { ok: true, data: { ...redacted, previewToken: result.previewToken } };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}


/** 404 pre neexistujúcu kampaň — jednotná hláška. */
export async function loadCampaignOr404(
  d: ResolvedRoutesDeps,
  id: number,
): Promise<CampaignRecord> {
  const record = await d.campaignsRepo.getById(id);
  if (record === null) throw notFound(`Kampaň ${id} neexistuje.`);
  return record;
}

/** 409, keď kampaň nie je v niektorom z povolených stavov. */
export function assertStatusIn(
  record: CampaignRecord,
  allowed: readonly CampaignStatus[],
  action: string,
): void {
  if (!allowed.includes(record.status)) {
    throw conflict(
      `Akcia „${action}" nie je zo stavu „${record.status}" možná (povolené: ${allowed.join(', ')}).`,
      'invalid_transition',
      { detail: { status: record.status, allowed: [...allowed] }, logAsError: false },
    );
  }
}
