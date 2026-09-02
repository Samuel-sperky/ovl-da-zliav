/**
 * Aura Zľavy — TABUĽKOVÁ SKUPINA V6a: `Table` · `Pagination` · `Toolbar`.
 *
 * ČO TENTO SÚBOR STRÁŽI (a prečo práve to)
 * ────────────────────────────────────────
 *
 *  A. **Trojstavovosť na TELE ODPOVEDE, nie v modeli.** Repo má zapísanú
 *     pascu: D121 fungoval v klientskom modeli, kým server posielal
 *     `unitsSold: 0` namiesto `null`, a 3756 testov to nenašlo. Tu sa preto
 *     nemeria, čo si komponent myslí, ale čo naozaj vykreslí: `data-value`
 *     na bunke, pomlčka U+2014 v texte, znak `≥` a slovo pre čítačku.
 *  B. **Prilepenie (D137) ako číslo, nie ako dojem.** Kompaktná výška riadku,
 *     `position: sticky` hlavičky a vodorovné odsadenie prvých dvoch stĺpcov
 *     sa čítajú z CSS a z inline `left`, takže „prilepené" je overiteľné bez
 *     prehliadača. Preklik (D141) potom dokazuje krásu, nie existenciu.
 *  C. **Vodorovný posuv patrí tabuľke, nie stránke.** `min-width: 0`
 *     a `max-width: 100%` na ráme sú jediné, čo drží 12 stĺpcov vnútri.
 *  D. **Dve kópie `pageTokens()`.** Nový domov je `Pagination.tsx`, ale
 *     `CatalogTable.tsx` má ešte tú svoju. Kým ju V6b nezmaže, test ich drží
 *     na tom istom výsledku — „to isté číslo nesmie žiť na dvoch miestach"
 *     platí aj o algoritme.
 *  E. **Slovenčina (§4 bod 4).** Portované komponenty prišli s anglickými
 *     textami; test hľadá tie anglické slová v NAOZAJ VYKRESLENOM texte.
 *  F. **Žiadny surový hex a žiadne `rgba()` v module** (D132, D144, D147) —
 *     strážny test tokenovej vrstvy číta `globals.css`, a keby toto nečítal
 *     nikto, hex by sa presunul sem a zostal by zelený.
 *
 * Meria sa `renderToStaticMarkup` (bez DOM-u, ako zvyšok projektu) a CSS sa
 * číta ako text — pravidlá modulu sú tvrdenia, nie vzhľad.
 *
 * Vlastník: V6a, skupina „Tabuľka" (D133, D137).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import Pagination, { pageRange, pageTokens } from '@/components/ui/Pagination';
import Table, {
  TABLE_UNKNOWN_WORD,
  stickyOffsets,
  tableCellState,
  type TableCell,
  type TableColumn,
} from '@/components/ui/Table';
import {
  FilterToolbar,
  FilterTray,
  Toolbar,
  ToolbarSearch,
  ToolbarSpacer,
} from '@/components/ui/Toolbar';
import styles from '@/components/ui/tables.module.css';


const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CSS = read('../../src/components/ui/tables.module.css');
const TABLE_TSX = read('../../src/components/ui/Table.tsx');
const PAGINATION_TSX = read('../../src/components/ui/Pagination.tsx');
const TOOLBAR_TSX = read('../../src/components/ui/Toolbar.tsx');

/** Pomlčka, ktorou appka hovorí „nevieme" (U+2014) — nie spojovník. */
const POMLCKA = '—';
/** Znak dolnej hranice (U+2265). */
const VACSIE_ROVNE = '≥';

/* ═══════════════════════ 0. Čítanie CSS ako pravidiel ════════════════════ */

