/**
 * Aura Zľavy — PANEL NEUKAZUJE TEN ISTÝ FAKT DVAKRÁT
 * (otvorený bod 5 kontraktu V4, rozhodnutý 31. 8. 2026).
 *
 * NÁLEZ. Bočný panel mal DVE skupiny z eshopu a osem faktov v oboch naraz:
 *
 *   „Fakty z eshopu"        — obohatenie `getFull` uložené v stĺpcoch
 *                             `catalog_cache`, datované `enriched_at`
 *                             (`measuredNote()`), slovník prázdna `KpiGapKind`.
 *   „Podrobnosti z eshopu"  — `extra.keyed`, teda `raw` odpoveď TOHO ISTÉHO
 *                             riadku `catalog_cache`, BEZ času merania,
 *                             slovník prázdna `AbsenceKind`.
 *
 * Kód/referencia, sklad, nákupná cena, marža, dodávateľ, `qty_in_orders`
 * a `last_time_in_order` teda stáli v paneli dvakrát, z dvoch čítaní — a keďže
 * druhá skupina o svojom čase mlčala, nedalo sa povedať, ktoré číslo je novšie.
 * To je presne to, čo I11 zakazuje: dve tvrdenia o tej istej veci, z ktorých
 * ani jedno sa nedá datovať proti druhému.
 *
 * ČO SA MERÁ TU (a nikde inde to nikto nestráži):
 *
 *  1. **Žiadna menovka údaja sa v paneli neopakuje.** Meria sa nad VŠETKÝMI
 *     `<dt>` panela, nie nad zoznamom, ktorý by sa dal zabudnúť rozšíriť.
 *  2. **Osem duplicít je naozaj preč zo skupiny za kľúčom** a každý z tých
 *     faktov je v paneli ďalej — v skupine „Fakty z eshopu". Nič sa nestratilo.
 *  3. **Každá skupina, ktorá kreslí MERANIE Z ESHOPU, nesie čas merania.**
 *     Sú štyri: „Údaje o produkte" (`fetched_at` riadku), „Fakty z eshopu"
 *     (`enriched_at`), „Podrobnosti z eshopu" (`extra.at`) a „Varianty"
 *     (`extra.at`, nesie ho vnútri `ProductVariants`).
 *  4. **Neobohatený produkt ukáže pomlčky so slovom, nikdy nuly.**
 *  5. **Čas sa nikdy nevymyslí.** Keď ho appka nemá, je tam veta o tom, že ho
 *     nemá — nie dnešný dátum a nie „pred chvíľou".
 *
 * ČO SA TU ZÁMERNE NEMERÁ: skupiny, ktoré NIE SÚ meranie eshopu — „Predaj po
 * dňoch" a „Zľavy podľa vlastných zápisov" sú vlastný výpočet z objednávok
 * a vlastné zápisy appky (medzeru priznávajú `curveGapNote()` a nadpis
 * skupiny), „Prekážky" je stav appky. Čas merania eshopu by nad nimi bol
 * nepravdivý.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna sieť. Efekty
 * klienta pri statickom renderi NEBEŽIA, takže `extra` aj `kpi` sú v paneli
 * `undefined`/`null`; vetvy, ktoré závisia od doťahaných dát, sa preto merajú
 * priamo nad čistými funkciami (`keyedMeasuredNote`, `variantsMeasuredNote`) —
 * tá istá pasca, akú má `SoldDominant`.
 *
 * Vlastník: úloha DETAIL-FAKTY, vlna V4 (31. 8. 2026).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { CatalogRowView } from '@/components/products/catalog-api';
import {
  keyedMeasuredNote,
  variantsMeasuredNote,
  type ProductExtraView,
  type ProductKeyedView,
} from '@/components/products/product-extras';
import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import ProductVariants from '@/components/products/ProductVariants';

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

const KEYED: ProductKeyedView = {
  reference: 'AB-1',
  ean13: '8586001234567',
  wholesalePrice: '12',
  margin: '8',
  marginPercent: 42,
  priceWithTax: '41.88',
  active: true,
  addedAt: '2026-01-05T00:00:00.000Z',
  lastOrderedAt: '2026-08-01T00:00:00.000Z',
  stockQuantity: 3,
  orderedTotal: 17,
  supplier: 'Lumen s.r.o.',
  shopDiscountPercent: null,
  shopDiscountFrom: null,
  shopDiscountTo: null,
  categories: ['12', '18'],
};

const extraOf = (over: Partial<ProductExtraView> = {}): ProductExtraView => ({
  productId: ROW.productId,
  description: null,
  shortDescription: null,
  variants: [],
  keyed: KEYED,
  at: '2026-08-31T07:22:00.000Z',
  ...over,
});

function panel(row: CatalogRowView = ROW): string {
  return renderToStaticMarkup(
    createElement(ProductDetailPanel, { row, soldWindowDays: 30, onClose: () => {} }),
  );
}

/** Menovky všetkých údajov panela, v poradí vykreslenia. */
function labels(html: string): string[] {
  return [...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map((match) => match[1] ?? '');
}

/* ═════════ 1–2. Ten istý fakt práve raz ═══════════════════════════════════ */

describe('panel kusu — ten istý fakt sa nekreslí dvakrát', () => {
  const html = panel();

  it('meranie vôbec niečo našlo', () => {
    /* Bez poistky by tvrdenia nižšie prešli aj nad prázdnym reťazcom. */
    expect(html.length).toBeGreaterThan(2000);
    expect(labels(html).length).toBeGreaterThan(20);
  });

  it('žiadna menovka údaja sa v paneli neopakuje', () => {
    const found = labels(html);
    const twice = found.filter((label, index) => found.indexOf(label) !== index);
    expect(twice, `menovka v paneli dvakrát: ${twice.join(', ')}`).toEqual([]);
  });

  it('osem duplicít odišlo zo skupiny za kľúčom a ostalo vo „Faktoch z eshopu"', () => {
    /*
     * Vľavo menovka, ktorú kreslila skupina za kľúčom; vpravo tá, ktorá ten
     * istý fakt kreslí dnes. Ani jeden fakt sa teda nestratil — presunul sa
     * na to jediné miesto, ktoré ho vie datovať a má na jeho prázdno slovo.
     */
    const MOVED: readonly (readonly [string, string])[] = [
      ['Kód produktu', 'Referencia'],
      ['Sklad', 'Sklad'],
      ['Nákupná cena', 'Nákupná cena'],
      ['Marža', 'Marža'],
      ['Dodávateľ', 'Dodávateľ'],
      ['Objednané kusy spolu', 'Celkovo predané'],
      ['Naposledy objednané', 'Posledný predaj'],
      ['Skutočná zľava v eshope', 'Aktívna zľava v eshope'],
    ];
    const found = labels(html);
    for (const [gone, stays] of MOVED) {
      if (gone !== stays) {
        expect(found, `menovka ${gone} sa v paneli ešte kreslí`).not.toContain(gone);
      }
      expect(found, `fakt ${stays} v paneli chýba — niečo sa stratilo`).toContain(stays);
    }
  });

  it('skupina za kľúčom kreslí presne to, čo obohatenie nenesie', () => {
    const start = html.indexOf('data-testid="detail-locked"');
    expect(start).toBeGreaterThan(-1);
    const group = labels(html.slice(start, html.indexOf('</dl>', start)));
    expect(group).toEqual([
      'EAN produktu',
      'Cena s DPH',
      'Kategórie',
      'Zapnutý v eshope',
      'Pridané do eshopu',
    ]);
  });
});

/* ═════════ 3. Každá skupina merania z eshopu nesie svoj čas ═══════════════ */

describe('panel kusu — skupina bez času merania sa nekreslí', () => {
  const html = panel();

  for (const testId of [
    'detail-row-fetched-at', // „Údaje o produkte" — `fetched_at` riadku
    'detail-kpi-measured', // „Fakty z eshopu" — `enriched_at`
    'detail-keyed-measured', // „Podrobnosti z eshopu" — `extra.at`
    'detail-variants-measured', // „Varianty" — `extra.at`
  ] as const) {
    it(`skupina s meraním ${testId} nesie čas merania`, () => {
      expect(html, `${testId} v paneli nie je`).toContain(testId);
    });
  }

  it('skupina za kľúčom má svoj čas merania VNÚTRI svojho rozkliku', () => {
    /*
     * Nie kdekoľvek v paneli: čas merania patrí k skupine, ktorú datuje. Keby
     * stál mimo rozkliku, po zavretí skupiny by datoval niečo iné.
     */
    const at = html.indexOf('data-testid="detail-locked"');
    expect(at).toBeGreaterThan(-1);
    expect(html.slice(at, html.indexOf('</details>', at))).toContain('detail-keyed-measured');
  });
});

/* ═════════ 4–5. Nevieme je pomlčka so slovom, čas sa nevymýšľa ════════════ */

describe('neobohatený kus ukáže pomlčky a priznaný čas, nie nuly a nie dnešok', () => {
  const html = panel();

  it('fakty z eshopu sú pomlčky so slovom, nikdy nuly', () => {
    /* Efekty pri statickom renderi nebežia, takže `kpi === null`. */
    expect(html).toContain('data-kpi-gap="not_loaded"');
    expect(html).toContain('zatiaľ nenačítané');
    // Nula je tvrdenie o predaji a o sklade; pri nenačítanom KPI ho appka nemá.
    const facts = html.slice(html.indexOf('data-testid="detail-kpi-facts"'));
    const group = facts.slice(0, facts.indexOf('</dl>'));
    expect(group).not.toMatch(/>0 kusov</);
    expect(group).not.toMatch(/>0,00 €</);
  });

  it('riadky spoza kľúča sú „zatiaľ nenačítané", nie „nemá" a nie nula', () => {
    const start = html.indexOf('data-testid="detail-locked"');
    const group = html.slice(start, html.indexOf('</dl>', start));
    expect(group).toContain('data-absence="pending"');
    expect(group).not.toContain('data-absence="none"');
    expect(group).not.toMatch(/>0</);
  });

  it('čas merania podrobností má štyri stavy a ani v jednom sa nevymyslí', () => {
    expect(keyedMeasuredNote(undefined)).toContain('načítavajú');
    expect(keyedMeasuredNote(undefined)).not.toMatch(/\d{4}/);

    const bezKluca = keyedMeasuredNote(extraOf({ keyed: null }));
    expect(bezKluca).toContain('nedovidí');
    expect(bezKluca).not.toMatch(/\d{4}/);

    const bezCasu = keyedMeasuredNote(extraOf({ at: '' }));
    expect(bezCasu).toContain('bez času merania');
    expect(bezCasu).not.toMatch(/\d{4}/);

    const zmerane = keyedMeasuredNote(extraOf());
    expect(zmerane).toContain('2026');
    expect(zmerane).toContain('nie je to stav v tejto sekunde');
    // Konkrétny čas, nikdy „pred chvíľou" (bod 5 hlavičky panela).
    expect(zmerane).toMatch(/\d{1,2}:\d{2}/);
  });

  it('čas merania variantov nemá stav „nedovidíme" — verejná cesta ich dá', () => {
    /*
     * Varianty dá aj `products/get` bez kľúča, takže veta o chýbajúcom kľúči
     * by tu bola nepravdivá. Preto dve funkcie a nie jedna s parametrom.
     */
    expect(variantsMeasuredNote(extraOf({ keyed: null }))).toContain('2026');
    expect(variantsMeasuredNote(undefined)).toContain('načítavajú');
    expect(variantsMeasuredNote(extraOf({ at: '' }))).toContain('bez času merania');
    expect(variantsMeasuredNote(extraOf({ at: '' }))).not.toMatch(/\d{4}/);
  });

  it('prázdna skupina variantov čas merania NESTRÁCA', () => {
    /*
     * Vetva bez zoznamu je práve tá, v ktorej by sa veta stratila najľahšie —
     * preto ju kreslí `ProductVariants`, nie panel.
     */
    for (const extra of [undefined, extraOf({ variants: [] })]) {
      const kus = renderToStaticMarkup(createElement(ProductVariants, { extra }));
      expect(kus).toContain('detail-variants-measured');
    }
  });
});
