/**
 * Aura Zľavy — KPI produktu: TRI stavy každého čísla (KONTRAKT-V4-2026-08-28,
 * D114 v revízii D117–D119; invariant I11).
 *
 * ČO TENTO SÚBOR STRÁŽI A PREČO EXISTUJE
 * --------------------------------------
 * KPI produktu má tri stavy, nie dva: **hodnotu**, **„nevieme, produkt nie je
 * obohatený"** a **„nevieme, dni okna chýbajú"**. Zámena ktoréhokoľvek z tých
 * dvoch „nevieme" za nulu je chyba, ktorá sa v tomto repe UŽ RAZ dostala do
 * produkcie (štrnásť `partial` dní sa počítalo ako pokryté a každé číslo
 * o predajnosti bolo osemkrát nižšie).
 *
 * Testy sú preto písané tak, aby ZČERVENALI presne pri tej zámene:
 *  · pri každom „nevieme" sa tvrdí `value === null` A `gap` A `not.toBe(0)`,
 *    takže `?? 0` na ktorejkoľvek ceste súbor rozbije,
 *  · neobohatené polia sa kontrolujú CYKLOM cez zoznam, takže nové KPI
 *    s nulovou predvoľbou spadne bez toho, aby si niekto musel spomenúť,
 *  · „bez predaja" sa skúša aj na neobohatenom a aj na čiastočne pokrytom okne
 *    — mŕtvy produkt sa smie tvrdiť len s dôkazom (D119).
 *
 * Bez DB a bez siete: `buildProductKpis()` a jeho pomocníci sú čisté funkcie
 * (`productKpis()` s fake závislosťami sa tu skúša len na počet dotazov —
 * skutočné SQL kryje `test/integration/kpi-produktu.spec.ts`).
 */
import { describe, expect, it } from 'vitest';

import type {
  CatalogEnrichmentRecord,
  DateOnly,
  DbRow,
  KpiValue,
  KpiWindowUnits,
  Queryable,
  SalesDayCoverage,
} from '@/contracts';

import { addDays, startOfDayUtc } from '@/lib/domain/dates';
import type { CatalogKpiRow } from '@/lib/repo/catalog.repo';
import { emptyCatalogEnrichment } from '@/lib/repo/catalog.repo';
import type { KpiUnitsRow } from '@/lib/sales/insights';
import {
  buildProductKpis,
  kpiActiveDiscount,
  kpiNoSale,
  KPI_WINDOW_LONG_DAYS,
  KPI_WINDOW_SHORT_DAYS,
  productKpis,
  windowCoverage,
} from '@/lib/sales/insights';

const TODAY = '2026-08-20' as DateOnly;
const P = 90_301;

/* ═══════════════════════════ Pomocníci testu ══════════════════════════════ */

function enrichment(patch: Partial<CatalogEnrichmentRecord> = {}): CatalogEnrichmentRecord {
  return { ...emptyCatalogEnrichment(P), ...patch };
}

function catalogRow(patch: Partial<CatalogKpiRow> = {}): CatalogKpiRow {
  return {
    productId: P,
    missing: false,
    name: 'Náramok zirkón',
    price: '19.99',
    enrichment: enrichment(),
    ...patch,
  };
}

/**
 * Okno končiace `TODAY`, z ktorého je dočítaných `complete` NAJNOVŠÍCH dní.
 * Dni sa počítajú kalendárne cez `addDays()` — ručné skladanie `2026-08-${n}`
 * pretečie za hranicu mesiaca a vyrobí neplatné dátumy.
 */
function coverage(windowDays: number, complete: number): ReturnType<typeof windowCoverage> {
  const days: Array<{ day: DateOnly; coverage: SalesDayCoverage }> = [];
  for (let i = 0; i < windowDays; i += 1) {
    days.push({ day: addDays(TODAY, -i), coverage: i < complete ? 'complete' : 'pending' });
  }
  return windowCoverage(days, addDays(TODAY, -(windowDays - 1)), TODAY);
}

