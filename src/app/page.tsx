/**
 * Aura Zľavy — dashboard (A13, D1).
 *
 * Kombinovaná hlavná obrazovka: stav kľúča (`KeyCard`), agregovaný banner
 * `needs_key` + `missed` s rovnakou vizuálnou váhou (`AlertsBanner`, D8/D33b),
 * neodklikané výsledky (`UnackedResults`, D17), mini prehľad kampaní
 * a mriežka 10 allowlist produktov s badge „podľa vlastného zápisu z DD.MM."
 * (D7, I11). Dáta číta klient z API kontraktu §5 — `next build` nezávisí
 * od bežiacej DB.
 */
import type { Metadata } from 'next';

import Dashboard from '@/components/dashboard/Dashboard';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Dashboard — ${APP_DISPLAY_NAME}`,
};

export default function DashboardPage() {
  return (
    <>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 1rem' }}>Dashboard</h1>
      <Dashboard />
    </>
  );
}
