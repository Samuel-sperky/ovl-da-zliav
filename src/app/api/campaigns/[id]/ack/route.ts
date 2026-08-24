/**
 * Aura Zľavy — `POST /api/campaigns/[id]/ack` (BUILD-SPEC §5, D17, O6;
 * kontrakt dokončenia B7).
 *
 * Odkliknutie výsledku zľavy v notifikačnom paneli. Bez SMTP — notifikácie žijú
 * výhradne v UI a `ack` ich z panelu odstráni (`result_ack_at`).
 *
 * ČO ODKLIKNUTIE ZNAMENÁ A ČO NIE
 * -------------------------------
 * Znamená „videl som to". NEZNAMENÁ „je to vyriešené" a už vôbec nie
 * „v shope je všetko v poriadku". Preto odpoveď vracia, čo sa práve odklikáva,
 * a osobitne priznáva položky, pri ktorých NEVIEME, či sa zľava zapísala
 * (`uncertain`, D45) — tie odkliknutím nezmiznú zo sveta, len z panelu. Bez
 * tejto vety by odkliknutie tichým spôsobom pochovalo jediné miesto, kde sa
 * o nich používateľ dozvie.
 *
 * `ack` NIKDY nič nezapisuje do shopu a NIKDY nemení stav zľavy — mení jedine
 * `result_ack_at`.
 *
 * K10 — do hlášky sa NESMIE dostať vnútorný kód stavu (`partial`, `needs_key`).
 * Vetu skladá slovník (`ui/vocabulary.ts`), rovnako ako pre tabuľku zliav.
 *
 * Vlastník: A12.
 */
import { needsAcknowledgement } from '@/lib/domain/status';
import { conflict } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { campaignSentence, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

import {
  idParamSchema,
  loadCampaignOr404,
  resolveRoutesDeps,
  todayOf,
  withRouteErrors,
  type RoutesDeps,
} from '../../_shared';

/**
 * Veta o neistých položkách. D45: „nevieme, či sa zapísalo" nie je to isté ako
 * „nezapísalo sa" a odkliknutie na tom nič nemení — preto sa ďalší krok
 * pripomína práve tu, na poslednom mieste, kde sa o nich hovorí.
 */
export function uncertainNote(uncertain: number): string | null {
  if (uncertain <= 0) return null;
  const count = formatCountSk(uncertain);
  const noun = pluralSk(uncertain, 'produktu', 'produktov', 'produktov');
  const verb = pluralSk(uncertain, 'zostáva', 'zostávajú', 'zostáva');
  return (
    `Pri ${count} ${noun} stále nevieme, či sa zľava zapísala — odkliknutím to ${verb} tak, ` +
    'ako to je. Pozrite sa na ne v eshope; ak zľava neplatí, spustite pri tejto zľave ' +
    '„Zopakovať zlyhané".'
  );
}

export function createAckPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      params: idParamSchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const campaign = await loadCampaignOr404(d, ctx.params.id);

          if (!needsAcknowledgement(campaign.status, campaign.resultAckAt)) {
            const today = todayOf(d);
            // Kód stavu ide do slovníka TAK, AKO PRIŠIEL Z DATABÁZY. Do
            // 24. 8. 2026 tu stálo `as CampaignStatusCode`; pri kóde, ktorý
            // appka nepozná, bol `state` `undefined`, `join(' · ')` ho zahodil
            // a hláška končila prázdnou zátvorkou: „Zľava „X" () ešte nemá
            // výsledok". Slovník kód prevedie sám a náhradu prizná.
            const sentence = campaignSentence({
              status: campaign.status,
              dateFrom: campaign.dateFrom,
              dateTo: campaign.dateTo,
              today,
              itemsWritten: campaign.itemsOk,
              failedCount: campaign.itemsFailed,
            });
            throw conflict(
              campaign.resultAckAt !== null
                ? `Výsledok zľavy „${campaign.name}" už niekto odklikol. Nie je čo potvrdzovať.`
                : `Zľava „${campaign.name}" (${sentence.text}) ešte nemá výsledok na odkliknutie — odkliknúť sa dá až dobehnutá zľava.`,
              'nothing_to_ack',
              {
                logAsError: false,
                detail: { alreadyAcked: campaign.resultAckAt !== null },
              },
            );
          }

          await d.campaignsRepo.ack(campaign.id);

          return {
            acked: true as const,
            campaignId: campaign.id,
            /** Čo sa práve odklikáva — aby panel vedel, čo z neho zmizlo. */
            items: {
              total: campaign.itemsTotal,
              ok: campaign.itemsOk,
              failed: campaign.itemsFailed,
              uncertain: campaign.itemsUncertain,
            },
            /** D45 — neisté položky odkliknutím nezmiznú. `null` = žiadne nie sú. */
            uncertainNote: uncertainNote(campaign.itemsUncertain),
          };
        }),
    },
    routeDeps,
  );
}

export const POST = createAckPost();
