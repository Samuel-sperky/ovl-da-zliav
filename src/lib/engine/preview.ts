/**
 * Aura Zľavy — DRY-RUN NÁHĽAD (BUILD-SPEC §9, D3, D4, D8, D28, D30, D39c, D60,
 * I3, a po novom K1, K3, K4, K7).
 *
 * Zostaví diff sadu pre potvrdenie: `name`/`price`, orientačnú zľavnenú cenu
 * (D4), posledný VLASTNÝ zápis (I11), varovania a blokátory. Keď nie je žiadny
 * blokátor, vydá jednorazový `previewToken` (O2) s `pricesAtPreview` a
 * `percents` per produkt — bez neho zápis neprebehne (I3).
 *
 * Blokátory sú fail-closed: kým existuje čo len jeden, token sa NEVYDÁ
 * (`previewToken` je prázdny string) a sada sa nedá potvrdiť.
 *
 * ─── Čo sa zmenilo v V3 ────────────────────────────────────────────────────
 *
 * 1. **Pásma (K3).** Jedna zľava môže mať viac percent. Percento je vlastnosť
 *    POLOŽKY a rozhoduje sa TU, pri potvrdení — nie pri zápise. Executor pásma
 *    nikdy nevyhodnocuje, berie hotové číslo z položky, takže produkt, ktorý sa
 *    medzi potvrdením a zápisom presunie do iného pásma, zlacnie presne o to
 *    percento, ktoré používateľ videl. `input.percent` je HLAVIČKA kampane a
 *    musí sa rovnať najvyššiemu percentu pásiem.
 *
 * 2. **Vzorka (6 riadkov naprieč pásmami).** Pri 8 000 produktoch nemá zmysel
 *    vracať 8 000 riadkov a ešte menej zmysel má ukázať „prvých 6" — pri
 *    triedení podľa `product_id` alebo podľa ceny by používateľ videl jediné
 *    pásmo (typicky to najlacnejšie) a potvrdil by zľavu, z ktorej nevidel
 *    väčšinu. `pickSample()` preto rozdelí 6 miest medzi pásma round-robinom a
 *    v rámci pásma berie rovnomerne rozložené riadky z cenového rozsahu.
 *
 * 3. **Zdroj cien pri veľkej sade (K7).** Do `PREVIEW_SHOP_DETAIL_MAX` produktov
 *    sa čítajú čerstvé detaily zo shopu (D57 — jeden `POST /api/batch` na 25
 *    kusov). Nad tým by to bolo 400 requestov na jeden dry-run, takže sa berie
 *    `catalog_cache` (zrkadlo katalógu, K7) a výsledok nesie `dataAsOf`, aby UI
 *    povedalo „Dáta k …" ako MERANÝ fakt (P7), nie ako odhad.
 *
 * 4. **Dotazy na kampane sú dávkované.** `findFutureOverlaps()` ide po blokoch;
 *    per-produkt sa dopytuje len blok, v ktorom sa naozaj niečo našlo — inak by
 *    dry-run 10 000 položiek znamenal 10 000 dotazov len na prekryv.
 *    `lastOwnWrite()` sa pýta len na riadky, ktoré sa naozaj zobrazia.
 *
 * Vlastník: V6.
 */
import type {
  AllowlistRepo,
  ApiKeyRepo,
  CampaignKind,
  CampaignRecord,
  CampaignStatus,
  CampaignsRepo,
  CatalogRepo,
  DateOnly,
  DiscountPercent,
  LastOwnWrite,
  MoneyString,
  PreviewBlocker,
  PreviewItem,
  PreviewResult,
  ProductDetail,
  ShopClient,
  ShopCtx,
} from '@/contracts';

import {
  formatDateOnlySk,
  isSameOrBefore,
  startOfDayUtc,
  todayInZone,
  LOGIC_TIME_ZONE,
} from '@/lib/domain/dates';
import { validateCampaignWindow } from '@/lib/domain/campaign-rules';
import { discountedPrice, isMoneyString, moneyToCents } from '@/lib/domain/pricing';
import {
  PERCENT_MAX,
  PERCENT_MIN,
  previewTokenService as defaultPreviewTokens,
  type PreviewTokenServiceV3,
} from '@/lib/crypto/preview-token';
import { allowlistRepo as defaultAllowlistRepo } from '@/lib/repo/allowlist.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { checkScope, type GuardsDeps } from '@/lib/engine/guards';
import { numberToMoney } from '@/lib/engine/snapshot';
import { isShopError } from '@/lib/shop/errors';

