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
  /*
   * HISTORICKÉ TYPY — appka ich od 27. 8. 2026 už NEZAPISUJE.
   *
   * Prihlásenie, lockout a sudo zmizli (D99, D100), ale riadky s týmito
   * hodnotami v `audit_log` ZOSTÁVAJÚ a musia sa dať prečítať a zobraziť.
   * Vyhodiť ich z tejto únie by znamenalo, že staršia história appky prestane
   * prechádzať typovou kontrolou a obrazovka Histórie na nej spadne — čiže
   * strata záznamu, ktorý v DB fyzicky je. Nemazať.
   */
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
  // K1 bod 4 — prepnutie režimu rozsahu `pilot` ↔ `plny`. Uvoľnenie stropu
  // desiatich produktov musí byť dohľadateľné, inak sa nedá zistiť, kedy a kto
  // appku pustil na celý katalóg.
  | 'scope_mode_changed'
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

/**
 * Prečo appka NEVIE, aká zľava na produkte beží (`ShopReductionState.unknown`).
 *
 * Sú to štyri RÔZNE dôvody a nesmú sa zliať do jedného „—": prvé dva hovoria
 * „nepýtali sme sa / nedostali sme odpoveď", druhé dva „odpoveď prišla, ale
 * nedáva zmysel". Prvé dva sa riešia kľúčom alebo opakovaním, druhé dva sú
 * hlásenie pre maintainera shopu.
 */
export type ReductionUnknownReason =
  /** `getFull` sa vôbec nevolal — typicky chýba kľúč so scope `product:read`. */
  | 'not_checked'
  /** Volanie zlyhalo alebo prišlo v nečakanom tvare (`schema_drift`, 429, timeout). */
  | 'read_failed'
  /** Shop poslal trojicu `reduction_*` nekonzistentne — časť `null`, časť nie. */
  | 'partial'
  /** Trojica prišla celá, ale hodnoty sa nedajú prečítať (napr. `0000-00-00`). */
  | 'invalid';

/**
 * SKUTOČNÝ stav zľavy na produkte tak, ako ho hlási shop (`getFull`, bod B1).
 *
 * Tri stavy, ktoré sa NIKDY nesmú zliať do dvoch:
 *   - `none`    — shop výslovne povedal, že žiadna zľava nebeží (všetky tri
 *                 polia `reduction_*` sú `null`). Je to MERANÝ fakt.
 *   - `active`  — shop hlási konkrétnu zľavu s oknom.
 *   - `unknown` — appka to NEVIE. To nie je „žiadna zľava"; je to medzera
 *                 v poznaní a UI ju musí priznať (I11).
 *
 * Zliatie `none` a `unknown` do jedného „zľava nebeží" je presne tá chyba,
 * kvôli ktorej appka roky tvrdila len „podľa vlastných zápisov": z „nevieme"
 * by sa stalo tvrdenie o produkčnom shope, ktoré nikto nepremeral.
 */
export type ShopReductionState =
  | { state: 'none' }
  | {
      state: 'active';
      /**
       * Percento tak, ako ho vrátil shop. NIE je zaručené, že padne do nášho
       * rozsahu 1–30 (D11, I9) — zľavu tam mohla nastaviť ruka v admine alebo
       * flash sale. Posúdenie rozdielu patrí porovnávaču (bod A2), nie sem.
       */
      percent: number;
      from: DateOnly;
      to: DateOnly;
    }
  | { state: 'unknown'; reason: ReductionUnknownReason };

/**
 * `GET /api/products/getFull?id=` (API v5, bod A1) — všetko, čo `get`, plus
 * back-office polia. Vyžaduje kľúč so scope `product:read`.
 *
 * Názvy polí zámerne kopírujú shop (`snake_case`), rovnako ako `ProductDetail`
 * a `ProductAttribute` — jediná výnimka je `reduction`, ktorá tri surové polia
 * zlučuje do stavu vyššie, aby sa „nevieme" nedalo prehliadnuť.
 *
 * Všetko okrem `reduction` je voliteľné: back-office polia sú bonus (marža,
 * sklad, kategórie — body C1–C3) a ich absencia nesmie zhodiť čítanie stavu
 * zľavy, kvôli ktorému sa endpoint volá.
 */
