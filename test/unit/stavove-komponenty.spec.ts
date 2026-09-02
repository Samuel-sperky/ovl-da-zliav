/**
 * Aura Zľavy — RODINA STAVOV: ŠESŤ PRÁZDIEN SA NESMIE ZLIAŤ (D134, D142, I11).
 *
 * ČO SA TU MERIA A PREČO PRÁVE TO
 * ───────────────────────────────
 * Prázdna obrazovka je v tejto appke bežný stav (R4: `shop_write` kľúč chýba,
 * predaje sa nesynchronizovali, obohatených je zlomok katalógu). Má teda šesť
 * rôznych príčin a každá má iný ďalší krok. Zámena dvoch z nich nie je
 * kozmetika, ale nepravda na obrazovke:
 *
 *   · „nič tu ešte nevzniklo" ↔ „hľadanie nič nenašlo" — človek zakladá zľavu,
 *     ktorá už existuje, len ju schoval filter;
 *   · čokoľvek ↔ „nemerali sme" — appka tvrdí o obsahu niečo, čo nemá čím
 *     doložiť, a je to presne to, čo I11 zakazuje: nevedomosť vydaná za nulu.
 *
 * Ani jedna z týchto chýb nič nezhodí. Prejdú typecheckom, prejdú lintom a na
 * snímke vyzerajú dobre — rozdiel je len v tom, čo veta TVRDÍ. Preto sa tu
 * merajú VETY a vykreslený markup, nie tvar komponentov.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 *  A. **Slová sú pripnuté zámerne.** Test drží konkrétne kusy vetí („prázdny
 *     zoznam to neznamená", „nie je to nula"). Nie je to test prekladu: každý
 *     z tých kusov je SĽUB, ktorý appka dáva, a keď zmizne, stav sa zmení
 *     z priznania na tvrdenie. Kto vetu preformuluje, musí prepísať aj tvrdenie
 *     tu a tým vedome povedať, že sľub platí ďalej.
 *  B. **Prázdny nález je pád, nie úspech.** Každé tvrdenie „nad všetkými" má
 *     pred sebou poistku na počet — inak by rozbitý render svietil zeleno.
 *  C. **Rám je JEDEN.** Všetkých päť textových stavov kreslí `.ovl-empty`.
 *     Druhá, takmer rovnaká sada tried by sa o mesiac rozišla s prvou (to isté
 *     pravidlo má v hlavičke `ui/primitives.module.css`).
 *  D. **Príbeh je v markupe aj pre stroj** (`data-story`). Bez toho sa dá
 *     rozlíšiť len čítaním vety, a to test ani e2e nedokáže spoľahlivo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import EmptyState from '@/components/states/EmptyState';
import ErrorState from '@/components/states/ErrorState';
import ForbiddenState from '@/components/states/ForbiddenState';
import LoadingState from '@/components/states/LoadingState';
import NoResultsState from '@/components/states/NoResultsState';
import UnmeasuredState from '@/components/states/UnmeasuredState';
import {
  LOADING_LABEL,
  RESET_FILTERS_LABEL,
  RETRY_LABEL,
  STATE_STORIES,
  STATE_STORY,
  type StateStory,
} from '@/components/states/state-copy';
import styles from '@/components/states/states.module.css';
import { describeActionFailure } from '@/lib/ui/action-failure';
import { PRODUCT_DASH, PRODUCT_GAP_REASON } from '@/lib/ui/product-columns';

import { NAJKRATSIE_SLOVO, pocetZnaciek, text, uzly } from '../helpers/znacky';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const MODULE_CSS = read('../../src/components/states/states.module.css');
const STATES_DIR = fileURLToPath(new URL('../../src/components/states', import.meta.url));

/**
 * Zdroje rodiny — na tvrdenia o tom, čo v nich NIE JE napísané.
 *
 * Komentáre sa odstrihávajú: hlavičky týchto modulov zámerne CITUJÚ vety, ktoré
 * sa na obrazovku nesmú dostať („nič sa nezmenilo", „požiadajte správcu"),
 * pretože vysvetľujú, prečo tam nie sú. Test bez odstrihnutia by trestal
 * dokumentáciu za to, že existuje — presne to je bod C hlavičky
 * `test/unit/ikony.spec.ts`.
 */
const SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  readdirSync(STATES_DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => [
      f,
      readFileSync(`${STATES_DIR}/${f}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' '),
    ]),
);

/** Všetky predvolené vety rodiny ako jeden zoznam. */
const COPY: readonly string[] = STATE_STORIES.flatMap((s) => [
  STATE_STORY[s].word,
  STATE_STORY[s].title,
  STATE_STORY[s].meaning,
]);

/* ═══════════════════════════ vzorky ══════════════════════════════════════ */

const FAILURE = describeActionFailure(
  { code: 'shop_unavailable', message: 'Shop odmietol požiadavku.' },
  { action: 'Načítanie zliav' },
);

const empty = (): string =>
  renderToStaticMarkup(
    createElement(EmptyState, {
      title: STATE_STORY.prazdno.title,
      description: STATE_STORY.prazdno.meaning,
    }),
  );

const noResults = (): string => renderToStaticMarkup(createElement(NoResultsState, {}));

const unmeasured = (): string =>
  renderToStaticMarkup(
    createElement(UnmeasuredState, { reason: PRODUCT_GAP_REASON.not_enriched }),
  );

const forbidden = (): string =>
  renderToStaticMarkup(
    createElement(ForbiddenState, {
      reason: 'Kľúč do shopu chýba, takže appka nemá čím čítať.',
    }),
  );

const failed = (): string =>
  renderToStaticMarkup(createElement(ErrorState, { failure: FAILURE }));

const loading = (opts: { tiles?: number; blocks?: number } = {}): string =>
  renderToStaticMarkup(createElement(LoadingState, opts));

/** Všetkých šesť stavov v predvolenom stave, pod menom svojho príbehu. */
const RENDERED: Readonly<Record<StateStory, string>> = {
  prazdno: empty(),
  hladanie: noResults(),
  nemerane: unmeasured(),
  bez_pristupu: forbidden(),
  zlyhalo: failed(),
  nacitava: loading(),
};

/* ═════════════ A. Meranie vôbec niečo našlo ══════════════════════════════ */

describe('A — poistky merania', () => {
  it('render dal markup a slovník dal vety', () => {
    for (const [story, html] of Object.entries(RENDERED)) {
      expect(html.length, `${story}: render nič nevykreslil`).toBeGreaterThan(80);
    }
    expect(COPY.length).toBe(STATE_STORIES.length * 3);
    expect(MODULE_CSS.length).toBeGreaterThan(500);
    expect(Object.keys(SOURCES).length).toBeGreaterThanOrEqual(7);
  });
});

/* ═════════════ B. Šesť príbehov, šesť vetí ═══════════════════════════════ */

describe('B — slovník príbehov', () => {
  it('šesť príbehov a každý má všetky štyri polia', () => {
    expect(new Set(STATE_STORIES).size).toBe(STATE_STORIES.length);
    for (const s of STATE_STORIES) {
      const c = STATE_STORY[s];
      for (const [pole, hodnota] of Object.entries(c)) {
        expect(hodnota.trim().length, `${s}.${pole} je prázdne`).toBeGreaterThan(3);
      }
    }
  });

  it('nadpisy aj vety sú navzájom RÔZNE — inak sa dva príbehy zliali', () => {
    const titles = STATE_STORIES.map((s) => STATE_STORY[s].title);
    const meanings = STATE_STORIES.map((s) => STATE_STORY[s].meaning);
    expect(new Set(titles).size, 'dva príbehy majú ten istý nadpis').toBe(titles.length);
    expect(new Set(meanings).size, 'dva príbehy majú tú istú vetu').toBe(meanings.length);
  });

  it('každý príbeh má svoj komponent a každý komponent svoj príbeh', () => {
    /*
     * Väzba je mechanická v OBOCH smeroch. Príbeh bez komponentu je veta, ktorú
     * nikto nekreslí; komponent bez príbehu je stav, ktorý si vety vymýšľa sám
     * — a práve tak vznikne siedme prázdno s vlastnou formuláciou.
     */
    const kreslia = STATE_STORIES.map((s) => `${STATE_STORY[s].component}.tsx`).sort();
    const subory = Object.keys(SOURCES)
      .filter((f) => f.endsWith('.tsx'))
      .sort();
    expect(subory).toEqual(kreslia);
  });
});

/* ═════════════ C. Tri zamieňané príbehy sa v texte LÍŠIA ═════════════════ */

describe('C — prázdno, hľadanie a „nemerali sme" sú tri rôzne vety', () => {
  it('každý z tých troch kreslí SVOJ nadpis a SVOJU vetu', () => {
    for (const s of ['prazdno', 'hladanie', 'nemerane'] as const) {
      expect(RENDERED[s], `${s}: chýba nadpis`).toContain(STATE_STORY[s].title);
      expect(RENDERED[s], `${s}: chýba veta`).toContain(STATE_STORY[s].meaning);
    }
  });

  it('a nekreslí vetu ani jedného z tých druhých dvoch', () => {
    const trojica = ['prazdno', 'hladanie', 'nemerane'] as const;
    for (const s of trojica) {
      for (const iny of trojica) {
        if (iny === s) continue;
        expect(RENDERED[s], `${s} hovorí vetou príbehu ${iny}`).not.toContain(
          STATE_STORY[iny].meaning,
        );
      }
    }
  });

  it('hľadanie POVIE, že prázdny zoznam to neznamená', () => {
    /* Bez tejto polovice vety je prázdny výsledok filtra nerozlíšiteľný od
       prázdneho katalógu — a v katalógu 41 348 produktov je to nepravda, ktorá
       stojí človeka hodinu hľadania kusu, čo tam je (pozri bod A hlavičky). */
    expect(STATE_STORY.hladanie.meaning).toContain('prázdny zoznam to neznamená');
    expect(RENDERED.hladanie).toContain('prázdny zoznam to neznamená');
  });

  it('„nemerali sme" POVIE, že to nie je nula (I11)', () => {
    expect(STATE_STORY.nemerane.meaning).toContain('nie je to nula');
    expect(RENDERED.nemerane).toContain('nie je to nula');
    /* A prečo sme nemerali, hovorí veta zo SPOLOČNÉHO slovníka medzier — tá
       istá, ktorú dostane `title` bunky. Dve vety o tej istej medzere by sa
       rozišli. */
    expect(RENDERED.nemerane).toContain(PRODUCT_GAP_REASON.not_enriched);
  });

  it('prázdno hovorí o vzniku, nie o nule ani o poruche', () => {
    expect(STATE_STORY.prazdno.meaning).toContain('nevznikla');
  });

  it('príbeh je v markupe aj pre stroj (`data-story`)', () => {
    for (const s of STATE_STORIES) {
      expect(RENDERED[s], `${s}: chýba data-story`).toContain(`data-story="${s}"`);
    }
    /* Poistka na to, že hodnoty sú naozaj rôzne a nie šesťkrát tá istá. */
    const najdene = STATE_STORIES.map(
      (s) => /data-story="([a-z_]+)"/.exec(RENDERED[s])?.[1] ?? null,
    );
    expect(new Set(najdene).size).toBe(STATE_STORIES.length);
  });
});

/* ═════════════ D. Prázdny stav sa netvári ako nula ═══════════════════════ */

describe('D — žiadna veta netvrdí nulu (I11)', () => {
  it('v predvolených vetách nie je ani jedna číslica', () => {
    /*
     * Číslo, ktoré appka nemá, sa nedopĺňa — a keď ho má, hovorí ho OBRAZOVKA
     * (`enrichPageNote()` povie číslom, koľko z denného cieľa zostáva), nie
     * tento slovník. „0 výsledkov" je najkratšia cesta, ako z priznania spraviť
     * tvrdenie.
     */
    for (const veta of COPY) {
      expect(veta, `veta obsahuje číslicu: ${veta}`).not.toMatch(/\d/);
    }
  });

  it('a ani jedna nepovie „žiadne dáta"', () => {
    for (const veta of COPY) {
      expect(veta.toLowerCase(), veta).not.toContain('žiadne dáta');
      expect(veta.toLowerCase(), veta).not.toContain('žiadne údaje');
      expect(veta.toLowerCase(), veta).not.toContain('nie sú dostupné');
    }
  });

  it('pomlčka v priznaniach je U+2014, nie spojovník ani en dash', () => {
    /* Ten istý znak, ktorým appka priznáva „nevieme" v bunke (`PRODUCT_DASH`).
       Dva rôzne znaky pre tú istú vec sa raz rozídu aj vizuálne. */
    expect(PRODUCT_DASH).toBe('—');
    const sPomlckou = COPY.filter((v) => v.includes(PRODUCT_DASH));
    expect(sPomlckou.length, 'ani jedna veta pomlčku nemá — meranie nič nemeria').toBeGreaterThan(
      0,
    );
    for (const veta of COPY) {
      expect(veta, `en dash namiesto U+2014: ${veta}`).not.toContain('–');
      expect(veta, `spojovník ako interpunkcia: ${veta}`).not.toMatch(/ - /);
    }
  });
});

/* ═════════════ E. Jeden rám, jeden slot, jedno poradie ═══════════════════ */

describe('E — rám prázdneho stavu', () => {
  it('päť textových stavov kreslí ten istý rám `.ovl-empty`', () => {
    for (const s of ['prazdno', 'hladanie', 'nemerane', 'bez_pristupu', 'zlyhalo'] as const) {
      expect(RENDERED[s], `${s}: kreslí vlastný rám`).toContain('class="ovl-empty"');
    }
    /* Načítavanie rám nemá — je to kostra obsahu, nie veta na jeho mieste. */
    expect(RENDERED.nacitava).not.toContain('ovl-empty');
  });

  it('druhá veta stojí PRED akciou, nie za ňou', () => {
    /* Vysvetlenie za tlačidlom sa už nečíta: človek klikne, alebo odíde. */
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: 'Nadpis',
        description: 'Jedna veta.',
        note: createElement('span', null, 'druhá veta'),
        action: createElement('button', { type: 'button' }, 'Akcia'),
      }),
    );
    const note = html.indexOf('druhá veta');
    const akcia = html.indexOf('Akcia');
    expect(note).toBeGreaterThan(-1);
    expect(akcia).toBeGreaterThan(-1);
    expect(note, 'druhá veta sa presunula za akciu').toBeLessThan(akcia);
  });

  it('každá modulová trieda rodiny naozaj existuje', () => {
    /* Preklep v CSS module je `undefined` — teda `class="undefined"` a ticho:
       trieda bez štýlu nič nezhodí a na snímke chýba len rozostup. */
    const pouzite = Object.values(SOURCES).flatMap((src) =>
      [...src.matchAll(/styles\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]!),
    );
    expect(pouzite.length, 'ani jedna modulová trieda — meranie nič nemeria').toBeGreaterThan(3);
    for (const name of new Set(pouzite)) {
      expect(MODULE_CSS, `trieda .${name} v states.module.css chýba`).toMatch(
        new RegExp(`\\.${name}\\b`),
      );
    }
    for (const s of STATE_STORIES) {
      expect(RENDERED[s], `${s}: class="undefined"`).not.toContain('class="undefined"');
    }
    /* A slot druhej vety sa naozaj kreslí tam, kde druhá veta je. */
    expect(RENDERED.nemerane).toContain(styles.noteSlot);
  });

  it('modul nemá surovú farbu ani `rgba()` (D147)', () => {
    const bezKomentarov = MODULE_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(bezKomentarov).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(bezKomentarov).not.toMatch(/rgba?\(/);
    expect(bezKomentarov).not.toContain('!important');
    /* Prázdno nie je stav: farba stavu do tohto modulu nepatrí vôbec. */
    expect(bezKomentarov).not.toMatch(/--st-/);
  });
});

/* ═════════════ F. Zlyhanie: jeden alert, tri kanály, žiadny sľub ═════════ */

describe('F — chybový stav', () => {
  it('veta zlyhania NETVRDÍ, čo sa (ne)zapísalo', () => {
    /* Pri neznámej chybe to appka nevie — mutácia mohla spadnúť aj uprostred.
       Tvrdiť „nezapísali sme nič" je I11 obráteným smerom
       (`lib/ui/action-failure.ts`). */
    const podozrive = ['nič sa nezmenilo', 'nezapísal', 'nezmenilo sa', 'nič sa neuložilo'];
    for (const fraza of podozrive) {
      expect(STATE_STORY.zlyhalo.meaning.toLowerCase(), fraza).not.toContain(fraza);
      expect(SOURCES['ErrorState.tsx']?.toLowerCase() ?? '', `ErrorState.tsx: ${fraza}`).not.toContain(
        fraza,
      );
    }
  });

  it('prázdno je dôsledok, nie zistenie — a text to hovorí', () => {
    expect(STATE_STORY.zlyhalo.meaning).toContain('dôsledok zlyhania');
    expect(RENDERED.zlyhalo).toContain(STATE_STORY.zlyhalo.meaning);
  });

  it('slovenská veta zo servera aj kód sú na obrazovke', () => {
    expect(RENDERED.zlyhalo).toContain('Shop odmietol požiadavku.');
    expect(RENDERED.zlyhalo).toContain('shop_unavailable');
  });

  it('PRÁVE JEDEN `role="alert"` a nesie tri kanály', () => {
    /* Dva vnorené alerty prečíta čítačka dvakrát; nula alertov znamená, že
       zlyhané načítanie prejde bez povšimnutia. */
    const alerty = (RENDERED.zlyhalo.match(/role="alert"/g) ?? []).length;
    expect(alerty, 'alert nie je práve jeden').toBe(1);

    const uzol = uzly(RENDERED.zlyhalo).find((u) => u.atributy.role === 'alert');
    expect(uzol, 'alert uzol sa nenašiel').toBeDefined();
    if (uzol === undefined) return;
    /* FARBA — trieda tónovanej vysvetlivky; ZNAČKA — práve jedna ikona zo sady;
       SLOVO — čitateľný text pri nej. */
    expect(uzol.triedy).toContain('ovl-note');
    expect(uzol.triedy.some((t) => t.startsWith('ovl-note--'))).toBe(true);
    expect(pocetZnaciek(uzol), 'značka nie je práve jedna').toBe(1);
    expect(text(uzol).length).toBeGreaterThanOrEqual(NAJKRATSIE_SLOVO);
  });

  it('samotný rám prázdna nie je červený', () => {
    /* Tón nesie vysvetlivka vnútri, nie plocha: zafarbený prázdny stav by bol
       štvrtý kanál bez značky a bez slova (bod 3 hlavičky `EmptyState`). */
    const ram = uzly(RENDERED.zlyhalo).find((u) => u.triedy.includes('ovl-empty'));
    expect(ram).toBeDefined();
    expect(ram?.atributy.role).toBeUndefined();
    expect(ram?.triedy).toEqual(['ovl-empty']);
  });
});

/* ═════════════ G. Zamknuté: appka, nie človek ════════════════════════════ */

describe('G — stav bez prístupu nesľubuje práva ani správcu', () => {
  it('nehovorí o oprávneniach, správcovi ani prihlásení (D98–D100)', () => {
    /*
     * Predlohová veta znela „Nemáte prístup… požiadajte správcu". Táto appka
     * nemá prihlásenie, používateľov ani práva a žiadny správca, ktorého by šlo
     * požiadať, neexistuje — prevzatá veta by človeka poslala hľadať niekoho,
     * kto nie je. Zakázané slová sú tu preto, že port sa dá „opraviť" späť.
     */
    const zakazane = ['oprávnen', 'správc', 'prihlás', 'nemáte prístup', 'nemáte právo'];
    /* Markup AJ zdroj bez komentárov: veta sa dá vrátiť ako default propu
       rovnako ľahko ako priamo na obrazovku. */
    const kde = `${RENDERED.bez_pristupu}\n${SOURCES['ForbiddenState.tsx'] ?? ''}`.toLowerCase();
    expect(kde.length, 'meranie nemá čo merať').toBeGreaterThan(200);
    for (const slovo of zakazane) {
      expect(kde.includes(slovo), `vrátilo sa slovo „${slovo}"`).toBe(false);
    }
  });

  it('prístup chýba APPKE a cesta von nie je opakovanie', () => {
    expect(RENDERED.bez_pristupu).toContain(STATE_STORY.bez_pristupu.title);
    expect(RENDERED.bez_pristupu).toContain('Appka');
    expect(RENDERED.bez_pristupu, 'ponúka „skúsiť znova", čo prístup nedá').not.toContain(
      RETRY_LABEL,
    );
  });

  it('zámok nesie značku, slovo aj dôvod', () => {
    const uzol = uzly(RENDERED.bez_pristupu).find((u) => u.triedy.includes('locked-note'));
    expect(uzol, 'zámok sa nenakreslil').toBeDefined();
    if (uzol === undefined) return;
    expect(pocetZnaciek(uzol)).toBe(1);
    expect(text(uzol)).toContain('Zamknuté');
    expect(text(uzol)).toContain('Kľúč do shopu chýba');
  });
});

