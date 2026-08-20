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
 *    vynechala a vzniklo by „žiadne dáta" zadnými dverami. Toto sa 20. 8. 2026
 *    znovu preverilo a NEMENÍ sa: povinný zostáva.
 * 2. **A je to JEDNA VETA.** Kontrakt UI bod 11 predpisuje „jedna veta + jedno
 *    tlačidlo". S bodom 1 si to neprotirečí — spor bol vždy len o DĹŽKE, nikdy
 *    o tom, či tam veta má byť. Rozhodnuté v prospech kontraktu: povinná áno,
 *    dlhá nie.
 *
 *    Dĺžka je presne to, čo sa tu smie ticho nazbierať, lebo typ o nej nič
 *    netvrdí a nikdy tvrdiť nebude: `products/catalog-status.ts` mal v jednom
 *    `description` 234 znakov v štyroch vetách, z toho dva pokyny v druhej
 *    osobe („Uvoľnite…", „počkajte…"). Prázdny stav je potom najdlhší text na
 *    obrazovke, na ktorej nič nie je, a jediné tlačidlo v ňom zapadne. Kto
 *    tu potrebuje druhú vetu, potrebuje `Note` vedľa, nie dlhší prázdny stav.
 * 3. **Prázdno nie je chyba.** Žiadna červená, žiadny výkričník. Keď je
 *    prázdno DÔSLEDKOM chyby, patrí tam `Note variant="err"`, nie zafarbený
 *    prázdny stav.
 * 4. **Akcia je voliteľná, ale ak je, má byť tá jedna správna.** Nie tri
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
  /**
   * Vysvetlenie — ako sa to sem dostane. **Jedna veta.** Povinné aj krátke;
   * dôvody oboch podmienok sú v hlavičke modulu, body 1 a 2.
   */
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
