/**
 * Aura Zľavy — FARBY GRAFOV SA MERAJÚ (V1, kontrakt UX/dizajn 19. 8. 2026).
 *
 * `paleta.spec.ts` meria stavovú škálu a text. Grafy majú vlastnú sadu otázok,
 * na ktoré tam nikto neodpovedá, a všetky majú spoločné to, že sa NEDAJÚ
 * posúdiť okom:
 *
 *  A. **Marka grafu musí byť vidieť.** Čiara ani stĺpec nie sú text, takže
 *     hranica 4,5:1 na ne neplatí — platí 3:1 pre grafické objekty. Bez
 *     merania nikto nezistí, že to teal na bielej spĺňa a `--line` nie.
 *
 *  B. **Mriežka musí USTÚPIŤ.** Nestačí, že je svetlá; musí byť preukázateľne
 *     slabšia než dáta. Meria sa to porovnaním, nie dojmom.
 *
 *  C. **Trend sa od série NEODLIŠUJE FARBOU a ani nemôže.** `--accent`
 *     a `--dim` majú pod protanopiou odstup ΔE 4,9 — pre časť ľudí je to tá
 *     istá farba. Tento súbor to meria a zároveň vyžaduje, aby existovalo
 *     nefarebné rozlíšenie: prerušovaná čiara. Kto `dasharray` zruší, spraví
 *     z dvoch čiar jednu a NIČ INÉ TO NENAHLÁSI.
 *
 *  D. **Sekvenčná rampa musí byť monotónna vo svetlosti.** Rampa, ktorá sa
 *     v strede zosvetlí, prestane kódovať veľkosť a začne kódovať nič.
 *
 *  E. **Graf nesmie siahnuť na vyhradené farby.** Stavová škála a značkové
 *     farby (teal ako `--brand`, zlatá) nesmú byť „séria 4" ani „iný odtieň
 *     bodu". Do 19. 8. 2026 kreslil dnešok v grafe predaja `--gold2`.
 *
 * Čo tento súbor NEROBÍ: nehovorí, že grafy sú pekné, a nenahrádza pravidlo
 * „identita nie je nikdy len farba" — na to je legenda a dátová tabuľka.
 *
 * Vlastník: V1.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SELF_TEST, contrast, deltaE, simulate } from '../helpers/palette-math';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CSS = read('../../src/app/globals.css');
const CHARTS_CSS = read('../../src/components/charts/charts.module.css');
const SALES_CHART = read('../../src/components/dashboard/SalesChart.tsx');
const HISTOGRAM = read('../../src/components/charts/PriceHistogram.tsx');

/* ═════════════════════ Čítanie skutočných tokenov ═════════════════════════ */

/** Telo CSS bloku, ktorý začína danou hlavičkou a obsahuje daný token. */
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
  throw new Error(`blok sa nenašiel: ${head}`);
}

function raw(body: string, token: string): string {
  const m = body.match(new RegExp(`^[ \\t]*${token}:\\s*([^;]+);`, 'm'));
  if (!m) throw new Error(`token ${token} v bloku chýba`);
  return m[1]!.trim();
}

/** Hodnota tokenu rozvinutá na hex — `var(--deep)` sa musí doriešiť. */
function resolve(body: string, token: string, depth = 0): string {
  if (depth > 8) throw new Error(`cyklus pri ${token}`);
  const value = raw(body, token);
  const m = value.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (m) return resolve(body, m[1]!, depth + 1);
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  const root = block(':root {', '--st-critical');
  if (root !== body) return resolve(root, token, depth + 1);
  throw new Error(`token ${token} nie je hex: ${value}`);
}

const SVETLA = block(':root {', '--st-critical');
const TMAVA = block(":root[data-theme='dark'] {");

const TEMY = [
  { nazov: 'svetlá', body: SVETLA },
  { nazov: 'tmavá', body: TMAVA },
] as const;

/** Ktoré tokeny grafy naozaj kreslia. Zoznam je zámerne krátky. */
const RAMPA = ['--seq-teal-1', '--seq-teal-2', '--seq-teal-3', '--seq-teal-4', '--seq-teal-5'];

/* ────────────────────────────────────────────────────────────────────────── */

describe('kontrola samotnej matematiky', () => {
  // Beží PRVÉ. Keby bola pokazená mierka, všetko ostatné by prešlo omylom.
  for (const t of SELF_TEST) {
    it(t.name, () => {
      const v = t.actual();
      expect(v).toBeGreaterThanOrEqual(t.expect[0]);
      expect(v).toBeLessThanOrEqual(t.expect[1]);
    });
  }
});

