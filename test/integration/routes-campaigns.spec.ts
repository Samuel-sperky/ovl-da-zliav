/**
 * Aura Zľavy — integračné testy route-ov A12 (BUILD-SPEC §5) proti mock shopu.
 *
 * Akceptačné kritériá A12 pokryté tu:
 *  - dry-run `/preview` vydá jednorazový token; `POST /api/campaigns`
 *    s `mode='eager'` zapíše okamžite, `mode='scheduled'` len naplánuje,
 *  - `execute` funguje LEN zo stavov `needs_key`/`missed` a vyžaduje nový
 *    `previewToken` (D33b),
 *  - `DELETE /api/allowlist/[id]` vráti 409 `campaign_planned` (D40),
 *  - `POST /api/allowlist` vráti 409 pri 10 obsadených slotoch (I2),
 *  - `GET /api/audit/[id]` nesie príznak `priceMismatch` (D39c),
 *  - `GET /api/campaigns` vracia derivované UI stavy „aktívna"/„expirovaná" (O1).
 *
 * I3 scenáre (token chýba/expirovaný/iná sada → ani jeden request na shop)
 * sú v `no-write-without-confirm.spec.ts`.
 */
import { describe, expect, it } from 'vitest';

import { createAckPost } from '@/app/api/campaigns/[id]/ack/route';
import { createCancelPost } from '@/app/api/campaigns/[id]/cancel/route';
import { createExecutePost } from '@/app/api/campaigns/[id]/execute/route';
import { createCampaignGet } from '@/app/api/campaigns/[id]/route';
import { createCampaignsGet, createCampaignsPost } from '@/app/api/campaigns/route';
import { createPreviewPost } from '@/app/api/campaigns/preview/route';
import { createAllowlistDelete } from '@/app/api/allowlist/[productId]/route';
import { createAllowlistGet, createAllowlistPost } from '@/app/api/allowlist/route';
import { createCatalogRefreshPost } from '@/app/api/catalog/refresh/route';
import { createAuditDetailGet } from '@/app/api/audit/[id]/route';
import { createNotificationsGet } from '@/app/api/notifications/route';

import { makeCampaign } from '../helpers/factories';
import { useMockShop } from '../helpers/mock';
import {
  day,
  makeRequest,
  makeRoutesWorld,
  parse,
  sessionRouteDeps,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

function world(opts: { allowlistIds?: number[]; apiKey?: string | null } = {}): RoutesWorld {
  mock.state.setProducts(
    (opts.allowlistIds ?? [201, 202, 203]).map((id) => ({
      id,
      name: `Šperk ${id}`,
      price: 19.99,
      has_attributes: false,
    })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl, ...opts });
}

async function previewToken(w: RoutesWorld, body: Record<string, unknown>): Promise<string> {
  const handler = createPreviewPost(w.deps, sessionRouteDeps());
  const res = await parse(await handler(makeRequest('POST', '/api/campaigns/preview', body)));
  expect(res.status).toBe(200);
  const data = res.body.data as { previewToken: string; blockers: unknown[] };
  expect(data.blockers).toEqual([]);
  expect(data.previewToken).not.toBe('');
  return data.previewToken;
}

describe('POST /api/campaigns/preview + POST /api/campaigns', () => {
  it('eager: potvrdený dry-run zapíše okamžite cez executor', async () => {
    const w = world();
    const token = await previewToken(w, {
      productIds: [201, 202],
      percent: 15,
      from: day(1),
      to: day(10),
      kind: 'new',
    });

    const post = createCampaignsPost(w.deps, sessionRouteDeps());
    const res = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          previewToken: token,
          name: 'Letná akcia',
          mode: 'eager',
          acknowledgements: { irreversible: true },
        }),
      ),
    );

    expect(res.status).toBe(200);
    const data = res.body.data as { campaignId: number; status: string };
    expect(data.status).toBe('done');
    expect(mock.state.writeRequests()).toHaveLength(2);
    expect(w.campaigns.get(data.campaignId)?.status).toBe('done');
    // I3 — potvrdenie je doložené v zázname kampane.
    expect(w.campaigns.get(data.campaignId)?.confirmPayloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('scheduled: kampaň sa len naplánuje — na mock neodíde žiadny zápis', async () => {
    const w = world();
    const token = await previewToken(w, {
      productIds: [201],
      percent: 10,
      from: day(2),
      to: day(5),
      kind: 'new',
    });

    const post = createCampaignsPost(w.deps, sessionRouteDeps());
    const res = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          previewToken: token,
          name: 'Naplánovaná akcia',
          mode: 'scheduled',
          acknowledgements: { irreversible: true },
        }),
      ),
    );

    expect(res.status).toBe(200);
    const data = res.body.data as { campaignId: number; status: string };
    expect(data.status).toBe('scheduled');
    expect(mock.state.writeRequests()).toHaveLength(0);
    const record = w.campaigns.get(data.campaignId);
    expect(record?.status).toBe('scheduled');
    expect(record?.fireAt).toBeInstanceOf(Date);
  });

  it('jednodňová zľava bez potvrdenia „naozaj 1 deň?" je 400 a token sa nespáli (D30)', async () => {
    const w = world();
    const token = await previewToken(w, {
      productIds: [201],
      percent: 10,
      from: day(3),
      to: day(3),
      kind: 'new',
      oneDayAcknowledged: true,
    });

    const post = createCampaignsPost(w.deps, sessionRouteDeps());
    const missing = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          previewToken: token,
          name: 'Jednodňovka',
          mode: 'scheduled',
          acknowledgements: { irreversible: true },
        }),
      ),
    );
    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe('one_day_not_acknowledged');

    // Token nebol spálený — s `oneDay: true` prejde.
    const okRes = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          previewToken: token,
          name: 'Jednodňovka',
          mode: 'scheduled',
          acknowledgements: { irreversible: true, oneDay: true },
        }),
      ),
    );
    expect(okRes.status).toBe(200);
  });
});

