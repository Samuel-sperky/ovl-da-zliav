/**
 * Aura Zľavy — KONTRAST SA POČÍTA, NEPOSUDZUJE (V6a, kritérium K7, riziko R3).
 *
 * Kontrakt V6 hovorí o svetlej téme jednu vetu, ktorá je celý dôvod tohto
 * súboru: *„svetlá téma nemá dnes ani jeden test — kým sa nepridá, môže byť
 * hotová a nečitateľná"*. Toto je ten test. Nie je to druhá kópia
 * `paleta.spec.ts`: ten meria ZOZNAM štrnástich párov, ktorý niekto napísal
 * ručne, a všetky proti `--paper` a `--paper2`. Tento súbor si páry
 * NEVYMÝŠĽA — vyparsuje ich z CSS, ktoré appka naozaj nasadzuje, a meria
 * KAŽDÝ z nich v OBOCH témach.
 *
 * Rozdiel nie je akademický. Ručný zoznam prehliadol presne to, čo sa okom
 * nevidí:
 *   · `--st-idle` mal na `--surface-raised` 3,95 : 1 a na `--paper3` 4,15 : 1,
 *     kým na `--paper2` (jediná plocha, ktorú niekto meral) mal 4,52 : 1.
 *     „Pripravená" a „beží" boli na bočnom raile a v zdvihnutých paneloch
 *     nečitateľné celý čas, čo tá appka existuje.
 *   · v svetlej téme mal značkový teal na svojej VLASTNEJ tinte 4,48 : 1 —
 *     naklikaný filter chip bol pod hranicou.
 *   · zlatá ako text mala na 14 % zlatej ploche (`.pageHeaderMark`) 4,33 : 1.
 * Žiadny z tých párov v ručnom zozname nebol, takže o nich nikto nevedel.
 *
 * ── ČO SA MERIA (a odkiaľ sa páry berú) ──────────────────────────────────
 * Vstup je `src/app/globals.css` PLUS každý `*.module.css` nájdený chôdzou
 * po `src/` — nie zoznam súborov. Zoznam by starnul: D143 posiela vzhľad
 * primitív práve do modulov, takže test, ktorý pozná len dnešné moduly, by
 * zajtrajší nestrážil (D144 hovorí to isté o strážnom teste).
 *
 * Pár = pravidlo, ktoré nastavuje `color`, a plocha pod ním:
 *   · vlastné `background` v tom istom pravidle → jedna plocha, jedno meranie;
 *   · priesvitné `background` (`color-mix(… , transparent)`) → poskladá sa
 *     nad každou ZEMOU (sekcia 5) a meria sa najhorší prípad;
 *   · žiadne / `transparent` / `none` → text stojí na ploche stránky, takže
 *     sa meria proti VŠETKÝM plochám;
 *   · zdedená plocha (text v tmavej lište výberu, znak v zaškrtnutom
 *     políčku) → `ZDEDENA_PLOCHA` nižšie, jedna položka na pravidlo.
 * A od 3. 9. 2026 (V7) aj obrátene — plocha bez vlastnej farby textu:
 *   · text jej píše základný stav alebo predok (`.ovl-btn--primary:hover`
 *     ← `.ovl-btn--primary`) → `poskytovatelFarby()`, jeden pár;
 *   · text jej píše pravidlo POTOMKA (`.ovl-sbar-why-panel b`) →
 *     `paryPotomkov()`, jeden pár na potomka;
 *   · nikto → je to PLOCHA STRÁNKY a meria sa na nej každý text bez
 *     vlastnej plochy.
 * Obe smery sú ODVODENÉ z CSS. Zoznam plôch, ktorý tu stál do V7, mal 10
 * položiek a sedem plôch s textom mu chýbalo (§5). Dnes sa v každej téme
 * meria **7319 párov** nad **26 plochami** (do V7 to bolo 2656 nad desiatimi).
 *
 * ── HRANICE ──────────────────────────────────────────────────────────────
 * **7 : 1 pre VŠETOK text** (D164, V7, 3. 9. 2026) — nie 4,5 : 1. Samuel
 * preklikol V6 a označil nízky kontrast ako jednu zo štyroch príčin toho, že
 * appka „nie je čitateľná"; 7 : 1 je hranica WCAG 1.4.6 (AAA) pre malé písmo
 * a v tejto appke je malé skoro všetko (11,5–13 px). Hranica sa NEUPRAVUJE
 * preto, aby nejaký pár vyšiel: pár, ktorý ju neunesie, sa vymenuje s číslom
 * (riziko R2 kontraktu V7). Dnes ju unesie každý — najhorší textový pár je
 * 7,12 : 1 v tmavej (biele písmo na `--st-critical-fill`) a 7,19 : 1
 * v svetlej (pruh PRODUKCIA).
 * 3 : 1 pre IKONY (1.4.11, netextová grafika) — a to len pre pravidlá
 * vymenované v `IKONY`, kde je dokázané, že kreslia `<Icon>` a nie slovo.
 * Dekoratívne oddeľovače majú hranicu viditeľnosti, nie čitateľnosti; sú
 * vymenované v `DEKORACIE` a je pri nich napísané prečo.
 *
 * JEDNA FARBA 7 : 1 NEUNIESLA a je to napísané pri nej, nie zamlčané:
 * **značkový teal svetlej témy** (`--deep`, na ktorý ukazujú `--accent`
 * aj `--brand`) — v OBOCH rolách, ako text aj ako plocha pod textom.
 * Zmerané 3. 9. 2026: **4,60 : 1** ako text na papieri pod závojom
 * a **5,71 : 1** pre biele písmo na tejto ploche. Obe sú nad WCAG 1.4.3
 * (AA), ani jedna nedosiahne 7 : 1 (AAA). Dotknutých párov je **218** a
 * všetky sú v svetlej téme — v tmavej je uvoľnených NULA. (Do 3. 9. 2026 ich
 * bolo 89; číslo stúplo tým, že sa plochy prestali vymenúvať a začali
 * odvodzovať, nie tým, že by sa výnimka rozšírila — najhorší pár je stále
 * 4,60 : 1.)
 *
 * Nie je to nedbalosť ani voľba plochy — je to KOLÍZIA DVOCH PRAVIDIEL.
 * Na 7 : 1 sa teal dostane až pri ~#005156, a tam padne pod ΔE 8 od
 * „nečinný" (protanopia 4,0), „v poriadku" (tritanopia 4,1) a „prebieha"
 * (tritanopia 7,1) — teda pod hranicu, ktorú drží `paleta.spec.ts`. Vyhráva
 * ZNAČENIE: farba, ktorú časť ľudí nerozlíši od stavu, je horšia než farba,
 * ktorá sa horšie číta. Kritérium sa NEZNÍŽILO (`HRANICA_TEXT` je stále 7);
 * pár je vymenovaný, zmeraný a nesie dva DÔKAZY (§10a, §10b), ktoré si test
 * prepočíta sám. Keď sa stavová škála pohne, dôkaz sčervená a výnimka sa
 * musí prehodnotiť — nie predĺžiť.
 *
 * ČO BY JU ZRUŠILO (a prečo to nie je práca tohto testu): keby plné
 * značkové plochy (`.cb:checked`, `.chip.on`, `.btn.primary`, `.steps .s.on`)
 * prešli z `--accent` na `--brand-fill` (#025c60, biela na ňom má 7,76 : 1),
 * zmizla by celá druhá polovica výnimky. Je to zmena vzhľadu tmavej témy
 * (svietivý teal → tmavý), teda rozhodnutie o dizajne, nie o kontraste.
 *
 * ČO 7 : 1 STÁLO (a čo sa preto NESMIE „zjednotiť" späť):
 *   · `--dim` sa posunula #8b919b → #b0b4bc (tmavá) a #63696f → #454a4f
 *     (svetlá), `--ink2` s ňou, aby rebrík ink → ink2 → dim nesplynul;
 *   · plochy dostali vlastné tokeny pre TEXT tam, kde plocha zostať musela:
 *     `--brand-fill` (biela na ňom mala 5,20 : 1), `--st-critical-fill`
 *     (5,00 : 1 a bielejší text neexistuje), `--accent` = `--teal3` v tmavej;
 *   · `--st-*-ink` mieša 52 % tónu (bolo 80 / 70 %), plné tóny sa NEHÝBALI —
 *     ich ΔE ≥ 8 pod farbosleposťou drží `paleta.spec.ts`;
 *   · stavové tinty zoslabli zo 14 % na 10 % (nečinná z 12 % na 9 %)
 *     a značková tinta prestala byť priesvitná — po odvodení plôch sa
 *     ukázalo, že `--dim` má na 14 % tinte 6,76 : 1, teda pod hranicou;
 *   · `--st-critical-press` a `.btn.primary:hover` miešajú k `--ink`, nie
 *     k `--mix-shade`: stlačené červené tlačidlo malo v TMAVEJ téme 4,31 : 1
 *     (tmavý nápis na stmavenej výplni) a `<code>` v pruhu PRODUKCIA 5,33 : 1;
 *   · neaktívny prvok má vlastný `--ink-disabled`. Kým bola `--dim` 4,7 : 1,
 *     bola zošednutím sama; pri 7 : 1 by vypnutý čip vyzeral zapnutý.
 *
 * ── ČO TENTO TEST NEVIE (a kto to stráži namiesto neho) ──────────────────
 *  1. **Vnorenie, ktoré CSS nepovie.** Ak niekto vloží text do priesvitnej
 *     plochy vnútri inej priesvitnej plochy, statický parser to nevidí.
 *     Merania nad všetkými plochami stránky sú horná hranica tohto rizika;
 *     zvyšok stráži preklik (D141), nie tento súbor.
 *
 *     KONKRÉTNY ŽIVÝ PRÍPAD (nájdený 3. 9. 2026 pri V6c, ZATVORENÝ pri D164):
 *     `signals.module.css { .chipCount }` nastavuje `color: var(--dim)` a
 *     pozadie NEMÁ, kým tint pod kurzorom nesie susedné pravidlo
 *     `{ .chip:hover }`. Test tie dve pravidlá neskladá, takže meria `--dim`
 *     na čistých plochách (prejde), nie na tinte nad nimi. Po posune na
 *     7 : 1 to bolo na tinte nad `--surface-raised` **5,99 : 1**, teda pod
 *     hranicou, a tento test by o tom mlčal. Zatvorené je to PRAVIDLOM, nie
 *     vetou: `.chip:hover:not(:disabled) .chipCount` posúva počet o stupeň
 *     na `--ink2` (8,2 : 1 na tej istej ploche).
 *     Diera ako trieda sa 3. 9. 2026 (V7) ZÚŽILA, nie zavrela: `paryPotomkov()`
 *     už vnorenie zložiť VIE, ale len keď ho CSS napíše selektorom
 *     (`.chip:hover:not(:disabled) .chipCount` áno, `<span>` bez pravidla nie).
 *     Zvyšok je konzervatívne meranie nad všetkými plochami stránky, a to je
 *     horná hranica rizika, nie jeho odstránenie. Zvyšok stráži preklik.
 *  1b. **Plocha, ktorú kreslí pravidlo s VLASTNOU farbou.** Test ju berie ako
 *     ovládací prvok — jeho nápis je jediný text na nej — a meria ju cez
 *     vlastnú farbu plus cez pravidlá potomkov, ktoré CSS menuje. Keď je taká
 *     plocha v skutočnosti KONTEJNER a text do nej príde bez vlastného
 *     pravidla, test o tom mlčí. Preto sú `--accent`, `--brand-fill`
 *     a `--st-critical-fill` merané len bielym/tmavým nápisom, nie celou
 *     paletou textu. Kto na výplň tlačidla položí tlmený text, dozvie sa to
 *     z preklikov (D141) — ale zároveň porušil pravidlo, že výplň nesie
 *     `--*-on` farbu, a to stráži `dizajn-tokeny-strazca.spec.ts`.
 *  2. **Geometria závoja `body::before`.** Test počíta s jeho DEKLAROVANOU
 *     silou (`--veil-brand`, `--veil-gold`), teda s najhorším bodom gradientu.
 *     Na obrazovke je slabší (stredy oboch gradientov ležia mimo výrezu),
 *     takže je to konzervatívny odhad, nie presná hodnota. Dôležité je, že
 *     silu závoja nesie TOKEN: kto ho zosilní, dostane červený test.
 *     Do 2. 9. 2026 bolo percento napísané priamo v gradiente a v meraní
 *     neexistovalo.
 *  3. **`color: inherit` a `currentColor`.** Merajú sa tam, kde farba vzniká,
 *     nie tam, kde sa dedí. Pravidlo s `inherit` sa preskočí zámerne.
 *  4. **Uvoľnená hranica pre veľké písmo.** Nepoužíva sa (WCAG 1.4.6 ju dáva
 *     na 4,5 : 1). Je to úmyselne prísnejšie: `--ovl-fs-h1` je 1,5 rem =
 *     24 px, čo je „large scale" až pri hmotnom reze, a rozlišovať to podľa
 *     `font-weight` by z testu spravilo hádanie.
 *
 * Vlastník: V6a, agent kontrastu (K7); hranicu 7 : 1 priniesla V7 (D164, K1).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contrastRgb, deltaE, hexToRgb, tightestPairs, type Rgb } from '../helpers/palette-math';

/* ═══════════════════════════════════════════════════════════════════════════
   1. VSTUP — globals.css a každý *.module.css, ktorý v `src/` existuje
   ═════════════════════════════════════════════════════════════════════════ */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function najdiModuly(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) najdiModuly(p, out);
    else if (e.name.endsWith('.module.css')) out.push(p);
  }
  return out;
}

