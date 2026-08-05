'use client';

/**
 * Aura Zľavy — prepínač témy „Light pill" (32-UX-UI-PLAN §2 bod 1).
 *
 * Dark je default rodiny. Prepínač len prepisuje `data-theme` na `<html>` a
 * hodnotu si pamätá v `localStorage`; inline skript v `layout.tsx` ju aplikuje
 * pred prvým paintom, takže svetlé pozadie nikdy nebliká.
 *
 * Neukladá nič na server a nič neposiela do auditu — je to čisto vizuálna
 * voľba jedného prehliadača.
 */
import { useEffect, useState } from 'react';

import { THEME_STORAGE_KEY, type Theme } from '@/components/layout/theme';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function ThemeToggle() {
  // Server vykreslí dark (default) a klient sa po pripojení zosúladí s tým,
  // čo už nastavil inline skript.
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Súkromný režim bez localStorage — téma platí len pre túto reláciu.
    }
  }

  const label = theme === 'light' ? 'Tmavá' : 'Svetlá';
  return (
    <button
      type="button"
      className="ovl-theme-pill"
      onClick={toggle}
      aria-pressed={theme === 'light'}
      title={`Prepnúť na ${theme === 'light' ? 'tmavú' : 'svetlú'} tému`}
      data-testid="theme-toggle"
      data-theme-state={theme}
    >
      <span aria-hidden="true">{theme === 'light' ? '☾' : '☀'}</span>
      {label}
    </button>
  );
}

export default ThemeToggle;
