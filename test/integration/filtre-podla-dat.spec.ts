/**
 * Aura Zľavy — FILTRE PODĽA TOHO, ČO APPKA NAOZAJ MÁ (D125, K4) nad SKUTOČNOU DB.
 *
 * Zadanie V5 znie: „filter, ktorý sa nedá naplniť, je sľub, ktorý appka
 * nedodrží". Inventúra 1. 9. 2026 rozdelila filtre na tri kôpky a tento súbor
 * dokazuje, že sa tak aj správajú — proti migrovanej MariaDB, nie proti fake
 * repozitáru (pasca „agentov report nie je dôkaz" z CLAUDE.md):
 *
 *  A. **Štyri filtre nad obohatením naozaj filtrujú.** Marža, sklad, celkovo
 *     objednané kusy a posledný predaj majú v schéme svoj stĺpec (`getFull`,
 *     migrácia 0014) a `search()` podľa nich vyberá riadky. Keby sa filter
 *     ticho ignoroval, testy nižšie by videli celý katalóg.
 *  B. **Neobohatený riadok NIE JE nula.** Do žiadneho zo štyroch filtrov
 *     nespadne — „nevieme, aká je marža" sa nesmie čítať ako „marža je 0" ani
 *     ako „sklad je prázdny" (I11). A že je výsledok zlomok katalógu, odpoveď
 *     PRIZNÁVA (`enrichedOnly`, `counts.enrichedRows`); prázdna tabuľka bez
 *     slova by vyzerala ako „také produkty neexistujú".
 *  C. **Odstránené filtre sa naďalej priznávajú na úrovni API.** Kategória,
 *     kov a typ šperku sa v paneli UŽ NEKRESLIA (to meria
 *     `test/unit/produkty-detail-filtre.spec.ts`), ale keď ich niekto pošle
 *     v adrese, odpoveď povie „poslal si a ja som ho NEPOUŽILA". Naopak sklad,
 *     marža a obrátkovosť medzi zamknutými byť NESMÚ — inak by appka tvrdila,
 *     že filtre, ktoré práve použila, použiť nevie.
 *
 * POZOR na obrátkovosť (R3 kontraktu V5): `qty_in_orders` je CELKOVÉ množstvo
 * za históriu shopu. Filter sa preto volá „celkovo objednané" a okno NESĽUBUJE;
 * že to nesľubuje ani panel, stráži `test/unit/sales-insights.spec.ts`.
 *
 * Vlastník: V5, vlna 1 (D125).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DateOnly, Queryable } from '@/contracts';

import { closePool } from '@/db/pool';
import { catalogRepo } from '@/lib/repo/catalog.repo';

import { dbAvailable, setupTestDb, truncateAll, withMigrationConn } from '../helpers/db';

const available = await dbAvailable();

/** Fixný „dnes" — všetky dátumové hranice sú voči nemu. */
const TODAY: DateOnly = '2026-09-01';

/**
 * Produkty vzorky. Tri OBOHATENÉ s rôznymi hodnotami a dva NEOBOHATENÉ —
 * práve tie druhé sú jadro tvrdenia B: nesmú sa objaviť v ŽIADNOM zo štyroch
 * filtrov, nech je hranica akákoľvek.
 */
const ENRICHED_LOW = 7101; // marža 5 %, sklad 12, objednané 3, predaj 2026-08-20
const ENRICHED_MID = 7102; // marža 40 %, sklad 0, objednané 40, predaj 2026-01-10
const ENRICHED_HIGH = 7103; // marža 90 %, sklad 5, objednané 900, predaj nikdy
const PLAIN_A = 7201; // neobohatený
const PLAIN_B = 7202; // neobohatený

/** Ako vyzerá prázdne obohatenie — vypĺňa sa len to, o čo v teste ide. */
function enrichment(over: {
  marginPercent?: number | null;
  qty?: number | null;
  qtyInOrders?: number | null;
  lastTimeInOrder?: string | null;
}) {
  return {
    reference: null,
    ean13: null,
    purchasePrice: null,
    margin: null,
    marginPercent: null,
    sellPriceWithVat: null,
    lastTimeInOrder: null,
    qty: null,
    qtyInOrders: null,
    supplier: null,
    reductionPercent: null,
    reductionFrom: null,
    reductionTo: null,
    active: null,
    categories: null,
    enrichedAt: new Date('2026-09-01T06:00:00.000Z'),
    ...over,
  };
}