export interface ProductFullDetail extends ProductDetail {
  /** Bod B1 — najväčšia diera kontraktu. Nikdy nie je `undefined`. */
  reduction: ShopReductionState;
  ean13?: string | null;
  reference?: string | null;
  /** Nákupná cena bez DPH (bod C1). */
  purchase_price?: number | null;
  /** `sell_price - purchase_price` (bod C1). */
  margin?: number | null;
  /** Marža ako percento z `sell_price`, 2 desatinné miesta (bod C1). */
  margin_percent?: number | null;
  /** Tá istá hodnota ako `price`, bez DPH. */
  sell_price?: number | null;
  sell_price_with_vat?: number | null;
  active?: boolean | null;
  /** Dátum založenia produktu tak, ako ho poslal shop (nenormalizovaný). */
  date_add?: string | null;
  /** Deň poslednej objednávky s týmto produktom, alebo `null`. */
  last_time_in_order?: string | null;
  /** Skladová zásoba aj pre nevariantné produkty (bod C2). */
  qty?: number | null;
  /** Koľko kusov tohto produktu sa kedy objednalo, naprieč objednávkami. */
  qty_in_orders?: number | null;
  supplier?: string | null;
  /** Id kategórií, do ktorých je produkt zaradený (bod C3). */
  categories?: number[] | null;
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

/**
 * Výsledok sondy kľúča.
 *
 * `address_banned` je od 24. 8. 2026 vlastný člen, hoci ide tiež o 403. Nie je
 * to výrok o kľúči: kód `ip_banned` shop vracia aj na volanie BEZ kľúča
 * (zmerané 24. 8. 2026 na verejnom `/api/products`). Zliať ho do `forbidden` by
 * znamenalo obviniť kľúč z toho, že sa appka k shopu nedostane; zliať ho do
 * `unknown` by zmazalo jediný rozdiel, ktorý používateľ potrebuje vidieť — že
 * tu nepomôže nový kľúč, ale odblokovanie adresy.
 */
export type KeyProbeResult = 'valid' | 'invalid' | 'forbidden' | 'address_banned' | 'unknown';

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

