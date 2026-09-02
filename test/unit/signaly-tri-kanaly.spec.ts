/**
 * Aura Zľavy — SIGNÁLNA SKUPINA: STAV NIKDY NIE JE LEN FARBA.
 *
 * Štyri komponenty (`ToneBadge`, `StatusPill`, `BudgetMeter`, `Chip`) sú jediné
 * miesta, kde appka kreslí stav ako signál. Kontrakt V6 (§4 bod 3) ich označil
 * za NEDOTKNUTEĽNÉ: *„redizajn ich smie spraviť krajšími, nie tichšími"*.
 * Tento súbor je to slovo „tichšími" v podobe, ktorá sa dá spustiť.
 *
 * ČO SA TU MERIA A PREČO PRÁVE TAK
 * --------------------------------
 * Meria sa VYKRESLENÝ markup (`renderToStaticMarkup`), nie zdroj. Grep nad
 * komponentom by potvrdil, že v ňom `<Icon` stojí — nie že sa nakreslil práve
 * v tom stave, ktorý má o sebe niečo tvrdiť. Repo má na to zapísanú vlastnú
 * skúsenosť dvakrát: mutácia „odstránená značka pri ponechanom importe"
 * prešla grepovým testom zeleno (`ikony.spec.ts`) a D121 fungoval v modeli,
 * kým server posielal `unitsSold: 0` — *„trojstavovosť overuj na TELE
 * ODPOVEDE, nie len na modeli"*.
 *
 * Parser aj definícia značky sú spoločné (`test/helpers/znacky.ts`); ten
 * pomocník však vyberá hostiteľov po triedach `.sig` / `.flag` / `.state`,
 * ktoré signálna skupina NEPOUŽÍVA — jej vzhľad je v CSS moduloch a triedy sú
 * hašované. Hostiteľ sa tu preto hľadá po ATRIBÚTOCH (`data-tone`,
 * `aria-pressed`, `data-selected`), čo je aj dôvod, prečo `ToneBadge` vo V6a
 * dostal `data-tone` popri skladanej triede: tón sa má dať zmerať jedným
 * dotazom.
 *
 * MUTÁCIE, KTORÉ TENTO SÚBOR MUSÍ ZČERVENAŤ
 * -----------------------------------------
 *  1. odstránené `<Icon>` z ktoréhokoľvek zo štyroch komponentov,
 *  2. odstránená náhrada slova v `ui/signals.ts` (`signalWord`, `signalLabel`)
 *     — badge s prázdnym popisom potom nakreslí len farbu a značku,
 *  3. `SIGNAL_WORD_FALLBACK` prepísaný na pomlčku — priznanie o DÁTACH (I11)
 *     a defekt KÓDU by splynuli,
 *  4. zapnutý čip bez značky (späť na predlohu, kde ho odlišuje len výplň),
 *  5. `BUDGET_LEVEL_ICON.full` zmenený na značku tónu `attention` — „blíži sa
 *     strop" a „strop vyčerpaný" by mali rovnakú farbu AJ rovnakú značku,
 *  6. vyčerpaný rozpočet prefarbený na `critical` (K2).
 *
 * Vlastník: V6a, signálna skupina.
 */
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BudgetMeter } from '@/components/ui/BudgetMeter';
import { Chip, FilterChip } from '@/components/ui/Chip';
import { BUDGET_LEVEL_WORD } from '@/components/ui/primitives';
import {
  SIGNAL_WORDLESS_ATTR,
  SIGNAL_WORD_FALLBACK,
  chipCountLabel,
  chipRemoveLabel,
  isWordless,
  signalLabel,
  signalWord,
} from '@/components/ui/signals';
import { StatusPill } from '@/components/ui/StatusPill';
import { TONE_ICON, ToneBadge, type StatusTone } from '@/components/ui/ToneBadge';
import { NEVIEME } from '@/lib/ui/product-label';

import {
  NAJKRATSIE_SLOVO,
  pocetZnaciek,
  text,
  uzly,
  znackaJePrva,
  type Uzol,
} from '../helpers/znacky';

const render = (el: ReactElement): string => renderToStaticMarkup(el);

