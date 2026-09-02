/**
 * Aura Zľavy — TMAVÁ JE PREDVOLENÁ A NIKTO TO NESMIE ODMLČAŤ (V6a, D145).
 *
 * Do 2. 9. 2026 stála svetlá téma na HOLOM `:root` a tmavú zapínala
 * `@media (prefers-color-scheme: dark)`. Prevod hexov tie bloky zmazal, takže
 * holý `:root` nesie odteraz TMAVÚ. Tým sa obrátil význam JEDNEJ vetvy
 * bootstrapu: „nemám uloženú voľbu → zmaž atribút" znamenalo predtým
 * „nechaj rozhodnúť systém", a po obrátení znamená „daj vždy tmavú".
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * -------------------------
 * Pred V6a nemal bootstrap témy ANI JEDEN test — `grep -rl "ovl-theme" test/`
 * bolo prázdne. Repo má pritom zapísané, že čo test vyňal z kontroly,
 * nestráži nikto: rozcestník Nastavení mesiac ponúkal odkaz do prázdna práve
 * preto, že sa jedna kotva „kryje e2e" a e2e ju nekryla. Zmena predvolenej
 * témy je presne taká zmena — nikde nespadne, len sa appka jednému
 * používateľovi otvorí v nesprávnej farbe.
 *
 * ČO SA TU MERIA A ČO NIE
 * -----------------------
 * Neposudzuje sa, či je tmavá pekná ani či má kontrast (na to je
 * `paleta.spec.ts`, ktorý meria OBE témy tou istou sadou tvrdení). Meria sa
 * jediná vec: či CSS a skript hovoria o predvolenej téme TO ISTÉ. Skript sa
 * preto naozaj SPUSTÍ nad podvrhnutým `localStorage`, `matchMedia` a `<html>`
 * — nehľadajú sa v ňom reťazce. `expect(SCRIPT).toContain('light')` by prešiel
 * aj vtedy, keby to slovo stálo v mŕtvej vetve.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  effectiveTheme,
  parseStoredTheme,
} from '@/components/layout/theme';

const CSS = readFileSync(
  fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
  'utf8',
);

/* ═══════════════════ 1. Čo naozaj kreslí holý `:root` ════════════════════ */

/** Telo bloku, ktorý začína hlavičkou `head` a obsahuje `musiObsahovat`. */
function blok(head: string, musiObsahovat: string): string {
  let od = 0;
  for (;;) {
    const i = CSS.indexOf(head, od);
    if (i < 0) throw new Error(`blok sa nenašiel: ${head} (s ${musiObsahovat})`);
    const open = CSS.indexOf('{', i);
    let hlbka = 0;
    for (let k = open; k < CSS.length; k++) {
      if (CSS[k] === '{') hlbka++;
      else if (CSS[k] === '}') {
        hlbka--;
        if (hlbka === 0) {
          const telo = CSS.slice(open + 1, k);
          if (telo.includes(musiObsahovat)) return telo;
          od = k;
          break;
        }
      }
    }
  }
}

describe('CSS: holý `:root` nesie TMAVÚ tému (D145)', () => {
  const TMAVA = blok(':root {', '--st-critical:');
  const SVETLA = blok(':root[data-theme="light"] {', '--st-critical:');

  it('holý `:root` hlási prehliadaču `color-scheme: dark`', () => {
    // `color-scheme` nie je kozmetika: rozhoduje o farbe posuvníkov, polí
    // a natívnych ovládacích prvkov. Keby zostal `light`, appka by mala
    // tmavé plochy a svetlé posuvníky.
    expect(TMAVA).toContain('color-scheme: dark');
    expect(SVETLA).toContain('color-scheme: light');
  });

  it('plocha na holom `:root` je tmavšia než plocha svetlej témy', () => {
    // Meria sa hodnota, nie názov bloku: premenovanie selektora to neschová.
    const hodnota = (telo: string, token: string): number => {
      const m = telo.match(new RegExp(`^[ \\t]*${token}:\\s*#([0-9a-f]{6});`, 'mi'));
      if (m === null) throw new Error(`${token} nie je hex v tomto bloku`);
      const n = Number.parseInt(m[1]!, 16);
      // Súčet kanálov stačí — ide o „tmavšie/svetlejšie", nie o presný luma.
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    expect(hodnota(TMAVA, '--paper')).toBeLessThan(hodnota(SVETLA, '--paper'));
    expect(hodnota(TMAVA, '--paper2')).toBeLessThan(hodnota(SVETLA, '--paper2'));
  });

  it('svetlú tému nezapína žiadna media query — zapína ju iba atribút', () => {
    /*
     * Toto je tvrdenie, ktoré chráni celý prevod. Keby sa niekde vrátilo
     * `@media (prefers-color-scheme: …)` s paletou, mali by sme farbu
     * definovanú na dvoch miestach a jedno z nich by prebilo tokenovú vrstvu
     * — presne stav, ktorý V6a odstránila.
     */
    const media = CSS.match(/@media\s*\([^)]*prefers-color-scheme[^)]*\)\s*\{/g) ?? [];
    expect(media, 'paleta v media query je zakázaná (D145)').toEqual([]);
  });
});

