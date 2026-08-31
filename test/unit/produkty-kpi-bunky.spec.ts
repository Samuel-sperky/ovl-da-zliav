/**
 * Aura Zľavy — KPI TABUĽKY PRODUKTOV: TRI STAVY KAŽDÉHO ČÍSLA
 * (kontrakt V4 D114, D116–D119; invariant I11).
 *
 * ČO TENTO SÚBOR STRÁŽI
 * ─────────────────────
 * Stránka Produktov je miesto, kde si človek podľa čísel naklikáva tisíce kusov
 * do zľavy. Každé číslo na nej má tri možné stavy a JEDINÁ chyba, ktorá sa tu
 * dá spraviť ticho, je zliať ich na dva:
 *
 *  1. hodnota — appka ju naozaj zmerala (`0` je platná nula),
 *  2. „produkt nie je obohatený" — `getFull` sa naň nikdy nepýtalo (D118),
 *  3. „dni chýbajú" — okno nie je stiahnuté, súčet by bol nižší (D119).
 *
 * Testy sú napísané tak, aby ZČERVENALI presne pri tom zliatí: keby `kpiCell()`
 * pri medzere vrátila nulu (alebo keby si ju tabuľka domyslela cez `?? 0`),
 * spadne to tu, nie v produkcii. V tomto repe to už raz do produkcie prešlo —
 * štrnásť dní `partial` sa počítalo ako pokryté a každé číslo o predajnosti
 * bolo osemkrát nižšie.
 *
 * A druhá vec rovnakého druhu: **neobohatený produkt NIE JE mŕtvy produkt.**
 * Značka „bez predaja" smie vzniknúť len s dôkazom (`KpiNoSale.proof`), inak by
 * appka o produkte, na ktorý sa nikdy nepozrela, tvrdila, že sa nepredáva.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Zapojenie dotazu (jeden na stránku, žiadne N+1) dokazuje samostatný
 * súbor `produkty-kpi-zapojenie.spec.ts` v prostredí jsdom.
 *
 * Vlastník: vlna V4-PRODUKTY.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CatalogTable from '@/components/products/CatalogTable';
import type {
  KpiWindowUnitsView,
  ProductKpiPageView,
  ProductKpiRowView,
} from '@/components/products/catalog-api';
import {
  KPI_IDS_PER_REQUEST,
  fetchProductKpis,
  parseProductKpiPage,
} from '@/components/products/catalog-api';
import {
  DEFAULT_CATALOG_FILTER,
  PER_PAGE_CHOICES,
  catalogFilterKey,
  catalogSearchQuery,
} from '@/components/products/catalog-filter';
import { restoreSelection } from '@/components/products/catalog-selection';
import type { SoldCoverageState } from '@/components/products/sold-coverage';
import {
  KPI_DASH,
  kpiCell,
  kpiDiscountCell,
  kpiLastSaleCell,
  kpiNoSaleMark,
  kpiReference,
  kpiSoldPerStockCell,
  kpiUnitsCell,
  soldUnitsViaCoverage,
} from '@/components/products/sold-coverage';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const ROW = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok' as const,
  unitsSold: 0,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror' as const,
};

const TABLE = {
  rows: [ROW],
  soldWindowDays: 30,
  total: 1,
  page: 1,
  perPage: 100 as const,
  loading: false,
  selected: new Set<number>(),
  allMatchingSelected: false,
  onToggleRow: () => {},
  onTogglePage: () => {},
  onOpenDetail: () => {},
  onPage: () => {},
  onPerPage: () => {},
};

/** Celé okno je dočítané a v ňom sa nepredalo nič — MERANÁ nula. */
const OKNO_CELE = (units: number, windowDays = 30): KpiWindowUnitsView => ({
  windowDays,
  completeDays: windowDays,
  unknownDays: 0,
  units: { value: units, gap: null },
  lowerBound: false,
});

/** Z okna nie je dočítaný ani jeden deň — „nevieme", nie nula. */
const OKNO_PRAZDNE = (windowDays = 30): KpiWindowUnitsView => ({
  windowDays,
  completeDays: 0,
  unknownDays: windowDays,
  units: { value: null, gap: 'days_missing' },
  lowerBound: false,
});

