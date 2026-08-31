/**
 * Aura Zľavy — tab Produkty (V10; kontrakt V3 K7–K10, architektúra §1 a §5).
 *
 * Dôkaz, nie report agenta (pasca z CLAUDE.md). Testuje sa to, čo sa dá na
 * obrazovke pokaziť ticho:
 *
 *  A. **Filter je serializovateľný a odolný.** Odkaz z Prehľadu aj uložený
 *     filter idú cez `parseCatalogFilter()`; nezmyselná hodnota v adrese
 *     nesmie obrazovku zhodiť ani ticho zmeniť význam (napr. na iné okno).
 *  B. **Hromadný výber posiela FILTER, nie desaťtisíce čísel.** Adresa novej
 *     zľavy má pri „vybrať všetkých" tvar `?filter=…&pocet=…`.
 *  C. **Zamknuté filtre sú vidieť** (K8) — kategória, kov, typ šperku, marža,
 *     obrátkovosť aj sklad sa vykreslia sivé, so štítkom, nie skryté.
 *  D. **Číslo produktu nie je hlavný stĺpec** (P3) — v tabuľke sa nevyskytuje,
 *     žije až v rozkliku „Technický detail" bočného panela.
 *  E. **Tržby eshopu na tejto obrazovke nie sú** (hranica z architektúry §1).
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Efekty klienta sa pri statickom renderi nespúšťajú, takže test meria
 * značky a texty, nie načítanie dát.
 *
 * Vlastník: V10 (testovú sadu ako celok vlastní V14).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CatalogFilters from '@/components/products/CatalogFilters';
import CatalogPanel from '@/components/products/CatalogPanel';
import CatalogTable, { pageTokens } from '@/components/products/CatalogTable';
import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import SelectionBar from '@/components/products/SelectionBar';
import {
  catalogFilterKey,
  catalogSearchQuery,
  DEFAULT_CATALOG_FILTER,
  newDiscountHref,
  parseCatalogFilter,
  parseCatalogFilterQuery,
  priceParam,
} from '@/components/products/catalog-filter';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

/** Prvý riadok kanonickej vzorky z architektúry §3.5. */
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
  // I11 — predvolene zo zrkadla katalógu.
  origin: 'mirror' as const,
};

const LOCKED = {
  stock: { locked: true as const, requested: false },
  turnover: { locked: true as const, requested: false },
  category: { locked: true as const, requested: false },
  metal: { locked: true as const, requested: false },
  jewelryType: { locked: true as const, requested: false },
  margin: { locked: true as const, requested: false },
};

const COUNTS = {
  total: 40483,
  sold: { none: 11640, low: 7564, mid: 12918, high: 8361 },
  neverDiscounted: 21049,
  discountedNow: 2380,
  shopDiscountedNow: 311,
  enrichedRows: 1204,
  soldWindowDays: 30,
};

/* ═════════════════════════ A. Filter v adrese ═════════════════════════════ */

describe('V10 — filter katalógu prežije cestu cez adresu', () => {
  it('predvolené okno je 30 dní a posiela sa vždy explicitne', () => {
    // Repozitár má vlastný default 180; keby sa okno neposielalo, obrazovka by
    // ukazovala iné číslo, než má napísané pri prepínači.
    expect(DEFAULT_CATALOG_FILTER.soldWindowDays).toBe(30);
    expect(catalogSearchQuery(DEFAULT_CATALOG_FILTER)).toContain('soldWindowDays=30');
  });

  it('adresa → filter → adresa nestratí ani nepridá podmienku', () => {
    const parsed = parseCatalogFilter({
      q: 'lumen',
      soldWindowDays: '180',
      soldBuckets: 'none,low',
      priceFrom: '10',
      priceTo: '40,50',
      neverDiscounted: '1',
      page: '3',
      perPage: '100',
    });
    expect(parsed.soldWindowDays).toBe(180);
    expect(parsed.soldBuckets).toEqual(['none', 'low']);
    expect(parsed.perPage).toBe(100);
    expect(parsed.page).toBe(3);

    const key = catalogFilterKey(parsed);
    expect(key).not.toContain('page=');
    const back = parseCatalogFilterQuery(key);
    expect(back.query).toBe('lumen');
    expect(back.soldBuckets).toEqual(['none', 'low']);
    expect(back.priceTo).toBe('40.50');
    expect(back.neverDiscounted).toBe(true);
  });

  it('`shopDiscounted` prežije cestu cez adresu pod tým istým menom ako v API', () => {
    // Meno parametra je kontrakt medzi adresou obrazovky a `GET /api/catalog/search`
    // (D116). Iné meno na klientovi by znamenalo preklad, a teda druhý slovník.
    const parsed = parseCatalogFilter({ shopDiscounted: '1' });
    expect(parsed.shopDiscounted).toBe(true);
    // …a je to DRUHÁ veta než vlastné zápisy, nie ich prepis.
    expect(parsed.currentlyDiscounted).toBe(false);

    const query = catalogSearchQuery(parsed);
    expect(query).toContain('shopDiscounted=1');
    expect(parseCatalogFilterQuery(query).shopDiscounted).toBe(true);

    // Vypnutý filter sa NEPOSIELA — prázdny parameter drží adresy krátke.
    expect(catalogSearchQuery(DEFAULT_CATALOG_FILTER)).not.toContain('shopDiscounted');
  });

  it('nezmysel v adrese spadne na predvolenú hodnotu, nikdy na výnimku', () => {
    const parsed = parseCatalogFilter({
      soldWindowDays: 'x',
      perPage: '7',
      page: '-2',
      soldBuckets: 'zzz',
    });
    expect(parsed.soldWindowDays).toBe(30);
    expect(parsed.perPage).toBe(50);
    expect(parsed.page).toBe(1);
    expect(parsed.soldBuckets).toEqual([]);
  });

  it('cena s čiarkou ide do API s bodkou, nezmysel odpadne', () => {
    expect(priceParam('12,50')).toBe('12.50');
    expect(priceParam('  ')).toBeNull();
    expect(priceParam('asi tridsať')).toBeNull();
  });
});

