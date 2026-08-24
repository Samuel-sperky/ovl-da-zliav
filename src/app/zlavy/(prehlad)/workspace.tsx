'use client';

/**
 * Aura Zľavy — shell tabu Zľavy: rebrík vľavo, detail vpravo (K1, šprint 20).
 *
 * Prečo je to samostatný klientský komponent a nie priamo layout:
 * `app/zlavy/(prehlad)/layout.tsx` je serverový a nesmie čítať adresu. Ktorá
 * zľava je otvorená, sa pritom NESMIE držať v stave — jediným zdrojom pravdy
 * je adresa, inak by prestal fungovať priamy odkaz na `/zlavy/[id]`, obnovenie
 * stránky aj tlačidlo Späť. Tento komponent preto adresu iba prečíta
 * (`usePathname`) a posunie ďalej ako číslo.
 *
 * Detail sa sem dostáva ako `children` z trasy `/zlavy/[id]`, teda ako slot.
 * Next.js layout sa medzi súrodeneckými trasami neodmountuje, takže rebrík
 * ostáva načítaný a klik na riadok vymení len pravý stĺpec.
 *
 * Vlastník: V11.
 */
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import DiscountsList from '@/components/campaigns/DiscountsList';

/**
 * `/zlavy/12` → `12`; `/zlavy`, `/zlavy/nova` aj čokoľvek iné → `null`.
 *
 * Zámerne prísne: len kladné celé číslo. Rovnaký tvar overuje aj serverová
 * stránka `[id]/page.tsx` — keď sa v adrese ocitne nezmysel, rebrík nesmie
 * podčiarknuť náhodný riadok.
 */
export function selectedIdFromPath(pathname: string): number | null {
  const found = /^\/zlavy\/(\d+)$/.exec(pathname);
  if (found === null) return null;
  const id = Number(found[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function DiscountsWorkspace({ children }: { children: ReactNode }) {
  return <DiscountsList selectedId={selectedIdFromPath(usePathname())} detail={children} />;
}

export default DiscountsWorkspace;
