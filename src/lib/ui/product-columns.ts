/**
 * Aura Zľavy — JEDNA DEFINÍCIA STĹPCOV PRODUKTOVÝCH TABULIEK (D124, 1. 9. 2026).
 *
 * PREČO TENTO MODUL VZNIKOL
 * -------------------------
 * Appka má tri tabuľky produktov — Produkty (`CatalogTable.tsx`), výber do
 * zľavy (vzorka v `NewDiscount.tsx`) a položky zľavy (`ItemsTable`
 * v `DiscountDetail.tsx`) — a do V5 si každá písala hlavičky aj bunky sama.
 * Rozišli sa v dvoch veciach naraz:
 *
 *  1. **V menách.** Tá istá vec sa volala „Cena" aj „Cena pri príprave", pričom
 *     to boli DVE rôzne veličiny; produkt sa raz volal „referencia · názov"
 *     v jednej bunke a inde bol kód schovaný v `title`. Človek si tie tabuľky
 *     nevedel porovnať, hoci vedľa seba vyzerali rovnako.
 *  2. **V tom, čo znamená prázdna bunka.** Jedna tabuľka písala pomlčku, druhá
 *     nulu, tretia prázdno — a nula pri výbere do zľavy je dôvod, prečo niekto
 *     zlacní tisíc kusov (D121, pasca zapísaná v `CLAUDE.md`).
 *
 * PRAVIDLO D124, KTORÉ SA TU NESMIE POKAZIŤ
 * -----------------------------------------
 * **Kde sa stĺpec nehodí, VYNECHÁ sa.** Nikdy sa nepremenuje a nikdy sa
 * nenaplní inou veličinou. Premenovaný stĺpec je presne to, čo tie tabuľky
 * rozišlo: „Cena pri príprave" nie je „Cena", je to momentka z času skúšky
 * naprázdno — takže sa v položkách zľavy stĺpec `price` VYNECHÁ a momentka
 * dostane vlastné meno MIMO tejto sady. To je celé pravidlo a je to jediný
 * spôsob, ako sa dve tabuľky nerozídu.
 *
 * TROJSTAVOVOSŤ JE VLASTNOSŤ STĹPCA, NIE TABUĽKY (I11)
 * ----------------------------------------------------
 * Každý stĺpec vie sám nakresliť všetky tri stavy:
 *
 *   · **hodnota** — appka ju ZMERALA a stojí za ňou,
 *   · **„nie je obohatené"** (`not_enriched`) — appka sa shopu na tento
 *     produkt nikdy nepýtala (D118); nie je to nula ani prázdno v shope,
 *   · **„dni chýbajú"** (`days_missing`) — okno nie je dočítané, takže súčet
 *     by bol nižší než skutočnosť.
 *
 * Keby si tri stavy kreslila každá tabuľka sama, prvý `?? 0` v ktorejkoľvek
 * z nich tú prácu zahodí a nikto si to nevšimne. Preto sú bunky ČISTÉ funkcie
 * mimo Reactu a pod testom (`test/unit/jednotne-stlpce.spec.ts`).
 *
 * KTO TENTO MODUL POUŽÍVA
 * -----------------------
 *  · `src/components/campaigns/NewDiscount.tsx` — vzorka výberu do zľavy:
 *    `reference`, `name`, `price`, `soldWindow`. Ostatné sú VYNECHANÉ, lebo
 *    výber pracuje s riadkami z `/api/catalog/search`, ktoré obohatené polia
 *    (marža, sklad, obrátkovosť, stav zľavy v shope) nenesú. „Pásmo" a „Nová
 *    cena" sú stĺpce SPRIEVODCU — nie sú v jednotnej sade a ani nemajú byť.
 *  · `src/components/campaigns/DiscountDetail.tsx` (`ItemsTable`) — položky
 *    zľavy: `reference`, `name`. `price` aj `discountNow` sú vynechané zámerne
 *    (viď pravidlo D124 vyššie); „Cena pri príprave", „Zľava" tejto kampane
 *    a „Zapísané" sú stĺpce HISTÓRIE ZÁPISU, ktorá sa neprepisuje (I4).
 *  · `src/components/products/CatalogTable.tsx` — Produkty: OSEM z deviatich
 *    stĺpcov, vrátane rozpadu marže na dve polovice (`productMarginCells`),
 *    ktorý tá tabuľka kreslí ako dva uzly. `ean13` VYNECHÁVA (D124) — EAN tam
 *    už stojí tichým druhým riadkom v bunke názvu a z inej cesty. Má navyše
 *    tri stĺpce MIMO sady (druhé okno predajnosti, posledný predaj a zľavu
 *    podľa vlastných zápisov appky); jednotné stĺpce medzi nimi idú v poradí
 *    sady a stráži to `test/unit/produkty-jednotne-stlpce.spec.ts`.
 *  · `src/components/dashboard/ProductsTable.tsx` — tabuľka Prehľadu (V7,
 *    D159): CELÁ sada, teda VŠETKÝCH DEVÄŤ stĺpcov. Je to jediná tabuľka,
 *    ktorá nevynecháva ani jeden, takže na nej sa meria meno aj veta `title`
 *    každého z nich (`test/unit/prehlad-tabulka.spec.ts` §A).
 *  · História (`src/components/audit/`) tabuľka produktov NIE JE: je to jeden
 *    riadok textu na udalosť, takže tam ostáva `productLabel()` (D122).
 *
 * VZŤAH K `product-label.ts` (D122)
 * ---------------------------------
 * Ten modul odpovedá na otázku „ako sa produkt VOLÁ", tento na otázku „aké
 * stĺpce má tabuľka a čo znamená prázdna bunka". V tabuľke idú ruka v ruke:
 * stĺpec `reference` je prvý (D122) a stĺpec `name` sa plní z
 * `productNameCell()`, ktorý pri chýbajúcom názve nechá `#id`, aby sa riadok
 * dal identifikovať. `productLabel()` — teda veta „referencia · názov" — do
 * TABUĽKY nepatrí: tá má na priznanie dve miesta, nie jedno.
 *
 * ČO TENTO MODUL NEROBÍ
 * ---------------------
 * Nekreslí. Je to čistý popis stĺpcov (`.ts`, žiadny JSX), aby sa dal overiť
 * bez prehliadača a aby ho smel importovať aj server. Značky `<th>`/`<td>`
 * si kreslí každá tabuľka sama — z `label`, `numeric` a `id`.
 *
 * VZŤAH K `sold-coverage.ts`
 * --------------------------
 * Bunky KPI obrazovky Produkty (`src/components/products/sold-coverage.ts`)
 * odpovedali na tú istú otázku prvé a ich vety sú tu prebrané DOSLOVA, aby
 * jedna obrazovka nehovorila o tej istej medzere dvoma spôsobmi. `lib/` nesmie
 * importovať z `components/` (bol by to obrátený smer závislosti), takže tie
 * dva zdroje stráži pred rozídením test `jednotne-stlpce.spec.ts` §E, ktorý
 * porovnáva reťazce oboch modulov. Keď `CatalogTable.tsx` prejde na tento
 * modul, `sold-coverage.ts` má tie konštanty re-exportovať odtiaľto a test §E
 * zmizne.
 *
 * Vlastník: V5 (jednotné stĺpce).
 */
