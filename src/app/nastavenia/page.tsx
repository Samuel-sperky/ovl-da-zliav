/**
 * Aura Zľavy — `/nastavenia` (A16, §8, D65, D67, D79, D80).
 *
 * Doména (https-only, zmena vyžaduje heslo + canary test), API kľúč (nikdy
 * sa nezobrazí, len last4 + čas uloženia + odpočet), default eager write,
 * odomknutie zápisov po runaway strope a panic button „KLUC UNIKOL".
 */
import type { Metadata } from 'next';

import SettingsPanel from '@/components/settings/SettingsPanel';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Nastavenia — ${APP_DISPLAY_NAME}`,
};

export default function SettingsPage() {
  return (
    <>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 0.35rem' }}>Nastavenia</h1>
      <p className="ovl-small ovl-muted" style={{ margin: '0 0 1rem' }}>
        Citlivé zmeny (doména, kľúč, odomknutie zápisov, panic button) vyžadujú
        heslo a platné 15-minútové sudo okno.
      </p>
      <SettingsPanel />
    </>
  );
}
