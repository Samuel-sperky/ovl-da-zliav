/**
 * Aura Zľavy — ČÍTACIE ENDPOINTY V5: HISTÓRIA, KOLÁČ, ÚČINNOSŤ
 * (D126, D127 body 1, 3 a 4; invarianty I3, I11).
 *
 * Beží proti SKUTOČNEJ MariaDB so skutočnými migráciami. Je to zámer, nie
 * pohodlie: fake repozitár by referenciu, diel „nevieme" aj priznanie účinnosti
 * vrátil aj vtedy, keby ich SQL vôbec nepočítalo — a presne tak to v tomto repe
 * raz prežilo zelenú bránu (pasca „agentov report nie je dôkaz" z CLAUDE.md).
 * Meria sa TELO ODPOVEDE, nie model: D121 fungoval v modeli, kým server posielal
 * `unitsSold: 0` namiesto `null`.
 *
 * Čo sa dokazuje:
 *  1. **História obojsmerne.** Pri zľave vidno jej produkty, pri produkte jeho
 *     zľavy — a sú to tie isté fakty z tej istej tabuľky (K7).
 *  2. **Produkt mimo katalógu sa NESTRATÍ.** Riadok zostane s `reference: null`
 *     a `inCatalog: false` — `LEFT JOIN`, nie `INNER`. Zľava je dôkaz o tom, čo
 *     appka urobila, a nesmie sa skrátiť tým, že produkt zmizol z katalógu.
 *  3. **Koláč vracia diel „nevieme".** Neobohatený produkt nepatrí do žiadneho
 *     podielu (D118) a nesťahovaný deň nie je vedro „nula" (D121). Diel sa
 *     vracia VŽDY a diely dávajú celok.
 *  4. **Účinnosť priznáva, nevracia číslo.** Bez stiahnutých dní `coverage_gap`
 *     a `units: null`; nezačatá a príliš krátka zľava `too_young`. Číslo príde
 *     LEN nad dočítanými dňami.
 *  5. **Žiadne eurá per produkt** (D117) a **žiadna cesta k zápisu** (I3):
 *     všetky štyri route sú `GET` a `setReduction` sa v nich nevyskytuje.
 *
 * Vlastník: vlna V5-CITACIE.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DateOnly, ItemStatus } from '@/contracts';

import { createInsightsCampaignEffectivenessGet } from '@/app/api/insights/campaign/[id]/effectiveness/route';
import { createInsightsCampaignProductsGet } from '@/app/api/insights/campaign/[id]/products/route';
import { createInsightsCatalogDistributionGet } from '@/app/api/insights/catalog-distribution/route';
import { createInsightsProductCampaignsGet } from '@/app/api/insights/product/[productId]/campaigns/route';
import { closePool } from '@/db/pool';
import { resetRateLimiter } from '@/lib/http/define-route';
import { campaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepoV3 } from '@/lib/repo/campaigns.repo';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';
import { makeCreateCampaignInput, testUlid } from '../helpers/factories';
import { actorRouteDeps } from './routes-harness';

const available = await dbAvailable();

/* ═══════════════════════════════ 0. Svet ══════════════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const NOW = new Date('2026-09-01T09:00:00.000Z');
const TODAY = '2026-09-01' as DateOnly;
const ZONE = 'Europe/Bratislava';

/** Obohatený produkt v zrkadle — referenciu aj cenu appka pozná. */
const OBOHATENY = 7001;
/** Riadok v zrkadle je, `getFull` nebol — referencia `NULL` (D118). */
const NEOBOHATENY = 7002;
/** V zrkadle VÔBEC NIE JE — zmizol z katalógu. */
const MIMO_KATALOGU = 7003;

const deps = { now: () => NOW, timeZone: ZONE };
const routeDeps = actorRouteDeps({ now: () => NOW });