import { formatDateSk, formatEur, formatPercentSk } from '@/lib/ui/format';
import { NEVIEME, productNameCell } from '@/lib/ui/product-label';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════ 1. Tri stavy jednej hodnoty ══════════════════════ */

/** Pomlčka, ktorou appka hovorí „toto nevieme" (nie „toto je nula"). */
export const PRODUCT_DASH = NEVIEME;

/**
 * Prečo hodnota nie je. `not_asked` je stav PRED odpoveďou a je to iná veta než
 * „pýtali sme sa a nevieme" — kto ich zlije, buď vykreslí priznanie skôr, než
 * odpoveď prišla, alebo nečitateľnú odpoveď vydá za plné pokrytie.
 */
export const PRODUCT_GAPS = [
  'not_asked',
  'not_enriched',
  'shop_has_none',
  'days_missing',
  'not_computable',
] as const;

export type ProductGap = (typeof PRODUCT_GAPS)[number];

/** Jedno miesto, jedna veta pre všetky stĺpce a všetky tabuľky. */
export const PRODUCT_GAP_REASON: Readonly<Record<ProductGap, string>> = {
  not_asked: 'KPI tohto riadku sa ešte nenačítali.',
  not_enriched:
    'Produkt ešte nie je obohatený — appka sa na jeho podrobnosti shopu nepýtala. ' +
    'Nie je to nula ani prázdna hodnota v shope.',
  shop_has_none: 'Appka sa shopu pýtala a shop k tomuto poľu o produkte nič nevedie.',
  days_missing: 'Z okna chýbajú dni, takže súčet by bol nižší než skutočnosť.',
  not_computable: 'Pomer nemá hodnotu — menovateľ je nula.',
};

/** Hodnota je `null` a odpoveď dôvod nepovedala — priznáva sa to bez výmyslu. */
export const PRODUCT_NO_REASON = 'Appka túto hodnotu nemá a odpoveď nepovedala prečo.';

/**
 * Jedno pole: hodnota, alebo dôvod, prečo ju nemáme.
 *
 * Tvar je ZÁMERNE ten istý ako `KpiValueView` z `catalog-api.ts` a množina
 * dôvodov je jeho nadmnožina (`not_asked` navyše), takže KPI riadku sa sem dá
 * podať bez prekladu.
 */