/**
 * Časť okna chýba — číslo je len DOLNÁ hranica.
 *
 * Tvar je PRESNE ten, aký posiela produkčný `kpiWindowUnits()`
 * (`src/lib/sales/insights.ts`): hodnota A dôvod `days_missing` naraz. Do
 * 31. 8. 2026 tu stálo `gap: null`, teda kombinácia, akú server nikdy
 * nevyrobí — a zelené `≥ 3` nižšie tak dokazovalo fikciu, kým v appke bola
 * bunka pomlčka. Ak sa tento tvar zmení, musí sa zmeniť v `insights.ts` a tu
 * naraz; strážcom je test `kusy za okno — tri stavy (D119)`
 * v `test/unit/kpi-produktu.spec.ts`, ktorý meria priamo server.
 */
const OKNO_CIASTOCNE = (units: number, windowDays = 30): KpiWindowUnitsView => ({
  windowDays,
  completeDays: 4,
  unknownDays: windowDays - 4,
  units: { value: units, gap: 'days_missing' },
  lowerBound: true,
});

/** Neobohatený produkt: o ničom z `getFull` nevieme nič. */
function neobohateny(productId = ROW.productId): ProductKpiRowView {
  const gap = { value: null, gap: 'not_enriched' } as const;
  return {
    productId,
    missing: false,
    reference: gap,
    supplier: gap,
    priceWithVat: gap,
    margin: gap,
    marginPercent: gap,
    discount: {
      state: 'unknown',
      activePercent: { value: null, gap: 'not_enriched' },
      from: null,
      to: null,
      measuredAt: null,
    },
    stock: gap,
    soldTotal: gap,
    lastSaleAt: gap,
    daysSinceLastSale: gap,
    soldPerStock: gap,
    units30: OKNO_PRAZDNE(30),
    units90: OKNO_PRAZDNE(90),
    noSale: { mark: false, proof: null },
    enrichedAt: null,
  };
}

/** Obohatený produkt so všetkým, čo `getFull` dáva. */
function obohateny(over: Partial<ProductKpiRowView> = {}): ProductKpiRowView {
  return {
    ...neobohateny(),
    reference: { value: 'NAU-1042', gap: null },
    supplier: { value: 'Aura', gap: null },
    priceWithVat: { value: 41.88, gap: null },
    margin: { value: 12.4, gap: null },
    marginPercent: { value: 38, gap: null },
    discount: {
      state: 'running',
      activePercent: { value: 20, gap: null },
      from: '2026-08-25T00:00:00.000Z',
      to: '2026-09-05T00:00:00.000Z',
      measuredAt: '2026-08-30T02:00:00.000Z',
    },
    stock: { value: 8, gap: null },
    soldTotal: { value: 24, gap: null },
    lastSaleAt: { value: '2026-08-11T00:00:00.000Z', gap: null },
    daysSinceLastSale: { value: 19, gap: null },
    soldPerStock: { value: 3, gap: null },
    units30: OKNO_CELE(2, 30),
    units90: OKNO_CELE(7, 90),
    enrichedAt: '2026-08-30T02:00:00.000Z',
    ...over,
  };
}

const page = (row: ProductKpiRowView): ProductKpiPageView => ({
  today: '2026-08-31',
  shortWindowDays: row.units30.windowDays,
  longWindowDays: row.units90.windowDays,
  byId: new Map([[row.productId, row]]),
});

const render = (kpi: ProductKpiPageView | null): string =>
  renderToStaticMarkup(createElement(CatalogTable, { ...TABLE, kpi }));

/* ════════ 1. Bunka: hodnota, „nevieme", a nikdy nula namiesto medzery ═════ */

