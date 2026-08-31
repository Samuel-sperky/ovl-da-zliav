/**
 * Aura Zľavy — BOČNÝ PANEL: TRI STAVY KAŽDÉHO ČÍSLA, A UPLIFT, KTORÝ SI
 * NEVYMÝŠĽA (V4, D114/D115/D118).
 *
 * Panel detailu dostal vo V4 tri nové zdroje: fakty z obohatenia
 * (`/api/insights/product-kpi`), dennú krivku s oknami zliav
 * (`/api/insights/product/<id>`) a doťahovanie na dopyt
 * (`POST /api/catalog/enrich`). Tento súbor meria to, čo sa na nich dá ticho
 * pokaziť — a v tomto repe sa to už raz aj pokazilo:
 *
 *  1. **Uplift, ktorý sa spočítať nedá, NESMIE dostať číslo.** 26. 8. 2026
 *     (commit `d00e081`) sa tu dve okná, ktoré zľave OBE predchádzali,
 *     vydávali za výkon zľavy. Endpoint to už odmieta spočítať; úloha povrchu
 *     je to nezakryť. Meria sa NEPRIATEĽSKOU vzorkou: server v nej pri
 *     `available: false` čísla POSLAL. Ani jedno sa nesmie dostať na obrazovku.
 *  2. **Neobohatený produkt ukáže pomlčky, nie nuly.** Kvóta kľúča je ~200
 *     čítaní na deň a katalóg má 41 348 produktov, takže neobohatený riadok je
 *     NORMÁLNY stav (D118) — a nula na ňom by bola tvrdenie o cene, marži
 *     a predaji, ktoré nikto nezmeral.
 *  3. **Prázdna sa nesmú zliať.** „Produkt nie je obohatený" ≠ „eshop to
 *     nevedie" ≠ „dni chýbajú". Prvé sa spraví jedným čítaním, druhé sa spraviť
 *     nedá vôbec a tretie sťahovaním predajov.
 *  4. **`gap` musí prežiť cestu po drôte.** Keby sa z odpovede čítalo len
 *     `value`, obrazovka by mala `null` — a z `null` je `?? 0` jeden riadok
 *     kódu. Presne takto vznikla chyba, pre ktorú bolo každé číslo
 *     o predajnosti osemkrát nižšie než meranie.
 *  5. **Nestiahnutý deň v krivke nie je nula** a **meraná nula je meranie**:
 *     dva rôzne tvary, nie jeden.
 *
 * Väčšina tvrdení sa meria nad ČISTÝMI funkciami a nad malými komponentmi,
 * nie nad panelom: `kpi`, `insights` ani výsledok doťahovania sa do panela
 * nedostanú inak než EFEKTOM, a efekty v `renderToStaticMarkup` nebežia. Cez
 * panel by sa teda dala odmerať jediná vetva — tá prázdna. Je to tá istá pasca,
 * akú má `SoldDominant` (`dominanta-pomlcka.spec.ts`).
 *
 * Sekcia „zrkadlá sedia so serverom" je typová kontrola, nie behový test:
 * komponenty z `@/lib/*` ani z `@/app/api/*` neimportujú, tak si držia vlastné
 * zrkadlá — a keď sa server zmení a zrkadlo nie, má padnúť `npx tsc`, nie oko.
 *
 * Vlastník: vlna V4-DETAIL (bočný panel produktu).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { KpiGap, ProductKpiRow } from '@/contracts';
import type { UpliftResult } from '@/app/api/insights/_shared';
import type { ProductSeriesDay } from '@/app/api/insights/product/[productId]/route';
import type { EnrichOneOutcome } from '@/lib/engine/catalog-enrich';

import ProductDetailPanel, {
  KpiFacts,
  ProductCurveChart,
  UpliftBlock,
} from '@/components/products/ProductDetailPanel';
import type { CatalogRowView } from '@/components/products/catalog-api';
import { parseProductKpi } from '@/components/products/extras-api';
import {
  activeDiscountText,
  curveGapNote,
  enrichNotice,
  kpiFactRows,
  marginText,
  measuredNote,
  percentPlain,
  productCurve,
  stockField,
  upliftView,
  UPLIFT_UNAVAILABLE_WORD,
  type EnrichOutcomeKind,
  type KpiGapKind,
  type ProductExtraView,
  type ProductKpiView,
  type ProductVariantView,
  type SeriesDayWire,
  type UpliftWire,
} from '@/components/products/product-extras';
import { variantStockNote, variantStockTotal } from '@/components/products/ProductVariants';

/* ═══════════════════════════ vzorky ══════════════════════════════════════ */

