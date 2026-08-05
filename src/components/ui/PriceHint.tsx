/**
 * Aura Zľavy — orientačná zľavnená cena (D4, §8).
 *
 * Zobrazuje `price × (1 − r/100)` VŽDY s upozornením na zaokrúhlenie shopu.
 * Upozornenie sa NESMIE vynechať — je súčasťou komponentu, nie voľba.
 */
import { formatEur } from '@/lib/ui/format';

export const PRICE_HINT_DISCLAIMER =
  'orientačný výpočet appky; zaokrúhlenie shopu sa môže líšiť';

export interface PriceHintProps {
  /** Pôvodná cena ako peňažný reťazec, napr. "24.90". */
  price: string | null;
  /** Celé percento zľavy 1–30. */
  percent: number;
}

export function PriceHint({ price, percent }: PriceHintProps) {
  if (price == null || !Number.isFinite(Number(price))) {
    return <span className="ovl-price-hint">cena neznáma — {PRICE_HINT_DISCLAIMER}</span>;
  }
  const discounted = Number(price) * (1 - percent / 100);
  return (
    <span>
      <strong>{formatEur(discounted)}</strong>{' '}
      <span className="ovl-price-hint">({PRICE_HINT_DISCLAIMER})</span>
    </span>
  );
}

export default PriceHint;