describe.each(TEMY)('$nazov téma — marka grafu je vidieť, mriežka ustupuje', ({ body }) => {
  const t = (token: string) => resolve(body, token);

  it('marka série má proti karte aspoň 3:1', () => {
    // Grafický objekt, nie text — hranica je 1.4.11, nie 1.4.3.
    expect(contrast(t('--accent'), t('--paper2'))).toBeGreaterThanOrEqual(3);
  });

  it('popisky a hodnoty majú textových 4,5:1', () => {
    // Číslo pri bode a hlavička tabuľky sú TEXT a nesú textové tokeny.
    expect(contrast(t('--ink'), t('--paper2'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t('--dim'), t('--paper2'))).toBeGreaterThanOrEqual(4.5);
  });

  it('mriežka je preukázateľne slabšia než dáta', () => {
    const mriezka = contrast(t('--line'), t('--paper2'));
    const data = contrast(t('--accent'), t('--paper2'));
    expect(mriezka).toBeLessThan(data);
    // A zároveň nie neviditeľná — os musí byť tušiteľná.
    expect(mriezka).toBeGreaterThanOrEqual(1.1);
  });

  it('šrafovanie diery je slabšie než dáta a silnejšie než mriežka', () => {
    // Nesťahované obdobie sa nesmie čítať ani ako séria, ani ako pozadie.
    const srafa = contrast(t('--line2'), t('--paper2'));
    expect(srafa).toBeGreaterThan(contrast(t('--line'), t('--paper2')));
    expect(srafa).toBeLessThan(contrast(t('--accent'), t('--paper2')));
  });
});

describe.each(TEMY)('$nazov téma — sekvenčná rampa kóduje veľkosť', ({ body }) => {
  const kroky = RAMPA.map((token) => resolve(body, token));

  it('je monotónna vo svetlosti', () => {
    // Rampa, ktorá sa v strede otočí, prestane kódovať veľkosť.
    const kontrasty = kroky.map((hex) => contrast(hex, resolve(body, '--paper2')));
    for (let i = 1; i < kontrasty.length; i += 1) {
      expect(kontrasty[i]!, `krok ${i + 1} nie je tmavší než ${i}`).toBeGreaterThan(
        kontrasty[i - 1]!,
      );
    }
  });

  it('krajné kroky sa nedajú zameniť ani pri farbosleposti', () => {
    const prvy = kroky[0]!;
    const posledny = kroky[kroky.length - 1]!;
    for (const kind of ['normal', 'deuteranopia', 'protanopia', 'tritanopia'] as const) {
      expect(deltaE(simulate(prvy, kind), simulate(posledny, kind))).toBeGreaterThanOrEqual(20);
    }
  });
});

describe.each(TEMY)('$nazov téma — trend sa dá odlíšiť od série', ({ body }) => {
  const t = (token: string) => resolve(body, token);

  it('séria a trend majú naprieč všetkými typmi videnia odstup aspoň ΔE 8', () => {
    // Sú to dve marky v jednom ráme; odstup je podmienka, nie estetika.
    for (const kind of ['normal', 'deuteranopia', 'protanopia', 'tritanopia'] as const) {
      const odstup = deltaE(simulate(t('--accent'), kind), simulate(t('--gold2'), kind));
      expect(odstup, `${kind} akcent ↔ zlatá`).toBeGreaterThanOrEqual(8);
    }
  });

  it('trendová čiara má proti karte aspoň 3:1', () => {
    // Tenká čiara je grafický objekt. Vo svetlej téme je to tesných 3,45:1.
    expect(contrast(t('--gold2'), t('--paper2'))).toBeGreaterThanOrEqual(3);
  });
});

describe('tlmená farba sa na druhú marku použiť nedá — a rozbilo by to len jednu tému', () => {
  /*
   * Poistka proti „upratovaniu". Zlatá trendová čiara vyzerá ako značková
   * ozdoba a láka prepísať ju na neutrál. V TMAVEJ téme by to prešlo
   * (`--accent` ↔ `--dim` má pod protanopiou ΔE 10,3), v SVETLEJ nie
   * (ΔE 4,9) — a taká zmena sa odhalí len na jednom nastavení systému.
   * Presne preto sa tmavá téma neodvodzuje preklopením svetlej.
   */
  it('vo svetlej téme splýva akcent s tlmenou pod protanopiou', () => {
    const odstup = deltaE(
      simulate(resolve(SVETLA, '--accent'), 'protanopia'),
      simulate(resolve(SVETLA, '--dim'), 'protanopia'),
    );
    expect(odstup).toBeLessThan(8);
  });

  it('v tmavej téme by tá istá zámena prešla — preto sa nesmie robiť naslepo', () => {
    const odstup = deltaE(
      simulate(resolve(TMAVA, '--accent'), 'protanopia'),
      simulate(resolve(TMAVA, '--dim'), 'protanopia'),
    );
    expect(odstup).toBeGreaterThanOrEqual(8);
  });
});

describe('trend nesie okrem farby aj vzor a slovo', () => {
  it('trendová čiara má prerušovanie, séria nie', () => {
    const trend = CSS.match(/\.line\.trend\s*\{([^}]*)\}/);
    expect(trend, 'pravidlo .line.trend sa nenašlo').not.toBeNull();
    expect(trend![1]).toContain('stroke-dasharray');

    const seria = CSS.match(/^\.line\s*\{([^}]*)\}/m);
    expect(seria, 'pravidlo .line sa nenašlo').not.toBeNull();
    expect(seria![1]).not.toContain('stroke-dasharray');
  });

  it('legenda pomenúva trend slovom, nie len značkou', () => {
    expect(SALES_CHART).toContain('trend cez uzavreté dni');
  });
});

describe('grafy nesiahajú na vyhradené farby', () => {
  const ZDROJE: ReadonlyArray<[string, string]> = [
    ['charts.module.css', CHARTS_CSS],
    ['SalesChart.tsx', SALES_CHART],
    ['PriceHistogram.tsx', HISTOGRAM],
  ];

  for (const [nazov, zdroj] of ZDROJE) {
    it(`${nazov} nekreslí značkovou zlatou`, () => {
      // Dnešok v grafe predaja bol do 19. 8. 2026 `--gold2`.
      const kod = zdroj.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(kod).not.toMatch(/var\(\s*--gold/);
    });

    it(`${nazov} nekreslí stavovou škálou`, () => {
      // `--st-*` sú zmerané STAVY, nie voľné odtiene pre ďalšiu sériu.
      const kod = zdroj.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(kod).not.toMatch(/var\(\s*--st-/);
    });

    it(`${nazov} nemá ani jednu farbu napísanú ručne`, () => {
      // Hex mimo tokenov by v druhej téme zostal ten istý a nikto by to
      // nezistil — tmavá téma sa neodvodzuje preklopením.
      const kod = zdroj.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
      expect(kod.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    });
  }
});
