/**
 * Aura Zľavy — výber due kampaní, guardy a atomický claim (§9 krok 5,
 * D21, D25, D32, D55, D59, D84, I12, I13).
 *
 * Poradie kontrol per kampaň je normatívne:
 *   1. zamrznuté okno ±60 s okolo polnoci (D59) → preskočiť do ďalšieho ticku,
 *   2. kľúč chýba / expirovaný / neoverený → `needs_key` (D21, NIKDY `failed`),
 *   3. `writes_locked` alebo env poistka → `needs_key` s dôvodom
 *      `writes_disabled` (fail-closed, I13),
 *   4. canary GET (D55) → pri zlyhaní `needs_key` s dôvodom `shop_unreachable`,
 *   5. atomický `claim()` (D84) — pokračuje sa LEN pri `affectedRows = 1`,
 *   6. prepočet okna (D25: `lapse` / `shift_from` / `proceed`),
 *   7. zápis deleguje VÝHRADNE `engine/executor` (A9) — tento modul shop
 *      nevolá nikdy priamo.
 *
 * Vlastník: A10.
 */
import { ulid } from 'ulid';

import type {
  ApiKeyRepo,
  AuditWriter,
  CanaryResult,
  Logger,
  SecretRef,
  SettingsRepo,
  ShopCtx,
  Ulid,
  UtcDate,
} from '@/contracts';

import { resolveFireWindow } from '@/lib/domain/campaign-rules';
import { isMidnightFrozen, todayInZone } from '@/lib/domain/dates';
import type { ExecutorResultV3 } from '@/lib/engine/executor';

import type { SchedulerCampaign, SchedulerCampaignsRepo } from './types';

/**
 * Podpis executora dávky (`engine/executor.ts`, A9).
 *
 * `campaign` je `SchedulerCampaign` (viď `types.ts`), aby sa doň zmestil aj
 * produkčný `campaignsRepoV3` so stavom `queued`, a návratový typ je priamo
 * typ `executeCampaign()` (K2 pridala stav `queued`). Bez toho by wiring v
 * `boot.ts` potreboval `as` — a pretypovanie na nekompatibilnú signatúru je
 * presne nález E1, po ktorom scheduler nikdy nič nezapísal.
 */
export type ExecuteCampaignFn = (
  campaign: SchedulerCampaign,
  key: SecretRef,
  ctx: ShopCtx,
) => Promise<ExecutorResultV3>;

export interface DueDeps {
  campaigns: Pick<SchedulerCampaignsRepo, 'findDue' | 'claim' | 'setStatus'>;
  apiKey: Pick<ApiKeyRepo, 'getMeta' | 'loadForUse'>;
  settings: Pick<SettingsRepo, 'get'>;
  audit: AuditWriter;
  /** Canary GET pred každým fire (D55). */
  canary: (ctx: ShopCtx) => Promise<CanaryResult>;
  /** `engine/executor` (A9). `null` = executor nie je zapojený → fail-closed `needs_key`. */
  executor: ExecuteCampaignFn | null;
  log: Logger;
}

export interface DueConfig {
  /** `writesAllowedByEnv()` — `NODE_ENV=production && WRITES_ENABLED=true` (I13). */
  writesEnabledByEnv: boolean;
  timeZone: string;
  midnightFreezeSeconds: number;
}

export interface DueOutcome {
  fired: number;
  needsKey: number;
  lapsed: number;
  /** Kampane preskočené kvôli zamrznutému oknu okolo polnoci (D59). */
  frozenSkipped: number;
}

async function toNeedsKey(
  deps: DueDeps,
  campaign: SchedulerCampaign,
  reason: string,
  operationId: Ulid,
  now: UtcDate,
): Promise<void> {
  await deps.campaigns.setStatus(campaign.id, 'needs_key', {
    statusReason: reason,
    needsKeySince: now,
  });
  await deps.audit.appendAudit({
    actor: 'scheduler',
    eventType: 'campaign_needs_key',
    ok: false,
    campaignId: campaign.id,
    operationId,
    message: reason,
  });
  deps.log.warn('scheduler_campaign_needs_key', { campaignId: campaign.id, reason });
}

/**
 * Spracuje kampane so `status='scheduled' AND fire_at ≤ now`.
 * Zmeškané kampane už predtým odchytil krok `missed` (§9 krok 4).
 */
