'use client';

/**
 * Aura Zľavy — vloženie a rotácia OBJEDNÁVKOVÉHO API kľúča
 * (KONTRAKT-PREDAJNOST-2026-08-06: P2, P5; D65, I1).
 *
 * Dvojča `ApiKeyForm`, ale pre druhý kľúč: ten, ktorým appka ČÍTA objednávky,
 * aby vedela, čo sa predáva. Zľavy ním nikdy nezapisuje (I8' bod 4).
 *
 * Rovnaké pravidlá ako pri zápisovom kľúči:
 *  - UI kľúč NIKDY nezobrazí — len posledné 4 znaky, čas uloženia a živý odpočet,
 *  - vstup je `type="password"` a hodnota sa po odoslaní okamžite zahodí,
 *  - TICHÝ NEÚSPECH JE ZAKÁZANÝ: keď server kľúč neuloží, na obrazovke je
 *    výslovné „kľúč sa NEULOŽIL" a pravdivý dôvod.
 *
 * Jediný rozdiel je platnosť: 30 dní namiesto 48 h (vedomá odchýlka P2 —
 * kľúč je len na čítanie a nevidí zákaznícke údaje). Panic button ho maže
 * spolu so zápisovým kľúčom.
 */
import { useState } from 'react';

import ActionFailurePanel from '@/components/ui/ActionFailure';
import Button from '@/components/ui/Button';
import Countdown from '@/components/ui/Countdown';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { formatDateTimeSk } from '@/lib/ui/format';
import { describeActionFailure, type ActionFailure } from '@/lib/ui/first-run';
import {
  SUDO_REQUIRED_CODE,
  putOrdersKey,
  validateApiKey,
  type KeyMetaView,
} from '@/components/settings/api';

const VERIFY_LABELS: Record<string, { label: string; tone: string }> = {
  valid: { label: 'overený čítaním objednávok', tone: 'ok' },
  unverified: { label: 'neoverený (sonda neprebehla)', tone: 'neutral' },
  invalid: { label: 'neplatný', tone: 'danger' },
  forbidden: { label: 'shop mu nepovolil čítanie objednávok', tone: 'danger' },
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
    setFailure(describeActionFailure(error, { action: 'Uloženie objednávkového kľúča' }));
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
      // Plaintext kľúča držíme len po dobu requestu a hneď ho zahadzujeme (I1).
      setApiKey('');
      setPending(null);
      setFailure(null);
      setStored({ last4: res.data.last4, verifyStatus: res.data.verifyStatus });
      onStored();
      return;
    }
    if (res.error.code === SUDO_REQUIRED_CODE) {
      // Sudo okno vypršalo — to NIE je odhlásenie; pýtame heslo, nie login.
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
    <section className="ovl-card" data-testid="orders-key-form">
      <h2>Kľúč na čítanie objednávok</h2>
      <div className="ovl-stack">
        {keyMeta?.present ? (
          <div className="ovl-stack" style={{ gap: '0.2rem' }} data-testid="orders-key-meta">
            <div>
              uložený kľúč <code>····{keyMeta.last4 ?? '????'}</code>
              {verify ? (
                <span
                  className={`ovl-badge ovl-badge--${verify.tone}`}
                  style={{ marginLeft: '0.4rem' }}
                >
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
                (platnosť 30 dní — po expirácii sa kľúč zmaže a predajnosť sa
                prestane dopĺňať; zľavy to nijako neovplyvní)
              </span>
            </div>
          </div>
        ) : (
          <p className="ovl-badge ovl-badge--warning" data-testid="orders-key-missing">
            Kľúč nie je uložený — appka nevie čítať objednávky, takže karta
            Predajnosť zostane bez dát. Zľavy a kampane fungujú aj bez neho.
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
              {keyMeta?.present ? 'Nový kľúč (rotácia)' : 'Objednávkový kľúč zo shopu'}
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
              data-testid="orders-key-input"
              style={{ minWidth: '20rem' }}
            />
          </label>
          <div className="ovl-row">
            <Button type="submit" variant="primary" disabled={busy} data-testid="orders-key-save">
              {busy ? 'Ukladám…' : keyMeta?.present ? 'Rotovať kľúč' : 'Uložiť kľúč'}
            </Button>
          </div>
        </form>

        {stored ? (
          <div className="ovl-badge ovl-badge--ok" data-testid="orders-key-stored">
            Kľúč <code>····{stored.last4}</code> uložený (
            {VERIFY_LABELS[stored.verifyStatus]?.label ?? stored.verifyStatus}). Predajnosť sa
            doplní pri najbližšej synchronizácii.
          </div>
        ) : null}
        {failure ? (
          <div className="ovl-stack" style={{ gap: '0.35rem' }}>
            <p className="ovl-badge ovl-badge--danger" data-testid="orders-key-not-stored">
              Kľúč sa NEULOŽIL — v databáze zostáva pôvodný stav a do shopu sa
              nič nezapísalo. Po oprave príčiny ho vlož znova.
            </p>
            <ActionFailurePanel failure={failure} testId="orders-key-failure" />
          </div>
        ) : null}
        <p className="ovl-small ovl-muted">
          Kľúč sa ukladá zašifrovaný rovnakou cestou ako zápisový, jeho plaintext
          neopustí pamäť requestu a UI ani logy ho nikdy nezobrazia. Pred uložením
          appka overí, či shop cez tento kľúč čítanie objednávok skutočne povolí —
          ak nie, kľúč sa neuloží. Panic button maže oba kľúče naraz.
        </p>
      </div>
      {needSudo ? (
        <SudoPrompt
          actionLabel="uloženie objednávkového kľúča"
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

export default OrdersKeyForm;
