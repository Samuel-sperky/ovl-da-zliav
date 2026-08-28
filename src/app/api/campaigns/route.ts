/**
 * Aura Zľavy — `/api/campaigns` (BUILD-SPEC §5; KONTRAKT V3: K2, K3, K5, K6).
 *
 *  - `GET`: stránkovaný zoznam zliav + PÁSMA (K3) + odhad dobehnutia fronty
 *    (K5) + príznak `late` + DERIVOVANÉ UI stavy „aktívna"/„expirovaná"
 *    (O1, D14). Derivát sa nikdy neukladá do DB.
 *  - `POST`: potvrdenie dry-runu → vytvorenie zľavy (I3, D2, D22).
 *    Bez platného jednorazového `previewToken` so zhodným hashom parametrov
 *    sa NEODOŠLE ani jeden request na shop — token sa overuje PRED akýmkoľvek
 *    dotykom shopu aj pred vložením zľavy.
 *
 *    Sudo pred týmto `POST`om stálo do 27. 8. 2026 (D100). Brána zápisu tým
 *    NEZMIZLA, len sa stiahla na to, čo naozaj chráni: I3 znie odteraz „žiadny
 *    zápis bez dry-runu + potvrdenia" a obe polovice sú tu — token z
 *    `/api/campaigns/preview` je dôkaz dry-runu a mutáciu navyše prepustí len
 *    origin check (`checkOrigin()`, D72), takže cudzia stránka sem nezapíše.
 *
 * Čo mení KONTRAKT V3 oproti pôvodnému tvaru:
 *
 *  1. **Zápis je FRONTA, nie akcia (K2).** `mode='eager'` už neznamená „zapíš
 *     teraz všetko" — 8 000 produktov pri 200/deň je 40 dní a taký zápis sa do
 *     jednej HTTP požiadavky nezmestí. Zľava sa preto zakladá rovno v stave
 *     `queued` a fronta (V7) ju dobehne. Inline sa dopíše len sada, ktorá sa
 *     zmestí do stropu režimu `pilot` (10 produktov = najviac 10 × 3 s) — to je
 *     doterajšie správanie D22 a zostáva nezmenené.
 *     `mode='scheduled'` zostáva `scheduled` + `fire_at` (D32).
 *  2. **Pásma (K3).** Percento je vlastnosť POLOŽKY a berie sa VÝHRADNE
 *     z overeného tokenu. `tiers` v tele nesie len popis pásma (`label`,
 *     `rule`) na zobrazenie — percento pásma sa proti tokenu overuje a pri
 *     nezhode sa nič nevloží (inak by sa dalo potvrdiť jedno a zapísať iné).
 *  3. **Odhad a varovanie o kľúči (K5, K6).** Odpoveď povie, kedy fronta
 *     dobehne a či zápisový kľúč expiruje skôr. Zaradiť frontu to nebráni —
 *     je to varovanie, nie brzda.
 *
 * Vlastník: V8.
 */
import { z } from 'zod';

import type { CampaignStatus, DiscountPercent } from '@/contracts';

import { fireAtUtc } from '@/lib/domain/dates';
import { CAMPAIGN_KINDS, CAMPAIGN_MODES } from '@/lib/domain/status';
import { badRequest } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { PILOT_MAX_PRODUCTS } from '@/lib/repo/settings.repo';
import type { NewCampaignTier } from '@/lib/repo/tiers.repo';

import {
  QUEUED,
  campaignStatusSchema,
  campaignView,
  estimateWith,
  insertConfirmedCampaign,
  makeExecutor,
  pageQuery,
  peekPreviewToken,
  perPageQuery,
  readBudgetStatus,
  readQueuePending,
  resolveRoutesDeps,
  tierView,
  todayOf,
  verifyPreviewTokenFor,
  withRouteErrors,
  type RoutesDeps,
} from './_shared';

