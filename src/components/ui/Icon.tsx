/**
 * Aura Zľavy — JEDNA IKONOVÁ SADA (monochromatická, kreslená, bez knižnice).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LICENČNÉ OZNÁMENIE
 *
 * Tvary ikon sú odvodené z Lucide (https://lucide.dev), verzia 1.32.0.
 *
 *   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-present
 *   as part of Feather (MIT). All other copyright (c) for Lucide are held by
 *   Lucide Contributors 2022.
 *
 *   Permission to use, copy, modify, and/or distribute this software for any
 *   purpose with or without fee is hereby granted, provided that the above
 *   copyright notice and this permission notice appear in all copies.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 *   WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 *   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 *   ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 *   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 *   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 *   OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * (ISC; časť ikon odvodených z Feather je MIT.) Oznámenie zostáva v tomto
 * súbore — je to podmienka licencie, nie poznámka pod čiarou.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PREČO NIE `lucide-react`
 * ------------------------
 *
 * 1. **Server-safe primitíva.** `lucide-react` má v `dist/esm/Icon.mjs`
 *    direktívu `"use client"`. Appka má šesť serverových obrazoviek a zámerne
 *    serverové primitíva (`LockBadge.tsx`, `primitives.ts` — pozri ich
 *    hlavičky). Jeden import knižnice by z každého badge, každej vysvetlivky
 *    a každého riadku prekážky spravil klientsky komponent.
 * 2. **Mriežka.** Sloty na značky sú v tejto appke 10–12,5 px
 *    (`globals.css`: `.sig::before` 10 px, `.state .g` 11 px, `.sig.lock` 12 px).
 *    Lucide kreslí na mriežku 24 s hrúbkou ťahu 2; zmenšené na 11 px z toho
 *    ostane kaša. **Tu sa kreslí na mriežku 16 s hrúbkou 1,5** — a nič iné.
 *    Kto pridá cestu, prepočíta ju na 16-mriežku, inak sa sada rozíde.
 * 3. **Pätnásť ikon z 1 650** je nákup skladu kvôli jednej skrutke.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Ikona NIKDY nenahrádza slovo.** Pravidlo appky znie „stav nie je nikdy
 *     len farba — vždy farba + glyf + text" a je zmerané: pod deuteranopiou
 *     nesie rozdiel susedných tónov len jas, takže SLOVO je jediný spoľahlivý
 *     kanál. Ikona je TRETÍ kanál, nie prvý.
 *  B. **Ikona dedí farbu textu.** `stroke="currentColor"`, žiadna vlastná
 *     farba, žiadna výplň. Teal, `--brand` ani zlatá nekódujú stav (stráži
 *     `test/unit/paleta.spec.ts`) a ikona to nesmie obísť zadnými dverami.
 *  C. **Rozmer je v `em`, nie v `px`** — značka rastie a klesá s textom, pri
 *     ktorom stojí.
 *  D. **Predvolene `aria-hidden`.** `role="img"` a slovenský `aria-label` len
 *     tam, kde je ikona JEDINÝM nositeľom významu. V tlačidle bez viditeľného
 *     textu meno nesie `aria-label` TLAČIDLA — nikdy oboje naraz, čítačka by
 *     to prečítala dvakrát.
 *
 * `ICON_PATHS` je zároveň jediný zdroj tvarov pre CSS: `globals.css` má tie
 * isté cesty zapečené do `--ic-*` masiek (pseudo-prvky sa inak nakresliť
 * nedajú) a `test/unit/ikony.spec.ts` porovnáva, či sa obe kópie zhodujú.
 *
 * Vlastník: I1, vlna „bez emoji" 19. 8. 2026.
 */
import type { SVGProps } from 'react';

/** Mriežka, na ktorej sú nakreslené všetky cesty. Nemení sa. */
export const ICON_GRID = 16;

/** Hrúbka ťahu na mriežke 16. Nemení sa — pozri bod 2 hlavičky. */
export const ICON_STROKE = 1.5;

/**
 * Tvary. Kľúč je meno ikony, hodnota sú `d` jednotlivých ciest.
 *
 * Všetko sú ťahy (`fill="none"`), aj kruhy — jednotný tvar dát je to, čo
 * dovoľuje CSS maskám a `<Icon>` zdieľať jeden zdroj. Kto sem pridá výplň,
 * rozbije `test/unit/ikony.spec.ts`.
 */
