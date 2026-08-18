/**
 * Aura Zľavy — TAB 1: Prehľad (V9, architektúra §1).
 *
 * Prístrojová doska. Odpovedá na JEDNU otázku — „je všetko v poriadku?" — a
 * podľa nej je vybraná dominanta: verdikt jednou vetou, nie číslo fronty.
 * Najviac štyri sekcie (Stav · prekážky · Zľavy · Predaj), v pokojnom stave
 * tri. Jediný rozklik je dôvod pomlčky, keď sa stav fronty nedá prečítať.
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
