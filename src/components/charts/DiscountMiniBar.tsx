'use client';

/**
 * Aura Zľavy — mini bar z G2 pre kartu produktu (plán §4, „zobrazenia produktov").
 *
 * Tá istá sekvenčná teal rampa a tá istá os 0–30 % ako v G2, len bez rámu,
 * legendy a tabuľky — karta ich má v okolí. Sekvenčná teal kóduje MAGNITÚDU,
 * nie stav; stavová paleta sa tu nepoužíva.
 *
 * Bez vlastného zápisu sa kreslí prázdna dráha — appka netvrdí nič, čo nevie
 * (I11). Hodnota je vždy aj v texte (`aria-label`), nikdy len vo farbe.
 *
 * Vlastník: B2.
 */
import { formatPercentSk } from '@/lib/ui/format';
import { PERCENT_CAP, barPathRightRounded, sequentialColor } from '@/components/charts/chart-utils';

export interface DiscountMiniBarProps {
  /** Percento posledného vlastného zápisu; `null` = žiadny zápis. */
  percent: number | null;
  /** Šírka vo viewBox jednotkách. */
  width?: number;
}

export function DiscountMiniBar({ percent, width = 120 }: DiscountMiniBarProps) {
  const height = 8;
  const value = percent == null ? 0 : Math.max(0, Math.min(PERCENT_CAP, percent));
  const barWidth = (width * value) / PERCENT_CAP;
  const label =
    percent == null
      ? 'bez vlastného zápisu — appka na tento produkt nikdy nezapísala zľavu'
      : `${formatPercentSk(percent)} podľa vlastného zápisu, os 0 až 30 %`;

  return (
    <svg
      className="ovl-chart"
      viewBox={`0 0 ${width} ${height}`}
      height={height}
      role="img"
      aria-label={label}
      style={{ width: '100%', maxWidth: `${width}px`, height: `${height}px`, overflow: 'visible' }}
    >
      <title>{label}</title>
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={4}
        fill="none"
        stroke="var(--line)"
        strokeWidth={1}
        {...(percent == null ? { strokeDasharray: '3 4' } : {})}
      />
      {percent == null ? null : (
        <path
          className="ovl-anim-grow"
          d={barPathRightRounded(0, 0, barWidth, height, 4)}
          fill={sequentialColor(value)}
        />
      )}
    </svg>
  );
}

export default DiscountMiniBar;
