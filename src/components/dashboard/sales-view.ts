/**
 * Aura Zľavy — čisté počítanie sekcie „Tržby" v Prehľade (V9).
 *
 * Žiadny React, žiadny fetch, žiadny `process.env` — len čísla dnu a čísla von,
 * aby sa dali otestovať bez prehliadača aj bez databázy.
 *
 * ── Čo appka o predaji naozaj vie ─────────────────────────────────────────────
 *
 * Vlastné tabuľky súčtov nesú **kusy predané na produkt a deň**. Zaplatená suma
 * patrí objednávke, nie položke, takže appka NEVIE povedať tržbu v eurách ZA
 * PRODUKT a nesmie ju dopočítať z ceny — cena v čase objednávky mohla byť iná,
 * doprava a zľavové kupóny do nej nepatria. Sekcia preto pracuje s kusmi a
 * hovorí to nahlas. Vymyslené euro na prístrojovej doske je horšie než priznaná
 * medzera.
 *
 * Od 28. 8. 2026 (D117) k tomu pribudlo jedno jediné euro, ktoré appka mať
 * SMIE: denný súčet `total_paid` za CELÝ ESHOP. Počíta ho §5 tohto modulu a je
 * zámerne oddelené od kusov — dôvod je tam napísaný.
 *
 * ── Čo je meraný fakt a čo odhad (P7) ─────────────────────────────────────────
 *
 * Uzavretý deň je fakt. Dnešok je fakt „zatiaľ" — nie odhad, ale ani celý deň,
 * preto nikdy nevstupuje do priemeru ani do trendu. Trend je porovnanie dvoch
 * polovíc pokrytého okna, teda opäť len merané čísla vedľa seba; appka z neho
 * NEROBÍ záver o príčine (P8).
 *
 * Vlastník: V9.
 */
import type { SalesDay, SalesSnapshot } from '@/components/dashboard/api';
import { NEVIEME } from '@/lib/ui/product-label';

/* ═════════════════════════════ 1. Tri čísla ═══════════════════════════════ */

export interface SalesNumbers {
  /** Kusy za dnešok. `null` = denný priebeh nemáme, tak sa netvrdí nič. */
  today: number | null;
  /** Priemer na uzavretý deň. `null`, keď nie je z čoho počítať. */
  perDay: number | null;
  /** Zmena novšej polovice okna oproti staršej, v percentách. */
  trendPercent: number | null;
  /** Koľko uzavretých dní priemer a trend pokrývajú. */
  closedDays: number;
  /** Kusy za celé pokryté obdobie. */
  windowUnits: number;
}

/** Uzavreté dni = všetko okrem dneška; dnešok je rozrobený, nie krátky deň. */
export function closedDays(days: readonly SalesDay[], today: string): SalesDay[] {
  return days.filter((day) => day.day < today);
}

function sum(days: readonly SalesDay[]): number {
  let total = 0;
  for (const day of days) total += day.units;
  return total;
}

/**
 * Zmena medzi staršou a novšou polovicou, zaokrúhlená na celé percentá.
 * `null`, keď sa okno nedá rozdeliť alebo keď je staršia polovica nulová —
 * delenie nulou by vyrobilo „+∞ %", čo nie je informácia, ale hluk.
 */
export function trendPercent(previous: number | null, recent: number | null): number | null {
  if (previous === null || recent === null) return null;
  if (previous <= 0) return null;
  return Math.round(((recent - previous) / previous) * 100);
}

export function salesNumbers(snapshot: SalesSnapshot): SalesNumbers {
  const closed = closedDays(snapshot.days, snapshot.today);
  const hasSeries = snapshot.days.length > 0;

  const todayRow = snapshot.days.find((day) => day.day === snapshot.today);

  // Priemer sa počíta z denného priebehu, keď ho máme; inak zo súčtu metrík
  // produktov (`unitsPerDay`), ktorý pokrýva rovnaké obdobie.
  let perDay: number | null = null;
  if (closed.length > 0) perDay = Math.round(sum(closed) / closed.length);
  else if (snapshot.unitsPerDay !== null) perDay = Math.round(snapshot.unitsPerDay);

  let trend = trendPercent(snapshot.previousUnits, snapshot.recentUnits);
  if (trend === null && closed.length >= 4) {
    const half = Math.floor(closed.length / 2);
    trend = trendPercent(sum(closed.slice(0, half)), sum(closed.slice(half)));
  }

  return {
    today: todayRow === undefined ? null : todayRow.units,
    perDay,
    trendPercent: trend,
    closedDays: closed.length,
    windowUnits: hasSeries ? sum(snapshot.days) : snapshot.windowUnits,
  };
}

