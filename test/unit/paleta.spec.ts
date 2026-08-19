/**
 * Aura Zľavy — PALETA SA MERIA (kontrakt UX/dizajn 19. 8. 2026, vlna F).
 *
 * Tento súbor je jediný dôvod, prečo sa dá o palete tejto appky tvrdiť čokoľvek
 * bez toho, aby si to niekto musel pozrieť. Číta **skutočné tokeny** zo
 * `src/app/globals.css` — nie ich kópiu — a meria ich.
 *
 * TRI TICHÉ ÚMRTIA, KTORÉ TU KONČIA:
 *
 *  A. **Farba, ktorá pre časť ľudí neexistuje.** Stavy „bráni" a „obmedzuje"
 *     boli v tomto projekte už raz pod deuteranopiou ΔE 0,9 od seba — teda tá
 *     istá farba. Tu sa vyžaduje odstup ΔE ≥ 8 naprieč normálnym videním,
 *     deuteranopiou, protanopiou aj tritanopiou.
 *
 *  B. **Rozídené témy.** Tmavá téma je v `globals.css` deklarovaná DVAKRÁT
 *     (`@media (prefers-color-scheme: dark)` a `:root[data-theme='dark']`).
 *     Kto opraví len jednu, dostane appku, ktorá vyzerá inak podľa toho, či si
 *     tmavú vypýtal systém alebo prepínač. Test vyžaduje zhodu do posledného
 *     znaku.
 *
 *  C. **Teal ako stav.** Značkový akcent sa nesmie priblížiť k žiadnemu stavu,
 *     inak „prebieha" a „tlačidlo" splynú. Akcent je preto v meraní ako
 *     rovnocenný účastník, nie ako výnimka.
 *
 * Čo tento test NEROBÍ a robiť nemá: nehovorí, že paleta je pekná, a nenahrádza
 * pravidlo „stav nikdy nie je len farba" (glyf + slovo). Odstup farieb je
 * spodná hranica, nie povolenie farbu použiť samu.
 *
 * Vlastník: vlna F, kontrakt UX/dizajn 19. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CVD_KINDS,
  SELF_TEST,
  contrast,
  hexToRgb,
  simulate,
  tightestPairs,
} from '../helpers/palette-math';

const CSS = readFileSync(
  fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
  'utf8',
);

/**
 * Telo CSS bloku, ktorý začína danou hlavičkou.
 *
 * `musiObsahovat` je nutnosť, nie pohodlie: `:root {` je v `globals.css`
 * DVAKRÁT — raz pre primitívy rodiny (`--aura-teal-*`) a raz pre tokeny
 * svetlej témy. Bez rozlíšenia by test čítal ten prvý, nenašiel v ňom stavy
 * a tváril sa, že paleta neexistuje.
 */
function block(head: string, musiObsahovat?: string): string {
  let from = 0;
  for (;;) {
    const i = CSS.indexOf(head, from);
    if (i < 0) break;
    const open = CSS.indexOf('{', i);
    let depth = 0;
    for (let k = open; k < CSS.length; k++) {
      if (CSS[k] === '{') depth++;
      else if (CSS[k] === '}') {
        depth--;
        if (depth === 0) {
          const body = CSS.slice(open + 1, k);
          if (!musiObsahovat || body.includes(musiObsahovat)) return body;
          from = k;
          break;
        }
      }
    }
    if (from <= i) throw new Error(`neuzavretý blok: ${head}`);
  }
  throw new Error(`blok sa nenašiel: ${head}${musiObsahovat ? ` (s ${musiObsahovat})` : ''}`);
}

/** Surová hodnota tokenu v bloku. */
function raw(body: string, token: string): string {
  const m = body.match(new RegExp(`^[ \\t]*${token}:\\s*([^;]+);`, 'm'));
  if (!m) throw new Error(`token ${token} v bloku chýba`);
  return m[1]!.trim();
}

/**
 * Hodnota tokenu rozvinutá na hex. `--brand: var(--deep)` sa musí doriešiť,
 * inak by test meral reťazec „var(--deep)" a tváril sa spokojne.
 */
function resolve(body: string, token: string, depth = 0): string {
  if (depth > 8) throw new Error(`cyklus pri ${token}`);
  const v = raw(body, token);
  const m = v.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (m) return resolve(body, m[1]!, depth + 1);
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  // Tokeny svetlej vrstvy (napr. --deep) žijú v koreňovom `:root`.
  const root = block(':root {', '--st-critical');
  if (root !== body) {
    try {
      return resolve(root, token, depth + 1);
    } catch {
      /* spadne nižšie */
    }
  }
  throw new Error(`token ${token} nie je hex ani var(): ${v}`);
}

const SVETLA = block(':root {', '--st-critical');
const TMAVA_SYSTEM = block(":root:not([data-theme='light']) {");
const TMAVA_RUCNE = block(":root[data-theme='dark'] {");