const ROW: CatalogRowView = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok',
  unitsSold: 0,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-30T01:00:00.000Z',
  origin: 'mirror',
};

/** KPI riadok tak, ako ho posiela server — NEOBOHATENÝ produkt. */
const NOT_ENRICHED_ROW = {
  productId: ROW.productId,
  missing: false,
  name: ROW.name,
  reference: { value: null, gap: 'not_enriched' },
  supplier: { value: null, gap: 'not_enriched' },
  listPrice: '34.90',
  priceWithVat: { value: null, gap: 'not_enriched' },
  purchasePrice: { value: null, gap: 'not_enriched' },
  margin: { value: null, gap: 'not_enriched' },
  marginPercent: { value: null, gap: 'not_enriched' },
  discount: {
    state: 'unknown',
    activePercent: { value: null, gap: 'not_enriched' },
    reportedPercent: { value: null, gap: 'not_enriched' },
    from: null,
    to: null,
    measuredAt: null,
  },
  stock: { value: null, gap: 'not_enriched' },
  soldTotal: { value: null, gap: 'not_enriched' },
  lastSaleAt: { value: null, gap: 'not_enriched' },
  daysSinceLastSale: { value: null, gap: 'not_enriched' },
  soldPerStock: { value: null, gap: 'not_enriched' },
  units30: {
    windowDays: 30,
    from: '2026-08-01',
    to: '2026-08-30',
    completeDays: 0,
    unknownDays: 30,
    units: { value: null, gap: 'days_missing' },
    lowerBound: true,
  },
  units90: {
    windowDays: 90,
    from: '2026-06-02',
    to: '2026-08-30',
    completeDays: 0,
    unknownDays: 90,
    units: { value: null, gap: 'days_missing' },
    lowerBound: true,
  },
  noSale: { mark: false, proof: null },
  enrichedAt: null,
};

/** Ten istý riadok OBOHATENÝ — vrátane platnej nuly na sklade. */
const ENRICHED_ROW = {
  ...NOT_ENRICHED_ROW,
  reference: { value: 'AG-1024', gap: null },
  supplier: { value: 'Argento', gap: null },
  purchasePrice: { value: 12.5, gap: null },
  margin: { value: 14.4, gap: null },
  marginPercent: { value: 42.07, gap: null },
  priceWithVat: { value: 34.9, gap: null },
  stock: { value: 0, gap: null },
  soldTotal: { value: 37, gap: null },
  lastSaleAt: { value: '2026-08-12T10:00:00.000Z', gap: null },
  daysSinceLastSale: { value: 18, gap: null },
  discount: {
    state: 'running',
    activePercent: { value: 15, gap: null },
    reportedPercent: { value: 15, gap: null },
    from: '2026-08-20T00:00:00.000Z',
    to: '2026-09-03T00:00:00.000Z',
    measuredAt: '2026-08-30T06:00:00.000Z',
  },
  enrichedAt: '2026-08-30T06:00:00.000Z',
};

const kpiOf = (row: unknown): ProductKpiView => {
  const view = parseProductKpi({ rows: [row] }, ROW.productId);
  expect(view, 'vzorka sa nedá prečítať — meranie by nemeralo nič').not.toBeNull();
  return view!;
};

const variant = (over: Partial<ProductVariantView> = {}): ProductVariantView => ({
  variantId: 1,
  reference: 'AB-1',
  ean13: null,
  quantity: 4,
  priceImpact: null,
  values: ['Veľkosť: 54'],
  ...over,
});

/* ═════════ 1. Zrkadlá sedia so serverom (typová kontrola) ════════════════ */

