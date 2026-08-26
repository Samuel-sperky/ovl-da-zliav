/**
 * Aura Zľavy — reconciliácia po havárii, beží pri PRVOM ticku po štarte
 * (D86, §9 krok 3; KONTRAKT V3 K2, K6).
 *
 * Kampane v `running` bez `finished_at` = proces spadol uprostred dávky.
 * Reconcile rozdeľuje položky na TRI skupiny, nie na dve:
 *  - potvrdené OK (`request_id` sedí s audit záznamom `write_ok`) zostáva `ok`,
 *  - položka, ktorej zápis MOHOL odísť, ale potvrdenie chýba, je `uncertain`
 *    — na MANUÁLNE rozhodnutie,
 *  - položka, ktorá sa v spadnutom behu ani nezačala zapisovať, zostáva
 *    `pending` a kampaň sa vracia do fronty (`queued`).
 *
 * Prečo tá tretia skupina existuje (K2, K6): fronta má 200 zápisov na deň a
 * 8 000 produktov beží 40 dní, takže v momente reštartu je nezapísaná VÄČŠINA
 * kampane. Reštart kontejnera je pritom normálna cesta upgradu (D100). Keby
 * reconcile označil nikdy neposlané položky za „nevieme" a kampaň zavrel s
 * `finished_at`, kampaň by zmizla z `findQueued()` a 7 800 zápisov by sa
 * stratilo — to zakazuje K6 („žiadny zápis sa nestratí") a I11 zakazuje aj ten
 * posun tvrdenia z „isto neodišlo" na „nevieme".
 *
 * Dopísanie nikdy neposlanej položky NIE JE re-run: re-run je opakovanie
 * zápisu, ktorý mohol odísť, a taký zápis tu končí ako `uncertain` a executor
 * sa ho už nikdy nedotkne (spracúva výhradne `pending`). AUTOMATICKÝ re-run
 * teda NESMIE prebehnúť a neprebehne — reconcile sám do shopu nikdy nezapisuje.
 *
 * Vlastník: A10.
 */
import type {
  AuditRepo,
  AuditWriter,
  CampaignItemRecord,
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

/**
 * Položkové stavy, ktoré sú už rozhodnuté a reconcile ich NEprepisuje.
 *
 * `interrupted` medzi ne PATRÍ: všetky tri cesty, ktoré ho nastavujú
 * (`markRemaining` pri SIGTERM podľa D85, `markRemaining` po wipe kľúča podľa
 * D51/D52 a `ApiKeyError` v `executor.ts`), ho dávajú položke, ktorej zápis sa
 * NEODOSLAL. Prepísať ho na `uncertain` by zahodilo istotu a zároveň by
 * položku odrezalo od dopálenia z `needs_key` (executor vracia `interrupted`
 * na `pending`, `uncertain` nie).
 */
const SETTLED: readonly ItemStatus[] = [
  'failed',
  'not_found',
  'skipped',
  'blocked',
  'interrupted',
];

/**
 * Položka, ktorá sa v spadnutom behu ani nezačala zapisovať.
 *
 * `request_id` sa na položku zapíše v tom istom kroku ako audit `write_attempt`
 * a tesne PRED odoslaním requestu (`executor.ts`, krok 6c). `pending` bez
 * `request_id` je preto dôkaz, že do shopu nič neodišlo — nie „nevieme" (I11).
 * Opačné poradie by túto istotu zrušilo, preto sa v executore meniť nesmie.
 */
function isNeverSent(item: CampaignItemRecord): boolean {
  return item.status === 'pending' && item.requestId == null;
}

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

      // K6 — nikdy neposlaná položka sa NEDOTKNE: zostáva `pending` a dopíše sa
      // vo fronte. Žiadny `finished_at`, žiadny error kód, nič na rozhodovanie.
      if (isNeverSent(item)) {
        finalStatuses.push(item.status);
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
    // Rovnaká definícia „neúspešnej" položky ako v `executor.ts` — `interrupted`
    // a `not_found` sa po pridaní do SETTLED nesmú z počítadiel vytratiť.
    const itemsFailed = tally.failed + tally.notFound + tally.blocked + tally.interrupted;

    if (tally.pending > 0) {
      // K2 — kampaň nedobehla, takže sa VRACIA DO FRONTY. `finished_at` sa
      // ZÁMERNE nenastavuje (`queued` nie je výsledok) a `result_ack_at` sa
      // nedotýka — nie je čo odklikávať. Presne ako `toQueued()` v executore.
      await deps.campaigns.setStatus(campaign.id, 'queued', {
        statusReason:
          `Reconcile po havárii (D86): ${uncertainCount} položiek na manuálne rozhodnutie, ` +
          `${tally.pending} nezapísaných zostáva vo fronte a dopíše sa (K2, K6).`,
        itemsTotal: finalStatuses.length,
        itemsOk: tally.ok,
        itemsFailed,
        itemsUncertain: tally.uncertain,
      });
    } else {
      // D86: automatický re-run je zakázaný, preto `done` tu nikdy nevznikne —
      // kampaň s nepotvrdenými položkami je `partial` (aspoň jedna ok) alebo `failed`.
      const finalStatus = tally.ok > 0 ? 'partial' : 'failed';
      await deps.campaigns.setStatus(campaign.id, finalStatus, {
        statusReason: `Reconcile po havárii (D86): ${uncertainCount} položiek označených 'uncertain' na manuálne rozhodnutie.`,
        finishedAt: now,
        itemsTotal: finalStatuses.length,
        itemsOk: tally.ok,
        itemsFailed,
        itemsUncertain: tally.uncertain,
        resultAckAt: null,
      });
    }

    await deps.audit.appendAudit({
      actor: 'scheduler',
      eventType: 'reconcile_uncertain',
      ok: false,
      campaignId: campaign.id,
      operationId: campaign.operationId,
      message:
        `Reconcile po havárii: ${tally.ok} potvrdených OK, ${uncertainCount} neistých, ` +
        `${tally.pending} nezapísaných zostáva vo fronte — ` +
        'automatický re-run neprebehol (D86).',
    });
    deps.log.warn('scheduler_reconciled_campaign', {
      campaignId: campaign.id,
      uncertain: uncertainCount,
      pending: tally.pending,
    });
    reconciled += 1;
  }

  return reconciled;
}
