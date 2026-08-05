/**
 * Aura Zľavy — RECONCILE PO HAVÁRII (BUILD-SPEC §9 krok 3, D86).
 *
 * Po štarte (prvý tick schedulera) sa kampane, ktoré zostali v `running` bez
 * `finished_at`, porovnajú s `audit_log`:
 *   - položka s auditom `write_ok` a rovnakým `request_id` (fallback: rovnakým
 *     `product_id`) = potvrdený OK → `ok`,
 *   - všetko ostatné nedobehnuté → `uncertain` na MANUÁLNE rozhodnutie.
 *
 * Automatický re-run NESMIE prebehnúť — reconcile nikdy nevolá shop, len
 * upratuje DB a zapíše audit `reconcile_uncertain`.
 *
 * Vlastník: A9.
 */
import type {
  AuditWriter,
  CampaignItemsRepo,
  CampaignsRepo,
  ItemStatus,
  Ulid,
} from '@/contracts';

import { auditWriter as defaultAuditWriter } from '@/lib/audit/write';
import { resolveFinalStatus } from '@/lib/domain/status';
import { logger as defaultLogger } from '@/lib/log/logger';
import { auditRepo as defaultAuditRepo } from '@/lib/repo/audit.repo';
import { campaignItemsRepo as defaultCampaignItemsRepo } from '@/lib/repo/campaign-items.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';

export interface ReconcileDeps {
  campaignsRepo?: Pick<CampaignsRepo, 'findRunningUnfinished' | 'setStatus'>;
  campaignItemsRepo?: Pick<CampaignItemsRepo, 'listByCampaign' | 'update'>;
  auditRepo?: {
    findConfirmedWrites(
      campaignId: number,
    ): Promise<Array<{ requestId: Ulid | null; productId: number | null }>>;
  };
  audit?: AuditWriter;
  logger?: import('@/contracts').Logger;
  now?: () => Date;
}

export interface ReconcileReport {
  /** Koľko kampaní sa upratalo. */
  campaigns: number;
  /** Koľko položiek skončilo `uncertain`. */
  uncertainItems: number;
  /** Koľko položiek audit potvrdil ako `ok`. */
  confirmedItems: number;
}

/** Stavy, ktoré reconcile NIKDY nemení — sú už rozhodnuté. */
const SETTLED: ReadonlySet<ItemStatus> = new Set<ItemStatus>([
  'ok',
  'failed',
  'skipped',
  'not_found',
  'blocked',
]);

export async function reconcileRunningCampaigns(
  deps: ReconcileDeps = {},
): Promise<ReconcileReport> {
  const campaignsRepo = deps.campaignsRepo ?? defaultCampaignsRepo;
  const itemsRepo = deps.campaignItemsRepo ?? defaultCampaignItemsRepo;
  const auditRepo = deps.auditRepo ?? defaultAuditRepo;
  const audit = deps.audit ?? defaultAuditWriter;
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());

  const report: ReconcileReport = { campaigns: 0, uncertainItems: 0, confirmedItems: 0 };

  const stuck = await campaignsRepo.findRunningUnfinished();
  for (const campaign of stuck) {
    const items = await itemsRepo.listByCampaign(campaign.id);
    const confirmed = await auditRepo.findConfirmedWrites(campaign.id);
    const confirmedRequestIds = new Set(
      confirmed.flatMap((c) => (c.requestId !== null ? [c.requestId] : [])),
    );
    const confirmedProductIds = new Set(
      confirmed.flatMap((c) => (c.productId !== null ? [c.productId] : [])),
    );

    let uncertain = 0;
    const statuses: ItemStatus[] = [];
    for (const item of items) {
      if (SETTLED.has(item.status)) {
        statuses.push(item.status);
        continue;
      }
      const isConfirmed =
        (item.requestId !== null && confirmedRequestIds.has(item.requestId)) ||
        confirmedProductIds.has(item.productId);

      const nextStatus: ItemStatus = isConfirmed ? 'ok' : 'uncertain';
      if (nextStatus !== item.status) {
        await itemsRepo.update(item.id, {
          status: nextStatus,
          ...(nextStatus === 'uncertain'
            ? {
                errorCode: 'reconcile_uncertain',
                errorMessage:
                  'Beh bol prerušený a audit zápis nepotvrdil — stav v shope je neistý, rozhodni manuálne (D86).',
              }
            : {}),
          finishedAt: now(),
        });
      }
      if (nextStatus === 'uncertain') uncertain += 1;
      else report.confirmedItems += 1;
      statuses.push(nextStatus);
    }

    const finalStatus = resolveFinalStatus(statuses);
    await campaignsRepo.setStatus(campaign.id, finalStatus, {
      statusReason: 'reconcile_after_crash',
      finishedAt: now(),
      itemsTotal: statuses.length,
      itemsOk: statuses.filter((s) => s === 'ok' || s === 'skipped').length,
      itemsFailed: statuses.filter(
        (s) => s === 'failed' || s === 'not_found' || s === 'blocked' || s === 'interrupted',
      ).length,
      itemsUncertain: statuses.filter((s) => s === 'uncertain').length,
      resultAckAt: null,
    });

    await audit.appendAudit({
      actor: 'system',
      eventType: 'reconcile_uncertain',
      ok: uncertain === 0,
      campaignId: campaign.id,
      operationId: campaign.operationId,
      message: `Reconcile po havárii: ${report.confirmedItems} potvrdených, ${uncertain} neistých položiek → „${finalStatus}" (D86). Automatický re-run neprebehol.`,
    });

    log.warn('reconcile_campaign_settled', {
      campaignId: campaign.id,
      operationId: campaign.operationId,
      uncertain,
      finalStatus,
    });

    report.campaigns += 1;
    report.uncertainItems += uncertain;
  }

  return report;
}
