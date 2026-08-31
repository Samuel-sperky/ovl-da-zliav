/**
 * Aura Zľavy — REFERENCIA NA SERVEROVEJ STRANE (D116 / K6, invarianty I4, I11).
 *
 * Klienti (`src/components/audit/api.ts`, `src/components/campaigns/zlavy-api.ts`)
 * čítali `reference` už predtým, ale ŽIADNA serverová cesta to pole neposielala:
 * v audite aj v tabuľke položiek zľavy bola referencia VŽDY pomlčka — a nie
 * preto, že by ju appka nemala (stĺpec `catalog_cache.reference` z migrácie
 * `0014` existuje), ale preto, že ju nikto nepripojil. Tento súbor je poistka,
 * aby sa to nemohlo zopakovať bez toho, aby padol test.
 *
 * Beží proti SKUTOČNEJ MariaDB so skutočnými migráciami — nie proti fake
 * závislosti. Fake by referenciu vrátil aj vtedy, keby ju SQL nepripájalo, a
 * presne tak toto raz prežilo zelenú bránu (pasca z CLAUDE.md).
 *
 * Čo sa dokazuje:
 *  1. OBOHATENÝ produkt nesie referenciu (a v audite aj názov).
 *  2. NEOBOHATENÝ produkt nesie `null` — nie prázdny reťazec a nie pomlčku
 *     (I11: pomlčku skladá až obrazovka, server hovorí „nevieme").
 *  3. Produkt, ktorý v `catalog_cache` VÔBEC NIE JE, sa v odpovedi OBJAVÍ
 *     s `null` — `LEFT JOIN`, nie `INNER`. Auditný riadok je dôkazný záznam
 *     a nesmie sa stratiť len preto, že produkt zmizol z katalógu.
 *  4. Filtre auditu fungujú aj s pripojeným zrkadlom (`product_id` majú obe
 *     tabuľky — nekvalifikovaný názov by dotaz rozbil).
 *  5. Zápisová sada (`listForWrite()`) referenciu NEMÁ — hash potvrdenia
 *     (K4, I3) sa nesmie zmeniť tým, že sa niečo pridalo na povrch.
 *
 * Vlastník: V4 (REFERENCIA-SERVER).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuditDetailGet } from '@/app/api/audit/[id]/route';
import { createAuditGet } from '@/app/api/audit/route';
import { createCampaignGet } from '@/app/api/campaigns/[id]/route';
import { closePool } from '@/db/pool';
import { auditRepo, getById, list, listByCampaign } from '@/lib/repo/audit.repo';
import { campaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepoV3 } from '@/lib/repo/campaigns.repo';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { makeCreateCampaignInput, testUlid } from '../helpers/factories';
import { actorRouteDeps, makeRequest, parse } from './routes-harness';

const available = await dbAvailable();

/* ═══════════════════════════════ fixtúry ══════════════════════════════════ */

/** Obohatený produkt — `getFull` prebehol, referenciu aj názov appka pozná. */
const OBOHATENY = 5001;
/** Neobohatený produkt — riadok v zrkadle je, referencia v ňom NIE (D118). */
const NEOBOHATENY = 5002;
/** Produkt, ktorý v zrkadle vôbec NIE JE (zmizol z katalógu). */
const MIMO_ZRKADLA = 5003;
/** Zrkadlo vrátilo prázdny reťazec — to je „nevieme", nie „bez referencie". */
const PRAZDNA_REFERENCIA = 5004;

async function seedUser(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const result = (await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      ['samuel-referencia', '$argon2id$fake-hash-for-tests'],
    )) as { insertId?: number | bigint };
    return Number(result.insertId ?? 0);
  });
}

/**
 * Zrkadlo katalógu sa plní priamym SQL zámerne: `catalogRepo.upsertMany()`
 * stĺpce z `0014` NEPREPISUJE (obohatenie musí prežiť každý prechod katalógu),
 * takže referenciu by cez neho nastaviť ani nešlo.
 */
async function seedCatalog(): Promise<void> {
  await withMigrationConn(async (conn) => {
    for (const row of [
      { id: OBOHATENY, reference: 'REF-5001', name: 'Náramok obohatený', enriched: true },
      { id: NEOBOHATENY, reference: null, name: 'Náramok neobohatený', enriched: false },
      { id: PRAZDNA_REFERENCIA, reference: '   ', name: 'Náramok s prázdnou ref', enriched: true },
    ]) {
      await conn.query(
        'INSERT INTO catalog_cache (product_id, name, reference, source, fetched_at, enriched_at) ' +
          'VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), ?)',
        [row.id, row.name, row.reference, 'list', row.enriched ? new Date() : null],
      );
    }
    // MIMO_ZRKADLA sa NEVKLÁDA — to je celý zmysel bodu 3.
  });
}

