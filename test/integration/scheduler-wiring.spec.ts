/**
 * Aura Zľavy — produkčný wiring scheduler → engine (E1; D82, D84, §9).
 *
 * Stráži nález E1: `boot.ts` kedysi pripájal executor dynamickým importom
 * s `webpackIgnore` na `@/` alias (v standalone Node builde vždy zlyhal →
 * executor `null` → každý automatický fire skončil fail-closed v `needs_key`
 * a NIKDY nič nezapísal) a navyše cez cast na nekompatibilnú signatúru
 * (`executeCampaign(campaignId, deps, opts)` vs `(campaign, key, ctx)`).
 *
 * Test preto NEPOUŽÍVA fake executor: `processDue` dostane presne ten adaptér,
 * ktorý si stavia produkčný boot (`createSchedulerExecutor`), so skutočným
 * `executeCampaign` a skutočným shop klientom proti mock shopu (I6). Scheduled
 * kampaň s platným kľúčom musí skončiť `done` a mock musí dostať zápisy.
 */
import { describe, expect, it } from 'vitest';

import type { ApiKeyMeta, CampaignRecord, CanaryResult, SecretRef } from '@/contracts';

import { computePayloadHash } from '@/lib/crypto/preview-token';
import { createWriteMutex } from '@/lib/engine/mutex';
import {
  createMemoryAllowlistRepo,
  createMemoryApiKeyRepo,
  createMemoryAudit,
  createMemoryCampaignWorld,
  createMemorySettingsRepo,
} from '@/lib/engine/testing';
import { createLogger } from '@/lib/log/logger';
import { createSchedulerExecutor } from '@/lib/scheduler/boot';
import { processDue } from '@/lib/scheduler/due';
import { createShopClient } from '@/lib/shop/client';

import { fakeSecretRef, makeCampaign } from '../helpers/factories';
import { useMockShop, VALID_API_KEY } from '../helpers/mock';

const mock = useMockShop();

/** Deň v logickej zóne (Europe/Bratislava) — nie UTC, aby test neflakoval večer. */
const zonedDay = (offset: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

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
      confirmPayloadHash: computePayloadHash({ kind: 'new', productIds, percent, from, to }),
    };
    world.seedCampaign(
      campaign,
      productIds.map((productId) => ({ productId, priceAtPreview: '19.99' })),
    );

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
    });

    const keyMeta: ApiKeyMeta = {
      present: true,
      last4: '0001',
      savedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      secondsLeft: 3600,
      verifyStatus: 'valid',
      lastUsedAt: null,
    };

    const outcome = await processDue(
      {
        campaigns: {
          async findDue() {
            const found = await world.campaignsRepo.getById(campaign.id);
            return found !== null && found.status === 'scheduled' ? [found] : [];
          },
          claim: (id, allowedFrom) => world.campaignsRepo.claim(id, allowedFrom),
          setStatus: (id, status, patch) => world.campaignsRepo.setStatus(id, status, patch),
        },
        apiKey: {
          async getMeta() {
            return keyMeta;
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
        log: createLogger({ module: 'scheduler-wiring-test' }),
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
