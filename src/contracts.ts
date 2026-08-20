/**
 * Aura Zľavy — KONTRAKTY MEDZI MODULMI.
 *
 * Tento súbor je **výhradne typový** (po kompilácii z neho nezostane nič).
 * Každý agent programuje proti týmto rozhraniam aj vtedy, keď implementácia
 * druhej strany ešte neexistuje (SPRINT-PLAN §0 bod 2).
 *
 * Vlastník: A0. Nikto iný ho needituje. Ak niekomu chýba typ, doplní si ho
 * lokálne vo svojom module a nahlási to vo finálnej odpovedi.
 *
 * Runtime hodnoty (zoznamy stavov pre zod, mapy prechodov, enum `event_type`)
 * ÚMYSELNE nie sú tu — vlastnia ich `src/lib/domain/status.ts` (A7)
 * a `src/lib/audit/events.ts` (A2). Tu sú len typy.
 *
 * Referencie: KONTRAKT R1–R10 / D1–D100 / I1–I14, BUILD-SPEC §3–§9.
 */

/* ═══════════════════════════ 1. Základné aliasy ═══════════════════════════ */

/** Holý kalendárny deň `YYYY-MM-DD` bez zóny (BUILD-SPEC §2, D13). */
export type DateOnly = string;

/** ULID, 26 znakov — `operation_id` / `request_id` (D58, §2). */
export type Ulid = string;

/** SHA-256 v hexadecimálnom tvare, 64 znakov (I3, O2). */
export type Sha256Hex = string;

/** Peniaze ako string z DB drivera (`DECIMAL(10,2)`) — nikdy float pri porovnaní (§2). */
export type MoneyString = string;

/** Časová pečiatka v UTC. V DB `DATETIME(3)`, v TS `Date` (D31). */
export type UtcDate = Date;

/** Percento zľavy — celé číslo 1–30 (D11, I9). */
export type DiscountPercent = number;

/** Jednotný tvar odpovede API appky (§2). */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; detail?: unknown } };

/** Stránkovaný výsledok (§5). */
export interface Paged<T> {
  data: T[];
  page: number;
  perPage: number;
  total: number;
}

/* ══════════════════════════════ 2. DB vrstva ══════════════════════════════ */

/** Jeden riadok z DB pred namapovaním na doménový typ. */
export type DbRow = Record<string, unknown>;

/**
 * Minimálne rozhranie, ktoré poskytuje `mariadb` Pool aj PoolConnection.
 * Repozitáre ho prijímajú, aby vedeli bežať v transakcii aj mimo nej.
 */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, values?: unknown): Promise<T>;
}

/** Spojenie v transakcii (`src/db/tx.ts`). */
export interface TxConnection extends Queryable {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): unknown;
}

/** `withTransaction()` z `src/db/tx.ts`. */
export type TransactionRunner = <T>(fn: (conn: TxConnection) => Promise<T>) => Promise<T>;

/* ═══════════════════════════════ 3. Crypto ════════════════════════════════ */

/**
 * Držiteľ dešifrovaného tajomstva. Plaintext existuje výhradne ako `Buffer`
 * a `release()` ho prepíše nulami (`Buffer.fill(0)`) — I1, D64.
 */
export interface SecretHandle {
  readonly value: Buffer;
  release(): void;
}

/**
 * Callback, ktorý dešifruje kľúč až v momente odoslania requestu (§6, D64).
 * Volajúci MUSÍ `release()` volať vo `finally`.
 */
export type SecretRef = () => Promise<SecretHandle>;

/** Uložený AES-256-GCM záznam (§7, tabuľka `api_key`). */
export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/** Výsledok kontroly master key súboru (D61, I14). */
export interface MasterKeyCheck {
  ok: boolean;
  path: string;
  /** Zoznam problémov v slovenčine; prázdny keď `ok === true`. */
  problems: string[];
}

export interface SecretBox {
  encryptApiKey(plain: Buffer): EncryptedSecret;
  /** Volá sa VÝHRADNE z implementácie `SecretRef` (I1). */
  decryptApiKey(record: EncryptedSecret): Buffer;
  wipeBuffer(buf: Buffer): void;
}

/* ════════════════════════ 4. Logger a redaktor (I1) ═══════════════════════ */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Štruktúrované polia logu. Prechádzajú `redact()` vždy (D66, D92). */
export interface LogFields {
  operationId?: Ulid;
  requestId?: Ulid;
  campaignId?: number;
  productId?: number;
  httpStatus?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Podlogger s prilepenými poliami (napr. `operationId`). */
  child(fields: LogFields): Logger;
}