/** Tokeny, ktoré musia byť v oboch tmavých deklaráciách zhodné. */
const TEMOVE_TOKENY = [
  '--paper', '--paper2', '--paper3', '--ink', '--ink2', '--dim',
  '--line', '--line2', '--track', '--sel', '--selbar-bg', '--selbar-fg',
  '--surface', '--surface-raised',
  '--st-critical', '--st-attention', '--st-progress', '--st-good', '--st-idle',
  '--production-bg', '--production-fg',
] as const;

function stavy(body: string): Record<string, string> {
  return {
    brani: resolve(body, '--st-critical'),
    obmedzuje: resolve(body, '--st-attention'),
    prebieha: resolve(body, '--st-progress'),
    vporiadku: resolve(body, '--st-good'),
    necinny: resolve(body, '--st-idle'),
    akcent: resolve(body, '--accent'),
  };
}

const TEMY = [
  { nazov: 'svetlá', body: SVETLA },
  { nazov: 'tmavá', body: TMAVA_RUCNE },
] as const;

/* ────────────────────────────────────────────────────────────────────── */

describe('meranie farieb — kontrola samotnej matematiky', () => {
  // Beží PRVÉ. Keby bola pokazená mierka, všetko ostatné by prešlo omylom.
  for (const t of SELF_TEST) {
    it(t.name, () => {
      const v = t.actual();
      expect(v).toBeGreaterThanOrEqual(t.expect[0]);
      expect(v).toBeLessThanOrEqual(t.expect[1]);
    });
  }
});

describe('tmavá téma je deklarovaná dvakrát a musí sedieť', () => {
  for (const token of TEMOVE_TOKENY) {
    it(`${token} je v oboch tmavých deklaráciách rovnaký`, () => {
      expect(raw(TMAVA_SYSTEM, token)).toBe(raw(TMAVA_RUCNE, token));
    });
  }
});

describe.each(TEMY)('$nazov téma — kontrast textu', ({ body }) => {
  const t = (token: string) => resolve(body, token);

  const PARY: readonly [string, string, string, number][] = [
    ['text na ploche', '--ink', '--paper', 4.5],
    ['text na karte', '--ink', '--paper2', 4.5],
    ['sekundárny text', '--ink2', '--paper2', 4.5],
    ['tlmený text na karte', '--dim', '--paper2', 4.5],
    ['tlmený text na ploche', '--dim', '--paper', 4.5],
    ['tlmený text na pruhu', '--dim', '--paper3', 4.5],
    ['akcent na karte', '--accent', '--paper2', 4.5],
    ['akcent na ploche', '--accent', '--paper', 4.5],
    ['stav bráni', '--st-critical', '--paper2', 4.5],
    ['stav obmedzuje', '--st-attention', '--paper2', 4.5],
    ['stav prebieha', '--st-progress', '--paper2', 4.5],
    ['stav v poriadku', '--st-good', '--paper2', 4.5],
    ['stav nečinný', '--st-idle', '--paper2', 4.5],
    ['pruh PRODUKCIA', '--production-fg', '--production-bg', 4.5],
  ];

  for (const [nazov, fg, bg, min] of PARY) {
    it(`${nazov} má aspoň ${min}:1`, () => {
      expect(contrast(t(fg), t(bg))).toBeGreaterThanOrEqual(min);
    });
  }

  // Linky sú tenké plochy, nie text — platí pre ne hranica viditeľnosti,
  // nie čitateľnosti.
  it('linka je na ploche viditeľná', () => {
    expect(contrast(t('--line'), t('--paper'))).toBeGreaterThanOrEqual(1.2);
  });
});

describe.each(TEMY)('$nazov téma — stavy sú rozlíšiteľné aj pri farbosleposti', ({ body }) => {
  const farby = stavy(body);

  it('žiadna dvojica stavov nie je bližšie než ΔE 8', () => {
    const tesne = tightestPairs(farby).filter((p) => p.deltaE < 8);
    expect(
      tesne.map((p) => `${p.kind} ${p.pair} ΔE ${p.deltaE}`),
      'dvojice, ktoré časť používateľov nerozlíši',
    ).toEqual([]);
  });

  it('meria sa naozaj všetkých šesť stavov cez štyri typy videnia', () => {
    // Poistka proti tomu, aby test prešiel preto, že nemeral nič.
    expect(Object.keys(farby)).toHaveLength(6);
    expect(tightestPairs(farby)).toHaveLength(15 * CVD_KINDS.length);
  });

  it('teal nikdy nesplýva so stavom v poriadku', () => {
    // Najčastejšia zámena v tejto appke: „hotovo" vs „tlačidlo".
    const najtesnejsie = tightestPairs({ vporiadku: farby.vporiadku!, akcent: farby.akcent! })[0]!;
    expect(najtesnejsie.deltaE).toBeGreaterThanOrEqual(8);
  });
});