const GLOBALS = join(SRC, 'app', 'globals.css');
const SUBORY = [GLOBALS, ...najdiModuly(SRC).sort()];

/** CSS bez komentárov. `globals.css` v nich cituje selektory aj hexy. */
const bezKomentarov = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/* ═══════════════════════════════════════════════════════════════════════════
   2. PARSER PRAVIDIEL

   Vlastný, lebo potrebuje dve veci, ktoré regex nad celým súborom nedá:
   deklarácie na správnej úrovni zanorenia (`@media` má vnútri pravidlá)
   a selektor bez prefixu at-pravidla. Je to ~40 riadkov a žiadna závislosť.
   ═════════════════════════════════════════════════════════════════════════ */

interface Pravidlo {
  subor: string;
  selektor: string;
  /** Reťaz predkov vrátane at-pravidiel — rozhoduje, či pravidlo preskočiť. */
  obal: readonly string[];
  dekl: Map<string, string>;
}

function parsuj(subor: string, css: string): Pravidlo[] {
  const out: Pravidlo[] = [];
  const stack: string[] = [];
  let prelude = '';
  let buf = '';

  const zapisDeklaraciu = (telo: string) => {
    if (stack.length === 0) return;
    const dekl = new Map<string, string>();
    for (const kus of telo.split(';')) {
      const i = kus.indexOf(':');
      if (i < 0) continue;
      const k = kus.slice(0, i).trim();
      const v = kus.slice(i + 1).trim();
      if (k !== '' && v !== '') dekl.set(k, v);
    }
    if (dekl.size === 0) return;
    out.push({
      subor,
      selektor: stack[stack.length - 1]!.replace(/\s+/g, ' ').trim(),
      obal: [...stack],
      dekl,
    });
  };

  for (const ch of css) {
    if (ch === '{') {
      stack.push(prelude.trim());
      prelude = '';
      buf = '';
    } else if (ch === '}') {
      zapisDeklaraciu(buf);
      stack.pop();
      buf = '';
      prelude = '';
    } else {
      prelude += ch;
      buf += ch;
    }
  }
  return out;
}

const PRAVIDLA: Pravidlo[] = SUBORY.flatMap((f) =>
  parsuj(f.slice(SRC.length + 1).replace(/\\/g, '/'), bezKomentarov(readFileSync(f, 'utf8'))),
);

/* ═══════════════════════════════════════════════════════════════════════════
   3. TOKENY OBOCH TÉM

   `:root` je v `globals.css` OSEMKRÁT (T1 invarianty, T2 tmavá, T4 výška
   grafu, T4 tmavé rady, T5 derivované, alias blok…), takže „nájdi blok
   s `--st-critical`" je krehké. Berie sa preto poradie v súbore: každé
   `:root` pravidlo dopĺňa základ, každé `:root[data-theme="light"]` dopĺňa
   svetlú vrstvu — presne ako kaskáda. Tmavá je základ (D145).
   ═════════════════════════════════════════════════════════════════════════ */

function temaMapa(svetla: boolean): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of PRAVIDLA) {
    if (p.subor !== 'app/globals.css') continue;
    const jeZaklad = p.selektor === ':root';
    const jeSvetla = p.selektor === ':root[data-theme="light"]';
    if (!jeZaklad && !jeSvetla) continue;
    if (jeSvetla && !svetla) continue;
    for (const [k, v] of p.dekl) if (k.startsWith('--')) m.set(k, v);
  }
  return m;
}

const TEMY = [
  { nazov: 'tmavá', tokeny: temaMapa(false) },
  { nazov: 'svetlá', tokeny: temaMapa(true) },
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
   4. VYHODNOTENIE FARBY

   `color-mix()` sa NEPRESKAKUJE. Appka ju používa 47-krát a všetky tinty
   stavov, tóny hoveru aj priesvitné plochy z nej vznikajú — test, ktorý ju
   obíde, by nemeral polovicu appky. Vyhodnocuje sa podľa CSS Color 5:
   zložky sa vážia, alfa sa premultiplikuje a `srgb` sa mieša v sRGB,
   `oklab` v Oklabe. `transparent` je `rgba(0,0,0,0)`, takže
   `color-mix(in …, X 14%, transparent)` je X s alfou 0,14 — a taká plocha
   sa MUSÍ poskladať nad niečím, inak sa meria vzduch.
   ═════════════════════════════════════════════════════════════════════════ */

/** [r, g, b, a] — r/g/b v 0–255 (nie nutne celé), a v 0–1. */
type Rgba = readonly [number, number, number, number];

const NEPRIESVITNA = (c: Rgba): Rgb => [c[0], c[1], c[2]];

const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const zLinear = (x: number) => {
  const c = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, c)) * 255;
};

/** sRGB → Oklab (Björn Ottosson). Vstup 0–255. */
function doOklab(c: Rgba): [number, number, number] {
  const R = linear(c[0]);
  const G = linear(c[1]);
  const B = linear(c[2]);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Oklab → sRGB. */
function zOklab([L, A, B]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    zLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    zLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    zLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Rozdelenie na argumenty na najvyššej úrovni zátvoriek. */
function argumenty(s: string): string[] {
  const out: string[] = [];
  let hlbka = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') hlbka++;
    if (ch === ')') hlbka--;
    if (ch === ',' && hlbka === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

class NeviemFarbu extends Error {}

function farba(hodnota: string, tokeny: Map<string, string>, hlbka = 0): Rgba {
  if (hlbka > 12) throw new NeviemFarbu(`cyklus v ${hodnota}`);
  const v = hodnota.trim();

  if (v === 'transparent') return [0, 0, 0, 0];
  if (/^#[0-9a-f]{3}$/i.test(v) || /^#[0-9a-f]{6}$/i.test(v)) {
    const [r, g, b] = hexToRgb(v);
    return [r, g, b, 1];
  }

  const jeVar = v.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]*))?\)$/i);
  // Turbopack tu už raz zahodil skrátený guard, takže sa porovnáva explicitne.
  if (jeVar !== null) {
    const nazov = jeVar[1]!;
    const dalej = tokeny.get(nazov);
    if (dalej !== undefined) return farba(dalej, tokeny, hlbka + 1);
    const zaloha = jeVar[2];
    if (zaloha !== undefined && zaloha.trim() !== '') return farba(zaloha, tokeny, hlbka + 1);
    throw new NeviemFarbu(`token ${nazov} nie je v tejto téme definovaný`);
  }

  const mix = v.match(/^color-mix\(\s*in\s+([a-z]+)\s*,([\s\S]*)\)$/i);
  if (mix !== null) {
    const priestor = mix[1]!.toLowerCase();
    if (priestor !== 'srgb' && priestor !== 'oklab') {
      throw new NeviemFarbu(`neznámy priestor color-mix: ${priestor}`);
    }
    const casti = argumenty(mix[2]!);
    if (casti.length !== 2) throw new NeviemFarbu(`color-mix s ${casti.length} zložkami: ${v}`);
    const rozober = (kus: string): [string, number | null] => {
      const m = kus.match(/^([\s\S]+?)\s+([\d.]+)%$/);
      return m === null ? [kus, null] : [m[1]!, Number(m[2]) / 100];
    };
    const [v1, p1raw] = rozober(casti[0]!);
    const [v2, p2raw] = rozober(casti[1]!);
    /*
     * CSS Color 5: chýbajúce percento je doplnok toho druhého, a keď chýbajú
     * obe, je to pol na pol. Poradie vetiev je preto dôležité — `p1` sa
     * dopočítava z `p2` a naopak, nie obe naraz. Turbopack v tomto repe už
     * raz zahodil skrátený guard, takže sa porovnáva explicitne s `null`.
     */
    const p1 =
      p1raw !== null ? p1raw : p2raw !== null ? 1 - p2raw : 0.5;
    const p2 = p2raw !== null ? p2raw : p1raw !== null ? 1 - p1raw : 0.5;
    const suma = p1 + p2;
    if (suma <= 0) throw new NeviemFarbu(`color-mix s nulovými podielmi: ${v}`);
    const w1 = p1 / suma;
    const w2 = p2 / suma;
    const c1 = farba(v1, tokeny, hlbka + 1);
    const c2 = farba(v2, tokeny, hlbka + 1);
    const a = c1[3] * w1 + c2[3] * w2;
    if (a === 0) return [0, 0, 0, 0];
    if (priestor === 'srgb') {
      const zloz = (i: number) => (c1[i]! * c1[3] * w1 + c2[i]! * c2[3] * w2) / a;
      return [zloz(0), zloz(1), zloz(2), a];
    }
    const o1 = doOklab(c1);
    const o2 = doOklab(c2);
    const [r, g, b] = zOklab([0, 1, 2].map((i) => (o1[i]! * c1[3] * w1 + o2[i]! * c2[3] * w2) / a) as [number, number, number]);
    return [r, g, b, a];
  }

  throw new NeviemFarbu(`neviem vyhodnotiť: ${v}`);
}

