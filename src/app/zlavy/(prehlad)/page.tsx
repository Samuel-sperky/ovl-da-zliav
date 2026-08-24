/**
 * Aura Zľavy — `/zlavy` (V11; kontrakt V3 K9, architektúra §1 TAB 3).
 *
 * Tab odpovedá na „ktoré zľavy bežia, čo sa práve zapisuje a čo skončilo".
 * Od šprintu 20 kreslí celý pohľad — rebrík vľavo, detail vpravo — layout
 * `(prehlad)/layout.tsx`, aby prežil prechod na `/zlavy/[id]`. Tejto stránke
 * tak zostala jediná úloha: pomenovať záložku prehliadača. Dáta číta až klient
 * z `/api/campaigns`, takže `next build` nepotrebuje bežiacu databázu.
 *
 * Preto vracia `null`. Pravý stĺpec kreslí shell sám: kým nie je otvorená
 * žiadna zľava, stojí v ňom karta zľavy na čele, a tú vie zložiť len ten, kto
 * už má načítaný zoznam. Druhé načítanie tých istých dát len kvôli tejto
 * stránke by bol druhý zdroj pravdy o tom, ktorá zľava je na čele.
 *
 * Vlastník: V11.
 */
import type { Metadata } from 'next';

import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Zľavy — ${APP_DISPLAY_NAME}`,
};

export default function DiscountsPage() {
  return null;
}