export interface ProductValue<T> {
  readonly value: T | null;
  readonly gap: ProductGap | null;
}

/** Zmeraná hodnota. */
export function knownValue<T>(value: T): ProductValue<T> {
  return { value, gap: null };
}

/** Priznaná medzera — hodnota nie je a vieme prečo. */
export function missingValue<T>(gap: ProductGap): ProductValue<T> {
  return { value: null, gap };
}

/**
 * Hodnota, ktorú zdroj posiela ako `T | null | undefined`, s dôvodom pre
 * prázdno. Používa sa tam, kde odpoveď medzeru NEPOMENÚVA (riadok katalógu,
 * položka zľavy) — dôvod tam vie len volajúci a bez neho by z prázdna vznikla
 * tichá nula.
 */
export function valueOrGap<T>(value: T | null | undefined, gap: ProductGap): ProductValue<T> {
  return value === null || value === undefined ? missingValue<T>(gap) : knownValue(value);
}

/** Jedna bunka: čo sa vypíše, či je to priznanie a čo o tom povie `title`. */
export interface ProductCellView {
  readonly text: string;
  /** `true` ⇔ je to pomlčka, teda priznanie „nevieme", nie hodnota. */
  readonly unknown: boolean;
  readonly title: string | null;
  /** `true` ⇔ hodnota JE, ale je len dolná hranica (chýbajú dni okna). */
  readonly lowerBound: boolean;
}

const unknownCell = (title: string): ProductCellView => ({
  text: PRODUCT_DASH,
  unknown: true,
  title,
  lowerBound: false,
});

/**
 * Kód dôvodu → veta. Neznámy kód (odpoveď servera sa môže rozšíriť) NEPADNE na
 * prázdny `title`, ale na priznanie bez výmyslu.
 */
function gapReason(gap: string): string {
  return Object.prototype.hasOwnProperty.call(PRODUCT_GAP_REASON, gap)
    ? PRODUCT_GAP_REASON[gap as ProductGap]
    : PRODUCT_NO_REASON;
}

/**
 * Jedno pole do bunky.
 *
 * Poradie podmienok je rovnaké ako v `sold-coverage.ts` a je záväzné: `gap` sa
 * kontroluje PRED hodnotou. Odpoveď `{ value: 0, gap: 'days_missing' }` je pre
 * bežný stĺpec nekonzistentná a jediná bezpečná odpoveď na ňu je pomlčka; keby
 * sa pozeralo najprv na hodnotu, appka by tú medzeru vypísala ako nulu.
 * Jediná výnimka je okno predajov — má vlastnú funkciu nižšie.
 */
function fieldCell<T>(
  value: ProductValue<T> | null | undefined,
  format: (known: T) => string,
  knownTitle: string | null,
): ProductCellView {
  if (value === null || value === undefined) return unknownCell(PRODUCT_GAP_REASON.not_asked);
  const gap = value.gap ?? null;
  if (gap !== null) return unknownCell(gapReason(gap));
  if (value.value === null) return unknownCell(PRODUCT_NO_REASON);
  return { text: format(value.value), unknown: false, title: knownTitle, lowerBound: false };
}

/* ═══════════════════════ 2. Vstupy zložených stĺpcov ══════════════════════ */

/**
 * Zľava, ktorá na produkte BEŽÍ — podľa SHOPU, k času obohatenia.
 *
 * Je to iná veta než „appka si zapísala, že tento produkt zlacnila": vlastné
 * zápisy sú účtovníctvo appky, kým tento stĺpec hovorí, čo vidí zákazník.
 * Zliať ich by znamenalo tvrdiť o neobohatenom produkte, že naň zľava nebeží.
 */
export interface ProductDiscountNow {
  readonly state: 'running' | 'scheduled' | 'ended' | 'none' | 'unknown';
  /** % zľavy, ktorá v posudzovaný deň NAOZAJ beží. Mimo `running` vždy prázdne. */
  readonly percent: ProductValue<number>;
  readonly from: string | null;
  readonly to: string | null;
  /** Kedy sa stav zmeral (`enriched_at`); `null` = produkt nie je obohatený. */
  readonly measuredAt: string | null;
}

/** Predané kusy za okno a to, koľko dní okna appka NEMÁ (D119, D121). */
export interface ProductSoldWindow {
  readonly windowDays: number;
  readonly completeDays: number;
  readonly unknownDays: number;
  readonly units: ProductValue<number>;
  /** `true` ⇔ `units.value` je len DOLNÁ HRANICA. */
  readonly lowerBound: boolean;
}

