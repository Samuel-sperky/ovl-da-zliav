/**
 * Aura Zľavy — DETAIL ZĽAVY po oprave D15–D18
 * (kontrakt UX/dizajn 19. 8. 2026; kontrakt UI, body 5, 22; P1, P7, P8).
 *
 * Čo sa tu dá ticho pokaziť späť:
 *
 *  A. **D15 — dominanta a dlaždice sú jeden útvar.** Štyri dlaždice fronty
 *     ZOSTÁVAJÚ (kontrakt UI, bod 22): „nevieme, či sa zapísalo" je vlastný
 *     stav a zliať ho so „nepodarilo sa" by bolo klamstvo. Duplicitu preto
 *     odstránila druhá strana — zmizla veta, ktorá tie isté štyri čísla
 *     hovorila ešte raz slovami, aj tretí výskyt čakajúcich. Pruh pod
 *     dominantou je rozdelený na tie isté štyri stavy, takže dlaždice sú jeho
 *     legendou, nie druhým zoznamom.
 *  B. **D16 — jeden zoznam dôvodov, nie dve červené škatule.**
 *  C. **D17 — „Výkon výberu" nie sú tri karty, ktoré všetky hlásia, že dáta
 *     nie sú.** Zamknuté uhly sú dva tiché riadky a stále povedia dôvod (K8).
 *  D. **D18 — popisok tretieho uhla je po slovensky.**
 *
 * Detail zľavy je klientský komponent, ktorý čísla ťahá až v efekte, takže
 * body A a B sa merajú nad zdrojom a nad geometriou — presne tak, ako to robia
 * `typografia.spec.ts` a `paleta.spec.ts`. Sekcia výkonu sa renderuje naozaj.
 *
 * DVE MERANIA, KTORÉ SA 19. 8. 2026 OPRAVILI
 * ------------------------------------------
 *
 *  · **Rez zdroja vynechával skoré návraty.** `DETAIL_JSX` bol rez od prvého
 *    `data-testid="discount-detail"`, takže chybová aj načítavacia vetva
 *    (návraty pred hlavným `return`) stáli mimo všetkých negatívnych tvrdení
 *    a zakázaná veta sa v nich mohla ticho vrátiť. Rez nahradil zdroj BEZ
 *    KOMENTÁROV: hlavičky o defektoch smú hovoriť čokoľvek, všetko ostatné sa
 *    meria celé.
 *  · **Sekcia výkonu sa merala v stave „Načítavam…".** `renderToStaticMarkup`
 *    efekty nespúšťa, takže `view` ostávalo `null` a tvrdenia „appka nikde
 *    nepredstiera eurá" a „žiadny záver o príčine" nemali čo merať — presne
 *    preto v nich prežil nález, že `.perfStrong i` mal `background:
 *    var(--ink3)`, čiže neexistujúci token, a porovnávací pruh sa kreslil ako
 *    prázdny žľab. Sekcia je odteraz rozdelená na `PerformanceCard` (čistú)
 *    a `DiscountPerformance` (s načítaním), takže sa dá vykresliť S DÁTAMI.
 *
 * Vlastník: O2, kontrakt UX/dizajn 19. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PerformanceCard } from '@/components/campaigns/DiscountPerformance';
import type { PerformanceView } from '@/components/campaigns/zlavy-api';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const DETAIL = read('../../src/components/campaigns/DiscountDetail.tsx');

/**
 * Zdroj bez komentárov — všetko, čo sa môže vykresliť, a nič, čo sa nemôže.
 * Rez od prvého `data-testid` vynechával skoré návraty; toto ich má.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
}

const DETAIL_JSX = withoutComments(DETAIL);
const CSS = read('../../src/components/campaigns/zlavy.module.css');
const GLOBAL_CSS = read('../../src/app/globals.css');
/*
 * Rám dôvodov sa 19. 8. 2026 presťahoval z DiscountDetail.tsx do
 * BlockerList.tsx ako `StandPanel`, pretože tú istú chybu (dva poplachy
 * namiesto jedného rámu) mal aj zoznam zliav a riešiť ju dvakrát znamená
 * rozísť sa. Tvrdenia D16 preto platia o paneli, nie o detaile — detail už
 * len overuje, že ho použil práve raz.
 */
const PANEL = read('../../src/components/campaigns/BlockerList.tsx');

/** Koľkokrát sa reťazec v texte vyskytuje. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Len to, čo človek na obrazovke prečíta — bez značiek, tried a štýlov. */
function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, ' ');
}

