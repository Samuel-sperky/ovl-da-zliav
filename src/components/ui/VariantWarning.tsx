/**
 * Aura Zľavy — varovanie pri produkte s atribútmi/variantmi (§8, D3).
 *
 * Zľava sa v shope aplikuje na produkt; pri variantoch nevieme zaručiť,
 * ako ju shop premietne do jednotlivých kombinácií.
 */
export interface VariantWarningProps {
  hasAttributes: boolean;
}

export function VariantWarning({ hasAttributes }: VariantWarningProps) {
  if (!hasAttributes) return null;
  return (
    <span className="ovl-variant-warning" role="note">
      ⚠ Produkt má varianty (atribúty) — spôsob premietnutia zľavy do variantov
      určuje shop, appka ho nevie overiť.
    </span>
  );
}

export default VariantWarning;
