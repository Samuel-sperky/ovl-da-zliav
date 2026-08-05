'use client';

/**
 * Aura Zľavy — stavová časť hlavičky (D5, D10, D77, D79, D87).
 *
 * Polluje `/api/health` a kreslí `KeyTtlBadge`, `SchedulerBadge`,
 * `WriteModeBadge`, prepínač témy a pod hlavičkou `ReadOnlyNotice`. Keď health
 * endpoint neodpovedá, shell to priznáva (degradovaný badge) — nič nepredstiera.
 *
 * Mobil (plán §2 bod 19, K8): `KeyTtlBadge` je viditeľný VŽDY — D5 to vyžaduje
 * a skrývať ho nesmieme. Skladá sa len scheduler a režim zápisov za prepínač
 * „stav appky"; na šírke ≥ 720 px sú aj tie stále viditeľné (CSS).
 */
import { useState } from 'react';

import KeyTtlBadge from '@/components/layout/KeyTtlBadge';
import ReadOnlyNotice from '@/components/layout/ReadOnlyNotice';
import SchedulerBadge from '@/components/layout/SchedulerBadge';
import ThemeToggle from '@/components/layout/ThemeToggle';
import WriteModeBadge from '@/components/layout/WriteModeBadge';
import { useHealth } from '@/components/layout/health';

export function HeaderBadges() {
  const { health, loading, unreachable } = useHealth();
  const [moreOpen, setMoreOpen] = useState(false);

  if (loading) {
    return (
      <>
        <span className="ovl-badge ovl-shimmer" aria-hidden>
          načítavam stav…
        </span>
        <ThemeToggle />
      </>
    );
  }
  if (unreachable || !health) {
    return (
      <>
        <span className="ovl-badge ovl-badge--critical" data-testid="health-unreachable">
          <span className="ovl-badge-glyph" aria-hidden="true">
            ✕
          </span>
          stav appky nedostupný
        </span>
        <ThemeToggle />
      </>
    );
  }
  return (
    <>
      <KeyTtlBadge present={health.key.present} expiresAt={health.key.expiresAt} />
      <button
        type="button"
        className="ovl-theme-pill ovl-status-more"
        onClick={() => setMoreOpen((v) => !v)}
        aria-expanded={moreOpen}
        title="Stav schedulera a režim zápisov"
      >
        stav appky {moreOpen ? '▴' : '▾'}
      </button>
      <span className="ovl-status-secondary" data-open={moreOpen ? 'true' : 'false'}>
        <SchedulerBadge
          lastTickAt={health.scheduler.lastTickAt}
          ageSec={health.scheduler.ageSec}
        />
        <WriteModeBadge
          writesEnabled={health.writesEnabled}
          writesLocked={health.writesLocked}
        />
      </span>
      <ThemeToggle />
    </>
  );
}

/** Samostatný full-bleed pruh pod hlavičkou — read-only výzva (D10). */
export function HeaderReadOnlyNotice() {
  const { health, loading } = useHealth(60_000);
  if (loading || !health) return null;
  const expired =
    health.key.expiresAt != null && new Date(health.key.expiresAt).getTime() <= Date.now();
  return <ReadOnlyNotice keyPresent={health.key.present && !expired} />;
}
