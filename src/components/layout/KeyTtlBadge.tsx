'use client';

/**
 * Aura Zľavy — badge TTL API kľúča (D5).
 *
 * Štyri vizuálne stavy: kľúč chýba (danger), > 6 h (neutrál/ok),
 * ≤ 6 h (výstraha), ≤ 1 h (kritická). Odpočet beží klientsky každú sekundu.
 */
import { useEffect, useState } from 'react';

import { formatCountdownSk } from '@/lib/ui/format';

export interface KeyTtlBadgeProps {
  present: boolean;
  /** ISO čas expirácie; `null` keď kľúč chýba. */
  expiresAt: string | null;
}

const SIX_HOURS = 6 * 3600;
const ONE_HOUR = 3600;

export function KeyTtlBadge({ present, expiresAt }: KeyTtlBadgeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!present || !expiresAt) {
    return (
      <span className="ovl-badge ovl-badge--danger" data-testid="key-ttl-badge" data-state="missing">
        kľúč chýba
      </span>
    );
  }

  const left = Math.floor((new Date(expiresAt).getTime() - now) / 1000);

  if (left <= 0) {
    return (
      <span className="ovl-badge ovl-badge--danger" data-testid="key-ttl-badge" data-state="missing">
        kľúč expiroval
      </span>
    );
  }

  const state = left <= ONE_HOUR ? 'critical' : left <= SIX_HOURS ? 'warning' : 'ok';
  const tone = state === 'critical' ? 'danger' : state === 'warning' ? 'warning' : 'ok';

  return (
    <span
      className={`ovl-badge ovl-badge--${tone}`}
      data-testid="key-ttl-badge"
      data-state={state}
      title="Zostávajúca platnosť API kľúča (max 48 h)"
      suppressHydrationWarning
    >
      kľúč: {formatCountdownSk(left)}
    </span>
  );
}

export default KeyTtlBadge;
