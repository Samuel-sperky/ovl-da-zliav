/**
 * Aura Zľavy — KPI SKUPINA: `StatTile` · `DeltaPill` · `BarList` (V6a, D133, D142).
 *
 * Skupina vznikla zlúčením `StatCard` z `aura-roadmap` do miestnej dlaždice
 * a dvoma naozaj novými komponentmi. Testy tu nemeria vzhľad — merajú tri
 * veci, ktoré sa pri redizajne strácajú ako prvé:
 *
 *  1. **TROJSTAVOVOSŤ** (I11). Číslo smie byť hodnota, pomlčka „nevieme"
 *     alebo dolná hranica `≥ N`. Ku každému negatívnemu tvrdeniu je pozitívne
 *     dvojča: bez neho by testy prešli aj nad komponentom, ktorý nevykreslí
 *     nikdy nič.
 *
 *  2. **`DeltaPill(null)` NIE JE NULA.** Toto je jadro celého súboru. Predloha
 *     brala `value: number`, takže volajúci bez porovnania musel poslať `0`
 *     a pilulka by napísala „bez zmeny 0" — tvrdenie o niečom, čo appka
 *     nezmerala. Test preto porovnáva vykreslené HTML stavu `null` so stavom
 *     `0` a žiada, aby boli RÔZNE, a navyše, aby v stave `null` nebola ani
 *     jedna číslica. Samotné „obsahuje slovo nevieme" by prešlo aj vtedy, keby
 *     pilulka to slovo napísala VEDĽA nuly.
 *
 *  3. **TRI KANÁLY.** Stav nesie farba (`data-tone`) + značka (ikona alebo
 *     pomlčka) + SLOVO, a slovo musí byť v HTML, nie len v atribúte. Značka
 *     bez slova je porušenie, o ktorom sa nikto nedozvie.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Trieda v CSS musí byť aj v HTML a naopak.** Pravidlo, ktoré nikto
 *     nenosí, je mŕtvy selektor — presne tak vznikol zelený test o troch
 *     mŕtvych triedach (19. 8. 2026). §E drží obe strany.
 *
 *  B. **Dva moduly o tej istej dolnej hranici sa nesmú rozísť.** Znak `≥`
 *     píše aj `lib/ui/product-columns.ts` (`soldWindowCell`). §A porovnáva
 *     ich výstupy, nie ich zdrojový text. Keď tabuľky prejdú na `statValue()`,
 *     to tvrdenie zmizne spolu s duplicitou.
 *
 *  C. **Dvojník je dlh (D142).** §B stráži, že vedľa `StatTile` nevznikol
 *     `StatCard.tsx` a že po presťahovaní smeru do `DeltaPill` nezostal
 *     v `primitives.module.css` mŕtvy `.trend`.
 *
 * Vlastník: V6a, KPI skupina.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BarList, { barListBars, barListInputs, type BarListItem } from '@/components/ui/BarList';
import DeltaPill from '@/components/ui/DeltaPill';
import Icon, { ICON_NAMES } from '@/components/ui/Icon';
import StatTile from '@/components/ui/StatTile';
import chartStyles from '@/components/charts/charts.module.css';
import {
  DELTA_ICON,
  DELTA_STATES,
  DELTA_UNKNOWN_TITLE,
  DELTA_WORD,
  KPI_LOWER_BOUND,
  KPI_UNKNOWN,
  barListUnknownSentence,
  deltaMeaning,
  deltaState,
  deltaTone,
  formatDeltaSk,
  hasNode,
  roundDelta,
  statValue,
  statValueMarks,
  type DeltaSense,
  type DeltaState,
} from '@/components/ui/kpi';
import styles from '@/components/ui/kpi.module.css';
import { knownValue, productColumn } from '@/lib/ui/product-columns';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const KPI_CSS = read('../../src/components/ui/kpi.module.css');
const STAT_TILE_SRC = read('../../src/components/ui/StatTile.tsx');
const DELTA_SRC = read('../../src/components/ui/DeltaPill.tsx');
const BAR_SRC = read('../../src/components/ui/BarList.tsx');
const PRIMITIVES_CSS = read('../../src/components/ui/primitives.module.css');
const KPI_SRC = read('../../src/components/ui/kpi.ts');

/**
 * Zdroj BEZ komentárov.
 *
 * Repo má na to zapísanú pascu (`TopFlopSection.tsx`): skener, ktorý komentáre
 * neodstrihne, zakáže napísať slovo aj do vysvetlenia, PREČO sa tá vec
 * nepoužíva. Tieto komponenty majú v hlavičke napísané, že `trendMeaning` sa
 * presťahoval, že `lucide-react` sa nepoužíva a že kategorická paleta je
 * v rebríku zakázaná — a to sú presne tie reťazce, ktoré testy nižšie hľadajú.
 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const KPI_RULES = code(KPI_CSS);
const PRIMITIVES_RULES = code(PRIMITIVES_CSS);
const STAT_TILE_CODE = code(STAT_TILE_SRC);
const DELTA_CODE = code(DELTA_SRC);
const BAR_CODE = code(BAR_SRC);
const KPI_CODE = code(KPI_SRC);

/* ─────────────────────────── pomôcky ─────────────────────────────────────── */

