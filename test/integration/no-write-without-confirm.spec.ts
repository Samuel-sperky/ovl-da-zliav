/**
 * Aura Zľavy — EXPLICITNÝ TEST INVARIANTU I3: „žiadny zápis bez potvrdenia".
 *
 * `POST /api/campaigns`, `execute`, `retry-failed` aj `extend` MUSIA pri
 * chýbajúcom, expirovanom, podvrhnutom, cudzom alebo už použitom
 * `previewToken` vrátiť 4xx a na mock shop NESMIE odísť ANI JEDEN request —
 * ani čítací, ani zápisový. Overuje sa cez `mock.state.recordedRequests`,
 * jediný zdroj pravdy mocku (I6).
 */
import { describe, expect, it } from 'vitest';

import { createPreviewTokenService } from '@/lib/crypto/preview-token';

import { createExecutePost } from '@/app/api/campaigns/[id]/execute/route';
import { createExtendPost } from '@/app/api/campaigns/[id]/extend/route';
import { createRetryFailedPost } from '@/app/api/campaigns/[id]/retry-failed/route';
import { createCampaignsPost } from '@/app/api/campaigns/route';
import { createPreviewPost } from '@/app/api/campaigns/preview/route';

import { makeCampaign } from '../helpers/factories';
import { useMockShop } from '../helpers/mock';
import {
  day,
  makeRequest,
  makeRoutesWorld,
  parse,
  sessionRouteDeps,
  TEST_USER_ID,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

function world(): RoutesWorld {
  mock.state.setProducts(
    [201, 202, 203].map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl });
}

const createBody = (previewToken: string) => ({
  previewToken,
  name: 'Pokus o zápis',
  mode: 'eager' as const,
  acknowledgements: { irreversible: true as const },
});

async function expectRefusedWithoutShopContact(
  response: Response,
  expectedStatusRange: [number, number] = [400, 499],
): Promise<void> {
  const res = await parse(response);
  expect(res.status).toBeGreaterThanOrEqual(expectedStatusRange[0]);
  expect(res.status).toBeLessThanOrEqual(expectedStatusRange[1]);
  expect(res.body.ok).toBe(false);
  // Jadro I3: na shop nedorazil ANI JEDEN request.
  expect(mock.state.recordedRequests).toHaveLength(0);
}

describe('I3 — POST /api/campaigns bez platného potvrdenia', () => {
  it('chýbajúci previewToken → 400, žiadny request na shop', async () => {
    const w = world();
    const post = createCampaignsPost(w.deps, sessionRouteDeps());
    const response = await post(
      makeRequest('POST', '/api/campaigns', {
        name: 'Bez tokenu',
        mode: 'eager',
        acknowledgements: { irreversible: true },
      }),
    );
    await expectRefusedWithoutShopContact(response);
    expect(w.campaigns.size).toBe(0);
  });

  it('nezmyselný token → 400, žiadny request na shop', async () => {
    const w = world();
    const post = createCampaignsPost(w.deps, sessionRouteDeps());
    await expectRefusedWithoutShopContact(
      await post(makeRequest('POST', '/api/campaigns', createBody('toto-nie-je-jwt'))),
    );
    expect(w.campaigns.size).toBe(0);
  });

  it('expirovaný token → 400 preview_token_expired, žiadny request na shop', async () => {
    const w = world();
    // Token podpísaný TÝM ISTÝM secretom, ale vydaný pred 16 minútami.
    const past = new Date(Date.now() - 16 * 60_000);
    const expiredIssuer = createPreviewTokenService({
      secret: Buffer.from('routes-a12-test-secret-32bytes!!', 'utf8'),
      now: () => past,
    });
    const { token } = await expiredIssuer.issue({
      sub: TEST_USER_ID,
      kind: 'new',
      productIds: [201],
      percent: 15,
      from: day(1),
      to: day(10),
      pricesAtPreview: { '201': '19.99' },
    });

    const post = createCampaignsPost(w.deps, sessionRouteDeps());
    const response = await post(makeRequest('POST', '/api/campaigns', createBody(token)));
    const res = await parse(response);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('preview_token_expired');
    expect(mock.state.recordedRequests).toHaveLength(0);
    expect(w.campaigns.size).toBe(0);
  });

  it('token podpísaný CUDZÍM secretom → 400, žiadny request na shop', async () => {
    const w = world();
    const foreignIssuer = createPreviewTokenService({
      secret: Buffer.from('uplne-iny-secret-32-bajtov-....!', 'utf8'),
    });
    const { token } = await foreignIssuer.issue({
      sub: TEST_USER_ID,
      kind: 'new',
      productIds: [201],
      percent: 15,
      from: day(1),
      to: day(10),
      pricesAtPreview: {},
    });

    const post = createCampaignsPost(w.deps, sessionRouteDeps());
    const response = await post(makeRequest('POST', '/api/campaigns', createBody(token)));
    const res = await parse(response);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('preview_token_invalid');
    expect(mock.state.recordedRequests).toHaveLength(0);
  });

  it('už použitý token → 409 preview_token_used a žiadny ĎALŠÍ zápis (jednorazovosť)', async () => {
    const w = world();
    // Platný token cez skutočný dry-run.
    const preview = createPreviewPost(w.deps, sessionRouteDeps());
    const previewRes = await parse(
      await preview(
        makeRequest('POST', '/api/campaigns/preview', {
          productIds: [201],
          percent: 15,
          from: day(1),
          to: day(10),
          kind: 'new',
        }),
      ),
    );
    const token = (previewRes.body.data as { previewToken: string }).previewToken;

    const post = createCampaignsPost(w.deps, sessionRouteDeps());
    const first = await parse(await post(makeRequest('POST', '/api/campaigns', createBody(token))));
    expect(first.status).toBe(200);
    const writesAfterFirst = mock.state.writeRequests().length;
    expect(writesAfterFirst).toBe(1);

    const second = await parse(await post(makeRequest('POST', '/api/campaigns', createBody(token))));
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('preview_token_used');
    expect(mock.state.writeRequests().length).toBe(writesAfterFirst);
  });

  it('bez sudo okna → 401 sudo_required, žiadny request na shop (D70)', async () => {
    const w = world();
    const post = createCampaignsPost(w.deps, sessionRouteDeps({ sudo: false }));
    const response = await post(makeRequest('POST', '/api/campaigns', createBody('cokolvek')));
    const res = await parse(response);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('sudo_required');
    expect(mock.state.recordedRequests).toHaveLength(0);
  });
});