/**
 * Koľko produktov sa smie dopísať SYNCHRÓNNE v požiadavke `mode='eager'`.
 *
 * Je to zhodou okolností strop režimu `pilot` (K1) a nie je to náhoda: väčšia
 * sada je z definície fronta bežiaca dni až týždne (K2) a HTTP požiadavka na to
 * nie je miesto. Nad týmto číslom sa zľava zaradí do fronty a odpoveď povie
 * odhad dobehnutia — nič sa nestratí, len sa nečaká.
 */
export const EAGER_INLINE_MAX_ITEMS = PILOT_MAX_PRODUCTS;

/* ═══════════════════════════════ GET ══════════════════════════════════════ */

const listQuerySchema = z.object({
  status: z
    .union([campaignStatusSchema, z.array(campaignStatusSchema)])
    .optional(),
  page: pageQuery,
  perPage: perPageQuery,
});

export function createCampaignsGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      query: listQuerySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const filter: {
            status?: CampaignStatus | CampaignStatus[];
            page: number;
            perPage: number;
          } = { page: ctx.query.page, perPage: ctx.query.perPage };
          if (ctx.query.status !== undefined) {
            // `queued` je platná hodnota DB enumu, ktorú `CampaignStatus` (A0)
            // ešte nevie pomenovať — repozitár si ju sám whitelistuje.
            filter.status = ctx.query.status as CampaignStatus | CampaignStatus[];
          }

          const paged = await d.campaignsRepo.list(filter);
          const today = todayOf(d);
          // K2 — rozpočet sa číta RAZ na požiadavku; 20 riadkov zoznamu nesmie
          // znamenať 20 dotazov na to isté číslo.
          const budget = await readBudgetStatus(d);
          const now = d.now();

          // Pásma sa čítajú po riadkoch (`perPage` je zastropované na 100, čiže
          // najviac 100 malých dotazov cez `ix` na `campaign_id`). Zámerne nie
          // jedným `IN (…)` dotazom: `tiersRepo` taký tvar nemá a rozširovať
          // cudzí repozitár kvôli zoznamu na jednej obrazovke sa neoplatí.
          const data = [];
          for (const record of paged.data) {
            const view = campaignView(record, today);
            const tiers = await d.tiersRepo.listByCampaign(record.id);
            data.push({
              ...view,
              tiers: tiers.map(tierView),
              /** K5 — `null`, keď nie je čo dopisovať alebo rozpočet nečitateľný. */
              estimate: estimateWith(budget, view.itemsPending, now),
            });
          }

          return {
            data,
            page: paged.page,
            perPage: paged.perPage,
            total: paged.total,
            budget,
          };
        }),
    },
    routeDeps,
  );
}

/* ═══════════════════════════════ POST ═════════════════════════════════════ */

/**
 * Pásmo v tele požiadavky. `percent` tu JE, ale slúži len na kontrolu proti
 * tokenu — zapisuje sa percento z tokenu (K3, I3). `productIds` sa neposielajú:
 * rozdelenie produktov do pásiem už nesie podpísaný token.
 */
const tierSchema = z.object({
  ord: z.number().int().min(1).max(255),
  label: z.string().min(1).max(191),
  percent: z.number().int().min(1).max(30),
  /** Filter, ktorým pásmo vzniklo — LEN na zobrazenie a zopakovanie (K3). */
  rule: z.unknown().optional(),
  itemsCount: z.number().int().min(0).max(10_000).optional(),
});

const createBodySchema = z.object({
  previewToken: z.string().min(1),
  name: z.string().min(1).max(200),
  mode: z.enum(CAMPAIGN_MODES),
  /** K3 — pásma zľavy. Bez nich má celá sada jedno percento. */
  tiers: z.array(tierSchema).min(1).max(50).optional(),
  acknowledgements: z.object({
    /** Veta o nevratnosti — bez nej sa zľava nevytvorí (D2). */
    irreversible: z.literal(true),
    /** Povinné pri jednodňovej zľave `from = to` (D30). */
    oneDay: z.literal(true).optional(),
  }),
});

