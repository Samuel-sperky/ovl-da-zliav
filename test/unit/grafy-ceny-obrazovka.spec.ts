/**
 * Aura Zľavy — HISTOGRAM CIEN JE NA OBRAZOVKE A KRESLÍ SA S DÁTAMI (W3).
 *
 * `grafy-ceny.spec.ts` meria, či graf neklame o tvare rozdelenia. Tento súbor
 * meria niečo iné a doteraz nemerané: či ho vôbec NIEKTO KRESLÍ, a či to, čo
 * sa kreslí, je stav S DÁTAMI.
 *
 * Prečo to má vlastný súbor
 * ─────────────────────────
 * Do 20. 8. 2026 bol `PriceHistogram` hotový, otestovaný a MŔTVY — žiadna
 * obrazovka ho nevolala, a `grafy-ceny.spec.ts` bol pritom zelený. Ten test
 * totiž rendruje komponent priamo, takže o zapojení nevie nič. V tomto projekte
 * to nie je prvý raz: oprava rol popiskov už raz siahla na tri selektory, ktoré
 * nikto nekreslil, a testy to nezachytili.
 *
 * Druhá pasca je opačná: test, ktorý rendruje obrazovku staticky, vidí stav
 * PRED načítaním dát („Načítavam…"). Prejde, ale nemeria graf — meria
 * zástupnú vetu. Preto sú tu obe strany oddelene a pomenovane:
 *
 *  A. **Obrazovka graf naozaj volá** a má ho POD ROZKLIKOM (`<details>`), nie
 *     ako piatu sekciu — P5 povoľuje štyri a Produkty ich už majú.
 *  B. **Graf so DÁTAMI** kreslí stĺpce, dátovú tabuľku a priznania.
 *     `data-mode` rozlišuje stav s dátami od prázdneho, aby sa už nikdy
 *     nedalo omylom zmerať to druhé.
 *  C. **Živé selektory.** Každá trieda z `charts.module.css`, ktorú histogram
 *     používa, v tom súbore naozaj existuje. Preklep v názve modulovej triedy
 *     je v CSS moduloch `undefined` — teda tichý neúspech bez chyby.
 *  D. **Farby.** Stĺpec aj šrafovanie idú zo sekvenčnej rampy `--seq-teal-*`;
 *     stavová škála `--st-*` je zakázaná, cenové pásmo nie je stav.
 *
 * Vlastník: V1 (graf), V10 (obrazovka).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PriceHistogram from '@/components/charts/PriceHistogram';
import CatalogPanel from '@/components/products/CatalogPanel';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';
import { PRICE_BIN_COUNT, foldBuckets } from '@/app/api/insights/_prices';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const PANEL = read('../../src/components/products/CatalogPanel.tsx');

/**
 * Vykreslená obrazovka Produkty. Statický render, takže efekty klienta nebežia
 * a je to stav PRED načítaním dát — presne preto sa na nej meria len to, čo do
 * tohto stavu patrí: že rozklik existuje, že je zavretý a že graf sám sa v ňom
 * ešte nekreslí. Stav S DÁTAMI má vlastnú sekciu nižšie.
 */
const SCREEN = renderToStaticMarkup(
  createElement(CatalogPanel, { initialFilter: DEFAULT_CATALOG_FILTER }),
);
const HISTOGRAM = read('../../src/components/charts/PriceHistogram.tsx');
const CHARTS_CSS = read('../../src/components/charts/charts.module.css');

/** Tvar nameraný na živej kópii katalógu: ťažký vrchol nízko, dlhý chvost. */
const BINS = foldBuckets(
  new Map<number, number>([
    [0, 1_240],
    [1, 6_800],
    [2, 9_450],
    [3, 7_100],
    [4, 5_020],
    [5, 3_300],
    [8, 900],
    [12, 260],
    [PRICE_BIN_COUNT, 180],
  ]),
);

/**
 * Render grafu SO DÁTAMI. Presne tie polia, ktoré na obrazovku prídu
 * z `GET /api/insights/catalog-prices` — nie vymyslený minimálny vstup.
 */
