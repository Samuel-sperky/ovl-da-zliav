/**
 * Aura Zľavy — JEDNOTNÁ SADA STĹPCOV (D124, kontrakt V5, K3; I11).
 *
 * Tabuľky produktov si do V5 písali hlavičky aj bunky samy a rozišli sa v tom
 * najhoršom mieste: tá istá vec sa volala inak („Cena" vs „Cena pri príprave")
 * a prázdna bunka znamenala v každej tabuľke niečo iné. Nula pri výbere do
 * zľavy pritom rozhoduje o pásme — z „nevieme" vydaného za nulu je −30 % na
 * tisícoch kusov (D121, pasca zapísaná v `CLAUDE.md`).
 *
 * ČO SA TU MERIA A PREČO PRÁVE TO
 * -------------------------------
 *  A. **Trojstavovosť je v DEFINÍCII, nie v tabuľke.** Každý stĺpec sady musí
 *     vedieť nakresliť hodnotu, „nie je obohatené" aj „dni chýbajú". Iteruje sa
 *     cez `PRODUCT_COLUMN_IDS`, takže nový stĺpec sa tejto kontrole nevyhne
 *     tým, že ho niekto zabudne dopísať do testu.
 *  B. **Obe tabuľky používajú TÚ ISTÚ definíciu, nie kópiu.** Meria sa
 *     VYKRESLENÝ markup oboch tabuliek proti menám z modulu — nie prítomnosť
 *     reťazca v zdroji. Zdrojové kontroly sú tu len dve a strážia to, čo
 *     vykreslený markup ukázať nevie: že si tabuľka meno stĺpca nedrží
 *     v druhej kópii.
 *  C. **Vynechaný stĺpec sa naozaj NEKRESLÍ** — a hlavne sa nepremenuje.
 *     Presne to je pravidlo D124: „Cena pri príprave" nesmie zmutovať na
 *     „Cena", lebo je to iná veličina.
 *  D. **Poradie a obsah sady** — dve tabuľky s tými istými stĺpcami v inom
 *     poradí sa porovnať nedajú o nič lepšie než dve s inými menami.
 *  E. **Vety sa nerozišli so `sold-coverage.ts`.** `lib/` nesmie importovať
 *     z `components/`, takže dôvody „nevieme" sú na dvoch miestach; tento blok
 *     je to, čo ich drží pri sebe. Keď `CatalogTable.tsx` prejde na jednotné
 *     stĺpce, `sold-coverage.ts` má tie konštanty re-exportovať a blok E má
 *     zmiznúť.
 *  F. **Správanie, ktoré sa už raz pokazilo** — `≥ 0`, obrátkovosť vydávaná za
 *     okno (R3) a marža, ktorej jedna chýbajúca polovica zahodí aj tú druhú.
 *
 * Vlastník: V5 (jednotné stĺpce).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ItemsTable } from '@/components/campaigns/DiscountDetail';
import { SampleTable, SAMPLE_COLUMN_IDS } from '@/components/campaigns/NewDiscount';
import type { TierPlan } from '@/components/campaigns/discounts-model';
import type { SelectableRow } from '@/components/campaigns/discounts-model';
import type { DiscountItemView } from '@/components/campaigns/zlavy-api';
import {
  KPI_DASH,
  KPI_GAP_REASON,
  KPI_NO_REASON,
  KPI_UNASKED_REASON,
  type SoldCoverageState,
} from '@/components/products/sold-coverage';
import {
  knownValue,
  missingValue,
  productColumn,
  productColumns,
  productMarginCells,
  unknownRowValues,
  PRODUCT_COLUMN_IDS,
  PRODUCT_DASH,
  PRODUCT_GAPS,
  PRODUCT_GAP_REASON,
  PRODUCT_NO_REASON,
  type ProductColumnId,
  type ProductRowValues,
} from '@/lib/ui/product-columns';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Zdroj bez komentárov — komentár o stĺpci nie je vykreslené meno stĺpca. */
const bezKomentarov = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const DETAIL = '../../src/components/campaigns/DiscountDetail.tsx';
const NOVA = '../../src/components/campaigns/NewDiscount.tsx';