/**
 * Koľkokrát sa AKTUÁLNA zásoba už predala (`qty_in_orders / qty`).
 *
 * R3 kontraktu V5: je to číslo za CELÚ históriu, nie za okno. „Obrátkovosť za
 * 30 dní" sa bez histórie objednávok vypočítať NEDÁ a tento stĺpec to priznáva
 * v `headTitle` aj v `title` každej bunky.
 *
 * IDENTIFIKÁTOR SA VOLÁ `soldPerStock` (1. 9. 2026)
 * -------------------------------------------------
 * Do zelenej brány V5 niesol tento stĺpec anglické meno účtovnej obrátkovosti.
 * Repo má pritom zapísané pravidlo, ktoré presne to zakazuje:
 * `test/unit/sales-insights.spec.ts` bráni tomu slovu ako menu metriky,
 * premennej či vzorca — z `getFull` je zásoba JEDNA MOMENTKA, nie priemer za
 * obdobie, takže účtovnú obrátkovosť z nej spočítať nemožno. Modul to pravidlo
 * porušoval len preto, že v zozname stráženom tým testom nebol (grep nad
 * priečinkom A nepovie nič o diere v priečinku B). Meno je teraz to isté, aké
 * nesie `kpiSoldPerStockCell()` v `sold-coverage.ts`, a modul v tom zozname
 * odteraz stojí.
 */
export interface ProductSoldPerStock {
  readonly ratio: ProductValue<number>;
  readonly soldTotal: ProductValue<number>;
  readonly stock: ProductValue<number>;
}

/** Marža TAK, AKO JU POSLAL SHOP. Appka ju nikdy nepočíta (D117). */
export interface ProductMargin {
  readonly eur: ProductValue<number>;
  readonly percent: ProductValue<number>;
}

/**
 * Hodnoty jedného riadku pre jednotné stĺpce.
 *
 * Každé pole je VOLITEĽNÉ a chýbajúce pole znamená „táto tabuľka o tom
 * nehovorí" — bunka z neho spraví `not_asked`, teda pomlčku, nikdy nulu.
 * Tabuľka, ktorá stĺpec vynechala (D124), jeho pole jednoducho neposiela.
 */
export interface ProductRowValues {
  /**
   * Identifikátor riadku. Nie je to stĺpec (D116 ho z povrchu sťahuje) — slúži
   * stĺpcu `name` ako POSLEDNÉ východisko: riadok bez názvu aj bez referencie
   * by sa inak nedal identifikovať vôbec.
   */
  readonly productId?: number;
  readonly reference?: ProductValue<string>;
  /**
   * Čiarový kód EAN-13 (D150, V7). Vlastné pole, nie prívesok referencie:
   * referencia je hlavný identifikátor a EAN je iný kód z iného stĺpca
   * zrkadla, takže každý má vlastnú medzeru a vlastný dôvod.
   */
  readonly ean13?: ProductValue<string>;
  readonly name?: ProductValue<string>;
  readonly price?: ProductValue<string | number>;
  readonly discountNow?: ProductDiscountNow;
  readonly soldWindow?: ProductSoldWindow;
  readonly soldPerStock?: ProductSoldPerStock;
  readonly margin?: ProductMargin;
  readonly stock?: ProductValue<number>;
}

/* ═══════════════════════════ 3. Sada stĺpcov ══════════════════════════════ */

/**
 * Jednotná sada a jej ZÁVÄZNÉ poradie (D124). Poradie je súčasťou definície:
 * dve tabuľky s tými istými stĺpcami v inom poradí sa porovnať nedajú o nič
 * lepšie než dve tabuľky s inými menami.
 *
 * ═══ ČO ZMENILA V7 (D159, 3. 9. 2026) ═══
 * Sada má DEVÄŤ stĺpcov a dve zmeny naraz — obe sú voľba Samuela pre tabuľku
 * Prehľadu a obe platia pre VŠETKY tabuľky, pretože poradie je vlastnosť
 * definície, nie obrazovky:
 *
 *  1. **`stock` stojí PRED `margin`.** Sklad a marža sú dve veličiny z tej
 *     istej odpovede `getFull`, ale sklad odpovedá na otázku „koľko toho
 *     ešte mám" a stojí preto vedľa predaného; marža je peňažný záver a je
 *     posledná z čísel. Do V7 to bolo obrátene a Produkty to prekreslili
 *     spolu s touto zmenou — dve tabuľky s tou istou sadou v inom poradí sú
 *     presne to, čo D124 zakazuje.
 *  2. **Pribudol `ean13`.** Referencia je hlavný identifikátor a je PRVÁ
 *     (D150); EAN je pre čítačku a má vlastný stĺpec, nie prívesok
 *     v referencii. Je POSLEDNÝ, pretože sa ním nič neporovnáva — je to kód
 *     na odpísanie, nie veličina.
 *
 * `ean13` NEKRESLÍ každá tabuľka a je to D124, nie výnimka z nej: kde sa
 * stĺpec nehodí, VYNECHÁ sa. Produkty ho ako stĺpec nemajú, pretože EAN tam
 * už stojí tichým druhým riadkom v bunke názvu (`CodeLine`) a berie ho z inej
 * cesty (`/api/catalog/details`, teda spoza kľúča) — dva stĺpce s tým istým
 * menom z dvoch rôznych zdrojov by boli horšie než jeden. Že sa Produkty pri
 * tom nerozišli s poradím sady, meria `produkty-jednotne-stlpce.spec.ts`;
 * že tabuľka Prehľadu kreslí všetkých deväť v poradí D159, meria
 * `prehlad-tabulka.spec.ts`.
 */
