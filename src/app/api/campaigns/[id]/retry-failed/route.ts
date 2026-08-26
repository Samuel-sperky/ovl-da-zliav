/**
 * Aura Zľavy — `GET`/`POST /api/campaigns/[id]/retry-failed`
 * (BUILD-SPEC §5, D15, D16, D36, D45; kontrakt dokončenia B7).
 *
 * „Zopakovať zlyhané": `partial`/`failed` zľava sa NIKDY neopravuje na mieste —
 * vytvorí sa NOVÁ zľava `kind='retry'` s `parent_campaign_id` a s presne tou
 * sadou produktov, ktoré neskončili `ok`/`skipped` (D15). Vyžaduje NOVÝ náhľad
 * a jednorazový `previewToken` nad touto zúženou sadou (D16, I3). Idempotenciu
 * identických zápisov rieši executor (D36 skip).
 *
 * PREČO TU PRIBUDOL `GET`
 * -----------------------
 * `POST` sa bez `previewToken` odmietne — a to je správne (I3). Lenže dovtedy
 * appka mlčala: používateľ dostal 4xx, z ktorého sa nedalo prečítať, ČO by sa
 * vlastne zopakovalo, PREČO to teraz nejde a ČO má urobiť. `GET` je čisto
 * čítací popis toho istého rozhodnutia — vráti sadu produktov, jej rozpad na
 * „nezapísalo sa" a „nevieme, či sa zapísalo", okno, ktoré by nová zľava
 * dostala, a vetu s ďalším krokom. Z nej si obrazovka poskladá náhľad a až ten
 * dá token, ktorým sa `POST` volá.
 *
 * `GET` NIČ NEMENÍ a nič nezapisuje — je to popis, nie príprava zápisu.
 *
 * NEISTÉ NIE JE ZLYHANÉ (D45)
 * ---------------------------
 * Do sady na zopakovanie patria OBE skupiny, ale znamenajú niečo iné a odpoveď
 * ich preto vracia oddelene:
 *
 *  - **nezapísalo sa** (`failed`, `not_found`, `blocked`, `interrupted`) —
 *    produkt určite nie je zlacnený,
 *  - **nevieme, či sa zapísalo** (`uncertain`) — zápis odišiel, ale odpoveď
 *    nedorazila alebo mala iný tvar. D45 hovorí jasne: pošle sa IDENTICKÝ
 *    `setReduction` ešte raz a stav sa vyrieši podľa druhej odpovede. Keď tam
 *    zľava už je, executor ju druhýkrát nepíše (D36). Preto je zopakovanie
 *    neistej položky bezpečné — ale používateľ má vedieť, že sa deje práve toto.
 *
 * Vlastník: A12.
 */
import { z } from 'zod';

import type {
  CampaignItemRecord,
  CampaignRecord,
  CampaignStatus,
  DateOnly,
  DiscountPercent,
  ItemStatus,
} from '@/contracts';
/**
 * Položka rodiča tak, ako ju POST potrebuje. `RoutesItemsRepo` je zdieľaný typ
 * starší než K3 a `percent` nepomenúva, hoci produkčný `listByCampaign()` vracia
 * `CampaignItemRecordV3`, ktorý ho má (`campaign-items.repo.ts:120` o sebe
 * hovorí, že je to iba PRIDANÉ pole). Voliteľné je tu zámerne: staré fakes
 * v testoch percento na položke nenesú a fallback na hlavičku je fail-closed.
 */
type RetryItem = CampaignItemRecord & { percent?: DiscountPercent };

import { maxDateOnly } from '@/lib/domain/dates';
import { conflict } from '@/lib/http/errors';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

import {
  idParamSchema,
  loadCampaignOr404,
  makeExecutor,
  resolveRoutesDeps,
  todayOf,
  verifyPreviewTokenFor,
  insertConfirmedCampaign,
  withRouteErrors,
  type ResolvedRoutesDeps,
  type RoutesDeps,
} from '../../_shared';

const bodySchema = z.object({
  previewToken: z
    .string({
      error:
        'Zopakovanie zlyhaných si vždy vyžiada nový náhľad a jeho potvrdenie (D16, I3). ' +
        'V požiadavke chýba token z čerstvého náhľadu — spustite náhľad nad zúženou sadou produktov.',
    })
    .min(
      1,
      'Token z náhľadu je prázdny. Spustite náhľad znova; bez neho sa do shopu nezapíše nič (I3).',
    ),
});