async function seedCatalog(): Promise<void> {
  await catalogRepo.upsertMany([
    { productId: ENRICHED_LOW, name: 'Prsteň nízka marža', price: '10.00', hasAttributes: false, source: 'list', raw: null },
    { productId: ENRICHED_MID, name: 'Náramok stredná marža', price: '20.00', hasAttributes: false, source: 'list', raw: null },
    { productId: ENRICHED_HIGH, name: 'Náušnice vysoká marža', price: '30.00', hasAttributes: false, source: 'list', raw: null },
    { productId: PLAIN_A, name: 'Neobohatený prívesok', price: '40.00', hasAttributes: false, source: 'list', raw: null },
    { productId: PLAIN_B, name: 'Neobohatená retiazka', price: '50.00', hasAttributes: false, source: 'list', raw: null },
  ]);

  await catalogRepo.saveEnrichment(
    ENRICHED_LOW,
    enrichment({ marginPercent: 5, qty: 12, qtyInOrders: 3, lastTimeInOrder: '2026-08-20 10:00:00' }),
  );
  await catalogRepo.saveEnrichment(
    ENRICHED_MID,
    enrichment({ marginPercent: 40, qty: 0, qtyInOrders: 40, lastTimeInOrder: '2026-01-10 10:00:00' }),
  );
  /*
   * `lastTimeInOrder: null` pri OBOHATENOM riadku znamená „shop nevie o žiadnej
   * objednávke" — teda najhorší možný ležiak, nie „nevieme". Preto tento
   * produkt do filtra „posledný predaj starší než" PATRÍ.
   */
  await catalogRepo.saveEnrichment(
    ENRICHED_HIGH,
    enrichment({ marginPercent: 90, qty: 5, qtyInOrders: 900, lastTimeInOrder: null }),
  );
}

/** ID-čka výsledku vzostupne — poradie tu nie je tvrdenie, obsah áno. */
async function idsFor(filter: Parameters<typeof catalogRepo.search>[0]): Promise<number[]> {
  const result = await catalogRepo.search({ today: TODAY, perPage: 50, ...filter });
  return result.data.map((row) => row.productId).sort((a, b) => a - b);
}