const ANY_DIGIT = /[0-9]/;

function html(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

function tile(props: Parameters<typeof StatTile>[0]): string {
  return html(createElement(StatTile, props));
}

function pill(props: Parameters<typeof DeltaPill>[0]): string {
  return html(createElement(DeltaPill, props));
}

function bars(props: Parameters<typeof BarList>[0]): string {
  return html(createElement(BarList, props));
}

/** Hodnota atribútu na prvom výskyte — bez parsovania celého DOM. */
function attr(markup: string, name: string): string | null {
  const found = new RegExp(`${name}="([^"]*)"`).exec(markup);
  return found === null ? null : (found[1] ?? null);
}

/* ═════════════ 0. Meranie vôbec niečo našlo (poistka pod všetkým) ═════════ */

describe('meranie stojí na naozaj prečítaných súboroch', () => {
  it('CSS aj zdroje sú neprázdne', () => {
    /* Bez tejto poistky by negatívne tvrdenia nižšie prešli nad prázdnym
       reťazcom — presne ten druh zeleného testu, ktorý nič nestráži. */
    expect(KPI_RULES.length).toBeGreaterThan(800);
    expect(STAT_TILE_SRC.length).toBeGreaterThan(800);
    expect(DELTA_SRC.length).toBeGreaterThan(800);
    expect(BAR_SRC.length).toBeGreaterThan(800);
    expect(KPI_SRC.length).toBeGreaterThan(800);
  });

  it('CSS moduly sa v teste čítajú ako mená tried', () => {
    expect(typeof styles.delta).toBe('string');
    expect(styles.delta.length).toBeGreaterThan(0);
    expect(typeof chartStyles.rowBarUnknown).toBe('string');
  });
});

/* ═══════════════ A. Tri stavy jedného čísla (statValue, I11) ══════════════ */

describe('statValue — hodnota, pomlčka, dolná hranica', () => {
  it('zmerané číslo je hodnota', () => {
    const view = statValue(1240);
    expect(view.text).toBe('1 240');
    expect(view.unknown).toBe(false);
    expect(view.lowerBound).toBe(false);
  });

  it('zmeraná NULA je hodnota, nie priznanie', () => {
    /* Pozitívne dvojča k testom nižšie: nula sa nesmie stať pomlčkou len
       preto, že je „prázdna". Nula je tvrdenie a appka ho tu naozaj má. */
    const view = statValue(0);
    expect(view.text).toBe('0');
    expect(view.unknown).toBe(false);
  });

  it('chýbajúce číslo je pomlčka U+2014, nie nula', () => {
    for (const value of [null, undefined]) {
      const view = statValue(value);
      expect(view.text).toBe('—');
      expect(view.text).toBe(KPI_UNKNOWN);
      expect(view.unknown).toBe(true);
    }
  });

  it('NaN a nekonečno sú pomlčka, nie „NaN" a nie nula', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const view = statValue(value);
      expect(view.text).toBe(KPI_UNKNOWN);
      expect(view.unknown).toBe(true);
    }
  });

  it('dolná hranica nesie znak ≥ a je to HODNOTA, nie priznanie', () => {
    const view = statValue(12, { lowerBound: true });
    expect(view.text).toBe('≥ 12');
    expect(view.text.startsWith(KPI_LOWER_BOUND)).toBe(true);
    expect(view.lowerBound).toBe(true);
    expect(view.unknown).toBe(false);
  });

  it('„≥ 0" sa nevykreslí NIKDY — je to prázdna veta, nie priznanie', () => {
    const view = statValue(0, { lowerBound: true });
    expect(view.text).not.toContain(KPI_LOWER_BOUND);
    expect(view.text).toBe(KPI_UNKNOWN);
    expect(view.unknown).toBe(true);
    expect(view.lowerBound).toBe(false);
  });

  it('vlastný formát sa použije aj pre dolnú hranicu', () => {
    const view = statValue(12.5, { lowerBound: true, format: (n) => `${String(n)} %` });
    expect(view.text).toBe('≥ 12.5 %');
  });

  it('znak dolnej hranice je ten istý, aký píšu jednotné stĺpce', () => {
    /*
     * §B hlavičky: dolnú hranicu píše aj `product-columns.ts`. Porovnáva sa
     * VÝSTUP oboch modulov, nie ich zdrojový text — reťazec `≥` by v súbore
     * mohol zostať aj po tom, čo by sa bunka prestala kresliť.
     */
    const cell = productColumn('soldWindow', { soldWindowDays: 30 }).cell({
      soldWindow: {
        windowDays: 30,
        completeDays: 20,
        unknownDays: 10,
        units: knownValue(12),
        lowerBound: true,
      },
    });
    expect(cell.lowerBound).toBe(true);
    expect(cell.text).toBe(statValue(12, { lowerBound: true }).text);
  });

  it('dolná hranica nula je pomlčka aj v jednotných stĺpcoch', () => {
    /* Tá istá závora na oboch stranách — keby jedna povolila `≥ 0`, appka by
       o tom istom riadku hovorila dvoma spôsobmi. */
    const cell = productColumn('soldWindow', { soldWindowDays: 30 }).cell({
      soldWindow: {
        windowDays: 30,
        completeDays: 20,
        unknownDays: 10,
        units: knownValue(0),
        lowerBound: true,
      },
    });
    expect(cell.text).toBe(statValue(0, { lowerBound: true }).text);
    expect(cell.unknown).toBe(true);
  });
});

