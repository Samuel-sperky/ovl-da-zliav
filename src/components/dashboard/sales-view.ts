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
 *  2. **Spojnica vedená cez nesťahovaný deň.** Čiara cez deň, ktorý sa nikdy
 *     nesťahoval, tvrdí, že sa v ten deň predalo niečo medzi susednými
 *     hodnotami. Nevieme to. Čiara sa preto na diere PRETRHNE (`segments`) a
 *     diera dostane vlastný pás (`gaps`). Nulu za chýbajúci deň nedopĺňa nikto
 *     a nikdy: „predalo sa 0 kusov" a „ten deň sme nesťahovali" sú dve rôzne
 *     vety a appka zapisuje do ostrého eshopu.
 *
 *  3. **Trendová čiara cez dva body.** Priamka najmenších štvorcov cez dva
 *     body JE tá spojnica — nakresliť ju druhýkrát a povedať jej „trend"
 *     znamená tvrdiť, že dve merania sú smerovanie. Trend sa preto kreslí až
 *     od `MIN_TREND_POINTS` uzavretých dní. Hranica je zámerne rovnaká ako
 *     `MIN_DAYS_FOR_TREND` v `src/lib/sales/insights.ts`; kopíruje sa preto,
 *     že ten modul ťahá `@/db/pool` a do prehliadača nesmie.
 *
 *  4. **Plocha pod čiarou pri dvoch bodoch.** Výplň číta oko ako spojitú
 *     veličinu v čase. Pri dvoch meraniach žiadna spojitá veličina nie je,
 *     takže `mode` je `pair`, plocha sa nekreslí a obe hodnoty sa napíšu
 *     priamo k bodom. Priamy popisok pri KAŽDOM bode je inak zakázaný; pri
 *     dvoch bodoch je to výber, nie hluk.
 *
 *  5. **Os natiahnutá po dnešok.** Zámerne NIE. Os pokrýva prvý až posledný
 *     zmeraný deň; že sú dáta staré, hovorí riadok o čerstvosti pod grafom.
 *     Prázdna púšť dvoch týždňov by z grafu spravila prevažne prázdny rám.
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

/**
 * Ako graf vyzerá.
 *  · `pair` — dve merania: dva body, spojnica, obe čísla priamo pri bodoch,
 *    žiadna plocha, žiadny trend,
 *  · `line` — tri a viac meraní: čiara, plocha, prípadne trend.
 */
export type SalesChartMode = 'pair' | 'line';

export interface ChartPoint {
  day: string;
  units: number;
  x: number;
  y: number;
}

/** Nesťahované obdobie medzi dvoma meraniami — v grafe diera, nikdy nula. */
export interface CoverageGap {
  /** Posledný deň, ktorý dáta majú, pred dierou. */
  afterDay: string;
  /** Prvý deň, ktorý dáta majú, za dierou. */
  beforeDay: string;
  /** Koľko kalendárnych dní medzi nimi chýba. */
  missingDays: number;
  x1: number;
  x2: number;
}

