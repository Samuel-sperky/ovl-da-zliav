/**
 * Aura Zľavy — STRÁŽCA TOKENOVEJ VRSTVY (D132, D144, D147, K1, K3; V6a, 2. 9. 2026).
 *
 * Predloha je `aura-roadmap/src/app/globals.css.test.ts` a jej veta *„toto sú
 * dizajnové pravidlá, ktoré rodina stále ručne porušuje, takže sú vynútené
 * mechanicky"*. Tu je test PRÍSNEJŠÍ, a to z jedného dôvodu: `aura-roadmap`
 * začínal z dlhu (mal hexy v pravidlách a musel si dovoliť „hocijaký `:root`
 * je tokenový blok"), kým tento repo prevod 121 hexov práve dokončil. Kto sa
 * nemusí zmierovať s dlhom, nesmie si písať mierne pravidlá — inak si dlh
 * vyrobí znova a bude naň mať zelený test.
 *
 * TRI SPÔSOBY, AKO SA TENTO TEST DAL OBÍSŤ, KEBY BOL NAPÍSANÝ NAIVNE:
 *
 *  A. **Čítať len `globals.css`.** Po D143 ide vzhľad primitív do
 *     `src/components/ui/*.module.css`. Hex by sa presunul o priečinok nižšie
 *     a test by zostal zelený — presne pasca „čo test vyňal z kontroly,
 *     nestráži NIKTO" (D144). Preto sa číta `globals.css` **aj všetkých
 *     `src/**\/*.module.css`**, a zoznam modulov sa hľadá na disku, nie ručne.
 *
 *  B. **Považovať každý `:root` za tokenový blok.** Tento súbor má `:root`
 *     blokov šesť a JEDEN z nich tokenový NIE JE — aliasová vrstva na
 *     riadku ~488 (`--ovl-bg: var(--paper)` …). Keby sa hex smel schovať tam,
 *     stačilo by ho napísať o 400 riadkov nižšie. Tokenový blok je preto len
 *     ten, nad ktorým stojí značka `@tokens:invariant|dark|light|derived`
 *     v komentári BEZPROSTREDNE pred selektorom. Značky nie sú kozmetika:
 *     hlavička `globals.css` sa na ne odvoláva ako na kritérium K2.
 *
 *  C. **Grepovať celý súbor.** Docblocky tejto vrstvy o zakázaných veciach
 *     PÍŠU — `frame.module.css` má v hlavičke vetu „žiadne `rgba()`,
 *     žiadny `!important`" a naivný grep by ju označil za porušenie. Test
 *     preto komentáre najprv vymaže, a to **náhradou za medzery rovnakej
 *     dĺžky**, aby riadky v hlásení stále ukazovali na pravé miesto.
 *
 * ČO TENTO TEST NEROBÍ: nemeria kontrast ani farebné odstupy — to je
 * `paleta.spec.ts` (K7) a je to iná otázka. Tento súbor sa nepýta „je paleta
 * dobrá", pýta sa „je paleta na JEDNOM mieste".
 *
 * NEDOTKNUTEĽNÉ (kontrakt V6 §4) sa tu nemeria, ale platí nad ním: pravidlo
 * „stav nesie farba + značka + slovo" nie je vlastnosť CSS, takže ho strážia
 * `signaly-tri-kanaly.spec.ts` a `stavy-slovnik.spec.ts`. Kto sem pridá
 * tvrdenie o farbe stavu, nech ho pridá tam, nie tu.
 *
 * Vlastník: V6a agent 3 (kontrakt KONTRAKT-V6-DIZAJN-2026-09-02.md §8).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const GLOBALS = 'src/app/globals.css';

/* ───────────────────────────────────────────────────────────────────────────
   Čítanie súborov
   ─────────────────────────────────────────────────────────────────────────── */

/** Všetky `*.module.css` pod `src/` — hľadané na disku, nie vypísané ručne. */
function moduleStylesheets(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...moduleStylesheets(path));
    else if (entry.name.endsWith('.module.css')) out.push(path);
  }
  return out.sort();
}