/** Handler, ktorý nič nerobí — kliknutie tu nikto nemeria, len jeho existenciu. */
const nic = (): void => undefined;

/** Päť tónov appky. Zoznam je doslovný, aby test padol aj pri pribratí šiesteho. */
const TONY: readonly StatusTone[] = ['critical', 'attention', 'progress', 'good', 'idle'];

/**
 * Uzol podľa `data-testid`. Poistka na počet je zámerná: bez nej by tvrdenia
 * bežali nad `undefined` a rozbitý parser by svietil zeleno.
 */
function uzol(html: string, testId: string): Uzol {
  const najdene = uzly(html).filter((u) => u.atributy['data-testid'] === testId);
  expect(najdene.length, `uzol "${testId}" sa v markupe nenašiel práve raz`).toBe(1);
  return najdene[0]!;
}

/** Uzol podľa atribútu a jeho hodnoty — pre koreň bez `data-testid`. */
function uzolPodlaAtributu(html: string, atribut: string, hodnota: string): Uzol {
  const najdene = uzly(html).filter((u) => u.atributy[atribut] === hodnota);
  expect(najdene.length, `uzol s ${atribut}="${hodnota}" sa nenašiel práve raz`).toBe(1);
  return najdene[0]!;
}

/**
 * Koreň badge.
 *
 * `ToneBadge` prop `testId` NEMÁ a nedostane ho: `data-testid` mu chodí ako
 * hyphenovaný atribút cez `...rest` (v JSX to TypeScript pustí, v
 * `createElement` nie) a druhá cesta k tej istej veci by bola dvojník. Koreň
 * sa preto adresuje tým, čo naň V6a pridalo — `data-tone`.
 */
function badge(html: string, tone: StatusTone): Uzol {
  return uzolPodlaAtributu(html, 'data-tone', tone);
}

/** Slovo, ktoré človek prečíta. Značky sa pri čítaní odstránia. */
function slovo(u: Uzol): string {
  return text(u);
}

/* ════════════ 0. Poistka: meranie vôbec niečo meria ══════════════════════ */

describe('poistka merania', () => {
  it('render vracia markup a parser ho rozreže na uzly', () => {
    /*
     * Bez tejto poistky by každé tvrdenie nižšie svietilo zeleno nad prázdnym
     * reťazcom — tak vznikol zelený test o troch mŕtvych selektoroch
     * (19. 8. 2026) a hlavička `test/helpers/znacky.ts` to má ako bod 7.
     */
    const html = render(createElement(ToneBadge, { tone: 'good', children: 'Pripojené' }));
    expect(html.length).toBeGreaterThan(40);
    expect(uzly(html).length).toBeGreaterThan(1);
    expect(pocetZnaciek(badge(html, 'good'))).toBe(1);
  });

  it('rodina tónov je päťčlenná a každý tón má značku', () => {
    expect(TONY.length).toBe(5);
    expect(Object.keys(TONE_ICON).sort()).toEqual([...TONY].sort());
  });
});

/* ════════════ 1. Tretí kanál ako čistá logika (`ui/signals.ts`) ══════════ */

describe('isWordless — čo sa NEPOČÍTA za slovo', () => {
  it('prázdno, prázdny reťazec a biele miesta slovo nie sú', () => {
    expect(isWordless(null)).toBe(true);
    expect(isWordless(undefined)).toBe(true);
    expect(isWordless('')).toBe(true);
    expect(isWordless('   ')).toBe(true);
    // Nezlomiteľná medzera a znaky nulovej šírky: reťazec neprázdny, na
    // obrazovke nič. `''.trim()` na ne nestačí.
    expect(isWordless('\u00a0')).toBe(true);
    expect(isWordless('\u200b\ufeff')).toBe(true);
  });

  it('`false &&` a `? :` z JSX sú najčastejší tvar chýbajúceho slova', () => {
    expect(isWordless(false)).toBe(true);
    expect(isWordless(true)).toBe(true);
  });

  it('pole samých prázdnych detí je prázdne, pole s jedným slovom nie', () => {
    expect(isWordless([])).toBe(true);
    expect(isWordless([null, '', false])).toBe(true);
    expect(isWordless([null, 'Beží'])).toBe(false);
  });

  it('nula je hodnota, NaN nie je', () => {
    expect(isWordless(0)).toBe(false);
    expect(isWordless(Number.NaN)).toBe(true);
    expect(isWordless(Number.POSITIVE_INFINITY)).toBe(true);
  });

  it('element platí za obsah — jeho vnútro sa staticky prečítať nedá', () => {
    // Vedomá hranica poistky. Značku bez slova preto chytá až meranie nad
    // markupom (bloky 2–7), nie táto funkcia.
    expect(isWordless(createElement('strong', null, 'Zapisuje sa'))).toBe(false);
  });
});

