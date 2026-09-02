/**
 * Aura Zľavy — PILULKA SMERU ZMENY (D133, predloha `aura-roadmap/DeltaPill`).
 *
 * Stojí na účiare hodnoty v `StatTile` a odpovedá na otázku „a oproti čomu?".
 * Vo svojej predlohe to bola šípka a číslo; tu má **štyri stavy, nie tri**,
 * a to je celý dôvod, prečo sa neportovala doslova.
 *
 * ŠTVRTÝ STAV: „ZMENU NEVIEME" (I11)
 * ----------------------------------
 * Appka je dnes bez `shop_write` kľúča a väčšina KPI sú pomlčky — porovnanie
 * s minulým obdobím teda často NEEXISTUJE. Predloha brala `value: number`,
 * takže volajúci bez porovnania musel poslať `0`, a pilulka by napísala
 * „bez zmeny 0 %“. To je TVRDENIE o niečom, čo appka nezmerala; presne to
 * zakazuje I11. Preto `value` prijíma `null` a pilulka vtedy povie pomlčkou
 * a slovom, že zmenu nepozná.
 *
 * `NaN` a `±Infinity` (pokazený menovateľ) sú tiež „nevieme", nie „bez zmeny" —
 * predloha ich mapovala na `flat`, čo by dalo slovo „bez zmeny" vedľa textu
 * „NaN". Rozhodovanie je v `ui/kpi.ts`, aby sa dalo zmerať bez vykresľovania.
 *
 * TRI KANÁLY, VŽDY VŠETKY TRI
 * ---------------------------
 * Farba (tón) + značka (šípka, alebo pomlčka pri „nevieme") + SLOVO
 * („nárast", „pokles", „bez zmeny", „zmenu nevieme"). Slovo sa nedá vypnúť
 * a **zámerne tu nie je žiadny prop `compact`, ktorý by ho skryl** — šípka
 * sama je pod deuteranopiou aj pre čítačku obrazovky príliš málo (pozri
 * hlavičku `ui/ToneBadge.tsx`). Poradie je to isté, aké mala do V6a dlaždica
 * vo svojom riadku smeru: značka, slovo, číslo.
 *
 * SMER SÁM NEHODNOTÍ
 * ------------------
 * Predvolený `sense` je `neutral` a pilulka vtedy NEFARBÍ. Rastúci obrat je
 * dobrá správa, rastúci počet neúspešných zápisov nie — a pilulka nemá ako
 * vedieť, ktoré z toho číta. Predloha na to mala `invert?: boolean`, ktorý
 * vie povedať len „obráť to"; „nehodnoť to" povedať nevie, a to je práve
 * predvolený stav tejto appky (`ui/StatTile.tsx`, 19. 8. 2026).
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a, KPI skupina.
 */
import Icon from '@/components/ui/Icon';
import {
  DELTA_ICON,
  DELTA_UNKNOWN_TITLE,
  DELTA_WORD,
  KPI_UNKNOWN,
  deltaState,
  deltaTone,
  formatDeltaSk,
  roundDelta,
  type DeltaSense,
} from '@/components/ui/kpi';
import styles from '@/components/ui/kpi.module.css';

export type { DeltaSense };

export interface DeltaPillProps {
  /**
   * Zmena so znamienkom. `null`/`undefined` = **zmenu nevieme**, a to nie je
   * nula: pilulka vtedy nakreslí pomlčku a povie to slovom.
   */
  value: number | null | undefined;
  /** Jednotka za číslom (`%`, `ks`). Pripojí sa medzerou, nikdy sa nezlomí. */
  suffix?: string;
  /** Desatinné miesta. Smer sa určuje z už zaokrúhleného čísla (`ui/kpi.ts`). */
  digits?: number;
  /**
   * Čo znamená RAST tohto čísla. Bez neho pilulka nefarbí — appka nehodnotí
   * smer, kým jej to volajúci nepovie.
   */
  sense?: DeltaSense;
  /**
   * Veta pod kurzorom: oproti čomu sa meria, alebo prečo porovnanie chýba.
   * Pri „nevieme" má predvolenú hodnotu, takže priznanie nikdy nie je nahé.
   *
   * Obdobie porovnania patrí VIDITEĽNE do `detail` dlaždice, nie sem —
   * `title` nie je náhrada za text na obrazovke a čítačky ho nečítajú vždy.
   */
  title?: string;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function DeltaPill({
  value,
  suffix,
  digits = 0,
  sense = 'neutral',
  title,
  testId,
}: DeltaPillProps) {
  /* Najprv zaokrúhli, potom sa pýtaj na smer — inak by pilulka pri +0,4 %
     a nule desatinných miest napísala „nárast +0". */
  const shown = roundDelta(value, digits);
  const state = deltaState(shown);
  const tone = deltaTone(state, sense);
  const icon = DELTA_ICON[state];
  const unit = suffix === undefined || suffix === '' ? '' : ` ${suffix}`;
  const hint = title ?? (state === 'unknown' ? DELTA_UNKNOWN_TITLE : undefined);

  return (
    <span
      className={styles.delta}
      data-tone={tone}
      data-delta={state}
      data-testid={testId}
      title={hint}
    >
      {icon === null ? (
        /* Značka priznania je TEXTOVÁ pomlčka — ten istý znak ako v tabuľkách. */
        <span className={styles.deltaDash} aria-hidden="true">
          {KPI_UNKNOWN}
        </span>
      ) : (
        <Icon className={styles.deltaGlyph} name={icon} size={0.85} />
      )}
      <span className={styles.deltaWord}>{DELTA_WORD[state]}</span>
      {state === 'unknown' ? null : (
        <span className={styles.deltaValue}>
          {formatDeltaSk(shown, digits)}
          {unit}
        </span>
      )}
    </span>
  );
}

export default DeltaPill;
