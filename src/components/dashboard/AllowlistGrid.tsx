'use client';

/**
 * Aura Zľavy — mriežka 10 allowlist produktov (D1, D7, I2, I11).
 *
 * Každá karta nesie badge „podľa vlastného zápisu z DD.MM. — shop môže mať
 * iný stav" (SelfWriteBadge). Voľné sloty do 10 sa kreslia ako prázdne
 * karty — strop 10 je vidieť na prvý pohľad.
 */
import Link from 'next/link';

import SelfWriteBadge from '@/components/ui/SelfWriteBadge';
import VariantWarning from '@/components/ui/VariantWarning';
import { formatDateSk, formatEur } from '@/lib/ui/format';
import type { AllowlistItem } from '@/components/dashboard/api';

const MAX_SLOTS = 10;

const SHOP_STATUS_LABELS: Record<AllowlistItem['shopStatus'], { label: string; tone: string } | null> = {
  ok: null,
  not_found: { label: 'v shope nenájdený', tone: 'danger' },
  unknown: { label: 'stav neznámy', tone: 'warning' },
};

export function AllowlistGrid({ items }: { items: readonly AllowlistItem[] }) {
  const bySlot = new Map(items.map((i) => [i.slot, i]));

  return (
    <section className="ovl-card ovl-span-2" data-testid="allowlist-grid">
      <div className="ovl-spread">
        <h2>
          Allowlist produktov ({items.length}/{MAX_SLOTS})
        </h2>
        <Link href="/produkty" className="ovl-small">
          spravovať produkty →
        </Link>
      </div>
      <div className="ovl-allowlist-grid">
        {Array.from({ length: MAX_SLOTS }, (_, idx) => {
          const slot = idx + 1;
          const item = bySlot.get(slot);
          if (!item) {
            return (
              <div className="ovl-product-card ovl-product-card--empty" key={`empty-${slot}`}>
                <span className="ovl-small">voľný slot {slot}</span>
              </div>
            );
          }
          const shopStatus = SHOP_STATUS_LABELS[item.shopStatus];
          const w = item.lastOwnWrite;
          return (
            <div className="ovl-product-card" key={item.productId} data-testid="allowlist-card">
              <span className="ovl-product-name">
                {item.name ?? item.label ?? `Produkt #${item.productId}`}
              </span>
              <span className="ovl-small ovl-muted">
                ID <code>{item.productId}</code> · slot {slot}
              </span>
              <span className="ovl-product-price">{formatEur(item.price)}</span>
              {shopStatus ? (
                <span className={`ovl-badge ovl-badge--${shopStatus.tone}`}>{shopStatus.label}</span>
              ) : null}
              {w ? (
                <span className="ovl-small">
                  −{w.percent} % · {formatDateSk(w.from)} – {formatDateSk(w.to)}
                </span>
              ) : null}
              <SelfWriteBadge
                writtenAt={w?.at ?? null}
                detail={
                  w
                    ? `Posledný vlastný zápis: −${w.percent} % od ${formatDateSk(w.from)} do ${formatDateSk(w.to)}`
                    : undefined
                }
              />
              <VariantWarning hasAttributes={item.hasAttributes} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default AllowlistGrid;