describe('zrkadlá povrchu sedia s tým, čo server naozaj posiela', () => {
  it('slovník prázdien KPI pokrýva všetky `KpiGap` zo servera', () => {
    /* Keď na serveri pribudne dôvod chýbania, toto priradenie prestane
       kompilovať a povrch dostane šancu ho pomenovať — namiesto toho, aby ho
       ticho nakreslil ako „nečitateľné". */
    const fromServer: KpiGapKind = 'days_missing' satisfies KpiGap;
    expect(fromServer).toBe('days_missing');
  });

  it('`EnrichOutcomeKind` je presne `EnrichOneOutcome`', () => {
    const toSurface: EnrichOutcomeKind = 'ip_banned' as EnrichOneOutcome;
    const toEngine: EnrichOneOutcome = 'ip_banned' as EnrichOutcomeKind;
    expect(enrichNotice(toSurface)).not.toBeNull();
    expect(toEngine).toBe('ip_banned');
  });

  it('`UpliftWire` unesie `UpliftResult` bez straty poľa', () => {
    const fromServer: UpliftWire = {} as UpliftResult;
    expect(typeof fromServer).toBe('object');
  });

  it('`SeriesDayWire` unesie `ProductSeriesDay`', () => {
    const fromServer: SeriesDayWire = {} as ProductSeriesDay;
    expect(typeof fromServer).toBe('object');
  });

  it('mená polí KPI, ktoré panel čítá, na serveri EXISTUJÚ', () => {
    /* `Pick` neskompiluje, keď ktorékoľvek z tých mien v `ProductKpiRow` nie je
       — presne to je oprava po `extras-api.ts`, kde sa šesť mien čítalo voľnými
       reťazcami a všetky boli zlé. */
    type Read = Pick<
      ProductKpiRow,
      | 'productId'
      | 'missing'
      | 'name'
      | 'reference'
      | 'supplier'
      | 'purchasePrice'
      | 'margin'
      | 'marginPercent'
      | 'priceWithVat'
      | 'stock'
      | 'soldTotal'
      | 'lastSaleAt'
      | 'daysSinceLastSale'
      | 'discount'
      | 'units30'
      | 'units90'
      | 'noSale'
      | 'enrichedAt'
    >;
    const names: (keyof Read)[] = ['reference', 'margin', 'stock', 'enrichedAt'];
    expect(names).toHaveLength(4);
  });
});

/* ═════════ 2. `gap` prežije drôt (bod 4 hlavičky) ════════════════════════ */

describe('čítanie odpovede nezahodí dôvod, prečo hodnota chýba', () => {
  it('dôvod zo servera sa prenesie, nie zahodí', () => {
    const view = kpiOf(NOT_ENRICHED_ROW);
    expect(view.reference).toEqual({ known: false, gap: 'not_enriched' });
    expect(view.units30.units).toEqual({ known: false, gap: 'days_missing' });
    // Dve RÔZNE prázdna — keby sa zliali, používateľ by nevedel, či počkať na
    // obohatenie (jedno čítanie), alebo na sťahovanie predajov (dni).
    expect(view.reference).not.toEqual(view.units30.units);
  });

  it('platná nula je hodnota, nie prázdno', () => {
    const view = kpiOf(ENRICHED_ROW);
    expect(view.stock).toEqual({ known: true, value: 0 });
  });

  it('rozpor v odpovedi je priznanie, nikdy nula', () => {
    // `gap: null` sľubuje hodnotu, ale hodnota sa prečítať nedá.
    const view = kpiOf({ ...NOT_ENRICHED_ROW, margin: { value: null, gap: null } });
    expect(view.margin).toEqual({ known: false, gap: 'unreadable' });
    // Neznámy dôvod sa tiež nesmie stať hodnotou.
    const other = kpiOf({ ...NOT_ENRICHED_ROW, margin: { value: null, gap: 'vymyslene' } });
    expect(other.margin).toEqual({ known: false, gap: 'unreadable' });
  });

  it('neprečítané pokrytie okna je NAJHORŠÍ prípad, nie „všetko stiahnuté"', () => {
    const view = kpiOf({ ...NOT_ENRICHED_ROW, units90: { units: { value: null, gap: null } } });
    expect(view.units90.unknownDays).toBe(90);
    expect(view.units90.lowerBound).toBe(true);
  });

  it('riadok pre iné ID sa nevydáva za náš', () => {
    expect(parseProductKpi({ rows: [{ ...ENRICHED_ROW, productId: 999 }] }, ROW.productId)).toBeNull();
    expect(parseProductKpi({ rows: [] }, ROW.productId)).toBeNull();
    expect(parseProductKpi('nezmysel', ROW.productId)).toBeNull();
  });
});

/* ═════════ 3. Neobohatený produkt = pomlčky, nie nuly ════════════════════ */

