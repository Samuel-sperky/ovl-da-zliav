/**
 * Aura Zľavy — VARIANTY A ÚDAJE SPOZA KĽÚČA V PANELI DETAILU (C2, vlna 3).
 *
 * Zadanie znie doslova: „potrebujem zobraziť všetko čo je možné z endpointov."
 * Endpointy vedia dve rôzne veci a rozdiel medzi nimi je celý zmysel tohto
 * testu:
 *
 *  · verejný `products/get` dá KAŽDÉMU VARIANTU `reference`, `ean13`
 *    a `quantity` — teda kód a sklad BEZ oprávnenia,
 *  · `products/getFull` za `product:read` dá tie isté polia na úrovni produktu
 *    plus nákupnú cenu, maržu, dodávateľa a kategórie.
 *
 * ČO SA TU DOKAZUJE (a čo by sa inak pokazilo ticho)
 * ──────────────────────────────────────────────────
 *
 *  A. **Tri prázdna sa nezlejú.** `pending` (nepýtali sme sa) · `locked`
 *     (chýba kľúč) · `none` (shop to o kuse nevedie) majú tri RÔZNE slová
 *     a tri rôzne značky. Keby sa zliali, používateľ by nevedel, či má počkať,
 *     vypýtať si kľúč, alebo či taký údaj neexistuje — a to je jediné, čo ho
 *     pri prázdnej bunke zaujíma. Meria sa cez `data-absence`, lebo to je ten
 *     istý atribút, ktorý nesie aj slovo.
 *  B. **`quantity: 0` je platná nula.** „Vypredané" je meraný fakt, nie
 *     chýbajúci údaj — a je to presne tá zámena, ktorú `?? 0` spraví v jednom
 *     riadku kódu.
 *  C. **Súčet skladu je celok, alebo nič.** Jeden variant bez množstva a súčet
 *     sa NEUKÁŽE; nižšie číslo vydávané za celok je horšie než pomlčka.
 *  D. **Zamknuté sa NEVYNECHÁVA a NEVYSVETĽUJE.** Riadok tam je aj bez
 *     hodnoty (inak by sa nedalo zistiť, že taký údaj existuje), ale
 *     vysvetlenie „prečo" tu nie je — vedie odtiaľto odkaz na jediné miesto
 *     (Nastavenia → Zamknuté funkcie, kontrakt bod 18).
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna sieť. Efekty
 * pri statickom renderi nebežia, takže panel je presne v tom stave, v akom ho
 * používateľ vidí v prvom okamihu: všetko doťahované je `pending`.
 *
 * Vlastník: C2, vlna 3 (majster/detail), 20. 8. 2026.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import ProductVariants, { variantStockTotal } from '@/components/products/ProductVariants';
import type { CatalogRowView } from '@/components/products/catalog-api';
import type {
  ProductExtraView,
  ProductVariantView,
} from '@/components/products/product-extras';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const ROW: CatalogRowView = {
  productId: 18342,
  name: 'Strieborné náušnice Lumen, kubický zirkón',
  price: '34.90',
  hasAttributes: true,
  shopStatus: 'ok',
  unitsSold: 4,
  everDiscounted: false,
  discountedNow: false,
  fetchedAt: '2026-08-10T01:00:00.000Z',
  origin: 'mirror',
};

const variant = (over: Partial<ProductVariantView>): ProductVariantView => ({
  variantId: 1,
  reference: 'LUM-52',
  ean13: '8586001234567',
  quantity: 3,
  priceImpact: null,
  values: ['Veľkosť: 52'],
  ...over,
});

const extraOf = (over: Partial<ProductExtraView>): ProductExtraView => ({
  productId: ROW.productId,
  description: null,
  shortDescription: null,
  variants: [variant({})],
  keyed: null,
  at: '2026-08-20T10:00:00.000Z',
  ...over,
});

const renderVariants = (extra: ProductExtraView | undefined): string =>
  renderToStaticMarkup(createElement(ProductVariants, { extra }));

const renderPanel = (row: CatalogRowView = ROW): string =>
  renderToStaticMarkup(
    createElement(ProductDetailPanel, { row, soldWindowDays: 30, onClose: () => {} }),
  );

/** Ktoré z troch prázdien bunka priznáva — v poradí, v akom sú v značke. */
const absences = (html: string): string[] =>
  [...html.matchAll(/data-absence="([a-z]+)"/g)].map((match) => match[1] ?? '');

/* ═════════════ A. Varianty nesú kód, EAN a sklad bez kľúča ════════════════ */