describe('statValueMarks — značka sa odvodí z textu, neposiela sa zvlášť', () => {
  it('pomlčka je priznanie', () => {
    expect(statValueMarks(KPI_UNKNOWN)).toEqual({ unknown: true, lowerBound: false });
  });

  it('dolná hranica je hodnota', () => {
    expect(statValueMarks('≥ 12')).toEqual({ unknown: false, lowerBound: true });
  });

  it('bežné číslo nie je ani jedno', () => {
    expect(statValueMarks('1 240')).toEqual({ unknown: false, lowerBound: false });
  });

  it('nula NIE JE priznanie', () => {
    expect(statValueMarks('0')).toEqual({ unknown: false, lowerBound: false });
  });

  it('to, čo nie je reťazec, sa nehádá', () => {
    /* `<Countdown/>` a spol. — o nich vie stav len volajúci. */
    expect(statValueMarks(42)).toEqual({ unknown: false, lowerBound: false });
    expect(statValueMarks(null)).toEqual({ unknown: false, lowerBound: false });
  });
});

describe('hasNode — prázdny riadok dlaždice nezdvihne celý rad', () => {
  it('nič je null, undefined, false a prázdny reťazec', () => {
    for (const node of [null, undefined, false, '']) {
      expect(hasNode(node), String(node)).toBe(false);
    }
  });

  it('nula a prázdny zoznam sú NIEČO', () => {
    /* `0` je platná hodnota a `detail={0}` sa vykresliť MUSÍ. */
    expect(hasNode(0)).toBe(true);
    expect(hasNode('—')).toBe(true);
  });
});

/* ══════════════════════ B. StatTile — zlúčená dlaždica ════════════════════ */

