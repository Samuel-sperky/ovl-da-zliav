/**
 * Aura Zľavy — ZÁMOK PRI ZAMKNUTEJ POLOŽKE (predloha `sperky-admin.html`,
 * `.lock`).
 *
 * Predloha vešala 🔒 na položky navigácie, ktoré kľúč neotvorí. Vzor preberáme
 * aj s tvrdým doplnkom, ktorý v predlohe chýbal: **zámok bez dôvodu je horší
 * než žiadny zámok**. Používateľ, ktorý vidí visiaci zámok a nevie prečo, si
 * domyslí, že appka je pokazená — a má pravdu myslieť si to.
 *
 * Preto je `reason` POVINNÝ prop. Nie je to formalita: presne toto je miesto,
 * kde sa v UI zvykne šetriť, a presne odtiaľto potom chodia otázky „prečo mi
 * to nejde".
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Zamknuté sa NESKRÝVA, len vypína.** Rovnaké pravidlo ako
 *    `Button.disabledReason` (D10) — skrytá akcia sa nedá pochopiť, vypnutá
 *    s dôvodom áno. Kto chce položku skryť, nemá siahať po tomto komponente.
 * 2. **Zámok je dekorácia, dôvod je obsah.** Emodži má `aria-hidden`; čítačke
 *    zostáva slovo „Zamknuté" a veta prečo. Bez toho by čítačka prečítala
 *    „zamknuté" ako názov obrázka a stratila by dôvod.
 * 3. **Dôvod je veta, nie kód.** „Kľúč nemá právo zapisovať do shopu", nie
 *    názov práva ani stavový kód — ten patrí do technického detailu (P6).
 *
 * Vzhľad dedí `.locked-note` z `globals.css` (prerušovaný rámik, tlmená
 * farba), ktorý na tento účel v appke už existuje — druhý takmer rovnaký
 * štýl by sa časom rozišiel s prvým.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1.
 */
import type { ReactNode } from 'react';

export interface LockBadgeProps {
  /**
   * Prečo je položka zamknutá — slovenská veta, ktorá povie, čo s tým.
   * Povinné: zámok bez dôvodu sa v tejto appke nekreslí.
   */
  reason: ReactNode;
  /** Krátky názov stavu pred dôvodom. Predvolene „Zamknuté". */
  label?: string;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function LockBadge({ reason, label = 'Zamknuté', testId }: LockBadgeProps) {
  return (
    <span className="locked-note" data-testid={testId}>
      <span aria-hidden="true">🔒</span>
      <span>
        <strong>{label}</strong> — {reason}
      </span>
    </span>
  );
}

export default LockBadge;
