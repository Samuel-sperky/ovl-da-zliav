'use client';

/**
 * Aura Zľavy — odomknutie zápisov po runaway strope (A16, D79, I12).
 *
 * Prekročenie 60 zápisov/h zamkne zápisy fail-closed. Odomknutie je výhradne
 * manuálne, vyžaduje heslo aj platné sudo okno a zapíše audit event
 * `writes_unlocked`. Appka sa NIKDY neodomkne sama.
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
      // Sudo okno vypršalo — to NIE je odhlásenie; pýtame heslo, nie login.
      setPending(value);
      setNeedSudo(true);
      return;
    }
    setPassword('');
    setPending(null);
    fail(res.error);
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
          <ActionFailurePanel failure={failure} testId="unlock-writes-failure" />
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
