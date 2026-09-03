/**
 * Aura Zľavy — RECHARTS NESMIE Z MEDZERY UROBIŤ NULU (D135, K5, K6, V6a).
 *
 * Tento súbor stráži tri veci, ktoré sa pri prechode na Recharts pokazia
 * najtichšie:
 *
 *  A. **TRI STAVY HODNOTY.** Číslo je meranie, nula je TIEŽ meranie, `null` je
 *     priznanie nevedomosti (I11). V Rechartse sa medzera kreslí `null`-om
 *     v dátovom riadku a `connectNulls: false`. Kto `null` po ceste nahradí
 *     nulou, spraví z výpadku sťahovania prepad predaja — a bude to vyzerať
 *     dôveryhodne. Nie je to hypotéza: D121 padol presne takto (server posielal
 *     `unitsSold: 0` namiesto `null`, klientský model bol správny a dostal
 *     nepravdivý vstup) a nenašlo to 3756 testov, ale preklik v prehliadači.
 *     Preto sa tu meria SPRÁVANIE PREPISU, nie len typ.
 *
 *  B. **PALETA SA NEROZÍDE S `globals.css`.** Recharts chce farbu ako hotový
 *     reťazec, takže `chart-language.ts` drží zálohu na beh bez DOM. Záloha,
 *     ktorá sa rozíde s tokenovou vrstvou, je najhoršia možnosť: v prehliadači
 *     jedna farba, v serverovom renderi iná, a nikde nič nespadne. Test preto
 *     `globals.css` naozaj PARSUJE — nezhoda je pád, nie poznámka.
 *
 *  C. **GRAF JE PRE ČÍTAČKU TICHÝ A PREPIS NIE JE.** `ChartCard` musí plochu
 *     schovať (`aria-hidden`) a prepis vykresliť. Keby sa to obrátilo, čítačka
 *     by prečítala hluk z SVG a čísla by neprečítala vôbec.
 *
 * ČO TENTO SÚBOR NEROBÍ: nemeria kontrast (to je `grafy-paleta.spec.ts`)
 * a netvrdí, že graf vyzerá dobre — na to je preklik (D141).
 *
 * Vlastník: V6a-GRAFY.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ChartCard,
  ChartSummaryTable,
  type ChartCardProps,
} from '@/components/charts/ChartCard';
import { useChartTheme } from '@/components/charts/useChartTheme';
import {
  AXIS_TICK,
  CHART_RAMP_VARS,
  CHART_SERIES_VARS,
  GAP_SERIES_PROPS,
  GAP_WORD,
  areaFill,
  chartRowText,
  chartRows,
  chartTheme,
  chartValue,
  gapLegendSentence,
  gapRowCount,
  seriesColor,
} from '@/components/ui/chart-language';

const ROOT = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

const GLOBALS = read('src/app/globals.css');
const CHARTS_CSS = read('src/components/charts/charts.module.css');
const PACKAGE = JSON.parse(read('package.json')) as {
  dependencies?: Record<string, string>;
};

/* ═══════════ A. Tri stavy hodnoty: hodnota · nula · nevieme (K6) ══════════ */

