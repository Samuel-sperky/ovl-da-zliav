/**
 * Aura Zľavy — ČO IDE DO HLAVNÉHO GRAFU PREHĽADU (D135, D136, K6, V6b).
 *
 * Geometria (`sales-view.ts`) počítala SÚRADNICE, pretože graf bol vlastné
 * inline SVG. Od V6b ho kreslí Recharts v ráme `ChartCard`, a ten súradnice
 * nechce — chce RIADKY. Tento modul je práve ten prevod a je zámerne čistý:
 * žiadny React, žiadny Recharts, žiadne farby. Dá sa preto zmerať to, čo sa
 * inak nedá — TELO DÁT, ktoré do grafu naozaj vstúpi.
 *
 * PREČO TO NIE JE ZBYTOČNÁ VRSTVA
 * ───────────────────────────────
 * Repo má zapísané, ako sa stráca pravda medzi modelom a vstupom: D121 bol
 * v klientskom modeli SPRÁVNY a server mu posielal `unitsSold: 0` namiesto
 * `null`, takže `soldBucketOf(0)` dal tisícom produktov legitímne vedro s 30 %
 * zľavou. Nenašlo to 3756 testov, ale preklik. Plocha Rechartsu je v teste
 * neviditeľná (`ResponsiveContainer` bez rozmerov nenakreslí ani jeden `path`),
 * takže tvrdenie „nesťahovaný deň nie je nula" sa NEDÁ dokázať na SVG. Dá sa
 * dokázať tu, na riadkoch — a `test/unit/prehlad-graf-tri-stavy.spec.ts` to
 * robí na oboch koncoch: na tomto modeli aj na propsoch, ktoré komponent
 * Rechartsu odovzdá.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Nemeraný deň dostane nulu.** `units` je `number | null` a `null` sa
 *     NIKDY nedopĺňa. Nula je meraný fakt o eshope („deň sme stiahli, nepredalo
 *     sa nič"), `null` je fakt o appke („o tom dni nevieme"). Recharts pri
 *     `connectNulls: false` (`GAP_SERIES_PROPS`) na `null` líniu pretne a vznikne
 *     MEDZERA. Kto tu napíše `?? 0`, spraví z výpadku sťahovania prepad predaja.
 *
 *  2. **Nemeraný deň z radu VYPADNE.** To je tichšia verzia tej istej lži: os
 *     by sa stiahla a graf by tvrdil, že medzi 6. a 22. augustom nie je čo
 *     ukázať. Riadky sa preto skladajú cez CELÝ KALENDÁR osi (`windowDayList`),
 *     nie cez dni, ktoré niečo priniesli — presne to isté pravidlo, aké má
 *     `chart-language.ts` pri `chartRows()`.
 *
 *  3. **Os prestane byť kalendár.** `XAxis` dostáva `day` (`2026-08-07`), nie
 *     popis `7. 8.`: popisy sa v okne dlhšom než rok zopakujú a `ReferenceArea`
 *     by si našla nesprávny deň. Popis kreslí `tickFormatter`, teda `axisDay()`.
 *
 *  4. **Pás zľavy prekryje šrafovanie medzery.** Poradie kreslenia je preto
 *     DÁTA, nie poradie značiek v komponente: `underlays` vracia najprv zľavy
 *     a potom medzery, a komponent ich mapuje v tom poradí. Keby to bolo naopak,
 *     nemeraný deň so zľavou by vyzeral zmeraný a nikto by to nezistil inak než
 *     pohľadom (v teste sa plocha nekreslí vôbec).
 *
 *  5. **Trend sa dopočíta cez dni, ktoré nikto nezmeral.** Nedopočíta:
 *     `trend` je NULL všade, kde geometria trendovú čiaru zakázala, a hodnoty
 *     sa berú z JEJ priamky (`trendLine`), nie z druhého výpočtu. Prevod
 *     `y → kusy` je len obrátenie mierky, ktorou tá priamka vznikla.
 *
 * Vlastník: V6b, hlavný graf Prehľadu.
 */
import {
  CHART,
  axisDay,
  windowDayList,
  type ChartGeometry,
  type DiscountBand,
} from '@/components/dashboard/sales-view';
import {
  GAP_WORD,
  chartRows,
  chartScaleMax,
  gapLegendSentence,
  type ChartRow,
} from '@/components/ui/chart-language';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Slová ═════════════════════════════════════ */

/**
 * Legenda a priznania pod grafom. Sú to ZABEHNUTÉ formulácie z inline SVG
 * verzie (V1–V4) a prenášajú sa ZNAK PO ZNAKU: „krajšie áno, tichšie nie"
 * (§4 kontraktu V6). Kto ich prepíše, prepíše zároveň to, čo si človek pri
 * grafe zapamätal.
 */