interface Sheet {
  /** Cesta relatívne ku koreňu repa — hlásenia musia byť klikateľné. */
  readonly path: string;
  /** Pôvodný text (len na počítanie riadkov a čítanie hlavičky). */
  readonly source: string;
  /**
   * Text s komentármi prepísanými na medzery. Dĺžka aj počet `\n` sú
   * ZACHOVANÉ, takže offset v `code` je ten istý offset ako v `source`
   * a `lineOf()` ukazuje na skutočný riadok.
   */
  readonly code: string;
  /** Rozsahy komentárov — treba ich na hľadanie značiek `@tokens:*`. */
  readonly comments: readonly { start: number; end: number; text: string }[];
}

function loadSheet(relPath: string): Sheet {
  const source = readFileSync(resolve(ROOT, relPath), 'utf8');
  const comments: { start: number; end: number; text: string }[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (match, offset: number) => {
    comments.push({ start: offset, end: offset + match.length, text: match });
    // Newline sa MUSÍ zachovať, inak sa čísla riadkov v hláseniach rozídu.
    return match.replace(/[^\n]/g, ' ');
  });
  return { path: relPath.replace(/\\/g, '/'), source, code, comments };
}

const MODULES = moduleStylesheets(resolve(ROOT, 'src')).map((p) =>
  relative(ROOT, p).replace(/\\/g, '/'),
);
const SHEETS: readonly Sheet[] = [GLOBALS, ...MODULES].map(loadSheet);
const GLOBALS_SHEET = SHEETS[0]!;

function lineOf(sheet: Sheet, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < sheet.code.length; i++) {
    if (sheet.code[i] === '\n') line++;
  }
  return line;
}

/** `src/app/globals.css:272` — presné miesto, nie „niekde v CSS". */
function at(sheet: Sheet, offset: number): string {
  return `${sheet.path}:${lineOf(sheet, offset)}`;
}

/* ───────────────────────────────────────────────────────────────────────────
   Rozklad na pravidlá a tokenové bloky
   ─────────────────────────────────────────────────────────────────────────── */

interface Rule {
  readonly selector: string;
  /** Offset prvého znaku selektora (po whitespace) — kotva pre komentár nad ním. */
  readonly selectorStart: number;
  readonly bodyStart: number;
  readonly bodyEnd: number;
  readonly depth: number;
}

/**
 * Každé pravidlo v súbore vrátane vnorených (`@media { .x { … } }`).
 *
 * Zámerne to nie je regex „blok bez zátvoriek" ako v predlohe: ten vidí len
 * najvnútornejšie pravidlá, takže hex napísaný do hlavičky `@supports` alebo
 * do `@keyframes` mu prekĺzne. Párovanie zátvoriek vidí všetko.
 */
function rules(sheet: Sheet): readonly Rule[] {
  const out: Rule[] = [];
  const stack: { selector: string; selectorStart: number; bodyStart: number }[] = [];
  const code = sheet.code;
  let segment = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '{') {
      const raw = code.slice(segment, i);
      const lead = raw.length - raw.trimStart().length;
      stack.push({
        selector: raw.trim(),
        selectorStart: segment + lead,
        bodyStart: i + 1,
      });
      segment = i + 1;
    } else if (ch === '}') {
      const open = stack.pop();
      if (open !== undefined) {
        out.push({ ...open, bodyEnd: i, depth: stack.length });
      }
      segment = i + 1;
    }
  }
  if (stack.length > 0) {
    throw new Error(`${sheet.path}: neuzavretá zátvorka v pravidle „${stack[0]!.selector}"`);
  }
  return out;
}

type TokenKind = 'invariant' | 'dark' | 'light' | 'derived';
const TOKEN_KINDS: readonly TokenKind[] = ['invariant', 'dark', 'light', 'derived'];

interface TokenBlock extends Rule {
  readonly kind: TokenKind;
}

/**
 * Tokenové bloky: pravidlo so `:root` v selektore, nad ktorým stojí komentár
 * so značkou `@tokens:<kind>` a medzi komentárom a selektorom je len
 * whitespace.
 *
 * Požiadavka „bezprostredne" je nosná. Hlavička `globals.css` značky
 * `@tokens:dark` a `@tokens:light` cituje, keď vysvetľuje kritérium K2 — keby
 * sa hľadala „najbližšia značka vyššie", zdedila by ju aj aliasová vrstva
 * o štyristo riadkov nižšie a rozdiel medzi tokenom a aliasom by prestal
 * existovať.
 */
