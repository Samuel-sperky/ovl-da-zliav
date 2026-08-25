/**
 * Aura Zľavy — PANEL KUSU SA ZMESTIL, A NIČ Z NEHO NEVYPADLO.
 *
 * Panel detailu mal 1 148 px obsahu v stĺpci, ktorý má 620 px
 * (`.catalog-split > .drawer { max-height: calc(100vh - 280px) }`). Vyše 500 px
 * teda nedržal skrol, ale odseknutá hrana — posledný viditeľný riadok („Cena
 * po nej") bol preseknutý vodorovne a na snímke z 1440 × 900 to vyzeralo ako
 * chyba vykreslenia, nie ako „ide sa posúvať".
 *
 * Oprava je P6: referenčné skupiny sa zavreli do rozklikov. Lenže presne tu
 * sa dá ticho pokaziť to, čo panel drží pohromade — zadanie znie „všetky údaje
 * vypísané" a architektúra k tomu dopĺňa, že **zamknuté riadky sa nedajú
 * vynechať: z chýbajúceho riadku sa nedá zistiť, že tá informácia existuje**
 * (výnimka z P4/P5, 18. 8. 2026).
 *
 * Rozklik to neporušuje LEN VTEDY, keď na povrchu zostane nadpis skupiny
 * a pravdivý počet toho, čo je v nej. Tento súbor meria práve to:
 *
 *  1. **Zavretá skupina je na povrchu vidieť.** Nadpis je v `<summary>`, teda
 *     v tom, čo je čitateľné bez kliknutia.
 *  2. **Číslo v nadpise sedí s obsahom.** Počíta sa z poľa riadkov
 *     (`keyedRows`, `facts`), nie ručne — keby niekto riadok zmazal a číslo
 *     nechal, nadpis by klamal. Meria sa počtom `<dt>` NAOZAJ vykreslených
 *     vnútri tej istej skupiny.
 *  3. **Ani jeden z trinástich zamknutých riadkov nezmizol.**
 *  4. **Prekážky NIE SÚ pod rozklikom.** Sú to jediné údaje v paneli, ktoré
 *     hovoria, či sa kus vôbec dá zlacniť; schovať ich by bola iná chyba než
 *     tá, ktorú tu opravujeme.
 *  5. **Povrch zostal krátky.** Jediná dvojstĺpcová tabuľka na povrchu je
 *     „Zľavy podľa vlastných zápisov" (šesť riadkov). Keby niekto ktorýkoľvek
 *     rozklik otvoril natvrdo, povrch by naskočil na devätnásť riadkov a
 *     panel by sa znovu odsekol.
 *  6. **Tri prázdna sa v nadpise skupiny variantov nezlejú** a nedoťahaný
 *     zoznam sa netvári ako nula (`variantsHint`).
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna sieť. Efekty
 * klienta sa pri statickom renderi NESPÚŠŤAJÚ, takže `extra` je v paneli vždy
 * `undefined`; vetvy, ktoré závisia od doťahaného detailu, sa preto merajú nad
 * `variantsHint` priamo, nie cez panel. Je to tá istá pasca, akú má
 * `SoldDominant` (pozri `dominanta-pomlcka.spec.ts`).
 *
 * Vlastník: UX3, obrazovka Produkty (24. 8. 2026).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ProductDetailPanel, {
  fieldCount,
  variantsHint,
} from '@/components/products/ProductDetailPanel';
import type { CatalogRowView } from '@/components/products/catalog-api';
import type { ProductExtraView, ProductVariantView } from '@/components/products/product-extras';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const ROW: CatalogRowView = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: true,
  shopStatus: 'ok',
  unitsSold: 0,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror',
};

const variant = (over: Partial<ProductVariantView> = {}): ProductVariantView => ({
  variantId: 1,
  reference: 'AB-1',
  ean13: '8586001234567',
  quantity: 0,
  priceImpact: null,
  values: ['Veľkosť: 54'],
  ...over,
});

const extraOf = (variants: readonly ProductVariantView[]): ProductExtraView => ({
  productId: ROW.productId,
  description: null,
  shortDescription: null,
  variants,
  keyed: null,
  at: '2026-08-24T06:00:00.000Z',
});

function panel(row: CatalogRowView = ROW): string {
  return renderToStaticMarkup(
    createElement(ProductDetailPanel, { row, soldWindowDays: 30, onClose: () => {} }),
  );
}

/* ═══════════════════════════ pomôcky merania ══════════════════════════════ */

