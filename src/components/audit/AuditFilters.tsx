'use client';

/**
 * Aura Zľavy — filtre audit logu (A16, D18).
 *
 * Povinná sada: produkt, dátum (od/do), typ operácie, výsledok.
 * Filtrovanie je čisto čítacie — audit sa nikdy nemení ani nemaže (I4).
 */
import Button from '@/components/ui/Button';
import {
  AUDIT_EVENT_OPTIONS,
  EMPTY_FILTERS,
  type AuditFilterState,
} from '@/components/audit/api';

export interface AuditFiltersProps {
  value: AuditFilterState;
  onChange: (next: AuditFilterState) => void;
}

export function AuditFilters({ value, onChange }: AuditFiltersProps) {
  /** Každá zmena filtra resetuje stránkovanie na 1. */
  function patch(part: Partial<AuditFilterState>) {
    onChange({ ...value, ...part, page: 1 });
  }

  return (
    <form
      className="ovl-stack"
      data-testid="audit-filters"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="ovl-row">
        <label>
          <span className="ovl-small">ID produktu</span>
          <br />
          <input
            inputMode="numeric"
            value={value.productId}
            placeholder="všetky"
            onChange={(e) => patch({ productId: e.target.value })}
            data-testid="audit-filter-product"
          />
        </label>
        <label>
          <span className="ovl-small">ID kampane</span>
          <br />
          <input
            inputMode="numeric"
            value={value.campaignId}
            placeholder="všetky"
            onChange={(e) => patch({ campaignId: e.target.value })}
          />
        </label>
        <label>
          <span className="ovl-small">Od dňa</span>
          <br />
          <input
            type="date"
            value={value.from}
            onChange={(e) => patch({ from: e.target.value })}
            data-testid="audit-filter-from"
          />
        </label>
        <label>
          <span className="ovl-small">Do dňa</span>
          <br />
          <input
            type="date"
            value={value.to}
            onChange={(e) => patch({ to: e.target.value })}
            data-testid="audit-filter-to"
          />
        </label>
        <label>
          <span className="ovl-small">Typ operácie</span>
          <br />
          <select
            value={value.eventType}
            onChange={(e) => patch({ eventType: e.target.value })}
            data-testid="audit-filter-event"
          >
            {AUDIT_EVENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="ovl-small">Výsledok</span>
          <br />
          <select
            value={value.ok}
            onChange={(e) => patch({ ok: e.target.value as AuditFilterState['ok'] })}
            data-testid="audit-filter-ok"
          >
            <option value="">všetky</option>
            <option value="true">úspešné</option>
            <option value="false">neúspešné</option>
          </select>
        </label>
        <Button onClick={() => onChange({ ...EMPTY_FILTERS })} data-testid="audit-filter-reset">
          Zmazať filtre
        </Button>
      </div>
      <p className="ovl-small ovl-muted">
        Dátumový filter pracuje s dňami v časovej zóne shopu. Audit je
        append-only — z UI sa nedá nič upraviť ani zmazať.
      </p>
    </form>
  );
}

export default AuditFilters;
