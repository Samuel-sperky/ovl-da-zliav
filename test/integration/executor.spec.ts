/**
 * Aura Zľavy — integračné testy executora (A9, BUILD-SPEC §9).
 *
 * Reálny shop klient proti reálnemu mock shopu (I6); repozitáre a audit sú
 * in-memory z `src/lib/engine/testing.ts`. Overuje akceptačné kritériá A9:
 *  - zlyhanie 3. produktu dávku nezastaví → `partial` (D34),
 *  - 401 uprostred dávky → wipe kľúča, zvyšok `interrupted`, `needs_key` (D51),
 *  - `not_found` blokne len daný produkt a označí ho v allowliste (D49),
 *  - timeout po odoslaní → presne jeden identický resend (D45),
 *  - bez potvrdeného dry-runu na mock nedorazí ŽIADNY request (I3),
 *  - chýbajúci kľúč → `needs_key`, nie `failed` (D21),
 *  - druhá súbežná dávka sa odmietne (D37, I12),
 *  - dry-run náhľad vydá jednorazový token s cenami (O2, D39c).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { CampaignRecord } from '@/contracts';

import { computePayloadHash, createPreviewTokenService } from '@/lib/crypto/preview-token';
import { EngineError, createExecutor, resetGracefulStop, type ExecutorFlags } from '@/lib/engine/executor';
import { createWriteMutex } from '@/lib/engine/mutex';
import { buildPreview } from '@/lib/engine/preview';
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

function shopClient(opts: { writeTimeoutMs?: number } = {}) {
  return createShopClient({
    baseUrl: () => mock.baseUrl,
    version: '0.1.0-test',
    readTimeoutMs: 2000,
    writeTimeoutMs: opts.writeTimeoutMs ?? 1000,
    policy: { maxAttempts: 3, backoffMs: [5, 5, 5], retryAfterCapSeconds: 1 },
  });
}

interface WorldOptions {
  productIds?: number[];
  percent?: number;
  from?: string;
  to?: string;
  apiKey?: string | null;
  confirm?: boolean;
  seededWrites?: number;
  flags?: Partial<ExecutorFlags>;
  writeTimeoutMs?: number;
}

function makeWorld(opts: WorldOptions = {}) {
  const productIds = opts.productIds ?? [201, 202, 203];
  const percent = opts.percent ?? 15;
  const from = opts.from ?? day(1);
  const to = opts.to ?? day(10);

  mock.state.setProducts(
    productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );

  const world = createMemoryCampaignWorld();
  const settingsRepo = createMemorySettingsRepo();
  const allowlistRepo = createMemoryAllowlistRepo(productIds);
  const audit = createMemoryAudit();
  if (opts.seededWrites) audit.seedWrites(opts.seededWrites);
  const apiKeyRepo = createMemoryApiKeyRepo(opts.apiKey === undefined ? VALID_API_KEY : opts.apiKey);
  const mutex = createWriteMutex({ dbLock: null });

  const confirm = opts.confirm ?? true;
  const campaign: CampaignRecord = {
    ...makeCampaign({ productIds, percent, status: 'scheduled' }),
    dateFrom: from,
    dateTo: to,
    confirmedAt: confirm ? new Date() : null,
    sudoAt: confirm ? new Date() : null,
    confirmPayloadHash: confirm
      ? computePayloadHash({ kind: 'new', productIds, percent, from, to })
      : null,
  };
  world.seedCampaign(
    campaign,
    productIds.map((productId) => ({ productId, priceAtPreview: '19.99' })),
  );

  const executor = createExecutor({
    shopClient: shopClient({
      ...(opts.writeTimeoutMs !== undefined ? { writeTimeoutMs: opts.writeTimeoutMs } : {}),
    }),
    campaignsRepo: world.campaignsRepo,
    campaignItemsRepo: world.campaignItemsRepo,
    allowlistRepo,
    settingsRepo,
    auditRepo: audit,
    apiKeyRepo,
    audit,
    mutex,
    flags: { ...FLAGS, ...(opts.flags ?? {}) },
  });

  return { executor, world, settingsRepo, allowlistRepo, audit, apiKeyRepo, mutex, campaign };
}

beforeEach(() => {
  resetGracefulStop();
});

describe('executor — šťastná cesta', () => {
  it('zapíše celú dávku sekvenčne a kampaň skončí done', async () => {
    const { executor, audit, world } = makeWorld();
    const result = await executor.executeCampaign(1);

    expect(result.status).toBe('done');
    expect(result.itemsOk).toBe(3);
    expect(mock.state.writeRequests()).toHaveLength(3);
    // D48 — pred každým zápisom pre-write GET.
    expect(mock.state.requestsTo('/api/products/get')).toHaveLength(3);
    // Mock si zľavu naozaj zapamätal.
    expect(mock.state.getProduct(201)?.lastReduction?.reduction).toBe(15);
    expect(audit.byEvent('write_ok')).toHaveLength(3);
    expect(audit.byEvent('campaign_finished')).toHaveLength(1);
    expect(world.campaignsRepo.campaigns.get(1)?.status).toBe('done');
    expect(world.campaignsRepo.campaigns.get(1)?.resultAckAt).toBeNull();
  });
});

describe('D34 — čiastočné zlyhanie dávku nezastaví', () => {
  it('zlyhanie 3. produktu nezastaví zvyšok, kampaň skončí partial', async () => {
    const productIds = [201, 202, 203, 204, 205];
    const { executor, world } = makeWorld({ productIds });
    // 3. zápis zlyhá 500 vo všetkých 3 pokusoch retry politiky.
    mock.state.failNth(3, 'server_error', { target: 'write', times: 3 });

    const result = await executor.executeCampaign(1);

    expect(result.status).toBe('partial');
    expect(result.itemsOk).toBe(4);
    expect(result.itemsFailed).toBe(1);
    const items = await world.campaignItemsRepo.listByCampaign(1);
    expect(items.map((i) => i.status)).toEqual(['ok', 'ok', 'failed', 'ok', 'ok']);
  });
});

describe('D49 — not_found blokuje len daný produkt', () => {
  it('produkt zmiznutý zo shopu sa označí v allowliste a dávka pokračuje', async () => {
    const { executor, world, allowlistRepo, audit } = makeWorld({ productIds: [201, 202, 203] });
    mock.state.removeProduct(202);

    const result = await executor.executeCampaign(1);

    expect(result.status).toBe('partial');
    const items = await world.campaignItemsRepo.listByCampaign(1);
    expect(items.map((i) => i.status)).toEqual(['ok', 'not_found', 'ok']);
    expect(allowlistRepo.shopStatuses.get(202)?.status).toBe('not_found');
    expect(audit.byEvent('allowlist_marked_unknown')).toHaveLength(1);
    // Zápis 202 sa NIKDY neodoslal.
    const writtenIds = mock.state.writeRequests().map((r) => r.body.id);
    expect(writtenIds).toEqual(['201', '203']);
  });
});

describe('D51/D52 — 401/403 uprostred dávky', () => {
  it('401 wipne kľúč, zvyšok je interrupted a kampaň prejde do needs_key', async () => {
    const { executor, world, apiKeyRepo, audit } = makeWorld({ productIds: [201, 202, 203] });
    // Požiadavky: 1=GET(201), 2=WRITE(201), 3=GET(202), 4+=401 → zápis 202 padne.
    mock.state.unauthorizedAfter(3);

    const result = await executor.executeCampaign(1);

    expect(result.status).toBe('needs_key');
    expect(apiKeyRepo.plaintext).toBeNull();
    expect(apiKeyRepo.wipedWith).toEqual(['http_401']);
    const items = await world.campaignItemsRepo.listByCampaign(1);
    expect(items.map((i) => i.status)).toEqual(['ok', 'failed', 'interrupted']);
    expect(world.campaignsRepo.campaigns.get(1)?.status).toBe('needs_key');
    expect(audit.byEvent('campaign_needs_key')).toHaveLength(1);
    // Po 401 už na shop nesmel odísť ďalší zápis (produkt 203).
    const writtenIds = mock.state.writeRequests().map((r) => r.body.id);
    expect(writtenIds).not.toContain('203');
  });

  it('403 má rovnaký účinok s dôvodom key_forbidden (D52)', async () => {
    const { executor, apiKeyRepo, world } = makeWorld({ productIds: [201, 202] });
    mock.state.failNth(2, 'forbidden', { target: 'write', times: 1 });

    const result = await executor.executeCampaign(1);

    expect(result.status).toBe('needs_key');
    expect(apiKeyRepo.wipedWith).toEqual(['http_403']);
    expect(world.campaignsRepo.campaigns.get(1)?.statusReason).toBe('key_forbidden');
  });
});

describe('D45 — timeout po odoslaní', () => {
  it('pošle presne jeden identický resend a rozhodne podľa druhej odpovede', async () => {
    const { executor, world } = makeWorld({ productIds: [201], writeTimeoutMs: 300 });
    mock.state.failNth(1, 'hang', { target: 'write', times: 1 });

    const result = await executor.executeCampaign(1);

    const writes = mock.state.writeRequests();
    expect(writes).toHaveLength(2); // originál + PRESNE jeden resend
    expect(writes[0]!.rawBody).toBe(writes[1]!.rawBody); // identický payload
    expect(result.status).toBe('done'); // druhá odpoveď bola OK
    const items = await world.campaignItemsRepo.listByCampaign(1);
    expect(items[0]!.status).toBe('ok');
  });
});

describe('I3 — bez potvrdenia žiadny request', () => {
  it('kampaň bez confirm_payload_hash je odmietnutá a mock nevidí NIČ', async () => {
    const { executor } = makeWorld({ confirm: false });
    await expect(executor.executeCampaign(1)).rejects.toMatchObject({
      name: 'EngineError',
      code: 'confirmation_missing',
    });
    expect(mock.state.requestCount).toBe(0);
  });

  it('potvrdenie inej sady parametrov (podvrhnutý hash) je odmietnuté', async () => {
    const { executor, world } = makeWorld();
    const campaign = world.campaignsRepo.campaigns.get(1)!;
    campaign.confirmPayloadHash = computePayloadHash({
      kind: 'new',
      productIds: [201, 202, 203],
      percent: 30, // iné percento než potvrdené
      from: campaign.dateFrom,
      to: campaign.dateTo,
    });
    await expect(executor.executeCampaign(1)).rejects.toMatchObject({
      code: 'confirmation_mismatch',
    });
    expect(mock.state.requestCount).toBe(0);
  });
});

describe('D21 — chýbajúci kľúč', () => {
  it('kampaň prejde do needs_key (nie failed) a mock nevidí nič', async () => {
    const { executor, world } = makeWorld({ apiKey: null });
    const result = await executor.executeCampaign(1);
    expect(result.status).toBe('needs_key');
    expect(world.campaignsRepo.campaigns.get(1)?.status).toBe('needs_key');
    expect(world.campaignsRepo.campaigns.get(1)?.statusReason).toBe('no_key');
    expect(mock.state.requestCount).toBe(0);
  });
});

describe('I13 — env poistky', () => {
  it('mimo produkcie je zápis odmietnutý pred prvým requestom', async () => {
    const { executor } = makeWorld({ flags: { nodeEnv: 'test' } });
    await expect(executor.executeCampaign(1)).rejects.toBeInstanceOf(EngineError);
    expect(mock.state.requestCount).toBe(0);
  });
});

describe('D37/I12 — mutex', () => {
  it('druhá súbežná dávka sa odmietne, nečaká', async () => {
    const { executor, mutex } = makeWorld();
    const held = await mutex.tryAcquire('iny-beh');
    expect(held).not.toBeNull();
    await expect(executor.executeCampaign(1)).rejects.toMatchObject({
      code: 'write_in_progress',
    });
    expect(mock.state.requestCount).toBe(0);
    await held!.release();
  });
});

describe('D85 — SIGTERM počas dávky', () => {
  it('dobehne aktuálny produkt, zvyšok označí interrupted', async () => {
    const { executor, world, audit } = makeWorld({ productIds: [201, 202, 203] });
    // Stop signál „príde" počas prvého zápisu — loop ho vidí pred 2. položkou.
    const executorWithStop = createExecutor({
      shopClient: shopClient(),
      campaignsRepo: world.campaignsRepo,
      campaignItemsRepo: world.campaignItemsRepo,
      allowlistRepo: createMemoryAllowlistRepo([201, 202, 203]),
      settingsRepo: createMemorySettingsRepo(),
      auditRepo: audit,
      apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
      audit,
      mutex: createWriteMutex({ dbLock: null }),
      flags: FLAGS,
      isStopping: () => audit.byEvent('write_ok').length >= 1,
    });
    void executor;

    const result = await executorWithStop.executeCampaign(1);

    // Prvý produkt DOBEHOL (mock ho má zapísaný), zvyšok je interrupted.
    expect(mock.state.writeRequests()).toHaveLength(1);
    expect(mock.state.getProduct(201)?.lastReduction?.reduction).toBe(15);
    const items = await world.campaignItemsRepo.listByCampaign(1);
    expect(items.map((i) => i.status)).toEqual(['ok', 'interrupted', 'interrupted']);
    expect(result.status).toBe('partial');
  });
});

describe('reconcile po havárii (D86)', () => {
  it('write_ok z auditu potvrdí položku, ostatné sú uncertain, bez re-runu', async () => {
    const { reconcileRunningCampaigns } = await import('@/lib/engine/reconcile');
    const { executor, world, audit } = makeWorld({ productIds: [201, 202, 203] });
    void executor;

    // Simulácia havárie: kampaň zostala running, položka 201 má potvrdený
    // write_ok v audite, 202/203 zostali pending.
    const campaign = world.campaignsRepo.campaigns.get(1)!;
    campaign.status = 'running';
    campaign.finishedAt = null;
    const items = await world.campaignItemsRepo.listByCampaign(1);
    await world.campaignItemsRepo.update(items[0]!.id, { requestId: 'REQCONFIRMED0000000000000' });
    audit.records.push({
      actor: 'user',
      eventType: 'write_ok',
      ok: true,
      campaignId: 1,
      productId: 201,
      requestId: 'REQCONFIRMED0000000000000',
    });

    const report = await reconcileRunningCampaigns({
      campaignsRepo: world.campaignsRepo,
      campaignItemsRepo: world.campaignItemsRepo,
      auditRepo: audit,
      audit,
    });

    expect(report).toMatchObject({ campaigns: 1, confirmedItems: 1, uncertainItems: 2 });
    const settled = await world.campaignItemsRepo.listByCampaign(1);
    expect(settled.map((i) => i.status)).toEqual(['ok', 'uncertain', 'uncertain']);
    expect(world.campaignsRepo.campaigns.get(1)?.status).toBe('partial');
    expect(audit.byEvent('reconcile_uncertain')).toHaveLength(1);
    // Automatický re-run NEPREBEHOL — na shop nič neodišlo.
    expect(mock.state.requestCount).toBe(0);
  });
});

describe('dry-run náhľad (preview, O2/D39c)', () => {
  it('zostaví položky s cenami a vydá jednorazový token nad tou istou sadou', async () => {
    const productIds = [201, 202];
    mock.state.setProducts(
      productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 10, has_attributes: id === 202 })),
    );
    const allowlistRepo = createMemoryAllowlistRepo(productIds);
    const world = createMemoryCampaignWorld();
    const tokens = createPreviewTokenService({ secret: Buffer.alloc(32, 7) });

    const input = {
      userId: 1,
      kind: 'new' as const,
      productIds,
      percent: 10,
      from: day(1),
      to: day(5),
    };
    const preview = await buildPreview(
      input,
      {
        shopClient: shopClient(),
        allowlistRepo: allowlistRepo as never,
        campaignsRepo: world.campaignsRepo as never,
        catalogRepo: null,
        previewTokens: tokens,
      },
      newOperationContext(),
    );

    expect(preview.blockers).toEqual([]);
    expect(preview.previewToken).not.toBe('');
    expect(preview.items).toHaveLength(2);
    expect(preview.items[0]).toMatchObject({
      productId: 201,
      price: '10.00',
      discountedPrice: '9.00',
      reductionUnverifiable: true,
    });
    expect(preview.warnings.hasAttributes).toEqual([202]);

    // Token sedí na sadu a je JEDNORAZOVÝ (I3).
    const claims = await tokens.verify(preview.previewToken, {
      kind: 'new',
      productIds,
      percent: 10,
      from: input.from,
      to: input.to,
    });
    expect(claims.pricesAtPreview).toEqual({ '201': '10.00', '202': '10.00' });
    await expect(
      tokens.verify(preview.previewToken, {
        kind: 'new',
        productIds,
        percent: 10,
        from: input.from,
        to: input.to,
      }),
    ).rejects.toMatchObject({ code: 'replayed' });

    // Dry-run NIKDY nezapisuje.
    expect(mock.state.writeRequests()).toHaveLength(0);
  });

  it('produkt mimo allowlistu je blokátor a token sa nevydá (I2, fail-closed)', async () => {
    const allowlistRepo = createMemoryAllowlistRepo([201]);
    const world = createMemoryCampaignWorld();
    const tokens = createPreviewTokenService({ secret: Buffer.alloc(32, 7) });
    const preview = await buildPreview(
      { userId: 1, kind: 'new', productIds: [201, 999], percent: 10, from: day(1), to: day(5) },
      {
        shopClient: shopClient(),
        allowlistRepo: allowlistRepo as never,
        campaignsRepo: world.campaignsRepo as never,
        catalogRepo: null,
        previewTokens: tokens,
      },
      newOperationContext(),
    );
    expect(preview.previewToken).toBe('');
    expect(preview.blockers.length).toBeGreaterThan(0);
  });
});
