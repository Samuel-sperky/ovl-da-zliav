/**
 * Aura Zľavy — AKO SA PREKÁŽKA KRESLÍ (Nastavenia; `lib/status/blockers.ts`).
 *
 * Server posiela prekážky hotové: vetu, ďalší krok, cestu, závažnosť aj to,
 * ako sa dajú odstrániť. Tento modul k nim dopĺňa JEDINÉ, čo servera nezaujíma
 * — tón, glyf a slovo pre povrch. Žiadna veta sa tu neskladá znova; keby sa
 * skladala, mali by sme dva texty o tej istej veci a jeden z nich by sa časom
 * rozišiel s pravdou.
 *
 * FARBA IDE PODĽA `resolution`, NIE PODĽA `severity`
 * --------------------------------------------------
 * Je to výslovné pravidlo z doc-bloku `blockers.ts` a má konkrétny dôvod:
 * `severity` hovorí, ČI cez to teraz niečo prejde, ale používateľa zaujíma, ČO
 * S TÝM. Vyčerpaný denný rozpočet je `blokuje` a pritom sa nič nepokazilo —
 * o polnoci sa obnoví sám (K2). Keby sa farbilo podľa závažnosti, svietil by
 * rovnako naliehavo ako chýbajúci kľúč, ktorý appku zastaví na neurčito.
 *
 * Preto:
 *  - `cakanie`    → pokojný tón. Netreba robiť nič, čas to vyrieši.
 *  - `sam`, `sudo` → tón pozornosti. Dá sa to spraviť hneď, v appke.
 *  - `mimo_appky` → tón poruchy. Appka s tým nespraví nič a nikto to nespraví
 *    za používateľa; červená je tu vyhradená pre stratu dát a zastavený zápis
 *    a toto je presne ten druhý prípad.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Stav nikdy nie je len farba.** Ku každému tónu patrí glyf
 *     (`TONE_GLYPH`, jeden slovník pre celú appku) aj SLOVO
 *     (`RESOLUTION_WORD`). V tmavej téme sú susedné tóny pod farbosleposťou
 *     zameniteľné a samotný farebný bod povie polovici používateľov nič.
 *  2. **Domnienka sa priznáva.** Prekážka s `assumed` stojí na bezpečnom
 *     predpoklade, nie na prečítanom údaji, a povrch to musí povedať —
 *     `ASSUMED_NOTE` je na to jedna veta pre celú obrazovku.
 *  3. **Nič sa tu nefiltruje podľa dôležitosti.** Výber prekážok robí
 *     obrazovka (`pickBlocker`) podľa toho, o čom práve píše; poradie zoznamu
 *     už prišlo zoradené zo servera a neprehadzuje sa.
 *
 * Vlastník: V12.
 */
import type { BlockerWire } from '@/components/settings/api';
import { TONE_GLYPH, type StatusTone } from '@/components/ui/ToneBadge';

/** Ako sa prekážka odstráni → tón §3.2. Viď doc-blok modulu. */
export const RESOLUTION_TONE: Readonly<Record<BlockerWire['resolution'], StatusTone>> = {
  sam: 'attention',
  sudo: 'attention',
  cakanie: 'idle',
  mimo_appky: 'critical',
};

/** Tretí kanál popri farbe a glyfe — čo sa s tým dá robiť, jedným slovom. */
export const RESOLUTION_WORD: Readonly<Record<BlockerWire['resolution'], string>> = {
  sam: 'vyriešiš to tu v appke',
  sudo: 'vyriešiš to tu, vypýta si heslo',
  cakanie: 'netreba robiť nič, čaká sa',
  mimo_appky: 'appka s tým nespraví nič',
};

/** Veta pri prekážke, ktorá stojí na bezpečnom predpoklade, nie na fakte. */
export const ASSUMED_NOTE =
  'Túto vetu appka nepostavila na prečítanom údaji, ale na bezpečnom predpoklade — ' +
  'keď niečo nevie, počíta s tou prísnejšou možnosťou.';

/** Tón prekážky. Jediné povolené miesto, kde sa prekážke priradí farba. */
export function blockerTone(blocker: Pick<BlockerWire, 'resolution'>): StatusTone {
  return RESOLUTION_TONE[blocker.resolution];
}

/** Glyf prekážky — z toho istého slovníka ako všetky ostatné stavy appky. */
export function blockerGlyph(blocker: Pick<BlockerWire, 'resolution'>): string {
  return TONE_GLYPH[blockerTone(blocker)];
}

/**
 * Prvá prekážka zo zoznamu, ktorá má niektoré z hľadaných čísel. Poradie
 * v `ids` je poradie hľadania, nie poradie dôležitosti — zoznam zo servera je
 * už zoradený a prehadzovať ho tu by znamenalo mať dve pravdy o poradí.
 */
export function pickBlocker(
  blockers: readonly BlockerWire[] | null | undefined,
  ids: readonly BlockerWire['id'][],
): BlockerWire | null {
  if (!Array.isArray(blockers)) return null;
  for (const id of ids) {
    const found = blockers.find((blocker) => blocker.id === id);
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * Trieda signálnej značky (`.sig`) pre tón. Značka nesie okrem farby aj znak
 * cez `::before`, takže sa nedá zredukovať na samotnú farbu.
 */
export const TONE_SIG_CLASS: Readonly<Record<StatusTone, string>> = {
  good: 'sig ok',
  attention: 'sig warn',
  critical: 'sig bad',
  progress: 'sig idle',
  idle: 'sig idle',
};