describe('V4 — bunka KPI rozlišuje tri stavy (I11)', () => {
  it('nula s prázdnym `gap` je MERANÝ fakt a vypíše sa ako nula', () => {
    const cell = kpiCell({ value: 0, gap: null }, (v) => String(v));
    expect(cell.text).toBe('0');
    expect(cell.unknown).toBe(false);
  });

  it('medzera je pomlčka s dôvodom — NIKDY nula', () => {
    for (const gap of ['not_enriched', 'shop_has_none', 'days_missing', 'not_computable'] as const) {
      const cell = kpiCell({ value: null, gap }, (v: number) => String(v));
      expect(cell.text).toBe(KPI_DASH);
      expect(cell.unknown).toBe(true);
      expect(cell.title).not.toBeNull();
      // Toto je tá chyba, ktorá sa v repe už raz stala: `?? 0` nad medzerou.
      expect(cell.text).not.toBe('0');
    }
  });

  it('nekonzistentná odpoveď (hodnota AJ dôvod) padá na pomlčku, nie na číslo', () => {
    // `gap` sa kontroluje PRED hodnotou. Keby to bolo naopak, `{ value: 0,
    // gap: 'days_missing' }` by sa vykreslilo ako meraná nula.
    const cell = kpiCell({ value: 0, gap: 'days_missing' }, (v) => String(v));
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.unknown).toBe(true);
  });

  it('riadok bez odpovede KPI je TRETÍ stav — „ešte sa nenačítalo"', () => {
    const cell = kpiCell(undefined, (v: number) => String(v));
    expect(cell.unknown).toBe(true);
    expect(cell.title).toContain('nenačítali');
  });
});

/* ═════════════ 2. Okno predajov: nula, dolná hranica a medzera ════════════ */

