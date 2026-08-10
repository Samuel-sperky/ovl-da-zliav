'use client';

/**
 * Aura Zľavy — filtre histórie (V12; pôvodne A16, rozhodnutie D18).
 *
 * Povinná sada zostáva ÚPLNÁ: produkt, zľava, dátum od–do, typ udalosti,
 * výsledok. Nič sa nezahodilo, len sa rozdelilo podľa toho, čo je bežná otázka
 * a čo je technické hľadanie:
 *
 *  - hore, na povrchu: obdobie, čo sa stalo, ako to dopadlo,
 *  - v rozkliku „Technický detail": čísla produktu a zľavy. Sú to vnútorné
 *    identifikátory a na povrch obrazovky nepatria.
 *
 * Filtrovanie je čisto čítacie — história sa nikdy nemení ani nemaže.
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
  /** Každá zmena filtra vracia stránkovanie na prvú stranu. */
  function patch(part: Partial<AuditFilterState>) {
    onChange({ ...value, ...part, page: 1 });
  }

  return (
    <form
      className="row wrapx"
      data-testid="audit-filters"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="lb">Od dňa</span>
        <input
          className="inp"
          type="date"
          value={value.from}
          onChange={(e) => patch({ from: e.target.value })}
          data-testid="audit-filter-from"
        />
      </label>
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="lb">Do dňa</span>
        <input
          className="inp"
          type="date"
          value={value.to}
          onChange={(e) => patch({ to: e.target.value })}
          data-testid="audit-filter-to"
        />
      </label>
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="lb">Čo sa stalo</span>
        <select
          className="inp"
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
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="lb">Ako to dopadlo</span>
        <select
          className="inp"
          value={value.ok}
          onChange={(e) => patch({ ok: e.target.value as AuditFilterState['ok'] })}
          data-testid="audit-filter-ok"
        >
          <option value="">všetko</option>
          <option value="true">podarilo sa</option>
          <option value="false">nepodarilo sa</option>
        </select>
      </label>
      <Button small onClick={() => onChange({ ...EMPTY_FILTERS })} data-testid="audit-filter-reset">
        Zrušiť filtre
      </Button>

      <details className="tech bare" style={{ width: '100%' }}>
        <summary>Hľadať podľa čísla</summary>
        <div className="body">
          <div className="row wrapx">
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="lb">Číslo produktu</span>
              <input
                className="inp"
                inputMode="numeric"
                value={value.productId}
                placeholder="všetky"
                onChange={(e) => patch({ productId: e.target.value })}
                data-testid="audit-filter-product"
              />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="lb">Číslo zľavy</span>
              <input
                className="inp"
                inputMode="numeric"
                value={value.campaignId}
                placeholder="všetky"
                onChange={(e) => patch({ campaignId: e.target.value })}
                data-testid="audit-filter-campaign"
              />
            </label>
          </div>
          <p className="hint">
            Dátumy sa počítajú podľa dní v našej časovej zóne. História je
            append-only — z obrazovky sa nedá nič upraviť ani zmazať.
          </p>
        </div>
      </details>
    </form>
  );
}

export default AuditFilters;
