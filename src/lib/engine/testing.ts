/**
 * Aura Zľavy — IN-MEMORY SVET PRE TESTY ENGINE (A9).
 *
 * Ľahké fakes repozitárov pre testy `test/unit/guards.spec.ts` a integračné
 * testy executora, ktoré potrebujú reálny mock shop, ale nie reálnu MariaDB.
 * Dôkaz „kľúč nie je v DB" (`test/integration/redaction.spec.ts`) beží proti
 * skutočnej DB — tieto fakes sú na správanie, nie na granty.
 *
 * NIE JE to produkčný kód: nič odtiaľto sa nesmie importovať mimo `test/**`.
 *
 * Vlastník: A9.
 */
import type {
  AllowlistShopStatus,
  AuditInput,
  AuditWriter,
  CampaignItemRecord,
  CampaignRecord,
  CampaignStatus,
  DateOnly,
  ItemStatus,
  KeyWipeReason,
  LastOwnWrite,
  MoneyString,
  SecretRef,
  SettingsRecord,
  TransactionRunner,
  TxConnection,
  Ulid,
  UtcDate,
} from '@/contracts';

/* ══════════════════════════ settings ══════════════════════════════════════ */

export interface MemorySettingsRepo {
  record: SettingsRecord;
  get(): Promise<SettingsRecord>;
  lockWrites(reason: string): Promise<void>;
  unlockWrites(): Promise<void>;
}

