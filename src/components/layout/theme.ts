/**
 * Aura Zľavy — téma appky: kľúč v `localStorage` a pred-paint bootstrap.
 *
 * Zámerne BEZ `'use client'`: modul číta server (`layout.tsx` vkladá skript)
 * aj klient (`ThemeToggle`). Keby mal direktívu, server by z konstanty dostal
 * client-reference proxy a skript by sa rozbil.
 *
 * Dark je default rodiny (plán §2 bod 1): `:root` bez `data-theme` je dark,
 * `[data-theme="light"]` prepína. Skript sa vykoná pred prvým paintom, takže
 * svetlé pozadie nikdy nebliká.
 */
export const THEME_STORAGE_KEY = 'ovl-theme';

export type Theme = 'dark' | 'light';

/** Inline skript do `<body>` — bez závislostí, nič neposiela na server. */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});document.documentElement.setAttribute("data-theme",t==="light"?"light":"dark")}catch(e){document.documentElement.setAttribute("data-theme","dark")}`;
