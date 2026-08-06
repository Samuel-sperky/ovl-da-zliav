'use client';

/**
 * Aura Zľavy — kompozícia stránky `/produkty` (KISS, plán 33 §3 Produkty).
 *
 * Geometria predlohy: page-head s eyebrow a akciou, toolbar (hľadanie +
 * filter stavu), mriežka produktových kariet (monogram, cena tabulárne,
 * mini-bar hĺbky z G2, skrátený badge vlastného zápisu, ⚙ varianty).
 * Pridanie produktu = drawer sprava; odobranie = inline „Naozaj?".
 *
 * Pravidlá bez zmeny: strop 10 fail-closed (I2), percentá sú „posledný
 * VLASTNÝ zápis", nie stav shopu (I11), chyba siete degraduje na priznaný
 * chybový stav — nikdy vymyslené dáta.
 *
 * Vlastník: C2.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import AddProductForm from '@/components/products/AddProductForm';
import MarkUnknownButton from '@/components/products/MarkUnknownButton';
import ProductCard from '@/components/products/ProductCard';
import RefreshButton from '@/components/products/RefreshButton';
import RemoveProductButton from '@/components/products/RemoveProductButton';
import Button from '@/components/ui/Button';
import Drawer from '@/components/ui/Drawer';
import EmptyState from '@/components/ui/EmptyState';
import ErrorMessage from '@/components/ui/ErrorMessage';
import Eyebrow from '@/components/ui/Eyebrow';
import Toolbar from '@/components/ui/Toolbar';
import { ALLOWLIST_MAX, getAllowlist, type AllowlistRow } from '@/components/products/api';

type StatusFilter = 'all' | 'written' | 'unwritten' | 'attention';

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'všetky stavy' },
  { value: 'written', label: 's vlastným zápisom' },
  { value: 'unwritten', label: 'bez vlastného zápisu' },
  { value: 'attention', label: 'nenájdený / stav neznámy' },
];

function matchesStatus(row: AllowlistRow, status: StatusFilter): boolean {
  if (status === 'written') return row.lastOwnWrite !== null;
  if (status === 'unwritten') return row.lastOwnWrite === null;
  if (status === 'attention') return row.shopStatus !== 'ok';
  return true;
}

function matchesQuery(row: AllowlistRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    (row.name ?? '').toLowerCase().includes(q) ||
    (row.label ?? '').toLowerCase().includes(q) ||
    String(row.productId).includes(q.replace(/^#/, ''))
  );
}

export function ProductsPanel() {
  const [rows, setRows] = useState<AllowlistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => matchesStatus(r, status) && matchesQuery(r, query)),
    [rows, query, status],
  );

  const count = rows?.length ?? 0;
  const full = count >= ALLOWLIST_MAX;

  const head = (
    <div className="ovl-page-head ovl-view-in">
      <div>
        <Eyebrow>Riadenie zliav</Eyebrow>
        <h1>Produkty</h1>
        <p className="ovl-page-desc">
          Allowlist {count}/{ALLOWLIST_MAX} — zľavu je možné zapísať výhradne produktom z tohto
          zoznamu a strop 10 je vynútený aj v databáze. Uvedené zľavy sú vždy „posledný vlastný
          zápis", nie stav shopu.
        </p>
      </div>
      <div className="ovl-page-actions">
        <Button
          variant="primary"
          onClick={() => setDrawerOpen(true)}
          disabled={full}
          disabledReason={
            full ? `Allowlist je plný — ${ALLOWLIST_MAX} produktov je tvrdý strop.` : undefined
          }
          data-testid="open-add-product"
        >
          + Pridať produkt
        </Button>
      </div>
    </div>
  );

  if (error) {
    return (
      <>
        {head}
        <ErrorMessage message={`Allowlist sa nepodarilo načítať. ${error}`} />
      </>
    );
  }

  if (rows === null) {
    return (
      <>
        {head}
        <div className="ovl-card ovl-skeleton" style={{ minHeight: '10rem' }} aria-busy="true" />
      </>
    );
  }

  return (
    <div className="ovl-stack" style={{ gap: '0' }}>
      {head}

      <Toolbar
        ariaLabel="Hľadanie a filter produktov"
        actions={
          <RefreshButton productIds={rows.map((r) => r.productId)} onRefreshed={() => void load()} />
        }
      >
        <span className="ovl-input-wrap">
          <span className="ovl-input-glyph" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            placeholder="Hľadať názov alebo #id…"
            aria-label="Hľadať produkt"
            onChange={(e) => setQuery(e.target.value)}
            data-testid="products-search"
          />
        </span>
        <label>
          <select
            value={status}
            aria-label="Filter stavu"
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            data-testid="products-status-filter"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="ovl-small ovl-muted ovl-num">
          {filtered.length} z {count}
        </span>
      </Toolbar>

      {count === 0 ? (
        <section className="ovl-card">
          <EmptyState
            title="Allowlist je prázdny"
            action={
              <Button variant="primary" onClick={() => setDrawerOpen(true)}>
                + Pridať prvý produkt
              </Button>
            }
            testId="allowlist-empty"
          >
            Bez allowlistu appka nezapíše nič — pridaj prvý produkt (maximum je {ALLOWLIST_MAX}).
          </EmptyState>
        </section>
      ) : filtered.length === 0 ? (
        <section className="ovl-card">
          <EmptyState
            title="Nič nezodpovedá filtru"
            action={
              <Button
                onClick={() => {
                  setQuery('');
                  setStatus('all');
                }}
              >
                Vyčistiť filtre
              </Button>
            }
            testId="allowlist-filter-empty"
          >
            Skús iný výraz alebo iný stav — allowlist má {count}{' '}
            {count === 1 ? 'produkt' : count < 5 ? 'produkty' : 'produktov'}.
          </EmptyState>
        </section>
      ) : (
        /* testid `allowlist-table` zostáva pre e2e — obsah je teraz mriežka kariet. */
        <div className="ovl-allowlist-grid ovl-view-in" data-testid="allowlist-table">
          {filtered.map((row) => (
            <ProductCard
              key={row.productId}
              product={row}
              actions={
                <div className="ovl-stack" style={{ gap: '0.3rem', marginTop: 'auto' }}>
                  <MarkUnknownButton productId={row.productId} onMarked={() => void load()} />
                  <RemoveProductButton productId={row.productId} onRemoved={() => void load()} />
                </div>
              }
            />
          ))}
        </div>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Pridať produkt"
        subtitle={`Allowlist ${count}/${ALLOWLIST_MAX} — strop je fail-closed, 11. produkt sa pridať nedá.`}
        testId="add-product-drawer"
      >
        <AddProductForm
          currentCount={count}
          onAdded={() => {
            setDrawerOpen(false);
            void load();
          }}
        />
      </Drawer>
    </div>
  );
}

export default ProductsPanel;