/* ═════════════ A. D15 — dominanta sa neopakuje v dlaždiciach ════════════ */

describe('A — štyri dlaždice zostávajú, duplicita zmizla inde (D15, bod 22)', () => {
  it('všetky štyri stavy fronty majú vlastnú dlaždicu', () => {
    for (const tile of ['tile-ok', 'tile-pending', 'tile-failed', 'tile-uncertain']) {
      expect(DETAIL).toContain(`testId="${tile}"`);
    }
  });

  it('„nevieme, či sa zapísalo" ostáva vlastným stavom, nezliatym so zlyhaním', () => {
    expect(DETAIL).toContain('Nevieme, či sa zapísalo');
    expect(DETAIL).toContain('Nepodarilo sa');
    expect(DETAIL).toContain('zápis odišiel, odpoveď nedorazila');
  });

  it('veta, ktorá tie isté čísla hovorila ešte raz slovami, je preč', () => {
    expect(DETAIL_JSX).not.toContain('sa nepodarilo`');
    expect(DETAIL_JSX).not.toContain('nevieme, či sa zapísalo`');
    expect(DETAIL_JSX).not.toContain('ostáva zapísať');
  });

  it('pruh priebehu je rozdelený na tie isté štyri stavy ako dlaždice', () => {
    for (const state of ['ok', 'uncertain', 'failed', 'pending']) {
      expect(DETAIL).toContain(`data-state="${state}"`);
      expect(CSS).toContain(`.queueBar i[data-state='${state}']`);
    }
  });

  it('úseky pruhu berú farbu VÝHRADNE zo stavovej škály, nikdy z akcentu', () => {
    const bar = CSS.slice(CSS.indexOf('.queueBar {'), CSS.indexOf('.queueTiles {'));
    expect(bar).toContain('var(--st-good)');
    expect(bar).toContain('var(--st-attention)');
    expect(bar).toContain('var(--st-critical)');
    expect(bar).toContain('var(--st-progress)');
    expect(bar).not.toContain('var(--accent)');
  });

  it('stav nesie farbu aj slovo — a nikdy prázdnu značku', () => {
    // Do 19. 8. 2026 sa sem lepil TONE_GLYPH, ktorý po prechode na ikony
    // vracal samé prázdne reťazce — z „glyf + slovo" ostala medzera navyše.
    // Mapa je preč. Kým dlaždice dostanú <Icon>, nesie stav FARBA (data-state
    // + --st-*) a SLOVO v popisku; musia byť oba, inak je to len farba.
    expect(DETAIL).not.toContain('TONE_GLYPH');
    for (const word of ['Zapísané', 'Čaká na zápis', 'Nepodarilo sa', 'Nevieme, či sa zapísalo']) {
      expect(DETAIL, word).toContain(word);
    }
  });

  it('prúžok farby dostane len dlaždica s nenulovým číslom — nula nie je poplach', () => {
    expect(DETAIL).toContain('anyOf(campaign.itemsFailed)');
    expect(CSS).toContain(".queueTile[data-any='ano'][data-state='failed']");
  });
});

/* ═════════════ B. D16 — jeden zoznam dôvodov ════════════════════════════ */

describe('B — dôvody stoja v jednom ráme (D16)', () => {
  it('detail kreslí rám dôvodov práve raz', () => {
    expect(count(DETAIL_JSX, '<StandPanel')).toBe(1);
    // Po presune do StandPanelu je z atribútu prop; panel ho na
    // `data-testid` premení sám (overené nižšie).
    expect(count(DETAIL_JSX, 'testId="detail-blockers"')).toBe(1);
    expect(PANEL).toContain('data-testid={testId}');
  });

  it('rám má jediný nadpis a nesie oba druhy dôvodov naraz', () => {
    expect(count(PANEL, 'Prečo sa teraz nezapisuje')).toBe(1);
    // Starý druhý nadpis nesmie prežiť ani v paneli, ani v detaile.
    expect(PANEL).not.toContain('Čo bráni zápisu');
    expect(DETAIL_JSX).not.toContain('Čo bráni zápisu');
  });

  it('dôvod behu appky je riadok v tej istej skupine, nie vyplnená škatuľa', () => {
    const group = PANEL.slice(PANEL.indexOf('export function StandPanel'));
    expect(group).toContain('testId="detail-stand"');
    expect(group).toContain('<StandRow');
    // `variant` je prop vyplneného `Note` — ten sa sem už nesmie vrátiť.
    expect(PANEL).not.toContain('variant=');
  });

  it('aj tento riadok má vedľa farby glyf', () => {
    // Značku kreslí IKONA, nie znak (19. 8. 2026): TONE_GLYPH po prechode
    // vracal prázdno, takže riadok o stojacej fronte prišiel o druhý kanál.
    expect(PANEL).toContain('TONE_ICON[stand.tone]');
  });

  it('prázdny rám sa nekreslí — bol by tvrdením, že niečo stojí', () => {
    expect(PANEL).toContain('if (stand === null && cards.length === 0) return null;');
  });
});

