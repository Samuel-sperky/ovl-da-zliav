/**
 * Aura Zľavy — KPI karta v mäkkom štýle predlohy (KISS, plán 33 §2/§3).
 *
 * Geometria z predlohy: label + soft ikona hore, hero hodnota, foot text,
 * kruhový akcent v pravom hornom rohu. Akcent je VŽDY v `--brand-tint`
 * a NIKDY v stavovej farbe (plán 33 §2 — mapa tokenov).
 *
 * `tone` farbí len hodnotu (`--st-*-ink`), a pretože stav nie je nikdy len
 * farba (plán 32 §3.3), volajúci pri tone MUSÍ niesť význam aj textom
 * (label/foot/glyf v hodnote).
 *
 * Bez `label` a `value` sa vykreslí len obal + `children` — pre bloky ako
 * TTL oblúk (G6), ktoré si hero číslo a popis kreslia samé.
 *
 * Vlastník: C1. Používajú C2/C3.
 */
import type { ReactNode } from 'react';

import type { StatusTone } from '@/components/ui/ToneBadge';

export interface KpiCardProps {
  label?: ReactNode;
  value?: ReactNode;
  /** Riadok drobného textu pod hodnotou. */
  foot?: ReactNode;
  /** Ikona v soft ploche vpravo od labelu (inline SVG / glyf). */
  icon?: ReactNode;
  /** Tón hodnoty — volajúci musí význam niesť aj textom, nie len farbou. */
  tone?: StatusTone;
  /** Kruhový akcent v rohu (default zapnutý); vždy `--brand-tint`. */
  accent?: boolean;
  /** Vlastný obsah pod hlavičkou (napr. TTL oblúk namiesto hodnoty). */
  children?: ReactNode;
  testId?: string;
}

export function KpiCard({
  label,
  value,
  foot,
  icon,
  tone,
  accent = true,
  children,
  testId,
}: KpiCardProps) {
  return (
    <article
      className="ovl-card ovl-kpi-card ovl-lift"
      data-accent={accent ? 'true' : 'false'}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {label !== undefined || icon !== undefined ? (
        <div className="ovl-kpi-top">
          {label !== undefined ? <span className="ovl-kpi-label">{label}</span> : <span />}
          {icon !== undefined ? (
            <span className="ovl-kpi-icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
        </div>
      ) : null}
      {value !== undefined ? (
        <div
          className="ovl-kpi-value"
          {...(tone ? { style: { color: `var(--st-${tone}-ink)` } } : {})}
        >
          {value}
        </div>
      ) : null}
      {children}
      {foot !== undefined ? <div className="ovl-kpi-foot">{foot}</div> : null}
    </article>
  );
}

export default KpiCard;
