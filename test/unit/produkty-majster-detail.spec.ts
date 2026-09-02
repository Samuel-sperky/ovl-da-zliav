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
 *     TROMA kanálmi — prúžok v prvej (prilepenej) bunke, podfarbenie riadku
 *     a `aria-current` pre čítačku. Farba teda nikdy nie je jediný kanál.
 *
 * KOTVY PRESMEROVANÉ 2. 9. 2026 (V6b, D137/D139/D143)
 * ───────────────────────────────────────────────────
 * Tabuľka katalógu prešla na primitívum `ui/Table`, takže tri kotvy tohto
 * súboru už neexistujú a merajú sa na novom mieste. Meria sa TO ISTÉ tvrdenie:
 *
 *  · rám tabuľky nie je `.tbl-frame` z `globals.css` (tú triedu kreslia
 *    História, Zľavy a Nastavenia, preto v `globals.css` zostala) — kreslí ho
 *    `.frame` z `ui/tables.module.css` a šírku v rade mu dáva `.catalog`
 *    z `products/catalog-table.module.css`. Obe sú v testovom prostredí
 *    zahašované, preto regulárny výraz;
 *  · značku otvoreného riadku NENESIE `<tr class="open">`. `ui/Table` pojem
 *    „ktorý riadok práve popisuje panel vpravo" nemá a pridávať ho do primitíva
 *    kvôli jednej obrazovke by bolo API na jedno použitie
 *    (`catalog-table.module.css`, bod 2 hlavičky). Nesie ju prúžok `.openMark`
 *    v prvej bunke, podfarbenie `tr:has(.openMark)` a `aria-current` na
 *    tlačidle názvu.
 *
 * KTO STRÁŽI TO, ČO TU UŽ NESTOJÍ (pravidlo o výnimkách v `CLAUDE.md`)
 *  · geometriu rámu (`min-width: 0`, `max-width: 100%`) — `tabulka-skupina.spec.ts`;
 *  · že prilepené stĺpce a tri stavy bunky prežili — `tabulka-skupina.spec.ts`
 *    a `produkty-jednotne-stlpce.spec.ts`;
 *  · že sa referencia neskracuje — `produkty-referencia-stlpec.spec.ts`.
 *
 * Pravidlá `.catalog-split > .tbl-frame` a `table.tbl tbody tr.open …`
 * v `globals.css` sú po tomto prechode pre Produkty MŔTVE (nič už tie triedy
 * nekreslí). Nemažú sa tu, lebo `globals.css` nie je súbor tejto obrazovky
 * a arizmetiku radu z nich ešte číta `globals-vlna3-chyby.spec.ts` — to je
 * zvyšok D139 pre vlastníka `globals.css`, nie zabudnuté miesto.
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
/** Čo je na tabuľke Produktov miestne — vrátane značky otvoreného riadku. */
const TABLE_CSS = read('../../src/components/products/catalog-table.module.css');

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

/** Blok pravidiel jedného selektora zo zadaného súboru, aj s komentármi. */
function blockIn(source: string, where: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `selektor ${selector} v ${where} chýba`).toBeGreaterThan(-1);
  const end = source.indexOf('}', start);
  return source.slice(start, end);
}

/** Blok pravidiel jedného selektora z `globals.css`, aj s komentármi. */
function block(selector: string): string {
  return blockIn(CSS, 'globals.css', selector);
}

/**
 * Značky JEDNÉHO riadku tabuľky. `<tr>` sa od V6b kreslí primitívom, takže
 * jeho triedy sú zahašované a celý riadok sa nedá porovnať na literál —
 * porovnáva sa preto obsah TOHO riadku, nie tvar jeho otváracej značky.
 */
