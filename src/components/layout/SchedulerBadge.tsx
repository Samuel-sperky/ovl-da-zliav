'use client';

/**
 * Aura Zľavy — badge stavu schedulera (D87).
 *
 * „scheduler beží" pri čerstvom heartbeate; červená pri heartbeate staršom
 * než 3 minúty alebo keď heartbeat vôbec nie je.
 */
import { formatAgoSk } from '@/lib/ui/format';

export interface SchedulerBadgeProps {
  lastTickAt: string | null;
  /** Vek heartbeatu v sekundách zo servera (`/api/health`). */
  ageSec: number | null;
}

export const SCHEDULER_STALE_SECONDS = 3 * 60;

export function SchedulerBadge({ lastTickAt, ageSec }: SchedulerBadgeProps) {
  const stale = lastTickAt == null || ageSec == null || ageSec > SCHEDULER_STALE_SECONDS;

  if (stale) {
    return (
      <span
        className="ovl-badge ovl-badge--danger"
        data-testid="scheduler-badge"
        data-state="stale"
        title="Heartbeat schedulera je starší než 3 minúty — naplánované kampane sa nemusia spúšťať"
      >
        scheduler: {lastTickAt == null ? 'bez heartbeatu' : `naposledy ${formatAgoSk(ageSec)}`}
      </span>
    );
  }

  return (
    <span className="ovl-badge ovl-badge--ok" data-testid="scheduler-badge" data-state="ok">
      scheduler beží
    </span>
  );
}

export default SchedulerBadge;
