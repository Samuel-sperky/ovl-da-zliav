/**
 * Aura Zľavy — HISTOGRAM CIEN NEKLAME O TVARE ROZDELENIA (V1).
 *
 * Rozdelenie cien je jediný dataset tejto appky, ktorý je na graf dosť veľký,
 * a zároveň ten, na ktorom sa dá najľahšie klamať bez toho, aby si to niekto
 * všimol. Merajú sa preto štyri veci:
 *
 *  A. **Základňa je nula.** Useknutá os y je pri stĺpcoch najsilnejšie
 *     skreslenie, aké existuje — pomer výšok prestane zodpovedať pomeru počtov.
 *
 *  B. **Prázdne pásmo je nula, nie medzera.** Dotaz prešiel celú tabuľku,
 *     takže „v tomto pásme nie je nič" je meraný fakt. Je to jediné miesto
 *     v grafoch tejto appky, kde sa nula dopĺňa zámerne — a preto to má
 *     vlastný test, aby sa pravidlo nepreklopilo aj na graf predaja.
 *
 *  C. **Chvost je priznaný.** Ceny idú po vyše 1 700 €, os po 200 €. Posledné
 *     pásmo je zberné a musí sa dať rozoznať; inak graf tvrdí, že drahšie
 *     produkty neexistujú.
 *
 *  D. **Produkt bez ceny nespadne do nuly.** `NULL` cena by v najlacnejšom
 *     pásme vyrobila neexistujúci vrchol.
 *
 * Vlastník: V1.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PriceHistogram from '@/components/charts/PriceHistogram';
import {
  BAR_GAP,
  PRICE_CHART,
  eurWhole,
  niceCount,
  priceHistogramGeometry,
  type PriceBinInput,
} from '@/components/charts/price-bins';
import { PRICE_BIN_COUNT, PRICE_BIN_WIDTH, foldBuckets } from '@/app/api/insights/_prices';

/** Tvar nameraný na živej kópii katalógu: ťažký vrchol nízko, dlhý chvost. */
function realneBins(): PriceBinInput[] {
  const counts = new Map<number, number>([
    [0, 1_240],
    [1, 6_800],
    [2, 9_450],
    [3, 7_100],
    [4, 5_020],
    [5, 3_300],
    [8, 900],
    [12, 260],
    [PRICE_BIN_COUNT, 180],
  ]);
  return foldBuckets(counts);
}

/* ═════════════════ A + B. Základňa, nuly a rozmery pásiem ═════════════════ */

describe('pásma sa skladajú súvisle a prázdne pásmo je nula', () => {
  it('riedka odpoveď databázy sa rozvinie na súvislý rad', () => {
    const bins = foldBuckets(new Map([[2, 9_450]]));
    expect(bins).toHaveLength(PRICE_BIN_COUNT + 1);
    // Pásmo, ktoré v odpovedi nebolo, má nulu — dotaz prešiel celú tabuľku.
    expect(bins[0]).toEqual({ from: 0, to: PRICE_BIN_WIDTH, count: 0 });
    expect(bins[2]).toEqual({ from: 20, to: 30, count: 9_450 });
  });

  it('posledné pásmo je zberné a pozná sa podľa chýbajúcej hornej hranice', () => {
    const bins = foldBuckets(new Map([[PRICE_BIN_COUNT, 180]]));
    const posledne = bins[bins.length - 1]!;
    expect(posledne.to).toBeNull();
    expect(posledne.from).toBe(PRICE_BIN_COUNT * PRICE_BIN_WIDTH);
    expect(posledne.count).toBe(180);
  });

  it('základňa osi je nula, nie najnižší počet', () => {
    const g = priceHistogramGeometry(realneBins(), [])!;
    const prazdne = g.bars.find((bar) => bar.count === 0)!;
    expect(prazdne.height).toBe(0);
    expect(prazdne.y).toBe(PRICE_CHART.baseline);

    // A výšky sú v pomere počtov — to je celý zmysel nulovej základne.
    const velky = g.bars[2]!;
    const maly = g.bars[5]!;
    expect(velky.height / maly.height).toBeCloseTo(velky.count / maly.count, 1);
  });

  it('medzi stĺpcami zostáva medzera podkladu', () => {
    const g = priceHistogramGeometry(realneBins(), [])!;
    const rozostup = g.bars[1]!.x - g.bars[0]!.x;
    expect(rozostup - g.bars[0]!.width).toBeCloseTo(BAR_GAP, 1);
  });

  it('horná hranica osi je okrúhle číslo nad maximom', () => {
    expect(niceCount(9_450)).toBe(10_000);
    expect(niceCount(0)).toBe(1);
    expect(priceHistogramGeometry(realneBins(), [])!.scaleMax).toBe(10_000);
  });

  it('bez jediného produktu sa graf nekreslí', () => {
    // Prázdny rám s osou by tvrdil, že katalóg je prázdny.
    expect(priceHistogramGeometry([], [])).toBeNull();
    expect(priceHistogramGeometry(foldBuckets(new Map()), [])).toBeNull();
  });
});