describe('StatTile — tvar StatCard v miestnej dlaždici', () => {
  it('dedí `.kpi` a nezavádza druhú geometriu dlaždice', () => {
    const markup = tile({ label: 'Zľavy', value: '4' });
    expect(markup).toContain('class="kpi ');
    expect(markup).toContain(styles.tile);
    expect(markup).toContain('<div class="k">Zľavy</div>');
  });

  it('vykreslí popis, hodnotu, detail, smer aj ikonu', () => {
    const markup = tile({
      label: 'Obrat',
      value: '1 240',
      detail: 'za posledných 30 dní',
      delta: createElement(DeltaPill, { value: 12, suffix: '%', sense: 'rise-good' }),
      icon: createElement(Icon, { name: 'lock' }),
      accent: 'gold',
      testId: 'tile-obrat',
    });
    expect(markup).toContain('Obrat');
    expect(markup).toContain('1 240');
    expect(markup).toContain('za posledných 30 dní');
    expect(markup).toContain(styles.headIcon);
    expect(markup).toContain(styles.delta);
    expect(attr(markup, 'data-testid')).toBe('tile-obrat');
  });

  it('pomlčka je označená ako priznanie BEZ toho, aby to volajúci povedal', () => {
    /*
     * Značka a text sú tá istá informácia; keby sa posielali zvlášť, raz by
     * sa rozišli a dlaždica by pomlčku vykreslila ako zmeranú hodnotu.
     */
    const markup = tile({ label: 'Marža', value: KPI_UNKNOWN });
    expect(markup).toContain('data-unknown="ano"');
    expect(markup).not.toContain('data-lower-bound');
  });

  it('zmerané číslo označené ako priznanie NIE JE', () => {
    const markup = tile({ label: 'Marža', value: '12 %' });
    expect(markup).toContain('data-unknown="nie"');
  });

  it('zmeraná nula označená ako priznanie NIE JE', () => {
    const markup = tile({ label: 'Zapísané', value: '0' });
    expect(markup).toContain('data-unknown="nie"');
  });

  it('dolná hranica je hodnota — označí sa, ale netlmí sa ako pomlčka', () => {
    const markup = tile({ label: 'Predané', value: '≥ 12' });
    expect(markup).toContain('data-lower-bound="true"');
    expect(markup).toContain('data-unknown="nie"');
  });

  it('pri hodnote, ktorá nie je reťazec, sa priznanie dá zadať ručne', () => {
    const markup = tile({ label: 'Do konca', value: createElement('span', null, '—'), unknown: true });
    expect(markup).toContain('data-unknown="ano"');
  });

  it('prázdny detail nevykreslí prázdny riadok', () => {
    const withDetail = tile({ label: 'A', value: '1', detail: 'x' });
    const without = tile({ label: 'A', value: '1', detail: false });
    expect(withDetail).toContain('class="s"');
    expect(without).not.toContain('class="s"');
  });

  it('zdôraznenie je atribút v HTML a má pravidlo v CSS (obe strany)', () => {
    /* §A hlavičky: pravidlo bez triedy je mŕtvy selektor, trieda bez pravidla
       je tichý omyl. Preto sa merajú obe strany. */
    for (const accent of ['none', 'accent', 'gold'] as const) {
      expect(tile({ label: 'A', value: '1', accent })).toContain(`data-accent="${accent}"`);
    }
    expect(KPI_RULES).toMatch(/\.tile\[data-accent='accent'\]/);
    expect(KPI_RULES).toMatch(/\.tile\[data-accent='gold'\]/);
    /* `none` pravidlo NEMÁ zámerne — nezdôraznená dlaždica je predvolený stav. */
    expect(KPI_RULES).not.toMatch(/\[data-accent='none'\]/);
  });

  it('zdôraznenie nekóduje stav — vlas je značkový, nie stavový', () => {
    const accentRules = /\.tile\[data-accent[\s\S]*?\}/g;
    const found = KPI_RULES.match(accentRules) ?? [];
    expect(found.length).toBe(2);
    for (const rule of found) {
      expect(rule).not.toMatch(/var\(\s*--st-/);
    }
  });

  it('vedľa dlaždice NEVZNIKOL StatCard (D142)', () => {
    /* Slepý port by postavil dvojníka; docblock `primitives.module.css` to
       zakazuje a `StatTile` to má v hlavičke napísané. */
    expect(() => read('../../src/components/ui/StatCard.tsx')).toThrow();
    /* Pozitívne dvojča: čítanie tým istým spôsobom nájde súbor, ktorý JE. */
    expect(read('../../src/components/ui/StatTile.tsx').length).toBeGreaterThan(0);
  });

  it('smer zmeny už dlaždica nekreslí sama — a nezostalo po ňom mŕtve CSS', () => {
    /* Presťahovanie do `DeltaPill` je hotové len vtedy, keď po ňom nezostal
       ani prop, ani pravidlo. Inak sú v appke dve pilulky smeru. */
    expect(STAT_TILE_CODE).not.toContain('trendMeaning');
    expect(STAT_TILE_CODE).not.toContain('TREND_WORD');
    expect(PRIMITIVES_RULES).not.toMatch(/\.trend(?![\w-])/);
    expect(PRIMITIVES_RULES).not.toMatch(/\.tileTrend(?![\w-])/);
    /* Pozitívne dvojča: prúžok a pilulka spojenia v tom súbore ZOSTALI. */
    expect(PRIMITIVES_RULES).toMatch(/\.meterTrack(?![\w-])/);
    expect(PRIMITIVES_RULES).toMatch(/\.pillMark(?![\w-])/);
  });
});

/* ══════════════ C. DeltaPill — štvrtý stav a tri kanály ═══════════════════ */

describe('DeltaPill — „zmenu nevieme" NIE JE nula', () => {
  it('null a 0 sa vykreslia RÔZNE', () => {
    /* Jadro súboru. Keby pilulka mapovala `null` na `flat`, tieto dva
       výstupy by boli identické a appka by tvrdila zmerané „bez zmeny". */
    expect(pill({ value: null })).not.toBe(pill({ value: 0 }));
  });

  it('pri neznámej zmene nie je vo výstupe ANI JEDNA číslica', () => {
    /*
     * Silnejšie než „obsahuje slovo nevieme": to by prešlo aj vtedy, keby
     * pilulka slovo napísala vedľa nuly.
     */
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      const markup = pill({ value, suffix: '%' });
      const text = markup.replace(/<[^>]*>/g, '');
      expect(ANY_DIGIT.test(text), `${String(value)} → ${text}`).toBe(false);
      expect(markup).toContain('data-delta="unknown"');
    }
  });

  it('neznáma zmena nesie pomlčku, slovo a neutrálny tón (tri kanály)', () => {
    const markup = pill({ value: null });
    expect(markup).toContain(KPI_UNKNOWN);
    expect(markup).toContain('zmenu nevieme');
    expect(attr(markup, 'data-tone')).toBe('idle');
    expect(markup).toContain(DELTA_UNKNOWN_TITLE);
  });

  it('vlastná veta prebije predvolené priznanie', () => {
    const markup = pill({ value: null, title: 'Predchádzajúce okno sa nesťahovalo.' });
    expect(markup).toContain('Predchádzajúce okno sa nesťahovalo.');
    expect(markup).not.toContain(DELTA_UNKNOWN_TITLE);
  });

  it('zmeraná nula je „bez zmeny 0" — pozitívne dvojča k neznámej zmene', () => {
    const markup = pill({ value: 0, suffix: '%' });
    expect(markup).toContain('bez zmeny');
    expect(markup).toContain('data-delta="flat"');
    expect(markup.replace(/<[^>]*>/g, '')).toContain('0 %');
  });

  it('nula nedostane znamienko — „+0" vyzerá ako pohyb, ktorý sa nestal', () => {
    expect(formatDeltaSk(0)).toBe('0');
    expect(formatDeltaSk(-0)).toBe('0');
  });

  it('smer sa určuje z čísla, KTORÉ JE VIDIEŤ', () => {
    /* +0,4 pri nule desatinných miest je „bez zmeny 0", nie „nárast +0". */
    const markup = pill({ value: 0.4, digits: 0 });
    expect(markup).toContain('data-delta="flat"');
    expect(markup).toContain('bez zmeny');
    expect(markup.replace(/<[^>]*>/g, '')).not.toContain('+0');
    /* Pozitívne dvojča: s jedným desatinným miestom už nárast VIDNO. */
    const finer = pill({ value: 0.4, digits: 1 });
    expect(finer).toContain('data-delta="up"');
    expect(finer.replace(/<[^>]*>/g, '')).toContain('+0,4');
  });

  it('znamienko mínus je typografické U+2212, nie spojovník', () => {
    expect(formatDeltaSk(-7)).toBe('−7');
    expect(formatDeltaSk(-7)).not.toContain('-');
  });

  it('slovenské tisícky a desatinná čiarka', () => {
    expect(formatDeltaSk(1240)).toBe('+1 240');
    expect(formatDeltaSk(-1240.5, 1)).toBe('−1 240,5');
    expect(formatDeltaSk(3.456, 2)).toBe('+3,46');
  });

  it('jednotka sa pripojí a pilulka sa nezlomí', () => {
    expect(pill({ value: 12, suffix: '%' }).replace(/<[^>]*>/g, '')).toContain('+12 %');
    expect(KPI_RULES).toMatch(/\.delta\s*\{[^}]*white-space:\s*nowrap/);
  });
});

