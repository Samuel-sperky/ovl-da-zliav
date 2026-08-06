'use client';

/**
 * Aura Zľavy — potvrdzovací panel „Zapísať do PRODUKCIE" (D2, D22, D28, D30, D70, I3).
 *
 * Druhý krok POVINNÉHO dvojkroku. Obsahuje:
 *  - vetu o nevratnosti (eager zápis sa nedá zrušiť, len prepísať — D22),
 *  - prepínač eager write, defaultne ZAPNUTÝ (D22, D33b),
 *  - povinné potvrdenie pri jednodňovej zľave `from = to` (D30),
 *  - diff starý → nový pri prepise existujúcej zľavy (D28),
 *  - `SudoPrompt`, ak je od poslednej autentifikácie viac než 15 min (D70).
 *
 * Panel NIKDY nezapisuje sám — volá `onConfirm`, ktorý POSTuje na
 * `/api/campaigns/*` (I3). Žiadna cesta v tomto komponente neobíde dry-run.
 */
import { useEffect, useState } from 'react';

import type { PreviewItemView, PreviewWarningsView } from '@/components/campaigns/api';
import { fetchSession, sudoValid } from '@/components/campaigns/api';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import SudoPrompt from '@/components/ui/SudoPrompt';
import { formatDateSk, formatPercentSk } from '@/lib/ui/format';

export interface ConfirmSubmit {
  name: string;
  mode: 'eager' | 'scheduled';
  acknowledgements: { irreversible: true; oneDay?: true };
}

export interface ConfirmPanelProps {
  items: PreviewItemView[];
  warnings: PreviewWarningsView;
  percent: number;
  from: string;
  to: string;
  /** Predvyplnený názov kampane; pri extend/retry ho volajúci zamkne. */
  defaultName: string;
  nameLocked?: boolean;
  /** Default prepínača eager write zo `settings.eagerWriteDefault` (D22). */
  eagerDefault?: boolean;
  /** Extend/retry/execute majú mode daný — prepínač sa skryje. */
  hideModeToggle?: boolean;
  /** Slovenský popis akcie pre sudo dialóg. */
  actionLabel?: string;
  submitting: boolean;
  error: { message: string; rawCode?: string | null } | null;
  onConfirm: (submit: ConfirmSubmit) => void | Promise<void>;
  onBack: () => void;
}

