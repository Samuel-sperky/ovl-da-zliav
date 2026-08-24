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
  readonly full: WireFull | null;
}

/**
 * Blok spoza kľúča, PRESNE ako ho posiela `/api/catalog/details`.
 *
 * Trasa vracia `CatalogDetailRow` z repozitára doslova, takže toto je zrkadlo
 * typu `CatalogFullDetail` v `lib/repo/catalog.repo.ts`. Že sa tie dva
 * nerozídu, stráži typová kontrola v `test/unit/detaily-mapovanie.spec.ts` —
 * komponenty z `@/lib/repo/` neimportujú, tak sa zhoda vynucuje tam.
 *
 * PREDTÝM tu stálo `Record<string, unknown>` a čítalo sa z neho voľnými
 * reťazcami. Kompilátor tak nemal čo skontrolovať a šesť mien bolo zlých:
 * `wholesalePrice`, `priceWithTax`, `addedAt`, `lastOrderedAt`, `orderedTotal`
 * a `categories` čítané ako reťazce. Dnes to vidieť nie je — bez oprávnenia
 * `product:read` je `full` vždy `null` — ale po jeho doplnení by appka o šiestich
 * existujúcich hodnotách tvrdila „nemá". To je horšie než mlčať.
 */
interface WireFull {
  readonly purchasePrice: number | null;
  readonly margin: number | null;
  readonly marginPercent: number | null;
  readonly sellPrice: number | null;
  readonly sellPriceWithVat: number | null;
  readonly active: boolean | null;
  readonly dateAdd: string | null;
  readonly lastTimeInOrder: string | null;
  readonly qtyInOrders: number | null;
  readonly supplier: string | null;
  readonly categories: readonly number[] | null;
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
  /*
   * Kľúč je `keyof WireFull`, nie voľný reťazec. Práve to je oprava: preklep
   * alebo premenované pole na serveri je odteraz chyba prekladu, nie tiché
   * „nemá" na obrazovke.
   */
  const num = (key: keyof WireFull): number | null => {
    const raw = full?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };
  const text = (key: keyof WireFull): string | null => {
    const raw = full?.[key];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  };
  /** Peniaze prídu ako číslo; povrch ich chce ako reťazec a neprepočítava. */
  const money = (key: keyof WireFull): string | null => {
    const raw = num(key);
    return raw === null ? null : String(raw);
  };

  return {
    productId: row.productId,
    /*
     * Popis repozitár NENESIE. Čítal sa tu z bloku spoza kľúča, kde nikdy
     * nebol — teda vždy `null`, len to nebolo vidieť. Nechávame `null`
     * priznane: keď appka popis raz čítať bude, doplní ho tá istá cesta,
     * ktorá ho prinesie, a nie tento preklad.
     */
    description: null,
    shortDescription: null,
    variants: row.variants.map(toVariant),
    keyed:
      full === null
        ? null
        : {
            reference: row.reference.value,
            ean13: row.ean13.value,
            wholesalePrice: money('purchasePrice'),
            margin: money('margin'),
            marginPercent: num('marginPercent'),
            priceWithTax: money('sellPriceWithVat'),
            active: full.active,
            addedAt: text('dateAdd'),
            lastOrderedAt: text('lastTimeInOrder'),
            stockQuantity: row.quantity.value,
            orderedTotal: num('qtyInOrders'),
            supplier: text('supplier'),
            /*
             * Skutočnú zľavu v eshope repozitár dnes NENESIE — `CatalogFullDetail`
             * tie tri polia nemá. Nie je to teda „zamknuté za kľúčom", ale
             * „appka to zatiaľ nečíta". Kým to tak je, `null` je jediná pravdivá
             * odpoveď; vymyslieť sa nedá a hádať sa nesmie (I11).
             */
            shopDiscountPercent: null,
            shopDiscountFrom: null,
            shopDiscountTo: null,
            /* Kategórie prídu ako ID, nie mená. Povrch ich chce ako reťazce. */
            categories: (full.categories ?? []).map((id) => String(id)),
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