function tokenBlocks(sheet: Sheet): readonly TokenBlock[] {
  const out: TokenBlock[] = [];
  for (const rule of rules(sheet)) {
    if (!rule.selector.includes(':root')) continue;
    const before = sheet.comments
      .filter((c) => c.end <= rule.selectorStart)
      .sort((a, b) => b.end - a.end)[0];
    if (before === undefined) continue;
    if (sheet.code.slice(before.end, rule.selectorStart).trim() !== '') continue;
    const mark = /@tokens:(invariant|dark|light|derived)\b/.exec(before.text);
    if (mark === null) continue;
    out.push({ ...rule, kind: mark[1] as TokenKind });
  }
  return out;
}

const TOKEN_BLOCKS = tokenBlocks(GLOBALS_SHEET);

/** Je offset vnútri tela nejakého tokenového bloku? */
function insideTokenBlock(sheet: Sheet, offset: number): TokenBlock | null {
  if (sheet !== GLOBALS_SHEET) return null; // moduly tokenové bloky nemajú (D143)
  for (const block of TOKEN_BLOCKS) {
    if (offset >= block.bodyStart && offset < block.bodyEnd) return block;
  }
  return null;
}

/**
 * Názov vlastnosti, do ktorej daný offset patrí.
 *
 * Deklarácia začína za posledným `;`, `{` alebo `}` pred offsetom. Bez toho by
 * sa nedalo povedať, či `rgba()` stojí v `--shadow` (povolené) alebo
 * v `background` (zakázané) — a práve to je celé pravidlo D147.
 */
function propertyAt(sheet: Sheet, offset: number): string | null {
  let start = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const ch = sheet.code[i];
    if (ch === ';' || ch === '{' || ch === '}') {
      start = i + 1;
      break;
    }
  }
  const decl = sheet.code.slice(start, offset);
  const m = /(--[a-zA-Z0-9-]+|[a-zA-Z-]+)\s*:/.exec(decl);
  return m === null ? null : m[1]!;
}

/** Všetky výskyty regexu vo všetkých hárkoch, s miestom. */
function scan(re: RegExp): readonly { sheet: Sheet; offset: number; text: string }[] {
  const out: { sheet: Sheet; offset: number; text: string }[] = [];
  for (const sheet of SHEETS) {
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of sheet.code.matchAll(rx)) {
      out.push({ sheet, offset: m.index!, text: m[0] });
    }
  }
  return out;
}

/* ───────────────────────────────────────────────────────────────────────────
   0. Poistky proti tichému úspechu
   ─────────────────────────────────────────────────────────────────────────── */

/*
 * Bez tejto sekcie by pokazený parser urobil zo VŠETKÝCH tvrdení nižšie
 * dekoráciu: keby `rules()` nenašla ani jedno pravidlo, každý zoznam
 * porušení by bol prázdny a súbor by svietil zeleno nad ľubovoľným CSS.
 * V tomto repe už raz „zelený balík" znamenal, že sa meral nesprávny
 * priečinok — poistka je preto povinná časť testu, nie ozdoba.
 */
