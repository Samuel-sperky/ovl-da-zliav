/**
 * Aura Zľavy — čistá matematika a mapovanie grafov G1–G6 (plán §4, sekcia B2).
 *
 * Modul je zámerne bez Reactu, bez DOM a bez fetchu: všetko, čo sa dá overiť
 * testom, žije tu a komponenty len kreslia SVG z výsledkov.
 *
 * Tvrdé pravidlá, ktoré tento modul drží:
 *   · **Farba je vždy token B1.** Funkcie vracajú `var(--st-*)` /
 *     `var(--seq-teal-*)`, nikdy vlastný hex. Teal je len sekvenčná rampa
 *     (magnitúda), nikdy stav — a `--gold` sa v grafoch nepoužije vôbec.
 *   · **Stav nie je nikdy len farba.** Ku každému stavu patrí glyf aj
 *     slovenský text; `statusVisual()` vracia všetky tri naraz.
 *   · **Jedna os.** Nikde tu nie je funkcia, ktorá by počítala druhú y-škálu.
 *
 * Poznámka k duplicite (nahlásené B1): mapovanie `stav → tón + glyf` existuje
 * aj v `src/components/ui/StatusBadge.tsx`, ale nie je odtiaľ exportované.
 * Tabuľka nižšie je 1 : 1 prepis plánu §3.3 a musí sa meniť spolu s ním.
 */
import type { StatusTone } from '@/components/ui/ToneBadge';

/* ═══════════════════════════ 1. Stavy a tóny ══════════════════════════════ */

export interface StatusVisual {
  tone: StatusTone;
  glyph: string;
  label: string;
}

/** Kampaň → tón + glyf + text (plán §3.3; `scheduled` je neutrál, nie zelená). */
export const CAMPAIGN_VISUAL: Record<string, StatusVisual> = {
  draft: { tone: 'idle', glyph: '✎', label: 'návrh' },
  scheduled: { tone: 'idle', glyph: '○', label: 'naplánovaná' },
  needs_key: { tone: 'attention', glyph: '⚿', label: 'vyžaduje kľúč' },
  running: { tone: 'progress', glyph: '◐', label: 'beží zápis' },
  done: { tone: 'good', glyph: '✓', label: 'zapísaná' },
  partial: { tone: 'attention', glyph: '◧', label: 'čiastočná' },
  failed: { tone: 'critical', glyph: '✕', label: 'zlyhala' },
  missed: { tone: 'attention', glyph: '⏱', label: 'zmeškaná' },
  cancelled: { tone: 'idle', glyph: '–', label: 'zrušená' },
  lapsed: { tone: 'idle', glyph: '⊘', label: 'prepadnutá' },
};

/** Položka dávky → tón + glyf + text. `preskočený` NIE JE chyba (V20). */
export const ITEM_VISUAL: Record<string, StatusVisual> = {
  pending: { tone: 'idle', glyph: '○', label: 'čaká' },
  skipped: { tone: 'idle', glyph: '⤼', label: 'preskočený' },
  ok: { tone: 'good', glyph: '✓', label: 'zapísaný' },
  failed: { tone: 'critical', glyph: '✕', label: 'zlyhal' },
  uncertain: { tone: 'attention', glyph: '?', label: 'neistý' },
  interrupted: { tone: 'attention', glyph: '⏸', label: 'prerušený' },
  not_found: { tone: 'attention', glyph: '∅', label: 'nenájdený' },
  blocked: { tone: 'attention', glyph: '⊗', label: 'blokovaný' },
};

const UNKNOWN_VISUAL: StatusVisual = { tone: 'idle', glyph: '·', label: 'neznámy stav' };

export function campaignVisual(status: string): StatusVisual {
  return CAMPAIGN_VISUAL[status] ?? UNKNOWN_VISUAL;
}

export function itemVisual(status: string): StatusVisual {
  return ITEM_VISUAL[status] ?? UNKNOWN_VISUAL;
}

/** Farba tónu — VÝHRADNE token B1, nikdy hex (plán §3.1, §5). */
export function toneColor(tone: StatusTone): string {
  return `var(--st-${tone})`;
}

