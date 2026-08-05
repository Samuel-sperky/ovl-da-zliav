/**
 * Aura Zľavy — orientačná zľavnená cena (D4, §8).
 *
 * Zobrazuje `price × (1 − r/100)` VŽDY s upozornením na zaokrúhlenie shopu.
 * Upozornenie sa NESMIE vynechať — je súčasťou komponentu, nie voľba.
 *
 * Redizajn (plán §2 bod 8): upozornenie nesie `≈` marker, ktorý má plné znenie
 * v `title` **aj** `aria-label` pri každej vypočítanej cene, plus jedno plné
 * znenie na obrazovku cez `<PriceHintLegend/>`. Sedem kópií tej istej vety na
 * jednej dry-run obrazovke ju devalvovalo; marker + tooltip + legenda ju
 * zachovávajú pri každej hodnote aj v prístupnostnom strome.
 */
import { formatEur } from '@/lib/ui/format';

export const PRICE_HINT_DISCLAIMER =
  'orientačný výpočet appky; zaokrúhlenie shopu sa môže líšiť';

export interface PriceHintProps {
  /** Pôvodná cena ako peňažný reťazec, napr. "24.90". */
  price: string | null;
  /** Celé percento zľavy 1–30. */
  percent: number;
  /** Vypísať plné znenie ako viditeľný text (jednorazové zobrazenia). */
  full?: boolean;
}

export function PriceHint({ price, percent, full = false }: PriceHintProps) {
  if (price == null || !Number.isFinite(Number(price))) {
    return <span className="ovl-price-hint">cena neznáma — {PRICE_HINT_DISCLAIMER}</span>;
  }
  const discounted = Number(price) * (1 - percent / 100);
  return (
    <span className="ovl-num">
      <span className="ovl-approx" title={PRICE_HINT_DISCLAIMER} aria-label={PRICE_HINT_DISCLAIMER}>
        ≈
      </span>
      <strong>{formatEur(discounted)}</strong>
      {full ? <span className="ovl-price-hint"> ({PRICE_HINT_DISCLAIMER})</span> : null}
    </span>
  );
}

/** Plné znenie D4 raz na obrazovku — patrí pod hlavičku tabuľky s cenami. */
export function PriceHintLegend() {
  return (
    <p className="ovl-legend" data-testid="pricehint-legend">
      Ceny označené <span className="ovl-approx">≈</span> sú {PRICE_HINT_DISCLAIMER}.
    </p>
  );
}

export default PriceHint;