/** Priesvitná farba položená na nepriesvitnú. */
function nad(vrch: Rgba, spodok: Rgba): Rgba {
  const a = vrch[3];
  return [
    vrch[0] * a + spodok[0] * (1 - a),
    vrch[1] * a + spodok[1] * (1 - a),
    vrch[2] * a + spodok[2] * (1 - a),
    1,
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. PLOCHY STRÁNKY — ODVODENÉ Z CSS, NIE VYMENOVANÉ RUKOU (V7, K1)

   Do 3. 9. 2026 tu stál RUČNÝ zoznam desiatich plôch. Verifikácia V6c ho
   zmerala a našla diéru: štýly appky používajú **33 rôznych pozadí**, z toho
   26 sú skutočné plochy — a SEDEM z nich nieslo text, ktorý sa nemeral ani
   raz (tinty `.ovl-note--*`, `--brand-tint` na `.step[data-state='now']`,
   plochy hoveru `--brand-fill-hover` a `--st-critical-press`). Ručný zoznam
   je horší než chýbajúci: tvári sa, že kryje appku, a pritom kryje deň, keď
   ho niekto napísal. V7 pritom pozadia panelov PREKRESLIL (D153), takže
   zoznam by starol znova.

   Odvodenie má jedno pravidlo a to pravidlo je celá pointa:

     · pravidlo kreslí plochu A NASTAVUJE farbu textu → pár je známy, meria
       sa priamo (sekcia 7, nič nové);
     · pravidlo kreslí plochu a farbu textu NENASTAVUJE → text vnútra dedí
       z niečoho vyššie, teda je NEZNÁMY. Taká plocha je PLOCHA STRÁNKY
       a meria sa proti nej každý text, ktorý si vlastnú plochu nedeklaruje;
     · …okrem prípadu, keď farbu píše iné MENOVATEĽNÉ pravidlo — základný
       stav toho istého prvku (`.ovl-btn--primary:hover` ← `.ovl-btn--primary`)
       alebo predok (`.ovl-production-bar code` ← `.ovl-production-bar`).
       Vtedy je text známy a meria sa JEDEN pár, nie celá stránka.
       Robí to `poskytovatelFarby()` a je to odvodenie, nie zoznam.

   Nepriesvitná plocha vstupuje priamo; priesvitná (`color-mix(…, transparent)`)
   sa poskladá nad KAŽDOU nepriesvitnou plochou a meria sa najhorší prípad —
   inak by sa meral vzduch.

   Závoj `body::before` je tu ako VARIANTA `--paper`, nie ako plocha: je to
   ten istý papier prefarbený dekoráciou. Sila sa čita z tokenu, takže test
   meria to, čo je v CSS, nie číslo prepísané do testu.

   Jediné, čo z odvodenia vypadáva, je `PLOCHY_BEZ_TEXTU` nižšie — a tam
   nestojí „táto plocha je nudná", ale KTORÝ prvok to je a prečo naň text
   nepadne. Aj to sa testuje: sekcia 9 overuje, že každý taký selektor v CSS
   existuje a že naň žiadne pravidlo text nepíše.
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Pravidlá, ktoré kreslia plochu a farbu textu NENASTAVUJÚ.
 *
 * Je to funkcia a nie `const`, lebo `farbaTextu()` a `pozadie()` stoja nižšie
 * (sekcia 7, pri zostavovaní párov, kam významom patria) a `const` na úrovni
 * modulu by ich čítal pred inicializáciou. Výsledok sa spočíta raz.
 */
let plochotvorneMemo: Pravidlo[] | null = null;
function plochotvorne(): Pravidlo[] {
  if (plochotvorneMemo === null) {
    plochotvorneMemo = PRAVIDLA.filter((p) => {
      if (p.obal.some((o) => o.startsWith('@keyframes'))) return false;
      if (p.selektor.startsWith(':root')) return false;
      if (farbaTextu(p) !== undefined) return false;
      return pozadie(p) !== null;
    });
  }
  return plochotvorneMemo;
}

/**
 * PLOCHY, NA KTORÝCH ŽIADNY TEXT NESTOJÍ.
 *
 * Nie je to výnimka z K1 — je to zoznam prvkov, ktoré nie sú plocha pod
 * textom, ale samy KRESBA: prúžok, vlas, bodka, závoj. Keby sa dostali medzi
 * plochy stránky, každý tlmený text by sa meral aj na 10 px vysokom prúžku
 * merača, kam nikdy nepadne, a test by hlásil desiatky vymyslených pádov —
 * teda by sa musel oslabiť. To je horšie než pravda o troch prúžkoch.
 *
 * Vedie sa to po SELEKTOROCH, nie po tokenoch: `var(--accent)` je raz výplň
 * zaškrtnutého políčka a raz 3 px značka otvoreného riadku, a keď ho niekto
 * zajtra dá panelu, plocha sa MERAŤ MUSÍ. Tokenová výnimka by tú tretiu
 * bezhlasne prehltla.
 */
const PLOCHY_BEZ_TEXTU: readonly { selektor: string; dovod: string }[] = [
  // Žľab a výplň prúžku (`<i>` vnútri `<span>`), 6–10 px vysoké, bez obsahu.
  { selektor: '.hbar', dovod: 'žľab vodorovného prúžku' },
  { selektor: '.hbar i', dovod: 'výplň vodorovného prúžku' },
  { selektor: '.bar', dovod: 'žľab prúžku priebehu' },
  { selektor: '.bar i', dovod: 'výplň prúžku priebehu' },
  { selektor: '.bar.done i', dovod: 'výplň dokončeného prúžku' },
  { selektor: '.progress', dovod: 'žľab prúžku sprievodcu' },
  { selektor: '.progressFill', dovod: 'výplň prúžku sprievodcu' },
  { selektor: '.queueBar', dovod: 'žľab pásu frontu' },
  { selektor: ".queueBar i[data-state='ok']", dovod: 'diel pásu frontu' },
  { selektor: ".queueBar i[data-state='uncertain']", dovod: 'diel pásu frontu' },
  { selektor: ".queueBar i[data-state='failed']", dovod: 'diel pásu frontu' },
  { selektor: ".queueBar i[data-state='pending']", dovod: 'diel pásu frontu' },
  { selektor: '.meterTrack', dovod: 'žľab merača' },
  { selektor: '.meterFill', dovod: 'výplň merača' },
  { selektor: ".meter[data-tone='attention'] .meterFill", dovod: 'výplň merača' },
  { selektor: ".meter[data-tone='critical'] .meterFill", dovod: 'výplň merača' },
  { selektor: '.wait', dovod: 'žľab čakania v tabuľke' },
  { selektor: '.rowBar', dovod: 'žľab riadkového grafu' },
  { selektor: '.rowBarFill', dovod: 'výplň riadkového grafu' },
  { selektor: '.perfTrack', dovod: 'žľab porovnania období' },
  { selektor: '.perfTrack i', dovod: 'výplň porovnania období' },
  { selektor: '.perfStrong i', dovod: 'výplň porovnávacieho obdobia' },
  { selektor: '.tlTrack', dovod: 'žľab časovej osi' },
  { selektor: '.tlBand', dovod: 'pás okna platnosti na časovej osi' },
  { selektor: '.tlToday', dovod: '1 px značka dneška' },
  // Vlas a mriežka: plocha je VIDITEĽNÁ ČIARA, nie podklad.
  { selektor: '.hsep', dovod: 'vodorovný oddeľovač' },
  { selektor: '.kpis', dovod: 'mriežka dlaždíc — 1 px medzery, dlaždice majú --paper2' },
  // Bodka a značka.
  { selektor: '.bandDot', dovod: 'bodka pásma zľavy' },
  { selektor: '.openMark', dovod: '3 px značka otvoreného riadku' },
  // Dekoratívne vrstvy ::before/::after — kresba pod obsahom, nie plocha textu.
  { selektor: ".ovl-kpi-card[data-accent='true']::after", dovod: 'akcentová linka karty' },
  { selektor: '.ovl-empty-orbit::before', dovod: 'kresba prázdneho stavu' },
  // Závoj pod zásuvkou — obsah zásuvky má vlastnú plochu (`--surface-solid`).
  { selektor: '.ovl-drawer-backdrop', dovod: 'stmavenie pozadia zásuvky' },
  /*
   * Výplň zaškrtnutého políčka. Znak (✓ a –) na nej JE text a meria sa —
   * ale ako `ZDEDENA_PLOCHA`, teda jedným párom, nie ako plocha stránky.
   */
  { selektor: '.cb:checked, .cb:indeterminate', dovod: 'výplň políčka; znak meria ZDEDENA_PLOCHA' },
];

const BEZ_TEXTU = new Set(PLOCHY_BEZ_TEXTU.map((x) => x.selektor));

/**
 * Pravidlo, ktoré na túto plochu píše text, hoci ju samo nekreslí.
 *
 * Dva mechanické vzťahy, žiadny zoznam:
 *  1. STAV toho istého prvku — selektor bez pseudotried (`:hover`,
 *     `:not(…)`, `::after`). `.ovl-btn--primary:hover:not(:disabled)` kreslí
 *     `--brand-fill-hover` a farbu berie z `.ovl-btn--primary`.
 *  2. PREDOK — najdlhší selektor, ktorý je vlastnou predponou tohto po
 *     hranici potomka. `.ovl-production-bar code` stojí na
 *     `--production-code-bg` a text dedí z `.ovl-production-bar`.
 *
 * Bez tohto by hover plochy tlačidiel skončili medzi plochami stránky
 * a každý tlmený text by sa „meral" na tealovom tlačidle — teda vymyslený
 * pád. Takto sa meria to, čo na nich naozaj stojí: ich vlastný nápis.
 */
function poskytovatelFarby(p: Pravidlo): { selektor: string; farba: string } | null {
  const zoznam = PRAVIDLA.filter((x) => farbaTextu(x) !== undefined);
  const bezStavu = p.selektor.replace(/::?[a-z-]+(\([^)]*\))?/g, '').trim();
  if (bezStavu !== p.selektor && bezStavu !== '') {
    const zaklad = zoznam.find((x) => x.selektor === bezStavu);
    if (zaklad !== undefined) return { selektor: bezStavu, farba: farbaTextu(zaklad)! };
  }
  let najdlhsi: Pravidlo | null = null;
  for (const x of zoznam) {
    if (x.selektor === p.selektor) continue;
    if (!p.selektor.startsWith(`${x.selektor} `) && !p.selektor.startsWith(`${x.selektor}>`)) {
      continue;
    }
    if (najdlhsi === null || x.selektor.length > najdlhsi.selektor.length) najdlhsi = x;
  }
  return najdlhsi === null
    ? null
    : { selektor: najdlhsi.selektor, farba: farbaTextu(najdlhsi)! };
}

/**
 * PODKLAD pod priesvitnou plochou, keď ho CSS pozná.
 *
 * `.ovl-production-bar code` je priesvitný čip a stojí na `--production-bg`,
 * nie na ľubovoľnej ploche stránky; `.selbar .btn.ghost:hover` stojí na
 * `--selbar-bg`. Bez tohto by sa čip skladal nad každou plochou vrátane
 * priesvitných panelov — teda nad vecami, ktoré pod ním nikdy nie sú, a test
 * by hlásil desiatky pomerov 1,0 : 1, ktoré na obrazovke neexistujú.
 *
 * Hľadá sa tá istá dvojica vzťahov ako v `poskytovatelFarby()`: základný stav
 * toho istého prvku a najbližší predok. Keď ani jeden nekreslí NEPRIESVITNÚ
 * plochu, vráti `null` a meria sa nad všetkými plochami stránky — teda
 * konzervatívne.
 */
function podkladPre(p: Pravidlo, tokeny: Map<string, string>): string | null {
  const kreslia = PRAVIDLA.filter((x) => {
    const bg = pozadie(x);
    if (bg === null) return false;
    const c = skusFarbu(bg, tokeny);
    return c !== null && c[3] >= 1;
  });
  const bezStavu = p.selektor.replace(/::?[a-z-]+(\([^)]*\))?/g, '').trim();
  if (bezStavu !== p.selektor && bezStavu !== '') {
    const zaklad = kreslia.find((x) => x.selektor === bezStavu);
    if (zaklad !== undefined) return pozadie(zaklad);
  }
  let najdlhsi: Pravidlo | null = null;
  for (const x of kreslia) {
    if (x.selektor === p.selektor) continue;
    if (!p.selektor.startsWith(`${x.selektor} `) && !p.selektor.startsWith(`${x.selektor}>`)) {
      continue;
    }
    if (najdlhsi === null || x.selektor.length > najdlhsi.selektor.length) najdlhsi = x;
  }
  return najdlhsi === null ? null : pozadie(najdlhsi);
}

