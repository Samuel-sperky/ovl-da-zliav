/**
 * Aura Zľavy — VARIANTY KUSU: KÓD, EAN A SKLAD BEZ KĽÚČA.
 *
 * Toto je jediné miesto v appke, kde je kód a sklad vidieť BEZ oprávnenia
 * `product:read`. Verejný `products/get` vracia pole variantov a každý variant
 * v ňom nesie `reference` (skladový kód), `ean13` a `quantity` — teda presne
 * to, čo používateľ pri názve pýtal. Na úrovni produktu tie isté polia verejná
 * cesta NEDÁVA; tie žijú v paneli v skupine za kľúčom.
 *
 * Dôsledok, ktorý sa nesmie zamlčať: kód a sklad takto vidno pri 8 663 kusoch
 * zo 41 220 — pri tých, ktoré varianty majú. O zvyšku appka bez kľúča nevie nič
 * a hovorí to slovom, nie prázdnym miestom.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 * 1. **Tri prázdna sa nesmú zliať.** `pending` (detail sme ešte nedoťahali),
 *    `none` (shop pri tomto variante údaj nevedie) a `locked` (chýba kľúč).
 *    Kreslí ich `AbsenceValue`, ktorá dáva pomlčku, značku aj SLOVO.
 *    Zamknuté sa tu NEVYSVETĽUJE — vysvetlenie má jedno miesto
 *    (Nastavenia → Zamknuté funkcie).
 * 2. **`quantity: 0` je platná nula** („vypredané"), nie chýbajúci údaj.
 *    Rozlišuje to `stockText()`; tento súbor si vlastný preklad nepíše.
 * 3. **Súčet skladu je celok, alebo nič.** Keď čo i len jeden variant sklad
 *    nepovie, súčet sa NEUKÁŽE — nižšie číslo vydávané za celok je horšie než
 *    priznaná pomlčka. Rovnaké pravidlo má aj repozitár (`variantStock`).
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: C2, vlna 3 (majster/detail), 20. 8. 2026.
 */
import {
  fieldOf,
  stockText,
  variantLabel,
  type ProductExtraView,
  type ProductVariantView,
} from '@/components/products/product-extras';
import { AbsenceValue, FieldValue } from '@/components/products/ProductFacts';
import { pluralSk } from '@/lib/ui/vocabulary';

/**
 * Sklad cez všetky varianty — alebo `null`.
 *
 * `null` znamená „súčet sa povedať nedá", nie nulu: stačí jeden variant bez
 * množstva a celok už nie je celok (bod 3 hlavičky).
 */
export function variantStockTotal(variants: readonly ProductVariantView[]): number | null {
  if (variants.length === 0) return null;
  if (variants.some((variant) => variant.quantity === null)) return null;
  return variants.reduce((sum, variant) => sum + (variant.quantity ?? 0), 0);
}

/** Hodnota variantu ako číslica alebo kód — vždy v číslicovom reze. */
function Num({ text }: { text: string }) {
  return <b className="num">{text}</b>;
}

function VariantRow({ variant, index }: { variant: ProductVariantView; index: number }) {
  return (
    <li className="varrow" data-testid="detail-variant">
      <span className="varname">{variantLabel(variant, index)}</span>
      <span className="varfacts">
        <span className="varfact">
          kód{' '}
          <FieldValue
            field={fieldOf(variant.reference, 'none')}
            render={(value) => <Num text={value} />}
          />
        </span>
        <span className="varfact">
          EAN{' '}
          <FieldValue
            field={fieldOf(variant.ean13, 'none')}
            render={(value) => <Num text={value} />}
          />
        </span>
        <span className="varfact">
          sklad{' '}
          <FieldValue
            field={fieldOf(variant.quantity, 'none')}
            render={(value) => <Num text={stockText(value)} />}
          />
        </span>
      </span>
    </li>
  );
}

export interface ProductVariantsProps {
  /** Doťahnutý detail kusu. `undefined` = zatiaľ sme sa nepýtali. */
  extra: ProductExtraView | undefined;
}

/**
 * Zoznam variantov aj s tým, čo o nich shop nepovedal.
 *
 * Panel túto skupinu kreslí len pri kuse, ktorý varianty má — pri ostatných to
 * hovorí riadok „Varianty: bez variantov" v skupine údajov, a druhá veta o tom
 * istom by bola šum.
 */
export function ProductVariants({ extra }: ProductVariantsProps) {
  if (extra === undefined) {
    return (
      <div className="lvl-3" data-testid="detail-variants">
        <AbsenceValue why="pending" />
      </div>
    );
  }

  const variants = extra.variants;
  if (variants.length === 0) {
    return (
      <div className="lvl-3" data-testid="detail-variants">
        <AbsenceValue why="none" />
      </div>
    );
  }

  const total = variantStockTotal(variants);
  return (
    <div data-testid="detail-variants">
      <ul className="varlist">
        {variants.map((variant, index) => (
          <VariantRow key={variant.variantId} variant={variant} index={index} />
        ))}
      </ul>
      <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="detail-variant-stock">
        {variants.length} {pluralSk(variants.length, 'variant', 'varianty', 'variantov')} · sklad
        spolu{' '}
        <FieldValue
          field={fieldOf(total, 'none')}
          render={(value) => <b className="num">{stockText(value)}</b>}
        />
      </div>
    </div>
  );
}

export default ProductVariants;
