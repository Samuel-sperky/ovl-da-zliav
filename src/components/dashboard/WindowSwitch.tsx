'use client';

/**
 * Aura Zľavy — PREPÍNAČ OKNA PREHĽADU 7 / 30 / 90 dní (V4, kontrakt §2 bod 2).
 *
 * Jeden prepínač pre CELÚ obrazovku, nie jeden na sekciu. Dôvod nie je šetrenie
 * miestom: graf, rebríček a tržba odpovedajú na tú istú otázku za to isté
 * obdobie, a keby si každá sekcia držala vlastné okno, ležali by na obrazovke
 * vedľa seba tri čísla za tri rôzne obdobia — a všetky by vyzerali rovnako
 * dôveryhodne.
 *
 * `role="group"` nie je ozdoba: na `<div>` bez roly je `aria-label` podľa ARIA
 * neplatný a čítačke by z prepínača zostalo len „7, 30, 90" bez toho, čo tie
 * čísla znamenajú.
 *
 * Vzhľad je `.seg` z `globals.css` — ten istý prepínač, aký majú Produkty a
 * detail panel. Žiadna nová trieda, žiadny nový vzhľad.
 *
 * Vlastník: V4.
 */
import type { OverviewWindow } from '@/components/dashboard/overview-model';
import { OVERVIEW_WINDOWS } from '@/components/dashboard/overview-model';

export interface WindowSwitchProps {
  value: OverviewWindow;
  onChange: (value: OverviewWindow) => void;
}

export function WindowSwitch({ value, onChange }: WindowSwitchProps) {
  return (
    <div
      className="seg"
      role="group"
      aria-label="Za koľko dní sa počítajú predaje a rebríček"
      data-testid="overview-window"
    >
      {OVERVIEW_WINDOWS.map((days) => (
        <button
          key={days}
          type="button"
          className={days === value ? 'on' : undefined}
          aria-pressed={days === value}
          onClick={() => onChange(days)}
        >
          {days}
        </button>
      ))}
    </div>
  );
}

export default WindowSwitch;
