/**
 * Aura Zľavy — toolbar nad tabuľkou/zoznamom (KISS, plán 33 §3).
 *
 * Geometria z predlohy: jedna karta s dvoma skupinami — vľavo hľadanie
 * a filtre (`children`), vpravo sekundárne akcie (`actions`). Na mobile sa
 * skupiny skladajú pod seba (CSS `.ovl-toolbar`).
 *
 * Vlastník: C1. Používajú C2 (Produkty, Analytika) a C3 (Kampane).
 */
import type { ReactNode } from 'react';

export interface ToolbarProps {
  /** Ľavá skupina — hľadanie, filtre. */
  children: ReactNode;
  /** Pravá skupina — sekundárne akcie (napr. „Vyčistiť filtre"). */
  actions?: ReactNode;
  /** Popis pre čítačky. */
  ariaLabel?: string;
}

export function Toolbar({ children, actions, ariaLabel }: ToolbarProps) {
  return (
    <div className="ovl-toolbar" role="group" {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}>
      <div className="ovl-toolbar-group">{children}</div>
      {actions !== undefined ? <div className="ovl-toolbar-group">{actions}</div> : null}
    </div>
  );
}

export default Toolbar;
