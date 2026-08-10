'use client';

/**
 * Aura Zľavy — ZÁMOK ZÁPISOV (V12; pôvodne A16).
 *
 * Keď appka zapisuje rýchlejšie, než je bezpečné, sama sa zastaví a zámok
 * zostane, kým ho niekto ručne neotvorí heslom. Appka sa NIKDY neodomkne sama
 * a odomknutie sa zapíše do histórie.
 *
 * Zámok je jedna z dvoch vecí, ktoré smú byť červené (druhá je strata dát).
 * Vyčerpaný denný rozpočet červený NIE JE — to je informácia, nie chyba, a má
 * svoje miesto v sekcii Rozpočet.
 *
 * Kreslí sa vnútri sekcie Poistky; v pokojnom stave je to jeden riadok, po
 * zamknutí sa rozvinie na formulár.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import { SUDO_REQUIRED_CODE, unlockWrites } from '@/components/settings/api';

export interface UnlockWritesFormProps {
  writesLocked: boolean;
  writesLockedReason: string | null;
  onUnlocked: () => void;
}

export function UnlockWritesForm({
  writesLocked,
  writesLockedReason,
  onUnlocked,
}: UnlockWritesFormProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const fail = (error: { code?: string | null; message?: string | null } | null) =>
    setFailure(describeActionFailure(error, { action: 'Odomknutie zápisov' }));

  async function submit(value: string) {
    if (value.length === 0) {
      fail({ code: 'validation_failed', message: 'Odomknutie zápisov vyžaduje tvoje heslo.' });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await unlockWrites(value);
    setBusy(false);
    if (res.ok) {
      setPassword('');
      setPending(null);
      setFailure(null);
      onUnlocked();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      setPending(value);
      setNeedSudo(true);
      return;
    }
    setPassword('');
    setPending(null);
    fail(res.error);
  }

  if (!writesLocked) {
    return (
      <div className="lvl-3" data-testid="unlock-writes-form">
        Zápisy nie sú zastavené. Keby appka začala zapisovať rýchlejšie, než je
        bezpečné, zastaví sa sama a otvoriť to pôjde len tu, heslom.
      </div>
    );
  }

  return (
    <div className="stack" data-testid="unlock-writes-form">
      <div className="row">
        <span className="sig bad">Zápisy sú zastavené</span>
      </div>
      <p className="set-note">
        Dôvod: {writesLockedReason ?? 'appka zapisovala rýchlejšie, než je bezpečné'}. Kým
        zámok trvá, do eshopu sa nezapíše nič — ani z fronty. Skôr než odomkneš,
        pozri sa do histórie, čo zápisy spôsobilo.
      </p>
      <label className="field set-w">
        <span className="lb">Heslo</span>
        <input
          className="inp"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          data-testid="unlock-writes-password"
        />
      </label>
      <div className="row">
        <Button
          variant="danger"
          onClick={() => void submit(password)}
          disabled={busy}
          data-testid="unlock-writes-submit"
        >
          {busy ? 'Odomykám…' : 'Odomknúť zápisy'}
        </Button>
      </div>
      <ActionFailurePanel failure={failure} testId="unlock-writes-failure" />
      {needSudo ? (
        <SudoPrompt
          actionLabel="odomknutie zápisov"
          onSuccess={() => {
            setNeedSudo(false);
            const value = pending;
            setPending(null);
            if (value) void submit(value);
          }}
          onCancel={() => {
            setNeedSudo(false);
            setPending(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default UnlockWritesForm;
