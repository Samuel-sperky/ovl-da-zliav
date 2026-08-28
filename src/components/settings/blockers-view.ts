/**
 * Aura Zľavy — AKO SA PREKÁŽKA KRESLÍ (Nastavenia; `lib/status/blockers.ts`).
 *
 * Server posiela prekážky hotové: vetu, ďalší krok, cestu, závažnosť aj to,
 * ako sa dajú odstrániť. Povrchu ostáva JEDINÉ, čo servera nezaujíma — tón,
 * glyf a slovo. Ani to sa už ale nerozhoduje tu: prevod `resolution → vzhľad`
 * má celá appka JEDEN a žije v `ui/blocker-look.ts`. Tento modul si z neho
 * berie, čo Nastavenia potrebujú, a pridáva len svoje vlastné veci — výber
 * prekážky pre kartu a vetu o priznanej domnienke. Žiadna veta sa tu neskladá
 * znova; keby sa skladala, mali by sme dva texty o tej istej veci a jeden z
 * nich by sa časom rozišiel s pravdou.
 *
 * PREČO TU PREVOD KEDYSI STÁL ZNOVA (a prečo sa už nesmie rozdeliť)
 * -----------------------------------------------------------------
 * Nastavenia boli treťou obrazovkou s prekážkami a prevod mal tri riadky, tak
 * sa napísal na mieste — presne ako predtým na Prehľade a v tabe Zľavy. Tri
 * tabuľky sa potom rozišli: `mimo_appky` bolo tu a v tabe Zľavy červené, na
 * Prehľade jantárové; `potvrdenie` (do D105 `sudo`) bolo tu jantárové, na
 * Prehľade tlmené; a slovo
 * o riešení znelo na každej obrazovke inak. Prevod NIE JE lokálna vec — je to
 * tvrdenie appky o jednej a tej istej prekážke.
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
 *  - `sam`, `potvrdenie` → tón pozornosti. Dá sa to spraviť hneď, v appke.
 *    (Kód `sudo` sa 27. 8. 2026 premenoval na `potvrdenie` — D105.)
 *  - `mimo_appky` → tón poruchy. Appka s tým nespraví nič a nikto to nespraví
 *    za používateľa; červená je tu vyhradená pre stratu dát a zastavený zápis
 *    a toto je presne ten druhý prípad.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Stav nikdy nie je len farba.** Ku každému tónu patrí glyf
 *     (`blockerGlyph`) aj SLOVO (`RESOLUTION_WORD`) — oboje z toho istého
 *     slovníka. V tmavej téme sú susedné tóny pod farbosleposťou zameniteľné
 *     a samotný farebný bod povie polovici používateľov nič.
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
import { lookChannel, resolutionLook } from '@/components/ui/blocker-look';
import type { IconName } from '@/components/ui/Icon';
import type { StatusTone } from '@/components/ui/ToneBadge';

/**
 * Ako sa prekážka odstráni → tón §3.2. ODVODENÉ z jediného slovníka appky,
 * nie napísané tu; viď doc-blok modulu.
 */
export const RESOLUTION_TONE: Readonly<Record<BlockerWire['resolution'], StatusTone>> =
  lookChannel('tone');

/** Tretí kanál popri farbe a glyfe — čo sa s tým dá robiť, jedným slovom. */
export const RESOLUTION_WORD: Readonly<Record<BlockerWire['resolution'], string>> =
  lookChannel('word');

/**
 * Veta pri prekážke, ktorá stojí na bezpečnom predpoklade, nie na fakte.
 *
 * Stojí na obrazovke RAZ, pod tabuľkou. Predtým sa vykresľovala v bunke pri
 * každej takej podmienke — teda až trikrát to isté, a v 131 znakoch, čo je
 * odsek, nie štítok (P2 dovolí 90). Bunka nesie `ASSUMED_MARK`, vysvetlenie
 * je jedno a spoločné.
 */
export const ASSUMED_NOTE =
  'Nie je to prečítaný údaj — keď appka nevie, počíta s prísnejšou možnosťou.';

/** Čo stojí v bunke pri takej podmienke. Značka, nie veta (P7: odhad je tlmený). */
export const ASSUMED_MARK = '≈ predpoklad';

/** Tón prekážky — z jediného slovníka appky. */
export function blockerTone(blocker: Pick<BlockerWire, 'resolution'>): StatusTone {
  return resolutionLook(blocker.resolution).tone;
}

/**
 * Ikona prekážky. Berie sa zo SLOVNÍKA PREKÁŽOK, nie z ikony tónu:
 * `potvrdenie` (do 27. 8. 2026 `sudo`, D105) má zámok, hoci má rovnaký tón ako
 * `sam`, lebo zámok je spôsob riešenia.
 *
 * Do 19. 8. 2026 to bol ZNAK a vracalo sa 🔒 — jediné emoji v appke a jediná
 * farebná vec v inak zmeranej monochromatickej palete. Teraz je to názov
 * ikony z `Icon.tsx`.
 */
export function blockerIcon(blocker: Pick<BlockerWire, 'resolution'>): IconName {
  return resolutionLook(blocker.resolution).icon;
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
 * Trieda signálnej značky (`.sig`) pre tón. Nesie IBA farbu a typografiu —
 * značku kreslí `<ToneSigMark>` (`ui/StatusMark.tsx`) ako `<Icon>` v tom istom
 * uzle, kde stojí slovo. Do 19. 8. 2026 ju kreslil znak v `::before`; kto sem
 * pridá triedu bez značky, zredukuje stav na farbu a slovo a NIČ nespadne.
 *
 * Prevod žije v `ui/blocker-look.ts` — do 19. 8. 2026 tu mapoval `progress` na
 * `sig idle`, lebo `.sig` variantu `progress` nemal, a piaty stav appky tým
 * splynul s „nečinný". `.sig.progress` medzitým v `globals.css` pribudol.
 */
export { TONE_SIG_CLASS } from '@/components/ui/blocker-look';