/** Koľko riadkov ide do potvrdenia. Šesť — mockup `nova-zlava.html`. */
export const PREVIEW_SAMPLE_SIZE = 6;

/**
 * Do tohto počtu produktov sa detaily čítajú zo SHOPU (D56/D57 — `POST
 * /api/batch` po 25). Nad tým je zdrojom `catalog_cache` (K7). Číslo je vedomý
 * kompromis: 100 produktov = 4 requesty, 10 000 by bolo 400.
 */
export const PREVIEW_SHOP_DETAIL_MAX = 100;

/** Veľkosť bloku pre `findFutureOverlaps()` — 10 000 položiek = 20 dotazov. */
export const PREVIEW_OVERLAP_CHUNK = 500;

/**
 * Koľko blokátorov viazaných na konkrétny produkt sa vypíše do detailu. Zvyšok
 * sa spočíta do jednej vety — 10 000 rovnakých hlášok nikto neprečíta a
 * blokovací účinok je aj tak binárny (stačí jeden).
 */
export const PREVIEW_MAX_ITEM_BLOCKERS = 20;

export interface PreviewTierInput {
  /** Poradie pásma v UI (A, B, C…). */
  ord: number;
  /** Ľudský názov pásma, napr. „0 predaných za 360 dní". */
  label: string;
  percent: DiscountPercent;
  /** Produkty pásma. Každý produkt sady patrí PRÁVE do jedného pásma. */
  productIds: number[];
}

export interface PreviewInput {
  /** Prihlásený user — `sub` preview tokenu (I3). */
  userId: number;
  kind: CampaignKind;
  productIds: number[];
  /**
   * Hlavičkové percento kampane = NAJVYŠŠIE percento pásiem (K3). Pri kampani
   * bez pásiem platí pre celú sadu.
   */
  percent: DiscountPercent;
  from: DateOnly;
  to: DateOnly;
  /** Pásma (K3). Bez nich má celá sada jedno percento. */
  tiers?: PreviewTierInput[];
  /** D30 — potvrdenie „naozaj 1 deň?". Bez neho je `from = to` blokátor. */
  oneDayAcknowledged?: boolean;
  /**
   * Rodičovská kampaň pri `kind = 'retry'` / `'extend'` (D15, D16, D19).
   * Z kontroly prekryvu (D28) sa VYLUČUJE — opakovanie zlyhaných zápisov tej
   * istej kampane nie je „iná budúca kampaň" a nesmie sa blokovať samo sebou.
   */
  parentCampaignId?: number;
}

export interface PreviewDeps {
  shopClient: Pick<ShopClient, 'batchGetProducts'>;
  allowlistRepo?: Pick<AllowlistRepo, 'areAllActive' | 'listActive'>;
  campaignsRepo?: Pick<CampaignsRepo, 'lastOwnWrite' | 'findFutureOverlaps'>;
  /** `getMany` je voliteľné — bez kľúča aj pri veľkej sade z neho vieme ceny. */
  catalogRepo?: (Pick<CatalogRepo, 'upsert'> & Partial<Pick<CatalogRepo, 'getMany'>>) | null;
  apiKeyMeta?: Pick<ApiKeyRepo, 'getMeta'>;
  previewTokens?: PreviewTokenServiceV3;
  guards?: GuardsDeps;
  now?: () => Date;
  timeZone?: string;
}

/** Jedna kolízia budúcich kampaní na jednom produkte (D28, U3). */
export interface PreviewConflict {
  productId: number;
  campaignId: number;
  campaignName: string;
  from: DateOnly;
  to: DateOnly;
  status: CampaignStatus;
}

/** Položka náhľadu s percentom svojho pásma (K3). */
export interface PreviewItemEx extends PreviewItem {
  percent: DiscountPercent;
  tierOrd: number;
  tierLabel: string;
}

/** Hlavička pásma do tabuľky „Pásma a okno platnosti". */
export interface PreviewTierSummary {
  ord: number;
  label: string;
  percent: DiscountPercent;
  /** Koľko produktov sady do pásma spadlo. */
  count: number;
}

/**
 * Výsledok dry-runu rozšírený o to, čo UI potrebuje, aby blokátor nebol slepou
 * uličkou. Je priraditeľný na `PreviewResult` (contracts §11), takže route ani
 * klienti nič nestrácajú.
 */
