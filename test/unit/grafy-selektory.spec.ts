/**
 * Aura Zľavy — GRAFY: ŽIVÉ SELEKTORY V OBOCH SMEROCH (V6b, 2. 9. 2026; K5, D139, D143).
 *
 * PREČO TENTO SÚBOR VZNIKOL
 * ─────────────────────────
 * Presne tá istá trieda chýb, ktorá 2. 9. 2026 rozsypala sprievodcu Novou
 * zľavou (rozbor je v `nova-zlava-selektory.spec.ts`): vitest rieši
 * `.module.css` Proxy-om, ktorý na KAŽDÝ kľúč vráti hašované meno. `styles.nz`
 * je v teste `_nz_e472ea` aj vtedy, keď v module žiadne `.nz` neexistuje —
 * v prehliadači je ten istý kľúč `undefined`, teda `class="undefined"`.
 * Typecheck, lint ani vykreslený markup o tom nepovedia NIČ. Jediná cesta je
 * čítať CSS ako TEXT.
 *
 * A prečo pre grafy vlastný súbor: `charts.module.css` je jediný modul v tomto
 * repe, z ktorého kreslí PIAŤ komponentov v troch priečinkoch
 * (`charts/`, `ui/`, `dashboard/`). Tam sa oba smery pokazia najľahšie:
 *
 *  · **Chýbajúci kľúč** — komponent sa presunie alebo prepne import a mená
 *    tried zostanú staré. To je `class="undefined"`.
 *  · **Mŕtva trieda** — komponent odíde a jeho triedy v module zostanú.
 *    Nikde to nespadne (nepoužité CSS je platné CSS) a o mesiac ich niekto
 *    použije v domnení, že niečo kreslia. Presne to sa tu stalo: vrstvu myši
 *    z V1 (`.frame`, `.hitArea`, `.crosshair`, `.hotDot`, `.tip*`) nahradil
 *    vo V6a `<Tooltip>` Rechartsu a trinásť tried zostalo v súbore ležať.
 *    Zmazané sú 2. 9. 2026 spolu s touto závorou.
 *
 * ČO TENTO SÚBOR NEMERÁ: farby a kontrast (to je `grafy-paleta.spec.ts`
 * a `paleta.spec.ts`), tokeny (`dizajn-tokeny-strazca.spec.ts`) ani to, či
 * graf hovorí pravdu (`grafy-jazyk.spec.ts`, `grafy-ceny.spec.ts`).
 * Pýta sa jedinú otázku: **existuje to, na čo sa kód odvoláva, a odvoláva sa
 * niekto na to, čo v súbore je?**
 *
 * Vlastník: V6b (agent 27 — jeden jazyk grafov).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const ROOT = resolve(process.cwd());

/** Všetky `.ts`/`.tsx` pod priečinkom — hľadané na disku, nie vypísané ručne. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Zdroj bez komentárov — `styles.foo` v komentári nie je vykreslená trieda. */
const bezKomentarov = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const MODUL = read('../../src/components/charts/charts.module.css');

/**
 * Súbory, ktoré z `charts.module.css` NAOZAJ kreslia — a pod akým menom si
 * ho naimportovali. `SalesChart` má dva moduly naraz (svoj vlastný ako
 * `styles`, spoločný ako `chartStyles`), takže meno premennej je súčasťou
 * merania: hľadať `styles.` by v ňom našlo triedy z iného súboru a test by
 * hlásil chýbajúce triedy, ktoré nikde nechýbajú.
 */
const KRESLIA = [
  { rel: '../../src/components/charts/ChartCard.tsx', premenna: 'styles' },
  { rel: '../../src/components/charts/ChartTable.tsx', premenna: 'styles' },
  { rel: '../../src/components/charts/PriceHistogram.tsx', premenna: 'styles' },
  { rel: '../../src/components/ui/Charts.tsx', premenna: 'styles' },
  { rel: '../../src/components/dashboard/SalesChart.tsx', premenna: 'chartStyles' },
] as const;

/** Kľúče, ktoré si daný súbor z modulu grafov pýta. */
function pouziteKluce(rel: string, premenna: string): Set<string> {
  const vzor = new RegExp(`${premenna}\\.([a-zA-Z0-9_]+)`, 'g');
  return new Set([...bezKomentarov(rel).matchAll(vzor)].map((m) => m[1]!));
}

const VSETKY_POUZITE = new Set(KRESLIA.flatMap(({ rel, premenna }) => [...pouziteKluce(rel, premenna)]));

/** Triedy deklarované v module — len tie na začiatku riadku, teda pravidlá. */
const DEKLAROVANE = [...new Set([...MODUL.matchAll(/^\.([a-zA-Z][a-zA-Z0-9_]*)/gm)].map((m) => m[1]!))];

/* ══════════════ A. Meranie vôbec niečo našlo ═════════════════════════════ */

