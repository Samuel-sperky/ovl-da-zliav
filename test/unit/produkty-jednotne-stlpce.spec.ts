/**
 * Aura Zľavy — PRODUKTY IDÚ NA JEDNOTNÚ SADU STĹPCOV (D124, K3; 1. 9. 2026).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * ─────────────────────────
 * `test/unit/jednotne-stlpce.spec.ts` meria výber do zľavy a položky kampane
 * a vo svojej hlavičke sám priznáva, že `CatalogTable.tsx` z kontroly VYŇAL.
 * Presne to je zapísaná pasca tohto repa — „čo test vyňal z kontroly, nestráži
 * NIKTO" — a overovatelia ju 1. 9. 2026 našli v dvoch tvaroch naraz:
 *
 *  1. Najväčšia z troch tabuliek produktov jednotnú sadu vôbec nepoužívala,
 *     takže štyri z ôsmich stĺpcov sady (`discountNow`, `soldPerStock`, `margin`,
 *     `stock`) nemali v produkčnom grafe ŽIADNEHO konzumenta — kreslil ich len
 *     test.
 *  2. Stĺpec `discountNow` sa v sade volal „Zľava teraz" — presne tak, ako sa
 *     na Produktoch volá stĺpec VLASTNÝCH ZÁPISOV appky. Jedno meno, dva
 *     opačné zdroje: shop verzus účtovníctvo appky. Človek by tie dve tabuľky
 *     vedľa seba porovnal ako to isté číslo.
 *
 * ČO SA TU MERIA
 * ──────────────
 *  A. Sada je na Produktoch CELÁ a v ZÁVÄZNOM poradí — čítané z `data-col`
 *     vo vykreslenej hlavičke, nie zo zdroja.
 *  B. Mená a vety `title` sú z DEFINÍCIE, nie z druhej kópie v tabuľke.
 *  C. Dva stĺpce o zľave majú dve rôzne mená a DVA RÔZNE ZDROJE — a to sa dá
 *     ukázať len riadkom, kde si tie zdroje odporujú.
 *  D. Trojstavovosť prežila prechod: neobohatený riadok je pomlčka s dôvodom
 *     z `PRODUCT_GAP_REASON`, nie nula.
 *
 * Vlastník: V5 (zelená brána).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CatalogTable from '@/components/products/CatalogTable';
import type {
  CatalogRowView,
  KpiValueView,
  ProductKpiPageView,
  ProductKpiRowView,
} from '@/components/products/catalog-api';
import {
  PRODUCT_COLUMN_IDS,
  PRODUCT_DASH,
  PRODUCT_GAP_REASON,
  productColumn,
  type ProductColumnId,
} from '@/lib/ui/product-columns';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const TABULKA = read('../../src/components/products/CatalogTable.tsx');

/**
 * Stĺpce sady, ktoré Produkty KRESLIA.
 *
 * Od 3. 9. 2026 má sada deväť stĺpcov (V7, D159) a `ean13` medzi kreslenými
 * NIE JE — je to D124, nie výnimka z neho: „kde sa stĺpec nehodí, VYNECHÁ sa".
 * EAN v tejto tabuľke už stojí tichým druhým riadkom v bunke názvu
 * (`CodeLine`) a berie ho INÁ cesta než KPI riadok — `POST /api/catalog/details`
 * spoza kľúča, kde má tri druhy prázdna. Druhý stĺpec s tým istým menom
 * z druhého zdroja by na jednej obrazovke postavil dve odpovede na tú istú
 * otázku.
 *
 * KTO STRÁŽI TO, ČO TÁTO VÝNIMKA VYŇALA (pravidlo z `CLAUDE.md`):
 * `test/unit/prehlad-tabulka.spec.ts` §A meria, že tabuľka Prehľadu kreslí
 * VŠETKÝCH DEVÄŤ stĺpcov v poradí D159 — stĺpec teda nezostal bez jedinej
 * tabuľky, ktorá ho naozaj vypisuje, a jeho meno ani vety `title` nie sú bez
 * dozoru. Zoznam sa tu pritom NEPÍŠE ručne: je ODVODENÝ zo sady, takže nový
 * stĺpec sady sa objaví aj tu a test padne, kým ho niekto vedome nezaradí
 * alebo nevynechá.
 */