/**
 * Kus značiek jedného rozkliku — od jeho `<details>` po najbližšie
 * `</details>`. Rozkliky panela sa NEVNORUJÚ, takže najbližší koniec je ten
 * správny; keby sa raz zavnorili, zlyhá to hlučne a nie ticho.
 */
function fold(html: string, testId: string): string {
  const mark = `data-testid="${testId}"`;
  const at = html.indexOf(mark);
  expect(at, `rozklik ${testId} v paneli nie je`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<details', at);
  const end = html.indexOf('</details>', at);
  expect(start, `${testId} nie je v <details>`).toBeGreaterThan(-1);
  expect(end, `${testId} nemá koniec`).toBeGreaterThan(at);
  const kus = html.slice(start, end);
  expect(kus.indexOf('<details', 1), `${testId} sa zavnoril — meranie prestalo platiť`).toBe(-1);
  return kus;
}

/** To, čo je v rozkliku čitateľné BEZ kliknutia. */
function summaryOf(kus: string): string {
  const start = kus.indexOf('<summary');
  const end = kus.indexOf('</summary>');
  expect(start, 'rozklik bez nadpisu').toBeGreaterThan(-1);
  return kus.slice(start, end);
}

/** Koľko riadkov `<dt>` sa v tomto kuse značiek naozaj vykreslilo. */
function rows(kus: string): number {
  return kus.match(/<dt>/g)?.length ?? 0;
}

/** Číslo, ktoré nadpis zavretej skupiny sľubuje. */
function promisedCount(summary: string): number {
  const found = /·\s*(\d+)\s+údaj/.exec(summary);
  expect(found, `nadpis nesľubuje počet údajov: ${summary}`).not.toBeNull();
  return Number(found?.[1]);
}

/** Povrch = všetko, čo nie je v žiadnom rozkliku. */
function surface(html: string): string {
  return html.replace(/<details[\s\S]*?<\/details>/g, '');
}

/* ═════════ 1–2. Zavretá skupina je vidieť a jej počet je pravdivý ═════════ */

describe('panel kusu — rozklik neschováva existenciu údaja', () => {
  const html = panel();

  it('meranie vôbec niečo našlo', () => {
    /* Bez tejto poistky by testy nižšie prešli aj nad prázdnym reťazcom. */
    expect(html.length).toBeGreaterThan(2000);
    expect(rows(html)).toBeGreaterThan(20);
  });

  for (const [testId, title] of [
    ['detail-facts-fold', 'Údaje o produkte'],
    ['detail-locked-fold', 'Zatiaľ nedostupné'],
    ['detail-variants-fold', 'Varianty'],
  ] as const) {
    it(`„${title}" má nadpis na povrchu, nie až po kliknutí`, () => {
      expect(summaryOf(fold(html, testId))).toContain(title);
    });
  }

  it('počet v nadpise sedí s tým, koľko riadkov je vnútri', () => {
    for (const testId of ['detail-facts-fold', 'detail-locked-fold'] as const) {
      const kus = fold(html, testId);
      expect(promisedCount(summaryOf(kus)), `${testId}: nadpis klame o počte`).toBe(rows(kus));
    }
  });

  it('skupina spoza kľúča má trinásť riadkov a ani jeden nechýba', () => {
    const kus = fold(html, 'detail-locked-fold');
    const LABELS = [
      'Kód produktu',
      'EAN produktu',
      'Sklad',
      'Nákupná cena',
      'Marža',
      'Cena s DPH',
      'Dodávateľ',
      'Kategórie',
      'Zapnutý v eshope',
      'Pridané do eshopu',
      'Naposledy objednané',
      'Objednané kusy spolu',
      'Skutočná zľava v eshope',
    ];
    for (const label of LABELS) expect(kus, `chýba zamknutý riadok ${label}`).toContain(label);
    expect(rows(kus)).toBe(LABELS.length);
    // Zamknuté sa NEVYSVETĽUJE tu — vedie odtiaľto odkaz na jediné miesto.
    expect(kus).toContain('/nastavenia#zamknute');
  });

  it('nadpis skupiny je pomenovanie, nie „ďalšie" — dá sa z neho zistiť, čo je vnútri', () => {
    for (const testId of ['detail-facts-fold', 'detail-locked-fold'] as const) {
      const summary = summaryOf(fold(html, testId));
      expect(summary).not.toMatch(/ďalšie|viac|ostatné/i);
    }
  });
});

/* ═══════════ 3–4. Čo zostalo na povrchu a prečo práve to ══════════════════ */

describe('panel kusu — povrch nesie rozhodnutie, rozklik referenciu', () => {
  const html = panel();
  const povrch = surface(html);

  it('prekážky sú na povrchu, nie pod rozklikom', () => {
    /*
     * Jediné údaje v paneli, ktoré hovoria, či sa kus vôbec dá zlacniť.
     * Schovať ich pod rozklik by bola iná chyba než tá, ktorú tu opravujeme.
     */
    expect(povrch).toContain('product-no-blockers');
    expect(povrch).toContain('Appka nevidí nič');

    const sPrekazkou = surface(panel({ ...ROW, shopStatus: 'not_found' }));
    expect(sPrekazkou).toContain('Prekážky');
    expect(sPrekazkou).toContain('product-reason-');
  });

  it('nadpis „Prekážky" sa kreslí len nad zoznamom, nie nad jednou vetou', () => {
    /*
     * Nadpis skupiny je sľub, že pod ním je zoznam. Nad jedinou vetou „nič tu
     * nie je" je to 34 px chrómu nad nulovým obsahom — to isté rozhodnutie má
     * D8 v `CatalogTiles`. Veta si tému pomenuje sama.
     */
    expect(povrch).not.toContain('Prekážky');
    expect(povrch).not.toContain('product-blockers');
  });

  it('dominanta a výhrada o vlastných zápisoch zostali na povrchu', () => {
    expect(povrch).toContain('detail-units-sold');
    expect(povrch).toContain('Zľavy podľa vlastných zápisov');
    expect(povrch).toContain('Zľava teraz');
    // Výhrada stojí PRED číslom, nie pod ním.
    expect(povrch.indexOf('Zľavy podľa vlastných zápisov')).toBeLessThan(
      povrch.indexOf('Zľava teraz'),
    );
  });

  it('na povrchu je jediná dvojstĺpcová tabuľka a má šesť riadkov', () => {
    /*
     * Toto je rozpočet výšky prevedený na počítanie riadkov. Devätnásť
     * riadkov na povrchu je presne ten stav, v ktorom sa panel odsekol.
     */
    expect(rows(povrch)).toBe(6);
    expect(povrch).toContain('detail-discounts');
    expect(povrch).not.toContain('detail-locked"');
    expect(povrch).not.toContain('detail-facts"');
  });

  it('technika zostáva pod rozklikom (P6)', () => {
    expect(povrch).not.toContain('Technický detail');
    expect(html).toContain('Technický detail');
  });

  it('kus bez variantov rozklik variantov vôbec nekreslí', () => {
    const bez = panel({ ...ROW, hasAttributes: false });
    expect(bez).not.toContain('detail-variants-fold');
    // …a povie to riadkom v skupine údajov, nie prázdnym rozklikom.
    expect(bez).toContain('bez variantov');
  });
});

/* ═══════════ 5–6. Počty v nadpisoch: tri prázdna a platná nula ════════════ */

describe('nadpis zavretej skupiny nezlieva prázdna ani nevymýšľa nulu', () => {
  it('nedoťahaný zoznam variantov nie je nula', () => {
    expect(variantsHint(undefined)).toBe('zatiaľ nenačítané');
    expect(variantsHint(undefined)).not.toMatch(/\d/);
  });

  it('prázdny zoznam zo shopu je iné prázdno než nedoťahaný', () => {
    expect(variantsHint(extraOf([]))).toBe('shop ich nevedie');
    expect(variantsHint(extraOf([]))).not.toBe(variantsHint(undefined));
    expect(variantsHint(extraOf([]))).not.toMatch(/\d/);
  });

  it('varianty so skladom 0 sa počítajú — nula kusov nie je nula variantov', () => {
    /* `quantity: 0` je „vypredané", teda PLATNÁ hodnota, nie chýbajúci údaj. */
    const dva = extraOf([variant({ variantId: 1 }), variant({ variantId: 2, quantity: 0 })]);
    expect(variantsHint(dva)).toBe('2 varianty');
    expect(variantsHint(extraOf([variant()]))).toBe('1 variant');
  });

  it('počet údajov sa skloňuje a tisícky sa nelepia', () => {
    expect(fieldCount(1)).toBe('1 údaj');
    expect(fieldCount(3)).toBe('3 údaje');
    expect(fieldCount(13)).toBe('13 údajov');
  });
});
