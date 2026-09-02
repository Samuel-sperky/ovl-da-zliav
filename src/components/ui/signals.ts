/**
 * Aura Zľavy — TRETÍ KANÁL STAVU AKO KÓD, NIE AKO SĽUB (V6a, D133, D142).
 *
 * Pravidlo appky znie „stav nikdy nie je len farba — vždy farba + značka +
 * slovo" a je zmerané: pod deuteranopiou nesie rozdiel susedných tónov len
 * jas, takže SLOVO je jediný kanál, na ktorý sa dá spoľahnúť. Do V6a bolo to
 * pravidlo napísané v štyroch docblockoch a merané ZVONKU
 * (`test/helpers/znacky.ts` nad vykresleným markupom). To je dobré na
 * odhalenie, nie na zabránenie: keď volajúci pošle do badge prázdny reťazec —
 * a to sa stane vždy tak, že mu vypadne dáta, nie že by to chcel — komponent
 * poslušne nakreslí farbu, značku a NIČ. Na obrazovke to nevyzerá ako chyba,
 * ale ako preklep, takže to nikto nenahlási.
 *
 * ČO TENTO MODUL NIE JE
 * ---------------------
 * **Nie je to druhý mechanizmus značiek.** Druhý kanál (značka) už svoj
 * mechanizmus má: koreňový slovník `TONE_ICON` (`ui/ToneBadge.tsx`) a obaly
 * v `ui/StatusMark.tsx`. Tento modul sa ich nedotýka a žiadnu ďalšiu mapu
 * `tón → značka` nezavádza — kto by si ju napísal, otvorí presne tú chybu,
 * ktorú opisuje hlavička `ui/blocker-look.ts`.
 *
 * **Nie je to ani ďalšia slovná zásoba stavov.** Slová stavov žijú v
 * `lib/ui/vocabulary.ts` (`SURFACE_STATES`, `ITEM_SENTENCES`,
 * `GUARD_SENTENCES`) a v `ui/primitives.ts` (`BUDGET_LEVEL_WORD`,
 * `TREND_WORD`). Tie sú PLATBA — konkrétne, doménové, pravdivé.
 * `SIGNAL_WORD_FALLBACK` nie je ich náhrada ani ich súper: je to to, čo sa
 * nakreslí, keď žiadne z nich neprišlo.
 *
 * PREČO NÁHRADNÉ SLOVO A NIE VÝNIMKA
 * ----------------------------------
 * Rovnaký dôvod ako pri `FALLBACK_ICON` (`ui/Icon.tsx`, bod E): výnimka
 * v komponente zhodí celú obrazovku na bielu stránku, nielen jednu značku —
 * to sa v tomto repe už raz stalo (24. 8. 2026, neznámy stavový kód zhodil
 * tab Zľavy). A rovnako ako tam platí, že náhrada sa NESMIE tváriť ako
 * platná hodnota: náhradný tvar je otáznik a nie fajka, náhradné slovo je
 * priznanie („stav bez popisu") a nie vymyslený doménový výraz. Kto by tu
 * napísal „chyba" alebo „v poriadku", vyrobí badge, ktorý o sebe tvrdí
 * nepravdu — a to je horšie než badge bez slova.
 *
 * NÁHRADNÉ SLOVO NIE JE POMLČKA
 * -----------------------------
 * `SIGNAL_WORD_FALLBACK` sa nesmie rovnať `NEVIEME` (`lib/ui/product-label.ts`,
 * U+2014). Pomlčka je PRIZNANIE O DÁTACH — „túto hodnotu appka nemeria" (I11)
 * — a je to jedna z nedotknuteľných vecí kontraktu V6 (§4 bod 1). Chýbajúce
 * slovo pri stave je naopak defekt KÓDU. Keby oba hovorili tou istou
 * pomlčkou, prvý pohľad by ich nerozlíšil a chyba by sa schovala za invariant.
 * Stráži to `test/unit/signaly-tri-kanaly.spec.ts`.
 *
 * Vlastník: V6a, signálna skupina.
 */
import type { ReactNode } from 'react';

import type { IconName } from '@/components/ui/Icon';
import { NEVIEME } from '@/lib/ui/product-label';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════ 1. Slovo — tretí kanál ═══════════════════════════ */