/**
 * Centrálny redaktor (D66, I1). Maskuje hlavičky `authorization`, `x-api-key`,
 * `cookie`, polia z denylistu do ľubovoľnej hĺbky a robí substring scan na
 * aktuálne uložený kľúč a jeho posledných 8 znakov.
 */
export type Redactor = <T>(value: T) => T;

export interface RedactorModule {
  redact: Redactor;
  /** Nastaví aktuálny kľúč pre substring scan; `null` ho zabudne. */
  setActiveSecretForScan(secret: string | null): void;
}

/* ═══════════════════════════════ 5. Audit ═════════════════════════════════ */

export type AuditActor = 'user' | 'scheduler' | 'system';

/** Presný zoznam z BUILD-SPEC §3. Runtime enum vlastní A2 (`lib/audit/events.ts`). */
export type AuditEventType =
  | 'login_ok'
  | 'login_fail'
  | 'lockout'
  | 'logout'
  | 'sudo_ok'
  | 'sudo_fail'
  | 'key_stored'
  | 'key_verified'
  | 'key_wiped'
  | 'key_panic_wipe'
  | 'domain_changed'
  | 'allowlist_added'
  | 'allowlist_removed'
  | 'allowlist_marked_unknown'
  | 'catalog_refreshed'
  | 'canary_ok'
  | 'canary_fail'
  | 'campaign_created'
  | 'campaign_confirmed'
  | 'campaign_cancelled'
  | 'campaign_claimed'
  | 'campaign_needs_key'
  | 'campaign_missed'
  | 'queue_resumed'
  | 'campaign_lapsed'
  | 'campaign_from_shifted'
  | 'campaign_finished'
  | 'write_attempt'
  | 'write_ok'
  | 'write_failed'
  | 'write_uncertain'
  | 'write_skipped'
  | 'schema_drift'
  | 'writes_locked'
  | 'writes_unlocked'
  | 'reconcile_uncertain'
  | 'migration_applied'
  | 'boot'
  | 'shutdown';

