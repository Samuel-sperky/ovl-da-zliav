/**
 * Aura Zľavy — GEOMETRIA HISTOGRAMU CIEN (V1).
 *
 * Čisté funkcie: pásma a čísla dnu, súradnice a popisky von. Žiadny React,
 * žiadny fetch — histogram sa dá overiť bez prehliadača.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Zberné pásmo prestane byť rozoznateľné.** Posledný stĺpec nie je
 *     „190 až 200 €", ale „200 € a viac" — zhrnutý chvost, ktorý siaha rádovo
 *     desaťnásobne ďalej. Nesie preto `open: true` a kreslí sa šrafovaním.
 *     Kto ho vykreslí ako obyčajný stĺpec, urobí z rozdelenia lož: vyzeralo by
 *     to, že drahšie produkty neexistujú.
 *
 *  2. **Značka výberu sa mlčky presunie.** Cena nad hranicou osi sa PRIPNE na
 *     pravý okraj (`clamped: true`), lebo mimo rámu by nebola vidieť. Pripnutá
 *     značka nesmie vyzerať ako nepripnutá — volajúci to musí povedať a presnú
 *     cenu ukázať v dátovej tabuľke, inak graf tvrdí, že produkt za 900 €
 *     stojí 200 €.
 *
 *  3. **Os y sa začne inde než na nule.** Pri stĺpcovom grafe je useknutá os
 *     najsilnejšie skreslenie, aké sa dá urobiť — pomer výšok prestane
 *     zodpovedať pomeru počtov. Základňa je preto vždy nula a `scaleMax`
 *     rastie od nej.
 *
 * Vlastník: V1.
 */

/** Súradnicová sústava histogramu. Vyššia než graf predaja — má popisky osi. */
export const PRICE_CHART = {
  width: 880,
  height: 180,
  left: 34,
  right: 872,
  baseline: 146,
  top: 10,
} as const;

/** Medzera medzi stĺpcami v jednotkách `viewBox` — kreslí ju podklad. */
export const BAR_GAP = 2;

export interface PriceBinInput {
  from: number;
  /** `null` = zberné pásmo „a viac". */
  to: number | null;
  count: number;
}

export interface PriceBar extends PriceBinInput {
  /** Zberné pásmo. Kreslí sa šrafovaním, nie plnou výplňou. */
  open: boolean;
  x: number;
  width: number;
  y: number;
  height: number;
}

export interface PriceRefMark {
  productId: number;
  price: number;
  x: number;
  /** Cena presiahla os a značka je pripnutá na okraj. */
  clamped: boolean;
}

export interface PriceHistogramGeometry {
  bars: PriceBar[];
  scaleMax: number;
  gridLines: Array<{ y: number; value: number }>;
  /** Popisky osi x — len tie, ktoré sa zmestia bez prekrytia. */
  xLabels: Array<{ x: number; value: number }>;
  marks: PriceRefMark[];
  /** Horná hranica poslednej obyčajnej hranice — začiatok zberného pásma. */
  axisTop: number;
}

/** Najbližšie okrúhle číslo nad `value` (1, 2, 5 × mocnina desiatich). */
export function niceCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

const round1 = (value: number): number => Number(value.toFixed(1));

/**
 * Cena na os a do popisku pásma — CELÉ eurá.
 *
 * `formatEur()` píše centy, čo je správne pri cene jedného produktu, ale na osi
 * s dvadsiatimi popiskami („0,00 €", „10,00 €", …) sú centy hluk a popisky sa
 * kvôli šírke prekrývajú. Hranice pásiem sú aj tak celé desiatky.
 */
export function eurWhole(value: number): string {
  const rounded = Math.round(value).toString();
  return `${rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
}

/**
 * Pásma a ceny výberu → súradnice.
 * `null`, keď niet čo kresliť — volajúci vtedy vypíše prázdny stav.
 */
export function priceHistogramGeometry(
  bins: readonly PriceBinInput[],
  selection: ReadonlyArray<{ productId: number; price: number }>,
): PriceHistogramGeometry | null {
  if (bins.length === 0) return null;

  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  if (total <= 0) return null;

  const span = PRICE_CHART.right - PRICE_CHART.left;
  const height = PRICE_CHART.baseline - PRICE_CHART.top;
  const slot = span / bins.length;
  const scaleMax = niceCount(Math.max(...bins.map((bin) => bin.count)));

  const bars: PriceBar[] = bins.map((bin, index) => {
    const barHeight = round1((bin.count / scaleMax) * height);
    return {
      ...bin,
      open: bin.to === null,
      x: round1(PRICE_CHART.left + index * slot),
      width: round1(Math.max(1, slot - BAR_GAP)),
      y: round1(PRICE_CHART.baseline - barHeight),
      height: barHeight,
    };
  });

  const last = bins[bins.length - 1] as PriceBinInput;
  const axisTop = last.to === null ? last.from : last.to;

  /* Cena → x. Nad hranicou osi sa značka pripne na okraj a povie to. */
  const marks: PriceRefMark[] = selection.map((item) => {
    const clamped = item.price > axisTop;
    const ratio = clamped ? 1 : axisTop <= 0 ? 0 : item.price / axisTop;
    return {
      productId: item.productId,
      price: item.price,
      x: round1(PRICE_CHART.left + ratio * span),
      clamped,
    };
  });

  const gridLines = [0, scaleMax / 2, scaleMax].map((value) => ({
    y: round1(PRICE_CHART.baseline - (value / scaleMax) * height),
    value: Math.round(value),
  }));

  // Najviac šesť popiskov osi cien — hustejšie sa pri 21 pásmach prekrývajú.
  const wanted = Math.min(6, bins.length);
  const step = Math.max(1, Math.round(bins.length / wanted));
  const xLabels: Array<{ x: number; value: number }> = [];
  for (let index = 0; index < bins.length; index += step) {
    const bin = bins[index] as PriceBinInput;
    const bar = bars[index] as PriceBar;
    xLabels.push({ x: bar.x, value: bin.from });
  }

  return { bars, scaleMax, gridLines, xLabels, marks, axisTop };
}