describe('V4 — predané kusy za okno (D119)', () => {
  it('celé dočítané okno s nulou predaných je nula, a je to fakt', () => {
    const cell = kpiUnitsCell(OKNO_CELE(0));
    expect(cell.text).toBe('0');
    expect(cell.unknown).toBe(false);
    expect(cell.lowerBound).toBe(false);
    expect(cell.title).toContain('Celé okno 30 dní je dočítané');
  });

  it('nedočítané okno je pomlčka, nie nula', () => {
    const cell = kpiUnitsCell(OKNO_PRAZDNE());
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.unknown).toBe(true);
    expect(cell.title).toContain('je dočítaných 0');
  });

  it('okno bez čísla a bez dôvodu je tiež pomlčka, nie nula', () => {
    // Odpoveď, ktorá povie „pokrytie plné" a číslo nepošle. Nula by tu bola
    // tvrdenie o nepredaní vyrobené z nečitateľnej odpovede.
    const cell = kpiUnitsCell({
      windowDays: 30,
      completeDays: 30,
      unknownDays: 0,
      units: { value: null, gap: null },
      lowerBound: false,
    });
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.unknown).toBe(true);
    expect(cell.text).not.toBe('0');
  });

  it('čiastočné okno s NULOU je pomlčka — `≥ 0` je prázdna veta, nie priznanie', () => {
    /*
     * Nález z 31. 8. 2026 (I11 č. 2). Server po D121 posiela pre produkt bez
     * riadku v dočítaných dňoch presne tento tvar (`insights.ts` →
     * `kpiWindowUnits`: `value = units ?? 0`, `gap: 'days_missing'`), a pri
     * dnešnom pokrytí (2 dni zo 180) to je 40 511 zo 41 348 produktov. Bunka
     * z toho robila HODNOTU `≥ 0`, kým bočný panel tej istej obrazovky
     * (`soldUnitsViaCoverage`) dával na to isté číslo pomlčku — dve odpovede
     * na tú istú otázku na jednej obrazovke.
     */
    const cell = kpiUnitsCell(OKNO_CIASTOCNE(0));
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.text).not.toBe('≥ 0');
    expect(cell.unknown).toBe(true);
    expect(cell.lowerBound).toBe(false);
    expect(cell.title).toContain('je dočítaných 4');
  });

  it('čiastočné okno s nulou je pomlčka aj vtedy, keď medzeru ohlási len `lowerBound`', () => {
    // Druhá závora: `gap: null` + `lowerBound: true` je tvar, aký server dnes
    // nevyrobí, ale keby ho vyrobil, `≥ 0` nesmie prejsť ani tak.
    const cell = kpiUnitsCell({
      windowDays: 30,
      completeDays: 4,
      unknownDays: 26,
      units: { value: 0, gap: null },
      lowerBound: true,
    });
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.unknown).toBe(true);
  });

  it('čiastočné okno dá číslo označené ako DOLNÁ hranica', () => {
    const cell = kpiUnitsCell(OKNO_CIASTOCNE(3));
    expect(cell.text).toBe('≥ 3');
    expect(cell.unknown).toBe(false);
    expect(cell.lowerBound).toBe(true);
    expect(cell.title).toContain('Dolná hranica');
  });

  it('tvar zo SERVERA (hodnota + `days_missing`) sa prečíta ako dolná hranica', () => {
    /*
     * Regresia z 31. 8. 2026: server pri čiastočne dočítanom okne posiela
     * hodnotu AJ dôvod (`insights.ts` → `kpiWindowUnits`), a bunka kontrolovala
     * dôvod PRED hodnotou — takže stĺpce „Predané 30 d" a „Predané 90 d" boli
     * pomlčka na každom riadku a vetva s `≥` bola mŕtvy kód. Toto ide celou
     * čítacou cestou (odpoveď → `parseProductKpiPage` → bunka), aby sa to už
     * nedalo pokaziť ani v parseri.
     */
    const kpiPage = parseProductKpiPage({
      today: '2026-08-31',
      window30: { windowDays: 30, completeDays: 4, unknownDays: 26 },
      window90: { windowDays: 90, completeDays: 4, unknownDays: 86 },
      rows: [
        {
          productId: 1,
          units30: {
            windowDays: 30,
            completeDays: 4,
            unknownDays: 26,
            units: { value: 3, gap: 'days_missing' },
            lowerBound: true,
          },
        },
      ],
    });
    const cell = kpiUnitsCell(kpiPage?.byId.get(1)?.units30);
    expect(cell.text).toBe('≥ 3');
    expect(cell.unknown).toBe(false);
    expect(cell.lowerBound).toBe(true);
    expect(cell.title).toContain('je dočítaných 4');
  });

  it('`days_missing` BEZ hodnoty zostáva pomlčkou — dolná hranica z ničoho nie je', () => {
    const cell = kpiUnitsCell({
      windowDays: 30,
      completeDays: 0,
      unknownDays: 30,
      units: { value: null, gap: 'days_missing' },
      lowerBound: true,
    });
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.unknown).toBe(true);
  });

  it('chýbajúci počet nedočítaných dní sa NEČÍTA ako plné pokrytie', () => {
    // `unknownDays` sa nedalo prečítať → okno sa chová ako nepokryté; inak by
    // sa dolná hranica ticho vydávala za celý súčet.
    const kpiPage = parseProductKpiPage({
      today: '2026-08-31',
      window30: { windowDays: 30 },
      window90: { windowDays: 90 },
      rows: [{ productId: 1, units30: { windowDays: 30, units: { value: 5, gap: null } } }],
    });
    expect(kpiPage).not.toBeNull();
    const cell = kpiUnitsCell(kpiPage?.byId.get(1)?.units30);
    expect(cell.lowerBound).toBe(true);
    expect(cell.text).toBe('≥ 5');
  });
});

/* ═════════ 2b. Dominanta bočného panela ide tou istou bránou ══════════════ */

/**
 * Nález I11 č. 2 (31. 8. 2026): tabuľka číslo z `catalog/search` zámerne
 * NEZOBRAZUJE (nemá bránu `status='complete'`), ale bočný panel toho istého
 * `.catalog-split` ho vypisoval v 44 px reze ako meraný fakt s vetou
 * „predaných za posledných 30 dní". Jedna obrazovka, dve odpovede na tú istú
 * otázku a ani jedna označená. Odteraz obe idú cez pokrytie.
 */
