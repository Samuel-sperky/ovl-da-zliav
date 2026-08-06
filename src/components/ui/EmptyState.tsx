/**
 * Aura Zľavy — prázdny stav v štýle predlohy (KISS, plán 33 §3).
 *
 * Ikona v soft ploche, tučný titulok, jednovetový popis a voliteľná akcia.
 * Poctivosť (I11): popis hovorí, čo appka VIE a NEVIE — prázdny stav nikdy
 * nepredstiera dáta (napr. sekcia „Výkon zliav" v Analytike).
 *
 * Vlastník: C1. Používajú C2 (Analytika — Výkon zliav) a C3.
 */
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Ikona (inline SVG / glyf) v soft ploche. */
  icon?: ReactNode;
  title: ReactNode;
  /** Jednovetový popis pod titulkom. */
  children?: ReactNode;
  /** Voliteľná akcia (tlačidlo / odkaz). */
  action?: ReactNode;
  testId?: string;
}

export function EmptyState({ icon, title, children, action, testId }: EmptyStateProps) {
  return (
    <div className="ovl-empty" {...(testId ? { 'data-testid': testId } : {})}>
      {icon !== undefined ? (
        <span className="ovl-empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : (
        <span className="ovl-empty-orbit" aria-hidden="true" />
      )}
      <strong>{title}</strong>
      {children !== undefined ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export default EmptyState;
