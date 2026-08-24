/**
 * Aura Zľavy — ŠTYRI CHYBY, KTORÉ NAŠIEL STATICKÝ SNÍMKOVAČ (UX1, vlna 3).
 *
 * `npm run snimky` odfotil 24. 8. 2026 šestnásť obrazoviek pri 1440 × 900 a
 * na nich boli štyri veci, ktoré vlastní `src/app/globals.css`:
 *
 *   1. legenda grafu predaja nafúknutá — marky legendy dostali `width: 100%`
 *      z pravidla určeného pre plochu grafu a preliezli text;
 *   2. majster/detail na Produktoch sa pri 1440 px nepostavil vedľa seba —
 *      súčet flex-základov bol väčší než miesto, ktoré na obrazovke existuje;
 *   3. tabuľky odsekli posledný riadok vodorovne v polovici;
 *   4. dráha meracieho prúžku nebola v tmavej téme vidieť.
 *
 * PREČO SA TU NEHĽADAJÚ REŤAZCE
 * -----------------------------
 * `expect(CSS).toContain('flex: 1 1 350px')` by prešiel aj vtedy, keby bolo
 * miesto na obrazovke 300 px — nemeria totiž nič, len prepíše hodnotu z CSS do
 * testu. Preto sa tu z `globals.css` čítajú HODNOTY a nad nimi sa POČÍTA to
 * isté, čo počíta prehliadač:
 *
 *   · pri legende sa selektor z CSS priloží na SKUTOČNE VYKRESLENÉ `<svg>`
 *     z `SalesChart` a pýta sa, ktoré z nich kreslí;
 *   · pri rozložení sa zloží celý reťazec šírok (bočný panel → `.wrap` →
 *     stĺpec filtrov → rad) a porovná sa so súčtom flex-základov, lebo presne
 *     ten rozhoduje o zalomení radu;
 *   · pri hrane tabuľky sa porovná poloha masky s koncom obsahu;
 *   · pri prúžku sa počíta kontrastný pomer, nie „je tam iný hex".
 *
 * Každé tvrdenie tu bolo mutačne overené: pravidlo v `globals.css` sa naozaj
 * pokazilo a test spadol.
 *
 * Vlastník: UX1.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import SalesChart from '@/components/dashboard/SalesChart';
import { chartGeometry } from '@/components/dashboard/sales-view';

import { contrast } from '../helpers/palette-math';

const CSS = readFileSync(
  fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
  'utf8',
);

/* ═══════════════════════ 0. Čítanie hodnôt z CSS ══════════════════════════ */

/**
 * Telo bloku, ktorý začína danou hlavičkou. `musiObsahovat` nie je pohodlie:
 * `:root {`, `.wrap {` aj `.tbl-scroll {` sú v súbore viackrát (raz naostro,
 * raz v media query) a bez rozlíšenia by test čítal ten nesprávny.
 */
function blok(hlavicka: string, musiObsahovat?: string): string {
  let od = 0;
  for (;;) {
    const i = CSS.indexOf(hlavicka, od);
    if (i < 0) break;
    const open = CSS.indexOf('{', i);
    let hlbka = 0;
    for (let k = open; k < CSS.length; k++) {
      if (CSS[k] === '{') hlbka++;
      else if (CSS[k] === '}') {
        hlbka--;
        if (hlbka === 0) {
          const telo = CSS.slice(open + 1, k);
          if (musiObsahovat === undefined || telo.includes(musiObsahovat)) return telo;
          od = k;
          break;
        }
      }
    }
    if (od <= i) throw new Error(`neuzavretý blok: ${hlavicka}`);
  }
  throw new Error(`blok sa nenašiel: ${hlavicka}${musiObsahovat ? ` (s ${musiObsahovat})` : ''}`);
}

/** Hodnota deklarácie v tele bloku, bez komentárov. */
function hodnota(telo: string, vlastnost: string): string {
  const cisté = telo.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = cisté.match(new RegExp(`(?:^|[;{\\s])${vlastnost}:\\s*([^;]+);`));
  if (!m) throw new Error(`deklarácia ${vlastnost} v bloku chýba`);
  return m[1]!.trim();
}

