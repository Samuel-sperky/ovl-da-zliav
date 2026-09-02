/**
 * Aura Zľavy — POUČNÝ PRÁZDNY STAV (predloha `sperky-admin.html`, `.empty`;
 * rozšírené vo V6a, D134 a D142).
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
 * jedna z nich je nudná. Ktorá to je, hovorí `state-copy.ts` — šesť príbehov,
 * šesť vetí — a tento komponent kreslí PRVÝ z nich: „nič tu ešte nevzniklo".
 * Zvyšné cez neho kreslia `NoResultsState`, `UnmeasuredState`,
 * `ForbiddenState`, `ErrorState` a `LoadingState` má vlastnú kostru.
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
 *    tu potrebuje druhú vetu, dá ju do slotu `note` — teda do `Note`,
 *    `LockBadge` alebo `ErrorMessage`, ktoré na druhú vetu majú tvar.
 * 3. **Prázdno nie je chyba.** Žiadna červená, žiadny výkričník. Keď je
 *    prázdno DÔSLEDKOM chyby, patrí tam `Note variant="err"` (teda slot
 *    `note`, čo presne robí `ErrorState`), nie zafarbený prázdny stav.
 * 4. **Akcia je voliteľná, ale ak je, má byť tá jedna správna.** Nie tri
 *    tlačidlá — jedna cesta von.
 *
 * ČO SI PORT Z `aura-roadmap` NEPRINIESOL (D142 — portuje sa tvar a pravidlo)
 * --------------------------------------------------------------------------
 *  · **`secondaryActionLabel`** — druhé tlačidlo. Bod 4 hlavičky hovorí jedna
 *    cesta von a platí: prázdna obrazovka s dvoma návrhmi je rozhodovanie na
 *    ploche, kde ešte nie je čo rozhodovať.
 *  · **`canAct`** — brána, ktorá CTA skryje tomu, kto nemá právo. Táto appka
 *    prihlásenie ani práva NEMÁ (D98–D100), takže by gate nemala čo čítať; a aj
 *    keby mala, miestne pravidlo je opačné — zapisovacia akcia sa NESKRÝVA, len
 *    vypína s dôvodom (`Button.disabledReason`, D10; `LockBadge`, bod 1).
 *    Skrytá akcia sa nedá pochopiť, vypnutá s dôvodom áno.
 *  · **`tone` (accent / muted / gold)** — farba prázdneho stavu. Bola by to
 *    štvrtá farba bez značky a bez slova, teda presne to, čo pravidlo troch
 *    kanálov zakazuje; a teal ani zlatá v tejto appke nekódujú stav NIKDY.
 *  · **`bare`** — modifikátor bez volajúceho. `.ovl-empty` je stĺpec, ktorý sa
 *    zanorí aj do bunky tabuľky (robí to `CatalogPanel`), takže by dnes nič
 *    neriešil. Nepoužitý modifikátor v rodine šiestich stavov je presne to, čo
 *    „portuj tvar, nie súbor" odmieta.
 *
 * Vzhľad dedí `.ovl-empty` z `globals.css` (vycentrovaný stĺpec s tlmeným
 * textom), ktorý v appke už existuje a používajú ho dve živé obrazovky; nový je
 * len slot druhej vety (`states.module.css`, `noteSlot`).
 *
 * Server-safe: žiadne hooky, žiadne `use client`.
 *
 * Vlastník: U1; rodina stavov V6a.
 */
import type { ReactNode } from 'react';

import styles from '@/components/states/states.module.css';
import type { StateStory } from '@/components/states/state-copy';

export interface EmptyStateProps {
  /** Nadpis — čo tu má byť. Krátko, slovensky. */
  title: string;
  /**
   * Vysvetlenie — ako sa to sem dostane, prípadne čo prázdno znamená. **Jedna
   * veta.** Povinné aj krátke; dôvody oboch podmienok sú v hlavičke modulu,
   * body 1 a 2.
   */
  description: ReactNode;
  /**
   * DRUHÁ veta — vysvetlivka (`Note`), zámok (`LockBadge`) alebo chybová
   * hláška (`ErrorMessage`) pod vysvetlením. Existuje preto, aby sa druhá veta
   * nenatlačila do `description` (bod 2 hlavičky): tieto tri primitíva majú na
   * ňu tvar aj tri kanály, `description` ani jedno.
   */
  note?: ReactNode;
  /** Jedna akcia, ktorá prázdno vyrieši (tlačidlo, odkaz). Voliteľné. */
  action?: ReactNode;
  /**
   * Ozdobná značka nad nadpisom (glyf alebo ikona). Dekoratívna — nesmie
   * niesť význam, ktorý nie je v texte.
   */
  icon?: ReactNode;
  /**
   * KTORÝ z príbehov `state-copy.ts` sa práve kreslí. Ide do `data-story`, teda
   * do stroja: test, snímka aj e2e potom vedia rozoznať šesť prázdien od seba
   * bez čítania vety. Pre človeka to nemení nič — jeho kanál je text.
   */
  story?: StateStory;
  /** `data-testid` koreňa — nech sa dá adresovať v e2e. */
  testId?: string;
}

export function EmptyState({
  title,
  description,
  note,
  action,
  icon,
  story = 'prazdno',
  testId,
}: EmptyStateProps) {
  return (
    <div className="ovl-empty" data-story={story} data-testid={testId}>
      {icon ? (
        <span className="ovl-empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <strong>{title}</strong>
      <p>{description}</p>
      {/* Druhá veta stojí PRED akciou: čo sa stalo → čo to znamená → prečo →
          čo urobiť. Vysvetlenie za tlačidlom sa už nečíta. */}
      {note ? <div className={styles.noteSlot}>{note}</div> : null}
      {action}
    </div>
  );
}

export default EmptyState;
