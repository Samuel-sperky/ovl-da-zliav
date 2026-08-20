'use client';

/**
 * Aura Zľavy — prepínač témy v hlavičke (V3, ARCHITEKTURA §0).
 *
 * Jedno okrúhle tlačidlo `.tglt` úplne vpravo. Svetlá téma je predvolená,
 * takže v nej ponúka mesiac (☾ = prepni na tmavú) a v tmavej slnko.
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

  return (
    <button
      type="button"
      className="tglt"
      onClick={toggle}
      aria-label="Prepnúť tému"
      title={`Prepnúť na ${theme === 'dark' ? 'svetlú' : 'tmavú'} tému`}
      data-testid="theme-toggle"
      data-theme-state={theme}
      suppressHydrationWarning
    >
      <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
    </button>
  );
}

export default ThemeToggle;