export const PRODUCT_COLUMN_IDS = [
  'reference',
  'name',
  'price',
  'discountNow',
  'soldWindow',
  'soldPerStock',
  'stock',
  'margin',
  'ean13',
] as const;

export type ProductColumnId = (typeof PRODUCT_COLUMN_IDS)[number];

/**
 * Čo tabuľka o sebe vie a čo stĺpec potrebuje na pomenovanie. Dnes je to len
 * dĺžka okna predajnosti — `Predané 30 d` a `Predané 180 d` je ten istý stĺpec
 * s iným oknom, nie dva rôzne stĺpce.
 */
export interface ProductColumnContext {
  /** `null`/chýba = okno nevieme; hlavička to prizná namiesto vymysleného čísla. */
  readonly soldWindowDays?: number | null;
}

/** Jeden stĺpec pripravený na vykreslenie. */
export interface ProductColumn {
  readonly id: ProductColumnId;
  /** Nadpis stĺpca. Jediné meno, aké tento stĺpec v appke má. */
  readonly label: string;
  /** `true` = číselný stĺpec (v tomto repe trieda `n`, zarovnanie doprava). */
  readonly numeric: boolean;
  /** Čo stĺpec znamená — a hlavne, čo NEznamená. Ide do `title` hlavičky. */
  readonly headTitle: string;
  /** Bunka riadku vrátane všetkých troch stavov. */
  cell(values: ProductRowValues): ProductCellView;
}

interface ColumnDef {
  readonly label: (ctx: ProductColumnContext) => string;
  readonly numeric: boolean;
  readonly headTitle: (ctx: ProductColumnContext) => string;
  readonly cell: (values: ProductRowValues) => ProductCellView;
}

const REFERENCE_TITLE =
  'Referencia produktu podľa shopu. Podľa nej sa produkt hľadá v sklade ' +
  'aj v administrácii eshopu — názvy sa opakujú, referencia nie.';

const NAME_TITLE = 'Názov produktu z posledného prechodu katalógu.';

/**
 * EAN je DRUHÝ kód, nie druhé meno referencie (D150).
 *
 * Veta menuje, na čo je: referencia sa píše rukou zo skladovej karty, EAN sa
 * načíta čítačkou. `title` zámerne NEHOVORÍ, že prázdno znamená „shop ho
 * nevedie" — pri neobohatenom riadku je v zrkadle `NULL`, teda „nevieme", a
 * ten rozdiel nesie `PRODUCT_GAP_REASON`, nie tento text.
 */
const EAN13_TITLE =
  'Čiarový kód EAN-13 tak, ako ho poslal shop. Je pre čítačku — referencia ' +
  'je kód, ktorý sa píše rukou, EAN je ten, ktorý sa sníma.';

const PRICE_TITLE = 'Predajná cena z posledného prechodu katalógu.';

const DISCOUNT_NOW_UNKNOWN =
  'Produkt nie je obohatený, takže stav zľavy v shope appka nepozná.';

const SOLD_PER_STOCK_WHAT = 'Koľkokrát sa aktuálna zásoba už predala (celkovo predané / sklad).';

const SOLD_PER_STOCK_NOT =
  'Nehovorí to, ako rýchlo sa produkt predáva ani koľko sa ho predalo za okno — ' +
  'na to by bola potrebná história objednávok, ktorú appka nemá (R3).';

const MARGIN_TITLE = 'Marža tak, ako ju poslal shop. Appka ju nepočíta.';

const STOCK_TITLE = 'Zásoba podľa shopu, zmeraná pri obohatení produktu.';

/**
 * Okno predajnosti do nadpisu. Bez známeho okna sa číslo NEVYMÝŠĽA — nadpis
 * povie „za okno" a `headTitle` prizná, že dĺžku appka nedostala.
 */
function soldWindowLabel(ctx: ProductColumnContext): string {
  const days = ctx.soldWindowDays ?? null;
  return days === null ? 'Predané za okno' : `Predané ${days} d`;
}