/**
 * Tvar marku pre bodové grafy. Stav sa nesmie kódovať len farbou, takže
 * v grafoch ho nesie aj silueta (plán §3.3).
 */
export type MarkShape = 'circle' | 'cross' | 'diamond';

export function markShape(tone: StatusTone): MarkShape {
  if (tone === 'good') return 'circle';
  if (tone === 'critical') return 'cross';
  return 'diamond';
}

/* ═══════════════════════ 2. Kalendár a časová os ══════════════════════════ */

export const DAY_MS = 86_400_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string): boolean {
  return DAY_RE.test(value);
}

/** `YYYY-MM-DD` → UTC milisekundy poludnia daného dňa (bezpečné voči DST). */
export function dayMs(day: string): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return Date.UTC(year, month - 1, date, 12, 0, 0, 0);
}

/** Počet celých dní medzi dvoma kalendárnymi dňami (`to − from`). */
export function dayDiff(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

export function addDaysTo(day: string, days: number): string {
  return new Date(dayMs(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Dĺžka okna v dňoch vrátane oboch krajných dní (`06.08.–06.08.` = 1 deň). */
export function windowLengthDays(from: string, to: string): number {
  return dayDiff(from, to) + 1;
}

export interface Axis {
  from: string;
  to: string;
  /** Ľavý okraj plochy grafu vo viewBox jednotkách. */
  x0: number;
  /** Pravý okraj plochy grafu vo viewBox jednotkách. */
  x1: number;
}

/** Pozícia dňa na osi. Vracia aj hodnoty mimo `[x0,x1]` — orezáva volajúci. */
export function dayToX(day: string, axis: Axis): number {
  const total = dayDiff(axis.from, axis.to) + 1;
  if (total <= 0) return axis.x0;
  const offset = dayDiff(axis.from, day);
  return axis.x0 + ((axis.x1 - axis.x0) * offset) / total;
}

export interface SpanGeometry {
  x: number;
  width: number;
  /** Okno začína pred ľavým okrajom osi — koniec spanu sa nekreslí zaoblený. */
  clippedStart: boolean;
  /** Okno končí za pravým okrajom osi. */
  clippedEnd: boolean;
  /** `false`, keď okno do osi vôbec nezasahuje. */
  visible: boolean;
}

/**
 * Geometria jedného okna na osi. Span je INKLUZÍVNY na oboch koncoch, preto sa
 * pravý okraj počíta z `to + 1 deň` — jednodňová kampaň tak nemá nulovú šírku.
 */
export function spanGeometry(from: string, to: string, axis: Axis): SpanGeometry {
  const hidden: SpanGeometry = {
    x: axis.x0,
    width: 0,
    clippedStart: false,
    clippedEnd: false,
    visible: false,
  };
  if (!isDay(from) || !isDay(to) || dayDiff(from, to) < 0) return hidden;
  if (dayDiff(to, axis.from) > 0 || dayDiff(axis.to, from) > 0) return hidden;

  const rawStart = dayToX(from, axis);
  const rawEnd = dayToX(addDaysTo(to, 1), axis);
  const x = Math.max(axis.x0, rawStart);
  const end = Math.min(axis.x1, rawEnd);
  return {
    x,
    // Minimálna šírka 3 px, aby jednodňové okno na 3-mesačnej osi nezmizlo.
    width: Math.max(3, end - x),
    clippedStart: rawStart < axis.x0,
    clippedEnd: rawEnd > axis.x1,
    visible: true,
  };
}

export interface MonthTick {
  day: string;
  /** `aug 2026` — krátky slovenský mesiac. */
  label: string;
}

const MONTHS_SK = [
  'jan',
  'feb',
  'mar',
  'apr',
  'máj',
  'jún',
  'júl',
  'aug',
  'sep',
  'okt',
  'nov',
  'dec',
];

export function monthLabel(day: string): string {
  const month = Number(day.slice(5, 7));
  return `${MONTHS_SK[month - 1] ?? '?'} ${day.slice(0, 4)}`;
}

/** Prvé dni mesiacov v rozsahu osi — mriežka G1 (hairline, nie prerušovaná). */
export function monthTicks(from: string, to: string): MonthTick[] {
  if (!isDay(from) || !isDay(to) || dayDiff(from, to) < 0) return [];
  const ticks: MonthTick[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  for (let guard = 0; guard < 24; guard += 1) {
    const day = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
    if (dayDiff(day, to) < 0) break;
    if (dayDiff(from, day) >= 0) ticks.push({ day, label: monthLabel(day) });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return ticks;
}

/* ═══════════════════════ 3. Prekryv okien (D28) ═══════════════════════════ */

export interface TimelineSpan {
  id: number;
  dateFrom: string;
  dateTo: string;
  productIds: readonly number[];
}

/**
 * ID kampaní, ktoré sa s inou kampaňou prekrývajú v čase **a zároveň na tom
 * istom produkte**. Iba taký prekryv je blokujúci (D28) — dve kampane na
 * rôznych produktoch v rovnakom týždni sú úplne v poriadku.
 */
export function overlappingIds(spans: readonly TimelineSpan[]): Set<number> {
  const hit = new Set<number>();
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      const a = spans[i] as TimelineSpan;
      const b = spans[j] as TimelineSpan;
      const timeOverlap = dayDiff(a.dateFrom, b.dateTo) >= 0 && dayDiff(b.dateFrom, a.dateTo) >= 0;
      if (!timeOverlap) continue;
      const shared = a.productIds.some((id) => b.productIds.includes(id));
      if (!shared) continue;
      hit.add(a.id);
      hit.add(b.id);
    }
  }
  return hit;
}

/* ══════════════════ 4. Sekvenčná rampa a osi hodnôt ═══════════════════════ */

/** Strop percenta, ktorý dovolí shop API aj lokálna validácia (D11, I9). */
export const PERCENT_CAP = 30;

/**
 * Percento → krok sekvenčnej teal rampy 1–5 (G2). Rampa kóduje MAGNITÚDU,
 * nie stav — to je jediné miesto, kde je teal v grafe správne (plán §4).
 */
export function sequentialStep(percent: number, cap = PERCENT_CAP): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(percent) || percent <= 0) return 1;
  const ratio = Math.min(1, percent / Math.max(1, cap));
  const step = Math.ceil(ratio * 5);
  return Math.min(5, Math.max(1, step)) as 1 | 2 | 3 | 4 | 5;
}

export function sequentialColor(percent: number, cap = PERCENT_CAP): string {
  return `var(--seq-teal-${sequentialStep(percent, cap)})`;
}

/**
 * „Pekné" hodnoty osi od 0 po `max` (1/2/5 × 10ⁿ). Prázdne dáta dajú `[0, 1]`,
 * aby os nikdy nebola degenerovaná.
 */
export function niceTicks(max: number, targetCount = 4): number[] {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const rawStep = safeMax / Math.max(1, targetCount);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceUnit = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = niceUnit * magnitude;
  const top = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks;
}

/**
 * Cesta baru so zaoblením LEN na dátovom konci (plán §4: „4 px rádius na
 * dátovom konci"). Základňa zostáva hranatá, aby bolo vidieť, odkiaľ bar rastie.
 * Pri šírke menšej než rádius sa kreslí obyčajný obdĺžnik.
 */
export function barPathRightRounded(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 4,
): string {
  const w = Math.max(0, width);
  const r = Math.min(radius, w, height / 2);
  if (r <= 0.5) return `M${x},${y} h${w} v${height} h${-w} Z`;
  return [
    `M${x},${y}`,
    `H${x + w - r}`,
    `A${r},${r} 0 0 1 ${x + w},${y + r}`,
    `V${y + height - r}`,
    `A${r},${r} 0 0 1 ${x + w - r},${y + height}`,
    `H${x}`,
    'Z',
  ].join(' ');
}

/* ══════════════════════════ 5. Popisky ════════════════════════════════════ */

/** Skrátenie popisku pre SVG (text sa v SVG neláme ani neelipsuje sám). */
export function truncateLabel(text: string, maxChars: number): string {
  const value = text ?? '';
  if (maxChars <= 1) return value.slice(0, Math.max(0, maxChars));
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Iniciálový monogram namiesto obrázka produktu — API obrázky nemá (plán §4). */
export function monogram(name: string | null, productId: number): string {
  const words = (name ?? '')
    .split(/[\s/–—-]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
  if (words.length === 0) return `#${String(productId).slice(-2)}`;
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
  return `${(words[0] as string)[0] ?? ''}${(words[1] as string)[0] ?? ''}`.toUpperCase();
}

/* ══════════════════════ 6. Segmenty (G5) ══════════════════════════════════ */

export interface Segment {
  key: string;
  count: number;
  visual: StatusVisual;
}

/**
 * Rozpad položiek kampane na segmenty jedného pruhu (G5). Stavy s nulou sa
 * do pruhu nekreslia, ale v tabuľke pod grafom zostávajú — súčet MUSÍ sedieť
 * so `spolu` (U6: dnešné počítadlá nesedia).
 */
export const SEGMENT_ORDER = [
  'ok',
  'failed',
  'uncertain',
  'not_found',
  'interrupted',
  'blocked',
  'skipped',
  'pending',
] as const;

export function itemSegments(tally: Readonly<Record<string, number>>): Segment[] {
  const segments: Segment[] = SEGMENT_ORDER.filter((key) => (tally[key] ?? 0) > 0).map((key) => ({
    key,
    count: tally[key] ?? 0,
    visual: itemVisual(key),
  }));
  // Stav, ktorý UI (ešte) nepozná, sa nesmie ticho vypustiť — súčet segmentov
  // MUSÍ sedieť so `spolu`. Neznáme stavy sa zbalia do jedného segmentu.
  const KNOWN: ReadonlySet<string> = new Set(SEGMENT_ORDER);
  const otherCount = Object.entries(tally)
    .filter(([key, count]) => !KNOWN.has(key) && Number.isFinite(count) && count > 0)
    .reduce((sum, [, count]) => sum + count, 0);
  if (otherCount > 0) segments.push({ key: 'other', count: otherCount, visual: UNKNOWN_VISUAL });
  return segments;
}

export function tallyTotal(tally: Readonly<Record<string, number>>): number {
  // Súčet VŠETKÝCH stavov (aj neznámych) — inak by počítadlá pod grafom
  // nesedeli so segmentmi ani so `spolu`.
  return Object.values(tally).reduce(
    (sum, count) => sum + (Number.isFinite(count) && count > 0 ? count : 0),
    0,
  );
}

/* ═══════════════════════ 7. TTL oblúk (G6) ════════════════════════════════ */

/** TTL kľúča je 48 h (D5) — oblúk kreslí zvyšok z tohto celku. */
export const KEY_TTL_SECONDS = 48 * 3600;

export interface TtlArc {
  /** 0–1, podiel zostávajúceho času. */
  fraction: number;
  tone: StatusTone;
  glyph: string;
  /** Slovenský text stavu — farba nikdy nestojí sama (§3.3). */
  label: string;
}

/**
 * Zvyšok TTL → oblúk. Prah 6 h prepne na `attention`, 1 h na `critical`;
 * `null`/`≤0` znamená „kľúč nie je použiteľný", nie „všetko v poriadku“.
 */
export function ttlArc(secondsLeft: number | null, total = KEY_TTL_SECONDS): TtlArc {
  if (secondsLeft == null || !Number.isFinite(secondsLeft) || secondsLeft <= 0) {
    return { fraction: 0, tone: 'critical', glyph: '⚿', label: 'kľúč chýba alebo expiroval' };
  }
  const fraction = Math.max(0, Math.min(1, secondsLeft / Math.max(1, total)));
  if (secondsLeft <= 3600) return { fraction, tone: 'critical', glyph: '⚿', label: 'expiruje o chvíľu' };
  if (secondsLeft <= 6 * 3600) return { fraction, tone: 'attention', glyph: '⏱', label: 'expiruje dnes' };
  return { fraction, tone: 'good', glyph: '✓', label: 'kľúč platí' };
}

/** Dĺžka oblúka pre `stroke-dasharray` na kruhu s daným polomerom. */
export function arcDash(fraction: number, radius: number): { dash: number; gap: number } {
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * Math.max(0, Math.min(1, fraction));
  return { dash, gap: circumference - dash };
}