describe('DeltaPill — rast sám osebe nie je dobrá správa', () => {
  it('bez zadaného zmyslu pilulka NEFARBÍ ani pri jednoznačnom smere', () => {
    for (const value of [12, -12]) {
      expect(attr(pill({ value }), 'data-tone'), String(value)).toBe('idle');
    }
    /* A pritom smer aj slovo hovorí — nefarbenie nie je mlčanie. */
    expect(pill({ value: 12 })).toContain('data-delta="up"');
    expect(pill({ value: 12 })).toContain('nárast');
  });

  it('zmysel zapne farbu a rešpektuje obrátený význam', () => {
    const cases: ReadonlyArray<[DeltaSense, number, string]> = [
      ['rise-good', 12, 'good'],
      ['rise-good', -12, 'critical'],
      ['rise-bad', 12, 'critical'],
      ['rise-bad', -12, 'good'],
    ];
    for (const [sense, value, tone] of cases) {
      expect(attr(pill({ value, sense }), 'data-tone'), `${sense} ${String(value)}`).toBe(tone);
    }
  });

  it('„bez zmeny" a „nevieme" sa nefarbia ani pri zadanom zmysle', () => {
    for (const sense of ['rise-good', 'rise-bad'] as const) {
      expect(deltaTone('flat', sense)).toBe('idle');
      expect(deltaTone('unknown', sense)).toBe('idle');
    }
  });

  it('každý zmysel má hodnotenie pre každý stav (mapa nie je dierava)', () => {
    for (const state of DELTA_STATES) {
      for (const sense of ['rise-good', 'rise-bad', 'neutral'] as const) {
        expect(deltaMeaning(state, sense).length, `${state}/${sense}`).toBeGreaterThan(0);
      }
    }
  });

  it('CSS má pravidlo pre oba farebné tóny a pre neutrálny základ', () => {
    expect(KPI_RULES).toMatch(/\.delta\[data-tone='good'\]/);
    expect(KPI_RULES).toMatch(/\.delta\[data-tone='critical'\]/);
    expect(KPI_RULES).toMatch(/\.delta\s*\{[^}]*var\(--st-idle-ink\)/);
  });
});

