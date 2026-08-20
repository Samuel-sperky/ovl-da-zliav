/**
 * Aura Zľavy — PRODUKČNÝ wiring schedulera (E1; D82, D84, §9; KONTRAKT V3 K2, K7).
 *
 * Stráži nález E1: `boot.ts` kedysi pripájal executor dynamickým importom
 * s `webpackIgnore` na `@/` alias (v standalone Node builde vždy zlyhal →
 * executor `null` → každý automatický fire skončil fail-closed v `needs_key`
 * a NIKDY nič nezapísal) a navyše cez cast na nekompatibilnú signatúru
 * (`executeCampaign(campaignId, deps, opts)` vs `(campaign, key, ctx)`).
 * Integračné testy s FAKE executorom to nezachytili — preto tento súbor fake
 * executor nepoužíva vôbec.
 *
 * Všetky tri cesty tu bežia na PRODUKČNÝCH adaptéroch z `boot.ts`
 * a proti reálnemu mock shopu (I6):
 *   1. `createSchedulerExecutor()`      — fire naplánovanej kampane (D32),
 *   2. `createSchedulerQueueExecutor()` — kampaň z fronty (K2),
 *   3. `syncCatalog()`                  — synchronizácia katalógu (K7),
 *      vrátane dôkazu, že NEKONZUMUJE zápisový rozpočet.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  ApiKeyMeta,
  CampaignRecord,
  CampaignStatus,
  CanaryResult,
  SecretRef,
} from '@/contracts';

import { computePayloadHash } from '@/lib/crypto/preview-token';
import { createBudget, type WriteAttemptCounter } from '@/lib/engine/budget';
import { createWriteMutex } from '@/lib/engine/mutex';
import {
  createMemoryAllowlistRepo,
  createMemoryApiKeyRepo,
  createMemoryAudit,
  createMemoryCampaignWorld,
  createMemorySettingsRepo,
} from '@/lib/engine/testing';
import { createLogger } from '@/lib/log/logger';
import { createSchedulerExecutor, createSchedulerQueueExecutor } from '@/lib/scheduler/boot';
import { processDue } from '@/lib/scheduler/due';
import { resetQueueGate } from '@/lib/scheduler/pause';
import { processQueue, resetQueueReport } from '@/lib/scheduler/queue';
import type { CampaignStatusV3, SchedulerCampaign } from '@/lib/scheduler/types';
import { createShopClient } from '@/lib/shop/client';
import { syncCatalog, type CatalogSyncSink } from '@/lib/shop/catalog-sync';
import type { CatalogUpsertInput } from '@/lib/repo/catalog.repo';

import { fakeSecretRef, makeCampaign } from '../helpers/factories';
import { useMockShop, VALID_API_KEY } from '../helpers/mock';

const mock = useMockShop();

/** Deň v logickej zóne (Europe/Bratislava) — nie UTC, aby test neflakoval večer. */
const zonedDay = (offset: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

/**
 * In-memory repozitár engine pozná len stavy z `src/contracts.ts` (bez
 * `queued`). Filter je typový most, nie cast: kampaň v pamäti nikdy nie je
 * v stave, ktorý by fake nepoznal.
 */
const withoutQueued = (statuses: CampaignStatusV3[]): CampaignStatus[] =>
  statuses.filter((status): status is CampaignStatus => status !== 'queued');

const logger = createLogger({ module: 'scheduler-wiring-test' });

const keyMetaValid = (now: Date): ApiKeyMeta => ({
  present: true,
  last4: '0001',
  savedAt: now,
  expiresAt: new Date(now.getTime() + 3_600_000),
  secondsLeft: 3600,
  verifyStatus: 'valid',
  lastUsedAt: null,
});

beforeEach(() => {
  // Brána fronty aj posledný report sú in-process stav — testy si ho nesmú
  // podávať medzi sebou.
  resetQueueGate();
  resetQueueReport();
});

describe('E1 — createSchedulerExecutor: produkčný wiring due → engine → shop', () => {
  it('scheduled kampaň s platným kľúčom skončí done a mock dostane write requesty', async () => {
    const productIds = [201, 202, 203];
    const percent = 15;
    const from = zonedDay(0);
    const to = zonedDay(10);

    mock.state.setProducts(
      productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
    );

    /* Svet engine — in-memory repozitáre, ale REÁLNY executor a klient. */
    const world = createMemoryCampaignWorld();
    const audit = createMemoryAudit();
    const settingsRepo = createMemorySettingsRepo();
    const now = new Date();

    const campaign: CampaignRecord = {
      ...makeCampaign({ productIds, percent, status: 'scheduled' }),
      dateFrom: from,
      dateTo: to,
      fireAt: new Date(now.getTime() - 60_000),
      confirmedAt: now,
      sudoAt: now,
      // K4 — hash je nad trojicami `id:percent:price_at_preview` zo skutočných
      // položiek, nie nad hlavičkovým percentom kampane (K3).
      confirmPayloadHash: computePayloadHash({
        kind: 'new',
        from,
        to,
        items: productIds.map((productId) => ({
          productId,
          percent,
          priceAtPreview: '19.99',
        })),
      }),
    };
    world.seedCampaign(
      campaign,
      productIds.map((productId) => ({ productId, priceAtPreview: '19.99' })),
    );
    // K3 — percento zápisu je na POLOŽKE, nie na hlavičke kampane. Executor ho
    // z hlavičky NIKDY nedopočíta, takže položka bez percenta sa nezapíše.
    // `createMemoryCampaignWorld()` (A9) percento zatiaľ neseje.
    for (const item of world.campaignItemsRepo.items.values()) {
      Object.assign(item, { percent });
    }

    /* PRODUKČNÝ adaptér z boot.ts — žiadny fake executor. */
    const executor = createSchedulerExecutor({
      shopClient: createShopClient({
        baseUrl: () => mock.baseUrl,
        version: '0.1.0-test',
        readTimeoutMs: 2000,
        writeTimeoutMs: 2000,
        policy: { maxAttempts: 3, backoffMs: [5, 5, 5], retryAfterCapSeconds: 1 },
      }),
      campaignsRepo: world.campaignsRepo,
      campaignItemsRepo: world.campaignItemsRepo,
      allowlistRepo: createMemoryAllowlistRepo(productIds),
      settingsRepo,
      auditRepo: audit,
      // K2 — bez in-memory počítadla by rozpočet siahol na produkčný audit
      // v DB, ktorá v teste neexistuje. Executor by potom (správne, fail-closed)
      // vrátil kampaň do fronty a tento test by nikdy nedokázal to, načo je:
      // že produkčný wiring naozaj DOJDE k zápisu.
      writeAttemptCounter: {
        async countWriteAttemptsOn() {
          return audit.byEvent('write_attempt').length;
        },
      },
      apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
      audit,
      mutex: createWriteMutex({ dbLock: null }),
      flags: {
        nodeEnv: 'production',
        writesEnabled: true,
        maxProductsPerOperation: 10,
        runawayLimitPerHour: 60,
        writePauseMs: 1,
      },
      sleepFn: async () => undefined,
    });

    const outcome = await processDue(
      {
        campaigns: {
          async findDue() {
            const found = await world.campaignsRepo.getById(campaign.id);
            return found !== null && found.status === 'scheduled' ? [found] : [];
          },
          claim: (id, allowedFrom) =>
            world.campaignsRepo.claim(id, withoutQueued(allowedFrom)),
          setStatus: (id, status, patch) =>
            world.campaignsRepo.setStatus(id, withoutQueued([status])[0] ?? 'failed', patch),
        },
        apiKey: {
          async getMeta() {
            return keyMetaValid(now);
          },
          async loadForUse(): Promise<SecretRef | null> {
            return fakeSecretRef(VALID_API_KEY);
          },
        },
        settings: settingsRepo,
        audit,
        canary: async (): Promise<CanaryResult> => ({
          ok: true,
          total: productIds.length,
          latencyMs: 1,
          httpStatus: 200,
        }),
        executor,
        log: logger,
      },
      { writesEnabledByEnv: true, timeZone: 'Europe/Bratislava', midnightFreezeSeconds: 60 },
      now,
    );

    expect(outcome.fired).toBe(1);
    expect(outcome.needsKey).toBe(0);

    const finished = await world.campaignsRepo.getById(campaign.id);
    expect(finished?.status).toBe('done');

    // Mock shop skutočne dostal sekvenčné zápisy (I10) — jadro nálezu E1:
    // starý wiring nikdy nezapísal ani jeden request.
    const writtenIds = mock.state.writeRequests().map((r) => r.body.id);
    expect(writtenIds).toEqual(productIds.map(String));
    expect(audit.byEvent('write_ok')).toHaveLength(productIds.length);
    expect(audit.byEvent('campaign_finished')).toHaveLength(1);
  });
});

describe('K2 — createSchedulerQueueExecutor: produkčný wiring fronta → engine → shop', () => {
  const productIds = [301, 302, 303, 304];
  const percent = 20;

  function makeQueueWorld(dailyBudget: number) {
    const from = zonedDay(0);
    const to = zonedDay(20);

    mock.state.setProducts(
      productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 29.9, has_attributes: false })),
    );

    const world = createMemoryCampaignWorld();
    const audit = createMemoryAudit();
    const settingsRepo = createMemorySettingsRepo();
    const now = new Date();

    const campaign: CampaignRecord = {
      ...makeCampaign({ productIds, percent, status: 'scheduled' }),
      dateFrom: from,
      dateTo: to,
      confirmedAt: now,
      sudoAt: now,
      confirmPayloadHash: computePayloadHash({
        kind: 'new',
        from,
        to,
        items: productIds.map((productId) => ({
          productId,
          percent,
          priceAtPreview: '29.90',
        })),
      }),
    };
    world.seedCampaign(
      campaign,
      productIds.map((productId) => ({ productId, priceAtPreview: '29.90' })),
    );
    for (const item of world.campaignItemsRepo.items.values()) {
      Object.assign(item, { percent });
    }
    // Stav `queued` (K2) `src/contracts.ts` ešte nepozná, preto sa nastavuje
    // takto — rovnako, ako V5 dopĺňa `percent` na položku. V DB je to riadny
    // ENUM z migrácie `0010_fronta_a_pasma.sql`.
    const seeded = world.campaignsRepo.campaigns.get(campaign.id);
    Object.assign(seeded ?? {}, { status: 'queued' });

    /** K2 — spotreba rozpočtu sa počíta z auditu, nie z premennej v teste. */
    const counter: WriteAttemptCounter = {
      async countWriteAttemptsOn() {
        return audit.byEvent('write_attempt').length;
      },
    };

    const queueExecutor = createSchedulerQueueExecutor({
      shopClient: createShopClient({
        baseUrl: () => mock.baseUrl,
        version: '0.1.0-test',
        readTimeoutMs: 2000,
        writeTimeoutMs: 2000,
      }),
      campaignsRepo: world.campaignsRepo,
      campaignItemsRepo: world.campaignItemsRepo,
      allowlistRepo: createMemoryAllowlistRepo(productIds),
      settingsRepo,
      auditRepo: audit,
      writeAttemptCounter: counter,
      apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
      audit,
      mutex: createWriteMutex({ dbLock: null }),
      flags: {
        nodeEnv: 'production',
        writesEnabled: true,
        maxProductsPerOperation: productIds.length,
        runawayLimitPerHour: 60,
        dailyWriteBudget: dailyBudget,
        writePauseMs: 0,
      },
      // Pauza ≥ 3 s je injektovaná závislosť — inak by test bežal minúty.
      sleepFn: async () => undefined,
    });

    const queueDeps = {
      campaigns: {
        async findQueued(): Promise<SchedulerCampaign[]> {
          const found = await world.campaignsRepo.getById(campaign.id);
          const status: string = found === null ? '' : found.status;
          return found !== null && status === 'queued' ? [{ ...found, status: 'queued' }] : [];
        },
        async findLateCandidates(): Promise<SchedulerCampaign[]> {
          return [];
        },
        async markLate(): Promise<boolean> {
          return false;
        },
        setStatus: (id: number, status: CampaignStatusV3) =>
          world.campaignsRepo.setStatus(id, withoutQueued([status])[0] ?? 'failed'),
      },
      apiKey: {
        async getMeta() {
          return keyMetaValid(now);
        },
      },
      settings: settingsRepo,
      budget: createBudget({ counter, dailyBudget }),
      audit,
      executor: queueExecutor,
      log: logger,
    };

    const config = {
      writesEnabledByEnv: true,
      timeZone: 'Europe/Bratislava',
      maxCampaignsPerTick: 10,
    };

    return { world, audit, queueDeps, config, now };
  }

  it('queued kampaň prejde produkčným executorom a mock dostane všetky zápisy', async () => {
    // Rozpočet s rezervou, aby sa dal odlíšiť „dobehla" od „minula rozpočet".
    const { world, audit, queueDeps, config, now } = makeQueueWorld(productIds.length + 1);

    const outcome = await processQueue(queueDeps, config, now);

    expect(outcome.skipped).toBeNull();
    expect(outcome.processed).toBe(1);
    expect(outcome.paused).toBe(false);

    const finished = await world.campaignsRepo.getById(1);
    expect(finished?.status).toBe('done');

    // Jadro dôkazu: fronta naozaj zapísala do (mock) shopu, sekvenčne a raz.
    const writtenIds = mock.state.writeRequests().map((r) => r.body.id);
    expect(writtenIds).toEqual(productIds.map(String));
    expect(audit.byEvent('write_ok')).toHaveLength(productIds.length);
  });

  it('rozpočet na 2 zápisy vráti kampaň do fronty a druhý beh ju dopíše (K2)', async () => {
    const { world, queueDeps, config, now } = makeQueueWorld(2);

    const first = await processQueue(queueDeps, config, now);
    expect(first.processed).toBe(1);
    // Rozpočet je po dvoch zápisoch minutý — nie je to chyba, je to informácia.
    expect(first.skipped).toBe('budget_exhausted');
    expect(mock.state.writeRequests()).toHaveLength(2);

    const midway = await world.campaignsRepo.getById(1);
    const midwayStatus: string = midway === null ? '' : midway.status;
    expect(midwayStatus).toBe('queued');

    // Druhý beh v tom istom dni nesmie zapísať nič navyše — rozpočet drží.
    const blocked = await processQueue(queueDeps, config, now);
    expect(blocked.skipped).toBe('budget_exhausted');
    expect(blocked.processed).toBe(0);
    expect(mock.state.writeRequests()).toHaveLength(2);
  });
});