/**
 * Čo sa vykreslí namiesto slova, ktoré volajúci nedal.
 *
 * Je to priznanie, nie doménový výraz — pozri hlavičku. Musí mať aspoň štyri
 * znaky, inak by ho `test/helpers/znacky.ts` (`NAJKRATSIE_SLOVO`) nepovažoval
 * za slovo a poistka by bola len na oko.
 */
export const SIGNAL_WORD_FALLBACK = 'stav bez popisu';

/**
 * Atribút, ktorým sa chýbajúce slovo dá NÁJSŤ — v DOM, v teste aj v snímke.
 *
 * Tá istá myšlienka ako `ICON_UNKNOWN_ATTR` (`ui/Icon.tsx`): kanál, ktorý
 * potichu zmizne, je porušenie pravidla, o ktorom sa nikto nedozvie; kanál,
 * ktorý o sebe povie, sa dá opraviť.
 */
export const SIGNAL_WORDLESS_ATTR = 'data-signal-wordless';

/**
 * Znaky, ktoré vyzerajú ako obsah, ale slovo nie sú.
 *
 * Trieda `\s` v JavaScripte UŽ pokrýva nezlomiteľnú medzeru (U+00A0) aj BOM
 * (U+FEFF), takže sa nevypisujú druhýkrát. Medzera nulovej šírky (U+200B) v nej
 * NIE JE a práve ona je najzradnejšia: reťazec je neprázdny, na obrazovke nie je
 * nič. Spájače (U+200C, U+200D) v triede zámerne nestoja — sú to riadiace znaky,
 * nie biele miesta, a ESLint ich v triede znakov hlási ako zavádzajúce.
 */
const BEZ_SLOVA = /^[\s\u200b]*$/;

/**
 * Je toto `ReactNode` bez slova?
 *
 * ROZSAH POISTKY je vedomý a úzky: pozná prázdno, prázdny reťazec, biele
 * miesta, `NaN` a pole samých takých detí. Element (`<strong>…</strong>`,
 * `<Icon/>`) sa NEROZOBERÁ — vnútro cudzieho elementu sa staticky preskúmať
 * nedá a hádanie by z poistky urobilo lotériu. Element preto platí za obsah
 * a prípad `<ToneBadge tone="critical"><Icon name="x"/></ToneBadge>` (značka
 * bez slova) chytá až meranie nad VYKRESLENÝM markupom
 * (`test/unit/signaly-tri-kanaly.spec.ts`) — presne preto to meranie
 * zostáva, hoci pribudla táto poistka.
 */
export function isWordless(word: ReactNode): boolean {
  if (word === null || word === undefined) return true;
  /* `false && …` a `cond ? x : null` v JSX — najčastejší tvar chýbajúceho slova. */
  if (typeof word === 'boolean') return true;
  if (typeof word === 'string') return BEZ_SLOVA.test(word);
  /* Číslo je obsah — `0` je platná hodnota. `NaN` a nekonečno nie sú. */
  if (typeof word === 'number') return !Number.isFinite(word);
  if (typeof word === 'bigint') return false;
  if (Array.isArray(word)) return word.every((dieta) => isWordless(dieta as ReactNode));
  return false;
}

/** Slovo tak, ako sa má vykresliť, plus či bolo treba siahnuť po náhrade. */
export interface SignalWord {
  /** Čo ide do JSX. Nikdy nie prázdno — to je celý zmysel tohto modulu. */
  readonly word: ReactNode;
  /** Prišla náhrada? Volajúci z toho robí `SIGNAL_WORDLESS_ATTR`. */
  readonly wordless: boolean;
}

/**
 * Doplní tretí kanál, keď ho volajúci vynechal.
 *
 * Používa ho KAŽDÝ komponent signálnej skupiny (`ToneBadge`, `StatusPill`,
 * `BudgetMeter`, `Chip`) — jedna poistka na jednom mieste. Kto pridá do
 * skupiny piaty komponent a túto funkciu obíde, obišiel pravidlo troch
 * kanálov, nie len pomocníka.
 */
export function signalWord(word: ReactNode): SignalWord {
  const wordless = isWordless(word);
  return { word: wordless ? SIGNAL_WORD_FALLBACK : word, wordless };
}