/** Stavy zľavy, z ktorých má „zopakovať zlyhané" zmysel (D15). */
const RETRYABLE_FROM: readonly CampaignStatus[] = ['partial', 'failed'];

/**
 * Stavy položky, ktoré sa NEOPAKUJÚ. Všetko ostatné do opravnej zľavy patrí —
 * definícia je zámerne „čo neskončilo úspechom", nie výpočet zlyhaní: keby
 * pribudol nový stav položky, fail-closed sa zopakuje, nie ticho zabudne (D15).
 */
const SETTLED_ITEM_STATUSES: readonly ItemStatus[] = ['ok', 'skipped'];

/** Čo bráni zopakovaniu. `null` = nič, dá sa pokračovať náhľadom. */
export type RetryBlockCode = 'invalid_status' | 'window_lapsed' | 'nothing_to_retry';

/** Rozpad položiek zľavy na skupiny, ktoré majú rôzny ďalší krok. */
export interface RetryBreakdown {
  /** Zapísané a potvrdené shopom — do opravnej zľavy nejdú. */
  ok: number;
  /** Rovnaká zľava tam už bola, nepísali sme ju druhýkrát (D36). */
  skipped: number;
  /** Určite sa nezapísalo (`failed`, `not_found`, `blocked`, `interrupted`). */
  notWritten: number;
  /** NEVIEME, či sa zapísalo (`uncertain`, D45). */
  uncertain: number;
  /** Fronta na ne ešte nedošla. */
  pending: number;
}

/** Popis toho, čo by „zopakovať zlyhané" urobilo. Čistý výpočet, žiadna DB. */
export interface RetryPlan {
  /** Sada produktov opravnej zľavy, vzostupne podľa ID (I10). */
  productIds: number[];
  breakdown: RetryBreakdown;
  /** `null` = dá sa pokračovať. Inak dôvod, prečo nie. */
  blockedBy: RetryBlockCode | null;
  /** Okno, ktoré by opravná zľava dostala (`from` v minulosti = dnešok, D25). */
  effectiveFrom: DateOnly;
  effectiveTo: DateOnly;
}

/* ═════════════════════ 1. Čistý výpočet plánu (D15, D25) ══════════════════ */

/**
 * Čo by sa zopakovalo. Jediné miesto, kde sa sada opravnej zľavy počíta —
 * `GET` aj `POST` z neho čítajú to isté, takže odpoveď na „čo to urobí" a
 * samotné „urob to" sa nemôžu rozísť.
 */
export function buildRetryPlan(
  campaign: Pick<CampaignRecord, 'status' | 'dateFrom' | 'dateTo'>,
  items: readonly Pick<CampaignItemRecord, 'productId' | 'status'>[],
  today: DateOnly,
): RetryPlan {
  const breakdown: RetryBreakdown = {
    ok: 0,
    skipped: 0,
    notWritten: 0,
    uncertain: 0,
    pending: 0,
  };
  const productIds: number[] = [];

  for (const item of items) {
    if (item.status === 'ok') breakdown.ok += 1;
    else if (item.status === 'skipped') breakdown.skipped += 1;
    else if (item.status === 'uncertain') breakdown.uncertain += 1;
    else if (item.status === 'pending') breakdown.pending += 1;
    else breakdown.notWritten += 1;

    if (!SETTLED_ITEM_STATUSES.includes(item.status)) productIds.push(item.productId);
  }
  productIds.sort((a, b) => a - b);

  const effectiveFrom = maxDateOnly(campaign.dateFrom, today);

  const blockedBy: RetryBlockCode | null = !RETRYABLE_FROM.includes(campaign.status)
    ? 'invalid_status'
    : campaign.dateTo < today
      ? 'window_lapsed'
      : productIds.length === 0
        ? 'nothing_to_retry'
        : null;

  return { productIds, breakdown, blockedBy, effectiveFrom, effectiveTo: campaign.dateTo };
}

/* ═════════════════════ 2. Slovenské vety k plánu (K10) ════════════════════ */

const products = (count: number): string =>
  `${formatCountSk(count)} ${pluralSk(count, 'produkt', 'produkty', 'produktov')}`;

/**
 * ČO sa deje a ČO S TÝM — s číslami, nie s kódom. Tvar je zámerne rovnaký ako
 * v `lib/status/blockers.ts` (`what` + `nextStep`), aby to obrazovka vedela
 * vykresliť tou istou kartou.
 */
