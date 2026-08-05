'use client';

/**
 * Aura Zľavy — vstup percenta zľavy (D11, I9).
 *
 * Prijíma VÝHRADNE celé čísla 1–30; desatiny a hodnoty mimo rozsahu sa
 * neprepustia ďalej. Čipy 5/10/15/20/25/30 sú rýchla voľba.
 */
import { PERCENT_MAX, PERCENT_MIN, validatePercent } from '@/components/campaigns/api';

const CHIPS = [5, 10, 15, 20, 25, 30] as const;

export interface PercentInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}

export function PercentInput({ value, onChange, disabled }: PercentInputProps) {
  const error = value == null ? null : validatePercent(value);

  function handleInput(raw: string) {
    if (raw === '') {
      onChange(null);
      return;
    }
    // Len číslice — desatinná čiarka/bodka sa vôbec neprijme (D11).
    if (!/^\d+$/.test(raw)) return;
    onChange(Number(raw));
  }

  return (
    <div className="ovl-stack" data-testid="percent-input">
      <label className="ovl-small" htmlFor="ovl-percent">
        Percento zľavy (celé číslo {PERCENT_MIN}–{PERCENT_MAX})
      </label>
      <div className="ovl-row" style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          id="ovl-percent"
          type="number"
          inputMode="numeric"
          min={PERCENT_MIN}
          max={PERCENT_MAX}
          step={1}
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === '.' || e.key === ',' || e.key === '-' || e.key === 'e') e.preventDefault();
          }}
          style={{ width: '6rem' }}
          aria-invalid={error != null}
        />
        <span aria-hidden="true">%</span>
        {CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className={`ovl-btn ovl-btn--small${value === chip ? ' ovl-btn--primary' : ''}`}
            disabled={disabled}
            onClick={() => onChange(chip)}
            data-testid={`percent-chip-${chip}`}
          >
            {chip} %
          </button>
        ))}
      </div>
      {error ? (
        <p className="ovl-error ovl-small" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default PercentInput;
