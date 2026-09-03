'use client';

/**
 * Aura Zľavy — PREPÍNAČ OKNA PRE KARTY A TABUĽKU (V7, D155).
 *
 * Prvý z dvoch prepínačov Prehľadu. Stojí NAD radom KPI kariet a platí pre
 * karty AJ pre tabuľku pod grafom — stĺpce „predané za okno" a „predané/sklad"
 * sú tá istá veličina, akú nesie tretia karta, takže tabuľka je jej rozpis.
 * Zoznam okien a prevod hodnôt vlastní `sold-window.ts`; tu je len vykreslenie.
 *
 * ═══ PREČO NIE `WindowSwitch.tsx` ═══
 * `WindowSwitch` je prepínač 7/30/90 pre GRAF a sekcie, ktoré s ním idú
 * (`WINDOW_DAYS_ALLOWED` na čítacích endpointoch). Toto je iná veličina, iný
 * zoznam okien (30/60/90/180/360) a iný rozsah platnosti; jeden komponent pre
 * oboje by musel dostať prepínač „ktorý som" a to je dva komponenty v jednom.
 * Vzhľad sa pritom NEDUPLIKUJE — kreslí ho `ui/Segmented` (D142), ten istý,
 * ktorý má nahradiť aj staré `.seg`.
 *
 * ═══ ROZSAH PLATNOSTI JE NAPÍSANÝ, NIE TUŠENÝ ═══
 * Dva prepínače na jednej obrazovke potrebujú povedať, čoho sa ktorý týka —
 * inak človek prepne okno kariet a čaká, že sa prekreslí aj graf. Preto má
 * rail viditeľný popis a vetu „Platí pre karty aj tabuľku"; `aria-label`
 * skupiny hovorí to isté, aby to nebolo len pre oči.
 *
 * ═══ TRI KANÁLY VÝBERU ═══
 * Nesie ich `Segmented`: farba, zdvihnutá plocha s okrajom a `aria-checked` na
 * tom istom uzle. Tento komponent k tomu žiadny štvrtý kanál nepridáva a ani
 * jeden neuberá.
 *
 * Vlastník: V7, krok 1/4 (KPI riadok a prepínače okna).
 */
import styles from '@/components/dashboard/sold-window.module.css';
import {
  soldWindowFromValue,
  soldWindowOptions,
  soldWindowValue,
  type SoldWindow,
} from '@/components/dashboard/sold-window';
import Segmented from '@/components/ui/Segmented';

/** Veta o rozsahu platnosti. Jedna formulácia — dve by sa raz rozišli. */
export const SOLD_WINDOW_SCOPE_NOTE = 'Platí pre karty aj tabuľku.';

export interface SoldWindowSwitchProps {
  value: SoldWindow;
  onChange: (value: SoldWindow) => void;
}

export function SoldWindowSwitch({ value, onChange }: SoldWindowSwitchProps) {
  return (
    <div className={styles.rail} data-testid="overview-sold-window">
      <span className={styles.label}>Okno predaja</span>
      <Segmented
        value={soldWindowValue(value)}
        onChange={(raw) => {
          /*
           * Fail-closed: hodnota mimo zoznamu okno NEMENÍ. Tichý fallback na
           * 30 by prekreslil karty za iné obdobie, než na ktoré človek klikol.
           * Porovnáva sa výslovne — Turbopack tu už raz skrátený guard zahodil.
           */
          const days = soldWindowFromValue(raw);
          if (days === null) return;
          onChange(days);
        }}
        options={soldWindowOptions()}
        ariaLabel="Za koľko dní sa počítajú karty prehľadu a tabuľka produktov"
        size="sm"
        testId="overview-sold-window-segmented"
      />
      <span className={styles.note}>{SOLD_WINDOW_SCOPE_NOTE}</span>
    </div>
  );
}

export default SoldWindowSwitch;
