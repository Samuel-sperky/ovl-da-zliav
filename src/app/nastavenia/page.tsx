/**
 * Aura Zľavy — `/nastavenia` (V12; kontrakt V3, bod K-deväť).
 *
 * Štvrtý a posledný tab. Skladajú sa doň veci, ktoré predtým žili samostatne:
 * adresa eshopu, oba kľúče, denný rozpočet zápisov, rozsah zliav, poistky,
 * zoznam zamknutých funkcií, celá história (predtým samostatný tab „Audit")
 * a červená zóna.
 *
 * Nadpis stránky aj kotvy dodáva `SettingsPanel` — je to jedna stránka
 * s kotvami, nie zoznam kariet, takže hlavička a obsah patria k sebe.
 */
import type { Metadata } from 'next';

import SettingsPanel from '@/components/settings/SettingsPanel';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Nastavenia — ${APP_DISPLAY_NAME}`,
};

export default function SettingsPage() {
  return <SettingsPanel />;
}
