'use client';

/**
 * Aura Zľavy — „Označiť stav ako neznámy" (A16, D38, I11).
 *
 * Priznaný únik z klamania: keď používateľ zmenil zľavu ručne v admin shope,
 * náš „posledný vlastný zápis" už neplatí. Táto akcia stav produktu prepne
 * na `unknown`, aby UI netvrdilo nič, čo nevie.
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { markUnknown } from '@/components/products/api';

export interface MarkUnknownButtonProps {
  productId: number;
  onMarked: () => void;
}

export function MarkUnknownButton({ productId, onMarked }: MarkUnknownButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setRawCode(null);
    const res = await markUnknown(productId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      setRawCode(res.error.code);
      return;
    }
    onMarked();
  }

  return (
    <div className="ovl-stack" style={{ gap: '0.2rem' }}>
      <Button
        small
        onClick={run}
        disabled={busy}
        title="Použi, keď si zľavu zmenil ručne v admin shope — appka potom netvrdí, že pozná stav."
        data-testid={`mark-unknown-${productId}`}
      >
        {busy ? 'Označujem…' : 'Označiť stav ako neznámy'}
      </Button>
      {error ? <ErrorMessage message={error} rawCode={rawCode} /> : null}
    </div>
  );
}

export default MarkUnknownButton;
