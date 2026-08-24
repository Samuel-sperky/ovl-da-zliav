/**
 * Aura Zľavy — spoločný shell trás `/zlavy` a `/zlavy/[id]` (K1, šprint 20).
 *
 * Skupina `(prehlad)` neexistuje v adrese — je tu len preto, aby sa tento
 * layout NEDOSTAL na `/zlavy/nova`. Sprievodca novou zľavou je celoobrazovkové
 * rozhodnutie a rebrík zliav vedľa neho nemá čo robiť.
 *
 * Layout je tu ten nosný trik celej vlny: Next.js ho medzi súrodeneckými
 * trasami neodmountuje, takže rebrík zliav a jeho načítané dáta prežijú klik
 * na riadok. Trasa `/zlavy/[id]` zostáva plnohodnotná — priamy odkaz aj
 * obnovenie stránky vykreslia layout a stránku naraz, tlačidlo Späť vracia na
 * `/zlavy`, kde je pravý stĺpec zase kartou zľavy na čele.
 *
 * Vlastník: V11.
 */
import type { ReactNode } from 'react';

import DiscountsWorkspace from './workspace';

export default function DiscountsLayout({ children }: { children: ReactNode }) {
  return <DiscountsWorkspace>{children}</DiscountsWorkspace>;
}
