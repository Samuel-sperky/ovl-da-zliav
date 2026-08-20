'use client';

/**
 * Aura Zľavy — sekcia HISTÓRIA A TECHNICKÝ DETAIL (V12).
 *
 * Audit prestal byť samostatný tab a stal sa sekciou v Nastaveniach. Zmenil sa
 * RÁM, nie obsah: filtre zostávajú úplné, stránkovanie tiež, detail so
 * snímkami pred/po tiež. História je append-only a tento panel nemá ani jednu
 * akciu, ktorá by na nej niečo menila — číta výhradne cez dve čítacie cesty.
 *
 * Prečo sa panel volá „História", a nie „Audit": na povrchu majú byť slová,
 * ktoré človek pozná. Slovo audit ostáva vnútri kódu a v technických rozkliku.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import AuditDetailDrawer from '@/components/audit/AuditDetailDrawer';
import AuditFilters from '@/components/audit/AuditFilters';
import AuditTable from '@/components/audit/AuditTable';
import Button from '@/components/ui/Button';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { formatCountSk } from '@/lib/ui/vocabulary';
import {
  EMPTY_FILTERS,
  getAudit,
  type AuditFilterState,
  type AuditPage,
} from '@/components/audit/api';

/**
 * Sekvenčný strážca proti pretekaniu odpovedí: každá požiadavka dostane rastúci
 * token a do stavu smie len odpoveď s posledným vydaným tokenom — stará
 * (pomalšia) odpoveď tak nikdy neprepíše novšiu.
 */
export function createStaleGuard(): {
  begin(): number;
  isCurrent(token: number): boolean;
} {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(token: number) {
      return token === current;
    },
  };
}

export function AuditPanel() {
  const [filters, setFilters] = useState<AuditFilterState>({ ...EMPTY_FILTERS });
  const [page, setPage] = useState<AuditPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const guard = useRef(createStaleGuard());

  const load = useCallback(async (f: AuditFilterState) => {
    const token = guard.current.begin();
    const res = await getAudit(f);
    // Pri rýchlej zmene filtrov sa stará odpoveď zahodí.
    if (!guard.current.isCurrent(token)) return;
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
    <section className="sec" id="historia" data-testid="audit-panel">
      <div className="sec-h">
        <h2>História a technický detail</h2>
        <div className="act lvl-3">Zapisuje sa navždy, mazať sa nedá</div>
      </div>

      <AuditFilters value={filters} onChange={setFilters} />

      <div className="tbl-frame gap-t">
        <div className="tbl-scroll audit-scroll">
          {error ? (
            <ErrorMessage message={`Históriu sa nepodarilo načítať. ${error}`} />
          ) : page === null ? (
            <div className="ovl-skeleton" style={{ minHeight: '8rem' }} aria-busy="true" />
          ) : (
            <AuditTable rows={page.data} onSelect={setSelected} />
          )}
        </div>
        <div className="tbl-foot">
          <span data-testid="audit-total">
            {formatCountSk(total)} záznamov · strana {filters.page} z {lastPage}
          </span>
          <span className="row">
            <Button
              small
              disabled={filters.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              data-testid="audit-prev"
            >
              Späť
            </Button>
            <Button
              small
              disabled={filters.page >= lastPage}
              onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              data-testid="audit-next"
            >
              Ďalej
            </Button>
          </span>
        </div>
      </div>

      {selected !== null ? (
        <AuditDetailDrawer auditId={selected} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}

export default AuditPanel;
