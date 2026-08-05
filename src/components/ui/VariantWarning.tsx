/**
 * Aura Zľavy — varovanie pri produkte s atribútmi/variantmi (§8, D3).
 *
 * Zľava sa v shope aplikuje na produkt; pri variantoch nevieme zaručiť, ako ju
 * shop premietne do jednotlivých kombinácií.
 *
 * Redizajn (V16): v kartách a riadkoch tabuliek naťahovala plná štvorriadková
 * veta celú mriežku. `compact` kreslí 20×20 px chip `⚙`, plná veta zostáva v
 * `title` **aj** `aria-label`, takže sa z prístupnostného stromu nestratí.
 */
export const VARIANT_WARNING_TEXT =
  'Produkt má varianty (atribúty) — spôsob premietnutia zľavy do variantov určuje shop, appka ho nevie overiť.';

export interface VariantWarningProps {
  hasAttributes: boolean;
  /** Kompaktný chip namiesto plnej vety (karty, riadky tabuliek). */
  compact?: boolean;
}

export function VariantWarning({ hasAttributes, compact = false }: VariantWarningProps) {
  if (!hasAttributes) return null;
  if (compact) {
    return (
      <span
        className="ovl-variant-chip"
        role="note"
        title={VARIANT_WARNING_TEXT}
        aria-label={VARIANT_WARNING_TEXT}
      >
        <span aria-hidden="true">⚙</span>
      </span>
    );
  }
  return (
    <span className="ovl-variant-warning" role="note">
      <span className="ovl-note-glyph" aria-hidden="true">
        ⚙
      </span>
      {VARIANT_WARNING_TEXT}
    </span>
  );
}

export default VariantWarning;
