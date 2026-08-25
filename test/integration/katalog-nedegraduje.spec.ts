/**
 * Aura Zľavy — zoznamový prechod nesmie zahodiť doťahnutý detail.
 *
 * PREČO TENTO SÚBOR EXISTUJE
 * --------------------------
 * `SQL_UPSERT_SUFFIX` v `repo/catalog.repo.ts` prepisoval `source` a `raw`
 * bezpodmienečne, takže každý prechod synchronizácie degradoval obohatený
 * riadok späť na `list` a `fillProductDetails()` zaň zaplatil znova. Zmerané
 * v prevádzkovej DB: `list: 41 220, get: 0, batch: 0` po ôsmich dňoch
 * vyčerpaného rozpočtu (`240/240`), beh skončil na `ip_banned`.
 *
 * PREČO INTEGRAČNÝ A NIE UNIT TEST
 * --------------------------------
 * Celá oprava JE to SQL. Zrkadlo v JavaScripte by overovalo zrkadlo, nie
 * MariaDB — a práve tá má vlastnosť, na ktorej to stojí: priradenia
 * v `ON DUPLICATE KEY UPDATE` sa vykonávajú zľava doprava a neskoršie výrazy
 * vidia už PREPÍSANÉ hodnoty. Keby `name`/`price` stáli pred `source`/`raw`,
 * podmienka by porovnávala novú hodnotu samu so sebou, vždy by vyšla
 * „nezmenené" a detail by prežil aj skutočnú zmenu ceny. Test „skutočná zmena
 * ceny detail uvoľní" je presne tou poistkou a bez reálnej DB ju napísať nedá.
 *
 * Merá sa POVRCH, ktorý appka číta (`detailsFor()` → `route`, `reference`,
 * `variantStock`), nie len obsah stĺpcov — riadok, ktorý má `source = 'get'`,
 * ale prázdny `raw`, by prešiel kontrolou stĺpca a v UI by aj tak chýbal kód.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ProductListItem } from '@/contracts';

import { closePool } from '@/db/pool';
import { catalogRepo } from '@/lib/repo/catalog.repo';
import { toCatalogRow } from '@/lib/shop/catalog-sync';

import { dbAvailable, setupTestDb, truncateAll } from '../helpers/db';

const available = await dbAvailable();

const PRODUCT_ID = 4711;

/** Kedy zoznamový prechod „prebehol" — vždy novší než doťahnutý detail. */
const DETAIL_AT = new Date('2026-06-01T10:00:00.000Z');
const LIST_AT = new Date('2026-08-24T03:00:00.000Z');

/** Ako produkt vyzerá v zozname (`GET /api/products`). */
const LIST_ITEM: ProductListItem = {
  id: PRODUCT_ID,
  name: 'Strieborný prsteň so zirkónom',
  price: 24.9,
  has_attributes: true,
};

/**
 * Doťahnutý detail cez `getFull` — nesie `reduction`, takže
 * `catalogDetailRoute()` ho pozná ako `getFull` a kód produktu je známy.
 */
function fullDetailRaw(): Record<string, unknown> {
  return {
    id: PRODUCT_ID,
    name: LIST_ITEM.name,
    price: LIST_ITEM.price,
    has_attributes: true,
    reference: 'AG-1234',
    ean13: '8590123456789',
    qty: 12,
    reduction: { state: 'none' },
    attributes: [
      {
        id_product_attribute: 900_001,
        reference: 'AG-1234-52',
        ean13: '8590123456796',
        quantity: 5,
        is_default: true,
        values: ['52'],
      },
      {
        id_product_attribute: 900_002,
        reference: 'AG-1234-54',
        ean13: '8590123456802',
        quantity: 7,
        is_default: false,
        values: ['54'],
      },
    ],
  };
}

/** Zapíše riadok tak, ako ho zapisuje `fillProductDetails()` (`getFull`). */
async function seedDetail(): Promise<void> {
  await catalogRepo.upsert({
    productId: PRODUCT_ID,
    name: LIST_ITEM.name,
    price: '24.90',
    hasAttributes: true,
    shopStatus: 'ok',
    source: 'get',
    fetchedAt: DETAIL_AT,
    raw: fullDetailRaw(),
  });
}

/** Prežene cez riadok jeden prechod synchronizácie — reálnou cestou (§ K7). */
async function runListPass(item: ProductListItem = LIST_ITEM): Promise<void> {
  await catalogRepo.upsertMany([toCatalogRow(item, LIST_AT)]);
}