function rowMarkup(html: string, productId: number): string {
  const found = html.split('<tr').filter((part) => part.includes(`select-row-${productId}`));
  expect(found, `riadok produktu ${productId} v tabuľke chýba`).toHaveLength(1);
  return found[0] as string;
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
    /* Rám tabuľky a jeho šírka v rade na JEDNOM prvku: `.frame` z primitíva
       (rám, posuv, `min-width: 0`) a `.catalog` z modulu obrazovky
       (`flex: 3 1 350px`, teda tri diely z piatich). Keby sa `.catalog`
       stratil, tabuľka by v rade prestala byť dominantou (P1) a panel by
       spadol pod ňu aj na 1440 px — presne to, čo meria časť B. */
    expect(html).toMatch(/<div class="_frame_[^"]*_catalog_[^"]*"[^>]*data-testid="catalog-table"/);
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
    /* Tabuľka sa musí smieť zúžiť, inak ju vlastný obsah vytlačí z radu
       a panel by spadol dole aj na širokej obrazovke. Základ radu je od V6b
       v module obrazovky (`.catalog`), `min-width: 0` v primitíve — pravidlo
       `.catalog-split > .tbl-frame` v `globals.css` už na Produktoch nič
       nekreslí (pozri hlavičku). Meria sa teda to, čo naozaj platí. */
    expect(blockIn(TABLE_CSS, 'catalog-table.module.css', '.catalog')).toContain('flex: 3 1 350px');
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
    // Ani prúžok: bez otvoreného riadku nie je čo označiť.
    expect(html).not.toMatch(/_openMark_/);
    // Rozklik názvu je zavretý na každom riadku.
    expect(html).not.toContain('aria-expanded="true"');
  });

  it('otvorený riadok nesie prúžok aj `aria-current`, ostatné nie', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, { ...TABLE, openId: INY_ROW.productId }),
    );
    // Značku nesie PRÁVE JEDEN riadok — inak by panel popisoval dva kusy.
    expect(html.match(/aria-current="true"/g)?.length ?? 0).toBe(1);
    expect(html.match(/_openMark_/g)?.length ?? 0).toBe(1);

    const otvoreny = rowMarkup(html, INY_ROW.productId);
    // Oko: prúžok v prvej (prilepenej) bunke, teda vidno ho aj odrolovanú
    // tabuľku. Čítačka: `aria-current`. Rozklik: `aria-expanded`.
    expect(otvoreny).toMatch(/_openMark_/);
    expect(otvoreny).toContain('aria-current="true"');
    expect(otvoreny).toContain('aria-expanded="true"');

    const zavrety = rowMarkup(html, ROW.productId);
    expect(zavrety).not.toMatch(/_openMark_/);
    expect(zavrety).not.toContain('aria-current="true"');
    expect(zavrety).toContain('aria-expanded="false"');
  });

  it('otvorený a vybraný riadok nesie obe značky — sú to iné dve veci', () => {
    const html = renderToStaticMarkup(
      createElement(CatalogTable, {
        ...TABLE,
        openId: ROW.productId,
        selected: new Set<number>([ROW.productId]),
      }),
    );
    const riadok = rowMarkup(html, ROW.productId);
    // „Pôjde do zľavy" (`data-selected`) a „toto teraz čítam vpravo" (prúžok)
    // sa skladajú, nevylučujú.
    expect(riadok).toContain('data-selected="true"');
    expect(riadok).toMatch(/_openMark_/);
    expect(riadok).toContain('aria-current="true"');
    /* Podfarbenie výberu prežije: pravidlo pre otvorený riadok sa vybranému
       riadku vyhýba práve preto, aby „pôjde do zľavy" neprekrylo. Kotva je
       v module obrazovky — do V6b to isté hovorilo
       `table.tbl tbody tr.open:not(.on) td` v `globals.css` (pozri hlavičku). */
    const podfarbenie = blockIn(
      TABLE_CSS,
      'catalog-table.module.css',
      ".catalog tbody tr:has(.openMark):not([data-selected='true']) > td",
    );
    expect(podfarbenie).toContain('background');
  });
});