/**
 * Telo JEDNEJ top-level funkcie zo zdroja (bez komentárov).
 *
 * Pridané 2. 9. 2026: `DiscountDetail.tsx` hostí odvtedy aj `AuditTrailTable`,
 * a tam je `productLabel()` SPRÁVNY tvar — audit má na produkt jeden riadok
 * textu vnútri bunky, nie vlastný stĺpec (D122, K6). Grep nad celým súborom
 * preto prestal merať to, čo meral: nezakazoval druhú kópiu pravidla
 * v tabuľke, ale legitímne pomenovanie v inej funkcii.
 */
function telo(rel: string, name: string): string {
  const src = bezKomentarov(rel);
  const start = src.indexOf(`export function ${name}(`);
  expect(start, `${rel} — funkcia ${name} v zdroji nie je`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(?:export (?:function|const|default)|function) /);
  return next === -1 ? rest : rest.slice(0, next);
}

/* ═══════════════════════════ fixtúry ══════════════════════════════════════ */

/** Riadok, o ktorom appka vie VŠETKO — jeden pre všetkých osem stĺpcov. */
const ZNAME: ProductRowValues = {
  productId: 4100,
  reference: knownValue('NAU-0031'),
  name: knownValue('Náušnice Lumen'),
  price: knownValue('34.90'),
  discountNow: {
    state: 'running',
    percent: knownValue(20),
    from: '2026-09-01',
    to: '2026-09-10',
    measuredAt: '2026-09-01T08:00:00.000Z',
  },
  soldWindow: {
    windowDays: 30,
    completeDays: 30,
    unknownDays: 0,
    units: knownValue(7),
    lowerBound: false,
  },
  soldPerStock: { ratio: knownValue(2.5), soldTotal: knownValue(50), stock: knownValue(20) },
  margin: { eur: knownValue(12.5), percent: knownValue(34) },
  stock: knownValue(20),
};

function polozka(patch: Partial<DiscountItemView> = {}): DiscountItemView {
  return {
    id: 1,
    productId: 4100,
    position: 1,
    status: 'failed',
    nameAtWrite: 'Náušnice Lumen',
    priceAtPreview: '34.90',
    priceAtWrite: null,
    priceMismatch: false,
    hasAttributes: false,
    attemptCount: 1,
    httpStatus: 502,
    errorCode: 'shop_timeout',
    errorMessage: null,
    finishedAt: null,
    ...patch,
  };
}

function vyber(patch: Partial<SelectableRow> = {}): SelectableRow {
  return {
    productId: 4100,
    name: 'Náušnice Lumen',
    reference: 'NAU-0031',
    price: '34.90',
    unitsSold: 7,
    discountedNow: false,
    ...patch,
  };
}

/** Pokrytie: celé okno je dočítané, takže čísla sú celé počty. */
const PLNE = (days: number): SoldCoverageState => ({
  asked: true,
  coverage: { syncEnabled: true, daysCovered: days, daysPartial: 0, from: null, to: null },
});

/** Pokrytie: z okna je dočítaných len pár dní — čísla sú dolná hranica. */
const CIASTOCNE = (covered: number): SoldCoverageState => ({
  asked: true,
  coverage: { syncEnabled: true, daysCovered: covered, daysPartial: 0, from: null, to: null },
});

const PASMO: TierPlan = {
  ord: 1,
  letter: 'A',
  bucket: 'none',
  label: 'Ležiaky',
  percent: 30,
  productIds: [4100],
};

const polozky = (rows: readonly DiscountItemView[]) =>
  renderToStaticMarkup(createElement(ItemsTable, { rows, fallbackPercent: 25 }));

const vzorka = (
  rows: readonly SelectableRow[],
  coverage: SoldCoverageState = PLNE(30),
  soldWindowDays = 30,
) =>
  renderToStaticMarkup(
    createElement(SampleTable, {
      sample: rows,
      total: rows.length,
      soldWindowDays,
      coverage,
      tierOfProduct: new Map(rows.map((row) => [row.productId, PASMO])),
    }),
  );