describe('GET /api/campaigns — derivované UI stavy (O1, D14)', () => {
  it('vracia „aktívna" pre done s budúcim koncom a „expirovaná" pre done s minulým', async () => {
    const w = world();
    const active = w.seedCampaign(
      makeCampaign({ status: 'done', dateFrom: day(-2), dateTo: day(3), name: 'Bežiaca' }),
      [{ productId: 201, priceAtPreview: '19.99' }],
    );
    const expired = w.seedCampaign(
      makeCampaign({ status: 'done', dateFrom: day(-10), dateTo: day(-1), name: 'Skončená' }),
      [{ productId: 202, priceAtPreview: '19.99' }],
    );

    const get = createCampaignsGet(w.deps, sessionRouteDeps());
    const res = await parse(await get(makeRequest('GET', '/api/campaigns')));
    expect(res.status).toBe(200);
    const rows = (res.body.data as { data: Array<{ id: number; derived: string | null }> }).data;
    expect(rows.find((r) => r.id === active.id)?.derived).toBe('aktivna');
    expect(rows.find((r) => r.id === expired.id)?.derived).toBe('expirovana');
  });
});

describe('POST /api/campaigns/[id]/execute (D33b, I3)', () => {
  it('dopáli kampaň z needs_key s NOVÝM preview tokenom', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({
        status: 'needs_key',
        dateFrom: day(1),
        dateTo: day(10),
        percent: 15,
        needsKeySince: new Date(),
      }),
      [
        { productId: 201, priceAtPreview: '19.99' },
        { productId: 202, priceAtPreview: '19.99' },
      ],
    );

    // Nový dry-run token pre presnú sadu kampane (D33b). Cez `/preview` sa
    // vydať nedá — vlastná needs_key kampaň by kolidovala s D28 overlap
    // blokátorom — preto ho vydá priamo token service (ekvivalent nového
    // dry-runu; hash aj jednorazovosť platia rovnako).
    const { token } = await w.previewTokens.issue({
      sub: 1,
      kind: 'new',
      productIds: [201, 202],
      percent: 15,
      from: day(1),
      to: day(10),
      pricesAtPreview: { '201': '19.99', '202': '19.99' },
    });

    const execute = createExecutePost(w.deps, sessionRouteDeps());
    const res = await parse(
      await execute(makeRequest('POST', `/api/campaigns/${campaign.id}/execute`, { previewToken: token }), {
        params: { id: String(campaign.id) },
      }),
    );

    expect(res.status).toBe(200);
    expect((res.body.data as { status: string }).status).toBe('done');
    expect(mock.state.writeRequests()).toHaveLength(2);
  });

  it('zo stavu scheduled je execute odmietnutý 409 a na mock neodíde nič', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'scheduled', dateFrom: day(1), dateTo: day(10) }),
      [{ productId: 201, priceAtPreview: '19.99' }],
    );

    const execute = createExecutePost(w.deps, sessionRouteDeps());
    const res = await parse(
      await execute(
        makeRequest('POST', `/api/campaigns/${campaign.id}/execute`, { previewToken: 'xxx' }),
        { params: { id: String(campaign.id) } },
      ),
    );

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('invalid_transition');
    expect(mock.state.recordedRequests).toHaveLength(0);
  });

  it('missed → running funguje LEN cez execute s novým tokenom (jediná cesta, D33b)', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'missed', dateFrom: day(1), dateTo: day(10), percent: 15 }),
      [{ productId: 201, priceAtPreview: '19.99' }],
    );

    const { token } = await w.previewTokens.issue({
      sub: 1,
      kind: 'new',
      productIds: [201],
      percent: 15,
      from: day(1),
      to: day(10),
      pricesAtPreview: { '201': '19.99' },
    });

    const execute = createExecutePost(w.deps, sessionRouteDeps());
    const res = await parse(
      await execute(makeRequest('POST', `/api/campaigns/${campaign.id}/execute`, { previewToken: token }), {
        params: { id: String(campaign.id) },
      }),
    );
    expect(res.status).toBe(200);
    expect((res.body.data as { status: string }).status).toBe('done');
  });
});