  /**
   * `GET /api/products/getFull?id=` (v5, bod A1) — ČÍTANIE, ale s kľúčom:
   * endpoint vyžaduje scope `product:read`, bez hlavičky vráti `forbidden`.
   * Kľúč je preto výslovný parameter, nie skrytá závislosť — čítacia cesta
   * katalógu (`listProducts`, `getProduct`, `batchGetProducts`, `canary`)
   * ho naďalej nemá čím podstrčiť (D48, I1).
   */
  getProductFull(id: number, key: SecretRef, ctx: ShopCtx): Promise<ProductFullDetail>;

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

/**
 * Obohatenie riadku katalógu z `GET /api/products/getFull` (migrácia 0014,
 * D116–D119, 28. 8. 2026).
 *
 * KAŽDÉ pole je `| null` a `null` znamená VÝHRADNE „nevieme" (I11) — nikdy nula
 * a nikdy odhad. Rozlíšiť sa to dá jediným spôsobom: `enrichedAt === null`
 * znamená, že sa produkt nikdy neobohatil, takže sú NULL všetky polia; pri
 * vyplnenom `enrichedAt` je `null` odpoveď SHOPU („o tomto poli nič nevedie").
 *
 * `margin` a `marginPercent` posiela shop už vypočítané a ukladajú sa tak, ako
 * prišli — appka si ich NEPOČÍTA (viď hlavička migrácie 0014, bod 2).
 */
export interface CatalogEnrichmentRecord {
  productId: number;
  /** Kód produktu („ref · názov" v UI, D116). */
  reference: string | null;
  ean13: string | null;
  purchasePrice: number | null;
  /** Marža v EUR TAK, AKO JU POSLAL SHOP (`sell_price - purchase_price`). */
  margin: number | null;
  /** Marža v % TAK, AKO JU POSLAL SHOP (2 desatiny). */
  marginPercent: number | null;
  sellPriceWithVat: number | null;
  /** Deň poslednej objednávky s produktom. `null` = shop o žiadnej nevie. */
  lastTimeInOrder: UtcDate | null;
  /** Sklad. `0` je platná nula (vypredané), `null` je „nevieme". */
  qty: number | null;
  /** Koľko kusov bolo kedy objednané — podklad obrátkovosti (D119). */
  qtyInOrders: number | null;
  supplier: string | null;
  /**
   * Stav zľavy PODĽA SHOPU v čase `enrichedAt`. NIE JE to „posledný vlastný
   * zápis" z `campaign_items` (I11) — sú to dve rôzne vety a nesmú sa zliať.
   * Všetky tri sú `null` naraz, keď na produkte žiadna zľava nebeží.
   */
  reductionPercent: number | null;
  reductionFrom: UtcDate | null;
  reductionTo: UtcDate | null;
  active: boolean | null;
  /** Id kategórií tak, ako prišli. `null` = nevieme, `[]` = shop poslal prázdno. */
  categories: readonly number[] | null;
  /** Kedy sa riadok naposledy ÚSPEŠNE obohatil. `null` = NIKDY (I11). */
  enrichedAt: UtcDate | null;
  /** Kedy sa o obohatenie naposledy POKÚSILO (aj neúspešne) — D118. */
  enrichAttemptedAt: UtcDate | null;
  /** Poradie vo fronte: 1 = allowlist, 2 = kampane, 3 = ostatné (D118). */
  enrichPriority: number;
}

/**
 * Denná tržba CELÉHO ESHOPU (migrácia 0014, tabuľka `shop_revenue_daily`, D117).
 *
 * POZOR: nikdy nie tržba na produkt. `GET /api/order/get` vracia položky ako
 * `{id, qty}` bez ceny, takže rozdeliť `totalPaidSum` medzi položky je zakázané
 * — bolo by to vymyslené číslo (poštovné, zľavy, kupóny) a porušilo by I11.
 * Per produkt existujú výhradne KUSY.
 */
export interface ShopRevenueDayRecord {
  /** Deň podľa hodín SHOPU (`date_add`), nie prepočítaný do UTC. */
  day: DateOnly;
  /** Mena tak, ako prišla. Riadok je na (deň, mena) — meny sa NESČÍTAVAJÚ. */
  currency: string;
  /** Súčet `total_paid` objednávok dňa. Riadok existuje len pre čítaný deň. */
  totalPaidSum: MoneyString;
  /** Počet objednávok v súčte. POČET, nie odkaz na objednávku (I8' bod 3). */
  ordersCount: number;
  /**
   * `true` = stiahli sme VŠETKY strany objednávok za tento deň, súčet je celý
   * deň. `false` = súčet je zatiaľ len DOLNÁ HRANICA a obrazovka to musí
   * priznať, inak posledný deň vždy vyzerá ako pokles.
   */
  dayComplete: boolean;
  pagesRead: number;
  updatedAt: UtcDate | null;
}

/**
 * Pokrytie jedného dňa v predajnosti (`sales_sync_state`, 0009 + 0014 §4, I11).
 *
 * Toto je odpoveď na otázku „je `0 predaných` nula, alebo sme ten deň
 * nesťahovali": `complete` = platná nula, `missing`/`pending`/`partial` =
 * NEVIEME, a `partial` je navyše len dolná hranica, nikdy súčet.
 */
export type SalesDayCoverage = 'missing' | 'pending' | 'partial' | 'complete';

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

/**
 * 27. 8. 2026 (D99, D102): `upsertAdmin()` a `touchLastLogin()` odtiaľ zmizli
 * spolu so svojimi implementáciami. Zakladanie správcu s heslom aj stopa
 * posledného prihlásenia patrili prihláseniu, ktoré je zmazané.
 *
 * POZOR, `local-actor.ts` tento repozitár NEPOUŽÍVA: dohľadanie aj založenie
 * lokálneho actora si robí vlastným SQL (`SELECT id, username FROM users
 * ORDER BY id ASC LIMIT 1`), lebo hľadá riadok s najnižším id, nie riadok
 * podľa mena. Do 28. 8. 2026 tu stálo, že ho dohľadáva „cez
 * `getByUsername`/`getById`" — nebola to pravda a poslalo by to čitateľa
 * hľadať cestu, ktorou zápis nechodí.
 */
export interface UsersRepo {
  getByUsername(username: string, conn?: Queryable): Promise<UserRecord | null>;
  getById(id: number, conn?: Queryable): Promise<UserRecord | null>;
}

/* 27. 8. 2026 (D99): `LockoutState` a `LoginAttemptsRepo` zmazané — lockout
   (D71) zmizol s prihlásením a `src/lib/repo/login-attempts.repo.ts` už
   neexistuje. */

/* ══════════ 9. Lokálny actor (D102; nahradil session z D69) ══════════════ */

/**
 * Kto zapísal. Appka od 27. 8. 2026 nemá prihlásenie (D99), ale meno potrebuje
 * ďalej: `campaigns.created_by` a `audit_log.user_id` majú FK na `users(id)`,
 * a auditný riadok bez actora by bol „nevieme" — presne to, čo I11 zakazuje.
 *
 * Vyhľadanie a vytvorenie vlastní `src/lib/auth/local-actor.ts`.
 */
export interface LocalActor {
  readonly id: number;
  readonly username: string;
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

/** Stav synchronizácie jedného dňa (`sales_sync_state`). */
export interface SalesSyncDay {
  saleDay: DateOnly;
  status: 'pending' | 'partial' | 'complete';
  /** Kedy sa deň dokončil (ISO) — `null`, keď ešte nie je hotový. */
  finishedAt: string | null;
  /** Kedy sa riadok naposledy hýbal (ISO) — zdroj „naposledy synchronizované". */
  updatedAt: string | null;
  /**
   * Z koľkých objednávok sa deň naozaj spočítal. POČET, nikdy odkaz na
   * objednávku (I8' bod 3).
   *
   * Prečo to tu pribudlo: bez tohto čísla sa deň `partial`, ktorý spadol skôr,
   * než čokoľvek priniesol, nedá odlíšiť od dňa, ktorý sa naozaj zmeral.
   * `summarizeCoverage()` prvý z nich do pokrytia počítať nesmie — inak delí
   * priemer dňami, ktoré appka nikdy nevidela.
   *
   * POVINNÉ od 24. 8. 2026. Voliteľné bývalo len kým sa vlny Sprintu 20
   * dobiehali; odkedy hodnotu dodávajú všetci producenti, je `?:` už len diera,
   * ktorou by nový producent mohol pole tichým opomenutím vynechať — a taký deň
   * by `summarizeCoverage()` prestal počítať ako zmeraný bez toho, aby si to
   * niekto všimol.
   *
   * `null` znamená „nevieme" a vyhodnocuje sa PRÍSNEJŠIE (deň sa za zmeraný
   * nepovažuje), nie voľnejšie. Nevedomosť sa musí NAPÍSAŤ, nie vynechať.
   */
  ordersSeen: number | null;
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
  /**
   * Počet dní, ktoré appka NAOZAJ zmerala: `complete`, plus `partial` s aspoň
   * jednou prečítanou objednávkou. Deň, ktorý sa začal a hneď spadol, tu NIE JE
   * — delil by priemer dňami bez merania (I11).
   */
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

/* ══════ 13b. KPI produktu (KONTRAKT-V4-2026-08-28: D114, D117–D119) ══════ */

/**
 * PREČO KAŽDÉ KPI NESIE DÔVOD, KEĎ HODNOTU NEMÁ (I11)
 * ---------------------------------------------------
 * KPI produktu má TRI stavy, nie dva, a rozdiel medzi druhým a tretím je celý
 * zmysel tohto typu:
 *
 *  1. **hodnota** — číslo, ktoré appka naozaj zmerala (`0` je platná nula),
 *  2. **„nevieme, produkt nie je obohatený"** — `getFull` sa naň nikdy nepýtalo
 *     (kvóta ~200 čítaní/deň, celý katalóg = ~207 dní, preto D118), takže
 *     o cene, marži, sklade ani dodávateľovi nie je známe NIČ,
 *  3. **„nevieme, dni chýbajú"** — okno 30/90 dní nie je celé stiahnuté, takže
 *     súčet kusov je nanajvýš DOLNÁ HRANICA (D119).
 *
 * Zliať stav 2 alebo 3 do nuly je chyba, ktorá sa v tomto repe UŽ RAZ dostala
 * do produkcie: `sales_sync_state` malo štrnásť dní `partial / orders_seen = 0`,
 * tie sa počítali ako pokryté a KAŽDÉ číslo o predajnosti bolo zhruba osemkrát
 * nižšie než to, čo sa naozaj zmeralo. Preto `KpiValue` nesie `gap` a nie holé
 * `T | null`: z holého `null` sa na obrazovke `?? 0` spraví nula v jednom
 * riadku kódu, kým z `{ value: null, gap }` sa nula spraviť NEDÁ bez toho, aby
 * autor ten dôvod výslovne zahodil.
 */
export type KpiGap =
  /** Produkt sa NIKDY neobohatil (`enriched_at IS NULL`) — nevieme o ňom nič. */
  | 'not_enriched'
  /** Obohatený je, ale shop toto pole o ňom nevedie (alebo nič nebeží). */
  | 'shop_has_none'
  /** Časť okna — alebo celé okno — nie je stiahnutá; číslo by klamalo (D119). */
  | 'days_missing'
  /** Obe ingrediencie poznáme, ale pomer hodnotu nemá (delenie nulou). */
  | 'not_computable';

/**
 * Jedno KPI. `gap === null` ⇔ hodnotu POZNÁME; `value: 0` je platná nula
 * a `gap` je pri nej `null`.
 */
export interface KpiValue<T> {
  readonly value: T | null;
  readonly gap: KpiGap | null;
}

/**
 * Beží na produkte zľava PODĽA SHOPU? Stav sa počíta z `reduction_percent`,
 * `reduction_from` a `reduction_to` z `getFull`, teda z odpovede SHOPU — a nie
 * z `campaign_items`, kde je „posledný VLASTNÝ zápis" (I11). Sú to dve rôzne
 * vety a v UI sa NESMÚ zliať; preto `KpiActiveDiscount.measuredAt`.
 */
export type KpiDiscountState =
  /** Podľa shopu zľava v posudzovaný deň BEŽÍ. */
  | 'running'
  /** Shop má okno zľavy, ale začína až po tom dni. */
  | 'scheduled'
  /** Shop mal okno zľavy a to už uplynulo. */
  | 'ended'
  /** Shop k `measuredAt` povedal, že žiadna zľava nebeží — MERANÝ fakt, nie nula. */
  | 'none'
  /** Produkt nie je obohatený, alebo shop poslal nekonzistentnú trojicu. */
  | 'unknown';

/** Aktívna zľava produktu podľa shopu (D114 „aktívna zľava %"). */
export interface KpiActiveDiscount {
  readonly state: KpiDiscountState;
  /**
   * % zľavy, ktorá v posudzovaný deň NAOZAJ beží. Mimo stavu `running` je to
   * vždy `null` — aj keď shop nejaké percento nahlásil (viď `reportedPercent`).
   * Toto je pole, ktoré UI píše do stĺpca „aktívna zľava".
   */
  readonly activePercent: KpiValue<number>;
  /**
   * % okna tak, ako ho shop nahlásil — aj pre okno v budúcnosti či minulosti.
   * Pre stĺpec „aktívna zľava" sa NESMIE použiť; je to podklad pre detail.
   */
  readonly reportedPercent: KpiValue<number>;
  readonly from: UtcDate | null;
  readonly to: UtcDate | null;
  /**
   * Kedy sa tento stav zmeral (`enriched_at`). `null` = produkt nie je
   * obohatený. Bez tohto poľa by obrazovka tvrdila, že pozná stav zľavy
   * v shope TERAZ — a to je presne to, čo I11 zakazuje.
   */
  readonly measuredAt: UtcDate | null;
}

/** Okno predajov a to, koľko z neho appka NEMÁ (D119). */
export interface KpiWindowCoverage {
  readonly windowDays: number;
  readonly from: DateOnly;
  readonly to: DateOnly;
  /** Koľko dní okna je naozaj DOČÍTANÝCH (`sales_sync_state.status='complete'`). */
  readonly completeDays: number;
  /**
   * Koľko dní okna je „nevieme": `missing` + `pending` + `partial`. `0` je
   * jediný stav, pri ktorom je súčet kusov celé okno; inak je to dolná hranica.
   */
  readonly unknownDays: number;
}

/**
 * Predané kusy za okno VÝHRADNE za dni, ktoré sú naozaj stiahnuté (D119).
 *
 * `partial` deň sa do súčtu NEPOČÍTA: je to len časť dňa a pripočítať ho by
 * znamenalo vydávať dolnú hranicu za deň. Počíta sa medzi `unknownDays`.
 */
export interface KpiWindowUnits extends KpiWindowCoverage {
  /**
   * Kusy za DOČÍTANÉ dni okna. `null` s `gap: 'days_missing'` ⇔ z okna nie je
   * dočítaný ANI JEDEN deň — nula by tam bola tvrdenie o nepredaní.
   * `0` s `gap: null` naopak znamená „celé okno je dočítané a nepredalo sa nič".
   */
  readonly units: KpiValue<number>;
  /** `true` ⇔ `units.value` je len DOLNÁ HRANICA (`unknownDays > 0`). */
  readonly lowerBound: boolean;
}

/** Čím je značka „bez predaja" DOKÁZANÁ. Bez dôkazu značka nevzniká (D119). */
export type KpiNoSaleProof =
  /**
   * `getFull`: shop o produkte nemá ani jednu objednávku — `last_time_in_order`
   * je `NULL` a `qty_in_orders` je `0`. Jeden request na produkt namiesto
   * tisícov objednávok (D119).
   */
  | 'shop_never_ordered'
  /** Celé dlhé okno je dočítané (`unknownDays === 0`) a v ňom nula kusov. */
  | 'no_sale_in_covered_days';

/**
 * Značka „bez predaja" (ležiak). NEOBOHATENÝ PRODUKT NIE JE MŔTVY PRODUKT —
 * je to neznámy produkt, a preto `mark` vzniká len s dôkazom.
 */
export interface KpiNoSale {
  readonly mark: boolean;
  /** `null` ⇔ `mark === false`. */
  readonly proof: KpiNoSaleProof | null;
}

/**
 * KPI jedného riadku produktu (D114 v revízii D117–D119).
 *
 * ODKIAĽ ČO POCHÁDZA — a nie je to kozmetika, lebo z toho plynú dôvody chýbania:
 *  · `getFull` (obohatenie): `reference`, `supplier`, `priceWithVat`,
 *    `purchasePrice`, `margin`, `marginPercent`, `discount`, `stock`,
 *    `soldTotal`, `lastSaleAt`, `daysSinceLastSale`, `soldPerStock`,
 *  · lokálne denné predaje: `units30`, `units90`,
 *  · zoznamový prechod katalógu: `name`, `listPrice`.
 *
 * Marža sa NEPOČÍTA — shop ju dáva hotovú (`margin`, `margin_percent`) a appka
 * ukladá aj čítá presne to, čo prišlo. Keby si ju počítala a shop zmenil
 * definíciu (DPH, nákupná cena s dopravou), appka by ticho klamala.
 */
export interface ProductKpiRow {
  readonly productId: number;
  /**
   * `true` = zrkadlo katalógu tento produkt vôbec nemá (eshop ho pridal po
   * poslednom prechode, alebo je to cudzie id). Všetky KPI z obohatenia sú
   * potom `not_enriched` — `missing` je to, čím sa tie dva prípady odlíšia.
   */
  readonly missing: boolean;
  readonly name: string | null;
  /** Kód produktu („ref · názov", D116). Len z `getFull`. */
  readonly reference: KpiValue<string>;
  readonly supplier: KpiValue<string>;
  /**
   * Cenníková cena zo zoznamového prechodu (`catalog_cache.price`), teda BEZ
   * obohatenia. Podľa dokumentácie shopu je to tá istá hodnota ako `sell_price`.
   */
  readonly listPrice: MoneyString | null;
  /** Predajná cena s DPH z `getFull` (`sell_price_with_vat`). */
  readonly priceWithVat: KpiValue<number>;
  readonly purchasePrice: KpiValue<number>;
  /** Marža v EUR TAK, AKO JU POSLAL SHOP. Nikdy dopočítaná. */
  readonly margin: KpiValue<number>;
  /** Marža v % TAK, AKO JU POSLAL SHOP. Nikdy dopočítaná. */
  readonly marginPercent: KpiValue<number>;
  readonly discount: KpiActiveDiscount;
  /** Sklad (`qty`). `0` je platná nula (vypredané), nie „nevieme". */
  readonly stock: KpiValue<number>;
  /** Celkovo predané kusy za celú históriu (`qty_in_orders`, D119). */
  readonly soldTotal: KpiValue<number>;
  /** Posledný predaj podľa shopu (`last_time_in_order`). */
  readonly lastSaleAt: KpiValue<UtcDate>;
  /**
   * Dni od posledného predaja. Je to HORNÁ hranica: hodnota je meraná k času
   * `discount.measuredAt`, takže od obohatenia mohol pribudnúť predaj, o ktorom
   * appka nevie.
   */
  readonly daysSinceLastSale: KpiValue<number>;
  /**
   * Koľkokrát sa AKTUÁLNA zásoba už predala (`qty_in_orders / qty`).
   *
   * POZOR NA POMENOVANIE: **toto NIE JE účtovná obrátkovosť.**
   * `(Ø zásoba × počet dní) / COGS` sa stále vypočítať NEDÁ — `getFull` dáva
   * zásobu ako JEDINÚ momentku, nie priemer za obdobie, a bez toho je každá
   * „obrátkovosť za obdobie" vymyslené číslo (I11). D119 pod obrátkovosťou
   * myslí práve tieto tri merané fakty: `soldTotal`, `stock` a tento pomer.
   * `gap: 'not_computable'` znamená „sklad je 0, pomer hodnotu nemá".
   */
  readonly soldPerStock: KpiValue<number>;
  readonly units30: KpiWindowUnits;
  readonly units90: KpiWindowUnits;
  readonly noSale: KpiNoSale;
  /** Kedy sa obohatenie zmeralo. `null` = produkt NIE JE obohatený (I11). */
  readonly enrichedAt: UtcDate | null;
}

/**
 * Celá strana KPI. Pokrytie oboch okien je pre všetky riadky ROVNAKÉ (je to
 * vlastnosť sťahovania, nie produktu), takže hlavička tabuľky ho vezme odtiaľ
 * a nemusí ho čítať z prvého riadku.
 */
export interface ProductKpiPage {
  /** Deň, voči ktorému sa počítajú okná aj „beží zľava" (D31, nikdy UTC). */
  readonly today: DateOnly;
  readonly window30: KpiWindowCoverage;
  readonly window90: KpiWindowCoverage;
  readonly rows: ProductKpiRow[];
}

/* ════════ 13c. Presety zliav (KONTRAKT-V4-2026-08-28: D112, K7) ══════════ */

/**
 * Pásmo presetu — tvar, aký prijíma `POST /api/campaigns` (`tiers[]`), bez
 * `itemsCount`.
 *
 * `itemsCount` tu ZÁMERNE nie je: koľko produktov padne do pásma sa vie až pri
 * dry-rune nad aktuálnym katalógom, takže uložené číslo by bolo výmysel (I11).
 * `rule` má rovnakú úlohu ako v `campaign_tiers` — je LEN na zobrazenie a
 * zopakovanie filtra, pri zápise sa nevyhodnocuje (K3).
 */
export interface DiscountPresetTier {
  /** Poradie pásma, 1..n. V rámci presetu unikátne. */
  readonly ord: number;
  /** Ľudský popis pásma, napr. „0 predaných za 360 dní". */
  readonly label: string;
  readonly percent: DiscountPercent;
  readonly rule?: unknown;
}

/**
 * Pomenovaná kombinácia filtra, pásiem a dĺžky okna (D112) — jeden riadok
 * `discount_presets` (migrácia 0015).
 *
 * Preset PREDPLNÍ formulár novej zľavy a tým to preň končí. **Nie je to druhá
 * cesta k zápisu:** spustenie presetu prejde tým istým dry-runom a tým istým
 * potvrdením ako každá zľava (I3, K7).
 */
export interface DiscountPreset {
  readonly id: number;
  /** Meno od človeka. Unikátne — duplicitné sa odmietne, nie prepíše. */
  readonly name: string;
  /** Query string filtra bez stránkovania a triedenia (`catalogFilterKey()`). */
  readonly filterQuery: string;
  readonly tiers: readonly DiscountPresetTier[];
  /** Inkluzívna dĺžka okna v dňoch (`to = from + dĺžka − 1`), 1–90 (I9, D29). */
  readonly durationDays: number;
  readonly createdAt: UtcDate;
  /** `null` = ešte nepoužitý. NIE je to „použitý v epoche" (I11). */
  readonly lastUsedAt: UtcDate | null;
}

/** Vstup pre založenie presetu. Časy si dopĺňa DB, nie volajúci. */
export type NewDiscountPreset = Pick<
  DiscountPreset,
  'name' | 'filterQuery' | 'tiers' | 'durationDays'
>;

/**
 * Čo sa dá na presete zmeniť. Zmena je VÝSLOVNÁ operácia — ukladanie pod
 * obsadeným menom preset neprepíše (na rozdiel od uložených filtrov
 * v prehliadači, ktoré nič nezapisujú do eshopu).
 */
export type DiscountPresetPatch = Partial<NewDiscountPreset>;

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