export const SALES_WORDS = {
  series: 'predané kusy',
  trend: 'trend cez uzavreté dni',
  gap: 'nesťahované dni, predaj nepoznáme',
  band: 'okná zliav podľa našich zápisov',
  today: 'dnešok, deň ešte beží',
  estimate: '≈ neúplný deň, aspoň toľko',
} as const;

/** Poznámka v bubline. Tri stavy hodnoty, tri rôzne vety — nikdy mlčanie. */
export const SALES_TIP_NOTES = {
  unmeasured: 'deň sa nesťahoval',
  estimate: 'neúplný deň, aspoň toľko',
  today: 'deň ešte beží',
} as const;

/* ═══════════════════════════ 2. Riadky ════════════════════════════════════ */

/** Ako sa deň v ploche ZNAČÍ. Tvar, nie odtieň — farba nie je jediný kanál. */
export type SalesPointKind = 'measured' | 'lower_bound' | 'today' | 'unmeasured';

export interface SalesChartPoint {
  /** Kľúč osi — ISO deň. Popis na osi z neho robí `axisDay()`. */
  day: string;
  /** Popis do bubliny a do prepisu: `7. 8.`. */
  label: string;
  /** Kusy za deň. `null` = MEDZERA, nikdy nula. */
  units: number | null;
  kind: SalesPointKind;
  /** Číslo je dolná hranica (nedočítaný deň) — v prepise dostane `≥`. */
  lowerBound: boolean;
  /** Hodnota trendovej priamky v ten deň, alebo `null` (trend sa nekreslí). */
  trend: number | null;
  /**
   * Číslo napísané PRIAMO pri bode, alebo `null`.
   *
   * Povolené je LEN v režime `pair`, kde sú body dva: pri dvoch meraniach sa
   * nekreslí spojnica ani plocha, takže bez čísel by z grafu nebolo čo prečítať.
   * Pri dlhšom rade je popisok pri každom bode hluk, nie informácia — čísla sa
   * čítajú z bubliny alebo z prepisu. Dolná hranica si aj tu nesie `≈`.
   */
  pointLabel: string | null;
}

/** Podklad pod krivkou. Poradie v poli JE poradie kreslenia (bod 4 hlavičky). */
export type SalesUnderlayKind = 'discount' | 'gap';

export interface SalesUnderlay {
  kind: SalesUnderlayKind;
  /** Kľúč pre React aj pre test. */
  key: string;
  /** Hranice pásu v ISO dňoch — tie isté kľúče, aké nesie os. */
  fromDay: string;
  toDay: string;
  days: number;
  /** Slovo do plochy; `null` = pás je na text príliš úzky. */
  label: string | null;
}

/**
 * Hrana okna zľavy. Kreslí sa LEN tam, kde okno naozaj začína alebo končí —
 * orezaná hrana (zľava pokračuje mimo osi) čiaru NEDOSTANE, inak by orezanie
 * vyzeralo ako koniec zľavy. Medzery hrany nemajú vôbec: šrafovanie je plocha,
 * nie interval s koncami.
 */
export interface SalesEdge {
  key: string;
  day: string;
}

export type SalesLegendKind = 'series' | 'trend' | 'gap' | 'band';

export interface SalesLegendItem {
  kind: SalesLegendKind;
  /** Tretí kanál. Marku a farbu dopĺňa komponent z `useChartTheme()`. */
  label: string;
}

export interface SalesChartView {
  /** `pair` = dve merania: body a ich čísla, žiadna spojnica ani plocha. */
  shape: 'pair' | 'line';
  drawLine: boolean;
  drawArea: boolean;
  drawTrend: boolean;
  /** Horná hranica osi y. Základňa je vždy nula (D126). */
  scaleMax: number;
  points: SalesChartPoint[];
  underlays: SalesUnderlay[];
  /** Hrany okien zliav, ktoré sa NAOZAJ kreslia (pozri `SalesEdge`). */
  edges: SalesEdge[];
  legend: SalesLegendItem[];
  /** Priznania pod plochou. Prázdne pole = nie je čo priznať, teda mlčíme. */
  notes: string[];
  /** Prepis pre čítačku — TIE ISTÉ riadky, z ktorých sa kreslí rad. */
  summaryRows: ChartRow[];
  measuredDays: number;
  /** Koľko dní osi je priznanie, nie meranie. */
  unknownDays: number;
}