async function seedUser(): Promise<number> {
  return withMigrationConn(async (conn) => {
    const result = (await conn.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      ['samuel-historia', 'nepouzity-hash'],
    )) as { insertId?: number | bigint };
    return Number(result.insertId ?? 0);
  });
}

/**
 * Zrkadlo sa plní priamym SQL zámerne: `catalogRepo.upsertMany()` stĺpce
 * z migrácie `0014` NEPREPISUJE (obohatenie musí prežiť každý prechod
 * katalógu), takže referenciu by cez neho nastaviť ani nešlo.
 */
async function seedCatalog(): Promise<void> {
  await withMigrationConn(async (conn) => {
    for (const row of [
      { id: OBOHATENY, name: 'Náramok obohatený', reference: 'REF-7001', price: '30.00', enriched: true },
      { id: NEOBOHATENY, name: 'Náramok neobohatený', reference: null, price: '20.00', enriched: false },
    ]) {
      await conn.query(
        'INSERT INTO catalog_cache (product_id, name, price, reference, source, fetched_at, ' +
          "shop_status, enriched_at) VALUES (?, ?, ?, ?, 'list', UTC_TIMESTAMP(3), 'ok', ?)",
        [row.id, row.name, row.price, row.reference, row.enriched ? NOW : null],
      );
    }
    // MIMO_KATALOGU sa NEVKLÁDA — to je celý zmysel bodu 2.
  });
}

/** Dni pokrytia jedným `INSERT`-om — 180 samostatných príkazov je len pomalšie. */
async function seedSyncDays(days: readonly string[], status = 'complete'): Promise<void> {
  if (days.length === 0) return;
  await withMigrationConn(async (conn) => {
    const tuples = days.map(() => '(?, ?, 3, UTC_TIMESTAMP(3))').join(', ');
    const values: unknown[] = [];
    for (const day of days) values.push(day, status);
    await conn.query(
      'INSERT INTO sales_sync_state (sale_day, status, orders_seen, finished_at) VALUES ' + tuples,
      values,
    );
  });
}

/**
 * `truncateAll()` (`test/helpers/db.ts`) tabuľky predajov NEZAHŔŇA — čistí ich
 * každý spec sám, rozsahom vlastných dní (rovnako `kpi-produktu.spec.ts` aj
 * `trzba-eshopu.spec.ts`). Bez toho by zvyšok po predchádzajúcom teste padol na
 * `Duplicate entry` a vyzeralo by to ako kolízia dvoch vitestov.
 */
async function clearSales(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query("DELETE FROM product_sales_daily WHERE sale_day BETWEEN '2026-01-01' AND '2026-12-31'");
    await conn.query("DELETE FROM sales_sync_state WHERE sale_day BETWEEN '2026-01-01' AND '2026-12-31'");
  });
}

async function seedSales(rows: ReadonlyArray<[number, string, number]>): Promise<void> {
  await withMigrationConn(async (conn) => {
    for (const [productId, day, units] of rows) {
      await conn.query(
        'INSERT INTO product_sales_daily (product_id, sale_day, units_sold) VALUES (?, ?, ?)',
        [productId, day, units],
      );
    }
  });
}

/** Súvislý rad dní `[from, to]` — na dávanie a odoberanie pokrytia. */
function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

interface SeedCampaignOptions {
  userId: number;
  dateFrom: string;
  dateTo: string;
  percent?: number;
  name?: string;
  products: ReadonlyArray<{ id: number; status?: ItemStatus; priceAtPreview?: string }>;
}

