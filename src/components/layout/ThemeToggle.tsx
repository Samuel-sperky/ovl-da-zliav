'use client';

/**
 * Aura Zľavy — prepínač témy v hlavičke (V3, ARCHITEKTURA §0).
 *
 * Jedno okrúhle tlačidlo `.tglt` úplne vpravo. Svetlá téma je predvolená,
 * takže v nej ponúka mesiac (= prepni na tmavú) a v tmavej slnko.
 *
 * `aria-label` hovorí CIEĽ, nie stav („Prepnúť na tmavú tému"). Stav by
 * čítačke nepovedal, čo klik urobí, a používateľ by musel hádať — presne to
 * bola chyba do 19. 8. 2026, keď tu stálo len „Prepnúť tému". Meno nesie
 * TLAČIDLO, ikona zostáva `aria-hidden`; inak by sa prečítalo dvakrát.
 *
 * Prepínač píše explicitnú voľbu do `localStorage` aj na `<html>`; kým žiadna
 * voľba nie je, atribút na `<html>` chýba a tému určuje systém. Na serveri sa
 * teda nedá vedieť, čo používateľ uvidí — preto sa prvý render robí vždy ako
 * svetlý a zosúladenie beží až v `useEffect`. Blikanie tým nevzniká: farby
 * mení CSS, nie tento komponent, a `THEME_BOOTSTRAP_SCRIPT` nastaví atribút
 * pred prvým paintom.
 *
 * Neukladá nič na server a nič neposiela do auditu — je to čisto vizuálna
 * voľba jedného prehliadača.
 */
import { useEffect, useState } from 'react';

import Icon from '@/components/ui/Icon';

import {
  THEME_STORAGE_KEY,
  effectiveTheme,
  parseStoredTheme,
  type Theme,
} from '@/components/layout/theme';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  const stored = parseStoredTheme(attr);
  const systemDark =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false;
  return effectiveTheme(stored, systemDark);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Súkromný režim bez localStorage — téma platí len pre túto reláciu.
    }
  }

  /* Cieľ, nie stav: tlačidlo v tmavej téme prepína na svetlú. */
  const target = `Prepnúť na ${theme === 'dark' ? 'svetlú' : 'tmavú'} tému`;

  return (
    <button
      type="button"
      className="tglt"
      onClick={toggle}
      aria-label={target}
      title={target}
      data-testid="theme-toggle"
      data-theme-state={theme}
      suppressHydrationWarning
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={0.95} />
    </button>
  );
}

export default ThemeToggle;