/* ══════════════════════════ 2. Geometria grafu ════════════════════════════ */

/*
 * ČO SA V TEJTO SEKCII SMIE TICHO POKAZIŤ — a aké tvrdenie tým graf začne robiť
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. **Os x podľa poradia namiesto podľa dátumu.** Do 19. 8. 2026 sa bod
 *     kreslil na `left + index * step`, teda dva dni vzdialené od seba dva
 *     týždne vyzerali ako dva susedné dni. Graf tým tvrdil, že sťahovanie beží
 *     každý deň. Odteraz nesie vodorovnú polohu KALENDÁRNY DEŇ a diera
 *     v pokrytí je v grafe naozaj diera.
 *
 *  2. **Deň bez merania dostane nulu.** `SeriesDay.units` je `number | null`
 *     a `null` NIE JE nula: znamená „appka o tom dni nič nevie". Taký deň
 *     nedostane bod, nevstúpi do mierky, do priemeru ani do trendu — dostane
 *     šrafovaný pás (`gaps`) a v tabuľke pomlčku. Kto `null` niekde nahradí
 *     nulou, spraví z výpadku sťahovania prepad predaja a bude to vyzerať
 *     vierohodne. K 24. 8. 2026 je takých dní šestnásť a merané sú dva.
 *
 *  3. **Diera vzniká len medzi dvoma meraniami.** Nevzniká. Pásmo neznáma sa
 *     počíta cez CELÝ kalendár osi, takže ho dostane aj úsek PRED prvým
 *     a ZA posledným meraním — a práve ten je dnes ten podstatný: posledné
 *     meranie je 6. 8. a `sales_sync_state` siaha po 22. 8.
 *
 *  4. **Trendová čiara cez dva body alebo cez dieru.** Priamka najmenších
 *     štvorcov cez dva body JE tá spojnica; nakresliť ju druhýkrát a povedať
 *     jej „trend" znamená tvrdiť, že dve merania sú smerovanie. Trend sa preto
 *     kreslí až od `MIN_TREND_POINTS` uzavretých dní a NIKDY nad radom, ktorý
 *     má čo i len jedno pásmo neznáma alebo jeden odhad: sklon by počítal
 *     s dňami, ktoré nikto nezmeral. Hranica je zámerne rovnaká ako
 *     `MIN_DAYS_FOR_TREND` v `src/lib/sales/insights.ts`; kopíruje sa preto,
 *     že ten modul ťahá `@/db/pool` a do prehliadača nesmie.
 *
 *  5. **Plocha aj spojnica pri dvoch bodoch.** Výplň číta oko ako spojitú
 *     veličinu v čase a čiara medzi dvoma bodmi je sklon, teda trend inou
 *     rukou. Pri dvoch meraniach žiadna spojitá veličina nie je, takže `mode`
 *     je `pair`: dva body, obe čísla priamo pri nich, ŽIADNA plocha a ŽIADNA
 *     spojnica. Priamy popisok pri KAŽDOM bode je inak zakázaný; pri dvoch
 *     bodoch je to výber, nie hluk.
 *
 *  6. **Os natiahnutá po dnešok.** Zámerne NIE. Os pokrýva prvý až posledný
 *     deň, o ktorom má appka ZÁZNAM — teda aj dni, ktoré sa sťahovať pokúsila
 *     a nestiahla. Po dnešok sa neťahá: že sú dáta staré, hovorí riadok
 *     o čerstvosti pod grafom, nie prázdna púšť v ráme.
 */