const KRESLENE: readonly ProductColumnId[] = PRODUCT_COLUMN_IDS.filter((id) => id !== 'ean13');

/** Zdroj bez komentárov — inak by tvrdenie zhodila veta v docblocku. */
const bezKomentarov = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Text tak, ako ho React zapíše do atribútu. Vety definície nesú úvodzovky
 * („≥"), a tie sa v `title=` vykreslia ako `&quot;` — bez tohto by test meral
 * escapovanie, nie zhodu s definíciou.
 */
const vAtribute = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const ROW: CatalogRowView = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: false,
  shopStatus: 'ok',
  unitsSold: null,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror',
};

const OKNO_PRAZDNE = (windowDays: number) => ({
  windowDays,
  completeDays: 0,
  unknownDays: windowDays,
  units: { value: null, gap: 'days_missing' } as KpiValueView<number>,
  lowerBound: false,
});

/** Riadok, o ktorom appka nevie nič — `getFull` sa naň nikdy nepýtalo. */
function neobohateny(): ProductKpiRowView {
  const gap = { value: null, gap: 'not_enriched' } as const;
  return {
    productId: ROW.productId,
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

/** Riadok, na ktorý sa appka shopu naozaj spýtala. */
function obohateny(): ProductKpiRowView {
  return {
    ...neobohateny(),
    reference: { value: 'NAU-1042', gap: null },
    margin: { value: 12.4, gap: null },
    marginPercent: { value: 38, gap: null },
    stock: { value: 8, gap: null },
    soldTotal: { value: 24, gap: null },
    soldPerStock: { value: 3, gap: null },
    discount: {
      state: 'none',
      activePercent: { value: null, gap: 'shop_has_none' },
      from: null,
      to: null,
      measuredAt: '2026-08-30T02:00:00.000Z',
    },
    units30: {
      windowDays: 30,
      completeDays: 30,
      unknownDays: 0,
      units: { value: 5, gap: null },
      lowerBound: false,
    },
    enrichedAt: '2026-08-30T02:00:00.000Z',
  };
}

const stranka = (row: ProductKpiRowView): ProductKpiPageView => ({
  today: '2026-09-01',
  shortWindowDays: 30,
  longWindowDays: 90,
  byId: new Map([[row.productId, row]]),
});

const render = (kpi: ProductKpiPageView | null, row: CatalogRowView = ROW): string =>
  renderToStaticMarkup(
    createElement(CatalogTable, {
      rows: [row],
      kpi,
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
    }),
  );

/** Poradie jednotných stĺpcov tak, ako ich vykreslila HLAVIČKA. */
function poradieVHlavicke(html: string): ProductColumnId[] {
  const hlavicka = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
  return [...hlavicka.matchAll(/data-col="([a-zA-Z]+)"/g)].map(
    (match) => match[1] as ProductColumnId,
  );
}

/** Bunka jednotného stĺpca aj s obalom `<td>` — meria sa TELO, nie model. */
function bunka(html: string, id: ProductColumnId): string {
  const riadok = html.slice(html.indexOf('<tbody>'));
  const kotva = riadok.indexOf(`data-col="${id}"`);
  expect(kotva, `bunka stĺpca ${id} v riadku chýba`).toBeGreaterThan(-1);
  const zaciatok = riadok.lastIndexOf('<td', kotva);
  return riadok.slice(zaciatok, riadok.indexOf('</td>', kotva) + 5);
}

/* ═════════ A. Sada je celá a v záväznom poradí ════════════════════════════ */

describe('A. Produkty kreslia CELÚ jednotnú sadu v poradí sady (D124)', () => {
  const html = render(stranka(obohateny()));

  it('v hlavičke sú všetky KRESLENÉ stĺpce sady, ani jeden nechýba', () => {
    expect([...poradieVHlavicke(html)].sort()).toEqual([...KRESLENE].sort());
  });

  it('vynechaný `ean13` sa tu nekreslí ako stĺpec — a nepremenoval sa', () => {
    /*
     * Druhá strana toho istého pravidla (D124): stĺpec, ktorý sa nehodí, sa
     * VYNECHÁ — nikdy sa nepremenuje ani nenaplní inou veličinou. Meria sa to
     * na `data-col`, nie na texte: slovo „EAN" v tejto tabuľke LEGITÍMNE je
     * (tichý druhý riadok v bunke názvu), takže grep nad textom by tvrdil
     * opak toho, čo sa deje.
     */
    expect(poradieVHlavicke(html)).not.toContain('ean13');
    expect(html).not.toContain('data-col="ean13"');
    // A meno stĺpca sady zostalo menom stĺpca sady, nie menovkou riadku.
    expect(productColumn('ean13').label).toBe('EAN');
  });

  it('idú v ZÁVÄZNOM poradí sady — stĺpce mimo sady ho nesmú prehádzať', () => {
    /*
     * Produkty majú navyše tri stĺpce, ktoré sada nepozná (druhé okno
     * predajnosti, posledný predaj, vlastné zápisy). Sada preto nie je súvislý
     * blok, ale PODPOSTUPNOSŤ — a tá musí ísť v poradí `PRODUCT_COLUMN_IDS`.
     * Dve tabuľky s tými istými stĺpcami v inom poradí sa porovnať nedajú
     * o nič lepšie než dve s inými menami.
     */
    expect(poradieVHlavicke(html)).toEqual([...KRESLENE]);
  });

  it('mriežka `data-col` je aj v RIADKU, nielen v hlavičke', () => {
    for (const id of KRESLENE) expect(bunka(html, id).length).toBeGreaterThan(0);
  });

  /*
   * ČLENSTVO V SADE SA NEDÁ POUŽIŤ AKO CSS KOTVA PRE STĹPEC MIMO SADY.
   *
   * `Table` vypisuje `data-col` LEN pre stĺpce sady (jeho bod G), takže výber
   * a „Zľava teraz" ho nemajú vôbec. Modul obrazovky mal do 2. 9. 2026 dve
   * pravidlá na `[data-col='select']` — obe MŔTVE od prechodu na primitívum,
   * takže odsadenie prvej bunky ticho zmizlo a s ním aj „kotva" prúžku
   * otvoreného riadku. Nenašiel to typecheck ani grep nad `.tsx`: chyba bola
   * v CSS, kde sa preklep neprejaví ničím.
   *
   * Nemeria sa tu vzhľad, ale ROZPOR: keď selektor menuje `data-col` hodnotou,
   * ktorú tabuľka nevypisuje, je to pravidlo bez cieľa.
   */
  it('CSS obrazovky necieli na `data-col`, ktoré tabuľka nevypisuje', () => {
    /* Komentáre sa odstrihnú: mŕtve kotvy sú v tomto module POMENOVANÉ ako
       pasca (`[data-col='select']`) a bez tohto by test padal na vysvetlení
       toho, čo stráži. */
    const modul = read('../../src/components/products/catalog-table.module.css').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const vSade = new Set<string>(PRODUCT_COLUMN_IDS);
    /* 2. 9. 2026: `vSade.has()` vracia `boolean`, takže `id` zostávalo `string`
       a `bunka()` (berie `ProductColumnId`) na ňom neprešlo typecheckom.
       Členstvo sa preto pýtame PREDIKÁTOM — to isté tvrdenie, len zúži typ. */
    const jeVSade = (id: string): id is ProductColumnId => vSade.has(id);
    const cielene = [...modul.matchAll(/data-col=['"]([a-zA-Z]+)['"]/g)].map((m) => m[1] as string);

    expect(cielene.length, 'modul stratil všetky kotvy na stĺpce sady').toBeGreaterThan(0);
    for (const id of cielene) {
      expect(jeVSade(id), `CSS cieli na data-col='${id}', ktoré tabuľka nevypisuje`).toBe(true);
      /* Tvrdenie nad týmto `if` už padlo, keď kotva v sade nie je; `continue`
         je tu LEN pre zúženie typu, nie ako zmäkčenie kontroly. */
      if (!jeVSade(id)) continue;
      expect(bunka(html, id).length, `stĺpec ${id} v riadku nie je`).toBeGreaterThan(0);
    }
  });
});

/* ═════════ B. Mená a vety sú z definície, nie z druhej kópie ══════════════ */

describe('B. tabuľka si mená stĺpcov nedrží vo vlastnej kópii', () => {
  const html = render(stranka(obohateny()));

  it('každý KRESLENÝ stĺpec sady nesie meno aj vetu `title` z DEFINÍCIE', () => {
    for (const id of KRESLENE) {
      const column = productColumn(id, { soldWindowDays: 30 });
      expect(html, `${id} — meno`).toContain(column.label);
      expect(html, `${id} — headTitle`).toContain(vAtribute(column.headTitle));
    }
  });

  it('zdroj naozaj importuje definíciu a volá jej bunky', () => {
    const src = bezKomentarov(TABULKA);
    expect(src).toContain("from '@/lib/ui/product-columns'");
    expect(src).toContain('.cell(values)');
    /* Meno stĺpca napísané druhýkrát u seba je presne to, čím sa tabuľky
       rozišli. Literály sa preto v tabuľke vyskytnúť nesmú. */
    for (const literal of ['>Referencia<', 'Referencia</th>', '>Názov<', 'Názov</th>']) {
      expect(src, literal).not.toContain(literal);
    }
  });
});

/* ═════════ C. Dva stĺpce o zľave = dva zdroje, dve mená ═══════════════════ */

describe('C. „Zľava teraz" a „Zľava v shope" sú dve rôzne otázky', () => {
  it('meno stĺpca vlastných zápisov NIE JE menom žiadneho stĺpca sady', () => {
    /*
     * Toto je celý nález: do 1. 9. 2026 sa jednotný `discountNow` volal
     * „Zľava teraz" — teda rovnako ako stĺpec vlastných zápisov na Produktoch,
     * len s opačným zdrojom.
     */
    const mena = PRODUCT_COLUMN_IDS.map((id) => productColumn(id).label);
    expect(mena).not.toContain('Zľava teraz');
    expect(productColumn('discountNow').label).toBe('Zľava v shope');
  });

  it('odporujúce si zdroje sa NEZLEJÚ — appka zapísala, shop nič nehlási', () => {
    /*
     * Riadok, na ktorom si obe vety odporujú, je jediný spôsob, ako ukázať, že
     * to sú naozaj dva zdroje: appka si zľavu zapísala (`discountedNow`), kým
     * shop k času obohatenia povedal „bez zľavy".
     */
    const html = render(stranka(obohateny()), { ...ROW, discountedNow: true });
    expect(bunka(html, 'discountNow')).toContain('bez zľavy');

    const telo = html.slice(html.indexOf('<tbody>'));
    const vlastna = telo.slice(telo.indexOf('data-l="Zľava teraz"'));
    expect(vlastna.slice(0, vlastna.indexOf('</td>'))).toContain('v zľave');
  });

  it('„bez zľavy" je MERANÝ fakt, neobohatený riadok je pomlčka', () => {
    expect(bunka(render(stranka(neobohateny())), 'discountNow')).toContain(PRODUCT_DASH);
  });
});

/* ═════════ D. Trojstavovosť prežila prechod (I11) ═════════════════════════ */

describe('D. neobohatený riadok je priznanie s dôvodom, nikdy nula', () => {
  const html = render(stranka(neobohateny()));

  it('každý obohatením plnený stĺpec je pomlčka s vetou z definície', () => {
    for (const id of ['reference', 'discountNow', 'soldPerStock', 'margin', 'stock'] as const) {
      const td = bunka(html, id);
      expect(td, id).toContain(PRODUCT_DASH);
      expect(td, id).toContain('data-unknown="true"');
      expect(td, id).toContain(PRODUCT_GAP_REASON.not_enriched.slice(0, 40));
      expect(td, id).not.toContain('>0<');
    }
  });

  it('okno bez dočítaných dní nedá `≥ 0`, ale pomlčku (D121)', () => {
    const td = bunka(html, 'soldWindow');
    expect(td).toContain(PRODUCT_DASH);
    expect(td).not.toContain('≥');
  });

  it('bez KPI (odpoveď ešte nedobehla) je to INÁ veta než „nie je obohatené"', () => {
    const bezKpi = render(null);
    expect(bunka(bezKpi, 'reference')).toContain(PRODUCT_GAP_REASON.not_asked);
    expect(bunka(bezKpi, 'reference')).not.toContain(PRODUCT_GAP_REASON.not_enriched);
  });
});