/**
 * Kedy pás unesie slovo. Prenesené z inline SVG verzie, kde to bola hranica
 * v jednotkách `viewBox` (70 z 830 pre medzeru, 40 pre zľavu) — tu je to podiel
 * osi, aby pravidlo nezáviselo od šírky rámu, ktorý Recharts určuje sám.
 */
const GAP_LABEL_MIN_SHARE = 70 / (CHART.right - CHART.left);
const BAND_LABEL_MIN_SHARE = 40 / (CHART.right - CHART.left);

/** Kusy v mierke, ktorou vznikla `trendLine`. Obrátenie, nie druhý výpočet. */
function unitsAtY(y: number, scaleMax: number): number {
  const height = CHART.baseline - CHART.top;
  return ((CHART.baseline - y) / height) * scaleMax;
}

/**
 * Hodnoty trendovej priamky po dňoch.
 *
 * Priamku uzavrela geometria (`trendLine`) a stojí na uzavretých MERANÝCH
 * dňoch; trend navyše vzniká len nad radom BEZ medzier a BEZ odhadov, takže
 * medzi prvým a posledným bodom nie je ani jeden nemeraný deň a lineárna
 * interpolácia po indexe je tá istá priamka, nie jej odhad.
 *
 * Mimo uzavretého úseku je `null` — dnešok do trendu nevstupuje a Recharts
 * čiaru pri `connectNulls: false` na ňom ukončí.
 */
function trendValues(
  geometry: ChartGeometry,
  days: readonly string[],
): Array<number | null> {
  const line = geometry.trendLine;
  const first = geometry.points[0];
  const last = geometry.points[geometry.points.length - 1];
  if (line === null || first === undefined || last === undefined) {
    return days.map(() => null);
  }
  const fromIndex = days.indexOf(first.day);
  const toIndex = days.indexOf(last.day);
  if (fromIndex < 0 || toIndex <= fromIndex) return days.map(() => null);

  const fromUnits = unitsAtY(line.y1, geometry.scaleMax);
  const toUnits = unitsAtY(line.y2, geometry.scaleMax);
  const step = (toUnits - fromUnits) / (toIndex - fromIndex);
  return days.map((_, index) => {
    if (index < fromIndex || index > toIndex) return null;
    return Number((fromUnits + step * (index - fromIndex)).toFixed(2));
  });
}

/**
 * Dni osi. Pri kalendárnej mierke je to CELÝ kalendár od prvého po posledný
 * deň záznamu (bod 2 hlavičky); pri poradovej mierke — teda keď je v rade
 * nečitateľný deň — sa berie rad, ako prišiel, lebo kalendár sa z neho zložiť
 * nedá a hádať sa nesmie.
 */
function axisDays(geometry: ChartGeometry): string[] {
  if (geometry.axis.byDate) {
    const list = windowDayList(geometry.axis.firstDay, geometry.axis.lastDay);
    if (list.length > 0) return list;
  }
  return geometry.hover.map((point) => point.day);
}

/** Riadky pre Recharts. Jeden na KAŽDÝ deň osi, aj na ten, ktorý nemeriame. */
export function salesChartPoints(geometry: ChartGeometry): SalesChartPoint[] {
  const measured = new Map(geometry.hover.map((point) => [point.day, point]));
  const days = axisDays(geometry);
  const trend = trendValues(geometry, days);

  return days.map((day, index) => {
    const point = measured.get(day);
    /* Výslovné porovnanie s `undefined`: Turbopack v tomto repe už raz
       vyhodnotil skrátený guard ako compile-time falsy. */
    if (point === undefined || point.units === null) {
      return {
        day,
        label: axisDay(day),
        units: null,
        kind: 'unmeasured' as const,
        lowerBound: false,
        trend: trend[index] ?? null,
        pointLabel: null,
      };
    }
    const kind: SalesPointKind = point.isToday
      ? 'today'
      : point.estimate
        ? 'lower_bound'
        : 'measured';
    return {
      day,
      label: axisDay(day),
      units: point.units,
      kind,
      /* Dolná hranica je vlastnosť ČÍSLA, nie značky: nedočítaný dnešok je
         `today` (prázdny bod) a v prepise má aj tak `≥`. */
      lowerBound: point.estimate,
      trend: trend[index] ?? null,
      pointLabel:
        geometry.mode === 'pair'
          ? `${point.estimate ? '≈ ' : ''}${formatCountSk(point.units)}`
          : null,
    };
  });
}

/** Veta do bubliny pod hodnotou. `null` = hodnota je celý meraný deň. */
export function salesPointNote(point: SalesChartPoint): string | null {
  if (point.units === null) return SALES_TIP_NOTES.unmeasured;
  if (point.lowerBound) return SALES_TIP_NOTES.estimate;
  if (point.kind === 'today') return SALES_TIP_NOTES.today;
  return null;
}