/** Súradnicová sústava presne ako v predlohe — `viewBox="0 0 880 150"`. */
export const CHART = {
  width: 880,
  height: 150,
  left: 30,
  right: 860,
  baseline: 130,
  top: 10,
} as const;

/**
 * Od koľkých uzavretých dní má trendová čiara zmysel. Pod touto hranicou je
 * „trend" len prekreslená spojnica dvoch bodov.
 */
export const MIN_TREND_POINTS = 4;

/** Poistka proti pokazenému dátumu: os sa nikdy neprejde po dňoch dlhšie. */
const MAX_AXIS_DAYS = 400;

/**
 * Ako graf vyzerá.
 *  · `pair` — dve merania: dva body a obe čísla pri nich, žiadna spojnica,
 *    žiadna plocha, žiadny trend,
 *  · `line` — tri a viac meraní: čiara, plocha, prípadne trend.
 */
export type SalesChartMode = 'pair' | 'line';

/**
 * Jeden deň radu tak, ako do grafu vstupuje.
 *
 * `units` je `number | null` a ten rozdiel je celé jadro tejto sekcie:
 * `0` znamená „deň sme stiahli a nepredalo sa nič" (meraný fakt o eshope),
 * `null` znamená „o tomto dni appka nevie nič" (fakt o appke). Zliať ich do
 * jedného čísla je najlacnejší spôsob, ako z výpadku sťahovania spraviť
 * presvedčivo vyzerajúci prepad predaja.
 */
export interface SeriesDay {
  day: string;
  /** Kusy za deň. `null` = nemerané; NIKDY sa nekreslí ako nula. */
  units: number | null;
  /** Neúplne stiahnutý deň — číslo je dolná hranica, značí sa `≈` (P7). */
  partial?: boolean;
}

export interface ChartPoint {
  day: string;
  units: number;
  x: number;
  y: number;
  /** Neúplný deň: hodnota je dolná hranica, kreslí sa tlmene a s `≈`. */
  estimate: boolean;
}

/**
 * Súvislé pásmo dní, o ktorých appka nevie nič. V grafe šrafovaný pás,
 * v tabuľke riadok s pomlčkou — nikdy bod a nikdy nula.
 */
export interface UnknownSpan {
  /** Prvý deň pásma. */
  fromDay: string;
  /** Posledný deň pásma. */
  toDay: string;
  /** Koľko kalendárnych dní pásmo drží. */
  days: number;
  x1: number;
  x2: number;
}

/** Nesťahované obdobie MEDZI dvoma meraniami — čistý výpočet pre testy. */
export interface CoverageGap {
  /** Posledný deň, ktorý dáta majú, pred dierou. */
  afterDay: string;
  /** Prvý deň, ktorý dáta majú, za dierou. */
  beforeDay: string;
  /** Koľko kalendárnych dní medzi nimi chýba. */
  missingDays: number;
}

export interface ChartGeometry {
  /** Merané uzavreté dni — plná čiara a plocha. */
  points: ChartPoint[];
  /** Dnešok, ak ho máme — kreslí sa prerušovane, lebo deň ešte beží. */
  todayPoint: ChartPoint | null;
  /**
   * Spojnica rozdelená na súvislé úseky. Cez pásmo neznáma ani cez odhad sa
   * čiara neťahá a v režime `pair` sa nekreslí vôbec.
   */
  segments: string[];
  areaPath: string;
  /** Priamka najmenších štvorcov. `null` pri dierach, odhadoch a dvoch bodoch. */
  trendLine: { x1: number; y1: number; x2: number; y2: number } | null;
  gridLines: Array<{ y: number; label: string }>;
  xLabels: Array<{ x: number; label: string }>;
  /** Horná hranica osi — „pekné" číslo nad maximom. */
  scaleMax: number;
  mode: SalesChartMode;
  /** Pásma dní bez merania. Prázdne pole = os je meraná deň po dni. */
  gaps: UnknownSpan[];
  /** Koľko kalendárnych dní os pokrýva. */
  spanDays: number;
  /** Koľko dní osi má naozaj číslo. Toľko a nie viac graf meria. */
  measuredDays: number;
  /**
   * Mierka osi — aby sa na ňu dalo PRILOŽIŤ okno zľavy bez druhého výpočtu.
   *
   * Existuje presne preto, že podfarbené okná zliav (V4, D113) musia sedieť na
   * tú istú os ako body. Keby si ich prevod z dňa na `x` počítal komponent sám,
   * vznikla by druhá mierka — a graf by mal krivku podľa kalendára a pásy
   * podľa poradia, čo by nikto neuvidel.
   *
   * `byDate: false` znamená, že rad obsahuje nečitateľný deň a celá os je
   * poradová. Vtedy sa okná NEKRESLIA vôbec: pás priložený na poradovú os
   * tvrdí o dátume niečo, čo nikto nezmeral.
   */
  axis: {
    firstDay: string;
    lastDay: string;
    byDate: boolean;
    /** Poradové číslo prvého dňa osi; `null` pri poradovej mierke. */
    firstNumber: number | null;
    /** Koľko jednotiek `viewBox` zaberá jeden kalendárny deň. */
    perDay: number;
  };
  /** Body pre nitkový kríž — jeden na KAŽDÝ deň osi, aj na nemeraný. */
  hover: Array<{
    day: string;
    units: number | null;
    x: number;
    y: number;
    isToday: boolean;
    estimate: boolean;
  }>;
}