describe('náhradné slovo je priznanie, nie doménový výraz', () => {
  it('má aspoň toľko znakov, aby sa počítalo za slovo', () => {
    expect(SIGNAL_WORD_FALLBACK.length).toBeGreaterThanOrEqual(NAJKRATSIE_SLOVO);
    expect(SIGNAL_WORD_FALLBACK.trim()).toBe(SIGNAL_WORD_FALLBACK);
  });

  it('NIE JE pomlčka — priznanie o dátach a defekt kódu sa nesmú zliať', () => {
    /*
     * Pomlčka U+2014 znamená „túto hodnotu appka nemeria" (I11, §4 bod 1
     * kontraktu V6). Chýbajúce slovo pri stave je naopak chyba v kóde. Keby
     * oba hovorili tým istým znakom, defekt by sa schoval za invariant.
     */
    expect(SIGNAL_WORD_FALLBACK).not.toBe(NEVIEME);
    expect(SIGNAL_WORD_FALLBACK).not.toContain(NEVIEME);
  });

  it('nepredstiera platný stav', () => {
    // Rovnaký úsudok ako `FALLBACK_ICON` v `ui/Icon.tsx`: náhrada je otáznik,
    // nie fajka. Slová stavov appky sa tu preto nesmú objaviť.
    for (const slovoUrovne of Object.values(BUDGET_LEVEL_WORD)) {
      expect(SIGNAL_WORD_FALLBACK).not.toBe(slovoUrovne);
    }
  });

  it('signalWord a signalLabel dopĺňajú to isté', () => {
    expect(signalWord('Pripojené')).toEqual({ word: 'Pripojené', wordless: false });
    expect(signalWord('')).toEqual({ word: SIGNAL_WORD_FALLBACK, wordless: true });
    expect(signalLabel('Zápisy dnes')).toEqual({ label: 'Zápisy dnes', wordless: false });
    expect(signalLabel('  ')).toEqual({ label: SIGNAL_WORD_FALLBACK, wordless: true });
  });
});

/* ════════════════════════ 2. ToneBadge ═══════════════════════════════════ */

describe('ToneBadge — farba + značka + slovo pri každom tóne', () => {
  for (const tone of TONY) {
    it(`tón ${tone} nesie všetky tri kanály`, () => {
      const html = render(createElement(ToneBadge, { tone, children: 'Zapisuje sa' }));
      const u = badge(html, tone);
      // FARBA: tón je na koreni mechanicky AJ v skladanej triede, ktorú kreslí
      // `globals.css` a merajú `paleta.spec.ts` a `mrtve-triedy.spec.ts`.
      expect(u.triedy).toContain('ovl-badge');
      expect(u.triedy).toContain(`ovl-badge--${tone}`);
      // ZNAČKA: práve jedna a pred slovom.
      expect(pocetZnaciek(u), 'značka nie je práve jedna').toBe(1);
      expect(znackaJePrva(u), 'značka stojí za slovom, nie pred ním').toBe(true);
      // SLOVO.
      expect(slovo(u).length).toBeGreaterThanOrEqual(NAJKRATSIE_SLOVO);
      expect(u.atributy[SIGNAL_WORDLESS_ATTR]).toBeUndefined();
    });
  }

  it('prázdny popis nekreslí farebnú pilulku bez slova', () => {
    const html = render(createElement(ToneBadge, { tone: 'critical', children: '' }));
    const u = badge(html, 'critical');
    expect(pocetZnaciek(u)).toBe(1);
    expect(slovo(u)).toBe(SIGNAL_WORD_FALLBACK);
    expect(u.atributy[SIGNAL_WORDLESS_ATTR], 'defekt o sebe nepovedal').toBe('true');
  });

  it('vlastná značka prebije značku tónu, slovo zostáva', () => {
    const svoja = render(
      createElement(ToneBadge, { tone: 'idle', icon: 'lock', children: 'Zamknuté' }),
    );
    const tonova = render(createElement(ToneBadge, { tone: 'idle', children: 'Zamknuté' }));
    expect(pocetZnaciek(badge(svoja, 'idle'))).toBe(1);
    expect(svoja, 'prebitie značky sa nekreslí').not.toBe(tonova);
    expect(slovo(badge(svoja, 'idle'))).toBe('Zamknuté');
  });
});

