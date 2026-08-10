'use client';

/**
 * Aura Zľavy — ČERVENÁ ZÓNA: kľúč unikol (V12; pôvodne A16).
 *
 * Vyžaduje heslo A doslovné opísanie textu `KLUC UNIKOL` (bez diakritiky).
 * Po vykonaní sú oba kľúče z appky zmazané, všetky čakajúce zľavy zrušené a na
 * obrazovke je postup, čo robiť ďalej. Appka kľúč revokovať NEVIE — vie ho len
 * zabudnúť; skutočnú revokáciu robí správca eshopu. Po incidente nebeží nič
 * automaticky.
 *
 * Sekcia je jediné miesto v Nastaveniach s červeným rámom. Je to zámer:
 * červená je vyhradená pre stratu dát a zastavený zápis, takže keď ju
 * používateľ uvidí inde, vie, že ide o vážnu vec.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import RunbookPanel from '@/components/ui/RunbookPanel';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import {
  PANIC_CONFIRM_LITERAL,
  SUDO_REQUIRED_CODE,
  panicWipeKey,
  type PanicResult,
} from '@/components/settings/api';

const RUNBOOK_STEPS: readonly string[] = [
  'Oba kľúče (na zápis zliav aj na objednávky) sú z appky zmazané a všetky čakajúce zľavy zrušené. Nič nebeží automaticky.',
  'Kontaktuj správcu eshopu a požiadaj o zneplatnenie oboch kľúčov na strane eshopu — appka kľúč zneplatniť nevie, vie ho len zabudnúť.',
  'Pozri sa do histórie (filter podľa dátumu a typu „zápis") a do administrácie eshopu, či medzitým neprebehli neočakávané zmeny zliav.',
  'Po zneplatnení vygeneruj v eshope nový kľúč, ktorý smie výhradne meniť produkty, a vlož ho v sekcii Kľúče. Kľúč na objednávky vlož znova až vtedy, keď ho potrebuješ — bez neho appka len nevidí, čo sa predáva.',
  'Skontroluj zľavy, ktoré čakajú na kľúč, a rozhodni, ktoré chceš zapísať znova. Každá pôjde znova cez skúšku naprázdno a samostatné potvrdenie.',
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
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<PanicResult | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const confirmOk = confirm === PANIC_CONFIRM_LITERAL;

  const fail = (error: { code?: string | null; message?: string | null } | null) =>
    setFailure(describeActionFailure(error, { action: 'Zmazanie kľúčov' }));

  async function submit(pwd: string) {
    if (pwd.length === 0) {
      fail({ code: 'validation_failed', message: 'Zmazanie kľúčov vyžaduje tvoje heslo.' });
      return;
    }
    if (!confirmOk) {
      fail({
        code: 'validation_failed',
        message: `Do potvrdzovacieho poľa opíš presne text ${PANIC_CONFIRM_LITERAL} (bez diakritiky).`,
      });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await panicWipeKey(pwd);
    setBusy(false);
    if (res.ok) {
      setPassword('');
      setConfirm('');
      setPending(null);
      setFailure(null);
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
    fail(res.error);
  }

  if (result) {
    return (
      <section className="sec danger-zone" id="cervena" data-testid="panic-result">
        <div className="sec-h">
          <h2>Kľúče sú zmazané</h2>
        </div>
        <p className="set-note">
          Zrušených čakajúcich zliav: <b>{result.cancelledCampaigns}</b>. Appka
          teraz do eshopu nezapíše nič, kým nevložíš nový kľúč. Už zapísané zľavy
          v eshope zostanú a dobehnú.
        </p>
        <RunbookPanel
          title="Čo robiť teraz"
          steps={RUNBOOK_STEPS}
          runbookUrl={result.runbookUrl}
        />
      </section>
    );
  }

  return (
    <section className="sec danger-zone" id="cervena" data-testid="panic-button">
      <div className="sec-h">
        <h2>Červená zóna</h2>
      </div>

      <div className="dz-row">
        <span>
          Kľúč unikol — zmazať oba kľúče a zrušiť všetky čakajúce zľavy. Už
          zapísané zľavy v eshope zostanú a dobehnú.
        </span>
        {!open ? (
          <span className="dz-a">
            <Button variant="danger" small onClick={() => setOpen(true)} data-testid="panic-open">
              Kľúč unikol
            </Button>
          </span>
        ) : null}
      </div>

      {!keyPresent ? (
        <div className="dz-row lvl-3">
          <span>
            Teraz nie je uložený ani jeden kľúč. Zmazanie sa dá spustiť aj tak —
            zruší čakajúce zľavy a zapíše incident do histórie.
          </span>
        </div>
      ) : null}

      {open ? (
        <div className="set-form" data-testid="panic-editor">
          <label className="field set-w">
            <span className="lb">Heslo</span>
            <input
              className="inp"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              data-testid="panic-password"
            />
          </label>
          <label className="field set-w">
            <span className="lb">Opíš presne text {PANIC_CONFIRM_LITERAL}</span>
            <input
              className="inp"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              placeholder={PANIC_CONFIRM_LITERAL}
              data-testid="panic-confirm"
            />
          </label>
          <div className="row">
            <Button
              variant="danger"
              onClick={() => void submit(password)}
              disabled={busy || !confirmOk || password.length === 0}
              disabledReason={
                !confirmOk ? `Najprv opíš text ${PANIC_CONFIRM_LITERAL}.` : 'Zadaj heslo.'
              }
              data-testid="panic-submit"
            >
              {busy ? 'Mažem kľúče…' : 'Zmazať kľúče a zrušiť čakajúce zľavy'}
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                setPassword('');
                setConfirm('');
                setFailure(null);
              }}
              disabled={busy}
            >
              Späť
            </Button>
          </div>
          <ActionFailurePanel failure={failure} testId="panic-failure" />
        </div>
      ) : null}

      {needSudo ? (
        <SudoPrompt
          actionLabel="zmazanie kľúčov po úniku"
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
