'use client';

/**
 * Aura Zľavy — odomknutie zápisov po runaway strope (A16, D79, I12).
 *
 * Prekročenie 60 zápisov/h zamkne zápisy fail-closed. Odomknutie je výhradne
 * manuálne, vyžaduje heslo aj platné sudo okno a zapíše audit event
 * `writes_unlocked`. Appka sa NIKDY neodomkne sama.
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import SudoPrompt from '@/components/ui/SudoPrompt';
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
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function submit(value: string) {
    setRawCode(null);
    if (value.length === 0) {
      setError('Odomknutie zápisov vyžaduje tvoje heslo.');
      return;
    }
    setError(null);
    setBusy(true);
    const res = await unlockWrites(value);
    setBusy(false);
    if (res.ok) {
      setPassword('');
      setPending(null);
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
    setError(res.error.message);
    setRawCode(res.error.code);
  }

  return (
    <section
      className={`ovl-card${writesLocked ? ' ovl-card--danger' : ''}`}
      data-testid="unlock-writes-form"
    >
      <h2>Zámok zápisov</h2>
      {!writesLocked ? (
        <p className="ovl-small">
          <span className="ovl-badge ovl-badge--ok">zápisy nie sú zamknuté</span>{' '}
          <span className="ovl-muted">
            Strop je 60 zápisov za hodinu. Pri prekročení sa zápisy zamknú a
            odomknúť ich pôjde len tu, heslom.
          </span>
        </p>
      ) : (
        <div className="ovl-stack">
          <p>
            <span className="ovl-badge ovl-badge--danger">ZÁPISY ZAMKNUTÉ</span>
          </p>
          <p className="ovl-small">
            Dôvod: {writesLockedReason ?? 'prekročený strop 60 zápisov za hodinu (D79).'} Kým je
            zámok aktívny, appka nezapíše do shopu nič — ani scheduler. Predtým, než odomkneš,
            over v audite, čo zápisy spôsobilo.
          </p>
          <label>
            <span className="ovl-small">Heslo</span>
            <br />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              data-testid="unlock-writes-password"
            />
          </label>
          <div className="ovl-row">
            <Button
              variant="danger"
              onClick={() => void submit(password)}
              disabled={busy}
              data-testid="unlock-writes-submit"
            >
              {busy ? 'Odomykám…' : 'Odomknúť zápisy'}
            </Button>
          </div>
          {error ? <ErrorMessage message={error} rawCode={rawCode} /> : null}
        </div>
      )}
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
    </section>
  );
}

export default UnlockWritesForm;
