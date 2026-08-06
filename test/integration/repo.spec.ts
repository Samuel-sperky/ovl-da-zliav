/**
 * Aura Zľavy — integračné testy repozitárov (A8, BUILD-SPEC §12).
 *
 * Beží proti testovacej MariaDB s migráciami z A0 (`test/helpers/db.ts`).
 * Overuje akceptačné kritériá A8:
 *  - `allowlist.addProduct()` pri 10 obsadených slotoch zlyhá doménovou chybou
 *    `allowlist_full` a odobranie slot uvoľní (I2),
 *  - `campaigns.claim()` — dva paralelné claimy uspejú presne raz (D84, I12),
 *  - `settings` a `scheduler_state` sa správajú ako singleton,
 *  - žiadny repozitár nezapisuje do `audit_log` (I4).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closePool } from '@/db/pool';
import { allowlistRepo } from '@/lib/repo/allowlist.repo';
import { campaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepo } from '@/lib/repo/campaigns.repo';
import { catalogRepo } from '@/lib/repo/catalog.repo';
import { schedulerStateRepo } from '@/lib/repo/scheduler-state.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { computeReminders } from '@/lib/scheduler/reminders';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { makeCreateCampaignInput, testDay, testUlid } from '../helpers/factories';

const available = await dbAvailable();

/** Admin pre `campaigns.created_by` (FK). Hash je fake — testy sa neprihlasujú. */
async function seedUser(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const result = (await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      ['samuel-test', '$argon2id$fake-hash-for-tests'],
    )) as { insertId?: number | bigint };
    return Number(result.insertId ?? 0);
  });
}

async function auditLogCount(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const rows = (await conn.query('SELECT COUNT(*) AS total FROM audit_log')) as Array<{
      total: number | bigint;
    }>;
    return Number(rows[0]?.total ?? 0);
  });
}

