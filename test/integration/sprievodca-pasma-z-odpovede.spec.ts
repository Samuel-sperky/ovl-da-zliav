/**
 * Aura Zľavy — D121 OD TELA ODPOVEDE PO ČÍSLA SPRIEVODCU
 * (`GET /api/catalog/search` → `parseCatalogPage()` → `buildTiers()`;
 * KONTRAKT-V4-2026-08-28 §2b, D121, invarianty I3 a I11).
 *
 * ČO SA TU DOKAZUJE A PREČO TO INÉ TESTY NEDOKÁŽU
 * ───────────────────────────────────────────────
 * D121 („produkt s neznámym predajom sa do pásiem nezaradí") už raz NEPLATIL
 * end-to-end. Model to vedel — `soldBucketOf(null)` vracia `null` — ale server
 * posielal `unitsSold: 0`, takže `soldBucketOf(0)` dal legitímne vedro `none`
 * a s ním 30 % zľavu na tisícoch produktov, ktoré appka nikdy nezmerala.
 * Nenašlo to 3756 testov, ale preklik v prehliadači.
 *
 * Reťaz má TRI články a každý z nich už raz `null` zahodil alebo mohol:
 *
 *   1. **SQL a repozitár** — `COALESCE(s.units, 0)` bez brány
 *      `status = 'complete'`. Stráži `predaje-brana-pokrytia.spec.ts` nad
 *      skutočnou MariaDB.
 *   2. **Prepis riadku na TELO ODPOVEDE** — `mirrorRowView()` s `?? 0`.
 *      Stráži `routes-v8.spec.ts` §1b.
 *   3. **Prečítanie tela odpovede na strane sprievodcu** — `readCount()`
 *      v `parseCatalogPage()`, a potom rozdelenie do pásiem. TENTO súbor.
 *
 * Tretí článok bez testu znamená, že `null` môže prežiť SQL aj route a zomrieť
 * až v klientskom parseri (`?? 0` v `parseCatalogRow`, alebo `readCount()`,
 * ktoré by chýbajúce pole čítalo ako nulu) — a obrazovka by o tom nepovedala
 * nič, lebo vedro `none` je platné vedro. Meria sa preto CELÁ cesta: route sa
 * naozaj zavolá, jej JSON sa prečíta tým istým parserom ako v prehliadači
 * a z riadkov sa poskladajú pásma tou istou funkciou ako v sprievodcovi.
 *
 * Žiadny shop a žiadny API kľúč — hľadanie je čítanie lokálneho zrkadla (K8,
 * I1, I6). Repozitár je fake, lebo predmetom merania je PREPIS a PREČÍTANIE,
 * nie SQL (to má svoj vlastný test nad DB).
 *
 * ID 90 6xx sú zámerne mimo dosahu ostatných integračných testov — jednu
 * testovaciu MariaDB zdieľa celý repo.
 *
 * Vlastník: V6b (oblasť Nová zľava, krok 1 — sprievodca).
 */
import { describe, expect, it } from 'vitest';

import {
  createCatalogSearchRoute,
  type CatalogSearchRouteDeps,
} from '@/app/api/catalog/search/route';
import {
  buildTiers,
  soldBucketOf,
  type SelectableRow,
} from '@/components/campaigns/discounts-model';
import { unknownTierNoteText } from '@/components/campaigns/NewDiscount';
import { parseCatalogPage } from '@/components/campaigns/zlavy-api';
import type {
  CatalogCounts,
  CatalogSearchFilter,
  CatalogSearchResult,
  CatalogSearchRow,
  LockedCatalogFilter,
} from '@/lib/repo/catalog.repo';

import { makeRequest, parse, actorRouteDeps } from './routes-harness';

/* ═══════════════════════ 1. Zrkadlo katalógu (fake) ═══════════════════════ */

const LOCKED: LockedCatalogFilter[] = ['category', 'metal', 'jewelryType'];
const WINDOW_DAYS = 180;

/** Riadok zrkadla. `unitsSold: null` = „za toto okno to NEVIEME" (D121). */
function mirrorRow(productId: number, unitsSold: number | null): CatalogSearchRow {
  return {
    productId,
    name: `Produkt ${productId}`,
    price: '19.90',
    hasAttributes: false,
    source: 'list',
    fetchedAt: new Date('2026-09-01T01:00:00.000Z'),
    raw: null,
    shopStatus: 'ok',
    unitsSold,
    everDiscounted: false,
    discountedNow: false,
  };
}

/**
 * Vybraná sada: jeden nezmeraný, jeden zmeraný na nule, jeden predaný.
 *
 * Presne tá trojica, ktorou sa dá rozlíšiť „nevieme" od „meranej nuly" — bez
 * prostredného riadku by test prešiel aj implementácii, ktorá `null` a `0`
 * zlieva do jedného.
 */