describe('I3 — execute / retry-failed / extend s tokenom pre INÚ sadu', () => {
  it('execute: token vydaný na inú sadu produktov → 400, žiadny request na shop', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'needs_key', dateFrom: day(1), dateTo: day(10), percent: 15 }),
      [
        { productId: 201, priceAtPreview: '19.99' },
        { productId: 202, priceAtPreview: '19.99' },
      ],
    );
    // Token pre [201] — kampaň má [201, 202].
    const { token } = await w.previewTokens.issue({
      sub: TEST_USER_ID,
      kind: 'new',
      productIds: [201],
      percent: 15,
      from: day(1),
      to: day(10),
      pricesAtPreview: {},
    });

    const execute = createExecutePost(w.deps, sessionRouteDeps());
    const response = await execute(
      makeRequest('POST', `/api/campaigns/${campaign.id}/execute`, { previewToken: token }),
      { params: { id: String(campaign.id) } },
    );
    const res = await parse(response);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('preview_token_invalid');
    expect(mock.state.recordedRequests).toHaveLength(0);
    expect(w.campaigns.get(campaign.id)?.status).toBe('needs_key');
  });

  it('execute: token s iným percentom → 400, žiadny request na shop', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'missed', dateFrom: day(1), dateTo: day(10), percent: 15 }),
      [{ productId: 201, priceAtPreview: '19.99' }],
    );
    const { token } = await w.previewTokens.issue({
      sub: TEST_USER_ID,
      kind: 'new',
      productIds: [201],
      percent: 20, // kampaň má 15
      from: day(1),
      to: day(10),
      pricesAtPreview: {},
    });

    const execute = createExecutePost(w.deps, sessionRouteDeps());
    const response = await execute(
      makeRequest('POST', `/api/campaigns/${campaign.id}/execute`, { previewToken: token }),
      { params: { id: String(campaign.id) } },
    );
    await expectRefusedWithoutShopContact(response);
    expect(w.campaigns.get(campaign.id)?.status).toBe('missed');
  });

  it('retry-failed: token nad plnou sadou namiesto zlyhanej → 400, žiadny request', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'partial', dateFrom: day(1), dateTo: day(10), percent: 15 }),
      [
        { productId: 201, priceAtPreview: '19.99', status: 'ok' },
        { productId: 202, priceAtPreview: '19.99', status: 'failed' },
      ],
    );
    // Sada retry je [202]; token je podvrhnutý na [201, 202].
    const { token } = await w.previewTokens.issue({
      sub: TEST_USER_ID,
      kind: 'retry',
      productIds: [201, 202],
      percent: 15,
      from: day(1),
      to: day(10),
      pricesAtPreview: {},
    });

    const retry = createRetryFailedPost(w.deps, sessionRouteDeps());
    const response = await retry(
      makeRequest('POST', `/api/campaigns/${campaign.id}/retry-failed`, { previewToken: token }),
      { params: { id: String(campaign.id) } },
    );
    await expectRefusedWithoutShopContact(response);
    expect(w.campaigns.size).toBe(1); // žiadna retry kampaň nevznikla
  });

  it('extend: token s iným `to`, než tvrdí → odmietnuté bez requestu na shop', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'done', dateFrom: day(-5), dateTo: day(5), percent: 15 }),
      [{ productId: 201, priceAtPreview: '19.99', status: 'ok' }],
    );
    // Token kind='new' namiesto 'extend' → payload_mismatch.
    const { token } = await w.previewTokens.issue({
      sub: TEST_USER_ID,
      kind: 'new',
      productIds: [201],
      percent: 15,
      from: day(-5),
      to: day(15),
      pricesAtPreview: {},
    });

    const extend = createExtendPost(w.deps, sessionRouteDeps());
    const response = await extend(
      makeRequest('POST', `/api/campaigns/${campaign.id}/extend`, { previewToken: token }),
      { params: { id: String(campaign.id) } },
    );
    await expectRefusedWithoutShopContact(response);
    expect(w.campaigns.size).toBe(1);
  });
});
