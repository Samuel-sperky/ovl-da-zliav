'use client';

/**
 * Aura Zľavy — odhlásenie zo appky (V12, doplnené po prestavbe).
 *
 * Prestavba na štyri taby (K9) vzala odhlásenie so sebou: cesta
 * `POST /api/auth/logout` existovala ďalej, ale v UI ju už nič nevolalo, takže
 * sa používateľ nemal ako odhlásiť. Session by síce vypršala sama (idle aj
 * absolútny strop), ale „počkaj, kým to vyprší" nie je odhlásenie.
 *
 * Prečo je to v Nastaveniach a nie v hlavičke: hlavička má podľa architektúry
 * presne štyri taby, stav zápisov, stav fronty a prepínač témy — a nič iné.
 *
 * POZOR, čo odhlásenie NEROBÍ: neruší basic auth Caddy (tá je vrstva pred
 * appkou a zruší ju až zatvorenie prehliadača) a nezastavuje frontu. Fronta
 * beží na serveri, nie v prehliadači — zapisuje ďalej, aj keď nikto nie je
 * prihlásený. Obe veci sú na obrazovke napísané, aby si ich používateľ
 * nedomýšľal.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import { logout } from '@/components/settings/api';

export function SignOut() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setFailure(null);
    const result = await logout();
    if (result.ok) {
      // Tvrdé prekreslenie, nie klientská navigácia: session cookie práve
      // zanikla a všetok stav v pamäti stránky patrí odhlásenému účtu.
      window.location.assign('/login');
      return;
    }
    setBusy(false);
    setFailure(describeActionFailure(result.error, { action: 'Odhlásenie' }));
  }

  return (
    <section className="sec" id="odhlasenie" data-testid="sign-out">
      <div className="sec-h">
        <h2>Odhlásenie</h2>
        <div className="act">
          <Button small onClick={() => void run()} disabled={busy} data-testid="sign-out-button">
            {busy ? 'Odhlasujem…' : 'Odhlásiť sa'}
          </Button>
        </div>
      </div>
      <p className="muted">
        Fronta beží ďalej — zapisuje na pozadí, aj keď nie si prihlásený.
        Heslo, ktoré si zadal pred vstupom do appky, odhlásenie neruší.
      </p>
      {failure === null ? null : <ActionFailurePanel failure={failure} />}
    </section>
  );
}

export default SignOut;
