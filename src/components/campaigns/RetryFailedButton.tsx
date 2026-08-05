'use client';

/**
 * Aura Zľavy — „Zopakovať zlyhané" (D15, D16, D36, I3).
 *
 * VŽDY prechádza novým dry-run potvrdením, aj pri identických parametroch:
 * klik → `POST /api/campaigns/preview` (kind='retry') → `DryRunTable` →
 * `ConfirmPanel` → `POST /api/campaigns/[id]/retry-failed` s novým
 * `previewToken`. Neexistuje skratka, ktorá by dry-run obišla.
 */
import { useState } from 'react';

import type {
  ApiError,
  CampaignDetailView,
  CampaignItemView,
  PreviewResponse,
} from '@/components/campaigns/api';
import { postJson } from '@/components/campaigns/api';
import ConfirmPanel, { type ConfirmSubmit } from '@/components/campaigns/ConfirmPanel';
import DryRunTable from '@/components/campaigns/DryRunTable';
import { retryableProductIds } from '@/components/campaigns/ItemsTable';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';

export interface RetryFailedButtonProps {
  campaign: CampaignDetailView;
  items: CampaignItemView[];
  /** Po úspechu — nová retry kampaň. */
  onDone: (newCampaignId: number) => void;
  disabled?: boolean;
  disabledReason?: string;
}

type Phase = 'idle' | 'previewing' | 'preview' | 'writing';

export function RetryFailedButton({
  campaign,
  items,
  onDone,
  disabled,
  disabledReason,
}: RetryFailedButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const productIds = retryableProductIds(items);

  async function startDryRun() {
    setError(null);
    setPhase('previewing');
    const res = await postJson<PreviewResponse>('/api/campaigns/preview', {
      productIds,
      percent: campaign.percent,
      from: campaign.dateFrom,
      to: campaign.dateTo,
      kind: 'retry',
      parentCampaignId: campaign.id,
    });
    if (res.ok) {
      setPreview(res.data);
      setPhase('preview');
    } else {
      setError(res.error);
      setPhase('idle');
    }
  }

  async function confirm(_submit: ConfirmSubmit) {
    if (!preview) return;
    setError(null);
    setPhase('writing');
    const res = await postJson<{ campaignId: number }>(
      `/api/campaigns/${campaign.id}/retry-failed`,
      { previewToken: preview.previewToken },
    );
    if (res.ok) {
      onDone(res.data.campaignId);
    } else {
      setError(res.error);
      setPhase('preview');
    }
  }

  if (productIds.length === 0) return null;

  return (
    <div className="ovl-stack" data-testid="retry-failed">
      {phase === 'idle' || phase === 'previewing' ? (
        <>
          <Button
            variant="primary"
            disabled={disabled || phase === 'previewing'}
            disabledReason={disabledReason}
            onClick={() => void startDryRun()}
          >
            {phase === 'previewing' ? 'Pripravuje sa dry-run…' : `Zopakovať zlyhané (${productIds.length})`}
          </Button>
          {error ? <ErrorMessage message={error.message} rawCode={error.code} /> : null}
        </>
      ) : null}

      {preview && (phase === 'preview' || phase === 'writing') ? (
        <div className="ovl-stack" style={{ gap: '1rem' }}>
          <h2>Dry-run opakovania (nové potvrdenie je povinné, D16)</h2>
          <DryRunTable
            items={preview.items}
            warnings={preview.warnings}
            blockers={preview.blockers}
            percent={campaign.percent}
            from={campaign.dateFrom}
            to={campaign.dateTo}
          />
          {preview.blockers.length === 0 ? (
            <ConfirmPanel
              items={preview.items}
              warnings={preview.warnings}
              percent={campaign.percent}
              from={campaign.dateFrom}
              to={campaign.dateTo}
              defaultName={`${campaign.name} — opakovanie`}
              nameLocked
              hideModeToggle
              actionLabel="Opakovanie zlyhaných zápisov v PRODUKCII"
              submitting={phase === 'writing'}
              error={error ? { message: error.message, rawCode: error.code } : null}
              onConfirm={confirm}
              onBack={() => {
                setPreview(null);
                setError(null);
                setPhase('idle');
              }}
            />
          ) : (
            <Button
              onClick={() => {
                setPreview(null);
                setPhase('idle');
              }}
            >
              Zavrieť
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default RetryFailedButton;