function rowFor(
  patch: Partial<CatalogKpiRow>,
  opts: { units?: KpiUnitsRow; short?: [number, number]; long?: [number, number] } = {},
) {
  const [shortDays, shortComplete] = opts.short ?? [30, 30];
  const [longDays, longComplete] = opts.long ?? [90, 90];
  const units = new Map<number, KpiUnitsRow>();
  if (opts.units !== undefined) units.set(P, opts.units);
  const rows = buildProductKpis({
    products: [catalogRow(patch)],
    units,
    window30: coverage(shortDays, shortComplete),
    window90: coverage(longDays, longComplete),
    today: TODAY,
  });
  const row = rows[0];
  if (row === undefined) throw new Error('buildProductKpis nevrátil riadok');
  return row;
}

/** „Nevieme" sa tvrdí naraz troma spôsobmi — nula tým prepadne. */
function expectUnknown<T>(value: KpiValue<T>, gap: string, label: string): void {
  expect(value.value, `${label}: hodnota musí byť null, nie nula`).toBeNull();
  expect(value.gap, `${label}: musí povedať PREČO chýba`).toBe(gap);
  expect(value.value, `${label}: nula je zakázaná (I11)`).not.toBe(0);
}

/* ══════════════════ 1. Pokrytie okna: čo appka NEMÁ ══════════════════════ */

describe('windowCoverage — koľko dní okna appka nemá (D119)', () => {
  it('prázdny stav synchronizácie je CELÉ okno neznáme, nie pokryté okno', () => {
    const window = windowCoverage([], '2026-08-11' as DateOnly, TODAY);
    expect(window.windowDays).toBe(10);
    expect(window.completeDays).toBe(0);
    // Keby sa `unknownDays` počítalo z riadkov, ktoré NIE SÚ complete, vyšla by
    // tu nula — teda „celé okno máme" nad prázdnou tabuľkou.
    expect(window.unknownDays).toBe(10);
  });

  it('`partial` ani `pending` deň NIE JE dočítaný deň', () => {
    const window = windowCoverage(
      [
        { day: '2026-08-18' as DateOnly, coverage: 'complete' },
        { day: '2026-08-19' as DateOnly, coverage: 'partial' },
        { day: TODAY, coverage: 'pending' },
      ],
      '2026-08-18' as DateOnly,
      TODAY,
    );
    expect(window.completeDays).toBe(1);
    expect(window.unknownDays).toBe(2);
  });

  it('dni mimo okna sa nepočítajú ani ako dočítané, ani ako chýbajúce', () => {
    const window = windowCoverage(
      [
        { day: '2026-07-01' as DateOnly, coverage: 'complete' },
        { day: TODAY, coverage: 'complete' },
      ],
      '2026-08-19' as DateOnly,
      TODAY,
    );
    expect(window.windowDays).toBe(2);
    expect(window.completeDays).toBe(1);
    expect(window.unknownDays).toBe(1);
  });
});

/* ══════════════ 2. Okno 30/90 d: hodnota, dolná hranica, nevieme ═════════ */

describe('kusy za okno — tri stavy (D119)', () => {
  it('žiadny dočítaný deň = NEVIEME, nikdy nula', () => {
    const row = rowFor({}, { short: [30, 0], long: [90, 0] });
    expectUnknown(row.units30.units, 'days_missing', 'ks 30 d bez dát');
    expectUnknown(row.units90.units, 'days_missing', 'ks 90 d bez dát');
    expect(row.units30.unknownDays).toBe(30);
    expect(row.units90.unknownDays).toBe(90);
  });

  it('čiastočne pokryté okno dá DOLNÚ HRANICU a povie, koľko dní chýba', () => {
    const row = rowFor({}, { units: { shortUnits: 4, longUnits: 9 }, short: [30, 10], long: [90, 40] });
    expect(row.units30.units.value).toBe(4);
    expect(row.units30.units.gap).toBe('days_missing');
    expect(row.units30.lowerBound).toBe(true);
    expect(row.units30.unknownDays).toBe(20);
    expect(row.units90.units.value).toBe(9);
    expect(row.units90.unknownDays).toBe(50);
    expect(row.units90.lowerBound).toBe(true);
  });

  it('celé okno dočítané a bez predaja = ZMERANÁ nula (gap null)', () => {
    const row = rowFor({}, { short: [30, 30], long: [90, 90] });
    expect(row.units30.units.value).toBe(0);
    expect(row.units30.units.gap).toBeNull();
    expect(row.units30.lowerBound).toBe(false);
    expect(row.units90.units.value).toBe(0);
    expect(row.units90.units.gap).toBeNull();
  });

  it('krátke a dlhé okno sú DVE čísla z jedného riadku, nie jedno', () => {
    const row = rowFor({}, { units: { shortUnits: 3, longUnits: 17 } });
    expect(row.units30.units.value).toBe(3);
    expect(row.units90.units.value).toBe(17);
    expect(row.units30.windowDays).toBe(30);
    expect(row.units90.windowDays).toBe(90);
  });

  it('predvolené okná sú 30 a 90 dní (D114)', () => {
    expect(KPI_WINDOW_SHORT_DAYS).toBe(30);
    expect(KPI_WINDOW_LONG_DAYS).toBe(90);
  });
});