export function ConfirmPanel({
  items,
  warnings,
  percent,
  from,
  to,
  defaultName,
  nameLocked,
  eagerDefault = true,
  hideModeToggle,
  actionLabel = 'Zápis zľavy do PRODUKCIE',
  submitting,
  error,
  onConfirm,
  onBack,
}: ConfirmPanelProps) {
  const [name, setName] = useState(defaultName);
  const [eager, setEager] = useState(eagerDefault);
  const [oneDayAck, setOneDayAck] = useState(false);
  const [sudoUntil, setSudoUntil] = useState<string | null>(null);
  const [sudoChecked, setSudoChecked] = useState(false);
  const [showSudo, setShowSudo] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<ConfirmSubmit | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSession().then((s) => {
      if (!alive) return;
      setSudoUntil(s?.sudoUntil ?? null);
      setSudoChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const overwriteItems = items.filter(
    (it) => it.lastOwnWrite != null && warnings.overwrite.includes(it.productId),
  );
  const oneDay = warnings.oneDayWindow || from === to;
  const canSubmit =
    !submitting && sudoChecked && name.trim().length > 0 && (!oneDay || oneDayAck);

  function buildSubmit(): ConfirmSubmit {
    const ack: ConfirmSubmit['acknowledgements'] = { irreversible: true };
    if (oneDay) ack.oneDay = true;
    return { name: name.trim(), mode: hideModeToggle || eager ? 'eager' : 'scheduled', acknowledgements: ack };
  }

  function handleConfirmClick() {
    const submitPayload = buildSubmit();
    if (!sudoValid(sudoUntil)) {
      // Od poslednej autentifikácie je viac než 15 min → sudo heslo (D70).
      setPendingSubmit(submitPayload);
      setShowSudo(true);
      return;
    }
    void onConfirm(submitPayload);
  }

  return (
    <section className="ovl-card" data-testid="confirm-panel">
      <h2 style={{ marginTop: 0 }}>Potvrdenie zápisu</h2>

      <div className="ovl-stack" style={{ gap: '0.75rem' }}>
        <label className="ovl-small">
          Názov kampane{' '}
          <input
            type="text"
            value={name}
            maxLength={120}
            disabled={nameLocked || submitting}
            onChange={(e) => setName(e.target.value)}
            data-testid="campaign-name"
          />
        </label>

        {overwriteItems.length > 0 ? (
          <div className="ovl-card ovl-card--warning" data-testid="overwrite-diff">
            <strong>Prepísanie existujúcej zľavy (podľa vlastnej DB):</strong>
            <ul className="ovl-small" style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
              {overwriteItems.map((it) => (
                <li key={it.productId}>
                  #{it.productId} {it.name ?? ''}: starý{' '}
                  <code>
                    {formatPercentSk(it.lastOwnWrite!.percent)} · {formatDateSk(it.lastOwnWrite!.from)} –{' '}
                    {formatDateSk(it.lastOwnWrite!.to)}
                  </code>{' '}
                  → nový{' '}
                  <code>
                    {formatPercentSk(percent)} · {formatDateSk(from)} – {formatDateSk(to)}
                  </code>
                </li>
              ))}
            </ul>
            <p className="ovl-small ovl-muted" style={{ marginBottom: 0 }}>
              Ide o posledný vlastný zápis — shop môže mať iný stav.
            </p>
          </div>
        ) : null}

        {hideModeToggle ? null : (
          <label className="ovl-small" data-testid="eager-toggle">
            <input
              type="checkbox"
              checked={eager}
              disabled={submitting}
              onChange={(e) => setEager(e.target.checked)}
            />{' '}
            Zapísať hneď s budúcim OD (eager write) — inak zápis vykoná plánovač v deň OD
          </label>
        )}

        <div className="ovl-card ovl-card--danger" data-testid="irreversible-note">
          <strong>Nevratná operácia:</strong> zápis do produkčného shopu sa už{' '}
          <strong>nedá zrušiť, len prepísať</strong> novou zľavou. Zľava pobeží od 00:00 dňa{' '}
          {formatDateSk(from)} do 23:59 dňa {formatDateSk(to)} (čas shopu) na {items.length}{' '}
          {items.length === 1 ? 'produkte' : 'produktoch'} so zľavou {formatPercentSk(percent)}.
        </div>

        {oneDay ? (
          <label className="ovl-small" data-testid="one-day-ack">
            <input
              type="checkbox"
              checked={oneDayAck}
              disabled={submitting}
              onChange={(e) => setOneDayAck(e.target.checked)}
            />{' '}
            Rozumiem, že ide o <strong>jednodňovú</strong> zľavu (OD = DO) a je to zámer.
          </label>
        ) : null}

        {error ? <ErrorMessage message={error.message} rawCode={error.rawCode} /> : null}

        <div className="ovl-row" style={{ gap: '0.5rem' }}>
          <Button onClick={onBack} disabled={submitting}>
            ← Späť na úpravu
          </Button>
          <Button
            variant="danger"
            disabled={!canSubmit}
            disabledReason={
              oneDay && !oneDayAck
                ? 'Najprv potvrď jednodňovú zľavu.'
                : !sudoChecked
                  ? 'Overuje sa session…'
                  : undefined
            }
            onClick={handleConfirmClick}
            data-testid="write-to-production"
          >
            {submitting ? 'Zapisuje sa…' : 'Zapísať do PRODUKCIE'}
          </Button>
        </div>
      </div>

      {showSudo && pendingSubmit ? (
        <SudoPrompt
          actionLabel={actionLabel}
          onSuccess={(newSudoUntil) => {
            setSudoUntil(newSudoUntil);
            setShowSudo(false);
            const p = pendingSubmit;
            setPendingSubmit(null);
            void onConfirm(p);
          }}
          onCancel={() => {
            setShowSudo(false);
            setPendingSubmit(null);
          }}
        />
      ) : null}
    </section>
  );
}

export default ConfirmPanel;
