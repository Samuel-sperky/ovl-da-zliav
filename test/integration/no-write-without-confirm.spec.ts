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

import { computePayloadHash, createPreviewTokenService, payloadHashItemsFromRows } from '@/lib/crypto/preview-token';
import { assertConfirmed } from '@/lib/engine/executor';

import { createExecutePost } from '@/app/api/campaigns/[id]/execute/route';
import { createExtendPost } from '@/app/api/campaigns/[id]/extend/route';
import { createRetryFailedPost } from '@/app/api/campaigns/[id]/retry-failed/route';
import { createCampaignsPost } from '@/app/api/campaigns/route';
import { createPreviewPost } from '@/app/api/campaigns/preview/route';

import { makeCampaign, makeCampaignItems, makeConfirmedCampaign } from '../helpers/factories';
import { useMockShop } from '../helpers/mock';
import {
  day,
  makeRequest,
  makeRoutesWorld,
  parse,
  actorRouteDeps,
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
    const post = createCampaignsPost(w.deps, actorRouteDeps());
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
    const post = createCampaignsPost(w.deps, actorRouteDeps());
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

    const post = createCampaignsPost(w.deps, actorRouteDeps());
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

    const post = createCampaignsPost(w.deps, actorRouteDeps());
    const response = await post(makeRequest('POST', '/api/campaigns', createBody(token)));
    const res = await parse(response);
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('preview_token_invalid');
    expect(mock.state.recordedRequests).toHaveLength(0);
  });

  it('už použitý token → 409 preview_token_used a žiadny ĎALŠÍ zápis (jednorazovosť)', async () => {
    const w = world();
    // Platný token cez skutočný dry-run.
    const preview = createPreviewPost(w.deps, actorRouteDeps());
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

    const post = createCampaignsPost(w.deps, actorRouteDeps());
    const first = await parse(await post(makeRequest('POST', '/api/campaigns', createBody(token))));
    expect(first.status).toBe(200);
    const writesAfterFirst = mock.state.writeRequests().length;
    expect(writesAfterFirst).toBe(1);

    const second = await parse(await post(makeRequest('POST', '/api/campaigns', createBody(token))));
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe('preview_token_used');
    expect(mock.state.writeRequests().length).toBe(writesAfterFirst);
  });

  /*
   * Test „bez sudo okna → 401 sudo_required" tu bol do 27. 8. 2026 (D70).
   * Sudo zrušilo D100. Čo I3 po tej zmene znamená, stráži samostatný blok
   * na konci tohto súboru — priamo nad assertConfirmed(), poslednou bránou
   * pred zápisom do produkčného eshopu.
   */
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

    const execute = createExecutePost(w.deps, actorRouteDeps());
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

    const execute = createExecutePost(w.deps, actorRouteDeps());
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

    const retry = createRetryFailedPost(w.deps, actorRouteDeps());
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

    const extend = createExtendPost(w.deps, actorRouteDeps());
    const response = await extend(
      makeRequest('POST', `/api/campaigns/${campaign.id}/extend`, { previewToken: token }),
      { params: { id: String(campaign.id) } },
    );
    await expectRefusedWithoutShopContact(response);
    expect(w.campaigns.size).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * I3 PO ZRUŠENÍ SUDO — assertConfirmed() JE POSLEDNÁ BRÁNA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Prečo tento blok vznikol: 27. 8. 2026 sa pri zrušení sudo (D100) začalo do
 * `campaigns.sudo_at` zapisovať NULL — a `assertConfirmed()` mala podmienku
 * „sudo_at nesmie byť NULL". Následok bol, že appka ODMIETLA KAŽDÝ zápis
 * a hlásila pritom „chýba potvrdenie". Chytil to `no-write-without-confirm`
 * vyššie, ale iba nepriamo, cez 409 na route.
 *
 * Odteraz sa obe nohy nového I3 („dry-run + potvrdenie") merajú priamo. Nič
 * z toho nie je test nad zdrojovým textom: každý prípad volá funkciu.
 */
describe('assertConfirmed — obe nohy I3 po D100', () => {
  const IDS = [201, 202, 203];

  /** Kampaň + položky, ktorých hash SEDÍ — teda smie zapisovať. */
  function pair(overrides: Parameters<typeof makeConfirmedCampaign>[0] = {}) {
    const items = makeCampaignItems(IDS).map((item) => ({ ...item, percent: 15 }));
    const campaign = makeConfirmedCampaign({ productIds: IDS, percent: 15, ...overrides });
    const hash = computePayloadHash({
      kind: campaign.kind,
      from: campaign.dateFrom,
      to: campaign.dateTo,
      items: payloadHashItemsFromRows(
        items.map((i) => ({ productId: i.productId, percent: 15, priceAtPreview: i.priceAtPreview })),
      ),
    });
    return { campaign: { ...campaign, confirmPayloadHash: hash }, items };
  }

  /*
   * TOTO JE STRÁŽCA CHYBY Z 27. 8. `sudo_at` je NULL na každej novej kampani.
   * Keby sa kontrola vrátila, appka by prestala zapisovať — a tento test by
   * bol jediné miesto, kde by sa to ozvalo pred nasadením.
   */
  it('sudo_at = NULL zápis NEZASTAVÍ — sudo zrušilo D100', () => {
    const { campaign, items } = pair();
    expect(campaign.sudoAt).toBeNull();
    expect(() => assertConfirmed(campaign, items)).not.toThrow();
  });

  it('chýbajúci confirmed_at zápis ZASTAVÍ', () => {
    const { campaign, items } = pair();
    expect(() => assertConfirmed({ ...campaign, confirmedAt: null }, items)).toThrow(
      /confirmed_at/i,
    );
  });

  it('chýbajúci confirm_payload_hash zápis ZASTAVÍ', () => {
    const { campaign, items } = pair();
    expect(() => assertConfirmed({ ...campaign, confirmPayloadHash: null }, items)).toThrow(
      /confirm_payload_hash/i,
    );
  });

  /*
   * Silná noha: hash sa PREPOČÍTAVA z riadkov položiek. Podvrhnuté potvrdenie
   * (správne vyzerajúci hash nad inou sadou) tým padne, aj keď confirmed_at
   * a confirm_payload_hash sú vyplnené.
   */
  it('zmenené percento položky rozbije prepočet hashu a zápis ZASTAVÍ', () => {
    const { campaign, items } = pair();
    const tampered = items.map((item, index) =>
      index === 0 ? { ...item, percent: 40 } : item,
    );
    expect(() => assertConfirmed(campaign, tampered)).toThrow();
  });

  it('pridaný produkt mimo potvrdenej sady zápis ZASTAVÍ', () => {
    const { campaign, items } = pair();
    const extra = [...items, { ...items[0]!, id: 999, productId: 999, position: 4, percent: 15 }];
    expect(() => assertConfirmed(campaign, extra)).toThrow();
  });

  it('položka bez percenta pásma zápis ZASTAVÍ (K3)', () => {
    const { campaign, items } = pair();
    const bezPercenta = items.map((item, index) =>
      index === 1 ? { ...item, percent: undefined } : item,
    );
    expect(() => assertConfirmed(campaign, bezPercenta)).toThrow(/percent/i);
  });
});