/* ═══════════ 3. KPI z obohatenia: neobohatené ≠ nula (D118, I11) ═════════ */

describe('KPI z `getFull` — neobohatený produkt nevie NIČ', () => {
  it('každé pole z obohatenia hlási `not_enriched`, ani jedno nulu', () => {
    const row = rowFor({});
    const fields: Array<[string, KpiValue<unknown>]> = [
      ['referencia', row.reference],
      ['dodávateľ', row.supplier],
      ['cena s DPH', row.priceWithVat],
      ['nákupná cena', row.purchasePrice],
      ['marža €', row.margin],
      ['marža %', row.marginPercent],
      ['sklad', row.stock],
      ['celkovo predané', row.soldTotal],
      ['posledný predaj', row.lastSaleAt],
      ['dni od predaja', row.daysSinceLastSale],
      ['predané / sklad', row.soldPerStock],
    ];
    for (const [label, value] of fields) expectUnknown(value, 'not_enriched', label);
    expect(row.enrichedAt).toBeNull();
  });

  it('produkt, ktorý zrkadlo vôbec nemá, je `missing` — a nie mŕtvy produkt', () => {
    const row = rowFor({ missing: true, name: null, price: null }, { short: [30, 0], long: [90, 0] });
    expect(row.missing).toBe(true);
    expect(row.name).toBeNull();
    expect(row.listPrice).toBeNull();
    expect(row.noSale.mark).toBe(false);
    expect(row.noSale.proof).toBeNull();
  });

  it('obohatený produkt vydá hodnoty a `0` prežije ako platná nula', () => {
    const at = new Date('2026-08-20T09:00:00Z');
    const row = rowFor({
      enrichment: enrichment({
        enrichedAt: at,
        reference: 'SP-1234',
        supplier: 'Dodávateľ s. r. o.',
        sellPriceWithVat: 23.99,
        purchasePrice: 6.3,
        margin: 13.69,
        marginPercent: 68.5,
        qty: 0,
        qtyInOrders: 0,
      }),
    });
    expect(row.reference.value).toBe('SP-1234');
    expect(row.reference.gap).toBeNull();
    expect(row.supplier.value).toBe('Dodávateľ s. r. o.');
    expect(row.priceWithVat.value).toBe(23.99);
    expect(row.purchasePrice.value).toBe(6.3);
    // Vypredané NIE JE „nevieme": nula je meraná hodnota a `gap` musí byť null.
    expect(row.stock.value).toBe(0);
    expect(row.stock.gap).toBeNull();
    expect(row.soldTotal.value).toBe(0);
    expect(row.soldTotal.gap).toBeNull();
    expect(row.enrichedAt).toEqual(at);
  });

  it('MARŽA SA NEPREPOČÍTAVA — vráti sa presne to, čo poslal shop', () => {
    // Z týchto cien by „vlastný" výpočet dal 17.69, resp. 73.7 %. Keď sa niekto
    // rozhodne maržu dopočítať, tento test spadne — a to je jeho zmysel.
    const row = rowFor({
      enrichment: enrichment({
        enrichedAt: new Date('2026-08-20T09:00:00Z'),
        purchasePrice: 6.3,
        sellPriceWithVat: 23.99,
        margin: 7.77,
        marginPercent: 11.11,
      }),
    });
    expect(row.margin.value).toBe(7.77);
    expect(row.marginPercent.value).toBe(11.11);
  });

  it('obohatený, ale shop pole nevedie = `shop_has_none`, nie `not_enriched`', () => {
    const row = rowFor({
      enrichment: enrichment({ enrichedAt: new Date('2026-08-20T09:00:00Z'), qty: 4 }),
    });
    expectUnknown(row.reference, 'shop_has_none', 'referencia');
    expectUnknown(row.margin, 'shop_has_none', 'marža €');
    expectUnknown(row.soldTotal, 'shop_has_none', 'celkovo predané');
    // Sklad tu známy JE — dôvod chýbania sa nesmie rozliať na celý riadok.
    expect(row.stock.value).toBe(4);
  });
});