export interface PreviewResultEx extends PreviewResult {
  /** Pri veľkej sade len vzorka + problémové riadky, viď `itemsTruncated`. */
  items: PreviewItemEx[];
  /** 6 riadkov ROZLOŽENÝCH naprieč pásmami — to, čo sa ukáže v potvrdení. */
  sample: PreviewItemEx[];
  tiers: PreviewTierSummary[];
  /** Koľko produktov sada naozaj má (`items.length` môže byť menšie). */
  itemsTotal: number;
  itemsTruncated: boolean;
  /** Odkiaľ sú ceny: čerstvo zo shopu (D57) alebo zo zrkadla katalógu (K7). */
  priceSource: 'shop' | 'catalog' | 'none';
  /** `fetched_at` najstaršieho použitého riadku katalógu — „Dáta k …" (P7). */
  dataAsOf: string | null;
  /** Kolízie per produkt — pomenovanie konfliktu + „vyradiť zo sady" (D28). */
  conflicts: PreviewConflict[];
  /** Kedy expiruje kľúč, aby varovanie D8 vedelo povedať KEDY, nie len „skôr". */
  keyExpiresAt: string | null;
  /** `true` = kľúč chýba/expiroval; sada sa dá uložiť len ako koncept. */
  keyMissing: boolean;
}

export const KEY_MISSING_BLOCKER_CODE = 'key_missing';

const KEY_MISSING_MESSAGE =
  'API kľúč chýba alebo expiroval — bez neho appka nevie prečítať ceny zo shopu ani nič zapísať. Vlož nový kľúč v Nastaveniach; rozpracovanú kampaň si medzitým môžeš uložiť ako koncept.';

/* ────────────────────────────── pásma (K3) ──────────────────────────────── */

interface ResolvedTier {
  ord: number;
  label: string;
  percent: DiscountPercent;
}

interface ResolvedTiers {
  /** productId → pásmo. Prázdna mapa znamená, že rozdelenie neprešlo. */
  byProduct: Map<number, ResolvedTier>;
  summaries: PreviewTierSummary[];
  blockers: PreviewBlocker[];
}

/**
 * Priradí každému produktu jeho pásmo a overí, že rozdelenie dáva zmysel.
 * Fail-closed: každá nezrovnalosť je blokátor, nie tichá oprava — potvrdiť sa
 * nesmie dať sada, pri ktorej appka nevie, o koľko percent produkt zlacnie.
 */
function resolveTiers(input: PreviewInput): ResolvedTiers {
  const blockers: PreviewBlocker[] = [];
  const byProduct = new Map<number, ResolvedTier>();
  const inSet = new Set(input.productIds);

  if (input.tiers === undefined || input.tiers.length === 0) {
    const single: ResolvedTier = { ord: 1, label: '', percent: input.percent };
    for (const productId of input.productIds) byProduct.set(productId, single);
    return {
      byProduct,
      summaries: [{ ord: 1, label: '', percent: input.percent, count: byProduct.size }],
      blockers,
    };
  }

  const summaries: PreviewTierSummary[] = [];
  const sorted = [...input.tiers].sort((a, b) => a.ord - b.ord);

  for (const tier of sorted) {
    if (!Number.isInteger(tier.percent) || tier.percent < PERCENT_MIN || tier.percent > PERCENT_MAX) {
      blockers.push({
        code: 'tier_percent_invalid',
        message: `Pásmo „${tier.label}" má percento ${String(tier.percent)} — povolené je celé číslo ${PERCENT_MIN}–${PERCENT_MAX} (I9, D11).`,
      });
      continue;
    }
    const resolved: ResolvedTier = { ord: tier.ord, label: tier.label, percent: tier.percent };
    let count = 0;
    for (const productId of tier.productIds) {
      if (!inSet.has(productId)) {
        blockers.push({
          code: 'tier_product_outside_set',
          productId,
          message: `Pásmo „${tier.label}" obsahuje produkt, ktorý v sade nie je — sada a pásma sa rozišli.`,
        });
        continue;
      }
      if (byProduct.has(productId)) {
        blockers.push({
          code: 'tier_product_duplicate',
          productId,
          message: `Produkt patrí do dvoch pásiem naraz — appka by nevedela, o koľko percent má zlacnieť.`,
        });
        continue;
      }
      byProduct.set(productId, resolved);
      count += 1;
    }
    summaries.push({ ord: tier.ord, label: tier.label, percent: tier.percent, count });
  }

  const uncovered = input.productIds.filter((id) => !byProduct.has(id));
  if (uncovered.length > 0) {
    blockers.push({
      code: 'tier_product_uncovered',
      ...(uncovered[0] !== undefined ? { productId: uncovered[0] } : {}),
      message: `${uncovered.length === 1 ? 'Jeden produkt sady nepatrí' : `${uncovered.length} produktov sady nepatrí`} do žiadneho pásma — bez percenta sa potvrdiť nedá.`,
    });
  }

  // K3 — `campaigns.percent` je hlavička a znamená NAJVYŠŠIE percento pásiem.
  const highest = summaries.reduce((max, tier) => Math.max(max, tier.percent), 0);
  if (highest > 0 && highest !== input.percent) {
    blockers.push({
      code: 'tier_percent_header',
      message: `Zľava v hlavičke je ${input.percent} %, ale najvyššie pásmo má ${highest} % — zoznamy zliav by ukazovali iné číslo, než sa naozaj zapíše.`,
    });
  }

  return { byProduct, summaries, blockers };
}

