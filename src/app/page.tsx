/**
 * Aura Zľavy — TAB 1: Prehľad (V9, prestavaný V4; architektúra §1).
 *
 * Prvá strana. Od 28. 8. 2026 (D113) odpovedá na otázku **„čo sa predáva, čo
 * leží, čo robia moje zľavy"** — nie na „je všetko v poriadku?". Tá druhá
 * otázka nezmizla: nesie ju stavový PÁS v jednom riadku nad obsahom a sekcia
 * prekážok pod ním, ktorá sa v pokoji nekreslí vôbec. Kým je zeleno, stav
 * appky si neberie tretinu obrazovky.
 *
 * Poradie sekcií, okno 7/30/90 a dôvody, prečo je práve takto, sú v hlavičke
 * `components/dashboard/Overview.tsx`.
 *
 * Stránka je zámerne chudobná — všetko vykresľuje klientský `Overview`, ktorý
 * číta výhradne ČÍTACIE endpointy nad lokálnou databázou. `next build` tak
 * nezávisí od bežiacej databázy ani od kľúča do eshopu a na shop z tejto
 * obrazovky neodíde ani jeden request (K8).
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