describe('cancel a ack', () => {
  it('cancel funguje zo scheduled a je odmietnutý z done (§4)', async () => {
    const w = world();
    const scheduled = w.seedCampaign(
      makeCampaign({ status: 'scheduled', dateFrom: day(1), dateTo: day(5) }),
      [{ productId: 201, priceAtPreview: '19.99' }],
    );
    const done = w.seedCampaign(
      makeCampaign({ status: 'done', dateFrom: day(-5), dateTo: day(5) }),
      [{ productId: 202, priceAtPreview: '19.99' }],
    );

    const cancel = createCancelPost(w.deps, sessionRouteDeps());
    const okRes = await parse(
      await cancel(makeRequest('POST', `/api/campaigns/${scheduled.id}/cancel`, {}), {
        params: { id: String(scheduled.id) },
      }),
    );
    expect(okRes.status).toBe(200);
    expect(w.campaigns.get(scheduled.id)?.status).toBe('cancelled');

    const badRes = await parse(
      await cancel(makeRequest('POST', `/api/campaigns/${done.id}/cancel`, {}), {
        params: { id: String(done.id) },
      }),
    );
    expect(badRes.status).toBe(409);
  });

  it('notifications vracia neodklikané výsledky a ack ich odstráni (D17)', async () => {
    const w = world();
    const finished = w.seedCampaign(
      makeCampaign({ status: 'failed', dateFrom: day(-3), dateTo: day(3), finishedAt: new Date() }),
      [{ productId: 201, priceAtPreview: '19.99', status: 'failed' }],
    );

    const notifications = createNotificationsGet(w.deps, sessionRouteDeps());
    const before = await parse(await notifications(makeRequest('GET', '/api/notifications')));
    expect(
      (before.body.data as { unacked: Array<{ campaignId: number }> }).unacked.map((u) => u.campaignId),
    ).toContain(finished.id);

    const ack = createAckPost(w.deps, sessionRouteDeps());
    const ackRes = await parse(
      await ack(makeRequest('POST', `/api/campaigns/${finished.id}/ack`), {
        params: { id: String(finished.id) },
      }),
    );
    expect(ackRes.status).toBe(200);

    const after = await parse(await notifications(makeRequest('GET', '/api/notifications')));
    expect((after.body.data as { unacked: unknown[] }).unacked).toHaveLength(0);
  });
});

describe('allowlist (I2, D40)', () => {
  it('POST vráti 409 allowlist_full pri 10 obsadených slotoch', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => 201 + i);
    const w = world({ allowlistIds: ids });

    const post = createAllowlistPost(w.deps, sessionRouteDeps());
    const res = await parse(await post(makeRequest('POST', '/api/allowlist', { productId: 999 })));
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('allowlist_full');
  });

  it('DELETE je blokovaný 409 campaign_planned, kým existuje plánovaná kampaň (D40)', async () => {
    const w = world();
    w.seedCampaign(
      makeCampaign({ status: 'scheduled', dateFrom: day(1), dateTo: day(5) }),
      [{ productId: 201, priceAtPreview: '19.99' }],
    );

    const del = createAllowlistDelete(w.deps, sessionRouteDeps());
    const blocked = await parse(
      await del(makeRequest('DELETE', '/api/allowlist/201'), { params: { productId: '201' } }),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.code).toBe('campaign_planned');
    expect(w.allowlist.get(201)?.slot).not.toBeNull();

    // Produkt bez plánovanej kampane sa odobrať dá.
    const removed = await parse(
      await del(makeRequest('DELETE', '/api/allowlist/203'), { params: { productId: '203' } }),
    );
    expect(removed.status).toBe(200);
    expect(w.allowlist.get(203)?.slot).toBeNull();
  });

  it('GET vracia sloty s cache a posledným vlastným zápisom (I11)', async () => {
    const w = world();
    w.catalog.set(201, {
      productId: 201,
      name: 'Šperk 201',
      price: '19.99',
      hasAttributes: false,
      source: 'get',
      fetchedAt: new Date(),
      raw: {},
    });

    const get = createAllowlistGet(w.deps, sessionRouteDeps());
    const res = await parse(await get(makeRequest('GET', '/api/allowlist')));
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<{ productId: number; name: string | null }>;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.productId === 201)?.name).toBe('Šperk 201');
  });
});