describe.skipIf(!available)('filtre podľa dostupných dát (D125, K4)', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  afterAll(async () => {
    await closePool();
  });

  beforeEach(async () => {
    await truncateAll();
    await withMigrationConn(async (conn: Queryable) => {
      await conn.query('DELETE FROM product_sales_daily');
      await conn.query('DELETE FROM sales_sync_state');
    });
    await seedCatalog();
  });

  /* ═══════════ A. Štyri filtre nad obohatením naozaj filtrujú ═════════════ */

  it('marža vyberá podľa percenta zo shopu, nie podľa vlastného výpočtu', async () => {
    // Bez filtra je vo vzorke všetkých päť — inak by testy nižšie „prešli"
    // len preto, že dotaz nevracia nič.
    expect(await idsFor({})).toEqual([ENRICHED_LOW, ENRICHED_MID, ENRICHED_HIGH, PLAIN_A, PLAIN_B]);

    expect(await idsFor({ marginPercentFrom: 30 })).toEqual([ENRICHED_MID, ENRICHED_HIGH]);
    expect(await idsFor({ marginPercentTo: 30 })).toEqual([ENRICHED_LOW]);
    expect(await idsFor({ marginPercentFrom: 30, marginPercentTo: 50 })).toEqual([ENRICHED_MID]);
  });

  it('sklad rozlíši „na sklade" od „vypredané" a nezlieva ich s „nevieme"', async () => {
    expect(await idsFor({ stock: 'in' })).toEqual([ENRICHED_LOW, ENRICHED_HIGH]);
    // Nula je MERANÝ fakt („shop hovorí, že nič nemá"), preto tu je práve jeden.
    expect(await idsFor({ stock: 'out' })).toEqual([ENRICHED_MID]);
  });

  it('celkovo objednané je hranica nad CELOU históriou, nie nad oknom (R3)', async () => {
    expect(await idsFor({ orderedTotalFrom: 40 })).toEqual([ENRICHED_MID, ENRICHED_HIGH]);
    expect(await idsFor({ orderedTotalTo: 40 })).toEqual([ENRICHED_LOW, ENRICHED_MID]);
    expect(await idsFor({ orderedTotalFrom: 4, orderedTotalTo: 100 })).toEqual([ENRICHED_MID]);

    /*
     * A že to okno naozaj NEČÍTA: to isté zadanie s iným oknom predajnosti dá
     * ten istý výsledok. Keby sa `qty_in_orders` tvárilo ako „za okno", tu by
     * sa čísla rozišli — a presne to by bol sľub, ktorý appka nedodrží.
     */
    expect(await idsFor({ orderedTotalFrom: 40, soldWindowDays: 30 })).toEqual(
      await idsFor({ orderedTotalFrom: 40, soldWindowDays: 360 }),
    );
  });

  it('„posledný predaj starší než" berie aj tie, čo sa nepredali NIKDY', async () => {
    // Hranica 90 dní od 2026-09-01 je 2026-06-03: predaj z augusta je čerstvý,
    // januárový starý, a „žiadny predaj" je ten najhorší ležiak zo všetkých.
    expect(await idsFor({ lastSaleOlderDays: 90 })).toEqual([ENRICHED_MID, ENRICHED_HIGH]);
    // Pri veľmi krátkej hranici pribudne aj augustový predaj.
    expect(await idsFor({ lastSaleOlderDays: 1 })).toEqual([
      ENRICHED_LOW,
      ENRICHED_MID,
      ENRICHED_HIGH,
    ]);
  });

  /* ═════════════ B. Neobohatený riadok nie je nula — a povie sa to ════════ */

  it('neobohatený produkt nespadne do ŽIADNEHO zo štyroch filtrov (I11)', async () => {
    const plain = [PLAIN_A, PLAIN_B];
    for (const filter of [
      { marginPercentFrom: -1000 },
      { marginPercentTo: 1000 },
      { stock: 'in' as const },
      { stock: 'out' as const },
      { orderedTotalFrom: 0 },
      { orderedTotalTo: 1_000_000 },
      { lastSaleOlderDays: 1 },
      { lastSaleOlderDays: 3650 },
    ]) {
      const ids = await idsFor(filter);
      for (const id of plain) {
        expect(ids, `neobohatený ${id} prešiel filtrom ${JSON.stringify(filter)}`).not.toContain(
          id,
        );
      }
    }
  });

  it('odpoveď PRIZNÁVA, že tie štyri platia len nad obohatenými riadkami', async () => {
    const result = await catalogRepo.search({ today: TODAY, marginPercentFrom: 30 });
    for (const feature of ['marginPercent', 'stock', 'orderedTotal', 'lastSale'] as const) {
      expect(result.enrichedOnly, `${feature} sa nepriznáva`).toContain(feature);
    }

    /*
     * A číslo, o ktoré ide: koľko riadkov obohatených JE. Bez neho by výsledok
     * „2 z 5" vyzeral ako celý katalóg. `total` je počet po filtri, `enrichedRows`
     * hovorí, z akej časti zrkadla sa vôbec dalo vyberať.
     */
    const counts = await catalogRepo.counts({ today: TODAY });
    expect(counts.total).toBe(5);
    expect(counts.enrichedRows).toBe(3);
  });

  it('nezmyselná hranica filter ZAHODÍ, nevráti prázdno a nespadne', async () => {
    /*
     * Uložený filter aj cudzí odkaz musia prežiť. „Nezmysel" tu neznamená
     * „prázdny výsledok" — filter jednoducho neplatí a vidno celý katalóg.
     */
    const all = [ENRICHED_LOW, ENRICHED_MID, ENRICHED_HIGH, PLAIN_A, PLAIN_B];
    expect(await idsFor({ marginPercentFrom: Number.NaN })).toEqual(all);
    expect(await idsFor({ orderedTotalFrom: -5 })).toEqual(all);
    expect(await idsFor({ lastSaleOlderDays: 0 })).toEqual(all);
    // Nad stropom `MAX_LAST_SALE_OLDER_DAYS` (10 rokov) tiež odpadne.
    expect(await idsFor({ lastSaleOlderDays: 99_999 })).toEqual(all);
  });

  /* ═════════ C. Odstránené filtre sa priznávajú, použité nie ══════════════ */

  it('zamknuté sú UŽ LEN tri a použité filtre medzi nimi nie sú', async () => {
    const result = await catalogRepo.search({ today: TODAY });
    expect([...result.lockedFilters].sort()).toEqual(['category', 'jewelryType', 'metal']);
    /*
     * Sklad, marža a obrátkovosť z toho zoznamu odišli 1. 9. 2026. Keby tam
     * zostali, appka by tvrdila, že filter, ktorý práve použila, použiť nevie —
     * a to je horšie klamstvo než ten zamknutý riadok, ktorý sme odstránili.
     */
    for (const gone of ['stock', 'margin', 'turnover']) {
      expect(result.lockedFilters as readonly string[]).not.toContain(gone);
    }
  });
});
