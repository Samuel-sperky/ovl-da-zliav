'use client';

/**
 * Aura Zľavy — drawer sprava v štýle predlohy (KISS, plán 33 §1 bod 7, §3).
 *
 * Čistý UI obal: backdrop + panel sprava, sticky hlavička a pätička,
 * Escape/klik na backdrop zatvára, fokus ide pri otvorení do panelu.
 *
 * BEZPEČNOSŤ (I3): drawer je len geometria — NIJAKO nemení pravidlá zápisu.
 * Obsah drawera novej kampane (C3) MUSÍ prejsť dry-run + potvrdením presne
 * ako predtým samostatná stránka; drawer žiadny krok neobchádza.
 *
 * Vlastník: C1. Používajú C2 (pridanie produktu, detail auditu) a C3
 * (nová kampaň — 2 kroky v tom istom draweri).
 */
import { useEffect, useRef, type ReactNode } from 'react';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Drobný popis pod titulom. */
  subtitle?: ReactNode;
  /** Sticky pätička — akcie (Zrušiť / pokračovanie krokov). */
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}

export function Drawer({ open, onClose, title, subtitle, footer, children, testId }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ovl-drawer-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="ovl-drawer"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        {...(testId ? { 'data-testid': testId } : {})}
      >
        <div className="ovl-drawer-head">
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {subtitle !== undefined ? (
              <p className="ovl-small ovl-muted" style={{ margin: '0.15rem 0 0' }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="ovl-btn ovl-btn--small"
            aria-label="Zavrieť"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="ovl-drawer-body">{children}</div>
        {footer !== undefined ? <div className="ovl-drawer-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export default Drawer;