describe('DeltaPill — tri kanály má KAŽDÝ stav', () => {
  it('štyri stavy, štyri rôzne slová a ani jedno prázdne', () => {
    expect(DELTA_STATES.length).toBe(4);
    const words = DELTA_STATES.map((s) => DELTA_WORD[s]);
    expect(new Set(words).size).toBe(4);
    for (const word of words) expect(word.length).toBeGreaterThan(0);
  });

  it('slovo je v HTML, nie len v atribúte', () => {
    const rendered: ReadonlyArray<[DeltaState, string]> = [
      ['up', pill({ value: 5 })],
      ['down', pill({ value: -5 })],
      ['flat', pill({ value: 0 })],
      ['unknown', pill({ value: null })],
    ];
    for (const [state, markup] of rendered) {
      const text = markup.replace(/<[^>]*>/g, '');
      expect(text, state).toContain(DELTA_WORD[state]);
    }
  });

  it('značka je ikona zo sady, pri „nevieme" pomlčka — a nikdy nič', () => {
    for (const state of DELTA_STATES) {
      const icon = DELTA_ICON[state];
      if (state === 'unknown') {
        expect(icon).toBeNull();
        continue;
      }
      expect(icon).not.toBeNull();
      expect(ICON_NAMES, state).toContain(icon);
    }
    /* Tri známe stavy majú tri RÔZNE šípky. */
    const icons = ['up', 'down', 'flat'].map((s) => DELTA_ICON[s as DeltaState]);
    expect(new Set(icons).size).toBe(3);
  });

  it('slovo sa nedá vypnúť — pilulka nemá „compact" ani podobný prepínač', () => {
    expect(DELTA_CODE).not.toMatch(/compact|hideWord|wordless/);
  });

  it('nekonečno a NaN sú „nevieme", nie „bez zmeny"', () => {
    expect(deltaState(Number.NaN)).toBe('unknown');
    expect(deltaState(Number.POSITIVE_INFINITY)).toBe('unknown');
    expect(deltaState(Number.NEGATIVE_INFINITY)).toBe('unknown');
    /* Pozitívne dvojča: skutočná nula je `flat`. */
    expect(deltaState(0)).toBe('flat');
    expect(roundDelta(Number.NaN)).toBeNull();
  });
});

/* ══════════════════ D. BarList — rebrík s priznaniami ═════════════════════ */

const TOP: readonly BarListItem[] = [
  { key: 'a', label: 'A · Náramok', value: 120 },
  { key: 'b', label: 'B · Prsteň', value: 30 },
];