/** Najbližšie okrúhle číslo nad `value` (1, 2, 5 × mocnina desiatich). */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

/** `2026-08-10` → `10. 8.` — os grafu, nie veta. */
export function axisDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return day;
  return `${Number(match[3])}. ${Number(match[2])}.`;
}

/**
 * Deň → poradové číslo dňa od epochy. `null` pri nečitateľnom vstupe.
 *
 * Zámerne sa NEPOUŽÍVA `@/lib/domain/dates` — jeho `parseDateOnly()` na
 * nezmysle vyhodí `DomainError` a zhodilo by to celú sekciu Prehľadu kvôli
 * jednému pokazenému riadku z API. Tu stačí vedieť, či sa deň dá prečítať.
 */
export function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return null;
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(stamp)) return null;
  return Math.round(stamp / 86_400_000);
}

/** Opak `dayNumber()` — pásmo neznáma musí vedieť pomenovať aj deň bez riadku. */
export function dayFromNumber(value: number): string {
  return new Date(Math.round(value) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Diery v rade dní. Vstup musí byť zoradený vzostupne (API aj `parseDays()`
 * to robia). Nečitateľný deň dieru nevyrobí — to by bolo tvrdenie z neznalosti.
 */
export function coverageGaps(days: readonly SeriesDay[]): CoverageGap[] {
  const out: CoverageGap[] = [];
  for (let i = 1; i < days.length; i += 1) {
    const previous = days[i - 1] as SeriesDay;
    const current = days[i] as SeriesDay;
    const a = dayNumber(previous.day);
    const b = dayNumber(current.day);
    if (a === null || b === null) continue;
    const missing = b - a - 1;
    if (missing > 0) {
      out.push({ afterDay: previous.day, beforeDay: current.day, missingDays: missing });
    }
  }
  return out;
}

const round1 = (value: number): number => Number(value.toFixed(1));

interface Placement {
  xs: number[];
  spanDays: number;
  byDate: boolean;
  /** Poradové číslo prvého dňa osi; `null` pri poradovej mierke. */
  firstNumber: number | null;
  /** Koľko jednotiek `viewBox` zaberá jeden kalendárny deň. */
  perDay: number;
}

/**
 * Vodorovné polohy dní. Prvý deň sedí na ľavom okraji, posledný na pravom;
 * medzi nimi rozhoduje KALENDÁR, nie poradie v poli.
 *
 * Keď je čo i len jeden deň nečitateľný, celý rad sa rozostupuje rovnomerne po
 * poradí. Miešať obe mierky v jednom ráme by vyrobilo os, ktorá je zľava
 * kalendárna a sprava poradová — a to by nikto nezistil.
 */
function positions(days: readonly SeriesDay[]): Placement {
  const span = CHART.right - CHART.left;
  const numbers = days.map((day) => dayNumber(day.day));
  const readable = numbers.every((value): value is number => value !== null);
  const first = readable ? (numbers[0] as number) : 0;
  const last = readable ? (numbers[numbers.length - 1] as number) : days.length - 1;
  const total = last - first;

  if (!readable || total <= 0) {
    const step = span / Math.max(1, days.length - 1);
    return {
      xs: days.map((_, index) => round1(CHART.left + index * step)),
      spanDays: days.length,
      byDate: false,
      firstNumber: null,
      perDay: step,
    };
  }
  const perDay = span / total;
  return {
    xs: numbers.map((value) => round1(CHART.left + ((value as number) - first) * perDay)),
    spanDays: total + 1,
    byDate: true,
    firstNumber: first,
    perDay,
  };
}

/**
 * Pásma dní bez merania po celej dĺžke osi — vrátane úseku pred prvým a za
 * posledným meraním. Práve ten posledný je dnes ten podstatný.
 */
function unknownSpans(placed: Placement, measured: ReadonlySet<string>): UnknownSpan[] {
  if (!placed.byDate || placed.firstNumber === null) return [];
  if (placed.spanDays > MAX_AXIS_DAYS) return [];

  const firstNumber = placed.firstNumber;
  const lastNumber = firstNumber + placed.spanDays - 1;
  const known = new Set<number>();
  for (const day of measured) {
    const value = dayNumber(day);
    if (value !== null) known.add(value);
  }

  const xAt = (value: number): number =>
    Math.min(
      CHART.right,
      Math.max(CHART.left, round1(CHART.left + (value - firstNumber) * placed.perDay)),
    );

  const out: UnknownSpan[] = [];
  let start: number | null = null;
  for (let n = firstNumber; n <= lastNumber + 1; n += 1) {
    if (n <= lastNumber && !known.has(n)) {
      if (start === null) start = n;
      continue;
    }
    if (start === null) continue;
    const end = n - 1;
    out.push({
      fromDay: dayFromNumber(start),
      toDay: dayFromNumber(end),
      days: end - start + 1,
      x1: xAt(start - 0.5),
      x2: xAt(end + 0.5),
    });
    start = null;
  }
  return out;
}

function fit(points: readonly ChartPoint[]): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXy = 0;
  let sumXx = 0;
  for (let i = 0; i < n; i += 1) {
    const point = points[i] as ChartPoint;
    sumX += i;
    sumY += point.units;
    sumXy += i * point.units;
    sumXx += i * i;
  }
  const denominator = n * sumXx - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXy - sumX * sumY) / denominator;
  return { slope, intercept: (sumY - slope * sumX) / n };
}