describe('V4 — dominanta panela hovorí o pokrytí (I11, D119)', () => {
  const coverage = (daysCovered: number, syncEnabled = true): SoldCoverageState => ({
    asked: true,
    coverage: { syncEnabled, daysCovered, daysPartial: 0, from: '2026-08-01', to: '2026-08-31' },
  });

  it('plné pokrytie okna → číslo je celý počet, bez `≥`', () => {
    const cell = soldUnitsViaCoverage(12, 30, coverage(30));
    expect(cell.text).toBe('12');
    expect(cell.lowerBound).toBe(false);
    expect(cell.unknown).toBe(false);
    expect(cell.title).toContain('celé okno 30 dní');
  });

  it('plné pokrytie a nula predaných → nula ZOSTÁVA faktom', () => {
    const cell = soldUnitsViaCoverage(0, 30, coverage(30));
    expect(cell.text).toBe('0');
    expect(cell.unknown).toBe(false);
  });

  it('čiastočné pokrytie → dolná hranica a veta, koľko dní appka má', () => {
    const cell = soldUnitsViaCoverage(5, 30, coverage(2));
    expect(cell.text).toBe('≥ 5');
    expect(cell.lowerBound).toBe(true);
    expect(cell.title).toContain('stiahnuté za 2 z 30 dní');
  });

  it('čiastočné pokrytie a NULA → pomlčka, nikdy „nepredáva sa"', () => {
    const cell = soldUnitsViaCoverage(0, 30, coverage(2));
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.unknown).toBe(true);
    expect(cell.text).not.toBe('0');
  });

  it('vypnuté sťahovanie objednávok neurobí z nuly fakt', () => {
    expect(soldUnitsViaCoverage(0, 30, coverage(0, false)).unknown).toBe(true);
    const nenula = soldUnitsViaCoverage(4, 30, coverage(0, false));
    expect(nenula.text).toBe('≥ 4');
    expect(nenula.title).toContain('Sťahovanie objednávok je vypnuté');
  });

  it('nezistené pokrytie NIE JE plné pokrytie', () => {
    const cell = soldUnitsViaCoverage(7, 30, { asked: false });
    expect(cell.text).toBe('≥ 7');
    expect(cell.lowerBound).toBe(true);
    expect(cell.title).toContain('sa ešte nezistilo');
  });

  it('nečitateľná odpoveď o pokrytí je priznanie, nie plné pokrytie', () => {
    const cell = soldUnitsViaCoverage(7, 30, { asked: true, coverage: null });
    expect(cell.text).toBe('≥ 7');
    expect(cell.title).toContain('nepodarilo zistiť');
  });

  it('chýbajúce číslo zostáva pomlčkou (prepnuté okno, riadok sa nevrátil)', () => {
    const cell = soldUnitsViaCoverage(null, 90, coverage(90));
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.unknown).toBe(true);
  });
});

/* ═════════════ 3. Značka „bez predaja" vzniká LEN s dôkazom ═══════════════ */

describe('V4 — neobohatený produkt nie je mŕtvy produkt (D119)', () => {
  it('bez dôkazu značka nevzniká, ani keď `mark` je `true`', () => {
    expect(kpiNoSaleMark({ mark: true, proof: null })).toBeNull();
    expect(kpiNoSaleMark({ mark: false, proof: 'shop_never_ordered' })).toBeNull();
    expect(kpiNoSaleMark(undefined)).toBeNull();
  });

  it('s dôkazom značka vznikne a povie, čím je dokázaná', () => {
    const shop = kpiNoSaleMark({ mark: true, proof: 'shop_never_ordered' });
    expect(shop?.text).toBe('bez predaja');
    expect(shop?.title).toContain('ani jednu objednávku');

    const dni = kpiNoSaleMark({ mark: true, proof: 'no_sale_in_covered_days' });
    expect(dni?.title).toContain('Celé dlhé okno');
  });

  it('`mark` bez dôkazu neprejde ani cez čítanie odpovede — zahodí sa tam', () => {
    const kpiPage = parseProductKpiPage({
      rows: [{ productId: 18342, noSale: { mark: true, proof: 'vymyslene' } }],
    });
    expect(kpiPage?.byId.get(18342)?.noSale).toEqual({ mark: false, proof: null });
  });

  it('RIADOK neobohateného produktu značku „bez predaja" NEMÁ', () => {
    const html = render(page(neobohateny()));
    expect(html).not.toContain('bez predaja');
    expect(html).not.toContain(`row-no-sale-${ROW.productId}`);
    // A ani jedna KPI bunka riadku nie je nula.
    expect(html).not.toContain('>0<');
  });

  it('RIADOK s dôkazom značku má', () => {
    const html = render(
      page(obohateny({ noSale: { mark: true, proof: 'shop_never_ordered' } })),
    );
    expect(html).toContain('bez predaja');
    expect(html).toContain(`row-no-sale-${ROW.productId}`);
  });
});

