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
 *     nad KAŽDOU plochou stránky a meria sa najhorší prípad;
 *   · žiadne / `transparent` / `none` → text stojí na ploche stránky, takže
 *     sa meria proti VŠETKÝM plochám;
 *   · zdedená plocha (text v tmavej lište výberu, znak v zaškrtnutom
 *     políčku) → `ZDEDENA_PLOCHA` nižšie, jedna položka na pravidlo.
 *
 * ── HRANICE ──────────────────────────────────────────────────────────────
 * 4,5 : 1 pre text (WCAG 1.4.3, malé písmo — v tejto appke je malé skoro
 * všetko: 11,5–13 px). 3 : 1 pre IKONY (1.4.11, netextová grafika) — a to len
 * pre pravidlá vymenované v `IKONY`, kde je dokázané, že kreslia `<Icon>`
 * a nie slovo. Dekoratívne oddeľovače majú hranicu viditeľnosti, nie
 * čitateľnosti; sú vymenované v `DEKORACIE` a je pri nich napísané prečo.
 *
 * ── ČO TENTO TEST NEVIE (a kto to stráži namiesto neho) ──────────────────
 *  1. **Vnorenie, ktoré CSS nepovie.** Ak niekto vloží text do priesvitnej
 *     plochy vnútri inej priesvitnej plochy, statický parser to nevidí.
 *     Merania nad všetkými plochami stránky sú horná hranica tohto rizika;
 *     zvyšok stráži preklik (D141), nie tento súbor.
 *
 *     KONKRÉTNY ŽIVÝ PRÍPAD (zmerané ručne 3. 9. 2026, verifikácia V6c):
 *     `signals.module.css { .chipCount }` nastavuje `color: var(--dim)` a
 *     pozadie NEMÁ, kým tint pod kurzorom nesie susedné pravidlo
 *     `{ .chip:hover }`. Test tie dve pravidlá neskladá, takže meria `--dim`
 *     na čistých plochách (prejde), nie na tinte nad nimi. Nad `--paper2` je
 *     to 4,71 (tmavá) / 4,82 (svetlá), nad `--paper` ale **4,46 v svetlej —
 *     teda POD hranicou**. Dnes je to latentné: `Chip` s počtom kreslí len
 *     `PanelHead` (`NewDiscount.tsx`), a ten stojí na `--paper2`. Prvý
 *     `Chip count` v `Toolbar`-e (`tables.module.css { .toolbarSticky }`,
 *     plocha `--paper`) tú hranicu prekročí a TENTO test to nenahlási.
 *     Zložiť to mechanicky by znamenalo poznať vnorenie selektorov; kým to
 *     nevie, drží to táto veta a preklik, nie zelený test.
 *  2. **Geometria závoja `body::before`.** Test počíta s jeho DEKLAROVANOU
 *     silou (`--veil-brand`, `--veil-gold`), teda s najhorším bodom gradientu.
 *     Na obrazovke je slabší (stredy oboch gradientov ležia mimo výrezu),
 *     takže je to konzervatívny odhad, nie presná hodnota. Dôležité je, že
 *     silu závoja nesie TOKEN: kto ho zosilní, dostane červený test.
 *     Do 2. 9. 2026 bolo percento napísané priamo v gradiente a v meraní
 *     neexistovalo.
 *  3. **`color: inherit` a `currentColor`.** Merajú sa tam, kde farba vzniká,
 *     nie tam, kde sa dedí. Pravidlo s `inherit` sa preskočí zámerne.
 *  4. **Hranica pre veľké písmo (3 : 1).** Nepoužíva sa. Je to úmyselne
 *     prísnejšie: `--ovl-fs-h1` je 1,5 rem = 24 px, čo je „large scale" až
 *     pri hmotnom reze, a rozlišovať to podľa `font-weight` by z testu
 *     spravilo hádanie.
 *
 * Vlastník: V6a, agent kontrastu (K7).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contrastRgb, hexToRgb, type Rgb } from '../helpers/palette-math';

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
   5. PLOCHY STRÁNKY

   Toto je zoznam toho, na čom v tejto appke môže stáť text bez toho, aby si
   svoju plochu deklaroval sám. Nie je vymyslený: každý z týchto tokenov je
   v CSS použitý ako `background` aspoň jedného pravidla, ktoré zároveň
   nastavuje `color` (`--paper` na `body`, `--paper2` na `.hdr`/`.sec`,
   `--paper3` na `.tabs a.on`, `--surface-raised` na `.segment`).

   Závoj `body::before` je tu ako VARIANTA `--paper`, nie ako plocha: je to
   ten istý papier prefarbený dekoráciou. Sila sa čita z tokenu, takže test
   meria to, čo je v CSS, nie číslo prepísané do testu.
   ═════════════════════════════════════════════════════════════════════════ */

