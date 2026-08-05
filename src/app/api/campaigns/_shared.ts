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
 *  5. `insertConfirmedCampaign()` — jediná cesta, ktorou A12 vkladá kampaň:
 *     vždy s `confirmed_at` + `confirm_payload_hash` z OVERENÉHO preview
 *     tokenu (I3) a s položkami v deterministickom poradí (I10).
 *
 * Route handlery NEOBSAHUJÚ zápisovú logiku — dry-run stavia `engine/preview`,
 * zápis výhradne `engine/executor` (BUILD-SPEC §5, poznámky).
 *
 * Vlastník: A12.
 */
import { decodeJwt } from 'jose';
import { z } from 'zod';

import type {
  AllowlistRepo,
  ApiKeyRepo,
  AuditRepo,
  AuditWriter,
  CampaignItemsRepo,
  CampaignKind,
  CampaignMode,
  CampaignRecord,
  CampaignStatus,
  CampaignsRepo,
  CatalogRepo,
  DateOnly,
  DiscountPercent,
  MoneyString,
  PreviewTokenClaims,
  PreviewTokenService,
  SettingsRepo,
  ShopClient,
  Ulid,
  WriteMutex,
} from '@/contracts';

import { env } from '@/env';
import { auditWriter as defaultAuditWriter } from '@/lib/audit/write';
import { previewTokenService as defaultPreviewTokens, PreviewTokenError } from '@/lib/crypto/preview-token';
import { isDateOnly, todayInZone } from '@/lib/domain/dates';
import { DomainError } from '@/lib/domain/errors';
import { CAMPAIGN_STATUSES, deriveCampaignView } from '@/lib/domain/status';
import { createExecutor, EngineError, executorFlagsFromEnv, type ExecutorFlags } from '@/lib/engine/executor';
import { writeMutex as defaultWriteMutex } from '@/lib/engine/mutex';
import { AppError, badRequest, conflict, notFound } from '@/lib/http/errors';
import { redact } from '@/lib/log/redact';
import { allowlistRepo as defaultAllowlistRepo } from '@/lib/repo/allowlist.repo';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { auditRepo as defaultAuditRepo } from '@/lib/repo/audit.repo';
import { campaignItemsRepo as defaultCampaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings } from '@/lib/shop/client';
import { newOperationId } from '@/lib/shop/correlation';

/* ═══════════════════════ 1. Závislosti route-ov ═══════════════════════════ */

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
  >;
  campaignItemsRepo?: Pick<
    CampaignItemsRepo,
    'createMany' | 'listByCampaign' | 'update' | 'markRemaining'
  >;
  allowlistRepo?: Pick<
    AllowlistRepo,
    'listActive' | 'addProduct' | 'removeProduct' | 'markShopStatus' | 'areAllActive'
  >;
  catalogRepo?: Pick<CatalogRepo, 'get' | 'getMany' | 'upsert'>;
  auditRepo?: Pick<AuditRepo, 'list' | 'getById' | 'countWritesInLastHour'>;
  settingsRepo?: Pick<SettingsRepo, 'get' | 'lockWrites'>;
  apiKeyRepo?: Pick<ApiKeyRepo, 'getMeta' | 'loadForUse' | 'wipe' | 'touchLastUsed'>;
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
  Omit<RoutesDeps, 'executorFlags' | 'fireTime' | 'timeZone'>
> & {
  executorFlags: ExecutorFlags | (() => ExecutorFlags);
  timeZone: string;
  fireTime: string;
};

export function resolveRoutesDeps(overrides: RoutesDeps = {}): ResolvedRoutesDeps {
  const settingsRepo = overrides.settingsRepo ?? defaultSettingsRepo;
  return {
    campaignsRepo: overrides.campaignsRepo ?? defaultCampaignsRepo,
    campaignItemsRepo: overrides.campaignItemsRepo ?? defaultCampaignItemsRepo,
    allowlistRepo: overrides.allowlistRepo ?? defaultAllowlistRepo,
    catalogRepo: overrides.catalogRepo ?? defaultCatalogRepo,
    auditRepo: overrides.auditRepo ?? defaultAuditRepo,
    settingsRepo,
    apiKeyRepo: overrides.apiKeyRepo ?? defaultApiKeyRepo,
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

export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);

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
    derived: deriveCampaignView(record.status, record.dateTo, today),
  };
}

/* ═══════════ 6. Vloženie potvrdenej kampane (I3, I10, D39c) ═══════════════ */

export interface InsertCampaignArgs {
  claims: PreviewTokenClaims;
  name: string;
  kind: CampaignKind;
  mode: CampaignMode;
  status: Extract<CampaignStatus, 'draft' | 'scheduled'>;
  fireAt: Date | null;
  parentCampaignId?: number | null;
  createdBy: number;
}

/**
 * Vloží kampaň + položky z OVERENÝCH claims preview tokenu. `confirmed_at`,
 * `confirm_payload_hash` a `sudo_at` sa zapisujú hneď pri vzniku — executor si
 * ich pri štarte dávky znova prepočíta a overí (I3). Položky dostanú
 * `position` podľa vzostupného `product_id` (I10) a `price_at_preview`
 * z tokenu (D39c).
 */
export async function insertConfirmedCampaign(
  d: ResolvedRoutesDeps,
  args: InsertCampaignArgs,
): Promise<CampaignRecord> {
  const now = d.now();
  const operationId = newOperationId();
  const sortedIds = [...args.claims.productIds].sort((a, b) => a - b);

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

  await d.campaignItemsRepo.createMany(
    record.id,
    sortedIds.map((productId, index) => ({
      productId,
      position: index + 1,
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
    message: `Kampaň „${args.name}" (${args.kind}, ${args.mode}) vytvorená s potvrdeným dry-runom: ${sortedIds.length} produktov, ${args.claims.percent} %, ${args.claims.from} → ${args.claims.to}.`,
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