async function seedCampaign(opts: SeedCampaignOptions): Promise<number> {
  const percent = opts.percent ?? 20;
  const campaign = await campaignsRepoV3.create(
    makeCreateCampaignInput({
      operationId: testUlid(),
      createdBy: opts.userId,
      name: opts.name ?? 'Historia test',
      percent,
      dateFrom: opts.dateFrom as DateOnly,
      dateTo: opts.dateTo as DateOnly,
    }),
  );
  await campaignItemsRepo.createMany(
    campaign.id,
    opts.products.map((product, index) => ({
      productId: product.id,
      position: index,
      percent,
      priceAtPreview: product.priceAtPreview ?? '10.00',
      hasAttributes: false,
    })),
  );

  /* Stav zápisu sa dopĺňa cez repozitár — presne tak, ako to robí executor. */
  const items = await campaignItemsRepo.listByCampaign(campaign.id);
  for (const item of items) {
    const wanted = opts.products.find((product) => product.id === item.productId)?.status;
    if (wanted === undefined || wanted === 'pending') continue;
    await campaignItemsRepo.update(item.id, {
      status: wanted,
      nameAtWrite: `Zapisany ${String(item.productId)}`,
      priceAtWrite: item.priceAtPreview,
      finishedAt: NOW,
    });
  }
  return campaign.id;
}

/* ═════════════════════════ 0b. Volanie route-ov ═══════════════════════════ */

async function callJson<T>(
  handler: (request: Request, args?: { params?: Promise<Record<string, string>> }) => Promise<Response>,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const response = await handler(new Request(`${APP_ORIGIN}${path}`, { method: 'GET' }), {
    ...(params === undefined ? {} : { params: Promise.resolve(params) }),
  });
  const parsed = (await response.json()) as { ok: boolean; data?: T };
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  return parsed.data as T;
}

interface CampaignProductsBody {
  campaignId: number;
  campaign: { name: string; percent: number } | null;
  total: number;
  items: Array<{
    productId: number;
    reference: string | null;
    catalogName: string | null;
    nameAtWrite: string | null;
    inCatalog: boolean;
    enriched: boolean;
    status: ItemStatus;
    priceBefore: string | null;
    priceBeforeSource: string | null;
    priceAfter: string | null;
    priceAfterEstimated: boolean;
    catalogPrice: string | null;
  }>;
}

interface ProductCampaignsBody {
  productId: number;
  today: DateOnly;
  returned: number;
  truncated: boolean;
  rows: Array<{
    campaignId: number;
    campaignName: string;
    percent: number;
    dateFrom: DateOnly;
    dateTo: DateOnly;
    itemStatus: ItemStatus;
    ownWriteCoversToday: boolean;
    priceAfter: string | null;
  }>;
}

interface DistributionBody {
  dimension: string;
  scope: string;
  selectionSize: number | null;
  total: number;
  slices: Array<{ bucket: string; count: number; share: number | null }>;
  unknown: { bucket: string; count: number; share: number | null; reason: string };
  sumMatchesTotal: boolean;
  locked: Array<{ dimension: string; reason: string }>;
  enrichedRows: number;
}

interface EffectivenessBody {
  campaignId: number;
  available: boolean;
  state: string;
  reason: string | null;
  unit: string;
  spanDays: number | null;
  startsOn: DateOnly | null;
  before: { from: DateOnly; to: DateOnly; days: number; units: number | null } | null;
  during: { from: DateOnly; to: DateOnly; days: number; units: number | null } | null;
  deltaPercent: number | null;
  missingBefore: DateOnly[];
  missingDuring: DateOnly[];
  locked: { revenue: string };
}

const campaignProducts = (campaignId: number, query = ''): Promise<CampaignProductsBody> =>
  callJson<CampaignProductsBody>(
    createInsightsCampaignProductsGet(deps, routeDeps),
    `/api/insights/campaign/${String(campaignId)}/products${query}`,
    { id: String(campaignId) },
  );

const productCampaigns = (productId: number, query = ''): Promise<ProductCampaignsBody> =>
  callJson<ProductCampaignsBody>(
    createInsightsProductCampaignsGet(deps, routeDeps),
    `/api/insights/product/${String(productId)}/campaigns${query}`,
    { productId: String(productId) },
  );

