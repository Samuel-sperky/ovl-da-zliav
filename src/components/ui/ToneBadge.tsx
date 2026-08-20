/**
 * Aura Zľavy — stavový badge ako primitív (32-UX-UI-PLAN §3.2, §3.3).
 *
 * Päť tónov (critical / attention / progress / good / idle) a tvrdé pravidlo:
 * **stav nie je nikdy len farba.** Každý badge nesie farbu + glyf + text,
 * pretože v darku je susedná dvojica critical↔attention pod deuteranopiou
 * takmer nerozlíšiteľná (ΔE 4,0). Glyf je dekoratívny (`aria-hidden`) — nesie
 * ho text, ktorý je pri ňom vždy.
 *
 * Teal (`--brand`) ani gold (`--gold`) sa tu NESMÚ objaviť: nikdy nekódujú stav.
 */
import type { HTMLAttributes, ReactNode } from 'react';

export type StatusTone = 'critical' | 'attention' | 'progress' | 'good' | 'idle';

/** Glyfy podľa §3.3 — jeden zdroj pravdy pre badge aj legendy grafov. */
export const TONE_GLYPH: Record<StatusTone, string> = {
  critical: '✕',
  attention: '▲',
  progress: '◐',
  good: '✓',
  idle: '○',
};

export interface ToneBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone: StatusTone;
  /** Glyf stavu (§3.3). Keď sa neuvedie, použije sa glyf tónu. */
  glyph?: string;
  children: ReactNode;
}

export function ToneBadge({ tone, glyph, children, className, ...rest }: ToneBadgeProps) {
  const classes = ['ovl-badge', `ovl-badge--${tone}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} {...rest}>
      <span className="ovl-badge-glyph" aria-hidden="true">
        {glyph ?? TONE_GLYPH[tone]}
      </span>
      {children}
    </span>
  );
}

export default ToneBadge;
