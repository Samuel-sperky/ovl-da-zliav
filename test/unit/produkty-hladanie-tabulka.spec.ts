/**
 * Aura Zľavy — HĽADANIE A TABUĽKA (kontrakt produktov A1–A2, kontrakt UI 8,
 * 17, 19, 25–28).
 *
 * Dôkaz o štyroch veciach, ktoré sa na tejto obrazovke dajú pokaziť ticho:
 *
 *  A. **Počet zhôd je pri neúplnom zrkadle DOLNÁ HRANICA.** `total` z API je
 *     počet v zrkadle, nie v eshope. Bez značky `≈` je to tvrdenie, ktoré
 *     appka nemá kryté (P7). Neistota sa nesmie stratiť ani vtedy, keď sa stav
 *     katalógu nepodarilo zistiť — vtedy `≈` OSTÁVA.
 *  B. **Dohľadanie v eshope je ponuka, nie automat.** Je dostupné vždy, keď je
 *     v hľadaní text — teda aj keď zrkadlo niečo našlo — a nikdy sa nespustí
 *     samo: míňa anonymný rozpočet čítaní.
 *  C. **Poradie nie je otázka.** Predvolené je najdrahšie prvé (bod 19), do
 *     kľúča filtra ani do odkazu na novú zľavu ale nevstupuje — inak by
 *     preklik stĺpca zrušil naklikaný výber (bod 17).
 *  D. **Výber prežije prechod medzi tabmi** (bod 17), ale len k tej istej
 *     otázke; odkaz z Prehľadu má prednosť pred pamäťou.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Efekty klienta sa pri statickom renderi nespúšťajú, takže test meria
 * značky a texty, nie načítanie dát.
 *
 * Vlastník: V15 (hľadanie a tabuľka).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import CatalogPanel from '@/components/products/CatalogPanel';
import CatalogTable, { nextSort, sortDirection } from '@/components/products/CatalogTable';
import {
  catalogFilterKey,
  catalogSearchQuery,
  DEFAULT_CATALOG_FILTER,
  newDiscountHref,
  parseCatalogFilter,
  parseCatalogFilterQuery,
} from '@/components/products/catalog-filter';
import {
  forgetSelection,
  readSelection,
  restoreSelection,
  writeSelection,
  type StoredSelection,
} from '@/components/products/catalog-selection';

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

/** Spoločné povinné vlastnosti tabuľky — test mení vždy len to podstatné. */
const TABLE = {
  rows: [ROW],
  soldWindowDays: 30,
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
};

/* ═════════════ A. Počet zhôd je dolná hranica, kým zrkadlo nie je celé ════ */

describe('V15 — počet zhôd nad neúplným zrkadlom', () => {
  it('pätka označí počet `≈` a bez tučného, kým je zrkadlo neúplné (P7)', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, { ...TABLE, total: 11640, totalIsLowerBound: true }),
    );
    expect(html).toContain('≈ 11 640');
    // Merané číslo je tučné; odhad nesmie mať ten istý štýl.
    expect(html).not.toContain('<b class="num">11 640</b>');
  });

  it('nad úplným zrkadlom je počet meraný fakt, teda bez značky', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, { ...TABLE, total: 11640, totalIsLowerBound: false }),
    );
    expect(html).toContain('<b class="num">11 640</b>');
    expect(html).not.toContain('≈');
  });

  it('nula sa neoznačuje — „≈ 0" nie je odhad', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, { ...TABLE, rows: [], total: 0, totalIsLowerBound: true }),
    );
    expect(html).not.toContain('≈');
  });

  it('obrazovka bez zisteného stavu katalógu značku NEZAHADZUJE (fail-closed)', () => {
    // Statický render = nič sa nenačítalo, teda ani stav katalógu. Neistota sa
    // nemá ako vyvrátiť, takže obrazovka ostáva pri odhade.
    const html = renderToStaticMarkup(
      createElement(CatalogPanel, { initialFilter: DEFAULT_CATALOG_FILTER }),
    );
    expect(html).toContain('Počet v načítaných riadkoch — v eshope ich môže byť viac.');
    // Kým nie je načítaný ani jeden riadok, je tam POMLČKA, nie nula (bod 5).
    expect(html).toMatch(/data-testid="catalog-matching"[^>]*>—/);
    expect(html).not.toContain('z 0 načítaných');
  });
});

/* ═══════════════ B. Dohľadanie v eshope je ponuka, nie automat ════════════ */

