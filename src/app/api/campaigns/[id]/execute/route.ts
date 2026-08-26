/**
 * Aura Zľavy — `POST /api/campaigns/[id]/execute` (BUILD-SPEC §5, D33b, I3).
 *
 * MANUÁLNE dopálenie kampane zo stavov `needs_key`/`missed` — a toto je
 * JEDINÁ cesta, ktorou sa zmeškaná kampaň dopáli (D33b): scheduler ani
 * executor zmeškanú kampaň nikdy neprevezmú sami.
 *
 * Vyžaduje NOVÝ jednorazový `previewToken` z čerstvého dry-runu (I3):
 * pôvodné potvrdenie z vytvorenia kampane NESTAČÍ. Token musí sedieť
 * s reálnou sadou kampane (produkty, percento, okno) — pri `from` v minulosti
 * sa `from` posúva na dnešok (D25) a token musí byť vydaný už na posunuté okno.
 *
 * Sada sa overuje DVA razy a OBA razy pred akýmkoľvek zápisom stavu: token
 * proti hlavičke operácie (`verifyPreviewTokenFor`) a jeho `payloadHash` proti
 * riadkom `campaign_items` tým istým predikátom, aký použije executor
 * (`assertConfirmed`, K4). Nesúlad tak kampaň nechá v pôvodnom stave —
 * `running` kampaň by už nedopálil nikto, lebo túto route nemá čím vyvolať
 * ani `findQueued`, ani `findMissed`.
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import { resolveFireWindow } from '@/lib/domain/campaign-rules';
import { assertTransition } from '@/lib/domain/status';
import { assertConfirmed } from '@/lib/engine/executor';
import { conflict } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  assertStatusIn,
  idParamSchema,
  loadCampaignOr404,
  makeExecutor,
  resolveRoutesDeps,
  todayOf,
  verifyPreviewTokenFor,
  withRouteErrors,
  type RoutesDeps,
} from '../../_shared';

const bodySchema = z.object({
  previewToken: z.string().min(1),
});

export function createExecutePost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      auth: 'sudo',
      body: bodySchema,
      params: idParamSchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const campaign = await loadCampaignOr404(d, ctx.params.id);

          /* 1. Len `needs_key`/`missed` (akceptačné kritérium A12, D33b). */
          assertStatusIn(campaign, ['needs_key', 'missed'], 'execute');

          /* 2. Prepočet okna v momente dopálenia (D25, D59). */
          const today = todayOf(d);
          const resolution = resolveFireWindow(campaign.dateFrom, campaign.dateTo, today);
          if (resolution.action === 'lapse') {
            assertTransition(campaign.status, 'lapsed', { trigger: 'window_lapsed' });
            await d.campaignsRepo.setStatus(campaign.id, 'lapsed', {
              statusReason: resolution.reason,
              resultAckAt: null,
            });
            await d.audit.appendAudit({
              actor: 'user',
              eventType: 'campaign_lapsed',
              ok: false,
              userId: ctx.claims.sub,
              campaignId: campaign.id,
              operationId: campaign.operationId,
              message: resolution.reason,
            });
            throw conflict(resolution.reason, 'window_lapsed', { logAsError: false });
          }
          const effectiveFrom = resolution.action === 'shift_from' ? resolution.from : campaign.dateFrom;

          /* 3. NOVÝ preview token proti REÁLNEJ sade kampane (I3, D33b).
           *    Bez platného tokenu na shop neodíde ani jeden request. */
          const items = await d.campaignItemsRepo.listByCampaign(campaign.id);
          const productIds = items.map((i) => i.productId).sort((a, b) => a - b);
          const claims = await verifyPreviewTokenFor(
            d,
            ctx.body.previewToken,
            {
              kind: campaign.kind,
              productIds,
              percent: campaign.percent,
              from: effectiveFrom,
              to: campaign.dateTo,
            },
            ctx.claims.sub,
          );

          /* 4. To isté potvrdenie, aké si prepočíta executor — PRED zápisom
           *    stavu. Token sa overuje nad HLAVIČKOU (kind/productIds/percent/
           *    from/to), executor si hash skladá z RIADKOV `campaign_items`
           *    (`product_id:percent:price_at_preview`, K4). Tie dve veci sa
           *    rozídu vždy, keď sa medzi vytvorením zľavy a dopálením zmenila
           *    cena alebo pásma (K3) — a keby sa to zistilo až v kroku 7,
           *    kampaň by už bola `running` s prepísaným `confirm_payload_hash`.
           *    `running` kampaň nevidí ani `findQueued`, ani `findMissed`,
           *    takže by zmeškanú zľavu nedopálil už nikto — a táto route je
           *    jej JEDINÁ cesta (D33b). Preto sa to overuje tu a naprázdno:
           *    pri nesúlade zostáva kampaň presne v stave, v akom bola.
           */
          const now = d.now();
          assertConfirmed(
            {
              ...campaign,
              dateFrom: effectiveFrom,
              dateFromOriginal:
                resolution.action === 'shift_from'
                  ? (campaign.dateFromOriginal ?? resolution.originalFrom)
                  : campaign.dateFromOriginal,
              confirmedAt: now,
              confirmPayloadHash: claims.payloadHash,
              sudoAt: now,
            },
            items,
          );

          /* 5. Stavový stroj: `manual_execute` s ČERSTVÝM potvrdením (D33b). */
          assertTransition(campaign.status, 'running', {
            trigger: 'manual_execute',
            confirmedAt: now,
            confirmPayloadHash: claims.payloadHash,
            freshConfirmation: true,
          });

          /* 6. Zapíš nové potvrdenie + prípadný posun `from` (D25). */
          await d.campaignsRepo.setStatus(campaign.id, campaign.status, {
            confirmedAt: now,
            confirmPayloadHash: claims.payloadHash,
            sudoAt: now,
            ...(resolution.action === 'shift_from'
              ? { dateFrom: resolution.from, dateFromOriginal: campaign.dateFromOriginal ?? resolution.originalFrom }
              : {}),
          });
          if (resolution.action === 'shift_from') {
            await d.audit.appendAudit({
              actor: 'user',
              eventType: 'campaign_from_shifted',
              ok: true,
              userId: ctx.claims.sub,
              campaignId: campaign.id,
              operationId: campaign.operationId,
              message: `Začiatok zľavy posunutý z ${resolution.originalFrom} na ${resolution.from} (D25).`,
            });
          }

          /* 7. Atomický claim — jediná obrana proti dvojitému spusteniu (D84). */
          const claimed = await d.campaignsRepo.claim(campaign.id, ['needs_key', 'missed']);
          if (!claimed) {
            throw conflict(
              'Kampaň medzičasom zmenila stav — pravdepodobne ju už spracúva iný beh (D84).',
              'invalid_transition',
              { logAsError: false },
            );
          }
          await d.audit.appendAudit({
            actor: 'user',
            eventType: 'campaign_claimed',
            ok: true,
            userId: ctx.claims.sub,
            campaignId: campaign.id,
            operationId: campaign.operationId,
            message: 'Manuálne dopálenie s novým potvrdením (D33b).',
          });

          /* 8. Zápis — VÝHRADNE cez executor (§9). */
          const result = await makeExecutor(d).executeCampaign(campaign.id, {
            actor: 'user',
            userId: ctx.claims.sub,
          });
          return { status: result.status, items: result.items };
        }),
    },
    routeDeps,
  );
}

export const POST = createExecutePost();