/* ═════════════════ 2. Bootstrap sa naozaj spustí a stampuje ═══════════════ */

interface Vysledok {
  readonly atribut: string | null;
  readonly dopyty: readonly string[];
}

/**
 * Spustí `THEME_BOOTSTRAP_SCRIPT` nad podvrhnutým prostredím.
 *
 * `new Function` s parametrami `window`, `document` a `localStorage` ich
 * v tele skriptu ZASTRIE, takže sa nič nedotkne skutočného prostredia testu
 * a nepotrebujeme jsdom (`environment: 'node'`).
 */
function spusti(ulozene: string | null, systemHlasi: 'light' | 'dark' | null): Vysledok {
  let atribut: string | null = null;
  const dopyty: string[] = [];
  const html = {
    setAttribute(name: string, value: string) {
      if (name === 'data-theme') atribut = value;
    },
    removeAttribute(name: string) {
      if (name === 'data-theme') atribut = null;
    },
  };
  const window: Record<string, unknown> = {};
  if (systemHlasi !== null) {
    window['matchMedia'] = (q: string) => {
      dopyty.push(q);
      return { matches: q.includes(`prefers-color-scheme: ${systemHlasi}`) };
    };
  }
  const localStorage = {
    getItem(key: string) {
      return key === THEME_STORAGE_KEY ? ulozene : null;
    },
  };
  /* `new Function` je tu zámer: skript je náš vlastný literál, nie cudzí vstup. */
  new Function('window', 'document', 'localStorage', THEME_BOOTSTRAP_SCRIPT)(
    window,
    { documentElement: html },
    localStorage,
  );
  return { atribut, dopyty };
}

describe('bootstrap témy: pred prvým paintom stampuje to, čo CSS naozaj kreslí', () => {
  it('vzorka je tá pravá — skript sa naozaj vykonal', () => {
    // Poistka proti tomu, aby všetky tvrdenia nižšie prešli preto, že skript
    // spadol na výnimke a `try{}catch{}` ju spolkol.
    expect(spusti(null, 'light').dopyty.length).toBeGreaterThan(0);
  });

  it('uložená voľba vyhráva nad systémom v OBOCH smeroch', () => {
    expect(spusti('light', 'dark').atribut).toBe('light');
    expect(spusti('dark', 'light').atribut).toBe('dark');
  });

  it('bez voľby a systémovo SVETLÁ → atribút `light` sa stampuje EXPLICITNE', () => {
    /*
     * Toto je celá zmena D145. Do V6a sa tu atribút MAZAL, lebo holý `:root`
     * bol svetlý. Keby mazanie zostalo, používateľ so svetlým OS by dostal
     * tmavú appku bez toho, aby si o ňu povedal — a nikde by to nespadlo.
     */
    expect(spusti(null, 'light').atribut).toBe('light');
  });

  it('bez voľby a systémovo TMAVÁ → atribút zostáva nenastavený', () => {
    // Nie z lenivosti: holý `:root` JE tmavý, takže stampovať `dark` by bola
    // druhá cesta k tej istej farbe.
    expect(spusti(null, 'dark').atribut).toBeNull();
  });

  it('bez `matchMedia` zostáva atribút nenastavený, teda tmavá', () => {
    // Starý prehliadač nemá dostať výnimku a stránku bez štýlu.
    expect(spusti(null, null).atribut).toBeNull();
  });

  it('neplatná uložená hodnota sa berie ako „žiadna voľba"', () => {
    // Do `localStorage` vie zapísať čokoľvek aj iná záložka na tom istom
    // origine; „sepia" nesmie appku nechať bez témy.
    expect(spusti('sepia', 'light').atribut).toBe('light');
    expect(parseStoredTheme('sepia')).toBeNull();
  });
});

/* ═══════════ 3. Čistá funkcia hovorí to isté ako skript aj CSS ════════════ */

describe('`effectiveTheme` sa nerozišla so skriptom', () => {
  it('bez voľby rozhoduje systém', () => {
    expect(effectiveTheme(null, true)).toBe('dark');
    expect(effectiveTheme(null, false)).toBe('light');
  });

  it('voľba vyhráva nad systémom', () => {
    expect(effectiveTheme('light', true)).toBe('light');
    expect(effectiveTheme('dark', false)).toBe('dark');
  });

  it('to, čo stampuje skript, dá `effectiveTheme` po prečítaní atribútu', () => {
    /*
     * Prepínač (`ThemeToggle`) číta ATRIBÚT, nie `localStorage`, a posiela ho
     * do `parseStoredTheme`. Reťaz skript → atribút → prepínač preto musí
     * dávať tú istú tému, akú kreslí CSS; inak by tlačidlo v tmavej appke
     * ponúkalo „prepnúť na tmavú".
     */
    for (const system of ['light', 'dark'] as const) {
      const { atribut } = spusti(null, system);
      expect(effectiveTheme(parseStoredTheme(atribut), system === 'dark')).toBe(system);
    }
  });
});