/* ────────────────────────────── vzorka (6) ──────────────────────────────── */

interface SampleCandidate {
  productId: number;
  tierOrd: number;
  priceCents: number | null;
}

/**
 * Rozdelí `total` miest medzi pásma round-robinom: každé pásmo dostane jedno,
 * potom druhé… kým sú miesta alebo kandidáti. Pri dvoch pásmach a šiestich
 * miestach z toho vyjde 3 + 3, pri troch 2 + 2 + 2 — presne to, čo mockup
 * `nova-zlava.html` ukazuje, a nikdy „prvých 6 z jedného pásma".
 */
function allocateSlots(sizes: number[], total: number): number[] {
  const out = sizes.map(() => 0);
  let left = total;
  let progress = true;
  while (left > 0 && progress) {
    progress = false;
    for (let i = 0; i < sizes.length && left > 0; i += 1) {
      if ((out[i] ?? 0) < (sizes[i] ?? 0)) {
        out[i] = (out[i] ?? 0) + 1;
        left -= 1;
        progress = true;
      }
    }
  }
  return out;
}

/** Rovnomerne rozložené indexy — nie prvých `count`, ale prierez rozsahom. */
function pickSpread<T>(list: readonly T[], count: number): T[] {
  if (count >= list.length) return [...list];
  const out: T[] = [];
  for (let k = 0; k < count; k += 1) {
    const item = list[Math.floor((k * list.length) / count)];
    if (item !== undefined) out.push(item);
  }
  return out;
}

/**
 * Vyberie `size` produktov rozložených naprieč pásmami. V rámci pásma sú
 * kandidáti zoradení podľa ceny zostupne (drahý → lacný) a berie sa prierez,
 * aby vzorka nebola len z jedného konca cenníka. Poradie je deterministické —
 * ten istý vstup dá tú istú vzorku, takže potvrdenie sa nemení pod rukami.
 */
export function pickSample(
  candidates: readonly SampleCandidate[],
  size: number = PREVIEW_SAMPLE_SIZE,
): number[] {
  const byTier = new Map<number, SampleCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byTier.get(candidate.tierOrd);
    if (bucket === undefined) byTier.set(candidate.tierOrd, [candidate]);
    else bucket.push(candidate);
  }

  const ords = [...byTier.keys()].sort((a, b) => a - b);
  for (const ord of ords) {
    const bucket = byTier.get(ord);
    if (bucket === undefined) continue;
    bucket.sort((a, b) => {
      const priceA = a.priceCents === null ? -1 : a.priceCents;
      const priceB = b.priceCents === null ? -1 : b.priceCents;
      if (priceA !== priceB) return priceB - priceA;
      return a.productId - b.productId;
    });
  }

  const slots = allocateSlots(
    ords.map((ord) => byTier.get(ord)?.length ?? 0),
    size,
  );

  const picked: number[] = [];
  ords.forEach((ord, index) => {
    const bucket = byTier.get(ord) ?? [];
    for (const candidate of pickSpread(bucket, slots[index] ?? 0)) {
      picked.push(candidate.productId);
    }
  });
  return picked;
}

/* ───────────────────────────────── dry-run ──────────────────────────────── */

interface RawRow {
  productId: number;
  tier: ResolvedTier;
  name: string | null;
  price: MoneyString | null;
  hasAttributes: boolean;
  /** Hláška, keď sa produkt nedal prečítať — riadok potom ide do `items` vždy. */
  problem: string | null;
}