const NEZMERANY = 90_601;
const MERANA_NULA = 90_602;
const PREDANY = 90_603;

const ROWS: readonly CatalogSearchRow[] = [
  mirrorRow(NEZMERANY, null),
  mirrorRow(MERANA_NULA, 0),
  mirrorRow(PREDANY, 7),
];

function catalogFake(rows: readonly CatalogSearchRow[]): CatalogSearchRouteDeps['catalog'] {
  const unknown = rows.filter((row) => row.unitsSold === null).length;
  return {
    async search(filter: CatalogSearchFilter): Promise<CatalogSearchResult> {
      return {
        data: [...rows],
        page: filter.page ?? 1,
        perPage: filter.perPage ?? 200,
        total: rows.length,
        soldWindowDays: WINDOW_DAYS,
        soldFrom: '2026-03-06',
        soldTo: '2026-09-01',
        /* Okno dočítané z časti — presne stav, v ktorom `null` vzniká. */
        soldCoverage: { windowDays: WINDOW_DAYS, completeDays: 2, unknownDays: 178 },
        lockedFilters: [...LOCKED],
        enrichedOnly: [],
      };
    },
    async counts(filter: CatalogSearchFilter): Promise<CatalogCounts> {
      return {
        total: rows.length,
        sold: { none: 1, low: 0, mid: 1, high: 0 },
        soldUnknown: unknown,
        neverDiscounted: rows.length,
        discountedNow: 0,
        shopDiscountedNow: 0,
        enrichedRows: 0,
        soldWindowDays: filter.soldWindowDays ?? WINDOW_DAYS,
        soldFrom: '2026-03-06',
        soldTo: '2026-09-01',
        lockedFilters: [...LOCKED],
        enrichedOnly: [],
      };
    },
    async totalRows(): Promise<number> {
      return 41_348;
    },
    async lastFetchedAt(): Promise<Date | null> {
      return new Date('2026-09-01T01:00:00.000Z');
    },
  };
}

/** Zavolá route tak, ako ju volá sprievodca, a vráti TELO odpovede. */
async function odpoved(rows: readonly CatalogSearchRow[] = ROWS): Promise<unknown> {
  const route = createCatalogSearchRoute({
    catalog: catalogFake(rows),
    routeDeps: actorRouteDeps(),
  });
  const res = await parse(
    await route(
      makeRequest(
        'GET',
        `/api/catalog/search?soldWindowDays=${WINDOW_DAYS}&counts=1&perPage=200&sort=sold_asc`,
      ),
    ),
  );
  expect(res.status).toBe(200);
  return res.body.data;
}

/* ═════════ A. Telo odpovede rozlišuje „nevieme" od meranej nuly ══════════ */

describe('A. TELO ODPOVEDE `/api/catalog/search` (D121, I11)', () => {
  it('`unitsSold` je `null`, `0` a `7` — tri rôzne hodnoty, nie dve', async () => {
    const body = (await odpoved()) as {
      data: readonly { productId: number; unitsSold: unknown }[];
    };
    const soldOf = (id: number): unknown =>
      body.data.find((row) => row.productId === id)?.unitsSold;

    // Príznak „nevieme" prežil až na drôt.
    expect(soldOf(NEZMERANY)).toBeNull();
    // Meraná nula je FAKT a na `null` sa nemení.
    expect(soldOf(MERANA_NULA)).toBe(0);
    expect(soldOf(PREDANY)).toBe(7);

    /* A výslovne to, čo mutácia `?? 0` spôsobí: nula tam, kde má byť `null`.
       Bez tohto riadku by tvrdenie vyššie prešlo aj `toBeFalsy()`-logike. */
    expect(soldOf(NEZMERANY)).not.toBe(0);
  });

  it('odpoveď POVIE ČÍSLOM, koľko produktov predaj zmeraný nemá', async () => {
    const body = (await odpoved()) as { counts: { soldUnknown: unknown } };
    // Bez tohto čísla obrazovka nemá čím povedať „koľko nevieme" — a pri
    // nedočítanom okne z toho vzniká veta „filtru nevyhovuje ani jeden".
    expect(body.counts.soldUnknown).toBe(1);
  });
});

/* ═════════ B. Parser sprievodcu tri stavy nezlieva ═══════════════════════ */