/** Vstup pre `appendAudit()` — JEDINÁ cesta zápisu do `audit_log` (I4, D50). */
export interface AuditInput {
  actor: AuditActor;
  eventType: AuditEventType;
  ok?: boolean | null;
  userId?: number | null;
  campaignId?: number | null;
  campaignItemId?: number | null;
  productId?: number | null;
  operationId?: Ulid | null;
  requestId?: Ulid | null;
  httpStatus?: number | null;
  /** name, price, last_own_write, reduction_unverifiable (D48). */
  beforeSnapshot?: unknown;
  /** odoslaný payload + raw odpoveď + status (D50). Redakcia je povinná (I1). */
  afterSnapshot?: unknown;
  message?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * `appendAudit()` NIKDY nehodí výnimku smerom do volajúceho toku — zlyhanie
 * auditu sa len zaloguje (akceptačné kritérium A2).
 */
export interface AuditWriter {
  appendAudit(input: AuditInput, conn?: Queryable): Promise<void>;
}

/** Riadok `audit_log` (§3). */
export interface AuditRecord {
  id: number;
  ts: UtcDate;
  actor: AuditActor;
  userId: number | null;
  eventType: AuditEventType | string;
  ok: boolean | null;
  campaignId: number | null;
  campaignItemId: number | null;
  productId: number | null;
  operationId: Ulid | null;
  requestId: Ulid | null;
  httpStatus: number | null;
  beforeSnapshot: unknown;
  afterSnapshot: unknown;
  message: string | null;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditFilter {
  productId?: number;
  campaignId?: number;
  eventType?: string;
  from?: DateOnly;
  to?: DateOnly;
  ok?: boolean;
  page?: number;
  perPage?: number;
}

/** Čisto čítacie rozhranie — žiadny `UPDATE`/`DELETE` (I4, D74, D75). */
export interface AuditRepo {
  list(filter: AuditFilter): Promise<Paged<AuditRecord>>;
  getById(id: number): Promise<AuditRecord | null>;
  /** Runaway počítadlo: `write_ok` + `write_uncertain` za poslednú hodinu (D79). */
  countWritesInLastHour(): Promise<number>;
  /** Podklad pre reconcile (D86): potvrdené zápisy kampane. */
  findConfirmedWrites(campaignId: number): Promise<Array<{ requestId: Ulid | null; productId: number | null }>>;
}

/* ════════════════════════════ 6. Shop klient ══════════════════════════════ */

/** Korelačný kontext každého volania (D58). */
export interface ShopCtx {
  operationId: Ulid;
  requestId?: Ulid;
}

export interface ProductListItem {
  id: number;
  name: string;
  price: number;
  has_attributes: boolean;
}

export interface ProductAttribute {
  id_product_attribute: number;
  price_impact?: number;
  reference?: string | null;
  ean13?: string | null;
  quantity?: number;
  is_default?: boolean;
  values?: string[];
}

/** `GET /api/products/get` (D48). Zľavu shop nevracia — viď B1 a I11. */
export interface ProductDetail {
  id: number;
  name: string;
  price: number;
  has_attributes: boolean;
  description?: string | null;
  description_short?: string | null;
  attributes?: ProductAttribute[];
}

/** Taxonómia chýb — jediné miesto, nekonfigurovateľné z DB (D41, §6). */
export type ShopErrorKind =
  | 'rate_limited'
  | 'server_error'
  | 'network'
  | 'timeout_before'
  | 'timeout_after'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'schema_drift'
  | 'batch_not_allowed';

export interface ShopError {
  kind: ShopErrorKind;
  /** Surový kód zo shopu (`invalid_dates`, `range_too_long`, …) — D47. */
  code: string | null;
  /** Slovenská veta s odporúčaním (D47). */
  message: string;
  httpStatus: number | null;
  retryable: boolean;
  requestId?: Ulid;
  /** Sekundy z `Retry-After`, už zastropované (D42). */
  retryAfterSeconds?: number;
  /** Redigovaná raw odpoveď (I1, D50). */
  raw?: unknown;
}

/** Výsledok `setReduction` — `uncertain` NIE JE úspech (D45, D54). */
export type SetReductionResult =
  | { outcome: 'ok'; httpStatus: number; requestId: Ulid; raw: unknown; attempts: number }
  | { outcome: 'uncertain'; httpStatus: number | null; requestId: Ulid; raw: unknown; attempts: number; error: ShopError }
  | { outcome: 'failed'; httpStatus: number | null; requestId: Ulid; raw: unknown; attempts: number; error: ShopError };

export type KeyProbeResult = 'valid' | 'invalid' | 'forbidden' | 'unknown';

export interface CanaryResult {
  ok: boolean;
  total: number;
  latencyMs: number;
  httpStatus?: number | null;
  error?: ShopError;
}

export interface SetReductionParams {
  id: number;
  from: DateOnly;
  to: DateOnly;
  /** Percento 1–30. `0` je vyhradená VÝHRADNE pre sondu `probeKey` (D53). */
  reduction: DiscountPercent;
}

/**
 * Klient voči shopu (§6). NEEXISTUJE a NESMIE existovať metóda, ktorá zľavu ruší
 * alebo posiela `to` v minulosti (I7), ani nič pod `/api/order` (I8).
 */
export interface ShopClient {
  listProducts(
    params: { page?: number; perPage?: number },
    ctx: ShopCtx,
  ): Promise<Paged<ProductListItem>>;

  getProduct(id: number, ctx: ShopCtx): Promise<ProductDetail>;

  /** `POST /api/batch`, max 25, fallback na jednotlivé GETy (D56). */
  batchGetProducts(
    ids: number[],
    ctx: ShopCtx,
  ): Promise<{ results: Map<number, ProductDetail | ShopError>; via: 'batch' | 'single' }>;

  setReduction(params: SetReductionParams, key: SecretRef, ctx: ShopCtx): Promise<SetReductionResult>;

  /** Sonda `reduction=0` — vedomý trik, nikdy nič nezapíše (D53, backlog B4). */
  probeKey(key: SecretRef, ctx: ShopCtx): Promise<KeyProbeResult>;