/* ════════════════════════ 3. StatusPill ══════════════════════════════════ */

describe('StatusPill — popis je platba, tón ju len zosilňuje', () => {
  for (const tone of TONY) {
    it(`tón ${tone} nesie všetky tri kanály`, () => {
      const html = render(
        createElement(StatusPill, {
          tone,
          label: 'Pripojené',
          detail: 'sperky-eshop.sk',
          testId: 'pill',
        }),
      );
      const u = uzol(html, 'pill');
      expect(u.atributy['data-tone']).toBe(tone);
      expect(pocetZnaciek(u)).toBe(1);
      expect(slovo(u)).toContain('Pripojené');
      expect(u.atributy[SIGNAL_WORDLESS_ATTR]).toBeUndefined();
    });
  }

  it('prázdny názov stavu nekreslí krúžok s adresou pod ním', () => {
    const html = render(
      createElement(StatusPill, { tone: 'good', label: '', detail: 'localhost', testId: 'pill' }),
    );
    const u = uzol(html, 'pill');
    expect(pocetZnaciek(u)).toBe(1);
    expect(slovo(u)).toContain(SIGNAL_WORD_FALLBACK);
    expect(u.atributy[SIGNAL_WORDLESS_ATTR]).toBe('true');
  });

  it('detail sa nekreslí, keď nie je — a nikdy sa neskracuje', () => {
    const bez = render(createElement(StatusPill, { tone: 'idle', label: 'Nepripojené' }));
    expect(text(bez)).toBe('Nepripojené');
    const dlha = 'velmi-dlha-testovacia-domena-ktora-sa-ma-zalomit.example';
    const s = render(
      createElement(StatusPill, { tone: 'idle', label: 'Nepripojené', detail: dlha }),
    );
    expect(s).toContain(dlha);
    expect(s, 'skrátená doména vyzerá presne ako tá správna').not.toContain('…');
  });
});

/* ════════════════════════ 4. BudgetMeter ═════════════════════════════════ */