describe.skipIf(!available)('zoznamový prechod vs. doťahnutý detail', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  afterAll(async () => {
    await closePool();
  });

  /* ────────── 1. Detail prežije prechod, keď sa produkt nezmenil ────────── */

  it('detail prežije zoznamový prechod, keď produkt zostal rovnaký', async () => {
    await seedDetail();
    await runListPass();

    const record = await catalogRepo.get(PRODUCT_ID);
    expect(record?.source).toBe('get');
    expect(record?.raw).toMatchObject({ reference: 'AG-1234', qty: 12 });
  });

  it('povrch appky po prechode ďalej vie kód, EAN aj sklad', async () => {
    await seedDetail();
    await runListPass();

    const detail = (await catalogRepo.detailsFor([PRODUCT_ID])).get(PRODUCT_ID);
    expect(detail?.route).toBe('getFull');
    expect(detail?.reference.value).toBe('AG-1234');
    expect(detail?.ean13.value).toBe('8590123456789');
    expect(detail?.quantity.value).toBe(12);
    expect(detail?.variants).toHaveLength(2);
    expect(detail?.variantStock.value).toBe(12);
  });

  it('desať prechodov za sebou detail nezoderie', async () => {
    await seedDetail();
    for (let pass = 0; pass < 10; pass += 1) await runListPass();

    const detail = (await catalogRepo.detailsFor([PRODUCT_ID])).get(PRODUCT_ID);
    expect(detail?.route).toBe('getFull');
    expect(detail?.reference.value).toBe('AG-1234');
  });

  /* ──── 2. Prechod aj tak obnoví to, čo zoznam naozaj nesie a vie ─────── */

  it('prechod obnoví `fetched_at`, aj keď detail nechá na pokoji', async () => {
    await seedDetail();
    await runListPass();

    const record = await catalogRepo.get(PRODUCT_ID);
    expect(record?.fetchedAt.getTime()).toBe(LIST_AT.getTime());
  });

  it('produkt označený `not_found` sa prechodom vráti na `ok` a detail ostane', async () => {
    await seedDetail();
    await catalogRepo.markShopStatus(PRODUCT_ID, 'not_found');
    await runListPass();

    const record = await catalogRepo.get(PRODUCT_ID);
    expect(record?.shopStatus).toBe('ok');
    expect(record?.source).toBe('get');
  });

  /* ─────────── 3. Skutočná zmena v shope detail UVOĽNÍ ─────────────────── */

  it('zmena ceny detail uvoľní — zastaraný detail je tiež nepravda', async () => {
    await seedDetail();
    await runListPass({ ...LIST_ITEM, price: 19.9 });

    const record = await catalogRepo.get(PRODUCT_ID);
    expect(record?.source).toBe('list');
    expect(record?.price).toBe('19.90');
    expect(record?.raw).toEqual({ ...LIST_ITEM, price: 19.9 });

    const detail = (await catalogRepo.detailsFor([PRODUCT_ID])).get(PRODUCT_ID);
    // Riadok sa priznáva ako nedoplnený, takže ho doťahovanie obnoví. Raz.
    expect(detail?.route).toBe('list');
    expect(detail?.reference.gap).toBe('not_fetched');
  });

  it('zmena `has_attributes` detail uvoľní — varianty už neplatia', async () => {
    await seedDetail();
    await runListPass({ ...LIST_ITEM, has_attributes: false });

    const record = await catalogRepo.get(PRODUCT_ID);
    expect(record?.source).toBe('list');
    expect(record?.hasAttributes).toBe(false);
  });

  it('zmena názvu detail uvoľní', async () => {
    await seedDetail();
    await runListPass({ ...LIST_ITEM, name: 'Zlatý prsteň so zirkónom' });

    const record = await catalogRepo.get(PRODUCT_ID);
    expect(record?.source).toBe('list');
    expect(record?.name).toBe('Zlatý prsteň so zirkónom');
  });

  it('zmena diakritiky v názve detail NEuvoľní (kolácia `_ci`, vedomé)', async () => {
    await seedDetail();
    await runListPass({ ...LIST_ITEM, name: 'Strieborny prsten so zirkonom' });

    const record = await catalogRepo.get(PRODUCT_ID);
    expect(record?.source).toBe('get');
    expect(record?.name).toBe('Strieborny prsten so zirkonom');
  });

  /* ────────────── 4. Obohatenie funguje ďalej oboma smermi ─────────────── */

  it('doťahovanie prepíše zoznamový riadok na detail', async () => {
    await runListPass();
    await catalogRepo.upsert({
      productId: PRODUCT_ID,
      name: LIST_ITEM.name,
      price: '24.90',
      hasAttributes: true,
      source: 'batch',
      fetchedAt: new Date('2026-08-25T08:00:00.000Z'),
      raw: fullDetailRaw(),
    });

    const detail = (await catalogRepo.detailsFor([PRODUCT_ID])).get(PRODUCT_ID);
    expect(detail?.source).toBe('batch');
    expect(detail?.route).toBe('getFull');
  });

  it('detail smie prepísať detail (obnova cez `force`)', async () => {
    await seedDetail();
    await catalogRepo.upsert({
      productId: PRODUCT_ID,
      name: LIST_ITEM.name,
      price: '24.90',
      hasAttributes: true,
      source: 'get',
      fetchedAt: new Date('2026-08-25T08:00:00.000Z'),
      raw: { ...fullDetailRaw(), qty: 3 },
    });

    const detail = (await catalogRepo.detailsFor([PRODUCT_ID])).get(PRODUCT_ID);
    expect(detail?.quantity.value).toBe(3);
  });

  it('nový produkt zo zoznamu sa vloží normálne', async () => {
    await runListPass({ ...LIST_ITEM, id: 5150 });

    const record = await catalogRepo.get(5150);
    expect(record?.source).toBe('list');
    expect(record?.price).toBe('24.90');
  });

  it('riadok bez názvu a ceny na oboch stranách detail nezhodí (`<=>`)', async () => {
    await catalogRepo.upsert({
      productId: 5151,
      name: null,
      price: null,
      hasAttributes: false,
      source: 'get',
      fetchedAt: DETAIL_AT,
      raw: { id: 5151, reduction: { state: 'none' } },
    });
    /*
     * `toCatalogRow()` premení necelé číslo na `null` cenu a nereťazcový názov
     * na `null` názov (drift v odpovedi shopu) — presne tá dvojica, na ktorej
     * by obyčajné `=` vrátilo `NULL`, podmienka by vyšla nepravdivo a detail by
     * zmizol. Preto `<=>`. Názov sa sem musí dostať pretypovaním: kontrakt
     * `ProductListItem` ho má ako `string`, ale vetva v `toCatalogRow()` počíta
     * s tým, že shop pošle čokoľvek.
     */
    const drifted = { id: 5151, name: null, price: Number.NaN, has_attributes: false };
    await catalogRepo.upsertMany([toCatalogRow(drifted as unknown as ProductListItem, LIST_AT)]);

    const record = await catalogRepo.get(5151);
    expect(record?.price).toBeNull();
    expect(record?.source).toBe('get');
  });

  /* ──────────── 5. Dávka: každý riadok sa posudzuje sám za seba ────────── */

  it('v jednej dávke prežije nezmenený detail a uvoľní sa len zmenený', async () => {
    const keep = 6001;
    const drop = 6002;
    for (const id of [keep, drop]) {
      await catalogRepo.upsert({
        productId: id,
        name: `Produkt ${id}`,
        price: '10.00',
        hasAttributes: false,
        source: 'get',
        fetchedAt: DETAIL_AT,
        raw: { id, reference: `REF-${id}`, reduction: { state: 'none' } },
      });
    }

    await catalogRepo.upsertMany([
      toCatalogRow({ id: keep, name: `Produkt ${keep}`, price: 10, has_attributes: false }, LIST_AT),
      toCatalogRow({ id: drop, name: `Produkt ${drop}`, price: 11, has_attributes: false }, LIST_AT),
      toCatalogRow({ id: 6003, name: 'Nový', price: 5, has_attributes: false }, LIST_AT),
    ]);

    const rows = await catalogRepo.getMany([keep, drop, 6003]);
    expect(rows.get(keep)?.source).toBe('get');
    expect(rows.get(drop)?.source).toBe('list');
    expect(rows.get(6003)?.source).toBe('list');
  });

  /* ─────────────── 6. Koľko čítaní tá podmienka ušetrí ─────────────────── */

  it('opakovaný prechod nad obohateným katalógom nevyrobí ani jeden nedoplnený riadok', async () => {
    const ids = Array.from({ length: 50 }, (_, index) => 7000 + index);
    for (const id of ids) {
      await catalogRepo.upsert({
        productId: id,
        name: `Produkt ${id}`,
        price: '12.50',
        hasAttributes: false,
        source: 'get',
        fetchedAt: DETAIL_AT,
        raw: { id, reference: `REF-${id}`, reduction: { state: 'none' } },
      });
    }

    for (let pass = 0; pass < 3; pass += 1) {
      await catalogRepo.upsertMany(
        ids.map((id) =>
          toCatalogRow({ id, name: `Produkt ${id}`, price: 12.5, has_attributes: false }, LIST_AT),
        ),
      );
    }

    const details = await catalogRepo.detailsFor(ids);
    const needRefetch = ids.filter((id) => details.get(id)?.route === 'list');
    // Každý taký riadok by `fillProductDetails()` zaplatil znova, na každom
    // prechode. Pred opravou ich tu bolo 50 z 50.
    expect(needRefetch).toEqual([]);
  });
});
