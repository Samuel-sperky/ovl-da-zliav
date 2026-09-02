/**
 * Aura Zľavy — „TOTO SME NEMERALI" (I11; rodina stavov V6a).
 *
 * PREČO TENTO KOMPONENT V PREDLOHE NIE JE — A TU MUSÍ BYŤ
 * ------------------------------------------------------
 * `aura-roadmap` má päť stavov, pretože v nej má každé číslo dve možnosti:
 * je, alebo nie je. Táto appka má pri KAŽDOM čísle tri: je, nie je, alebo ho
 * appka nemerala. Tretia možnosť nie je vzácna — obohatiť sa dá ~600 produktov
 * denne zo 41 348, predaje sú kusy len za sťahované dni a `shop_write` kľúč
 * dnes chýba, takže „nemerali sme" je na väčšine plôch bežná odpoveď.
 *
 * Bez samostatného stavu má tá odpoveď dva východy a oba sú nepravda:
 *
 *   · `EmptyState` — „nič tu nie je". To je tvrdenie o obsahu, ktoré appka
 *     nemá čím doložiť. Používateľ z neho odíde s presvedčením, že sa nič
 *     nepredalo alebo že produkt zľavu nemá.
 *   · nula. To je to isté, len číslom, a je to presne to, čo I11 zakazuje.
 *
 * ROZDIEL MEDZI HODNOTOU A PLOCHOU
 * --------------------------------
 * Keď sa nevie JEDNA hodnota, priznanie je **pomlčka** (`PRODUCT_DASH`,
 * U+2014) s dôvodom v `title` bunky, prípadne šrafovaná plocha v grafe alebo
 * `≥` pri dolnej hranici. Tie sa týmto komponentom NENAHRADZUJÚ. `UnmeasuredState`
 * kreslí až prípad, keď je nemeraná CELÁ plocha a pomlčky by boli len šesťkrát
 * to isté bez jediného „prečo".
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **`reason` je POVINNÝ a NEPÍŠE sa tu.** Veta o tom, prečo appka nemerala,
 *    má jediný domov: `PRODUCT_GAP_REASON` (`lib/ui/product-columns.ts`), ktorý
 *    tú istú vetu dáva do `title` bunky. Panel a bunka musia hovoriť to isté;
 *    druhá, ručne napísaná veta by sa po prvej úprave rozišla. Volajúci ju sem
 *    podá — preto tu nemá default. (Rovnaké pravidlo ako `LockBadge.reason`:
 *    priznanie bez dôvodu je horšie než žiadne priznanie.)
 * 2. **Nemerané NIE JE porucha.** Vysvetlivka je `info`, nie `warn`: nesťahovať
 *    celý katalóg je aritmetika kvóty a plán, nie zlyhanie — tá istá úvaha ako
 *    „vyčerpaný denný rozpočet nie je chyba" (K2) a ako bod 3 v
 *    `products/enrich-note.ts`. Jantárová by z každého bežného dňa spravila
 *    poplach.
 * 3. **Odhad sa nedopĺňa.** Tento stav nemá čo ukázať; nesmie navrhnúť
 *    „približne" ani „zatiaľ 0". Buď je čo zmerať, alebo je tu táto veta.
 *
 * ČÍSLA PATRIA VEDĽA, NIE SEM
 * ---------------------------
 * Keď appka vie POVEDAŤ ČÍSLOM, koľko z denného cieľa obohatenia zostáva, má to
 * povedať — robí to `enrichPageNote()` (`products/enrich-note.ts`, R2). Tá veta
 * ide do `reason` vedľa vety o medzere (`reason` je `ReactNode`, takže
 * fragment dvoch vetí je v poriadku; vysvetlivka je odsek, nie nadpis). Slot
 * `note` prázdneho stavu je v tomto stave už obsadený samotným priznaním. Bez
 * čísla je „nemerali sme" pravdivé, ale nepoužiteľné: človek nevie, či má čakať
 * do polnoci, alebo niečo odblokovať.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a (rodina stavov, D134).
 */
import type { ReactNode } from 'react';

import EmptyState from '@/components/states/EmptyState';
import { STATE_STORY } from '@/components/states/state-copy';
import Note from '@/components/ui/Note';

export interface UnmeasuredStateProps {
  /** Nadpis. Predvolene veta príbehu „nevieme, lebo sme to nemerali". */
  title?: string;
  /** Jedna veta o tom, čo to znamená. Predvolená hovorí, že to nie je nula. */
  description?: ReactNode;
  /**
   * PREČO appka nemerala — veta z `PRODUCT_GAP_REASON`, nie vlastná. Povinné;
   * pozri bod 1 hlavičky.
   */
  reason: ReactNode;
  /**
   * Ďalší krok, ak nejaký JE (obohatiť stranu, spustiť synchronizáciu). Keď
   * neexistuje, radšej žiadne tlačidlo než tlačidlo, po ktorom sa nič nestane.
   */
  action?: ReactNode;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function UnmeasuredState({
  title = STATE_STORY.nemerane.title,
  description = STATE_STORY.nemerane.meaning,
  reason,
  action,
  testId,
}: UnmeasuredStateProps) {
  return (
    <EmptyState
      story="nemerane"
      title={title}
      description={description}
      note={<Note variant="info">{reason}</Note>}
      action={action}
      testId={testId}
    />
  );
}

export default UnmeasuredState;
