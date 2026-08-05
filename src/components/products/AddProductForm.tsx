'use client';

/**
 * Aura Zľavy — pridanie produktu do allowlistu (A16, I2, D40).
 *
 * Fail-closed: pri 10 aktívnych záznamoch je pridanie vypnuté ešte pred
 * odoslaním requestu a UI vysvetlí, prečo (strop 10 produktov, R1/I2).
 * 409 zo servera sa zobrazí ako slovenská veta + raw kód.
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { ALLOWLIST_MAX, addProduct, validateNewProduct } from '@/components/products/api';

export interface AddProductFormProps {
  currentCount: number;
  /** `false` v read-only režime (chýba kľúč / zamknuté zápisy) — len informatívne. */
  disabled?: boolean;
  disabledReason?: string;
  onAdded: () => void;
}

export function AddProductForm({
  currentCount,
  disabled = false,
  disabledReason,
  onAdded,
}: AddProductFormProps) {
  const [productId, setProductId] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const full = currentCount >= ALLOWLIST_MAX;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setRawCode(null);
    // Lokálna validácia VŽDY pred odoslaním (I2, I9).
    const localError = validateNewProduct(productId, currentCount);
    if (localError) {
      setError(localError);
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await addProduct(Number(productId.trim()), label);
    setSubmitting(false);
    if (res.ok) {
      setProductId('');
      setLabel('');
      onAdded();
      return;
    }
    setError(res.error.message);
    setRawCode(res.error.code);
  }

  return (
    <form className="ovl-stack" onSubmit={submit} data-testid="add-product-form">
      <h3>Pridať produkt do allowlistu</h3>
      <p className="ovl-small ovl-muted">
        Zľavu je možné zapísať výhradne produktu z tohto zoznamu. Strop je{' '}
        <strong>
          {ALLOWLIST_MAX} produktov ({currentCount}/{ALLOWLIST_MAX} obsadených)
        </strong>{' '}
        a je vynútený aj v databáze — appka pri pochybnosti nezapíše nič.
      </p>
      <div className="ovl-row">
        <label>
          <span className="ovl-small">ID produktu v shope</span>
          <br />
          <input
            inputMode="numeric"
            value={productId}
            placeholder="napr. 1024"
            onChange={(e) => setProductId(e.target.value)}
            disabled={full || disabled || submitting}
            data-testid="add-product-id"
          />
        </label>
        <label>
          <span className="ovl-small">Vlastný popis (nepovinné)</span>
          <br />
          <input
            value={label}
            placeholder="napr. Náhrdelník Aura"
            maxLength={200}
            onChange={(e) => setLabel(e.target.value)}
            disabled={full || disabled || submitting}
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          disabled={full || disabled || submitting}
          disabledReason={
            full
              ? `Allowlist je plný — ${ALLOWLIST_MAX} produktov je tvrdý strop (I2).`
              : disabledReason
          }
          data-testid="add-product-submit"
        >
          {submitting ? 'Pridávam…' : 'Pridať produkt'}
        </Button>
      </div>
      {full ? (
        <p className="ovl-badge ovl-badge--warning" data-testid="allowlist-full-notice">
          Allowlist je plný ({ALLOWLIST_MAX}/{ALLOWLIST_MAX}) — 11. produkt sa pridať nedá.
          Najprv odober niektorý zo zoznamu.
        </p>
      ) : null}
      {error ? <ErrorMessage message={error} rawCode={rawCode} /> : null}
    </form>
  );
}

export default AddProductForm;