/**
 * Denný priebeh → súradnice. `null`, keď nie sú aspoň DVA merané dni; volajúci
 * potom vykreslí prázdny stav namiesto čiary cez nulu. Dni s `units: null`
 * sa do počtu meraní nerátajú — os ich nesie, graf ich nekreslí.
 */
export function chartGeometry(days: readonly SeriesDay[], today: string): ChartGeometry | null {
  if (days.length < 2) return null;

  const measured = days.filter((day) => day.units !== null);
  if (measured.length < 2) return null;

  const scaleMax = niceCeiling(Math.max(...measured.map((day) => day.units as number)));
  const height = CHART.baseline - CHART.top;
  const placed = positions(days);
  const yOf = (units: number): number => round1(CHART.baseline - (units / scaleMax) * height);

  const all: ChartPoint[] = [];
  days.forEach((day, index) => {
    if (day.units === null) return;
    all.push({
      day: day.day,
      units: day.units,
      x: placed.xs[index] as number,
      y: yOf(day.units),
      estimate: day.partial === true,
    });
  });

  const todayPoint = all.find((point) => point.day === today) ?? null;
  const points = all.filter((point) => point.day !== today);
  if (points.length === 0) return null;

  const mode: SalesChartMode = all.length <= 2 ? 'pair' : 'line';
  const gaps = unknownSpans(placed, new Set(measured.map((day) => day.day)));

  /*
   * Súvislé úseky. Čiara spája len dni, ktoré sú v kalendári vedľa seba a obe
   * merané naplno — odhad ani nemeraný deň úsek ukončia.
   */
  const runs: ChartPoint[][] = [];
  let run: ChartPoint[] = [];
  let previous: number | null = null;
  for (const point of points) {
    const number = placed.byDate ? dayNumber(point.day) : null;
    if (point.estimate) {
      if (run.length > 0) runs.push(run);
      run = [];
      previous = number;
      continue;
    }
    const adjacent = placed.byDate
      ? previous !== null && number !== null && number - previous === 1
      : run.length > 0;
    if (!adjacent && run.length > 0) {
      runs.push(run);
      run = [];
    }
    run.push(point);
    previous = number;
  }
  if (run.length > 0) runs.push(run);
  const drawable = runs.filter((chunk) => chunk.length >= 2);

  const segments =
    mode === 'pair'
      ? []
      : drawable.map((chunk) => chunk.map((point) => `${point.x},${point.y}`).join(' '));

  /* Plocha sa skladá z tých istých úsekov — cez pásmo neznáma sa nerozlieva. */
  const areaPath =
    mode === 'pair'
      ? ''
      : drawable
          .map((chunk) => {
            const head = chunk[0] as ChartPoint;
            const tail = chunk[chunk.length - 1] as ChartPoint;
            const body = chunk.map((point) => `${point.x},${point.y}`).join(' ');
            return `M${body} ${tail.x},${CHART.baseline} ${head.x},${CHART.baseline} Z`;
          })
          .join(' ');

  const trendable =
    mode === 'line' &&
    gaps.length === 0 &&
    points.length >= MIN_TREND_POINTS &&
    points.every((point) => !point.estimate);
  const line = trendable ? fit(points) : null;
  const first = points[0] as ChartPoint;
  const end = points[points.length - 1] as ChartPoint;
  const trendLine =
    line === null
      ? null
      : {
          x1: first.x,
          y1: yOf(Math.max(0, line.intercept)),
          x2: end.x,
          y2: yOf(Math.max(0, line.intercept + line.slope * (points.length - 1))),
        };

  const gridLines = [0, scaleMax / 2, scaleMax].map((value) => ({
    y: yOf(value),
    label: String(Math.round(value)),
  }));

  // Najviac päť popisov osi — hustejšie sa pri 14 dňoch prekrývajú.
  const wanted = Math.min(5, days.length);
  const labelStep = (days.length - 1) / Math.max(1, wanted - 1);
  const seen = new Set<number>();
  const xLabels: Array<{ x: number; label: string }> = [];
  for (let i = 0; i < wanted; i += 1) {
    const index = Math.round(i * labelStep);
    if (seen.has(index)) continue;
    seen.add(index);
    const day = days[index] as SeriesDay;
    xLabels.push({ x: placed.xs[index] as number, label: axisDay(day.day) });
  }

  /* Nemeraný deň nemá výšku. Kríž ho nájde v strede rámu a povie pomlčku. */
  const unknownY = round1((CHART.top + CHART.baseline) / 2);
  const hover = days.map((day, index) => ({
    day: day.day,
    units: day.units,
    x: placed.xs[index] as number,
    y: day.units === null ? unknownY : yOf(day.units),
    isToday: day.day === today,
    estimate: day.partial === true,
  }));

  return {
    points,
    todayPoint,
    segments,
    areaPath,
    trendLine,
    gridLines,
    xLabels,
    scaleMax,
    mode,
    gaps,
    spanDays: placed.spanDays,
    measuredDays: all.length,
    axis: {
      firstDay: (days[0] as SeriesDay).day,
      lastDay: (days[days.length - 1] as SeriesDay).day,
      byDate: placed.byDate,
      firstNumber: placed.firstNumber,
      perDay: placed.perDay,
    },
    hover,
  };
}

