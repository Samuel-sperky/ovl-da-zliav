/**
 * Aura Zľavy — `/zlavy` (V11; kontrakt V3 K9, architektúra §1 TAB 3).
 *
 * Tab odpovedá na „ktoré zľavy bežia, čo sa práve zapisuje a čo skončilo".
 * Stránka je server komponent a robí presne jednu vec: pomenuje záložku
 * prehliadača. Dáta číta až klient z `/api/campaigns`, takže `next build`
 * nepotrebuje bežiacu databázu.
 *
 * Vlastník: V11.
 */
import type { Metadata } from 'next';

import DiscountsList from '@/components/campaigns/DiscountsList';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Zľavy — ${APP_DISPLAY_NAME}`,
};

export default function DiscountsPage() {
  return <DiscountsList />;
}
