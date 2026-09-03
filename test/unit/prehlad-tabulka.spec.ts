/**
 * @vitest-environment jsdom
 *
 * Aura Zľavy — TABUĽKA PRODUKTOV NA PREHĽADE (V7, D159–D163, K6, K7, K8).
 *
 * PREČO SA TU MERIA VYKRESLENÝ DOM A NIE MODEL
 * ────────────────────────────────────────────
 * Tento repo má na to dva zapísané dôvody a oba sa týkajú presne tejto
 * tabuľky:
 *
 *  · **„Model môže byť správny a dostať nepravdivý vstup."** D121 fungoval
 *    v klientskom modeli, kým server posielal `unitsSold: 0` namiesto `null` —
 *    a `soldBucketOf(0)` z toho urobil 30 % zľavu na tisícoch produktov.
 *    Trojstavovosť sa preto overuje na TELE ODPOVEDE a na tom, čo z nej
 *    vznikne v `<td>`, nie na čistej funkcii.
 *  · **„Grep nad priečinkom A nepovie nič o diere v priečinku B."** Poradie
 *    stĺpcov sa dá „overiť" grepom nad zoznamom v komponente a pritom
 *    vykresliť inak, pretože poradie určuje `productColumns()` a nie ten
 *    zoznam. Čita sa preto `data-col` z vykresleného `<thead>`.
 *  · **`data-*` selektor môže byť MŔTVY.** V tomto repe už raz
 *    `[data-col='select']` cielil na atribút, ktorý primitívum nevypisuje, a
 *    odsadenie prvej bunky ticho zmizlo. §A preto tvrdí, že každý `data-col`,
 *    na ktorý cieli CSS tabuľky Prehľadu, sa vo VYKRESLENOM markupe naozaj
 *    nachádza.
 *
 * ČO SA MERIA
 * ───────────
 *  A. Deväť stĺpcov v poradí D159, prilepené prvé dva, hustota D159.
 *  B. Trojstavovosť buniek na TELE: hodnota · pomlčka s dôvodom · `≥`.
 *  C. Tri zamknuté rozmery sú VIDITEĽNE ZAMKNUTÉ s dôvodom, nie funkčné (K7).
 *  D. Triedenie má TRI stavy a `aria-sort` (D162).
 *  E. Riadok NIE JE klikateľný (D163).
 *  F. Otázka → query: filtre D160, stránka D161.
 *  G. Riadky bez zmeraného predaja sa priznávajú ČÍSLOM (D121).
 *
 * Vlastník: V7, krok 3/4 (tabuľka s filtrami).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ProductsTable from '@/components/dashboard/ProductsTable';
import {
  DEFAULT_PER_PAGE,
  DEFAULT_TABLE_QUERY,
  PER_PAGE_CHOICES,
  SOLD_BANDS,
  SORTABLE_COLUMNS,
  enrichedRowsNote,
  isPerPage,
  lockedFilterViews,
  nextSortState,
  overviewRowValues,
  overviewTableColumns,
  overviewTableQueryString,
  sortParam,
  unknownSoldNote,
  type OverviewSort,
} from '@/components/dashboard/products-table-view';
import { parseCatalogPage } from '@/components/dashboard/products-table-api';
import type { OverviewCatalogRow } from '@/components/dashboard/products-table-api';
import { LOCKED_DIMENSIONS, LOCKED_DIMENSION_REASON } from '@/lib/ui/locked-dimensions';
import {
  PRODUCT_COLUMN_IDS,
  PRODUCT_DASH,
  PRODUCT_GAP_REASON,
  productColumn,
} from '@/lib/ui/product-columns';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

const MODUL = 'src/components/dashboard/products-table.module.css';
const KOMPONENT = 'src/components/dashboard/ProductsTable.tsx';
const GLOBALS = 'src/app/globals.css';

/** Zdroj bez komentárov — docblocky tu o pasciach zámerne PÍŠU. */
const bezKomentarov = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1 ');

/* ═══════════════════════════ 1. Vzorka odpovedí ═══════════════════════════ */

const NEOBOHATENY_ID = 18_342;
const OBOHATENY_ID = 18_343;

/**
 * Riadok zrkadla. `unitsSold: null` je ZÁMER: „za toto okno to nevieme"
 * (D121), a práve táto hodnota sa v tomto repe už raz zmenila na nulu.
 */