/** Text hlavičky stĺpca z vykresleného markupu. `null` = stĺpec sa nekreslí. */
function hlavicka(html: string, id: ProductColumnId): string | null {
  const found = new RegExp(`<th[^>]*data-col="${id}"[^>]*>([^<]*)</th>`).exec(html);
  return found === null ? null : found[1]!;
}

/** Obsah bunky stĺpca (aj so značkami vnútri). `null` = stĺpec sa nekreslí. */
function bunka(html: string, id: ProductColumnId): string | null {
  const found = new RegExp(`<td[^>]*data-col="${id}"[^>]*>([\\s\\S]*?)</td>`).exec(html);
  return found === null ? null : found[1]!;
}

/* ═════════ A. Trojstavovosť patrí do definície stĺpca ═════════════════════ */

describe('A. každý stĺpec vie sám nakresliť všetky tri stavy (I11, D124)', () => {
  it('meranie vôbec niečo prechádza', () => {
    /* Bez tejto poistky by cykly nižšie prešli aj nad prázdnou sadou. */
    expect(PRODUCT_COLUMN_IDS.length).toBe(8);
  });

  it('1. hodnota — zmerané číslo sa vypíše a NIE je to priznanie', () => {
    for (const id of PRODUCT_COLUMN_IDS) {
      const cell = productColumn(id, { soldWindowDays: 30 }).cell(ZNAME);
      expect(cell.unknown, id).toBe(false);
      expect(cell.text, id).not.toBe(PRODUCT_DASH);
      expect(cell.text.trim(), id).not.toBe('');
    }
  });

  it('2. „nie je obohatené" — pomlčka a veta, ktorá to povie nahlas', () => {
    for (const id of PRODUCT_COLUMN_IDS) {
      const cell = productColumn(id, { soldWindowDays: 30 }).cell(
        unknownRowValues('not_enriched'),
      );
      expect(cell.unknown, id).toBe(true);
      expect(cell.text, id).toBe(PRODUCT_DASH);
      expect(cell.title ?? '', id).toContain('nie je obohatený');
    }
  });

  it('3. „dni chýbajú" — pomlčka a dôvod, nie nižšie číslo', () => {
    for (const id of PRODUCT_COLUMN_IDS) {
      const cell = productColumn(id, { soldWindowDays: 30 }).cell(
        unknownRowValues('days_missing'),
      );
      expect(cell.unknown, id).toBe(true);
      expect(cell.text, id).toBe(PRODUCT_DASH);
      expect(cell.title ?? '', id).toContain('chýbajú dni');
    }
  });

  it('žiadny dôvod nekončí ako nula, prázdno ani ako `title` bez vety', () => {
    for (const gap of PRODUCT_GAPS) {
      for (const id of PRODUCT_COLUMN_IDS) {
        const cell = productColumn(id, { soldWindowDays: 30 }).cell(unknownRowValues(gap));
        expect(cell.text, `${id}/${gap}`).toBe(PRODUCT_DASH);
        expect(cell.text, `${id}/${gap}`).not.toBe('0');
        expect(cell.title, `${id}/${gap}`).not.toBeNull();
        expect((cell.title ?? '').length, `${id}/${gap}`).toBeGreaterThan(10);
      }
    }
  });

  it('stĺpec, na ktorý tabuľka hodnotu vôbec neposlala, je „ešte sme sa nepýtali"', () => {
    /* Štvrtý stav, ktorý sa s ostatnými tromi nesmie zliať: prázdny vstup nie
       je medzera v dátach, je to riadok pred odpoveďou. */
    for (const id of PRODUCT_COLUMN_IDS) {
      const cell = productColumn(id, { soldWindowDays: 30 }).cell({});
      expect(cell.unknown, id).toBe(true);
      expect(cell.title ?? '', id).toContain(PRODUCT_GAP_REASON.not_asked);
    }
  });

  it('neznámy kód dôvodu nepadne na prázdny `title`, ale na priznanie', () => {
    /* Server smie poslať kód, ktorý klient nepozná; zahodiť pri tom vetu by
       znamenalo prázdnu bunku bez vysvetlenia. */
    const cell = productColumn('stock').cell({
      stock: { value: null, gap: 'celkom_nova_medzera' as never },
    });
    expect(cell.unknown).toBe(true);
    expect(cell.title).toBe(PRODUCT_NO_REASON);
  });
});

