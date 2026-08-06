'use client';

/**
 * Aura Zľavy — odobranie produktu z allowlistu s inline „Naozaj?" (KISS,
 * plán 33 §3 Produkty; pôvodné pravidlá D40 nezmenené).
 *
 * Dvojkrok priamo v karte: prvý klik prepne tlačidlo na otázku „Naozaj?"
 * s možnosťami Áno/Nie — žiadny modal, žiadny confirm(). Odobranie produktu
 * s naplánovanou alebo čakajúcou kampaňou blokuje server (409
 * `campaign_planned`) a dôvod sa zobrazí doslova v karte.
 *
 * Vlastník: C2.
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { removeProduct } from '@/components/products/api';

export interface RemoveProductButtonProps {
  productId: number;
  onRemoved: () => void;
}

export function RemoveProductButton({ productId, onRemoved }: RemoveProductButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await removeProduct(productId);
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      const blocked = res.error.code === 'campaign_planned';
      setError({
        message: blocked
          ? 'Produkt sa nedá odobrať: má naplánovanú alebo čakajúcu kampaň. Najprv zruš tú kampaň v sekcii Kampane. Už zapísaná zľava v shope dobehne sama — zrušiť ju appka nedokáže.'
          : res.error.message,
        code: res.error.code,
      });
      return;
    }
    onRemoved();
  }

  return (
    <div className="ovl-stack" style={{ gap: '0.3rem' }}>
      {confirming ? (
        <div className="ovl-row" style={{ gap: '0.3rem', alignItems: 'center' }} role="group">
          <span className="ovl-small">
            <strong>Naozaj?</strong>
          </span>
          <Button
            small
            variant="danger"
            onClick={() => void run()}
            disabled={busy}
            data-testid={`remove-product-confirm-${productId}`}
          >
            {busy ? 'Odoberám…' : 'Áno, odobrať'}
          </Button>
          <Button small onClick={() => setConfirming(false)} disabled={busy}>
            Nie
          </Button>
        </div>
      ) : (
        <Button
          small
          variant="danger-quiet"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          data-testid={`remove-product-${productId}`}
        >
          Odobrať z allowlistu
        </Button>
      )}
      {error ? <ErrorMessage message={error.message} rawCode={error.code} /> : null}
    </div>
  );
}

export default RemoveProductButton;
