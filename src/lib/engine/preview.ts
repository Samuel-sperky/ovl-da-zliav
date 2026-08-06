/**
 * Aura Zľavy — DRY-RUN NÁHĽAD (BUILD-SPEC §9, D3, D4, D8, D28, D30, D39c, D60, I3).
 *
 * Zostaví diff sadu pre potvrdenie: čerstvé `name`/`price` zo shopu (D57),
 * orientačnú zľavnenú cenu (D4), posledný VLASTNÝ zápis (I11), varovania
 * a blokátory. Keď nie je žiadny blokátor, vydá jednorazový `previewToken`
 * (O2) s `pricesAtPreview` per produkt (D39c) — bez neho zápis neprebehne (I3).
 *
 * Blokátory sú fail-closed: kým existuje čo len jeden, token sa NEVYDÁ
 * (`previewToken` je prázdny string) a sada sa nedá potvrdiť.
 *
 * Redizajn (plán §2 body 11, 15 · U2, U3):
 *  - chýbajúci/expirovaný kľúč je VLASTNÝ blokátor `key_missing`, nie
 *    `shop_unreachable`; shop sa v tom prípade nevolá vôbec a položky sa
 *    poskladajú z `catalog_cache`, aby sa dal uložiť koncept (D21, decision 15),
 *  - prekryv (D28) vracia STRUKTUROVANÝ zoznam kolízií (kampaň, okno, produkt),
 *    takže UI vie pomenovať konflikt a ponúknuť „vyradiť kolidujúce zo sady";
 *    predtým sa `overlapIds` zahodilo cez `void`,
 *  - `item.warnings` už neopakuje disclaimer o zaokrúhlení (drží ho `PriceHint`
 *    pri každej cene, D4 zostáva splnené) a nenesie kódy rozhodnutí (plán §2/10).
 *
 * Vlastník: A9 (úpravy B3).
 */