describe('V15 — dohľadanie v eshope', () => {
  it('pole hľadania priznáva číslo aj kód produktu', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogPanel, { initialFilter: DEFAULT_CATALOG_FILTER }),
    );
    expect(html).toContain('Hľadať názov, číslo alebo kód produktu');
    expect(html).toContain('kód nájde eshop');
  });

  it('bez textu v hľadaní sa dohľadanie neponúka — nie je čo hľadať', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogPanel, { initialFilter: DEFAULT_CATALOG_FILTER }),
    );
    expect(html).not.toContain('Dohľadať v eshope');
  });

  it('s textom je ponuka pri poli, a to aj keď zrkadlo NIEČO našlo', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogPanel, {
        initialFilter: { ...DEFAULT_CATALOG_FILTER, query: 'lumen' },
      }),
    );
    expect(html).toContain('Dohľadať v eshope');
    // Presne jedna ponuka na obrazovke — druhé rovnaké tlačidlo v prázdnom
    // stave by bolo len šum pár centimetrov pod prvým.
    expect(html.match(/Dohľadať v eshope/g)?.length ?? 0).toBe(1);
    expect(html).toContain('Prehľadá celý eshop — názov, popis, kód aj kategórie.');
  });
});

/* ═════════════════════════ C. Poradie riadkov ═════════════════════════════ */

describe('V15 — triedenie', () => {
  it('predvolené je najdrahšie prvé a tabuľka ho posiela explicitne (bod 19)', () => {
    // Repozitár má vlastný default `name`, takže bez tohto parametra by
    // obrazovka ukazovala iné poradie, než má napísané v hlavičke stĺpca.
    expect(DEFAULT_CATALOG_FILTER.sort).toBe('price_desc');
    expect(catalogSearchQuery(DEFAULT_CATALOG_FILTER, { sorting: true })).toContain(
      'sort=price_desc',
    );
    // Ten istý reťazec bez výslovnej žiadosti poradie NENESIE — inde v appke
    // znamená otázku, nie pohľad.
    expect(catalogSearchQuery(DEFAULT_CATALOG_FILTER)).not.toContain('sort=');
  });

  it('poradie nevstupuje do kľúča filtra ani do odkazu na novú zľavu', () => {
    const cheapFirst = { ...DEFAULT_CATALOG_FILTER, sort: 'price_asc' as const };
    // Tá istá otázka, iné poradie — kľúč musí zostať rovnaký, inak by preklik
    // stĺpca zrušil naklikaný výber (bod 17).
    expect(catalogFilterKey(cheapFirst)).toBe(catalogFilterKey(DEFAULT_CATALOG_FILTER));
    expect(catalogFilterKey(cheapFirst)).not.toContain('sort=');

    const href = newDiscountHref({ kind: 'filter', filter: cheapFirst, total: 11640 });
    expect(decodeURIComponent(href)).not.toContain('sort=');
  });

  it('neznáme poradie v adrese spadne na predvolené, nikdy na výnimku', () => {
    expect(parseCatalogFilter({ sort: 'podla_naladi' }).sort).toBe('price_desc');
    expect(parseCatalogFilter({ sort: 'sold_asc' }).sort).toBe('sold_asc');
    expect(parseCatalogFilterQuery('sort=name').sort).toBe('name');
  });

  it('druhý klik na stĺpec otočí smer, prvý ponúkne to, čo sa hľadá', () => {
    // Pri cene sa hľadá najdrahšie, pri predaných NAJMENEJ predané — obrazovka
    // slúži na hľadanie ležiakov.
    expect(nextSort('price', 'name')).toBe('price_desc');
    expect(nextSort('price', 'price_desc')).toBe('price_asc');
    expect(nextSort('sold', 'price_desc')).toBe('sold_asc');
    expect(nextSort('sold', 'sold_asc')).toBe('sold_desc');
  });

  it('hlavička hovorí, podľa čoho sa triedi', () => {
    expect(sortDirection('price', 'price_desc')).toBe('descending');
    expect(sortDirection('price', 'price_asc')).toBe('ascending');
    expect(sortDirection('sold', 'price_desc')).toBe('none');

    const html = renderToStaticMarkup(
      createElement(CatalogTable, {
        ...TABLE,
        total: 1,
        sort: 'price_desc' as const,
        onSort: () => {},
      }),
    );
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('data-testid="sort-price"');
  });

  it('bez obsluhy sa hlavička nekreslí ako tlačidlo', () => {
    const html = renderToStaticMarkup(createElement(CatalogTable, { ...TABLE, total: 1 }));
    expect(html).toContain('Cena');
    expect(html).not.toContain('data-testid="sort-price"');
  });
});

