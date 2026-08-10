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

import { ApiKeyError } from '@/lib/repo/api-key.repo';

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
  // K2 — rozpočet je tu dosť veľký na to, aby dávku nezastavil; frontu
  // a jej vyčerpanie testuje `fronta-rozpocet.spec.ts`.
  dailyWriteBudget: 200,
  // Pauza ≥ 3 s je injektovaná závislosť (K2) — inak by test bežal minúty.
  writePauseMs: 5,
};

/**
 * K3 — percento zápisu je na POLOŽKE (`campaign_items.percent`), rozhodnuté
 * pri potvrdení. `createMemoryCampaignWorld()` (A9) ho zatiaľ neseje, takže ho
 * testy dopĺňajú tu. Executor ho z hlavičky kampane NIKDY nedopočíta —
 * položka bez percenta sa zámerne nezapíše.
 */
function setItemPercents(
  world: ReturnType<typeof createMemoryCampaignWorld>,
  percent: number,
): void {
  for (const item of world.campaignItemsRepo.items.values()) {
    Object.assign(item, { percent });
  }
}

/** Rozpočet, ktorý sa v týchto testoch nikdy neminie (K2). */
const roomyBudget = {
  async spentToday() {
    return 0;
  },
  async remainingToday() {
    return {
      day: '2026-08-10',
      budget: 200,
      spent: 0,
      remaining: 200,
      exhausted: false,
    };
  },
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
    // K4 — hash nad SKUTOČNÝMI trojicami `id:percent:price` (nie nad hlavičkou).
    confirmPayloadHash: confirm
      ? computePayloadHash({
          kind: 'new',
          from,
          to,
          items: productIds.map((productId) => ({
            productId,
            percent,
            priceAtPreview: '19.99' as const,
          })),
        })
      : null,
  };
  world.seedCampaign(
    campaign,
    productIds.map((productId) => ({ productId, priceAtPreview: '19.99' })),
  );
  setItemPercents(world, percent);

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
    budget: roomyBudget,
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
      from: campaign.dateFrom,
      to: campaign.dateTo,
      items: [201, 202, 203].map((productId) => ({
        productId,
        percent: 30, // iné percento než potvrdené
        priceAtPreview: '19.99' as const,
      })),
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
      budget: roomyBudget,
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

  it("kind='overwrite' bez parentCampaignId neblokuje okno dobehnutej kampane (D28)", async () => {
    const productIds = [201];
    mock.state.setProducts([{ id: 201, name: 'Šperk 201', price: 10, has_attributes: false }]);
    const allowlistRepo = createMemoryAllowlistRepo(productIds);
    const tokens = createPreviewTokenService({ secret: Buffer.alloc(32, 7) });
    const overlapping: CampaignRecord = {
      ...makeCampaign({ id: 77, status: 'done', productIds }),
      dateFrom: day(1),
      dateTo: day(5),
    };
    const campaignsRepo = {
      async lastOwnWrite() {
        return null;
      },
      async findFutureOverlaps() {
        return [overlapping];
      },
    };
    const previewDeps = {
      shopClient: shopClient(),
      allowlistRepo: allowlistRepo as never,
      campaignsRepo,
      catalogRepo: null,
      previewTokens: tokens,
    };
    const inputBase = { userId: 1, productIds, percent: 10, from: day(1), to: day(5) };

    // Explicitný prepis dobehnutej (done) kampane NIE JE blokovaný — presne
    // na to `kind='overwrite'` existuje; UI parentCampaignId neposiela.
    const overwrite = await buildPreview(
      { ...inputBase, kind: 'overwrite' as const },
      previewDeps,
      newOperationContext(),
    );
    expect(overwrite.blockers).toEqual([]);
    expect(overwrite.previewToken).not.toBe('');

    // `kind='new'` na tom istom okne zostáva blokovaný (D28).
    const asNew = await buildPreview(
      { ...inputBase, kind: 'new' as const },
      previewDeps,
      newOperationContext(),
    );
    expect(asNew.blockers.some((b) => b.code === 'future_overlap')).toBe(true);
    expect(asNew.previewToken).toBe('');

    // Prekryv s kampaňou, ktorá ešte LEN zapíše, blokuje aj prepis.
    overlapping.status = 'scheduled';
    const overwriteVsScheduled = await buildPreview(
      { ...inputBase, kind: 'overwrite' as const },
      previewDeps,
      newOperationContext(),
    );
    expect(overwriteVsScheduled.blockers.some((b) => b.code === 'future_overlap')).toBe(true);
    expect(overwriteVsScheduled.previewToken).toBe('');
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


/** Deň v logickej zóne (Europe/Bratislava) — pre posun `date_from` na „dnes". */
const zonedDay = (offset: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

describe('D25 — dopálenie s posunutým date_from (relight po zadaní kľúča)', () => {
  it('potvrdenie nad pôvodným from (date_from_original) prejde a dávka sa zapíše', async () => {
    const originalFrom = zonedDay(-3);
    const { executor, world } = makeWorld({ from: originalFrom, to: day(10) });

    // Stav po posune D25 (scheduler/relight): from → dnes, pôvodné from
    // v date_from_original, confirm_payload_hash stále nad pôvodným from.
    const campaign = world.campaignsRepo.campaigns.get(1)!;
    campaign.status = 'needs_key';
    campaign.dateFrom = zonedDay(0);
    campaign.dateFromOriginal = originalFrom;

    const result = await executor.executeCampaign(1);

    // Pred opravou: confirmation_mismatch navždy — kampaň sa nedala dopáliť.
    expect(result.status).toBe('done');
    expect(mock.state.writeRequests()).toHaveLength(3);
  });

  it('podvrhnutá sada neprejde ani s date_from_original (I3 sa neoslabuje)', async () => {
    const originalFrom = zonedDay(-3);
    const { executor, world } = makeWorld({ from: originalFrom, to: day(10) });
    const campaign = world.campaignsRepo.campaigns.get(1)!;
    campaign.status = 'needs_key';
    campaign.dateFrom = zonedDay(0);
    campaign.dateFromOriginal = originalFrom;

    // K3/K4 — potvrdenie sa počíta z trojíc `id:percent:price` na POLOŽKÁCH,
    // takže podvrh sa robí tam. (Pred V3 sa menilo `campaign.percent`; to už
    // do hashu nevstupuje a do shopu nešlo nikdy — viď test nižšie.)
    const [first] = [...world.campaignItemsRepo.items.values()];
    Object.assign(first as object, { percent: 30 });

    await expect(executor.executeCampaign(1)).rejects.toMatchObject({
      code: 'confirmation_mismatch',
    });
    expect(mock.state.requestCount).toBe(0);
  });
});

describe('K3 — hlavičkové percento kampane nie je zdroj pravdy', () => {
  it('zmena campaigns.percent nezmení hash ani to, čo sa zapíše', async () => {
    const { executor, world } = makeWorld({ productIds: [201, 202], percent: 15 });

    // `campaigns.percent` je len hlavička pre zoznamy (najvyššie percento
    // pásiem). Executor ju nepoužíva ani na hash, ani na zápis — nesmie teda
    // ovplyvniť nič, čo odíde do shopu.
    const campaign = world.campaignsRepo.campaigns.get(1)!;
    campaign.percent = 30;

    const result = await executor.executeCampaign(1);

    expect(result.status).toBe('done');
    expect(mock.state.writeRequests().map((r) => r.body.reduction)).toEqual(['15', '15']);
  });
});

describe('dopálenie z needs_key — interrupted položky sa dopíšu (E3)', () => {
  it('claim z needs_key vráti interrupted na pending a položka sa zapíše', async () => {
    const { executor, world, audit } = makeWorld({ productIds: [201, 202, 203] });

    // Stav po 401 wipe uprostred dávky (D51): 201 ok, 202 failed, 203 interrupted.
    const campaign = world.campaignsRepo.campaigns.get(1)!;
    campaign.status = 'needs_key';
    const seeded = [...world.campaignItemsRepo.items.values()];
    seeded[0]!.status = 'ok';
    seeded[1]!.status = 'failed';
    seeded[2]!.status = 'interrupted';

    const result = await executor.executeCampaign(1);

    // Pred opravou: 203 zostal interrupted, mock nedostal NIČ a kampaň sa
    // uzavrela partial s nulou nových zápisov.
    const after = await world.campaignItemsRepo.listByCampaign(1);
    expect(after.map((i) => i.status)).toEqual(['ok', 'failed', 'ok']);
    expect(mock.state.writeRequests().map((r) => r.body.id)).toEqual(['203']);
    expect(result.status).toBe('partial');
    const claimAudit = audit.byEvent('campaign_claimed');
    expect(claimAudit).toHaveLength(1);
    expect(claimAudit[0]?.message).toContain('prerušených');
  });
});

describe('kľúč expiruje uprostred dávky — ApiKeyError nie je sieťová chyba (E4)', () => {
  it('žiadne retry/backoff: zvyšok interrupted a kampaň needs_key', async () => {
    const productIds = [201, 202, 203];
    mock.state.setProducts(
      productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
    );

    const world = createMemoryCampaignWorld();
    const audit = createMemoryAudit();
    const from = day(1);
    const to = day(10);
    const campaign: CampaignRecord = {
      ...makeCampaign({ productIds, percent: 15, status: 'scheduled' }),
      dateFrom: from,
      dateTo: to,
      confirmedAt: new Date(),
      sudoAt: new Date(),
      confirmPayloadHash: computePayloadHash({
        kind: 'new',
        from,
        to,
        items: productIds.map((productId) => ({
          productId,
          percent: 15,
          priceAtPreview: '19.99' as const,
        })),
      }),
    };
    world.seedCampaign(
      campaign,
      productIds.map((productId) => ({ productId, priceAtPreview: '19.99' })),
    );
    setItemPercents(world, 15);

    // Kľúč, ktorý po prvom použití „expiruje": ďalšie dešifrovanie hodí
    // ApiKeyError presne ako produkčný repozitár (D63, TTL wipe).
    let keyLoads = 0;
    const expiringApiKeyRepo = {
      async loadForUse() {
        return async () => {
          keyLoads += 1;
          if (keyLoads > 1) {
            throw new ApiKeyError('expired', 'API kľúč expiroval (TTL 48 h) — zadaj nový v UI (R2).');
          }
          const buffer = Buffer.from(VALID_API_KEY, 'utf8');
          return {
            value: buffer,
            release() {
              buffer.fill(0);
            },
          };
        };
      },
      async wipe() {
        return true;
      },
      async touchLastUsed() {},
    };

    const executor = createExecutor({
      shopClient: shopClient(),
      campaignsRepo: world.campaignsRepo,
      campaignItemsRepo: world.campaignItemsRepo,
      allowlistRepo: createMemoryAllowlistRepo(productIds),
      settingsRepo: createMemorySettingsRepo(),
      auditRepo: audit,
      apiKeyRepo: expiringApiKeyRepo,
      audit,
      mutex: createWriteMutex({ dbLock: null }),
      budget: roomyBudget,
      flags: FLAGS,
    });

    const result = await executor.executeCampaign(1);

    // Pred opravou: ApiKeyError → „network" → 3× backoff na KAŽDÚ položku
    // a kampaň failed/partial namiesto needs_key.
    expect(result.status).toBe('needs_key');
    expect(world.campaignsRepo.campaigns.get(1)?.status).toBe('needs_key');
    expect(world.campaignsRepo.campaigns.get(1)?.statusReason).toBe('key_unavailable');
    const items = await world.campaignItemsRepo.listByCampaign(1);
    expect(items.map((i) => i.status)).toEqual(['ok', 'interrupted', 'interrupted']);
    // Presne 1 zápis odišiel a kľúč sa skúšal presne 2× — ŽIADNY retry.
    expect(mock.state.writeRequests().map((r) => r.body.id)).toEqual(['201']);
    expect(keyLoads).toBe(2);
  });
});
