/**
 * Aura Zľavy — čisté počítanie sekcie „Tržby" v Prehľade (V9).
 *
 * Žiadny React, žiadny fetch, žiadny `process.env` — len čísla dnu a čísla von,
 * aby sa dali otestovať bez prehliadača aj bez databázy.
 *
 * ── Čo appka o predaji naozaj vie ─────────────────────────────────────────────
 *
 * Vlastné tabuľky súčtov nesú **kusy predané na produkt a deň**. Zaplatená suma
 * patrí objednávke, nie položke, takže appka NEVIE povedať tržbu v eurách a
 * nesmie ju dopočítať z ceny — cena v čase objednávky mohla byť iná, doprava a
 * zľavové kupóny do nej nepatria. Sekcia preto pracuje s kusmi a hovorí to
 * nahlas. Vymyslené euro na prístrojovej doske je horšie než priznaná medzera.
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

/** Súradnicová sústava presne ako v predlohe — `viewBox="0 0 880 150"`. */
export const CHART = {
  width: 880,
  height: 150,
  left: 30,
  right: 860,
  baseline: 130,
  top: 10,
} as const;

export interface ChartPoint {
  day: string;
  units: number;
  x: number;
  y: number;
}

export interface ChartGeometry {
  /** Uzavreté dni — plná čiara a plocha. */
  points: ChartPoint[];
  /** Dnešok, ak ho máme — kreslí sa prerušovane, lebo deň ešte beží. */
  todayPoint: ChartPoint | null;
  linePoints: string;
  areaPath: string;
  /** Priamka najmenších štvorcov cez uzavreté dni. `null` pri < 2 dňoch. */
  trendLine: { x1: number; y1: number; x2: number; y2: number } | null;
  gridLines: Array<{ y: number; label: string }>;
  xLabels: Array<{ x: number; label: string }>;
  /** Horná hranica osi — „pekné" číslo nad maximom. */
  scaleMax: number;
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
 * Denný priebeh → súradnice. `null`, keď nie je čo kresliť; volajúci potom
 * vykreslí prázdny stav namiesto čiary cez nulu.
 */
export function chartGeometry(days: readonly SalesDay[], today: string): ChartGeometry | null {
  if (days.length < 2) return null;

  const scaleMax = niceCeiling(Math.max(...days.map((day) => day.units)));
  const span = CHART.right - CHART.left;
  const height = CHART.baseline - CHART.top;
  const step = span / (days.length - 1);

  const all: ChartPoint[] = days.map((day, index) => ({
    day: day.day,
    units: day.units,
    x: Number((CHART.left + index * step).toFixed(1)),
    y: Number((CHART.baseline - (day.units / scaleMax) * height).toFixed(1)),
  }));

  const last = all[all.length - 1] as ChartPoint;
  const isTodayLast = last.day === today;
  const points = isTodayLast ? all.slice(0, -1) : all;
  const todayPoint = isTodayLast ? last : null;

  if (points.length === 0) return null;

  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  const first = points[0] as ChartPoint;
  const end = points[points.length - 1] as ChartPoint;
  const areaPath = `M${linePoints} ${end.x},${CHART.baseline} ${first.x},${CHART.baseline} Z`;

  const line = fit(points);
  const trendLine =
    line === null
      ? null
      : {
          x1: first.x,
          y1: Number(
            (CHART.baseline - (Math.max(0, line.intercept) / scaleMax) * height).toFixed(1),
          ),
          x2: end.x,
          y2: Number(
            (
              CHART.baseline -
              (Math.max(0, line.intercept + line.slope * (points.length - 1)) / scaleMax) * height
            ).toFixed(1),
          ),
        };

  const gridLines = [0, scaleMax / 2, scaleMax].map((value) => ({
    y: Number((CHART.baseline - (value / scaleMax) * height).toFixed(1)),
    label: String(Math.round(value)),
  }));

  // Najviac päť popisov osi — hustejšie sa pri 14 dňoch prekrývajú.
  const wanted = Math.min(5, all.length);
  const labelStep = (all.length - 1) / Math.max(1, wanted - 1);
  const seen = new Set<number>();
  const xLabels: Array<{ x: number; label: string }> = [];
  for (let i = 0; i < wanted; i += 1) {
    const index = Math.round(i * labelStep);
    if (seen.has(index)) continue;
    seen.add(index);
    const point = all[index] as ChartPoint;
    xLabels.push({ x: point.x, label: axisDay(point.day) });
  }

  return { points, todayPoint, linePoints, areaPath, trendLine, gridLines, xLabels, scaleMax };
}