export const ICON_PATHS = {
  /** Kríž. Odmietnutie / zastavený zápis a zároveň „zavrieť" (Lucide `x`). */
  x: ['M12.5 3.5 3.5 12.5', 'M3.5 3.5 12.5 12.5'],
  /** Trojuholník s výkričníkom — „pozor" (Lucide `triangle-alert`). */
  alertTriangle: [
    'M7.05 2.6 1.3 12.7a1.1 1.1 0 0 0 .95 1.65h11.5a1.1 1.1 0 0 0 .95-1.65L8.95 2.6a1.1 1.1 0 0 0-1.9 0Z',
    'M8 6.2v3.2',
    'M8 12.05h.01',
  ],
  /** Fajka — „v poriadku" (Lucide `check`). */
  check: ['M13.5 4.5 6 12 2.5 8.5'],
  /** Prázdny krúžok — „nečinné, nič sa nedeje" (Lucide `circle`). */
  circle: ['M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13Z'],
  /** Krúžok s bodkou — „beží" (Lucide `circle-dot`). */
  circleDot: [
    'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13Z',
    'M8 6.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2Z',
  ],
  /** Neúplný kruh — „prebieha" (Lucide `loader-circle`). */
  loader: ['M14.5 8a6.5 6.5 0 1 1-4.49-6.18'],
  /** Plný štvorec obrysom — „strop vyčerpaný" (Lucide `square`). */
  square: ['M3.6 2.6h8.8a1 1 0 0 1 1 1v8.8a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1Z'],
  /** Visiaci zámok — „zamknuté / vypýta si heslo" (Lucide `lock`). */
  lock: [
    'M3.3 7.2h9.4a1.1 1.1 0 0 1 1.1 1.1v4.9a1.1 1.1 0 0 1-1.1 1.1H3.3a1.1 1.1 0 0 1-1.1-1.1V8.3a1.1 1.1 0 0 1 1.1-1.1Z',
    'M4.8 7.2V5a3.2 3.2 0 0 1 6.4 0v2.2',
  ],
  /** Šípka hore — „nárast" (Lucide `arrow-up`). */
  arrowUp: ['M8 13.2V2.8', 'M3.6 7.2 8 2.8l4.4 4.4'],
  /** Šípka dole — „pokles" (Lucide `arrow-down`). */
  arrowDown: ['M8 2.8v10.4', 'M12.4 8.8 8 13.2l-4.4-4.4'],
  /** Šípka vpravo — „bez zmeny" (Lucide `arrow-right`). */
  arrowRight: ['M2.8 8h10.4', 'M8.8 3.6 13.2 8l-4.4 4.4'],
  /** Strieška hore — „triedené vzostupne" (Lucide `chevron-up`). */
  chevronUp: ['M12 10 8 6l-4 4'],
  /** Strieška dole — „triedené zostupne" (Lucide `chevron-down`). */
  chevronDown: ['M4 6l4 4 4-4'],
  /** Slnko — „prepni na svetlú tému" (Lucide `sun`). */
  sun: [
    'M8 5.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 1 0 0-5.4Z',
    'M8 1.2v1.3',
    'M8 13.5v1.3',
    'M1.2 8h1.3',
    'M13.5 8h1.3',
    'M3.22 3.22l.92.92',
    'M11.86 11.86l.92.92',
    'M12.78 3.22l-.92.92',
    'M4.14 11.86l-.92.92',
  ],
  /** Mesiac — „prepni na tmavú tému" (Lucide `moon`). */
  moon: ['M8 2a4.2 4.2 0 0 0 6 6 6 6 0 1 1-6-6Z'],
} as const satisfies Record<string, readonly string[]>;

/** Meno ikony zo sady. Iné mená neexistujú — sada sa rozširuje tu, nikde inde. */
export type IconName = keyof typeof ICON_PATHS;

/** Mená v poradí deklarácie — pre testy a prehľady. */
export const ICON_NAMES = Object.keys(ICON_PATHS) as readonly IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
  /** Ktorá ikona zo sady. */
  name: IconName;
  /**
   * Slovenské meno pre čítačku. Uveď LEN vtedy, keď je ikona jediným
   * nositeľom významu. Keď pri nej stojí slovo (badge, vysvetlivka, riadok
   * prekážky) alebo keď meno nesie `aria-label` tlačidla, nechaj to prázdne —
   * ikona zostane `aria-hidden` a čítačka nič neprečíta dvakrát (bod D).
   */
  label?: string;
  /** Násobok veľkosti textu. `1` = 1 em; menšie značky si pýtajú 0,85–0,9. */
  size?: number;
}

/**
 * Ikona zo sady. Server-safe: žiadne hooky, žiadne `use client`.
 */
export function Icon({ name, label, size = 1, className, ...rest }: IconProps) {
  const a11y =
    label === undefined
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': label } as const);
  const classes = ['ovl-ic', className ?? ''].filter(Boolean).join(' ');
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${ICON_GRID} ${ICON_GRID}`}
      width={`${size}em`}
      height={`${size}em`}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={classes}
      {...a11y}
      {...rest}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export default Icon;
