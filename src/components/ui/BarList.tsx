/**
 * Aura Zľavy — VODOROVNÝ REBRÍK (D133, D136; predloha `aura-roadmap/BarList`).
 *
 * „Čo je najviac a čo najmenej" ako zoznam: popis, číslo, pod nimi pás. Je to
 * POROVNANIE MEDZI POLOŽKAMI (D126), teda tá istá otázka, na akú odpovedá
 * stĺpcový graf — len v tvare, ktorý sa zmestí do karty a dá sa preklikať.
 *
 * ČO SA Z PREDLOHY NEPREVZALO — A PREČO
 * -------------------------------------
 *
 * 1. **Vlastná mierka.** Predloha si počítala `max` z položiek sama. Tu ju
 *    počíta `barLayout()` z `ui/chart-language.ts` a pás kreslí `RowBar`
 *    z `ui/Charts.tsx` — jedno pravidlo osi pre celú appku (K5). Keď majú byť
 *    dva rebríky porovnateľné (top a flop toho istého merania), mierka sa
 *    vypočíta RAZ cez `barListBars(barListInputs(a), barListInputs(b))`
 *    a podá sa oboma zoznamom; inak by najslabší produkt flopu mal pás cez
 *    celý riadok a vyzeral by ako najpredávanejší.
 *
 * 2. **Farba na položku.** Predloha cyklila kategorickú paletu
 *    (`--chart-1..8`) podľa poradia. Tu je zakázaná: rebrík je JEDNA séria
 *    a osem farieb by tvrdilo osem kategórií. Veľkosť sa kreslí sekvenčnou
 *    rampou (`--seq-teal-*` v `RowBar`) a stavová škála ani značková zlatá do
 *    grafu nesmú vôbec (`test/unit/grafy-paleta.spec.ts`).
 *
 * 3. **`value: number`.** Tu je `number | null`, pretože položka BEZ merania
 *    nesmie dostať nulový pás — nula je odpoveď a toto ňou nie je (I11).
 *    Dostane šrafovaný pahýľ (`RowBar`), pomlčku namiesto čísla a SLOVO
 *    „nevieme" v poznámke riadku. Tri kanály, aj tu.
 *
 * `≥ 0` SA NEVYKRESLÍ NIKDY
 * -------------------------
 * Dolná hranica nula nie je priznanie, ale prázdna veta. Rozhoduje o tom
 * `statValue()` v `ui/kpi.ts` a rebrík z toho ROVNAKO odvodí aj pás: keď je
 * z čísla pomlčka, pás je šrafovaný. Keby si pás bral surové `value`, riadok
 * by ukázal priznanie a vedľa neho zmeraný stĺpec.
 *
 * PREČO POD REBRÍKOM NIE JE DÁTOVÁ TABUĽKA
 * ----------------------------------------
 * Tabuľkou je sám zoznam — každý riadok nesie svoje číslo slovom, takže pás je
 * druhý kanál nad ním a je `aria-hidden` (pozri `RowBar`). Prilepiť pod zoznam
 * ešte tabuľku by tie isté čísla zdvojilo.
 *
 * Sám nemá hooky ani direktívu, ale pás si berie z `ui/Charts.tsx`, ktorý je
 * `'use client'` — rebrík je teda hranica klienta, nie čisto serverový
 * primitív. Je to vedomá cena za jedno šrafovanie v celej appke.
 *
 * Vlastník: V6a, KPI skupina.
 */
import type { ReactNode } from 'react';

import { RowBar } from '@/components/ui/Charts';
import { UNKNOWN_WORD, type Bar, type BarInput } from '@/components/ui/chart-language';
import {
  barListBars,
  barListUnknownSentence,
  hasNode,
  statValue,
  type StatValueView,
} from '@/components/ui/kpi';
import styles from '@/components/ui/kpi.module.css';

/*
 * Mierku vlastní `ui/kpi.ts`; tu sa len prepošle, aby volajúci nemusel
 * skladať rebrík z dvoch modulov. Je to re-export, nie druhá definícia.
 */
export { barListBars };

