'use client';

/**
 * Aura Zľavy — G6: TTL kľúča ako oblúk (plán §4).
 *
 * Toto **nie je graf**: jedna hodnota si chart nezaslúži. Je to hero číslo
 * (`47 h 59 min`) a okolo neho oblúk celku 48 h. Farba prechádza
 * `--st-good → --st-attention` (≤ 6 h) → `--st-critical` (≤ 1 h), a pretože
 * farba nikdy nestojí sama, oblúk sprevádza glyf aj slovenský text.
 *
 * I1: komponent nevidí a nikdy nedostane API kľúč — pracuje výhradne so
 * zostávajúcimi sekundami. Ani `last4`, ani nič, čo by kľúč pripomínalo.
 *
 * D5: TTL sa nesmie skrývať ani na mobile — komponent preto nemá „compact"
 * režim, ktorý by hodnotu vypustil; má len menší priemer.
 *
 * Vlastník: B2.
 */
import { formatCountdownSk } from '@/lib/ui/format';
import { KEY_TTL_SECONDS, arcDash, toneColor, ttlArc } from '@/components/charts/chart-utils';

export interface KeyTtlArcProps {
  /** Zostávajúce sekundy platnosti kľúča; `null` = kľúč chýba alebo expiroval. */
  secondsLeft: number | null;
  /** Celková dĺžka TTL v sekundách (48 h). */
  totalSeconds?: number;
  /** Priemer oblúka v px. */
  size?: number;
}

export function KeyTtlArc({
  secondsLeft,
  totalSeconds = KEY_TTL_SECONDS,
  size = 92,
}: KeyTtlArcProps) {
  const arc = ttlArc(secondsLeft, totalSeconds);
  const color = toneColor(arc.tone);
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const center = size / 2;
  const { dash, gap } = arcDash(arc.fraction, radius);
  const text = secondsLeft == null ? 'kľúč chýba' : formatCountdownSk(secondsLeft);
  const full = `Platnosť API kľúča: ${text} — ${arc.label}.`;

  return (
    <div className="ovl-row" style={{ gap: '0.75rem', alignItems: 'center' }} data-testid="key-ttl-arc">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={full}
        style={{ flex: '0 0 auto' }}
      >
        <title>{full}</title>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
        />
        {arc.fraction > 0 ? (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${gap}`}
            transform={`rotate(-90 ${center} ${center})`}
          />
        ) : null}
        <text
          x={center}
          y={center + 5}
          fontSize={16}
          fontWeight={700}
          fill={color}
          textAnchor="middle"
          aria-hidden="true"
        >
          {arc.glyph}
        </text>
      </svg>
      <div className="ovl-stack" style={{ gap: '0.1rem' }}>
        <span className="ovl-eyebrow">Platnosť API kľúča</span>
        <span className="ovl-stat" data-testid="key-ttl-value">
          {text}
        </span>
        <span className="ovl-small ovl-muted">
          <span aria-hidden="true">{arc.glyph} </span>
          {arc.label} · celé okno je 48 h
        </span>
      </div>
    </div>
  );
}

export default KeyTtlArc;
