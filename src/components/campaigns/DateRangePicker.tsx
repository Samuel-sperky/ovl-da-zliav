'use client';

/**
 * Aura Zľavy — výber okna zľavy (D12, D13, I9).
 *
 * Kalendárové pickery s presetmi 7/14/30 dní a „do konca mesiaca".
 * Pod poľami je POVINNÝ výklad hraníc dňa (D13). Validácia okna
 * (`to ≥ from`, `from ≥ dnes`, ≤ 3 mesiace) beží lokálne pri každej zmene.
 */
import { addDays, endOfMonth, todayDateOnly, validateWindow } from '@/components/campaigns/api';
import { formatDateSk } from '@/lib/ui/format';

export const DAY_BOUNDS_EXPLANATION =
  'Zľava platí od 00:00 dňa OD do 23:59 dňa DO, čas shopu.';

export interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** Predĺženie (D19): `from` je zamknuté, edituje sa len `to`. */
  lockFrom?: boolean;
  disabled?: boolean;
}

export function DateRangePicker({ from, to, onChange, lockFrom, disabled }: DateRangePickerProps) {
  const error = from && to ? validateWindow(from, to) : null;
  const presetBase = from || todayDateOnly();

  const presets: Array<{ label: string; to: string }> = [
    { label: '7 dní', to: addDays(presetBase, 6) },
    { label: '14 dní', to: addDays(presetBase, 13) },
    { label: '30 dní', to: addDays(presetBase, 29) },
    { label: 'do konca mesiaca', to: endOfMonth(presetBase) },
  ];

  return (
    <div className="ovl-stack" data-testid="date-range-picker">
      <div className="ovl-row" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <label className="ovl-small">
          Od{' '}
          <input
            type="date"
            value={from}
            min={todayDateOnly()}
            disabled={disabled || lockFrom}
            onChange={(e) => onChange(e.target.value, to)}
            data-testid="date-from"
          />
        </label>
        <label className="ovl-small">
          Do{' '}
          <input
            type="date"
            value={to}
            min={from || todayDateOnly()}
            disabled={disabled}
            onChange={(e) => onChange(from, e.target.value)}
            data-testid="date-to"
          />
        </label>
      </div>
      <div className="ovl-row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="ovl-btn ovl-btn--small"
            disabled={disabled}
            onClick={() => onChange(presetBase, p.to)}
            title={`DO = ${formatDateSk(p.to)}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="ovl-small ovl-muted" data-testid="day-bounds-explanation">
        {DAY_BOUNDS_EXPLANATION}
      </p>
      {error ? (
        <p className="ovl-error ovl-small" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default DateRangePicker;
