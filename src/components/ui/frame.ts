/**
 * Aura Zľavy — PRAVIDLÁ RÁMCA STRÁNKY (D133, D142; V6a, 2. 9. 2026).
 *
 * `Panel`, `PageHeader`, `Tabs` a `Segmented` sú štyri kusy jedného rámca:
 * plocha, hlavička stránky a dva prepínače. Tento modul nesie ich LOGIKU —
 * pohyb klávesnicou, párovanie identifikátorov, skladanie tried a priznanie
 * „nevieme" v počte na záložke. Značkovanie je vo `*.tsx` vedľa, vzhľad
 * v `frame.module.css` (D143).
 *
 * PREČO JE LOGIKA MIMO KOMPONENTU
 * -------------------------------
 * Ten istý dôvod, aký má `primitives.ts` vedľa `StatTile.tsx`: `vitest.config.ts`
 * beží v `environment: 'node'` a zbiera `*.spec.ts`, takže tvrdenie o klávese
 * sa dá napísať bez prehliadača len vtedy, keď je tá klávesa ČISTÁ FUNKCIA.
 * DOM-ový test (`test/unit/ramec-klavesnica.spec.ts`) potom overuje už len to,
 * čo bez DOM-u naozaj nejde: že sa `keydown` doručí, že fokus ide ZA výberom
 * a že atribúty na uzloch sedia. Keby bol pohyb zapečený v obsluhe udalosti,
 * jediné meranie by bolo to drahé a krajné prípady (jediná položka, všetky
 * zakázané, hodnota mimo zoznamu) by nemal kto pokryť.
 *
 * DVA PREPÍNAČE, DVA VZORY KLÁVESNICE — A NIE JE TO NEDÔSLEDNOSŤ
 * -------------------------------------------------------------
 *  · `Tabs` prepínajú OBSAH (iné panely) → `role="tablist"`, `aria-selected`.
 *    Vodorovný tablist podľa ARIA APG hýbe len `←`/`→` (+ `Home`/`End`);
 *    `↑`/`↓` si necháva stránka na posun, inak by sa zo záložiek nedalo
 *    odscrollovať.
 *  · `Segmented` prepína ZOBRAZENIE tých istých dát (okno 7/30/90, hustota)
 *    → `role="radiogroup"`, `aria-checked`. Prepínač rádií hýbe aj `↑`/`↓`,
 *    pretože skupina rádií nemá vlastný posuv a APG to pre ňu predpisuje.
 *
 * Obidva vzory obiehajú dokola (z posledného na prvý). Je to voľba: prepínače
 * sú krátke (tri až päť položiek) a náraz na koniec zoznamu si pri troch
 * položkách nikto nevšimne ako hranicu, len ako nefunkčnú klávesu.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  A. **Zakázaná položka nie je v obehu.** Volajúci posiela do
 *     `nextTabIndex`/`nextRadioIndex` počet POVOLENÝCH položiek a index medzi
 *     nimi — nie index v celom zozname. Klávesa, ktorá zastaví na zakázanej
 *     položke, je horšia než klávesa, ktorá nerobí nič.
 *
 *  B. **Hodnota mimo zoznamu neznamená „nič nevyber".** Keď je vybraná
 *     položka zakázaná (alebo hodnota v zozname vôbec nie je), `current` je
 *     `-1` a pohyb sa počíta od prvej položky. Prepínač, ktorý pri pokazenej
 *     hodnote na klávesu nereaguje, vyzerá ako zamrznutá obrazovka.
 *
 *  C. **Počet na záložke je trojstavový (I11).** `undefined` = záložka číslo
 *     nemá; `null` = „nevieme" a kreslí sa POMLČKA; číslo = číslo. Nula je
 *     tvrdenie („nič tam nie je") a nesmie zastupovať nevedomosť — presne to
 *     už raz appku stálo pásma zliav nad neznámym predajom (D121).
 */
import { NEVIEME } from '@/lib/ui/product-label';
import { formatCountSk } from '@/lib/ui/vocabulary';

/**
 * Klávesy, ktorými hýbe VODOROVNÝ tablist (`Tabs`). `↑`/`↓` medzi nimi
 * zámerne nie sú — pozri hlavičku modulu.
 */
export const TAB_MOVE_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const;

/** Klávesy, ktorými hýbe skupina rádií (`Segmented`). */
export const RADIO_MOVE_KEYS = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
] as const;

/**
 * Kam sa má výber posunúť.
 *
 * @param key      hodnota `KeyboardEvent.key`
 * @param count    koľko POVOLENÝCH položiek prepínač má
 * @param current  index vybranej položky medzi povolenými, alebo `-1`
 * @param vertical či skupina počíta aj `↑`/`↓` (skupina rádií áno, tablist nie)
 * @returns nový index, alebo `null` keď sa hýbať nemá (cudzia klávesa,
 *          prázdny prepínač)
 */
function move(key: string, count: number, current: number, vertical: boolean): number | null {
  if (!Number.isInteger(count) || count <= 0) return null;

  /* Hodnota mimo zoznamu sa počíta od prvej položky — bod B hlavičky. */
  const at = current >= 0 && current < count ? current : 0;

  switch (key) {
    case 'ArrowLeft':
      return (at - 1 + count) % count;
    case 'ArrowRight':
      return (at + 1) % count;
    case 'ArrowUp':
      return vertical ? (at - 1 + count) % count : null;
    case 'ArrowDown':
      return vertical ? (at + 1) % count : null;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Pohyb vo vodorovnom tabliste (`Tabs`). */
export function nextTabIndex(key: string, count: number, current: number): number | null {
  return move(key, count, current, false);
}

/** Pohyb v skupine rádií (`Segmented`). */
export function nextRadioIndex(key: string, count: number, current: number): number | null {
  return move(key, count, current, true);
}

/**
 * Identifikátor záložky. `base` je spoločná predpona jednej skupiny záložiek
 * (`useId()` alebo vlastný reťazec volajúceho) — bez nej by dve skupiny so
 * zhodnými hodnotami vyrobili v dokumente dva rovnaké `id` a čítačka by
 * `aria-controls` poslala k cudziemu panelu.
 */
export function tabId(base: string, value: string): string {
  return `${base}tab-${value}`;
}

/**
 * Identifikátor PANELA záložky. Kreslí ho volajúci, nie `Tabs` — a musí ho
 * kresliť: `aria-controls`, ktorý ukazuje do prázdna, je pre čítačku
 * pokazený odkaz. Preto sa `id` skladá tu a nie ručne na obrazovke.
 */
export function tabPanelId(base: string, value: string): string {
  return `${base}panel-${value}`;
}

/**
 * Počet pri popise záložky ako TEXT (bod C hlavičky).
 *
 * `null` a nečíslo dávajú pomlčku U+2014 — appka o počte nevie a nesmie
 * povedať nulu.
 */
export function tabCountText(count: number | null): string {
  if (count === null) return NEVIEME;
  if (!Number.isFinite(count)) return NEVIEME;
  return formatCountSk(count);
}

/**
 * Skladanie tried. Nepravdivé časti vypadnú, takže podmienená trieda nikdy
 * nenechá v DOM-e reťazec „undefined" — ten istý dôvod, aký má `.filter`
 * v `Icon.tsx`.
 */
export function joinClasses(...parts: readonly (string | false | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
}
