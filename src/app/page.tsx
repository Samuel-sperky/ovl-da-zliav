/**
 * Aura Zľavy — TAB 1: Prehľad (V9, architektúra §1).
 *
 * Prístrojová doska: čo sa práve zapisuje, čo čaká na rozhodnutie, ako sa
 * predáva a ktoré zľavy bežia. Štyri sekcie, jedna dominanta, žiadny rozklik.
 *
 * Stránka je zámerne chudobná — všetko vykresľuje klientský `Overview`, ktorý
 * číta štyri čítacie endpointy. `next build` tak nezávisí od bežiacej
 * databázy ani od kľúča do eshopu.
 */
import type { Metadata } from 'next';

import Overview from '@/components/dashboard/Overview';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Prehľad — ${APP_DISPLAY_NAME}`,
};

export default function OverviewPage() {
  return <Overview />;
}