describe('BarList — porovnanie medzi položkami', () => {
  it('vykreslí popis, číslo a pás pre každý riadok', () => {
    const markup = bars({ items: TOP, testId: 'rebrik' });
    expect(markup).toContain('A · Náramok');
    expect(markup).toContain('120');
    expect(markup).toContain(chartStyles.rowBarFill);
    expect((markup.match(/data-testid="bar-list-row"/g) ?? []).length).toBe(2);
    expect(attr(markup, 'data-testid')).toBe('rebrik');
  });

  it('mierka je jedna a základňa nula — najväčší má 100 %', () => {
    const markup = bars({ items: TOP });
    /* Mierka je najbližšie okrúhle číslo NAD najväčšou hodnotou (`chartScaleMax`),
       teda 200: 120 → 60 %, 30 → 15 %. Podiely držia pomer 4 : 1. */
    expect(markup).toContain('width:60%');
    expect(markup).toContain('width:15%');
  });

  it('dva rebríky sa dajú porovnať cez JEDNU mierku', () => {
    const flop: readonly BarListItem[] = [{ key: 'z', label: 'Z', value: 30 }];
    const shared = barListBars(barListInputs(TOP), barListInputs(flop));
    const alone = bars({ items: flop });
    const together = bars({ items: flop, bars: shared });
    /* Sám si ten istý riadok vyškáluje na 60 % (mierka 50), v spoločnej
       mierke má 15 %. Bez toho by najslabší produkt flopu vyzeral ako
       najpredávanejší — celý dôvod, prečo mierka chodí zvonku. */
    expect(alone).toContain('width:60%');
    expect(together).toContain('width:15%');
    expect(shared.get('z')?.unknown).toBe(false);
  });

  it('položka BEZ merania dostane pomlčku, šrafovanie a SLOVO', () => {
    const markup = bars({
      items: [{ key: 'a', label: 'A', value: 120 }, { key: 'b', label: 'B', value: null }],
    });
    expect(markup).toContain(KPI_UNKNOWN);
    expect(markup).toContain(chartStyles.rowBarUnknown);
    expect(markup).toContain('nevieme');
    expect(markup).toContain('data-unknown="ano"');
    /* Pozitívne dvojča: meraný riadok šrafovaný NIE JE. */
    expect(markup).toContain(chartStyles.rowBarFill);
  });

  it('položka bez merania NEDOSTANE nulový pás', () => {
    const markup = bars({ items: [{ key: 'b', label: 'B', value: null }] });
    expect(markup).not.toContain('width:0%');
    expect(markup).toContain(chartStyles.rowBarUnknown);
  });

  it('zmeraná NULA dostane pás, nie šrafovanie', () => {
    /* Nula je odpoveď: „za okno sa nepredalo nič" je meraný fakt, keď je
       okno dočítané. Zliať ju s „nevieme" by informáciu zahodilo. */
    const markup = bars({ items: [{ key: 'a', label: 'A', value: 0 }] });
    expect(markup).toContain(chartStyles.rowBarFill);
    expect(markup).not.toContain(chartStyles.rowBarUnknown);
    expect(markup).toContain('data-unknown="nie"');
  });

  it('dolná hranica nula sa premení na pomlčku AJ v páse', () => {
    /*
     * Tu sa najľahšie rozíde číslo a pás: `≥ 0` sa nevykreslí, takže riadok
     * ukáže pomlčku — a pás musí ísť za ňou, nie za surovou nulou.
     */
    const markup = bars({ items: [{ key: 'a', label: 'A', value: 0, lowerBound: true }] });
    expect(markup).toContain(KPI_UNKNOWN);
    expect(markup).not.toContain(KPI_LOWER_BOUND);
    expect(markup).toContain(chartStyles.rowBarUnknown);
    expect(markup).toContain('data-unknown="ano"');
  });

  it('dolná hranica nad nulou je hodnota — číslo so ≥ a normálny pás', () => {
    const markup = bars({ items: [{ key: 'a', label: 'A', value: 12, lowerBound: true }] });
    expect(markup).toContain('≥ 12');
    expect(markup).toContain('data-lower-bound="true"');
    expect(markup).toContain(chartStyles.rowBarFill);
  });

  it('slovo pri pomlčke sa nedá vypnúť ani prázdnou poznámkou', () => {
    /* `note={null}` je najbližšia cesta k tichému riadku — tretí kanál sa
       doplní aj tak. */
    const markup = bars({ items: [{ key: 'b', label: 'B', value: null, note: null }] });
    expect(markup).toContain('nevieme');
  });

  it('vlastná poznámka prebije predvolené slovo', () => {
    const markup = bars({
      items: [{ key: 'b', label: 'B', value: null, note: 'produkt ešte nie je obohatený' }],
    });
    expect(markup).toContain('produkt ešte nie je obohatený');
  });

  it('veta o položkách bez merania je legenda celého rebríka', () => {
    const withGap = bars({
      items: [{ key: 'a', label: 'A', value: 5 }, { key: 'b', label: 'B', value: null }],
    });
    expect(withGap).toContain('data-testid="bar-list-unknown"');
    expect(withGap).toContain('Bez merania 1 z 2');
    /* Bez medzery sa veta NEKRESLÍ — prázdna veta je šum. */
    expect(bars({ items: TOP })).not.toContain('data-testid="bar-list-unknown"');
  });

  it('veta počíta slovenské tvary a pri nule mlčí', () => {
    expect(barListUnknownSentence(0, 10)).toBeNull();
    expect(barListUnknownSentence(1, 1)).toContain('položky');
    expect(barListUnknownSentence(2, 5)).toContain('položiek');
    expect(barListUnknownSentence(Number.NaN, 5)).toBeNull();
  });

  it('prázdny zoznam povie vetu, alebo nekreslí nič', () => {
    expect(bars({ items: [], empty: 'Za toto okno sa nepredalo nič.' })).toContain(
      'Za toto okno sa nepredalo nič.',
    );
    expect(bars({ items: [] })).toBe('');
  });

  it('rebrík nekreslí kategorickou paletou — je to JEDNA séria', () => {
    /* Osem farieb by tvrdilo osem kategórií; veľkosť sa kreslí rampou. */
    expect(BAR_CODE).not.toMatch(/--chart-[0-9]/);
    expect(KPI_RULES).not.toMatch(/--chart-[0-9]/);
    /* A pás si nekreslí sám — berie `RowBar`, teda jedno šrafovanie v appke. */
    expect(BAR_CODE).toContain('RowBar');
    expect(KPI_RULES).not.toContain('repeating-linear-gradient');
  });
});