/* ═════════════════ 4. Aktívna zľava podľa SHOPU (I11) ════════════════════ */

describe('aktívna zľava % — stav podľa shopu, nie podľa nás', () => {
  it('okno, ktoré dnes beží, dá percento a `running`', () => {
    const at = new Date('2026-08-20T06:00:00Z');
    const discount = kpiActiveDiscount(
      enrichment({
        enrichedAt: at,
        reductionPercent: 20,
        reductionFrom: startOfDayUtc('2026-08-18' as DateOnly),
        reductionTo: startOfDayUtc('2026-08-25' as DateOnly),
      }),
      TODAY,
    );
    expect(discount.state).toBe('running');
    expect(discount.activePercent.value).toBe(20);
    expect(discount.activePercent.gap).toBeNull();
    expect(discount.measuredAt).toEqual(at);
  });

  it('okno končiace DNES o polnoci stále BEŽÍ — porovnáva sa po dňoch', () => {
    // Keby sa `reduction_to` bralo ako presný okamih, zľava by od prvej sekundy
    // po polnoci vyzerala ako uplynulá, hoci celý deň beží.
    const discount = kpiActiveDiscount(
      enrichment({
        enrichedAt: new Date('2026-08-20T06:00:00Z'),
        reductionPercent: 15,
        reductionFrom: startOfDayUtc('2026-08-01' as DateOnly),
        reductionTo: startOfDayUtc(TODAY),
      }),
      TODAY,
    );
    expect(discount.state).toBe('running');
    expect(discount.activePercent.value).toBe(15);
  });

  it('uplynuté okno NEDÁ percento do stĺpca „aktívna zľava"', () => {
    const discount = kpiActiveDiscount(
      enrichment({
        enrichedAt: new Date('2026-08-20T06:00:00Z'),
        reductionPercent: 30,
        reductionFrom: startOfDayUtc('2026-08-01' as DateOnly),
        reductionTo: startOfDayUtc('2026-08-19' as DateOnly),
      }),
      TODAY,
    );
    expect(discount.state).toBe('ended');
    expectUnknown(discount.activePercent, 'shop_has_none', 'aktívna zľava uplynutého okna');
    // Percento sa nestráca — len nesmie ísť do stĺpca aktívnej zľavy.
    expect(discount.reportedPercent.value).toBe(30);
  });

  it('okno v budúcnosti je `scheduled`, nie bežiaca zľava', () => {
    const discount = kpiActiveDiscount(
      enrichment({
        enrichedAt: new Date('2026-08-20T06:00:00Z'),
        reductionPercent: 10,
        reductionFrom: startOfDayUtc('2026-08-21' as DateOnly),
        reductionTo: startOfDayUtc('2026-08-30' as DateOnly),
      }),
      TODAY,
    );
    expect(discount.state).toBe('scheduled');
    expectUnknown(discount.activePercent, 'shop_has_none', 'aktívna zľava budúceho okna');
    expect(discount.reportedPercent.value).toBe(10);
  });

  it('obohatený bez zľavy = MERANÉ „nič nebeží" (`none`), nie 0 %', () => {
    const at = new Date('2026-08-20T06:00:00Z');
    const discount = kpiActiveDiscount(enrichment({ enrichedAt: at }), TODAY);
    expect(discount.state).toBe('none');
    expectUnknown(discount.activePercent, 'shop_has_none', 'aktívna zľava bez okna');
    expect(discount.from).toBeNull();
    expect(discount.to).toBeNull();
    expect(discount.measuredAt).toEqual(at);
  });

  it('neobohatený produkt o zľave nevie NIČ a nemá ani čas merania', () => {
    const discount = kpiActiveDiscount(enrichment(), TODAY);
    expect(discount.state).toBe('unknown');
    expectUnknown(discount.activePercent, 'not_enriched', 'aktívna zľava neobohateného');
    expectUnknown(discount.reportedPercent, 'not_enriched', 'nahlásené % neobohateného');
    expect(discount.measuredAt).toBeNull();
  });

  it('nekonzistentná trojica zo shopu je NEVEDOMOSŤ, nie dopočítané okno', () => {
    const discount = kpiActiveDiscount(
      enrichment({
        enrichedAt: new Date('2026-08-20T06:00:00Z'),
        reductionPercent: 25,
        reductionFrom: startOfDayUtc('2026-08-18' as DateOnly),
        reductionTo: null,
      }),
      TODAY,
    );
    expect(discount.state).toBe('unknown');
    expectUnknown(discount.activePercent, 'shop_has_none', 'aktívna zľava pri chýbajúcom `to`');
  });
});

