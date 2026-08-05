'use client';

/**
 * Aura Zľavy — kompozícia stránky `/nastavenia` (A16, §8).
 *
 * Doména (heslo + canary), API kľúč (bez zobrazenia kľúča, I1), default eager
 * write, odomknutie zápisov po runaway strope a panic button s runbookom.
 */
import { useCallback, useEffect, useState } from 'react';

import ApiKeyForm from '@/components/settings/ApiKeyForm';
import DomainForm from '@/components/settings/DomainForm';
import EagerWriteToggle from '@/components/settings/EagerWriteToggle';
import PanicButton from '@/components/settings/PanicButton';
import UnlockWritesForm from '@/components/settings/UnlockWritesForm';
import ErrorMessage from '@/components/ui/ErrorMessage';
import {
  getKeyMeta,
  getSettings,
  type KeyMetaView,
  type SettingsView,
} from '@/components/settings/api';

export function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [keyMeta, setKeyMeta] = useState<KeyMetaView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, k] = await Promise.all([getSettings(), getKeyMeta()]);
    if (s.ok) {
      setSettings(s.data);
      setError(null);
    } else {
      setSettings(null);
      setError(s.error.message);
    }
    setKeyMeta(k.ok ? k.data : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <ErrorMessage message={`Nastavenia sa nepodarilo načítať. ${error}`} />;
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
      <EagerWriteToggle enabled={settings.eagerWriteDefault} onChanged={() => void load()} />
      <UnlockWritesForm
        writesLocked={settings.writesLocked}
        writesLockedReason={settings.writesLockedReason}
        onUnlocked={() => void load()}
      />
      <PanicButton keyPresent={keyMeta?.present ?? false} onWiped={() => void load()} />
    </div>
  );
}

export default SettingsPanel;