/* ═════════════ C + D. D17, D18 — Výkon výberu ═══════════════════════════ */

/**
 * Odpoveď servera s NAOZAJ nameranými číslami. Bez nej sa sekcia vykreslila
 * v stave „Načítavam…" a všetky tvrdenia o nej boli prázdne.
 */
const VIEW: PerformanceView = {
  available: true,
  unit: 'ks',
  spanDays: 14,
  recent: { from: '2026-08-06', to: '2026-08-19', units: 128 },
  prior: { from: '2026-07-23', to: '2026-08-05', units: 74 },
  coverage: { from: '2026-05-01', to: '2026-08-19', syncEnabled: true },
  locked: {
    revenue: 'Tržby v eurách shop cez API nevracia.',
    lastYear: 'Predaje zatiaľ rok dozadu nesiahajú.',
  },
};

const cardOf = (view: PerformanceView | null, failed = false): string =>
  renderToStaticMarkup(createElement(PerformanceCard, { view, failed }));

/** Sekcia s dátami — stav, v ktorom človek sekciu naozaj číta. */
const WITH_DATA = cardOf(VIEW);
/** Sekcia počas načítavania — jediný stav, ktorý sa dal merať do 19. 8. 2026. */
const LOADING = cardOf(null);

describe('C — výkon výberu nie sú tri karty s tou istou správou (D17)', () => {
  it('zamknuté uhly sú riadky, nie karty v mriežke', () => {
    expect(CSS).not.toContain('.perfGrid');
    expect(CSS).not.toContain('.perfPanel');
    expect(WITH_DATA).toContain('data-testid="performance-locked"');
  });

  it('čísla, ktoré appka má, už nemajú vlastný nadpis nad nadpisom sekcie', () => {
    expect(WITH_DATA).toContain('Výkon výberu');
    expect(WITH_DATA).toContain('data-testid="performance-units"');
    expect(WITH_DATA).not.toContain('Pred zľavou a teraz');
  });

  it('zamknutý uhol naďalej povie dôvod — nie je skrytý (K8)', () => {
    expect(WITH_DATA).toContain('Tržby');
    expect(WITH_DATA).toContain('Tržby v eurách shop cez API nevracia.');
    expect(WITH_DATA).toContain('Predaje zatiaľ rok dozadu nesiahajú.');
  });

  /*
   * Poistka, že test naozaj meria stav s dátami. Bez nej by stačilo, aby sa
   * `view` prestalo dostávať dnu, a všetky negatívne tvrdenia nižšie by zase
   * merali „Načítavam…" — teda nič.
   */
  it('vykreslený stav NIE JE „Načítavam…" — obe čísla sú na obrazovke', () => {
    expect(LOADING).toContain('Načítavam…');
    expect(WITH_DATA).not.toContain('Načítavam…');
    expect(WITH_DATA).toContain('128 ks');
    expect(WITH_DATA).toContain('74 ks');
    expect(WITH_DATA).toContain('predané kusy za 14 dní');
  });

  it('appka nikde nepredstiera eurá, percentá ani záver o príčine (K8, P8)', () => {
    /*
     * Meria sa TEXT, nie značky: `width:100%` je geometria pruhu, nie výrok.
     * Percento v texte by už bolo prepočítanie dvoch čísel na jedno, teda
     * presne ten záver, ktorý sekcia robiť nesmie.
     */
    const text = textOf(WITH_DATA);
    expect(text).not.toContain('€');
    expect(text).not.toContain('EUR');
    expect(text).not.toContain('%');
    for (const veta of ['priniesla', 'vďaka zľave', 'spôsobil', 'nárast', 'pokles', 'oproti']) {
      expect(text, veta).not.toContain(veta);
    }
  });

  it('dve čísla stoja vedľa seba a appka ich za nikoho neodčíta', () => {
    // Rozdiel 128 − 74 = 54 sa nikde nedopočítava — sú tam len obe merania.
    const text = textOf(WITH_DATA);
    expect(text).toContain('128 ks');
    expect(text).toContain('74 ks');
    expect(text).not.toContain('54');
  });

  /*
   * Nález, ktorý prežil práve preto, že sa sekcia merala bez dát:
   * `.perfStrong i` mal `background: var(--ink3)`. Taký token neexistuje,
   * deklarácia bola neplatná a porovnávací pruh sa kreslil ako prázdny žľab —
   * teda ako nula, hoci číslo bolo známe.
   */
  it('porovnávací pruh sa naozaj kreslí — jeho farba je definovaný token', () => {
    const strong = CSS.slice(CSS.indexOf('.perfStrong i {'), CSS.indexOf('.perfValue {'));
    const token = /background:\s*var\((--[a-z0-9-]+)\)/.exec(strong);
    expect(token).not.toBeNull();
    expect(GLOBAL_CSS).toContain(`${token![1]}:`);
    expect(CSS).not.toContain('var(--ink3)');
  });

  it('oba pruhy dostanú nenulovú šírku, keď sú obe čísla známe', () => {
    const widths = [...WITH_DATA.matchAll(/width:\s*(\d+)%/g)].map((hit) => Number(hit[1]));
    expect(widths).toHaveLength(2);
    expect(Math.min(...widths)).toBeGreaterThan(0);
    // Dlhší pruh patrí väčšiemu číslu — pomer je k väčšiemu z dvoch.
    expect(Math.max(...widths)).toBe(100);
  });

  it('neznáme porovnávacie okno je pomlčka a bez pruhu — nikdy nula', () => {
    const html = cardOf({ ...VIEW, prior: { from: '2026-07-23', to: '2026-08-05', units: null } });
    expect(html).toContain('—');
    expect(html).not.toContain('0 ks');
    expect([...html.matchAll(/width:\s*\d+%/g)]).toHaveLength(1);
  });

  it('neúspešné načítanie sa povie vetou, nepredstiera sa číslom', () => {
    const html = cardOf(null, true);
    expect(html).toContain('Čísla sa nepodarilo načítať.');
    expect(html).not.toContain('Načítavam…');
    expect(html).not.toContain('ks');
  });
});

