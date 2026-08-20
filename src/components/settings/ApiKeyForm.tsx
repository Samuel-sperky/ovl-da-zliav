'use client';

/**
 * Aura Zľavy — vloženie a obnova kľúča na ZÁPIS ZLIAV (V12; pôvodne A16).
 *
 * UI kľúč NIKDY nezobrazí — ani po vložení, ani „na kontrolu". Jediné, čo
 * o ňom hovorí, sú posledné štyri znaky, čas uloženia a živý odpočet platnosti.
 * Vstupné pole je typu heslo, hodnota sa po odoslaní okamžite zahodí a nikde
 * sa nezapisuje.
 *
 * TICHÝ NEÚSPECH JE ZAKÁZANÝ. Kľúč ide do PRODUKČNÉHO eshopu, takže dojem
 * „uložilo sa" bez uloženia je najhorší možný výsledok. Preto po každom
 * neúspechu: (a) zmizne akékoľvek staršie hlásenie o úspechu, (b) na obrazovke
 * je výslovné „kľúč sa NEULOŽIL", (c) pri chýbajúcej prihlásenej relácii sa
 * nezobrazí generická červená chyba, ale veta „nie si prihlásený" s odkazom.
 *
 * Formulár sa kreslí vnútri sekcie Kľúče, preto nemá vlastný rám ani nadpis
 * sekcie — hostiteľ ich dodáva.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { SigMark, type SigVariant } from '@/components/ui/StatusMark';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import {
  SUDO_REQUIRED_CODE,
  putKey,
  validateApiKey,
  type KeyMetaView,
} from '@/components/settings/api';

/** Výsledok overenia kľúča → veta. Kód overenia na povrch nepatrí. */
const VERIFY_LABELS: Record<string, { label: string; tone: SigVariant }> = {
  valid: { label: 'overený u eshopu', tone: 'ok' },
  unverified: { label: 'neoverený', tone: 'idle' },
  invalid: { label: 'eshop ho neprijal', tone: 'bad' },
  forbidden: { label: 'nemá právo meniť produkty', tone: 'bad' },
};

export interface ApiKeyFormProps {
  keyMeta: KeyMetaView | null;
  onStored: () => void;
}

export function ApiKeyForm({ keyMeta, onStored }: ApiKeyFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [stored, setStored] = useState<{ last4: string; verifyStatus: string } | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  /** Neúspech je vždy hlasný: úspešné hlásenie zmizne, chyba sa pomenuje. */
  function fail(error: { code?: string | null; message?: string | null } | null) {
    setStored(null);
    setFailure(describeActionFailure(error, { action: 'Uloženie kľúča na zápis zliav' }));
  }

  async function submit(value: string) {
    const localError = validateApiKey(value);
    if (localError) {
      fail({ code: 'validation_failed', message: localError });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await putKey(value.trim());
    setBusy(false);
    if (res.ok) {
      // Kľúč držíme len po dobu odoslania a hneď ho zahadzujeme.
      setApiKey('');
      setPending(null);
      setFailure(null);
      setStored({ last4: res.data.last4, verifyStatus: res.data.verifyStatus });
      onStored();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      // Vypršané okno hesla NIE JE odhlásenie; pýtame heslo, nie prihlásenie.
      setPending(value);
      setNeedSudo(true);
      return;
    }
    // Kľúč nedržíme ani po neúspechu — používateľ ho vloží znova. Preto MUSÍ
    // byť na obrazovke nepochybné, že sa nič neuložilo.
    setApiKey('');
    setPending(null);
    fail(res.error);
  }

  const verify = keyMeta?.verifyStatus ? VERIFY_LABELS[keyMeta.verifyStatus] : null;

  return (
    <div data-testid="api-key-form">
      {keyMeta?.present === true ? (
        <div className="lvl-3" data-testid="api-key-meta">
          Uložený kľúč končí na {keyMeta.last4 ?? '????'}
          {verify ? (
            <>
              {' · '}
              <span className={`sig ${verify.tone}`}>
                <SigMark variant={verify.tone} />
                {verify.label}
              </span>
            </>
          ) : null}
        </div>
      ) : (
        <div className="lvl-3" data-testid="api-key-missing">
          Bez tohto kľúča appka do eshopu nič nezapíše. Fronta počká, nič sa
          nestratí.
        </div>
      )}

      <form
        className="set-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void submit(apiKey);
        }}
      >
        <label className="field set-w">
          <span className="lb">
            {keyMeta?.present === true ? 'Nový kľúč na zápis zliav' : 'Kľúč na zápis zliav'}
          </span>
          <input
            className="inp"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={busy}
            placeholder="vlož kľúč — nikdy sa nezobrazí"
            data-testid="api-key-input"
          />
        </label>
        <div className="row">
          <Button type="submit" variant="primary" disabled={busy} data-testid="api-key-save">
            {busy ? 'Ukladám…' : 'Uložiť kľúč'}
          </Button>
          <span className="lvl-3">appka kľúč najprv overí u eshopu</span>
        </div>
      </form>

      {stored ? (
        <p className="set-note" data-testid="api-key-stored">
          Kľúč končiaci na {stored.last4} je uložený (
          {VERIFY_LABELS[stored.verifyStatus]?.label ?? 'stav overenia neznámy'}). Zľavy,
          ktoré na kľúč čakali a sú ešte vo svojom okne, appka dopísala sama.
        </p>
      ) : null}

      {failure ? (
        <div className="stack">
          <p className="sig bad" data-testid="api-key-not-stored">
            <SigMark variant="bad" />
            Kľúč sa NEULOŽIL — v appke zostáva pôvodný stav a do eshopu sa nič
            neposlalo.
          </p>
          <ActionFailurePanel failure={failure} testId="api-key-failure" />
        </div>
      ) : null}

      <p className="set-note">
        Kľúč sa ukladá zašifrovaný, neopustí pamäť odoslania a UI ani záznamy ho
        nikdy nezobrazia.
      </p>

      {needSudo ? (
        <SudoPrompt
          actionLabel="uloženie kľúča na zápis zliav"
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
    </div>
  );
}

export default ApiKeyForm;