/** Plochy, na ktoré padá NEZNÁMY text — teda tie bez vlastnej farby a bez poskytovateľa. */
function plochyStranky(): Pravidlo[] {
  return plochotvorne().filter(
    (p) => !BEZ_TEXTU.has(p.selektor) && poskytovatelFarby(p) === null,
  );
}

/**
 * PÁRY POTOMKA — plocha kreslená jedným pravidlom, text pravidlom POTOMKA.
 *
 * `.ovl-sbar-why-panel` (karta) si farbu textu nastavuje, takže OTVORENÁ
 * plocha to nie je — ale `.ovl-sbar-why-panel b` na nej stojí a vlastnú
 * plochu nemá. To isté je `.chip[aria-pressed='true'] .chipCount` na značkovej
 * výplni a `.ovl-note summary` na tinte. Bez tohto by karta z merania
 * vypadla úplne (`--dim` má na nej 7,28 : 1, teda NAJTESNEJŠÍ pár tmavej
 * témy) len preto, že ju kreslí pravidlo s vlastnou farbou.
 *
 * Vzťah sa ČÍTA z CSS (selektor potomka začína selektorom plochy), takže je
 * to odvodenie, nie zoznam. Nezastupuje konzervatívne meranie nad plochami
 * stránky — dopĺňa ho tam, kde CSS vnorenie POVIE.
 */
function paryPotomkov(): { plocha: Pravidlo; text: Pravidlo }[] {
  const out: { plocha: Pravidlo; text: Pravidlo }[] = [];
  for (const p of PRAVIDLA) {
    if (p.obal.some((o) => o.startsWith('@keyframes'))) continue;
    if (p.selektor.startsWith(':root')) continue;
    if (BEZ_TEXTU.has(p.selektor)) continue;
    const bg = pozadie(p);
    if (bg === null) continue;
    for (const x of PRAVIDLA) {
      if (farbaTextu(x) === undefined) continue;
      if (pozadie(x) !== null) continue;
      if (!x.selektor.startsWith(`${p.selektor} `) && !x.selektor.startsWith(`${p.selektor}>`)) {
        continue;
      }
      out.push({ plocha: p, text: x });
    }
  }
  return out;
}

/** Plochy s VLASTNÝM textom: plocha kreslená jedným pravidlom, farba druhým. */
function plochySCudzouFarbou(): { pravidlo: Pravidlo; kto: { selektor: string; farba: string } }[] {
  return plochotvorne().flatMap((p) => {
    if (BEZ_TEXTU.has(p.selektor)) return [];
    const kto = poskytovatelFarby(p);
    return kto === null ? [] : [{ pravidlo: p, kto }];
  });
}

/**
 * ZEM — plochy, nad ktorými sa skladajú PRIESVITNÉ plochy.
 *
 * Zem je ŠTRUKTÚRA: stránka, tá istá stránka pod závojom, panel, pruh, karta,
 * vybraný riadok. Nie je to zoznam — odvodzuje sa z tých istých plôch ako
 * všetko ostatné a vylučujú sa z nej TINTY, teda plochy zamiešané zo stavovej
 * alebo značkovej farby. Dôvod je fyzický: tinta je panel a panel v panele
 * v tejto appke nikto nekreslí, takže „tinta značky nad tintou pozornosti" je
 * dvojica, ktorá na obrazovke neexistuje — a takých by vznikli tisíce.
 * Priesvitný čip nad KARTOU naopak existuje (tak sa 3. 9. 2026 našiel
 * `.chipCount` na 5,99 : 1), a preto karta v zemi JE.
 *
 * Rozlíšenie „tinta verzus štruktúra" nie je podľa mena tokenu, ale podľa
 * jeho ROZKLADU: keď sa hodnota rozkladá cez tón (`--st-*`, `--teal`,
 * `--deep`, `--gold*`, `--seq-*`, `--brand*`, `--accent*`), je to tinta.
 * `--sel` je v tmavej téme tealovo ladený LITERÁL, takže zem — a to je
 * správne: je to plocha riadku, nie panel navrch.
 */
const TONOVE_TOKENY = /^--(st-|teal|deep|gold|seq-|brand|accent)/;

function jeTinta(hodnota: string, tokeny: Map<string, string>, hlbka = 0): boolean {
  if (hlbka > 12) return false;
  for (const m of hodnota.matchAll(/--[a-z0-9-]+/g)) {
    if (TONOVE_TOKENY.test(m[0])) return true;
    const dalej = tokeny.get(m[0]);
    if (dalej !== undefined && jeTinta(dalej, tokeny, hlbka + 1)) return true;
  }
  return false;
}

function zemPlochy(tokeny: Map<string, string>): Record<string, Rgba> {
  const t = (v: string) => farba(v, tokeny);
  const papier = t('var(--paper)');
  const out: Record<string, Rgba> = {
    'var(--paper)': papier,
    '--paper + závoj brand': nad(t('var(--veil-brand)'), papier),
    '--paper + závoj gold': nad(t('var(--veil-gold)'), papier),
  };
  for (const p of plochyStranky()) {
    const bg = pozadie(p)!;
    if (jeTinta(bg, tokeny)) continue;
    const c = skusFarbu(bg, tokeny);
    if (c === null || c[3] < 1) continue;
    out[bg] = c;
  }
  return out;
}

