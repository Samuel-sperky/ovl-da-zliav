'use client';

/**
 * Aura Zľavy — predvolený čas zápisu (V12; pôvodne A16).
 *
 * Appka vie zľavu zapísať hneď pri potvrdení (aj s oknom, ktoré začne až
 * o týždne), alebo ju nechať na deň štartu. Zapisovať dopredu je HLAVNÁ cesta:
 * zmeškané spustenie sa totiž nikdy nedobieha automaticky, a čo je zapísané
 * dopredu, to sa nedá zmeškať.
 *
 * Prepínač mení LEN predvoľbu vo formulári novej zľavy. Samotný zápis vždy
 * prejde skúškou naprázdno a samostatným potvrdením — to sa vypnúť nedá.
 *
 * Kreslí sa ako riadok vnútri sekcie Poistky, preto nemá vlastný rám.
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
      // Nastavenie sa NEuložilo — pri chýbajúcej relácii to povieme ľudsky.
      setFailure(describeActionFailure(res.error, { action: 'Uloženie predvoľby' }));
      return;
    }
    setFailure(null);
    onChanged();
  }

  return (
    <>
      <span className="k">Predvolený čas zápisu</span>
      <span className="v" data-testid="eager-write-state">
        {enabled ? 'zapisovať dopredu' : 'zapisovať až v deň štartu'}
      </span>
      <span>
        <Button small onClick={() => void toggle()} disabled={busy} data-testid="eager-write-switch">
          {busy ? 'Ukladám…' : 'Zmeniť'}
        </Button>
      </span>
      {/* Chyba zaberá celý riadok mriežky — `div` vnútri `span` by bol
          neplatný dokument a React by na ňom padal pri hydratácii. */}
      {failure ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <ActionFailurePanel failure={failure} testId="eager-write-failure" />
        </div>
      ) : null}
    </>
  );
}

export default EagerWriteToggle;
