/**
 * Aura Zľavy — HARNESS PRE INTEGRAČNÉ TESTY ROUTE-OV A12.
 *
 * In-memory svet repozitárov (nad fakes z `src/lib/engine/testing.ts`),
 * stubovaná session/sudo vrstva pre `defineRoute()` a helper na stavbu
 * `Request`-ov so správnym Origin (D72). Shop je VŽDY reálny mock (I6) —
 * testy si ho prinesú cez `useMockShop()` a harness dostane jeho URL.
 *
 * Vlastník: A12. Zdieľajú ho `routes-campaigns.spec.ts`,
 * `no-write-without-confirm.spec.ts` a `kontrakt-v3-kluc.spec.ts` (K6).
 */
import type {
  AllowlistRecord,
  AuditFilter,
  AuditInput,
  AuditRecord,
  CampaignItemRecord,
  CampaignListFilter,
  CampaignRecord,
  CampaignStatus,
  CatalogCacheRecord,
  CreateCampaignInput,
  MoneyString,
  Paged,
  SessionClaims,
} from '@/contracts';

import { createPreviewTokenService, type PreviewTokenServiceInstance } from '@/lib/crypto/preview-token';
import {
  createMemoryApiKeyRepo,
  createMemoryAudit,
  createMemorySettingsRepo,
  type MemoryApiKeyRepo,
  type MemoryAudit,
} from '@/lib/engine/testing';
import { createBudget } from '@/lib/engine/budget';
import { createWriteMutex } from '@/lib/engine/mutex';
import type { ExecutorFlags } from '@/lib/engine/executor';
import type { RouteDeps } from '@/lib/http/define-route';
import { createShopClient } from '@/lib/shop/client';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
} from '@/lib/shop/read-budget';

import type { RoutesDeps } from '@/app/api/campaigns/_shared';
import type { CampaignTierRecord } from '@/lib/repo/tiers.repo';

import { fakeApiKey } from '../helpers/factories';

/* ══════════════════════════ 1. Session / sudo stub ════════════════════════ */

export const TEST_USER_ID = 1;

