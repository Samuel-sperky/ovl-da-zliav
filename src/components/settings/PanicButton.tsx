'use client';

/**
 * Aura Zľavy — panic button „kľúč unikol" (A16, D67, R5).
 *
 * Vyžaduje heslo A doslovné opísanie textu `KLUC UNIKOL` (bez diakritiky).
 * Po vykonaní: kľúč je wipnutý, všetky čakajúce kampane zrušené a UI zobrazí
 * runbook — appka kľúč revokovať NEVIE, skutočná revokácia je na maintainerovi
 * shopu. Po incidente nebeží nič automaticky.
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import RunbookPanel from '@/components/ui/RunbookPanel';
import SudoPrompt from '@/components/ui/SudoPrompt';
import {
  PANIC_CONFIRM_LITERAL,
  SUDO_REQUIRED_CODE,
  panicWipeKey,
  type PanicResult,
} from '@/components/settings/api';

const RUNBOOK_STEPS: readonly string[] = [
  'Kľúč je z appky wipnutý (prepis ciphertextu + zmazanie) a všetky čakajúce kampane sú zrušené. Nič nebeží automaticky.',
  'Kontaktuj maintainera shopu a požiadaj o REVOKÁCIU kľúča na strane shopu — appka kľúč revokovať nevie, vie ho len zabudnúť.',
  'Skontroluj audit log (filtre podľa dátumu a typu „zápis") a admin shopu, či medzitým neprebehli neočakávané zmeny zliav.',
  'Po revokácii vygeneruj v shope nový kľúč so scope výhradne product:edit a vlož ho v Nastaveniach.',
  'Skontroluj kampane v stave „vyžaduje kľúč" a rozhodni, ktoré chceš dopáliť novým dry-runom.',
];

export interface PanicButtonProps {
  keyPresent: boolean;
  onWiped: () => void;
}

export function PanicButton({ keyPresent, onWiped }: PanicButtonProps) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);
  const [result, setResult] = useState<PanicResult | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const confirmOk = confirm === PANIC_CONFIRM_LITERAL;

  async function submit(pwd: string) {
    setRawCode(null);
    if (pwd.length === 0) {
      setError('Panic button vyžaduje tvoje heslo.');
      return;
    }
    if (!confirmOk) {
      setError(`Do potvrdzovacieho poľa opíš presne text ${PANIC_CONFIRM_LITERAL} (bez diakritiky).`);
      return;
    }
    setError(null);
    setBusy(true);
    const res = await panicWipeKey(pwd);
    setBusy(false);
    if (res.ok) {
      setPassword('');
      setConfirm('');
      setPending(null);
      setResult(res.data);
      onWiped();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      setPending(pwd);
      setNeedSudo(true);
      return;
    }
    setPassword('');
    setPending(null);
    setError(res.error.message);
    setRawCode(res.error.code);
  }

  if (result) {
    return (
      <section className="ovl-card ovl-card--danger" data-testid="panic-result">
        <h2>Kľúč bol wipnutý</h2>
        <p className="ovl-small">
          Zrušených čakajúcich kampaní: <strong>{result.cancelledCampaigns}</strong>. Appka je od
          teraz len na čítanie, kým nevložíš nový kľúč.
        </p>
        <RunbookPanel
          title="Runbook R5 — kľúč unikol"
          steps={RUNBOOK_STEPS}
          runbookUrl={result.runbookUrl}
        />
      </section>
    );
  }

  return (
    <section className="ovl-card ovl-card--danger" data-testid="panic-button">
      <h2>Panic button — kľúč unikol</h2>
      <p className="ovl-small">
        Okamžite zmaže API kľúč z appky, zruší všetky čakajúce kampane a zapíše
        audit event. Už zapísané zľavy v shope zostanú a dobehnú — appka ich
        zrušiť nedokáže. Skutočnú revokáciu kľúča vie urobiť len maintainer shopu.
      </p>
      {!keyPresent ? (
        <p className="ovl-small ovl-muted">
          Kľúč momentálne nie je uložený, ale panic button môžeš použiť aj tak —
          zruší čakajúce kampane a zapíše incident do auditu.
        </p>
      ) : null}
      {!open ? (
        <Button variant="danger" onClick={() => setOpen(true)} data-testid="panic-open">
          Kľúč unikol — otvoriť panic button
        </Button>
      ) : (
        <div className="ovl-stack">
          <label>
            <span className="ovl-small">Heslo</span>
            <br />
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              data-testid="panic-password"
            />
          </label>
          <label>
            <span className="ovl-small">
              Opíš presne text <code>{PANIC_CONFIRM_LITERAL}</code>
            </span>
            <br />
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              placeholder={PANIC_CONFIRM_LITERAL}
              data-testid="panic-confirm"
            />
          </label>
          <div className="ovl-row">
            <Button
              variant="danger"
              onClick={() => void submit(password)}
              disabled={busy || !confirmOk || password.length === 0}
              disabledReason={
                !confirmOk
                  ? `Najprv opíš text ${PANIC_CONFIRM_LITERAL}.`
                  : 'Zadaj heslo.'
              }
              data-testid="panic-submit"
            >
              {busy ? 'Wipujem kľúč…' : 'Wipnúť kľúč a zrušiť kampane'}
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                setPassword('');
                setConfirm('');
                setError(null);
              }}
              disabled={busy}
            >
              Zrušiť
            </Button>
          </div>
          {error ? <ErrorMessage message={error} rawCode={rawCode} /> : null}
        </div>
      )}
      {needSudo ? (
        <SudoPrompt
          actionLabel="panic button — wipnutie kľúča"
          onSuccess={() => {
            setNeedSudo(false);
            const pwd = pending;
            setPending(null);
            if (pwd) void submit(pwd);
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

export default PanicButton;
