/**
 * Aura Zľavy — DOŤAHOVANIE KÓDOV A SKLADU PRE VIDITEĽNÚ STRÁNKU.
 *
 * Spojka medzi `POST /api/catalog/details` a modelom, ktorý kreslí tabuľka
 * (`product-extras.ts`). Robí presne dve veci: pošle ID stránky a preloží
 * odpoveď repozitára na pohľad, ktorý pozná tri druhy prázdna.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Tri prázdna sa nesmú zliať do jedného.** Repozitár vracia `gap`:
 *    `not_fetched` (riadok sme ešte nedoťahali), `needs_product_read` (pole
 *    dáva len `getFull`, a na to chýba kľúč) a `shop_has_none` (shop ten údaj
 *    o produkte proste nevedie). V UI z toho je `pending`, `locked` a `none`.
 *    Keby sa zliali, používateľ by nevedel, či má počkať, vypýtať si kľúč,
 *    alebo či taký údaj neexistuje — a to je jediné, čo ho pri prázdnej bunke
 *    zaujíma.
 *
 * 2. **Doťahuje sa VIDITEĽNÁ stránka, nikdy katalóg.** 50 riadkov = dve dávky
 *    po 25 z denného rozpočtu 240 anonymných čítaní. Celý katalóg by bol
 *    1 649 dávok. Kto sem pridá „a načítajme rovno všetko", minie appke deň.
 *
 * 3. **Chyba nie je prázdny výsledok.** Keď sa doplnenie nepodarí, volajúci to
 *    musí vedieť rozlíšiť od „shop nič nemá" — inak by tabuľka po výpadku siete
 *    tvrdila, že produkty kód nemajú.
 *
 * Vlastník: doťahovanie detailov, 19. 8. 2026.
 */
import {
  absent,
  fieldOf,
  type AbsenceKind,
  type ExtrasCapabilityState,
  type ProductExtraView,
  type ProductExtrasView,
  type ProductVariantView,
} from '@/components/products/product-extras';

/** Hodnota z repozitára: `gap === null` znamená, že hodnotu poznáme. */
interface WireValue<T> {
  readonly value: T | null;
  readonly gap: 'not_fetched' | 'needs_product_read' | 'shop_has_none' | null;
}

interface WireVariant {
  readonly variantId: number;
  readonly reference: string | null;
  readonly ean13: string | null;
  readonly quantity: number | null;
  readonly values: readonly string[];
  readonly priceImpact?: string | null;
}

interface WireRow {
  readonly productId: number;
  readonly route: 'list' | 'get' | 'getFull';
  readonly fetchedAt: string | null;
  readonly reference: WireValue<string>;
  readonly ean13: WireValue<string>;
  readonly quantity: WireValue<number>;
  readonly variantStock: WireValue<number>;
  readonly variants: readonly WireVariant[];
  readonly full: Record<string, unknown> | null;
}

interface WireResponse {
  readonly route: 'get' | 'getFull';
  readonly capability: { readonly state?: string } | null;
  readonly notFilled: readonly number[];
  readonly notFilledReason: string;
  readonly readsUsed: number;
  readonly at: string;
  readonly error: string | null;
  readonly rows: readonly (WireRow | null)[];
}

/**
 * Preklad medzery repozitára na dôvod, ktorý sa dá povedať človeku.
 *
 * Je to jediné miesto, kde tento preklad žije. Druhá kópia by sa raz rozišla
 * a appka by o tom istom prázdne hovorila na dvoch obrazovkách inak.
 */
function absenceOf(gap: WireValue<unknown>['gap']): AbsenceKind {
  if (gap === 'needs_product_read') return 'locked';
  if (gap === 'not_fetched') return 'pending';
  return 'none';
}

function toVariant(v: WireVariant): ProductVariantView {
  return {
    variantId: v.variantId,
    reference: v.reference,
    ean13: v.ean13,
    quantity: v.quantity,
    priceImpact: v.priceImpact ?? null,
    values: v.values,
  };
}