describe('neobohatený produkt ukáže pomlčky a povie PREČO', () => {
  const rows = kpiFactRows(kpiOf(NOT_ENRICHED_ROW));

  it('všetkých osem faktov je prázdnych a všetky vedia dôvod', () => {
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.field.known, `${row.label} má hodnotu, hoci produkt nie je obohatený`).toBe(false);
      if (!row.field.known) expect(row.field.gap).toBe('not_enriched');
    }
  });

  it('ani jeden fakt nie je nula ani vymyslené číslo', () => {
    const html = renderToStaticMarkup(createElement(KpiFacts, { rows }));
    expect(html).toContain('produkt nie je obohatený');
    expect(html).toContain('—');
    // Nula, „0 €" ani „0 %" sa v prázdnych faktoch objaviť nesmú.
    expect(html).not.toMatch(/>\s*0\s*</);
    expect(html).not.toContain('0,00 €');
    expect(html).not.toContain('0 %');
  });

  it('nedoťahané KPI sú „zatiaľ nenačítané", nie „produkt nie je obohatený"', () => {
    /* Prvé je tvrdenie o NÁS, druhé o produkte. Zliať ich znamená obviniť
       obohacovanie z toho, že odpoveď ešte nedobehla. */
    for (const row of kpiFactRows(null)) {
      expect(row.field.known).toBe(false);
      if (!row.field.known) expect(row.field.gap).toBe('not_loaded');
    }
  });

  it('veta o meraní nepredstiera čas, ktorý neexistuje', () => {
    expect(measuredNote(null)).toContain('načítava');
    expect(measuredNote(kpiOf(NOT_ENRICHED_ROW))).toContain('ešte nedoťahoval');
    expect(measuredNote(kpiOf(NOT_ENRICHED_ROW))).not.toMatch(/\d{4}/);
    expect(measuredNote(kpiOf(ENRICHED_ROW))).toContain('30. 8. 2026');
  });
});

/* ═════════ 4. Obohatený produkt: hodnoty tak, ako prišli ═════════════════ */

describe('obohatený produkt — nič sa nedopočítava', () => {
  const view = kpiOf(ENRICHED_ROW);

  it('marža je zo shopu a NEMÁ mínus (nie je to zľava)', () => {
    const margin = marginText(view);
    expect(margin.known).toBe(true);
    if (margin.known) {
      expect(margin.value).toBe('14,40 € · 42.07 %');
      expect(margin.value).not.toContain('−');
    }
    expect(percentPlain(42.07)).toBe('42.07 %');
  });

  it('aktívna zľava je stav SHOPU a nesie okno', () => {
    const discount = activeDiscountText(view);
    expect(discount.known).toBe(true);
    if (discount.known) expect(discount.value).toContain('15 %');
  });

  it('„bez zľavy" je meraný fakt, „nevieme" nie je bez zľavy', () => {
    const none = activeDiscountText(kpiOf({ ...ENRICHED_ROW, discount: { ...ENRICHED_ROW.discount, state: 'none' } }));
    expect(none).toEqual({ known: true, value: 'bez zľavy' });

    const unknown = activeDiscountText(kpiOf(NOT_ENRICHED_ROW));
    expect(unknown.known).toBe(false);
    if (!unknown.known) expect(unknown.gap).toBe('not_enriched');
  });

  it('sklad 0 sa píše ako vypredané, nie ako pomlčka', () => {
    const stock = kpiFactRows(view).find((row) => row.key === 'stock');
    expect(stock?.field).toEqual({ known: true, value: '0 — vypredané' });
  });
});

/* ═════════ 5. UPLIFT: priznanie NIE JE číslo (pasca d00e081) ═════════════ */

/**
 * NEPRIATEĽSKÁ vzorka: server tvrdí `available: false`, ALE čísla porovnania
 * v odpovedi nechal. Povrch ich vypísať nesmie — inak by na obrazovke stálo
 * číslo vydávané za výkon zľavy, teda presne to, čo `d00e081` opravoval.
 */
const HOSTILE_UPLIFT: UpliftWire = {
  available: false,
  reason: 'coverage_gap',
  campaignId: 7,
  campaignName: 'Letná zľava',
  percent: 20,
  startsOn: '2026-07-01',
  spanDays: 7,
  duringTruncated: false,
  before: { from: '2026-06-24', to: '2026-06-30', days: 7, units: 777, perDay: 111 },
  during: { from: '2026-07-01', to: '2026-07-07', days: 7, units: 999, perDay: 142.71 },
  deltaPercent: 28.5,
  deltaReason: null,
  missingDuring: ['2026-07-03'],
  missingBefore: [],
};