import type {
  AllowlistRepo,
  ApiKeyRepo,
  CampaignKind,
  CampaignStatus,
  CampaignsRepo,
  CatalogRepo,
  DateOnly,
  DiscountPercent,
  MoneyString,
  PreviewBlocker,
  PreviewItem,
  PreviewResult,
  PreviewTokenService,
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
import { discountedPrice } from '@/lib/domain/pricing';
import { previewTokenService as defaultPreviewTokens } from '@/lib/crypto/preview-token';
import { allowlistRepo as defaultAllowlistRepo } from '@/lib/repo/allowlist.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { checkAllowlist, type GuardsDeps } from '@/lib/engine/guards';
import { numberToMoney } from '@/lib/engine/snapshot';
import { isShopError } from '@/lib/shop/errors';

export interface PreviewInput {
  /** Prihlásený user — `sub` preview tokenu (I3). */
  userId: number;
  kind: CampaignKind;
  productIds: number[];
  percent: DiscountPercent;
  from: DateOnly;
  to: DateOnly;
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
  /** `getMany` je voliteľné — bez kľúča z neho vieme aspoň názvy a ceny. */
  catalogRepo?: (Pick<CatalogRepo, 'upsert'> & Partial<Pick<CatalogRepo, 'getMany'>>) | null;
  apiKeyMeta?: Pick<ApiKeyRepo, 'getMeta'>;
  previewTokens?: PreviewTokenService;
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

/**
 * Výsledok dry-runu rozšírený o to, čo UI potrebuje, aby blokátor nebol slepou
 * uličkou. Je priraditeľný na `PreviewResult` (contracts §11), takže route ani
 * klienti nič nestrácajú.
 */
export interface PreviewResultEx extends PreviewResult {
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

  /* 1. Lokálna validácia parametrov (I9, D29, D30). */
  for (const issueItem of validateCampaignWindow({
    from: input.from,
    to: input.to,
    percent: input.percent,
    today,
    ...(input.oneDayAcknowledged !== undefined
      ? { oneDayAcknowledged: input.oneDayAcknowledged }
      : {}),
  })) {
    blockers.push({ code: issueItem.code, message: issueItem.message });
  }

  /* 2. Allowlist fail-closed (I2). */
  const allowCheck = await checkAllowlist(input.productIds, {
    allowlistRepo,
    ...(deps.guards ?? {}),
  });
  if (!allowCheck.ok) {
    blockers.push({ code: allowCheck.code, message: allowCheck.message });
  }

  /* 3. Prekryv budúcich kampaní na produkte (D28) — blokuje pri vytváraní.
   *    Kolízie sa NEZAHADZUJÚ: každá dostane vlastný blokátor s `productId`
   *    a štruktúrovaný záznam v `conflicts` (meno kampane, okno, stav), aby
   *    UI vedelo povedať KTORÁ kampaň a ponúknuť cestu von (U3). */
  const conflicts: PreviewConflict[] = [];
  if (allowCheck.ok) {
    // Dotaz ide per produkt (max 10, I2), aby sa dalo povedať KTORÝ produkt
    // koliduje s KTOROU kampaňou. Rodič opakovania/predĺženia neblokuje sám
    // seba (D15, D16, D19) — bez tejto výnimky bol dry-run „Zopakovať zlyhané"
    // VŽDY zablokovaný (rodič má rovnaké produkty aj rovnaké okno).
    for (const productId of [...input.productIds].sort((a, b) => a - b)) {
      const found = await campaignsRepo.findFutureOverlaps([productId], input.from, input.to);
      for (const campaign of found) {
        if (campaign.id === input.parentCampaignId) continue;
        // D28: `kind='overwrite'` je EXPLICITNÝ prepis už ZAPÍSANEJ zľavy.
        // Okno dobehnutej kampane (`done`/`partial`) nie je „budúca kampaň" —
        // je to presne to, čo sa vedome prepisuje (diff starý → nový nesú
        // warnings `overwrite` nižšie). Bez tejto výnimky bol legitímny
        // prepis VŽDY zablokovaný, keď UI neposlalo `parentCampaignId`.
        // Prekryv s kampaňou, ktorá ešte len zapíše (`scheduled`/`needs_key`/
        // `missed`) alebo práve zapisuje (`running`), blokuje aj prepis.
        if (
          input.kind === 'overwrite' &&
          (campaign.status === 'done' || campaign.status === 'partial')
        ) {
          continue;
        }
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

    for (const conflict of conflicts) {
      blockers.push({
        code: 'future_overlap',
        productId: conflict.productId,
        message: `Produkt už má naplánovanú kampaň „${conflict.campaignName}" (#${conflict.campaignId}) na ${formatDateOnlySk(conflict.from)} – ${formatDateOnlySk(conflict.to)}. Dve naplánované zľavy na jednom produkte appka nepovolí — nedá sa zistiť, ktorá v shope vyhrá. Vyraď produkt zo sady, zmeň okno alebo zruš pôvodnú kampaň.`,
      });
    }
  }

  /* 4. Kľúč (D10, decision 15): bez platného kľúča sa shop nevolá vôbec.
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

  /* 5. Čerstvé detaily zo shopu (D57) + položky náhľadu. */
  const items: PreviewItem[] = [];
  const pricesAtPreview: Record<string, MoneyString> = {};
  const hasAttributesIds: number[] = [];
  const overwriteIds: number[] = [];

  let details = new Map<number, ProductDetail | import('@/contracts').ShopError>();
  let cached = new Map<number, import('@/contracts').CatalogCacheRecord>();
  if (allowCheck.ok && !keyMissing) {
    try {
      const fetched = await deps.shopClient.batchGetProducts(input.productIds, ctx);
      details = fetched.results;
    } catch {
      blockers.push({
        code: 'shop_unreachable',
        message:
          'Shop sa nepodarilo prečítať — náhľad sa nedá zostaviť a nič sa nezapíše. Skús to znova o chvíľu.',
      });
    }
  } else if (allowCheck.ok && keyMissing && catalogRepo?.getMany) {
    // Bez kľúča ukážeme aspoň poslednú známu cenu z cache — nie je to stav
    // shopu, len naša evidencia (I11), a token sa aj tak nevydá.
    try {
      cached = await catalogRepo.getMany(input.productIds);
    } catch {
      cached = new Map();
    }
  }

  for (const productId of [...input.productIds].sort((a, b) => a - b)) {
    const detail = details.get(productId);
    const lastOwnWrite = await campaignsRepo.lastOwnWrite(productId);
    const warnings: string[] = [];

    if (keyMissing) {
      // Bez kľúča nie je čo čítať zo shopu — položka nesie cache, nie pravdu.
      const fromCache = cached.get(productId) ?? null;
      items.push({
        productId,
        name: fromCache?.name ?? null,
        price: fromCache?.price ?? null,
        discountedPrice:
          fromCache?.price != null ? discountedPrice(fromCache.price, input.percent) : null,
        hasAttributes: fromCache?.hasAttributes ?? false,
        lastOwnWrite,
        reductionUnverifiable: true,
        warnings: [
          fromCache
            ? 'Cena je z poslednej známej evidencie appky, nie zo shopu — bez kľúča sa nedá overiť.'
            : 'Bez kľúča appka o tomto produkte nemá ani uloženú cenu.',
        ],
      });
      continue;
    }

    if (detail === undefined || isShopError(detail)) {
      const notFound = detail !== undefined && detail.kind === 'not_found';
      blockers.push({
        code: notFound ? 'product_not_found' : 'product_unreadable',
        message: notFound
          ? `Produkt ${productId} sa v shope nenašiel — sada sa nedá potvrdiť.`
          : `Produkt ${productId} sa nepodarilo prečítať zo shopu — sada sa nedá potvrdiť.`,
        productId,
      });
      items.push({
        productId,
        name: null,
        price: null,
        discountedPrice: null,
        hasAttributes: false,
        lastOwnWrite,
        reductionUnverifiable: true,
        warnings: [notFound ? 'Produkt v shope neexistuje.' : 'Produkt sa nedá prečítať.'],
      });
      continue;
    }

    const price = numberToMoney(detail.price);
    pricesAtPreview[String(productId)] = price;

    if (detail.has_attributes) {
      hasAttributesIds.push(productId);
      warnings.push(
        'Produkt má varianty — zľavu na ne uplatní logika shopu, výsledné ceny variantov appka negarantuje.',
      );
    }
    if (lastOwnWrite !== null && isSameOrBefore(input.from, lastOwnWrite.to)) {
      overwriteIds.push(productId);
      warnings.push(
        `Podľa vlastného zápisu z ${formatDateOnlySk(lastOwnWrite.at.toISOString().slice(0, 10))} tu zľava beží alebo je naplánovaná — nový zápis ju prepíše. Shop môže mať iný stav.`,
      );
    }
    // Disclaimer o zaokrúhlení sa do `warnings` NEDUPLIKUJE — drží ho `PriceHint`
    // pri každej vypočítanej cene (D4 zostáva splnené, plán §2 bod 8).

    items.push({
      productId,
      name: detail.name,
      price,
      discountedPrice: discountedPrice(price, input.percent),
      hasAttributes: detail.has_attributes,
      lastOwnWrite,
      reductionUnverifiable: true,
      warnings,
    });

    // D57 — obnov cache name/price pri otvorení náhľadu.
    if (catalogRepo) {
      try {
        await catalogRepo.upsert({
          productId,
          name: detail.name,
          price,
          hasAttributes: detail.has_attributes,
          source: 'batch',
          raw: detail,
        });
      } catch {
        // cache je best-effort — jej zlyhanie dry-run nezhodí
      }
    }
  }

  /* 6. Varovania (D8, D30, D28, D60). Meta kľúča sa už načítalo v kroku 4. */
  const keyExpiresBeforeStart = deps.apiKeyMeta
    ? keyMissing ||
      (keyExpiresAtDate !== null &&
        keyExpiresAtDate.getTime() < startOfDayUtc(input.from, timeZone).getTime())
    : false;

  /* 7. Token len pre čistú sadu (I3, O2). */
  let previewToken = '';
  if (blockers.length === 0) {
    const issued = await previewTokens.issue({
      sub: input.userId,
      kind: input.kind,
      productIds: [...input.productIds].sort((a, b) => a - b),
      percent: input.percent,
      from: input.from,
      to: input.to,
      pricesAtPreview,
    });
    previewToken = issued.token;
  }

  return {
    previewToken,
    items,
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
