/**
 * Aura Zľavy — MŔTVE TRIEDY SA NEVRACAJÚ.
 *
 * V šablóne `.ovl-*` bola celá vrstva, ktorú nepoužíval ani jeden komponent:
 * `.ovl-card`, `.ovl-table`, `.ovl-eyebrow` a ich príbuzní. Nebola neškodná.
 * Prvá oprava rolí popiskov (D2) siahla presne na ne, vyzerala hotovo, testy
 * svietili zeleno — a na obrazovke sa nezmenilo nič, lebo tie selektory nič
 * nekreslili. Stálo to jeden celý priechod a našiel to až kontrolný agent.
 *
 * Vrstva je zmazaná (24. 8. 2026, 146 riadkov). Tento test drží, aby sa
 * nevrátila, a zároveň chráni tie `.ovl-*`, ktoré ŽIVÉ SÚ — zoznam nižšie nie
 * je „čo sa smie", ale „čo sa naozaj používa", a overuje sa proti stromu.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Zmazané rodiny. Ktorákoľvek z nich v CSS = návrat mŕtvej vrstvy. */
const ZMAZANE = [
  'ovl-card',
  'ovl-table',
  'ovl-eyebrow',
  'ovl-num',
  'ovl-date',
  'ovl-daterange',
] as const;

/** Zdrojové súbory, v ktorých sa trieda dá použiť. */
function zdroje(dir: string): readonly string[] {
  const out: string[] = [];
  for (const p of readdirSync(dir, { withFileTypes: true })) {
    const cesta = join(dir, p.name);
    if (p.isDirectory()) out.push(...zdroje(cesta));
    else if (/\.(tsx|ts|module\.css)$/.test(p.name)) out.push(cesta);
  }
  return out;
}

const ZDROJ = zdroje(resolve(process.cwd(), 'src'))
  .filter((f) => !f.endsWith('globals.css'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Selektory v CSS, bez komentárov — tie o histórii písať smú. */
const CSS_BEZ_KOMENTAROV = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Je trieda v texte ako CELÉ meno?
 *
 * `toContain('.ovl-btn')` na to nestačí a nie je to teoretická chyba: pri
 * mutačnom overení som `.ovl-btn` premenoval na `.ovl-btnX` a test zostal
 * zelený, lebo jedno je podreťazcom druhého. Trieda končí tam, kde končí
 * meno — nie kdekoľvek.
 */
function maTriedu(text: string, trieda: string): boolean {
  return new RegExp(`\\.${trieda}(?![\\w-])`).test(text);
}

describe('mŕtva vrstva .ovl-* sa nevrátila', () => {
  it('meranie vôbec niečo našlo', () => {
    /* Bez tejto poistky by testy nižšie prešli aj nad prázdnym reťazcom. */
    expect(CSS_BEZ_KOMENTAROV.length).toBeGreaterThan(10_000);
    expect(ZDROJ.length).toBeGreaterThan(10_000);
    expect(maTriedu(CSS_BEZ_KOMENTAROV, 'ovl-btn')).toBe(true);
  });

  for (const trieda of ZMAZANE) {
    it(`.${trieda} nie je v globals.css`, () => {
      expect(maTriedu(CSS_BEZ_KOMENTAROV, trieda), `.${trieda} sa vrátila do CSS`).toBe(false);
    });
  }

  it('a ani jeden komponent ich nepoužíva', () => {
    /*
     * Druhá strana tej istej mince. Keby ich niekto začal používať bez CSS,
     * nedostal by mŕtvu vrstvu, ale triedu bez štýlu — tiež tichý omyl.
     */
    for (const trieda of ZMAZANE) {
      expect(maTriedu(ZDROJ, trieda), `.${trieda} sa používa, hoci štýl nemá`).toBe(false);
      /* V JSX stojí trieda bez bodky, tak sa pýtame aj tak. */
      expect(ZDROJ, `${trieda} sa používa, hoci štýl nemá`).not.toMatch(
        new RegExp(`\\b${trieda}(?![\\w-])`),
      );
    }
  });

  it('živé .ovl-* sa nezmazali spolu s nimi', () => {
    /*
     * Toto je tá druhá polovica. Mazanie podľa predpony by zobralo aj tieto
     * a nikto by si toho nevšimol, kým by sa appka nerozsypala vizuálne.
     */
    for (const trieda of ['ovl-btn', 'ovl-badge', 'ovl-drawer', 'ovl-empty', 'ovl-ic']) {
      expect(maTriedu(CSS_BEZ_KOMENTAROV, trieda), `.${trieda} zmizla z CSS`).toBe(true);
      expect(ZDROJ, `${trieda} už nikto nepoužíva — je mŕtva a patrí preč`).toMatch(
        new RegExp(`\\b${trieda}(?![\\w-])`),
      );
    }
  });
});
