/**
 * Aura Zľavy — sekvenčný determinizmus zápisu (V5; I10, D46, KONTRAKT V3 K2).
 *
 * Dávka 10 produktov MUSÍ ísť sériovo, NIKDY paralelne, a poradie je
 * deterministické podľa `position` (vzostupné product_id).
 *
 * Prečo sa tvrdenie o pauze prepísalo (nie oslabilo): D46 hovorilo 250 ms,
 * K2 hovorí **≥ 3 s** (shop dovolí 20 zápisov/min). Merať 9 skutočných
 * trojsekundových páuz by znamenalo 27 sekúnd čakania v jednom teste, takže
 * sa tu meria SEKVENČNOSŤ s injektovanou pauzou — a osobitne sa tvrdí, že
 * produkčná hodnota má podlahu `MIN_WRITE_PAUSE_MS`. Podlaha je jediné, čo
 * o rýchlosti rozhoduje; jej meranie stopkami by nič nedokázalo navyše.
 */
import { describe, expect, it } from 'vitest';

import type { CampaignRecord } from '@/contracts';

import { computePayloadHash } from '@/lib/crypto/preview-token';
import {
  MIN_WRITE_PAUSE_MS,
  createExecutor,
  executorFlagsFromEnv,
  type ExecutorFlags,
} from '@/lib/engine/executor';
import { createWriteMutex } from '@/lib/engine/mutex';
import {
  createMemoryAllowlistRepo,
  createMemoryApiKeyRepo,
  createMemoryAudit,
  createMemoryCampaignWorld,
  createMemorySettingsRepo,
} from '@/lib/engine/testing';
import { createShopClient } from '@/lib/shop/client';

import { useMockShop, VALID_API_KEY } from '../helpers/mock';
import { makeCampaign } from '../helpers/factories';

const mock = useMockShop();

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Injektovaná pauza — dosť veľká na zmeranie odstupu, dosť malá na CI. */
const PAUSE_MS = 60;
/** setTimeout smie vystreliť o ~1–2 ms skôr; meranie nechceme flakey. */
const TOLERANCE_MS = 15;

const FLAGS: ExecutorFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
  dailyWriteBudget: 200,
  writePauseMs: PAUSE_MS,
};

/** Rozpočet, ktorý sa v tomto teste nikdy neminie (K2). */
const roomyBudget = {
  async spentToday() {
    return 0;
  },
  async remainingToday() {
    return { day: '2026-08-10', budget: 200, spent: 0, remaining: 200, exhausted: false };
  },
};

describe('K2 — produkčná pauza medzi zápismi je ≥ 3 s (20/min)', () => {
  it('executorFlagsFromEnv() drží podlahu bez ohľadu na SHOP_WRITE_PAUSE_MS', () => {
    expect(MIN_WRITE_PAUSE_MS).toBe(3000);
    expect(executorFlagsFromEnv().writePauseMs).toBeGreaterThanOrEqual(MIN_WRITE_PAUSE_MS);
  });
});

describe('I10 — sekvenčné zápisy s pauzou medzi položkami', () => {
  it('10 produktov ide sériovo, v deterministickom poradí, s odstupom ≥ pauza', async () => {
    const productIds = Array.from({ length: 10 }, (_, i) => 301 + i);
    mock.state.setProducts(
      productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 12.5, has_attributes: false })),
    );

    const from = day(1);
    const to = day(10);
    const world = createMemoryCampaignWorld();
    const audit = createMemoryAudit();
    const campaign: CampaignRecord = {
      ...makeCampaign({ productIds, percent: 20, status: 'scheduled' }),
      dateFrom: from,
      dateTo: to,
      confirmedAt: new Date(),
      sudoAt: new Date(),
      // K4 — hash nad trojicami `id:percent:price` zo skutočných položiek.
      confirmPayloadHash: computePayloadHash({
        kind: 'new',
        from,
        to,
        items: productIds.map((productId) => ({
          productId,
          percent: 20,
          priceAtPreview: '12.50' as const,
        })),
      }),
    };
    // Položky sa seedujú v zamiešanom poradí — poradie zápisu určuje `position`.
    world.seedCampaign(
      campaign,
      [...productIds].reverse().map((productId) => ({ productId, priceAtPreview: '12.50' })),
    );
    // K3 — percento je na položke; `createMemoryCampaignWorld()` (A9) ho neseje.
    for (const item of world.campaignItemsRepo.items.values()) {
      Object.assign(item, { percent: 20 });
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
      allowlistRepo: createMemoryAllowlistRepo(productIds),
      settingsRepo: createMemorySettingsRepo(),
      auditRepo: audit,
      apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
      audit,
      mutex: createWriteMutex({ dbLock: null }),
      budget: roomyBudget,
      flags: FLAGS,
    });

    const result = await executor.executeCampaign(campaign.id);
    expect(result.status).toBe('done');

    const writes = mock.state.writeRequests();
    expect(writes).toHaveLength(10);

    // Deterministické poradie (I10): vzostupné product_id = position 1…10.
    expect(writes.map((w) => Number(w.body.id))).toEqual(productIds);

    // Sériovo s pauzou — timestampy mocku, žiadny prekryv.
    const gaps = mock.state.writeGapsMs();
    expect(gaps).toHaveLength(9);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(PAUSE_MS - TOLERANCE_MS);
    }

    // „Nikdy paralelne": každý zápis začal až po ODOSLANEJ odpovedi predošlého.
    for (let i = 1; i < writes.length; i += 1) {
      const previous = writes[i - 1]!;
      const current = writes[i]!;
      expect(previous.responseStatus).toBe(200);
      expect(current.atMonotonic).toBeGreaterThan(
        previous.atMonotonic + (previous.durationMs ?? 0),
      );
    }

    // Medzi zápismi bol vždy aj pre-write GET (D48) — 10 GETov na 10 zápisov.
    expect(mock.state.requestsTo('/api/products/get')).toHaveLength(10);
  }, 30_000);
});
