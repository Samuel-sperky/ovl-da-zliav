'use client';

/**
 * Aura Zľavy — detail kampane (D15, D16, D19, I3, I7, I11).
 *
 * Detail + `ItemsTable` + „Zopakovať zlyhané" (vždy cez nový dry-run) +
 * „Predĺžiť" (len `to`) + „Zrušiť kampaň" + `AuditTrail`. Zrušiť sa dá
 * VÝHRADNE kampaň v našej DB (draft/scheduled/needs_key/missed) — rušenie
 * už zapísanej zľavy v shope UI neponúka VÔBEC (I7). Manuálne dopálenie
 * `needs_key`/`missed` kampane (D33b) ide tiež cez nový dry-run (I3).
 */
import { useCallback, useEffect, useState } from 'react';

import type {
  ApiError,
  CampaignDetailResponse,
  PreviewResponse,
} from '@/components/campaigns/api';
import { getJson, postJson, todayDateOnly } from '@/components/campaigns/api';
import AuditTrail from '@/components/campaigns/AuditTrail';
import ConfirmPanel, { type ConfirmSubmit } from '@/components/campaigns/ConfirmPanel';
import DryRunTable from '@/components/campaigns/DryRunTable';
import ExtendDialog from '@/components/campaigns/ExtendDialog';
import ItemsTable from '@/components/campaigns/ItemsTable';
import RetryFailedButton from '@/components/campaigns/RetryFailedButton';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateSk, formatDateTimeSk, formatPercentSk } from '@/lib/ui/format';

const CANCELLABLE = ['draft', 'scheduled', 'needs_key', 'missed'] as const;
const EXECUTABLE = ['needs_key', 'missed'] as const;
const FINISHED = ['done', 'partial', 'failed', 'missed', 'lapsed'] as const;

export interface CampaignDetailProps {
  campaignId: number;
}