export interface BarListItem {
  /** Kľúč riadku. Nesie ho aj mierka, takže musí byť v skupine jedinečný. */
  readonly key: string;
  /** Popis riadku. Reťazec dostane aj `title`, aby sa dal prečítať celý. */
  readonly label: ReactNode;
  /**
   * Zmeraná hodnota, alebo `null` = **nemerané**. NIE nula — nula je odpoveď,
   * `null` je jej absencia.
   */
  readonly value: number | null;
  /**
   * Hotový text čísla, keď to nie sú kusy (percentá, eurá). Bez neho sa píše
   * slovenskými tisíckami (`formatCountSk`), ktoré číslo skracujú na celé.
   */
  readonly display?: string;
  /** `true` = číslo je len DOLNÁ HRANICA (okno nie je dočítané) → `≥ N`. */
  readonly lowerBound?: boolean;
  /**
   * Poznámka pod riadkom. Pri pomlčke je POVINNÝ tretí kanál, takže keď ju
   * volajúci nedá, doplní sa slovo „nevieme" — vypnúť sa to nedá.
   */
  readonly note?: ReactNode;
  /** Veta pod kurzorom na čísle: prečo hranica, prečo pomlčka. */
  readonly title?: string;
}

export interface BarListProps {
  readonly items: readonly BarListItem[];
  /**
   * Pásy z JEDNEJ mierky pre viac rebríkov (`barListBars()`). Bez nich si
   * zoznam mierku spočíta sám zo svojich položiek.
   */
  readonly bars?: ReadonlyMap<string, Bar>;
  /** Čo sa napíše namiesto prázdneho zoznamu. Bez neho sa nekreslí nič. */
  readonly empty?: ReactNode;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  readonly testId?: string;
}

/**
 * Ako sa riadok premení na jedno číslo. Jedno miesto pre číslo aj pre pás —
 * pozri „`≥ 0` sa nevykreslí nikdy" v hlavičke.
 */
function viewOf(item: BarListItem): StatValueView {
  const display = item.display;
  return statValue(item.value, {
    lowerBound: item.lowerBound,
    format: display === undefined ? undefined : () => display,
  });
}

/**
 * Položky → vstup mierky. Používa sa aj zvonku, keď dva rebríky majú mať
 * jednu mierku: `barListBars(barListInputs(top), barListInputs(flop))`.
 *
 * Hodnota, z ktorej sa stalo priznanie, ide do mierky ako `null` — inak by
 * riadok ukázal pomlčku a pod ňou zmeraný pás.
 */
export function barListInputs(items: readonly BarListItem[]): readonly BarInput[] {
  return items.map((item) => ({
    key: item.key,
    value: viewOf(item).unknown ? null : item.value,
  }));
}

/**
 * Poznámka riadku. Pri pomlčke sa slovo doplní VŽDY — aj keď volajúci pošle
 * `null`. Riadok bez slova je porušenie pravidla troch kanálov, o ktorom sa
 * nikto nedozvie.
 */
function noteOf(item: BarListItem, unknown: boolean): ReactNode {
  if (hasNode(item.note)) return item.note;
  return unknown ? UNKNOWN_WORD : null;
}

export function BarList({ items, bars, empty, testId }: BarListProps) {
  if (items.length === 0) {
    if (!hasNode(empty)) return null;
    return (
      <p className={styles.empty} data-testid={testId}>
        {empty}
      </p>
    );
  }

  /* Bez podanej mierky si ju zoznam spočíta zo seba — tou istou funkciou. */
  const scale = bars === undefined ? barListBars(barListInputs(items)) : bars;

  const views = items.map((item) => ({ item, view: viewOf(item) }));
  const unknownCount = views.filter(({ view }) => view.unknown).length;
  const listNote = barListUnknownSentence(unknownCount, items.length);

  return (
    <>
      <ul className={styles.list} data-testid={testId}>
        {views.map(({ item, view }) => {
          const bar = scale.get(item.key);
          const note = noteOf(item, view.unknown);
          return (
            <li className={styles.row} key={item.key} data-testid="bar-list-row">
              <span
                className={styles.label}
                title={typeof item.label === 'string' ? item.label : undefined}
              >
                {item.label}
              </span>
              <span
                className={styles.value}
                data-unknown={view.unknown ? 'ano' : 'nie'}
                data-lower-bound={view.lowerBound ? 'true' : undefined}
                title={item.title}
              >
                {view.text}
              </span>
              {bar === undefined ? null : <RowBar bar={bar} />}
              {note === null ? null : <span className={styles.note}>{note}</span>}
            </li>
          );
        })}
      </ul>
      {listNote === null ? null : (
        <p className={styles.listNote} data-testid="bar-list-unknown">
          {listNote}
        </p>
      )}
    </>
  );
}

export default BarList;
