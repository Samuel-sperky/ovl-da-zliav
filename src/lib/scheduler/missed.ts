/**
 * Aura Zľavy — detekcia zmeškaného fire (D33b, §9 krok 4).
 *
 * NAJTVRDŠIA požiadavka schedulera: kampaň so `fire_at` starším než tolerancia
 * (5 min) prejde do `missed` a NIKDY sa nespustí automaticky. V tomto module
 * (ani nikde inde v schedulery) NEEXISTUJE catch-up konštanta ani vetva, ktorá
 * by `missed` kampaň odpálila — dopáliť ju môže VÝHRADNE manuálna akcia
 * (`/api/campaigns/[id]/execute`, A12) s novým potvrdením a novým preview
 * tokenom (I3).
 *
 * Vlastník: A10.
 */
import type { AuditWriter, CampaignsRepo, Logger, UtcDate } from '@/contracts';

/** Tolerancia od `fire_at`, po ktorej je fire zmeškaný (D33b). */
export const MISSED_GRACE_MINUTES = 5;

export interface MissedDeps {
  campaigns: Pick<CampaignsRepo, 'findMissedCandidates' | 'setStatus'>;
  audit: AuditWriter;
  log: Logger;
}

/**
 * Označí kampane `scheduled` s `fire_at < now − grace` ako `missed` + audit.
 * ŽIADNY automatický catch-up — návratová hodnota je len počet označených.
 */
export async function detectMissed(
  deps: MissedDeps,
  now: UtcDate,
  graceMinutes: number = MISSED_GRACE_MINUTES,
): Promise<number> {
  const threshold = new Date(now.getTime() - graceMinutes * 60_000);
  const candidates = await deps.campaigns.findMissedCandidates(threshold);

  let marked = 0;
  for (const campaign of candidates) {
    if (campaign.status !== 'scheduled') continue;
    if (!campaign.fireAt || campaign.fireAt.getTime() >= threshold.getTime()) continue;

    const reason =
      `Zmeškaný fire: plánované spustenie ${campaign.fireAt.toISOString()} je staršie než ` +
      `${graceMinutes} min. Kampaň sa NIKDY nespustí automaticky — vyžaduje manuálne ` +
      'rozhodnutie s novým potvrdením (D33b).';

    await deps.campaigns.setStatus(campaign.id, 'missed', { statusReason: reason });
    await deps.audit.appendAudit({
      actor: 'scheduler',
      eventType: 'campaign_missed',
      ok: false,
      campaignId: campaign.id,
      operationId: campaign.operationId,
      message: reason,
    });
    deps.log.warn('scheduler_campaign_missed', { campaignId: campaign.id });
    marked += 1;
  }
  return marked;
}
