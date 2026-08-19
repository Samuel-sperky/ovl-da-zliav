/**
 * Aura Zľavy — stavový badge ako primitív (32-UX-UI-PLAN §3.2, §3.3).
 *
 * Päť tónov (critical / attention / progress / good / idle) a tvrdé pravidlo:
 * **stav nie je nikdy len farba.** Každý badge nesie farbu + značku + text,
 * pretože v darku je susedná dvojica critical↔attention pod deuteranopiou
 * takmer nerozlíšiteľná (ΔE 4,0). Značka je dekoratívna (`aria-hidden`) —
 * význam nesie text, ktorý je pri nej vždy.
 *
 * Teal (`--brand`) ani gold (`--gold`) sa tu NESMÚ objaviť: nikdy nekódujú stav.
 *
 * ZNAČKA JE OD 19. 8. 2026 IKONA, NIE ZNAK
 * ----------------------------------------
 * Do tohto dátumu tu stáli textové glyfy. Ani jeden z nich nebol v písme
 * Inter, ktoré appka dodáva — všetky padali na systémový symbolový zásobník,
 * takže sa kreslili iným písmom, s inou hrúbkou a na každom operačnom systéme
 * inak; zmeraná typografia sa ich vôbec netýkala. Nahradila ich sada
 * `ui/Icon.tsx` (mriežka 16, hrúbka 1,5, `currentColor`).
 */
import type { HTMLAttributes, ReactNode } from 'react';

import Icon, { type IconName } from '@/components/ui/Icon';

export type StatusTone = 'critical' | 'attention' | 'progress' | 'good' | 'idle';

/**
 * KOREŇOVÝ SLOVNÍK ZNAČIEK (§3.3) — jeden zdroj pravdy pre badge, pilulku,
 * vysvetlivku, chybovú hlášku aj legendy grafov.
 *
 * Odvodzuje sa z neho `NOTE_ICON` (`ui/primitives.ts`) aj značka chybovej
 * hlášky (`ui/ErrorMessage.tsx`), ktorá tu do 19. 8. 2026 mala DRUHÚ, ručne
 * písanú kópiu. Kto by si napísal vlastnú `Record<StatusTone, …>` tabuľku
 * značiek, otvorí presne tú chybu znova.
 */
export const TONE_ICON: Readonly<Record<StatusTone, IconName>> = {
  critical: 'x',
  attention: 'alertTriangle',
  progress: 'loader',
  good: 'check',
  idle: 'circle',
};


export interface ToneBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone: StatusTone;
  /** Značka stavu (§3.3). Keď sa neuvedie, použije sa ikona tónu. */
  icon?: IconName;
  children: ReactNode;
}

export function ToneBadge({ tone, icon, children, className, ...rest }: ToneBadgeProps) {
  const classes = ['ovl-badge', `ovl-badge--${tone}`, className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} {...rest}>
      <Icon className="ovl-badge-glyph" name={icon ?? TONE_ICON[tone]} size={0.9} />
      {children}
    </span>
  );
}

export default ToneBadge;
