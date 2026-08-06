'use client';

/**
 * Aura Zľavy — spoločný obal grafov (plán §4, sekcia B2).
 *
 * Každý graf appky má rovnakú kostru, aby sa nedalo zabudnúť na to podstatné:
 *   1. nadpis a jednovetový podnadpis (čo graf hovorí a odkiaľ to vie),
 *   2. legenda pri dvoch a viac sériách — identita nikdy nestojí na farbe,
 *   3. samotné inline SVG (žiadna knižnica, `package.json` je zamknutý),
 *   4. voliteľná poznámka pod grafom,
 *   5. **tabuľková alternatíva v `<details>`** — povinná pri každom grafe.
 *
 * Farby chodia výhradne z tokenov B1 (`--st-*`, `--seq-teal-*`, `--dim`, …).
 * Animácie sú na triedach B1 (`.ovl-anim-grow`), takže ich globálny blok
 * `prefers-reduced-motion: reduce` vypína bez ďalšieho zásahu.
 *
 * Vlastník: B2.
 */
import {
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import type { StatusTone } from '@/components/ui/ToneBadge';
import { toneColor } from '@/components/charts/chart-utils';

/* ═══════════════════════════ 1. Legenda ═══════════════════════════════════ */

export interface LegendItem {
  key: string;
  /** Farba marku — token B1, nikdy hex. */
  color: string;
  /** Glyf stavu; pri sekvenčnej rampe sa neuvádza (magnitúda nie je stav). */
  glyph?: string;
  label: string;
  /** Doplnkový údaj vpravo od popisku (počet, percento). */
  value?: string;
}

export function ChartLegend({ items }: { items: readonly LegendItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul
      className="ovl-chart-legend"
      style={{ listStyle: 'none', margin: '0 0 0.5rem', padding: 0 }}
    >
      {items.map((item) => (
        <li key={item.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35em' }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '0.7rem',
              height: '0.7rem',
              borderRadius: '3px',
              background: item.color,
            }}
          />
          {item.glyph ? <span aria-hidden="true">{item.glyph}</span> : null}
          <span>{item.label}</span>
          {item.value ? <strong className="ovl-num">{item.value}</strong> : null}
        </li>
      ))}
    </ul>
  );
}

export function toneLegendItem(
  key: string,
  tone: StatusTone,
  glyph: string,
  label: string,
  value?: string,
): LegendItem {
  return { key, color: toneColor(tone), glyph, label, ...(value ? { value } : {}) };
}

/* ═══════════════════════════ 2. Tooltip ═══════════════════════════════════ */

export interface ChartTooltipApi {
  containerRef: (node: HTMLDivElement | null) => void;
  show: (event: ReactMouseEvent, content: ReactNode) => void;
  hide: () => void;
  layer: ReactNode;
}

/**
 * Hover vrstva grafu. Marky si ju pripnú cez `show`/`hide`; klávesnica
 * a čítačky dostávajú tú istú informáciu cez `<title>` priamo v marku, takže
 * tooltip nikdy nie je jediný nosič údaja.
 */
/** Odsadenie tooltipu od kurzora. */
export const TOOLTIP_OFFSET_PX = 12;
/** `max-width: 18rem` tooltipu v px (16 px root) — horná hranica jeho šírky. */
export const TOOLTIP_MAX_WIDTH_PX = 288;
/** Odhad výšky tooltipu (2–3 riadky micro textu) pre preklopenie pri spodku. */
export const TOOLTIP_EST_HEIGHT_PX = 72;

/**
 * CSS transform tooltipu (U10): štandardne sa kreslí vpravo dole od kurzora;
 * keď by na pravom/spodnom okraji grafu pretiekol (x + šírka > rect.width),
 * preklopí sa cez `translate(-100%)` na opačnú stranu kurzora — percentá
 * rieši prehliadač zo skutočnej šírky, takže netreba merať DOM.
 */