/**
 * K3 — pásma z tela sa musia zhodovať s percentami, ktoré nesie OVERENÝ token.
 * Fail-closed: pri akejkoľvek nezrovnalosti sa nevloží nič. Bez tejto kontroly
 * by sa dal potvrdiť náhľad s 20 % a do `campaign_tiers` uložiť 30 % — položky
 * by síce zlacneli správne, ale súhrn po pásmach by klamal o tom, čo sa deje.
 */
function assertTiersMatchToken(
  tiers: ReadonlyArray<z.infer<typeof tierSchema>>,
  percents: Readonly<Record<string, DiscountPercent>> | undefined,
  headerPercent: DiscountPercent,
): void {
  const fromToken = new Set<number>(
    percents === undefined ? [headerPercent] : Object.values(percents),
  );
  const fromBody = new Set(tiers.map((tier) => tier.percent));

  for (const percent of fromBody) {
    if (!fromToken.has(percent)) {
      throw badRequest(
        `Pásmo s ${percent} % nie je v potvrdenom náhľade — zopakuj skúšku naprázdno a potvrď znova.`,
        'tiers_mismatch',
        { logAsError: false },
      );
    }
  }
  for (const percent of fromToken) {
    if (!fromBody.has(percent)) {
      throw badRequest(
        `Potvrdený náhľad obsahuje pásmo s ${percent} %, ktoré v zľave chýba — zopakuj skúšku naprázdno a potvrď znova.`,
        'tiers_mismatch',
        { logAsError: false },
      );
    }
  }
  const highest = Math.max(...fromBody);
  if (highest !== headerPercent) {
    throw badRequest(
      `Najvyššie pásmo má ${highest} %, hlavička zľavy ${headerPercent} % — zoznamy zliav by ukazovali iné číslo, než sa naozaj zapíše.`,
      'tiers_mismatch',
      { logAsError: false },
    );
  }
}