function plochy(tokeny: Map<string, string>): Record<string, Rgba> {
  const zem = zemPlochy(tokeny);
  const out: Record<string, Rgba> = { ...zem };
  const priesvitne: [string, Rgba][] = [];
  for (const p of plochyStranky()) {
    const bg = pozadie(p)!;
    const c = skusFarbu(bg, tokeny);
    if (c === null) continue;
    if (c[3] >= 1) out[bg] = c;
    else priesvitne.push([bg, c]);
  }
  for (const [bg, c] of priesvitne) {
    for (const [nazov, s] of Object.entries(zem)) out[`${bg} nad ${nazov}`] = nad(c, s);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. TRI VÝNIMKY, KAŽDÁ S DÔVODOM A S PLATNOSŤOU OVERENOU TESTOM

   Zoznamy nižšie sú jediné miesto, kde je meranie riadené rukou. Preto pri
   každom stojí, PREČO tam je — a preto sa nižšie testuje, že každý ich
   selektor v CSS naozaj existuje. Zoznam, ktorý ukazuje na zmazané pravidlo,
   je horší než žiadny: tvári sa, že niečo kryje.
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * IKONY — netextová grafika, hranica 3 : 1 (WCAG 1.4.11).
 *
 * Každý z týchto selektorov kreslí `<Icon>` (`ui/Icon.tsx`), nie slovo:
 * `StatusBar.tsx` → `.ovl-sbar-mark`, `BlockerList.tsx` → `.blockerGlyph`,
 * `DiscountDetail.tsx` → `.queueGlyph`. Slovo stavu stojí VEDĽA nich vo
 * vlastnom prvku a to je text — meria sa na 4,5 : 1 ako všetko ostatné.
 * Pravidlo troch kanálov to nezoslabuje: ikona je druhý kanál, slovo tretí.
 */
const IKONY: readonly string[] = [
  ".ovl-sbar-cell[data-tone='good'] .ovl-sbar-mark",
  ".ovl-sbar-cell[data-tone='idle'] .ovl-sbar-mark",
  ".ovl-sbar-cell[data-tone='progress'] .ovl-sbar-mark",
  '.blockerGlyph',
  ".blocker[data-tone='attention'] .blockerGlyph",
  ".blocker[data-tone='critical'] .blockerGlyph",
  ".blocker[data-tone='progress'] .blockerGlyph",
  ".blocker[data-tone='good'] .blockerGlyph",
  ".queueTile[data-any='ano'][data-state='ok'] .queueGlyph",
  ".queueTile[data-any='ano'][data-state='pending'] .queueGlyph",
  ".queueTile[data-any='ano'][data-state='failed'] .queueGlyph",
  ".queueTile[data-any='ano'][data-state='uncertain'] .queueGlyph",
];

/**
 * DEKORÁCIE — hranica viditeľnosti (1,2 : 1), nie čitateľnosti.
 *
 * Oddeľovač medzi položkami nenesie ŽIADNU informáciu: omrvinky majú
 * `aria-hidden` na oddeľovači a štruktúru nesú odkazy, bodka medzi faktami
 * je len rytmus. Keby zmizla, nestratí sa nič — a tmavší oddeľovač by
 * naopak súperil s textom, ktorý oddeľuje. Obe berú `--line2`, teda TOKEN
 * OKRAJA, a to je zámer: je to čiara, ktorá má tvar znaku.
 * POZOR: toto nie je diera na text. Kto sem pridá selektor, ktorý nesie
 * slovo, obchádza K7 — a `farbaKodujeStav` nižšie ho pri stavovej farbe
 * chytí, lebo stav sa dekoráciou vyhlásiť nedá.
 */
const DEKORACIE: readonly string[] = ['.sep-dot', '.sep'];

/**
 * NEAKTÍVNE PRVKY — hranica 2 : 1.
 *
 * WCAG 1.4.3 aj 1.4.6 vynímajú text neaktívneho prvku z textovej hranice
 * výslovne („inactive user interface component"), a je to jediná výnimka
 * v tomto súbore, ktorá sa NEUDRŽIAVA ZOZNAMOM — číta sa zo selektora, takže
 * nový zakázaný stav sa do nej dostane sám a nikto ju nemusí dopĺňať.
 *
 * Prečo nie nula: zakázaná voľba, ktorej popis sa nedá prečítať, nie je
 * zakázaná voľba, ale prázdne miesto — človek nezistí, čo je nedostupné.
 * 2 : 1 je preto podlaha ČITATEĽNOSTI TVARU, nie zoslabenie K1.
 * A druhý smer je rovnako dôležitý: neaktívny prvok sa NESMIE vytiahnuť
 * nahor s ostatným textom. Keď D164 posunul `--dim` na 7 : 1, zakázané prvky
 * z nej vyskočili na 3,58 : 1 (tmavá) — teda vyzerali dostupne — a preto
 * dostali vlastný `--ink-disabled`. Dnešné najhoršie hodnoty sú 2,14 : 1
 * (svetlá) a 2,79 : 1 (tmavá), čo je tam, kde to bolo pred D164
 * (2,32 / 2,67), takže podlaha nie je opísaný súčasný stav.
 *
 * `:not(:disabled)` sa musí odstrihnúť PRED testom — `.chip:hover:not(:disabled)`
 * je pravidlo AKTÍVNEHO prvku a výnimka sa naň vzťahovať nesmie.
 */
function jeNeaktivne(selektor: string): boolean {
  const bezNot = selektor.replace(/:not\([^)]*\)/g, '');
  return /:disabled|\[disabled\]|aria-disabled=['"]?true/i.test(bezNot);
}

/**
 * ZDEDENÁ PLOCHA — pravidlo nastaví `color`, ale plochu má od predka.
 *
 * Jedna položka na pravidlo a pri každej stojí, KTORÉ pravidlo tú plochu
 * kreslí. Bez tohto zoznamu by sa tieto štyri merali proti plochám stránky,
 * čo je nezmysel: biele písmo v tmavej lište výberu na svetlom papieri
 * „padne", hoci na svojej lište má 16 : 1.
 */
const ZDEDENA_PLOCHA: readonly { selektor: string; plocha: string; kreslim: string }[] = [
  // `.selbar { background: var(--selbar-bg) }` — lišta je tmavá v OBOCH témach.
  { selektor: '.selbar .all', plocha: 'var(--selbar-bg)', kreslim: '.selbar' },
  { selektor: '.selbar .btn.ghost', plocha: 'var(--selbar-bg)', kreslim: '.selbar' },
  // `.cb:checked, .cb:indeterminate { background: var(--accent) }` — znak
  // (✓ a –) stojí na výplni políčka, nie na papieri.
  {
    selektor: '.cb:checked::after',
    plocha: 'var(--accent)',
    kreslim: '.cb:checked, .cb:indeterminate',
  },
  {
    selektor: '.cb:indeterminate::after',
    plocha: 'var(--accent)',
    kreslim: '.cb:checked, .cb:indeterminate',
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
   7. ZOSTAVENIE PÁROV
   ═════════════════════════════════════════════════════════════════════════ */

interface Par {
  /** Ľudský popis — objaví sa v hláške padajúceho testu. */
  kde: string;
  text: string;
  plocha: string;
  hranica: number;
}

const PRESKOC_FARBU = new Set(['inherit', 'currentcolor', 'unset', 'initial', 'revert']);

/**
 * TEXT V SVG SA PÍŠE `fill`, NIE `color` (doplnené 3. 9. 2026).
 *
 * Do tohto dňa test čítal VÝHRADNE `color:`, takže popisky osi grafu
 * (`charts.module.css { .axisTick }` → `fill: var(--dim)`, na obrazovke okolo
 * 7 px) a poradové čísla dielov koláča (`{ .pieOrder }` → `fill: var(--ink)`)
 * neboli v K7 zmerané ANI RAZ. Bol to celý druh textu mimo dozoru — a pritom
 * ten najmenší, teda ten, ktorý na kontrast doplatí prvý.
 *
 * Rozlíšenie „`fill` je text" verzus „`fill` je grafika" NIE JE ručný zoznam:
 * pravidlo, ktoré kreslí text, si v tom istom mieste nastavuje aj písmo
 * (`font-size`, `font-family`, `font-weight`). Marka, výsek ani mriežka
 * písmo nemajú. Zoznam by starnul; táto podmienka nie.
 *
 * `fill`/`stroke` BEZ písma sa naďalej nemeria — je to netextová grafika
 * s hranicou 3 : 1 (WCAG 1.4.11) a stráži ju `grafy-paleta.spec.ts` pre marky
 * grafu. Že je to len ČIASTOČNÉ krytie, je napísané v hlavičke tohto súboru.
 */
const PISMO = ['font-size', 'font-family', 'font-weight'];

/** Farba TEXTU pravidla — `color`, alebo `fill` v pravidle, ktoré nesie písmo. */
function farbaTextu(p: Pravidlo): string | undefined {
  const c = p.dekl.get('color');
  if (c !== undefined) return c;
  const fill = p.dekl.get('fill');
  if (fill === undefined) return undefined;
  return PISMO.some((v) => p.dekl.has(v)) ? fill : undefined;
}

/** Pravidlá, ktoré nastavujú farbu textu a dajú sa vyhodnotiť. */
const TEXTOVE = PRAVIDLA.filter((p) => {
  if (p.obal.some((o) => o.startsWith('@keyframes'))) return false;
  const c = farbaTextu(p);
  if (c === undefined) return false;
  if (PRESKOC_FARBU.has(c.toLowerCase())) return false;
  if (c === 'transparent') return false; // .ovl-skeleton — plocha bez textu
  if (c.toLowerCase() === 'none') return false; // `fill: none` nekreslí nič
  return true;
});

/** Hodnota pozadia pravidla, alebo `null`, ak plochu nekreslí. */
function pozadie(p: Pravidlo): string | null {
  const v = p.dekl.get('background') ?? p.dekl.get('background-color') ?? null;
  if (v === null) return null;
  if (['transparent', 'none', 'inherit'].includes(v.toLowerCase())) return null;
  if (/gradient|url\(/i.test(v)) return null; // gradient nie je jedna farba
  return v;
}

/**
 * Hranica textu je JEDNO číslo a je tu raz (D164). Keby stálo aj v tvrdeniach
 * v §10, dalo by sa „opraviť" padajúci pár znížením jednej z dvoch kópií
 * a druhá by o tom mlčala — presne pasca „to isté číslo nesmie žiť na dvoch
 * miestach" z CLAUDE.md.
 */
const HRANICA_TEXT = 7;

/**
 * VÝNIMKA JE FARBA, NIE ZOZNAM SELEKTOROV.
 *
 * Kryje presne tú farbu, na ktorú sa `--deep` v SVETLEJ téme rozloží, a to
 * v oboch rolách — ako text aj ako plocha pod textom. Zoznam selektorov by
 * starnul a dal by sa rozšíriť; farba nie. `--deep` v tmavej téme sa pod ňu
 * nedostane (tam je `--accent` = `--teal3`, 8,65 : 1) a nová farba tiež nie.
 *
 * Dôvod aj obe zmerané hodnoty sú v hlavičke súboru; dôkazy v §10a a §10b.
 */
const HRANICA_KONFLIKT = 4.5;

/** Rozloží hodnotu na farbu, alebo `null`, keď sa to v tejto téme nedá. */
function skusFarbu(v: string, tokeny: Map<string, string>): Rgba | null {
  try {
    return farba(v, tokeny);
  } catch {
    return null;
  }
}

function hranicaPre(p: Pravidlo): number {
  if (IKONY.includes(p.selektor)) return 3;
  if (DEKORACIE.includes(p.selektor)) return 1.2;
  if (jeNeaktivne(p.selektor)) return 2;
  return HRANICA_TEXT;
}

/**
 * `opacity` v pravidle textu znižuje kontrast a nikto by si to nevšimol:
 * `.est` (odhad) má `opacity: 0.82` nad `--ink2`. Berie sa ako alfa textu.
 */
function alfaTextu(p: Pravidlo): number {
  const o = p.dekl.get('opacity');
  if (o === undefined) return 1;
  const n = Number(o);
  return Number.isFinite(n) ? n : 1;
}

function paryPre(
  tokeny: Map<string, string>,
  svetla: boolean,
): { pary: Par[]; hodnota: Map<string, number> } {
  const PLOCHY = plochy(tokeny);
  /*
   * Nad čím sa skladá priesvitná plocha SAMOTNÉHO textového pravidla: nad
   * ZEMOU, tak ako pri odvodených plochách. Skladať ju nad každou tintou by
   * vyrobilo „tintu zlatej nad tintou pozornosti nad papierom" — panel
   * v paneli v paneli, čo v tejto appke nikto nekreslí.
   */
  const ZEM = zemPlochy(tokeny);
  const pary: Par[] = [];
  const hodnota = new Map<string, number>();

  /*
   * Značkový teal svetlej témy — jediná farba s uvoľnenou hranicou, a to
   * v OBOCH rolách. Rozhoduje sa tu, pri meraní, a nie v `hranicaPre()`:
   * plocha sa dozvie až tu (to isté pravidlo sa meria nad ôsmimi plochami)
   * a výnimka platí aj vtedy, keď je teal PLOCHA, nie text.
   */
  const teal = svetla ? skusFarbu('var(--deep)', tokeny) : null;
  const jeTeal = (c: Rgba): boolean =>
    teal !== null && [0, 1, 2].every((i) => Math.abs(c[i]! - teal[i]!) < 0.5) && c[3] === teal[3];

  const zmeraj = (kde: string, textV: string, alfa: number, plochaV: string, plochaC: Rgba, zaklad: number) => {
    const t = farba(textV, tokeny);
    const textNaPloche = nad([t[0], t[1], t[2], t[3] * alfa], plochaC);
    const r = contrastRgb(NEPRIESVITNA(textNaPloche), NEPRIESVITNA(plochaC));
    const kluc = `${kde} · ${textV} na ${plochaV}`;
    const hranica =
      zaklad === HRANICA_TEXT && (jeTeal(t) || jeTeal(plochaC)) ? HRANICA_KONFLIKT : zaklad;
    hodnota.set(kluc, r);
    pary.push({ kde: kluc, text: textV, plocha: plochaV, hranica });
  };

  for (const p of TEXTOVE) {
    const textV = farbaTextu(p)!;
    const alfa = alfaTextu(p);
    const hranica = hranicaPre(p);
    const kde = `${p.subor} { ${p.selektor} }`;

    const zdedena = ZDEDENA_PLOCHA.find((z) => z.selektor === p.selektor);
    if (zdedena !== undefined) {
      const c = farba(zdedena.plocha, tokeny);
      const podklad = c[3] < 1 ? nad(c, farba('var(--paper2)', tokeny)) : c;
      zmeraj(kde, textV, alfa, `${zdedena.plocha} (z ${zdedena.kreslim})`, podklad, hranica);
      continue;
    }

    const bg = pozadie(p);
    if (bg === null) {
      for (const [nazov, c] of Object.entries(PLOCHY)) zmeraj(kde, textV, alfa, nazov, c, hranica);
      continue;
    }
    const c = farba(bg, tokeny);
    if (c[3] < 1) {
      // Priesvitná plocha: najhorší prípad nad každou PLNOU plochou stránky.
      for (const [nazov, s] of Object.entries(ZEM)) {
        zmeraj(kde, textV, alfa, `${bg} nad ${nazov}`, nad(c, s), hranica);
      }
      continue;
    }
    zmeraj(kde, textV, alfa, bg, c, hranica);
  }

  /*
   * Plochy, ktoré kreslí jedno pravidlo a text na ne píše druhé (stav toho
   * istého prvku alebo predok). Merajú sa JEDNÝM párom — na hover ploche
   * tlačidla stojí jeho vlastný nápis, nie ľubovoľný tlmený text.
   */
  for (const { pravidlo, kto } of plochySCudzouFarbou()) {
    if (PRESKOC_FARBU.has(kto.farba.toLowerCase())) continue;
    const bg = pozadie(pravidlo)!;
    const c = skusFarbu(bg, tokeny);
    if (c === null) continue;
    const kde = `${pravidlo.subor} { ${pravidlo.selektor} } ← text z { ${kto.selektor} }`;
    const hranica = hranicaPre(pravidlo);
    if (c[3] < 1) {
      const podklad = podkladPre(pravidlo, tokeny);
      if (podklad !== null) {
        zmeraj(kde, kto.farba, 1, `${bg} nad ${podklad}`, nad(c, farba(podklad, tokeny)), hranica);
        continue;
      }
      for (const [nazov, s] of Object.entries(ZEM)) {
        zmeraj(kde, kto.farba, 1, `${bg} nad ${nazov}`, nad(c, s), hranica);
      }
      continue;
    }
    zmeraj(kde, kto.farba, 1, bg, c, hranica);
  }

  /*
   * Páry, kde plochu kreslí predok a text potomok — vzťah, ktorý CSS POVIE.
   * Toto je jediné miesto, kde sa meria text na karte kreslenej pravidlom
   * s vlastnou farbou (`.ovl-sbar-why-panel`).
   */
  for (const { plocha: pl, text: tx } of paryPotomkov()) {
    const textV = farbaTextu(tx)!;
    if (PRESKOC_FARBU.has(textV.toLowerCase())) continue;
    const bg = pozadie(pl)!;
    const c = skusFarbu(bg, tokeny);
    if (c === null) continue;
    const kde = `${pl.subor} { ${pl.selektor} } ← text z { ${tx.selektor} }`;
    const hranica = Math.min(hranicaPre(tx), hranicaPre(pl));
    const alfa = alfaTextu(tx);
    if (c[3] < 1) {
      const podklad = podkladPre(pl, tokeny);
      const zem = podklad === null ? ZEM : { [podklad]: farba(podklad, tokeny) };
      for (const [nazov, sp] of Object.entries(zem)) {
        zmeraj(kde, textV, alfa, `${bg} nad ${nazov}`, nad(c, sp), hranica);
      }
      continue;
    }
    zmeraj(kde, textV, alfa, bg, c, hranica);
  }

  return { pary, hodnota };
}

const MERANIA = TEMY.map((t) => ({ ...t, ...paryPre(t.tokeny, t.nazov === 'svetlá') }));




/* ═══════════════════════════════════════════════════════════════════════════
   8. KONTROLA SAMOTNEJ MATEMATIKY

   Beží PRVÁ. Keby bola pokazená mierka alebo `color-mix()`, všetko ostatné
   by prešlo omylom — presne to sa v tomto repe stalo `palette-math.ts`
   (delenie 255 dvakrát), a preto tam self-test je.
   ═════════════════════════════════════════════════════════════════════════ */

describe('meranie — kontrola mierky a color-mix()', () => {
  const hex = (v: string) => farba(v, new Map());
  const round = (c: Rgba) => c.slice(0, 3).map((x) => Math.round(x));

  it('biela na čiernej je 21 : 1', () => {
    expect(contrastRgb([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 1);
  });

  it('#767676 na bielej je 4,54 : 1 (hranica WCAG na vlások)', () => {
    expect(contrastRgb(hexToRgb('#767676'), [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRgb(hexToRgb('#767676'), [255, 255, 255])).toBeLessThan(4.6);
  });

  it('color-mix v sRGB mieša po zložkách', () => {
    expect(round(hex('color-mix(in srgb, #ff0000 50%, #0000ff)'))).toEqual([128, 0, 128]);
  });

  it('color-mix s `transparent` je len alfa, nie stmavenie', () => {
    // Keby sa `transparent` bral ako čierna, výsledok by bol tmavočervený
    // a všetky tinty stavov by test meral o polovicu tmavšie.
    const c = hex('color-mix(in srgb, #ff0000 20%, transparent)');
    expect(round(c)).toEqual([255, 0, 0]);
    expect(c[3]).toBeCloseTo(0.2, 6);
  });

  it('color-mix v Oklabe nie je to isté ako v sRGB', () => {
    const o = hex('color-mix(in oklab, #ffffff 50%, #000000)');
    const s = hex('color-mix(in srgb, #ffffff 50%, #000000)');
    expect(round(s)).toEqual([128, 128, 128]);
    /*
     * Oklab je perceptuálny: L = 0,5 je TMAVŠIE než sRGB 128, lebo sRGB 128
     * má lineárne len 0,216 svetla. Overiteľné zvonka: L 0,5 → #636363.
     * Keby sa priestory zamenili, tinty stavov by test meral o ~30 hodnôt
     * svetlejšie a padajúce páry by prešli.
     */
    expect(round(o)).toEqual([99, 99, 99]);
  });

  it('Oklab tam a späť vráti tú istú farbu', () => {
    const c: Rgba = [216, 184, 120, 1];
    const [r, g, b] = zOklab(doOklab(c));
    expect([Math.round(r), Math.round(g), Math.round(b)]).toEqual([216, 184, 120]);
  });

  it('priesvitná plocha nad papierom sa naozaj poskladá', () => {
    const v = nad([255, 255, 255, 0.5], [0, 0, 0, 1]);
    expect(Math.round(v[0])).toBe(128);
    expect(v[3]).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   9. POISTKY PROTI TESTU, KTORÝ NEMERAL NIČ
   ═════════════════════════════════════════════════════════════════════════ */

describe('test naozaj čítal appku', () => {
  it('číta globals.css aj každý *.module.css', () => {
    expect(SUBORY.length).toBeGreaterThanOrEqual(8);
    expect(SUBORY.some((f) => f.endsWith('globals.css'))).toBe(true);
    // Zoznam sa neudržiava ručne — nájde sa chôdzou po `src/` (D144).
    const moduly = SUBORY.filter((f) => f.endsWith('.module.css'));
    expect(moduly.length).toBeGreaterThanOrEqual(7);
  });

  it('nájde stovky pravidiel a desiatky farieb textu', () => {
    expect(PRAVIDLA.length).toBeGreaterThan(500);
    expect(TEXTOVE.length).toBeGreaterThan(60);
  });

  it('obe témy majú tokeny a nie sú to tie isté hodnoty', () => {
    for (const t of TEMY) expect(t.tokeny.size).toBeGreaterThan(80);
    const tmava = TEMY[0]!.tokeny.get('--paper');
    const svetla = TEMY[1]!.tokeny.get('--paper');
    expect(tmava).not.toEqual(svetla);
  });

  it('meria sa stovky párov v každej téme', () => {
    for (const m of MERANIA) expect(m.pary.length).toBeGreaterThan(150);
  });

  it('každý selektor vo výnimkách v CSS existuje', () => {
    // Zoznam ukazujúci na zmazané pravidlo sa tvári, že niečo kryje.
    const su = new Set(PRAVIDLA.map((p) => p.selektor));
    const chybaju = [
      ...IKONY,
      ...DEKORACIE,
      ...ZDEDENA_PLOCHA.map((z) => z.selektor),
      ...PLOCHY_BEZ_TEXTU.map((z) => z.selektor),
    ].filter((s) => !su.has(s));
    expect(chybaju, 'výnimka bez pravidla — buď ju zmaž, alebo vráť pravidlo').toEqual([]);
  });

  it('plochu, ktorú si výnimka pýta, naozaj kreslí menované pravidlo', () => {
    for (const z of ZDEDENA_PLOCHA) {
      const kreslic = PRAVIDLA.find((p) => p.selektor === z.kreslim);
      expect(kreslic, `pravidlo ${z.kreslim} neexistuje`).toBeDefined();
      const bg = kreslic?.dekl.get('background') ?? kreslic?.dekl.get('background-color');
      expect(bg, `${z.kreslim} už nekreslí plochu, ${z.selektor} teda stojí na inom`).toBe(z.plocha);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   9b. POISTKY ODVODENIA PLÔCH (V7, K1)

   Diera, ktorú V6c našla, bola v tom, že plochy boli ZOZNAM. Odvodenie ju
   zatvára len dovtedy, kým sa nedá tichým spôsobom obísť — a dajú sa tri:
   zmazať pravidlo, na ktoré ukazuje výnimka; presunúť nepohodlnú plochu medzi
   „bez textu"; alebo nechať odvodenie spadnúť na prázdno. Tieto štyri
   tvrdenia sú závory na všetky tri.
   ═════════════════════════════════════════════════════════════════════════ */

describe('plochy sa ODVODZUJÚ z CSS, nie vymenúvajú', () => {
  it('odvodenie našlo desiatky plôch a plochy, ktoré V6c hlásila ako nekryté', () => {
    /*
     * Ručný zoznam mal 10 položiek a sedem plôch s textom mu chýbalo. Menujú
     * sa tu tie, ktoré vtedy chýbali — nie preto, že by ich odvodenie
     * potrebovalo, ale aby sa odvodenie nedalo zúžiť späť bez červeného testu.
     */
    for (const t of TEMY) {
      const mena = Object.keys(plochy(t.tokeny));
      expect(mena.length, `${t.nazov}: odvodenie plôch spadlo na zoznam`).toBeGreaterThan(15);
      for (const musi of [
        'var(--paper)',
        'var(--paper2)',
        'var(--paper3)',
        'var(--sel)',
        'var(--surface-solid)',
        'var(--st-critical-tint)',
        'var(--st-attention-tint)',
        'var(--st-progress-tint)',
        'var(--st-good-tint)',
      ]) {
        expect(mena, `${t.nazov}: plocha ${musi} sa nemeria`).toContain(musi);
      }
    }
  });

  it('plochy hoveru sa merajú farbou, ktorú na ne píše základný stav', () => {
    /*
     * `--brand-fill-hover` a `--st-critical-press` neboli v meraní ANI RAZ —
     * a stlačené červené tlačidlo malo na bielom písme 4,31 : 1, teda pod
     * hranicou aj po D164. Našlo to odvodenie; toto tvrdenie drží, aby sa
     * `poskytovatelFarby()` nedal odstrániť bez pádu.
     */
    const kde = MERANIA[0]!.pary.map((p) => p.kde);
    for (const musi of [
      '.ovl-btn--primary:hover',
      '.ovl-btn--danger:hover',
      '.selbar .btn.ghost:hover',
      '.ovl-production-bar code',
    ]) {
      expect(
        kde.some((k) => k.includes(musi) && k.includes('← text z')),
        `plocha ${musi} sa nemeria farbou svojho základného stavu`,
      ).toBe(true);
    }
  });

  it('každá plocha appky je zaradená — meraná alebo menovaná ako bez textu', () => {
    /*
     * Toto je závora na hlavnú pascu: nová plocha (V7 prekreslil pozadia
     * panelov, D153) sa nesmie dostať do CSS bez toho, aby ju niekto zaradil.
     * Nezaradená plocha padne TU, nie o mesiac na obrazovke.
     */
    for (const t of TEMY) {
      const zaradene = new Set([
        ...plochyStranky().map((p) => p.selektor),
        ...plochySCudzouFarbou().map((x) => x.pravidlo.selektor),
        ...BEZ_TEXTU,
      ]);
      const mimo = plochotvorne()
        .filter((p) => !zaradene.has(p.selektor))
        .map((p) => `${p.subor} { ${p.selektor} } → ${pozadie(p)!}`);
      expect(mimo, 'plocha bez zaradenia — zmeraj ju, alebo napíš, prečo na nej text nestojí').toEqual([]);
      // A druhý smer: zaradená plocha sa musí v tejto téme dať vyhodnotiť.
      const nevyhodnotene = plochyStranky()
        .filter((p) => skusFarbu(pozadie(p)!, t.tokeny) === null)
        .map((p) => `${p.subor} { ${p.selektor} } → ${pozadie(p)!}`);
      expect(nevyhodnotene, `${t.nazov}: plocha sa nedá vyhodnotiť, teda sa nemeria`).toEqual([]);
    }
  });

  it('na plochu „bez textu" naozaj žiadne pravidlo text nepíše', () => {
    /*
     * Výnimka bez dôkazu je diera s odôvodnením. Dôkaz je mechanický: keby
     * v CSS existovalo pravidlo POTOMKA vynechanej plochy, ktoré nastavuje
     * farbu textu, ten text by na nej stál — a výnimka by ho skryla.
     * (Pravidlo pre `.kpi .k` nie je potomok `.kpis` v CSS zápise: dlaždica
     * má vlastnú plochu `--paper2` a meria sa na nej.)
     */
    const spatne: string[] = [];
    for (const z of PLOCHY_BEZ_TEXTU) {
      for (const p of PRAVIDLA) {
        if (farbaTextu(p) === undefined) continue;
        if (pozadie(p) !== null) continue; // má vlastnú plochu, na tejto nestojí
        if (!p.selektor.startsWith(`${z.selektor} `) && !p.selektor.startsWith(`${z.selektor}>`)) {
          continue;
        }
        spatne.push(`${z.selektor} nesie text z { ${p.selektor} } — už to nie je kresba`);
      }
    }
    expect(spatne, 'plocha vyňatá ako „bez textu" text nesie — zaraď ju medzi merané').toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   10. K7 — KAŽDÝ PÁR V OBOCH TÉMACH
   ═════════════════════════════════════════════════════════════════════════ */

describe.each(MERANIA)('$nazov téma — kontrast každého páru text/plocha', ({ pary, hodnota }) => {
  it('žiadny text nemá menej než 7 : 1', () => {
    const pod = pary
      .filter((p) => p.hranica === HRANICA_TEXT && hodnota.get(p.kde)! < HRANICA_TEXT)
      .map((p) => `${p.kde} = ${hodnota.get(p.kde)!.toFixed(2)} : 1`);
    expect(pod, 'text pod hranicou čitateľnosti (D164, WCAG 1.4.6)').toEqual([]);
  });

  it('žiadna ikona nemá menej než 3 : 1', () => {
    const pod = pary
      .filter((p) => p.hranica === 3 && hodnota.get(p.kde)! < 3)
      .map((p) => `${p.kde} = ${hodnota.get(p.kde)!.toFixed(2)} : 1`);
    expect(pod, 'netextová grafika pod hranicou (WCAG 1.4.11)').toEqual([]);
  });

  it('popis neaktívneho prvku sa dá aspoň prečítať (2 : 1)', () => {
    const pod = pary
      .filter((p) => p.hranica === 2 && hodnota.get(p.kde)! < 2)
      .map((p) => `${p.kde} = ${hodnota.get(p.kde)!.toFixed(2)} : 1`);
    expect(pod, 'zakázaná voľba, ktorej popis nie je čitateľný, je prázdne miesto').toEqual([]);
  });

  it('dekoratívny oddeľovač je aspoň vidieť', () => {
    const pod = pary
      .filter((p) => p.hranica === 1.2 && hodnota.get(p.kde)! < 1.2)
      .map((p) => `${p.kde} = ${hodnota.get(p.kde)!.toFixed(2)} : 1`);
    expect(pod).toEqual([]);
  });

  it('pár, ktorý 7 : 1 neuniesol, je vymenovaný a stále čitateľný', () => {
    // Nie „nech to prejde", ale „nech je to VIDIEŤ v hlásení aj tak".
    const konflikt = pary.filter((p) => p.hranica === HRANICA_KONFLIKT);
    const pod = konflikt
      .filter((p) => hodnota.get(p.kde)! < HRANICA_KONFLIKT)
      .map((p) => `${p.kde} = ${hodnota.get(p.kde)!.toFixed(2)} : 1`);
    expect(pod, 'ani WCAG 1.4.3 (AA) už neplatí — to výnimka nekryje').toEqual([]);
  });

  it('výnimky nie sú väčšina — meria sa hlavne text', () => {
    // Poistka proti „opraveniu" padajúceho páru presunom do IKON.
    const textovych = pary.filter((p) => p.hranica === HRANICA_TEXT).length;
    expect(textovych / pary.length).toBeGreaterThan(0.85);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   11. ČO SA NESMIE STRATIŤ Z DOHĽADU
   ═════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   10a/10b. DÔKAZY VÝNIMKY

   Výnimka bez dôkazu je diera s odôvodnením. Tieto dva bloky si prepočítajú,
   že značkový teal svetlej témy 7 : 1 uniesť NEMÔŽE — ani ako text, ani ako
   plocha. Nemerajú dnešnú hodnotu `--deep` (tú by stačilo prepísať), merajú
   CELÝ PRIESTOR možností. Keď sa v ňom raz nájde farba, ktorá zvládne oboje,
   tieto testy sčervenajú a výnimka sa musí zmazať.
   ═════════════════════════════════════════════════════════════════════════ */

/* Chroma = ΔE od neutrálnej sivej TEJ ISTEJ svetlosti. Je to jediná
   mechanická odpoveď na otázku „je to ešte farba, alebo už sivá", a používa
   tú istú CIEDE2000, akou sa merajú odstupy stavov. */
function chroma(rgb: Rgb): number {
  const Y = 0.2126 * linear(rgb[0]!) + 0.7152 * linear(rgb[1]!) + 0.0722 * linear(rgb[2]!);
  const g = zLinear(Y);
  return deltaE(rgb, [g, g, g]);
}

/*
 * PODLAHA CHROMY PRE ZNAČKU. Bez nej dôkaz nižšie neplatí a nebolo by to
 * vidieť: v teal/cyan oblasti SA farby, ktoré zvládnu 7 : 1 aj ΔE ≥ 8,
 * nájdu — ale všetky sú tmavá bridlica, nie značka. Zmerané 3. 9. 2026:
 *   · dnešný `--deep` (#007278) ....... chroma 20,3
 *   · najfarebnejší z tých, čo zvládnu oboje (#303850) ... chroma 12,1
 *   · `--st-idle` (#4f555c), teda NEUTRÁLNY stav appky ... chroma  4,5
 * 15 je medzi značkou a bridlicou; tvrdenie nižšie overuje, že dnešná
 * značka podlahu prekonáva, takže podlaha nie je vybraná tak, aby vylúčila
 * práve ju.
 */
const CHROMA_ZNACKY = 15;

describe('§10a dôkaz — značkový teal ako TEXT 7 : 1 uniesť nemôže', () => {
  const SVETLA = TEMY[1]!.tokeny;
  const naHex = (v: string): string => {
    const c = farba(v, SVETLA);
    return `#${[0, 1, 2].map((i) => Math.round(c[i]!).toString(16).padStart(2, '0')).join('')}`;
  };
  const STAVY: Record<string, string> = {
    brani: naHex('var(--st-critical)'),
    obmedzuje: naHex('var(--st-attention)'),
    prebieha: naHex('var(--st-progress)'),
    vporiadku: naHex('var(--st-good)'),
    necinny: naHex('var(--st-idle)'),
  };

  it('stavová škála sa naozaj prečítala z CSS, nie z kópie v teste', () => {
    // Poistka proti dôkazu, ktorý porovnával s prázdnom.
    expect(Object.keys(STAVY)).toHaveLength(5);
    for (const [k, v] of Object.entries(STAVY)) expect(v, k).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(Object.values(STAVY)).size).toBe(5);
  });

  it('podlaha chromy neexistuje preto, aby vylúčila značku', () => {
    // Dnešná značka ju prekonáva; neutrálny stav appky je hlboko pod ňou.
    expect(chroma(hexToRgb(naHex('var(--deep)')))).toBeGreaterThan(CHROMA_ZNACKY);
    expect(chroma(hexToRgb(STAVY.necinny!))).toBeLessThan(CHROMA_ZNACKY / 2);
  });

  it('žiadny teal s ΔE ≥ 8 nedosiahne 7 : 1 ani na čistej bielej', () => {
    /*
     * Biela je NAJLEPŠIA možná plocha, takže výsledok nezávisí od toho, aké
     * plochy si appka zvolí — nedá sa „opraviť" prekreslením papiera.
     */
    const BIELA: Rgb = [255, 255, 255];
    const zvladli: string[] = [];
    let preskumanych = 0;
    for (let r = 0; r <= 48; r += 6) {
      for (let g = 56; g <= 148; g += 4) {
        for (let b = 56; b <= 176; b += 4) {
          if (b < g) continue; // teal/cyan: modrá nie menej než zelená
          const rgb: Rgb = [r, g, b];
          preskumanych++;
          if (chroma(rgb) < CHROMA_ZNACKY) continue;
          if (contrastRgb(rgb, BIELA) < HRANICA_TEXT) continue;
          const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          const najtesnejsi = tightestPairs({ ...STAVY, akcent: hex })
            .filter((x) => x.pair.includes('akcent'))
            .reduce((a, x) => (a.deltaE < x.deltaE ? a : x));
          if (najtesnejsi.deltaE >= 8) zvladli.push(`${hex} ΔE ${najtesnejsi.deltaE}`);
        }
      }
    }
    expect(preskumanych, 'mriežka je prázdna — dôkaz nemeral nič').toBeGreaterThan(2000);
    expect(
      zvladli.slice(0, 5),
      'taký teal existuje — výnimka pre značkový teal stráca dôvod, zmaž ju',
    ).toEqual([]);
  });
});

describe('§10b dôkaz — na značkovej ploche 7 : 1 nedosiahne ŽIADNY text', () => {
  /*
   * Toto nie je hľadanie, je to identita. Na ploche s luminanciou Y je
   * najvyšší dosiahnuteľný pomer max((1,05)/(Y+0,05), (Y+0,05)/0,05) — teda
   * biela alebo čierna, nič medzi tým. Pre svetlý `--accent` je to 5,71 : 1.
   * Takže „vyber lepšie písmo" neexistuje: musela by sa pohnúť PLOCHA, a tú
   * drží ΔE (§10a).
   */
  it('najvyšší možný pomer na svetlom --accent je 5,71 : 1', () => {
    const SVETLA = TEMY[1]!.tokeny;
    const plocha = NEPRIESVITNA(farba('var(--accent)', SVETLA));
    const najviac = Math.max(
      contrastRgb([255, 255, 255], plocha),
      contrastRgb([0, 0, 0], plocha),
    );
    expect(najviac).toBeLessThan(HRANICA_TEXT);
    expect(najviac).toBeGreaterThanOrEqual(HRANICA_KONFLIKT);
    // Číslo v hlásení, nie len „menej než 7" — aby bolo v reporte vidieť.
    expect(Number(najviac.toFixed(2))).toBe(5.71);
  });

  it('a biela je naozaj to najlepšie, čo sa na ňu dá napísať', () => {
    const SVETLA = TEMY[1]!.tokeny;
    const plocha = NEPRIESVITNA(farba('var(--accent)', SVETLA));
    expect(contrastRgb(NEPRIESVITNA(farba('var(--accent-on)', SVETLA)), plocha)).toBeCloseTo(
      contrastRgb([255, 255, 255], plocha),
      6,
    );
  });
});

describe('žiadna farba textu neuteká z merania', () => {
  it('každý token použitý ako farba textu je aspoň v jednom páre', () => {
    const pouzite = new Set<string>();
    for (const p of TEXTOVE) {
      // `farbaTextu()`, nie `color` — text v SVG nesie farbu vo `fill`.
      for (const m of farbaTextu(p)!.matchAll(/--[a-z0-9-]+/g)) pouzite.add(m[0]);
    }
    const merane = new Set<string>();
    for (const par of MERANIA[0]!.pary) {
      for (const m of par.text.matchAll(/--[a-z0-9-]+/g)) merane.add(m[0]);
    }
    const mimo = [...pouzite].filter((t) => !merane.has(t)).sort();
    expect(mimo, 'token kreslí text a nikto ho nemeria').toEqual([]);
  });

  it('text v SVG sa meria; grafika bez písma zostáva na 3 : 1 inde', () => {
    /*
     * Bez tohto tvrdenia by sa rozšírenie z 3. 9. 2026 dalo odobrať bez
     * jediného červeného testu — a popisky osi (7 px na obrazovke) by znova
     * vypadli z K7 úplne. Preto sa menuje, čo v pároch BYŤ MUSÍ.
     */
    const kde = MERANIA[0]!.pary.map((p) => p.kde);
    expect(kde.some((k) => k.includes('.axisTick')), 'popisok osi nie je v meraní').toBe(true);
    expect(kde.some((k) => k.includes('.pieOrder')), 'číslo dielu nie je v meraní').toBe(true);
    /* A druhý smer: výsek koláča ani mriežka písmo nemajú, takže to NIE JE
       text. Merať ich hranicou 4,5 : 1 by z grafiky spravilo odstavec. */
    expect(kde.some((k) => k.includes('.pieWedge'))).toBe(false);
    expect(kde.some((k) => k.includes('.gridLine'))).toBe(false);
  });

  it('sila závoja je token, nie číslo v gradiente', () => {
    // Kým tu bolo percento napísané priamo v `body::before`, závoj v meraní
    // NEEXISTOVAL — a pritom v svetlej téme zrážal text až o 0,6 pomeru.
    const telo = bezKomentarov(readFileSync(GLOBALS, 'utf8'));
    const zavoj = telo.match(/body::before\s*\{([\s\S]*?)\}/);
    expect(zavoj, 'body::before zmizol — závoj sa už nemeria').not.toBeNull();
    expect(zavoj![1]).toContain('var(--veil-brand)');
    expect(zavoj![1]).toContain('var(--veil-gold)');
    expect(zavoj![1]).not.toMatch(/\d+%\s*,\s*transparent/);
    for (const t of TEMY) {
      for (const token of ['--veil-brand', '--veil-gold'] as const) {
        const v = t.tokeny.get(token);
        expect(v, `${token} chýba v ${t.nazov} téme`).toBeDefined();
        expect(farba(v!, t.tokeny)[3]).toBeLessThan(1);
      }
    }
  });

  it('slovo stavu nekreslí plný tón — na to je `-ink`', () => {
    /*
     * Toto je nález, ktorý celý súbor odôvodňuje: `.state.*` a `.sig.*` mali
     * plné `--st-*` a pri 11,5–12,5 px nedosahovali 4,5 : 1 na `--paper3`
     * ani na `--surface-raised`. Zosvetliť tóny nešlo (ΔE ≥ 8 pod
     * farbosleposťou, paleta.spec.ts), takže sa zmenilo to, čo kreslí SLOVO.
     * Bez tohto tvrdenia sa to pri prvom „zjednotení" vráti.
     * Pri D164 to isté pravidlo zachytilo ešte tri miesta MIMO `.state.*`,
     * ktoré tento vzor nechytí — `.flag`, `zlavy.module.css { .note }`
     * a `overview.module.css { .actionNote }` kreslili slovo plným
     * `--st-attention` (6,88 : 1 na papieri pod závojom). Našlo ich MERANIE,
     * nie tento zoznam; preto je meranie to hlavné a zoznam len poistka.
     */
    const stavove = PRAVIDLA.filter(
      (p) => /^\.(state|sig)\.[a-z-]+$/.test(p.selektor) && p.dekl.has('color'),
    );
    expect(stavove.length).toBeGreaterThanOrEqual(8);
    const plnyTon = stavove
      .filter((p) => /var\(--st-[a-z]+\)/.test(p.dekl.get('color')!))
      .map((p) => `${p.selektor} → ${p.dekl.get('color')!}`);
    expect(plnyTon, 'slovo stavu potrebuje `--st-*-ink`, plný tón je výplň a okraj').toEqual([]);
  });
});
