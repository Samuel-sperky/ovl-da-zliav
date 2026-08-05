/**
 * Aura Zľavy — odchýlka D39c (A9).
 *
 * Zmena ceny medzi dry-run náhľadom a zápisom zápis NEZASTAVÍ (appka zapisuje
 * percento, nie cenu), ale protiváha je povinná:
 *  - pre-write `GET /products/get` VŽDY prebehne (D48),
 *  - `price_at_preview` aj `price_at_write` sa uložia,
 *  - `price_mismatch = 1` sa NESMIE stratiť — je v položke aj v audite.
 */
import { describe, expect, it } from 'vitest';

import type { CampaignRecord } from '@/contracts';

import { computePayloadHash } from '@/lib/crypto/preview-token';
import { createExecutor, type ExecutorFlags } from '@/lib/engine/executor';
import { createWriteMutex } from '@/lib/engine/mutex';
import { takePreWriteSnapshot } from '@/lib/engine/snapshot';
import {
  createMemoryAllowlistRepo,
  createMemoryApiKeyRepo,
  createMemoryAudit,
  createMemoryCampaignWorld,
  createMemorySettingsRepo,
} from '@/lib/engine/testing';
import { createShopClient } from '@/lib/shop/client';
import { newOperationContext } from '@/lib/shop/correlation';

import { useMockShop, VALID_API_KEY } from '../helpers/mock';
import { makeCampaign } from '../helpers/factories';

const mock = useMockShop();

const day = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const FLAGS: ExecutorFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
  writePauseMs: 5,
};

function client() {
  return createShopClient({
    baseUrl: () => mock.baseUrl,
    version: '0.1.0-test',
    readTimeoutMs: 2000,
    writeTimeoutMs: 2000,
  });
}

function makeWorld(productIds: number[], pricesAtPreview: Record<number, string>) {
  const from = day(1);
  const to = day(7);
  const world = createMemoryCampaignWorld();
  const audit = createMemoryAudit();
  const campaign: CampaignRecord = {
    ...makeCampaign({ productIds, percent: 25, status: 'scheduled' }),
    dateFrom: from,
    dateTo: to,
    confirmedAt: new Date(),
    sudoAt: new Date(),
    confirmPayloadHash: computePayloadHash({ kind: 'new', productIds, percent: 25, from, to }),
  };
  world.seedCampaign(
    campaign,
    productIds.map((productId) => ({
      productId,
      priceAtPreview: pricesAtPreview[productId] ?? null,
    })),
  );
  const executor = createExecutor({
    shopClient: client(),
    campaignsRepo: world.campaignsRepo,
    campaignItemsRepo: world.campaignItemsRepo,
    allowlistRepo: createMemoryAllowlistRepo(productIds),
    settingsRepo: createMemorySettingsRepo(),
    auditRepo: audit,
    apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
    audit,
    mutex: createWriteMutex({ dbLock: null }),
    flags: FLAGS,
  });
  return { executor, world, audit };
}

describe('D39c — zmena ceny medzi preview a write', () => {
  it('zápis NEZASTAVÍ, ale price_at_preview ≠ price_at_write a price_mismatch=1 sa uložia', async () => {
    mock.state.setProducts([
      { id: 501, name: 'Šperk 501', price: 19.99, has_attributes: false },
    ]);
    const { executor, world, audit } = makeWorld([501], { 501: '19.99' });

    // Cena sa v shope zmení PO náhľade a PRED zápisom.
    const previous = mock.state.changePrice(501, 24.5);
    expect(previous).toBe(19.99);

    const result = await executor.executeCampaign(1);

    // Zápis prebehol napriek nezhode.
    expect(result.status).toBe('done');
    expect(mock.state.writeRequests()).toHaveLength(1);
    expect(mock.state.getProduct(501)?.lastReduction?.reduction).toBe(25);

    // Nezhoda sa NESTRATILA — položka nesie obe ceny aj príznak.
    const [item] = await world.campaignItemsRepo.listByCampaign(1);
    expect(item).toMatchObject({
      status: 'ok',
      priceAtPreview: '19.99',
      priceAtWrite: '24.50',
      priceMismatch: true,
    });

    // …a je aj v audite (write_attempt beforeSnapshot + write_ok afterSnapshot).
    const attempt = audit.byEvent('write_attempt')[0]!;
    expect(attempt.beforeSnapshot).toMatchObject({
      price_at_preview: '19.99',
      price_at_write: '24.50',
      price_mismatch: true,
    });
    const ok = audit.byEvent('write_ok')[0]!;
    expect(ok.afterSnapshot).toMatchObject({ price_mismatch: true });
  });

  it('zhodná cena = price_mismatch=0, obe ceny sú aj tak uložené', async () => {
    mock.state.setProducts([
      { id: 502, name: 'Šperk 502', price: 10, has_attributes: false },
    ]);
    const { executor, world } = makeWorld([502], { 502: '10.00' });

    const result = await executor.executeCampaign(1);
    expect(result.status).toBe('done');

    const [item] = await world.campaignItemsRepo.listByCampaign(1);
    expect(item).toMatchObject({
      priceAtPreview: '10.00',
      priceAtWrite: '10.00',
      priceMismatch: false,
    });
  });

  it('chýbajúca cena z náhľadu je fail-closed nezhoda (mismatch=1), zápis prejde', async () => {
    mock.state.setProducts([
      { id: 503, name: 'Šperk 503', price: 5, has_attributes: false },
    ]);
    const { executor, world } = makeWorld([503], {});

    const result = await executor.executeCampaign(1);
    expect(result.status).toBe('done');
    const [item] = await world.campaignItemsRepo.listByCampaign(1);
    expect(item).toMatchObject({ priceAtWrite: '5.00', priceMismatch: true });
  });

  it('povinný pre-write GET zostáva v platnosti aj po odchýlke (D48)', async () => {
    mock.state.setProducts([{ id: 504, name: 'Šperk 504', price: 7, has_attributes: true }]);
    const snapshot = await takePreWriteSnapshot(
      { productId: 504, priceAtPreview: '7.00' },
      { shopClient: client() },
      newOperationContext(),
    );
    expect(snapshot.kind).toBe('ok');
    if (snapshot.kind === 'ok') {
      expect(snapshot.snapshot).toMatchObject({
        found: true,
        name: 'Šperk 504',
        priceAtWrite: '7.00',
        priceMismatch: false,
        hasAttributes: true,
        reductionUnverifiable: true,
      });
    }
    expect(mock.state.requestsTo('/api/products/get')).toHaveLength(1);
  });
});
