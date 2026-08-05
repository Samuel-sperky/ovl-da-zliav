'use client';

/**
 * Aura Zľavy — karta produktu (plán §4, „zobrazenia produktov"; sekcia B2).
 *
 * Shop API o produkte vracia len `id`, `name`, `price` a `has_attributes`.
 * **Obrázky produktov neexistujú**, takže karta žiadny nemá a ani nesimuluje
 * placeholder-šum: miesto obrázka nesie iniciálový monogram v `--brand-tint`.
 *
 * Čo karta ukazuje: názov, `#id`, cenu tabulárne, `≈` orientačnú zľavnenú cenu
 * (len keď existuje vlastný zápis), skrátený badge vlastného zápisu s plným
 * znením v `title`/`aria-label` (D7, §2 bod 7), mini bar z G2 a `⚙` chip pri
 * variantoch (D3, V16).
 *
 * I11: percento je „posledný VLASTNÝ zápis", nikdy „zľava v shope". Produkt
 * bez zápisu má prázdnu dráhu a text „bez zápisu" — nie nulu.
 *
 * Vlastník: B2.
 */
import PriceHint from '@/components/ui/PriceHint';
import SelfWriteBadge from '@/components/ui/SelfWriteBadge';
import ToneBadge from '@/components/ui/ToneBadge';
import VariantWarning from '@/components/ui/VariantWarning';
import DiscountMiniBar from '@/components/charts/DiscountMiniBar';
import { monogram } from '@/components/charts/chart-utils';
import { formatDateSk, formatEur, formatPercentSk } from '@/lib/ui/format';

export interface ProductCardOwnWrite {
  percent: number;
  from: string;
  to: string;
  at: string;
}

export interface ProductCardData {
  productId: number;
  name: string | null;
  label?: string | null;
  price: string | null;
  hasAttributes: boolean;
  shopStatus?: string;
  slot?: number | null;
  lastOwnWrite: ProductCardOwnWrite | null;
}

export interface ProductCardProps {
  product: ProductCardData;
  /** Akcie v päte karty (odobrať, označiť stav) — dodáva hostiteľ. */
  actions?: React.ReactNode;
}

/** Stav produktu v shope — farba + glyf + text, nikdy len farba (§3.3). */
function ShopStatus({ status }: { status: string | undefined }) {
  if (status === 'not_found') {
    return (
      <ToneBadge tone="critical" glyph="∅">
        v shope nenájdený
      </ToneBadge>
    );
  }
  if (status === 'unknown') {
    return (
      <ToneBadge tone="attention" glyph="?">
        stav neznámy
      </ToneBadge>
    );
  }
  return null;
}

export function ProductCard({ product, actions }: ProductCardProps) {
  const name = product.name ?? product.label ?? `Produkt #${product.productId}`;
  const own = product.lastOwnWrite;

  return (
    <article className="ovl-product-card" data-testid={`product-card-${product.productId}`}>
      <div className="ovl-row" style={{ gap: '0.5rem', flexWrap: 'nowrap', alignItems: 'start' }}>
        <span className="ovl-monogram" aria-hidden="true">
          {monogram(product.name ?? product.label ?? null, product.productId)}
        </span>
        <div className="ovl-stack" style={{ gap: '0.1rem', minWidth: 0 }}>
          <span className="ovl-product-name">{name}</span>
          <span className="ovl-small ovl-muted ovl-mono">#{product.productId}</span>
        </div>
        <VariantWarning hasAttributes={product.hasAttributes} compact />
      </div>

      <div className="ovl-spread" style={{ alignItems: 'baseline' }}>
        <span className="ovl-num ovl-product-price">{formatEur(product.price)}</span>
        {own ? <PriceHint price={product.price} percent={own.percent} /> : null}
      </div>

      <DiscountMiniBar percent={own?.percent ?? null} />

      <div className="ovl-stack" style={{ gap: '0.2rem' }}>
        <span className="ovl-small">
          {own ? (
            <>
              <strong className="ovl-num">{formatPercentSk(own.percent)}</strong>{' '}
              <span className="ovl-muted ovl-daterange">
                {formatDateSk(own.from)} – {formatDateSk(own.to)}
              </span>
            </>
          ) : (
            <span className="ovl-muted">bez zápisu</span>
          )}
        </span>
        <SelfWriteBadge
          writtenAt={own?.at ?? null}
          {...(own
            ? {
                detail: `${formatPercentSk(own.percent)}, okno ${formatDateSk(own.from)} – ${formatDateSk(own.to)}`,
              }
            : {})}
        />
        <ShopStatus status={product.shopStatus} />
      </div>

      {actions}
    </article>
  );
}

export default ProductCard;
