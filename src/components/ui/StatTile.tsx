/**
 * Aura Zľavy — KPI DLAŽDICA (predloha `sperky-admin.html` `.tile`; tvar
 * `StatCard` z `aura-roadmap` doňho ZLÚČENÝ, D142).
 *
 * Popis / hodnota / detail — tri riadky, jedno číslo. Trieda `.kpi`
 * (`.k` / `.v` / `.s`) v `globals.css` už existuje a používa ju Prehľad aj
 * Nastavenia; tento komponent ju **obaľuje**, nezavádza druhú.
 *
 * ═══ PRE KOHO HĽADÁ `StatCard.tsx`: NEEXISTUJE A NEMÁ VZNIKNÚŤ ═══
 * V6a preberá z `aura-roadmap` TVAR a PRAVIDLO, nie súbor (D142). Slepý port
 * by postavil `StatCard.tsx` vedľa tejto dlaždice a docblock
 * `primitives.module.css` to zakazuje vetou, ktorú si tento repo napísal sám:
 * *„druhá, takmer rovnaká sada tried by sa o mesiac rozišla s prvou"*.
 * Čo z predlohy pribudlo: `delta` (slot na `DeltaPill`), `accent` (vlas
 * zdôraznenia) a `icon`. Predlohovo sa `detail` volá `sub` — meno sa NEMENILO,
 * lebo by to bola tá istá vec pod dvoma menami a piati volajúci by sa
 * prepisovali bez dôvodu.
 *
 * ═══ SMER ZMENY UŽ NIE JE V DLAŽDICI ═══
 * Do V6a tu boli propy `trend` / `trendDetail` / `trendMeaning`: šípka a slovo
 * BEZ čísla, a bez štvrtého stavu „zmenu nevieme". Nemali ani jedného
 * volajúceho. Odteraz to nesie `ui/DeltaPill.tsx` a dlaždica má na ňu iba
 * slot `delta` — dve rôzne pilulky smeru v jednej appke sú presne ten dlh,
 * ktorý D142 zakazuje. Slovník smeru (`TREND_ICON`, `TREND_WORD`,
 * `trendTone`) zostal na svojom mieste v `ui/primitives.ts` a `DeltaPill`
 * ho POUŽÍVA; nezaniklo nič okrem druhého vykreslenia.
 *
 * ═══ TRI STAVY HODNOTY (I11) ═══
 * Hodnota smie byť ČÍSLO, POMLČKA „nevieme", alebo DOLNÁ HRANICA `≥ N`.
 * Dlaždica si stav odvodí z textu sama (`statValueMarks()` v `ui/kpi.ts`),
 * takže sa značka nemá ako rozísť s tým, čo je naozaj napísané — poslať
 * „nevieme" zvlášť vedľa textu je tá istá informácia dvakrát a raz sa rozíde.
 * `unknown` / `lowerBound` sa dajú zadať ručne LEN pre hodnoty, ktoré nie sú
 * reťazec (napr. `<Countdown/>`).
 *
 * Pomlčka je tlmená (`kpi.module.css`), dolná hranica NIE JE: `≥ 12` je
 * zmerané číslo, len neúplné, a jeho priznanie nesie znak `≥` a veta, nie
 * farba.
 *
 * ═══ ČO SA TU NESMIE POKAZIŤ ═══
 *
 * 1. **Hodnota je už naformátovaná.** Dlaždica nič nezaokrúhľuje ani
 *    neprepočítava; formátovanie patrí do `lib/ui/format.ts`, respektíve do
 *    `statValue()` v `ui/kpi.ts`. Keby počítala, to isté číslo by na dvoch
 *    obrazovkách vyšlo inak.
 * 2. **Chýbajúce číslo je pomlčka, nie nula.** Nula je tvrdenie.
 * 3. **`accent` NIE JE stav.** Teal ani zlatá nikdy nekódujú stav (stráži
 *    `test/unit/paleta.spec.ts`); vlas hovorí „pozri sa sem prvý". Na stav je
 *    stavová škála `--st-*` a tri kanály.
 * 4. **`icon` je dekorácia.** Stojí vedľa popisku, ktorý význam nesie, takže
 *    zostáva `aria-hidden` (bod D hlavičky `ui/Icon.tsx`). Prop berie
 *    `ReactNode`, nie meno ikony ani typ z knižnice (D146): ikony dodáva
 *    miestny `ui/Icon.tsx` a `lucide-react` sa v tomto repe nepoužíva.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1; zlúčenie so `StatCard` V6a.
 */
import type { ReactNode } from 'react';

import { hasNode, statValueMarks } from '@/components/ui/kpi';
import styles from '@/components/ui/kpi.module.css';

/** Vlas zdôraznenia nad dlaždicou. `gold` je pre JEDNU hlavnú dlaždicu radu. */
export type StatAccent = 'none' | 'accent' | 'gold';

export interface StatTileProps {
  /** Popis (`.k`) — čo sa meria. */
  label: string;
  /**
   * Hodnota (`.v`) — už naformátovaná: číslo, pomlčka `—`, alebo `≥ N`.
   * Pri reťazci si dlaždica stav odvodí sama.
   */
  value: ReactNode;
  /**
   * Detail (`.s`) — kontext pod hodnotou („za posledných 30 dní", „oproti
   * minulému týždňu"). V predlohe `aura-roadmap` sa ten istý riadok volá
   * `sub`; meno tu zostáva `detail`, aby existovalo jedno.
   */
  detail?: ReactNode;
  /**
   * Smer zmeny — obvykle `<DeltaPill/>`. Sadá na účiaru hodnoty, takže sa
   * číta ako jej doplnok, nie ako druhé číslo.
   */
  delta?: ReactNode;
  /** Zdôraznenie, NIE stav. Pozri bod 3 hlavičky. */
  accent?: StatAccent;
  /** Dekoratívna značka vpravo pri popisku, napr. `<Icon name="lock" />`. */
  icon?: ReactNode;
  /**
   * Ručné priznanie „nevieme" pre hodnoty, ktoré nie sú reťazec. Pri reťazci
   * ho neuvádzaj — odvodí sa z textu a nemá sa ako rozísť.
   */
  unknown?: boolean;
  /** Ručné „je to len dolná hranica" pre hodnoty, ktoré nie sú reťazec. */
  lowerBound?: boolean;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function StatTile({
  label,
  value,
  detail,
  delta,
  accent = 'none',
  icon,
  unknown,
  lowerBound,
  testId,
}: StatTileProps) {
  const marks = statValueMarks(value);
  const isUnknown = unknown ?? marks.unknown;
  const isLowerBound = lowerBound ?? marks.lowerBound;

  return (
    <div className={`kpi ${styles.tile}`} data-accent={accent} data-testid={testId}>
      <div className={styles.head}>
        <div className="k">{label}</div>
        {hasNode(icon) ? <span className={styles.headIcon}>{icon}</span> : null}
      </div>
      <div className={styles.valueRow}>
        <div
          className={`v ${styles.value}`}
          data-unknown={isUnknown ? 'ano' : 'nie'}
          data-lower-bound={isLowerBound ? 'true' : undefined}
        >
          {value}
        </div>
        {delta}
      </div>
      {hasNode(detail) ? <div className="s">{detail}</div> : null}
    </div>
  );
}

export default StatTile;
