'use client';

/**
 * Aura Zľavy — stavová časť hlavičky (D5, D10, D77, D79, D87).
 *
 * Polluje `/api/health` a kreslí `KeyTtlBadge`, `SchedulerBadge`,
 * `WriteModeBadge` a pod hlavičkou `ReadOnlyNotice`. Keď health endpoint
 * neodpovedá, shell to priznáva (degradovaný badge) — nič nepredstiera.
 */
import KeyTtlBadge from '@/components/layout/KeyTtlBadge';
import ReadOnlyNotice from '@/components/layout/ReadOnlyNotice';
import SchedulerBadge from '@/components/layout/SchedulerBadge';
import WriteModeBadge from '@/components/layout/WriteModeBadge';
import { useHealth } from '@/components/layout/health';

export function HeaderBadges() {
  const { health, loading, unreachable } = useHealth();

  if (loading) {
    return (
      <span className="ovl-badge ovl-badge--outline ovl-skeleton" aria-hidden>
        načítavam stav…
      </span>
    );
  }
  if (unreachable || !health) {
    return (
      <span className="ovl-badge ovl-badge--danger" data-testid="health-unreachable">
        stav appky nedostupný
      </span>
    );
  }
  return (
    <>
      <KeyTtlBadge present={health.key.present} expiresAt={health.key.expiresAt} />
      <SchedulerBadge
        lastTickAt={health.scheduler.lastTickAt}
        ageSec={health.scheduler.ageSec}
      />
      <WriteModeBadge
        writesEnabled={health.writesEnabled}
        writesLocked={health.writesLocked}
      />
    </>
  );
}

/** Samostatný pruh pod hlavičkou — read-only výzva (D10). */
export function HeaderReadOnlyNotice() {
  const { health, loading } = useHealth(60_000);
  if (loading || !health) return null;
  const expired =
    health.key.expiresAt != null && new Date(health.key.expiresAt).getTime() <= Date.now();
  return <ReadOnlyNotice keyPresent={health.key.present && !expired} />;
}