function soldWindowHeadTitle(ctx: ProductColumnContext): string {
  const days = ctx.soldWindowDays ?? null;
  if (days === null) {
    return (
      'Predané kusy za zvolené okno. Dĺžku okna appka k tejto tabuľke nedostala, ' +
      'takže ju nadpis nepomenúva.'
    );
  }
  return (
    `Predané kusy za ${days} ${pluralSk(days, 'deň', 'dni', 'dní')} — len za dni, ` +
    'ktoré má appka naozaj stiahnuté. Znak „≥" znamená, že okno nie je dočítané.'
  );
}

/**
 * Predané kusy za okno (D119, D121).
 *
 * Nula je MERANÝ fakt len vtedy, keď je celé okno dočítané; inak je číslo dolná
 * hranica a bunka to hovorí znakom `≥` aj vetou. Dolná hranica NULA sa za
 * hodnotu neberie: `≥ 0` nie je priznanie, ale prázdna veta, a pri dnešnom
 * pokrytí (pár dní zo 180) by ju tabuľka napísala takmer na každý riadok.
 */
function soldWindowCell(window: ProductSoldWindow | null | undefined): ProductCellView {
  if (window === null || window === undefined) return unknownCell(PRODUCT_GAP_REASON.not_asked);
  const { units, windowDays, completeDays, unknownDays } = window;
  const gap = units.gap ?? null;
  const daysNote =
    `Z ${windowDays} ${pluralSk(windowDays, 'dňa', 'dní', 'dní')} ` +
    `je dočítaných ${completeDays}.`;
  const measuredFloor = gap === 'days_missing' && units.value !== null && units.value > 0;
  if (gap !== null && !measuredFloor) return unknownCell(`${gapReason(gap)} ${daysNote}`);
  if (units.value === null) return unknownCell(PRODUCT_NO_REASON);
  const lowerBound = measuredFloor || window.lowerBound || unknownDays > 0;
  // Druhá závora na to isté pravidlo: `≥ 0` sa nesmie vykresliť ani vtedy, keď
  // dolnú hranicu ohlásilo pole `lowerBound` / `unknownDays` a nie `gap`.
  if (lowerBound && units.value === 0) {
    return unknownCell(`${PRODUCT_GAP_REASON.days_missing} ${daysNote}`);
  }
  return {
    text: lowerBound ? `≥ ${formatCountSk(units.value)}` : formatCountSk(units.value),
    unknown: false,
    title: lowerBound
      ? `Dolná hranica: z ${windowDays} dní okna je dočítaných ${completeDays}, ` +
        `chýba ${unknownDays}. Skutočný počet môže byť vyšší.`
      : `Celé okno ${windowDays} dní je dočítané, takže je to celý počet.`,
    lowerBound,
  };
}

/**
 * Zľava, ktorá na produkte beží podľa shopu.
 *
 * `none` je MERANÝ fakt („shop k tomu času povedal, že nič nebeží"), nie
 * pomlčka; `unknown` je pomlčka. Zliať ich by znamenalo tvrdiť o neobohatenom
 * produkte, že naň zľava nebeží.
 */
function discountNowCell(discount: ProductDiscountNow | null | undefined): ProductCellView {
  if (discount === null || discount === undefined) {
    return unknownCell(PRODUCT_GAP_REASON.not_asked);
  }
  const measured =
    discount.measuredAt === null
      ? DISCOUNT_NOW_UNKNOWN
      : `Podľa shopu, zmerané ${formatDateSk(discount.measuredAt)}.`;
  const window =
    discount.from === null && discount.to === null
      ? ''
      : ` Okno ${formatDateSk(discount.from)} – ${formatDateSk(discount.to)}.`;

  if (discount.state === 'unknown') {
    const gap = discount.percent.gap ?? null;
    return unknownCell(gap === null ? measured : `${gapReason(gap)} ${measured}`);
  }
  if (discount.state === 'running') {
    const gap = discount.percent.gap ?? null;
    if (gap !== null) return unknownCell(`${gapReason(gap)} ${measured}`);
    if (discount.percent.value === null) return unknownCell(`${PRODUCT_NO_REASON} ${measured}`);
    return {
      text: formatPercentSk(discount.percent.value),
      unknown: false,
      title: `${measured}${window}`,
      lowerBound: false,
    };
  }
  const WORD: Readonly<Record<'scheduled' | 'ended' | 'none', string>> = {
    scheduled: 'naplánovaná',
    ended: 'skončila',
    none: 'bez zľavy',
  };
  return {
    text: WORD[discount.state],
    unknown: false,
    title: `${measured}${window}`,
    lowerBound: false,
  };
}