/** Auditné riadky ide priamym `INSERT`-om — v produkcii ich píše `appendAudit()`. */
async function seedAudit(productIds: readonly number[]): Promise<number[]> {
  return withMigrationConn(async (conn) => {
    const ids: number[] = [];
    for (const productId of productIds) {
      const result = (await conn.query(
        'INSERT INTO audit_log (actor, event_type, ok, product_id, message) VALUES (?, ?, 1, ?, ?)',
        ['system', 'write_ok', productId, `referencia test ${String(productId)}`],
      )) as { insertId?: number | bigint };
      ids.push(Number(result.insertId ?? 0));
    }
    return ids;
  });
}

describe.skipIf(!available)('referencia na serverovej strane (D116 / K6)', () => {
  let userId = 0;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    userId = await seedUser();
    await seedCatalog();
  });

  afterAll(async () => {
    await closePool();
  });

  /* ═════════════════════════════ 1. AUDIT ═════════════════════════════════ */

  describe('audit (`/api/audit`, `/api/audit/[id]`)', () => {
    it('obohatený produkt nesie referenciu aj názov; neobohatený `null`', async () => {
      await seedAudit([OBOHATENY, NEOBOHATENY]);

      const page = await list({ perPage: 50 });
      const obohateny = page.data.find((row) => row.productId === OBOHATENY);
      const neobohateny = page.data.find((row) => row.productId === NEOBOHATENY);

      expect(obohateny?.reference).toBe('REF-5001');
      expect(obohateny?.productName).toBe('Náramok obohatený');

      // `null` = nevieme (I11). Prázdny reťazec by tvrdil „produkt ju nemá".
      expect(neobohateny?.reference).toBeNull();
      expect(neobohateny?.reference).not.toBe('');
      // Názov zrkadlo má aj bez obohatenia — sú to dva rôzne fakty.
      expect(neobohateny?.productName).toBe('Náramok neobohatený');
    });

    it('riadok o produkte MIMO zrkadla sa v odpovedi OBJAVÍ (LEFT JOIN, nie INNER)', async () => {
      await seedAudit([OBOHATENY, MIMO_ZRKADLA]);

      const page = await list({ perPage: 50 });
      // Keby to bol INNER JOIN, `total` by hovorilo 2 a riadkov by prišlo menej
      // — audit by ticho zamlčal udalosť o produkte, ktorý zmizol z katalógu.
      expect(page.total).toBe(2);
      expect(page.data.map((row) => row.productId).sort()).toEqual([OBOHATENY, MIMO_ZRKADLA]);

      const strateny = page.data.find((row) => row.productId === MIMO_ZRKADLA);
      expect(strateny).toBeDefined();
      expect(strateny?.reference).toBeNull();
      expect(strateny?.productName).toBeNull();
    });

    it('prázdny reťazec zo zrkadla je „nevieme", nie „bez referencie" (I11)', async () => {
      await seedAudit([PRAZDNA_REFERENCIA]);

      const page = await list({ perPage: 50 });
      expect(page.data[0]?.reference).toBeNull();
    });

    it('`getById()` nesie to isté doplnenie ako zoznam', async () => {
      const [obohatenyId, neobohatenyId, stratenyId] = await seedAudit([
        OBOHATENY,
        NEOBOHATENY,
        MIMO_ZRKADLA,
      ]);

      const obohateny = await getById(obohatenyId ?? 0);
      expect(obohateny?.reference).toBe('REF-5001');
      expect(obohateny?.productName).toBe('Náramok obohatený');

      const neobohateny = await getById(neobohatenyId ?? 0);
      expect(neobohateny?.reference).toBeNull();

      // Detail udalosti o produkte mimo zrkadla sa MUSÍ dať otvoriť.
      const strateny = await getById(stratenyId ?? 0);
      expect(strateny).not.toBeNull();
      expect(strateny?.productId).toBe(MIMO_ZRKADLA);
      expect(strateny?.reference).toBeNull();
    });

    it('filtre auditu fungujú aj s pripojeným zrkadlom (`product_id` je v dotaze dvakrát)', async () => {
      await seedAudit([OBOHATENY, NEOBOHATENY, MIMO_ZRKADLA]);

      const podlaProduktu = await list({ productId: OBOHATENY, perPage: 50 });
      expect(podlaProduktu.total).toBe(1);
      expect(podlaProduktu.data[0]?.reference).toBe('REF-5001');

      const podlaEventu = await list({ eventType: 'write_ok', ok: true, perPage: 50 });
      expect(podlaEventu.total).toBe(3);
    });

    it('objektový kontrakt `auditRepo` doplnenie tiež nesie', async () => {
      await seedAudit([OBOHATENY]);
      const page = await auditRepo.list({ perPage: 10 });
      expect(page.data[0]).toMatchObject({ reference: 'REF-5001' });
    });
  });

  /* ══════════════════════ 2. POLOŽKY ZĽAVY ═══════════════════════════════ */

  describe('položky zľavy (`/api/campaigns/[id]`)', () => {
    async function seedCampaignWithItems(): Promise<number> {
      const campaign = await campaignsRepoV3.create(
        makeCreateCampaignInput({
          operationId: testUlid(),
          createdBy: userId,
          percent: 20,
          dateFrom: '2026-09-01',
          dateTo: '2026-09-30',
        }),
      );
      await campaignItemsRepo.createMany(campaign.id, [
        {
          productId: OBOHATENY,
          position: 0,
          percent: 20,
          priceAtPreview: '10.00',
          hasAttributes: false,
        },
        {
          productId: NEOBOHATENY,
          position: 1,
          percent: 20,
          priceAtPreview: '11.00',
          hasAttributes: false,
        },
        {
          productId: MIMO_ZRKADLA,
          position: 2,
          percent: 20,
          priceAtPreview: '12.00',
          hasAttributes: false,
        },
        {
          productId: PRAZDNA_REFERENCIA,
          position: 3,
          percent: 20,
          priceAtPreview: '13.00',
          hasAttributes: false,
        },
      ]);
      return campaign.id;
    }

    it('stránka položiek nesie referenciu, `null` pri neobohatenom a poradie drží', async () => {
      const campaignId = await seedCampaignWithItems();

      const items = await campaignItemsRepo.listPage(campaignId, 100, 0);
      expect(items.map((item) => item.productId)).toEqual([
        OBOHATENY,
        NEOBOHATENY,
        MIMO_ZRKADLA,
        PRAZDNA_REFERENCIA,
      ]);
      expect(items[0]?.reference).toBe('REF-5001');
      expect(items[1]?.reference).toBeNull();
      expect(items[1]?.reference).not.toBe('');
      expect(items[3]?.reference).toBeNull();
    });

    it('položka produktu MIMO zrkadla sa NESTRATÍ (LEFT JOIN, nie INNER)', async () => {
      const campaignId = await seedCampaignWithItems();

      const items = await campaignItemsRepo.listPage(campaignId, 100, 0);
      expect(items).toHaveLength(4);
      expect(await campaignItemsRepo.countByCampaign(campaignId)).toBe(4);

      const stratena = items.find((item) => item.productId === MIMO_ZRKADLA);
      expect(stratena).toBeDefined();
      expect(stratena?.reference).toBeNull();
    });

    it('`listByCampaign()` a `nextPending()` nesú to isté doplnenie', async () => {
      const campaignId = await seedCampaignWithItems();

      const all = await campaignItemsRepo.listByCampaign(campaignId);
      expect(all).toHaveLength(4);
      expect(all[0]?.reference).toBe('REF-5001');
      expect(all[1]?.reference).toBeNull();

      const pending = await campaignItemsRepo.nextPending(campaignId, 2);
      expect(pending.map((item) => item.productId)).toEqual([OBOHATENY, NEOBOHATENY]);
      expect(pending[0]?.reference).toBe('REF-5001');
    });

    it('ZÁPISOVÁ sada referenciu NEMÁ — hash potvrdenia (K4, I3) sa nemení', async () => {
      const campaignId = await seedCampaignWithItems();

      const writeRows = await campaignItemsRepo.listForWrite(campaignId);
      expect(writeRows).toHaveLength(4);
      for (const row of writeRows) {
        expect(Object.prototype.hasOwnProperty.call(row, 'reference')).toBe(false);
      }
    });

    it('auditná stopa kampane nesie doplnenie tiež', async () => {
      const campaignId = await seedCampaignWithItems();
      await withMigrationConn(async (conn) => {
        await conn.query(
          'INSERT INTO audit_log (actor, event_type, ok, campaign_id, product_id, message) ' +
            'VALUES (?, ?, 1, ?, ?, ?)',
          ['system', 'write_ok', campaignId, OBOHATENY, 'stopa kampane'],
        );
      });

      const trail = await listByCampaign(campaignId);
      expect(trail).toHaveLength(1);
      expect(trail[0]?.reference).toBe('REF-5001');
      expect(trail[0]?.productName).toBe('Náramok obohatený');
    });
  });

  /* ═══════════════ 3. ROUTE-Y S PRODUKČNÝMI REPOZITÁRMI ═════════════════ */

  /**
   * Toto je rovina, na ktorej nález vznikol: repozitár môže pole vracať, a route
   * ho aj tak nemusí poslať (serializácia, redakcia, prepis odpovede). Route-y
   * sa tu preto volajú BEZ `overrides` — teda s produkčnými repozitármi nad
   * skutočnou DB. Fake by tento dôkaz zabil (pasca z CLAUDE.md).
   */
  describe('odpoveď route-ov (produkčný wiring)', () => {
    interface AuditBodyRow {
      productId: number | null;
      reference: string | null;
      productName: string | null;
    }

    it('`GET /api/audit` posiela `reference` aj `productName`', async () => {
      await seedAudit([OBOHATENY, NEOBOHATENY, MIMO_ZRKADLA]);

      const response = await parse(
        await createAuditGet(
          {},
          actorRouteDeps(),
        )(makeRequest('GET', '/api/audit?perPage=50'), { params: {} }),
      );
      expect(response.status).toBe(200);

      const rows = (response.body.data as { data: AuditBodyRow[] }).data;
      expect(rows).toHaveLength(3);

      const obohateny = rows.find((row) => row.productId === OBOHATENY);
      expect(obohateny?.reference).toBe('REF-5001');
      expect(obohateny?.productName).toBe('Náramok obohatený');

      // Pole tam JE aj pri neznámej hodnote — `null` je odpoveď „nevieme" (I11),
      // chýbajúce pole by bolo ticho.
      const strateny = rows.find((row) => row.productId === MIMO_ZRKADLA);
      expect(strateny).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(strateny ?? {}, 'reference')).toBe(true);
      expect(strateny?.reference).toBeNull();
    });

    it('`GET /api/audit/[id]` posiela `reference` aj `productName`', async () => {
      const [obohatenyId] = await seedAudit([OBOHATENY]);

      const response = await parse(
        await createAuditDetailGet({}, actorRouteDeps())(
          makeRequest('GET', `/api/audit/${String(obohatenyId)}`),
          { params: { id: String(obohatenyId) } },
        ),
      );
      expect(response.status).toBe(200);
      expect(response.body.data as AuditBodyRow).toMatchObject({
        productId: OBOHATENY,
        reference: 'REF-5001',
        productName: 'Náramok obohatený',
      });
    });

    it('`GET /api/campaigns/[id]` posiela `reference` na položkách', async () => {
      const campaign = await campaignsRepoV3.create(
        makeCreateCampaignInput({
          operationId: testUlid(),
          createdBy: userId,
          percent: 20,
          dateFrom: '2026-09-01',
          dateTo: '2026-09-30',
        }),
      );
      await campaignItemsRepo.createMany(campaign.id, [
        {
          productId: OBOHATENY,
          position: 0,
          percent: 20,
          priceAtPreview: '10.00',
          hasAttributes: false,
        },
        {
          productId: MIMO_ZRKADLA,
          position: 1,
          percent: 20,
          priceAtPreview: '12.00',
          hasAttributes: false,
        },
      ]);

      const response = await parse(
        await createCampaignGet({}, actorRouteDeps())(
          makeRequest('GET', `/api/campaigns/${String(campaign.id)}`),
          { params: { id: String(campaign.id) } },
        ),
      );
      expect(response.status).toBe(200);

      const items = (response.body.data as { items: Array<{ productId: number; reference: string | null }> })
        .items;
      expect(items.map((item) => item.productId)).toEqual([OBOHATENY, MIMO_ZRKADLA]);
      expect(items[0]?.reference).toBe('REF-5001');
      expect(Object.prototype.hasOwnProperty.call(items[1] ?? {}, 'reference')).toBe(true);
      expect(items[1]?.reference).toBeNull();
    });
  });
});
