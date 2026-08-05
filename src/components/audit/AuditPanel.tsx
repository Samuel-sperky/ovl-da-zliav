'use client';

/**
 * Aura Zľavy — kompozícia stránky `/audit` (A16, D18).
 *
 * Filtre + tabuľka + stránkovanie + detail drawer. Číta výhradne
 * `GET /api/audit` a `GET /api/audit/[id]` (I4 — žiadna mutácia).
 */
import { useCallback, useEffect, useState } from 'react';

import AuditDetailDrawer from '@/components/audit/AuditDetailDrawer';
import AuditFilters from '@/components/audit/AuditFilters';
import AuditTable from '@/components/audit/AuditTable';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import {
  EMPTY_FILTERS,
  getAudit,
  type AuditFilterState,
  type AuditPage,
} from '@/components/audit/api';

export function AuditPanel() {
  const [filters, setFilters] = useState<AuditFilterState>({ ...EMPTY_FILTERS });
  const [page, setPage] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const load = useCallback(async (f: AuditFilterState) => {
    const res = await getAudit(f);
    if (res.ok) {
      setPage(res.data);
      setError(null);
    } else {
      setPage(null);
      setError(res.error.message);
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const total = page?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / filters.perPage));

  return (
    <div className="ovl-stack" style={{ gap: '1rem' }}>
      <section className="ovl-card">
        <h2>Filtre</h2>
        <AuditFilters value={filters} onChange={setFilters} />
      </section>
      <section className="ovl-card">
        <div className="ovl-spread">
          <h2>Audit log</h2>
          <span className="ovl-small ovl-muted">
            {total} záznamov · strana {filters.page}/{lastPage}
          </span>
        </div>
        {error ? <ErrorMessage message={`Audit sa nepodarilo načítať. ${error}`} /> : null}
        {page === null && error === null ? (
          <div className="ovl-skeleton" style={{ minHeight: '8rem' }} aria-busy="true" />
        ) : null}
        {page ? <AuditTable rows={page.data} onSelect={setSelected} /> : null}
        <div className="ovl-row" style={{ marginTop: '0.5rem' }}>
          <Button
            small
            disabled={filters.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            ← Predchádzajúca
          </Button>
          <Button
            small
            disabled={filters.page >= lastPage}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            Nasledujúca →
          </Button>
        </div>
      </section>
      {selected !== null ? (
        <AuditDetailDrawer auditId={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

export default AuditPanel;
