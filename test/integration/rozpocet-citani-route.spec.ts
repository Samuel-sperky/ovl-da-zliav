/**
 * Aura Zľavy — ROZPOČET ČÍTANÍ SHOPU NA ROUTE-OCH (K7, nález B1).
 *
 * `engine/preview` sa proti nekontrolovanému čítaniu spevnil v auguste; dve
 * súrodenecké cesty k tomu istému shopu nie:
 *
 *  - `POST /api/campaigns/[id]/extend/preview` čítala celú sadu pôvodnej
 *    kampane cez `batchGetProducts()` bez rezervácie, takže o tých čítaniach
 *    počítadlo nevedelo — presne mechanizmus, ktorým si appka privolala IP ban,
 *  - `POST /api/catalog/refresh` to isté; sada je ohraničená rozsahom (I2),
 *    počet kliknutí nie.
 *
 * Testy tu preto merajú DVE veci, ktoré sa nedajú prečítať zo zdrojáku:
 *  1. koľko čítaní po volaní route naozaj ubudlo z počítadla,
 *  2. či shop dostal request, keď rozpočet nestačil (`recordedRequests`).
 *
 * Tretia vec je N+1: `lastOwnWrite()` sa volalo raz na produkt. Harness počíta
 * oba tvary dotazu, takže test vie povedať, ktorý route použila.
 */
import { describe, expect, it } from 'vitest';

import { createExtendPreviewPost } from '@/app/api/campaigns/[id]/extend/preview/route';
import { createCatalogRefreshPost } from '@/app/api/catalog/refresh/route';
import { anonReadCost } from '@/lib/catalog/product-details';

import { makeCampaign } from '../helpers/factories';
import { useMockShop } from '../helpers/mock';
import { MOCK_PATHS } from '../mock-shop/server';
import {
  day,
  makeRequest,
  makeRoutesWorld,
  parse,
  sessionRouteDeps,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

const PRODUCTS = [201, 202, 203];

function world(): RoutesWorld {
  mock.state.setProducts(
    PRODUCTS.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl, allowlistIds: PRODUCTS });
}

/** Zapísaná kampaň, ktorú sa dá predĺžiť (`done`, D27). */
function seedDone(w: RoutesWorld): number {
  const campaign = w.seedCampaign(
    makeCampaign({
      status: 'done',
      percent: 20,
      dateFrom: day(-5),
      dateTo: day(5),
      productIds: PRODUCTS,
    }),
    PRODUCTS.map((productId) => ({ productId, priceAtPreview: '19.99' as const })),
  );
  return campaign.id;
}

interface PreviewData {
  previewToken: string;
  items: Array<{
    productId: number;
    price: string | null;
    lastOwnWrite: unknown;
  }>;
  blockers: Array<{ code: string; message: string }>;
}

async function extendPreview(w: RoutesWorld, campaignId: number, to: string): Promise<PreviewData> {
  const handler = createExtendPreviewPost(w.deps, sessionRouteDeps());
  const res = await parse(
    await handler(makeRequest('POST', `/api/campaigns/${campaignId}/extend/preview`, { to }), {
      params: { id: String(campaignId) },
    }),
  );
  expect(res.status).toBe(200);
  return res.body.data as unknown as PreviewData;
}

describe('extend/preview — čítanie shopu prechádza rozpočtom (K7, B1)', () => {
  it('rezervuje cenu celej sady PRED volaním shopu', async () => {
    const w = world();
    const campaignId = seedDone(w);

    const before = await w.readBudget.status();
    const data = await extendPreview(w, campaignId, day(20));

    expect(data.blockers).toEqual([]);
    expect(data.items.map((i) => i.price)).toEqual(['19.99', '19.99', '19.99']);
    expect(mock.state.requestsTo(MOCK_PATHS.batch).length).toBeGreaterThan(0);

    // Ubudlo presne to, čo dávka stojí: položky + obálka dávky.
    const after = await w.readBudget.status();
    expect(after.used - before.used).toBe(anonReadCost(PRODUCTS.length));
  });

  it('keď rozpočet na sadu nestačí, shop nedostane ani jeden request a token sa nevydá', async () => {
    const w = world();
    const campaignId = seedDone(w);

    // Necháme voľné menej, než sada stojí (3 produkty = 4 čítania).
    const status = await w.readBudget.status();
    await w.readBudget.reserve(status.remaining - (anonReadCost(PRODUCTS.length) - 1));

    const data = await extendPreview(w, campaignId, day(20));

    expect(data.blockers.map((b) => b.code)).toContain('shop_read_budget');
    expect(data.previewToken).toBe('');
    expect(mock.state.recordedRequests).toEqual([]);

    // Odmietnuté čítanie nesmie minúť ani zvyšok kvóty.
    expect((await w.readBudget.status()).remaining).toBe(anonReadCost(PRODUCTS.length) - 1);
  });

  it('posledné vlastné zápisy si vypýta JEDNÝM dávkovým dotazom, nie raz na produkt (I11)', async () => {
    const w = world();
    const campaignId = seedDone(w);
    // Jeden produkt už appka raz zapísala — dávkový dotaz to musí priniesť.
    for (const item of w.items.values()) {
      if (item.productId === 202) {
        item.status = 'ok';
        item.finishedAt = new Date();
      }
    }

    const data = await extendPreview(w, campaignId, day(20));

    expect(w.lastOwnWriteCalls).toEqual({ single: 0, batch: 1 });
    expect(data.items.find((i) => i.productId === 202)?.lastOwnWrite).not.toBeNull();
    expect(data.items.find((i) => i.productId === 201)?.lastOwnWrite).toBeNull();
  });
});

describe('catalog/refresh — obnova katalógu prechádza rozpočtom (K7, B1)', () => {
  interface RefreshData {
    items: Array<{ productId: number; refreshed: boolean; error: string | null }>;
    staleCount: number;
  }

  async function refresh(w: RoutesWorld): Promise<RefreshData> {
    const handler = createCatalogRefreshPost(w.deps, sessionRouteDeps());
    const res = await parse(await handler(makeRequest('POST', '/api/catalog/refresh', {})));
    expect(res.status).toBe(200);
    return res.body.data as unknown as RefreshData;
  }

  it('úspešná obnova odpíše cenu dávky z počítadla', async () => {
    const w = world();
    const before = await w.readBudget.status();

    const data = await refresh(w);

    expect(data.staleCount).toBe(0);
    expect((await w.readBudget.status()).used - before.used).toBe(anonReadCost(PRODUCTS.length));
  });

  it('vyčerpaný rozpočet zastaví obnovu pred shopom a PRIZNÁ to na každom riadku', async () => {
    const w = world();
    const status = await w.readBudget.status();
    await w.readBudget.reserve(status.remaining);

    const data = await refresh(w);

    expect(mock.state.recordedRequests).toEqual([]);
    expect(data.staleCount).toBe(PRODUCTS.length);
    expect(data.items.map((i) => i.error)).toEqual(['read_budget', 'read_budget', 'read_budget']);
    expect(data.items.every((i) => !i.refreshed)).toBe(true);
    // Cache sa NEsmie zmeniť ani vyprázdniť, keď sa nič nečítalo.
    expect(w.catalog.size).toBe(0);
  });
});