describe('BudgetMeter — prúžok, ktorý zožltne, musí aj povedať prečo', () => {
  const meter = (spent: number, limit: number): string =>
    render(createElement(BudgetMeter, { label: 'Zápisy dnes', spent, limit, testId: 'm' }));

  it('pokojný prúžok mlčí — a nemá ani farbu stavu (výnimka s dôvodom)', () => {
    /*
     * Jediná výnimka z pravidla „tónovaný uzol má značku" v tomto súbore. Je
     * legálna PRETO, že pokojný prúžok nemá ani prvý kanál: pre
     * `data-tone="idle"` nemá `primitives.module.css` žiadnu stavovú výplň
     * (pravidlá existujú len pre `attention` a `critical`). Kanál, ktorý
     * nikde nezasvieti, netreba zdvojovať. Kto pridá výplň pre `idle`, musí
     * pridať aj slovo — a tvrdenie o pokojnom prúžku mu spadne.
     */
    const u = uzol(meter(0, 200), 'm');
    expect(u.atributy['data-level']).toBe('calm');
    expect(u.atributy['data-tone']).toBe('idle');
    expect(pocetZnaciek(u)).toBe(0);
    expect(slovo(u)).toContain('Zápisy dnes');
    for (const slovoUrovne of [BUDGET_LEVEL_WORD.warn, BUDGET_LEVEL_WORD.full]) {
      expect(slovo(u)).not.toContain(slovoUrovne);
    }
  });

  it('blížiaci sa strop má farbu, značku aj slovo', () => {
    const u = uzol(meter(160, 200), 'm');
    expect(u.atributy['data-level']).toBe('warn');
    expect(u.atributy['data-tone']).toBe('attention');
    expect(pocetZnaciek(u)).toBe(1);
    expect(slovo(u)).toContain(BUDGET_LEVEL_WORD.warn);
  });

  it('vyčerpaný strop NIE JE červený (K2), ale povie to slovom', () => {
    const u = uzol(meter(200, 200), 'm');
    expect(u.atributy['data-level']).toBe('full');
    expect(u.atributy['data-tone'], 'vyčerpaný rozpočet nie je chyba').toBe('attention');
    expect(pocetZnaciek(u)).toBe(1);
    expect(slovo(u)).toContain(BUDGET_LEVEL_WORD.full);
  });

  it('„blíži sa" a „vyčerpané" sa líšia aj VYKRESLENOU značkou', () => {
    /*
     * Oba stavy majú ten istý tón, takže farba ich nerozlíši. Meria sa
     * vykreslené `<svg>`, nie mapa `BUDGET_LEVEL_ICON`: tú testuje
     * `ui-primitives.spec.ts` a mapa môže byť správna, kým komponent kreslí
     * niečo iné.
     */
    const znacka = (html: string): string => {
      const m = /<svg\b[^>]*class="[^"]*\bovl-ic\b[\s\S]*?<\/svg>/.exec(html);
      expect(m, 'v prúžku nie je značka').not.toBeNull();
      return m![0];
    };
    expect(znacka(meter(160, 200))).not.toBe(znacka(meter(200, 200)));
  });

  it('nekonfigurovaný strop hlási plno, nie voľno', () => {
    // Predloha (`ProgressBar`) na „no data" nekreslí prúžok vôbec; tu je
    // pesimistický smer vedomý — appka nesmie sľúbiť kapacitu, o ktorej nevie.
    const u = uzol(meter(0, 0), 'm');
    expect(u.atributy['data-level']).toBe('full');
    expect(slovo(u)).toContain(BUDGET_LEVEL_WORD.full);
  });

  it('prázdny popis nenechá čítačke dvojbodku bez predmetu', () => {
    const html = render(
      createElement(BudgetMeter, { label: '', spent: 160, limit: 200, testId: 'm' }),
    );
    const u = uzol(html, 'm');
    expect(slovo(u)).toContain(SIGNAL_WORD_FALLBACK);
    expect(u.atributy[SIGNAL_WORDLESS_ATTR]).toBe('true');
    const track = uzolPodlaAtributu(html, 'role', 'progressbar');
    expect(track.atributy['aria-valuetext']).toContain(SIGNAL_WORD_FALLBACK);
    expect(track.atributy['aria-valuetext']?.startsWith(':')).toBe(false);
  });
});

/* ═════════════════════════ 5. Chip — prepínač ════════════════════════════ */