/**
 * Názov produktu (D122).
 *
 * Chýbajúci názov NIE JE pomlčka: `productNameCell()` z `product-label.ts` na
 * jeho mieste nechá `#id`, aby sa riadok dal identifikovať — a to je jediné
 * miesto, ktoré o tomto východisku rozhoduje. Bunka to označí ako priznanie
 * (`unknown: true`), takže povrch ho smie stlmiť, a dôvod medzery si nesie
 * v `title`.
 */
function nameCell(values: ProductRowValues): ProductCellView {
  const field = fieldCell(values.name, (value) => value, null);
  if (values.productId === undefined) return field;
  const named = productNameCell({
    productId: values.productId,
    name: field.unknown ? null : field.text,
  });
  return {
    text: named.text,
    unknown: named.unknown,
    title: named.unknown ? (field.title ?? PRODUCT_GAP_REASON.not_asked) : null,
    lowerBound: false,
  };
}

function soldPerStockCell(
  soldPerStock: ProductSoldPerStock | null | undefined,
): ProductCellView {
  if (soldPerStock === null || soldPerStock === undefined) {
    return unknownCell(PRODUCT_GAP_REASON.not_asked);
  }
  const sold = (soldPerStock.soldTotal.gap ?? null) === null ? soldPerStock.soldTotal.value : null;
  const stock = (soldPerStock.stock.gap ?? null) === null ? soldPerStock.stock.value : null;
  const detail =
    sold === null || stock === null
      ? `${SOLD_PER_STOCK_WHAT} ${SOLD_PER_STOCK_NOT}`
      : `Celkovo predané ${formatCountSk(sold)}, sklad ${formatCountSk(stock)}. ${SOLD_PER_STOCK_NOT}`;
  return fieldCell(soldPerStock.ratio, (value) => `${value.toFixed(1)}×`, detail);
}

/**
 * Marža po polovičkách — pre tabuľku, ktorá chce každej polovici vlastný uzol
 * (a teda vlastnú pomlčku aj vlastný `title`). `CatalogTable.tsx` to tak kreslí
 * dnes; vďaka tomuto exportu to môže robiť ďalej bez vlastného formátovania.
 */
export function productMarginCells(margin: ProductMargin | null | undefined): {
  readonly eur: ProductCellView;
  readonly percent: ProductCellView;
} {
  return {
    eur: fieldCell(margin?.eur, (value) => formatEur(value), MARGIN_TITLE),
    percent: fieldCell(margin?.percent, (value) => `${value} %`, MARGIN_TITLE),
  };
}

/**
 * Marža ako jedna bunka `€ · %`.
 *
 * Sú to DVE hodnoty z `getFull` a každá má vlastnú medzeru, preto sa polovica
 * s medzerou nakreslí ako pomlčka a druhá zostane čitateľná. Pomlčka za celý
 * stĺpec je až vtedy, keď nevieme ani jednu — inak by chýbajúca polovica
 * zahodila tú, ktorú appka zmerala.
 */
function marginCell(margin: ProductMargin | null | undefined): ProductCellView {
  const { eur, percent } = productMarginCells(margin);
  if (eur.unknown && percent.unknown) {
    return unknownCell(eur.title ?? percent.title ?? PRODUCT_NO_REASON);
  }
  const titles = [eur.title, percent.title].filter((title) => title !== null);
  return {
    text: `${eur.text} · ${percent.text}`,
    unknown: false,
    title: titles.length === 0 ? null : [...new Set(titles)].join(' '),
    lowerBound: false,
  };
}