describe('A. závora nie je vákuum', () => {
  it('každý súbor v zozname si modul grafov naozaj importuje', () => {
    /*
     * Bez tejto vety by oba smery nižšie prešli aj nad prázdnym zoznamom —
     * a presne tak vznikol v Produktoch zelený test o mŕtvych selektoroch.
     * Meria sa aj MENO premennej, lebo o ňom stojí zvyšok súboru.
     */
    for (const { rel, premenna } of KRESLIA) {
      expect(bezKomentarov(rel), rel).toContain(
        `import ${premenna} from '@/components/charts/charts.module.css'`,
      );
    }
  });

  it('nikto iný z modulu grafov nekreslí — zoznam sa hľadá na disku', () => {
    /*
     * Druhý smer úplnosti, a je NOSNÝ: keby si modul naimportoval šiesty
     * súbor, zoznam by zostarel a jeho triedy by v smere C vyzerali ako
     * mŕtve — teda test by hlásil chybu, ktorá nie je, alebo (horšie) by
     * cudzie triedy pokrýval a smer C by prestal merať.
     *
     * Preto sa zoznam NEDÔVERUJE: prehľadá sa celý `src/` na import tohto
     * modulu a porovná sa s `KRESLIA`. Import je jediné miesto, ktoré sa
     * nedá obísť — trieda sa dá premenovať, import nie.
     */
    const najdene = tsFiles(resolve(ROOT, 'src'))
      .filter((path) => /from\s+'@\/components\/charts\/charts\.module\.css'/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(ROOT, path).split(sep).join('/'))
      .sort();
    const zname = KRESLIA.map(({ rel }) => rel.replace('../../', '')).sort();
    expect(najdene, 'zoznam KRESLIA sa rozišiel so skutočnosťou').toEqual(zname);

    // `globals.css` a ostatné `*.module.css` modul len MENUJÚ v komentári,
    // neimportujú ho — CSS import v CSS by bol `@import`, a ten tu nie je.
    expect(MODUL).not.toContain('@import');
  });

  it('modul aj použitie majú rozumnú veľkosť', () => {
    expect(MODUL.length).toBeGreaterThan(1000);
    expect(DEKLAROVANE.length).toBeGreaterThan(15);
    expect(VSETKY_POUZITE.size).toBeGreaterThan(15);
  });
});

/* ═════ B. Prvý smer: použitý kľúč v module EXISTUJE ══════════════════════ */

describe('B. každý použitý kľúč má v module pravidlo', () => {
  it('ani jeden `styles.*` nechýba (inak je to `class="undefined"`)', () => {
    const chybajuce: string[] = [];
    for (const { rel, premenna } of KRESLIA) {
      for (const meno of pouziteKluce(rel, premenna)) {
        /*
         * `\b` nestačí: `.bar` je podreťazcom `.barOpen`, takže hranica musí
         * vylúčiť pokračovanie mena. Bez toho by chýbajúca `.bar` prešla len
         * preto, že v súbore je `.barOpen`.
         */
        if (!new RegExp(`\\.${meno}(?![a-zA-Z0-9_-])`).test(MODUL)) {
          chybajuce.push(`${rel.replace('../../', '')} → ${premenna}.${meno}`);
        }
      }
    }
    expect(chybajuce, 'tieto triedy v charts.module.css nie sú').toEqual([]);
  });

  it('hranica mena nie je slepá', () => {
    // Detektor sám: `.bar` sa nesmie uspokojiť s `.barOpen`.
    const vzorka = '.barOpen {\n  stroke: var(--paper2);\n}\n';
    expect(new RegExp('\\.bar(?![a-zA-Z0-9_-])').test(vzorka)).toBe(false);
    expect(new RegExp('\\.barOpen(?![a-zA-Z0-9_-])').test(vzorka)).toBe(true);
  });
});

/* ═════ C. Druhý smer: deklarovaná trieda má VOLAJÚCEHO (D139) ════════════ */

describe('C. ani jedna deklarovaná trieda nezostala bez volajúceho', () => {
  it('v module nie je mŕtve pravidlo', () => {
    /*
     * Mŕtva trieda je dlh, ktorý si nikto nevšimne: nepoužité CSS je platné
     * CSS a nepoužitý kľúč je v teste hash. Zoznam volajúcich je uzavretý
     * (skupina A), takže „nikto ju nekreslí" sa dá tvrdiť bez pochybnosti.
     *
     * Keby tu niekedy musela vzniknúť výnimka, píše sa k nej AJ TO, KTO tú
     * vec stráži namiesto tohto testu. Dnes výnimka nie je ani jedna a je to
     * zámer: trinásť tried po vrstve myši z V1 sa 2. 9. 2026 zmazalo,
     * namiesto aby sa vypísalo sem.
     */
    const mrtve = DEKLAROVANE.filter((meno) => !VSETKY_POUZITE.has(meno));
    expect(mrtve, 'tieto triedy modulu grafov nikto nekreslí').toEqual([]);
  });

  it('vrstva myši z V1 sa do modulu nevrátila', () => {
    /*
     * Trinásť mien, ktoré tu ležali mŕtve od V6a (vlastný nitkový kríž a
     * bublinu nahradil `<Tooltip>` Rechartsu). Keby sa niektoré vrátilo bez
     * volajúceho, spadne test vyššie; toto tvrdenie hovorí NAHLAS, čo sa
     * zmazalo, aby to nikto nepovažoval za nedopatrenie.
     */
    const ZMAZANE = [
      'frame',
      'hitArea',
      'crosshair',
      'hotDot',
      'tip',
      'tipDay',
      'tipValue',
      'tipNote',
      'gapFill',
      'gapLabel',
      'pointLabel',
      'pointLabelDim',
      'refLabel',
    ];
    for (const meno of ZMAZANE) {
      expect(DEKLAROVANE, `.${meno} sa vrátila do charts.module.css`).not.toContain(meno);
    }
  });
});