export function createMemorySettingsRepo(
  overrides: Partial<SettingsRecord> = {},
): MemorySettingsRepo {
  const record: SettingsRecord = {
    id: 1,
    shopDomain: null,
    shopDomainConfirmedAt: null,
    eagerWriteDefault: true,
    writesLocked: false,
    writesLockedReason: null,
    writesLockedAt: null,
    onboardingDoneAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
  return {
    record,
    async get() {
      return { ...record };
    },
    async lockWrites(reason: string) {
      record.writesLocked = true;
      record.writesLockedReason = reason;
      record.writesLockedAt = new Date();
    },
    async unlockWrites() {
      record.writesLocked = false;
      record.writesLockedReason = null;
      record.writesLockedAt = null;
    },
  };
}

/* ══════════════════════════ allowlist ═════════════════════════════════════ */

export interface MemoryAllowlistRepo {
  active: Set<number>;
  shopStatuses: Map<number, { status: AllowlistShopStatus; note: string | null }>;
  areAllActive(productIds: number[]): Promise<boolean>;
  markShopStatus(productId: number, status: AllowlistShopStatus, note: string | null): Promise<void>;
}

export function createMemoryAllowlistRepo(activeIds: number[]): MemoryAllowlistRepo {
  const active = new Set(activeIds);
  const shopStatuses = new Map<number, { status: AllowlistShopStatus; note: string | null }>();
  return {
    active,
    shopStatuses,
    async areAllActive(productIds: number[]) {
      return productIds.length > 0 && productIds.every((id) => active.has(id));
    },
    async markShopStatus(productId, status, note) {
      shopStatuses.set(productId, { status, note });
    },
  };
}

/* ══════════════════════════ audit ═════════════════════════════════════════ */

export interface MemoryAudit extends AuditWriter {
  records: AuditInput[];
  /** Pred-seedni „historické" zápisy pre runaway počítadlo (D79). */
  seedWrites(count: number): void;
  countWritesInLastHour(): Promise<number>;
  findConfirmedWrites(
    campaignId: number,
  ): Promise<Array<{ requestId: Ulid | null; productId: number | null }>>;
  byEvent(eventType: string): AuditInput[];
}

export function createMemoryAudit(): MemoryAudit {
  const records: AuditInput[] = [];
  return {
    records,
    async appendAudit(input: AuditInput) {
      records.push(input);
    },
    seedWrites(count: number) {
      for (let i = 0; i < count; i += 1) {
        records.push({ actor: 'system', eventType: 'write_ok', ok: true });
      }
    },
    async countWritesInLastHour() {
      return records.filter((r) => r.eventType === 'write_ok' || r.eventType === 'write_uncertain')
        .length;
    },
    async findConfirmedWrites(campaignId: number) {
      return records
        .filter((r) => r.eventType === 'write_ok' && r.ok === true && r.campaignId === campaignId)
        .map((r) => ({ requestId: r.requestId ?? null, productId: r.productId ?? null }));
    },
    byEvent(eventType: string) {
      return records.filter((r) => r.eventType === eventType);
    },
  };
}

/* ══════════════════════════ transakcia ════════════════════════════════════ */

/**
 * `TransactionRunner` pre in-memory svet: telo sa spustí, spojenie neexistuje.
 *
 * ROLLBACK TU NIE JE A NESMIE BYŤ PREDSTIERANÝ. Fakes repozitárov zapisujú do
 * `Map`, ktorú by žiadny `rollback()` nevrátil, a fake, ktorý by atomicitu
 * napodobnil, by z testu urobil dôkaz o sebe samom. Atomicita vloženej zľavy
 * sa preto dokazuje nad SKUTOČNOU MariaDB
 * (`test/integration/vlozenie-kampane-atomicke.spec.ts`); tento runner existuje
 * len preto, aby route-y bez DB vôbec zbehli.
 *
 * `query()` schválne HÁDŽE: keby sa nejaká cesta o spojenie naozaj oprela,
 * test to má povedať nahlas, nie ticho zapísať mimo fake sveta.
 */
export function createMemoryTx(): TransactionRunner {
  const conn: TxConnection = {
    async query() {
      throw new Error(
        'In-memory transakcia nemá spojenie do DB — fake repozitáre `conn` ignorujú.',
      );
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {
      return undefined;
    },
  };
  return async (fn) => fn(conn);
}

/* ══════════════════════════ api key ═══════════════════════════════════════ */

export interface MemoryApiKeyRepo {
  plaintext: string | null;
  wipedWith: KeyWipeReason[];
  lastUsedAt: UtcDate | null;
  loadForUse(): Promise<SecretRef | null>;
  wipe(reason: KeyWipeReason): Promise<boolean>;
  touchLastUsed(): Promise<void>;
}

/** Kľúč má VŽDY tvar `fake-shop-key-…` (I1). */
export function createMemoryApiKeyRepo(plaintext: string | null): MemoryApiKeyRepo {
  const repo: MemoryApiKeyRepo = {
    plaintext,
    wipedWith: [],
    lastUsedAt: null,
    async loadForUse() {
      if (repo.plaintext === null) return null;
      const current = repo.plaintext;
      return async () => {
        // Lazy ako produkcia (D63): po wipe už handle nevznikne.
        if (repo.plaintext === null) {
          throw new Error('kľúč bol medzičasom wipnutý');
        }
        const buffer = Buffer.from(current, 'utf8');
        return {
          value: buffer,
          release() {
            buffer.fill(0);
          },
        };
      };
    },
    async wipe(reason: KeyWipeReason) {
      const had = repo.plaintext !== null;
      repo.plaintext = null;
      repo.wipedWith.push(reason);
      return had;
    },
    async touchLastUsed() {
      repo.lastUsedAt = new Date();
    },
  };
  return repo;
}

/* ══════════════════════════ campaigns + items ═════════════════════════════ */

export interface MemoryCampaignsRepo {
  campaigns: Map<number, CampaignRecord>;
  ownWrites: Map<number, LastOwnWrite>;
  getById(id: number): Promise<CampaignRecord | null>;
  claim(id: number, allowedFrom: CampaignStatus[]): Promise<boolean>;
  setStatus(
    id: number,
    status: CampaignStatus,
    patch?: Partial<CampaignRecord>,
  ): Promise<void>;
  lastOwnWrite(productId: number): Promise<LastOwnWrite | null>;
  findRunningUnfinished(): Promise<CampaignRecord[]>;
  findFutureOverlaps(productIds: number[], from: DateOnly, to: DateOnly): Promise<CampaignRecord[]>;
}

export interface MemoryCampaignItemsRepo {
  items: Map<number, CampaignItemRecord>;
  listByCampaign(campaignId: number): Promise<CampaignItemRecord[]>;
  update(id: number, patch: Partial<CampaignItemRecord>): Promise<void>;
  markRemaining(
    campaignId: number,
    fromPosition: number,
    status: ItemStatus,
    reason: string,
  ): Promise<void>;
}

export interface MemoryEngineWorld {
  campaignsRepo: MemoryCampaignsRepo;
  campaignItemsRepo: MemoryCampaignItemsRepo;
  /** Vloží kampaň + položky (position podľa vzostupného product_id, I10). */
  seedCampaign(
    campaign: CampaignRecord,
    items: Array<{ productId: number; priceAtPreview: MoneyString | null; status?: ItemStatus }>,
  ): void;
}

export function createMemoryCampaignWorld(): MemoryEngineWorld {
  const campaigns = new Map<number, CampaignRecord>();
  const items = new Map<number, CampaignItemRecord>();
  const ownWrites = new Map<number, LastOwnWrite>();
  let nextItemId = 1;

  const campaignsRepo: MemoryCampaignsRepo = {
    campaigns,
    ownWrites,
    async getById(id) {
      const found = campaigns.get(id);
      return found ? { ...found } : null;
    },
    async claim(id, allowedFrom) {
      const found = campaigns.get(id);
      if (!found || !allowedFrom.includes(found.status)) return false;
      found.status = 'running';
      found.claimedAt = new Date();
      return true;
    },
    async setStatus(id, status, patch = {}) {
      const found = campaigns.get(id);
      if (!found) return;
      Object.assign(found, patch, { status, updatedAt: new Date() });
    },
    async lastOwnWrite(productId) {
      return ownWrites.get(productId) ?? null;
    },
    async findRunningUnfinished() {
      return [...campaigns.values()].filter(
        (c) => c.status === 'running' && c.finishedAt === null,
      );
    },
    async findFutureOverlaps() {
      return [];
    },
  };

  const campaignItemsRepo: MemoryCampaignItemsRepo = {
    items,
    async listByCampaign(campaignId) {
      return [...items.values()]
        .filter((i) => i.campaignId === campaignId)
        .sort((a, b) => a.position - b.position)
        .map((i) => ({ ...i }));
    },
    async update(id, patch) {
      const found = items.get(id);
      if (!found) throw new Error(`campaign item ${id} neexistuje`);
      Object.assign(found, patch);
    },
    async markRemaining(campaignId, fromPosition, status, reason) {
      for (const item of items.values()) {
        if (item.campaignId === campaignId && item.position >= fromPosition && item.status === 'pending') {
          item.status = status;
          item.errorMessage = reason;
          item.finishedAt = new Date();
        }
      }
    },
  };

  return {
    campaignsRepo,
    campaignItemsRepo,
    seedCampaign(campaign, seedItems) {
      campaigns.set(campaign.id, { ...campaign });
      [...seedItems]
        .sort((a, b) => a.productId - b.productId)
        .forEach((seed, index) => {
          const id = nextItemId;
          nextItemId += 1;
          items.set(id, {
            id,
            campaignId: campaign.id,
            productId: seed.productId,
            position: index + 1,
            status: seed.status ?? 'pending',
            attemptCount: 0,
            nameAtWrite: null,
            priceAtPreview: seed.priceAtPreview,
            priceAtWrite: null,
            priceMismatch: false,
            hasAttributes: false,
            reductionUnverifiable: true,
            requestId: null,
            httpStatus: null,
            errorCode: null,
            errorMessage: null,
            sentPayload: null,
            rawResponse: null,
            startedAt: null,
            finishedAt: null,
          });
        });
    },
  };
}
