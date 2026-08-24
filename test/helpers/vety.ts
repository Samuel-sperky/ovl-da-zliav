/**
 * Aura Zľavy — MERANIE HOTOVÝCH VIET POVRCHU.
 *
 * Vety prekážok (`lib/status/blockers.ts`) kreslí päť obrazoviek, majú limit
 * dĺžky (P2 = 90 znakov) a preto sa priebežne skracujú. Testy nad nimi musia
 * zamykať FAKT, nie slovné spojenie — inak padnú pri každom skrátení, hoci
 * údaj vo vete zostal, a človek ich prepíše tak, aby prešli. Vtedy sa
 * pokrytie stratí ticho.
 *
 * PASCA, KTORÁ TU UŽ RAZ BOLA
 * ---------------------------
 * `toContain('150 produktov')` v `test/unit/status-blockers.spec.ts` padlo
 * 24. 8. 2026, keď sa veta o strope skrátila na „vo výbere je 150 — 140 sa
 * nezapíše". Číslo z vety NEZMIZLO, zmizla jednotka vedľa neho. Päť takých
 * tvrdení naraz vyzeralo ako regresia a nebolo ňou.
 *
 * DRUHÁ PASCA: `formatCountSk` (`ui/vocabulary.ts`) oddeľuje tisícky
 * OBYČAJNOU medzerou (0x20), nie nezlomiteľnou. Kto hľadá „1500", nenájde
 * nič; kto hľadá tisícky spojené nezlomiteľnou medzerou, tiež nie. Preto sa
 * hľadané číslo skladá tým istým formátovačom, akým ho píše produkcia.
 *
 * Používa to `test/unit/status-blockers.spec.ts`, `test/unit/status-snapshot.spec.ts`
 * a `test/unit/slovnik-prekazky.spec.ts`.
 */
import { formatCountSk } from '@/lib/ui/vocabulary';

/**
 * Veta nesie ČÍSLO — nech ho obopína akákoľvek väzba.
 *
 * Ohraničenie `(?<!\d)` / `(?!\d)` je tu preto, aby sa „40" nenašlo v „140"
 * a „2" v „12 000". Medzera medzi tisíckami sa hľadá ako `\s`, aby test prežil
 * prípadné prepnutie na nezlomiteľnú medzeru — ale hodnotu skladá formátovač,
 * nie ručný literál.
 */
export const nesieCislo = (text: string, count: number): boolean =>
  new RegExp(`(?<!\\d)${formatCountSk(count).replace(/ /g, '\\s')}(?!\\d)`).test(text);

/**
 * Nájde vo vete každé „z <číslo> produkt…" so ZLÝM pádom.
 *
 * Vracia zoznam nájdených chýb (prázdny zoznam = veta je v poriadku), aby
 * hlásenie testu ukázalo priamo to slovo, ktoré je zlé.
 */
export function zlyPadPoZ(text: string): string[] {
  const chyby: string[] = [];
  for (const zhoda of text.matchAll(/\b([zZ]) (\d[\d\s]*?) (produkt\p{L}*)/gu)) {
    const [, predlozka, cislo, slovo] = zhoda;
    if (slovo !== 'produktu' && slovo !== 'produktov') {
      chyby.push(`${predlozka} ${cislo} ${slovo}`);
    }
  }
  return chyby;
}