/* ═══════════════ B. Hromadný výber posiela filter, nie zoznam ═════════════ */

describe('V10 — odovzdanie výberu do novej zľavy', () => {
  it('naklikané riadky idú ako zoznam čísel', () => {
    expect(newDiscountHref({ kind: 'products', productIds: [18342, 21170] })).toContain(
      '/zlavy/nova?produkty=',
    );
  });

  it('„vybrať všetkých" posiela filter a počet, nie desaťtisíce čísel', () => {
    const href = newDiscountHref({
      kind: 'filter',
      filter: { ...DEFAULT_CATALOG_FILTER, soldWindowDays: 180 },
      total: 11640,
    });
    expect(href).toContain('filter=');
    expect(href).toContain('pocet=11640');
    expect(href).not.toContain('produkty=');
    // Stránkovanie do zľavy nepatrí — zľava nie je stránka tabuľky.
    expect(href).not.toContain('page');
  });

  it('stránkovač nevypíše 233 čísel', () => {
    expect(pageTokens(1, 3)).toEqual([1, 2, 3]);
    expect(pageTokens(50, 233)).toEqual([1, 2, 'gap', 49, 50, 51, 'gap', 233]);
  });
});

/* ═══════════════════════ C–E. Čo obrazovka ukáže ══════════════════════════ */

describe('V10 — obrazovka Produkty', () => {
  it('zamknuté filtre sú viditeľné a sivé, nie skryté (K8)', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogFilters, {
        filter: DEFAULT_CATALOG_FILTER,
        counts: COUNTS,
        lockedFilters: LOCKED,
        saved: [],
        activeSaved: null,
        open: false,
        onChange: () => {},
        onApplySaved: () => {},
        onRemoveSaved: () => {},
      }),
    );
    for (const label of ['Kategória', 'Kov', 'Typ šperku', 'Marža', 'Obrátkovosť', 'Sklad']) {
      expect(html, `zamknutý filter ${label}`).toContain(label);
    }
    expect(html).toContain('fopt locked');
    expect(html).toContain('Čaká na dáta zo shopu');
    // Čísla pri možnostiach sú merané, takže bez značky odhadu (P7).
    expect(html).toContain('11 640');
    expect(html).not.toContain('≈');
  });

  it('tabuľka ukazuje kusy a ceny, nie číslo produktu (P3)', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, {
        rows: [ROW],
        soldWindowDays: 30,
        total: 11640,
        page: 1,
        perPage: 50 as const,
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
    expect(html).toContain('Strieborné náušnice Lumen');
    expect(html).toContain('34,90 €');
    expect(html).toContain('Predané 30 d');
    expect(html).toContain('11 640');
    expect(html).not.toContain('>18342<');
  });

  it('lišta výberu rozlišuje stránku od celého filtra', () => {
    const html = renderToStaticMarkup(
      createElement(SelectionBar, {
        pageSelected: 11,
        totalSelected: 11,
        matching: 11640,
        maxProducts: 10000,
        allMatchingSelected: false,
        discountHref: '/zlavy/nova?produkty=18342',
        onSelectAllMatching: () => {},
        onClear: () => {},
        onSaveFilter: () => {},
      }),
    );
    expect(html).toContain('vybraných na tejto stránke');
    expect(html).toContain('Vybrať všetkých 11 640');
    expect(html).toContain('do jednej zľavy sa zmestí 10 000');
    expect(html).toContain('Zlacniť');
  });

  it('detail produktu drží číslo a stav v shope pod rozklikom (P6)', () => {
    const html = renderToStaticMarkup(
      createElement(ProductDetailPanel, { row: ROW, soldWindowDays: 30, onClose: () => {} }),
    );
    expect(html).toContain('Technický detail');
    expect(html).toContain('18342');
    // Marža a kategória sú priznané ako chýbajúce, nie dopočítané (K8).
    expect(html).toContain('lockcell');
    expect(html).toContain('Marža');
  });

  it('obrazovka má panel filtrov, rám tabuľky a jeden riadok o čerstvosti dát', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogPanel, { initialFilter: DEFAULT_CATALOG_FILTER }),
    );
    expect(html).toContain('layout-filters');
    expect(html).toContain('tbl-frame');
    // Bez načítaných dát sa čerstvosť NEODHADUJE — obrazovka to povie (P7).
    expect(html).toContain('Katalóg sa zatiaľ nenačítal.');
    expect(html.match(/class="fresh"/g)?.length ?? 0).toBe(1);
    // Hranica z architektúry §1: tržby eshopu sem nepatria. Ceny áno — cena je
    // vlastnosť produktu, tržba je súčet za eshop a ten patrí do Prehľadu.
    expect(html).not.toMatch(/tržb/i);
    expect(html).not.toMatch(/objednáv/i);
  });
});
