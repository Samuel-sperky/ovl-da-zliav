'use client';

/**
 * Aura Zľavy — vloženie a rotácia API kľúča (A16, D65, D53, D24, I1).
 *
 * UI NIKDY nezobrazí kľúč — ani po vložení, ani „na kontrolu". Jediné, čo
 * o kľúči hovorí, sú posledné 4 znaky, čas uloženia, živý odpočet TTL a
 * výsledok sondy `reduction=0`. Vstupné pole je `type="password"`, hodnota sa
 * po odoslaní okamžite zahodí a nikde sa neloguje.
 *
 * Po úspešnom uložení UI informuje, koľko kampaní v stave „vyžaduje kľúč"
 * server automaticky dopálil (D24) — presný počet zistí obnovenie zoznamu
 * kampaní, preto sa tvrdí len to, čo appka vie.
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import Countdown from '@/components/ui/Countdown';
import ErrorMessage from '@/components/ui/ErrorMessage';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { formatDateTimeSk } from '@/lib/ui/format';
import {
  SUDO_REQUIRED_CODE,
  putKey,
  validateApiKey,
  type KeyMetaView,
} from '@/components/settings/api';

const VERIFY_LABELS: Record<string, { label: string; tone: string }> = {
  valid: { label: 'overený sondou reduction=0', tone: 'ok' },
  unverified: { label: 'neoverený (sonda neprebehla)', tone: 'neutral' },
  invalid: { label: 'neplatný', tone: 'danger' },
  forbidden: { label: 'chýba scope product:edit', tone: 'danger' },
};

export interface ApiKeyFormProps {
  keyMeta: KeyMetaView | null;
  onStored: () => void;
}

export function ApiKeyForm({ keyMeta, onStored }: ApiKeyFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);
  const [stored, setStored] = useState<{ last4: string; verifyStatus: string } | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function submit(value: string) {
    setRawCode(null);
    const localError = validateApiKey(value);
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    setBusy(true);
    const res = await putKey(value.trim());
    setBusy(false);
    if (res.ok) {
      // Plaintext kľúča držíme len po dobu requestu a hneď ho zahadzujeme (I1).
      setApiKey('');
      setPending(null);
      setStored({ last4: res.data.last4, verifyStatus: res.data.verifyStatus });
      onStored();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      setPending(value);
      setNeedSudo(true);
      return;
    }
    setApiKey('');
    setPending(null);
    setError(res.error.message);
    setRawCode(res.error.code);
  }

  const verify = keyMeta?.verifyStatus ? VERIFY_LABELS[keyMeta.verifyStatus] : null;

  return (
    <section className="ovl-card" data-testid="api-key-form">
      <h2>API kľúč</h2>
      <div className="ovl-stack">
        {keyMeta?.present ? (
          <div className="ovl-stack" style={{ gap: '0.2rem' }} data-testid="api-key-meta">
            <div>
              uložený kľúč <code>····{keyMeta.last4 ?? '????'}</code>
              {verify ? (
                <span className={`ovl-badge ovl-badge--${verify.tone}`} style={{ marginLeft: '0.4rem' }}>
                  {verify.label}
                </span>
              ) : null}
            </div>
            <div className="ovl-small ovl-muted">uložený {formatDateTimeSk(keyMeta.savedAt)}</div>
            <div className="ovl-small">
              expiruje za{' '}
              <strong>
                <Countdown expiresAt={keyMeta.expiresAt} expiredLabel="expirovaný" />
              </strong>{' '}
              <span className="ovl-muted">
                (TTL max 48 h — po expirácii sa kľúč zmaže a appka je len na čítanie)
              </span>
            </div>
          </div>
        ) : (
          <p className="ovl-badge ovl-badge--warning" data-testid="api-key-missing">
            Kľúč nie je uložený — appka je v režime len na čítanie a naplánované
            kampane skončia v stave „vyžaduje kľúč".
          </p>
        )}

        <form
          className="ovl-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit(apiKey);
          }}
        >
          <label>
            <span className="ovl-small">
              {keyMeta?.present ? 'Nový kľúč (rotácia)' : 'API kľúč zo shopu'}
            </span>
            <br />
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
              placeholder="vlož kľúč — nikdy sa nezobrazí"
              data-testid="api-key-input"
              style={{ minWidth: '20rem' }}
            />
          </label>
          <div className="ovl-row">
            <Button type="submit" variant="primary" disabled={busy} data-testid="api-key-save">
              {busy ? 'Ukladám…' : keyMeta?.present ? 'Rotovať kľúč' : 'Uložiť kľúč'}
            </Button>
          </div>
        </form>

        {stored ? (
          <div className="ovl-badge ovl-badge--ok" data-testid="api-key-stored">
            Kľúč <code>····{stored.last4}</code> uložený (
            {VERIFY_LABELS[stored.verifyStatus]?.label ?? stored.verifyStatus}). Kampane, ktoré
            čakali na kľúč a stále sú vo svojom okne, server automaticky dopálil — skontroluj ich
            v sekcii Kampane.
          </div>
        ) : null}
        {error ? <ErrorMessage message={error} rawCode={rawCode} /> : null}
        <p className="ovl-small ovl-muted">
          Kľúč sa ukladá zašifrovaný, jeho plaintext neopustí pamäť requestu a
          UI ani logy ho nikdy nezobrazia. Pred uložením appka spustí sondu
          `reduction=0`, ktorá nič nemení.
        </p>
      </div>
      {needSudo ? (
        <SudoPrompt
          actionLabel="uloženie API kľúča"
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

export default ApiKeyForm;
