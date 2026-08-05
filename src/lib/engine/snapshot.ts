/**
 * Aura Zľavy — PRE-WRITE SNAPSHOT (BUILD-SPEC §9, D48, D49, D39c).
 *
 * Tesne pred KAŽDÝM zápisom sa MUSÍ zavolať `GET /api/products/get` (D48) —
 * povinnosť platí aj po odchýlke D39c. Snapshot nesie:
 *   - `name`, `priceAtWrite`, `hasAttributes` zo shopu,
 *   - `lastOwnWrite` z vlastnej DB (I11 — nikdy nie pravda o shope),
 *   - `reductionUnverifiable: true` (backlog B1),
 *   - `priceAtPreview` + `priceMismatch` (D39c — nezhoda zápis NEZASTAVÍ,
 *     ale nesmie sa stratiť).
 *
 * `not_found` NIE JE chyba dávky: blokuje len daný produkt (D49).
 *
 * Vlastník: A9.
 */
import type {
  LastOwnWrite,
  MoneyString,
  PreWriteSnapshot,
  ProductDetail,
  ShopClient,
  ShopCtx,
  ShopError,
} from '@/contracts';

import { isPriceMismatch } from '@/lib/domain/pricing';
import { isShopRequestError, ShopConfigError } from '@/lib/shop/errors';

/** Cena zo shopu (number) → `MoneyString` bez float porovnávania ďalej (§2). */
export function numberToMoney(value: number): MoneyString {
  if (!Number.isFinite(value)) return '0.00';
  return (Math.round(value * 100) / 100).toFixed(2);
}

export type SnapshotOutcome =
  | { kind: 'ok'; snapshot: PreWriteSnapshot; detail: ProductDetail }
  | { kind: 'not_found'; snapshot: PreWriteSnapshot; error: ShopError }
  | { kind: 'error'; error: ShopError };

export interface SnapshotDeps {
  shopClient: Pick<ShopClient, 'getProduct'>;
  /** `lastOwnWrite` z `campaigns.repo` (I11). */
  lastOwnWrite?: (productId: number) => Promise<LastOwnWrite | null>;
}

/**
 * Povinný pre-write GET (D48). Vracia rozhodnutie pre executor:
 *  - `ok`        → zapisuje sa (aj pri `priceMismatch`, D39c),
 *  - `not_found` → len tento produkt sa blokne a označí v allowliste (D49),
 *  - `error`     → produkt zlyhá bez odoslania zápisu (fail-closed).
 */
export async function takePreWriteSnapshot(
  args: { productId: number; priceAtPreview: MoneyString | null },
  deps: SnapshotDeps,
  ctx: ShopCtx,
): Promise<SnapshotOutcome> {
  const lastOwnWrite = deps.lastOwnWrite ? await deps.lastOwnWrite(args.productId) : null;

  let detail: ProductDetail;
  try {
    detail = await deps.shopClient.getProduct(args.productId, ctx);
  } catch (error) {
    const shopError: ShopError | null = isShopRequestError(error)
      ? error.shopError
      : error instanceof ShopConfigError
        ? error.shopError
        : null;
    if (shopError === null) throw error;

    if (shopError.kind === 'not_found') {
      return {
        kind: 'not_found',
        error: shopError,
        snapshot: {
          productId: args.productId,
          found: false,
          name: null,
          priceAtWrite: null,
          hasAttributes: false,
          lastOwnWrite,
          reductionUnverifiable: true,
          priceAtPreview: args.priceAtPreview,
          // Fail-closed: bez ceny sa nezhoda nedá vylúčiť (D39c).
          priceMismatch: true,
        },
      };
    }
    return { kind: 'error', error: shopError };
  }

  const priceAtWrite = numberToMoney(detail.price);
  return {
    kind: 'ok',
    detail,
    snapshot: {
      productId: args.productId,
      found: true,
      name: detail.name,
      priceAtWrite,
      hasAttributes: detail.has_attributes,
      lastOwnWrite,
      reductionUnverifiable: true,
      priceAtPreview: args.priceAtPreview,
      priceMismatch: isPriceMismatch(args.priceAtPreview, priceAtWrite),
    },
  };
}