/* ═════════════════════════ 3. Celý pohľad ═════════════════════════════════ */

/**
 * Geometria + okná zliav → všetko, čo graf potrebuje.
 *
 * `bands` sú už orezané na os (`discountBands()`), takže ich `fromDay`/`toDay`
 * sú kľúče, ktoré na osi NAOZAJ existujú. Pri poradovej mierke vracia
 * `discountBands()` prázdne pole a pás sa nekreslí — dátum na poradovú os
 * priložiť nemožno.
 */
export function salesChartView(
  geometry: ChartGeometry,
  bands: readonly DiscountBand[] = [],
): SalesChartView {
  const points = salesChartPoints(geometry);
  const shape = geometry.mode;
  const maxUnits = points.reduce((max, point) => Math.max(max, point.units ?? 0), 0);

  const underlays: SalesUnderlay[] = [
    /* NAJPRV zľavy, POTOM medzery — poradie je tvrdenie, pozri bod 4 hlavičky. */
    ...bands.map((band) => ({
      kind: 'discount' as const,
      key: `zlava-${String(band.id)}-${band.fromDay}`,
      fromDay: band.fromDay,
      toDay: band.toDay,
      days: band.days,
      label:
        band.days / Math.max(1, points.length) >= BAND_LABEL_MIN_SHARE
          ? `−${String(band.percent)} %`
          : null,
    })),
    ...geometry.gaps.map((gap) => ({
      kind: 'gap' as const,
      key: `medzera-${gap.fromDay}`,
      fromDay: gap.fromDay,
      toDay: gap.toDay,
      days: gap.days,
      label: gap.days / Math.max(1, points.length) >= GAP_LABEL_MIN_SHARE ? GAP_WORD : null,
    })),
  ];

  /* Hrana len tam, kde okno naozaj začína a končí. `clippedStart` znamená
     „zľava začala pred osou" — taká hrana v ráme neexistuje. */
  const edges: SalesEdge[] = [];
  for (const band of bands) {
    if (!band.clippedStart) edges.push({ key: `hrana-od-${String(band.id)}`, day: band.fromDay });
    if (!band.clippedEnd) edges.push({ key: `hrana-do-${String(band.id)}`, day: band.toDay });
  }

  const hasToday = points.some((point) => point.kind === 'today');
  const hasEstimate = points.some((point) => point.lowerBound);
  const hasGap = points.some((point) => point.units === null);

  const legend: SalesLegendItem[] = [{ kind: 'series', label: SALES_WORDS.series }];
  if (geometry.trendLine !== null) legend.push({ kind: 'trend', label: SALES_WORDS.trend });
  if (hasGap) legend.push({ kind: 'gap', label: SALES_WORDS.gap });
  if (bands.length > 0) legend.push({ kind: 'band', label: SALES_WORDS.band });

  /*
   * Prepis a rad čítajú JEDNU vec. `chartRows()` pritom prejde `chartValue()`,
   * teda tou istou striktnou funkciou, ktorá `undefined`, `NaN` aj `'0'`
   * považuje za priznanie — nie za nulu.
   */
  const summaryRows = chartRows(
    points.map((point) => ({
      label: point.label,
      value: point.units,
      lowerBound: point.lowerBound,
    })),
  );

  /*
   * Priznania. Značka sa pomenúva TVAROM aj slovom, lebo marky legendy v
   * `ChartCard` sú tri (plná, prerušovaná, šrafovaná) a prázdny bod ani
   * prerušovaný prstenec medzi ne nepatria — dvakrát tá istá marka s dvoma
   * slovami by bola horšia než veta.
   */
  const notes: string[] = [];
  if (hasToday) notes.push(`Prázdny bod = ${SALES_WORDS.today}.`);
  if (hasEstimate) notes.push(`Prerušovaný prstenec = ${SALES_WORDS.estimate}.`);
  const gapSentence = gapLegendSentence(summaryRows);
  if (gapSentence !== null) notes.push(gapSentence);

  return {
    shape,
    /* Dve merania nie sú priebeh: čiara medzi dvoma bodmi je sklon, teda trend
       inou rukou, a plocha sa číta ako spojitá veličina v čase. */
    drawLine: shape === 'line',
    drawArea: shape === 'line',
    drawTrend: geometry.trendLine !== null,
    scaleMax: chartScaleMax(maxUnits),
    points,
    underlays,
    edges,
    legend,
    notes,
    summaryRows,
    measuredDays: geometry.measuredDays,
    unknownDays: points.reduce((sum, point) => (point.units === null ? sum + 1 : sum), 0),
  };
}

export default salesChartView;