/* ════════════════ E. CSS modul: D143, D147 a mŕtve triedy ═════════════════ */

describe('kpi.module.css — vzhľad vedľa komponentu, farby len z tokenov', () => {
  it('ani jeden surový hex', () => {
    expect(KPI_RULES.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it('ani jedna rgba() v žiadnej podobe (D147)', () => {
    expect(KPI_RULES).not.toMatch(/rgba?\(/);
  });

  it('žiadny !important', () => {
    expect(KPI_RULES).not.toContain('!important');
  });

  it('každá farba je token', () => {
    const colors = KPI_RULES.match(/(?:^|[\s:])(?:color|background|border-color):[^;]+;/g) ?? [];
    expect(colors.length).toBeGreaterThan(5);
    for (const decl of colors) {
      expect(decl, decl).toMatch(/var\(--/);
    }
  });

  it('tri komponenty nesú svoj vzhľad TU, nie v globals.css (D143)', () => {
    for (const [name, src] of [
      ['StatTile', STAT_TILE_CODE],
      ['DeltaPill', DELTA_CODE],
      ['BarList', BAR_CODE],
    ] as const) {
      expect(src, name).toContain("from '@/components/ui/kpi.module.css'");
    }
  });

  it('žiadna trieda v CSS nie je mŕtva a žiadna v HTML nie je bez pravidla', () => {
    /*
     * §A hlavičky, obe strany. Selektor bez nositeľa nekreslí nič (a vyzerá
     * ako hotová práca); trieda bez pravidla je tichý omyl.
     */
    const inCss = new Set(
      [...KPI_RULES.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1] as string),
    );
    const inTsx = new Set(
      [...`${STAT_TILE_CODE}${DELTA_CODE}${BAR_CODE}`.matchAll(/styles\.([A-Za-z]\w*)/g)].map(
        (m) => m[1] as string,
      ),
    );
    expect(inCss.size).toBeGreaterThan(10);
    expect([...inCss].filter((c) => !inTsx.has(c)).sort()).toEqual([]);
    expect([...inTsx].filter((c) => !inCss.has(c)).sort()).toEqual([]);
  });

  it('lucide-react sa v skupine neobjaví (D146)', () => {
    for (const src of [STAT_TILE_CODE, DELTA_CODE, BAR_CODE, KPI_CODE]) {
      expect(src).not.toContain('lucide');
    }
    /* Ikonové propy berú `ReactNode`, nie typ z knižnice. */
    expect(STAT_TILE_CODE).toMatch(/icon\?:\s*ReactNode/);
  });
});