function toItem(row: WireRow): ProductExtraView {
  const full = row.full;
  const text = (key: string): string | null => {
    const raw = full?.[key];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  };
  const num = (key: string): number | null => {
    const raw = full?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };

  return {
    productId: row.productId,
    description: text('description'),
    shortDescription: text('shortDescription'),
    variants: row.variants.map(toVariant),
    keyed:
      full === null
        ? null
        : {
            reference: row.reference.value,
            ean13: row.ean13.value,
            wholesalePrice: text('wholesalePrice'),
            margin: text('margin'),
            marginPercent: num('marginPercent'),
            priceWithTax: text('priceWithTax'),
            active: typeof full['active'] === 'boolean' ? (full['active'] as boolean) : null,
            addedAt: text('addedAt'),
            lastOrderedAt: text('lastOrderedAt'),
            stockQuantity: row.quantity.value,
            orderedTotal: num('orderedTotal'),
            supplier: text('supplier'),
            shopDiscountPercent: num('shopDiscountPercent'),
            shopDiscountFrom: text('shopDiscountFrom'),
            shopDiscountTo: text('shopDiscountTo'),
            categories: Array.isArray(full['categories'])
              ? (full['categories'] as unknown[]).filter(
                  (c): c is string => typeof c === 'string',
                )
              : [],
          },
    at: row.fetchedAt ?? '',
  };
}

/** Prečo je bunka prázdna, keď riadok vôbec neprišiel. */
export function rowAbsence(row: WireRow | null): AbsenceKind {
  if (row === null) return 'pending';
  return absenceOf(row.reference.gap);
}

export interface FetchExtrasResult {
  readonly view: ProductExtrasView | null;
  /** Veta pre používateľa, keď sa doplnenie nepodarilo. `null` = podarilo sa. */
  readonly failed: string | null;
}

/**
 * Doplní detaily pre ID viditeľnej stránky.
 *
 * Strop 100 drží route; tu sa zoznam len zbaví duplicít a zoradí, aby dve
 * rovnaké stránky poslali rovnakú požiadavku a dala sa cachovať.
 */
export async function fetchExtras(
  productIds: readonly number[],
  signal?: AbortSignal,
): Promise<FetchExtrasResult> {
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  if (ids.length === 0) return { view: null, failed: null };

  try {
    const res = await fetch('/api/catalog/details', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ productIds: ids }),
      signal,
    });

    const body = (await res.json()) as { ok?: boolean; data?: WireResponse };
    if (body.ok !== true || body.data === undefined) {
      return { view: null, failed: 'Kódy a sklad sa teraz nepodarilo doplniť.' };
    }

    const data = body.data;
    const rows = data.rows.filter((r): r is WireRow => r !== null);
    const state: ExtrasCapabilityState =
      data.capability?.state === 'available'
        ? 'available'
        : data.capability?.state === 'locked'
          ? 'locked'
          : 'unknown';

    return {
      view: {
        items: rows.map(toItem),
        skippedIds: data.notFilled,
        capability: {
          state,
          requires: 'product:read',
          note:
            state === 'available'
              ? null
              : 'Kód a sklad pre produkty bez variantov pozná len kľúč so scope product:read.',
        },
        readsUsed: data.readsUsed,
        at: data.at,
        error: data.error,
      },
      failed: data.error === null ? null : 'Časť údajov sa nepodarilo doplniť.',
    };
  } catch (error) {
    // Zrušený dotaz nie je chyba — používateľ len preklikol na ďalšiu stránku.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { view: null, failed: null };
    }
    return { view: null, failed: 'Kódy a sklad sa teraz nepodarilo doplniť.' };
  }
}

/** Prázdne pole s dôvodom — používa sa, kým doplnenie nedobehne. */
export const PENDING_FIELD = absent<string>('pending');

export { fieldOf };
