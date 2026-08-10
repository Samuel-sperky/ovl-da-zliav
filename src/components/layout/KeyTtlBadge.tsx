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
 *
 * POZOR (V3): tento badge UŽ NIE JE v hlavičke. Hlavička má podľa
 * `design/v3/ARCHITEKTURA.md` §0 presne tri veci vpravo (rozpočet zápisov,
 * fronta, prepínač témy) a nič iné. Komponent zostáva, lebo miesto pre neho je
 * v Nastaveniach — kotva „Kľúče a rozpočet" (§3.6). Kým ho tam V12 nezavesí, nikde sa
 * nevykresľuje. Nemazať bez toho, aby sa tá informácia objavila inde.
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

/**
 * Zvyšné sekundy do `expiresAt`. Neplatný/neparsovateľný string → `null`
 * (U11) — badge vtedy zobrazí „kľúč chýba" namiesto „kľúč: NaN h NaN min".
 */
export function secondsLeftFrom(expiresAt: string, nowMs: number): number | null {
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return null;
  return Math.floor((expiryMs - nowMs) / 1000);
}

export function KeyTtlBadge({ present, expiresAt }: KeyTtlBadgeProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // U11: neplatný `expiresAt` sa správa ako chýbajúci kľúč (fail-closed).
  const left = expiresAt ? secondsLeftFrom(expiresAt, now) : null;

  if (!present || !expiresAt || left === null) {
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