const priceCentsOf = (price: MoneyString | null): number | null => {
  if (price === null || !isMoneyString(price)) return null;
  try {
    return moneyToCents(price);
  } catch {
    return null;
  }
};

/**
 * Dry-run: NIKDY nič nezapisuje — všetky volania shopu sú čítacie
 * (`batchGetProducts`, D56/D57).
 */
export async function buildPreview(
  input: PreviewInput,
  deps: PreviewDeps,
  ctx: ShopCtx,
): Promise<PreviewResultEx> {
  const allowlistRepo = deps.allowlistRepo ?? defaultAllowlistRepo;
  const campaignsRepo = deps.campaignsRepo ?? defaultCampaignsRepo;
  const catalogRepo = deps.catalogRepo === undefined ? defaultCatalogRepo : deps.catalogRepo;
  const previewTokens = deps.previewTokens ?? defaultPreviewTokens;
  const now = deps.now ?? (() => new Date());
  const timeZone = deps.timeZone ?? LOGIC_TIME_ZONE;
  const today = todayInZone(now(), timeZone);

  const blockers: PreviewBlocker[] = [];
  const sortedIds = [...input.productIds].sort((a, b) => a - b);

  /* 1. Lokálna validácia parametrov (I9, D29, D30).
   *
   * „Naozaj 1 deň?" (D30) sa TU zámerne NEPOČÍTA medzi blokátory. Je to
   * potvrdenie človeka, nie technická prekážka — a blokátor bráni vydaniu
   * tokenu, takže by sa jednodňová zľava nedala vytvoriť vôbec: používateľ by
   * ju musel potvrdiť skôr, než by ju vôbec uvidel. Náhľad ju hlási ako
   * upozornenie (`warnings.oneDayWindow`) a tvrdou podmienkou zostáva až
   * `POST /api/campaigns`, kde bez `acknowledgements.oneDay` letí 400 a token
   * sa NESPÁLI (to je celé D30). */
  for (const issueItem of validateCampaignWindow({
    from: input.from,
    to: input.to,
    percent: input.percent,
    today,
    // Náhľad sa na jednodňové okno nepýta — preto vždy „potvrdené".
    oneDayAcknowledged: true,
  })) {
    blockers.push({ code: issueItem.code, message: issueItem.message });
  }

  /* 2. Pásma (K3) — percento na položku sa rozhoduje TU, pri potvrdení. */
  const tiers = resolveTiers(input);
  blockers.push(...tiers.blockers);

  /* 3. Rozsah fail-closed (I2 → K1). */
  const allowCheck = await checkScope(input.productIds, {
    allowlistRepo,
    ...(deps.guards ?? {}),
  });
  if (!allowCheck.ok) {
    blockers.push({ code: allowCheck.code, message: allowCheck.message });
  }

  /* 4. Prekryv budúcich kampaní na produkte (D28) — blokuje pri vytváraní.
   *    Dotaz ide po blokoch; per-produkt sa rozpisuje LEN blok, v ktorom sa
   *    naozaj niečo našlo. Pri čistej sade 10 000 produktov je to 20 dotazov
   *    namiesto 10 000, pri kolízii sa presnosť („KTORÝ produkt s KTOROU
   *    kampaňou", U3) nestráca. Rodič opakovania/predĺženia neblokuje sám seba
   *    (D15, D16, D19) — bez tejto výnimky bol dry-run „Zopakovať zlyhané"
   *    VŽDY zablokovaný. */
  const conflicts: PreviewConflict[] = [];
  if (allowCheck.ok) {
    const relevant = (campaign: CampaignRecord): boolean => {
      if (campaign.id === input.parentCampaignId) return false;
      // D28: `kind='overwrite'` je EXPLICITNÝ prepis už ZAPÍSANEJ zľavy. Okno
      // dobehnutej kampane (`done`/`partial`) nie je „budúca kampaň" — je to
      // presne to, čo sa vedome prepisuje. Prekryv s kampaňou, ktorá ešte len
      // zapíše (`scheduled`/`needs_key`/`missed`) alebo práve zapisuje
      // (`running`), blokuje aj prepis.
      if (
        input.kind === 'overwrite' &&
        (campaign.status === 'done' || campaign.status === 'partial')
      ) {
        return false;
      }
      return true;
    };

    for (let offset = 0; offset < sortedIds.length; offset += PREVIEW_OVERLAP_CHUNK) {
      const chunk = sortedIds.slice(offset, offset + PREVIEW_OVERLAP_CHUNK);
      const found = (await campaignsRepo.findFutureOverlaps(chunk, input.from, input.to)).filter(
        relevant,
      );
      if (found.length === 0) continue;
      for (const productId of chunk) {
        const perProduct = await campaignsRepo.findFutureOverlaps(
          [productId],
          input.from,
          input.to,
        );
        for (const campaign of perProduct.filter(relevant)) {
          conflicts.push({
            productId,
            campaignId: campaign.id,
            campaignName: campaign.name,
            from: campaign.dateFrom,
            to: campaign.dateTo,
            status: campaign.status,
          });
        }
      }
    }

    for (const conflict of conflicts) {
      blockers.push({
        code: 'future_overlap',
        productId: conflict.productId,
        message: `Produkt už má naplánovanú kampaň „${conflict.campaignName}" (#${conflict.campaignId}) na ${formatDateOnlySk(conflict.from)} – ${formatDateOnlySk(conflict.to)}. Dve naplánované zľavy na jednom produkte appka nepovolí — nedá sa zistiť, ktorá v shope vyhrá. Vyraď produkt zo sady, zmeň okno alebo zruš pôvodnú kampaň.`,
      });
    }
  }

  /* 5. Kľúč (D10, decision 15): bez platného kľúča sa shop nevolá vôbec.
   *    Hláška menuje KĽÚČ — nie „shop je nedostupný", ktoré zavádzalo. */
  let keyPresent = true;
  let keyExpiresAtDate: Date | null = null;
  if (deps.apiKeyMeta) {
    try {
      const meta = await deps.apiKeyMeta.getMeta();
      keyExpiresAtDate = meta.expiresAt;
      keyPresent =
        meta.present && (meta.expiresAt === null || meta.expiresAt.getTime() > now().getTime());
    } catch {
      keyPresent = false; // fail-closed
    }
  }
  const keyMissing = !keyPresent;
  if (keyMissing) {
    blockers.push({ code: KEY_MISSING_BLOCKER_CODE, message: KEY_MISSING_MESSAGE });
  }

  /* 6. Zdroj cien. Malá sada = čerstvo zo shopu (D57). Veľká sada = zrkadlo
   *    katalógu (K7): 10 000 produktov po 25 na batch by bolo 400 requestov na
   *    jeden náhľad, a katalóg je presne na to, aby to nebolo treba. */
  const useShop = allowCheck.ok && !keyMissing && sortedIds.length <= PREVIEW_SHOP_DETAIL_MAX;
  const useCatalog = allowCheck.ok && !useShop && Boolean(catalogRepo?.getMany);

  let details = new Map<number, ProductDetail | import('@/contracts').ShopError>();
  let cached = new Map<number, import('@/contracts').CatalogCacheRecord>();
  let priceSource: PreviewResultEx['priceSource'] = 'none';
  let dataAsOf: Date | null = null;

  if (useShop) {
    priceSource = 'shop';
    try {
      const fetched = await deps.shopClient.batchGetProducts(sortedIds, ctx);
      details = fetched.results;
    } catch {
      blockers.push({
        code: 'shop_unreachable',
        message:
          'Shop sa nepodarilo prečítať — náhľad sa nedá zostaviť a nič sa nezapíše. Skús to znova o chvíľu.',
      });
    }
  } else if (useCatalog && catalogRepo?.getMany) {
    priceSource = 'catalog';
    try {
      cached = await catalogRepo.getMany(sortedIds);
      for (const record of cached.values()) {
        if (dataAsOf === null || record.fetchedAt.getTime() < dataAsOf.getTime()) {
          dataAsOf = record.fetchedAt;
        }
      }
    } catch {
      cached = new Map();
    }
  }

  /* 7. Surové riadky — bez jediného dotazu na kampane. Dotazy na
   *    `lastOwnWrite()` prídu až pre riadky, ktoré sa naozaj zobrazia. */
  const fallbackTier: ResolvedTier = { ord: 1, label: '', percent: input.percent };
  const rows: RawRow[] = [];
  const pricesAtPreview: Record<string, MoneyString> = {};
  const percents: Record<string, DiscountPercent> = {};
  const hasAttributesIds: number[] = [];

  /**
   * Blokátor viazaný na jeden produkt. Pri 10 000 položkách by prázdny katalóg
   * znamenal 10 000 hlášok v jednej odpovedi — nikto ich neprečíta a JSON by
   * mal megabajty. Do detailu ide vzorka, zvyšok sa spočíta. Blokovací účinok
   * sa tým NESTRÁCA: stačí jediný blokátor a token sa nevydá.
   */
  let itemBlockerCount = 0;
  let suppressedItemBlockers = 0;
  const pushItemBlocker = (blocker: PreviewBlocker): void => {
    if (itemBlockerCount < PREVIEW_MAX_ITEM_BLOCKERS) {
      blockers.push(blocker);
      itemBlockerCount += 1;
      return;
    }
    suppressedItemBlockers += 1;
  };

  for (const productId of sortedIds) {
    const tier = tiers.byProduct.get(productId) ?? fallbackTier;
    percents[String(productId)] = tier.percent;

    if (keyMissing || priceSource === 'catalog') {
      const fromCache = cached.get(productId) ?? null;
      rows.push({
        productId,
        tier,
        name: fromCache?.name ?? null,
        price: fromCache?.price ?? null,
        hasAttributes: fromCache?.hasAttributes ?? false,
        problem: keyMissing
          ? fromCache
            ? 'Cena je z poslednej známej evidencie appky, nie zo shopu — bez kľúča sa nedá overiť.'
            : 'Bez kľúča appka o tomto produkte nemá ani uloženú cenu.'
          : fromCache
            ? null
            : 'Produkt nie je v zrkadle katalógu — spusti synchronizáciu katalógu.',
      });
      if (!keyMissing && fromCache?.price != null) {
        pricesAtPreview[String(productId)] = fromCache.price;
        if (fromCache.hasAttributes) hasAttributesIds.push(productId);
      }
      if (!keyMissing && fromCache === null) {
        pushItemBlocker({
          code: 'product_not_in_catalog',
          productId,
          message: `Produkt ${productId} nie je v zrkadle katalógu — sada sa nedá potvrdiť, kým katalóg nedobehne (K1 bod 2).`,
        });
      }
      continue;
    }

    const detail = details.get(productId);
    if (detail === undefined || isShopError(detail)) {
      const notFound = detail !== undefined && detail.kind === 'not_found';
      // Keď rozsah (K1) neprešiel, shop sa vôbec nevolal — vyrábať k tomu ešte
      // hlášku „produkt sa nedá prečítať" na každý produkt by len zahmlievalo
      // skutočný dôvod. Blokátor rozsahu je už v zozname.
      if (allowCheck.ok) {
        pushItemBlocker({
          code: notFound ? 'product_not_found' : 'product_unreadable',
          message: notFound
            ? `Produkt ${productId} sa v shope nenašiel — sada sa nedá potvrdiť.`
            : `Produkt ${productId} sa nepodarilo prečítať zo shopu — sada sa nedá potvrdiť.`,
          productId,
        });
      }
      rows.push({
        productId,
        tier,
        name: null,
        price: null,
        hasAttributes: false,
        problem: notFound ? 'Produkt v shope neexistuje.' : 'Produkt sa nedá prečítať.',
      });
      continue;
    }

    const price = numberToMoney(detail.price);
    pricesAtPreview[String(productId)] = price;
    if (detail.has_attributes) hasAttributesIds.push(productId);
    rows.push({
      productId,
      tier,
      name: detail.name,
      price,
      hasAttributes: detail.has_attributes,
      problem: null,
    });
  }

  if (suppressedItemBlockers > 0) {
    blockers.push({
      code: 'more_blocked_products',
      message: `Rovnaký problém má ešte ďalších ${suppressedItemBlockers} produktov — v detaile je prvých ${PREVIEW_MAX_ITEM_BLOCKERS}.`,
    });
  }

  /* 8. Vzorka — 6 riadkov ROZLOŽENÝCH naprieč pásmami (nie prvých 6). */
  const sampleIds = new Set(
    pickSample(
      rows
        .filter((row) => row.problem === null)
        .map((row) => ({
          productId: row.productId,
          tierOrd: row.tier.ord,
          priceCents: priceCentsOf(row.price),
        })),
      PREVIEW_SAMPLE_SIZE,
    ),
  );

  /* 9. Ktoré riadky sa vrátia. Malá sada celá (UI ju vie ukázať), veľká len
   *    vzorka + problémové riadky — 10 000 riadkov v JSON nikto neprečíta a
   *    položky kampane sa aj tak skladajú z tokenu, nie z tohto zoznamu. */
  const truncated = rows.length > PREVIEW_SHOP_DETAIL_MAX;
  const visible = truncated
    ? rows.filter((row) => sampleIds.has(row.productId) || row.problem !== null)
    : rows;

  /* 10. `lastOwnWrite` (I11) len pre zobrazené riadky. */
  const lastWrites = new Map<number, LastOwnWrite | null>();
  for (const row of visible) {
    lastWrites.set(row.productId, await campaignsRepo.lastOwnWrite(row.productId));
  }

  const overwriteIds: number[] = [];
  const items: PreviewItemEx[] = visible.map((row) => {
    const lastOwnWrite = lastWrites.get(row.productId) ?? null;
    const warnings: string[] = [];
    if (row.problem !== null) warnings.push(row.problem);
    if (row.hasAttributes) {
      warnings.push(
        'Produkt má varianty — zľavu na ne uplatní logika shopu, výsledné ceny variantov appka negarantuje.',
      );
    }
    if (lastOwnWrite !== null && isSameOrBefore(input.from, lastOwnWrite.to)) {
      overwriteIds.push(row.productId);
      warnings.push(
        `Podľa vlastného zápisu z ${formatDateOnlySk(lastOwnWrite.at.toISOString().slice(0, 10))} tu zľava beží alebo je naplánovaná — nový zápis ju prepíše. Shop môže mať iný stav.`,
      );
    }
    // Disclaimer o zaokrúhlení sa do `warnings` NEDUPLIKUJE — drží ho `PriceHint`
    // pri každej vypočítanej cene (D4 zostáva splnené).
    return {
      productId: row.productId,
      name: row.name,
      price: row.price,
      discountedPrice: row.price === null ? null : discountedPrice(row.price, row.tier.percent),
      hasAttributes: row.hasAttributes,
      lastOwnWrite,
      reductionUnverifiable: true,
      warnings,
      percent: row.tier.percent,
      tierOrd: row.tier.ord,
      tierLabel: row.tier.label,
    };
  });

  /* 11. D57 — obnov cache name/price, ale LEN pri čítaní zo shopu a len pri
   *     malej sade. Pri veľkej sade sú dáta z katalógu a 10 000 upsertov v
   *     dry-rune by bol zápis, nie náhľad. */
  if (priceSource === 'shop' && catalogRepo) {
    for (const row of rows) {
      if (row.price === null) continue;
      try {
        await catalogRepo.upsert({
          productId: row.productId,
          name: row.name,
          price: row.price,
          hasAttributes: row.hasAttributes,
          source: 'batch',
          raw: details.get(row.productId) ?? null,
        });
      } catch {
        // cache je best-effort — jej zlyhanie dry-run nezhodí
      }
    }
  }

  /* 12. Varovania (D8, D30, D28, D60). Meta kľúča sa už načítalo v kroku 5. */
  const keyExpiresBeforeStart = deps.apiKeyMeta
    ? keyMissing ||
      (keyExpiresAtDate !== null &&
        keyExpiresAtDate.getTime() < startOfDayUtc(input.from, timeZone).getTime())
    : false;

  /* 13. Token len pre čistú sadu (I3, O2, K4). Nesie percento aj cenu KAŽDEJ
   *     položky — presne tie tri stĺpce, z ktorých executor hash prepočíta. */
  let previewToken = '';
  if (blockers.length === 0) {
    const issued = await previewTokens.issue({
      sub: input.userId,
      kind: input.kind,
      productIds: sortedIds,
      percent: input.percent,
      from: input.from,
      to: input.to,
      pricesAtPreview,
      ...(input.tiers !== undefined && input.tiers.length > 0 ? { percents } : {}),
    });
    previewToken = issued.token;
  }

  return {
    previewToken,
    items,
    sample: items.filter((item) => sampleIds.has(item.productId)),
    tiers: tiers.summaries,
    itemsTotal: rows.length,
    itemsTruncated: truncated,
    priceSource,
    dataAsOf: dataAsOf === null ? null : dataAsOf.toISOString(),
    warnings: {
      keyExpiresBeforeStart,
      oneDayWindow: input.from === input.to,
      overwrite: overwriteIds,
      hasAttributes: hasAttributesIds,
    },
    blockers,
    conflicts,
    keyExpiresAt: keyExpiresAtDate === null ? null : keyExpiresAtDate.toISOString(),
    keyMissing,
  };
}