describe('A. hodnota / nula / nevieme — tri stavy, nie dva', () => {
  it('meranie je číslo a zostane číslom', () => {
    expect(chartValue(42)).toBe(42);
    expect(chartValue(29.9)).toBe(29.9);
    expect(chartValue(-3)).toBe(-3);
  });

  it('NULA JE FAKT a kreslí sa — nesmie sa stať medzerou', () => {
    /*
     * Toto je druhá polovica I11 a zabúda sa na ňu častejšie než na prvú:
     * „v ten deň sa nepredalo nič" je meranie a graf ho MUSÍ nakresliť.
     * Keby sa nula zliala s neznámom, appka by prestala rozlišovať „nepredalo
     * sa" od „nemerali sme" — a to sú dve rôzne vety s dvoma ďalšími krokmi.
     */
    expect(chartValue(0)).toBe(0);
    expect(chartValue(0)).not.toBeNull();
    expect(Object.is(chartValue(0), 0)).toBe(true);
  });

  it('NEVIEME je `null` a nikdy sa nedopĺňa nulou', () => {
    expect(chartValue(null)).toBeNull();
    expect(chartValue(undefined)).toBeNull();
  });

  it('nečitateľný vstup je priznanie, nie nula', () => {
    /*
     * `chartValue` je zámerne STRIKTNÁ. Reťazec `'0'` z pokazenej odpovede by
     * pri mäkkom prevode dal legitímne vypadajúcu nulu — presne to sa stalo
     * v D121. `NaN` a nekonečná sú to isté inou formou.
     */
    expect(chartValue(Number.NaN)).toBeNull();
    expect(chartValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(chartValue(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(chartValue('0')).toBeNull();
    expect(chartValue('5')).toBeNull();
    expect(chartValue(false)).toBeNull();
    expect(chartValue({})).toBeNull();
  });

  it('prepis radu drží všetky tri stavy vedľa seba', () => {
    const rows = chartRows([
      { label: '1. 8.', value: 12 },
      { label: '2. 8.', value: 0 },
      { label: '3. 8.', value: null },
    ]);
    expect(rows).toEqual([
      { label: '1. 8.', value: 12, lowerBound: false },
      { label: '2. 8.', value: 0, lowerBound: false },
      { label: '3. 8.', value: null, lowerBound: false },
    ]);
  });

  it('riadok sa NIKDY nevynechá — medzera musí byť v rade vidieť', () => {
    /*
     * Vynechaný riadok by os stiahla a graf by tvrdil, že medzi 6. a 22.
     * augustom nie je čo ukázať. Riadok s `null` je opak: medzera, ktorú je
     * vidieť. Počet riadkov na výstupe sa preto musí rovnať vstupu.
     */
    const input = [
      { label: 'a', value: 1 },
      { label: 'b', value: null },
      { label: 'c', value: undefined },
      { label: 'd', value: 0 },
    ];
    const rows = chartRows(input);
    expect(rows).toHaveLength(input.length);
    expect(gapRowCount(rows)).toBe(2);
  });

  it('dolná hranica na medzere nemá čo ohraničovať a zaniká', () => {
    // Inak by prepis napísal `≥ —`, čo nie je priznanie, ale zmätok.
    const [measured, gap] = chartRows([
      { label: 'a', value: 7, lowerBound: true },
      { label: 'b', value: null, lowerBound: true },
    ]);
    expect(measured).toEqual({ label: 'a', value: 7, lowerBound: true });
    expect(gap).toEqual({ label: 'b', value: null, lowerBound: false });
  });

  it('`connectNulls` je VÝSLOVNE `false`, nie len „falsy"', () => {
    /*
     * `true` by cez medzeru natiahlo spojnicu a z priznania „toto sme nemerali"
     * by spravilo tvrdenie „medzi týmito dvoma dňami to šlo takto". Recharts
     * má dnes `false` aj ako predvolenú hodnotu; tvrdenie tu je preto, že
     * predvolená hodnota cudzej knižnice nie je náš invariant.
     */
    expect(GAP_SERIES_PROPS.connectNulls).toBe(false);
    expect(Object.is(GAP_SERIES_PROPS.connectNulls, false)).toBe(true);
  });

  it('Recharts je naozaj závislosť, nie plán', () => {
    // D135 a R1: bez tejto vety by celý súbor mohol strážiť neexistujúci port.
    expect(PACKAGE.dependencies?.recharts).toBeTruthy();
  });
});

describe('A2. prepis hodnoty do textu — pomlčka, `≥`, číslo', () => {
  const plain = (value: number) => String(value);

  it('medzera je POMLČKA U+2014, nikdy nula', () => {
    const [row] = chartRows([{ label: 'a', value: null }]);
    const text = chartRowText(row, plain);
    expect(text).toBe('—');
    expect(text.charCodeAt(0)).toBe(0x2014);
    expect(text).not.toBe('0');
  });

  it('nula sa píše ako nula — je to odpoveď', () => {
    const [row] = chartRows([{ label: 'a', value: 0 }]);
    expect(chartRowText(row, plain)).toBe('0');
  });

  it('dolná hranica nesie znak `≥`', () => {
    const [row] = chartRows([{ label: 'a', value: 18, lowerBound: true }]);
    expect(chartRowText(row, plain)).toBe('≥ 18');
  });

  it('meranie je len číslo, bez ozdôb', () => {
    const [row] = chartRows([{ label: 'a', value: 18 }]);
    expect(chartRowText(row, plain)).toBe('18');
  });
});

describe('A3. veta o medzerách — mlčí, keď nie je čo priznať', () => {
  it('bez medzier NEHOVORÍ nič', () => {
    // „0 nesťahovaných bodov" je hluk, nie priznanie.
    expect(gapLegendSentence(chartRows([{ label: 'a', value: 1 }]))).toBeNull();
    expect(gapLegendSentence([])).toBeNull();
  });

  it('s medzerami povie POČET aj SLOVO', () => {
    const sentence = gapLegendSentence(
      chartRows([
        { label: 'a', value: 1 },
        { label: 'b', value: null },
        { label: 'c', value: null },
      ]),
    );
    /*
     * MERIA SA CELÁ VETA, nie to, či sa v nej niekde vyskytuje dvojka
     * (posilnené 3. 9. 2026). Do tohto dňa tu stálo `toContain('2')` a mutácia
     * `formatCountSk(count)` → `count * 11` prežila: „22 bodov grafu je
     * nesťahované" tvrdenie splnilo, hoci hovorilo o jedenásťkrát väčšej
     * medzere. Počet v priznaní je číslo o dátach, takže sa meria presne.
     */
    expect(sentence).toBe(`2 body grafu je ${GAP_WORD} — kreslí sa medzera, nie nula.`);
  });

  it('počet v priznaní je POČET MEDZIER, nie prepočet — a plurál sa mení s ním', () => {
    const gaps = (count: number): string | null =>
      gapLegendSentence(
        chartRows(
          Array.from({ length: count + 1 }, (_unused, i) =>
            i === 0 ? { label: 'm', value: 1 } : { label: `g${i}`, value: null },
          ),
        ),
      );
    expect(gaps(1)).toBe(`1 bod grafu je ${GAP_WORD} — kreslí sa medzera, nie nula.`);
    expect(gaps(5)).toBe(`5 bodov grafu je ${GAP_WORD} — kreslí sa medzera, nie nula.`);
  });
});

/* ═══════ B. Paleta grafu: mená tokenov, a tie musia existovať ═════════════ */

/**
 * Deklarácie z blokov `globals.css` označených danou značkou `@tokens:*`.
 *
 * Parsuje sa naozaj, negreppuje sa: značka `@tokens:dark` stojí aj v úvodnom
 * docblocku tokenovej vrstvy (tam, kde je popísané poradie blokov), takže
 * samotné hľadanie reťazca by načítalo T1 namiesto T2. Blok sa uznáva len
 * vtedy, keď hneď za koncom komentára so značkou nasleduje selektor a `{`,
 * a rozhoduje POSLEDNÁ značka v komentári — úvodný docblock ich vypisuje
 * všetky a jeho posledná je `derived`, takže sa o `dark` nepobijú.
 */
function tokenBlocks(css: string, mark: string): Record<string, string> {
  const out: Record<string, string> = {};
  const comment = /\/\*[\s\S]*?\*\//g;
  for (let m = comment.exec(css); m !== null; m = comment.exec(css)) {
    const markers = m[0].match(/@tokens:[a-z]+/g);
    if (markers === null) continue;
    if (markers[markers.length - 1] !== `@tokens:${mark}`) continue;

    const after = css.slice(m.index + m[0].length);
    const head = /^\s*([^{}/]+)\{/.exec(after);
    if (head === null) continue;

    const open = m.index + m[0].length + head[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) throw new Error(`neuzavretý blok @tokens:${mark}`);

    const body = css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
    const decl = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
    for (let d = decl.exec(body); d !== null; d = decl.exec(body)) {
      out[d[1] as string] = (d[2] as string).trim();
    }
  }
  return out;
}

const DARK = tokenBlocks(GLOBALS, 'dark');
const LIGHT = tokenBlocks(GLOBALS, 'light');

const THEME = chartTheme();

/** Všetky mená tokenov, ktoré paleta grafu naozaj vypíše do `var(…)`. */
const NAMED = [
  ...THEME.series,
  ...THEME.ramp,
  THEME.grid,
  THEME.axis,
  THEME.ink,
  THEME.tooltipBg,
  THEME.tooltipInk,
  THEME.tooltipBorder,
  THEME.gap,
  THEME.accent,
].map((value) => {
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (m === null) throw new Error(`paleta vrátila hodnotu, ktorá nie je token: ${value}`);
  return m[1] as string;
});

describe('B. paleta menuje tokeny a nekreslí farby', () => {
  it('KAŽDÁ hodnota palety je `var(--token)`, ani jedna nie je farba', () => {
    /*
     * Toto je celá myšlienka sekcie 7 v `chart-language.ts` v jednom tvrdení.
     * Napísaný odtieň by v druhej téme zostal ten istý a nikto by to neodhalil
     * okom pri jednom nastavení systému — a záloha s hexmi by sa s tokenovou
     * vrstvou rozišla tichučko, tiež len v jednej téme.
     */
    const values = [
      ...THEME.series,
      ...THEME.ramp,
      THEME.grid,
      THEME.axis,
      THEME.ink,
      THEME.tooltipBg,
      THEME.tooltipInk,
      THEME.tooltipBorder,
      THEME.gap,
      THEME.accent,
    ];
    expect(values.length).toBeGreaterThan(15);
    for (const value of values) {
      expect(value, `${value} nie je token`).toMatch(/^var\(--[a-z0-9-]+\)$/);
      expect(value).not.toMatch(/#[0-9a-fA-F]{3}/);
      expect(value).not.toContain('rgb');
    }
  });

  it('paleta je ČISTÁ — dve volania dajú to isté', () => {
    // Bez DOM, bez efektu, bez stavu: server a klient musia mať tú istú farbu,
    // inak by prvý render blikol inou paletou než druhý.
    expect(chartTheme()).toEqual(THEME);
  });

  it('paleta má osem radov a päť krokov rampy', () => {
    expect(THEME.series).toHaveLength(8);
    expect(THEME.ramp).toHaveLength(5);
    expect(CHART_SERIES_VARS).toHaveLength(8);
    expect(CHART_RAMP_VARS).toHaveLength(5);
  });

  it('rampa NIE JE medzi radmi — magnitúda a kategória sú dve veci', () => {
    for (const name of CHART_RAMP_VARS) {
      expect(CHART_SERIES_VARS as readonly string[]).not.toContain(name);
    }
  });

  it('paleta nesiaha na stavovú škálu, na značkovú zlatú ani na pruh PRODUKCIA', () => {
    /*
     * `grafy-paleta.spec.ts` bod E: `--st-*` sú ZMERANÉ stavy, nie voľné
     * odtiene pre ďalší rad. Zlatá do grafu patrí len ako TREND a kreslí ju
     * `globals.css` pravidlom `.line.trend`, nie táto paleta — preto sa tu
     * `--gold*` nesmie objaviť vôbec.
     */
    for (const name of NAMED) {
      expect(name, `${name} je stavový token`).not.toMatch(/^--st-/);
      expect(name, `${name} je značková zlatá`).not.toMatch(/^--gold/);
      expect(name).not.toBe('--production-bg');
    }
  });

  it('farba radu sa po ôsmom vracia na začiatok, aj pri zápornom indexe', () => {
    expect(seriesColor(0)).toBe('var(--chart-1)');
    expect(seriesColor(7)).toBe('var(--chart-8)');
    expect(seriesColor(8)).toBe('var(--chart-1)');
    expect(seriesColor(-1)).toBe('var(--chart-8)');
    expect(seriesColor(2.7)).toBe('var(--chart-3)');
  });

  it('výplň pod čiarou je `color-mix()`, nikdy `rgba()` (D147)', () => {
    const fill = areaFill(seriesColor(1));
    expect(fill).toBe('color-mix(in srgb, var(--chart-2) 14%, transparent)');
    expect(fill).not.toContain('rgba');
    expect(fill).not.toContain('rgb(');
    expect(areaFill(seriesColor(1), 30)).toContain('30%');
  });

  it('popisky osi majú jednu veľkosť pre celú appku', () => {
    expect(AXIS_TICK.fontSize).toBe(11);
  });
});

describe('B2. každý token palety v `globals.css` NAOZAJ existuje — a v OBOCH témach', () => {
  it('parser vôbec niečo našiel', () => {
    /*
     * Bez tejto poistky by tvrdenia nižšie prešli aj nad prázdnym záznamom —
     * presne ten druh vákua, ktorý drží zelenú farbu bez merania.
     */
    expect(Object.keys(DARK).length).toBeGreaterThan(30);
    expect(Object.keys(LIGHT).length).toBeGreaterThan(30);
    expect(NAMED.length).toBeGreaterThan(15);
  });

  it('nájdené sú OBA tmavé bloky — základný aj tokeny grafov (T2 a T4)', () => {
    // T2 nesie `--paper2`, T4 nesie `--chart-8`. Keby parser videl len jeden,
    // polovica kontroly by bola slepá a nikto by to nezistil.
    expect(DARK['--paper2']).toBeDefined();
    expect(DARK['--chart-8']).toBeDefined();
    expect(LIGHT['--paper2']).toBeDefined();
    expect(LIGHT['--chart-8']).toBeDefined();
  });

  for (const name of [...new Set(NAMED)]) {
    it(`${name} je definovaný pre tmavú aj svetlú tému (K2)`, () => {
      /*
       * `var(--chart-9)` je platný CSS, len neexistuje — rad by sa nakreslil
       * bez farby a NIKDE by nič nespadlo. Toto je tá kontrola, ktorú by inak
       * musela robiť záloha s hexmi, len bez rizika, že sa rozíde.
       */
      expect(DARK[name], `${name} chýba v @tokens:dark`).toBeDefined();
      expect(LIGHT[name], `${name} chýba v @tokens:light`).toBeDefined();
    });
  }

  it('detektor by si všimol vymyslený token', () => {
    // Mutačná poistka pre tvrdenia vyššie: keby parser vracal čokoľvek, aj
    // neexistujúce meno by prešlo a celá sekcia by bola ozdoba.
    expect(DARK['--chart-9']).toBeUndefined();
    expect(LIGHT['--nieco-co-neexistuje']).toBeUndefined();
  });
});

describe('B3. `useChartTheme` je vstupný bod, nie druhá paleta', () => {
  it('vracia presne to, čo `chartTheme()`', () => {
    /*
     * Hook je zámerne bez efektu (dôvod je v jeho docblocku: hodnoty sú
     * `var()`, tému doriešuje prehliadač). Dôležité je, aby nezaviedol DRUHÝ
     * zdroj farieb — to by bol presne ten „druhý, takmer rovnaký" modul, ktorý
     * si tento repo zakázal.
     */
    expect(useChartTheme()).toEqual(THEME);
  });

  it('vracia stabilnú referenciu — Recharts porovnáva props identitou', () => {
    expect(useChartTheme()).toBe(useChartTheme());
  });
});
/* ═══════ C. ChartCard: plocha je tichá, prepis je povinný (K6) ════════════ */

const ROWS = chartRows([
  { label: '1. 8.', value: 12 },
  { label: '2. 8.', value: 0 },
  { label: '3. 8.', value: null },
  { label: '4. 8.', value: 9, lowerBound: true },
]);

const summary = () =>
  createElement(ChartSummaryTable, {
    caption: 'predané kusy po dňoch',
    valueHead: 'Kusy',
    labelHead: 'Deň',
    rows: ROWS,
    format: (value: number) => String(value),
  });

/**
 * Rám s vloženou náhradou plochy. Recharts sem v teste nevstupuje zámerne:
 * meria sa RÁM a jeho stavy, nie to, či knižnica nakreslí `<path>`. Keby tu
 * bežal `ResponsiveContainer`, meral by 0 × 0 px a test by potvrdzoval prázdno.
 */
function card(props: Partial<ChartCardProps> = {}): string {
  const full: ChartCardProps = {
    title: 'Predané kusy',
    subtitle: 'miestna kópia predajov za 30 dní',
    srSummary: summary(),
    children: createElement('div', { 'data-testid': 'plot-inside' }),
    ...props,
  };
  return renderToStaticMarkup(createElement(ChartCard, full));
}

describe('C. ChartCard — graf mlčí, prepis hovorí', () => {
  const html = card();

  it('plocha grafu je pre asistenčné technológie skrytá', () => {
    // Recharts vyrobí desiatky `<path>`; čítačka z nich prečíta hluk alebo nič.
    expect(html).toContain('data-testid="chart-card-plot"');
    expect(html).toMatch(/aria-hidden="true"[^>]*data-testid="chart-card-plot"/);
  });

  it('a obsah, ktorý jej volajúci podal, je vnútri nej', () => {
    expect(html).toContain('data-testid="plot-inside"');
  });

  it('prepis pre čítačku je vykreslený a nie je skrytý pred ňou', () => {
    expect(html).toContain('data-testid="chart-card-summary"');
    expect(html).toContain('predané kusy po dňoch');
    // `aria-hidden` na prepise by z grafu spravil úplne neprístupný obrázok.
    expect(html).not.toMatch(/aria-hidden="true"[^>]*data-testid="chart-card-summary"/);
  });

  it('prepis nesie VŠETKY TRI STAVY vrátane pomlčky a `≥`', () => {
    /*
     * Toto je K6 na tele výstupu, nie na modeli. D121 fungoval v modeli a padol
     * na tom, čo naozaj odišlo von — trojstavovosť sa preto overuje tu.
     */
    expect(html).toContain('>12<');
    expect(html).toContain('>0<');
    expect(html).toContain('>—<');
    expect(html).toContain('≥ 9');
  });

  it('nadpis je popisok sekcie a stupeň sa dá zvoliť podľa osnovy stránky', () => {
    expect(html).toContain('<h2>Predané kusy</h2>');
    expect(card({ as: 'h3' })).toContain('<h3>Predané kusy</h3>');
  });
});

const FAILURE = {
  message: 'Dopyt na predaje neprešiel.',
  rawCode: 'upstream_error',
  tone: 'critical',
} as const;

describe('C2. ChartCard — päť stavov sa nezamieňa', () => {
  it('načítavanie hovorí `role="status"` a plochu nekreslí', () => {
    const html = card({ loading: true });
    expect(html).toContain('data-mode="loading"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Načítavam graf');
    expect(html).not.toContain('data-testid="plot-inside"');
  });

  it('chyba kreslí vetu zo servera, nie prázdny graf', () => {
    const html = card({ failure: FAILURE });
    expect(html).toContain('data-mode="error"');
    expect(html).toContain('Dopyt na predaje neprešiel.');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('data-testid="plot-inside"');
  });

  it('chyba PREKRÝVA prázdno — „nič tam nie je" by bolo tvrdenie z neznalosti', () => {
    /*
     * Keď dopyt spadol, appka nevie, či dáta sú alebo nie sú. Keby vyhrala
     * vetva `empty`, obrazovka by pri zlyhaní siete tvrdila, že sa nepredalo
     * nič — a to je práve ten druh nepravdy, ktorý vyzerá nevinne.
     */
    const html = card({ failure: FAILURE, empty: true, unmeasuredReason: 'nemerali sme' });
    expect(html).toContain('data-mode="error"');
    expect(html).toContain('Dopyt na predaje neprešiel.');
  });

  it('NEMERANÉ prekrýva prázdno — plocha bez merania nie je plocha bez dát', () => {
    /*
     * Toto je jadro I11 na úrovni celej plochy. „Za obdobie nemáme ani jeden
     * bod" je tvrdenie o PREDAJI; keď sa dni nesťahovali, appka o predaji nevie
     * nič a musí to povedať vetou o SEBE, nie o eshope.
     */
    const html = card({
      empty: true,
      unmeasuredReason: 'predaje za toto obdobie sme nesťahovali',
    });
    expect(html).toContain('data-mode="unmeasured"');
    expect(html).toContain('predaje za toto obdobie sme nesťahovali');
    expect(html).not.toContain('ani jeden bod');
  });

  it('prázdno povie, čo tam má byť a ako sa to tam dostane', () => {
    const html = card({ empty: true });
    expect(html).toContain('data-mode="empty"');
    expect(html).toContain('ani jeden bod');
    expect(html).toContain('synchronizáciu');
    expect(html).not.toContain('data-testid="plot-inside"');
  });

  it('ďalší krok po zlyhaní je SLOT — opakovanie nie je vždy správne', () => {
    // Zabanovaná IP ani vyčerpaná kvóta sa opakovaním nespravia; rodina stavov
    // preto berie celý prvok a nie `onRetry`.
    expect(card({ failure: FAILURE })).not.toContain('Skúsiť znova');
    expect(
      card({
        failure: FAILURE,
        failureAction: createElement('button', { type: 'button' }, 'Skúsiť znova'),
      }),
    ).toContain('Skúsiť znova');
  });

  it('načítavanie prekrýva aj chybu — kým sa čaká, nezlyhalo nič nové', () => {
    const html = card({ loading: true, failure: FAILURE });
    expect(html).toContain('data-mode="loading"');
    expect(html).not.toContain('Dopyt na predaje neprešiel.');
  });

  it('dáta majú režim `data` a prepis', () => {
    const html = card();
    expect(html).toContain('data-mode="data"');
    expect(html).toContain('data-testid="chart-card-summary"');
  });
});

describe('C3. legenda nesie tri kanály — farba, značka, slovo', () => {
  it('slovo je pri každej položke', () => {
    const html = card({
      legend: [
        { label: 'predané kusy', color: 'var(--chart-2)' },
        { label: 'nesťahované', gap: true },
        { label: 'trend cez uzavreté dni', color: 'var(--gold2)', dashed: true },
      ],
    });
    expect(html).toContain('predané kusy');
    expect(html).toContain('nesťahované');
    expect(html).toContain('trend cez uzavreté dni');
  });

  it('marka „nevieme" je ŠRAFOVANIE, nie iná farba', () => {
    /*
     * Šrafovanie je ten istý vzor, akým čiara kreslí nesťahovaný deň a koláč
     * diel „nevieme" (`ChartHatchPattern` — jediná definícia v repe). Keby
     * medzera dostala len inú farbu, farba by sa stala jediným nosičom
     * rozdielu a §4 bod 3 by prestal platiť.
     */
    const html = card({ legend: [{ label: 'nesťahované', gap: true }] });
    expect(html).toContain('<pattern');
    expect(html).toContain('url(#');
  });

  it('trend sa líši TVAROM — prerušovanou markou', () => {
    const html = card({ legend: [{ label: 'trend', color: 'var(--gold2)', dashed: true }] });
    expect(html).toContain('stroke-dasharray');
  });

  it('DOLNÁ HRANICA je prerušovaná HRANA, nie šrafovanie (V6b)', () => {
    /*
     * `open` pribudlo s histogramom cien a je to jazykové rozhodnutie:
     * zberné pásmo („200 € a viac") je NAMERANÝ počet, ktorého rozsah na osi
     * je ohraničený zdola. Kým sa kreslilo šrafovaním, appka tvrdila „toto
     * sme nemerali" nad 180 poctivo zmeranými produktmi.
     *
     * Meria sa preto rozdiel oproti `gap`: `open` má PLNÚ výplň farbou radu
     * a prerušovanú hranu, `gap` má vzor a farbu ignoruje. Keby sa zliali,
     * dve rôzne priznania by vyzerali rovnako.
     */
    const html = card({
      legend: [{ label: 'zberné pásmo', color: 'var(--chart-2)', open: true }],
    });
    expect(html).toContain('zberné pásmo');
    expect(html).toContain('fill="var(--chart-2)"');
    // Hrana je v module (`.legendOpenEdge`), nie inline — vzhľad patrí do CSS.
    expect(CHARTS_CSS).toMatch(/\.legendOpenEdge\s*\{[^}]*stroke-dasharray/);
    // A hlavne: NIE je to šrafovanie.
    expect(html).not.toContain('<pattern');
  });

  it('JEDNOTLIVÁ POLOŽKA na osi je zvislá čiarka, nie plôška (V6b)', () => {
    /*
     * Ceny vybraných produktov sú body na tej istej osi, nie druhá séria.
     * Plná plôška by z nich sériu urobila — marka má preto tvar značky
     * a berie neutrálny textový token, nie krok rampy.
     */
    const html = card({ legend: [{ label: 'ceny vybraných produktov', color: 'var(--ink)', tick: true }] });
    expect(html).toContain('ceny vybraných produktov');
    expect(html).toContain('stroke="var(--ink)"');
    expect(html).not.toContain('<rect');
    expect(html).not.toContain('stroke-dasharray');
  });

  it('NAMERANÉ HODNOTY S NEZNÁMYM ZARADENÍM sú BODKY, nie čiarky (V7)', () => {
    /*
     * `dotted` pribudlo s grafom troch kriviek (D156). Krivka „nevieme, či
     * bola zľava" nesie POCTIVO ZMERANÉ kusy, takže `gap` (šrafovanie =
     * „nemerali sme") by o meraní tvrdil, že meranie nie je — a v tom istom
     * grafe už šrafovanie znamená nesťahovaný deň. `dashed` to byť nemohlo:
     * prerušovaná marka je TREND.
     *
     * Meria sa preto rozdiel proti oboma: bodky (guľaté konce, medzera dlhšia
     * než čiarka) a žiadny vzor.
     */
    const html = card({
      legend: [{ label: 'nevieme, či bola', color: 'var(--chart-3)', dotted: true }],
    });
    expect(html).toContain('nevieme, či bola');
    expect(html).toContain('stroke="var(--chart-3)"');
    expect(html).toContain('stroke-linecap="round"');
    expect(html).not.toContain('<pattern');
    // Bodka je „takmer nulová čiarka s veľkou medzerou" — čiarka trendu je 4 3.
    expect(html).toContain('stroke-dasharray="0.1 4"');
  });

  it('marky sa navzájom nezliali — päť tvarov, päť významov', () => {
    /*
     * Bez tejto vety by tvrdenia vyššie prešli aj vtedy, keby `LegendMark`
     * vracal pre všetko to isté. Meria sa, že sa štyri marky od seba naozaj
     * LÍŠIA vykresleným tvarom.
     */
    const tvar = (entry: Record<string, unknown>) => {
      const html = card({ legend: [{ label: 'x', ...entry }] });
      return html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
    };
    const plna = tvar({ color: 'var(--chart-1)' });
    const medzera = tvar({ gap: true });
    const trend = tvar({ color: 'var(--chart-1)', dashed: true });
    const hranica = tvar({ color: 'var(--chart-1)', open: true });
    const znacka = tvar({ color: 'var(--ink)', tick: true });
    const bodky = tvar({ color: 'var(--chart-1)', dotted: true });
    const vsetky = [plna, medzera, trend, hranica, znacka, bodky];
    expect(new Set(vsetky).size, 'dve marky vyzerajú rovnako').toBe(vsetky.length);
  });

  it('legenda sa nekreslí, keď sa nekreslí graf', () => {
    // Legenda nad chybovou vetou popisuje rad, ktorý na obrazovke nie je.
    const html = card({ failure: FAILURE, legend: [{ label: 'predané kusy' }] });
    expect(html).not.toContain('data-testid="chart-card-legend"');
  });
});

/* ════════════ D. Statické závory: kde brána naozaj stojí ══════════════════ */

/** Všetky zdrojové súbory v `src/`, aby závora nemerala len jeden priečinok. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const SOURCES = sources(resolve(ROOT, 'src')).map((path) => ({
  path,
  code: readFileSync(path, 'utf8'),
}));

/** Kreslí súbor rad Rechartsu? Séria = `<Line>`, `<Area>`, `<Bar>`, `<Scatter>`. */
const SERIES_TAG = /<\s*(Line|Area|Bar|Scatter)[\s/>]/;
/** Kreslí súbor os Rechartsu? Tá si musí vypýtať hranicu (pozri nižšie). */
const AXIS_TAG = /<\s*[XY]Axis[\s/>]/;
const usesRecharts = (code: string) => /from\s+'recharts'/.test(code);

describe('D. závora `connectNulls` siaha tam, kde sa rad naozaj kreslí', () => {
  it('detektor nie je slepý — overené na vzorke, nie na dôvere', () => {
    /*
     * Bez tejto vety by závora nižšie bola dnes VÁKUUM: Recharts zatiaľ
     * neimportuje ani jeden súbor, takže „žiadny súbor pravidlo neporušil" by
     * platilo aj pre pokazený detektor. Repo má na to zapísanú pascu — „grep
     * nad priečinkom A nepovie nič o diere v priečinku B" (K7, 31. 8. 2026).
     */
    expect(usesRecharts("import { Line } from 'recharts';")).toBe(true);
    expect(usesRecharts("import { Line } from 'nerecharts';")).toBe(false);
    expect(SERIES_TAG.test('<Line dataKey="x" />')).toBe(true);
    expect(SERIES_TAG.test('<LineSomething />')).toBe(false);
    expect(SERIES_TAG.test('<Area\n  dataKey="x"')).toBe(true);
  });

  it('závora prehliadla celý `src/`, nie jeden priečinok', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(SOURCES.some((f) => f.path.endsWith('ChartCard.tsx'))).toBe(true);
    expect(SOURCES.some((f) => f.path.includes('dashboard'))).toBe(true);
  });

  it('nikde v `src/` sa `connectNulls` nenastavuje na `true`', () => {
    for (const file of SOURCES) {
      const code = file.code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, `${file.path} zapína connectNulls`).not.toMatch(
        /connectNulls\s*(=\s*\{\s*true|:\s*true)/,
      );
      // `connectNulls` bez hodnoty je v JSX to isté ako `={true}`.
      expect(code, `${file.path} má connectNulls bez hodnoty`).not.toMatch(
        /<\s*(?:Line|Area|Bar|Scatter)[^>]*\sconnectNulls\s*[/>]/,
      );
    }
  });

  it('každý rad Rechartsu berie pravidlo z `GAP_SERIES_PROPS`', () => {
    /*
     * Rozhodujúce je, aby sa pravidlo NEPÍSALO na každom rade zvlášť: jedno
     * miesto sa dá zmeniť a odmerať, dvadsať kópií sa rozíde. Kto rad kreslí,
     * musí konštantu rozbaliť — inak nie je čo strážiť.
     */
    for (const file of SOURCES) {
      if (!usesRecharts(file.code)) continue;
      if (!SERIES_TAG.test(file.code)) continue;
      expect(file.code, `${file.path} kreslí rad bez GAP_SERIES_PROPS`).toContain(
        'GAP_SERIES_PROPS',
      );
    }
  });

  it('každá číselná os Rechartsu si vypýta hranicu z `chartScaleMax()`', () => {
    /*
     * DRUHÁ, TICHŠIA POLOVICA TOHO ISTÉHO PROBLÉMU (K5).
     *
     * Recharts má v typoch `YAxis.domain` napísané: „If undefined, then the
     * domain is calculated based on the data" — teda ZÁKLADŇA NIE JE NULA.
     * Useknutá os je pri stĺpci najsilnejšie skreslenie, aké sa dá urobiť:
     * pomer výšok prestane zodpovedať pomeru čísel a nikto si toho nevšimne.
     * `chartScaleMax()` (sekcia 2) je jediné pravidlo hornej hranice v tejto
     * appke a os ho MUSÍ dostať výslovne — `domain={[0, chartScaleMax(max)]}`.
     *
     * Detektor je overený nižšie v tom istom describe (`AXIS_TAG`), takže toto
     * nie je vákuum ani dnes, keď Recharts ešte nikto neimportuje.
     */
    for (const file of SOURCES) {
      if (!usesRecharts(file.code)) continue;
      if (!AXIS_TAG.test(file.code)) continue;
      expect(file.code, `${file.path} kreslí číselnú os bez chartScaleMax()`).toContain(
        'chartScaleMax',
      );
    }
  });

  it('detektor osi nie je slepý', () => {
    expect(AXIS_TAG.test('<YAxis dataKey="x" />')).toBe(true);
    expect(AXIS_TAG.test('<XAxis\n  type="number"')).toBe(true);
    expect(AXIS_TAG.test('<YAxisSomething />')).toBe(false);
  });
});

describe('D3. inventúra: KTO v `src/` kreslí graf a kto ide cez `ChartCard`', () => {
  /**
   * Kreslí súbor plochu grafu?
   *
   * Detektor je zámerne z dvoch podmienok: vykresľuje SVG (alebo Recharts)
   * A hovorí o legende. Prvá sama by chytila `Icon.tsx` a každú značku
   * v appke, druhá sama by chytila CSS aj čisté modely. Spolu dávajú presne
   * tie súbory, ktoré kreslia GRAF — teda plochu, ku ktorej patrí legenda.
   */
  const KRESLI_GRAF = (code: string) =>
    (/<svg[\s>]/.test(code) || usesRecharts(code)) && /legend/i.test(code);

  const GRAFY = SOURCES.filter((f) => f.path.endsWith('.tsx') && KRESLI_GRAF(f.code)).map((f) =>
    f.path.split(sep).join('/').replace(/^.*\/src\//, 'src/'),
  );

  it('detektor nie je slepý ani nenažratý', () => {
    // Bez tejto vety by inventúra nižšie platila aj pre pokazený detektor.
    expect(KRESLI_GRAF('<svg viewBox="0 0 1 1" />\nlegend')).toBe(true);
    expect(KRESLI_GRAF('<svg viewBox="0 0 1 1" />')).toBe(false);
    expect(KRESLI_GRAF('const legend = 1;')).toBe(false);
    expect(KRESLI_GRAF("import { Line } from 'recharts';\nlegend")).toBe(true);
    expect(SOURCES.length).toBeGreaterThan(100);
  });

  it('graf v `src/` kreslí presne ŠESŤ súborov — nový sa nepridá tichom', () => {
    /*
     * Toto je zapísaná inventúra, nie výnimka. Kto pridá siedmy graf, spadne
     * na tomto tvrdení a bude musieť povedať, do ktorej z dvoch skupín nižšie
     * patrí. Bez toho by sa nový graf pridal so vlastným rámom, vlastnou
     * legendou a vlastným pravidlom osi — presne tak vznikli tri jazyky,
     * ktoré D126 zliepal dokopy.
     *
     * ŠIESTY PRIBUDOL VO V7 (D156): `DiscountSplitChart` je hlavný graf
     * Prehľadu a kreslí denný predaj v troch krivkách (v zľave · bez zľavy ·
     * nevieme, či bola). Ide cez `ChartCard` aj cez `useChartTheme()`, takže
     * patrí do skupiny `RAMOVANE` nižšie — nie medzi priznané výnimky.
     */
    expect(GRAFY).toEqual([
      'src/components/charts/ChartCard.tsx',
      'src/components/charts/PriceHistogram.tsx',
      'src/components/dashboard/DiscountSplitChart.tsx',
      'src/components/dashboard/SalesChart.tsx',
      'src/components/products/ProductDetailPanel.tsx',
      'src/components/ui/Charts.tsx',
    ]);
  });

  it('kto kreslí RÁMOVANÝ graf, berie rám aj paletu z jedného miesta', () => {
    /*
     * `ChartCard.tsx` je sám ten rám, takže sa nemôže volať. Ostatné, ktoré
     * kreslia graf V KARTE, musia ísť cezeň a farby si brať z `useChartTheme()`
     * — napísaná farba zostane v druhej téme tá istá.
     */
    const RAMOVANE = [
      'src/components/charts/PriceHistogram.tsx',
      'src/components/dashboard/DiscountSplitChart.tsx',
      'src/components/dashboard/SalesChart.tsx',
    ];
    for (const path of RAMOVANE) {
      const file = SOURCES.find((f) => f.path.split(sep).join('/').endsWith(path));
      expect(file, `${path} sa nenašiel`).toBeDefined();
      expect(file!.code, `${path} nekreslí rám cez ChartCard`).toContain('<ChartCard');
      expect(file!.code, `${path} si neberie paletu z useChartTheme`).toContain('useChartTheme');
    }
  });

  it('dva grafy cez `ChartCard` ešte NEIDÚ — a je zapísané prečo a kto ich má', () => {
    /*
     * PRIZNANIE, NIE VÝNIMKA. Kontrakt V6 §5 vylučuje z rozsahu informačnú
     * architektúru, a obom týmto grafom prevod na `ChartCard` mení práve ju:
     *
     *  · `ui/Charts.tsx` → `SharePie` (koláč rozdelenia). Nie je to
     *    samostatná karta — `TopFlopSection` ho kreslí VNÚTRI `Panel`-u
     *    rebríčka, takže `ChartCard` (ktorý je `Panel`) by vyrobil kartu
     *    v karte. Navyše jeho legenda nesie ŠTVRTÝ kanál (poradové číslo
     *    dielu), ktorý slovník mariek rámu nepozná. Prevod je preto buď
     *    bezrámová podoba `ChartCard`, alebo presun koláča z rebríčka —
     *    a oboje je rozhodnutie o architektúre, nie o vzhľade.
     *  · `products/ProductDetailPanel.tsx` → `ProductCurveChart` (denná
     *    krivka v detaile produktu). Kreslí si VLASTNÉ šrafovanie
     *    (`<pattern>` 4 × 4 rotate(45) namiesto `ChartHatchPattern` 6 × 6),
     *    takže tá istá značka „nemerali sme" má v appke dve hustoty, a os si
     *    berie hranicu z `curve.maxUnits`, nie z `chartScaleMax()`.
     *
     * Kto niektorý z nich prevedie, MUSÍ upraviť aj tvrdenie vyššie —
     * inventúra sa tým nezmení, ale skupina `RAMOVANE` áno.
     */
    const zatial = [
      'src/components/ui/Charts.tsx',
      'src/components/products/ProductDetailPanel.tsx',
    ];
    for (const path of zatial) {
      const file = SOURCES.find((f) => f.path.split(sep).join('/').endsWith(path));
      expect(file, `${path} sa nenašiel`).toBeDefined();
      expect(file!.code, `${path} už ide cez ChartCard — uprav inventúru`).not.toContain(
        '<ChartCard',
      );
    }
  });
});

describe('D2. výška plochy a výrez pre čítačku sú tokeny, nie čísla', () => {
  it('plocha grafu berie výšku z `--chart-h`', () => {
    const body = /\.cardBody\s*\{([^}]*)\}/.exec(CHARTS_CSS);
    expect(body, 'pravidlo .cardBody sa nenašlo').not.toBeNull();
    expect(body?.[1]).toContain('var(--chart-h)');
    // `min-height` je to, čo drží `ResponsiveContainer` nad nulou.
    expect(body?.[1]).toContain('min-height');
  });

  it('malý graf berie `--chart-h-sm`', () => {
    const body = /\.cardBodySm\s*\{([^}]*)\}/.exec(CHARTS_CSS);
    expect(body?.[1]).toContain('var(--chart-h-sm)');
  });

  it('`size="auto"` výšku PUSTÍ — a smie ju pustiť len inline SVG (V6b)', () => {
    /*
     * `auto` pribudlo s histogramom cien: plocha z inline SVG s `viewBox` si
     * výšku odvodí z pomeru strán (880 × 180, teda plochá), a pevná
     * `--chart-h` (220 – 380 px) by ju zarámovala do prázdna.
     *
     * PRE RECHARTS BY TO BOLA TICHÁ SMRŤ. `ResponsiveContainer` meria rodiča,
     * takže na `height: auto` sa zbalí na nulu a graf zmizne bez jediného
     * hlásenia — presne ten druh chyby, ktorú v tomto repe nachádza až
     * preklik. Preto je tu závora nad celým `src/`, nie veta v komentári.
     */
    const body = /\.cardBodyAuto\s*\{([^}]*)\}/.exec(CHARTS_CSS);
    expect(body, 'pravidlo .cardBodyAuto sa nenašlo').not.toBeNull();
    expect(body?.[1]).toContain('height: auto');
    expect(body?.[1]).toContain('min-height: 0');

    for (const file of SOURCES) {
      if (!usesRecharts(file.code)) continue;
      expect(file.code, `${file.path} kreslí Recharts a pýta si size="auto"`).not.toContain(
        'size="auto"',
      );
    }
  });

  it('závora na `size="auto"` nie je vákuum — niekto ho naozaj používa', () => {
    /*
     * Bez tejto vety by tvrdenie vyššie platilo aj vtedy, keby `auto`
     * neexistovalo. Aspoň jeden súbor ho použiť MUSÍ, a nesmie to byť súbor
     * s Rechartsom.
     */
    const sauto = SOURCES.filter((f) => f.code.includes('size="auto"'));
    expect(sauto.length).toBeGreaterThan(0);
    for (const file of sauto) expect(usesRecharts(file.code)).toBe(false);
  });

  it('`.srOnly` skrýva pred OKOM, nie pred čítačkou', () => {
    /*
     * `display: none` ani `visibility: hidden` sa použiť nesmú — vzali by
     * prepis aj čítačke a každý graf v appke by zostal bez jediného
     * prístupného zdroja čísel. Nič by to nenahlásilo.
     */
    const body = /\.srOnly\s*\{([^}]*)\}/.exec(CHARTS_CSS);
    expect(body, 'pravidlo .srOnly sa nenašlo').not.toBeNull();
    expect(body?.[1]).toContain('clip-path');
    expect(body?.[1]).not.toContain('display: none');
    expect(body?.[1]).not.toContain('visibility: hidden');
  });

  it('rám grafu je `Panel`, nie druhá karta v `charts.module.css`', () => {
    /*
     * D142: dvojník je dlh. Keby si `ChartCard` nakreslil vlastnú ohraničenú
     * plochu, appka by mala dve karty s tým istým vzhľadom a o mesiac by sa
     * rozišli.
     */
    const chartCard = readFileSync(resolve(ROOT, 'src/components/charts/ChartCard.tsx'), 'utf8');
    expect(chartCard).toContain("from '@/components/ui/Panel'");
    expect(CHARTS_CSS).not.toMatch(/^\.card\s*\{/m);
  });
});
