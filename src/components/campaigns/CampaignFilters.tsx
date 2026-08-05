'use client';

/**
 * Aura Zľavy — filter zoznamu kampaní (D14).
 *
 * Plná sada stavov vrátane derivovaných UI pohľadov „aktívna"/„expirovaná"
 * (§4) — tie sa na server mapujú ako `status=done` a rozlíši ich klient.
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

const OPTIONS: Array<{ value: CampaignFilterValue; label: string }> = [
  { value: 'all', label: 'všetky' },
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

export interface CampaignFiltersProps {
  value: CampaignFilterValue;
  onChange: (value: CampaignFilterValue) => void;
}

export function CampaignFilters({ value, onChange }: CampaignFiltersProps) {
  return (
    <div className="ovl-row" style={{ gap: '0.35rem', flexWrap: 'wrap' }} data-testid="campaign-filters">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`ovl-btn ovl-btn--small${value === o.value ? ' ovl-btn--primary' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Server query pre daný filter; derivované pohľady idú ako `done`. */
export function filterToStatusQuery(value: CampaignFilterValue): string | null {
  if (value === 'all') return null;
  if (value === 'aktivna' || value === 'expirovana') return 'done';
  return value;
}

export default CampaignFilters;