describe('poistky: parser naozaj číta CSS', () => {
  it('nájde globals.css aj všetky moduly', () => {
    expect(GLOBALS_SHEET.path).toBe(GLOBALS);
    expect(MODULES.length, 'moduly sa nenašli — D144 by nebolo vynútené').toBeGreaterThanOrEqual(8);
    expect(MODULES).toContain('src/components/ui/primitives.module.css');
  });

  it('pod src/ nie je ŽIADNY iný stylesheet než globals.css a moduly', () => {
    /*
     * Tretia cesta von: nový `src/styles/extra.css`, importovaný v layoute.
     * Shippoval by sa, hex by v ňom prešiel, a zoznam vyššie o ňom nevie —
     * lebo hľadá `globals.css` a `*.module.css`, nič medzi tým. Táto poistka
     * hovorí, že medzi tým nič nie je: keď vznikne, test padne TU a človek
     * ho pridá do `SHEETS`, namiesto aby ho strážca mlčky vynechal.
     */
    const all: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.css')) all.push(relative(ROOT, path).replace(/\\/g, '/'));
      }
    };
    walk(resolve(ROOT, 'src'));
    const uncovered = all.filter((p) => p !== GLOBALS && !p.endsWith('.module.css'));
    expect(uncovered, 'stylesheet, ktorý sa shippuje, ale strážca ho nečíta').toEqual([]);
    expect(all.sort()).toEqual([...SHEETS].map((s) => s.path).sort());
  });

  it('rozloží globals.css na stovky pravidiel', () => {
    expect(rules(GLOBALS_SHEET).length).toBeGreaterThan(200);
  });

  it('nájde tokenové bloky všetkých štyroch druhov', () => {
    const kinds = new Set(TOKEN_BLOCKS.map((b) => b.kind));
    expect([...kinds].sort()).toEqual([...TOKEN_KINDS].sort());
    expect(TOKEN_BLOCKS.length).toBeGreaterThanOrEqual(6);
  });

  it('NEsčíta aliasovú vrstvu medzi tokenové bloky', () => {
    // `:root { --ovl-bg: var(--paper); … }` je alias, nie token. Keby sa doň
    // dal schovať hex, celé pravidlo 1 by sa dalo obísť presunom o 400 riadkov.
    const aliasBlocks = rules(GLOBALS_SHEET).filter(
      (r) => r.selector.includes(':root') && GLOBALS_SHEET.code.slice(r.bodyStart, r.bodyEnd).includes('--ovl-bg:'),
    );
    expect(aliasBlocks, 'aliasový blok --ovl-bg sa nenašiel').toHaveLength(1);
    expect(insideTokenBlock(GLOBALS_SHEET, aliasBlocks[0]!.bodyStart + 5)).toBeNull();
  });

  it('komentáre sú vymazané, ale riadky zachované', () => {
    /*
     * Docblocky o zakázaných veciach PÍŠU, a nie hypoteticky: hlavička
     * `frame.module.css` obsahuje vetu „Žiadny surový hex, žiadne `rgba()`,
     * žiadny `!important`". Naivný grep by z troch dodržaných pravidiel
     * urobil tri porušenia — a keby to niekto „opravil" zmazaním vety,
     * pravidlo by stratilo svoj jediný zápis v kóde.
     */
    const frame = SHEETS.find((s) => s.path.endsWith('ui/frame.module.css'));
    expect(frame, 'frame.module.css sa nenašiel').toBeDefined();
    expect(frame!.source).toContain('žiadne `rgba()`');
    expect(frame!.code).not.toContain('žiadne `rgba()`');
    for (const sheet of SHEETS) {
      expect(sheet.code.split('\n')).toHaveLength(sheet.source.split('\n').length);
    }
  });

  it('vidí surové farby, ktoré v tokenovej vrstve legitímne sú', () => {
    // Keby regex na hex nehľadal nič, pravidlo 1 by bolo prázdne tvrdenie.
    expect(scan(HEX).length).toBeGreaterThan(50);
    expect(scan(RGBA).length).toBeGreaterThan(15);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   1. Surová farba žije VÝHRADNE v tokenovej vrstve (D130, K1)
   ─────────────────────────────────────────────────────────────────────────── */

/* Platné hex farby sú 3, 4, 6 alebo 8 miest. `{3,8}` by prijalo aj 5 a 7,
   čo nie je farba — a hlavne by z ID selektora `#abcde` urobilo „porušenie". */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;

/* Zachytí aj `rgb(0 0 0 / .35)` — tá istá vec inak napísaná. Pred V6a bolo
   tvrdenie „appka má 0 rgba()" pravopis, nie fakt: modernej formy tu bolo 19. */
const RGBA = /\brgba?\s*\(/g;

/* Ostatné surové farebné funkcie. Bez nich by sa pravidlo 1 obišlo prepisom
   `#d8b878` na `hsl(38 55% 66%)` — iný zápis tej istej neriadenej farby.
   `color-mix(in oklab, …)` NIE JE zásah: za `oklab` tam stojí čiarka, nie `(`. */
const RAW_COLOR_FN = /\b(?:hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/g;

describe('pravidlo 1 — surový hex len v bloku tokenov (K1)', () => {
  it('žiadny hex mimo tokenového bloku, v ŽIADNOM hárku', () => {
    const offenders = scan(HEX)
      .filter((h) => insideTokenBlock(h.sheet, h.offset) === null)
      .map((h) => `${at(h.sheet, h.offset)} → ${h.text}`);
    expect(
      offenders,
      'surová farba mimo tokenovej vrstby: „zmeň odtieň chyby" sa opäť stáva grepom (D130)',
    ).toEqual([]);
  });

  it('žiadna iná surová farebná funkcia mimo bloku tokenov', () => {
    const offenders = scan(RAW_COLOR_FN)
      .filter((h) => insideTokenBlock(h.sheet, h.offset) === null)
      .map((h) => `${at(h.sheet, h.offset)} → ${h.text}`);
    expect(offenders, 'hex sa dá obísť prepisom na hsl()/oklch() — to je tá istá diera').toEqual([]);
  });

  it('tónuje sa naozaj cez color-mix (pravidlo je živé, nie splnené vyhýbaním)', () => {
    const mixes = SHEETS.flatMap((s) => [...s.code.matchAll(/color-mix\(\s*in\s+(?:srgb|oklab)\s*,\s*var\(--/g)]);
    expect(mixes.length, 'žiadne color-mix() — pravidlo D147 nie je splnené, len nepoužité').toBeGreaterThan(20);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   2. rgba() len v enumerovaných tokenoch (D147)
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Osem tokenov, ktoré `rgba()` niesť smú. Zoznam je KÓPIA zoznamu z hlavičky
 * `globals.css` a to je zámer: deviaty priesvitný token si vyžaduje zmenu na
 * dvoch miestach, takže sa nedá pridať potichu. Tvrdenie „zoznam a hlavička
 * sedia" je nižšie, aby kópie nemohli tichlo utiecť od seba.
 *
 * Prečo práve tieto: závoj a tieň sú jediné miesta, kde priehľadnosť nie je
 * tón farby, ale samostatná vrstva nad NEZNÁMYM podkladom. `color-mix(…,
 * transparent)` mieša proti konkrétnemu tokenu; tieň nevie, čo bude pod ním.
 */
const RGBA_TOKENS: readonly string[] = [
  '--overlay',
  '--shadow',
  '--shadow-selbar',
  '--shadow-drawer',
  '--ovl-shadow',
  '--ovl-shadow-raised',
  '--kiss-shadow-sm',
  '--kiss-shadow-md',
];

describe('pravidlo 2 — rgba() výhradne v závojoch a tieňoch (D147)', () => {
  it('žiadna rgba() mimo tokenového bloku', () => {
    const offenders = scan(RGBA)
      .filter((h) => insideTokenBlock(h.sheet, h.offset) === null)
      .map((h) => `${at(h.sheet, h.offset)} → ${propertyAt(h.sheet, h.offset) ?? '?'}`);
    expect(offenders, 'rgba() mimo tokenovej vrstvy — tónuje sa color-mix() (D147)').toEqual([]);
  });

  it('v bloku tokenov nesie rgba() len enumerovaný token', () => {
    const offenders = scan(RGBA)
      .filter((h) => insideTokenBlock(h.sheet, h.offset) !== null)
      .map((h) => ({ where: at(h.sheet, h.offset), prop: propertyAt(h.sheet, h.offset) }))
      .filter((h) => h.prop === null || !RGBA_TOKENS.includes(h.prop))
      .map((h) => `${h.where} → ${h.prop ?? '?'}`);
    expect(
      offenders,
      `rgba() smie niesť len: ${RGBA_TOKENS.join(', ')} — inak color-mix()`,
    ).toEqual([]);
  });

  it('zoznam v teste a zoznam v hlavičke globals.css sa nerozišli', () => {
    /*
     * Hlavička sekcie „rgba() (D147)" vypisuje tie isté názvy. Keby sa kópie
     * rozišli, jedna z nich by lhala a nikto by to nevedel.
     *
     * Rez je po PRVÉ PRAVIDLO, nie po prvý výskyt `:root`: hlavička sa na
     * `:root` odvoláva už na riadku 11, keď opisuje poradie blokov, takže
     * `indexOf(':root')` by odrezal presne ten odstavec, ktorý sa má čítať.
     */
    const firstRule = /^:root/m.exec(GLOBALS_SHEET.code);
    expect(firstRule, 'v globals.css nie je ani jedno pravidlo :root').not.toBeNull();
    const header = GLOBALS_SHEET.source.slice(0, firstRule!.index);
    const missing = RGBA_TOKENS.filter((t) => !header.includes(`\`${t}\``));
    expect(missing, 'token je v teste, ale hlavička globals.css o ňom nehovorí').toEqual([]);
  });

  it('žiadny enumerovaný token nie je mŕtvy (zoznam nesmie hniť)', () => {
    const defined = new Set(
      [...GLOBALS_SHEET.code.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]!),
    );
    expect(RGBA_TOKENS.filter((t) => !defined.has(t))).toEqual([]);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   3. !important (D132)
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * `!important` je zakázaná — s JEDNOU vymenovanou výnimkou.
 *
 * Výnimka je `@media (prefers-reduced-motion: reduce)`, kde reset stojí na
 * selektore `*` (špecificita 0) a KAŽDÉ pravidlo appky ho prebije. Bez
 * `!important` by sa animácie ľuďom, ktorí si pohyb vypli, vypnuli len
 * naoko — a test by o tom mlčal. Výnimka je preto úzka dvojmo: platí len
 * v tomto jednom bloku a len na tri vlastnosti pohybu. `!important` na farbe
 * či rozmere v tom istom bloku je porušenie.
 */
const MOTION_PROPS: readonly string[] = [
  'animation',
  'animation-duration',
  'animation-iteration-count',
  'transition',
  'transition-duration',
  'scroll-behavior',
];

function reducedMotionRanges(): readonly { sheet: Sheet; start: number; end: number }[] {
  const out: { sheet: Sheet; start: number; end: number }[] = [];
  for (const sheet of SHEETS) {
    for (const rule of rules(sheet)) {
      if (rule.selector.includes('prefers-reduced-motion')) {
        out.push({ sheet, start: rule.bodyStart, end: rule.bodyEnd });
      }
    }
  }
  return out;
}

describe('pravidlo 3 — !important len v reset-e pohybu', () => {
  const IMPORTANT = /!\s*important/gi;

  it('reset pohybu vôbec existuje (inak by výnimka kryla prázdno)', () => {
    expect(reducedMotionRanges().length).toBeGreaterThanOrEqual(1);
  });

  it('žiadny !important mimo @media (prefers-reduced-motion: reduce)', () => {
    const ranges = reducedMotionRanges();
    const offenders = scan(IMPORTANT)
      .filter((h) => !ranges.some((r) => r.sheet === h.sheet && h.offset >= r.start && h.offset < r.end))
      .map((h) => `${at(h.sheet, h.offset)} → ${propertyAt(h.sheet, h.offset) ?? '?'}`);
    expect(
      offenders,
      '!important znamená, že kaskáda je pokazená — oprav špecificitu, nie silu (D132)',
    ).toEqual([]);
  });

  it('aj v reset-e pohybu nesie !important len vlastnosť pohybu', () => {
    const ranges = reducedMotionRanges();
    const offenders = scan(IMPORTANT)
      .filter((h) => ranges.some((r) => r.sheet === h.sheet && h.offset >= r.start && h.offset < r.end))
      .map((h) => ({ where: at(h.sheet, h.offset), prop: propertyAt(h.sheet, h.offset) }))
      .filter((h) => h.prop === null || !MOTION_PROPS.includes(h.prop))
      .map((h) => `${h.where} → ${h.prop ?? '?'}`);
    expect(
      offenders,
      'výnimka platí na pohyb, nie na farbu či rozmer — tie sa v tomto bloku neprebíjajú',
    ).toEqual([]);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   4. Každý token má hodnotu pre obe témy (K2, D131, D145)
   ─────────────────────────────────────────────────────────────────────────── */

function namesIn(kind: TokenKind): readonly string[] {
  const names = new Set<string>();
  for (const block of TOKEN_BLOCKS.filter((b) => b.kind === kind)) {
    const body = GLOBALS_SHEET.code.slice(block.bodyStart, block.bodyEnd);
    for (const m of body.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(m[1]!);
  }
  return [...names].sort();
}

describe('pravidlo 4 — token je definovaný pre obe témy (K2)', () => {
  const dark = namesIn('dark');
  const light = namesIn('light');

  it('obe témy vôbec niečo deklarujú', () => {
    expect(dark.length, 'tmavá téma je prázdna').toBeGreaterThan(20);
    expect(light.length, 'svetlá téma je prázdna').toBeGreaterThan(20);
  });

  it('tmavá a svetlá deklarujú tú istú množinu názvov', () => {
    const onlyDark = dark.filter((n) => !light.includes(n));
    const onlyLight = light.filter((n) => !dark.includes(n));
    // Rozdiel sa hlási v OBOCH smeroch: „chýba v svetlej" je nečitateľná
    // téma, „chýba v tmavej" je nečitateľná predvolená téma. Ani jedno nie je
    // menšia chyba, takže ani jedno sa nesmie stratiť v hlásení o druhom.
    expect(
      { chybaVSvetlej: onlyDark, chybaVTmavej: onlyLight },
      'token bez hodnoty v druhej téme (K2, D131) — pri prepnutí témy zdedí cudziu hodnotu',
    ).toEqual({ chybaVSvetlej: [], chybaVTmavej: [] });
  });

  it('invariantný ani derivovaný token sa v téme NEOBJAVÍ', () => {
    // Invariant má hodnotu v oboch témach tým, že sa v druhej neprepisuje.
    // Keby ho niektorá téma prepísala, prestal by byť invariantom — a hlavička
    // súboru by o palete tvrdila nepravdu.
    const themed = new Set([...dark, ...light]);
    const leaked = [...namesIn('invariant'), ...namesIn('derived')].filter((n) => themed.has(n));
    expect(leaked, 'token deklarovaný ako invariant/derived je prepísaný v téme').toEqual([]);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   5. Mŕtvy odkaz: var(--x) na token, ktorý nikto nedefinuje
   ─────────────────────────────────────────────────────────────────────────── */

interface VarUse {
  readonly sheet: Sheet;
  readonly offset: number;
  readonly name: string;
  /** Má `var()` náhradnú hodnotu? Potom je to VSTUP, nie mŕtvy odkaz. */
  readonly hasFallback: boolean;
}

function varUses(): readonly VarUse[] {
  const out: VarUse[] = [];
  for (const sheet of SHEETS) {
    for (const m of sheet.code.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,?)/g)) {
      out.push({ sheet, offset: m.index!, name: m[1]!, hasFallback: m[2] === ',' });
    }
  }
  return out;
}

/** Každý `--x:` v ktoromkoľvek hárku — vrátane lokálnych premenných modulov. */
function definedAnywhere(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const sheet of SHEETS) {
    for (const m of sheet.code.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) out.add(m[1]!);
  }
  return out;
}

describe('pravidlo 5 — žiadny var() na nedefinovaný token', () => {
  it('var() sa vôbec používa', () => {
    expect(varUses().length).toBeGreaterThan(100);
  });

  it('každý var() bez náhrady ukazuje na definovaný token', () => {
    const defined = definedAnywhere();
    const offenders = varUses()
      .filter((u) => !u.hasFallback && !defined.has(u.name))
      .map((u) => `${at(u.sheet, u.offset)} → var(${u.name})`);
    // `var(--x)` na nič nerozsvieti nič a nikde nezakričí: vlastnosť ostane
    // neplatná a prvok sa nakreslí bez farby. Presne takto sa v tomto repe
    // stratil rozcestník Nastavení — odkaz do prázdna, zelené testy.
    expect(offenders, 'var() ukazuje do prázdna — vlastnosť sa mlčky zahodí').toEqual([]);
  });

  it('var() s náhradou je VSTUP obrazovky a nesmie sa vydávať za token', () => {
    // `--ovl-toolbar-top` je takýto vstup: `tables.module.css` ho čaká od
    // obrazovky a bez neho použije `--hdr-h`. Test to musí vedieť rozlíšiť,
    // inak by dokumentovaný vstup hlásil ako mŕtvy odkaz. Aby tá výnimka
    // nekryla nedbalosť, vyžaduje sa, aby náhrada bola SAMA definovaný token
    // alebo hodnota — nie ďalší var() do prázdna.
    const defined = definedAnywhere();
    const bad: string[] = [];
    for (const u of varUses().filter((v) => v.hasFallback && !defined.has(v.name))) {
      const tail = u.sheet.code.slice(u.offset, u.offset + 200);
      const nested = /var\(\s*(--[a-zA-Z0-9-]+)/g;
      nested.exec(tail); // preskoč seba
      const inner = nested.exec(tail);
      if (inner !== null && !defined.has(inner[1]!)) {
        bad.push(`${at(u.sheet, u.offset)} → var(${u.name}, var(${inner[1]}))`);
      }
    }
    expect(bad, 'náhradná hodnota ukazuje tiež do prázdna — vstup nemá ako fungovať').toEqual([]);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   6. Mŕtvy token: definovaný, nepoužívaný
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Token sa smie čítať aj z TypeScriptu — `chart-language.ts` mená `--chart-1`
 * … `--seq-teal-5` vypisuje a podáva ich Rechartsu. Keby test hľadal len
 * `var()` v CSS, ohlásil by celú paletu grafov ako mŕtvu a jeho zoznam
 * výnimiek by narástol o trinásť riadkov, ktoré mŕtve nie sú.
 */
function referencedNames(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const u of varUses()) out.add(u.name);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) {
        for (const m of readFileSync(path, 'utf8').matchAll(/--[a-zA-Z0-9-]+/g)) out.add(m[0]);
      }
    }
  };
  walk(resolve(ROOT, 'src'));
  return out;
}

/**
 * MŔTVY DLH, KTORÝ TU DNES JE — a prečo je zoznam, nie pád.
 *
 * Pätnásť `--ovl-*` aliasov je zvyšok po prevode hexov (§ pod T5
 * v `globals.css`): ich komentár do V6a tvrdil „volajúci ich používajú" a to
 * bola nepravda. Nemažú ich tokeny, ale mazanie mŕtveho CSS má vlastného
 * vlastníka (D139, K11 — agent 28 vo V6b, verifikácia 35 vo V6c), takže
 * strážca ich POMENUJE a nedovolí, aby ich bolo viac.
 *
 * `--on-gold` a `--kiss-focus-ring` sú iný prípad: nie sú zvyšok, sú
 * PRIPRAVENÉ. Prvý je ink na zlatej ploche a hlavička súboru ho cituje ako
 * časť pravidla „plocha vs. text"; druhý je prsteň fokusu KISS vrstvy, ktorá
 * sa dokresľuje vo V6b.
 *
 * Zoznam je uzavretý v OBOCH smeroch. Nový mŕtvy token = pád (inak by dlh
 * rástol pod zeleným testom). Položka, ktorá už mŕtva nie je = tiež pád,
 * lebo zoznam s neplatnou výnimkou je klamstvo, ktoré nikto neprečíta.
 */
const KNOWN_DEAD: readonly string[] = [
  '--kiss-focus-ring',
  '--on-gold',
  '--ovl-accent',
  '--ovl-bg',
  '--ovl-border',
  '--ovl-border-strong',
  '--ovl-danger',
  '--ovl-danger-bg',
  '--ovl-fg',
  '--ovl-muted',
  '--ovl-neutral-bg',
  '--ovl-ok',
  '--ovl-ok-bg',
  '--ovl-surface',
  '--ovl-surface-2',
  '--ovl-warning',
  '--ovl-warning-bg',
];

describe('pravidlo 6 — mŕtvy token sa pomenuje a nesmie sa množiť', () => {
  const referenced = referencedNames();
  const dead = [...definedAnywhere()].filter((n) => !referenced.has(n)).sort();

  it('žiadny NOVÝ mŕtvy token nad vymenovaný dlh', () => {
    const fresh = dead.filter((n) => !KNOWN_DEAD.includes(n));
    if (fresh.length > 0) {
      console.warn(`[strážca] mŕtve tokeny nad rámec dlhu: ${fresh.join(', ')}`);
    }
    expect(
      fresh,
      'token, ktorý nikto nepoužíva — buď ho použi, alebo zmaž (D139, K11)',
    ).toEqual([]);
  });

  it('vymenovaný dlh sa nedá nechať hniť', () => {
    const revived = KNOWN_DEAD.filter((n) => !dead.includes(n));
    expect(
      revived,
      'tieto tokeny už mŕtve nie sú — vyhoď ich zo zoznamu KNOWN_DEAD, inak zoznam klame',
    ).toEqual([]);
  });

  it('dlh sa vôbec zmenšuje, nie rastie (dnešný stav je zaznamenaný)', () => {
    // Číslo je tu preto, aby bol dlh VIDITEĽNÝ v hlásení, nie schovaný
    // v zozname: `expect(17)` sa pri mazaní musí ručne znížiť a to je jediný
    // moment, kedy si niekto všimne, že sa dlh hýbe.
    expect(KNOWN_DEAD).toHaveLength(17);
  });
});
