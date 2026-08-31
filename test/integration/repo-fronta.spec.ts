/**
 * Aura Zľavy — repozitáre po KONTRAKTE V3 nad SKUTOČNOU DB (V4).
 *
 * Beží proti testovacej MariaDB s migráciami `0010`–`0012` (`test/helpers/db.ts`),
 * teda proti tej istej schéme, akú dostane produkcia — nie proti fake
 * závislosti. Práve na tomto mieste už raz agentov report zamaskoval, že
 * produkčný wiring nefunguje (pasca z CLAUDE.md), takže tu sa nič nemockuje.
 *
 * Čo sa dokazuje:
 *  - **K2** — stav `queued`, vstup do fronty, atomický claim z `queued`,
 *    počítadlá odvodené z položiek, súhrn fronty pre hlavičku.
 *  - **K5** — príznak `late` sa nastaví raz a okno (`date_to`) sa NEMENÍ (I7).
 *  - **K3** — `percent` na položke a pásma v `campaign_tiers`.
 *  - **K7/K8** — dávkový upsert katalógu, filtre, `LIMIT/OFFSET`, počty do
 *    bočného panela a priznané zamknuté filtre.
 *  - **K1** — `settings` v skutočnej DB: default `pilot`, prepnutie, rozpočet.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Queryable } from '@/contracts';

import { closePool } from '@/db/pool';
import { campaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepoV3 } from '@/lib/repo/campaigns.repo';
import { catalogRepo } from '@/lib/repo/catalog.repo';
import { settingsRepo } from '@/lib/repo/settings.repo';
import { tiersRepo } from '@/lib/repo/tiers.repo';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { makeCreateCampaignInput, testUlid } from '../helpers/factories';

const available = await dbAvailable();

/** Fixný „dnes" testov — všetky dátumové asserty sú voči tomuto dňu. */
const TODAY = '2026-08-10';

/**
 * Tabuľky, ktoré `test/helpers/db.ts` ešte nepozná (`campaign_tiers` z 0010,
 * `product_sales_daily` z 0009). Bez tohto by riadky prežili `truncateAll()`
 * a testy by si navzájom šumeli do počtov.
 */
async function cleanV3Tables(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('DELETE FROM campaign_tiers');
    await conn.query('DELETE FROM product_sales_daily');
  });
}

async function seedUser(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const result = (await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      ['samuel-fronta', '$argon2id$fake-hash-for-tests'],
    )) as { insertId?: number | bigint };
    return Number(result.insertId ?? 0);
  });
}

async function seedSales(rows: Array<{ productId: number; day: string; units: number }>): Promise<void> {
  if (rows.length === 0) return;
  await withMigrationConn(async (conn) => {
    for (const row of rows) {
      await conn.query(
        'INSERT INTO product_sales_daily (product_id, sale_day, units_sold) VALUES (?, ?, ?)',
        [row.productId, row.day, row.units],
      );
    }
  });
}

