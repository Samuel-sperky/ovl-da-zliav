'use client';

/**
 * Aura Zľavy — neodklikané výsledky kampaní (D17, O6).
 *
 * Výsledky odpálené schedulerom ostávajú na vrchu dashboardu, kým ich
 * používateľ neodklikne. Žiadny e-mail/SMTP neexistuje — toto JE
 * notifikačný kanál.
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDateTimeSk } from '@/lib/ui/format';
import { ackCampaign, type UnackedResult } from '@/components/dashboard/api';

export function UnackedResults({ results }: { results: readonly UnackedResult[] }) {
  const [acked, setAcked] = useState<ReadonlySet<number>>(new Set());
  const visible = results.filter((r) => !acked.has(r.campaignId));
  if (visible.length === 0) return null;

  async function ack(campaignId: number) {
    const ok = await ackCampaign(campaignId);
    if (ok) setAcked((prev) => new Set(prev).add(campaignId));
  }

  return (
    <section className="ovl-card ovl-card--warning" data-testid="unacked-results">
      <h2>Nepotvrdené výsledky kampaní</h2>
      <div className="ovl-stack">
        {visible.map((r) => (
          <div className="ovl-spread" key={r.campaignId}>
            <span className="ovl-row">
              <a href={`/kampane/${r.campaignId}`}>
                <strong>{r.name}</strong>
              </a>
              <StatusBadge status={r.status} />
              <span className="ovl-small ovl-muted">
                dokončená {formatDateTimeSk(r.finishedAt)}
              </span>
            </span>
            <Button small onClick={() => void ack(r.campaignId)}>
              Beriem na vedomie
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default UnackedResults;