/* ═══════════ 4. Zľava podľa shopu je iná veta než naše zápisy (I11) ═══════ */

describe('V4 — dva stĺpce o zľave sa nesmú zliať', () => {
  it('`none` je meraný fakt („bez zľavy"), `unknown` je pomlčka', () => {
    const none = kpiDiscountCell({
      state: 'none',
      activePercent: { value: null, gap: 'shop_has_none' },
      from: null,
      to: null,
      measuredAt: '2026-08-30T02:00:00.000Z',
    });
    expect(none.text).toBe('bez zľavy');
    expect(none.unknown).toBe(false);
    expect(none.title).toContain('30. 8. 2026');

    const unknown = kpiDiscountCell({
      state: 'unknown',
      activePercent: { value: null, gap: 'not_enriched' },
      from: null,
      to: null,
      measuredAt: null,
    });
    expect(unknown.text).toBe(KPI_DASH);
    expect(unknown.unknown).toBe(true);
    expect(unknown.title).toContain('nie je obohatený');
  });

  it('bežiaca zľava vypíše percento a povie, kedy sa merala', () => {
    const cell = kpiDiscountCell(obohateny().discount);
    expect(cell.text).toBe('−20 %');
    expect(cell.title).toContain('Podľa shopu, zmerané 30. 8. 2026');
  });

  it('naplánované a skončené okno sa NEVYDÁVA za bežiacu zľavu', () => {
    for (const state of ['scheduled', 'ended'] as const) {
      const cell = kpiDiscountCell({
        state,
        activePercent: { value: null, gap: null },
        reportedPercent: undefined,
        from: '2026-09-10T00:00:00.000Z',
        to: '2026-09-20T00:00:00.000Z',
        measuredAt: '2026-08-30T02:00:00.000Z',
      } as never);
      expect(cell.text).not.toContain('%');
    }
  });

  it('tabuľka kreslí OBA stĺpce a pomenúva, čí je ktorá veta', () => {
    const html = render(page(obohateny()));
    expect(html).toContain('Zľava teraz');
    expect(html).toContain('Zľava v shope');
    expect(html).toContain('Podľa vlastných zápisov appky');
    expect(html).toContain(`kpi-shop-discount-${ROW.productId}`);
  });
});

/* ═════════ 5. Pomer predaných k sklade a posledný predaj ══════════════════ */

describe('V4 — obrátkovosť podľa D119 stojí na meraných faktoch', () => {
  it('nulový sklad nie je nula pomeru, ale „nedá sa spočítať"', () => {
    const cell = kpiSoldPerStockCell(
      obohateny({
        stock: { value: 0, gap: null },
        soldPerStock: { value: null, gap: 'not_computable' },
      }),
    );
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.title).toContain('menovateľ je nula');
  });

  it('známy pomer nesie v `title` obe merané čísla', () => {
    const cell = kpiSoldPerStockCell(obohateny());
    expect(cell.text).toBe('3.0×');
    expect(cell.title).toContain('Celkovo predané 24, sklad 8');
  });

  it('posledný predaj je dátum a `title` priznáva, že je to horná hranica veku', () => {
    const cell = kpiLastSaleCell(obohateny());
    expect(cell.text).toBe('11. 8. 2026');
    expect(cell.title).toContain('Pred 19 dňami');
    expect(cell.title).toContain('merané pri obohatení');
  });

  it('prázdne `last_time_in_order` sa NEPREKLÁDA na „nikdy sa nepredalo"', () => {
    // To tvrdenie má vlastnú značku s vlastným dôkazom (bod 3 tohto súboru).
    const cell = kpiLastSaleCell(
      obohateny({ lastSaleAt: { value: null, gap: 'shop_has_none' } }),
    );
    expect(cell.text).toBe(KPI_DASH);
    expect(cell.text).not.toContain('nikdy');
  });
});