describe('B. `parseCatalogPage()` čita telo odpovede bez `?? 0`', () => {
  it('do modelu vojde `null`, nie nula', async () => {
    const page = parseCatalogPage(await odpoved());
    expect(page).not.toBeNull();
    const soldOf = (id: number): number | null | undefined =>
      page!.data.find((row) => row.productId === id)?.unitsSold;

    expect(soldOf(NEZMERANY)).toBeNull();
    expect(soldOf(MERANA_NULA)).toBe(0);
    expect(soldOf(PREDANY)).toBe(7);
    expect(page!.counts?.soldUnknown).toBe(1);
  });

  it('chýbajúce pole `unitsSold` je tiež „nevieme", nie nula', () => {
    /*
     * Odpoveď staršej appky (alebo skrátený JSON) pole nemusí niesť vôbec.
     * Fail-closed: neprítomnosť sa čita ako „nevieme" — z nuly by bolo vedro
     * `none` a 30 % zľava na produkte, o ktorom appka nevie nič.
     */
    const page = parseCatalogPage({
      data: [{ productId: 90_604, name: 'Bez poľa', price: '10.00', shopStatus: 'ok' }],
      page: 1,
      perPage: 200,
      total: 1,
      soldWindowDays: WINDOW_DAYS,
      catalogTotal: 41_348,
      dataAsOf: '2026-09-01T01:00:00.000Z',
      counts: null,
      lockedFilters: {},
    });
    expect(page).not.toBeNull();
    expect(page!.data[0]?.unitsSold).toBeNull();
  });
});

/* ═════════ C. Pásma sprievodcu: nezmeraný produkt do zľavy NEIDE ═════════ */

describe('C. `buildTiers()` nad TELOM ODPOVEDE (D121, I3)', () => {
  /** Presne ten prevod, aký robí sprievodca po načítaní strany výberu. */
  async function vyber(): Promise<readonly SelectableRow[]> {
    const page = parseCatalogPage(await odpoved());
    expect(page).not.toBeNull();
    return page!.data.map((row) => ({
      productId: row.productId,
      name: row.name,
      price: row.price,
      unitsSold: row.unitsSold,
      discountedNow: row.discountedNow,
    }));
  }

  it('nezmeraný produkt je v `unknownProductIds`, nie vo vedre `none`', async () => {
    const partition = buildTiers(await vyber(), WINDOW_DAYS);

    expect(partition.unknownProductIds).toEqual([NEZMERANY]);
    // Do žiadneho pásma sa nedostal…
    for (const tier of partition.tiers) {
      expect(tier.productIds, tier.bucket).not.toContain(NEZMERANY);
    }
    // …a meraná nula áno, lebo to je fakt (vedro `none`, najhlbšia zľava).
    const none = partition.tiers.find((tier) => tier.bucket === 'none');
    expect(none?.productIds).toEqual([MERANA_NULA]);
  });

  it('veľkosť ZÁPISU je menšia než veľkosť VÝBERU — a o presne jeden', async () => {
    const rows = await vyber();
    const partition = buildTiers(rows, WINDOW_DAYS);
    const zapis = partition.tiers.flatMap((tier) => tier.productIds);

    expect(rows).toHaveLength(3);
    expect(zapis).toHaveLength(2);
    expect(zapis.length + partition.unknownProductIds.length).toBe(rows.length);
  });

  it('sprievodca ten rozdiel POVIE ČÍSLOM a s dôvodom (I11)', async () => {
    const rows = await vyber();
    const partition = buildTiers(rows, WINDOW_DAYS);
    const zapis = partition.tiers.flatMap((tier) => tier.productIds);

    const veta = unknownTierNoteText({
      unknownCount: partition.unknownProductIds.length,
      soldWindowDays: WINDOW_DAYS,
      discountedCount: zapis.length,
      selectedCount: rows.length,
    });
    expect(veta).not.toBeNull();
    expect(veta!).toContain('1 vybraný produkt nemá');
    expect(veta!).toContain('180');
    expect(veta!).toContain('Zľavu dostane 2 z 3');
  });

  it('keby telo odpovede poslalo nulu, pásmo by vzniklo — presne ten pád', async () => {
    /*
     * Nie je to test cudzieho kódu, je to DÔKAZ, že tvrdenia vyššie merajú
     * naozaj `null`, a nie nejakú inú vlastnosť riadku. Keď sa `null` vymení
     * za nulu, produkt sa do vedra `none` zaradí a dostane 30 % — teda presne
     * to, čo appka do 31. 8. 2026 robila na tisícoch produktov.
     */
    expect(soldBucketOf(null)).toBeNull();
    expect(soldBucketOf(0)).toBe('none');

    const sNulou = (await odpoved([mirrorRow(NEZMERANY, 0), ...ROWS.slice(1)])) as {
      data: readonly { productId: number; unitsSold: unknown }[];
    };
    expect(sNulou.data.find((row) => row.productId === NEZMERANY)?.unitsSold).toBe(0);

    const page = parseCatalogPage(sNulou);
    const partition = buildTiers(
      page!.data.map((row) => ({
        productId: row.productId,
        name: row.name,
        price: row.price,
        unitsSold: row.unitsSold,
        discountedNow: row.discountedNow,
      })),
      WINDOW_DAYS,
    );
    expect(partition.unknownProductIds).toEqual([]);
    expect(partition.tiers.find((tier) => tier.bucket === 'none')?.productIds).toContain(
      NEZMERANY,
    );
  });
});