const distribution = (query = ''): Promise<DistributionBody> =>
  callJson<DistributionBody>(
    createInsightsCatalogDistributionGet(deps, routeDeps),
    `/api/insights/catalog-distribution${query}`,
  );

const effectiveness = (campaignId: number): Promise<EffectivenessBody> =>
  callJson<EffectivenessBody>(
    createInsightsCampaignEffectivenessGet(deps, routeDeps),
    `/api/insights/campaign/${String(campaignId)}/effectiveness`,
    { id: String(campaignId) },
  );

/* ══════════════════════════════ 1. Testy ══════════════════════════════════ */

describe.skipIf(!available)('čítacie endpointy V5 — história, koláč, účinnosť', () => {
  let userId = 0;

  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
    await clearSales();
    resetRateLimiter();
    userId = await seedUser();
    await seedCatalog();
  });

  afterAll(async () => {
    await closePool();
  });

  /* ─────────────── 1. História obojsmerne (D127 bod 3, K7) ──────────────── */

  describe('história produkt ↔ zľava', () => {
    it('pri zľave vidno jej produkty s referenciou, cenou pred aj orientačnou cenou po', async () => {
      const campaignId = await seedCampaign({
        userId,
        dateFrom: '2026-08-20',
        dateTo: '2026-08-27',
        percent: 20,
        products: [
          { id: OBOHATENY, status: 'ok', priceAtPreview: '30.00' },
          { id: NEOBOHATENY, status: 'pending', priceAtPreview: '20.00' },
        ],
      });

      const body = await campaignProducts(campaignId);
      expect(body.campaignId).toBe(campaignId);
      expect(body.campaign?.percent).toBe(20);
      expect(body.total).toBe(2);
      expect(body.items.map((item) => item.productId)).toEqual([OBOHATENY, NEOBOHATENY]);

      const obohateny = body.items[0]!;
      expect(obohateny.reference).toBe('REF-7001');
      expect(obohateny.catalogName).toBe('Náramok obohatený');
      expect(obohateny.enriched).toBe(true);
      // Zapísaná položka má cenu zo ZÁPISU, nie z náhľadu.
      expect(obohateny.priceBeforeSource).toBe('write');
      expect(obohateny.priceBefore).toBe('30.00');
      expect(obohateny.priceAfter).toBe('24.00');
      expect(obohateny.priceAfterEstimated).toBe(true);

      const neobohateny = body.items[1]!;
      // `null` = nevieme (I11). Nie prázdny reťazec a nie pomlčka.
      expect(neobohateny.reference).toBeNull();
      expect(neobohateny.reference).not.toBe('');
      expect(neobohateny.enriched).toBe(false);
      // Kým sa nezapisovalo, existuje len cena z náhľadu.
      expect(neobohateny.priceBeforeSource).toBe('preview');
      expect(neobohateny.nameAtWrite).toBeNull();
    });

    it('pri produkte vidno jeho zľavy — vrátane tej, ktorá ešte len čaká vo fronte', async () => {
      const minula = await seedCampaign({
        userId,
        name: 'Minula zlava',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-10',
        percent: 10,
        products: [{ id: OBOHATENY, status: 'ok' }],
      });
      const bezi = await seedCampaign({
        userId,
        name: 'Bezi teraz',
        dateFrom: '2026-08-28',
        dateTo: '2026-09-05',
        percent: 15,
        products: [{ id: OBOHATENY, status: 'ok' }],
      });
      const caka = await seedCampaign({
        userId,
        name: 'Caka vo fronte',
        dateFrom: '2026-09-10',
        dateTo: '2026-09-20',
        percent: 25,
        products: [{ id: OBOHATENY, status: 'pending' }],
      });

      const body = await productCampaigns(OBOHATENY);
      expect(body.today).toBe(TODAY);
      // Poradie od najnovšieho okna a `pending` zľava sa NEZAHADZUJE.
      expect(body.rows.map((row) => row.campaignId)).toEqual([caka, bezi, minula]);
      expect(body.returned).toBe(3);
      expect(body.truncated).toBe(false);

      const byId = new Map(body.rows.map((row) => [row.campaignId, row]));
      // Vlastný úspešný zápis, ktorého okno pokrýva dnešok — a NIE stav shopu.
      expect(byId.get(bezi)?.ownWriteCoversToday).toBe(true);
      expect(byId.get(minula)?.ownWriteCoversToday).toBe(false);
      // Zľava, ktorá dnešok pokrýva dátumami, ale zapísaná NIE JE, netvrdí nič.
      expect(byId.get(caka)?.itemStatus).toBe('pending');
      expect(byId.get(caka)?.ownWriteCoversToday).toBe(false);
      expect(byId.get(caka)?.campaignName).toBe('Caka vo fronte');
    });

    it('oba smery hovoria o tom istom fakte (K7)', async () => {
      const campaignId = await seedCampaign({
        userId,
        dateFrom: '2026-08-20',
        dateTo: '2026-08-27',
        percent: 20,
        products: [{ id: OBOHATENY, status: 'ok', priceAtPreview: '30.00' }],
      });

      const zoZlavy = await campaignProducts(campaignId);
      const zProduktu = await productCampaigns(OBOHATENY);

      expect(zoZlavy.items[0]?.productId).toBe(OBOHATENY);
      expect(zProduktu.rows[0]?.campaignId).toBe(campaignId);
      // Tá istá orientačná cena po zľave z tej istej ceny pred.
      expect(zProduktu.rows[0]?.priceAfter).toBe(zoZlavy.items[0]?.priceAfter);
    });

    it('produkt MIMO katalógu v zozname ZOSTANE s `null` referenciou (LEFT JOIN)', async () => {
      const campaignId = await seedCampaign({
        userId,
        dateFrom: '2026-08-20',
        dateTo: '2026-08-27',
        products: [
          { id: OBOHATENY, status: 'ok' },
          { id: MIMO_KATALOGU, status: 'ok' },
        ],
      });

      const body = await campaignProducts(campaignId);
      // Keby to bol INNER JOIN, riadok by ticho zmizol a `total` by nesedel.
      expect(body.total).toBe(2);
      expect(body.items).toHaveLength(2);

      const strateny = body.items.find((item) => item.productId === MIMO_KATALOGU);
      expect(strateny).toBeDefined();
      expect(strateny?.reference).toBeNull();
      expect(strateny?.catalogName).toBeNull();
      expect(strateny?.catalogPrice ?? null).toBeNull();
      // Dve rôzne nevedomosti sa NESMÚ zliať: produkt v zrkadle NIE JE…
      expect(strateny?.inCatalog).toBe(false);
      // …kým neobohatený produkt v ňom je, len ho `getFull` nevidel (D118).
      const vKatalogu = body.items.find((item) => item.productId === OBOHATENY);
      expect(vKatalogu?.inCatalog).toBe(true);

      // A ten istý riadok sa nesmie stratiť ani z opačného smeru.
      const zProduktu = await productCampaigns(MIMO_KATALOGU);
      expect(zProduktu.rows.map((row) => row.campaignId)).toEqual([campaignId]);
    });
  });

  /* ──────────────── 2. Koláč: diel „nevieme" (D126, D121) ───────────────── */

  describe('rozdelenie katalógu pre koláč', () => {
    it('bez stiahnutých dní je CELÝ katalóg v dieli „nevieme", nie vo vedre nula', async () => {
      const body = await distribution('?by=sold');

      expect(body.dimension).toBe('sold');
      expect(body.scope).toBe('catalog');
      expect(body.total).toBe(2);
      // D121: „nevieme, koľko sa predalo" NIE JE vedro `none`.
      expect(body.unknown.count).toBe(2);
      expect(body.unknown.reason).toBe('sales_days_missing');
      expect(body.slices.find((slice) => slice.bucket === 'none')?.count).toBe(0);
      // Diely dávajú celok — koláč sa smie nakresliť.
      expect(body.sumMatchesTotal).toBe(true);
      expect(body.unknown.share).toBe(1);
    });

    it('dočítaný deň bez predaja je MERANÁ nula, nie „nevieme"', async () => {
      await seedSyncDays(dayRange('2026-03-06', TODAY));
      await seedSales([[OBOHATENY, '2026-08-30', 4]]);

      const body = await distribution('?by=sold&soldWindow=180');
      expect(body.unknown.count).toBe(0);
      const buckets = new Map(body.slices.map((slice) => [slice.bucket, slice.count]));
      // Produkt s predajom je v niektorom vedre, ten bez predaja vo `none`.
      expect(buckets.get('none')).toBe(1);
      expect((buckets.get('low') ?? 0) + (buckets.get('mid') ?? 0) + (buckets.get('high') ?? 0)).toBe(1);
      expect(body.sumMatchesTotal).toBe(true);
    });

    it('neobohatený produkt nepatrí do žiadneho podielu zľavy podľa shopu (D118)', async () => {
      const body = await distribution('?by=shop-discount');

      expect(body.total).toBe(2);
      expect(body.enrichedRows).toBe(1);
      // Presne toto je „koláč, ktorý by scítal 100 % z nepravdy", keby diel
      // „nevieme" chýbal: neobohatený riadok NIE JE „bez zľavy".
      expect(body.unknown.count).toBe(1);
      expect(body.unknown.reason).toBe('not_enriched');
      expect(body.slices.find((slice) => slice.bucket === 'not_discounted')?.count).toBe(1);
      expect(body.sumMatchesTotal).toBe(true);
    });

    it('vlastné zápisy appka pozná celé — diel „nevieme" je nulový a vracia sa aj tak', async () => {
      await seedCampaign({
        userId,
        dateFrom: '2026-08-28',
        dateTo: '2026-09-05',
        products: [{ id: OBOHATENY, status: 'ok' }],
      });

      const body = await distribution('?by=own-discount');
      expect(body.unknown).toMatchObject({ bucket: 'unknown', count: 0, reason: 'none' });
      expect(body.slices.find((slice) => slice.bucket === 'active_now')?.count).toBe(1);
      expect(body.slices.find((slice) => slice.bucket === 'never')?.count).toBe(1);
      expect(body.sumMatchesTotal).toBe(true);
    });

    it('rozmery bez dát sú ZAMKNUTÉ, nie ponúknuté (K4)', async () => {
      const body = await distribution('?by=sold');
      const locked = body.locked.map((row) => row.dimension).sort();
      expect(locked).toContain('category');
      expect(locked).toContain('metal');
      for (const row of body.locked) expect(row.reason).toBe('no_data_in_schema');
    });

    it('rozsah `selection` počíta podiely nad naklikaným výberom', async () => {
      const body = await distribution(`?by=shop-discount&productIds=${String(OBOHATENY)}`);
      expect(body.scope).toBe('selection');
      expect(body.selectionSize).toBe(1);
      expect(body.total).toBe(1);
      expect(body.unknown.count).toBe(0);
    });

    it('nezmyselný výber je 400, nie ticho orezaný koláč', async () => {
      const handler = createInsightsCatalogDistributionGet(deps, routeDeps);
      const response = await handler(
        new Request(`${APP_ORIGIN}/api/insights/catalog-distribution?productIds=7001,abc`, {
          method: 'GET',
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  /* ─────────── 3. Účinnosť: priznanie namiesto čísla (D127 bod 4) ────────── */

  describe('účinnosť zľavy', () => {
    /** Zľava, ktorá skončila včera; okná sú `[08-25, 08-31]` a `[08-18, 08-24]`. */
    async function seedSkoncenaZlava(): Promise<number> {
      const campaignId = await seedCampaign({
        userId,
        name: 'Skoncena zlava',
        dateFrom: '2026-08-25',
        dateTo: '2026-08-31',
        products: [{ id: OBOHATENY, status: 'ok' }],
      });
      await seedSales([
        [OBOHATENY, '2026-08-19', 2],
        [OBOHATENY, '2026-08-20', 1],
        [OBOHATENY, '2026-08-26', 6],
        [OBOHATENY, '2026-08-27', 4],
      ]);
      return campaignId;
    }

    it('bez stiahnutých dní PRIZNÁ medzeru a NEVRÁTI číslo', async () => {
      const campaignId = await seedSkoncenaZlava();
      // Žiadny riadok v `sales_sync_state` — dni sa nesťahovali.

      const body = await effectiveness(campaignId);
      expect(body.state).toBe('coverage_gap');
      expect(body.reason).toBe('coverage_gap');
      expect(body.available).toBe(false);
      // Kusy v DB SÚ, ale okno nie je dočítané — číslo by meralo výpadok
      // sťahovania, nie zľavu.
      expect(body.before?.units).toBeNull();
      expect(body.during?.units).toBeNull();
      expect(body.deltaPercent).toBeNull();
      // Okná sa vrátia aj tak: obrazovka má povedať, ČO by porovnávala.
      expect(body.during).toMatchObject({ from: '2026-08-25', to: '2026-08-31', days: 7 });
      expect(body.before).toMatchObject({ from: '2026-08-18', to: '2026-08-24', days: 7 });
      // A menuje KTORÉ dni chýbajú.
      expect(body.missingDuring).toHaveLength(7);
      expect(body.missingBefore).toHaveLength(7);
    });

    it('čiastočne stiahnuté okno je stále medzera (`partial` nie je meranie)', async () => {
      const campaignId = await seedSkoncenaZlava();
      await seedSyncDays(dayRange('2026-08-18', '2026-08-30'));
      await seedSyncDays(['2026-08-31'], 'partial');

      const body = await effectiveness(campaignId);
      expect(body.state).toBe('coverage_gap');
      expect(body.during?.units).toBeNull();
      expect(body.missingDuring).toEqual(['2026-08-31']);
      expect(body.missingBefore).toEqual([]);
    });

    it('nad dočítanými dňami vráti KUSY a rozdiel na deň', async () => {
      const campaignId = await seedSkoncenaZlava();
      await seedSyncDays(dayRange('2026-08-18', '2026-08-31'));

      const body = await effectiveness(campaignId);
      expect(body.state).toBe('measured');
      expect(body.available).toBe(true);
      expect(body.reason).toBeNull();
      expect(body.unit).toBe('ks');
      expect(body.spanDays).toBe(7);
      // Pred: 2 + 1 = 3 kusy. Počas: 6 + 4 = 10 kusov. Dočítaný deň bez predaja
      // prispieva nulou — to je meranie, nie medzera.
      expect(body.before?.units).toBe(3);
      expect(body.during?.units).toBe(10);
      expect(body.deltaPercent).not.toBeNull();
      // Eurá tu NIE SÚ a ani nemôžu byť (D117).
      expect(body.locked.revenue).toBeTruthy();
      expect(JSON.stringify(body)).not.toContain('revenueEur');
    });

    it('zľava, ktorá ešte nezačala, je „príliš mladá" a nedostane ČÍSLA (pasca d00e081)', async () => {
      await seedSyncDays(dayRange('2026-06-01', TODAY));
      const campaignId = await seedCampaign({
        userId,
        name: 'Zapisuje sa',
        dateFrom: '2026-09-10',
        dateTo: '2026-09-20',
        products: [{ id: OBOHATENY, status: 'pending' }],
      });

      const body = await effectiveness(campaignId);
      expect(body.state).toBe('too_young');
      expect(body.reason).toBe('not_started');
      expect(body.available).toBe(false);
      expect(body.before).toBeNull();
      expect(body.during).toBeNull();
      // Obrazovka má povedať KEDY, nie len „ešte nie".
      expect(body.startsOn).toBe('2026-09-10');
    });

    it('okno kratšie než tri dni sa neporovnáva vôbec', async () => {
      await seedSyncDays(dayRange('2026-06-01', TODAY));
      const campaignId = await seedCampaign({
        userId,
        name: 'Zacala dnes',
        dateFrom: TODAY,
        dateTo: '2026-09-04',
        products: [{ id: OBOHATENY, status: 'ok' }],
      });

      const body = await effectiveness(campaignId);
      expect(body.state).toBe('too_young');
      expect(body.reason).toBe('window_too_short');
      expect(body.spanDays).toBe(1);
      expect(body.during?.units ?? null).toBeNull();
    });

    it('neexistujúca zľava je priznanie, nie prázdne čísla', async () => {
      const body = await effectiveness(999_111);
      expect(body.state).toBe('unknown_campaign');
      expect(body.available).toBe(false);
      expect(body.before).toBeNull();
    });
  });

  /* ─────────────── 4. Brány, ktoré sa tu nesmú oslabiť (I3) ─────────────── */

  /*
   * ZOZNAM SÚBOROV SA NEPÍŠE RUČNE (opravené 1. 9. 2026, nález overovateľa I3).
   *
   * Do tejto opravy tu stál natvrdo vypísaný zoznam štyroch ciest — a to je
   * presne vzor, ktorý 31. 8. prepustil skratku `presetId`: piata routa
   * v `src/app/api/insights/` by v ňom nebola, test by zostal zelený a nikto by
   * ju nemeral. Priečinok sa preto PREJDE CELÝ a meranie sa rozšírilo o dva
   * únikové východy, ktoré tri reťazce nechytili: zápis do LOKÁLNEJ databázy
   * (`insertX`, `createMany`, `enqueue`) a volanie shopu inou cestou než
   * `shop/client` (`orders-client`, `catalog/product-details`).
   */
  function insightsRoutes(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...insightsRoutes(full));
      else if (entry.name === 'route.ts') out.push(full);
    }
    return out;
  }

  it('žiadna route pod `insights/` nevie zapisovať — sú GET a `setReduction` v nich nie je', () => {
    const root = fileURLToPath(new URL('../../src/app/api/insights', import.meta.url));
    const files = insightsRoutes(root);
    // Poistka proti prázdnemu cyklu: keby sa priečinok premenoval, test by
    // inak prešiel bez jediného merania.
    expect(files.length).toBeGreaterThanOrEqual(8);

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

      // Metóda sa berie z KÓDU, nie z komentára: `method: 'GET'` vo vysvetľujúcej
      // vete a `export const POST` o riadok nižšie je presne ten únik.
      expect(code, file).toContain("method: 'GET'");
      for (const zapisova of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(code, `${file} — ${zapisova}`).not.toContain(`export const ${zapisova}`);
        expect(code, `${file} — method ${zapisova}`).not.toContain(`method: '${zapisova}'`);
      }

      // `setReduction` volá VÝHRADNE `engine/executor.ts`.
      expect(code, file).not.toContain('setReduction');
      // Žiadna cesta k shopu (K8: na render ceste sa shop nevolá) — ani tie,
      // ktoré reťazec `shop/client` neobsahujú.
      for (const doShopu of ['shop/client', 'shop/orders-client', 'catalog/product-details']) {
        expect(code, `${file} — ${doShopu}`).not.toContain(doShopu);
      }
      // GET route nesmie zapisovať ani do LOKÁLNEJ databázy.
      for (const zapis of ['.create(', '.createMany(', '.insert(', '.enqueue(', '.update(']) {
        expect(code, `${file} — ${zapis}`).not.toContain(zapis);
      }
    }
  });
});