/* ═════════════ 6. Pomenovanie produktu na povrchu (D116) ══════════════════ */

describe('V4 — `referencia · názov` a priznaná pomlčka', () => {
  it('referencia z medzery sa NEPOUŽIJE ako hodnota', () => {
    expect(kpiReference(obohateny())).toBe('NAU-1042');
    expect(kpiReference(neobohateny())).toBeNull();
    expect(kpiReference(obohateny({ reference: { value: 'X', gap: 'shop_has_none' } }))).toBeNull();
    expect(kpiReference(undefined)).toBeNull();
  });

  it('obohatený riadok má na povrchu `referencia · názov`', () => {
    const html = render(page(obohateny()));
    expect(html).toContain(`NAU-1042 · ${ROW.name}`);
    // `id` patrí do technického detailu — na povrchu ako stĺpec nie je.
    expect(html).not.toContain('>18342<');
  });

  it('neobohatený riadok prizná pomlčku, ale NETVRDÍ, že referencia neexistuje', () => {
    const html = render(page(neobohateny()));
    expect(html).toContain(`row-reference-unknown-${ROW.productId}`);
    expect(html).toContain('Referenciu appka zatiaľ nemá');
    expect(html).toContain('Neznamená to, že produkt referenciu nemá');
  });

  it('kým odpoveď KPI neprišla, pomlčka pri referencii sa NEKRESLÍ', () => {
    // Tretí stav: appka sa ešte nespýtala, takže nemá čo priznávať.
    const html = render(null);
    expect(html).not.toContain(`row-reference-unknown-${ROW.productId}`);
    expect(html).toContain(ROW.name);
  });
});

/* ═════════════ 7. Jeden dotaz na stránku, žiadne N+1 ═════════════════════ */

describe('V4 — KPI sa načítavajú po stránkach, nie po riadkoch', () => {
  it('sto ID odíde v JEDNOM dotaze', async () => {
    const ids = Array.from({ length: KPI_IDS_PER_REQUEST }, (_, i) => 1000 + i);
    const calls: string[] = [];
    const povodny = globalThis.fetch;
    globalThis.fetch = ((url: string) => {
      calls.push(String(url));
      return Promise.resolve({
        json: () => Promise.resolve({ ok: true, data: { rows: [] } }),
      } as unknown as Response);
    }) as unknown as typeof globalThis.fetch;
    try {
      const res = await fetchProductKpis(ids);
      expect(res.ok).toBe(true);
    } finally {
      globalThis.fetch = povodny;
    }
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/api/insights/product-kpi?ids=');
    expect(calls[0]).toContain('1000%2C1001');
    expect(calls[0]).toContain(String(1000 + KPI_IDS_PER_REQUEST - 1));
  });

  it('dlhšia stránka sa NEODREŽE — odmietne sa, aby medzera nevznikla ticho', async () => {
    const res = await fetchProductKpis(
      Array.from({ length: KPI_IDS_PER_REQUEST + 1 }, (_, i) => i + 1),
    );
    expect(res.ok).toBe(false);
  });

  it('ponúkané dávky riadkov sa do jedného dotazu KPI vždy zmestia', () => {
    // Toto je dôvod, prečo voľba 200 zmizla: `perPage` nemá ako prekročiť
    // strop route, takže stránka s polovicou prázdnych KPI nemôže vzniknúť.
    expect(Math.max(...PER_PAGE_CHOICES)).toBeLessThanOrEqual(KPI_IDS_PER_REQUEST);
    expect(DEFAULT_CATALOG_FILTER.perPage).toBe(100);
  });

  it('nečitateľná odpoveď nie je prázdna stránka', () => {
    expect(parseProductKpiPage({ today: '2026-08-31' })).toBeNull();
    expect(parseProductKpiPage(null)).toBeNull();
  });
});

