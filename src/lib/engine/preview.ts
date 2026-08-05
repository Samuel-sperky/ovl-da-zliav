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
 * Vlastník: A9.
 */
import type {
  AllowlistRepo,
  ApiKeyRepo,
  CampaignKind,
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
  isSameOrBefore,
  startOfDayUtc,
  todayInZone,
  LOGIC_TIME_ZONE,
} from '@/lib/domain/dates';
import { validateCampaignWindow } from '@/lib/domain/campaign-rules';
import { discountedPrice, DISCOUNTED_PRICE_DISCLAIMER_SK } from '@/lib/domain/pricing';
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
  catalogRepo?: Pick<CatalogRepo, 'upsert'> | null;
  apiKeyMeta?: Pick<ApiKeyRepo, 'getMeta'>;
  previewTokens?: PreviewTokenService;
  guards?: GuardsDeps;
  now?: () => Date;
  timeZone?: string;
}

/**
 * Dry-run: NIKDY nič nezapisuje — všetky volania shopu sú čítacie
 * (`batchGetProducts`, D56/D57).
 */
export async function buildPreview(
  input: PreviewInput,
  deps: PreviewDeps,
  ctx: ShopCtx,
): Promise<PreviewResult> {
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

  /* 3. Prekryv budúcich kampaní na produkte (D28) — blokuje pri vytváraní. */
  let overlapIds: number[] = [];
  if (allowCheck.ok) {
    const found = await campaignsRepo.findFutureOverlaps(input.productIds, input.from, input.to);
    // Rodič opakovania/predĺženia neblokuje sám seba (D15, D16, D19). Bez tejto
    // výnimky bol dry-run „Zopakovať zlyhané" VŽDY zablokovaný `future_overlap`
    // (rodič má rovnaké produkty aj rovnaké okno a stav `partial` je v dotaze).
    const overlaps =
      input.parentCampaignId === undefined
        ? found
        : found.filter((c) => c.id !== input.parentCampaignId);
    overlapIds = [...new Set(overlaps.flatMap((c) => (c.id > 0 ? [c.id] : [])))];
    if (overlaps.length > 0) {
      blockers.push({
        code: 'future_overlap',
        message:
          'Na produkte už existuje iná budúca kampaň s prekrývajúcim sa oknom — prekryv dvoch budúcich kampaní je blokovaný (D28).',
      });
    }
  }
  void overlapIds;

  /* 4. Čerstvé detaily zo shopu (D57) + položky náhľadu. */
  const items: PreviewItem[] = [];
  const pricesAtPreview: Record<string, MoneyString> = {};
  const hasAttributesIds: number[] = [];
  const overwriteIds: number[] = [];

  let details = new Map<number, ProductDetail | import('@/contracts').ShopError>();
  if (allowCheck.ok) {
    try {
      const fetched = await deps.shopClient.batchGetProducts(input.productIds, ctx);
      details = fetched.results;
    } catch {
      blockers.push({
        code: 'shop_unreachable',
        message: 'Shop sa nepodarilo prečítať — dry-run sa nedá zostaviť (fail-closed).',
      });
    }
  }

  for (const productId of [...input.productIds].sort((a, b) => a - b)) {
    const detail = details.get(productId);
    const lastOwnWrite = await campaignsRepo.lastOwnWrite(productId);
    const warnings: string[] = [];

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
        'Produkt má varianty — zľava sa v shope uplatní podľa jeho pravidiel pre varianty (D60).',
      );
    }
    if (lastOwnWrite !== null && isSameOrBefore(input.from, lastOwnWrite.to)) {
      overwriteIds.push(productId);
      warnings.push(
        `Podľa vlastného zápisu z ${lastOwnWrite.at.toISOString().slice(0, 10)} tu zľava beží alebo je naplánovaná — nový zápis ju prepíše (D28, I11).`,
      );
    }
    warnings.push(DISCOUNTED_PRICE_DISCLAIMER_SK);

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

  /* 5. Varovania (D8, D30, D28, D60). */
  let keyExpiresBeforeStart = false;
  if (deps.apiKeyMeta) {
    try {
      const meta = await deps.apiKeyMeta.getMeta();
      if (meta.present && meta.expiresAt !== null) {
        keyExpiresBeforeStart = meta.expiresAt.getTime() < startOfDayUtc(input.from, timeZone).getTime();
      } else if (!meta.present) {
        keyExpiresBeforeStart = true;
      }
    } catch {
      keyExpiresBeforeStart = true; // fail-closed varovanie (D8)
    }
  }

  /* 6. Token len pre čistú sadu (I3, O2). */
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
  };
}