describe.skipIf(!available)('repozitáre V3 — fronta, pásma, katalóg (V4)', () => {
  let userId = 0;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    await cleanV3Tables();
    userId = await seedUser();
  });

  afterAll(async () => {
    await closePool();
  });

  /** Kampaň v DB. Vzniká ako `scheduled` a do `queued` ju posunie stavový zápis. */
  async function makeCampaign(
    overrides: { dateFrom?: string; dateTo?: string; percent?: number } = {},
  ) {
    return campaignsRepoV3.create(
      makeCreateCampaignInput({
        operationId: testUlid(),
        createdBy: userId,
        percent: overrides.percent ?? 30,
        dateFrom: overrides.dateFrom ?? '2026-09-01',
        dateTo: overrides.dateTo ?? '2026-09-30',
      }),
    );
  }

  /* ═════════════════════════ K1 — settings v DB ═════════════════════════ */

  describe('settings.repo (K1, K2)', () => {
    it('predvolený režim je `pilot` a rozpočet 200 (default migrácie)', async () => {
      const scope = await settingsRepo.readScope();
      expect(scope.mode).toBe('pilot');
      expect(scope.failClosed).toBe(false);
      expect(scope.dailyWriteBudget).toBe(200);
      expect(scope.maxProductsPerCampaign).toBe(10_000);
    });

    it('prepnutie na `plny` a späť sa uloží a prečíta', async () => {
      await settingsRepo.setScopeMode('plny');
      expect((await settingsRepo.readScope()).mode).toBe('plny');
      expect((await settingsRepo.get()).scopeMode).toBe('plny');

      // Sprísnenie je vždy voľné (K1 bod 4).
      await settingsRepo.setScopeMode('pilot');
      expect((await settingsRepo.readScope()).mode).toBe('pilot');
    });

    it('rozpočet a strop sa dajú znížiť a DB ich drží v rozsahu', async () => {
      await settingsRepo.setDailyWriteBudget(50);
      await settingsRepo.setMaxProductsPerCampaign(8000);
      const record = await settingsRepo.get();
      expect(record.dailyWriteBudget).toBe(50);
      expect(record.maxProductsPerCampaign).toBe(8000);
    });

    it('CHÝBAJÚCI riadok settings sa v DB prečíta ako `pilot` (K1 bod 1)', async () => {
      await withMigrationConn(async (conn) => {
        await conn.query('DELETE FROM settings');
      });
      const scope = await settingsRepo.readScope();
      expect(scope.mode).toBe('pilot');
      expect(scope.failClosed).toBe(true);
      // Obnova singletonu patrí `get()`, nie fail-closed čítaniu.
      expect((await settingsRepo.get()).id).toBe(1);
    });
  });

  /* ═════════════════════════ K2 — fronta kampaní ════════════════════════ */

  describe('campaigns.repo — fronta (K2)', () => {
    it('stav `queued` sa uloží a findQueued() radí podľa date_from', async () => {
      const later = await makeCampaign({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
      const sooner = await makeCampaign({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
      await campaignsRepoV3.setStatus(later.id, 'queued');
      await campaignsRepoV3.setStatus(sooner.id, 'queued');

      const queued = await campaignsRepoV3.findQueued();
      expect(queued.map((c) => c.id)).toEqual([sooner.id, later.id]);
      expect(queued[0]?.status).toBe('queued');
      expect(queued[0]?.late).toBe(false);
    });

    it('claim() z `queued` je atomický — dva paralelné claimy uspejú raz (D84)', async () => {
      const campaign = await makeCampaign();
      await campaignsRepoV3.setStatus(campaign.id, 'queued');

      const [a, b] = await Promise.all([
        campaignsRepoV3.claim(campaign.id, ['queued']),
        campaignsRepoV3.claim(campaign.id, ['queued']),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect((await campaignsRepoV3.getById(campaign.id))?.status).toBe('running');
    });

    it('vyčerpaný rozpočet vracia kampaň do `queued`, nie do `failed` (K2)', async () => {
      const campaign = await makeCampaign();
      await campaignsRepoV3.setStatus(campaign.id, 'running', { startedAt: new Date() });
      await campaignsRepoV3.setStatus(campaign.id, 'queued', {
        statusReason: 'budget_exhausted',
      });
      const loaded = await campaignsRepoV3.getById(campaign.id);
      expect(loaded?.status).toBe('queued');
      expect(loaded?.statusReason).toBe('budget_exhausted');
      // Vyčerpaný rozpočet nie je chyba, takže kampaň neplní notifikačný panel.
      expect((await campaignsRepoV3.findUnacked()).map((c) => c.id)).not.toContain(campaign.id);
    });

    it('syncCountersFromItems() počíta počítadlá z položiek, nie z inkrementov (K2)', async () => {
      const campaign = await makeCampaign();
      await campaignItemsRepo.createMany(
        campaign.id,
        [1, 2, 3, 4, 5].map((n) => ({
          productId: 7000 + n,
          position: n,
          percent: 20,
          priceAtPreview: null,
          hasAttributes: false,
        })),
      );
      const items = await campaignItemsRepo.listByCampaign(campaign.id);
      await campaignItemsRepo.update(items[0]!.id, { status: 'ok' });
      await campaignItemsRepo.update(items[1]!.id, { status: 'failed' });
      await campaignItemsRepo.update(items[2]!.id, { status: 'not_found' });
      await campaignItemsRepo.update(items[3]!.id, { status: 'uncertain' });

      await campaignsRepoV3.syncCountersFromItems(campaign.id);
      const loaded = await campaignsRepoV3.getById(campaign.id);
      expect(loaded?.itemsTotal).toBe(5);
      expect(loaded?.itemsOk).toBe(1);
      // `not_found` a `blocked` sa počítajú k neúspešným — nie k „OK" (D39c bod 4).
      expect(loaded?.itemsFailed).toBe(2);
      expect(loaded?.itemsUncertain).toBe(1);
    });
  });

  /* ═════════════════════════ K5 — meškanie fronty ═══════════════════════ */

  describe('campaigns.repo — príznak `late` (K5)', () => {
    it('kampaň s nabehnutým oknom a pending položkami je kandidát na `late`', async () => {
      const late = await makeCampaign({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
      await campaignsRepoV3.setStatus(late.id, 'queued');
      await campaignItemsRepo.createMany(late.id, [
        { productId: 8001, position: 1, percent: 30, priceAtPreview: null, hasAttributes: false },
      ]);

      const future = await makeCampaign({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
      await campaignsRepoV3.setStatus(future.id, 'queued');
      await campaignItemsRepo.createMany(future.id, [
        { productId: 8002, position: 1, percent: 30, priceAtPreview: null, hasAttributes: false },
      ]);

      const candidates = await campaignsRepoV3.findLateCandidates(TODAY);
      expect(candidates.map((c) => c.id)).toEqual([late.id]);
    });

    it('dobehnutá kampaň s nabehnutým oknom kandidátom NIE JE', async () => {
      const done = await makeCampaign({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
      await campaignsRepoV3.setStatus(done.id, 'queued');
      await campaignItemsRepo.createMany(done.id, [
        { productId: 8003, position: 1, percent: 30, priceAtPreview: null, hasAttributes: false },
      ]);
      const [item] = await campaignItemsRepo.listByCampaign(done.id);
      await campaignItemsRepo.update(item!.id, { status: 'ok' });

      expect(await campaignsRepoV3.findLateCandidates(TODAY)).toEqual([]);
    });

    it('markLate() nastaví príznak raz a okno zľavy NEMENÍ (K5, I7)', async () => {
      const campaign = await makeCampaign({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
      await campaignsRepoV3.setStatus(campaign.id, 'queued');

      expect(await campaignsRepoV3.markLate(campaign.id)).toBe(true);
      // Druhé volanie už nič nemení — tick nesmie vyrábať ďalšie udalosti.
      expect(await campaignsRepoV3.markLate(campaign.id)).toBe(false);

      const loaded = await campaignsRepoV3.getById(campaign.id);
      expect(loaded?.late).toBe(true);
      expect(loaded?.dateFrom).toBe('2026-08-01');
      expect(loaded?.dateTo).toBe('2026-08-31');
      expect(loaded?.status).toBe('queued');
    });
  });

  /* ═══════════════ K2/K3 — položky: dávky, percentá, fronta ═════════════ */

  describe('campaign-items.repo (K2, K3)', () => {
    it('1 200 položiek sa vloží po dávkach a poradie zostane deterministické (I10)', async () => {
      const campaign = await makeCampaign();
      const items = Array.from({ length: 1200 }, (_, i) => ({
        productId: 20_000 + i,
        position: i + 1,
        // Dve pásma v jednej zľave (K3): prvá tretina 30 %, zvyšok 20 %.
        percent: i < 400 ? 30 : 20,
        priceAtPreview: null,
        hasAttributes: false,
      }));

      await campaignItemsRepo.createMany(campaign.id, items);

      const counts = await campaignItemsRepo.countByStatus(campaign.id);
      expect(counts.pending).toBe(1200);

      const firstPage = await campaignItemsRepo.listPage(campaign.id, 5, 0);
      expect(firstPage.map((i) => i.position)).toEqual([1, 2, 3, 4, 5]);
      expect(firstPage.every((i) => i.percent === 30)).toBe(true);

      const laterPage = await campaignItemsRepo.listPage(campaign.id, 3, 500);
      expect(laterPage.map((i) => i.position)).toEqual([501, 502, 503]);
      expect(laterPage.every((i) => i.percent === 20)).toBe(true);
    });

    it('nextPending() berie ďalších N podľa position a hotové preskočí (K2)', async () => {
      const campaign = await makeCampaign();
      await campaignItemsRepo.createMany(
        campaign.id,
        [1, 2, 3, 4, 5].map((n) => ({
          productId: 30_000 + n,
          position: n,
          percent: 15,
          priceAtPreview: null,
          hasAttributes: false,
        })),
      );
      const all = await campaignItemsRepo.listByCampaign(campaign.id);
      await campaignItemsRepo.update(all[0]!.id, { status: 'ok' });
      await campaignItemsRepo.update(all[1]!.id, { status: 'failed' });

      const next = await campaignItemsRepo.nextPending(campaign.id, 2);
      expect(next.map((i) => i.position)).toEqual([3, 4]);

      // Druhý deň fronta pokračuje presne tam, kde skončila.
      await campaignItemsRepo.update(next[0]!.id, { status: 'ok' });
      expect((await campaignItemsRepo.nextPending(campaign.id, 10)).map((i) => i.position)).toEqual([
        4, 5,
      ]);
    });

    it('listForWrite() vráti tú istú sadu, ale DB neposiela sent_payload ani raw_response (K2)', async () => {
      const campaign = await makeCampaign();
      await campaignItemsRepo.createMany(
        campaign.id,
        [1, 2, 3].map((n) => ({
          productId: 43_000 + n,
          position: n,
          percent: 25,
          priceAtPreview: null,
          hasAttributes: false,
        })),
      );
      const seeded = await campaignItemsRepo.listByCampaign(campaign.id);
      await campaignItemsRepo.update(seeded[0]!.id, {
        status: 'ok',
        sentPayload: { id: 43_001, reduction: 25 },
        rawResponse: { success: true },
      });

      const full = await campaignItemsRepo.listByCampaign(campaign.id);
      const lean = await campaignItemsRepo.listForWrite(campaign.id);

      // Poradie aj stavy sú zhodné — ubrali sa stĺpce, nie riadky.
      expect(lean.map((i) => i.position)).toEqual([1, 2, 3]);
      expect(lean.map((i) => i.status)).toEqual(['ok', 'pending', 'pending']);

      // Blob stĺpce v DB naozaj SÚ (inak by test dokazoval prázdnu tabuľku)
      // a všetko ostatné je v ľahkom riadku znak po znaku rovnaké.
      //
      // `reference` je z porovnania vyňatá spolu s blobmi, a z toho istého
      // dôvodu (D116 / K6): ČÍTACIE dotazy ju pripájajú `LEFT JOIN`-om zo
      // zrkadla katalógu, zápisová sada zrkadlo NEPRIPÁJA — hash potvrdenia
      // (K4, I3) sa nesmie zmeniť tým, že na povrch niečo pribudlo. Že tam
      // naozaj nie je, sa tvrdí explicitne o tri riadky nižšie; plné pokrytie
      // doplnenej referencie drží `referencia-server-join.spec.ts`.
      const { sentPayload, rawResponse, reference, ...expected } = full[0]!;
      expect(sentPayload).toEqual({ id: 43_001, reduction: 25 });
      expect(rawResponse).toEqual({ success: true });
      // Produkt 43 001 v zrkadle katalógu nie je — `null` = nevieme (I11).
      expect(reference).toBeNull();
      expect(lean[0]).toEqual(expected);
      expect(Object.keys(lean[0]!)).not.toContain('sentPayload');
      expect(Object.keys(lean[0]!)).not.toContain('rawResponse');
      expect(Object.keys(lean[0]!)).not.toContain('reference');
      // Čítacia sada ju naopak MUSÍ mať (aj keď je `null`).
      expect(Object.keys(full[0]!)).toContain('reference');

      // A hlavne: nejde o zahodenie po ceste — DB tie dva stĺpce neposlala.
      const rawKeys = await withMigrationConn(async (conn) => {
        let seen: string[] = [];
        const spy: Queryable = {
          async query<T>(sql: string, values?: unknown): Promise<T> {
            const rows = (await conn.query(sql, values)) as T;
            seen = Object.keys((rows as unknown as Array<Record<string, unknown>>)[0] ?? {});
            return rows;
          },
        };
        await campaignItemsRepo.listForWrite(campaign.id, spy);
        return seen;
      });
      expect(rawKeys).toContain('product_id');
      expect(rawKeys).not.toContain('sent_payload');
      expect(rawKeys).not.toContain('raw_response');
    });

    it('queueTotals() počíta len živé kampane (K2)', async () => {
      const queued = await makeCampaign();
      await campaignsRepoV3.setStatus(queued.id, 'queued');
      await campaignItemsRepo.createMany(
        queued.id,
        [1, 2, 3].map((n) => ({
          productId: 40_000 + n,
          position: n,
          percent: 10,
          priceAtPreview: null,
          hasAttributes: false,
        })),
      );
      const queuedItems = await campaignItemsRepo.listByCampaign(queued.id);
      await campaignItemsRepo.update(queuedItems[0]!.id, { status: 'ok' });

      const finished = await makeCampaign();
      await campaignsRepoV3.setStatus(finished.id, 'done', { finishedAt: new Date() });
      await campaignItemsRepo.createMany(finished.id, [
        { productId: 41_000, position: 1, percent: 10, priceAtPreview: null, hasAttributes: false },
      ]);

      const totals = await campaignItemsRepo.queueTotals();
      expect(totals).toEqual({ pending: 2, total: 3, campaigns: 1 });
    });

    it('DB odmietne percento mimo 1–30 aj keď by kód pustil (ck_items_percent)', async () => {
      const campaign = await makeCampaign();
      await expect(
        withMigrationConn(async (conn) =>
          conn.query(
            'INSERT INTO campaign_items (campaign_id, product_id, percent, position) VALUES (?, ?, ?, ?)',
            [campaign.id, 42_000, 31, 1],
          ),
        ),
      ).rejects.toThrow();
    });
  });

  /* ═══════════════════════════ K3 — pásma zľavy ═════════════════════════ */

  describe('tiers.repo (K3)', () => {
    it('createMany() + listByCampaign() drží poradie a JSON pravidlo', async () => {
      const campaign = await makeCampaign();
      await tiersRepo.createMany(campaign.id, [
        {
          ord: 2,
          label: '0 predaných za 180 dní',
          percent: 20,
          rule: { soldWindowDays: 180, buckets: ['none'] },
          itemsCount: 7564,
        },
        {
          ord: 1,
          label: '0 predaných za 360 dní',
          percent: 30,
          rule: { soldWindowDays: 360, buckets: ['none'] },
          itemsCount: 11_640,
        },
      ]);

      const tiers = await tiersRepo.listByCampaign(campaign.id);
      expect(tiers.map((t) => t.ord)).toEqual([1, 2]);
      expect(tiers.map((t) => t.percent)).toEqual([30, 20]);
      expect(tiers[0]?.label).toBe('0 predaných za 360 dní');
      expect(tiers[0]?.rule).toEqual({ soldWindowDays: 360, buckets: ['none'] });
      expect(tiers[0]?.itemsCount).toBe(11_640);
      expect(tiers[0]?.createdAt).toBeInstanceOf(Date);
    });

    it('percento pásma mimo 1–30 sa odmietne ešte pred SQL (I9, K3)', async () => {
      const campaign = await makeCampaign();
      for (const percent of [0, 31, 15.5]) {
        await expect(
          tiersRepo.createMany(campaign.id, [{ ord: 1, label: 'Pásmo', percent }]),
        ).rejects.toThrow(/percento/i);
      }
      expect(await tiersRepo.listByCampaign(campaign.id)).toEqual([]);
    });

    it('duplicitné poradie pásma sa odmietne s použiteľnou hláškou', async () => {
      const campaign = await makeCampaign();
      await expect(
        tiersRepo.createMany(campaign.id, [
          { ord: 1, label: 'A', percent: 10 },
          { ord: 1, label: 'B', percent: 20 },
        ]),
      ).rejects.toThrow(/dvakrát/);
    });

    it('update(), setItemsCount(), getById() a deleteByCampaign() fungujú', async () => {
      const campaign = await makeCampaign();
      await tiersRepo.createMany(campaign.id, [{ ord: 1, label: 'Pásmo A', percent: 10 }]);
      const [tier] = await tiersRepo.listByCampaign(campaign.id);

      await tiersRepo.update(tier!.id, { label: 'Pásmo A (upravené)', percent: 25 });
      await tiersRepo.setItemsCount(tier!.id, 42);
      const loaded = await tiersRepo.getById(tier!.id);
      expect(loaded?.label).toBe('Pásmo A (upravené)');
      expect(loaded?.percent).toBe(25);
      expect(loaded?.itemsCount).toBe(42);

      await expect(tiersRepo.update(tier!.id, { percent: 31 })).rejects.toThrow(/1–30/);
      await expect(
        tiersRepo.update(tier!.id, { hackovanyStlpec: 1 } as never),
      ).rejects.toThrow(/Neznáme pole/);

      expect(await tiersRepo.deleteByCampaign(campaign.id)).toBe(1);
      expect(await tiersRepo.getById(tier!.id)).toBeNull();
    });

    it('replaceForCampaign() prepíše pásma draftu', async () => {
      const campaign = await makeCampaign();
      await tiersRepo.createMany(campaign.id, [{ ord: 1, label: 'Staré', percent: 10 }]);
      await tiersRepo.replaceForCampaign(campaign.id, [
        { ord: 1, label: 'Nové 1', percent: 20 },
        { ord: 2, label: 'Nové 2', percent: 30 },
      ]);
      const tiers = await tiersRepo.listByCampaign(campaign.id);
      expect(tiers.map((t) => t.label)).toEqual(['Nové 1', 'Nové 2']);
    });
  });

  /* ═══════════════════ K7/K8 — katalóg: upsert, filtre, počty ═══════════ */

  describe('catalog.repo (K7, K8, I11)', () => {
    /**
     * Päť produktov s rôznou cenou a predajnosťou. Predaje sú v okne 30 dní
     * pred `TODAY`, aby sa dalo overiť aj okno.
     */
    async function seedCatalog(): Promise<void> {
      await catalogRepo.upsertMany([
        { productId: 9001, name: 'Strieborný prsteň', price: '24.90', hasAttributes: false, source: 'list', raw: null },
        { productId: 9002, name: 'Zlatý náhrdelník', price: '199.00', hasAttributes: true, source: 'list', raw: null },
        { productId: 9003, name: 'Perlové náušnice', price: '49.50', hasAttributes: false, source: 'list', raw: null },
        { productId: 9004, name: 'Ocelový náramok', price: '15.00', hasAttributes: false, source: 'list', raw: null },
        { productId: 9005, name: 'Chýbajúci šperk', price: '10.00', hasAttributes: false, source: 'list', raw: null, shopStatus: 'not_found' as const },
      ]);
      await seedSales([
        { productId: 9002, day: '2026-08-09', units: 1 },
        { productId: 9003, day: '2026-08-08', units: 5 },
        { productId: 9004, day: '2026-08-01', units: 12 },
        // Starý predaj mimo okna 30 dní — v 30-dňovom okne sa nesmie počítať.
        { productId: 9001, day: '2026-05-01', units: 9 },
      ]);
    }

    it('upsertMany() vloží aj prepíše a `fetched_at` je meraný fakt (K7, P7)', async () => {
      const first = new Date('2026-08-10T06:00:00.000Z');
      expect(
        await catalogRepo.upsertMany([
          { productId: 9101, name: 'Prsteň', price: '10.00', hasAttributes: false, source: 'list', raw: null, fetchedAt: first },
        ]),
      ).toBe(1);

      const second = new Date('2026-08-10T07:00:00.000Z');
      await catalogRepo.upsertMany([
        { productId: 9101, name: 'Prsteň XL', price: '12.50', hasAttributes: true, source: 'get', raw: { id: 9101 }, fetchedAt: second },
      ]);

      const record = await catalogRepo.get(9101);
      expect(record?.name).toBe('Prsteň XL');
      expect(record?.price).toBe('12.50');
      expect(typeof record?.price).toBe('string');
      expect(record?.hasAttributes).toBe(true);
      expect(record?.shopStatus).toBe('ok');
      expect(record?.fetchedAt.toISOString()).toBe(second.toISOString());
      expect((await catalogRepo.lastFetchedAt())?.toISOString()).toBe(second.toISOString());
      expect(await catalogRepo.totalRows()).toBe(1);
    });

    it('markShopStatus() označí `not_found` a search ho fail-closed vynechá (D49, K1 bod 2)', async () => {
      await seedCatalog();
      await catalogRepo.markShopStatus(9001, 'not_found');

      const defaultSearch = await catalogRepo.search({ today: TODAY });
      expect(defaultSearch.data.map((r) => r.productId)).not.toContain(9001);
      expect(defaultSearch.data.map((r) => r.productId)).not.toContain(9005);

      // Explicitne vyžiadaný stav sa zobrazí — filter sa nedá obísť, len zvoliť.
      const explicit = await catalogRepo.search({ today: TODAY, shopStatus: ['not_found'] });
      expect(explicit.data.map((r) => r.productId).sort()).toEqual([9001, 9005]);
      expect(explicit.data[0]?.shopStatus).toBe('not_found');
    });

    it('filtruje podľa ceny, textu a ID a stránkuje (LIMIT/OFFSET)', async () => {
      await seedCatalog();

      const byPrice = await catalogRepo.search({ today: TODAY, priceFrom: 20, priceTo: '50.00' });
      expect(byPrice.data.map((r) => r.productId).sort()).toEqual([9001, 9003]);
      expect(byPrice.total).toBe(2);

      const byName = await catalogRepo.search({ today: TODAY, query: 'náhrdelník' });
      expect(byName.data.map((r) => r.productId)).toEqual([9002]);

      const byId = await catalogRepo.search({ today: TODAY, query: '9004' });
      expect(byId.data.map((r) => r.productId)).toEqual([9004]);

      const page1 = await catalogRepo.search({ today: TODAY, perPage: 2, page: 1, sort: 'id' });
      const page2 = await catalogRepo.search({ today: TODAY, perPage: 2, page: 2, sort: 'id' });
      expect(page1.total).toBe(4);
      expect(page1.data.map((r) => r.productId)).toEqual([9001, 9002]);
      expect(page2.data.map((r) => r.productId)).toEqual([9003, 9004]);
    });

    it('`%` a `_` vo vyhľadávaní sú znaky, nie wildcardy', async () => {
      await catalogRepo.upsertMany([
        { productId: 9201, name: 'Zľava 50% strieborná', price: '10.00', hasAttributes: false, source: 'list', raw: null },
        { productId: 9202, name: 'Prsteň bez znaku', price: '10.00', hasAttributes: false, source: 'list', raw: null },
      ]);

      const hit = await catalogRepo.search({ today: TODAY, query: '50%' });
      expect(hit.data.map((r) => r.productId)).toEqual([9201]);

      // Keby `%` prešlo ako wildcard, `bez%` by našlo „Prsteň bez znaku".
      const miss = await catalogRepo.search({ today: TODAY, query: 'bez%' });
      expect(miss.data).toEqual([]);
    });

    it('vedrá predajnosti počítajú len zvolené okno (K7)', async () => {
      await seedCatalog();

      const w30 = await catalogRepo.search({ today: TODAY, soldWindowDays: 30, sort: 'id' });
      const sold30 = new Map(w30.data.map((r) => [r.productId, r.unitsSold]));
      expect(sold30.get(9001)).toBe(0); // predaj z mája je mimo 30-dňového okna
      expect(sold30.get(9002)).toBe(1);
      expect(sold30.get(9003)).toBe(5);
      expect(sold30.get(9004)).toBe(12);
      expect(w30.soldWindowDays).toBe(30);
      expect(w30.soldFrom).toBe('2026-07-12');
      expect(w30.soldTo).toBe(TODAY);

      const none = await catalogRepo.search({ today: TODAY, soldWindowDays: 30, soldBuckets: ['none'] });
      expect(none.data.map((r) => r.productId)).toEqual([9001]);

      const lowAndHigh = await catalogRepo.search({
        today: TODAY,
        soldWindowDays: 30,
        soldBuckets: ['low', 'high'],
        sort: 'id',
      });
      expect(lowAndHigh.data.map((r) => r.productId)).toEqual([9002, 9004]);

      // V 180-dňovom okne už májový predaj do počtu vstúpi.
      const w180 = await catalogRepo.search({ today: TODAY, soldWindowDays: 180, query: '9001' });
      expect(w180.data[0]?.unitsSold).toBe(9);
    });

    it('„nikdy nezlacnené" a „práve v zľave" sú z VLASTNÝCH zápisov (I11)', async () => {
      await seedCatalog();

      // Vlastný úspešný zápis na 9002 s oknom, ktoré dnes beží.
      const running = await makeCampaign({ dateFrom: '2026-08-05', dateTo: '2026-08-20' });
      await campaignItemsRepo.createMany(running.id, [
        { productId: 9002, position: 1, percent: 20, priceAtPreview: '199.00', hasAttributes: true },
      ]);
      const [runningItem] = await campaignItemsRepo.listByCampaign(running.id);
      await campaignItemsRepo.update(runningItem!.id, { status: 'ok', finishedAt: new Date() });

      // Zápis na 9003 s oknom, ktoré už skončilo.
      const past = await makeCampaign({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
      await campaignItemsRepo.createMany(past.id, [
        { productId: 9003, position: 1, percent: 10, priceAtPreview: '49.50', hasAttributes: false },
      ]);
      const [pastItem] = await campaignItemsRepo.listByCampaign(past.id);
      await campaignItemsRepo.update(pastItem!.id, { status: 'ok', finishedAt: new Date() });

      // Neúspešný zápis na 9004 — zľava sa nikdy nestala.
      const failed = await makeCampaign({ dateFrom: '2026-08-05', dateTo: '2026-08-20' });
      await campaignItemsRepo.createMany(failed.id, [
        { productId: 9004, position: 1, percent: 10, priceAtPreview: '15.00', hasAttributes: false },
      ]);
      const [failedItem] = await campaignItemsRepo.listByCampaign(failed.id);
      await campaignItemsRepo.update(failedItem!.id, { status: 'failed' });

      const never = await catalogRepo.search({ today: TODAY, neverDiscounted: true, sort: 'id' });
      expect(never.data.map((r) => r.productId)).toEqual([9001, 9004]);

      const now = await catalogRepo.search({ today: TODAY, currentlyDiscounted: true });
      expect(now.data.map((r) => r.productId)).toEqual([9002]);

      const all = await catalogRepo.search({ today: TODAY, sort: 'id' });
      const rows = new Map(all.data.map((r) => [r.productId, r]));
      expect(rows.get(9003)?.everDiscounted).toBe(true);
      expect(rows.get(9003)?.discountedNow).toBe(false);
      expect(rows.get(9004)?.everDiscounted).toBe(false);
    });

    it('counts() dá čísla do bočného panela jedným dotazom (K7)', async () => {
      await seedCatalog();
      const counts = await catalogRepo.counts({ today: TODAY, soldWindowDays: 30 });
      expect(counts.total).toBe(4); // `not_found` produkt sa nepočíta
      expect(counts.sold).toEqual({ none: 1, low: 1, mid: 1, high: 1 });
      expect(counts.neverDiscounted).toBe(4);
      expect(counts.discountedNow).toBe(0);

      // Zaškrtnuté vedro počty ostatných vedier NEVYNULUJE (facetové počítanie).
      const withBucket = await catalogRepo.counts({
        today: TODAY,
        soldWindowDays: 30,
        soldBuckets: ['none'],
      });
      expect(withBucket.sold).toEqual({ none: 1, low: 1, mid: 1, high: 1 });

      // Filter ceny sa naopak do počtov premietne.
      const cheap = await catalogRepo.counts({ today: TODAY, soldWindowDays: 30, priceTo: '30.00' });
      expect(cheap.total).toBe(2);
    });

    it('zamknuté filtre sa priznávajú aj v counts() (K8)', async () => {
      const counts = await catalogRepo.counts({ today: TODAY });
      expect(counts.lockedFilters).toContain('stock');
      expect(counts.lockedFilters).toContain('category');
      expect(counts.lockedFilters).toContain('turnover');
    });

    it('triedenie podľa predajnosti a ceny je stabilné', async () => {
      await seedCatalog();
      const bySold = await catalogRepo.search({ today: TODAY, soldWindowDays: 30, sort: 'sold_desc' });
      expect(bySold.data.map((r) => r.productId)).toEqual([9004, 9003, 9002, 9001]);

      const byPrice = await catalogRepo.search({ today: TODAY, sort: 'price_asc' });
      expect(byPrice.data.map((r) => r.productId)).toEqual([9004, 9001, 9003, 9002]);
    });
  });

  /* ═══════════════════════════ I4 — audit sa nedotýka ═══════════════════ */

  it('žiadny repozitár V3 nezapisuje do audit_log (I4)', async () => {
    const auditCount = async (): Promise<number> =>
      withMigrationConn(async (conn) => {
        const rows = (await conn.query('SELECT COUNT(*) AS total FROM audit_log')) as Array<{
          total: number | bigint;
        }>;
        return Number(rows[0]?.total ?? 0);
      });

    const before = await auditCount();

    await settingsRepo.readScope();
    await settingsRepo.setScopeMode('plny');
    await settingsRepo.setDailyWriteBudget(100);
    const campaign = await makeCampaign();
    await campaignsRepoV3.setStatus(campaign.id, 'queued');
    await campaignsRepoV3.markLate(campaign.id);
    await campaignsRepoV3.syncCountersFromItems(campaign.id);
    await campaignItemsRepo.createMany(campaign.id, [
      { productId: 50_001, position: 1, percent: 10, priceAtPreview: null, hasAttributes: false },
    ]);
    await campaignItemsRepo.queueTotals();
    await tiersRepo.createMany(campaign.id, [{ ord: 1, label: 'Pásmo', percent: 10 }]);
    await tiersRepo.deleteByCampaign(campaign.id);
    await catalogRepo.upsertMany([
      { productId: 50_001, name: 'x', price: '1.00', hasAttributes: false, source: 'list', raw: null },
    ]);
    await catalogRepo.search({ today: TODAY });
    await catalogRepo.counts({ today: TODAY });

    expect(await auditCount()).toBe(before);
  });
});
