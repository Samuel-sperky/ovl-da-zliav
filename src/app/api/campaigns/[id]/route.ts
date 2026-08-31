/**
 * Aura Zľavy — `GET /api/campaigns/[id]` (BUILD-SPEC §5; KONTRAKT V3: K3, K5).
 *
 * Detail zľavy: záznam + pásma (K3) + odhad dobehnutia (K5) + položky + audit
 * stopa (D18). Čisto čítacie.
 *
 * Položky sa vracajú STRÁNKOVANE. Detail zľavy podľa architektúry §1 ukazuje
 * „len súhrn + zlyhané a podozrivé" (odpoveď 56), nie 8 000 riadkov — a 8 000
 * riadkov v jednej JSON odpovedi by aj tak nikto neprečítal.
 *
 * D116 / K6: položky nesú aj `reference` — pripája ju `campaignItemsRepo`
 * (`listPage()`/`listByCampaign()`) `LEFT JOIN`-om zo zrkadla katalógu pri
 * ČÍTANÍ; do `campaign_items` sa nekopíruje nič. `null` = „appka referenciu
 * nepozná" (I11), nikdy „produkt ju nemá". Položky idú do odpovede tak, ako
 * prišli z repozitára — kto ich tu začne prepisovať, musí pole ponechať.
 *
 * Vlastník: V8.
 */
import { z } from 'zod';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import type { CampaignItemsRepoExt } from '@/lib/repo/campaign-items.repo';

import {
  campaignView,
  estimateFinishFor,
  idParamSchema,
  loadCampaignOr404,
  resolveRoutesDeps,
  tierView,
  todayOf,
  withRouteErrors,
  type RoutesDeps,
  type RoutesItemsRepo,
} from '../_shared';

/**
 * Repozitár položiek tak, ako ho potrebuje detail. `listPage`/`countByCampaign`
 * sú VOLITEĽNÉ len kvôli starým fakes v testoch (`RoutesItemsRepo` ich nemá);
 * produkčný `campaignItemsRepo` ich má vždy.
 *
 * Testy detailu idú DÁVKOVOU cestou: fake v `test/integration/routes-harness.ts`
 * oba tvary má. Do 25. 8. 2026 ich nemal, takže všetky tiekli záložnou vetvou a
 * produkčnú nespustil nikto — chyba v nej by sa v zelenom balíku nebola ukázala.
 * Kto ten fake okleští, otvorí tú dieru znova.
 */
type DetailItemsRepo = RoutesItemsRepo &
  Partial<Pick<CampaignItemsRepoExt, 'listPage' | 'countByCampaign'>>;

const detailQuerySchema = z.object({
  /** Koľko položiek vrátiť. Default 100 — detail nie je export katalógu. */
  itemsLimit: z.coerce.number().int().min(0).max(1000).default(100),
  itemsOffset: z.coerce.number().int().min(0).default(0),
});

export function createCampaignGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      params: idParamSchema,
      query: detailQuerySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const record = await loadCampaignOr404(d, ctx.params.id);
          const view = campaignView(record, todayOf(d));
          const tiers = await d.tiersRepo.listByCampaign(record.id);
          const audit = await d.auditRepo.list({ campaignId: record.id, perPage: 100 });

          /*
           * Stránka sa berie z DB, nie z poľa v pamäti. Predtým tu bolo
           * `listByCampaign()` (bez `LIMIT`, so `sent_payload` a `raw_response`)
           * a hneď za ním `.slice(offset, offset + limit)` — pri 10 000
           * položkách teda ~1 MB riadkov cez driver a filesort nad celou
           * kampaňou len na to, aby sa 99 % z nich zahodilo. `listPage()`
           * existoval o dva riadky nižšie v tom istom repozitári.
           */
          const itemsRepo: DetailItemsRepo = d.campaignItemsRepo;
          const { items, itemsTotal } =
            itemsRepo.listPage === undefined || itemsRepo.countByCampaign === undefined
              ? await (async () => {
                  const all = await itemsRepo.listByCampaign(record.id);
                  return {
                    items: all.slice(
                      ctx.query.itemsOffset,
                      ctx.query.itemsOffset + ctx.query.itemsLimit,
                    ),
                    itemsTotal: all.length,
                  };
                })()
              : {
                  // `itemsLimit=0` je platná požiadavka „len počet, žiadne
                  // riadky" — `listPage()` má spodný strop 1, tak sa nevolá.
                  items:
                    ctx.query.itemsLimit === 0
                      ? []
                      : await itemsRepo.listPage(
                          record.id,
                          ctx.query.itemsLimit,
                          ctx.query.itemsOffset,
                        ),
                  itemsTotal: await itemsRepo.countByCampaign(record.id),
                };

          return {
            campaign: view,
            tiers: tiers.map(tierView),
            estimate: await estimateFinishFor(d, view.itemsPending),
            items,
            itemsTotal,
            itemsOffset: ctx.query.itemsOffset,
            auditTrail: audit.data,
          };
        }),
    },
    routeDeps,
  );
}

export const GET = createCampaignGet();
