/**
 * Aura Zľavy — runaway strop (V5; D79, I12, KONTRAKT V3 K2).
 *
 * Zápis nad stropom NESMIE prebehnúť: zápisy sa fail-closed zamknú
 * (`settings.writes_locked`), zapíše sa audit `writes_locked` a zvyšok dávky
 * skončí `blocked`. Odomknúť ich možno len manuálne.
 *
 * Prečo sa tvrdenie prepísalo (nie oslabilo): D79 malo fixných 60/h, K2 hovorí
 * `daily_write_budget + 20 %` s podlahou 60/h — pri 200 zápisoch na deň by
 * 60/h zamklo zápisy počas úplne normálnej prevádzky. Testy preto stoja na
 * rozpočte, ktorý strop určuje, nie na konštante, ktorá už neplatí. Sila
 * tvrdenia je rovnaká: na strope sa zamyká, pod ním nie.
 */
import { describe, expect, it } from 'vitest';

import type { CampaignRecord } from '@/contracts';

import { computePayloadHash } from '@/lib/crypto/preview-token';
import { createExecutor, type ExecutorFlags } from '@/lib/engine/executor';
import { createWriteMutex } from '@/lib/engine/mutex';
import {
  createMemoryAllowlistRepo,
  createMemoryApiKeyRepo,
  createMemoryAudit,
  createMemoryCampaignWorld,
  createMemorySettingsRepo,
  type MemoryAudit,
  type MemorySettingsRepo,
} from '@/lib/engine/testing';
import { createShopClient } from '@/lib/shop/client';

import { useMockShop, VALID_API_KEY } from '../helpers/mock';
import { makeCampaign } from '../helpers/factories';

const mock = useMockShop();

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * K2: strop = `max(podlaha 60/h, rozpočet + 20 %)`. Rozpočet 50/deň dáva
 * `ceil(60) = 60`, takže tieto testy hovoria o tom istom čísle ako predtým —
 * len ho odvodzujú z kontraktu, nie z konštanty.
 */
const FLAGS: ExecutorFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
  dailyWriteBudget: 50,
  writePauseMs: 5,
};

/** Rozpočet, ktorý sa v tomto teste nikdy neminie — brzdí runaway, nie K2. */
const roomyBudget = {
  async spentToday() {
    return 0;
  },
  async remainingToday() {
    return { day: '2026-08-10', budget: 50, spent: 0, remaining: 50, exhausted: false };
  },
};

function makeWorld(opts: { productIds: number[]; seededWrites: number }) {
  mock.state.setProducts(
    opts.productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 9.9, has_attributes: false })),
  );
  const from = day(1);
  const to = day(5);
  const world = createMemoryCampaignWorld();
  const settingsRepo: MemorySettingsRepo = createMemorySettingsRepo();
  const audit: MemoryAudit = createMemoryAudit();
  audit.seedWrites(opts.seededWrites);

  const campaign: CampaignRecord = {
    ...makeCampaign({ productIds: opts.productIds, percent: 10, status: 'scheduled' }),
    dateFrom: from,
    dateTo: to,
    confirmedAt: new Date(),
    sudoAt: new Date(),
    // K4 — hash nad trojicami `id:percent:price` zo skutočných položiek.
    confirmPayloadHash: computePayloadHash({
      kind: 'new',
      from,
      to,
      items: opts.productIds.map((productId) => ({
        productId,
        percent: 10,
        priceAtPreview: '9.90' as const,
      })),
    }),
  };
  world.seedCampaign(
    campaign,
    opts.productIds.map((productId) => ({ productId, priceAtPreview: '9.90' })),
  );
  // K3 — percento je na položke; `createMemoryCampaignWorld()` (A9) ho neseje.
  for (const item of world.campaignItemsRepo.items.values()) {
    Object.assign(item, { percent: 10 });
  }

  const executor = createExecutor({
    shopClient: createShopClient({
      baseUrl: () => mock.baseUrl,
      version: '0.1.0-test',
      readTimeoutMs: 2000,
      writeTimeoutMs: 2000,
    }),
    campaignsRepo: world.campaignsRepo,
    campaignItemsRepo: world.campaignItemsRepo,
    allowlistRepo: createMemoryAllowlistRepo(opts.productIds),
    settingsRepo,
    auditRepo: audit,
    apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
    audit,
    mutex: createWriteMutex({ dbLock: null }),
    budget: roomyBudget,
    flags: FLAGS,
  });

  return { executor, world, settingsRepo, audit };
}

describe('D79 + K2 — runaway strop 60/h pri rozpočte 50/deň', () => {
  it('60 zápisov v hodine → nová dávka sa vôbec nezačne a zápisy sa zamknú', async () => {
    const { executor, settingsRepo, audit } = makeWorld({
      productIds: [401, 402],
      seededWrites: 60,
    });

    await expect(executor.executeCampaign(1)).rejects.toMatchObject({
      code: 'runaway_limit',
    });
    expect(settingsRepo.record.writesLocked).toBe(true);
    expect(audit.byEvent('writes_locked')).toHaveLength(1);
    expect(mock.state.requestCount).toBe(0); // fail-closed PRED shopom
  });

  it('61. zápis v hodine zamkne zápisy uprostred dávky, zvyšok je blocked', async () => {
    // 59 historických + 1. položka dávky = 60 → pred 2. položkou strop platí.
    const { executor, world, settingsRepo, audit } = makeWorld({
      productIds: [401, 402, 403],
      seededWrites: 59,
    });

    const result = await executor.executeCampaign(1);

    expect(mock.state.writeRequests()).toHaveLength(1); // len 60. zápis
    const items = await world.campaignItemsRepo.listByCampaign(1);
    expect(items.map((i) => i.status)).toEqual(['ok', 'blocked', 'blocked']);
    expect(result.status).toBe('partial');
    expect(settingsRepo.record.writesLocked).toBe(true);
    expect(settingsRepo.record.writesLockedReason).toContain('runaway');
    expect(audit.byEvent('writes_locked')).toHaveLength(1);
  });

  it('zamknuté zápisy odmietnu aj ďalšiu dávku, kým ich nikto neodomkne', async () => {
    const { executor, settingsRepo } = makeWorld({ productIds: [401], seededWrites: 0 });
    await settingsRepo.lockWrites('manuálny test');

    await expect(executor.executeCampaign(1)).rejects.toMatchObject({
      code: 'writes_locked',
    });
    expect(mock.state.requestCount).toBe(0);

    // Manuálne odomknutie (D79) → dávka prejde.
    await settingsRepo.unlockWrites();
    const result = await executor.executeCampaign(1);
    expect(result.status).toBe('done');
  });
});