export function tooltipTransform(
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
): string {
  const flipX = rectWidth > 0 && x + TOOLTIP_OFFSET_PX + TOOLTIP_MAX_WIDTH_PX > rectWidth;
  const flipY = rectHeight > 0 && y + TOOLTIP_OFFSET_PX + TOOLTIP_EST_HEIGHT_PX > rectHeight;
  const dx = Math.round(flipX ? x - TOOLTIP_OFFSET_PX : x + TOOLTIP_OFFSET_PX);
  const dy = Math.round(flipY ? y - TOOLTIP_OFFSET_PX : y + TOOLTIP_OFFSET_PX);
  const base = `translate(${dx}px, ${dy}px)`;
  if (!flipX && !flipY) return base;
  return `${base} translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`;
}

export function useChartTooltip(): ChartTooltipApi {
  const box = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    rectWidth: number;
    rectHeight: number;
    content: ReactNode;
  } | null>(null);

  const show = useCallback((event: ReactMouseEvent, content: ReactNode) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      rectWidth: rect.width,
      rectHeight: rect.height,
      content,
    });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  const layer =
    tip === null ? null : (
      <div
        role="presentation"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: tooltipTransform(tip.x, tip.y, tip.rectWidth, tip.rectHeight),
          maxWidth: '18rem',
          pointerEvents: 'none',
          zIndex: 5,
          background: 'var(--surface-solid)',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--ovl-radius-sm)',
          boxShadow: 'var(--ovl-shadow-raised)',
          padding: '0.4rem 0.55rem',
          fontSize: 'var(--ovl-fs-micro)',
          lineHeight: 1.35,
          color: 'var(--ink)',
        }}
      >
        {tip.content}
      </div>
    );

  return {
    containerRef: (node) => {
      box.current = node;
    },
    show,
    hide,
    layer,
  };
}

/* ═══════════════════════════ 3. Rám grafu ═════════════════════════════════ */

export interface ChartFrameProps {
  title: string;
  /** Jedna veta: čo graf hovorí a z čoho to appka vie (I11). */
  subtitle?: ReactNode;
  legend?: ReactNode;
  note?: ReactNode;
  /** Inline SVG. */
  children: ReactNode;
  /** Povinná tabuľková alternatíva — každý graf ju má (plán §4). */
  table: ReactNode;
  /** Ref a vrstva tooltipu z `useChartTooltip()`. */
  tooltip?: ChartTooltipApi;
  testId?: string;
  /** Akcia v hlavičke grafu (napr. prepínač rozsahu). */
  action?: ReactNode;
}

export function ChartFrame({
  title,
  subtitle,
  legend,
  note,
  children,
  table,
  tooltip,
  testId,
  action,
}: ChartFrameProps) {
  return (
    <figure
      className="ovl-stack"
      style={{ margin: 0, gap: '0.35rem' }}
      data-testid={testId}
      data-chart="1"
    >
      <figcaption style={{ width: '100%' }}>
        <div className="ovl-spread">
          <h3 style={{ margin: 0 }}>{title}</h3>
          {action}
        </div>
        {subtitle ? (
          <p className="ovl-small ovl-muted" style={{ margin: '0.15rem 0 0' }}>
            {subtitle}
          </p>
        ) : null}
      </figcaption>
      {legend}
      <div
        ref={tooltip?.containerRef}
        style={{ position: 'relative', width: '100%' }}
        onMouseLeave={tooltip?.hide}
      >
        {children}
        {tooltip?.layer}
      </div>
      {note}
      <details className="ovl-chart-table" style={{ width: '100%' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--dim)' }}>Zobraziť ako tabuľku</summary>
        <div style={{ marginTop: '0.4rem' }}>{table}</div>
      </details>
    </figure>
  );
}

/* ═══════════════════════ 4. Stavy načítania ═══════════════════════════════ */

export function ChartSkeleton({ height = 160, label }: { height?: number; label: string }) {
  return (
    <div
      className="ovl-shimmer"
      style={{ height: `${height}px`, width: '100%' }}
      aria-busy="true"
      aria-label={label}
    />
  );
}

/** Prázdny stav grafu — vždy povie, čo urobiť, nie len „žiadne dáta". */
export function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="ovl-note" style={{ margin: 0 }}>
      <span className="ovl-note-glyph" aria-hidden="true">
        ○
      </span>
      {children}
    </p>
  );
}

export default ChartFrame;