export function retrySentence(
  plan: RetryPlan,
  campaign: Pick<CampaignRecord, 'name' | 'status' | 'dateTo'>,
  today: DateOnly,
): { what: string; nextStep: string } {
  switch (plan.blockedBy) {
    case 'invalid_status':
      return {
        what: `Zopakovať sa dá až zľava, ktorá dobehla a časť produktov jej neprešla. Zľava „${campaign.name}" v tomto stave ešte nie je.`,
        nextStep:
          'Počkajte, kým zľava dobehne. Kým beží, jej zvyšné produkty sa zapisujú samy — opravná zľava by len duplikovala prácu.',
      };
    case 'window_lapsed':
      return {
        what: `Okno zľavy „${campaign.name}" skončilo ${campaign.dateTo} a dnes je ${today} — do uplynutého okna sa už dopísať nedá (D25, I7).`,
        nextStep:
          'Založte novú zľavu s novým oknom a vyberte do nej tie isté produkty. Appka okno existujúcej zľavy nikdy sama neposúva.',
      };
    case 'nothing_to_retry':
      return {
        what: `Zľava „${campaign.name}" nemá ani jeden produkt, ktorý by sa dal zopakovať — ${products(plan.breakdown.ok)} ${pluralSk(plan.breakdown.ok, 'je zapísaný', 'sú zapísané', 'je zapísaných')} a ${formatCountSk(plan.breakdown.skipped)} ${pluralSk(plan.breakdown.skipped, 'bol preskočený', 'boli preskočené', 'bolo preskočených')}, lebo rovnaká zľava tam už bola.`,
        nextStep: 'Netreba robiť nič.',
      };
    default:
      break;
  }

  const parts: string[] = [];
  if (plan.breakdown.notWritten > 0) {
    parts.push(`pri ${products(plan.breakdown.notWritten)} sa zľava určite nezapísala`);
  }
  if (plan.breakdown.uncertain > 0) {
    parts.push(`pri ${products(plan.breakdown.uncertain)} nevieme, či sa zapísala`);
  }
  if (plan.breakdown.pending > 0) {
    parts.push(`na ${products(plan.breakdown.pending)} fronta vôbec nedošla`);
  }

  return {
    what: `Opravná zľava by zopakovala ${products(plan.productIds.length)}: ${parts.join(', ')}.`,
    nextStep:
      'Spustite náhľad nad touto sadou a potvrďte ho — bez čerstvého potvrdenia sa do shopu nezapíše nič (I3, D16). ' +
      'Produkty, pri ktorých nevieme, či sa zľava zapísala, dostanú ten istý zápis ešte raz; ak tam zľava už je, appka ju druhýkrát nepíše.',
  };
}

/* ═══════════════════════ 3. Spoločné načítanie plánu ══════════════════════ */

async function loadPlan(
  d: ResolvedRoutesDeps,
  campaignId: number,
): Promise<{ campaign: CampaignRecord; plan: RetryPlan; today: DateOnly; items: RetryItem[] }> {
  const campaign = await loadCampaignOr404(d, campaignId);
  const today = todayOf(d);
  const items = await d.campaignItemsRepo.listByCampaign(campaign.id);
  return { campaign, plan: buildRetryPlan(campaign, items, today), today, items };
}

/* ══════════════════════════════ 4. GET ════════════════════════════════════ */

/**
 * Popis toho, čo by zopakovanie urobilo. Čisto čítacie — žiadny zápis do DB ani
 * do shopu, žiadny token sa tu nevydáva.
 */
export function createRetryFailedGet(
  overrides: RoutesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveRoutesDeps(overrides);
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      params: idParamSchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const { campaign, plan, today } = await loadPlan(d, ctx.params.id);
          const sentence = retrySentence(plan, campaign, today);

          return {
            campaignId: campaign.id,
            name: campaign.name,
            status: campaign.status,
            percent: campaign.percent,
            /** `true` = ostáva už len náhľad a jeho potvrdenie. */
            possible: plan.blockedBy === null,
            /** Kód prekážky; vetu k nemu nesie `what`/`nextStep` (K10). */
            blockedBy: plan.blockedBy,
            what: sentence.what,
            nextStep: sentence.nextStep,
            /**
             * Sada opravnej zľavy. Je ohraničená stropom 10 000 položiek na
             * zľavu (K1 bod 3), takže sa posiela celá — obrazovka z nej skladá
             * náhľad a bez úplnej sady by token nesedel na to, čo sa zapíše.
             */
            productIds: plan.productIds,
            items: {
              total: campaign.itemsTotal,
              retryable: plan.productIds.length,
              /** D45 — dve rôzne veci, dva rôzne ďalšie kroky. */
              notWritten: plan.breakdown.notWritten,
              uncertain: plan.breakdown.uncertain,
              pending: plan.breakdown.pending,
              ok: plan.breakdown.ok,
              skipped: plan.breakdown.skipped,
            },
            /** Okno, ktoré by opravná zľava dostala (D25 — `from` nikdy v minulosti). */
            window: {
              from: plan.effectiveFrom,
              to: plan.effectiveTo,
              originalFrom: campaign.dateFrom,
              today,
            },
            /** Čo si `POST` vyžiada. Nie je to voliteľné (I3, D16, D70). */
            requires: {
              freshPreview: true as const,
              confirmation: true as const,
              sudo: true as const,
            },
          };
        }),
    },
    routeDeps,
  );
}