describe('základňa je neutrálna (R5)', () => {
  // Predtým bola tónovaná doružova a jediný akcent na nej pôsobil špinavo.
  // Neutrál = kanály sa od svojho priemeru nelíšia o viac než 6/255.
  for (const { nazov, body } of TEMY) {
    for (const token of ['--paper', '--paper2', '--paper3', '--line', '--line2'] as const) {
      it(`${nazov} ${token} nemá farebný nádych`, () => {
        const [r, g, b] = hexToRgb(resolve(body, token));
        const priemer = (r + g + b) / 3;
        const odchylka = Math.max(...[r, g, b].map((c) => Math.abs(c - priemer)));
        expect(odchylka).toBeLessThanOrEqual(6);
      });
    }
  }
});

/*
 * ════════════════════════════════════════════════════════════════════════
 * Kto kóduje stav, musí byť zmeraný (pridané 19. 8. 2026 po review).
 *
 * Tento súbor pôvodne meral len --st-* a --accent. Stav zľavy „beží" pritom
 * kreslila zlatá --gold2 (#a8853c), ktorá má na bielej 3,45:1, teda pod
 * hranicou 4,5:1 pre text — a keďže v zozname meraných tokenov nebola,
 * test o nej mlčal a tvrdenie „všetko je zmerané" bolo nepravdivé.
 *
 * Meranie sa preto viac neriadi zoznamom, ktorý niekto napísal ručne, ale
 * tým, čo v CSS naozaj kóduje stav: každé pravidlo .state.* a .sig.*.
 * ════════════════════════════════════════════════════════════════════════
 */
describe('farba, ktorá kóduje stav, ide výhradne zo stavovej škály', () => {
  /** Pravidlá, ktorých selektor je stavový. */
  function stavovePravidla(): { selektor: string; farba: string }[] {
    const out: { selektor: string; farba: string }[] = [];
    const re = /^(\.(?:state|sig)\.[a-z0-9-]+)\s*\{([^}]*)\}/gim;
    for (const m of CSS.matchAll(re)) {
      const telo = m[2]!;
      const farba = telo.match(/(?:^|\s)color:\s*([^;]+);/);
      if (farba) out.push({ selektor: m[1]!.trim(), farba: farba[1]!.trim() });
    }
    return out;
  }

  /*
   * Povolene su stavova skala a NEUTRALY. Neutral (--dim) je v poriadku:
   * je zmerany v kontrastnych testoch vyssie a nikto si ho nepomyli so
   * signalom — .state.skoncila a .sig.lock su prave take pripady, kde appka
   * zamerne nesignalizuje nic. Zakazane su ZNACKOVE farby, lebo tie signal
   * predstieraju: presne tak sa sem dostala zlata pre stav "bezi".
   */
  const POVOLENE = [
    '--dim',
    '--st-critical',
    '--st-attention',
    '--st-progress',
    '--st-good',
    '--st-idle',
  ];

  it('nájde sa vôbec nejaké stavové pravidlo', () => {
    // Poistka proti tomu, aby test prešiel preto, že nič nenašiel.
    expect(stavovePravidla().length).toBeGreaterThan(4);
  });

  it('žiadny stav nekreslí značková farba (teal ani zlatá)', () => {
    const hriesnici = stavovePravidla().filter(
      (p) =>
        p.farba.includes('--accent') ||
        p.farba.includes('--gold') ||
        p.farba.includes('--teal') ||
        p.farba.includes('--brand'),
    );
    expect(
      hriesnici.map((p) => `${p.selektor} → ${p.farba}`),
      'značková farba nesmie kódovať stav (hlavička globals.css)',
    ).toEqual([]);
  });

  it('každý stav berie farbu zo škály, ktorá je zmeraná', () => {
    const mimo = stavovePravidla().filter(
      (p) => !POVOLENE.some((t) => p.farba.includes(t)),
    );
    expect(
      mimo.map((p) => `${p.selektor} → ${p.farba}`),
      'farba mimo --st-* nie je v žiadnom meraní, takže o nej nikto nevie',
    ).toEqual([]);
  });

  it('stav „prebieha" sa dá nakresliť — nesplýva s „nečinný"', () => {
    // Do 19. 8. mapoval blockers-view.ts progress na sig idle, lebo .sig
    // variantu progress nemal. Piaty stav tým prestal existovať.
    expect(CSS).toContain('.sig.progress');
  });
});

describe('simulácia farbosleposti nie je identita', () => {
  it('deuteranopia mení červenú', () => {
    // Keby `simulate()` vracala vstup, všetky CVD kontroly vyššie by boli
    // len trikrát zopakované normálne videnie.
    expect(simulate('#ff0000', 'deuteranopia')).not.toEqual(hexToRgb('#ff0000'));
  });
});