export async function processDue(
  deps: DueDeps,
  config: DueConfig,
  now: UtcDate,
): Promise<DueOutcome> {
  const outcome: DueOutcome = { fired: 0, needsKey: 0, lapsed: 0, frozenSkipped: 0 };

  const due = await deps.campaigns.findDue(now);
  if (due.length === 0) return outcome;

  // D59: v zamrznutom okne ±freeze s okolo polnoci sa fire preskočí do
  // ďalšieho ticku — dátumy sa prepočítajú až po bezpečnom prechode dňa.
  if (isMidnightFrozen(now, config.midnightFreezeSeconds, config.timeZone)) {
    outcome.frozenSkipped = due.length;
    deps.log.info('scheduler_midnight_freeze_skip', { durationMs: 0, count: due.length });
    return outcome;
  }

  const today = todayInZone(now, config.timeZone);

  for (const campaign of due) {
    if (campaign.status !== 'scheduled') continue;
    const operationId = campaign.operationId || (ulid() as Ulid);

    try {
      // D21 — chýbajúci/expirovaný/neplatný kľúč znamená `needs_key`, nie `failed`.
      const meta = await deps.apiKey.getMeta();
      const keyUsable =
        meta.present &&
        meta.verifyStatus === 'valid' &&
        meta.expiresAt != null &&
        meta.expiresAt.getTime() > now.getTime();
      const key = keyUsable ? await deps.apiKey.loadForUse() : null;
      if (!key) {
        await toNeedsKey(
          deps,
          campaign,
          'key_missing_or_invalid: v čase spustenia nie je k dispozícii platný API kľúč (D21).',
          operationId,
          now,
        );
        outcome.needsKey += 1;
        continue;
      }

      // I13 — dve poistky zápisu, fail-closed s dôvodom `writes_disabled`.
      const settings = await deps.settings.get();
      if (settings.writesLocked || !config.writesEnabledByEnv) {
        await toNeedsKey(
          deps,
          campaign,
          settings.writesLocked
            ? `writes_disabled: zápisy sú zamknuté (${settings.writesLockedReason ?? 'writes_locked'}) — I12/I13.`
            : 'writes_disabled: env poistka (NODE_ENV=production a WRITES_ENABLED=true) nie je splnená — I13.',
          operationId,
          now,
        );
        outcome.needsKey += 1;
        continue;
      }

      // D55 — canary GET pred každým fire.
      const canary = await deps.canary({ operationId });
      if (!canary.ok) {
        await toNeedsKey(
          deps,
          campaign,
          'shop_unreachable: canary GET pred fire zlyhal (D55) — kampaň čaká na ďalší pokus po zásahu.',
          operationId,
          now,
        );
        outcome.needsKey += 1;
        continue;
      }

      // D25 — prepočet okna PRED claimom (ako v manuálnej `/execute` route):
      // prepadnutá kampaň sa NIKDY neclaimne — prechod `running → lapsed`
      // v stavovom stroji neexistuje a claim by vyrobil falošný audit
      // `campaign_claimed` pre kampaň, ktorá nič nezapíše.
      const window = resolveFireWindow(campaign.dateFrom, campaign.dateTo, today);
      if (window.action === 'lapse') {
        await deps.campaigns.setStatus(campaign.id, 'lapsed', {
          statusReason: window.reason,
          finishedAt: now,
        });
        await deps.audit.appendAudit({
          actor: 'scheduler',
          eventType: 'campaign_lapsed',
          ok: false,
          campaignId: campaign.id,
          operationId,
          message: window.reason,
        });
        outcome.lapsed += 1;
        continue;
      }

      // D84 — atomický claim; pri `affectedRows ≠ 1` fire patrí niekomu inému.
      const claimed = await deps.campaigns.claim(campaign.id, ['scheduled']);
      if (!claimed) continue;
      await deps.audit.appendAudit({
        actor: 'scheduler',
        eventType: 'campaign_claimed',
        ok: true,
        campaignId: campaign.id,
        operationId,
        message: 'Scheduler prevzal kampaň atomickým claim (D84).',
      });

      let effective = campaign;
      if (window.action === 'shift_from') {
        await deps.campaigns.setStatus(campaign.id, 'running', {
          dateFrom: window.from,
          dateFromOriginal: window.originalFrom,
          statusReason: null,
          startedAt: now,
        });
        await deps.audit.appendAudit({
          actor: 'scheduler',
          eventType: 'campaign_from_shifted',
          ok: true,
          campaignId: campaign.id,
          operationId,
          message: `Posun date_from z ${window.originalFrom} na ${window.from} pri dopálení (D25).`,
        });
        effective = { ...campaign, dateFrom: window.from, dateFromOriginal: window.originalFrom };
      }

      // Zápis deleguje VÝHRADNE engine/executor (A9) — shop sa tu nevolá.
      if (!deps.executor) {
        await toNeedsKey(
          deps,
          effective,
          'executor_unavailable: engine/executor (A9) nie je zapojený — fail-closed, žiadny zápis.',
          operationId,
          now,
        );
        outcome.needsKey += 1;
        continue;
      }

      const result = await deps.executor(effective, key, { operationId });
      outcome.fired += 1;
      if (result.status === 'needs_key') outcome.needsKey += 1;
      deps.log.info('scheduler_campaign_fired', {
        campaignId: campaign.id,
        operationId,
        status: result.status,
      });
    } catch (error) {
      // Výnimka jednej kampane nesmie zablokovať ostatné ani zhodiť tick.
      const message = error instanceof Error ? error.message : String(error);
      deps.log.error('scheduler_due_campaign_error', { campaignId: campaign.id, error: message });
      await toNeedsKey(
        deps,
        campaign,
        `fire_error: neočakávaná chyba pri spúšťaní (${message}) — fail-closed, žiadny zápis mimo executora.`,
        operationId,
        now,
      ).catch(() => undefined);
      outcome.needsKey += 1;
    }
  }

  return outcome;
}
