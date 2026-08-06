'use client';

/**
 * Aura Zľavy — default pre eager write (A16, D22, odchýlka D33b).
 *
 * Eager write („zapíš hneď aj s budúcim `from`") je hlavná cesta a default je
 * zapnutý. Prepínač mení len PREDVOLENÚ hodnotu vo formulári kampane —
 * samotný zápis stále vyžaduje dry-run a samostatné potvrdenie (I3).
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import { putEagerWriteDefault } from '@/components/settings/api';

export interface EagerWriteToggleProps {
  enabled: boolean;
  onChanged: () => void;
}

export function EagerWriteToggle({ enabled, onChanged }: EagerWriteToggleProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const res = await putEagerWriteDefault(!enabled);
    setBusy(false);
    if (!res.ok) {
      // Nastavenie sa NEuložilo — pri chýbajúcej session to povieme ľudsky.
      setFailure(describeActionFailure(res.error, { action: 'Uloženie nastavenia' }));
      return;
    }
    setFailure(null);
    onChanged();
  }

  return (
    <section className="ovl-card" data-testid="eager-write-toggle">
      <h2>Predvolený režim zápisu</h2>
      <div className="ovl-stack">
        <div className="ovl-spread">
          <span>
            Eager write:{' '}
            <span className={`ovl-badge ovl-badge--${enabled ? 'ok' : 'neutral'}`}>
              {enabled ? 'zapnutý (predvolené)' : 'vypnutý'}
            </span>
          </span>
          <Button onClick={() => void toggle()} disabled={busy} data-testid="eager-write-switch">
            {busy ? 'Ukladám…' : enabled ? 'Vypnúť' : 'Zapnúť'}
          </Button>
        </div>
        <p className="ovl-small ovl-muted">
          Pri zapnutom eager write appka zapíše zľavu do shopu hneď pri potvrdení
          kampane, aj keď má okno začať v budúcnosti. Takýto zápis sa už nedá
          zrušiť — dá sa len prepísať iným zápisom. Pri vypnutom sa kampaň
          naplánuje a zapíše ju scheduler v deň začiatku. Nastavenie mení iba
          predvolenú hodnotu vo formulári; každý zápis stále prejde dry-runom
          a samostatným potvrdením.
        </p>
        <ActionFailurePanel failure={failure} testId="eager-write-failure" />
      </div>
    </section>
  );
}

export default EagerWriteToggle;
