'use client';

/**
 * Aura Zľavy — badge stavu schedulera (D87).
 *
 * „scheduler beží" pri čerstvom heartbeate; tón critical pri heartbeate
 * staršom než 3 minúty alebo keď heartbeat vôbec nie je — vtedy sa naplánované
 * kampane nemusia spúšťať, takže to je zásah, nie informácia.
 */
import ToneBadge from '@/components/ui/ToneBadge';
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
      <ToneBadge
        tone="critical"
        glyph="✕"
        data-testid="scheduler-badge"
        data-state="stale"
        title="Heartbeat schedulera je starší než 3 minúty — naplánované kampane sa nemusia spúšťať"
      >
        scheduler: {lastTickAt == null ? 'bez heartbeatu' : `naposledy ${formatAgoSk(ageSec)}`}
      </ToneBadge>
    );
  }

  return (
    <ToneBadge tone="good" glyph="✓" data-testid="scheduler-badge" data-state="ok">
      scheduler beží
    </ToneBadge>
  );
}

export default SchedulerBadge;