describe.skipIf(!available)('repozitáre (A8)', () => {
  let userId = 0;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedUser();
  });

  afterAll(async () => {
    await closePool();
  });

  /* ─────────────────────────── settings singleton ─────────────────────── */

  describe('settings.repo', () => {
    it('get() vracia singleton a nikdy nevytvorí druhý riadok', async () => {
      const first = await settingsRepo.get();
      expect(first.id).toBe(1);
      await settingsRepo.get();
      await settingsRepo.get();
      const total = await withMigrationConn(async (conn) => {
        const rows = (await conn.query('SELECT COUNT(*) AS total FROM settings')) as Array<{
          total: number | bigint;
        }>;
        return Number(rows[0]?.total ?? 0);
      });
      expect(total).toBe(1);
    });

    it('lockWrites()/unlockWrites() je fail-closed runaway zámok (D79)', async () => {
      await settingsRepo.lockWrites('runaway: 61 zápisov za hodinu');
      let s = await settingsRepo.get();
      expect(s.writesLocked).toBe(true);
      expect(s.writesLockedReason).toBe('runaway: 61 zápisov za hodinu');
      expect(s.writesLockedAt).toBeInstanceOf(Date);

      await settingsRepo.unlockWrites();
      s = await settingsRepo.get();
      expect(s.writesLocked).toBe(false);
      expect(s.writesLockedReason).toBeNull();
      expect(s.writesLockedAt).toBeNull();
    });

    it('setShopDomain() a markOnboardingDone() zapisujú do riadku 1', async () => {
      const confirmedAt = new Date('2026-08-01T10:00:00.000Z');
      await settingsRepo.setShopDomain('https://shop.example.test', confirmedAt);
      await settingsRepo.setEagerWriteDefault(false);
      await settingsRepo.markOnboardingDone();
      const s = await settingsRepo.get();
      expect(s.shopDomain).toBe('https://shop.example.test');
      expect(s.shopDomainConfirmedAt?.toISOString()).toBe(confirmedAt.toISOString());
      expect(s.eagerWriteDefault).toBe(false);
      expect(s.onboardingDoneAt).toBeInstanceOf(Date);
    });
  });

  /* ───────────────────────── scheduler_state singleton ────────────────── */

  describe('scheduler-state.repo', () => {
    it('heartbeat() inkrementuje tick_count v jedinom riadku', async () => {
      await schedulerStateRepo.heartbeat(120, null);
      await schedulerStateRepo.heartbeat(80, 'shop nedostupný');
      const state = await schedulerStateRepo.get();
      expect(state.id).toBe(1);
      expect(state.tickCount).toBe(2);
      expect(state.lastTickDurationMs).toBe(80);
      expect(state.lastError).toBe('shop nedostupný');
      expect(state.lastTickAt).toBeInstanceOf(Date);

      const total = await withMigrationConn(async (conn) => {
        const rows = (await conn.query('SELECT COUNT(*) AS total FROM scheduler_state')) as Array<{
          total: number | bigint;
        }>;
        return Number(rows[0]?.total ?? 0);
      });
      expect(total).toBe(1);
    });
  });

  /* ──────────────────────────── allowlist (I2) ────────────────────────── */

  describe('allowlist.repo', () => {
    it('11. produkt zlyhá doménovou chybou allowlist_full a odobranie slot uvoľní (I2)', async () => {
      for (let i = 1; i <= 10; i += 1) {
        const record = await allowlistRepo.addProduct(100 + i, `Produkt ${i}`);
        expect(record.slot).toBe(i);
      }
      await expect(allowlistRepo.addProduct(111, 'Jedenásty')).rejects.toMatchObject({
        name: 'AllowlistError',
        code: 'allowlist_full',
      });

      // Odobranie uvoľní slot…
      expect(await allowlistRepo.removeProduct(103)).toBe(true);
      const active = await allowlistRepo.listActive();
      expect(active).toHaveLength(9);

      // …a nový produkt dostane presne ten uvoľnený slot 3.
      const replacement = await allowlistRepo.addProduct(111, 'Jedenásty');
      expect(replacement.slot).toBe(3);
      expect((await allowlistRepo.listActive())).toHaveLength(10);
    });

    it('duplicitný aktívny produkt sa odmietne (nezožerie slot)', async () => {
      await allowlistRepo.addProduct(201, null);
      await expect(allowlistRepo.addProduct(201, null)).rejects.toMatchObject({
        code: 'already_listed',
      });
      expect(await allowlistRepo.listActive()).toHaveLength(1);
    });

    it('removeProduct() neaktívneho produktu vracia false a históriu nemaže', async () => {
      await allowlistRepo.addProduct(301, null);
      expect(await allowlistRepo.removeProduct(301)).toBe(true);
      expect(await allowlistRepo.removeProduct(301)).toBe(false);
      const all = await allowlistRepo.listAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.removedAt).toBeInstanceOf(Date);
      expect(all[0]?.slot).toBeNull();
    });

    it('areAllActive() je fail-closed (I2, R1)', async () => {
      await allowlistRepo.addProduct(401, null);
      await allowlistRepo.addProduct(402, null);
      expect(await allowlistRepo.areAllActive([401, 402])).toBe(true);
      expect(await allowlistRepo.areAllActive([401, 999])).toBe(false);
      expect(await allowlistRepo.areAllActive([])).toBe(false);
      expect(await allowlistRepo.areAllActive([0])).toBe(false);
      await allowlistRepo.removeProduct(402);
      expect(await allowlistRepo.areAllActive([401, 402])).toBe(false);
    });

    it('markShopStatus() označí len aktívny záznam (D49)', async () => {
      await allowlistRepo.addProduct(501, null);
      await allowlistRepo.markShopStatus(501, 'not_found', 'shop vrátil 404');
      const [record] = await allowlistRepo.listActive();
      expect(record?.shopStatus).toBe('not_found');
      expect(record?.statusNote).toBe('shop vrátil 404');
    });
  });

  /* ──────────────────────────── catalog cache ─────────────────────────── */

  describe('catalog.repo', () => {
    it('upsert() + get()/getMany() — cena zostáva string (§2)', async () => {
      await catalogRepo.upsert({
        productId: 601,
        name: 'Strieborný prsteň',
        price: '24.90',
        hasAttributes: true,
        source: 'get',
        raw: { id: 601, name: 'Strieborný prsteň' },
      });
      // Druhý upsert prepíše hodnoty (žiadny duplicate error).
      await catalogRepo.upsert({
        productId: 601,
        name: 'Strieborný prsteň XL',
        price: '29.90',
        hasAttributes: false,
        source: 'batch',
        raw: null,
      });
      const record = await catalogRepo.get(601);
      expect(record?.name).toBe('Strieborný prsteň XL');
      expect(record?.price).toBe('29.90');
      expect(typeof record?.price).toBe('string');
      expect(record?.source).toBe('batch');

      const many = await catalogRepo.getMany([601, 999]);
      expect(many.size).toBe(1);
      expect(many.get(601)?.productId).toBe(601);
      expect(await catalogRepo.get(999)).toBeNull();
    });
  });

  /* ─────────────────────────── campaigns + claim ──────────────────────── */

  describe('campaigns.repo', () => {
    function scheduledInput(overrides: Partial<ReturnType<typeof makeCreateCampaignInput>> = {}) {
      return makeCreateCampaignInput({
        operationId: testUlid(),
        status: 'scheduled',
        mode: 'scheduled',
        fireAt: new Date('2026-08-06T22:05:00.000Z'),
        createdBy: userId,
        ...overrides,
      });
    }

    it('create() + getById() zachová dátumy ako YYYY-MM-DD a percento ako číslo', async () => {
      const input = scheduledInput({ dateFrom: testDay(1), dateTo: testDay(5), percent: 15 });
      const created = await campaignsRepo.create(input);
      const loaded = await campaignsRepo.getById(created.id);
      expect(loaded?.dateFrom).toBe(testDay(1));
      expect(loaded?.dateTo).toBe(testDay(5));
      expect(loaded?.percent).toBe(15);
      expect(loaded?.status).toBe('scheduled');
      expect(loaded?.operationId).toBe(input.operationId);
    });

    it('findScheduled() proti reálnej DB: kampaň o 30 h → reminder pásmo 48 (D26, E5)', async () => {
      // Sentinel dátum (new Date(8.64e15)) MariaDB v `fire_at <= ?` skráti
      // s warningom a porovnanie je vždy false — preto reminderom slúži
      // findScheduled() bez dátumovej podmienky.
      const fireAt = new Date(Date.now() + 30 * 3_600_000); // o 30 h → pásmo 48
      const created = await campaignsRepo.create(
        scheduledInput({ fireAt, dateFrom: testDay(2), dateTo: testDay(9) }),
      );

      const scheduled = await campaignsRepo.findScheduled();
      expect(scheduled.map((c) => c.id)).toContain(created.id);

      const reminders = computeReminders(scheduled, new Date());
      expect(reminders.find((r) => r.campaignId === created.id)?.band).toBe(48);
    });

    it('claim() je atomický — dva paralelné claimy uspejú presne raz (D84, I12)', async () => {
      const campaign = await campaignsRepo.create(scheduledInput());
      const [a, b] = await Promise.all([
        campaignsRepo.claim(campaign.id, ['scheduled', 'needs_key']),
        campaignsRepo.claim(campaign.id, ['scheduled', 'needs_key']),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);

      const claimed = await campaignsRepo.getById(campaign.id);
      expect(claimed?.status).toBe('running');
      expect(claimed?.claimedAt).toBeInstanceOf(Date);

      // Tretí claim na už bežiacu kampaň zlyhá (affectedRows = 0).
      expect(await campaignsRepo.claim(campaign.id, ['scheduled', 'needs_key'])).toBe(false);
    });

    it('claim() mimo povolených stavov a s prázdnym zoznamom vracia false', async () => {
      const campaign = await campaignsRepo.create(scheduledInput({ status: 'draft' }));
      expect(await campaignsRepo.claim(campaign.id, ['scheduled', 'needs_key'])).toBe(false);
      expect(await campaignsRepo.claim(campaign.id, [])).toBe(false);
      expect((await campaignsRepo.getById(campaign.id))?.status).toBe('draft');
    });

    it('setStatus() zapíše status aj patch polia', async () => {
      const campaign = await campaignsRepo.create(scheduledInput());
      const finishedAt = new Date('2026-08-07T00:10:00.000Z');
      await campaignsRepo.setStatus(campaign.id, 'partial', {
        statusReason: '3. produkt zlyhal',
        finishedAt,
        itemsTotal: 10,
        itemsOk: 9,
        itemsFailed: 1,
        itemsUncertain: 0,
      });
      const loaded = await campaignsRepo.getById(campaign.id);
      expect(loaded?.status).toBe('partial');
      expect(loaded?.statusReason).toBe('3. produkt zlyhal');
      expect(loaded?.itemsOk).toBe(9);
      expect(loaded?.itemsFailed).toBe(1);
      expect(loaded?.finishedAt?.toISOString()).toBe(finishedAt.toISOString());
    });

    it('findDue()/findMissedCandidates()/findNeedsKey()/findUnacked() filtrujú podľa stavu', async () => {
      const due = await campaignsRepo.create(
        scheduledInput({ fireAt: new Date('2026-08-05T07:00:00.000Z') }),
      );
      await campaignsRepo.create(
        scheduledInput({ fireAt: new Date('2026-09-01T07:00:00.000Z') }),
      );
      const needsKey = await campaignsRepo.create(scheduledInput({ status: 'needs_key' }));

      const now = new Date('2026-08-05T08:00:00.000Z');
      const dueList = await campaignsRepo.findDue(now);
      expect(dueList.map((c) => c.id)).toEqual([due.id]);

      const missed = await campaignsRepo.findMissedCandidates(
        new Date('2026-08-05T07:55:00.000Z'),
      );
      expect(missed.map((c) => c.id)).toEqual([due.id]);

      expect((await campaignsRepo.findNeedsKey()).map((c) => c.id)).toEqual([needsKey.id]);

      await campaignsRepo.setStatus(due.id, 'failed', { finishedAt: now });
      expect((await campaignsRepo.findUnacked()).map((c) => c.id)).toEqual([due.id]);
      await campaignsRepo.ack(due.id);
      expect(await campaignsRepo.findUnacked()).toEqual([]);
    });

    it('list() stránkuje a filtruje podľa stavu aj produktu', async () => {
      const c1 = await campaignsRepo.create(scheduledInput());
      const c2 = await campaignsRepo.create(scheduledInput({ status: 'draft' }));
      await campaignItemsRepo.createMany(c1.id, [
        { productId: 701, position: 1, priceAtPreview: '10.00', hasAttributes: false },
      ]);

      const byStatus = await campaignsRepo.list({ status: 'draft' });
      expect(byStatus.total).toBe(1);
      expect(byStatus.data[0]?.id).toBe(c2.id);

      const byProduct = await campaignsRepo.list({ productId: 701 });
      expect(byProduct.total).toBe(1);
      expect(byProduct.data[0]?.id).toBe(c1.id);

      const paged = await campaignsRepo.list({ page: 2, perPage: 1 });
      expect(paged.total).toBe(2);
      expect(paged.data).toHaveLength(1);
    });

    it('findFutureOverlaps() a findPlannedForProduct() nachádzajú kampane cez položky (D28, D40)', async () => {
      const campaign = await campaignsRepo.create(
        scheduledInput({ dateFrom: testDay(2), dateTo: testDay(6) }),
      );
      await campaignItemsRepo.createMany(campaign.id, [
        { productId: 801, position: 1, priceAtPreview: null, hasAttributes: false },
      ]);

      const overlaps = await campaignsRepo.findFutureOverlaps([801], testDay(5), testDay(9));
      expect(overlaps.map((c) => c.id)).toEqual([campaign.id]);
      expect(await campaignsRepo.findFutureOverlaps([801], testDay(7), testDay(9))).toEqual([]);
      expect(await campaignsRepo.findFutureOverlaps([999], testDay(2), testDay(6))).toEqual([]);

      const planned = await campaignsRepo.findPlannedForProduct(801);
      expect(planned.map((c) => c.id)).toEqual([campaign.id]);
      expect(await campaignsRepo.findPlannedForProduct(802)).toEqual([]);
    });

    it('lastOwnWrite() vracia posledný VLASTNÝ ok zápis (I11)', async () => {
      const campaign = await campaignsRepo.create(
        scheduledInput({ percent: 20, dateFrom: testDay(0), dateTo: testDay(3) }),
      );
      await campaignItemsRepo.createMany(campaign.id, [
        { productId: 901, position: 1, priceAtPreview: '50.00', hasAttributes: false },
      ]);
      expect(await campaignsRepo.lastOwnWrite(901)).toBeNull();

      const [item] = await campaignItemsRepo.listByCampaign(campaign.id);
      const finishedAt = new Date('2026-08-05T08:30:00.000Z');
      await campaignItemsRepo.update(item!.id, { status: 'ok', finishedAt });

      const last = await campaignsRepo.lastOwnWrite(901);
      expect(last).toMatchObject({
        percent: 20,
        from: testDay(0),
        to: testDay(3),
        campaignId: campaign.id,
      });
      expect(last?.at.toISOString()).toBe(finishedAt.toISOString());
    });
  });

  /* ───────────────────────────── campaign_items ───────────────────────── */

  describe('campaign-items.repo', () => {
    it('createMany() + listByCampaign() drží deterministické poradie (I10)', async () => {
      const campaign = await campaignsRepo.create(
        makeCreateCampaignInput({ operationId: testUlid(), createdBy: userId }),
      );
      await campaignItemsRepo.createMany(campaign.id, [
        { productId: 12, position: 2, priceAtPreview: '12.00', hasAttributes: false },
        { productId: 11, position: 1, priceAtPreview: '11.00', hasAttributes: true },
        { productId: 13, position: 3, priceAtPreview: null, hasAttributes: false },
      ]);
      const items = await campaignItemsRepo.listByCampaign(campaign.id);
      expect(items.map((i) => i.productId)).toEqual([11, 12, 13]);
      expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
      expect(items[0]?.status).toBe('pending');
      expect(items[0]?.priceAtPreview).toBe('11.00');
      expect(items[0]?.reductionUnverifiable).toBe(true);
    });

    it('createMany() odmietne viac než 10 položiek (I2)', async () => {
      const campaign = await campaignsRepo.create(
        makeCreateCampaignInput({ operationId: testUlid(), createdBy: userId }),
      );
      const tooMany = Array.from({ length: 11 }, (_, i) => ({
        productId: 1000 + i,
        position: i + 1,
        priceAtPreview: null,
        hasAttributes: false,
      }));
      await expect(campaignItemsRepo.createMany(campaign.id, tooMany)).rejects.toThrow(/maximum je 10/);
    });

    it('update() zapíše výsledok zápisu vrátane price_mismatch (D39c)', async () => {
      const campaign = await campaignsRepo.create(
        makeCreateCampaignInput({ operationId: testUlid(), createdBy: userId }),
      );
      await campaignItemsRepo.createMany(campaign.id, [
        { productId: 21, position: 1, priceAtPreview: '10.00', hasAttributes: false },
      ]);
      const [item] = await campaignItemsRepo.listByCampaign(campaign.id);
      await campaignItemsRepo.update(item!.id, {
        status: 'ok',
        attemptCount: 1,
        nameAtWrite: 'Náhrdelník',
        priceAtWrite: '11.00',
        priceMismatch: true,
        requestId: testUlid(),
        httpStatus: 200,
        sentPayload: { id: 21, reduction: 10 },
        rawResponse: { success: true },
        finishedAt: new Date('2026-08-05T09:00:00.000Z'),
      });
      const [updated] = await campaignItemsRepo.listByCampaign(campaign.id);
      expect(updated?.status).toBe('ok');
      expect(updated?.priceAtWrite).toBe('11.00');
      expect(updated?.priceMismatch).toBe(true);
      expect(updated?.sentPayload).toEqual({ id: 21, reduction: 10 });
      expect(updated?.rawResponse).toEqual({ success: true });
    });

    it('update() odmietne neznáme pole patchu', async () => {
      await expect(
        campaignItemsRepo.update(1, { hackovanyStlpec: 1 } as never),
      ).rejects.toThrow(/Neznáme pole/);
    });

    it('markRemaining() označí len pending položky od pozície (D85, D51)', async () => {
      const campaign = await campaignsRepo.create(
        makeCreateCampaignInput({ operationId: testUlid(), createdBy: userId }),
      );
      await campaignItemsRepo.createMany(
        campaign.id,
        [1, 2, 3, 4].map((n) => ({
          productId: 30 + n,
          position: n,
          priceAtPreview: null,
          hasAttributes: false,
        })),
      );
      const items = await campaignItemsRepo.listByCampaign(campaign.id);
      await campaignItemsRepo.update(items[0]!.id, { status: 'ok' });
      await campaignItemsRepo.update(items[1]!.id, { status: 'failed' });

      await campaignItemsRepo.markRemaining(campaign.id, 2, 'interrupted', 'kľúč wipnutý po 401');
      const after = await campaignItemsRepo.listByCampaign(campaign.id);
      expect(after.map((i) => i.status)).toEqual(['ok', 'failed', 'interrupted', 'interrupted']);
      expect(after[2]?.errorMessage).toBe('kľúč wipnutý po 401');
      expect(after[2]?.finishedAt).toBeInstanceOf(Date);
    });
  });

  /* ─────────────────────────────── I4 kontrola ────────────────────────── */

  it('žiadny repozitár nezapisuje do audit_log (I4)', async () => {
    const before = await auditLogCount();

    await settingsRepo.get();
    await settingsRepo.lockWrites('test');
    await settingsRepo.unlockWrites();
    await schedulerStateRepo.heartbeat(1, null);
    await allowlistRepo.addProduct(9001, null);
    await allowlistRepo.removeProduct(9001);
    await catalogRepo.upsert({
      productId: 9001,
      name: 'x',
      price: '1.00',
      hasAttributes: false,
      source: 'list',
      raw: null,
    });
    const campaign = await campaignsRepo.create(
      makeCreateCampaignInput({ operationId: testUlid(), status: 'scheduled', createdBy: userId }),
    );
    await campaignsRepo.claim(campaign.id, ['scheduled']);
    await campaignsRepo.setStatus(campaign.id, 'done', { finishedAt: new Date() });
    await campaignItemsRepo.createMany(campaign.id, [
      { productId: 9001, position: 1, priceAtPreview: null, hasAttributes: false },
    ]);
    await campaignItemsRepo.markRemaining(campaign.id, 1, 'skipped', 'test');

    expect(await auditLogCount()).toBe(before);
  });
});