const withData = (patch: Partial<Parameters<typeof PriceHistogram>[0]> = {}): string =>
  renderToStaticMarkup(
    createElement(PriceHistogram, {
      bins: BINS,
      selection: [{ productId: 4_211, price: 43 }],
      rows: 41_220,
      withoutPrice: 0,
      maxPrice: 1_758.46,
      oldestFetchedAt: '2026-07-02T10:00:00.000Z',
      newestFetchedAt: '2026-08-18T21:30:00.000Z',
      complete: true,
      ...patch,
    }),
  );

/* ═════════════ A. Obrazovka graf kreslí — a pod rozklikom ═════════════════ */

describe('Produkty graf naozaj kreslia a je pod rozklikom', () => {
  it('CatalogPanel importuje a volá PriceHistogram', () => {
    // Toto je celý dôvod existencie tohto súboru: graf bol hotový a mŕtvy.
    expect(PANEL).toContain("from '@/components/charts/PriceHistogram'");
    expect(PANEL).toContain('<PriceHistogram');
  });

  it('graf stojí pod rozklikom, nie v piatej sekcii', () => {
    /*
     * Meria sa VYKRESLENÉ HTML obrazovky, nie jej zdroj. Regex nad zdrojom by
     * o `<details>` nič nedokázal — `onToggle` obsahuje `=>` a `.open`, takže
     * by sa dal oklamať v oboch smeroch. Toto je skutočný výstup.
     *
     * P5 — sekcie sú štyri (stav katalógu, filtre, tabuľka, lišta výberu).
     * P6 — technika ide pod rozklik.
     */
    const at = SCREEN.indexOf('data-testid="catalog-prices-fold"');
    expect(at, 'rozklik s grafom sa nevykreslil').toBeGreaterThan(-1);

    const tagStart = SCREEN.lastIndexOf('<', at);
    const tag = SCREEN.slice(tagStart, SCREEN.indexOf('>', at) + 1);
    expect(tag.startsWith('<details'), `graf nesie tag ${tag.slice(0, 24)}`).toBe(true);

    // Rozklik NESMIE byť `open` — otvorený natvrdo je to piata sekcia a padne P4.
    expect(tag).not.toMatch(/\bopen\b/);

    // Zavretý rozklik je jeden riadok: text rozkliku, žiadny graf.
    expect(SCREEN).toContain('Rozdelenie cien v katalógu');
  });

  it('zdrojovo je graf VNÚTRI toho rozkliku, nie vedľa neho', () => {
    const at = PANEL.indexOf('data-testid="catalog-prices-fold"');
    const end = PANEL.indexOf('</details>', at);
    expect(at).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(at);
    expect(PANEL.slice(at, end)).toContain('<PriceHistogram');
  });

  it('obrazovka zostáva pri jednom riadku o čerstvosti dát (architektúra §0)', () => {
    // `.fresh` je vyhradená pre „Dáta k …". Graf má na svoje priznania vlastnú
    // triedu — inak by rozklik pridal na obrazovku ďalšie tri „čerstvosti".
    expect(SCREEN.match(/class="fresh"/g)?.length ?? 0).toBe(1);
  });

  it('graf sa žiada až pri otvorení rozkliku, nie pri otvorení obrazovky', () => {
    // Dotaz pri každom nakuknutí na Produkty je záťaž, ktorú si nikto nevyžiadal.
    const from = PANEL.indexOf('data-testid="catalog-prices-fold"');
    const head = PANEL.slice(PANEL.lastIndexOf('<details', from), from);
    expect(head).toContain('onToggle');
  });

  it('kým dáta nie sú, kreslí sa VETA — nie prázdny rám s osou', () => {
    // Prázdne osi tvrdia, že katalóg je prázdny.
    expect(PANEL).toContain('data-testid="catalog-prices-loading"');
    expect(PANEL).toContain('prices === null');
  });
});

/* ═════════════════ B. Stav S DÁTAMI, nie „Načítavam…" ════════════════════ */