  /** `GET /api/products?per_page=1` pred uložením domény a pred každým fire (D55). */
  canary(ctx: ShopCtx): Promise<CanaryResult>;
}

/* ═════════════════════ 7. Doménové stavy a záznamy ═══════════════════════ */

/** Životný cyklus kampane (D83, O1, §4). Kampaň JE job. */
export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'needs_key'
  | 'running'
  | 'done'
  | 'partial'
  | 'failed'
  | 'missed'
  | 'cancelled'
  | 'lapsed';

/** Derivované UI stavy (§4) — nikdy sa neukladajú do DB. */
export type DerivedCampaignView = 'aktivna' | 'expirovana' | null;

export type CampaignKind = 'new' | 'extend' | 'overwrite' | 'retry';

/** `eager` = zápis hneď pri vytvorení (D22, hlavná cesta podľa D33b). */
export type CampaignMode = 'eager' | 'scheduled';

export type ItemStatus =
  | 'pending'
  | 'skipped'
  | 'ok'
  | 'failed'
  | 'uncertain'
  | 'interrupted'
  | 'not_found'
  | 'blocked';

export type AllowlistShopStatus = 'ok' | 'not_found' | 'unknown';

export type CatalogSource = 'list' | 'get' | 'batch';

export type KeyVerifyStatus = 'unverified' | 'valid' | 'invalid' | 'forbidden';

/** Dôvody wipe kľúča (§7). */
export type KeyWipeReason =
  | 'ttl_expired'
  | 'http_401'
  | 'http_403'
  | 'panic_button'
  | 'replaced_by_new_key';

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: UtcDate;
  updatedAt: UtcDate;
  lastLoginAt: UtcDate | null;
}

export interface SettingsRecord {
  id: 1;
  shopDomain: string | null;
  shopDomainConfirmedAt: UtcDate | null;
  eagerWriteDefault: boolean;
  writesLocked: boolean;
  writesLockedReason: string | null;
  writesLockedAt: UtcDate | null;
  onboardingDoneAt: UtcDate | null;
  updatedAt: UtcDate;
}

export interface SchedulerStateRecord {
  id: 1;
  lastTickAt: UtcDate | null;
  lastTickDurationMs: number | null;
  tickCount: number;
  lastError: string | null;
  updatedAt: UtcDate;
}

/** Metadáta kľúča — plaintext ani ciphertext sa odtiaľto NIKDY nevracia (I1, D65). */
export interface ApiKeyMeta {
  present: boolean;
  last4: string | null;
  savedAt: UtcDate | null;
  expiresAt: UtcDate | null;
  secondsLeft: number | null;
  verifyStatus: KeyVerifyStatus | null;
  lastUsedAt: UtcDate | null;
}

export interface AllowlistRecord {
  id: number;
  productId: number;
  /** 1–10 keď je aktívny, `null` keď je odobraný (I2). */
  slot: number | null;
  label: string | null;
  shopStatus: AllowlistShopStatus;
  statusNote: string | null;
  addedAt: UtcDate;
  removedAt: UtcDate | null;
}

export interface CatalogCacheRecord {
  productId: number;
  name: string | null;
  price: MoneyString | null;
  hasAttributes: boolean;
  source: CatalogSource;
  fetchedAt: UtcDate;
  raw: unknown;
}

/** „Posledný VLASTNÝ zápis" — nikdy nie pravda o shope (D7, D38, I11). */
export interface LastOwnWrite {
  percent: DiscountPercent;
  from: DateOnly;
  to: DateOnly;
  at: UtcDate;
  campaignId: number;
}

export interface CampaignRecord {
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
  fireAt: UtcDate | null;
  scheduledAt: UtcDate | null;
  needsKeySince: UtcDate | null;
  claimedAt: UtcDate | null;
  startedAt: UtcDate | null;
  finishedAt: UtcDate | null;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain: number;
  confirmedAt: UtcDate | null;
  confirmPayloadHash: Sha256Hex | null;
  sudoAt: UtcDate | null;
  resultAckAt: UtcDate | null;
  createdBy: number;
  createdAt: UtcDate;
  updatedAt: UtcDate;
}

export interface CampaignItemRecord {
  id: number;
  campaignId: number;
  productId: number;
  /** Deterministické poradie zápisu (I10). */
  position: number;
  status: ItemStatus;
  attemptCount: number;
  nameAtWrite: string | null;
  /** D39c protiváha — obe ceny sú povinné, nezhoda sa nesmie stratiť. */
  priceAtPreview: MoneyString | null;
  priceAtWrite: MoneyString | null;
  priceMismatch: boolean;
  hasAttributes: boolean;
  /** Kým nebude backlog B1, je vždy `true` (D48, I11). */
  reductionUnverifiable: boolean;
  requestId: Ulid | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  sentPayload: unknown;
  rawResponse: unknown;
  startedAt: UtcDate | null;
  finishedAt: UtcDate | null;
}

export interface LoginAttemptRecord {
  id: number;
  username: string;
  ip: string;
  success: boolean;
  ts: UtcDate;
}

/* ════════════════════════════ 8. Repozitáre ═══════════════════════════════ */

export interface SettingsRepo {
  get(conn?: Queryable): Promise<SettingsRecord>;
  setShopDomain(domain: string, confirmedAt: UtcDate | null, conn?: Queryable): Promise<void>;
  setEagerWriteDefault(enabled: boolean, conn?: Queryable): Promise<void>;
  /** Runaway zámok (D79, I12) — fail-closed. */
  lockWrites(reason: string, conn?: Queryable): Promise<void>;
  unlockWrites(conn?: Queryable): Promise<void>;
  markOnboardingDone(conn?: Queryable): Promise<void>;
}

export interface AllowlistRepo {
  listActive(conn?: Queryable): Promise<AllowlistRecord[]>;
  listAll(conn?: Queryable): Promise<AllowlistRecord[]>;
  /** Hodí doménovú chybu `allowlist_full` pri 10 obsadených slotoch (I2). */
  addProduct(productId: number, label: string | null, conn?: Queryable): Promise<AllowlistRecord>;
  /** Uvolní `slot` a nastaví `removed_at` (D40 kontroluje volajúci). */
  removeProduct(productId: number, conn?: Queryable): Promise<boolean>;
  markShopStatus(
    productId: number,
    status: AllowlistShopStatus,
    note: string | null,
    conn?: Queryable,
  ): Promise<void>;
  /** Fail-closed kontrola pred KAŽDÝM volaním shop API (I2, R1). */
  areAllActive(productIds: number[], conn?: Queryable): Promise<boolean>;
}

export interface CatalogRepo {
  get(productId: number, conn?: Queryable): Promise<CatalogCacheRecord | null>;
  getMany(productIds: number[], conn?: Queryable): Promise<Map<number, CatalogCacheRecord>>;
  upsert(
    record: Omit<CatalogCacheRecord, 'fetchedAt'> & { fetchedAt?: UtcDate },
    conn?: Queryable,
  ): Promise<void>;
}

export interface CampaignListFilter {
  status?: CampaignStatus | CampaignStatus[];
  productId?: number;
  page?: number;
  perPage?: number;
}

export interface CreateCampaignInput {
  operationId: Ulid;
  name: string;
  kind: CampaignKind;
  parentCampaignId?: number | null;
  percent: DiscountPercent;
  dateFrom: DateOnly;
  dateTo: DateOnly;
  mode: CampaignMode;
  status: CampaignStatus;
  fireAt?: UtcDate | null;
  scheduledAt?: UtcDate | null;
  confirmedAt?: UtcDate | null;
  confirmPayloadHash?: Sha256Hex | null;
  sudoAt?: UtcDate | null;
  createdBy: number;
}

export interface CampaignsRepo {
  create(input: CreateCampaignInput, conn?: Queryable): Promise<CampaignRecord>;
  getById(id: number, conn?: Queryable): Promise<CampaignRecord | null>;
  list(filter: CampaignListFilter, conn?: Queryable): Promise<Paged<CampaignRecord>>;
  /**
   * Atomický claim (D84, I12): PRESNE jeden `UPDATE … WHERE id=? AND status IN (…)`.
   * Vracia `false` pri `affectedRows = 0`. Žiadny `SELECT` a potom `UPDATE`.
   */
  claim(id: number, allowedFrom: CampaignStatus[], conn?: Queryable): Promise<boolean>;
  setStatus(
    id: number,
    status: CampaignStatus,
    patch?: Partial<
      Pick<
        CampaignRecord,
        | 'statusReason'
        | 'needsKeySince'
        | 'startedAt'
        | 'finishedAt'
        | 'itemsTotal'
        | 'itemsOk'
        | 'itemsFailed'
        | 'itemsUncertain'
        | 'resultAckAt'
        | 'dateFrom'
        | 'dateFromOriginal'
        | 'confirmedAt'
        | 'confirmPayloadHash'
        | 'sudoAt'
      >
    >,
    conn?: Queryable,
  ): Promise<void>;
  findDue(now: UtcDate, conn?: Queryable): Promise<CampaignRecord[]>;
  findMissedCandidates(threshold: UtcDate, conn?: Queryable): Promise<CampaignRecord[]>;
  findNeedsKey(conn?: Queryable): Promise<CampaignRecord[]>;
  findRunningUnfinished(conn?: Queryable): Promise<CampaignRecord[]>;
  findUnacked(conn?: Queryable): Promise<CampaignRecord[]>;
  ack(id: number, conn?: Queryable): Promise<void>;
  /** Blokovanie odobrania z allowlistu (D40). */
  findPlannedForProduct(productId: number, conn?: Queryable): Promise<CampaignRecord[]>;
  /** Prekryv dvoch BUDÚCICH kampaní na tom istom produkte (D28). */
  findFutureOverlaps(
    productIds: number[],
    from: DateOnly,
    to: DateOnly,
    conn?: Queryable,
  ): Promise<CampaignRecord[]>;
  lastOwnWrite(productId: number, conn?: Queryable): Promise<LastOwnWrite | null>;
}

export interface CampaignItemsRepo {
  createMany(
    campaignId: number,
    items: Array<{
      productId: number;
      position: number;
      priceAtPreview: MoneyString | null;
      hasAttributes: boolean;
    }>,
    conn?: Queryable,
  ): Promise<void>;
  listByCampaign(campaignId: number, conn?: Queryable): Promise<CampaignItemRecord[]>;
  update(
    id: number,
    patch: Partial<Omit<CampaignItemRecord, 'id' | 'campaignId' | 'productId'>>,
    conn?: Queryable,
  ): Promise<void>;
  /** Označí zvyšné položky pri SIGTERM / 401 (D85, D51). */
  markRemaining(
    campaignId: number,
    fromPosition: number,
    status: ItemStatus,
    reason: string,
    conn?: Queryable,
  ): Promise<void>;
}

export interface SchedulerStateRepo {
  get(conn?: Queryable): Promise<SchedulerStateRecord>;
  heartbeat(durationMs: number, lastError: string | null, conn?: Queryable): Promise<void>;
}

export interface ApiKeyRepo {
  /** Metadáta pre UI — nikdy plaintext (D65, I1). */
  getMeta(conn?: Queryable): Promise<ApiKeyMeta>;
  store(
    plain: Buffer,
    last4: string,
    ttlHours: number,
    conn?: Queryable,
  ): Promise<{ expiresAt: UtcDate; last4: string }>;
  /**
   * Lazy TTL kontrola pri KAŽDOM prístupe (D63). Po expirácii nevráti kľúč
   * a spustí wipe. `null` = kľúč nie je použiteľný.
   */
  loadForUse(): Promise<SecretRef | null>;
  /** Wipe: prepis náhodnými bajtmi → DELETE → audit `key_wiped` (D63). */
  wipe(reason: KeyWipeReason, conn?: Queryable): Promise<boolean>;
  setVerifyStatus(status: KeyVerifyStatus, conn?: Queryable): Promise<void>;
  touchLastUsed(conn?: Queryable): Promise<void>;
}

export interface UsersRepo {
  getByUsername(username: string, conn?: Queryable): Promise<UserRecord | null>;
  getById(id: number, conn?: Queryable): Promise<UserRecord | null>;
  upsertAdmin(username: string, passwordHash: string, conn?: Queryable): Promise<UserRecord>;
  touchLastLogin(id: number, conn?: Queryable): Promise<void>;
}

export interface LockoutState {
  locked: boolean;
  /** Kedy blokáda skončí; `null` keď netrvá. */
  until: UtcDate | null;
  failedAttempts: number;
  retryAfterSeconds: number;
}

export interface LoginAttemptsRepo {
  record(username: string, ip: string, success: boolean, conn?: Queryable): Promise<void>;
  /** Stav prežíva restart procesu — in-memory je zakázané (O4). */
  getState(ip: string, username: string, conn?: Queryable): Promise<LockoutState>;
}

/* ═══════════════════ 9. Autentifikácia, session, sudo ════════════════════ */

export interface SessionClaims {
  sub: number;
  username: string;
  /** Absolútny konec platnosti — 8 h (D69). */
  absoluteExpiresAt: UtcDate;
  /** Idle konec — 30 min, obnovuje sa pri každom požiadaní (D69). */
  idleExpiresAt: UtcDate;
  /** Konec sudo okna — 15 min od poslednej autentifikácie (D70). */
  sudoUntil: UtcDate | null;
}

export interface SudoCheck {
  /** Pri pochybnosti VŽDY `false` (fail-closed, I3). */
  valid: boolean;
  sudoUntil: UtcDate | null;
}

/* ════════════════════ 10. Preview token (I3, O2) ════════════════════════ */

export interface PreviewTokenClaims {
  jti: string;
  sub: number;
  kind: CampaignKind;
  productIds: number[];
  percent: DiscountPercent;
  from: DateOnly;
  to: DateOnly;
  /** `price_at_preview` per produkt (D39c bod 2). */
  pricesAtPreview: Record<string, MoneyString>;
  /** SHA-256 kanonického JSON `{productIds sorted, percent, from, to, kind}`. */
  payloadHash: Sha256Hex;
}

export interface PreviewTokenService {
  issue(claims: Omit<PreviewTokenClaims, 'jti' | 'payloadHash'>): Promise<{
    token: string;
    jti: string;
    payloadHash: Sha256Hex;
  }>;
  /**
   * Overí podpis, TTL 15 min a zhodu `payloadHash` s požadovanou operáciou.
   * Token je JEDNORAZOVÝ — druhé použitie sa odmietne (I3).
   */
  verify(
    token: string,
    expected: Pick<PreviewTokenClaims, 'kind' | 'productIds' | 'percent' | 'from' | 'to'>,
  ): Promise<PreviewTokenClaims>;
  computePayloadHash(
    input: Pick<PreviewTokenClaims, 'kind' | 'productIds' | 'percent' | 'from' | 'to'>,
  ): Sha256Hex;
}

/* ═══════════════════════════ 11. Engine (§9) ═════════════════════════════ */

/** Jedna položka dry-run náhľadu (D3, D4, D60). */
export interface PreviewItem {
  productId: number;
  name: string | null;
  price: MoneyString | null;
  /** Orientačná cena `price × (1 − r/100)` — vždy s upozornením (D4). */
  discountedPrice: MoneyString | null;
  hasAttributes: boolean;
  lastOwnWrite: LastOwnWrite | null;
  /** Zľava sa cez API overiť nedá (D48, I11, backlog B1). */
  reductionUnverifiable: true;
  warnings: string[];
}

export interface PreviewWarnings {
  /** Kampaň za horizont platnosti kľúča (D8). */
  keyExpiresBeforeStart: boolean;
  /** `from = to` — vyžaduje dodatočné potvrdenie (D30). */
  oneDayWindow: boolean;
  /** Produkty, kde podľa vlastnej DB zľava beží/je naplánovaná (D28). */
  overwrite: number[];
  /** Produkty s variantmi (D60). */
  hasAttributes: number[];
}

/** Blokátor — dry-run sa nedá potvrdiť, kým trvá (fail-closed). */
export interface PreviewBlocker {
  code: string;
  message: string;
  productId?: number;
}

export interface PreviewResult {
  previewToken: string;
  items: PreviewItem[];
  warnings: PreviewWarnings;
  blockers: PreviewBlocker[];
}

/** Výsledok guardov pred zápisom (I2, I9, I12, I13, D79). */
export type GuardResult =
  | { ok: true }
  | { ok: false; code: string; message: string; detail?: unknown };

export interface ExecutorResult {
  campaignId: number;
  status: Extract<CampaignStatus, 'done' | 'partial' | 'failed' | 'needs_key'>;
  itemsTotal: number;
  itemsOk: number;
  itemsFailed: number;
  itemsUncertain: number;
  items: CampaignItemRecord[];
}

/** Snapshot pred zápisom (D48, D39c). */
export interface PreWriteSnapshot {
  productId: number;
  found: boolean;
  name: string | null;
  priceAtWrite: MoneyString | null;
  hasAttributes: boolean;
  lastOwnWrite: LastOwnWrite | null;
  reductionUnverifiable: true;
  priceAtPreview: MoneyString | null;
  priceMismatch: boolean;
}

/** Globálny zápisový mutex (D37, I12): in-process semafor + DB `GET_LOCK`. */
export interface WriteMutex {
  acquire(owner: string): Promise<{ release(): Promise<void> }>;
  /** `null` keď je mutex obsadený — druhá operácia sa odmietne, nečaká. */
  tryAcquire(owner: string): Promise<{ release(): Promise<void> } | null>;
}

/* ═══════════════════════════ 12. Scheduler (§9) ══════════════════════════ */

export interface TickResult {
  startedAt: UtcDate;
  durationMs: number;
  keyWiped: boolean;
  reconciled: number;
  missed: number;
  fired: number;
  needsKey: number;
  error: string | null;
}

/** Pripomienkové pásma 48/24/2 h (D26). Nikam sa nič neposiela (bez SMTP, D17). */
export type ReminderBand = 48 | 24 | 2;

export interface Reminder {
  campaignId: number;
  name: string;
  band: ReminderBand;
  fireAt: UtcDate;
}

export interface SchedulerHandle {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

/* ═════════ 13. Predajnosť produktov (KONTRAKT-PREDAJNOST, P1, P4) ════════ */

/**
 * Typy predajnosti sú pomenované PO PRODUKTE, nikdy po objednávke — appka
 * z objednávok pozná výhradne súčet predaných KUSOV na produkt a deň (P4,
 * I8' bod 3). Peniaze tu zámerne nie sú: zaplatená suma patrí celej
 * objednávke, nie položke, takže obrat na produkt sa priradiť NEDÁ.
 *
 * Nič z toho nie je obrátkovosť — na tú chýba COGS a zásoba nevariantných
 * produktov (I11, karta „Obrátkovosť" zostáva zamknutá).
 */

/** Jeden riadok `product_sales_daily` — súčet kusov za produkt a deň. */
export interface ProductSalesDay {
  productId: number;
  saleDay: DateOnly;
  unitsSold: number;
}

/** Stav synchronizácie jedného dňa (`sales_sync_state`) — bez počtov objednávok. */
export interface SalesSyncDay {
  saleDay: DateOnly;
  status: 'pending' | 'partial' | 'complete';
  /** Kedy sa deň dokončil (ISO) — `null`, keď ešte nie je hotový. */
  finishedAt: string | null;
  /** Kedy sa riadok naposledy hýbal (ISO) — zdroj „naposledy synchronizované". */
  updatedAt: string | null;
}

/**
 * Za aké obdobie dáta NAOZAJ sú. Bez tejto hlavičky by karta klamala: okno je
 * zámerne krátke (`SALES_WINDOW_DAYS`, P3) a nočne sa rozširuje, takže „0 kusov"
 * môže znamenať aj „za tie tri dni sa to nepredalo", nie „nepredáva sa".
 */
export interface SalesCoverage {
  /** Je synchronizácia vôbec zapnutá (`SALES_SYNC_ENABLED`)? */
  syncEnabled: boolean;
  /** Nastavené okno prvého behu v dňoch — len informácia, nie pokrytie. */
  windowDays: number;
  /** Prvý a posledný pokrytý deň; `null`, keď nie je pokrytý ani jeden. */
  from: DateOnly | null;
  to: DateOnly | null;
  /** Počet dní so skutočnými dátami (`complete` + `partial`). */
  daysCovered: number;
  /** Z toho dní dopočítaných len čiastočne — pokrok, nie hotový deň (P6). */
  daysPartial: number;
  /** Kedy prebehla poslednná synchronizácia (ISO) — `null`, keď nikdy. */
  lastSyncedAt: string | null;
  /** `false` = appka o predaji NIČ nevie a nesmie zobraziť nuly ako fakt. */
  hasData: boolean;
}

/** Odvodené metriky predajnosti jedného produktu allowlistu. */
export interface ProductSalesMetrics {
  productId: number;
  name: string | null;
  label: string | null;
  /** Kusy za celé pokryté obdobie. */
  unitsSold: number;
  /** Kusy na deň; `null`, keď nie je pokrytý ani jeden deň (nedopočítava sa). */
  unitsPerDay: number | null;
  /** Posledný deň s predajom v pokrytom období; `null` = v ňom sa nepredal. */
  lastSaleDay: DateOnly | null;
  /** Dni od posledného predaja; `null`, keď v pokrytom období predaj nebol. */
  daysSinceLastSale: number | null;
  /** Kusy v novšej polovici pokrytého okna; `null`, keď je okno na delenie krátke. */
  recentUnits: number | null;
  /** Kusy v staršej polovici pokrytého okna; `null` z rovnakého dôvodu. */
  previousUnits: number | null;
}

/** Telo odpovede `GET /api/sales`. */
export interface SalesInsightsReport {
  today: DateOnly;
  coverage: SalesCoverage;
  products: ProductSalesMetrics[];
}

/* ═══════════════════════ 14. Health (§5, D87, D91) ═══════════════════════ */

/** `/api/health` — NIKDY neobsahuje `last4` ani nič citlivé (I1). */
export interface HealthReport {
  status: 'ok' | 'degraded';
  db: boolean;
  key: { present: boolean; expiresAt: string | null };
  scheduler: { lastTickAt: string | null; ageSec: number | null };
  writesEnabled: boolean;
  writesLocked: boolean;
  version: string;
}