/** História v hlavičkách nie je pravidlo — komentáre sa nemerajú. */
function bezKomentarov(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Telo pravidla, ktorého selektor je PRESNE táto trieda.
 *
 * Zámerne sa NEHĽADAJÚ zložené selektory (`.rowSelected > .cell`): merajú sa
 * pravidlá, ktoré nesú rozmer a stav samotného primitíva, nie ich prekrytia.
 */
function pravidlo(trieda: string): string {
  const re = new RegExp(`(?:^|})\\s*\\.${trieda}\\s*\\{([^{}]*)\\}`, 'm');
  const m = re.exec(bezKomentarov(CSS));
  expect(m, `pravidlo .${trieda} v tables.module.css chýba`).not.toBeNull();
  return (m?.[1] ?? '').trim();
}

/** Hodnota jednej vlastnosti v tele pravidla; `null`, keď tam nie je. */
function vlastnost(telo: string, meno: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${meno}\\s*:\\s*([^;]+)`).exec(telo);
  return m === null ? null : (m[1] ?? '').trim();
}

/** Viditeľný text vykresleného markupu — bez značiek a bez atribútov. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

/**
 * Otváracia značka prvku s daným `data-testid`.
 *
 * Poradie atribútov určuje React (rozloženie `...rest` v `Button.tsx`), takže
 * `aria-label="…"[^>]*disabled` je test, ktorý zčervená pri preskupení propov
 * a nie pri chybe. Toto sa pýta na CELÚ značku.
 */
function znacka(html: string, testid: string): string {
  const i = html.indexOf(`data-testid="${testid}"`);
  expect(i, `prvok s data-testid="${testid}" v markupe nie je`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf('<', i), html.indexOf('>', i) + 1);
}

/* ═══════════════════════ 1. Vzorové stĺpce a riadky ══════════════════════ */

interface Riadok {
  readonly id: number;
  readonly ref: string | null;
  readonly nazov: string;
  readonly predane: number | null;
}

const znama = (content: ReactNode, title?: string): TableCell => ({ content, title });

const priznanie = (title: string): TableCell => ({
  content: POMLCKA,
  unknown: true,
  title,
});

const dolnaHranica = (units: number): TableCell => ({
  content: `${VACSIE_ROVNE} ${units}`,
  lowerBound: true,
  title: 'Z 30 dní okna je dočítaných 4, chýba 26. Skutočný počet môže byť vyšší.',
});

const STLPCE: readonly TableColumn<Riadok>[] = [
  {
    key: 'reference',
    header: 'Referencia',
    headerTitle: 'Referencia produktu podľa shopu.',
    width: '88px',
    cell: (row) =>
      row.ref === null
        ? priznanie('Produkt ešte nie je obohatený.')
        : znama(row.ref, 'Referencia produktu podľa shopu.'),
  },
  {
    key: 'name',
    header: 'Názov',
    width: '260px',
    truncate: true,
    sortable: true,
    cell: (row) => znama(row.nazov),
  },
  {
    key: 'soldWindow',
    header: 'Predané 30 d',
    align: 'right',
    sortable: true,
    cell: (row) =>
      row.predane === null ? priznanie('Z okna chýbajú dni.') : dolnaHranica(row.predane),
  },
];

const RIADKY: readonly Riadok[] = [
  { id: 1, ref: 'AB-120', nazov: 'Strieborné náušnice Lumen', predane: 12 },
  { id: 2, ref: null, nazov: 'Oceľový prívesok', predane: null },
];

function vykresliTabulku(extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(Table<Riadok>, {
      columns: STLPCE,
      rows: RIADKY,
      rowKey: (row) => String(row.id),
      caption: 'Katalóg produktov',
      ...extra,
    }),
  );
}

/* ═══════════════════════ 2. Prilepené stĺpce (D137) ══════════════════════ */

describe('stickyOffsets — odsadenie prilepených stĺpcov', () => {
  const s = [{ width: '88px' }, { width: '260px' }, { width: '90px' }, {}];

  it('bez prilepenia nevracia ani jedno odsadenie', () => {
    expect(stickyOffsets(s, 0)).toEqual([null, null, null, null]);
  });

  it('prvý prilepený stĺpec stojí na nule', () => {
    expect(stickyOffsets(s, 1)).toEqual(['0px', null, null, null]);
  });

  it('druhý stojí za šírkou prvého (D137: referencia + názov)', () => {
    expect(stickyOffsets(s, 2)).toEqual(['0px', '88px', null, null]);
  });

  it('tretí stojí za SÚČTOM predchádzajúcich, nie za posledným', () => {
    expect(stickyOffsets(s, 3)).toEqual(['0px', '88px', 'calc(88px + 260px)', null]);
  });

  it('stĺpec bez šírky sa ešte prilepí, ale ten za ním už NIE', () => {
    // Bez šírky prvého sa druhý nemá o čo odsadiť; odhad by ho položil na
    // zlé miesto a prekryl by susedný stĺpec.
    expect(stickyOffsets([{}, { width: '80px' }], 2)).toEqual(['0px', null]);
  });

  it('šírka v inej jednotke sa nepočíta, len sčíta — `calc()` to zvládne', () => {
    expect(stickyOffsets([{ width: '6rem' }, { width: '10%' }], 2)).toEqual(['0px', '6rem']);
    expect(stickyOffsets([{ width: '6rem' }, { width: '10%' }, { width: '1px' }], 3)).toEqual([
      '0px',
      '6rem',
      'calc(6rem + 10%)',
    ]);
  });

  it('viac prilepených než stĺpcov sa zrezáva, nie predlžuje', () => {
    expect(stickyOffsets([{ width: '10px' }], 5)).toEqual(['0px']);
  });

  it('nezmyselný počet neprilepí nič (NaN, záporné číslo)', () => {
    expect(stickyOffsets(s, Number.NaN)).toEqual([null, null, null, null]);
    expect(stickyOffsets(s, -2)).toEqual([null, null, null, null]);
  });

  it('prázdna šírka je to isté ako žiadna', () => {
    expect(stickyOffsets([{ width: '   ' }, { width: '80px' }], 2)).toEqual(['0px', null]);
  });
});

describe('Table — prilepenie sa dostane do markupu', () => {
  const html = vykresliTabulku({ stickyColumns: 2 });

  it('prvé dva stĺpce nesú inline `left`, tretí nie', () => {
    expect(html).toContain('left:0px');
    expect(html).toContain('left:88px');
    // Tretí stĺpec je jediný ďalší; keby sa prilepil, jeho odsadenie by bolo
    // súčtom prvých dvoch.
    expect(html).not.toContain('calc(88px + 260px)');
  });

  it('prilepené bunky majú triedu `pin`, neprilepené nie', () => {
    // 2 hlavičky + 2 riadky × 2 bunky = 6 buniek s triedou `pin`; tretí
    // stĺpec ju nemá ani v hlavičke, ani v riadkoch.
    const pocet = [...html.matchAll(new RegExp(styles.pin as string, 'g'))].length;
    expect(pocet).toBe(6);
  });

  it('hranu prilepenej časti nesie POSLEDNÝ prilepený stĺpec, nie prvý', () => {
    const hrany = [...html.matchAll(new RegExp(styles.pinEdge as string, 'g'))].length;
    // 1 hlavička + 2 riadky = 3 bunky druhého stĺpca.
    expect(hrany).toBe(3);
  });

  it('bez `stickyColumns` sa neprilepí ani jeden stĺpec', () => {
    expect(vykresliTabulku()).not.toContain('left:0px');
  });
});

/* ═══════════════════════ 3. Tri stavy bunky (I11) ════════════════════════ */

describe('tableCellState — hodnota, priznanie, dolná hranica', () => {
  it('bez príznakov je to hodnota', () => {
    expect(tableCellState({ content: '12' })).toBe('known');
  });

  it('`unknown` je priznanie', () => {
    expect(tableCellState({ content: POMLCKA, unknown: true })).toBe('unknown');
  });

  it('`lowerBound` je dolná hranica', () => {
    expect(tableCellState({ content: '≥ 12', lowerBound: true })).toBe('lower-bound');
  });

  it('priznanie VYHRÁVA nad dolnou hranicou — čo nevieme, nemá ani hranicu', () => {
    expect(tableCellState({ content: POMLCKA, unknown: true, lowerBound: true })).toBe('unknown');
  });
});

describe('Table — priznanie sa vykreslí, nie zamlčí (§4 bod 1)', () => {
  const html = vykresliTabulku();

  it('pomlčka U+2014 je v texte a je to ONA, nie spojovník', () => {
    expect(html).toContain(POMLCKA);
    expect(text(html)).toContain(POMLCKA);
  });

  it('každá bunka hlási svoj stav v `data-value`', () => {
    expect(html).toContain('data-value="known"');
    expect(html).toContain('data-value="unknown"');
    expect(html).toContain('data-value="lower-bound"');
  });

  it('bunka s priznaním nesie slovo aj pre čítačku (pomlčku neprečíta)', () => {
    expect(html).toContain(TABLE_UNKNOWN_WORD);
    // Slovo je len tam, kde je priznanie: dve pomlčky v druhom riadku.
    expect([...html.matchAll(new RegExp(TABLE_UNKNOWN_WORD, 'g'))].length).toBe(2);
  });

  it('bunka s hodnotou to slovo NEMÁ — inak by čítačka klamala', () => {
    const jednoznama = renderToStaticMarkup(
      createElement(Table<Riadok>, {
        columns: [STLPCE[1] as TableColumn<Riadok>],
        rows: [RIADKY[0] as Riadok],
        rowKey: (row) => String(row.id),
        caption: 'Katalóg produktov',
      }),
    );
    expect(jednoznama).not.toContain(TABLE_UNKNOWN_WORD);
  });

  it('znak `≥` prežije vykreslenie — dolnú hranicu vyrába volajúci', () => {
    expect(text(html)).toContain(`${VACSIE_ROVNE} 12`);
  });

  it('dôvod medzery ide do `title` bunky', () => {
    expect(html).toContain('title="Produkt ešte nie je obohatený."');
    expect(html).toContain('Skutočný počet môže byť vyšší.');
  });

  it('tabuľka obsah bunky NEPREPISUJE — nulu si nevymyslí', () => {
    expect(html).not.toMatch(/data-value="unknown"[^>]*>0</);
  });

  it('priznanie dostane STLMUJÚCU triedu, dolná hranica svoju vlastnú', () => {
    // Bez tejto väzby by `data-value` bolo len atribút bez vzhľadu: stĺpec by
    // priznanie ohlásil a obrazovka by ho nakreslila ako hodnotu.
    expect(html).toContain(styles.unknown as string);
    expect(html).toContain(styles.bound as string);
    // Hodnota naopak nemá ani jednu z tých dvoch tried.
    const bunkaHodnoty = /<td[^>]*data-value="known"[^>]*>/.exec(html)?.[0] ?? '';
    expect(bunkaHodnoty).not.toContain(styles.unknown as string);
    expect(bunkaHodnoty).not.toContain(styles.bound as string);
  });
});

/* ═══════════════════════ 4. Prístupnosť tabuľky ══════════════════════════ */

describe('Table — prístupnosť hlavičky a triedenia', () => {
  const html = vykresliTabulku({
    sort: { key: 'name', dir: 'asc' },
    onSortChange: () => {},
  });

  it('každá hlavička má `scope="col"`', () => {
    expect([...html.matchAll(/<th /g)].length).toBe(3);
    expect([...html.matchAll(/scope="col"/g)].length).toBe(3);
  });

  it('triedený stĺpec hlási smer cez `aria-sort`', () => {
    expect(html).toContain('aria-sort="ascending"');
  });

  it('netriedený, ale triediteľný stĺpec hlási `none`', () => {
    expect(html).toContain('aria-sort="none"');
  });

  it('stĺpec bez triedenia `aria-sort` nemá vôbec', () => {
    // Tri stĺpce, z toho dva triediteľné → dve hodnoty `aria-sort`.
    expect([...html.matchAll(/aria-sort=/g)].length).toBe(2);
  });

  it('smer NIE JE v texte — `aria-sort` by ho prečítal druhýkrát', () => {
    const t = text(html);
    expect(t).not.toContain('vzostupne');
    expect(t).not.toContain('zostupne');
    expect(t).toContain('zoradiť');
  });

  it('bez `onSortChange` sa tlačidlo triedenia nekreslí', () => {
    expect(vykresliTabulku({ sort: { key: 'name', dir: 'asc' } })).not.toContain('<button');
  });

  it('tabuľka má meno pre čítačku (`caption`)', () => {
    expect(html).toContain('<caption');
    expect(text(html)).toContain('Katalóg produktov');
  });
});

describe('Table — riadok je klikateľný len na požiadanie', () => {
  it('bez `rowsClickable` nemá riadok ani fokus', () => {
    expect(vykresliTabulku({ onRowClick: () => {} })).not.toContain('tabindex');
  });

  it('s `rowsClickable` a obsluhou dostane `tabindex="0"`', () => {
    const html = vykresliTabulku({ rowsClickable: true, onRowClick: () => {} });
    expect([...html.matchAll(/tabindex="0"/g)].length).toBe(RIADKY.length);
  });

  it('`rowsClickable` bez obsluhy nič neklikne — sľub bez krytia sa nekreslí', () => {
    expect(vykresliTabulku({ rowsClickable: true })).not.toContain('tabindex');
  });
});

describe('Table — výber, tlmenie, prázdno a čakanie', () => {
  it('vybraný riadok nesie `data-selected`, nie iba farbu', () => {
    const html = vykresliTabulku({ rowMeta: (row: Riadok) => ({ selected: row.id === 1 }) });
    expect([...html.matchAll(/data-selected="true"/g)].length).toBe(1);
  });

  it('prázdny zoznam dostane jeden riadok cez všetky stĺpce', () => {
    const html = renderToStaticMarkup(
      createElement(Table<Riadok>, {
        columns: STLPCE,
        rows: [],
        rowKey: (row) => String(row.id),
        caption: 'Katalóg produktov',
        empty: 'Nastav filtre a vyhľadaj.',
      }),
    );
    expect(html).toMatch(/colspan="3"/i);
    expect(text(html)).toContain('Nastav filtre a vyhľadaj.');
  });

  it('čakanie hlási `aria-busy` a povie to aj slovom', () => {
    const html = vykresliTabulku({ loading: true, loadingRows: 3 });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(text(html)).toContain('Riadky tabuľky sa načítavajú.');
  });

  it('čakací prúžok NIE JE hodnota — nehlási ani jeden z troch stavov', () => {
    const html = vykresliTabulku({ loading: true, loadingRows: 2 });
    // Prázdna nula by bola tvrdenie; `data-value` je pri čakaní zakázané,
    // lebo bunka ešte nič nezmerala (v jazyku `product-columns` `not_asked`).
    expect(html).not.toContain('data-value');
    expect([...html.matchAll(new RegExp(styles.wait as string, 'g'))].length).toBe(
      2 * STLPCE.length,
    );
    // A ani jeden čakací prúžok nemá obsah — je to prázdny `<span>`.
    expect(html).not.toMatch(new RegExp(`${styles.wait as string}"[^>]*>[^<]`));
  });

  it('pätka stojí ZA posuvnou plochou — nesmie sa posúvať s tabuľkou', () => {
    const html = vykresliTabulku({ footer: createElement('i', null, 'PÄTKA') });
    expect(html.indexOf('PÄTKA')).toBeGreaterThan(html.indexOf('</table>'));
  });

  it('tabuľka je VNÚTRI posuvnej plochy, tá vnútri rámu', () => {
    const html = vykresliTabulku();
    const frame = html.indexOf(styles.frame as string);
    const scroll = html.indexOf(styles.scroll as string);
    expect(frame).toBeGreaterThanOrEqual(0);
    expect(scroll).toBeGreaterThan(frame);
    expect(html.indexOf('<table')).toBeGreaterThan(scroll);
  });
});