function plochy(tokeny: Map<string, string>): Record<string, Rgba> {
  const t = (v: string) => farba(v, tokeny);
  const papier = t('var(--paper)');
  const zavojBrand = nad(t('var(--veil-brand)'), papier);
  const zavojGold = nad(t('var(--veil-gold)'), papier);
  const priesvitna = t('var(--surface)');
  return {
    '--paper': papier,
    '--paper + závoj brand': zavojBrand,
    '--paper + závoj gold': zavojGold,
    '--paper2': t('var(--paper2)'),
    '--paper3': t('var(--paper3)'),
    '--surface-raised': t('var(--surface-raised)'),
    '--surface nad --paper': nad(priesvitna, papier),
    '--surface nad závojom': nad(priesvitna, zavojBrand),
    /*
     * DOPLNENÉ 3. 9. 2026 — dve plochy, ktoré text naozaj nesú a v meraní
     * neboli:
     *
     *  · `--sel` je pozadie VYBRANÉHO riadku tabuľky (`tables.module.css`
     *    `.rowSelected > .cell` farbu textu nenastavuje, takže celý taký
     *    riadok — bunka, pomlčka, dolná hranica — stál mimo K7),
     *  · `--surface-solid` nesie PRILEPENÝ stĺpec. Dnes je to `var(--paper2)`,
     *    takže vyzeral krytý — ale len náhodou: deň, keď dostane vlastnú
     *    hodnotu, by prilepená bunka prestala byť meraná bez jediného
     *    červeného tvrdenia. Menovaná plocha to zatvára dopredu.
     */
    '--sel': t('var(--sel)'),
    '--surface-solid': t('var(--surface-solid)'),
  };
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
 * WCAG 1.4.3 vyníma text neaktívneho prvku z hranice 4,5 : 1 výslovne
 * („inactive user interface component"), a je to jediná výnimka v tomto
 * súbore, ktorá sa NEUDRŽIAVA ZOZNAMOM — číta sa zo selektora, takže nový
 * zakázaný stav sa do nej dostane sám a nikto ju nemusí dopĺňať.
 *
 * Prečo nie nula: zakázaná voľba, ktorej popis sa nedá prečítať, nie je
 * zakázaná voľba, ale prázdne miesto — človek nezistí, čo je nedostupné.
 * 2 : 1 je preto podlaha ČITATEĽNOSTI TVARU, nie zoslabenie K7. Dnešné
 * najhoršie hodnoty sú 2,32 : 1 (`.tab:disabled` v svetlej téme) a
 * 2,67 : 1 (tmavá), takže podlaha nie je opísaný súčasný stav.
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

function hranicaPre(p: Pravidlo): number {
  if (IKONY.includes(p.selektor)) return 3;
  if (DEKORACIE.includes(p.selektor)) return 1.2;
  if (jeNeaktivne(p.selektor)) return 2;
  return 4.5;
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

function paryPre(tokeny: Map<string, string>): { pary: Par[]; hodnota: Map<string, number> } {
  const PLOCHY = plochy(tokeny);
  const pary: Par[] = [];
  const hodnota = new Map<string, number>();

  const zmeraj = (kde: string, textV: string, alfa: number, plochaV: string, plochaC: Rgba, hranica: number) => {
    const t = farba(textV, tokeny);
    const textNaPloche = nad([t[0], t[1], t[2], t[3] * alfa], plochaC);
    const r = contrastRgb(NEPRIESVITNA(textNaPloche), NEPRIESVITNA(plochaC));
    const kluc = `${kde} · ${textV} na ${plochaV}`;
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
      const podklad = c[3] < 1 ? nad(c, PLOCHY['--paper2']!) : c;
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
      // Priesvitná plocha: najhorší prípad nad každou plochou stránky.
      for (const [nazov, s] of Object.entries(PLOCHY)) {
        zmeraj(kde, textV, alfa, `${bg} nad ${nazov}`, nad(c, s), hranica);
      }
      continue;
    }
    zmeraj(kde, textV, alfa, bg, c, hranica);
  }

  return { pary, hodnota };
}

const MERANIA = TEMY.map((t) => ({ ...t, ...paryPre(t.tokeny) }));

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
    const chybaju = [...IKONY, ...DEKORACIE, ...ZDEDENA_PLOCHA.map((z) => z.selektor)].filter(
      (s) => !su.has(s),
    );
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
   10. K7 — KAŽDÝ PÁR V OBOCH TÉMACH
   ═════════════════════════════════════════════════════════════════════════ */

describe.each(MERANIA)('$nazov téma — kontrast každého páru text/plocha', ({ pary, hodnota }) => {
  it('žiadny text nemá menej než 4,5 : 1', () => {
    const pod = pary
      .filter((p) => p.hranica === 4.5 && hodnota.get(p.kde)! < 4.5)
      .map((p) => `${p.kde} = ${hodnota.get(p.kde)!.toFixed(2)} : 1`);
    expect(pod, 'text pod hranicou čitateľnosti (WCAG 1.4.3)').toEqual([]);
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

  it('výnimky nie sú väčšina — meria sa hlavne text', () => {
    // Poistka proti „opraveniu" padajúceho páru presunom do IKON.
    const textovych = pary.filter((p) => p.hranica === 4.5).length;
    expect(textovych / pary.length).toBeGreaterThan(0.85);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   11. ČO SA NESMIE STRATIŤ Z DOHĽADU
   ═════════════════════════════════════════════════════════════════════════ */

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
