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
 *     je v CSS moduloch `undefined` — teda tichý neúspech bez chyby. Druhý
 *     smer (deklarovaná trieda, ktorú už nikto nečíta) meria pre celý modul
 *     `grafy-selektory.spec.ts`.
 *  D. **Farby.** Stĺpec ide zo sekvenčnej rampy `--seq-teal-*`; stavová škála
 *     `--st-*` je zakázaná, cenové pásmo nie je stav. Šrafovanie tu NIE JE —
 *     pozri sekciu D nižšie, je to oprava z 2. 9. 2026.
 *  E. **Jednotný rám (K5, V6b).** Histogram stojí v `ChartCard`, nie vo
 *     vlastnej karte: má prepis pre čítačku, plochu `aria-hidden`, legendu
 *     z rámu a prázdny stav z rodiny stavov. Meria sa to na VYKRESLENOM
 *     výstupe aj na zdroji, lebo jedno bez druhého sa dá obísť.
 *
 * Vlastník: V1 (graf), V10 (obrazovka), V6b (prevod na jednotný jazyk).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PriceHistogram from '@/components/charts/PriceHistogram';
import chartStyles from '@/components/charts/charts.module.css';
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
    /*
     * Počíta sa PRESNE a podľa triedy stĺpca, nie „aspoň toľko a toľko".
     * Pôvodné tvrdenie hľadalo hociktorý `<rect class=… height=…>` a povolilo
     * ich viac, takže sa dalo uspokojiť markami legendy — po prevode na
     * `ChartCard` legenda marky naozaj kreslí a súčet vyšiel náhodou. Presný
     * počet nájde aj pásmo, ktoré vypadlo.
     */
    const html = withData();
    const bars = html.split(`class="${chartStyles.bar}`).length - 1;
    // Presne toľko stĺpcov, koľko je pásiem: 20 obyčajných + 1 zberné.
    expect(BINS.length).toBe(PRICE_BIN_COUNT + 1);
    expect(bars).toBe(BINS.length);
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

  it('stĺpec je zo `--seq-teal-*` a zberné pásmo má TÚ ISTÚ výplň', () => {
    /*
     * PRESMEROVANÉ 2. 9. 2026 (K5, V6b) — a je to oprava nepravdy, nie úprava.
     *
     * Tvrdenie tu bolo `HISTOGRAM.toContain('var(--seq-teal-3)')`, teda že
     * šrafovanie zberného pásma má vlastný krok rampy. Ten atribút bol MŔTVY:
     * `<pattern>` mal `className={styles.gapHatch}` aj
     * `stroke="var(--seq-teal-3)"`, a CSS prebíja prezentačný atribút — takže
     * sa kreslilo `--line2`, teda značka „TOTO SME NEMERALI" (I11) nad 180
     * poctivo zmeranými produktmi. Test bol zelený a meral text, ktorý na
     * obrazovku nemal vplyv.
     *
     * Zberné pásmo je teraz výplň radu s prerušovanou hranou (`.barOpen`) —
     * dolná hranica, nie nevedomosť. Meria sa preto to, čo sa naozaj kreslí:
     * jedna výplň z rampy pre celý rad a rozdiel v HRANE.
     */
    const css = bezKomentarov(CHARTS_CSS);
    expect(css).toMatch(/\.bar\s*\{\s*fill:\s*var\(--seq-teal-5\)/);
    expect(css).toMatch(/\.barOpen\s*\{[^}]*stroke-dasharray/);
    expect(css).toMatch(/\.barOpen\s*\{[^}]*stroke:\s*var\(--paper2\)/);
    // Zberné pásmo si vlastnú výplň NEBERIE — chvost je ten istý rad.
    expect(bezKomentarov(HISTOGRAM)).not.toMatch(/--seq-teal-[1-4]/);
  });

  it('histogram nekreslí šrafovanie — tá značka znamená „nemerali sme"', () => {
    /*
     * Šrafovanie je v tejto appke JEDNA značka s JEDNÝM významom (jazyk
     * grafov, sekcia 3). Histogram nemá čo priznávať šrafovaním: počet
     * v pásme je vždy meraný a produkty bez ceny do pásiem nevstupujú vôbec
     * (graf ich priznáva vetou). Kto sem šrafovanie vráti, povie o meraní, že
     * meranie nie je.
     */
    const src = bezKomentarov(HISTOGRAM);
    expect(src).not.toContain('gapHatch');
    expect(src).not.toContain('ChartHatchPattern');
    expect(src).not.toContain('<pattern');
    expect(withData()).not.toContain('url(#');
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

/* ═══════ E. Jednotný rám: `ChartCard`, nie vlastná karta (K5, V6b) ═══════ */

describe('histogram stojí v jednotnom ráme grafov', () => {
  it('rám kreslí `ChartCard`, nie vlastná karta ani vlastný prázdny stav', () => {
    /*
     * Do 2. 9. 2026 mal histogram vlastný rám `.chart`, vlastný popisok `.ct`,
     * vlastný blok `.empty` a vlastnú legendu — teda štyri veci, ktoré rodina
     * grafov už má. Dvojník je dlh (D142): dve karty s tým istým vzhľadom sa
     * o mesiac rozídu a nikde to nespadne.
     */
    const src = HISTOGRAM;
    expect(src).toContain("from '@/components/charts/ChartCard'");
    expect(src).toContain('<ChartCard');
    expect(src).toContain('useChartTheme');
    // Staré globálne triedy rámu sú preč — nie „zatiaľ nepoužité", ale preč.
    expect(src).not.toContain('className="chart"');
    expect(src).not.toContain('"ct"');
    expect(src).not.toContain('"empty"');
    expect(src).not.toContain('"fresh"');
  });

  it('plocha je pre čítačku TICHÁ a čísla nesie prepis', () => {
    /*
     * Recharts aj inline SVG sú pre čítačku obrazovky hluk. Jediný prístupný
     * zdroj čísel je preto prepis — a aby si ho človek prečítal, musí byť
     * plocha `aria-hidden`. Kto prepis vynechá, spraví graf neprístupným
     * a nič to nenahlási.
     */
    const html = withData();
    expect(html).toContain('data-testid="price-histogram-plot"');
    expect(html).toContain('data-testid="price-histogram-summary"');
    // Prepis nesie hlavičky stĺpcov, teda naozaj tabuľku, nie vetu.
    expect(html).toContain('Cenové pásmo');
    expect(html).toContain('Počet produktov v cenovom pásme');

    const plotAt = html.indexOf('data-testid="price-histogram-plot"');
    const tagStart = html.lastIndexOf('<', plotAt);
    const tag = html.slice(tagStart, html.indexOf('>', plotAt) + 1);
    expect(tag).toContain('aria-hidden="true"');

    // Plocha už NIE JE obrázok s popisom: popis nesie prepis pod ňou.
    const svgAt = html.indexOf('data-testid="price-histogram-svg"');
    const svgTag = html.slice(html.lastIndexOf('<', svgAt), html.indexOf('>', svgAt) + 1);
    expect(svgTag).not.toContain('role="img"');
    expect(svgTag).not.toContain('aria-label');
  });

  it('prepis pre oko a prepis pre čítačku majú TIE ISTÉ čísla', () => {
    /*
     * Najhoršia možnosť zo všetkých: dve čísla o produkčnom eshope, každé iné,
     * obe dôveryhodné. Oba prepisy preto berú jeden a ten istý `ChartRow[]`.
     * Meria sa to na VYKRESLENOM výstupe: každé pásmo aj jeho počet musia byť
     * v HTML aspoň dvakrát (raz v `srSummary`, raz v `ChartTable`).
     */
    const html = withData();
    const pocty = (needle: string) => html.split(needle).length - 1;
    expect(pocty('200 € a viac')).toBeGreaterThanOrEqual(2);
    expect(pocty('>9 450<')).toBeGreaterThanOrEqual(2);
    expect(pocty('>180<')).toBeGreaterThanOrEqual(2);
  });

  it('legendu kreslí rám a zberné pásmo v nej má SLOVO, nie iba tvar', () => {
    // Tri kanály: hrana (tvar), farba radu a slovo. Marka bez slova je obrázok.
    const html = withData();
    expect(html).toContain('data-testid="price-histogram-legend"');
    expect(html).toContain('zberné pásmo');
    expect(html).toContain('dolná hranica');
    expect(html).toContain('počet produktov v pásme');
  });

  it('prázdny stav je z rodiny stavov a priznanie o zrkadle v ňom zostáva', () => {
    const html = withData({ bins: [], complete: false });
    expect(html).toContain('data-mode="empty"');
    expect(html).toContain('data-testid="price-histogram-empty"');
    expect(html).toContain('Rozdelenie cien zatiaľ nemáme');
    expect(html).toContain('data-testid="price-histogram-mirror"');
    // Prepisovať nie je čo, takže prepis sa nekreslí — ani prázdna tabuľka.
    expect(html).not.toContain('data-testid="price-histogram-summary"');
    expect(html).not.toContain('<table');
  });

  it('výška plochy je `auto`, lebo plochu kreslí inline SVG s `viewBox`', () => {
    /*
     * `--chart-h` má 220 – 380 px, plocha je 880 × 180 jednotiek `viewBox`,
     * teda plochá. Pevná výška by graf zarámovala do prázdna. Pre Recharts by
     * `auto` naopak znamenalo nulovú výšku a zmiznutý graf — že to histogram
     * nepomieša, stráži `grafy-chartcard.spec.ts`.
     */
    expect(HISTOGRAM).toContain('size="auto"');
    expect(HISTOGRAM).not.toContain("from 'recharts'");
  });
});
