/**
 * Aura Zľavy — SNÍMKOVAČ: `next/link` bez Next.js.
 *
 * Snímkovač beží ako obyčajná stránka, nie ako Next.js appka, takže `Link`
 * nemá router, do ktorého by navigoval. Odkaz sa preto vykreslí ako `<a>` —
 * presne to, čo vykreslí aj Next.js. Rozdiel je len v tom, čo sa stane po
 * kliknutí, a na snímke sa neklikne na nič, čo naviguje.
 *
 * Vlastnosti smerovania (`prefetch`, `replace`, `scroll`, …) sa do DOM
 * NEPREPÍŠU: prehliadač by ich hlásil ako neznáme atribúty a v konzole by
 * vznikol šum, ktorý nie je vinou appky.
 *
 * Vlastník: snímkovač (`scripts/snimky.ts`).
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react';

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children?: ReactNode;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
}

export default function Link({
  prefetch: _prefetch,
  replace: _replace,
  scroll: _scroll,
  shallow: _shallow,
  passHref: _passHref,
  legacyBehavior: _legacyBehavior,
  ...zvysok
}: LinkProps) {
  return <a {...zvysok} />;
}