/* ═══════════════════════ 5. Stránkovanie ═════════════════════════════════ */

describe('pageRange — kde v poradí človek stojí', () => {
  it('počíta rozsah riadkov na strane', () => {
    expect(pageRange(3, 50, 41_348)).toEqual({ pages: 827, current: 3, from: 101, to: 150 });
  });

  it('poslednú stranu zreže na počet, nie na veľkosť strany', () => {
    expect(pageRange(827, 50, 41_348).to).toBe(41_348);
  });

  it('prázdny zoznam má jednu stranu a nulový rozsah', () => {
    expect(pageRange(1, 50, 0)).toEqual({ pages: 1, current: 1, from: 0, to: 0 });
  });

  it('strana mimo rozsahu sa zreže do rozsahu', () => {
    expect(pageRange(9000, 50, 100).current).toBe(2);
    expect(pageRange(-4, 50, 100).current).toBe(1);
  });

  it('nezmyselná veľkosť strany nespadne na delenie nulou', () => {
    expect(pageRange(1, 0, 10).pages).toBe(10);
    expect(pageRange(1, Number.NaN, 10).pages).toBe(10);
  });
});

describe('pageTokens — výpustky namiesto 827 čísel', () => {
  it('do siedmich strán vypíše všetky', () => {
    expect(pageTokens(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('v strede zoznamu drží okraje aj okolie', () => {
    expect(pageTokens(412, 827)).toEqual([1, 2, 'gap', 411, 412, 413, 'gap', 827]);
  });

  it('na začiatku nevyrába výpustku, kde nič nechýba', () => {
    expect(pageTokens(2, 827)).toEqual([1, 2, 3, 'gap', 827]);
  });

  /*
   * ZMENA 2. 9. 2026 (V6b, D139). Toto tvrdenie sa do V6b volalo „DVE KÓPIE
   * JEDNÉHO PRAVIDLA sa nesmú rozísť (kým V6b tú starú nezmaže)" a porovnávalo
   * `pageTokens()` z `ui/Pagination` s druhou kópiou v `CatalogTable`. V6b tú
   * starú zmazal — presne ako názov predpokladal — takže porovnávať sa už nedá
   * s čím.
   *
   * Tvrdenie sa preto nezrušilo, ale OBRÁTILO: stráži, že druhá kópia
   * NEVZNIKNE ZNOVA. Keby sa len zmazalo, pravidlo by nestrážil nikto, a to je
   * pasca, ktorú má tento repo zapísanú menovite („čo test vyňal z kontroly,
   * nestráži NIKTO").
   */
  it('pravidlo stránkovača má JEDEN domov — druhá kópia sa nevrátila', () => {
    const najdene: string[] = [];
    const chod = (dir: string): void => {
      for (const polozka of readdirSync(dir, { withFileTypes: true })) {
        const cesta = join(dir, polozka.name);
        if (polozka.isDirectory()) {
          chod(cesta);
          continue;
        }
        if (!/[.]tsx?$/.test(polozka.name)) continue;
        if (cesta.endsWith(join('ui', 'Pagination.tsx'))) continue;
        const zdroj = readFileSync(cesta, 'utf8');
        if (/export\s+(?:function|const)\s+pageTokens\W/.test(zdroj)) najdene.push(cesta);
      }
    };
    chod('src');
    expect(najdene, 'pageTokens smie exportovať iba ui/Pagination').toEqual([]);
  });
});

function vykresliStrankovanie(extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(Pagination, {
      page: 3,
      pageSize: 50,
      total: 41_348,
      onPageChange: () => {},
      ...extra,
    }),
  );
}

describe('Pagination — stav je veta, nie zlomok', () => {
  const html = vykresliStrankovanie();

  it('hovorí „Strana X z Y" slovom', () => {
    expect(text(html)).toContain('Strana 3 z 827');
  });

  it('má meno pre čítačku', () => {
    expect(html).toContain('aria-label="Stránkovanie"');
  });

  it('čísla oddeľuje ako celá appka (`formatCountSk`)', () => {
    expect(text(html)).toContain('41 348');
  });

  it('aktuálna strana nie je tlačidlo a nesie `aria-current`', () => {
    expect(html).toContain('aria-current="page"');
    expect(html).not.toMatch(/<button[^>]*aria-current/);
  });

  it('každé číslo strany má meno pre čítačku', () => {
    expect(html).toContain('aria-label="Strana 1"');
  });

  it('rozsah zobrazených riadkov je v texte', () => {
    expect(text(html)).toContain('101–150');
  });
});

describe('Pagination — počet smie byť priznanie (I11, P7)', () => {
  it('dolná hranica sa píše `≈` a povie prečo', () => {
    const html = vykresliStrankovanie({ totalIsLowerBound: true });
    expect(text(html)).toContain('≈ 41 348');
    expect(html).toContain('data-testid="pagination-total-approx"');
    expect(html).toContain('v eshope ich môže byť viac');
  });

  it('dolná hranica NIE JE tučná — meraný počet a odhad sa nesmú pliesť', () => {
    const html = vykresliStrankovanie({ totalIsLowerBound: true });
    expect(html).not.toMatch(/<b[^>]*>≈/);
    expect(vykresliStrankovanie()).toMatch(/<b[^>]*>41 348<\/b>/);
  });

  it('„≈ 0" sa nevykreslí NIKDY — nula nie je odhad', () => {
    const html = vykresliStrankovanie({ total: 0, totalIsLowerBound: true });
    expect(text(html)).not.toContain('≈');
    expect(text(html)).toContain('Žiadne záznamy');
  });

  it('pri prázdnom zozname nehovorí ani o strane — to je práca prázdneho stavu', () => {
    expect(text(vykresliStrankovanie({ total: 0 }))).not.toContain('Strana');
  });
});

describe('Pagination — ovládače', () => {
  it('na prvej strane je „predošlá" vypnutá, na poslednej „ďalšia"', () => {
    const prva = vykresliStrankovanie({ page: 1 });
    expect(znacka(prva, 'pagination-prev')).toContain('disabled');
    expect(znacka(prva, 'pagination-next')).not.toContain('disabled');

    const posledna = vykresliStrankovanie({ page: 827 });
    expect(znacka(posledna, 'pagination-next')).toContain('disabled');
    expect(znacka(posledna, 'pagination-prev')).not.toContain('disabled');
  });

  it('voľba počtu riadkov sa kreslí len s obsluhou', () => {
    expect(vykresliStrankovanie()).not.toContain('<select');
    const html = vykresliStrankovanie({ onPageSizeChange: () => {} });
    expect(html).toContain('<select');
    expect(text(html)).toContain('Na stránku');
  });

  it('skok na stranu sa kreslí až od zadaného počtu strán', () => {
    expect(vykresliStrankovanie({ jumpFromPages: 0 })).not.toContain('pagination-jump-input');
    expect(vykresliStrankovanie({ jumpFromPages: 900 })).not.toContain('pagination-jump-input');
    const html = vykresliStrankovanie({ jumpFromPages: 20 });
    expect(html).toContain('pagination-jump-input');
    // Meno pre čítačku začína VIDITEĽNÝM popiskom (hlasové ovládanie hľadá
    // to, čo je napísané) a nesie rozsah.
    expect(html).toContain('aria-label="Strana, 1 až 827"');
    expect(html).toContain('for="ovl-pagination-page-jump"');
  });

  it('`id` polí sa dá odlíšiť — dva stránkovače na obrazovke si nekradnú `label`', () => {
    const html = vykresliStrankovanie({
      onPageSizeChange: () => {},
      idPrefix: 'dolny',
    });
    expect(html).toContain('id="dolny-page-size"');
    expect(html).toContain('for="dolny-page-size"');
  });

  it('bez ikony nesie tlačidlo SLOVO — ikona je len tretí kanál', () => {
    expect(text(vykresliStrankovanie())).toContain('Predošlá');
    expect(text(vykresliStrankovanie())).toContain('Ďalšia');
  });
});

/* ═══════════════════════ 6. Lišta nad tabuľkou ═══════════════════════════ */

describe('Toolbar — riadok ovládačov', () => {
  it('nesľubuje `role="toolbar"`, kým nemá obsluhu šípok', () => {
    const html = renderToStaticMarkup(createElement(Toolbar, null, 'x'));
    expect(html).not.toContain('role="toolbar"');
  });

  it('prilepenie je voliteľné a viditeľné v triede', () => {
    expect(renderToStaticMarkup(createElement(Toolbar, { sticky: true }, 'x'))).toContain(
      'toolbarSticky',
    );
    expect(renderToStaticMarkup(createElement(Toolbar, null, 'x'))).not.toContain('toolbarSticky');
  });

  it('medzera odtlačí zvyšok doprava', () => {
    expect(renderToStaticMarkup(createElement(ToolbarSpacer))).toContain('spacer');
  });
});

describe('ToolbarSearch — jedno pole, slovensky', () => {
  const html = renderToStaticMarkup(
    createElement(ToolbarSearch, { value: '', onChange: () => {} }),
  );

  it('je to `type="search"` a má meno pre čítačku', () => {
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Hľadať…"');
  });

  it('ikona je voliteľná a dekoratívna (D146 — `ReactNode`)', () => {
    expect(html).not.toContain('aria-hidden="true"');
    const sIkonou = renderToStaticMarkup(
      createElement(ToolbarSearch, {
        value: '',
        onChange: () => {},
        icon: createElement('svg'),
      }),
    );
    expect(sIkonou).toContain('aria-hidden="true"');
  });
});

describe('FilterTray a FilterToolbar — priehradka značiek', () => {
  it('`aria-label` má rolu, inak ho čítačka zahodí', () => {
    const html = renderToStaticMarkup(createElement(FilterTray, null, 'značka'));
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Aktívne filtre"');
    expect(text(html)).toContain('Filtre');
  });

  it('„Zrušiť filtre" sa kreslí len s obsluhou (počíta ju volajúci)', () => {
    expect(text(renderToStaticMarkup(createElement(FilterTray, null, 'z')))).not.toContain(
      'Zrušiť filtre',
    );
    const html = renderToStaticMarkup(
      createElement(FilterTray, { onResetAll: () => {} }, 'z'),
    );
    expect(text(html)).toContain('Zrušiť filtre');
  });

  it('PRÁZDNE POLE značiek priehradku nenakreslí', () => {
    const html = renderToStaticMarkup(createElement(FilterToolbar, { chips: [] }, 'ovládače'));
    expect(html).not.toContain('role="group"');
    expect(text(html)).not.toContain('Filtre');
  });

  it('so značkami priehradka je', () => {
    const html = renderToStaticMarkup(
      createElement(FilterToolbar, { chips: [createElement('span', { key: 'a' }, 'Kov: zlato')] }),
    );
    expect(html).toContain('role="group"');
    expect(text(html)).toContain('Kov: zlato');
  });

  it('vypnutá lišta ukáže DÔVOD a ovládače skryje', () => {
    const html = renderToStaticMarkup(
      createElement(
        FilterToolbar,
        { disabled: true, disabledHint: 'Tento tab nemá čo filtrovať.' },
        'ovládače',
      ),
    );
    expect(text(html)).toContain('Tento tab nemá čo filtrovať.');
    expect(text(html)).not.toContain('ovládače');
  });
});

/* ═══════════════════════ 7. Slovenčina (§4 bod 4) ════════════════════════ */

describe('Portované texty sú po slovensky', () => {
  const ANGLICKE = [
    'Search',
    'Rows per page',
    'Per page',
    'Page ',
    'Previous',
    'Next',
    'No records',
    'Reset filters',
    'Clear filters',
    'Filters',
    'Loading',
    'sort ',
  ] as const;

  const VSETKO = [
    vykresliTabulku({ loading: true }),
    vykresliTabulku({ sort: { key: 'name', dir: 'desc' }, onSortChange: () => {} }),
    vykresliStrankovanie({ onPageSizeChange: () => {}, jumpFromPages: 20 }),
    vykresliStrankovanie({ total: 0 }),
    renderToStaticMarkup(createElement(ToolbarSearch, { value: '', onChange: () => {} })),
    renderToStaticMarkup(createElement(FilterTray, { onResetAll: () => {} }, 'z')),
  ]
    .map(text)
    .join(' | ');

  for (const slovo of ANGLICKE) {
    it(`vo vykreslenom texte nie je „${slovo.trim()}"`, () => {
      expect(VSETKO).not.toContain(slovo);
    });
  }
});

/* ═══════════════════════ 8. CSS modul: pravidlá, nie vzhľad ══════════════ */

describe('tables.module.css — kompaktná hustota a prilepenie (D137, K8)', () => {
  it('riadok je kompaktný: 36 px', () => {
    expect(vlastnost(pravidlo('frame'), '--ovl-tbl-row-h')).toBe('36px');
    expect(vlastnost(pravidlo('cell'), 'height')).toBe('var(--ovl-tbl-row-h)');
  });

  it('hlavička je prilepená na hornú hranu', () => {
    const head = pravidlo('head');
    expect(vlastnost(head, 'position')).toBe('sticky');
    expect(vlastnost(head, 'top')).toBe('0');
  });

  it('prilepený stĺpec je prilepený A NEPRIESVITNÝ', () => {
    const pin = pravidlo('pin');
    expect(vlastnost(pin, 'position')).toBe('sticky');
    // Bez pozadia by pod prilepenou bunkou presvital posúvajúci sa obsah.
    expect(vlastnost(pin, 'background')).toBe('var(--surface-solid)');
  });

  it('prilepená hlavička prekryje prilepenú bunku (poradie vrstiev)', () => {
    const z = (t: string) => Number(vlastnost(pravidlo(t), 'z-index'));
    expect(z('pinHead')).toBeGreaterThan(z('head'));
    expect(z('head')).toBeGreaterThan(z('pin'));
  });

  it('`border-collapse: separate` — pri `collapse` prilepené okraje neplatia', () => {
    expect(vlastnost(pravidlo('table'), 'border-collapse')).toBe('separate');
  });
});

describe('tables.module.css — vodorovne sa posúva tabuľka, nie stránka', () => {
  it('posuv je na `.scroll`', () => {
    expect(vlastnost(pravidlo('scroll'), 'overflow')).toBe('auto');
  });

  it('rám sa nedá roztlačiť na šírku tabuľky', () => {
    const frame = pravidlo('frame');
    expect(vlastnost(frame, 'min-width')).toBe('0');
    expect(vlastnost(frame, 'max-width')).toBe('100%');
  });
});

describe('tables.module.css — priznanie sa stlmí, nezmizne (§4 bod 1)', () => {
  it('`.unknown` mení iba farbu', () => {
    const telo = pravidlo('unknown');
    expect(vlastnost(telo, 'color')).toBe('var(--dim)');
    for (const zakazane of ['display', 'visibility', 'opacity', 'font-size']) {
      expect(vlastnost(telo, zakazane), `.unknown nesmie meniť ${zakazane}`).toBeNull();
    }
  });

  it('dolná hranica nie je zvýraznená hodnota (P7)', () => {
    expect(vlastnost(pravidlo('bound'), 'font-weight')).toBe('400');
  });
});

describe('tables.module.css — farba sa tu nevyrába (D132, D144, D147)', () => {
  const bez = bezKomentarov(CSS);

  it('ani jeden surový hex', () => {
    expect(bez.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('ani jedno `rgba()` ani `rgb(… / …)`', () => {
    expect(bez).not.toMatch(/\brgba?\s*\(/);
  });

  it('ani jedno `!important`', () => {
    expect(bez).not.toContain('!important');
  });

  it('tónuje sa výhradne `color-mix(in …, …, transparent)`', () => {
    const mixy = [...bez.matchAll(/color-mix\([^)]*\)/g)].map((m) => m[0]);
    expect(mixy.length).toBeGreaterThan(0);
    for (const mix of mixy) expect(mix).toMatch(/^color-mix\(in (srgb|oklab), var\(--/);
  });

  it('maska berie `--mask-opaque`, nie čiernu', () => {
    expect(bez).toContain('var(--mask-opaque)');
  });
});

describe('tables.module.css — každý token existuje (D130)', () => {
  /*
   * Preklep v mene tokenu je NAJTICHŠIA chyba v CSS: `var(--surface-sold)`
   * sa nevykreslí ako chyba, ale ako priesvitná bunka, pod ktorou presvitá
   * text — a nikto to nenahlási. Preto sa každé meno hľadá v tokenovej
   * vrstve `globals.css`; miestne rozmery skupiny musia byť deklarované
   * v tomto module.
   */
  const GLOBALS = read('../../src/app/globals.css');
  /*
   * Merajú sa len tokeny BEZ záložnej hodnoty. `var(--x, …)` je zámerný háčik
   * pre obrazovku: `--ovl-toolbar-top` nikto nedefinuje a nemá — hovorí ho tá
   * obrazovka, ktorá lištu prilepí, a bez nej platí záloha.
   */
  const povinne = new Set(
    [...bezKomentarov(CSS).matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((m) => m[1] as string),
  );
  const miestne = new Set(
    [...bezKomentarov(CSS).matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1] as string),
  );

  it('modul si deklaruje vlastné rozmery skupiny', () => {
    expect(miestne.has('--ovl-tbl-row-h')).toBe(true);
    expect(miestne.size).toBeGreaterThanOrEqual(5);
  });

  it('háčik pre obrazovku sa používa VÝHRADNE so zálohou', () => {
    expect(bezKomentarov(CSS)).toContain('var(--ovl-toolbar-top, var(--hdr-h))');
    expect(povinne.has('--ovl-toolbar-top')).toBe(false);
  });

  for (const token of [...povinne].sort()) {
    it(`token ${token} je definovaný`, () => {
      const globalny = new RegExp(`^\\s*${token}\\s*:`, 'm').test(GLOBALS);
      expect(globalny || miestne.has(token), `${token} nie je nikde definovaný`).toBe(true);
    });
  }
});

describe('tables.module.css — žiadna mŕtva ani chýbajúca trieda', () => {
  const TSX = [TABLE_TSX, PAGINATION_TSX, TOOLBAR_TSX].join('\n');
  const pouzite = new Set([...TSX.matchAll(/styles\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]));
  const definovane = new Set(
    [...bezKomentarov(CSS).matchAll(/\.([a-zA-Z][A-Za-z0-9]*)/g)].map((m) => m[1]),
  );

  it('každá trieda zo `styles.*` v module existuje', () => {
    for (const trieda of pouzite) {
      expect(definovane.has(trieda as string), `.${trieda} v module chýba`).toBe(true);
    }
  });

  it('každá trieda v module má volajúceho', () => {
    for (const trieda of definovane) {
      expect(pouzite.has(trieda as string), `.${trieda} nepoužíva ani jeden komponent`).toBe(true);
    }
  });
});

describe('Skupina nezavádza `lucide-react` (D146)', () => {
  it('ani jeden z troch komponentov ho neimportuje', () => {
    // Hľadá sa IMPORT, nie slovo: hlavičky týchto modulov o `lucide-react`
    // píšu práve preto, že sa nepoužíva (D146).
    for (const zdroj of [TABLE_TSX, PAGINATION_TSX, TOOLBAR_TSX]) {
      expect(zdroj).not.toMatch(/from ['"]lucide-react['"]/);
      expect(bezKomentarov(zdroj)).not.toContain('lucide');
    }
  });

  it('ikony berie z miestneho `Icon.tsx`', () => {
    expect(TABLE_TSX).toContain("from '@/components/ui/Icon'");
  });

  it('žiadny z troch nie je klientský — server-safe primitíva', () => {
    for (const zdroj of [TABLE_TSX, PAGINATION_TSX, TOOLBAR_TSX]) {
      expect(zdroj).not.toContain("'use client'");
    }
  });
});
