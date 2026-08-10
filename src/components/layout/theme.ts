/**
 * Aura Zľavy — téma appky: kľúč v `localStorage` a pred-paint bootstrap.
 *
 * Zámerne BEZ `'use client'`: modul číta server (`layout.tsx` vkladá skript)
 * aj klient (`ThemeToggle`). Keby mal direktívu, server by z konštanty dostal
 * client-reference proxy a skript by sa rozbil.
 *
 * V3 obracia predvolenú tému: SVETLÁ je default (ARCHITEKTURA §6). Preto tu
 * platia tri stavy, nie dva:
 *
 *   `data-theme="light"`  … používateľ si vypýtal svetlú (vyhráva aj nad
 *                            systémovo tmavým nastavením),
 *   `data-theme="dark"`   … používateľ si vypýtal tmavú,
 *   atribút CHÝBA         … nechávame rozhodnúť systém cez
 *                            `@media (prefers-color-scheme: dark)`.
 *
 * Tretí stav je dôvod, prečo bootstrap atribút MAŽE, keď v `localStorage` nič
 * nie je. Keby tam natvrdo písal `light`, guard `:root:not([data-theme="light"])`
 * by systémovú tmavú tému navždy zablokoval a používateľ s tmavým OS by dostal
 * svetlú appku bez toho, aby si o ňu povedal.
 */
export const THEME_STORAGE_KEY = 'ovl-theme';

export type Theme = 'dark' | 'light';

/** Uložená voľba: `null` = žiadna, rozhoduje systém. */
export function parseStoredTheme(raw: string | null): Theme | null {
  return raw === 'dark' || raw === 'light' ? raw : null;
}

/**
 * Téma, ktorú používateľ práve vidí. `stored === null` → rozhoduje systém.
 * Čistá funkcia, aby sa dala testovať bez DOM.
 */
export function effectiveTheme(stored: Theme | null, systemPrefersDark: boolean): Theme {
  if (stored !== null) return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

/** Inline skript do `<body>` — bez závislostí, nič neposiela na server. */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var r=document.documentElement;if(t==="dark"||t==="light"){r.setAttribute("data-theme",t)}else{r.removeAttribute("data-theme")}}catch(e){}`;