/* ═════════ B. Obe tabuľky idú cez TÚ ISTÚ definíciu ══════════════════════ */

describe('B. výber do zľavy a položky kampane používajú tú istú definíciu', () => {
  const vzorkaHtml = vzorka([vyber()]);
  const polozkyHtml = polozky([polozka({ reference: 'NAU-0031' })]);

  it('spoločné stĺpce sa v oboch tabuľkách volajú ROVNAKO', () => {
    for (const id of ['reference', 'name'] as const) {
      const label = productColumn(id).label;
      expect(label.length, id).toBeGreaterThan(0);
      expect(hlavicka(vzorkaHtml, id), id).toBe(label);
      expect(hlavicka(polozkyHtml, id), id).toBe(label);
    }
  });

  it('referencia je PRVÝ stĺpec oboch tabuliek (D122, K1)', () => {
    for (const html of [vzorkaHtml, polozkyHtml]) {
      const prvy = /<th[^>]*data-col="([a-zA-Z]+)"/.exec(html);
      expect(prvy).not.toBeNull();
      expect(prvy![1]).toBe('reference');
      // A je naozaj prvý v riadku hlavičky, nie až za iným stĺpcom.
      expect(html.indexOf('data-col="reference"')).toBeLessThan(html.indexOf('<td'));
    }
  });

  it('chýbajúca referencia dá v OBOCH tabuľkách tú istú bunku (I11)', () => {
    const bezVzorka = bunka(vzorka([vyber({ reference: undefined })]), 'reference');
    const bezPolozky = bunka(polozky([polozka({ reference: null })]), 'reference');
    expect(bezVzorka).not.toBeNull();
    expect(bezVzorka).toBe(bezPolozky);
    // Pomlčka a stlmenie — nie prázdna bunka a nie vymyslený kód.
    expect(bezVzorka).toContain(PRODUCT_DASH);
    expect(bezVzorka).toContain('lvl-3');
    expect(bezVzorka).not.toContain('NAU-');
  });

  it('hlavička nesie aj to, čo stĺpec ZNAMENÁ — z definície, nie z tabuľky', () => {
    const title = productColumn('reference').headTitle;
    expect(title.length).toBeGreaterThan(20);
    for (const html of [vzorkaHtml, polozkyHtml]) expect(html).toContain(title);
  });

  it('ani jedna tabuľka si meno stĺpca nedrží vo vlastnej kópii', () => {
    /*
     * Vykreslený markup ukáže, že sa mená ZHODUJÚ, ale nie to, či ich tabuľka
     * náhodou nemá napísané druhýkrát u seba. Druhá kópia je presne to, čím sa
     * tabuľky rozišli, preto tu stojí zdrojová kontrola — jediná v tomto
     * súbore, ktorá sa pozerá do súboru namiesto na výstup.
     */
    for (const rel of [
      '../../src/components/campaigns/NewDiscount.tsx',
      '../../src/components/campaigns/DiscountDetail.tsx',
    ]) {
      const src = bezKomentarov(rel);
      expect(src, rel).toContain("from '@/lib/ui/product-columns'");
      expect(src, rel).toContain('column.cell(');
      for (const literal of ['>Referencia<', 'Referencia</th>', '>Názov<', 'Názov</th>']) {
        expect(src, `${rel} — ${literal}`).not.toContain(literal);
      }
    }
  });

  it('tabuľka nemá ako obísť definíciu vlastným formátovaním pomlčky', () => {
    /*
     * Keby si bunku skladala tabuľka, `productLabel()` by sa do nej vrátil
     * a s ním aj predpona „— · názov", ktorú D122 z tabuliek odstraňuje.
     *
     * 2. 9. 2026 — ČO SA ZMENILO A PREČO: kontrola bola grep nad CELÝM
     * `DiscountDetail.tsx`. Detail medzitým dostal `AuditTrailTable`, kde
     * `productLabel()` byť MUSÍ (D122 ho pre miesta s jedným riadkom textu na
     * produkt výslovne nechává; žiada si ho `zlava-historia-zapisov.spec.ts`
     * tvrdením na „NR-0041 · Náramok…"). Zákaz sa preto zúžil na TELÁ
     * TABULIEK — a aby zo zúženia nebola diera, hneď pod ním stojí tvrdenie,
     * že v súbore je `productLabel(` PRÁVE RAZ a práve v audite. Kto ho
     * pridá do tretieho miesta, zhodí tento test, aj keby to bola tabuľka,
     * ktorú tu nikto nevymenoval.
     */
    for (const name of ['ItemsTable', 'CampaignProductsTable', 'campaignProductColumns']) {
      expect(telo(DETAIL, name), `${name} si skladá pomenovanie sám`).not.toContain(
        'productLabel(',
      );
    }
    const vyskyty = bezKomentarov(DETAIL).match(/productLabel\(/g) ?? [];
    expect(vyskyty.length, 'productLabel() je v detaile na inom mieste než v audite').toBe(1);
    expect(telo(DETAIL, 'AuditTrailTable'), 'audit produkt prestal menovať').toContain(
      'productLabel(',
    );
    expect(bezKomentarov(NOVA)).not.toContain('productLabel(');
  });
});

/* ═════════ C. Vynechaný stĺpec sa naozaj nekreslí ════════════════════════ */

describe('C. kde sa stĺpec nehodí, VYNECHÁ sa — a nepremenuje (D124)', () => {
  const polozkyHtml = polozky([polozka()]);
  const vzorkaHtml = vzorka([vyber()]);

  it('položky zľavy kreslia zo sady len identitu produktu', () => {
    for (const id of PRODUCT_COLUMN_IDS) {
      const kresli = id === 'reference' || id === 'name';
      expect(hlavicka(polozkyHtml, id) === null, id).toBe(!kresli);
      expect(bunka(polozkyHtml, id) === null, id).toBe(!kresli);
    }
  });

  it('vynechaná „Cena" sa NEPREMENOVALA — momentka má vlastné meno', () => {
    /*
     * Toto je celé pravidlo D124. „Cena pri príprave" je cena z času skúšky
     * naprázdno, nie dnešná cena z katalógu; keby prevzala meno „Cena",
     * dve tabuľky by pod jedným menom ukazovali dve rôzne veličiny.
     */
    expect(polozkyHtml).toContain('Cena pri príprave');
    expect(polozkyHtml).not.toContain('>Cena</th>');
    expect(polozkyHtml).not.toContain('data-col="price"');
  });

  it('vynechaná „Zľava v shope" sa nezamenila za percento tejto zľavy', () => {
    // Meno berieme z DEFINÍCIE, nie z literálu v teste: keby sa stĺpec znovu
    // premenoval, `not.toContain('…')` nad starým reťazcom by prešiel naprázdno.
    expect(polozkyHtml).not.toContain(productColumn('discountNow').label);
    expect(polozkyHtml).not.toContain('data-col="discountNow"');
    // Percento TEJTO zľavy tam zostáva pod vlastným menom.
    expect(polozkyHtml).toContain('<th class="n">Zľava</th>');
  });

  it('vzorka výberu vynecháva obohatené stĺpce, ktoré nemá čím naplniť', () => {
    expect([...SAMPLE_COLUMN_IDS]).toEqual(['reference', 'name', 'price', 'soldWindow']);
    for (const id of ['discountNow', 'soldPerStock', 'margin', 'stock'] as const) {
      expect(hlavicka(vzorkaHtml, id), id).toBeNull();
      expect(bunka(vzorkaHtml, id), id).toBeNull();
    }
  });

  it('stĺpce sprievodcu zostávajú mimo sady a nevydávajú sa za jednotné', () => {
    expect(vzorkaHtml).toContain('<th class="n">Pásmo</th>');
    expect(vzorkaHtml).toContain('<th class="n">Nová cena</th>');
    expect(vzorkaHtml).not.toContain('data-col="Pásmo"');
  });

  it('prázdna vzorka sa nekreslí — prázdna tabuľka nie je stav', () => {
    expect(vzorka([])).toBe('');
  });
});

/* ═════════ D. Sada a jej poradie ═════════════════════════════════════════ */

describe('D. sada je jedna a jej poradie je záväzné (D124, D122)', () => {
  it('sada je presne tá, ktorú vymenúva D124', () => {
    expect([...PRODUCT_COLUMN_IDS]).toEqual([
      'reference',
      'name',
      'price',
      'discountNow',
      'soldWindow',
      'soldPerStock',
      'margin',
      'stock',
    ]);
  });

  it('vstupné poradie sa ignoruje — inak by sa dve tabuľky nedali porovnať', () => {
    expect(productColumns(['stock', 'reference', 'price']).map((c) => c.id)).toEqual([
      'reference',
      'price',
      'stock',
    ]);
  });

  it('duplicita nevyrobí dva rovnaké stĺpce', () => {
    expect(productColumns(['name', 'name', 'name']).map((c) => c.id)).toEqual(['name']);
  });

  it('okno predajnosti je súčasťou mena, nie iný stĺpec', () => {
    expect(productColumn('soldWindow', { soldWindowDays: 30 }).label).toBe('Predané 30 d');
    expect(productColumn('soldWindow', { soldWindowDays: 180 }).label).toBe('Predané 180 d');
  });

  it('neznáme okno sa NEVYMÝŠĽA — nadpis to prizná', () => {
    const column = productColumn('soldWindow');
    expect(column.label).toBe('Predané za okno');
    expect(column.headTitle).toContain('nedostala');
  });
});

/* ═════════ E. Vety sa nerozišli so `sold-coverage.ts` ════════════════════ */

describe('E. dôvody „nevieme" znejú v oboch moduloch rovnako', () => {
  /*
   * `lib/` nesmie importovať z `components/`, takže tie isté vety sú na dvoch
   * miestach. Kto ich rozíde, dostane na jednej obrazovke dve vysvetlenia tej
   * istej medzery — a to je presne ten nález, kvôli ktorému D124 vzniklo.
   * Tento blok zmizne, keď `sold-coverage.ts` začne re-exportovať odtiaľto.
   */
  it('pomlčka je tá istá', () => {
    expect(PRODUCT_DASH).toBe(KPI_DASH);
  });

  it('spoločné dôvody sú znak po znaku tie isté', () => {
    for (const gap of ['not_enriched', 'shop_has_none', 'days_missing', 'not_computable'] as const) {
      expect(PRODUCT_GAP_REASON[gap], gap).toBe(KPI_GAP_REASON[gap]);
    }
  });

  it('„ešte sme sa nepýtali" a „nevieme prečo" sú tiež tie isté vety', () => {
    expect(PRODUCT_GAP_REASON.not_asked).toBe(KPI_UNASKED_REASON);
    expect(PRODUCT_NO_REASON).toBe(KPI_NO_REASON);
  });
});

/* ═════════ F. Správanie, ktoré sa už raz pokazilo ════════════════════════ */

describe('F. čo sa v týchto stĺpcoch pokazilo predtým', () => {
  const okno = (units: number | null, completeDays: number, windowDays = 30) =>
    productColumn('soldWindow', { soldWindowDays: windowDays }).cell({
      soldWindow: {
        windowDays,
        completeDays,
        unknownDays: windowDays - completeDays,
        units: units === null ? missingValue<number>('days_missing') : knownValue(units),
        lowerBound: windowDays - completeDays > 0,
      },
    });

  it('dočítané okno dá CELÝ počet — aj keď je to nula', () => {
    const nula = okno(0, 30);
    expect(nula.text).toBe('0');
    expect(nula.unknown).toBe(false);
    expect(nula.lowerBound).toBe(false);
  });

  it('nedočítané okno dá dolnú hranicu so znakom `≥`', () => {
    const cell = okno(5, 2);
    expect(cell.text).toBe('≥ 5');
    expect(cell.unknown).toBe(false);
    expect(cell.lowerBound).toBe(true);
    expect(cell.title ?? '').toContain('dočítaných 2');
  });

  it('`≥ 0` sa NEVYKRESLÍ nikdy — je to prázdna veta, nie priznanie', () => {
    const cell = okno(0, 2);
    expect(cell.text).toBe(PRODUCT_DASH);
    expect(cell.unknown).toBe(true);
    expect(cell.title ?? '').toContain('chýbajú dni');
  });

  it('vzorka výberu ide tou istou bránou ako definícia (D121)', () => {
    /* Číslo z `catalog/search` je pri neúplnom pokrytí dolná hranica; nula pri
       ňom je pomlčka, lebo práve podľa nej sa vyberá pásmo. */
    expect(bunka(vzorka([vyber({ unitsSold: 5 })], CIASTOCNE(2)), 'soldWindow')).toContain('≥ 5');
    const nula = bunka(vzorka([vyber({ unitsSold: 0 })], CIASTOCNE(2)), 'soldWindow');
    expect(nula).toContain(PRODUCT_DASH);
    expect(nula).not.toContain('≥');
    // Neznámy predaj (D121 — server posiela `null`, nikdy nulu) je pomlčka.
    expect(bunka(vzorka([vyber({ unitsSold: null })], PLNE(30)), 'soldWindow')).toContain(
      PRODUCT_DASH,
    );
  });

  it('nezistené pokrytie NEVYDÁ dolnú hranicu za meranie', () => {
    const cell = bunka(vzorka([vyber({ unitsSold: 5 })], { asked: false }), 'soldWindow');
    expect(cell).toContain('≥ 5');
  });

  it('obrátkovosť prizná, že je CELKOVÁ, nie za okno (R3)', () => {
    const column = productColumn('soldPerStock');
    expect(column.label).toBe('Predané / sklad');
    expect(column.headTitle).toContain('za okno');
    const cell = column.cell(ZNAME);
    expect(cell.text).toBe('2.5×');
    expect(cell.title ?? '').toContain('história objednávok');
  });

  it('marža: chýbajúca polovica nezahodí tú, ktorú appka zmerala', () => {
    const len_eur = productColumn('margin').cell({
      margin: { eur: knownValue(12.5), percent: missingValue<number>('shop_has_none') },
    });
    expect(len_eur.unknown).toBe(false);
    expect(len_eur.text).toBe(`12,50 € · ${PRODUCT_DASH}`);

    const len_percento = productColumn('margin').cell({
      margin: { eur: missingValue<number>('shop_has_none'), percent: knownValue(34) },
    });
    expect(len_percento.text).toBe(`${PRODUCT_DASH} · 34 %`);

    // Obe medzery = jedna pomlčka, nie „— · —".
    const ziadna = productColumn('margin').cell(unknownRowValues('not_enriched'));
    expect(ziadna.text).toBe(PRODUCT_DASH);
  });

  it('marža sa dá vziať aj po polovičkách — pre tabuľku s dvoma uzlami', () => {
    const { eur, percent } = productMarginCells({
      eur: knownValue(12.5),
      percent: missingValue<number>('not_enriched'),
    });
    expect(eur.text).toBe('12,50 €');
    expect(eur.unknown).toBe(false);
    expect(percent.text).toBe(PRODUCT_DASH);
    expect(percent.unknown).toBe(true);
  });

  it('zľava v shope: „bez zľavy" je MERANÝ fakt, „nevieme" je pomlčka', () => {
    const bez = productColumn('discountNow').cell({
      discountNow: {
        state: 'none',
        percent: missingValue<number>('shop_has_none'),
        from: null,
        to: null,
        measuredAt: '2026-09-01T08:00:00.000Z',
      },
    });
    expect(bez.text).toBe('bez zľavy');
    expect(bez.unknown).toBe(false);

    const nevieme = productColumn('discountNow').cell(unknownRowValues('not_enriched'));
    expect(nevieme.text).toBe(PRODUCT_DASH);
    expect(nevieme.unknown).toBe(true);
  });

  it('názov: keď ho zrkadlo nemá, zostane `#id`, nie prázdna bunka (D122)', () => {
    const cell = productColumn('name').cell({
      productId: 4100,
      name: missingValue<string>('shop_has_none'),
    });
    expect(cell.text).toBe('#4100');
    expect(cell.unknown).toBe(true);
    expect(cell.title ?? '').toContain('nič nevedie');
  });
});