/* ═══════════════ 4. Okná zliav pod krivkou (V4, D113) ═════════════════════ */

/**
 * Okno zľavy tak, ako ho vracia `GET /api/insights/timeline`.
 *
 * Sú to VLASTNÉ zápisy appky, nie stav eshopu (I11): hovorí to, že sme na tie
 * dni zľavu zapísali, nie že ju zákazník v tie dni naozaj videl. Text nad
 * grafom to musí povedať; tento modul len počíta súradnice.
 */
export interface DiscountWindowInput {
  id: number;
  name: string;
  percent: number;
  dateFrom: string;
  dateTo: string;
}

/** Podfarbený pás pod krivkou. Súradnice sú v mierke `CHART`, nie v pixeloch. */
export interface DiscountBand {
  id: number;
  name: string;
  percent: number;
  /** Prvý a posledný deň pásu PO orezaní na os. */
  fromDay: string;
  toDay: string;
  /** Koľko dní osi pás pokrýva. */
  days: number;
  x1: number;
  x2: number;
  /** `true` = zľava začala PRED osou; pás je odrezaný na jej ľavej hrane. */
  clippedStart: boolean;
  /** `true` = zľava pokračuje ZA osou. */
  clippedEnd: boolean;
}

/**
 * Okná zliav priložené na os grafu predaja.
 *
 * Prečo je to funkcia a nie pole v odpovedi servera: server nevie, aká os
 * nakoniec vznikne. Os pokrýva prvý až posledný deň, o ktorom má appka záznam
 * (viď bod 6 v hlavičke tohto modulu), takže hranice pásu môžu byť inde než
 * hranice okna prepínača.
 *
 * TRI VECI, KTORÉ SA TU DAJÚ TICHO POKAZIŤ
 *
 *  1. **Poradová os.** Pri nečitateľnom dni je mierka poradová a dátum na ňu
 *     priložiť NEMOŽNO. Vracia sa prázdne pole — graf potom nekreslí nič a
 *     netvrdí nič.
 *  2. **Okno mimo osi.** Zľava, ktorá skončila pred prvým dňom osi (alebo
 *     začne po poslednom), pás nedostane. Prilepiť ju na hranu by z nej
 *     spravilo zľavu, ktorá v okne bežala.
 *  3. **Orezanie bez priznania.** Zľava, ktorá os presahuje, pás dostane —
 *     ale s `clippedStart`/`clippedEnd`, aby povrch mohol povedať, že
 *     pokračuje mimo rámu. Bez toho vyzerá krátka zľava ako dlhá a naopak.
 *
 * Hranice sa počítajú na ±0,5 dňa, presne ako pásma neznáma: pás patrí CELÝM
 * dňom, nie bodom v ich stredoch.
 */
