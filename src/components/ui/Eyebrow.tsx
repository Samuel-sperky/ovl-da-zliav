/**
 * Aura Zľavy — eyebrow text nad titulom stránky (KISS, plán 33 §2/§3).
 *
 * Predloha ho má modrý; rodinné pravidlo (plán 32 §3.1) ho prepisuje na
 * `--gold` — gold je výhradne koruna, hairline a eyebrow, NIKDY stav.
 *
 * Vlastník: C1. Používajú C2/C3 v page-head svojich stránok.
 */
import type { ReactNode } from 'react';

export interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <p className={['ovl-eyebrow ovl-kiss-eyebrow', className].filter(Boolean).join(' ')}>
      {children}
    </p>
  );
}

export default Eyebrow;
