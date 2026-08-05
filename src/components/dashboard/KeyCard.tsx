'use client';

/**
 * Aura Zľavy — karta stavu API kľúča na dashboarde (D1, D5, D65).
 *
 * last4, kedy uložený, živý odpočet TTL a verify status. Nikdy nič viac
 * než metadáta (I1). Pri chýbajúcom kľúči výzva na vloženie (D10).
 */
import Link from 'next/link';

import Countdown from '@/components/ui/Countdown';
import { formatDateTimeSk } from '@/lib/ui/format';
import type { KeyData } from '@/components/dashboard/api';

const VERIFY_LABELS: Record<string, { label: string; tone: string }> = {
  valid: { label: 'overený sondou', tone: 'ok' },
  invalid: { label: 'neplatný', tone: 'danger' },
  forbidden: { label: 'nedostatočný scope', tone: 'danger' },
  unverified: { label: 'neoverený', tone: 'neutral' },
};

export function KeyCard({ keyData }: { keyData: KeyData | null }) {
  if (!keyData || !keyData.present) {
    return (
      <section className="ovl-card ovl-card--danger" data-testid="key-card">
        <h2>API kľúč</h2>
        <p>
          <span className="ovl-badge ovl-badge--danger">kľúč chýba</span>
        </p>
        <p className="ovl-small ovl-muted">
          Bez kľúča je appka len na čítanie a naplánované kampane skončia
          v stave „vyžaduje kľúč“.
        </p>
        <Link href="/nastavenia">Vložiť kľúč v Nastaveniach →</Link>
      </section>
    );
  }

  const verify = keyData.verifyStatus ? VERIFY_LABELS[keyData.verifyStatus] : null;

  return (
    <section className="ovl-card" data-testid="key-card">
      <h2>API kľúč</h2>
      <div className="ovl-stack">
        <div className="ovl-spread">
          <span>
            Kľúč <code>····{keyData.last4 ?? '????'}</code>
          </span>
          {verify ? (
            <span className={`ovl-badge ovl-badge--${verify.tone}`}>{verify.label}</span>
          ) : null}
        </div>
        <div className="ovl-small ovl-muted">
          uložený {formatDateTimeSk(keyData.savedAt)}
        </div>
        <div>
          zostáva{' '}
          <strong>
            <Countdown expiresAt={keyData.expiresAt} expiredLabel="expirovaný" />
          </strong>{' '}
          <span className="ovl-small ovl-muted">(TTL max 48 h, potom sa kľúč zmaže)</span>
        </div>
      </div>
    </section>
  );
}

export default KeyCard;