export function discountBands(
  geometry: Pick<ChartGeometry, 'axis'>,
  windows: readonly DiscountWindowInput[],
): DiscountBand[] {
  const axis = geometry.axis;
  if (!axis.byDate || axis.firstNumber === null) return [];

  const first = axis.firstNumber;
  const lastNumber = dayNumber(axis.lastDay);
  if (lastNumber === null) return [];

  const xAt = (value: number): number =>
    Math.min(
      CHART.right,
      Math.max(CHART.left, round1(CHART.left + (value - first) * axis.perDay)),
    );

  const out: DiscountBand[] = [];
  for (const window of windows) {
    const from = dayNumber(window.dateFrom);
    const to = dayNumber(window.dateTo);
    // Nečitateľný alebo obrátený dátum pás nedostane — hádať sa tu nedá.
    if (from === null || to === null || to < from) continue;
    if (to < first || from > lastNumber) continue;

    const start = Math.max(from, first);
    const end = Math.min(to, lastNumber);
    out.push({
      id: window.id,
      name: window.name,
      percent: window.percent,
      fromDay: dayFromNumber(start),
      toDay: dayFromNumber(end),
      days: end - start + 1,
      x1: xAt(start - 0.5),
      x2: xAt(end + 0.5),
      clippedStart: from < first,
      clippedEnd: to > lastNumber,
    });
  }
  return out;
}

/* ═════════ 5. Denná tržba ESHOPU (V4, D117) — nie tržba za produkt ════════ */

