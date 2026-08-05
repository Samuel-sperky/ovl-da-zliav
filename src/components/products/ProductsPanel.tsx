'use client';

/**
 * Aura Zľavy — kompozícia stránky `/produkty` (A16, §8).
 *
 * Načíta allowlist z `/api/allowlist` a skladá tabuľku, pridanie, obnovenie
 * z shopu a označenie stavu za neznámy. Chyba siete degraduje na priznaný
 * chybový stav — nikdy nezobrazíme vymyslené dáta (I11).
 */
import { useCallback, useEffect, useState } from 'react';

import AddProductForm from '@/components/products/AddProductForm';
import AllowlistTable from '@/components/products/AllowlistTable';
import RefreshButton from '@/components/products/RefreshButton';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { ALLOWLIST_MAX, getAllowlist, type AllowlistRow } from '@/components/products/api';

export function ProductsPanel() {
  const [rows, setRows] = useState<AllowlistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getAllowlist();
    if (res.ok) {
      setRows(res.data);
      setError(null);
    } else {
      setRows(null);
      setError(res.error.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return <ErrorMessage message={`Allowlist sa nepodarilo načítať. ${error}`} />;
  }

  if (rows === null) {
    return <div className="ovl-card ovl-skeleton" style={{ minHeight: '10rem' }} aria-busy="true" />;
  }

  return (
    <div className="ovl-stack" style={{ gap: '1rem' }}>
      <section className="ovl-card">
        <div className="ovl-spread">
          <h2>
            Allowlist ({rows.length}/{ALLOWLIST_MAX})
          </h2>
          <RefreshButton
            productIds={rows.map((r) => r.productId)}
            onRefreshed={() => void load()}
          />
        </div>
        <AllowlistTable rows={rows} onChanged={() => void load()} />
      </section>
      <section className="ovl-card">
        <AddProductForm currentCount={rows.length} onAdded={() => void load()} />
      </section>
    </div>
  );
}

export default ProductsPanel;