const mirrorRow = (productId: number, name: string | null): OverviewCatalogRow => ({
  productId,
  name,
  price: '34.90',
  unitsSold: null,
  everDiscounted: false,
  discountedNow: false,
});

/** KPI riadku, na ktorý sa `getFull` NIKDY nepýtalo — všetko `not_enriched`. */
const kpiNeobohateny = () => {
  const gap = { value: null, gap: 'not_enriched' };
  return {
    productId: NEOBOHATENY_ID,
    reference: gap,
    ean13: gap,
    discount: {
      state: 'unknown',
      activePercent: gap,
      from: null,
      to: null,
      measuredAt: null,
    },
    stock: gap,
    soldTotal: gap,
    soldPerStock: gap,
    margin: gap,
    marginPercent: gap,
    units90: {
      windowDays: 30,
      completeDays: 0,
      unknownDays: 30,
      units: { value: null, gap: 'days_missing' },
      lowerBound: false,
    },
  };
};

/**
 * KPI obohateného riadku. Okno je dočítané LEN Z ČASTI a súčet je kladný,
 * takže „predané za okno" je DOLNÁ HRANICA — `≥ 5`, nie `5`.
 */
const kpiObohateny = () => ({
  productId: OBOHATENY_ID,
  reference: { value: 'NAU-1042', gap: null },
  ean13: { value: '8594001234567', gap: null },
  discount: {
    state: 'running',
    activePercent: { value: 20, gap: null },
    from: '2026-09-01',
    to: '2026-09-10',
    measuredAt: '2026-09-01T08:00:00.000Z',
  },
  stock: { value: 8, gap: null },
  soldTotal: { value: 24, gap: null },
  soldPerStock: { value: 3, gap: null },
  margin: { value: 12.4, gap: null },
  marginPercent: { value: 38, gap: null },
  units90: {
    windowDays: 30,
    completeDays: 12,
    unknownDays: 18,
    units: { value: 5, gap: 'days_missing' },
    lowerBound: true,
  },
});

const searchPayload = () => ({
  data: [
    { ...mirrorRow(NEOBOHATENY_ID, null) },
    { ...mirrorRow(OBOHATENY_ID, 'Strieborné náušnice Lumen') },
  ],
  page: 1,
  perPage: DEFAULT_PER_PAGE,
  total: 41_348,
  soldWindowDays: 30,
  counts: { total: 41_348, soldUnknown: 41_100, enrichedRows: 2_900 },
  catalogTotal: 41_348,
  /* K8 — server posiela zamknuté filtre; obrazovka ich NEVYMÝŠĽA. */
  lockedFilters: {
    category: { locked: true, requested: false },
    metal: { locked: true, requested: false },
    jewelryType: { locked: true, requested: false },
  },
});

const kpiPayload = () => ({
  today: '2026-09-03',
  window30: { windowDays: 30, completeDays: 12, unknownDays: 18 },
  window90: { windowDays: 30, completeDays: 12, unknownDays: 18 },
  rows: [kpiNeobohateny(), kpiObohateny()],
});

/* ═══════════════════════════ 2. Prostredie ════════════════════════════════ */

let container: HTMLElement;
let root: Root;
let calls: string[];
const povodnyFetch = globalThis.fetch;

/** `true` = obe odpovede zlyhajú (dôkaz o chybovej vete namiesto núl). */
let vsetkoZlyha = false;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  calls = [];
  vsetkoZlyha = false;

  const json = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

  globalThis.fetch = vi.fn((input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (vsetkoZlyha) {
      return Promise.resolve(json({ ok: false, error: { code: 'db_down', message: 'Nedostupné.' } }));
    }
    if (url.startsWith('/api/catalog/search')) {
      return Promise.resolve(json({ ok: true, data: searchPayload() }));
    }
    if (url.startsWith('/api/insights/product-kpi')) {
      return Promise.resolve(json({ ok: true, data: kpiPayload() }));
    }
    return Promise.resolve(json({ ok: false, error: { code: 'not_found', message: 'Nič.' } }));
  }) as unknown as typeof globalThis.fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = povodnyFetch;
  vi.restoreAllMocks();
});