/**
 * ČO JE TOTO ČÍSLO A ČO NIE JE.
 *
 * Hlavička tohto modulu hovorí, že appka tržbu v eurách nepozná. Od sondy
 * 28. 8. 2026 (D117) to platí PRESNE V TEJTO PODOBE: ceny položiek objednávky
 * API nevracia, takže tržba per produkt naozaj neexistuje a dopočítať sa
 * NESMIE. Existuje ale denný súčet `total_paid` za CELÝ ESHOP — a to je jediné
 * euro, ktoré appka smie vypísať.
 *
 * Preto je táto sekcia oddelená od kusov a preto sa jej riadky nikdy nedelia
 * počtom kusov: `total_paid` nesie poštovné, kupóny a zľavy, takže „cena za
 * kus" z neho je vymyslené číslo (I11).
 */
export type RevenueDayState = 'measured' | 'lower_bound' | 'unknown';

/** Jeden deň okna pripravený na vykreslenie. Chýbajúci deň NIE JE nula. */
export interface RevenueDayView {
  day: string;
  /**
   * Suma ako string z odpovede (`DECIMAL`), nikdy float. `null` = deň nemáme
   * a jeho tržbu NEPOZNÁME.
   */
  amount: string | null;
  state: RevenueDayState;
  /** Hotový text: `≈` pri dolnej hranici, pomlčka pri „nevieme" (P7). */
  text: string;
  /** Koľko objednávok je v súčte. `null` = deň nemáme. */
  ordersCount: number | null;
}

/** Jeden deň tak, ako prichádza z `GET /api/insights/revenue-daily`. */
export interface RevenueRowInput {
  day: string;
  totalPaidSum: string;
  /**
   * Počet objednávok v súčte. `null` = pole sa v odpovedi nedalo prečítať;
   * nula by tvrdila „ani jedna objednávka", čo je tvrdenie o eshope (I11).
   */
  ordersCount: number | null;
  /** `false` = súčet dňa je DOLNÁ HRANICA, nie celý deň. */
  dayComplete: boolean;
}

/**
 * Dni okna → riadky pre povrch. Jeden riadok na KAŽDÝ deň okna, aj na ten,
 * ktorý v odpovedi nie je.
 *
 * TU SA ROZHODUJE, ČI ROZBEHNUTÝ DEŇ VYZERÁ AKO PREPAD. `dayComplete: false`
 * znamená, že sťahovanie zoznamu objednávok sa nedočítalo — súčet je teda
 * dolná hranica a NESMIE sa postaviť vedľa dočítaných dní ako rovnocenné
 * číslo. Dostane `state: 'lower_bound'` a značku `≈`; deň bez riadku dostane
 * pomlčku, nie nulu.
 *
 * `windowDays` je zoznam dní okna v kalendárnom poradí — zostavuje ho volajúci
 * z `window.from`/`window.to`, aby sa tu nemuseli sčítavať milisekundy (letný
 * čas by pri tom raz do roka posunul deň).
 */
export function revenueDays(
  windowDays: readonly string[],
  rows: readonly RevenueRowInput[],
): RevenueDayView[] {
  const byDay = new Map<string, RevenueRowInput>();
  for (const row of rows) byDay.set(row.day, row);

  return windowDays.map((day) => {
    const row = byDay.get(day);
    if (row === undefined) {
      return { day, amount: null, state: 'unknown' as const, text: NEVIEME, ordersCount: null };
    }
    const complete = row.dayComplete === true;
    return {
      day,
      amount: row.totalPaidSum,
      state: complete ? ('measured' as const) : ('lower_bound' as const),
      text: complete ? row.totalPaidSum : `≈ ${row.totalPaidSum}`,
      ordersCount: row.ordersCount,
    };
  });
}

/**
 * Kalendárne dni okna od `from` po `to` vrátane.
 *
 * Deň sa posúva cez poradové číslo dňa, nie pripočítavaním 86 400 000 ms —
 * v týždni prechodu na letný čas by ten druhý spôsob jeden deň preskočil.
 * Prázdny výsledok znamená nečitateľné hranice, teda „nevieme", nie nula dní.
 */
export function windowDayList(from: string, to: string, max = MAX_AXIS_DAYS): string[] {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null || b < a || b - a + 1 > max) return [];
  const out: string[] = [];
  for (let n = a; n <= b; n += 1) out.push(dayFromNumber(n));
  return out;
}