/* ═══════════════ D. Výber prežije prechod medzi tabmi (bod 17) ════════════ */

const NARROWED = { ...DEFAULT_CATALOG_FILTER, neverDiscounted: true };

function stored(filter: typeof DEFAULT_CATALOG_FILTER, ids: number[]): StoredSelection {
  return { filter: catalogFilterKey(filter), productIds: ids, allMatching: false };
}

describe('V15 — výber sa drží, kým ho človek nezruší', () => {
  it('tá istá otázka výber vráti', () => {
    const out = restoreSelection(NARROWED, stored(NARROWED, [18342, 21170]));
    expect(out.productIds).toEqual([18342, 21170]);
    expect(catalogFilterKey(out.filter)).toBe(catalogFilterKey(NARROWED));
  });

  it('prázdna adresa vráti aj otázku — výber bez nej ukazuje na neviditeľné riadky', () => {
    const out = restoreSelection(DEFAULT_CATALOG_FILTER, stored(NARROWED, [18342]));
    expect(out.filter.neverDiscounted).toBe(true);
    expect(out.productIds).toEqual([18342]);
    // Stránka a poradie do otázky nepatria: vraciame sa k otázke, nie k strane.
    expect(out.filter.page).toBe(1);
    expect(out.filter.sort).toBe(DEFAULT_CATALOG_FILTER.sort);
  });

  it('odkaz z Prehľadu má prednosť pred pamäťou a výber zahodí', () => {
    const fromLink = { ...DEFAULT_CATALOG_FILTER, soldWindowDays: 180 as const };
    const out = restoreSelection(fromLink, stored(NARROWED, [18342]));
    expect(out.productIds).toEqual([]);
    expect(out.allMatching).toBe(false);
    expect(out.filter.soldWindowDays).toBe(180);
  });

  it('hromadný výber sa ukladá ako príznak, nie ako desaťtisíce čísel', () => {
    const out = restoreSelection(NARROWED, {
      filter: catalogFilterKey(NARROWED),
      productIds: [],
      allMatching: true,
    });
    expect(out.allMatching).toBe(true);
    expect(out.productIds).toEqual([]);
  });

  it('prázdna pamäť nie je chyba', () => {
    const out = restoreSelection(NARROWED, null);
    expect(out.productIds).toEqual([]);
    expect(out.filter).toBe(NARROWED);
  });
});

/* ─────────────────── Úložisko: cudzí obsah nesmie zhodiť render ─────────── */

type WindowLike = { sessionStorage: Storage };

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

function withWindow(store: Storage): () => void {
  const holder = globalThis as unknown as { window?: WindowLike };
  const before = holder.window;
  holder.window = { sessionStorage: store };
  return () => {
    if (before === undefined) delete holder.window;
    else holder.window = before;
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('V15 — pamäť výberu', () => {
  it('uložený výber sa prečíta späť a zabudnutie ho zmaže', () => {
    const store = fakeStorage();
    restore = withWindow(store);

    writeSelection({ filter: 'x=1', productIds: [18342], allMatching: false });
    expect(readSelection()).toEqual({ filter: 'x=1', productIds: [18342], allMatching: false });

    forgetSelection();
    expect(readSelection()).toBeNull();
  });

  it('prázdny výber sa neukladá — zapamätaná nula by prežila svoju platnosť', () => {
    const store = fakeStorage();
    restore = withWindow(store);

    writeSelection({ filter: 'x=1', productIds: [18342], allMatching: false });
    writeSelection({ filter: 'x=1', productIds: [], allMatching: false });
    expect(readSelection()).toBeNull();
  });

  it('cudzí alebo poškodený obsah je prázdno, nie výnimka', () => {
    const store = fakeStorage();
    restore = withWindow(store);

    store.setItem('aura.produkty.vyber.v1', '{"filter":1}');
    expect(readSelection()).toBeNull();

    store.setItem('aura.produkty.vyber.v1', 'toto nie je JSON');
    expect(readSelection()).toBeNull();

    store.setItem(
      'aura.produkty.vyber.v1',
      JSON.stringify({ filter: 'x=1', productIds: ['18342'], allMatching: false }),
    );
    expect(readSelection()).toBeNull();
  });

  it('bez úložiska obrazovka beží ďalej', () => {
    // V serverovom prostredí `window` neexistuje — čítanie ani zápis nesmú
    // spadnúť, len nič neurobia.
    expect(readSelection()).toBeNull();
    expect(() => writeSelection({ filter: 'x=1', productIds: [1], allMatching: false })).not.toThrow();
    expect(() => forgetSelection()).not.toThrow();
  });
});
