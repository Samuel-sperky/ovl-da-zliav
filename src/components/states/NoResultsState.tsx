/**
 * Aura Zľavy — HĽADANIE NIČ NENAŠLO (D134; predloha `aura-roadmap`,
 * `NoResultsState`).
 *
 * PREČO TO NIE JE PRÁZDNY STAV
 * ----------------------------
 * „Nič tu nie je" a „nič takéto tu nie je" sú dve rôzne tvrdenia a majú dva
 * rôzne ďalšie kroky: prvé sa rieši vytvorením, druhé zrušením filtra. Kto ich
 * zlúči, pošle človeka zakladať zľavu, ktorá už dávno existuje — len ju
 * schoval filter. Zámena týchto dvoch je v tejto rodine tá najčastejšia a je to
 * dôvod, prečo je `NoResultsState` samostatný komponent, a nie prop.
 *
 * A je to zároveň dôvod, prečo veta hovorí „prázdny zoznam to neznamená". Bez
 * nej je prázdna tabuľka nerozlíšiteľná od prázdneho katalógu — a v tejto appke
 * to nie je teoretické: katalóg má 41 348 produktov, z ktorých je zrkadlo často
 * len čiastočne načítané, takže „nenašlo sa" musí vedieť povedať aj to, čo o
 * úplnosti vie.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Jedna akcia a je to ZRUŠENIE filtra**, nie vytvorenie dát. Text má
 *    `RESET_FILTERS_LABEL`, aby dve obrazovky nemali dve rôzne slová.
 * 2. **Keď obrazovka vie viac, hovorí SVOJU vetu.** `catalogEmptyView()`
 *    (`products/catalog-status.ts`) rozlišuje „medzi načítanými nič takéto nie
 *    je" od „katalóg je načítaný celý, takže je vinný filter" — to je presnejšie
 *    než čokoľvek, čo môže stáť tu, a preto to tento komponent NEPREPISUJE.
 *    Predvolené vety sú náhradník, nie pravda o katalógu.
 * 3. **Prázdny výsledok nie je nula.** Nikdy „0 výsledkov" — počet nájdených
 *    riadkov je vlastnosť filtra, nie vlastnosť katalógu.
 *
 * PREČO JE AKCIA SLOT A NIE `onResetFilters`
 * ------------------------------------------
 * Predloha berie callback a tlačidlo si nakreslí sama. Tu je akcia `ReactNode`,
 * rovnako ako v `EmptyState`: primitíva tejto appky sú server-safe (žiadne
 * hooky, žiadne `use client`) a ovládací prvok si vždy vlastní volajúci —
 * potrebuje na ňom `disabledReason` (D10), zámok alebo odkaz namiesto tlačidla.
 * Dva spôsoby, ako podať tú istú akciu, by sa o mesiac rozišli.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a (rodina stavov, D134).
 */
import type { ReactNode } from 'react';

import EmptyState from '@/components/states/EmptyState';
import { STATE_STORY } from '@/components/states/state-copy';

export interface NoResultsStateProps {
  /** Nadpis. Predvolene veta príbehu „hľadanie nič nenašlo". */
  title?: string;
  /** Jedna veta o tom, čo prázdny výsledok znamená. Predvolená je náhradník. */
  description?: ReactNode;
  /**
   * Jediná správna akcia: zrušenie filtrov. Slovo na tlačidle je
   * `RESET_FILTERS_LABEL` (`state-copy.ts`), samotný prvok kreslí volajúci —
   * pozri hlavičku modulu.
   */
  action?: ReactNode;
  /** Druhá veta (napr. `Note` o neúplnom zrkadle katalógu). */
  note?: ReactNode;
  /** Ozdobná značka nad nadpisom. */
  icon?: ReactNode;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function NoResultsState({
  title = STATE_STORY.hladanie.title,
  description = STATE_STORY.hladanie.meaning,
  action,
  note,
  icon,
  testId,
}: NoResultsStateProps) {
  return (
    <EmptyState
      story="hladanie"
      title={title}
      description={description}
      note={note}
      action={action}
      icon={icon}
      testId={testId}
    />
  );
}

export default NoResultsState;