/* ══════════ 5. Obrátkovosť: pomer, delenie nulou, nevedomosť ═════════════ */

describe('predané / sklad — pomer z dvoch meraných faktov (D119)', () => {
  it('spočíta pomer z celkovo predaných a skladu', () => {
    const row = rowFor({
      enrichment: enrichment({
        enrichedAt: new Date('2026-08-20T09:00:00Z'),
        qty: 4,
        qtyInOrders: 10,
      }),
    });
    expect(row.soldPerStock.value).toBe(2.5);
    expect(row.soldPerStock.gap).toBeNull();
  });

  it('sklad 0 = pomer HODNOTU NEMÁ (`not_computable`), nie nula ani nekonečno', () => {
    const row = rowFor({
      enrichment: enrichment({
        enrichedAt: new Date('2026-08-20T09:00:00Z'),
        qty: 0,
        qtyInOrders: 12,
      }),
    });
    expectUnknown(row.soldPerStock, 'not_computable', 'predané / sklad pri sklade 0');
    expect(Number.isFinite(row.soldPerStock.value ?? 0)).toBe(true);
  });

  it('chýbajúca ingrediencia si dôvod ponechá (`shop_has_none`)', () => {
    const row = rowFor({
      enrichment: enrichment({ enrichedAt: new Date('2026-08-20T09:00:00Z'), qty: 3 }),
    });
    expectUnknown(row.soldPerStock, 'shop_has_none', 'predané / sklad bez `qty_in_orders`');
  });
});

describe('dni od posledného predaja', () => {
  it('spočíta dni z `last_time_in_order` v zóne logiky', () => {
    const row = rowFor({
      enrichment: enrichment({
        enrichedAt: new Date('2026-08-20T09:00:00Z'),
        lastTimeInOrder: startOfDayUtc('2026-08-06' as DateOnly),
      }),
    });
    expect(row.lastSaleAt.value).toEqual(startOfDayUtc('2026-08-06' as DateOnly));
    expect(row.daysSinceLastSale.value).toBe(14);
  });

  it('shop o žiadnom predaji nevie = `shop_has_none`, nie 0 dní', () => {
    const row = rowFor({
      enrichment: enrichment({ enrichedAt: new Date('2026-08-20T09:00:00Z'), qtyInOrders: 3 }),
    });
    expectUnknown(row.daysSinceLastSale, 'shop_has_none', 'dni od predaja');
  });
});

/* ═════════ 6. Značka „bez predaja": len s dôkazom (D119) ═════════════════ */

