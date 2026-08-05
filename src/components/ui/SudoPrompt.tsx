'use client';

/**
 * Aura Zľavy — sudo dialóg (D70, §5).
 *
 * Citlivé operácie vyžadujú sudo okno < 15 min. Ak vypršalo, tento dialóg
 * si vypýta heslo a POSTne ho na `/api/auth/sudo`; po úspechu zavolá
 * `onSuccess` s novým `sudoUntil`. Heslo sa drží len v lokálnom state
 * a po odoslaní sa okamžite zahodí.
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';

export interface SudoPromptProps {
  /** Slovenský popis akcie, ktorá sudo vyžaduje. */
  actionLabel: string;
  onSuccess: (sudoUntil: string) => void;
  onCancel: () => void;
}

export function SudoPrompt({ actionLabel, onSuccess, onCancel }: SudoPromptProps) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/sudo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json()) as
        | { ok: true; data: { sudoUntil: string } }
        | { ok: false; error?: { message?: string } };
      setPassword('');
      if (res.ok && 'ok' in body && body.ok) {
        onSuccess(body.data.sudoUntil);
      } else {
        setError(
          ('error' in body && body.error?.message) || 'Overenie hesla zlyhalo. Skús znova.',
        );
      }
    } catch {
      setPassword('');
      setError('Server neodpovedá. Skús znova.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ovl-sudo-backdrop" role="dialog" aria-modal="true" aria-label="Overenie heslom">
      <form className="ovl-sudo-dialog" onSubmit={submit}>
        <h3>Over sa heslom</h3>
        <p className="ovl-small ovl-muted">
          Od poslednej autentifikácie ubehlo viac než 15 minút. Akcia
          „{actionLabel}“ vyžaduje opätovné zadanie hesla.
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Heslo"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <ErrorMessage message={error} /> : null}
        <div className="ovl-row">
          <Button type="submit" variant="primary" disabled={submitting || password.length === 0}>
            {submitting ? 'Overujem…' : 'Potvrdiť'}
          </Button>
          <Button onClick={onCancel} disabled={submitting}>
            Zrušiť
          </Button>
        </div>
      </form>
    </div>
  );
}

export default SudoPrompt;