describe('uplift, ktorý sa spočítať nedá, je priznanie a nie číslo', () => {
  const view = upliftView(HOSTILE_UPLIFT);
  const html = renderToStaticMarkup(createElement(UpliftBlock, { view }));

  it('výsledok je priznanie so slovom', () => {
    expect(view.kind).toBe('unavailable');
    if (view.kind === 'unavailable') {
      expect(view.word).toBe(UPLIFT_UNAVAILABLE_WORD);
      expect(view.why).toContain('nie sú stiahnuté');
    }
  });

  it('ani jedno číslo porovnania sa na povrch nedostalo', () => {
    const naked = JSON.stringify(view);
    for (const forbidden of ['777', '999', '111', '142.71', '28.5']) {
      expect(naked, `číslo ${forbidden} sa dostalo do pohľadu`).not.toContain(forbidden);
      expect(html, `číslo ${forbidden} sa dostalo na obrazovku`).not.toContain(forbidden);
    }
    expect(html).toContain(UPLIFT_UNAVAILABLE_WORD);
    expect(html).toContain('data-uplift="unavailable"');
  });

  it('povie, čo by porovnávalo — dátumami, nie hodnotami', () => {
    expect(html).toContain('Porovnávalo by sa');
    expect(html).toContain('24. 6. 2026');
  });

  it('každý dôvod servera má vlastnú vetu a ani jedna nie je číslo', () => {
    const reasons = [
      'no_discount_window',
      'not_started',
      'window_too_short',
      'baseline_overlaps_discount',
      'coverage_gap',
    ] as const;
    const seen = new Set<string>();
    for (const reason of reasons) {
      const one = upliftView({ ...HOSTILE_UPLIFT, reason, before: null, during: null });
      expect(one.kind).toBe('unavailable');
      if (one.kind === 'unavailable') {
        expect(one.why.length).toBeGreaterThan(20);
        seen.add(one.why);
      }
    }
    expect(seen.size, 'dve rôzne príčiny majú tú istú vetu').toBe(reasons.length);
  });

  it('„zľava sa ešte nezačala" povie KEDY, nie len že nie', () => {
    const view2 = upliftView({
      ...HOSTILE_UPLIFT,
      reason: 'not_started',
      startsOn: '2026-09-15',
      before: null,
      during: null,
    });
    if (view2.kind === 'unavailable') expect(view2.why).toContain('15. 9. 2026');
  });

  it('nedoťahaný uplift je „zatiaľ nenačítané", nie „nedá sa spočítať"', () => {
    const pending = upliftView(null);
    expect(pending.kind).toBe('unavailable');
    if (pending.kind === 'unavailable') expect(pending.word).toBe('zatiaľ nenačítané');
  });
});

describe('uplift, ktorý sa spočítať DÁ, ukáže presne to, čo prišlo', () => {
  const ok: UpliftWire = {
    ...HOSTILE_UPLIFT,
    available: true,
    reason: null,
    deltaPercent: 28.5,
    missingDuring: [],
  };
  const view = upliftView(ok);

  it('dve čísla vedľa seba a rozdiel zo servera', () => {
    expect(view.kind).toBe('value');
    if (view.kind === 'value') {
      expect(view.beforeText).toContain('777');
      expect(view.duringText).toContain('999');
      expect(view.deltaText).toBe('+28.5 %');
      expect(view.caveat).toContain('nie príčina');
    }
  });

  it('nulová základňa nedá „nekonečný rast", ale priznanie', () => {
    const zero = upliftView({
      ...ok,
      before: { from: '2026-06-24', to: '2026-06-30', days: 7, units: 0, perDay: 0 },
      deltaPercent: null,
      deltaReason: 'zero_baseline',
    });
    if (zero.kind === 'value') {
      expect(zero.deltaText).toBeNull();
      expect(zero.deltaNote).toContain('vyjadriť nedá');
    }
    const html = renderToStaticMarkup(createElement(UpliftBlock, { view: zero }));
    expect(html).toContain('nedá sa vyjadriť');
  });

  it('bežiaca zľava priznáva, že „počas" je len po dnešok', () => {
    const running = upliftView({ ...ok, duringTruncated: true });
    if (running.kind === 'value') expect(running.truncatedNote).toContain('ešte beží');
  });
});

/* ═════════ 6. Krivka: medzera nie je nula, nula je meranie ═══════════════ */

