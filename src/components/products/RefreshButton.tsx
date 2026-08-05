'use client';

/**
 * Aura Zľavy — „Obnoviť z shopu" (A16, D56, D57, I11).
 *
 * Obnoví názvy/ceny allowlist produktov z katalógu shopu. Obnovuje LEN
 * názov, cenu a existenciu produktu — o skutočnom stave zľavy v shope
 * appka nič nevie a toto tlačidlo to nemení (I11).
 */
import { useState } from 'react';

import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { refreshCatalog } from '@/components/products/api';

export interface RefreshButtonProps {
  productIds: number[];
  disabled?: boolean;
  disabledReason?: string;
  onRefreshed: () => void;
}

export function RefreshButton({
  productIds,
  disabled = false,
  disabledReason,
  onRefreshed,
}: RefreshButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawCode, setRawCode] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setRawCode(null);
    setNote(null);
    const res = await refreshCatalog(productIds);
    setBusy(false);
    if (!res.ok) {
      setError(res.error.message);
      setRawCode(res.error.code);
      return;
    }
    const { items, staleCount, via } = res.data;
    setNote(
      staleCount > 0
        ? `Obnovených ${items.length - staleCount} z ${items.length} produktov (via ${via}); ${staleCount} sa nepodarilo prečítať — ich údaje zostali staré.`
        : `Obnovených ${items.length} produktov (via ${via}).`,
    );
    onRefreshed();
  }

  return (
    <div className="ovl-stack" style={{ gap: '0.25rem' }}>
      <Button
        onClick={run}
        disabled={disabled || busy}
        disabledReason={disabledReason}
        data-testid="refresh-catalog"
      >
        {busy ? 'Obnovujem…' : 'Obnoviť z shopu'}
      </Button>
      {note ? <span className="ovl-small ovl-muted">{note}</span> : null}
      <span className="ovl-small ovl-muted">
        Obnoví len názov, cenu a existenciu produktu. Skutočný stav zľavy v shope
        sa cez API zistiť nedá.
      </span>
      {error ? <ErrorMessage message={error} rawCode={rawCode} /> : null}
    </div>
  );
}

export default RefreshButton;