/* ════════════════════ C. Chvost a pripnuté značky ═════════════════════════ */

describe('chvost sa priznáva, značka mimo osi sa pripne a povie to', () => {
  it('zberné pásmo je označené ako otvorené', () => {
    const g = priceHistogramGeometry(realneBins(), [])!;
    expect(g.bars.filter((bar) => bar.open)).toHaveLength(1);
    expect(g.bars[g.bars.length - 1]!.open).toBe(true);
    expect(g.axisTop).toBe(PRICE_BIN_COUNT * PRICE_BIN_WIDTH);
  });

  it('cena v rozsahu osi sedí na svojom mieste', () => {
    const g = priceHistogramGeometry(realneBins(), [{ productId: 1, price: 100 }])!;
    const znacka = g.marks[0]!;
    expect(znacka.clamped).toBe(false);
    // 100 € je presne polovica osi po 200 €.
    const stred = PRICE_CHART.left + (PRICE_CHART.right - PRICE_CHART.left) / 2;
    expect(znacka.x).toBeCloseTo(stred, 0);
  });

  it('cena za hranicou osi sa pripne na okraj a nesie príznak', () => {
    const g = priceHistogramGeometry(realneBins(), [{ productId: 9, price: 900 }])!;
    const znacka = g.marks[0]!;
    expect(znacka.clamped).toBe(true);
    expect(znacka.x).toBe(PRICE_CHART.right);
    // Skutočná cena zostáva v dátach — graf ju nezabudol, len ju nevie umiestniť.
    expect(znacka.price).toBe(900);
  });

  it('popisky osi sú v celých eurách, nie v centoch', () => {
    // Dvadsať popiskov s centami sa neprečíta a prekrýva sa.
    expect(eurWhole(0)).toBe('0 €');
    expect(eurWhole(200)).toBe('200 €');
    expect(eurWhole(1758)).toBe('1 758 €');
  });
});

/* ═════════════════ D. Čo komponent o svojich dátach povie ═════════════════ */

describe('graf hovorí, čo o cenách nevie', () => {
  const render = (patch: Partial<Parameters<typeof PriceHistogram>[0]> = {}): string =>
    renderToStaticMarkup(
      createElement(PriceHistogram, {
        bins: realneBins(),
        selection: [{ productId: 1, price: 43 }],
        rows: 41_220,
        withoutPrice: 0,
        maxPrice: 1_758,
        oldestFetchedAt: '2026-07-02T10:00:00.000Z',
        newestFetchedAt: '2026-08-18T21:30:00.000Z',
        ...patch,
      }),
    );

  it('priznáva, že ceny sú kópia, a odkedy dokedy', () => {
    const html = render();
    expect(html).toContain('miestnej kópii');
    expect(html).toContain('Ceny stiahnuté od');
  });

  it('priznáva produkty bez ceny, ktoré do pásiem nevstúpili', () => {
    // Nula v najlacnejšom pásme by z nich spravila neexistujúci vrchol.
    expect(render({ withoutPrice: 380 })).toContain('bez ceny');
    expect(render({ withoutPrice: 0 })).not.toContain('bez ceny');
  });

  it('priznáva, kam siaha chvost za zberným pásmom', () => {
    expect(render()).toContain('najvyššia cena');
  });

  it('priznáva pripnuté značky', () => {
    const html = render({ selection: [{ productId: 9, price: 900 }] });
    expect(html).toContain('pripnutých na okraj');
  });

  it('ku grafu patrí dátová tabuľka so všetkými pásmami', () => {
    const html = render();
    expect(html).toContain('Dátová tabuľka grafu');
    expect(html).toContain('200 € a viac');
  });

  it('bez dát je veta, nie prázdny rám s osou', () => {
    const html = render({ bins: [] });
    expect(html).not.toContain('<svg');
    expect(html).toContain('Rozdelenie cien zatiaľ nemáme');
  });
});
