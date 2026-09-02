/**
 * Aura Zľavy — téma appky: kľúč v `localStorage` a pred-paint bootstrap.
 *
 * Zámerne BEZ `'use client'`: modul číta server (`layout.tsx` vkladá skript)
 * aj klient (`ThemeToggle`). Keby mal direktívu, server by z konštanty dostal
 * client-reference proxy a skript by sa rozbil.
 *
 * TMAVÁ je od V6a predvolená (D131, D145): nesie ju HOLÝ `:root`, svetlá je
 * prepis pod `:root[data-theme="light"]`. Preto tu platia tri stavy, nie dva:
 *
 *   `data-theme="light"`  … svetlá téma (vypýtal si ju používateľ, alebo ju
 *                            hlási systém),
 *   `data-theme="dark"`   … tmavá téma vypýtaná používateľom,
 *   atribút CHÝBA         … tmavá téma z holého `:root`.
 *
 * Bootstrap preto pri voľbe „systém" (v `localStorage` nič nie je) atribút
 * NEMAŽE, ale sa systému spýta a pri svetlej stampuje `light` EXPLICITNE. Do
 * V6a to bolo naopak — mazanie atribútu znamenalo „nechaj rozhodnúť
 * `@media (prefers-color-scheme: dark)`", lebo svetlá stála na holom `:root`.
 * Po obrátení tém by to isté mazanie znamenalo „vždy tmavá" a používateľ so
 * svetlým OS by dostal tmavú appku bez toho, aby si o ňu povedal.
 *
 * `matchMedia` sa v skripte volá defenzívne: keď ho prehliadač nemá, zostane
 * atribút nenastavený, čo je po D145 tmavá — teda predvolená, nie chyba.
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
)});var r=document.documentElement;if(t==="dark"||t==="light"){r.setAttribute("data-theme",t)}else if(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches){r.setAttribute("data-theme","light")}else{r.removeAttribute("data-theme")}}catch(e){}`;
