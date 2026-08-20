'use client';

/**
 * Aura Zľavy — vloženie a obnova kľúča na ČÍTANIE OBJEDNÁVOK (V12; pôvodne A16).
 *
 * Dvojča formulára na zápisový kľúč, ale pre druhý kľúč: ten, ktorým appka
 * ČÍTA objednávky, aby vedela, čo sa predáva. Zľavy ním nikdy nezapisuje —
 * zápisová cesta o tomto kľúči vôbec nevie a nesmie vedieť.
 *
 * Rovnaké pravidlá ako pri zápisovom kľúči:
 *  - UI kľúč NIKDY nezobrazí — len posledné štyri znaky a odpočet platnosti,
 *  - vstup je typu heslo a hodnota sa po odoslaní okamžite zahodí,
 *  - TICHÝ NEÚSPECH JE ZAKÁZANÝ: keď server kľúč neuloží, na obrazovke je
 *    výslovné „kľúč sa NEULOŽIL" a pravdivý dôvod.
 *
 * Jediný rozdiel je platnosť: 30 dní namiesto 48 hodín — kľúč je len na
 * čítanie a nevidí zákaznícke údaje. Červená zóna maže oba kľúče naraz.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { SigMark, type SigVariant } from '@/components/ui/StatusMark';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import {
  SUDO_REQUIRED_CODE,
  putOrdersKey,
  validateApiKey,
  type KeyMetaView,
} from '@/components/settings/api';

const VERIFY_LABELS: Record<string, { label: string; tone: SigVariant }> = {
  valid: { label: 'overený čítaním objednávok', tone: 'ok' },
  unverified: { label: 'neoverený', tone: 'idle' },
  invalid: { label: 'eshop ho neprijal', tone: 'bad' },
  forbidden: { label: 'nemá právo čítať objednávky', tone: 'bad' },
};

export interface OrdersKeyFormProps {
  keyMeta: KeyMetaView | null;
  onStored: () => void;
}

export function OrdersKeyForm({ keyMeta, onStored }: OrdersKeyFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [stored, setStored] = useState<{ last4: string; verifyStatus: string } | null>(null);
  const [needSudo, setNeedSudo] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  /** Neúspech je vždy hlasný: úspešné hlásenie zmizne, chyba sa pomenuje. */
  function fail(error: { code?: string | null; message?: string | null } | null) {
    setStored(null);
    setFailure(describeActionFailure(error, { action: 'Uloženie kľúča na objednávky' }));
  }

  async function submit(value: string) {
    const localError = validateApiKey(value);
    if (localError) {
      fail({ code: 'validation_failed', message: localError });
      return;
    }
    setFailure(null);
    setBusy(true);
    const res = await putOrdersKey(value.trim());
    setBusy(false);
    if (res.ok) {
      setApiKey('');
      setPending(null);
      setFailure(null);
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
    fail(res.error);
  }

  const verify = keyMeta?.verifyStatus ? VERIFY_LABELS[keyMeta.verifyStatus] : null;

  return (
    <div data-testid="orders-key-form">
      {keyMeta?.present === true ? (
        <div className="lvl-3" data-testid="orders-key-meta">
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
        <div className="lvl-3" data-testid="orders-key-missing">
          Bez tohto kľúča appka nevidí, čo sa predáva. Zľavy fungujú aj bez neho.
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
            {keyMeta?.present === true ? 'Nový kľúč na objednávky' : 'Kľúč na objednávky'}
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
            data-testid="orders-key-input"
          />
        </label>
        <div className="row">
          <Button type="submit" variant="primary" disabled={busy} data-testid="orders-key-save">
            {busy ? 'Ukladám…' : 'Uložiť kľúč'}
          </Button>
          <span className="lvl-3">appka najprv overí, či ním eshop čítanie pustí</span>
        </div>
      </form>

      {stored ? (
        <p className="set-note" data-testid="orders-key-stored">
          Kľúč končiaci na {stored.last4} je uložený (
          {VERIFY_LABELS[stored.verifyStatus]?.label ?? 'stav overenia neznámy'}). Predané
          kusy sa doplnia pri najbližšom načítaní.
        </p>
      ) : null}

      {failure ? (
        <div className="stack">
          <p className="sig bad" data-testid="orders-key-not-stored">
            <SigMark variant="bad" />
            Kľúč sa NEULOŽIL — v appke zostáva pôvodný stav a do eshopu sa nič
            nezapísalo.
          </p>
          <ActionFailurePanel failure={failure} testId="orders-key-failure" />
        </div>
      ) : null}

      <p className="set-note">
        Kľúč sa ukladá zašifrovaný rovnakou cestou ako zápisový a UI ani záznamy
        ho nikdy nezobrazia. Červená zóna maže oba kľúče naraz.
      </p>

      {needSudo ? (
        <SudoPrompt
          actionLabel="uloženie kľúča na objednávky"
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

export default OrdersKeyForm;