/** Pixelové číslo z hodnoty typu `240px`. Bezrozmerná nula je tiež dĺžka. */
function px(v: string): number {
  const t = v.trim();
  if (t === '0') return 0;
  const m = t.match(/^(-?[\d.]+)px$/);
  if (!m) throw new Error(`nie je pixelová dĺžka: ${v}`);
  return Number(m[1]);
}

const KOSTRA = blok(':root {', '--side-w');

/** Dĺžka s rozvinutým `var(--x)` proti tokenom kostry. */
function dlzka(v: string): number {
  const m = v.trim().match(/^var\((--[a-z0-9-]+)\)$/i);
  return px(m ? hodnota(KOSTRA, m[1]!) : v);
}
const SVETLA = blok(':root {', '--st-critical');
const TMAVA_SYSTEM = blok(":root:not([data-theme='light']) {");
const TMAVA_RUCNE = blok(":root[data-theme='dark'] {");

/** Rozvinie `var(--x)` na hex; bez toho by sa merali reťazce, nie farby. */
function farba(telo: string, token: string, hlbka = 0): string {
  if (hlbka > 8) throw new Error(`cyklus pri ${token}`);
  const v = hodnota(telo, token);
  const m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (m) return farba(telo, m[1]!, hlbka + 1);
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  throw new Error(`token ${token} nie je hex ani var(): ${v}`);
}

/* ══════ 1. Legenda grafu: pravidlo kreslí plochu, nie marky vedľa slov ═════ */

describe('1 — `.chart svg` nesmie chytiť marky legendy', () => {
  /** Selektor, ktorým `globals.css` roztiahne graf na šírku karty. */
  const SELEKTOR = (() => {
    // Hľadá sa pravidlo v rodine `.chart`, ktoré nastavuje `width: 100%`.
    // Nie podľa mena — podľa toho, čo robí; premenovanie ho neschová.
    const bez = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of bez.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1]!.trim();
      if (!sel.startsWith('.chart') || !sel.includes('svg')) continue;
      if (/width:\s*100%/.test(m[2]!)) return sel;
    }
    throw new Error('pravidlo `.chart … svg { width: 100% }` sa nenašlo');
  })();

  interface Znacka {
    readonly tag: string;
    readonly atributy: Readonly<Record<string, string>>;
  }

  /** `<svg …>` z vykresleného HTML na tag + atribúty. */
  function znacky(html: string): Znacka[] {
    return [...html.matchAll(/<(svg)\b([^>]*)>/g)].map((m) => {
      const atributy: Record<string, string> = {};
      for (const a of m[2]!.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) atributy[a[1]!] = a[2]!;
      return { tag: m[1]!, atributy };
    });
  }

  /**
   * Kreslí `SELEKTOR` toto konkrétne SVG?
   *
   * Rodičom plochy grafu je `.frame`, rodičom marky `.legendItem` — ani jedno
   * nie je PRIAMY potomok `.chart`, takže `>` nekreslí ani jedno a je to chyba
   * rovnako ako príliš široký selektor.
   */
  function kresli(selektor: string, z: Znacka): boolean {
    if (selektor.includes('>')) return false;
    const casti = selektor.trim().split(/\s+/);
    if (casti[0] !== '.chart' || casti.length !== 2) return false;
    const compound = casti[1]!;
    const tag = compound.match(/^[a-zA-Z]+/)?.[0] ?? '*';
    if (tag !== '*' && tag !== z.tag) return false;
    for (const p of compound.matchAll(/\[([a-zA-Z-]+)(?:([~^|$*]?=)['"]?([^\]'"]*)['"]?)?\]/g)) {
      const meno = p[1]!;
      const skutocna = z.atributy[meno];
      if (skutocna === undefined) return false;
      if (p[2] === '=' && skutocna !== p[3]) return false;
    }
    for (const c of compound.matchAll(/\.([\w-]+)/g)) {
      if (!(z.atributy['class'] ?? '').split(/\s+/).includes(c[1]!)) return false;
    }
    return true;
  }

  /* Štrnásť dní vrátane dneška — geometria s trendom aj s otvoreným dneškom,
     teda legenda s viac než jednou markou. */
  const DNES = '2026-08-24';
  const DNI = Array.from({ length: 14 }, (_, i) => ({
    day: `2026-08-${String(11 + i).padStart(2, '0')}`,
    units: 8 + ((i * 5) % 7),
  }));

  const HTML = renderToStaticMarkup(
    createElement(SalesChart, {
      geometry: chartGeometry(DNI, DNES)!,
      caption: '11. 8. – 24. 8. · 14 dní s údajmi · povolené produkty',
      label: 'Predané kusy povolených produktov po dňoch',
    }),
  );

  const VSETKY = znacky(HTML);
  const PLOCHA = VSETKY.filter((z) => z.atributy['data-testid'] === 'sales-chart');
  const MARKY = VSETKY.filter((z) => z.atributy['aria-hidden'] === 'true');

  it('vzorka je tá pravá — jedna plocha grafu a niekoľko mariek legendy', () => {
    expect(PLOCHA).toHaveLength(1);
    // Bez mariek by test nemal čo merať a tichým prechodom by klamal.
    expect(MARKY.length).toBeGreaterThanOrEqual(2);
    expect(HTML).toContain('data-testid="sales-chart-legend"');
  });

  it('pravidlo kreslí plochu grafu', () => {
    expect(kresli(SELEKTOR, PLOCHA[0]!)).toBe(true);
  });

  it('to isté pravidlo nekreslí ani jednu marku legendy', () => {
    for (const marka of MARKY) {
      const meno = marka.atributy['class'] ?? '(bez triedy)';
      expect(
        kresli(SELEKTOR, marka),
        `selektor \`${SELEKTOR}\` roztiahne marku legendy (${meno}) na 100 % šírky`,
      ).toBe(false);
    }
  });

  it('marka legendy je malá a rolu obrázka nemá — na tom stojí rozlíšenie', () => {
    for (const marka of MARKY) {
      expect(Number(marka.atributy['width'])).toBeLessThanOrEqual(16);
      expect(marka.atributy['role']).toBeUndefined();
    }
    expect(PLOCHA[0]!.atributy['role']).toBe('img');
  });
});