export function CampaignDetail({ campaignId }: CampaignDetailProps) {
  const [detail, setDetail] = useState<CampaignDetailResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showExtend, setShowExtend] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [execPreview, setExecPreview] = useState<PreviewResponse | null>(null);
  const [execWriting, setExecWriting] = useState(false);
  const [execLoading, setExecLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await getJson<CampaignDetailResponse>(`/api/campaigns/${campaignId}`);
    if (res.ok) {
      setDetail(res.data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadFailed) {
    return (
      <p className="ovl-error" role="alert">
        Kampaň sa nepodarilo načítať. <a href="/kampane">Späť na zoznam</a>.
      </p>
    );
  }
  if (!detail) {
    return <div className="ovl-card ovl-skeleton" style={{ minHeight: '10rem' }} aria-busy="true" />;
  }

  const c = detail.campaign;
  const today = todayDateOnly();
  const derived =
    c.derived ??
    (c.status === 'done'
      ? c.dateTo < today
        ? 'expirovana'
        : c.dateFrom <= today
          ? 'aktivna'
          : null
      : null);
  const canCancel = (CANCELLABLE as readonly string[]).includes(c.status);
  const canExecute = (EXECUTABLE as readonly string[]).includes(c.status);
  const canExtend = c.status === 'done' && c.dateTo >= today;
  const canAck = (FINISHED as readonly string[]).includes(c.status);

  async function cancelCampaign() {
    setError(null);
    setCancelling(true);
    const res = await postJson<{ status: string }>(`/api/campaigns/${campaignId}/cancel`, {
      reason: 'zrušené používateľom v detaile kampane',
    });
    setCancelling(false);
    if (res.ok) void load();
    else setError(res.error);
  }

  async function startExecuteDryRun() {
    // Manuálne dopálenie (D33b) MUSÍ prejsť novým dry-runom (I3).
    setError(null);
    setExecLoading(true);
    const res = await postJson<PreviewResponse>('/api/campaigns/preview', {
      productIds: detail!.items.map((it) => it.productId).sort((a, b) => a - b),
      percent: c.percent,
      from: c.dateFrom,
      to: c.dateTo,
      kind: 'retry',
      parentCampaignId: c.id,
    });
    setExecLoading(false);
    if (res.ok) setExecPreview(res.data);
    else setError(res.error);
  }

  async function confirmExecute(_submit: ConfirmSubmit) {
    if (!execPreview) return;
    setError(null);
    setExecWriting(true);
    const res = await postJson<{ status: string }>(`/api/campaigns/${campaignId}/execute`, {
      previewToken: execPreview.previewToken,
    });
    setExecWriting(false);
    if (res.ok) {
      setExecPreview(null);
      void load();
    } else {
      setError(res.error);
    }
  }

  return (
    <div className="ovl-stack" style={{ gap: '1.25rem' }} data-testid="campaign-detail">
      <section className="ovl-card">
        <div className="ovl-spread">
          <h1 style={{ margin: 0, fontSize: '1.3rem' }}>
            {c.name} <span className="ovl-muted ovl-small">#{c.id}</span>
          </h1>
          <StatusBadge status={c.status} derived={derived} />
        </div>
        <dl className="ovl-small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', margin: '0.75rem 0 0' }}>
          <dt className="ovl-muted">Zľava</dt>
          <dd style={{ margin: 0 }}>{formatPercentSk(c.percent)}</dd>
          <dt className="ovl-muted">Okno</dt>
          <dd style={{ margin: 0 }}>
            {formatDateSk(c.dateFrom)} – {formatDateSk(c.dateTo)} (od 00:00 dňa OD do 23:59 dňa DO, čas shopu)
            {c.dateFromOriginal && c.dateFromOriginal !== c.dateFrom
              ? ` · pôvodné OD ${formatDateSk(c.dateFromOriginal)}`
              : ''}
          </dd>
          <dt className="ovl-muted">Režim</dt>
          <dd style={{ margin: 0 }}>{c.mode === 'eager' ? 'okamžitý zápis (eager)' : 'plánovaný'}</dd>
          <dt className="ovl-muted">Položky</dt>
          <dd style={{ margin: 0 }}>
            {c.itemsOk} ok · {c.itemsFailed} zlyhané · {c.itemsUncertain} neisté · spolu {c.itemsTotal}
          </dd>
          <dt className="ovl-muted">Potvrdená</dt>
          <dd style={{ margin: 0 }}>{formatDateTimeSk(c.confirmedAt)}</dd>
          <dt className="ovl-muted">Dokončená</dt>
          <dd style={{ margin: 0 }}>{formatDateTimeSk(c.finishedAt)}</dd>
          {c.statusReason ? (
            <>
              <dt className="ovl-muted">Dôvod stavu</dt>
              <dd style={{ margin: 0 }}>{c.statusReason}</dd>
            </>
          ) : null}
        </dl>
        <p className="ovl-small ovl-muted" style={{ marginBottom: 0 }}>
          Všetky stavy zľavy vychádzajú z posledného VLASTNÉHO zápisu — shop môže mať iný stav (I11).
          Už zapísaná zľava sa nedá zrušiť, len prepísať novou kampaňou (I7).
        </p>
      </section>

      {error ? <ErrorMessage message={error.message} rawCode={error.code} /> : null}

      <div className="ovl-row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        {canExecute ? (
          <Button variant="primary" disabled={execLoading || execPreview != null} onClick={() => void startExecuteDryRun()}>
            {execLoading ? 'Pripravuje sa dry-run…' : 'Dopáliť teraz (cez dry-run)'}
          </Button>
        ) : null}
        {canExtend ? (
          <Button onClick={() => setShowExtend(true)} disabled={showExtend}>
            Predĺžiť
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="danger" disabled={cancelling} onClick={() => void cancelCampaign()}>
            {cancelling ? 'Ruší sa…' : 'Zrušiť kampaň (len plán v DB)'}
          </Button>
        ) : null}
        {canAck ? (
          <Button
            small
            onClick={() =>
              void postJson(`/api/campaigns/${campaignId}/ack`).then(() => void load())
            }
          >
            Beriem na vedomie výsledok
          </Button>
        ) : null}
      </div>

      {execPreview ? (
        <div className="ovl-stack" style={{ gap: '1rem' }} data-testid="execute-dry-run">
          <h2>Dry-run dopálenia (nové potvrdenie je povinné, I3)</h2>
          <DryRunTable
            items={execPreview.items}
            warnings={execPreview.warnings}
            blockers={execPreview.blockers}
            percent={c.percent}
            from={c.dateFrom}
            to={c.dateTo}
          />
          {execPreview.blockers.length === 0 ? (
            <ConfirmPanel
              items={execPreview.items}
              warnings={execPreview.warnings}
              percent={c.percent}
              from={c.dateFrom}
              to={c.dateTo}
              defaultName={c.name}
              nameLocked
              hideModeToggle
              actionLabel="Manuálne dopálenie kampane v PRODUKCII"
              submitting={execWriting}
              error={error ? { message: error.message, rawCode: error.code } : null}
              onConfirm={confirmExecute}
              onBack={() => setExecPreview(null)}
            />
          ) : (
            <Button onClick={() => setExecPreview(null)}>Zavrieť</Button>
          )}
        </div>
      ) : null}

      {showExtend ? (
        <ExtendDialog
          campaign={c}
          onDone={(newId) => {
            window.location.href = `/kampane/${newId}`;
          }}
          onClose={() => setShowExtend(false)}
        />
      ) : null}

      <section>
        <h2>Položky</h2>
        <ItemsTable items={detail.items} />
      </section>

      <RetryFailedButton
        campaign={c}
        items={detail.items}
        onDone={(newId) => {
          window.location.href = `/kampane/${newId}`;
        }}
      />

      <AuditTrail rows={detail.auditTrail ?? []} />
    </div>
  );
}

export default CampaignDetail;
