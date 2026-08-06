'use client';

/**
 * Aura Zľavy — filter stavu kampaní (D14; KISS toolbar podľa plánu 33 §3).
 *
 * Redizajn KISS: rad pilulkových čipov sa mení na kompaktný `select` do
 * toolbaru predlohy (hľadanie + filter stavu). Plná sada stavov vrátane
 * derivovaných UI pohľadov „aktívna"/„expirovaná" (§4) zostáva — tie sa na
 * server mapujú ako `status=done` a rozlíši ich klient.
 */

export type CampaignFilterValue =
  | 'all'
  | 'draft'
  | 'scheduled'
  | 'needs_key'
  | 'running'
  | 'aktivna'
  | 'expirovana'
  | 'done'
  | 'partial'
  | 'failed'
  | 'missed'
  | 'cancelled'
  | 'lapsed';

export const FILTER_OPTIONS: Array<{ value: CampaignFilterValue; label: string }> = [
  { value: 'all', label: 'všetky stavy' },
  { value: 'scheduled', label: 'naplánovaná' },
  { value: 'needs_key', label: 'vyžaduje kľúč' },
  { value: 'running', label: 'beží zápis' },
  { value: 'aktivna', label: 'aktívna' },
  { value: 'expirovana', label: 'expirovaná' },
  { value: 'done', label: 'zapísaná' },
  { value: 'partial', label: 'čiastočná' },
  { value: 'failed', label: 'zlyhala' },
  { value: 'missed', label: 'zmeškaná' },
  { value: 'cancelled', label: 'zrušená' },
  { value: 'lapsed', label: 'prepadnutá' },
  { value: 'draft', label: 'návrh' },
];

const VALID = new Set<string>(FILTER_OPTIONS.map((o) => o.value));

export interface CampaignFiltersProps {
  value: CampaignFilterValue;
  onChange: (value: CampaignFilterValue) => void;
}

export function CampaignFilters({ value, onChange }: CampaignFiltersProps) {
  return (
    <label className="ovl-small" data-testid="campaign-filters">
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (VALID.has(next)) onChange(next as CampaignFilterValue);
        }}
        aria-label="Filter stavu kampane"
      >
        {FILTER_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Server query pre daný filter; derivované pohľady idú ako `done`. */
export function filterToStatusQuery(value: CampaignFilterValue): string | null {
  if (value === 'all') return null;
  if (value === 'aktivna' || value === 'expirovana') return 'done';
  return value;
}

export default CampaignFilters;