/* ═════════════ H. Načítavanie netvrdí prázdno ════════════════════════════ */

describe('H — prvé načítanie', () => {
  it('má rolu, `aria-busy` a VIDITEĽNÉ slovo', () => {
    /* `aria-label` na prvku bez roly čítačka zahodí (P5); a keď
       `prefers-reduced-motion` vypne shimmer, slovo je jediný kanál, ktorý
       zostane. */
    expect(RENDERED.nacitava).toContain('role="status"');
    expect(RENDERED.nacitava).toContain('aria-busy="true"');
    expect(RENDERED.nacitava).toContain(LOADING_LABEL);
    expect(text(RENDERED.nacitava)).toContain(LOADING_LABEL);
  });

  it('netvrdí, že je prázdno', () => {
    const html = RENDERED.nacitava.toLowerCase();
    expect(html).not.toContain('prázdn');
    expect(html).not.toContain('nie je čo ukázať');
    expect(html).not.toContain('nenašlo');
  });

  it('kostra má tvar toho, čo príde', () => {
    const s = loading({ tiles: 4, blocks: 2 });
    expect((s.match(/ovl-skeleton/g) ?? []).length, 'kostra nemá 4 dlaždice a 2 bloky').toBe(6);
    expect(s).toContain(styles.tiles);
    const bez = loading({ tiles: 0, blocks: 0 });
    expect(bez).not.toContain('ovl-skeleton');
    expect(bez, 'slovo zmizlo spolu s kostrou').toContain(LOADING_LABEL);
  });

  it('pokazený vstup nezhodí obrazovku', () => {
    /* `Array.from({ length: -3 })` hodí RangeError. Kostra má v najhoršom
       prípade zmiznúť, nie zhodiť plochu, na ktorej má niečo prísť. */
    const zaporne = loading({ tiles: -3, blocks: -1 });
    expect(zaporne).not.toContain('ovl-skeleton');
    expect(zaporne).toContain(LOADING_LABEL);
    const zlomok = loading({ tiles: 2.7, blocks: 0 });
    expect((zlomok.match(/ovl-skeleton/g) ?? []).length).toBe(2);
  });
});

/* ═════════════ I. Slová akcií žijú na jednom mieste ══════════════════════ */

describe('I — jedno slovo pre jednu akciu', () => {
  it('texty akcií sú slovenské a v slovníku, nie v komponentoch', () => {
    expect(RETRY_LABEL).toBe('Skúsiť znova');
    expect(RESET_FILTERS_LABEL).toBe('Zrušiť filtre');
    /*
     * Komponenty tlačidlá NEKRESLIA (ovládací prvok si vlastní volajúci, aby
     * naň mohol dať `disabledReason`), takže literál textu akcie sa v ich
     * vykreslenom markupe nesmie objaviť — inak by vznikli dve cesty, ako
     * podať tú istú akciu.
     */
    for (const s of STATE_STORIES) {
      expect(RENDERED[s], `${s}: kreslí si tlačidlo sám`).not.toContain(RESET_FILTERS_LABEL);
    }
  });
});
