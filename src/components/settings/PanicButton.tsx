'use client';

/**
 * Aura Zľavy — ČERVENÁ ZÓNA: kľúč unikol (V12; pôvodne A16).
 *
 * Vyžaduje doslovné opísanie textu `KLUC UNIKOL` (bez diakritiky). Do
 * 27. 8. 2026 k tomu chcela route aj heslo (D67); heslá zmazalo D99, ale
 * potvrdenie NEZMIZLO — vypísaná fráza je odteraz jediná brána a preto sa
 * oslabiť nesmie.
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
import { describeActionFailure, type ActionFailure } from '@/lib/ui/action-failure';
import {
  PANIC_CONFIRM_LITERAL,
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
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<PanicResult | null>(null);

  const confirmOk = confirm === PANIC_CONFIRM_LITERAL;

  const fail = (error: { code?: string | null; message?: string | null } | null) =>
    setFailure(describeActionFailure(error, { action: 'Zmazanie kľúčov' }));

  async function submit() {
    if (!confirmOk) {
      fail({
        code: 'validation_failed',
        message: `Do potvrdzovacieho poľa opíš presne text ${PANIC_CONFIRM_LITERAL} (bez diakritiky).`,
      });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await panicWipeKey();
    setBusy(false);
    if (res.ok) {
      setConfirm('');
      setFailure(null);
      setResult(res.data);
      onWiped();
      return;
    }
    setConfirm('');
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
            {/* Rozklik nad najnebezpečnejšou akciou appky: čo sa stlačením
                otvorí, musí byť čítačke povedané, nielen vidieť. */}
            <Button
              variant="danger"
              small
              aria-expanded={open}
              aria-controls="panic-editor"
              onClick={() => setOpen(true)}
              data-testid="panic-open"
            >
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
        <div className="set-form" id="panic-editor" data-testid="panic-editor">
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
              onClick={() => void submit()}
              disabled={busy || !confirmOk}
              disabledReason={`Najprv opíš text ${PANIC_CONFIRM_LITERAL}.`}
              data-testid="panic-submit"
            >
              {busy ? 'Mažem kľúče…' : 'Zmazať kľúče a zrušiť čakajúce zľavy'}
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
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

    </section>
  );
}

export default PanicButton;