describe('catalog refresh (D56, D57)', () => {
  it('obnoví cache z mocku a nečitateľný produkt počíta do staleCount', async () => {
    // 999 v allowliste je, ale mock ho nepozná → not_found.
    const w = world({ allowlistIds: [201, 202, 999] });
    mock.state.removeProduct(999); // `setProducts` je upsert — 999 nesmie existovať
    mock.state.setProducts([
      { id: 201, name: 'Šperk 201', price: 19.99, has_attributes: false },
      { id: 202, name: 'Šperk 202', price: 29.99, has_attributes: true },
    ]);

    const refresh = createCatalogRefreshPost(w.deps, sessionRouteDeps());
    const res = await parse(await refresh(makeRequest('POST', '/api/catalog/refresh', {})));
    expect(res.status).toBe(200);
    const data = res.body.data as { staleCount: number; items: Array<{ productId: number; refreshed: boolean }> };
    expect(data.staleCount).toBe(1);
    expect(data.items.find((i) => i.productId === 202)?.refreshed).toBe(true);
    expect(w.catalog.get(202)?.price).toBe('29.99');
    expect(w.allowlist.get(999)?.shopStatus).toBe('not_found');
  });
});

describe('GET /api/audit/[id] — príznak priceMismatch (D39c)', () => {
  it('vracia priceMismatch=true, keď snapshot nesie price_mismatch', async () => {
    const w = world();
    await w.audit.appendAudit({
      actor: 'user',
      eventType: 'write_ok',
      ok: true,
      campaignId: 1,
      productId: 201,
      afterSnapshot: { price_at_preview: '19.99', price_at_write: '24.99', price_mismatch: true },
    });
    await w.audit.appendAudit({
      actor: 'user',
      eventType: 'write_ok',
      ok: true,
      campaignId: 1,
      productId: 202,
      afterSnapshot: { price_mismatch: false },
    });

    const get = createAuditDetailGet(w.deps, sessionRouteDeps());
    const first = await parse(
      await get(makeRequest('GET', '/api/audit/1'), { params: { id: '1' } }),
    );
    expect(first.status).toBe(200);
    expect((first.body.data as { priceMismatch: boolean }).priceMismatch).toBe(true);

    const second = await parse(
      await get(makeRequest('GET', '/api/audit/2'), { params: { id: '2' } }),
    );
    expect((second.body.data as { priceMismatch: boolean }).priceMismatch).toBe(false);

    const missing = await parse(
      await get(makeRequest('GET', '/api/audit/99'), { params: { id: '99' } }),
    );
    expect(missing.status).toBe(404);
  });
});

describe('GET /api/campaigns/[id] — detail s položkami a audit stopou', () => {
  it('vracia kampaň, položky aj audit trail', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'done', dateFrom: day(-1), dateTo: day(5) }),
      [{ productId: 201, priceAtPreview: '19.99', status: 'ok' }],
    );
    await w.audit.appendAudit({
      actor: 'user',
      eventType: 'campaign_finished',
      ok: true,
      campaignId: campaign.id,
    });

    const get = createCampaignGet(w.deps, sessionRouteDeps());
    const res = await parse(
      await get(makeRequest('GET', `/api/campaigns/${campaign.id}`), {
        params: { id: String(campaign.id) },
      }),
    );
    expect(res.status).toBe(200);
    const data = res.body.data as {
      campaign: { id: number };
      items: unknown[];
      auditTrail: unknown[];
    };
    expect(data.campaign.id).toBe(campaign.id);
    expect(data.items).toHaveLength(1);
    expect(data.auditTrail).toHaveLength(1);
  });
});
