'use client';

/**
 * Aura Zľavy — doména shopu (A16, D80, D55).
 *
 * Doména je JEDNA a výhradne `https://`; jej zmena vyžaduje heslo aj platné
 * sudo okno (D70/D80). Server pred uložením spustí canary GET a UI jeho
 * výsledok zobrazí — bez úspešného canary sa doména neuloží (D55).
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { formatDateTimeSk } from '@/lib/ui/format';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
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
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [canary, setCanary] = useState<{ ok: boolean; total: number } | null>(null);
  const [connection, setConnection] = useState<CanaryView | null>(null);
  const [needSudo, setNeedSudo] = useState(false);

  /** Neúspech je vždy hlasný a pri chýbajúcej session ľudský (401). */
  function fail(error: { code?: string | null; message?: string | null } | null) {
    setCanary(null);
    setFailure(describeActionFailure(error, { action: 'Uloženie domény shopu' }));
  }

  async function save() {
    setCanary(null);
    // Lokálna validácia pred odoslaním — https-only (D80).
    const localError = validateDomain(domain);
    if (localError) {
      fail({ code: 'validation_failed', message: localError });
      return;
    }
    if (password.length === 0) {
      fail({ code: 'validation_failed', message: 'Zmena domény vyžaduje tvoje heslo.' });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await putDomain(domain.trim(), password);
    setBusy(false);
    if (res.ok) {
      setPassword('');
      setFailure(null);
      setCanary(res.data.canary);
      onSaved();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      // Sudo okno vypršalo — to NIE je odhlásenie; pýtame heslo, nie login.
      setNeedSudo(true);
      return;
    }
    setPassword('');
    fail(res.error);
  }

  async function test() {
    setBusy(true);
    setFailure(null);
    const res = await testConnection();
    setBusy(false);
    if (res.ok) {
      setConnection(res.data);
      return;
    }
    setConnection(null);
    setFailure(describeActionFailure(res.error, { action: 'Test spojenia so shopom' }));
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
        <ActionFailurePanel failure={failure} testId="domain-failure" />
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