/** Vykreslí tabuľku a nechá dobehnúť efekty aj oba prísľuby načítania. */
async function otvor(soldWindow = 30): Promise<void> {
  await act(async () => {
    root.render(createElement(ProductsTable, { soldWindow: soldWindow as 30 }));
  });
  /* Dva prísľuby za sebou (zrkadlo, potom KPI zobrazených ID) — jedno kolo
     mikrotaskov by druhý nedobehlo a riadky by mali pomlčky „nepýtali sme sa". */
  for (const _ of [0, 1, 2]) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const hlavicky = (): readonly HTMLTableCellElement[] =>
  [...container.querySelectorAll('thead th')] as HTMLTableCellElement[];

const bunka = (columnId: string, productId: number): HTMLTableCellElement | null =>
  container.querySelector<HTMLTableCellElement>(
    `tbody tr:has([data-testid="prehlad-${columnId}-${productId}"]) td[data-col="${columnId}"]`,
  );

/* ═══════ A. Deväť stĺpcov v poradí D159 ═══════════════════════════════════ */

describe('A. tabuľka kreslí VŠETKÝCH DEVÄŤ stĺpcov v poradí D159 (K6)', () => {
  it('meranie vôbec niečo prechádza', async () => {
    /* Bez tejto poistky by tvrdenia nad prázdnou hlavičkou prešli naprázdno. */
    await otvor();
    expect(hlavicky().length).toBe(9);
  });

  it('poradie z VYKRESLENEJ hlavičky je poradie sady (D124, D159)', async () => {
    await otvor();
    const poradie = hlavicky().map((th) => th.getAttribute('data-col'));
    expect(poradie).toEqual([...PRODUCT_COLUMN_IDS]);
    /* A je to naozaj to poradie, ktoré D159 vymenoval — vrátane toho, že
       sklad stojí PRED maržou a EAN je posledný. */
    expect(poradie).toEqual([
      'reference',
      'name',
      'price',
      'discountNow',
      'soldWindow',
      'soldPerStock',
      'stock',
      'margin',
      'ean13',
    ]);
  });

  it('referencia je PRVÝ stĺpec a EAN má VLASTNÝ, nie prívesok (D150)', async () => {
    await otvor();
    const prvy = hlavicky()[0];
    expect(prvy?.getAttribute('data-col')).toBe('reference');
    expect(prvy?.textContent).toBe(productColumn('reference').label);
    const ean = hlavicky().find((th) => th.getAttribute('data-col') === 'ean13');
    expect(ean, 'stĺpec EAN v hlavičke chýba').not.toBeUndefined();
    expect(ean?.textContent).toBe('EAN');
  });

  it('mená a vety `title` sú z DEFINÍCIE, nie z druhej kópie v tabuľke', async () => {
    await otvor();
    for (const th of hlavicky()) {
      const id = th.getAttribute('data-col');
      expect(id).not.toBeNull();
      const column = productColumn(id as (typeof PRODUCT_COLUMN_IDS)[number], {
        soldWindowDays: 30,
      });
      expect(th.textContent, `${String(id)} — meno`).toContain(column.label);
      expect(th.getAttribute('title') ?? '', `${String(id)} — headTitle`).toContain(
        column.headTitle,
      );
    }
  });

  it('prilepené sú PRVÉ DVA stĺpce, tretí sa posúva (D159)', async () => {
    await otvor();
    const [prvy, druhy, treti] = hlavicky();
    /* `left` dodáva `stickyOffsets()` inline — CSS o šírkach stĺpcov nevie.
       Prvý stojí na nule, druhý za šírkou prvého, tretí sa NEPRILEPÍ. */
    expect(prvy?.style.left).toBe('0px');
    expect(druhy?.style.left).toBe('128px');
    expect(treti?.style.left).toBe('');
  });

  it('hustota D159 je v CSS ako TEXT — 40 px riadok a nezmenšené písmo', () => {
    /*
     * Vitest rieši `.module.css` Proxy-om, takže vykreslený markup o skutočnej
     * výške riadku ani veľkosti písma nepovie NIČ. Číta sa preto CSS ako text.
     */
    const css = read(MODUL).replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(css).toContain('--ovl-tbl-row-h: 40px');
    /*
     * PÍSMO: D159 žiada 13 px „z dnešných 12". Dnešných 12 px neexistuje —
     * `--ovl-fs-table` je `0.875rem`, teda 14 px pri základe 16 px, ktorý
     * `globals.css` neprepisuje. Tabuľka ho preto NEZMENŠUJE. Merajú sa dve
     * veci naraz: token je aspoň 13 px, a tento modul o veľkosti písma
     * buniek nehovorí nič (inak by mohol 14 px potichu zraziť).
     */
    const token = /--ovl-fs-table:\s*([0-9.]+)rem/.exec(read(GLOBALS));
    expect(token, 'token veľkosti písma tabuliek v globals.css chýba').not.toBeNull();
    expect(Number(token?.[1] ?? 0) * 16).toBeGreaterThanOrEqual(13);
    /*
     * Hľadá sa `font-size` v pravidle, ktoré cieli na TABUĽKU alebo jej bunky.
     * Popisok pásiem svoju veľkosť mať SMIE (je to popisok filtra, nie
     * hodnota v tabuľke) — plošný zákaz `font-size` by meral iný súbor, než
     * o aký ide.
     */
    const pravidla = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    expect(pravidla.length, 'CSS modul sa nedal rozobrať na pravidlá').toBeGreaterThan(0);
    for (const [, selektor = '', telo = ''] of pravidla) {
      if (!/\.table|\bt[dh]\b/.test(selektor)) continue;
      expect(/font-size/.test(telo), `pravidlo ${selektor.trim()} zmenšuje písmo tabuľky`).toBe(
        false,
      );
    }
    expect(/html\s*\{[^}]*font-size/.test(read(GLOBALS))).toBe(false);
  });

  it('každý `data-col`, na ktorý CSS cieli, je vo VYKRESLENOM markupe', async () => {
    /*
     * Zapísaná pasca: `[data-col='select']` cielil na atribút, ktorý
     * primitívum nevypisuje — selektor nebol nepoužitý, bol MŔTVY. Meria sa
     * rozpor medzi CSS a vykresleným DOM-om, nie vzhľad.
     */
    await otvor();
    const css = read(MODUL).replace(/\/\*[\s\S]*?\*\//g, ' ');
    const cielene = [...css.matchAll(/data-col=['"]([a-zA-Z0-9]+)['"]/g)].map((m) => m[1]);
    expect(cielene.length, 'modul stratil všetky kotvy na stĺpce sady').toBeGreaterThan(0);
    for (const id of cielene) {
      expect(
        container.querySelector(`td[data-col="${String(id)}"]`),
        `CSS cieli na data-col='${String(id)}', ktoré tabuľka nevypisuje`,
      ).not.toBeNull();
    }
  });
});

/* ═══════ B. Trojstavovosť buniek na TELE odpovede ═════════════════════════ */

describe('B. bunka je hodnota, pomlčka s dôvodom, alebo dolná hranica (I11)', () => {
  it('neobohatený riadok má POMLČKU s dôvodom v každom obohatenom stĺpci', async () => {
    await otvor();
    for (const id of ['reference', 'ean13', 'discountNow', 'soldPerStock', 'stock', 'margin']) {
      const cell = bunka(id, NEOBOHATENY_ID);
      expect(cell, `bunka ${id} chýba`).not.toBeNull();
      expect(cell?.getAttribute('data-value'), id).toBe('unknown');
      expect(cell?.textContent ?? '', id).toContain(PRODUCT_DASH);
      expect(cell?.getAttribute('title') ?? '', id).toContain('nie je obohatený');
      /* Nula sa z priznania NESMIE stať — je to najčastejšia chyba tohto repa. */
      expect(cell?.textContent?.trim(), id).not.toBe('0');
    }
  });

  it('názov neobohateného riadku je `#id`, nie prázdno ani pomlčka (D151)', async () => {
    await otvor();
    const cell = bunka('name', NEOBOHATENY_ID);
    expect(cell?.textContent ?? '').toContain(`#${String(NEOBOHATENY_ID)}`);
    /* Je to PRIZNANIE, nie hodnota — povrch to smie stlmiť len vtedy, keď to
       tabuľka strojovo hlási. */
    expect(cell?.getAttribute('data-value')).toBe('unknown');
  });

  it('nedočítané okno je POMLČKA, nie `≥ 0` ani nula (D121)', async () => {
    await otvor();
    const cell = bunka('soldWindow', NEOBOHATENY_ID);
    expect(cell?.getAttribute('data-value')).toBe('unknown');
    expect(cell?.textContent ?? '').not.toContain('0');
    expect(cell?.getAttribute('title') ?? '').toContain('chýbajú dni');
  });

  it('obohatený riadok nesie ZMERANÉ hodnoty a označí DOLNÚ HRANICU', async () => {
    await otvor();
    expect(bunka('reference', OBOHATENY_ID)?.textContent).toContain('NAU-1042');
    expect(bunka('ean13', OBOHATENY_ID)?.textContent).toContain('8594001234567');
    expect(bunka('stock', OBOHATENY_ID)?.getAttribute('data-value')).toBe('known');
    expect(bunka('discountNow', OBOHATENY_ID)?.textContent).toContain('20');

    /* Okno je dočítané len z časti a súčet je kladný → `≥ 5`, a bunka to
       hlási TRETÍM stavom, nie tým istým, akým hlási zmeranú hodnotu. */
    const okno = bunka('soldWindow', OBOHATENY_ID);
    expect(okno?.getAttribute('data-value')).toBe('lower-bound');
    expect(okno?.textContent ?? '').toContain('≥');
    expect(okno?.getAttribute('title') ?? '').toContain('Dolná hranica');
  });

  it('bunka nepozná štvrtý stav: bez KPI je to „ešte sme sa nepýtali"', () => {
    /*
     * Model, nie DOM: je to jediný spôsob, ako oddeliť „KPI nedobehli" od
     * „pýtali sme sa a nevieme". Zliať tie dve vety je presne to, čo I11
     * zakazuje — a v DOM-e sú od seba rozoznateľné len vetou v `title`.
     */
    const values = overviewRowValues(mirrorRow(1, 'Test'), undefined);
    for (const column of overviewTableColumns(30)) {
      if (column.id === 'name' || column.id === 'price') continue;
      const cell = column.cell(values);
      expect(cell.unknown, column.id).toBe(true);
      expect(cell.title ?? '', column.id).toContain(PRODUCT_GAP_REASON.not_asked);
    }
  });

  it('názov a cena zo ZRKADLA nie sú „neobohatené" — je to iná veta', () => {
    /*
     * Názov a cenu má appka pre KAŽDÝ riadok zrkadla, takže ich prázdno
     * znamená „shop o tom nič nevie" (`shop_has_none`), nie „produkt nie je
     * obohatený" (`not_enriched`). Sú to dve rôzne vety o dvoch rôznych
     * stavoch a zliať ich by znamenalo posielať človeka čakať na obohatenie,
     * ktoré tú hodnotu nikdy nedoplní.
     */
    const values = overviewRowValues(
      { ...mirrorRow(1, null), price: null },
      undefined,
    );
    const name = productColumn('name').cell(values);
    expect(name.text).toBe('#1');
    expect(name.unknown).toBe(true);
    const price = productColumn('price').cell(values);
    expect(price.unknown).toBe(true);
    expect(price.title ?? '').toBe(PRODUCT_GAP_REASON.shop_has_none);
    expect(price.title ?? '').not.toContain('nie je obohatený');
  });

  it('`unitsSold: null` z odpovede zostáva `null` — `?? 0` je zakázaný (D121)', () => {
    /*
     * MUTAČNÝ NÁLEZ 3. 9. 2026: `?? 0` na tomto poli PREŽILO celý zvyšok
     * tohto súboru, pretože stĺpec „predané za okno" berie číslo z KPI (kde je
     * aj pokrytie okna) a `unitsSold` zo zrkadla sa nikde nevykresľuje. Pole
     * pritom v odpovedi JE a je to presne to pole, z ktorého v tomto repe už
     * raz vznikla „30 % zľava na tisícoch produktov, o ktorých appka nič
     * nevedela". Guard preto siaha na PARSER, nie na obrazovku — inak by tú
     * nulu nezastavilo nič.
     */
    const page = parseCatalogPage({
      data: [
        { productId: 1, name: 'A', price: '1.00', unitsSold: null },
        { productId: 2, name: 'B', price: '2.00', unitsSold: 0 },
        { productId: 3, name: 'C', price: '3.00' },
      ],
    });
    expect(page).not.toBeNull();
    expect(page?.rows.map((row) => row.unitsSold)).toEqual([null, 0, null]);
  });

  it('nečitateľná odpoveď je CHYBOVÁ VETA, nie prázdna tabuľka', async () => {
    vsetkoZlyha = true;
    await otvor();
    expect(container.querySelector('[data-testid="prehlad-tabulka-chyba"]')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr td[data-col]').length).toBe(0);
  });
});

/* ═══════ C. Tri zamknuté rozmery (K7) ════════════════════════════════════ */

describe('C. kategória, kov a typ šperku sú VIDITEĽNE ZAMKNUTÉ (K7, D125)', () => {
  it('zoznam sa berie z `locked-dimensions.ts`, nie z druhej kópie', () => {
    expect(lockedFilterViews().map((entry) => entry.code)).toEqual([...LOCKED_DIMENSIONS]);
    /* A obrazovka si ho nedopisuje: mená sú tie, ktoré dáva slovník. */
    expect(lockedFilterViews().map((entry) => entry.label)).toEqual([
      'kategória',
      'kov',
      'typ šperku',
    ]);
  });

  it('všetky tri sú na obrazovke a KAŽDÁ nesie dôvod', async () => {
    await otvor();
    const zamknute = container.querySelector('[data-testid="prehlad-zamknute"]');
    expect(zamknute, 'blok zamknutých rozmerov chýba').not.toBeNull();
    for (const dimension of lockedFilterViews()) {
      const node = container.querySelector(
        `[data-testid="prehlad-zamknute-${dimension.code}"]`,
      );
      expect(node, `zámok ${dimension.code} chýba`).not.toBeNull();
      expect(node?.textContent ?? '', dimension.code).toContain(dimension.label);
      // Zámok bez dôvodu je horší než žiadny zámok (`LockBadge`).
      expect(node?.textContent ?? '', dimension.code).toContain(LOCKED_DIMENSION_REASON);
    }
  });

  it('NIE SÚ funkčné — ani jeden zámok nie je tlačidlo ani vstup', async () => {
    await otvor();
    const zamknute = container.querySelector('[data-testid="prehlad-zamknute"]');
    expect(zamknute?.querySelectorAll('button, input, select, a').length).toBe(0);
  });

  it('žiadny zapnuteľný filter nenesie meno zamknutého rozmeru', async () => {
    /*
     * Toto je celý nález D125: sprievodca kreslil zámok nad maržou, kým
     * Produkty podľa marže naozaj filtrovali. Opačný tvar tej istej chyby je
     * čip, ktorý sa dá stlačiť a nič nefiltruje — filter bez dátového zdroja
     * je sľub, ktorý appka nedodrží.
     */
    await otvor();
    const ovladace = [...container.querySelectorAll('button, [role="radio"]')].map(
      (node) => (node.textContent ?? '').toLowerCase(),
    );
    for (const dimension of lockedFilterViews()) {
      expect(ovladace, dimension.label).not.toContain(dimension.label.toLowerCase());
    }
  });

  it('do query neodíde ani jeden zamknutý rozmer', () => {
    const query = overviewTableQueryString(DEFAULT_TABLE_QUERY, 30);
    for (const dimension of LOCKED_DIMENSIONS) expect(query).not.toContain(dimension);
  });
});

/* ═══════ D. Triedenie má TRI stavy (D162, K8) ═════════════════════════════ */

describe('D. hlavička cyklí vzostupne → zostupne → ZRUŠENÉ (D162)', () => {
  it('cyklus modelu má tri stavy a tretí je pôvodné poradie', () => {
    const prvy = nextSortState(null, 'price');
    expect(prvy).toEqual({ key: 'price', dir: 'asc' });
    const druhy = nextSortState(prvy, 'price');
    expect(druhy).toEqual({ key: 'price', dir: 'desc' });
    /* Bez tretieho stavu sa človek k pôvodnému poradiu nedostane. */
    expect(nextSortState(druhy, 'price')).toBeNull();
  });

  it('klik na INÝ stĺpec začína odznova vzostupne', () => {
    const desc: OverviewSort = { key: 'price', dir: 'desc' };
    expect(nextSortState(desc, 'soldWindow')).toEqual({ key: 'soldWindow', dir: 'asc' });
  });

  it('zrušené poradie posiela `sort=id`, teda pôvodné poradie zrkadla', () => {
    expect(sortParam(null)).toBe('id');
    expect(sortParam({ key: 'price', dir: 'asc' })).toBe('price_asc');
    expect(sortParam({ key: 'price', dir: 'desc' })).toBe('price_desc');
    expect(sortParam({ key: 'soldWindow', dir: 'asc' })).toBe('sold_asc');
    expect(sortParam({ key: 'soldWindow', dir: 'desc' })).toBe('sold_desc');
  });

  it('`aria-sort` prejde tromi stavmi na VYKRESLENEJ hlavičke', async () => {
    await otvor();
    const th = (): HTMLTableCellElement | null =>
      container.querySelector<HTMLTableCellElement>('thead th[data-col="price"]');
    const klik = async (): Promise<void> => {
      const button = container.querySelector<HTMLButtonElement>('[data-testid="sort-price"]');
      expect(button, 'tlačidlo triedenia ceny chýba').not.toBeNull();
      await act(async () => {
        button?.click();
      });
      await act(async () => {
        await Promise.resolve();
      });
    };

    expect(th()?.getAttribute('aria-sort')).toBe('none');
    await klik();
    expect(th()?.getAttribute('aria-sort')).toBe('ascending');
    await klik();
    expect(th()?.getAttribute('aria-sort')).toBe('descending');
    await klik();
    /* Tretí klik vracia `none` — a spolu s ním `sort=id` do dotazu. */
    expect(th()?.getAttribute('aria-sort')).toBe('none');
    expect(calls.filter((url) => url.includes('sort=id')).length).toBeGreaterThan(0);
    expect(calls.filter((url) => url.includes('sort=price_desc')).length).toBe(1);
  });

  it('netriediteľný stĺpec `aria-sort` NEMÁ a klikať sa nedá', async () => {
    await otvor();
    for (const th of hlavicky()) {
      const id = th.getAttribute('data-col') ?? '';
      const sortable = (SORTABLE_COLUMNS as readonly string[]).includes(id);
      expect(th.hasAttribute('aria-sort'), id).toBe(sortable);
      expect(th.querySelectorAll('button').length, id).toBe(sortable ? 1 : 0);
    }
  });

  it('triediteľné sú LEN stĺpce, pre ktoré má API OBA smery', () => {
    /*
     * Zrkadlo vie v SQL zoradiť podľa mena, ceny a predaných; z toho má oba
     * smery iba cena a predané. Meno by malo dva stavy tam, kde ostatné majú
     * tri, a „tri stavy" by prestalo byť pravidlo — preto medzi nimi nie je.
     */
    expect([...SORTABLE_COLUMNS]).toEqual(['price', 'soldWindow']);
  });
});

/* ═══════ E. Riadok nie je klikateľný (D163) ═══════════════════════════════ */

describe('E. Prehľad je na čítanie — riadok sa nedá kliknúť (D163)', () => {
  it('žiadny riadok nemá fokus ani obsluhu kliknutia', async () => {
    await otvor();
    const riadky = [...container.querySelectorAll('tbody tr')];
    expect(riadky.length).toBeGreaterThan(0);
    for (const tr of riadky) expect(tr.hasAttribute('tabindex')).toBe(false);
  });

  it('komponent primitívu klikateľnosť ani nepodáva', () => {
    const kod = bezKomentarov(read(KOMPONENT));
    expect(kod).not.toContain('rowsClickable');
    expect(kod).not.toContain('onRowClick');
  });

  it('na shop z tejto sekcie neodíde ani jeden request (K8)', async () => {
    await otvor();
    expect(calls.length).toBeGreaterThan(0);
    for (const url of calls) {
      expect(url.startsWith('/api/'), url).toBe(true);
      // Dohľadanie v eshope aj obohacovanie MÍŇAJÚ kvótu — odtiaľto nikdy.
      expect(url).not.toContain('lookup=1');
      expect(url).not.toContain('/api/catalog/enrich');
      expect(url).not.toContain('/api/catalog/details');
    }
  });
});

/* ═══════ F. Otázka → query (D160, D161) ══════════════════════════════════ */

describe('F. filtre a stránkovanie idú na SERVER, nie na naklikanú stránku', () => {
  it('predvolená otázka nezužuje nič a nesie okno aj poradie', () => {
    const query = overviewTableQueryString(DEFAULT_TABLE_QUERY, 90);
    expect(query).toContain('soldWindowDays=90');
    expect(query).toContain('sort=id');
    expect(query).toContain('page=1');
    expect(query).toContain(`perPage=${String(DEFAULT_PER_PAGE)}`);
    expect(query).not.toContain('q=');
    expect(query).not.toContain('soldBuckets=');
  });

  it('hľadanie ide do `q` — jedno pole na názov, referenciu aj EAN (D160)', () => {
    const query = overviewTableQueryString(
      { ...DEFAULT_TABLE_QUERY, search: '  NAU-1042  ' },
      30,
    );
    expect(query).toContain('q=NAU-1042');
  });

  it('tri stavy zľavy posielajú tri RÔZNE parametre (D160)', () => {
    const param = (discount: 'all' | 'now' | 'never' | 'ever'): string =>
      overviewTableQueryString({ ...DEFAULT_TABLE_QUERY, discount }, 30);
    expect(param('all')).not.toContain('Discounted');
    expect(param('now')).toContain('currentlyDiscounted=1');
    expect(param('never')).toContain('neverDiscounted=1');
    /* „Bola už niekedy" je opak „bez zľavy" a do 3. 9. 2026 sa podľa neho
       filtrovať nedalo — príznak niesol riadok, parameter neexistoval. */
    expect(param('ever')).toContain('everDiscounted=1');
  });

  it('pásma predaných idú v poradí ZOZNAMU, nie klikania', () => {
    const query = overviewTableQueryString(
      { ...DEFAULT_TABLE_QUERY, bands: ['high', 'none'] },
      30,
    );
    expect(query).toContain('soldBuckets=none%2Chigh');
  });

  it('pásma sú presne tie štyri, aké má SQL — 0 · 1–2 · 3–9 · 10+', () => {
    expect(SOLD_BANDS.map((band) => band.code)).toEqual(['none', 'low', 'mid', 'high']);
    expect(SOLD_BANDS.map((band) => band.label)).toEqual(['0', '1–2', '3–9', '10+']);
  });

  it('strana je 50 alebo 100 — 200 sa NEPRIJME (D161)', () => {
    expect([...PER_PAGE_CHOICES]).toEqual([50, 100]);
    expect(isPerPage(50)).toBe(true);
    expect(isPerPage(100)).toBe(true);
    /* 200 by znamenalo riadky bez KPI: route má strop `MAX_KPI_IDS = 100`. */
    expect(isPerPage(200)).toBe(false);
    expect(isPerPage(25)).toBe(false);
  });

  it('okno tabuľky je to isté, aké nesie prepínač kariet (D155)', async () => {
    await otvor(180);
    const search = calls.find((url) => url.startsWith('/api/catalog/search'));
    const kpi = calls.find((url) => url.startsWith('/api/insights/product-kpi'));
    expect(search).toContain('soldWindowDays=180');
    /* KPI dostane to isté okno ako DLHÉ (`?long=`) — inak by stĺpec „predané
       za okno" hovoril o inom období než nadpis nad ním. */
    expect(kpi).toContain('long=180');
  });

  it('KPI sa ťahajú LEN pre zobrazené ID, nie pre katalóg', async () => {
    await otvor();
    const kpi = calls.find((url) => url.startsWith('/api/insights/product-kpi')) ?? '';
    expect(kpi).toContain(`ids=${String(NEOBOHATENY_ID)}%2C${String(OBOHATENY_ID)}`);
  });
});

/* ═══════ G. Riadky bez zmeraného predaja (D121) ═══════════════════════════ */

describe('G. čo do pásiem nepatrí, sa prizná ČÍSLOM (D121)', () => {
  it('veta nesie počet aj dôvod', () => {
    const note = unknownSoldNote(41_100, 30) ?? '';
    expect(note).toContain('41 100');
    expect(note).toContain('30');
    expect(note).toContain('pomlčku, nie nulu');
  });

  it('`null` nie je nula — vtedy sa NEPOVIE nič', () => {
    expect(unknownSoldNote(null, 30)).toBeNull();
    /* Nula tiež mlčí: „všetko je zmerané" nie je priznanie, len šum. */
    expect(unknownSoldNote(0, 30)).toBeNull();
  });

  it('obohatené riadky sa priznávajú ako podiel, nie ako porucha', () => {
    const note = enrichedRowsNote(2_900, 41_348) ?? '';
    expect(note).toContain('2 900');
    expect(note).toContain('41 348');
    /* Keď je obohatené všetko, veta zmizne — inak by strašila bez dôvodu. */
    expect(enrichedRowsNote(41_348, 41_348)).toBeNull();
    expect(enrichedRowsNote(null, 41_348)).toBeNull();
  });

  it('obe vety sú na VYKRESLENEJ obrazovke, nie len v modeli', async () => {
    await otvor();
    const nezmerane = container.querySelector('[data-testid="prehlad-nezmerane"]');
    const obohatene = container.querySelector('[data-testid="prehlad-obohatene"]');
    expect(nezmerane?.textContent ?? '').toContain('41 100');
    expect(obohatene?.textContent ?? '').toContain('2 900');
  });
});
