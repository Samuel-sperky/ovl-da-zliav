/**
 * Aura Zľavy — APPKA NA TO NEMÁ PRÍSTUP (D134; predloha `aura-roadmap`,
 * `ForbiddenState`).
 *
 * PORT, KTORÝ SA MUSEL PRELOŽIŤ, NIE ODPÍSAŤ (D142)
 * ------------------------------------------------
 * Predloha hovorí „Nemáte prístup. Na túto časť aplikácie nemáte oprávnenie.
 * Ak ho potrebujete, požiadajte správcu." — a v TEJTO appke by to boli tri
 * nepravdy v troch riadkoch. Appka nemá prihlásenie, nemá používateľov a nemá
 * práva (D98–D100); jediný actor je lokálny `samuel` a žiadny správca, ktorého
 * by šlo požiadať, neexistuje. Prevzatá veta by človeka poslala hľadať niekoho,
 * kto nie je.
 *
 * Prístup tu chýba APPKE, nie človeku. Reálne prípady sú tri a všetky sú
 * o kľúči a bránach, nie o oprávneniach:
 *
 *   · `shop_write` kľúč chýba alebo mu vypršala 48-hodinová platnosť,
 *   · zápisy sú zamknuté a čakajú na výslovné potvrdenie (I3, D106),
 *   · rozsah kľúča na túto vec nedosiahne (`key_scopes`, pilotný strop).
 *
 * Preto nadpis hovorí „Appka na to teraz nemá prístup" a cesta von vedie do
 * Nastavení, nie k správcovi. Slovo „teraz" tam je zámerne: všetky tri stavy sú
 * odstrániteľné a človek pri tomto počítači ich odstrániť môže.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **`reason` je POVINNÝ.** Zámok bez dôvodu je horší než žiadny zámok —
 *    človek si domyslí, že appka je pokazená, a má pravdu myslieť si to. To isté
 *    pravidlo má `LockBadge`, ktorý ten dôvod aj kreslí, takže tri kanály
 *    (zámok + slovo „Zamknuté" + veta) sú v ňom už poskladané.
 * 2. **Žiadne „skúsiť znova".** Zopakovanie požiadavky prístup nedá; tlačidlo,
 *    ktoré nemôže uspieť, je len slučka. Akcia tohto stavu je CESTA VON
 *    (odkaz do Nastavení), nie opakovanie.
 * 3. **Prázdno tu nie je odpoveď o obsahu.** Veta to musí povedať: appka sa
 *    nemala čím pozrieť, takže o tom, či tam niečo je, netvrdí nič.
 * 4. **Toto je VIZUÁL, nie brána.** Skutočnú bránu drží server (`I3`: dry-run
 *    a potvrdenie, `key_scopes`, rozsah zápisu). Kto by chcel týmto komponentom
 *    niečo zakázať, zakázal len kreslenie.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: V6a (rodina stavov, D134).
 */
import type { ReactNode } from 'react';

import EmptyState from '@/components/states/EmptyState';
import { STATE_STORY } from '@/components/states/state-copy';
import LockBadge from '@/components/ui/LockBadge';

export interface ForbiddenStateProps {
  /** Nadpis. Predvolene „Appka na to teraz nemá prístup". */
  title?: string;
  /** Jedna veta o tom, čo to znamená pre obsah obrazovky. */
  description?: ReactNode;
  /**
   * ČO appke chýba — slovenská veta, nie kód stavu (kód patrí do technického
   * detailu, P6). Povinné; pozri bod 1 hlavičky.
   */
  reason: ReactNode;
  /**
   * Cesta von: odkaz do Nastavení, potvrdenie, vloženie kľúča. Nikdy nie
   * „skúsiť znova" (bod 2).
   */
  action?: ReactNode;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function ForbiddenState({
  title = STATE_STORY.bez_pristupu.title,
  description = STATE_STORY.bez_pristupu.meaning,
  reason,
  action,
  testId,
}: ForbiddenStateProps) {
  return (
    <EmptyState
      story="bez_pristupu"
      title={title}
      description={description}
      note={<LockBadge reason={reason} />}
      action={action}
      testId={testId}
    />
  );
}

export default ForbiddenState;
