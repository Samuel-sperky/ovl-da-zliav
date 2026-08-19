/**
 * Aura Zľavy — `/nastavenia/cervena-zona` (kontrakt UI 13. 8. 2026, bod 13).
 *
 * Tenká cesta. Nadpis, úvodnú vetu aj poradie sekcií vlastní
 * `SettingsSubPage`, ktorý ich číta zo `sub-pages.ts` — aby rozcestník,
 * podstránka a preklad starých kotiev nikdy nehovorili tri rôzne veci.
 */
import type { Metadata } from 'next';

import SettingsSubPage from '@/components/settings/SettingsSubPage';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Červená zóna — ${APP_DISPLAY_NAME}`,
};

export default function Page() {
  return <SettingsSubPage slug="cervena-zona" />;
}