/* ═══ 2. Majster/detail: rad sa na 1440 aj 1280 px musí zmestiť do miesta ═══ */

describe('2 — `.catalog-split` sa zmestí na cieľovú šírku', () => {
  const SIDE_W = px(hodnota(KOSTRA, '--side-w'));
  /** `.wrap { padding: var(--gap) 20px 28px }` — vodorovné je to druhé. */
  const WRAP_X = px(hodnota(blok('.wrap {', 'max-width: var(--w)'), 'padding').split(/\s+/)[1]!);
  const FILTRE = blok('.layout-filters {', '260px');
  const FILTRE_W = px(hodnota(FILTRE, 'grid-template-columns').split(/\s+/)[0]!);
  const FILTRE_GAP = px(hodnota(FILTRE, 'gap'));
  const RAD_GAP = px(hodnota(blok('.catalog-split {'), 'gap'));

  /** `flex: <grow> <shrink> <basis>`. */
  function flex(telo: string): { grow: number; basis: number } {
    const [g, , b] = hodnota(telo, 'flex').split(/\s+/);
    return { grow: Number(g), basis: px(b!) };
  }

  const TABULKA = flex(blok('.catalog-split > .tbl-frame {'));
  const PANEL = flex(blok('.catalog-split > .drawer {'));
  const PANEL_MAX = px(hodnota(blok('.catalog-split > .drawer {'), 'max-width'));

  /**
   * Koľko px zostane pre `.catalog-split` pri danej šírke okna.
   * `--side-w` je celá stopa bočného panela (`box-sizing: border-box`, rám je
   * v nej). Zvislý posuvník okna sa odratáva, lebo na Produktoch je vždy.
   */
  const POSUVNIK = 15;
  function miestoPreRad(okno: number, posuvnik = POSUVNIK): number {
    return okno - posuvnik - SIDE_W - 2 * WRAP_X - FILTRE_W - FILTRE_GAP;
  }

  /**
   * O ZALOMENÍ RADU rozhoduje súčet hypotetických veľkostí položiek, teda
   * flex-základov — nie výsledné šírky po raste. Toto je celá chyba 2.
   */
  const POTREBA = TABULKA.basis + PANEL.basis + RAD_GAP;

  /** Šírky po rozdelení voľného miesta podľa `flex-grow`, s orezom `max-width`. */
  function sirky(okno: number): { tabulka: number; panel: number } {
    const miesto = miestoPreRad(okno);
    const volno = miesto - POTREBA;
    const podiel = TABULKA.grow + PANEL.grow;
    let panel = PANEL.basis + (volno * PANEL.grow) / podiel;
    let tabulka = TABULKA.basis + (volno * TABULKA.grow) / podiel;
    if (panel > PANEL_MAX) {
      panel = PANEL_MAX;
      tabulka = miesto - RAD_GAP - panel;
    }
    return { tabulka, panel };
  }

  it('na 1440 × 900 rad drží — presne toto na snímke neplatilo', () => {
    const miesto = miestoPreRad(1440);
    // Kontrolný výpočet: 1440 − 15 − 240 − 40 − 274 = 871 px.
    expect(miesto).toBeGreaterThan(800);
    expect(miesto).toBeLessThan(900);
    expect(
      POTREBA,
      `pre rad je ${miesto} px, základy chcú ${POTREBA} px — panel spadne POD tabuľku`,
    ).toBeLessThanOrEqual(miesto);
  });

  it('na 1280 px rad drží tiež', () => {
    expect(POTREBA).toBeLessThanOrEqual(miestoPreRad(1280));
  });

  it('pod ~1100 px sa smie zalomiť — a naozaj sa zalomí', () => {
    // Bez tohto tvrdenia by chybu „nezmestí sa" opravil aj základ 0 px, ktorý
    // by pod tabuľku nechal 40 px panela namiesto zalomenia.
    let prah = 1440;
    while (prah > 900 && POTREBA <= miestoPreRad(prah)) prah -= 1;
    expect(prah).toBeLessThan(1280);
    expect(prah).toBeGreaterThanOrEqual(1000);
    expect(prah).toBeLessThanOrEqual(1130);
  });

  it('tabuľka zostáva dominantou radu a panel je použiteľne široký (P1)', () => {
    for (const okno of [1280, 1440, 1920]) {
      const { tabulka, panel } = sirky(okno);
      // Nie „len o kúsok širšia": tabuľka je dominanta obrazovky, panel je
      // jej doplnok. Delenie 1 : 1 stlačilo stĺpec názvu na 167 px a tri
      // rôzne kusy sa v ňom volali rovnako.
      expect(
        tabulka / panel,
        `${okno} px: tabuľka ${Math.round(tabulka)} px, panel ${Math.round(panel)} px`,
      ).toBeGreaterThanOrEqual(1.4);
      expect(panel, `${okno} px: panel ${Math.round(panel)} px`).toBeGreaterThanOrEqual(240);
      expect(panel).toBeLessThanOrEqual(PANEL_MAX);
    }
    // Na cieľovej šírke musí panel uniesť dvojstĺpcový zoznam údajov a tabuľka
    // musí uniesť päť stĺpcov s rozlíšiteľným názvom.
    expect(sirky(1440).panel).toBeGreaterThanOrEqual(300);
    expect(sirky(1440).tabulka).toBeGreaterThanOrEqual(520);
  });

  it('tabuľka sa smie stlačiť — inak ju vlastný obsah z radu vytlačí', () => {
    expect(px(hodnota(blok('.catalog-split > .tbl-frame {'), 'min-width'))).toBe(0);
    expect(px(hodnota(blok('.catalog-split > .drawer {'), 'min-width'))).toBe(0);
  });
});