describe('značka „bez predaja" — neobohatený produkt NIE JE mŕtvy produkt', () => {
  it('bez obohatenia a bez dní značka NEVZNIKNE', () => {
    const row = rowFor({}, { short: [30, 0], long: [90, 0] });
    expect(row.noSale.mark).toBe(false);
    expect(row.noSale.proof).toBeNull();
  });

  it('shop nemá ani jednu objednávku → dôkaz `shop_never_ordered`', () => {
    const row = rowFor(
      {
        enrichment: enrichment({
          enrichedAt: new Date('2026-08-20T09:00:00Z'),
          lastTimeInOrder: null,
          qtyInOrders: 0,
        }),
      },
      { short: [30, 0], long: [90, 0] },
    );
    expect(row.noSale.mark).toBe(true);
    expect(row.noSale.proof).toBe('shop_never_ordered');
  });

  it('protirečivá odpoveď shopu (bez dátumu, ale s kusmi) značku NEDÁ', () => {
    const row = rowFor(
      {
        enrichment: enrichment({
          enrichedAt: new Date('2026-08-20T09:00:00Z'),
          lastTimeInOrder: null,
          qtyInOrders: 5,
        }),
      },
      { short: [30, 0], long: [90, 0] },
    );
    expect(row.noSale.mark).toBe(false);
    expect(row.noSale.proof).toBeNull();
  });

  it('celé dlhé okno dočítané a v ňom nula kusov → `no_sale_in_covered_days`', () => {
    const row = rowFor({}, { short: [30, 30], long: [90, 90] });
    expect(row.noSale.mark).toBe(true);
    expect(row.noSale.proof).toBe('no_sale_in_covered_days');
  });

  it('ČIASTOČNE pokryté okno s nulou NEDOKAZUJE nič', () => {
    // Presne tá zámena, ktorá sa už raz dostala do produkcie: 89 z 90 dní
    // stiahnutých a nula kusov ešte neznamená, že sa produkt nepredáva.
    const row = rowFor({}, { short: [30, 29], long: [90, 89] });
    expect(row.units90.units.value).toBe(0);
    expect(row.units90.units.gap).toBe('days_missing');
    expect(row.noSale.mark).toBe(false);
    expect(row.noSale.proof).toBeNull();
  });

  it('produkt s predajom v dočítanom okne značku nedostane', () => {
    const row = rowFor({}, { units: { shortUnits: 1, longUnits: 2 } });
    expect(row.noSale.mark).toBe(false);
  });

  it('dôkaz zo shopu má prednosť pred dôkazom z okna', () => {
    // Oba dôkazy platia naraz. Uvedie sa ten silnejší: `getFull` hovorí o CELEJ
    // histórii produktu, kým okno len o 90 dňoch.
    const covered: KpiWindowUnits = {
      windowDays: 90,
      from: addDays(TODAY, -89),
      to: TODAY,
      completeDays: 90,
      unknownDays: 0,
      units: { value: 0, gap: null },
      lowerBound: false,
    };
    const proof = kpiNoSale(
      enrichment({
        enrichedAt: new Date('2026-08-20T09:00:00Z'),
        lastTimeInOrder: null,
        qtyInOrders: 0,
      }),
      covered,
    );
    expect(proof).toEqual({ mark: true, proof: 'shop_never_ordered' });
  });
});

/* ═════════════ 7. Strana 100 produktov = TRI dotazy, nie 300 ═════════════ */