export function testClaims(now = new Date()): SessionClaims {
  return {
    sub: TEST_USER_ID,
    username: 'samuel',
    absoluteExpiresAt: new Date(now.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(now.getTime() + 30 * 60_000),
    sudoUntil: new Date(now.getTime() + 10 * 60_000),
  };
}

/** Stub session vrstvy — testy route-ov netestujú A4, len pipeline za ňou. */
export function sessionRouteDeps(opts: { sudo?: boolean } = {}): RouteDeps {
  const claims = testClaims();
  return {
    verifySession: async () => ({
      claims,
      refreshed: {
        token: 'test-token',
        claims,
        cookie: {
          name: 'ovl_zliav_session',
          value: 'test-token',
          options: { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 1800 },
        },
      },
    }),
    requireSudo:
      opts.sudo === false
        ? () => {
            const err = new Error('Vyžaduje sa opätovné potvrdenie heslom (D70).');
            err.name = 'SudoRequiredError';
            throw err;
          }
        : () => new Date(Date.now() + 10 * 60_000),
  };
}

/* ══════════════════════════ 2. Request helper (D72) ═══════════════════════ */

export const APP_ORIGIN = 'https://app.local';

export function makeRequest(
  method: string,
  path: string,
  body?: unknown,
  opts: { origin?: string | null } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
  if (origin !== null && method !== 'GET') headers.origin = origin;
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export interface ParsedResponse {
  status: number;
  body: { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}

export async function parse(response: Response): Promise<ParsedResponse> {
  return { status: response.status, body: (await response.json()) as ParsedResponse['body'] };
}

/* ═══════════════════════ 3. In-memory repozitáre ══════════════════════════ */

class CodedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CodedError';
    this.code = code;
  }
}

/**
 * Položka fronty tak, ako ju vidí PRODUKČNÝ repozitár po V3: `CampaignItemRecord`
 * + `percent` pásma (K3). Fake bez `percent` by bol pasca — executor by v
 * `assertConfirmed()` nedopočítal hash (K4) a testy by dokazovali niečo iné,
 * než čo robí produkčná cesta.
 */
export type HarnessItem = CampaignItemRecord & { percent: number };

function paginate<T>(rows: T[], page: number, perPage: number): Paged<T> {
  return {
    data: rows.slice((page - 1) * perPage, page * perPage),
    page,
    perPage,
    total: rows.length,
  };
}

export interface RoutesWorld {
  deps: RoutesDeps;
  campaigns: Map<number, CampaignRecord>;
  items: Map<number, HarnessItem>;
  allowlist: Map<number, AllowlistRecord>;
  catalog: Map<number, CatalogCacheRecord>;
  audit: MemoryAudit;
  apiKeyRepo: MemoryApiKeyRepo & { getMeta(): Promise<import('@/contracts').ApiKeyMeta> };
  previewTokens: PreviewTokenServiceInstance;
  /**
   * K7 — zdieľaný denný rozpočet ANONYMNÝCH čítaní shopu, v pamäti. Testy si
   * ho vedia dopredu „vyčerpať" (`reserve(n)`) a potom overiť, že route shop
   * nezavolala. Bez neho by `resolveRoutesDeps()` spadol na produkčný
   * repozitár nad MariaDB, ktorá v týchto testoch neexistuje.
   */
  readBudget: ReadBudget;
  /** Koľko dotazov na posledné vlastné zápisy route spravila (I11, N+1). */
  lastOwnWriteCalls: { single: number; batch: number };
  seedCampaign(
    campaign: CampaignRecord,
    items: Array<{
      productId: number;
      priceAtPreview: MoneyString | null;
      status?: CampaignItemRecord['status'];
      /** K3 — keď chýba, použije sa hlavičkové percento kampane. */
      percent?: number;
    }>,
  ): CampaignRecord;
  seedAllowlist(productIds: number[]): void;
}

export interface RoutesWorldOptions {
  shopBaseUrl: string;
  allowlistIds?: number[];
  apiKey?: string | null;
  flags?: Partial<ExecutorFlags>;
  /** K2 — denný strop zápisov pre testy fronty. Default 200 ako v produkcii. */
  dailyBudget?: number;
}

export function makeRoutesWorld(opts: RoutesWorldOptions): RoutesWorld {
  const campaigns = new Map<number, CampaignRecord>();
  const items = new Map<number, HarnessItem>();
  const allowlist = new Map<number, AllowlistRecord>();
  const catalog = new Map<number, CatalogCacheRecord>();
  const audit = createMemoryAudit();
  /** K3 — pásma zľavy per kampaň. */
  const tiers = new Map<number, CampaignTierRecord[]>();
  const settingsRepo = createMemorySettingsRepo({ shopDomain: 'https://mock.local' });
  let nextCampaignId = 1;
  let nextItemId = 1;

  const baseApiKeyRepo = createMemoryApiKeyRepo(opts.apiKey === undefined ? fakeApiKey() : opts.apiKey);
  const apiKeyRepo = Object.assign(baseApiKeyRepo, {
    async getMeta() {
      const present = baseApiKeyRepo.plaintext !== null;
      return {
        present,
        last4: present ? (baseApiKeyRepo.plaintext as string).slice(-4) : null,
        savedAt: present ? new Date() : null,
        expiresAt: present ? new Date(Date.now() + 48 * 3_600_000) : null,
        secondsLeft: present ? 48 * 3600 : null,
        verifyStatus: present ? ('valid' as const) : null,
        lastUsedAt: null,
      };
    },
  });

  const seedAllowlist = (productIds: number[]): void => {
    productIds.forEach((productId, i) => {
      allowlist.set(productId, {
        id: allowlist.size + 1,
        productId,
        slot: i + 1,
        label: `Šperk ${productId}`,
        shopStatus: 'ok',
        statusNote: null,
        addedAt: new Date(),
        removedAt: null,
      });
    });
  };
  seedAllowlist(opts.allowlistIds ?? [201, 202, 203]);

  const activeRecords = (): AllowlistRecord[] =>
    [...allowlist.values()].filter((r) => r.slot !== null).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

  const allowlistRepo = {
    async listActive() {
      return activeRecords().map((r) => ({ ...r }));
    },
    async areAllActive(productIds: number[]) {
      return (
        productIds.length > 0 &&
        productIds.every((id) => allowlist.get(id)?.slot != null)
      );
    },
    async addProduct(productId: number, label: string | null) {
      const active = activeRecords();
      if (active.some((r) => r.productId === productId)) {
        throw new CodedError('conflict', 'Produkt už v allowliste je.');
      }
      if (active.length >= 10) {
        throw new CodedError('allowlist_full', 'Allowlist má obsadených všetkých 10 slotov (I2).');
      }
      const usedSlots = new Set(active.map((r) => r.slot));
      let slot = 1;
      while (usedSlots.has(slot)) slot += 1;
      const record: AllowlistRecord = {
        id: allowlist.size + 1,
        productId,
        slot,
        label,
        shopStatus: 'unknown',
        statusNote: null,
        addedAt: new Date(),
        removedAt: null,
      };
      allowlist.set(productId, record);
      return { ...record };
    },
    async removeProduct(productId: number) {
      const record = allowlist.get(productId);
      if (!record || record.slot === null) return false;
      record.slot = null;
      record.removedAt = new Date();
      return true;
    },
    async markShopStatus(productId: number, status: AllowlistRecord['shopStatus'], note: string | null) {
      const record = allowlist.get(productId);
      if (record) {
        record.shopStatus = status;
        record.statusNote = note;
      }
    },
  };

  const catalogRepo = {
    async get(productId: number) {
      return catalog.get(productId) ?? null;
    },
    async getMany(productIds: number[]) {
      const out = new Map<number, CatalogCacheRecord>();
      for (const id of productIds) {
        const rec = catalog.get(id);
        if (rec) out.set(id, rec);
      }
      return out;
    },
    async upsert(record: Omit<CatalogCacheRecord, 'fetchedAt'> & { fetchedAt?: Date }) {
      catalog.set(record.productId, { ...record, fetchedAt: record.fetchedAt ?? new Date() });
    },
  };

  /* K7 — zdieľané počítadlo anonymných čítaní shopu v pamäti. Testy ho vedia
   * dopredu vyčerpať a overiť, že route potom shop nezavolá vôbec. */
  const readBudget = createReadBudget({ store: createMemoryReadBudgetStore(), lane: 'anon' });
  const readBudgetGate = {
    reserveShopReads: (count = 1) => readBudget.reserve(count),
    shopReadBudget: () => readBudget.status(),
  };

  /** I11 — koľkokrát sa route pýtala na posledný vlastný zápis a akým tvarom. */
  const lastOwnWriteCalls = { single: 0, batch: 0 };

  /** Posledný ÚSPEŠNÝ vlastný zápis produktu, alebo `null` (I11). */
  const ownWriteOf = (
    productId: number,
  ): { percent: number; from: string; to: string; at: Date; campaignId: number } | null => {
    const writes = [...items.values()]
      .filter((i) => i.productId === productId && i.status === 'ok' && i.finishedAt !== null)
      .sort((a, b) => (b.finishedAt as Date).getTime() - (a.finishedAt as Date).getTime());
    const latest = writes[0];
    if (!latest) return null;
    const campaign = campaigns.get(latest.campaignId);
    if (!campaign) return null;
    return {
      percent: campaign.percent,
      from: campaign.dateFrom,
      to: campaign.dateTo,
      at: latest.finishedAt as Date,
      campaignId: campaign.id,
    };
  };

  const listItems = (campaignId: number): HarnessItem[] =>
    [...items.values()]
      .filter((i) => i.campaignId === campaignId)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ ...i }));

  const campaignsRepo = {
    async create(input: CreateCampaignInput) {
      const id = nextCampaignId;
      nextCampaignId += 1;
      const record: CampaignRecord = {
        id,
        operationId: input.operationId,
        name: input.name,
        kind: input.kind,
        parentCampaignId: input.parentCampaignId ?? null,
        percent: input.percent,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        dateFromOriginal: null,
        mode: input.mode,
        status: input.status,
        statusReason: null,
        fireAt: input.fireAt ?? null,
        scheduledAt: input.scheduledAt ?? null,
        needsKeySince: null,
        claimedAt: null,
        startedAt: null,
        finishedAt: null,
        itemsTotal: 0,
        itemsOk: 0,
        itemsFailed: 0,
        itemsUncertain: 0,
        confirmedAt: input.confirmedAt ?? null,
        confirmPayloadHash: input.confirmPayloadHash ?? null,
        sudoAt: input.sudoAt ?? null,
        resultAckAt: null,
        createdBy: input.createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      campaigns.set(id, record);
      return { ...record };
    },
    async getById(id: number) {
      const record = campaigns.get(id);
      return record ? { ...record } : null;
    },
    async list(filter: CampaignListFilter) {
      const wanted =
        filter.status === undefined
          ? null
          : new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
      const rows = [...campaigns.values()]
        .filter((c) => wanted === null || wanted.has(c.status))
        .sort((a, b) => b.id - a.id)
        .map((c) => ({ ...c }));
      return paginate(rows, filter.page ?? 1, filter.perPage ?? 20);
    },
    async claim(id: number, allowedFrom: CampaignStatus[]) {
      const record = campaigns.get(id);
      if (!record || !allowedFrom.includes(record.status)) return false;
      record.status = 'running';
      record.claimedAt = new Date();
      return true;
    },
    async setStatus(id: number, status: CampaignStatus, patch: Partial<CampaignRecord> = {}) {
      const record = campaigns.get(id);
      if (!record) return;
      Object.assign(record, patch, { status, updatedAt: new Date() });
    },
    async findUnacked() {
      return [...campaigns.values()]
        .filter(
          (c) =>
            c.resultAckAt === null &&
            ['done', 'partial', 'failed', 'missed', 'lapsed'].includes(c.status),
        )
        .map((c) => ({ ...c }));
    },
    async ack(id: number) {
      const record = campaigns.get(id);
      if (record) record.resultAckAt = new Date();
    },
    async findPlannedForProduct(productId: number) {
      return [...campaigns.values()]
        .filter(
          (c) =>
            ['scheduled', 'needs_key', 'missed', 'running'].includes(c.status) &&
            listItems(c.id).some((i) => i.productId === productId),
        )
        .map((c) => ({ ...c }));
    },
    async findFutureOverlaps(productIds: number[], from: string, to: string) {
      const ids = new Set(productIds);
      return [...campaigns.values()]
        .filter(
          (c) =>
            ['scheduled', 'needs_key', 'missed'].includes(c.status) &&
            c.dateFrom <= to &&
            c.dateTo >= from &&
            listItems(c.id).some((i) => ids.has(i.productId)),
        )
        .map((c) => ({ ...c }));
    },
    async lastOwnWrite(productId: number) {
      lastOwnWriteCalls.single += 1;
      return ownWriteOf(productId);
    },
    /**
     * I11 — dávkový tvar, ktorý má produkčný repozitár. Fake ho MUSÍ mať:
     * inak by testy merali postupný fallback a N+1 v route by nikto nezachytil.
     */
    async lastOwnWrites(productIds: number[]) {
      lastOwnWriteCalls.batch += 1;
      const out = new Map<number, NonNullable<ReturnType<typeof ownWriteOf>>>();
      for (const productId of new Set(productIds)) {
        const found = ownWriteOf(productId);
        if (found !== null) out.set(productId, found);
      }
      return out;
    },
  };

  const campaignItemsRepo = {
    async createMany(
      campaignId: number,
      newItems: Array<{
        productId: number;
        position: number;
        /**
         * K3 — percento je vlastnosť POLOŽKY a rozhoduje sa pri potvrdení.
         * Fake ho MUSÍ prenášať: bez neho executor v `assertConfirmed()`
         * nedopočíta hash (K4) a každý zápis by skončil na
         * `confirmation_required`. Presne to sa stalo, kým tu chýbalo.
         */
        percent: number;
        priceAtPreview: MoneyString | null;
        hasAttributes: boolean;
      }>,
    ) {
      for (const seed of newItems) {
        const id = nextItemId;
        nextItemId += 1;
        items.set(id, {
          id,
          campaignId,
          productId: seed.productId,
          percent: seed.percent,
          position: seed.position,
          status: 'pending',
          attemptCount: 0,
          nameAtWrite: null,
          priceAtPreview: seed.priceAtPreview,
          priceAtWrite: null,
          priceMismatch: false,
          hasAttributes: seed.hasAttributes,
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
      }
      const campaign = campaigns.get(campaignId);
      if (campaign) campaign.itemsTotal = newItems.length;
    },
    async listByCampaign(campaignId: number) {
      return listItems(campaignId);
    },
    /*
     * `listPage` a `countByCampaign` tu MUSIA byť, aj keď ich väčšina testov
     * nepotrebuje. `GET /api/campaigns/[id]` má dve cesty: dávkovú, keď ich
     * repozitár má, a záložnú `listByCampaign().slice()`, keď nie. Kým tento
     * fake obe metódy nemal, tiekli VŠETKY testy detailu záložnou cestou a
     * produkčnú nespustil nikto — takže sa v nej mohla schovať chyba, ktorú by
     * zelený balík nikdy neukázal (nález K5, 25. 8. 2026).
     */
    async listPage(campaignId: number, limit: number, offset: number) {
      return listItems(campaignId).slice(offset, offset + limit);
    },
    async countByCampaign(campaignId: number) {
      return listItems(campaignId).length;
    },
    async update(id: number, patch: Partial<CampaignItemRecord>) {
      const record = items.get(id);
      if (!record) throw new Error(`campaign item ${id} neexistuje`);
      Object.assign(record, patch);
    },
    async markRemaining(
      campaignId: number,
      fromPosition: number,
      status: CampaignItemRecord['status'],
      reason: string,
    ) {
      for (const item of items.values()) {
        if (item.campaignId === campaignId && item.position >= fromPosition && item.status === 'pending') {
          item.status = status;
          item.errorMessage = reason;
          item.finishedAt = new Date();
        }
      }
    },
  };

  /* AuditRepo len na čítanie — nad záznamami z `MemoryAudit`. */
  const toAuditRecord = (input: AuditInput, id: number): AuditRecord => ({
    id,
    ts: new Date(),
    actor: input.actor,
    userId: input.userId ?? null,
    eventType: input.eventType,
    ok: input.ok ?? null,
    campaignId: input.campaignId ?? null,
    campaignItemId: input.campaignItemId ?? null,
    productId: input.productId ?? null,
    operationId: input.operationId ?? null,
    requestId: input.requestId ?? null,
    httpStatus: input.httpStatus ?? null,
    beforeSnapshot: input.beforeSnapshot ?? null,
    afterSnapshot: input.afterSnapshot ?? null,
    message: input.message ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  const auditRepo = {
    async list(filter: AuditFilter) {
      const rows = audit.records
        .map((r, i) => toAuditRecord(r, i + 1))
        .filter(
          (r) =>
            (filter.campaignId === undefined || r.campaignId === filter.campaignId) &&
            (filter.productId === undefined || r.productId === filter.productId) &&
            (filter.eventType === undefined || r.eventType === filter.eventType) &&
            (filter.ok === undefined || r.ok === filter.ok),
        )
        .reverse();
      return paginate(rows, filter.page ?? 1, filter.perPage ?? 20);
    },
    async getById(id: number) {
      const input = audit.records[id - 1];
      return input === undefined ? null : toAuditRecord(input, id);
    },
    countWritesInLastHour: audit.countWritesInLastHour,
  };

  const previewTokens = createPreviewTokenService({
    secret: Buffer.from('routes-a12-test-secret-32bytes!!', 'utf8'),
  });

  const shopClient = createShopClient({
    baseUrl: () => opts.shopBaseUrl,
    version: '0.1.0-test',
    readTimeoutMs: 2000,
    writeTimeoutMs: 2000,
    policy: { maxAttempts: 3, backoffMs: [5, 5, 5], retryAfterCapSeconds: 1 },
  });

  const flags: ExecutorFlags = {
    nodeEnv: 'production',
    writesEnabled: true,
    maxProductsPerOperation: 10,
    runawayLimitPerHour: 60,
    writePauseMs: 5,
    ...(opts.flags ?? {}),
  };

  const deps: RoutesDeps = {
    campaignsRepo,
    campaignItemsRepo,
    allowlistRepo,
    catalogRepo,
    readBudget: readBudgetGate,
    auditRepo,
    settingsRepo,
    apiKeyRepo,
    audit,
    // K3 — pásma nad in-memory mapou. Bez toho by `GET /api/campaigns` aj
    // detail siahli na produkčný `tiersRepo` v DB, ktorá v teste neexistuje,
    // a čítanie by viselo až do timeoutu testu.
    tiersRepo: {
      async createMany(campaignId, rows) {
        tiers.set(campaignId, [
          ...(tiers.get(campaignId) ?? []),
          ...rows.map((row, index) => ({
            id: (tiers.get(campaignId)?.length ?? 0) + index + 1,
            campaignId,
            createdAt: new Date(),
            rule: null,
            itemsCount: 0,
            ...row,
          })),
        ]);
      },
      async listByCampaign(campaignId) {
        return [...(tiers.get(campaignId) ?? [])];
      },
    },
    // K2 — rozpočet zápisov nad IN-MEMORY auditom. Bez neho by `createBudget()`
    // spadol na produkčné počítadlo nad `audit_log` v DB, ktorá v teste
    // neexistuje: čítanie by viselo až do stropu a route by (správne,
    // fail-closed) vrátila kampaň do fronty namiesto zápisu.
    budget: createBudget({
      counter: {
        async countWriteAttemptsOn() {
          return audit.byEvent('write_attempt').length;
        },
      },
      dailyBudget: opts.dailyBudget ?? 200,
    }),
    previewTokens,
    shopClient,
    mutex: createWriteMutex({ dbLock: null }),
    executorFlags: flags,
    timeZone: 'Europe/Bratislava',
    fireTime: '00:05',
  };

  return {
    deps,
    campaigns,
    items,
    allowlist,
    catalog,
    audit,
    apiKeyRepo,
    previewTokens,
    readBudget,
    lastOwnWriteCalls,
    seedCampaign(campaign, seedItems) {
      const record: CampaignRecord = { ...campaign, id: nextCampaignId };
      nextCampaignId += 1;
      campaigns.set(record.id, record);
      [...seedItems]
        .sort((a, b) => a.productId - b.productId)
        .forEach((seed, index) => {
          const id = nextItemId;
          nextItemId += 1;
          items.set(id, {
            id,
            campaignId: record.id,
            productId: seed.productId,
            // K3 — bez percenta na položke sa hash potvrdenia nedá prepočítať.
            percent: seed.percent ?? record.percent,
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
      record.itemsTotal = seedItems.length;
      return record;
    },
    seedAllowlist,
  };
}

/** Kalendárny deň posunutý o `offset` dní od dnes (UTC — testy bežia cez deň). */
export const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
