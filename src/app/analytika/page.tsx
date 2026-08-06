/**
 * Aura Zľavy — `/analytika` (KISS, plán 33 §3 Analytika, sekcia C2).
 *
 * Filter-strip + grafy G2/G4/G3 + sekcia Audit (#audit, presunuté z bývalého
 * tabu Audit) + poctivá prázdna sekcia „Výkon zliav". Dáta číta klient
 * z `/api/*`, takže `next build` nepotrebuje bežiacu DB.
 */
import type { Metadata } from 'next';

import AnalyticsPanel from '@/app/analytika/AnalyticsPanel';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Analytika — ${APP_DISPLAY_NAME}`,
};

export default function AnalyticsPage() {
  return <AnalyticsPanel />;
}
