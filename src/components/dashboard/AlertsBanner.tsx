'use client';

/**
 * Aura Zľavy — agregovaný banner ohrozených kampaní (D8, D26, D33b).
 *
 * `needs_key` aj `missed` majú ROVNAKÚ vizuálnu váhu — jeden spoločný
 * danger banner, žiadna hierarchia medzi nimi. Zmeškaná kampaň sa nikdy
 * nedobieha automaticky; banner vedie na manuálne rozhodnutie.
 */
import Link from 'next/link';

import { formatDateSk } from '@/lib/ui/format';
import type { CampaignRow } from '@/components/dashboard/api';

export interface AlertsBannerProps {
  needsKey: readonly CampaignRow[];
  missed: readonly CampaignRow[];
}

export function AlertsBanner({ needsKey, missed }: AlertsBannerProps) {
  if (needsKey.length === 0 && missed.length === 0) return null;

  const line = (c: CampaignRow, why: string) => (
    <li key={`${why}-${c.id}`}>
      <Link href={`/kampane/${c.id}`}>
        <strong>{c.name}</strong>
      </Link>{' '}
      — {why}, okno {formatDateSk(c.dateFrom)} – {formatDateSk(c.dateTo)}, −{c.percent} %
    </li>
  );

  return (
    <section className="ovl-alerts-banner" role="alert" data-testid="alerts-banner">
      <strong>
        Kampane vyžadujú tvoj zásah ({needsKey.length + missed.length})
      </strong>
      <ul>
        {needsKey.map((c) => line(c, 'vyžaduje kľúč'))}
        {missed.map((c) => line(c, 'zmeškaný štart — nedobieha sa automaticky'))}
      </ul>
      <span className="ovl-small">
        Ani jedna z týchto kampaní nič nezapíše, kým o nej ručne nerozhodneš
        v jej detaile.
      </span>
    </section>
  );
}

export default AlertsBanner;
