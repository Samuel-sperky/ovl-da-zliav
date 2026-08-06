/**
 * Aura Zľavy — dashboard (KISS redizajn, plán 33 §3, sekcia C1).
 *
 * KISS kompozícia: page-head s eyebrow a „+ Nová kampaň", 3 KPI karty
 * (aktívne zľavy n/10 · vyžaduje zásah · TTL kľúča s oblúkom G6), časová os
 * kampaní (G1), riadok najbližšieho spustenia a banner zásahu len keď n > 0.
 * Dáta číta klient z API kontraktu §5 — `next build` nezávisí od bežiacej DB.
 */
import type { Metadata } from 'next';

import Dashboard from '@/components/dashboard/Dashboard';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Dashboard — ${APP_DISPLAY_NAME}`,
};

export default function DashboardPage() {
  return <Dashboard />;
}
