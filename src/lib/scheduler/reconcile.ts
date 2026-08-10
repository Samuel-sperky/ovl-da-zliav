/**
 * Aura Zľavy — reconciliácia po havárii, beží pri PRVOM ticku po štarte
 * (D86, §9 krok 3).
 *
 * Kampane v `running` bez `finished_at` = proces spadol uprostred dávky.
 * Per položka sa porovná `request_id` s audit záznamami `write_ok`:
 *  - potvrdené OK zostáva `ok`,
 *  - všetko ostatné sa označí `uncertain` — na MANUÁLNE rozhodnutie.
 * Kampaň prejde do `partial`/`failed` a zapíše sa audit `reconcile_uncertain`.
 *
 * AUTOMATICKÝ re-run NESMIE prebehnúť — reconcile nikdy nič nezapisuje do shopu.
 *
 * Vlastník: A10.
 */
import type {
  AuditRepo,
  AuditWriter,
  CampaignItemsRepo,
  ItemStatus,
  Logger,
  UtcDate,
} from '@/contracts';

import { tallyItemStatuses } from '@/lib/domain/status';

import type { SchedulerCampaignsRepo } from './types';

export interface ReconcileDeps {
  campaigns: Pick<SchedulerCampaignsRepo, 'findRunningUnfinished' | 'setStatus'>;
  items: Pick<CampaignItemsRepo, 'listByCampaign' | 'update'>;
  auditReader: Pick<AuditRepo, 'findConfirmedWrites'>;
  audit: AuditWriter;
  log: Logger;
}

/** Položkové stavy, ktoré sú už rozhodnuté a reconcile ich NEprepisuje. */
const SETTLED: readonly ItemStatus[] = ['failed', 'not_found', 'skipped', 'blocked'];

/**
 * @returns počet reconcilovaných kampaní.
 */
export async function reconcileAfterCrash(deps: ReconcileDeps, now: UtcDate): Promise<number> {
  const stuck = await deps.campaigns.findRunningUnfinished();
  let reconciled = 0;

  for (const campaign of stuck) {
    const confirmed = await deps.auditReader.findConfirmedWrites(campaign.id);
    const confirmedRequestIds = new Set(
      confirmed.map((c) => c.requestId).filter((r): r is string => r != null),
    );

    const items = await deps.items.listByCampaign(campaign.id);
    const finalStatuses: ItemStatus[] = [];
    let uncertainCount = 0;

    for (const item of items) {
      const confirmedOk =
        item.status === 'ok' && item.requestId != null && confirmedRequestIds.has(item.requestId);

      if (confirmedOk || SETTLED.includes(item.status)) {
        finalStatuses.push(confirmedOk ? 'ok' : item.status);
        continue;
      }

      await deps.items.update(item.id, {
        status: 'uncertain',
        errorCode: 'reconcile_uncertain',
        errorMessage:
          'Proces spadol počas dávky a zápis sa nedá potvrdiť auditom — rozhodni manuálne (D86).',
        finishedAt: now,
      });
      finalStatuses.push('uncertain');
      uncertainCount += 1;
    }

    const tally = tallyItemStatuses(finalStatuses);
    // D86: automatický re-run je zakázaný, preto `done` tu nikdy nevznikne —
    // kampaň s nepotvrdenými položkami je `partial` (aspoň jedna ok) alebo `failed`.
    const finalStatus = tally.ok > 0 ? 'partial' : 'failed';

    await deps.campaigns.setStatus(campaign.id, finalStatus, {
      statusReason: `Reconcile po havárii (D86): ${uncertainCount} položiek označených 'uncertain' na manuálne rozhodnutie.`,
      finishedAt: now,
      itemsTotal: finalStatuses.length,
      itemsOk: tally.ok,
      itemsFailed: tally.failed,
      itemsUncertain: tally.uncertain,
      resultAckAt: null,
    });
    await deps.audit.appendAudit({
      actor: 'scheduler',
      eventType: 'reconcile_uncertain',
      ok: false,
      campaignId: campaign.id,
      operationId: campaign.operationId,
      message:
        `Reconcile po havárii: ${tally.ok} potvrdených OK, ${uncertainCount} neistých — ` +
        'automatický re-run neprebehol (D86).',
    });
    deps.log.warn('scheduler_reconciled_campaign', {
      campaignId: campaign.id,
      uncertain: uncertainCount,
    });
    reconciled += 1;
  }

  return reconciled;
}