export interface ChartGeometry {
  /** Uzavreté dni — plná čiara a plocha. */
  points: ChartPoint[];
  /** Dnešok, ak ho máme — kreslí sa prerušovane, lebo deň ešte beží. */
  todayPoint: ChartPoint | null;
  linePoints: string;
  /**
   * Spojnica rozdelená na súvislé úseky. Kreslí sa TOTO, nie `linePoints` —
   * cez nesťahovaný deň sa čiara neťahá.
   */
  segments: string[];
  areaPath: string;
  /** Priamka najmenších štvorcov. `null` pod `MIN_TREND_POINTS` dňami. */
  trendLine: { x1: number; y1: number; x2: number; y2: number } | null;
  gridLines: Array<{ y: number; label: string }>;
  xLabels: Array<{ x: number; label: string }>;
  /** Horná hranica osi — „pekné" číslo nad maximom. */
  scaleMax: number;
  mode: SalesChartMode;
  /** Diery v pokrytí. Prázdne pole = os je súvislá deň po dni. */
  gaps: CoverageGap[];
  /** Koľko kalendárnych dní os pokrýva (prvý až posledný meraný deň). */
  spanDays: number;
  /** Body pre nitkový kríž — jeden na každý meraný deň, aj na dnešok. */
  hover: Array<{ day: string; units: number; x: number; y: number; isToday: boolean }>;
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

/**
 * Diery v rade dní. Vstup musí byť zoradený vzostupne (API aj `parseDays()`
 * to robia). Nečitateľný deň dieru nevyrobí — to by bolo tvrdenie z neznalosti.
 */
export function coverageGaps(days: readonly SalesDay[]): Array<Omit<CoverageGap, 'x1' | 'x2'>> {
  const out: Array<Omit<CoverageGap, 'x1' | 'x2'>> = [];
  for (let i = 1; i < days.length; i += 1) {
    const previous = days[i - 1] as SalesDay;
    const current = days[i] as SalesDay;
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

/**
 * Vodorovné polohy dní. Prvý deň sedí na ľavom okraji, posledný na pravom;
 * medzi nimi rozhoduje KALENDÁR, nie poradie v poli.
 *
 * Keď je čo i len jeden deň nečitateľný, celý rad sa rozostupuje rovnomerne po
 * poradí. Miešať obe mierky v jednom ráme by vyrobilo os, ktorá je zľava
 * kalendárna a sprava poradová — a to by nikto nezistil.
 */
function positions(days: readonly SalesDay[]): { xs: number[]; spanDays: number; byDate: boolean } {
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
    };
  }
  return {
    xs: numbers.map((value) => round1(CHART.left + ((value as number) - first) * (span / total))),
    spanDays: total + 1,
    byDate: true,
  };
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
  const height = CHART.baseline - CHART.top;
  const placed = positions(days);

  const all: ChartPoint[] = days.map((day, index) => ({
    day: day.day,
    units: day.units,
    x: placed.xs[index] as number,
    y: round1(CHART.baseline - (day.units / scaleMax) * height),
  }));

  const last = all[all.length - 1] as ChartPoint;
  const isTodayLast = last.day === today;
  const points = isTodayLast ? all.slice(0, -1) : all;
  const todayPoint = isTodayLast ? last : null;

  if (points.length === 0) return null;

  const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
  const first = points[0] as ChartPoint;
  const end = points[points.length - 1] as ChartPoint;

  /* Súvislé úseky uzavretých dní — čiara sa na diere pretrhne. */
  const gapList = placed.byDate ? coverageGaps(days) : [];
  const gapAfter = new Set(gapList.map((gap) => gap.afterDay));

  const runs: ChartPoint[][] = [];
  let run: ChartPoint[] = [];
  for (const point of points) {
    run.push(point);
    if (gapAfter.has(point.day)) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 0) runs.push(run);
  const drawable = runs.filter((chunk) => chunk.length >= 2);

  const segments = drawable.map((chunk) => chunk.map((point) => `${point.x},${point.y}`).join(' '));

  const measured = points.length + (todayPoint === null ? 0 : 1);
  const mode: SalesChartMode = measured <= 2 ? 'pair' : 'line';

  /* Plocha sa skladá z tých istých úsekov — cez dieru sa nerozlieva. */
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

  const line = points.length >= MIN_TREND_POINTS ? fit(points) : null;
  const trendLine =
    line === null
      ? null
      : {
          x1: first.x,
          y1: round1(CHART.baseline - (Math.max(0, line.intercept) / scaleMax) * height),
          x2: end.x,
          y2: round1(
            CHART.baseline -
              (Math.max(0, line.intercept + line.slope * (points.length - 1)) / scaleMax) * height,
          ),
        };

  const xByDay = new Map(all.map((point) => [point.day, point.x]));
  const gaps: CoverageGap[] = gapList.map((gap) => ({
    ...gap,
    x1: xByDay.get(gap.afterDay) ?? CHART.left,
    x2: xByDay.get(gap.beforeDay) ?? CHART.right,
  }));

  const gridLines = [0, scaleMax / 2, scaleMax].map((value) => ({
    y: round1(CHART.baseline - (value / scaleMax) * height),
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

  const hover = all.map((point) => ({
    day: point.day,
    units: point.units,
    x: point.x,
    y: point.y,
    isToday: point.day === today,
  }));

  return {
    points,
    todayPoint,
    linePoints,
    segments,
    areaPath,
    trendLine,
    gridLines,
    xLabels,
    scaleMax,
    mode,
    gaps,
    spanDays: placed.spanDays,
    hover,
  };
}
