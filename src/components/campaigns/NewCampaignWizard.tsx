'use client';

/**
 * Aura Zľavy — sprievodca novou kampaňou (D2, D3, D11–D13, D22, D28, I3, I9).
 *
 * Striktne DVOJKROKOVÝ tok: krok 1 (výber produktov len z allowlistu,
 * percento, okno) → `POST /api/campaigns/preview` → krok 2 (`DryRunTable`
 * + `ConfirmPanel` so samostatným tlačidlom „Zapísať do PRODUKCIE") →
 * `POST /api/campaigns`. Žiadna cesta nezapisuje bez dry-run náhľadu.
 * Stavy: draft → preview → confirming/writing → result.
 */
import { useEffect, useMemo, useState } from 'react';

import type {
  AllowlistProduct,
  ApiError,
  PreviewResponse,
} from '@/components/campaigns/api';
import {
  getJson,
  postJson,
  todayDateOnly,
  validatePercent,
  validateWindow,
} from '@/components/campaigns/api';
import ConfirmPanel, { type ConfirmSubmit } from '@/components/campaigns/ConfirmPanel';
import DateRangePicker from '@/components/campaigns/DateRangePicker';
import DryRunTable from '@/components/campaigns/DryRunTable';
import PercentInput from '@/components/campaigns/PercentInput';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import SelfWriteBadge from '@/components/ui/SelfWriteBadge';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateSk, formatEur } from '@/lib/ui/format';

type Phase = 'draft' | 'previewing' | 'preview' | 'writing' | 'result';

interface ResultData {
  campaignId: number;
  status: string;
}