/* ═════ 3. Dolná hrana posuvnej plochy sa stmieva namiesto rezania ═════════ */

describe('3 — posledný riadok sa neodsekne vodorovne', () => {
  const FADE = px(hodnota(KOSTRA, '--fade'));

  /** Odkiaľ (od hornej hrany, v px zdola) začína maska stmievať. */
  function maska(telo: string): number {
    const v = hodnota(telo, 'mask-image');
    const m = v.match(/calc\(100%\s*-\s*var\((--[a-z0-9-]+)\)\)/);
    if (!m) throw new Error(`maska nie je „calc(100% - var(…))": ${v}`);
    return px(hodnota(KOSTRA, m[1]!));
  }

  const PLOCHY: readonly { readonly kde: string; readonly telo: string }[] = [
    { kde: '.tbl-scroll', telo: blok('.tbl-scroll {', 'mask-image') },
    { kde: '.catalog-split > .drawer', telo: blok('.catalog-split > .drawer {') },
  ];

  it('stmievanie je nenulové — inak niet signálu, že obsah pokračuje', () => {
    expect(FADE).toBeGreaterThan(8);
    expect(FADE).toBeLessThanOrEqual(40);
  });

  for (const { kde, telo } of PLOCHY) {
    it(`${kde}: na konci posunu nie je stmievaný obsah, len prázdno`, () => {
      const stmievanie = maska(telo);
      const rezerva = dlzka(hodnota(telo, 'padding-bottom'));
      // Na konci posunu končí obsah `rezerva` px nad dolnou hranou a maska
      // začína `stmievanie` px nad ňou. Keď je rezerva menšia, maska zožerie
      // posledný riadok a tvári sa, že zoznam pokračuje, hoci nepokračuje.
      expect(
        rezerva,
        `${kde}: obsah končí ${rezerva} px nad hranou, maska stmieva už od ${stmievanie} px`,
      ).toBeGreaterThanOrEqual(stmievanie);
      expect(stmievanie).toBe(FADE);
    });

    it(`${kde}: maska je zapísaná aj s predponou -webkit-`, () => {
      expect(hodnota(telo, '-webkit-mask-image')).toBe(hodnota(telo, 'mask-image'));
    });
  }

  it('strop výšky ostáva — plocha sa posúva, stránka nie (P4)', () => {
    // Keby strop zmizol, hrana by sa síce prestala rezať, ale obrazovka by
    // prerástla 1,5 obrazovky a chyba by sa vymenila za inú.
    expect(hodnota(blok('.tbl-scroll {', 'mask-image'), 'max-height')).toContain('100vh');
    expect(hodnota(blok('.tbl-scroll {', 'mask-image'), 'overflow')).toBe('auto');
  });
});

