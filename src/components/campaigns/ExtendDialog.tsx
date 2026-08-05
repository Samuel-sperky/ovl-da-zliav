'use client';

/**
 * Aura Zľavy — dialóg „Predĺžiť" (D19, D27, I3).
 *
 * Všetko predvyplnené; editovateľné je VÝHRADNE pole `to`. Zmena percenta
 * nie je súčasťou predĺženia (to je prepis, D27). Tok je dvojkrokový:
 * `POST /api/campaigns/[id]/extend/preview` → dry-run → `ConfirmPanel` →
 * `POST /api/campaigns/[id]/extend`. Pri prekročení 3-mesačného stropu od
 * pôvodného `from` UI ponúkne prepis s novým `from` ako vedomú alternatívu.
 */
import { useState } from 'react';

import type { ApiError, CampaignDetailView, PreviewResponse } from '@/components/campaigns/api';
import { postJson, validateExtendTo } from '@/components/campaigns/api';
import ConfirmPanel, { type ConfirmSubmit } from '@/components/campaigns/ConfirmPanel';
import DryRunTable from '@/components/campaigns/DryRunTable';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { formatDateSk, formatPercentSk } from '@/lib/ui/format';

export interface ExtendDialogProps {
  campaign: CampaignDetailView;
  onDone: (newCampaignId: number) => void;
  onClose: () => void;
}

type Phase = 'form' | 'previewing' | 'preview' | 'writing';

export function ExtendDialog({ campaign, onDone, onClose }: ExtendDialogProps) {
  const [to, setTo] = useState(campaign.dateTo);
  const [phase, setPhase] = useState<Phase>('form');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const lockedFrom = campaign.dateFromOriginal ?? campaign.dateFrom;
  const localError = to === campaign.dateTo ? null : validateExtendTo(lockedFrom, campaign.dateTo, to);
  const overCap = localError != null && localError.includes('3-mesačný strop');

  async function startDryRun() {
    // Lokálna validácia pred serverom (I9).
    if (to === campaign.dateTo || validateExtendTo(lockedFrom, campaign.dateTo, to)) return;
    setError(null);
    setPhase('previewing');
    const res = await postJson<PreviewResponse>(`/api/campaigns/${campaign.id}/extend/preview`, { to });
    if (res.ok) {
      setPreview(res.data);
      setPhase('preview');
    } else {
      setError(res.error);
      setPhase('form');
    }
  }

  async function confirm(_submit: ConfirmSubmit) {
    if (!preview) return;
    setError(null);
    setPhase('writing');
    const res = await postJson<{ campaignId: number }>(`/api/campaigns/${campaign.id}/extend`, {
      previewToken: preview.previewToken,
    });
    if (res.ok) onDone(res.data.campaignId);
    else {
      setError(res.error);
      setPhase('preview');
    }
  }

  return (
    <section className="ovl-card" data-testid="extend-dialog">
      <h2 style={{ marginTop: 0 }}>Predĺžiť kampaň</h2>

      {phase === 'form' || phase === 'previewing' ? (
        <div className="ovl-stack" style={{ gap: '0.75rem' }}>
          <p className="ovl-small">
            Predĺženie pošle jeden zápis s <strong>rovnakým OD</strong> ({formatDateSk(campaign.dateFrom)}),{' '}
            <strong>rovnakým percentom</strong> ({formatPercentSk(campaign.percent)}) a novým DO. Zmena
            percenta nie je predĺženie — je to prepis (D27).
          </p>
          <label className="ovl-small">
            Nové DO{' '}
            <input
              type="date"
              value={to}
              min={campaign.dateTo}
              onChange={(e) => setTo(e.target.value)}
              disabled={phase === 'previewing'}
              data-testid="extend-to"
            />
          </label>
          <p className="ovl-small ovl-muted">
            Zľava platí od 00:00 dňa OD do 23:59 dňa DO, čas shopu.
          </p>
          {localError ? (
            <p className="ovl-error ovl-small" role="alert">
              {localError}
            </p>
          ) : null}
          {overCap ? (
            <p className="ovl-small">
              Vedomá alternatíva: vytvor <a href={`/kampane/nova?prepis=${campaign.id}`}>prepis s novým OD</a>{' '}
              — pôjde o novú kampaň s vlastným dry-runom (D27, D28).
            </p>
          ) : null}
          {error ? <ErrorMessage message={error.message} rawCode={error.code} /> : null}
          <div className="ovl-row" style={{ gap: '0.5rem' }}>
            <Button onClick={onClose} disabled={phase === 'previewing'}>
              Zavrieť
            </Button>
            <Button
              variant="primary"
              disabled={phase === 'previewing' || to === campaign.dateTo || localError != null}
              disabledReason={localError ?? 'Zadaj neskorší dátum DO.'}
              onClick={() => void startDryRun()}
            >
              {phase === 'previewing' ? 'Pripravuje sa dry-run…' : 'Dry-run predĺženia'}
            </Button>
          </div>
        </div>
      ) : null}

      {preview && (phase === 'preview' || phase === 'writing') ? (
        <div className="ovl-stack" style={{ gap: '1rem' }}>
          <DryRunTable
            items={preview.items}
            warnings={preview.warnings}
            blockers={preview.blockers}
            percent={campaign.percent}
            from={campaign.dateFrom}
            to={to}
          />
          {preview.blockers.length === 0 ? (
            <ConfirmPanel
              items={preview.items}
              warnings={preview.warnings}
              percent={campaign.percent}
              from={campaign.dateFrom}
              to={to}
              defaultName={`${campaign.name} — predĺženie`}
              nameLocked
              hideModeToggle
              actionLabel="Predĺženie zľavy v PRODUKCII"
              submitting={phase === 'writing'}
              error={error ? { message: error.message, rawCode: error.code } : null}
              onConfirm={confirm}
              onBack={() => {
                setPreview(null);
                setError(null);
                setPhase('form');
              }}
            />
          ) : (
            <Button
              onClick={() => {
                setPreview(null);
                setPhase('form');
              }}
            >
              ← Späť
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default ExtendDialog;