const DEFS: Readonly<Record<ProductColumnId, ColumnDef>> = {
  reference: {
    label: () => 'Referencia',
    numeric: false,
    headTitle: () => REFERENCE_TITLE,
    cell: (values) => fieldCell(values.reference, (value) => value, REFERENCE_TITLE),
  },
  name: {
    label: () => 'Názov',
    numeric: false,
    headTitle: () => NAME_TITLE,
    cell: nameCell,
  },
  price: {
    label: () => 'Cena',
    numeric: true,
    headTitle: () => PRICE_TITLE,
    cell: (values) => fieldCell(values.price, (value) => formatEur(value), null),
  },
  discountNow: {
    /*
     * MENO STĹPCA HOVORÍ, ČÍ JE TO VETA (1. 9. 2026, nález overovateľa I11).
     *
     * Do tejto opravy sa stĺpec volal „Zľava teraz" — presne tak, ako sa na
     * obrazovke Produkty volá stĺpec VLASTNÝCH ZÁPISOV appky
     * (`CatalogTable.tsx`, `row.discountedNow`). Boli to teda dve tabuľky, dve
     * opačné veličiny a jedno meno; človek by ich vedľa seba porovnal ako to
     * isté číslo. Tento stĺpec je od začiatku o SHOPE (viď `headTitle` aj
     * `ProductDiscountNow`), takže meno prevzal po tom, čo Produkty pre shop už
     * roky používajú — „Zľava v shope". Meno „Zľava teraz" zostáva vlastným
     * zápisom appky a v jednotnej sade NEEXISTUJE.
     */
    label: () => 'Zľava v shope',
    numeric: true,
    headTitle: () =>
      'Zľava, ktorá na produkte beží PODĽA SHOPU, k času obohatenia. ' +
      'Nie je to zoznam vlastných zápisov appky — to je iná otázka.',
    cell: (values) => discountNowCell(values.discountNow),
  },
  soldWindow: {
    label: soldWindowLabel,
    numeric: true,
    headTitle: soldWindowHeadTitle,
    cell: (values) => soldWindowCell(values.soldWindow),
  },
  soldPerStock: {
    label: () => 'Predané / sklad',
    numeric: true,
    headTitle: () => `${SOLD_PER_STOCK_WHAT} ${SOLD_PER_STOCK_NOT}`,
    cell: (values) => soldPerStockCell(values.soldPerStock),
  },
  margin: {
    label: () => 'Marža',
    numeric: true,
    headTitle: () => MARGIN_TITLE,
    cell: (values) => marginCell(values.margin),
  },
  stock: {
    label: () => 'Sklad',
    numeric: true,
    headTitle: () => STOCK_TITLE,
    cell: (values) => fieldCell(values.stock, (value) => formatCountSk(value), STOCK_TITLE),
  },
  ean13: {
    label: () => 'EAN',
    /*
     * `numeric: false` napriek tomu, že sú to samé cifry. Trieda `n` v tomto
     * repe znamená „veličina": zarovná doprava, aby sa jednotky dali porovnať
     * pod sebou. EAN nie je veličina, je to IDENTIFIKÁTOR a porovnáva sa
     * odpredu po znakoch — presne ako referencia (D122). Tabulárne číslice
     * mu dáva CSS obrazovky, nie zarovnanie.
     */
    numeric: false,
    headTitle: () => EAN13_TITLE,
    cell: (values) => fieldCell(values.ean13, (value) => value, EAN13_TITLE),
  },
};

/** Jeden stĺpec jednotnej sady, pomenovaný a pripravený na vykreslenie. */
export function productColumn(
  id: ProductColumnId,
  ctx: ProductColumnContext = {},
): ProductColumn {
  const def = DEFS[id];
  return {
    id,
    label: def.label(ctx),
    numeric: def.numeric,
    headTitle: def.headTitle(ctx),
    cell: def.cell,
  };
}

/**
 * Vybrané stĺpce jednotnej sady v ZÁVÄZNOM poradí (D124).
 *
 * Poradie vstupu sa zámerne ignoruje a duplicity sa zahadzujú: tabuľka si smie
 * vybrať, ktoré stĺpce ukáže, ale nie v akom poradí — inak by sa dve tabuľky
 * s tou istou sadou aj tak nedali porovnať. Stĺpce mimo sady (napr. „Pásmo"
 * sprievodcu alebo „Zapísané" v položkách zľavy) si tabuľka kreslí sama.
 */
export function productColumns(
  ids: readonly ProductColumnId[],
  ctx: ProductColumnContext = {},
): readonly ProductColumn[] {
  const wanted = new Set<ProductColumnId>(ids);
  return PRODUCT_COLUMN_IDS.filter((id) => wanted.has(id)).map((id) => productColumn(id, ctx));
}

/**
 * Riadok, o ktorom appka nevie NIČ, s jedným priznaným dôvodom pre všetky
 * stĺpce.
 *
 * Slúži dvom veciam: tabuľka ním vie nakresliť riadok, ktorého KPI ešte
 * nedobehli (`not_asked`), a test ním overí, že sa žiadny stĺpec z trojstavovosti
 * nevymyká. Bez toho by nový stĺpec mohol pribudnúť s tichou nulou a nikto by
 * to nezachytil.
 */
export function unknownRowValues(gap: ProductGap, productId?: number): ProductRowValues {
  const value = <T,>(): ProductValue<T> => missingValue<T>(gap);
  return {
    ...(productId === undefined ? {} : { productId }),
    reference: value<string>(),
    ean13: value<string>(),
    name: value<string>(),
    price: value<string | number>(),
    discountNow: {
      state: 'unknown',
      percent: value<number>(),
      from: null,
      to: null,
      measuredAt: null,
    },
    soldWindow: {
      windowDays: 0,
      completeDays: 0,
      unknownDays: 0,
      units: value<number>(),
      lowerBound: false,
    },
    soldPerStock: { ratio: value<number>(), soldTotal: value<number>(), stock: value<number>() },
    margin: { eur: value<number>(), percent: value<number>() },
    stock: value<number>(),
  };
}
