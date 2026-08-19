/**
 * Aura Zľavy — `/nastavenia` (V12; kontrakt UI 13. 8. 2026, bod 13).
 *
 * Štvrtý tab. Do 18. 8. to bola jedna stránka s dvanástimi sekciami a mierou
 * 4,7 obrazovky; teraz je to rozcestník so štyrmi kartami a obsah žije na
 * podstránkach. Nič sa nezmazalo — každá sekcia má svoju kotvu ďalej a staré
 * odkazy `/nastavenia#…` sem prídu a presmerujú sa (`sub-pages.ts`).
 */
import type { Metadata } from 'next';

import SettingsIndex from '@/components/settings/SettingsIndex';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Nastavenia — ${APP_DISPLAY_NAME}`,
};

export default function SettingsPage() {
  return <SettingsIndex />;
}