export function NewCampaignWizard() {
  const [phase, setPhase] = useState<Phase>('draft');
  const [allowlist, setAllowlist] = useState<AllowlistProduct[] | null>(null);
  const [eagerDefault, setEagerDefault] = useState(true);
  const [selected, setSelected] = useState<number[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const [from, setFrom] = useState(todayDateOnly());
  const [to, setTo] = useState('');
  const [overwriteIntent, setOverwriteIntent] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ResultData | null>(null);

  useEffect(() => {
    void getJson<AllowlistProduct[]>('/api/allowlist').then((res) => {
      setAllowlist(res.ok ? res.data.filter((p) => p.slot != null) : []);
    });
    void getJson<{ eagerWriteDefault: boolean }>('/api/settings').then((res) => {
      if (res.ok) setEagerDefault(res.data.eagerWriteDefault);
    });
  }, []);

  // Vedomé prepísanie (D28): predvoľba, keď vybraný produkt má podľa
  // vlastnej DB bežiacu/naplánovanú zľavu.
  const selectedWithOwnWrite = useMemo(() => {
    if (!allowlist) return [];
    const today = todayDateOnly();
    return allowlist.filter(
      (p) => selected.includes(p.productId) && p.lastOwnWrite != null && p.lastOwnWrite.to >= today,
    );
  }, [allowlist, selected]);

  const percentError = percent == null ? 'Zadaj percento zľavy.' : validatePercent(percent);
  const windowError = !to ? 'Zadaj dátum DO.' : validateWindow(from, to);
  const selectionError =
    selected.length === 0
      ? 'Vyber aspoň jeden produkt.'
      : selected.length > 10
        ? 'Jedna operácia môže zapísať najviac 10 produktov.'
        : null;
  const localValid = !percentError && !windowError && !selectionError;

  function toggleProduct(productId: number) {
    setSelected((cur) =>
      cur.includes(productId) ? cur.filter((id) => id !== productId) : [...cur, productId],
    );
  }

  async function startDryRun() {
    // Lokálna validácia VŽDY pred serverom (I9).
    if (!localValid || percent == null) return;
    setError(null);
    setPhase('previewing');
    const res = await postJson<PreviewResponse>('/api/campaigns/preview', {
      productIds: [...selected].sort((a, b) => a - b),
      percent,
      from,
      to,
      kind: overwriteIntent || selectedWithOwnWrite.length > 0 ? 'overwrite' : 'new',
    });
    if (res.ok) {
      setPreview(res.data);
      setPhase('preview');
    } else {
      setError(res.error);
      setPhase('draft');
    }
  }

  async function confirm(submit: ConfirmSubmit) {
    if (!preview) return;
    setError(null);
    setPhase('writing');
    const res = await postJson<ResultData>('/api/campaigns', {
      previewToken: preview.previewToken,
      name: submit.name,
      mode: submit.mode,
      acknowledgements: submit.acknowledgements,
    });
    if (res.ok) {
      setResult(res.data);
      setPhase('result');
    } else {
      setError(res.error);
      setPhase('preview');
    }
  }

  /* ── result ── */
  if (phase === 'result' && result) {
    return (
      <section className="ovl-card" data-testid="wizard-result">
        <h2 style={{ marginTop: 0 }}>Kampaň vytvorená</h2>
        <p>
          Kampaň <strong>#{result.campaignId}</strong> má stav{' '}
          <StatusBadge status={result.status as never} />.
        </p>
        <p className="ovl-small ovl-muted">
          Skutočný stav zľavy v shope sa cez API nedá overiť — zobrazujeme len vlastné zápisy (I11).
        </p>
        <div className="ovl-row" style={{ gap: '0.5rem' }}>
          <a className="ovl-btn ovl-btn--primary" href={`/kampane/${result.campaignId}`}>
            Otvoriť detail kampane
          </a>
          <a className="ovl-btn" href="/kampane">
            Späť na zoznam
          </a>
        </div>
      </section>
    );
  }

  /* ── krok 2: dry-run + potvrdenie ── */
  if (preview && (phase === 'preview' || phase === 'writing') && percent != null) {
    return (
      <div className="ovl-stack" style={{ gap: '1rem' }} data-testid="wizard-step2">
        <h2>Krok 2 — dry-run náhľad</h2>
        <DryRunTable
          items={preview.items}
          warnings={preview.warnings}
          blockers={preview.blockers}
          percent={percent}
          from={from}
          to={to}
        />
        {preview.blockers.length === 0 ? (
          <ConfirmPanel
            items={preview.items}
            warnings={preview.warnings}
            percent={percent}
            from={from}
            to={to}
            defaultName={`Zľava −${percent} % (${formatDateSk(from)} – ${formatDateSk(to)})`}
            eagerDefault={eagerDefault}
            submitting={phase === 'writing'}
            error={error ? { message: error.message, rawCode: error.code } : null}
            onConfirm={confirm}
            onBack={() => {
              setPreview(null);
              setError(null);
              setPhase('draft');
            }}
          />
        ) : (
          <Button
            onClick={() => {
              setPreview(null);
              setPhase('draft');
            }}
          >
            ← Späť na úpravu
          </Button>
        )}
      </div>
    );
  }

  /* ── krok 1: draft ── */
  return (
    <div className="ovl-stack" style={{ gap: '1.25rem' }} data-testid="wizard-step1">
      <section className="ovl-card">
        <h2 style={{ marginTop: 0 }}>1. Produkty (len allowlist, max 10)</h2>
        {allowlist == null ? (
          <div className="ovl-skeleton" style={{ minHeight: '4rem' }} aria-busy="true" />
        ) : allowlist.length === 0 ? (
          <p className="ovl-muted">
            Allowlist je prázdny — najprv pridaj produkty v sekcii <a href="/produkty">Produkty</a>.
          </p>
        ) : (
          <div className="ovl-stack" style={{ gap: '0.4rem' }}>
            {allowlist.map((p) => (
              <label key={p.productId} className="ovl-row ovl-small" style={{ gap: '0.5rem', alignItems: 'baseline' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.productId)}
                  onChange={() => toggleProduct(p.productId)}
                  data-testid={`product-${p.productId}`}
                />
                <span>
                  {p.name ?? p.label ?? 'bez názvu'}{' '}
                  <span className="ovl-muted">#{p.productId} · {formatEur(p.price)}</span>
                </span>
                <SelfWriteBadge
                  writtenAt={p.lastOwnWrite?.at ?? null}
                  detail={
                    p.lastOwnWrite
                      ? `−${p.lastOwnWrite.percent} % · ${formatDateSk(p.lastOwnWrite.from)} – ${formatDateSk(p.lastOwnWrite.to)}`
                      : undefined
                  }
                />
              </label>
            ))}
          </div>
        )}
        {selectionError && selected.length > 0 ? (
          <p className="ovl-error ovl-small" role="alert">
            {selectionError}
          </p>
        ) : null}
        {selectedWithOwnWrite.length > 0 ? (
          <p className="ovl-small" data-testid="overwrite-hint">
            ⚠ {selectedWithOwnWrite.length}{' '}
            {selectedWithOwnWrite.length === 1 ? 'vybraný produkt má' : 'vybrané produkty majú'} podľa
            vlastnej DB bežiacu alebo naplánovanú zľavu — kampaň pôjde ako explicitné{' '}
            <strong>prepísanie</strong> s diffom starý → nový v potvrdení (D28).
          </p>
        ) : (
          <label className="ovl-small">
            <input
              type="checkbox"
              checked={overwriteIntent}
              onChange={(e) => setOverwriteIntent(e.target.checked)}
            />{' '}
            Vedome prepisujem prípadnú existujúcu zľavu (D28)
          </label>
        )}
      </section>

      <section className="ovl-card">
        <h2 style={{ marginTop: 0 }}>2. Percento</h2>
        <PercentInput value={percent} onChange={setPercent} />
      </section>

      <section className="ovl-card">
        <h2 style={{ marginTop: 0 }}>3. Okno platnosti</h2>
        <DateRangePicker
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
      </section>

      {error ? <ErrorMessage message={error.message} rawCode={error.code} /> : null}

      <div className="ovl-row" style={{ gap: '0.5rem' }}>
        <a className="ovl-btn" href="/kampane">
          Zrušiť
        </a>
        <Button
          variant="primary"
          disabled={!localValid || phase === 'previewing'}
          disabledReason={selectionError ?? percentError ?? windowError ?? undefined}
          onClick={() => void startDryRun()}
        >
          {phase === 'previewing' ? 'Pripravuje sa dry-run…' : 'Pokračovať na dry-run →'}
        </Button>
      </div>
      <p className="ovl-small ovl-muted">
        Zápis do produkcie je vždy dvojkrokový: najprv dry-run náhľad, až potom samostatné tlačidlo
        „Zapísať do PRODUKCIE" (D2, I3).
      </p>
    </div>
  );
}

export default NewCampaignWizard;