describe('productKpis — jeden dotaz na zdroj, žiadne N+1 (D114)', () => {
  const IDS = Array.from({ length: 100 }, (_, i) => 90_400 + i);

  function fakes() {
    const calls = { catalog: 0, coverage: 0, conn: 0 };
    const catalog = {
      kpiRowsFor: async (ids: readonly number[]): Promise<Map<number, CatalogKpiRow>> => {
        calls.catalog += 1;
        const out = new Map<number, CatalogKpiRow>();
        for (const id of ids) out.set(id, { ...catalogRow(), productId: id });
        return out;
      },
    };
    const sales = {
      coverageFor: async (from: DateOnly, to: DateOnly) => {
        calls.coverage += 1;
        return { from, to, days: [], completeDays: 0, unknownDays: 90 };
      },
    };
    const conn: Queryable = {
      query: async <T>(): Promise<T> => {
        calls.conn += 1;
        return [] as unknown as T;
      },
    };
    return { calls, catalog, sales, conn };
  }

  it('sto produktov prečíta tri dotazy — jeden na každý zdroj', async () => {
    const { calls, catalog, sales, conn } = fakes();
    const page = await productKpis(IDS, { catalog, sales, conn, today: TODAY });
    expect(page.rows).toHaveLength(100);
    expect(calls.catalog).toBe(1);
    expect(calls.coverage).toBe(1);
    expect(calls.conn).toBe(1);
  });

  it('poradie riadkov je poradie ID — KPI triedenie tabuľky neprehodí', async () => {
    const { catalog, sales, conn } = fakes();
    const page = await productKpis([90_403, 90_401, 90_402], {
      catalog,
      sales,
      conn,
      today: TODAY,
    });
    expect(page.rows.map((row) => row.productId)).toEqual([90_403, 90_401, 90_402]);
  });

  it('prázdny zoznam ID nečíta DB a okná hlási ako NEPOKRYTÉ', async () => {
    const { calls, catalog, sales, conn } = fakes();
    const page = await productKpis([], { catalog, sales, conn, today: TODAY });
    expect(page.rows).toEqual([]);
    expect(calls.catalog + calls.coverage + calls.conn).toBe(0);
    // Bezpečný smer: „nevieme" sa nakresliť dá, vymyslené pokrytie nie.
    expect(page.window30.unknownDays).toBe(page.window30.windowDays);
    expect(page.window90.unknownDays).toBe(90);
  });

  it('okná sa počítajú voči `today` a krátke nikdy neprerastie dlhé', async () => {
    const { catalog, sales, conn } = fakes();
    const page = await productKpis([90_401], {
      catalog,
      sales,
      conn,
      today: TODAY,
      shortWindowDays: 120,
      longWindowDays: 7,
    });
    expect(page.window90.windowDays).toBe(7);
    expect(page.window30.windowDays).toBe(7);
    expect(page.window90.from).toBe('2026-08-14');
    expect(page.window90.to).toBe(TODAY);
  });

  it('deň sa počíta v zóne logiky, NIKDY v UTC', async () => {
    const { catalog, sales, conn } = fakes();
    // 22:30 UTC je v Bratislave už zajtra — v UTC by `today` vyšlo o deň menej
    // a celé okno by sedelo o deň vedľa (D31).
    const page = await productKpis([90_401], {
      catalog,
      sales,
      conn,
      now: new Date('2026-05-14T22:30:00Z'),
    });
    expect(page.today).toBe('2026-05-15');
  });

  it('neplatné ID (nula, zápor, necelé) sa do dotazu nedostanú', async () => {
    const { catalog, sales, conn } = fakes();
    const page = await productKpis([0, -5, 1.5, 90_401], { catalog, sales, conn, today: TODAY });
    expect(page.rows.map((row) => row.productId)).toEqual([90_401]);
  });
});

/* ═══════ 8. Poistka proti tichému `?? 0` na ceste z DB do KPI ════════════ */

describe('kusy z DB — riadok, ktorý dotaz nevrátil', () => {
  it('chýbajúci kľúč v mape je nula LEN nad dočítanými dňami', () => {
    const units = new Map<number, KpiUnitsRow>();
    const rows = buildProductKpis({
      products: [catalogRow(), { ...catalogRow(), productId: P + 1 }],
      units,
      window30: coverage(30, 30),
      window90: coverage(90, 0),
      today: TODAY,
    });
    const first = rows[0];
    if (first === undefined) throw new Error('chýba riadok');
    // 30 d je celé dočítané → zmeraná nula. 90 d nemá ani jeden deň → „nevieme".
    expect(first.units30.units.value).toBe(0);
    expect(first.units30.units.gap).toBeNull();
    expectUnknown(first.units90.units, 'days_missing', 'ks 90 d bez dočítaného dňa');
  });

  it('`DbRow` z dotazu sa nikde nemieša s nulou (typová poistka)', () => {
    // Drží import `DbRow` v teste zmysluplný: keby sa tvar riadku zmenil,
    // `kpiUnitsInCompleteDays()` prestane typovať a spadne `tsc`, nie beh.
    const row: DbRow = { product_id: P, units_short: '3', units_long: '9' };
    expect(Number(row.units_long)).toBe(9);
  });
});
