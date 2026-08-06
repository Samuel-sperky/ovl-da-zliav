'use client';

/**
 * Aura Zľavy — kompozícia stránky `/nastavenia` (A16, §8).
 *
 * Doména (heslo + canary), zápisový API kľúč a objednávkový API kľúč (oba bez
 * zobrazenia kľúča, I1), default eager write, odomknutie zápisov po runaway
 * strope a panic button s runbookom.
 *
 * Keď načítanie spadne na CHÝBAJÚCU SESSION (401 `unauthorized`), stránka to
 * nehlási ako poruchu appky, ale ako „nie si prihlásený" s odkazom na login —
 * inak používateľ vidí len červený obdĺžnik a nevie, že mu stačí prihlásiť sa.
 */
import { useCallback, useEffect, useState } from 'react';

import ApiKeyForm from '@/components/settings/ApiKeyForm';
import DomainForm from '@/components/settings/DomainForm';
import EagerWriteToggle from '@/components/settings/EagerWriteToggle';
import OrdersKeyForm from '@/components/settings/OrdersKeyForm';
import PanicButton from '@/components/settings/PanicButton';
import UnlockWritesForm from '@/components/settings/UnlockWritesForm';
import ActionFailurePanel from '@/components/ui/ActionFailure';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import {
  getKeyMeta,
  getOrdersKeyMeta,
  getSettings,
  type KeyMetaView,
  type SettingsView,
} from '@/components/settings/api';

export function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyMeta, setKeyMeta] = useState<KeyMetaView | null>(null);
  const [ordersKeyMeta, setOrdersKeyMeta] = useState<KeyMetaView | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const load = useCallback(async () => {
    const [s, k, o] = await Promise.all([getSettings(), getKeyMeta(), getOrdersKeyMeta()]);
    if (s.ok) {
      setSettings(s.data);
      setFailure(null);
    } else {
      setSettings(null);
      setFailure(describeActionFailure(s.error, { action: 'Načítanie nastavení' }));
    }
    setKeyMeta(k.ok ? k.data : null);
    setOrdersKeyMeta(o.ok ? o.data : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failure) {
    return <ActionFailurePanel failure={failure} testId="settings-failure" />;
  }

  if (settings === null) {
    return <div className="ovl-card ovl-skeleton" style={{ minHeight: '12rem' }} aria-busy="true" />;
  }

  return (
    <div className="ovl-stack" style={{ gap: '1rem' }}>
      <DomainForm
        shopDomain={settings.shopDomain}
        domainConfirmedAt={settings.domainConfirmedAt}
        onSaved={() => void load()}
      />
      <ApiKeyForm keyMeta={keyMeta} onStored={() => void load()} />
      <OrdersKeyForm keyMeta={ordersKeyMeta} onStored={() => void load()} />
      <EagerWriteToggle enabled={settings.eagerWriteDefault} onChanged={() => void load()} />
      <UnlockWritesForm
        writesLocked={settings.writesLocked}
        writesLockedReason={settings.writesLockedReason}
        onUnlocked={() => void load()}
      />
      {/* Panic button maže OBA kľúče (D67, P5) — stačí, že je uložený ktorýkoľvek. */}
      <PanicButton
        keyPresent={(keyMeta?.present ?? false) || (ordersKeyMeta?.present ?? false)}
        onWiped={() => void load()}
      />
    </div>
  );
}

export default SettingsPanel;
