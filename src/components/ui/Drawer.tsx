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

/** Selektor fokusovateľných prvkov pre focus trap panelu. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Drawer({ open, onClose, title, subtitle, footer, children, testId }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // `onClose` cez ref: keydown efekt tak závisí len od `open` a pri každom
  // re-renderi rodiča nekradne fokus späť do panelu.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    // Návrat fokusu: zapamätaj si vyvolávajúci element a po zavretí mu fokus vráť.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Vnorený dialóg (napr. sudo) si Escape spracoval sám — drawer ho ignoruje.
        if (event.defaultPrevented) return;
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      // Focus trap: Tab/Shift+Tab cyklí VÝHRADNE v paneli (aria-modal má
      // zodpovedať realite — pozadie nie je inertné, tak fokus nepustíme von).
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open]);

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