/** To isté, ale nad `string` — pre popisy, ktoré idú aj do `aria-label`. */
export interface SignalLabel {
  /** Text na vykreslenie. Nikdy prázdny. */
  readonly label: string;
  readonly wordless: boolean;
}

/**
 * Tá istá poistka pre propy typované ako `string` (`StatusPill.label`,
 * `BudgetMeter.label`, `FilterChip.label`).
 *
 * Existuje preto, že `signalWord()` vracia `ReactNode` a ten sa nedá vložiť do
 * `aria-label` ani do vety. Bez tejto dvojice by si volajúci písal `wordless
 * ? SIGNAL_WORD_FALLBACK : label` sám — a to je presne ten tvar, ktorý sa na
 * treťom mieste opíše s preklepom.
 */
export function signalLabel(label: string): SignalLabel {
  const wordless = isWordless(label);
  return { label: wordless ? SIGNAL_WORD_FALLBACK : label, wordless };
}

/**
 * Atribúty koreňa pre chýbajúce slovo. Prázdny objekt, keď je slovo v poriadku
 * — atribút, ktorý svieti vždy, nehovorí nič.
 *
 * Rozprestiera sa ZA `...rest`, aby sa príznak defektu nedal prepísať zvonku
 * (tak isto ako `ICON_UNKNOWN_ATTR` v `ui/Icon.tsx`).
 */
export function wordlessAttrs(wordless: boolean): Readonly<Record<string, string>> {
  return wordless ? { [SIGNAL_WORDLESS_ATTR]: 'true' } : {};
}

/* ═════════════════════════ 2. Slovník čipu ════════════════════════════════ */

/**
 * Značka ZAPNUTÉHO čipu.
 *
 * Existuje preto, že predloha (`aura-roadmap`, `Chip.tsx`) rozlišovala zapnutý
 * čip VÝHRADNE tealovou výplňou a `aria-pressed`. Vidiacemu používateľovi
 * s deuteranopiou tým nezostal ani jeden kanál — `aria-pressed` sa nekreslí.
 * Tá istá diera je dnes v tejto appke na troch miestach
 * (`products/CatalogFilters.tsx`, `campaigns/NewDiscount.tsx` — ich vlastné
 * komentáre to priznávajú) a `Chip` je jej koniec.
 *
 * Fajka je zámerne tá istá ako `TONE_ICON.good`: „toto platí" je v celej appke
 * jeden tvar. Nie je to druhá mapa stavov — je to jedna konštanta, ktorá si
 * tvar berie z koreňového slovníka.
 */
export const CHIP_SELECTED_ICON: IconName = 'check';

/** Značka „odstrániť" — tá istá, akou appka zatvára všetko ostatné. */
export const CHIP_REMOVE_ICON: IconName = 'x';

/**
 * Meno odstraňovacieho tlačidla pre čítačku.
 *
 * Slovenské a s DOPLNENÝM predmetom: „Zrušiť" samo o sebe je v zozname
 * dvanástich čipov dvanásťkrát to isté slovo a čítačka z neho nevie, čo sa
 * ruší. Volajúci, ktorý ruší niečo iné než filter (uložený filter sa
 * ZABÚDA, nie ruší), si vlastné meno pýta propom `removeLabel`.
 */
export function chipRemoveLabel(label: string): string {
  return `Zrušiť filter ${label}`;
}

/**
 * Číslo v čipe („Prebieha 12").
 *
 * `null` je POMLČKA, nie nula (I11): počet, ktorý appka nezmerala, sa
 * nedopĺňa. Presne toto rozlíšenie stálo D121 — server posielal `0` tam, kde
 * mal poslať `null`, a model z toho legitímne vyrobil zľavu.
 */
export function chipCountLabel(count: number | null): string {
  /*
   * Pomlčka sa NEOPISUJE — je to `NEVIEME` z `lib/ui/product-label.ts`, jediné
   * miesto, kde tento znak v appke žije. Druhá kópia znaku U+2014 by sa od
   * prvej rozišla presne v ten deň, keď niekto zamení pomlčku za spojovník.
   */
  return count === null ? NEVIEME : formatCountSk(count);
}