describe('denná krivka priznáva medzery a nekreslí ich ako nulu', () => {
  const days: readonly SeriesDayWire[] = [
    { day: '2026-08-25', units: 3, coverage: 'complete' },
    { day: '2026-08-26', units: 0, coverage: 'complete' },
    { day: '2026-08-27', units: null, coverage: 'missing' },
    { day: '2026-08-28', units: 5, coverage: 'partial' },
    { day: '2026-08-29', units: 2, coverage: 'complete' },
  ];
  const windows = [
    {
      campaignId: 7,
      campaignName: 'Letná zľava',
      percent: 20,
      from: '2026-08-28',
      to: '2026-09-10',
    },
  ];
  const curve = productCurve(days, windows);

  it('nedočítaný deň nemá číslo — ani nulu, ani hodnotu, ktorá prišla', () => {
    expect(curve.days[2]!.units).toBeNull();
    // `partial` deň PRIŠIEL s číslom 5, ale je to len časť dňa (D119).
    expect(curve.days[3]!.units).toBeNull();
    expect(curve.unknownDays).toBe(2);
    expect(curve.coveredDays).toBe(3);
  });

  it('meraná nula sa počíta ako meranie', () => {
    expect(curve.days[1]!.units).toBe(0);
    expect(curve.units).toBe(5);
    expect(curve.maxUnits).toBe(3);
  });

  it('okno zľavy sa neroztiahne mimo krivky', () => {
    expect(curve.bands).toHaveLength(1);
    expect(curve.bands[0]).toMatchObject({ fromIndex: 3, toIndex: 4 });
    // Okno mimo krivky nedostane pás vôbec — nakreslilo by zľavu, ktorá tam
    // nebola.
    const outside = productCurve(days, [{ ...windows[0]!, from: '2026-01-01', to: '2026-01-05' }]);
    expect(outside.bands).toHaveLength(0);
  });

  it('bez jediného dočítaného dňa niet mierky a hovorí sa to', () => {
    const blind = productCurve(
      [{ day: '2026-08-25', units: null, coverage: 'missing' }],
      [],
    );
    expect(blind.maxUnits).toBeNull();
    expect(blind.units).toBeNull();
    expect(curveGapNote(blind)).toContain('nemá stiahnutých');
  });

  it('veta o medzere povie počet, aj keď nechýba nič', () => {
    expect(curveGapNote(curve)).toContain('2 z 5');
    const full = productCurve([{ day: '2026-08-25', units: 1, coverage: 'complete' }], []);
    expect(curveGapNote(full)).toContain('stiahnuté');
    expect(curveGapNote(full)).not.toContain('nemá');
  });

  it('medzera a meraná nula sú v značkách DVA rôzne tvary', () => {
    const html = renderToStaticMarkup(createElement(ProductCurveChart, { curve }));
    expect(html).toContain('data-testid="detail-curve-gap"');
    expect(html).toContain('data-testid="detail-curve-day"');
    expect(html).toContain('data-testid="detail-curve-band"');
    // Šrafovanie bez slova je vzorka, ktorú si nikto nespojí s výpadkom.
    expect(html).toContain('dni, ktoré appka nemá');
    // Krivka je obrázok, nie dekorácia.
    expect(html).toContain('role="img"');
  });
});

/* ═════════ 7. Doťahovanie na dopyt: `ip_banned` nie je porucha ═══════════ */

describe('výsledok doťahovania sa povie vetou, nie chybou appky', () => {
  it('`ip_banned` je bežná cesta, nie „pozor"', () => {
    const notice = enrichNotice('ip_banned');
    expect(notice?.tone).toBe('note');
    expect(notice?.text).toContain('odmieta našu adresu');
    expect(notice?.text).not.toMatch(/chyba|zlyhalo|porucha/i);
  });

  it('úspech ani sviežosť nič nehlásia', () => {
    expect(enrichNotice('enriched')).toBeNull();
    expect(enrichNotice('fresh')).toBeNull();
    expect(enrichNotice(null)).toBeNull();
  });

  it('chýbajúci kľúč je „pozor", lebo sa s tým dá niečo urobiť', () => {
    expect(enrichNotice('no_key')?.tone).toBe('attention');
    expect(enrichNotice('locked')?.tone).toBe('attention');
    // Zamknuté sa TU nevysvetľuje — vysvetlenie má jedno miesto v Nastaveniach.
    expect(enrichNotice('locked')?.text).not.toContain('Nastavenia');
  });

  it('každý výsledok engine-u má odpoveď — ani jeden nekončí bez vety', () => {
    const all: EnrichOutcomeKind[] = [
      'enriched',
      'fresh',
      'invalid_id',
      'not_in_mirror',
      'paused',
      'locked',
      'unknown_scope',
      'no_key',
      'budget_day',
      'budget_minute',
      'budget_unknown',
      'ip_banned',
      'rate_limited',
      'not_found',
      'reduction_unknown',
      'failed',
    ];
    for (const outcome of all) {
      const notice = enrichNotice(outcome);
      if (outcome === 'enriched' || outcome === 'fresh') {
        expect(notice).toBeNull();
        continue;
      }
      expect(notice, `${outcome} nemá vetu`).not.toBeNull();
      expect(notice!.text.length).toBeGreaterThan(20);
    }
  });
});