describe('K7 — synchronizácia katalógu nad produkčným shop klientom', () => {
  it('stránkuje celý katalóg, zapíše ho a NEKONZUMUJE zápisový rozpočet', async () => {
    const products = Array.from({ length: 23 }, (_, index) => ({
      id: 1000 + index,
      name: `Šperk ${1000 + index}`,
      price: 10 + index,
      has_attributes: false,
    }));
    mock.state.setProducts(products);
    // Mock si medzi testami drží produkty z predchádzajúcich blokov (`reset()`
    // maže scenáre, nie katalóg). Sync má zrkadliť CELÝ katalóg shopu, takže
    // očakávanie sa počíta z toho, čo shop naozaj má — nie z 23 kusov.
    const allInShop = mock.state.listProducts();
    const perPage = 5;

    const rows = new Map<number, CatalogUpsertInput>();
    const sink: CatalogSyncSink = {
      async upsertMany(records) {
        for (const record of records) rows.set(record.productId, record);
        return records.length;
      },
    };
    const audit = createMemoryAudit();

    const result = await syncCatalog({
      shopClient: createShopClient({
        baseUrl: () => mock.baseUrl,
        version: '0.1.0-test',
        readTimeoutMs: 2000,
      }),
      catalog: sink,
      audit,
      logger,
      perPage,
      pausePerPageMs: 0,
    });

    expect(result.outcome).toBe('ok');
    expect(result.error).toBeNull();
    expect(result.pages).toBe(Math.ceil(allInShop.length / perPage));
    expect(result.products).toBe(allInShop.length);
    expect(result.total).toBe(allInShop.length);
    // Zrkadlo katalógu: v DB skončí KAŽDÝ produkt, ktorý shop vrátil.
    expect(rows.size).toBe(allInShop.length);
    for (const product of products) expect(rows.has(product.id)).toBe(true);
    expect(rows.get(1000)?.name).toBe('Šperk 1000');
    // Cena ide do DECIMAL(10,2) ako string — nikdy float (§2).
    expect(rows.get(1000)?.price).toBe('10.00');
    expect(rows.get(1000)?.shopStatus).toBe('ok');

    // K7 — synchronizácia je ČÍTANIE: ani jeden zápis do shopu a ani jeden
    // `write_attempt`, ktorý by ukradol rozpočet fronte (K2).
    expect(mock.state.writeRequests()).toHaveLength(0);
    expect(audit.byEvent('write_attempt')).toHaveLength(0);
    expect(audit.byEvent('catalog_refreshed')).toHaveLength(1);

    // I1 — kľúč sa pri čítaní vôbec nezostavuje.
    expect(mock.state.seenApiKeys()).toHaveLength(0);
  });
});