describe('varianty v paneli detailu', () => {
  it('vypíšu kód, EAN aj sklad tak, ako prišli zo shopu', () => {
    const html = renderVariants(extraOf({}));
    expect(html).toContain('Veľkosť: 52');
    expect(html).toContain('LUM-52');
    expect(html).toContain('8586001234567');
    // Sklad je hodnota, nie prázdno — variant o ňom povedal.
    expect(html).toContain('>3<');
  });

  it('variant bez mena dostane poradie, nie prázdny riadok', () => {
    const html = renderVariants(extraOf({ variants: [variant({ values: [] })] }));
    expect(html).toContain('variant 1');
  });

  it('sklad 0 je „vypredané", nikdy prázdno (B)', () => {
    const html = renderVariants(extraOf({ variants: [variant({ quantity: 0 })] }));
    expect(html).toContain('vypredané');
    // Nula je tvrdenie, ktoré shop urobil — nesmie sa preložiť na chýbajúci údaj.
    expect(absences(html)).toEqual([]);
  });

  it('údaj, ktorý shop o variante nevedie, je „nemá" — nie prázdna bunka (A)', () => {
    const html = renderVariants(
      extraOf({ variants: [variant({ reference: null, ean13: null })] }),
    );
    expect(absences(html)).toEqual(['none', 'none']);
    expect(html).toContain('nemá');
  });

  it('kým sa detail nedoťahal, je to „zatiaľ nenačítané" — nie „nemá" (A)', () => {
    const html = renderVariants(undefined);
    expect(absences(html)).toEqual(['pending']);
    expect(html).toContain('zatiaľ nenačítané');
    expect(html).not.toContain('nemá');
  });

  it('kus, ktorý varianty naozaj nemá, to povie slovom', () => {
    expect(absences(renderVariants(extraOf({ variants: [] })))).toEqual(['none']);
  });
});

/* ═════════════ C. Súčet skladu je celok, alebo nič ════════════════════════ */

describe('sklad cez varianty', () => {
  it('sčíta sa len vtedy, keď množstvo povedal KAŽDÝ variant', () => {
    expect(
      variantStockTotal([variant({ variantId: 1, quantity: 3 }), variant({ variantId: 2, quantity: 4 })]),
    ).toBe(7);
    // Nula sa počíta ako hodnota, nie ako chýbajúci variant.
    expect(variantStockTotal([variant({ quantity: 0 })])).toBe(0);
  });

  it('jeden variant bez množstva a súčet sa NEUKÁŽE (C)', () => {
    expect(
      variantStockTotal([variant({ variantId: 1, quantity: 3 }), variant({ variantId: 2, quantity: null })]),
    ).toBeNull();
    expect(variantStockTotal([])).toBeNull();
  });

  it('nepovedaný súčet je v paneli pomlčka so slovom, nie nula', () => {
    const html = renderVariants(
      extraOf({ variants: [variant({ variantId: 1 }), variant({ variantId: 2, quantity: null })] }),
    );
    expect(html).toContain('sklad spolu');
    expect(html).not.toMatch(/sklad\s*spolu[^<]*<b/);
  });
});

/* ═════════════ D. Skupina spoza kľúča ═════════════════════════════════════ */

describe('údaje spoza oprávnenia product:read', () => {
  const html = renderPanel();

  it('všetko, čo `getFull` dá, má v paneli svoj riadok', () => {
    for (const label of [
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
    ]) {
      expect(html, `riadok ${label} sa nekreslí`).toContain(label);
    }
  });

  it('kým sa detail nedoťahal, nehovorí sa „nemá" ani „zamknuté" (A)', () => {
    // Efekty pri statickom renderi nebežia — appka sa teda ešte nepýtala.
    const kinds = new Set(absences(html));
    expect(kinds.has('pending')).toBe(true);
    expect(kinds.has('none')).toBe(false);
  });

  it('nadpis skupiny nesľubuje hodnoty, ktoré appka nemá', () => {
    expect(html).toContain('Zatiaľ nedostupné');
    expect(html).not.toContain('Podrobnosti z eshopu');
  });

  it('vysvetlenie „prečo" tu nie je, je naň jediný odkaz (D, bod 18)', () => {
    expect(html.match(/\/nastavenia#zamknute/g)?.length ?? 0).toBe(1);
    expect(html).not.toMatch(/oprávneni/i);
    expect(html).not.toContain('product:read');
  });

  it('skupina variantov sa pri kuse bez variantov vôbec nekreslí', () => {
    const bez = renderPanel({ ...ROW, hasAttributes: false });
    expect(bez).not.toContain('detail-variants');
    // …ale fakt „bez variantov" zostáva, nemizne s ňou.
    expect(bez).toContain('bez variantov');
  });
});