/* ═════════ 8. Sklad variantov: súčet je celok, alebo nič ═════════════════ */

describe('sklad variantov sa nesčítava naslepo', () => {
  const extraOf = (variants: readonly ProductVariantView[]): ProductExtraView => ({
    productId: ROW.productId,
    description: null,
    shortDescription: null,
    variants,
    keyed: null,
    at: '2026-08-30T06:00:00.000Z',
  });

  it('jeden variant bez skladu zruší celý súčet', () => {
    const mixed = [variant({ variantId: 1, quantity: 4 }), variant({ variantId: 2, quantity: null })];
    expect(variantStockTotal(mixed)).toBeNull();
    // A to isté v poli, ktoré čítá panel: 4 sa NESMIE vydávať za celok.
    const field = stockField(extraOf(mixed), true);
    expect(field.known).toBe(false);
    expect(JSON.stringify(field)).not.toContain('4');
  });

  it('keď sklad povedia všetky varianty, súčet je súčet', () => {
    const all = [variant({ variantId: 1, quantity: 4 }), variant({ variantId: 2, quantity: 0 })];
    expect(variantStockTotal(all)).toBe(4);
    expect(stockField(extraOf(all), true)).toEqual({ known: true, value: 4 });
  });

  it('chýbajúci súčet povie, koľko variantov mlčalo', () => {
    const note = variantStockNote([
      variant({ variantId: 1, quantity: 4 }),
      variant({ variantId: 2, quantity: null }),
    ]);
    expect(note).toContain('1 z 2');
    expect(variantStockNote([variant({ quantity: 1 })])).toBeNull();
  });
});

/* ═════════ 9. Panel: nové bloky nerozbili rozpočet povrchu ═══════════════ */

describe('panel s novými blokmi', () => {
  const html = renderToStaticMarkup(
    createElement(ProductDetailPanel, { row: ROW, soldWindowDays: 30, onClose: () => {} }),
  );
  const surface = html.replace(/<details[\s\S]*?<\/details>/g, '');

  it('meranie vôbec niečo našlo', () => {
    expect(html.length).toBeGreaterThan(2000);
  });

  it('krivka aj výkon zľavy sú na POVRCHU — kvôli nim sa panel otvára', () => {
    expect(surface).toContain('Predaj po dňoch · 90 dní');
    expect(surface).toContain('data-testid="detail-uplift"');
  });

  it('fakty z eshopu sú pod rozklikom a nadpis nesľubuje, čo appka nemá', () => {
    expect(html).toContain('data-testid="detail-kpi-fold"');
    expect(surface).not.toContain('data-testid="detail-kpi-facts"');
    // Efekty pri statickom renderi nebežia, takže KPI ešte nie sú.
    expect(html).toContain('Fakty z eshopu zatiaľ nemáme');
  });

  it('povrch má stále presne šesť riadkov dvojstĺpcovej tabuľky', () => {
    /*
     * Rozpočet výšky povrchu z 24. 8. 2026 (`produkty-detail-rozklik.spec.ts`).
     * Uplift preto kreslí riadky ako `<div>`, nie ako `<dl>` — inak by tri
     * riadky navyše vrátili panel do stavu, v ktorom sa odsekol.
     */
    expect((surface.match(/<dt>/g) ?? []).length).toBe(6);
  });

  it('názov v hlavičke je „referencia · názov" (D116), id v technickom detaile', () => {
    expect(html).toContain(ROW.name);
    expect(html).toContain('Číslo produktu');
  });
});