/* ═════════ 4. Dráha meracieho prúžku je vidieť v OBOCH témach ═════════════ */

describe('4 — prúžok má dráhu aj v tmavej téme', () => {
  /**
   * Prahy sú odvodené z toho, čo snímkovač ukázal, nie vymyslené: svetlá téma
   * mala 1,22 : 1 a dráha bola vidieť, tmavá mala 1,13 : 1 a vidieť nebola.
   * Tmavá potrebuje väčší odstup než svetlá — rozdiel dvoch takmer čiernych
   * odtieňov oko takmer nezachytí. Meria sa proti KARTE (`--paper2`), lebo
   * prúžky žijú v kartách; proti `--paper` je aj svetlá dráha len 1,12 : 1
   * a taký prah by nemeral prúžok, ale niečo, čo na obrazovke nie je.
   */
  const TEMY = [
    { nazov: 'svetlá', telo: SVETLA, prah: 1.2 },
    { nazov: 'tmavá (systémová)', telo: TMAVA_SYSTEM, prah: 1.45 },
    { nazov: 'tmavá (ručná)', telo: TMAVA_RUCNE, prah: 1.45 },
  ];

  for (const { nazov, telo, prah } of TEMY) {
    it(`${nazov}: dráha sa odlíši od karty, na ktorej leží`, () => {
      const track = farba(telo, '--track');
      const karta = farba(telo, '--paper2');
      const pomer = contrast(track, karta);
      expect(
        pomer,
        `${nazov}: --track ${track} na --paper2 ${karta} = ${pomer.toFixed(2)} : 1`,
      ).toBeGreaterThanOrEqual(prah);
    });

    it(`${nazov}: naplnená časť sa od dráhy odlíši — inak niet mierky`, () => {
      const pomer = contrast(farba(telo, '--barfill'), farba(telo, '--track'));
      expect(pomer).toBeGreaterThanOrEqual(3);
    });
  }

  it('obe deklarácie tmavej témy hovoria o dráhe to isté', () => {
    expect(farba(TMAVA_SYSTEM, '--track')).toBe(farba(TMAVA_RUCNE, '--track'));
  });

  it('tmavá dráha nie je slabšia než svetlá — na tmavom podklade to nestačí', () => {
    const svetla = contrast(farba(SVETLA, '--track'), farba(SVETLA, '--paper2'));
    const tmava = contrast(farba(TMAVA_RUCNE, '--track'), farba(TMAVA_RUCNE, '--paper2'));
    expect(tmava).toBeGreaterThan(svetla);
  });
});
