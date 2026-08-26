/**
 * Aura Zľavy — `POST /api/campaigns/[id]/extend` (BUILD-SPEC §5, D19, D27, I3).
 *
 * Potvrdenie predĺženia: vyžaduje jednorazový `previewToken` z
 * `/extend/preview` — token je vydaný na kind `extend`, ZAMKNUTÉ `from`
 * a percento pôvodnej kampane a nové `to`. Vytvorí NOVÚ kampaň
 * `kind='extend'` s `parent_campaign_id` a hneď ju vykoná (jeden
 * `setReduction` per produkt s rovnakým `from` a novým `to`, D27) —
 * výhradne cez `engine/executor`.
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import { assertExtension } from '@/lib/domain/campaign-rules';
import type { CampaignItemRecordV3 } from '@/lib/repo/campaign-items.repo';
import { badRequest } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';

import {
  assertStatusIn,
  idParamSchema,
  insertConfirmedCampaign,
  loadCampaignOr404,
  makeExecutor,
  peekPreviewToken,
  resolveRoutesDeps,
  verifyPreviewTokenFor,
  withRouteErrors,
  type RoutesDeps,
} from '../../_shared';

const bodySchema = z.object({
  previewToken: z.string().min(1),
});

export function createExtendPost(
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
          const parent = await loadCampaignOr404(d, ctx.params.id);
          assertStatusIn(parent, ['done', 'partial'], 'extend');

          /* Nové `to` nesie token; všetko ostatné je zamknuté na kampaň. */
          const peeked = peekPreviewToken(ctx.body.previewToken);
          const newTo = typeof peeked?.to === 'string' ? peeked.to : '';
          if (newTo === '') {
            throw badRequest(
              'Preview token je neplatný alebo pozmenený — predĺženie sa odmieta (I3).',
              'preview_token_invalid',
            );
          }
          // D27 — kontrola pred verify(), aby neplatné `to` nespálilo token.
          assertExtension({
            originalFrom: parent.dateFrom,
            originalPercent: parent.percent,
            currentTo: parent.dateTo,
            newTo,
          });

          const items = await d.campaignItemsRepo.listByCampaign(parent.id);
          const productIds = [...new Set(items.map((i) => i.productId))].sort((a, b) => a - b);

          /*
           * K3 — percentá pásiem sa BERÚ Z RIADKOV RODIČA (L1, 25. 8. 2026).
           *
           * Predĺženie mení výhradne `to` (D27); percento položky je vlastnosť,
           * ktorú jej dali pásma pri potvrdení pôvodnej zľavy. Kým sa mapa
           * nepodávala, `insertConfirmedCampaign` padol na hlavičkové percento —
           * a to je podľa K3 NAJVYŠŠIE pásmo, takže zľava 30/20/10 sa celá
           * zapísala do produkčného shopu za 30 %. Cesta späť neexistuje (I7).
           */
          const percents = Object.fromEntries(
            items.map((item) => [
              String(item.productId),
              /*
               * `RoutesItemsRepo` je zdieľaný typ starší než K3 a `percent`
               * nepomenúva; produkčný `listByCampaign()` vracia
               * `CampaignItemRecordV3`, ktorý ho má — a `campaign-items.repo.ts:120`
               * to o sebe hovorí sám („je to iba PRIDANÉ pole, typ zostáva
               * kompatibilný"). Fallback na hlavičku je fail-closed pre staré
               * fakes v testoch, ktoré percento na položke nenesú.
               */
              (item as Partial<CampaignItemRecordV3>).percent ?? parent.percent,
            ]),
          );

          const claims = await verifyPreviewTokenFor(
            d,
            ctx.body.previewToken,
            {
              kind: 'extend',
              productIds,
              percent: parent.percent,
              from: parent.dateFrom,
              to: newTo,
              percents,
            },
            ctx.claims.sub,
          );

          const record = await insertConfirmedCampaign(d, {
            claims,
            name: `${parent.name} — predĺženie`,
            kind: 'extend',
            mode: 'eager',
            status: 'draft',
            fireAt: null,
            parentCampaignId: parent.id,
            createdBy: ctx.claims.sub,
            percents,
          });

          await makeExecutor(d).executeCampaign(record.id, {
            actor: 'user',
            userId: ctx.claims.sub,
          });
          return { campaignId: record.id };
        }),
    },
    routeDeps,
  );
}

export const POST = createExtendPost();
