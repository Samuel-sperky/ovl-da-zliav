'use client';

/**
 * Aura Zľavy — badge TTL API kľúča (D5).
 *
 * Trvalý badge v hlavičke na KAŽDEJ stránke; na mobile sa skrývať NESMIE
 * (D5, K8). Štyri stavy: kľúč chýba (critical), > 6 h (good), ≤ 6 h
 * (attention), ≤ 1 h (critical). Odpočet beží klientsky každú sekundu.
 *
 * I1: badge nesie výhradne zostávajúci čas — nikdy kľúč, nikdy `last4`.
 * `data-state` (`missing|ok|warning|critical`) je stabilné rozhranie pre e2e.
 */
import { useEffect, useState } from 'react';

import ToneBadge, { type StatusTone } from '@/components/ui/ToneBadge';
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
      <ToneBadge
        tone="critical"
        glyph="⚿"
        data-testid="key-ttl-badge"
        data-state="missing"
        title="API kľúč nie je uložený — appka je v režime len na čítanie"
      >
        kľúč chýba
      </ToneBadge>
    );
  }

  const left = Math.floor((new Date(expiresAt).getTime() - now) / 1000);

  if (left <= 0) {
    return (
      <ToneBadge
        tone="critical"
        glyph="⚿"
        data-testid="key-ttl-badge"
        data-state="missing"
        title="API kľúč expiroval — appka je v režime len na čítanie"
      >
        kľúč expiroval
      </ToneBadge>
    );
  }

  const state = left <= ONE_HOUR ? 'critical' : left <= SIX_HOURS ? 'warning' : 'ok';
  const tone: StatusTone =
    state === 'critical' ? 'critical' : state === 'warning' ? 'attention' : 'good';

  return (
    <ToneBadge
      tone={tone}
      glyph={state === 'ok' ? '⚿' : '⏱'}
      data-testid="key-ttl-badge"
      data-state={state}
      title="Zostávajúca platnosť API kľúča (max 48 h)"
      suppressHydrationWarning
    >
      kľúč: {formatCountdownSk(left)}
    </ToneBadge>
  );
}

export default KeyTtlBadge;
