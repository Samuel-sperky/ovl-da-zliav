/**
 * Aura Zľavy — POUČNÝ PRÁZDNY STAV (predloha `sperky-admin.html`, `.empty`).
 *
 * Predloha nikde nenapísala „žiadne dáta". Namiesto toho písala vety typu
 * „Načítaj katalóg — vyhľadávanie potom beží okamžite lokálne, bez ďalších
 * požiadaviek" alebo „Nastav filtre a vyhľadaj". To je celý vzor a je to
 * jediná vec, ktorá sa tu nesmie stratiť: **prázdna obrazovka má povedať, čo
 * tam má byť a ako sa to tam dostane.**
 *
 * „Žiadne dáta" je totiž z pohľadu používateľa nerozlíšiteľné od poruchy.
 * Prázdny zoznam zliav môže znamenať štyri rôzne veci (ešte žiadna nevznikla /
 * filter nič nenašiel / kľúč nedovolí čítať / appka nedosiahla na shop) a len
 * jedna z nich je nudná.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **`description` je POVINNÝ.** Prázdny stav bez vysvetlenia sa v tejto
 *    appke nekreslí. Keby bol voliteľný, o mesiac by ho polovica volajúcich
 *    vynechala a vzniklo by „žiadne dáta" zadnými dverami.
 * 2. **Prázdno nie je chyba.** Žiadna červená, žiadny výkričník. Keď je
 *    prázdno DÔSLEDKOM chyby, patrí tam `Note variant="err"`, nie zafarbený
 *    prázdny stav.
 * 3. **Akcia je voliteľná, ale ak je, má byť tá jedna správna.** Nie tri
 *    tlačidlá — jedna cesta von.
 *
 * Vzhľad dedí `.ovl-empty` z `globals.css` (vycentrovaný stĺpec s tlmeným
 * textom), ktorý v appke už existuje.
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1.
 */
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Nadpis — čo tu má byť. Krátko, slovensky. */
  title: string;
  /** Vysvetlenie — ako sa to sem dostane. Povinné, pozri hlavičku modulu. */
  description: ReactNode;
  /** Jedna akcia, ktorá prázdno vyrieši (tlačidlo, odkaz). Voliteľné. */
  action?: ReactNode;
  /**
   * Ozdobná značka nad nadpisom (glyf alebo ikona). Dekoratívna — nesmie
   * niesť význam, ktorý nie je v texte.
   */
  icon?: ReactNode;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function EmptyState({ title, description, action, icon, testId }: EmptyStateProps) {
  return (
    <div className="ovl-empty" data-testid={testId}>
      {icon ? (
        <span className="ovl-empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export default EmptyState;