/* ═════════════ 8. Predvolené poradie: najhoršie ležiaky prvé ══════════════ */

describe('V4 — obrazovka sa otvára na tom, čo sa nepredáva (§5 K4)', () => {
  it('predvolené poradie je najmenej predané prvé a posiela sa výslovne', () => {
    expect(DEFAULT_CATALOG_FILTER.sort).toBe('sold_asc');
    expect(catalogSearchQuery(DEFAULT_CATALOG_FILTER, { sorting: true })).toContain(
      'sort=sold_asc',
    );
  });

  it('poradie ani nová dávka nezmenili kľúč otázky (bod 17)', () => {
    // Kľúč rozhoduje o tom, či naklikaný výber prežije — poradie a stránkovanie
    // doň nepatria ani po zmene predvolených hodnôt.
    const key = catalogFilterKey(DEFAULT_CATALOG_FILTER);
    expect(key).not.toContain('sort=');
    expect(key).not.toContain('perPage=');
    expect(
      catalogFilterKey({ ...DEFAULT_CATALOG_FILTER, sort: 'price_desc', perPage: 50 }),
    ).toBe(key);
  });

  it('uložený výber sa k novej predvolenej otázke vráti celý', () => {
    const out = restoreSelection(DEFAULT_CATALOG_FILTER, {
      filter: catalogFilterKey(DEFAULT_CATALOG_FILTER),
      productIds: [18342, 21170],
      allMatching: false,
    });
    expect(out.productIds).toEqual([18342, 21170]);
    expect(out.filter.sort).toBe('sold_asc');
    expect(out.filter.perPage).toBe(100);
  });

  it('výber naklikaný na INEJ otázke sa nevracia', () => {
    const out = restoreSelection(
      { ...DEFAULT_CATALOG_FILTER, query: 'lumen' },
      { filter: 'soldWindowDays=30&q=prsten', productIds: [1], allMatching: false },
    );
    expect(out.productIds).toEqual([]);
  });
});

/* ═════════════ 9. Stĺpce, ktoré D114 menuje, na obrazovke sú ══════════════ */

describe('V4 — KPI stĺpce (D114) sú v tabuľke', () => {
  const html = render(page(obohateny()));

  it('hlavička nesie všetky stĺpce D114', () => {
    for (const label of [
      'Predané 30 d',
      'Predané 90 d',
      'Predané / sklad',
      'Posledný predaj',
      'Cena',
      'Zľava v shope',
      'Marža',
    ]) {
      expect(html).toContain(label);
    }
  });

  it('marža príde zo shopu v EUR aj v % a appka ju NEPOČÍTA', () => {
    expect(html).toContain('12,40 €');
    expect(html).toContain('38 %');
    expect(html).toContain('Marža tak, ako ju poslal shop. Appka ju nepočíta.');
  });

  it('polovica marže môže chýbať a druhá zostane — každá má vlastnú medzeru', () => {
    const jedna = render(page(obohateny({ marginPercent: { value: null, gap: 'shop_has_none' } })));
    expect(jedna).toContain('12,40 €');
    expect(jedna).toContain(`kpi-margin-percent-${ROW.productId}`);
    expect(jedna).not.toContain('38 %');
  });

  it('nadpis okna hovorí to, čo POVEDALA odpoveď, nie to, čo je vo filtri', () => {
    const sedem = render({
      ...page(obohateny({ units30: OKNO_CELE(1, 7) })),
      shortWindowDays: 7,
    });
    expect(sedem).toContain('Predané 7 d');
    expect(sedem).not.toContain('Predané 30 d');
  });

  it('nedočítaný súčet z `catalog/search` sa už NEZOBRAZUJE', () => {
    // `unitsSold` (bez brány `status=complete`) a KPI kusy sú dve rôzne čísla
    // o tom istom produkte; na obrazovke smie byť len to s bránou.
    const html30 = render(page(obohateny({ units30: OKNO_CELE(2, 30) })));
    const riadok = html30.slice(html30.indexOf('<tbody>'));
    expect(riadok).toContain(`kpi-units30-${ROW.productId}`);
    expect(riadok).toContain('>2<');
  });
});