describe('D — popisok tretieho uhla je po slovensky (D18)', () => {
  it('príslovka už nie je nalepená na podstatné meno', () => {
    expect(WITH_DATA).toContain('Rovnaké obdobie vlani');
    expect(WITH_DATA).not.toContain('Vlani rovnaké obdobie');
  });
});

/* ═════════════ E. P1 — dominanta detailu je `.lvl-1` ════════════════════ */

describe('E — dominantu nesie škála `.lvl-1/.lvl-2/.lvl-3`, nie vlastná veľkosť (P1)', () => {
  it('detail zľavy má na obrazovke práve jednu dominantu a je označená', () => {
    expect(DETAIL_JSX).toContain('className="prog-lg lvl-1"');
    // Presne jedna `.lvl-1` na obrazovke — vrátane skorých návratov.
    expect(count(DETAIL_JSX, 'lvl-1')).toBe(1);
  });

  it('číslo priebehu je `.big`, teda tá istá miera ako dominanty inde', () => {
    expect(DETAIL_JSX).toContain('className="n big num"');
  });

  it('`.prog-lg` a `.lvl-1 .big` držia rovnakú mieru, kým ich integrátor nezlúči', () => {
    const progSize = /\.prog-lg \.n \{[^}]*font-size:\s*(\d+)px/.exec(GLOBAL_CSS);
    const bigSize = /\.lvl-1 \.big \{[^}]*font-size:\s*(\d+)px/.exec(GLOBAL_CSS);
    expect(bigSize).not.toBeNull();
    /*
     * `.prog-lg .n` má vlastnú veľkosť už len dovtedy, kým sa `globals.css`
     * neprepíše podľa návrhu (vtedy regex nenájde nič a je to v poriadku).
     * Kým existuje, nesmie sa od `.lvl-1 .big` odchýliť — inak by dominanta
     * detailu zľavy merala inak než dominanta ostatných obrazoviek.
     */
    if (progSize !== null) expect(progSize[1]).toBe(bigSize![1]);
  });
});
