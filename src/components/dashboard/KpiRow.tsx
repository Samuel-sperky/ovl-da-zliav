/**
 * Aura Zľavy — KPI RIADOK PREHĽADU (D136, V6b krok 1/3).
 *
 * Štyri dlaždice nad hlavným grafom: **číslo najprv, priebeh druhý.** Čo
 * v ktorej dlaždici stojí, prečo v tomto poradí a kedy sa smie kresliť pomlčka
 * miesto čísla, rozhoduje `kpi-row-model.ts` — tu je len vykreslenie, aby sa
 * pravdivosť radu dala dokázať bez prehliadača.
 *
 * ═══ PRIMITÍVA, NIE VLASTNÉ TRIEDY (K4) ═══
 * Dlaždicu kreslí `ui/StatTile` a smer `ui/DeltaPill` — obe z vrstvy V6a.
 * Vlastný „kpi" blok tu NEVZNIKÁ: geometriu (`.kpis` mriežka, `.kpi` výplň,
 * tri riadky `.k`/`.v`/`.s`) dedia primitíva z `globals.css` a jediné, čo
 * pridáva `kpi-row.module.css`, sú štyri rovnaké diely mriežky.
 *
 * ═══ ČO SA TU NESMIE POKAZIŤ ═══
 *
 * 1. **Hodnota ide do dlaždice ako TEXT, ktorý už rozhodol model.** Značku
 *    „nevieme" / „dolná hranica" si `StatTile` odvodí z toho istého textu
 *    (`statValueMarks()`), takže sa nemá ako rozísť s tým, čo je napísané.
 *    Posielať ju zvlášť by bola tá istá informácia dvakrát.
 * 2. **Pilulka smeru sa kreslí len tam, kde porovnanie EXISTUJE.** `delta ===
 *    null` znamená „táto dlaždica porovnanie nemá" (počet bežiacich zliav je
 *    momentka, nie meranie za obdobie) — a to nie je to isté ako „zmenu
 *    nevieme", ktoré povie pilulka pri `value: null`. Nula sa ako zmena
 *    nekreslí NIKDY.
 * 3. **Zlatý vlas má JEDNA dlaždica.** `accent` prideľuje model a test to
 *    stráži; dva vlasy neznamenajú nič.
 * 4. **Rad musí vyzerať dobre PRÁZDNY** (R4 kontraktu V6). Appka je dnes bez
 *    `shop_write` kľúča, takže štyri pomlčky sú BEŽNÝ stav, nie výnimka —
 *    dlaždica preto nemá „prázdny" variant a pomlčka je v nej riadna hodnota
 *    s vlastnou tlmenou farbou (`ui/kpi.module.css`).
 *
 * Server-safe: žiadne hooky, žiadny `fetch`, žiadne `use client`. Dáta ťahá
 * `Overview` a posiela ich sem hotové.
 *
 * Vlastník: V6b, KPI riadok Prehľadu.
 */
import styles from '@/components/dashboard/kpi-row.module.css';
import { kpiTiles, type KpiRowInput } from '@/components/dashboard/kpi-row-model';
import DeltaPill from '@/components/ui/DeltaPill';
import StatTile from '@/components/ui/StatTile';

export type KpiRowProps = KpiRowInput;

export function KpiRow(props: KpiRowProps) {
  const tiles = kpiTiles(props);

  return (
    <div className={`kpis ${styles.row}`} data-testid="overview-kpi">
      {tiles.map((tile) => (
        <StatTile
          key={tile.id}
          testId={`kpi-${tile.id}`}
          label={tile.label}
          value={tile.value.text}
          detail={tile.detail}
          accent={tile.accent}
          delta={
            tile.delta === null ? undefined : (
              <DeltaPill
                testId={`kpi-delta-${tile.id}`}
                value={tile.delta.value}
                suffix={tile.delta.suffix}
                digits={tile.delta.digits}
                sense={tile.delta.sense}
                /* `null` v modeli = „nechaj predvolené priznanie pilulky";
                   prázdny reťazec by ho prebil vetou o ničom. */
                title={tile.delta.title === null ? undefined : tile.delta.title}
              />
            )
          }
        />
      ))}
    </div>
  );
}

export default KpiRow;
