/**
 * Aura Zľavy — `POST /api/campaigns/preview` (BUILD-SPEC §5, D3, D4, D60, I3;
 * KONTRAKT V3: K1, K3, K4).
 *
 * Skúška naprázdno: zostaví diff sadu cez `engine/preview` (V6) a pri čistej
 * sade vydá jednorazový `previewToken` (O2). NIKDY nič nezapisuje — všetky
 * volania shopu sú čítacie. Bez tokenu z tejto route neexistuje cesta
 * k zápisu (I3).
 *
 * Zmeny V3:
 *  - **strop sady je 10 000** (K1 bod 3), nie 10. Strop režimu `pilot` sa TU
 *    nevynucuje: pozná ho `checkScope()` v engine, ktorý číta `scope_mode`
 *    fail-closed z DB. Keby tu stálo natvrdo 10, prepnutie do režimu `plny`
 *    (s auditom) by nemalo žiadny účinok a K1 by bol na papieri.
 *  - **pásma (K3)**: `tiers` rozdelia sadu na skupiny s vlastným percentom.
 *    Token potom nesie percento KAŽDEJ položky a zápis sa nedá „preklopiť"
 *    do iného pásma medzi potvrdením a zápisom.
 *
 * Vlastník: V8.
 */
import { z } from 'zod';

import { PREVIEW_MAX_PRODUCTS } from '@/lib/crypto/preview-token';
import { buildPreview, type PreviewTierInput } from '@/lib/engine/preview';
import { CAMPAIGN_KINDS } from '@/lib/domain/status';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { newOperationContext } from '@/lib/shop/correlation';

import {
  dateOnlySchema,
  previewResultResponse,
  resolveRoutesDeps,
  withRouteErrors,
  type RoutesDeps,
} from '../_shared';

/** Pásmo (K3): popis + percento + produkty, ktoré doň patria. */
const tierSchema = z.object({
  ord: z.number().int().min(1).max(255),
  label: z.string().max(191),
  percent: z.number().int().min(1).max(30),
  productIds: z.array(z.number().int().positive()).min(1).max(PREVIEW_MAX_PRODUCTS),
});

const bodySchema = z.object({
  productIds: z.array(z.number().int().positive()).min(1).max(PREVIEW_MAX_PRODUCTS),
  /** K3 — hlavičkové percento = NAJVYŠŠIE percento pásiem. */
  percent: z.number().int().min(1).max(30),
  from: dateOnlySchema,
  to: dateOnlySchema,
  kind: z.enum(CAMPAIGN_KINDS),
  tiers: z.array(tierSchema).min(1).max(50).optional(),
  parentCampaignId: z.number().int().positive().optional(),
  /** D30 — potvrdenie „naozaj 1 deň?". Bez neho je `from = to` blokátor. */
  oneDayAcknowledged: z.boolean().optional(),
});

export function createPreviewPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      body: bodySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          /*
           * K3 pri OPRAVE ZLYHANÝCH: pásma doplní SERVER, nie klient.
           *
           * Percentá opravnej zľavy nie sú voľba človeka — sú vlastnosťou
           * riadkov rodiča. Obrazovka opravy (`RetryFailed.tsx`) preto do
           * náhľadu `tiers` neposiela a do 26. 8. 2026 ich nemal odkiaľ vziať
           * nikto: `buildPreview` vloží `percents` do tokenu len pri neprázdnych
           * `tiers`, takže token ich nenesol, `retry-failed` POST ich z tokenu
           * čítal ako `undefined` a položky opravnej zľavy dostali hlavičkové
           * percento — teda NAJVYŠŠIE pásmo (nález L2, vyvrátená prvá oprava).
           *
           * Klient sa nemení zámerne: mapa percent podaná klientom by bola nová
           * dôverovaná plocha na ceste, ktorá zapisuje do shopu. Server si ju
           * poskladá z `campaign_items` rodiča a `retry-failed` POST si ju
           * poskladá znova, nezávisle — takže token a DB sa musia zhodnúť.
           */
          let tiers: PreviewTierInput[] | undefined =
            ctx.body.tiers === undefined ? undefined : (ctx.body.tiers as PreviewTierInput[]);
          if (tiers === undefined && ctx.body.kind === 'retry' && ctx.body.parentCampaignId !== undefined) {
            const parentItems = await d.campaignItemsRepo.listByCampaign(ctx.body.parentCampaignId);
            const wanted = new Set(ctx.body.productIds);
            const byPercent = new Map<number, number[]>();
            for (const item of parentItems) {
              if (!wanted.has(item.productId)) continue;
              const percent = (item as { percent?: number }).percent ?? ctx.body.percent;
              const list = byPercent.get(percent);
              if (list === undefined) byPercent.set(percent, [item.productId]);
              else list.push(item.productId);
            }
            if (byPercent.size > 0) {
              tiers = [...byPercent.entries()]
                .sort((a, b) => b[0] - a[0])
                .map(([percent, productIds], index) => ({
                  ord: index + 1,
                  label: `${percent} %`,
                  percent: percent as PreviewTierInput['percent'],
                  productIds,
                }));
            }
          }

          const result = await buildPreview(
            {
              userId: ctx.actor.id,
              kind: ctx.body.kind,
              productIds: ctx.body.productIds,
              percent: ctx.body.percent,
              from: ctx.body.from,
              to: ctx.body.to,
              ...(tiers !== undefined ? { tiers } : {}),
              ...(ctx.body.oneDayAcknowledged !== undefined
                ? { oneDayAcknowledged: ctx.body.oneDayAcknowledged }
                : {}),
              // D15/D16 — rodič opakovania sa z kontroly prekryvu vylučuje.
              ...(ctx.body.parentCampaignId !== undefined
                ? { parentCampaignId: ctx.body.parentCampaignId }
                : {}),
            },
            {
              shopClient: d.shopClient,
              allowlistRepo: d.allowlistRepo,
              campaignsRepo: d.campaignsRepo,
              catalogRepo: d.catalogRepo,
              apiKeyMeta: d.apiKeyRepo,
              previewTokens: d.previewTokens,
              now: d.now,
              timeZone: d.timeZone,
            },
            newOperationContext(),
          );
          // Redaktor by `previewToken` v tele zamaskoval — vlastná Response (O2).
          return previewResultResponse(result);
        }),
    },
    routeDeps,
  );
}

export const POST = createPreviewPost();