describe('Chip — zapnuté sa nelíši len výplňou', () => {
  it('zapnutý čip nesie značku, `aria-pressed` aj slovo', () => {
    const html = render(createElement(Chip, { label: 'Z filtra', active: true, testId: 'c' }));
    const u = uzol(html, 'c');
    expect(u.tag).toBe('button');
    expect(u.atributy['aria-pressed']).toBe('true');
    expect(pocetZnaciek(u), 'zapnutý čip bez značky = stav len farbou').toBe(1);
    expect(znackaJePrva(u)).toBe(true);
    expect(slovo(u)).toContain('Z filtra');
  });

  it('vypnutý čip značku nemá — a nemá ani výplň', () => {
    // Neprítomnosť značky je druhý kanál k neprítomnosti výplne. Ten istý
    // úsudok ako pokojná úroveň prúžku: pokojný stav sa nekomentuje.
    const u = uzol(render(createElement(Chip, { label: 'Z filtra', testId: 'c' })), 'c');
    expect(u.atributy['aria-pressed']).toBe('false');
    expect(pocetZnaciek(u)).toBe(0);
    expect(slovo(u)).toContain('Z filtra');
  });

  it('zapnutý a vypnutý čip sa líšia viac než triedou', () => {
    const on = uzol(
      render(createElement(Chip, { label: 'Z filtra', active: true, testId: 'c' })),
      'c',
    );
    const off = uzol(render(createElement(Chip, { label: 'Z filtra', testId: 'c' })), 'c');
    expect(pocetZnaciek(on) - pocetZnaciek(off)).toBe(1);
    expect(on.atributy['aria-pressed']).not.toBe(off.atributy['aria-pressed']);
  });

  it('`aria-pressed` sa odvodzuje z `active`, nedá sa poslať zvonku', () => {
    // Prop je odstránený typom (`Omit`); tu sa tvrdí dôsledok — čip nemôže
    // vyzerať zapnuto a čítačke sa ohlásiť ako vypnutý.
    const html = render(createElement(Chip, { label: 'Z filtra', active: true, testId: 'c' }));
    expect((html.match(/aria-pressed="/g) ?? []).length).toBe(1);
  });

  it('nezmeraný počet je pomlčka, nie nula (I11)', () => {
    const nula = uzol(render(createElement(Chip, { label: 'Beží', count: 0, testId: 'c' })), 'c');
    expect(slovo(nula)).toContain('0');
    const nevieme = uzol(
      render(createElement(Chip, { label: 'Beží', count: null, testId: 'c' })),
      'c',
    );
    expect(slovo(nevieme)).toContain(NEVIEME);
    expect(slovo(nevieme), 'nezmerané sa dopočítalo na nulu').not.toContain('0');
    expect(chipCountLabel(null)).toBe(NEVIEME);
  });

  it('bez propu `count` sa nekreslí ani číslo, ani pomlčka', () => {
    // Tri rôzne veci: „12", „nezmerané" a „počet sem nepatrí".
    const u = uzol(render(createElement(Chip, { label: 'Beží', testId: 'c' })), 'c');
    expect(slovo(u)).toBe('Beží');
  });

  it('prázdny popis nekreslí klikateľnú farebnú pilulku', () => {
    const u = uzol(render(createElement(Chip, { label: '', active: true, testId: 'c' })), 'c');
    expect(slovo(u)).toBe(SIGNAL_WORD_FALLBACK);
    expect(u.atributy[SIGNAL_WORDLESS_ATTR]).toBe('true');
  });
});

/* ═══════════════════ 6. FilterChip — značka platného filtra ══════════════ */

describe('FilterChip — značka, ktorá sa dá zrušiť', () => {
  it('bez akcií je to text v pilulke, nie tlačidlo', () => {
    const html = render(createElement(FilterChip, { label: 'Kov: striebro', testId: 'f' }));
    const u = uzol(html, 'f');
    expect(u.tag).toBe('span');
    expect(u.atributy['data-selected']).toBe('false');
    expect(html, 'značka bez akcie si pribrala tlačidlo').not.toContain('<button');
    expect(slovo(u)).toBe('Kov: striebro');
  });

  it('platná značka nesie značku aj bez akcie', () => {
    /*
     * Najtichšie možné porušenie: `active` bez `onApply` by nakreslilo tintu
     * (`.tray[data-selected='true']`) a nič viac.
     */
    const u = uzol(
      render(createElement(FilterChip, { label: 'Kov: striebro', active: true, testId: 'f' })),
      'f',
    );
    expect(u.atributy['data-selected']).toBe('true');
    expect(pocetZnaciek(u)).toBe(1);
    expect(znackaJePrva(u)).toBe(true);
  });

  it('s `onApply` sedí `aria-pressed` a značka na tom istom tlačidle', () => {
    const html = render(
      createElement(FilterChip, {
        label: 'Zľavy nad 20 %',
        active: true,
        onApply: nic,
        testId: 'f',
      }),
    );
    const tlacidlo = uzol(html, 'f-apply');
    expect(tlacidlo.tag).toBe('button');
    expect(tlacidlo.atributy['aria-pressed']).toBe('true');
    expect(pocetZnaciek(tlacidlo)).toBe(1);
    expect(znackaJePrva(tlacidlo)).toBe(true);
    expect(slovo(tlacidlo)).toBe('Zľavy nad 20 %');
  });

  it('krížik má slovenské meno s predmetom a vlastnú značku', () => {
    const html = render(
      createElement(FilterChip, { label: 'Kov: striebro', onRemove: nic, testId: 'f' }),
    );
    const krizik = uzol(html, 'f-remove');
    expect(krizik.tag).toBe('button');
    expect(krizik.atributy['aria-label']).toBe(chipRemoveLabel('Kov: striebro'));
    expect(krizik.atributy['aria-label']).toContain('Kov: striebro');
    expect(pocetZnaciek(krizik)).toBe(1);
  });

  it('vlastné meno krížika prebije predvolené', () => {
    // Uložený filter sa ZABÚDA, nie ruší — a taký rozdiel si volajúci musí
    // vedieť vypýtať (`products/CatalogFilters.tsx` ho dnes píše ručne).
    const html = render(
      createElement(FilterChip, {
        label: 'Lacné strieborné',
        onRemove: nic,
        removeLabel: 'Zabudnúť uložený filter Lacné strieborné',
        testId: 'f',
      }),
    );
    expect(uzol(html, 'f-remove').atributy['aria-label']).toContain('Zabudnúť');
  });

  it('prázdny popis nenechá krížik bez predmetu', () => {
    const html = render(createElement(FilterChip, { label: '', onRemove: nic, testId: 'f' }));
    expect(uzol(html, 'f').atributy[SIGNAL_WORDLESS_ATTR]).toBe('true');
    expect(uzol(html, 'f-remove').atributy['aria-label']).toBe(
      chipRemoveLabel(SIGNAL_WORD_FALLBACK),
    );
  });

  it('dlhý popis sa zalomí, nie skráti', () => {
    const dlhy = 'Kategória: náhrdelníky a prívesky zo striebra s riečnymi perlami';
    const html = render(createElement(FilterChip, { label: dlhy, testId: 'f' }));
    expect(slovo(uzol(html, 'f'))).toBe(dlhy);
    expect(html).not.toContain('…');
  });
});

/* ═══════ 7. Pravidlo nad CELOU skupinou — jeden sken, žiadna výnimka ═════ */

describe('nad celou signálnou skupinou: nikde stav vyjadrený len farbou', () => {
  /**
   * Každý stav, ktorý ktorýkoľvek zo štyroch komponentov vie nakresliť.
   *
   * Zoznam je zámerne DOSLOVNÝ a nie generovaný: keď do skupiny pribudne piaty
   * komponent alebo šiesty tón, tento súbor sa nemá len tak dopočítať — niekto
   * sa má rozhodnúť, ako jeho stav znie po slovensky. Tvrdenie o POČTE
   * prípadov je to, čo ho k tomu donúti.
   */
  const PRIPADY: ReadonlyArray<{ kde: string; html: string }> = [
    ...TONY.map((tone) => ({
      kde: `ToneBadge ${tone}`,
      html: render(createElement(ToneBadge, { tone, children: 'Zapisuje sa' })),
    })),
    ...TONY.map((tone) => ({
      kde: `StatusPill ${tone}`,
      html: render(createElement(StatusPill, { tone, label: 'Pripojené' })),
    })),
    ...(
      [
        { spent: 0, uroven: 'calm' },
        { spent: 160, uroven: 'warn' },
        { spent: 200, uroven: 'full' },
      ] as const
    ).map(({ spent, uroven }) => ({
      kde: `BudgetMeter ${uroven}`,
      html: render(
        createElement(BudgetMeter, { label: 'Zápisy dnes', spent, limit: 200 }),
      ),
    })),
    {
      kde: 'Chip zapnutý',
      html: render(createElement(Chip, { label: 'Z filtra', active: true })),
    },
    { kde: 'Chip vypnutý', html: render(createElement(Chip, { label: 'Z filtra' })) },
    {
      kde: 'FilterChip platný',
      html: render(
        createElement(FilterChip, {
          label: 'Kov: striebro',
          active: true,
          onApply: nic,
          onRemove: nic,
        }),
      ),
    },
    {
      kde: 'FilterChip neplatný',
      html: render(createElement(FilterChip, { label: 'Kov: striebro' })),
    },
  ];

  /** Uzly, ktoré o sebe tvrdia stav. Hľadá sa po atribútoch, nie po triedach. */
  function signaly(html: string): Uzol[] {
    return uzly(html).filter(
      (u) =>
        u.atributy['data-tone'] !== undefined ||
        u.atributy['aria-pressed'] !== undefined ||
        u.atributy['data-selected'] !== undefined,
    );
  }

  /**
   * Nesie uzol FARBU stavu, teda kanál, ktorý treba zdvojiť značkou?
   *
   * Jediné „nie" pri tónovanom uzle je pokojný prúžok (`data-level="calm"`):
   * pre `idle` nemá `primitives.module.css` žiadnu stavovú výplň. Rozhoduje sa
   * podľa `data-level`, nie podľa tónu — `ToneBadge` s `idle` tintu MÁ, takže
   * „idle znamená bez farby" by bola nepravda a diera zároveň.
   */
  function farebnyStav(u: Uzol): boolean {
    if (u.atributy['data-tone'] !== undefined) return u.atributy['data-level'] !== 'calm';
    return u.atributy['aria-pressed'] === 'true' || u.atributy['data-selected'] === 'true';
  }

  it('prípadov je presne toľko, koľko stavov skupina pozná', () => {
    expect(PRIPADY.length).toBe(17);
    for (const { kde, html } of PRIPADY) {
      expect(signaly(html).length, `${kde}: žiadny uzol o sebe netvrdí stav`).toBeGreaterThan(0);
    }
  });

  it('každý stavový uzol má SLOVO', () => {
    const bezSlova: string[] = [];
    for (const { kde, html } of PRIPADY) {
      for (const u of signaly(html)) {
        if (slovo(u).length < NAJKRATSIE_SLOVO) bezSlova.push(`${kde} → <${u.tag}>`);
      }
    }
    expect(bezSlova, 'stav bez slova — značka slovo nenahrádza').toEqual([]);
  });

  it('každý FAREBNÝ stavový uzol má aj ZNAČKU', () => {
    /*
     * Počet je „aspoň jedna", nie „presne jedna": značka platného filtra nesie
     * vo svojom vnútri aj krížik, ktorý je druhý OVLÁDAČ, nie druhý stav.
     * Presné počty tvrdia bloky 2–6 nad jednotlivými komponentmi.
     */
    const bezZnacky: string[] = [];
    for (const { kde, html } of PRIPADY) {
      for (const u of signaly(html)) {
        if (farebnyStav(u) && pocetZnaciek(u) === 0) bezZnacky.push(`${kde} → <${u.tag}>`);
      }
    }
    expect(bezZnacky, 'stav nesie len farbu a slovo').toEqual([]);
  });

  it('žiadny stav sa neopisuje pomlčkou — tá je vyhradená dátam (I11)', () => {
    for (const { kde, html } of PRIPADY) {
      // Pomlčka smie v skupine stáť len ako nezmeraný POČET (`chipCountLabel`),
      // nikdy ako názov stavu. Ani jeden z týchto prípadov počet nemá.
      expect(text(html), `${kde}: stav sa opisuje pomlčkou`).not.toContain(NEVIEME);
    }
  });

  it('a ani jeden z nich netvrdí, že mu chýba slovo', () => {
    // Poistka proti opačnej chybe: keby `signalWord()` hlásil chýbajúce slovo
    // vždy, tvrdenia vyššie by prešli a appka by mala pod každým stavom
    // tečkované „stav bez popisu".
    for (const { kde, html } of PRIPADY) {
      expect(html, `${kde}: náhradné slovo tam, kde slovo bolo`).not.toContain(
        SIGNAL_WORDLESS_ATTR,
      );
    }
  });
});