/* ══════════════════════════════ 5. POST ═══════════════════════════════════ */

export function createRetryFailedPost(
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
          const { campaign: parent, plan, today, items } = await loadPlan(d, ctx.params.id);

          /* Prekážky sa hlásia tou istou vetou, akú vráti `GET` — používateľ
           * nesmie dostať iné vysvetlenie podľa toho, ktorou cestou prišiel. */
          if (plan.blockedBy !== null) {
            const sentence = retrySentence(plan, parent, today);
            throw conflict(
              `${sentence.what} ${sentence.nextStep}`,
              plan.blockedBy === 'invalid_status' ? 'invalid_transition' : plan.blockedBy,
              {
                logAsError: false,
                detail: {
                  blockedBy: plan.blockedBy,
                  status: parent.status,
                  allowed: [...RETRYABLE_FROM],
                  items: plan.breakdown,
                },
              },
            );
          }

          /*
           * K3 — percentá pásiem z RIADKOV RODIČA, nie z tokenu (L2, 26. 8. 2026).
           *
           * Prvá oprava tohto nálezu brala `percents` z overených claims. Bola
           * vyvrátená: `buildPreview` ich do tokenu vloží len pri neprázdnych
           * `tiers`, a obrazovka opravy žiadne neposielala — takže sa čítalo
           * pole, ktoré tam nikdy nebolo, a položky dostali hlavičkové percento,
           * teda najvyššie pásmo. Teraz ich náhľad do tokenu dostane (server ich
           * dopĺňa v `campaigns/preview`) a POST si tú istú mapu poskladá ZNOVA,
           * nezávisle z DB — takže sa token a databáza musia zhodnúť, inak hash
           * nesedí a nezapíše sa nič. To I3 utvrdzuje, nie oslabuje.
           */
          const percents = Object.fromEntries(
            items
              .filter((item) => plan.productIds.includes(item.productId))
              .map((item): [string, DiscountPercent] => [
                String(item.productId),
                item.percent ?? parent.percent,
              ]),
          );

          /* NOVÝ token nad zúženou sadou; `from` v minulosti = dnešok (D25). */
          const claims = await verifyPreviewTokenFor(
            d,
            ctx.body.previewToken,
            {
              kind: 'retry',
              productIds: plan.productIds,
              percent: parent.percent,
              from: plan.effectiveFrom,
              to: plan.effectiveTo,
              percents,
            },
            ctx.claims.sub,
          );

          /* K3 — percentá pásiem nesie OVERENÝ token, nie telo požiadavky.
           * Bez ich podania by položky dostali hlavičkové percento kampane a
           * `assertConfirmed()` by hash prepočítaný z riadkov už nedopočítal
           * k tomu, ktorý podpísal dry-run: opravná zľava by zostala visieť ako
           * `draft`, jednorazový token by bol spálený a do shopu by nešlo nič
           * (I3, K3). `POST /api/campaigns` ich podáva rovnako. */

          const record = await insertConfirmedCampaign(d, {
            claims,
            percents,
            name: `${parent.name} — oprava`,
            kind: 'retry',
            mode: 'eager',
            status: 'draft',
            fireAt: null,
            parentCampaignId: parent.id,
            createdBy: ctx.claims.sub,
          });

          await makeExecutor(d).executeCampaign(record.id, {
            actor: 'user',
            userId: ctx.claims.sub,
          });
          return {
            campaignId: record.id,
            /** Koľko produktov opravná zľava dostala a z čoho sa skladajú (D45). */
            items: {
              retryable: plan.productIds.length,
              notWritten: plan.breakdown.notWritten,
              uncertain: plan.breakdown.uncertain,
              pending: plan.breakdown.pending,
            },
          };
        }),
    },
    routeDeps,
  );
}

export const GET = createRetryFailedGet();
export const POST = createRetryFailedPost();
