/**
 * Aura Zľavy — KPI RIADOK PREHĽADU (V7: D148, D152, D154).
 *
 * TRI karty nad grafom: koľko produktov appka pozná · koľko z nich práve
 * zlacnila · ako rýchlo sa tovar hýbe. Čo v ktorej karte stojí, prečo v tomto
 * poradí a kedy sa smie kresliť pomlčka miesto čísla, rozhoduje
 * `kpi-row-model.ts` — tu je len vykreslenie, aby sa pravdivosť radu dala
 * dokázať bez prehliadača.
 *
 * ═══ PREČO TRI A NIE ŠTYRI (D152) ═══
 * V6 mal štyri dlaždice (predané kusy, tržba celého eshopu, bežiace zľavy,
 * obohatené z katalógu) a Samuel označil „priveľa vecí na obrazovke" ako jednu
 * zo štyroch príčin nečitateľnosti. Rad sa preto zúžil na tri karty, ktoré
 * odpovedajú na tri otázky prvej strany; tržba celého eshopu ani stav dávky
 * obohacovania z appky nezmizli — žijú tam, kde majú vlastný kontext
 * (sekcia Predaj, respektíve Nastavenia).
 *
 * ═══ PRIMITÍVA, NIE VLASTNÉ TRIEDY (D142) ═══
 * Kartu kreslí `ui/StatTile` a smer `ui/DeltaPill` — obe z vrstvy V6a. Vlastný
 * „kpi" blok tu NEVZNIKÁ: výplň a tri riadky (`.k`/`.v`/`.s`) dedia primitíva
 * z `globals.css` a `kpi-row.module.css` pridáva len to, čo D154 žiada —
 * TRI rovnaké diely mriežky a číslo ~40 px s tabulárnymi číslicami.
 *
 * ═══ ČO SA TU NESMIE POKAZIŤ ═══
 *
 * 1. **Hodnota ide do karty ako TEXT, ktorý už rozhodol model.** Značku
 *    „nevieme" / „dolná hranica" si `StatTile` odvodí z toho istého textu
 *    (`statValueMarks()`), takže sa nemá ako rozísť s tým, čo je napísané.
 *    Posielať ju zvlášť by bola tá istá informácia dvakrát.
 * 2. **Pilulka smeru sa kreslí len tam, kde porovnanie EXISTUJE.**
 *    `delta === null` znamená „táto karta porovnanie nemá" (počet riadkov
 *    zrkadla a počet bežiacich zliav sú momentky, nie meranie za obdobie) — a
 *    to nie je to isté ako „zmenu nevieme", ktoré povie pilulka pri
 *    `value: null`. Nula sa ako zmena nekreslí NIKDY.
 * 3. **Zlatý vlas má JEDNA karta.** `accent` prideľuje model a test to stráži;
 *    dva vlasy neznamenajú nič.
 * 4. **Rad musí vyzerať dobre PRÁZDNY** (R4). Appka je dnes bez `shop_write`
 *    kľúča a jej IP je zabanovaná, takže tri pomlčky sú BEŽNÝ stav, nie
 *    výnimka — karta preto nemá „prázdny" variant a pomlčka je v nej riadna
 *    hodnota s vlastnou tlmenou farbou (`ui/kpi.module.css`).
 *
 * Prepínač okna NAD radom kreslí `SoldWindowSwitch` a vlastní ho `Overview` —
 * platí pre karty AJ pre tabuľku (D155), takže nesmie patriť len tomuto radu.
 *
 * Server-safe: žiadne hooky, žiadny `fetch`, žiadne `use client`. Dáta ťahá
 * `Overview` a posiela ich sem hotové.
 *
 * Vlastník: V7, krok 1/4 (KPI riadok a prepínače okna).
 */
import styles from '@/components/dashboard/kpi-row.module.css';
import { kpiCards, type KpiRowInput } from '@/components/dashboard/kpi-row-model';
import DeltaPill from '@/components/ui/DeltaPill';
import StatTile from '@/components/ui/StatTile';

export type KpiRowProps = KpiRowInput;

export function KpiRow(props: KpiRowProps) {
  const cards = kpiCards(props);

  return (
    <div className={`kpis ${styles.row}`} data-testid="overview-kpi">
      {cards.map((card) => (
        <StatTile
          key={card.id}
          testId={`kpi-${card.id}`}
          label={card.label}
          value={card.value.text}
          detail={card.detail}
          accent={card.accent}
          delta={
            card.delta === null ? undefined : (
              <DeltaPill
                testId={`kpi-delta-${card.id}`}
                value={card.delta.value}
                suffix={card.delta.suffix}
                digits={card.delta.digits}
                sense={card.delta.sense}
                /* `null` v modeli = „nechaj predvolené priznanie pilulky";
                   prázdny reťazec by ho prebil vetou o ničom. */
                title={card.delta.title === null ? undefined : card.delta.title}
              />
            )
          }
        />
      ))}
    </div>
  );
}

export default KpiRow;