describe('graf so dátami kreslí stĺpce, tabuľku a priznania', () => {
  it('je to stav s dátami a pozná sa to bez hádania', () => {
    const html = withData();
    expect(html).toContain('data-mode="data"');
    expect(html).not.toContain('data-mode="empty"');
    expect(html).toContain('data-testid="price-histogram-svg"');
  });

  it('nakreslí stĺpec pre KAŽDÉ pásmo vrátane zberného', () => {
    const html = withData();
    const bars = html.match(/<rect[^>]*class="[^"]*"[^>]*height="/g) ?? [];
    // 21 pásiem v grafe + 2 marky v legende (stĺpec a zberné pásmo).
    expect(bars.length).toBeGreaterThanOrEqual(PRICE_BIN_COUNT + 1);
  });

  it('prázdne pásmo má nulovú výšku, nie chýbajúci stĺpec', () => {
    // Pásmo 6 v BINS nie je — musí byť nula, lebo dotaz prešiel celú tabuľku.
    expect(withData()).toContain('height="0"');
  });

  it('ku grafu patrí dátová tabuľka s tými istými číslami', () => {
    const html = withData();
    expect(html).toContain('Dátová tabuľka grafu');
    expect(html).toContain('200 € a viac');
    expect(html).toContain('41 220');
  });

  it('graf priznáva, že zrkadlo nemusí byť úplné — vo všetkých troch stavoch', () => {
    // `true` / `false` / `undefined` sú tri rôzne vety. „Nie je celé" je meraný
    // fakt, „nevieme" je priznanie a zliať ich znamená tvrdiť viac, než appka vie.
    expect(withData({ complete: true })).toContain('dočítané po koniec');
    expect(withData({ complete: false })).toContain('nie je celé');
    expect(withData({ complete: undefined })).toContain('nepodarilo zistiť');
  });

  it('priznanie o zrkadle je aj v prázdnom stave', () => {
    // Prázdny graf je práve ten stav, v ktorom je neúplné zrkadlo najskorším
    // vysvetlením — zamlčať to tam je horšie než hocikde inde.
    const html = withData({ bins: [], complete: false });
    expect(html).toContain('data-mode="empty"');
    expect(html).toContain('nie je celé');
  });

  it('neznáma najvyššia cena je POMLČKA, nikdy nula', () => {
    expect(withData({ maxPrice: null })).toContain('najvyššia cena —');
    expect(withData({ maxPrice: null })).not.toContain('najvyššia cena 0');
  });

  it('legenda značiek sa nekreslí, keď sa nekreslí ani jedna značka', () => {
    // Popis marky, ktorú v ráme nikto nevidí, je návod na neexistujúcu vec.
    expect(withData({ selection: [] })).not.toContain('ceny vybraných produktov');
    expect(withData()).toContain('ceny vybraných produktov');
  });
});

/* ═════════════════════ C. Selektory sú živé ══════════════════════════════ */

describe('každá modulová trieda grafu naozaj existuje', () => {
  it('trieda z `styles.*` sa v charts.module.css nájde', () => {
    // Preklep v CSS module je `undefined` — teda `class="undefined"` a ticho.
    const used = [...HISTOGRAM.matchAll(/styles\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const name of new Set(used)) {
      expect(CHARTS_CSS, `trieda .${name} v charts.module.css chýba`).toMatch(
        new RegExp(`\\.${name}\\b`),
      );
    }
  });

  it('vykreslený stĺpec má neprázdny názov triedy', () => {
    // `class="undefined"` je presne to tiché zlyhanie, ktoré hľadáme.
    expect(withData()).not.toContain('class="undefined"');
  });
});

/* ═══════════════════════ D. Farby zo sekvenčnej rampy ════════════════════ */

describe('histogram kreslí sekvenčnou rampou a ničím iným', () => {
  const bezKomentarov = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '');

  it('stĺpec aj šrafovanie sú zo `--seq-teal-*`', () => {
    const css = bezKomentarov(CHARTS_CSS);
    expect(css).toMatch(/\.bar\s*\{\s*fill:\s*var\(--seq-teal-5\)/);
    expect(bezKomentarov(HISTOGRAM)).toContain('var(--seq-teal-3)');
  });

  it('ani jedna farba zo stavovej škály `--st-*`', () => {
    // Stavy sú ZMERANÉ hodnoty, nie voľné odtiene pre ďalšiu sériu.
    expect(bezKomentarov(CHARTS_CSS)).not.toMatch(/var\(\s*--st-/);
    expect(bezKomentarov(HISTOGRAM)).not.toMatch(/var\(\s*--st-/);
  });

  it('text nosí textové tokeny, nie farbu série', () => {
    const css = bezKomentarov(CHARTS_CSS);
    expect(css).toMatch(/\.refMark\s*\{\s*stroke:\s*var\(--ink\)/);
    expect(css).toMatch(/\.sourceNote\s*\{[^}]*color:\s*var\(--dim\)/);
  });
});
