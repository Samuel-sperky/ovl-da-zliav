'use client';

/**
 * Aura Zľavy — sekcia PRIPOJENIE (V12; predloha `design/v3/nastavenia.html`).
 *
 * Adresa eshopu je JEDNA, výhradne `https://` a jej zmena vyžaduje heslo.
 * Server pred uložením overí, že na tej adrese naozaj odpovedá eshop — bez
 * úspešného overenia sa adresa neuloží. Appka nezapisuje do niečoho, o čom
 * nevie, či to vôbec existuje.
 *
 * Výsledok skúšobného spojenia je na povrchu VETA („Spojenie funguje"), nie
 * číslo odpovede. Číslo odpovede aj čas majú svoje miesto v rozkliku
 * „Technický detail" — tam patria technické údaje a nikde inde.
 *
 * Vlastník: V12 (pôvodne A16).
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
  /**
   * Keď adresa eshopu ešte nie je nastavená, formulár je otvorený hneď — bez
   * nej appka nevie nič, takže schovávať pole za ďalší klik nemá zmysel.
   */
  const [open, setOpen] = useState(shopDomain === null);
  const [domain, setDomain] = useState(shopDomain ?? 'https://');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [canary, setCanary] = useState<{ ok: boolean; total: number } | null>(null);
  const [connection, setConnection] = useState<CanaryView | null>(null);
  const [needSudo, setNeedSudo] = useState(false);

  /** Neúspech je vždy hlasný a pri chýbajúcej prihlásenej relácii ľudský. */
  function fail(error: { code?: string | null; message?: string | null } | null) {
    setCanary(null);
    setFailure(describeActionFailure(error, { action: 'Uloženie adresy eshopu' }));
  }

  async function save() {
    setCanary(null);
    // Lokálna kontrola PRED odoslaním — výhradne https.
    const localError = validateDomain(domain);
    if (localError) {
      fail({ code: 'validation_failed', message: localError });
      return;
    }
    if (password.length === 0) {
      fail({ code: 'validation_failed', message: 'Zmena adresy eshopu vyžaduje tvoje heslo.' });
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
      setOpen(false);
      onSaved();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      // Vypršané okno hesla NIE JE odhlásenie; pýtame heslo, nie prihlásenie.
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
    setFailure(describeActionFailure(res.error, { action: 'Skúška spojenia s eshopom' }));
  }

  return (
    <section className="sec" id="pripojenie" data-testid="domain-form">
      <div className="sec-h">
        <h2>Pripojenie</h2>
        <div className="act">
          {connection === null ? null : connection.ok ? (
            <span className="sig ok" data-testid="domain-connection">
              Spojenie funguje
            </span>
          ) : (
            <span className="sig bad" data-testid="domain-connection">
              Eshop neodpovedal
            </span>
          )}
        </div>
      </div>

      <div className="kv">
        <span className="k">Eshop</span>
        <span className="v" data-testid="domain-current">
          {shopDomain ?? 'zatiaľ nenastavený'}
        </span>
        <span>
          <Button small onClick={() => setOpen((v) => !v)} data-testid="domain-change">
            {open ? 'Zavrieť' : 'Zmeniť'}
          </Button>
        </span>

        <span className="k">Naposledy potvrdené</span>
        <span className="v">
          {domainConfirmedAt === null ? 'zatiaľ nikdy' : formatDateTimeSk(domainConfirmedAt)}
        </span>
        <span>
          <Button small onClick={() => void test()} disabled={busy} data-testid="domain-test">
            Vyskúšať spojenie
          </Button>
        </span>
      </div>

      {canary ? (
        <p className="set-note gap-t" data-testid="domain-canary">
          Adresa uložená — eshop odpovedal a vidí {canary.total} produktov.
        </p>
      ) : null}

      {open ? (
        <div className="set-form" data-testid="domain-editor">
          <label className="field set-w">
            <span className="lb">Adresa eshopu (len https)</span>
            <input
              className="inp"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="https://eshop.example.sk"
              disabled={busy}
              data-testid="domain-input"
            />
          </label>
          <label className="field set-w">
            <span className="lb">Heslo</span>
            <input
              className="inp"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              data-testid="domain-password"
            />
          </label>
          <div className="row">
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={busy}
              data-testid="domain-save"
            >
              {busy ? 'Ukladám…' : 'Uložiť adresu'}
            </Button>
            <span className="lvl-3">adresa je jedna pre celú appku</span>
          </div>
        </div>
      ) : null}

      <ActionFailurePanel failure={failure} testId="domain-failure" />

      <details className="tech">
        <summary>Technický detail</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Základ adresy</td>
                <td className="mono">{shopDomain === null ? '—' : `${shopDomain}/api`}</td>
              </tr>
              <tr>
                <td>Posledná skúška</td>
                <td className="mono">
                  {connection === null
                    ? '—'
                    : `${connection.httpStatus ?? '—'} · ${connection.total} položiek · ${connection.latencyMs} ms`}
                </td>
              </tr>
              <tr>
                <td>Limit eshopu</td>
                <td className="mono">20/min · 200/UTC deň</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      {needSudo ? (
        <SudoPrompt
          actionLabel="zmena adresy eshopu"
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
