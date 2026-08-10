'use client';

/**
 * Aura Zľavy — badge stavu schedulera (D87).
 *
 * „scheduler beží" pri čerstvom heartbeate; tón critical pri heartbeate
 * staršom než 3 minúty alebo keď heartbeat vôbec nie je — vtedy sa naplánované
 * kampane nemusia spúšťať, takže to je zásah, nie informácia.
 *
 * POZOR (V3): tento badge UŽ NIE JE v hlavičke. Hlavička má podľa
 * `design/v3/ARCHITEKTURA.md` §0 presne tri veci vpravo (rozpočet zápisov,
 * fronta, prepínač témy) a nič iné. Komponent zostáva, lebo miesto pre neho je
 * v Nastaveniach — kotva „Diagnostika" (§3.6). Kým ho tam V12 nezavesí, nikde sa
 * nevykresľuje. Nemazať bez toho, aby sa tá informácia objavila inde.
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
