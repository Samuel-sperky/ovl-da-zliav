'use client';

/**
 * Aura Zľavy — doména shopu (A16, D80, D55).
 *
 * Doména je JEDNA a výhradne `https://`; jej zmena vyžaduje heslo aj platné
 * sudo okno (D70/D80). Server pred uložením spustí canary GET a UI jeho
 * výsledok zobrazí — bez úspešného canary sa doména neuloží (D55).
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { formatDateTimeSk } from '@/lib/ui/format';
import {
  SUDO_REQUIRED_CODE,
  putDomain,
  testConnection,
  validateDomain,
  type CanaryView,
} from '@/components/settings/api';

export interface DomainFormProps {
  shopDomain: string | null;
  domainConfirmedAt: string | null;
  onSaved: () => void;
}

export function DomainForm({ shopDomain, domainConfirmedAt, onSaved }: DomainFormProps) {
  const [domain, setDomain] = useState(shopDomain ?? 'https://');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);
  const [canary, setCanary] = useState<{ ok: boolean; total: number } | null>(null);
  const [connection, setConnection] = useState<CanaryView | null>(null);
  const [needSudo, setNeedSudo] = useState(false);

  async function save() {
    setRawCode(null);
    setCanary(null);
    // Lokálna validácia pred odoslaním — https-only (D80).
    const localError = validateDomain(domain);
    if (localError) {
      setError(localError);
      return;
    }
    if (password.length === 0) {
      setError('Zmena domény vyžaduje tvoje heslo.');
      return;
    }
    setError(null);
    setBusy(true);
    const res = await putDomain(domain.trim(), password);
    setBusy(false);
    if (res.ok) {
      setPassword('');
      setCanary(res.data.canary);
      onSaved();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      setNeedSudo(true);
      return;
    }
    setPassword('');
    setError(res.error.message);
    setRawCode(res.error.code);
  }

  async function test() {
    setBusy(true);
    setError(null);
    setRawCode(null);
    const res = await testConnection();
    setBusy(false);
    if (res.ok) {
      setConnection(res.data);
      return;
    }
    setConnection(null);
    setError(res.error.message);
    setRawCode(res.error.code);
  }

  return (
    <section className="ovl-card" data-testid="domain-form">
      <h2>Doména shopu</h2>
      <div className="ovl-stack">
        <div className="ovl-small">
          aktuálne:{' '}
          {shopDomain ? (
            <code>{shopDomain}</code>
          ) : (
            <span className="ovl-badge ovl-badge--warning">nenastavená</span>
          )}
          {domainConfirmedAt ? (
            <span className="ovl-muted"> · potvrdená {formatDateTimeSk(domainConfirmedAt)}</span>
          ) : null}
        </div>
        <label>
          <span className="ovl-small">Nová doména (len https://)</span>
          <br />
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="https://shop.example.sk"
            disabled={busy}
            data-testid="domain-input"
            style={{ minWidth: '18rem' }}
          />
        </label>
        <label>
          <span className="ovl-small">Heslo (zmena domény ho vyžaduje)</span>
          <br />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            data-testid="domain-password"
          />
        </label>
        <div className="ovl-row">
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={busy}
            data-testid="domain-save"
          >
            {busy ? 'Ukladám…' : 'Uložiť doménu'}
          </Button>
          <Button onClick={() => void test()} disabled={busy} data-testid="domain-test">
            Otestovať spojenie
          </Button>
        </div>
        {canary ? (
          <p className="ovl-badge ovl-badge--ok" data-testid="domain-canary">
            Canary test pred uložením prešiel — shop odpovedal, {canary.total} produktov v katalógu.
          </p>
        ) : null}
        {connection ? (
          <p
            className={`ovl-badge ovl-badge--${connection.ok ? 'ok' : 'danger'}`}
            data-testid="domain-connection"
          >
            {connection.ok
              ? `Spojenie OK — HTTP ${connection.httpStatus ?? '200'}, ${connection.total} produktov, ${connection.latencyMs} ms.`
              : `Spojenie zlyhalo — HTTP ${connection.httpStatus ?? '—'}.`}
          </p>
        ) : null}
        {error ? <ErrorMessage message={error} rawCode={rawCode} /> : null}
        <p className="ovl-small ovl-muted">
          Doména je jedna a nemenná pre celú appku. Blokovanie privátnych IP
          rozsahov sa neimplementuje — zodpovednosť za správnu doménu je na tebe.
        </p>
      </div>
      {needSudo ? (
        <SudoPrompt
          actionLabel="zmena domény shopu"
          onSuccess={() => {
            setNeedSudo(false);
            void save();
          }}
          onCancel={() => setNeedSudo(false)}
        />
      ) : null}
    </section>
  );
}

export default DomainForm;