export function createCampaignsPost(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'POST',
      body: createBodySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          /* 1. Nahliadnutie do tokenu (neoverené) — len na zostavenie
           *    `expected` sady a kontrolu D30. Pravda je až `verify()`. */
          const peeked = peekPreviewToken(ctx.body.previewToken);
          if (
            peeked === null ||
            !Array.isArray(peeked.productIds) ||
            typeof peeked.percent !== 'number' ||
            typeof peeked.from !== 'string' ||
            typeof peeked.to !== 'string' ||
            !(CAMPAIGN_KINDS as readonly string[]).includes(peeked.kind as string)
          ) {
            throw badRequest(
              'Preview token je neplatný alebo pozmenený — zápis sa odmieta (I3).',
              'preview_token_invalid',
            );
          }

          // D30 — jednodňová zľava vyžaduje explicitné potvrdenie. Kontrola je
          // PRED verify(), aby chýbajúce potvrdenie nespálilo jednorazový token.
          if (peeked.from === peeked.to && ctx.body.acknowledgements.oneDay !== true) {
            throw badRequest(
              'Zľava platí len jediný deň — potvrď „naozaj 1 deň?" (D30).',
              'one_day_not_acknowledged',
            );
          }

          /* 2. I3 — podpis, TTL, payloadHash, jednorazovosť, vlastník. */
          const claims = await verifyPreviewTokenFor(
            d,
            ctx.body.previewToken,
            {
              kind: peeked.kind as (typeof CAMPAIGN_KINDS)[number],
              productIds: peeked.productIds,
              percent: peeked.percent,
              from: peeked.from,
              to: peeked.to,
            },
            ctx.actor.id,
          );

          /* 3. K3 — pásma musia sedieť s percentami z overeného tokenu. */
          const percents = (claims as { percents?: Record<string, DiscountPercent> }).percents;
          let tiers: NewCampaignTier[] | undefined;
          if (ctx.body.tiers !== undefined) {
            assertTiersMatchToken(ctx.body.tiers, percents, claims.percent);
            tiers = ctx.body.tiers.map((tier) => ({
              ord: tier.ord,
              label: tier.label,
              percent: tier.percent as DiscountPercent,
              ...(tier.rule !== undefined ? { rule: tier.rule } : {}),
              itemsCount:
                tier.itemsCount ??
                (percents === undefined
                  ? claims.productIds.length
                  : claims.productIds.filter(
                      (id) => (percents[String(id)] ?? claims.percent) === tier.percent,
                    ).length),
            }));
          }

          /* 4. Vloženie zľavy s doloženým potvrdením (I3, I10, D39c, K3).
           *
           * K2 — `eager` znamená „do fronty a hneď": zľava vzniká rovno ako
           * `queued`, nie `draft`. Rozdiel je podstatný — `draft` fronta ani
           * scheduler nevidia, takže by potvrdená zľava po prvom zaváhaní
           * (chýbajúci kľúč, zamknuté zápisy) zostala navždy ležať. `queued`
           * si vezme ďalší tick presne tam, kde sa skončilo. */
          const eager = ctx.body.mode === 'eager';
          const record = await insertConfirmedCampaign(d, {
            claims,
            percents,
            ...(tiers !== undefined ? { tiers } : {}),
            name: ctx.body.name,
            kind: claims.kind,
            mode: ctx.body.mode,
            status: eager ? QUEUED : 'scheduled',
            fireAt: eager ? null : fireAtUtc(claims.from, d.fireTime, d.timeZone),
            createdBy: ctx.actor.id,
          });

          const itemsTotal = claims.productIds.length;

          /* 5. Malá sada sa dopíše hneď — VÝHRADNE cez executor (D22, §9).
           * Veľká sada zostáva vo fronte: 8 000 zápisov po 3 s nie je odpoveď
           * na HTTP požiadavku, je to 40 dní (K2). */
          if (eager && itemsTotal <= EAGER_INLINE_MAX_ITEMS) {
            const result = await makeExecutor(d).executeCampaign(record.id, {
              actor: 'user',
              userId: ctx.actor.id,
            });
            return {
              campaignId: record.id,
              status: result.status,
              itemsTotal,
              estimate: null,
            };
          }

          /* 6. K5/K6 — odhad dobehnutia a varovanie, že kľúč vyprší skôr.
           * Ani jedno nebráni zaradeniu; obe sú informácia pre používateľa.
           *
           * Odhad sa počíta z CELEJ fronty, nie z veľkosti tejto kampane
           * (`readQueuePending()`): položky sú už vložené, takže sa v tom čísle
           * nachádzajú, a spolu s nimi aj to, čo stojí pred nimi. Inak by karta
           * „Zaradené do fronty" vypísala skorší dátum, než aký sekundu predtým
           * ukázala obrazovka nastavenia zľavy — a K6 varovanie o kľúči by sa
           * podľa toho optimistického dátumu tichšie preskočilo. */
          const estimate = eager
            ? estimateWith(
                await readBudgetStatus(d),
                await readQueuePending(d, itemsTotal),
                d.now(),
              )
            : null;
          let keyExpiresBeforeFinish = false;
          if (estimate !== null) {
            try {
              const meta = await d.apiKeyRepo.getMeta();
              keyExpiresBeforeFinish =
                !meta.present ||
                (meta.expiresAt !== null &&
                  meta.expiresAt.toISOString().slice(0, 10) < estimate.date);
            } catch {
              // Fail-closed smerom k varovaniu: keď sa metadáta kľúča nedajú
              // prečítať, radšej upozorniť než mlčať (K6).
              keyExpiresBeforeFinish = true;
            }
          }

          return {
            campaignId: record.id,
            status: eager ? ('queued' as const) : ('scheduled' as const),
            itemsTotal,
            estimate,
            keyExpiresBeforeFinish,
          };
        }),
    },
    routeDeps,
  );
}

export const GET = createCampaignsGet();
export const POST = createCampaignsPost();
