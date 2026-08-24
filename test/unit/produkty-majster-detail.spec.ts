/**
 * Aura Zľavy — MAJSTER/DETAIL NA TABE PRODUKTY (rozhodnutie K1, vlna 3, C1).
 *
 * Do 20. 8. 2026 bol `ProductDetailPanel` `position: fixed` prekryv, ktorý
 * visel MIMO mriežky obrazovky a zakrýval pravú tretinu tabuľky. Kto
 * porovnával dva kusy, musel panel zavrieť, nájsť riadok, ktorý bol pod ním,
 * a otvoriť ho znova. K1 hovorí, že appka je pracovný nástroj: tabuľka vľavo,
 * detail kusu vpravo ako druhý stĺpec.
 *
 * Prečo to má vlastný súbor a čo presne stráži
 * ────────────────────────────────────────────
 * Rozloženie je z veľkej časti CSS, takže statický render sám o sebe nič
 * neustráži — `renderToStaticMarkup` prekryv od stĺpca nerozozná. Merajú sa
 * preto tri veci, každá tam, kde sa dá pokaziť:
 *
 *  A. **Panel je V mriežke.** Obrazovka ho kreslí vnútri `.catalog-split`,
 *     teda ako súrodenca tabuľky — nie ako prívesok za celým rozložením.
 *     Návrat do „za všetkým" je presne tá regresia, ktorú K1 zakazuje.
 *  B. **CSS panel odprekrýva.** V `.catalog-split` je `position: static`
 *     a rad sa zalamuje (`flex-wrap`). Zalomenie je celá odpoveď na 720 px:
 *     keď na tabuľku aj panel prestane byť miesto, panel spadne POD tabuľku
 *     a prekryv sa nevracia.
 *  C. **Riadok vie, že je otvorený.** Trvalý stĺpec bez väzby na riadok by
 *     ukazoval kus, ktorý sa v päťdesiatich ďalších nedá nájsť. Značka ide
 *     dvoma kanálmi — trieda `open` (prúžok, nie iba farba) a `aria-current`.
 *
 * Vlastník: C1.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CatalogPanel from '@/components/products/CatalogPanel';
import CatalogTable from '@/components/products/CatalogTable';
import ProductDetailPanel from '@/components/products/ProductDetailPanel';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../src/components/products/CatalogPanel.tsx');
const CSS = read('../../src/app/globals.css');

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

/** Najdlhší názov v reálnom katalógu k 19. 8. 2026 — 117 znakov (D10). */
const NAJDLHSI_NAZOV =
  'Prevliekací strieborný náhrdelník 925 - kruh s čírymi a modrými zirkónmi, ' +
  'nepriehľadný kvietok z tyrkysových zirkónov';

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

const INY_ROW = { ...ROW, productId: 19001, name: NAJDLHSI_NAZOV };

const TABLE = {
  rows: [ROW, INY_ROW],
  soldWindowDays: 30,
  total: 2,
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

/** Blok pravidiel jedného selektora z `globals.css`, aj s komentármi. */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `selektor ${selector} v globals.css chýba`).toBeGreaterThan(-1);
  const end = CSS.indexOf('}', start);
  return CSS.slice(start, end);
}

/* ═══════════════ A. Panel stojí v mriežke, nie za ňou ═════════════════════ */

describe('K1 — detail je stĺpec vedľa tabuľky', () => {
  it('obrazovka kreslí panel vnútri `.catalog-split`, nie za celým rozložením', () => {
    const split = PANEL.indexOf('className="catalog-split"');
    const detail = PANEL.indexOf('<ProductDetailPanel');
    // Chybová vetva `catalog-error` je koniec bloku s tabuľkou; panel musí
    // stáť pred ňou, teda vnútri toho istého `<div className="catalog-split">`.
    const koniecBloku = PANEL.indexOf('data-testid="catalog-error"');

    expect(split).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(split);
    expect(detail).toBeLessThan(koniecBloku);
    // Jediné miesto, kde sa panel kreslí — druhý výskyt by znamenal, že starý
    // prekryv za rozložením zostal žiť vedľa nového stĺpca.
    expect(PANEL.match(/<ProductDetailPanel/g)?.length ?? 0).toBe(1);
  });

  it('bez otvoreného riadku stĺpec neexistuje — tabuľka má celú šírku', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogPanel, { initialFilter: DEFAULT_CATALOG_FILTER }),
    );
    expect(html).toContain('catalog-split');
    expect(html).toContain('tbl-frame');
    // Panel nie je „skrytý", ale v DOM vôbec nie je — skrytý by si držal
    // miesto v rade a tabuľka by sa zúžila nadarmo.
    expect(html).not.toContain('data-testid="product-detail"');
  });

  it('panel si drží svoje meno aj po presune do mriežky', () => {
    const html = renderToStaticMarkup(
      createElement(ProductDetailPanel, { row: ROW, soldWindowDays: 30, onClose: () => {} }),
    );
    expect(html).toContain('data-testid="product-detail"');
    expect(html).toContain('aria-label="Detail produktu"');
  });
});

/* ═══════════════ B. CSS: stĺpec, nie prekryv; 720 px zalomí ═══════════════ */

describe('K1 — rozloženie stĺpca v globals.css', () => {
  it('panel v mriežke nie je `fixed` a nemá tieň prekryvu', () => {
    const rules = block('.catalog-split > .drawer');
    expect(rules).toContain('position: static');
    expect(rules).not.toContain('position: fixed');
    expect(rules).toContain('box-shadow: none');
  });

  it('rad sa zalamuje sám — 720 px teda dá panel POD tabuľku, nie cez ňu', () => {
    const rules = block('.catalog-split');
    expect(rules).toContain('flex-wrap: wrap');
    // Tabuľka sa musí smieť zúžiť, inak ju vlastný obsah vytlačí z radu
    // a panel by spadol dole aj na širokej obrazovke.
    expect(block('.catalog-split > .tbl-frame')).toContain('min-width: 0');
  });

  it('117-znakový názov sa v hlavičke panela zalomí aj bez medzery', () => {
    expect(NAJDLHSI_NAZOV).toHaveLength(117);
    expect(block('.catalog-split > .drawer .drawer-h .t')).toContain('overflow-wrap: anywhere');
  });
});

/* ═══════════════ C. Riadok vie, že ho panel práve popisuje ════════════════ */

describe('K1 — väzba riadku na otvorený detail', () => {
  it('bez otvoreného detailu nenesie značku ani jeden riadok', () => {
    const html = renderToStaticMarkup(createElement(CatalogTable, TABLE));
    // `aria-current="page"` v stránkovači je iná vec a ostáva.
    expect(html).not.toContain('aria-current="true"');
    expect(html).not.toMatch(/class="[^"]*\bopen\b/);
  });

  it('otvorený riadok nesie triedu aj `aria-current`, ostatné nie', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, { ...TABLE, openId: INY_ROW.productId }),
    );
    expect(html.match(/aria-current="true"/g)?.length ?? 0).toBe(1);
    expect(html).toContain('<tr class="open" aria-current="true">');
  });

  it('otvorený a vybraný riadok nesie obe značky — sú to iné dve veci', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, {
        ...TABLE,
        openId: ROW.productId,
        selected: new Set<number>([ROW.productId]),
      }),
    );
    expect(html).toContain('<tr class="on open" aria-current="true">');
    // Podfarbenie výberu prežije: pravidlo pre otvorený riadok sa `:not(.on)`
    // vyhýba práve tomu, aby „pôjde do zľavy" prekrylo.
    expect(block('table.tbl tbody tr.open:not(.on) td')).toContain('background');
  });
});
