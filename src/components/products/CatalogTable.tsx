'use client';

/**
 * Aura Zľavy — tabuľka katalógu (V10; `design/v3/produkty.html`).
 *
 * Toto je DOMINANTA tabu Produkty (P1). Nie nadpis, nie filtre — tabuľka.
 * Skroluje výhradne ona, vo vlastnom ráme `.tbl-frame` (P4); stránka pod ňou
 * stojí, takže hlavička aj lišta výberu zostávajú na mieste.
 *
 * Stĺpce a čo v nich NIE JE
 * ─────────────────────────
 * `Názov · Predané 30 d · Predané 90 d · Predané / sklad · Posledný predaj ·
 * Cena · Zľava teraz · Zľava v shope · Marža`. Číslo produktu hlavný stĺpec NIE JE
 * (P3) — žije v „Technickom detaile" bočného panela; na povrchu je
 * `referencia · názov` (D116, `lib/ui/product-label.ts`).
 *
 * Do 31. 8. 2026 tu boli štyri stĺpce s vysvetlením, že na viac appka nemá
 * dáta. To vysvetlenie prestalo platiť s migráciou 0014 a obohacovaním
 * `getFull` (D118): sklad, marža, dodávateľ aj stav zľavy v shope už V ZRKADLE
 * SÚ — ale len pre obohatené produkty, a tých je zlomok. Preto sa stĺpce
 * kreslia a **prázdna bunka je priznanie, nie šum**: pomlčka nesie v `title`
 * dôvod („produkt nie je obohatený", „shop o tom nič nevie", „z okna chýbajú
 * dni"). Texty sa TU nevyrábajú — sú v `sold-coverage.ts`, aby tabuľka
 * a bočný panel nemohli o tej istej medzere povedať dve rôzne veci.
 *
 * DVA STĹPCE O ZĽAVE SÚ ZÁMER (I11)
 * ─────────────────────────────────
 * `Zľava teraz` je VŽDY podľa vlastného zápisu appky. `Zľava v shope` je to,
 * čo o produkte povedal SHOP pri obohatení (`reduction_*` z `getFull`), a nesie
 * čas merania. Sú to dve rôzne vety — appka mohla zľavu zapísať a shop ju
 * medzitým zrušiť, alebo naopak. Zliať ich do jedného stĺpca by z dvoch
 * tvrdení urobilo jedno, ktoré nie je kryté ani jedným zdrojom.
 *
 * ČÍSLO PREDANÝCH JE Z KPI, PORADIE ZO SQL — A NIE JE TO TO ISTÉ
 * ─────────────────────────────────────────────────────────────
 * Zobrazené kusy prichádzajú z `GET /api/insights/product-kpi`, kde je brána
 * `status='complete'`: nedočítaný deň sa NEPOČÍTA a bunka to prizná (`≥`).
 * `unitsSold` z `catalog/search` tú bránu od 31. 8. 2026 MÁ TIEŽ (D121 —
 * `JOIN_SALES` gatuje `status='complete'` a nedočítané okno vracia `null`),
 * takže obe čísla už hovoria to isté pravidlo. V tabuľke sa aj tak
 * NEZOBRAZUJE — dve cesty k tomu istému číslu na jednej obrazovke sú zbytočná
 * príležitosť rozísť sa; číslo nesie KPI a `unitsSold` slúži poradiu. (Pozor:
 * predchádzajúca podoba tejto vety tvrdila, že brána v `catalog/search`
 * CHÝBA — bola to presne ta veta, podľa ktorej by niekto vrátil `?? 0`.) Triedenie
 * „najmenej predané prvé" ho používa ďalej (inak by sa 41 348 riadkov nedalo
 * usporiadať) a hlavička stĺpca to hovorí v `title`: poradie áno, číslo nie.
 *
 * PORADIE: NAJHORŠIE LEŽIAKY PRVÉ, A JE TO VIDIEŤ
 * ───────────────────────────────────────────────
 * Predvolené triedenie je najmenej predané prvé (kontrakt V4 §5 K4; do
 * 31. 8. 2026 najdrahšie prvé, kontrakt UI bod 19). Keby o ňom
 * hlavička mlčala, bol by to neoveriteľný sľub — preto nesie šípku a klikom sa
 * dá prehodiť. Prvý klik na stĺpec je to, čo sa v ňom hľadá najčastejšie: pri
 * cene najdrahšie, pri predaných NAJMENEJ predané (appka je na zlacňovanie
 * ležiakov). Poradie sa nikdy nedotkne výberu — je to tá istá otázka.
 *
 * POČET ZHÔD JE DOLNÁ HRANICA, KÝM JE ZRKADLO NEÚPLNÉ
 * ───────────────────────────────────────────────────
 * `total` je počet v zrkadle katalógu, nie v eshope. Kým zrkadlo nie je celé,
 * pätka ho označí `≈` a tlmene (P7) — presné číslo by bolo tvrdenie, ktoré
 * appka nemá kryté.
 *
 * PREČO NEPREJDE — PRI RIADKU, NIE V PÄTKE
 * ────────────────────────────────────────
 * Riadok, na ktorý sa zľava nezapíše, dostane pod menom krátky príznak
 * („shop ho nenašiel"). Zámerne to NIE JE nový stĺpec: stĺpec by musel byť
 * vyplnený pri všetkých 41 220 riadkoch a 41 217 pomlčiek je šum, nie
 * informácia. Príznak sa objaví len tam, kde je čo povedať, a celá veta aj
 * s ďalším krokom čaká v bočnom paneli. Text príznaku sa TU nevyrába —
 * prichádza z `catalog-status.ts`, aby ho tabuľka a panel nemohli povedať inak.
 *
 * PRÁZDNA TABUĽKA NIE JE JEDEN PRÍBEH
 * ───────────────────────────────────
 * „Filtru nevyhovuje ani jeden produkt" je pravda len nad ÚPLNÝM katalógom,
 * a ani tam nie celá: zrkadlo pozná z produktu len názov a číslo, takže hľadaný
 * kus môže existovať a len mať hľadané slovo v kóde či popise — a to je úplne
 * iná rada než „uvoľnite filter". Tabuľka preto o prázdnom stave nerozhoduje:
 * dostane hotový `emptyState` od obrazovky, ktorá stav katalógu pozná.
 *
 * HUSTOTA PRE 41 220 RIADKOV (D10, 19. 8. 2026)
 * ─────────────────────────────────────────────
 * Zmerané na reálnej databáze: 41 220 produktov, priemerný názov 64 znakov,
 * NAJDLHŠÍ 117 znakov, ceny 0,00 – 1 758,46 €.
 *
 * 1. **Mriežka stĺpcov je pevná** (`table-layout: fixed` + `<colgroup>`).
 *    S automatickým rozložením meria prehliadač VŠETKY názvy na stránke
 *    a najdlhší z nich rozhodne, kde začne stĺpec Cena — čísla sa teda pri
 *    každom preklikaní stránky posunú inam a oko ich hľadá odznova. Pri 825
 *    stránkach je to 825 rôznych mriežok. Pevná mriežka to zastaví: čísla
 *    stoja na tom istom mieste na každej stránke a na každom filtri.
 * 2. **Názov je JEDEN riadok s výpustkou; celý je v `title` aj v bočnom
 *    paneli.** Zalamovanie sa zamietlo: rôzne vysoké riadky rozbijú zvislý
 *    rytmus, podľa ktorého sa stĺpec Cena skenuje, a stránku z 50 riadkov
 *    predĺžia z ≈ 1 600 px na až 2 600 px. Pevné dvojriadkové bunky by rytmus
 *    udržali a zmestili by každý názov, ale platili by +50 % výšky na KAŽDOM
 *    riadku za chvost, ktorý je pri týchto názvoch ozdoba — rozlišovacia časť
 *    („Prevliekací strieborný náhrdelník 925 …") stojí na začiatku. Na úzkej
 *    obrazovke (≤ 640 px) sa riadky menia na karty a názov sa zalamuje celý;
 *    preto tu `white-space` DEDÍ z bunky a nediktuje sa.
 *
 *    KOĽKO MIESTA NÁZOV NAOZAJ DOSTANE (premerané 24. 8. 2026, UX3 — pôvodné
 *    čísla „≈ 745 px / ≈ 112 znakov" v tejto hlavičke boli nadhodnotené a
 *    nikdy nesedeli). Pri 1440 × 900 má obsah pod pásom filtrov 886 px a štyri
 *    pevné stĺpce z neho zoberú 368 px (34 + 130 + 100 + 104), takže:
 *
 *      panel zavretý          → názov 516 px, orezané 3 mená z 50
 *      panel otvorený, 317 px → názov 185 px, orezaných 50 z 50
 *      panel otvorený, 400 px → názov 102 px, orezaných 50 z 50
 *
 *    Výpustka teda ZÁMER JE — chvost sa dá prečítať v `title` aj v paneli
 *    vedľa a mriežka drží. Pri OTVORENOM paneli to však už nie je „oreže sa
 *    chvost najdlhších", ale „z každého mena zostane začiatok": 886 px sa
 *    medzi 400 px panel a skenovateľnú tabuľku rozdeliť nedá. Nie je to
 *    vlastnosť tabuľky — rozhoduje o tom `flex-basis` v `.catalog-split`
 *    (`globals.css`, vlastní UX1) a šírka pásu filtrov. Kto bude tie čísla
 *    meniť, nech premeria toto, nie hlavičku.
 * 3. **Virtualizácia sa nepridáva.** V DOM nikdy nie je 41 348 riadkov —
 *    server stránkuje po 50/100 (strop je od V4 strop KPI, nie strop route). Chýbal spôsob, ako sa na riadok 30 000
 *    DOSTAŤ, nie ako ho vykresliť. Preto skok na stránku a poradie stĺpcov,
 *    nie knižnica navyše.
 * 4. **Skok na stránku sa kreslí až vtedy, keď stránkovač vypúšťa čísla**
 *    (viac než 7 strán). Pri troch stranách by bol políčkom, ktoré nahrádza
 *    kliknutie na číslo vedľa neho.
 *
 * Vlastník: V10; hustota O3.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { CatalogRowView, ProductKpiPageView } from '@/components/products/catalog-api';
import { PRODUCT_DETAIL_ID } from '@/components/products/ProductDetailPanel';
import { CodeLine } from '@/components/products/ProductFacts';
import { codeLine, EMPTY_EXTRAS, type ExtrasStore } from '@/components/products/product-extras';
import type { ProductReason } from '@/components/products/catalog-status';
import type { CatalogSort, PerPage } from '@/components/products/catalog-filter';
import { DEFAULT_CATALOG_FILTER, PER_PAGE_CHOICES } from '@/components/products/catalog-filter';
import type { KpiCellView } from '@/components/products/sold-coverage';
import {
  KPI_DASH,
  kpiCell,
  kpiDiscountCell,
  kpiLastSaleCell,
  kpiNoSaleMark,
  kpiPriceWithVatCell,
  kpiReference,
  kpiSoldPerStockCell,
  kpiUnitsCell,
} from '@/components/products/sold-coverage';
import { formatEur } from '@/lib/ui/format';
import { productLabel } from '@/lib/ui/product-label';
import Icon from '@/components/ui/Icon';
import { FlagMark } from '@/components/ui/StatusMark';
import { formatCountSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Pomôcky ═══════════════════════════════════ */

/**
 * Meno produktu ako tlačidlo. `display: block` + `width: 100%` je to, čo dá
 * výpustke rám, v ktorom má orezávať; `whiteSpace: 'inherit'` je zámerné —
 * v širokom rozložení dedí `nowrap` z bunky, v kartovom (≤ 640 px) `normal`,
 * takže sa názov na úzkej obrazovke zalomí celý bez jedinej media query.
 */
const NAME_BUTTON: CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  display: 'block',
  width: '100%',
  whiteSpace: 'inherit',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * Pevná mriežka stĺpcov (D10, bod 1 v hlavičke). Šírky sú ODMERANÉ v prehliadači
 * na najširšom obsahu, aký sa v stĺpci môže objaviť, plus 24 px odsadenia bunky
 * a 14 px na šípku triedenia:
 *  · `PREDANÉ 360 D` je najdlhší nadpis okna predajnosti — 92 px textu,
 *  · `1 758,46 €` je najdrahší produkt v katalógu — 59 px,
 *  · `ZĽAVA TERAZ` je nadpis širší než ktorákoľvek jeho hodnota — 78 px.
 * Šípka sa počíta aj tam, kde práve nie je: keď sa poradie prehodí, stĺpec sa
 * NESMIE zúžiť ani preliať. Názov dostáva celý zvyšok — pri 1440 px a zavretom
 * paneli 516 px, pri otvorenom 185 px (premerané 24. 8. 2026; rozpis v bode 2
 * hlavičky). Zužovať tieto tri stĺpce, aby názov dostal viac, sa NEDÁ bez
 * skrátenia ich nadpisov: 130/100/104 px je presne to, čo nadpis potrebuje.
 */
/**
 * Od 31. 8. 2026 (kontrakt V4 D114) je stĺpcov desať, nie päť, a preto má
 * mriežka aj `minWidth`: pod ňou sa tabuľka posúva VODOROVNE vo vlastnom ráme
 * (`.tbl-scroll` má `overflow: auto`) namiesto toho, aby si stĺpce zjedli
 * navzájom obsah. Stlačiť desať stĺpcov do 886 px sa nedá bez toho, aby sa
 * čísla zlomili na dva riadky — a tabuľka sa skenuje po zvislej osi.
 */
const COLUMNS: CSSProperties = { tableLayout: 'fixed', minWidth: '1120px' };
const COL_SELECT: CSSProperties = { width: '34px' };
const COL_NAME: CSSProperties = { minWidth: '220px' };
const COL_SOLD: CSSProperties = { width: '104px' };
const COL_SOLD_PER_STOCK: CSSProperties = { width: '112px' };
const COL_LAST_SALE: CSSProperties = { width: '124px' };
const COL_PRICE: CSSProperties = { width: '100px' };
const COL_DISCOUNT: CSSProperties = { width: '104px' };
const COL_SHOP_DISCOUNT: CSSProperties = { width: '112px' };
const COL_MARGIN: CSSProperties = { width: '132px' };

/** Koľko stĺpcov má riadok — pre `colSpan` prázdneho stavu. */
const COLUMN_COUNT = 10;

/** Pod týmto počtom strán stránkovač vypisuje všetky čísla — skok netreba. */
const JUMP_FROM_PAGES = 8;

/**
 * Bunka KPI: hodnota, alebo pomlčka s DÔVODOM (I11).
 *
 * Pomlčka je stlmená (`.lvl-3`) a nesie `title` — dva kanály, aby priznanie
 * nebolo len farba. `data-unknown` je pre testy: overuje sa ním, že sa
 * z „nevieme" nestala nula bez toho, aby test musel hádať z textu.
 *
 * Text sa TU nevyrába. Prichádza z `sold-coverage.ts`, aby o tej istej medzere
 * nemohla tabuľka povedať niečo iné než panel detailu.
 */
function KpiText({ cell, testId }: { cell: KpiCellView; testId?: string }) {
  return (
    <span
      className={cell.unknown ? 'lvl-3' : undefined}
      title={cell.title ?? undefined}
      data-testid={testId}
      data-unknown={cell.unknown ? 'true' : undefined}
      data-lower-bound={cell.lowerBound ? 'true' : undefined}
    >
      {cell.text}
    </span>
  );
}

/** Hlavička sa klikom triedi, ale ostáva hlavičkou — preto dedí celý štýl. */
const SORT_BUTTON: CSSProperties = {
  background: 'transparent',
  border: 0,
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  letterSpacing: 'inherit',
  textTransform: 'inherit',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
};

type PageToken = number | 'gap';

/* ─────────────────────────── Triedenie stĺpcov ────────────────────────────── */

/** Stĺpce, ktoré sa dajú triediť. „Zľava teraz" medzi nimi zámerne nie je. */
export type SortColumn = 'name' | 'sold' | 'price';

/**
 * Dve poradia na stĺpec a to, ktoré príde na prvý klik. Pri predaných je prvé
 * NAJMENEJ predané: obrazovka slúži na hľadanie ležiakov, nie bestsellerov.
 * Názov druhé poradie nemá — API triedi meno len vzostupne.
 */
const COLUMN_SORTS: Readonly<Record<SortColumn, readonly [CatalogSort, CatalogSort]>> = {
  name: ['name', 'name'],
  sold: ['sold_asc', 'sold_desc'],
  price: ['price_desc', 'price_asc'],
};

/** Vzostupné poradia — jediné miesto, kde sa smer pomenúva. */
const ASCENDING: readonly CatalogSort[] = ['name', 'sold_asc', 'price_asc'];

/** Čo klik urobí, povedané slovami — šípka sama o sebe je hádanka. */
const SORT_TITLES: Readonly<Record<CatalogSort, string>> = {
  price_desc: 'Najdrahšie prvé',
  price_asc: 'Najlacnejšie prvé',
  sold_desc: 'Najviac predané prvé',
  sold_asc: 'Najmenej predané prvé',
  name: 'Podľa názvu',
};

/** Kam prehodí klik na hlavičku: druhý klik na ten istý stĺpec otočí smer. */
export function nextSort(column: SortColumn, current: CatalogSort): CatalogSort {
  const [first, other] = COLUMN_SORTS[column];
  return current === first ? other : first;
}

/** Hodnota pre `aria-sort`; `none` = podľa tohto stĺpca sa netriedi. */
export function sortDirection(
  column: SortColumn,
  current: CatalogSort,
): 'ascending' | 'descending' | 'none' {
  const [first, other] = COLUMN_SORTS[column];
  if (current !== first && current !== other) return 'none';
  return ASCENDING.includes(current) ? 'ascending' : 'descending';
}

/**
 * Zoznam čísel stránok s výpustkami: `1 2 3 4 … 233`. Pri 233 stranách sa
 * nedá vypísať všetko a skákanie o desiatky strán nikto nepoužíva — okolie
 * aktuálnej strany a okraje stačia.
 */
export function pageTokens(current: number, pages: number): PageToken[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = new Set<number>([1, 2, pages, current - 1, current, current + 1]);
  const sorted = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: PageToken[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous !== 0 && page - previous > 1) out.push('gap');
    out.push(page);
    previous = page;
  }
  return out;
}

/* ═══════════════════════════ 2. Tabuľka ═══════════════════════════════════ */

export interface CatalogTableProps {
  rows: readonly CatalogRowView[];
  /**
   * Doťahnuté kódy a sklad pre práve zobrazenú stránku.
   *
   * Voliteľné zámerne: tabuľka sa kreslí HNEĎ z toho, čo je v zrkadle, a kódy
   * dobehnú o chvíľu. Keby na ne čakala, používateľ by pri každom prelistovaní
   * videl prázdno namiesto názvov, ktoré appka pozná okamžite.
   */
  extras?: ExtrasStore;
  /**
   * KPI riadkov pre práve zobrazenú stránku (D114), jedným dotazom.
   *
   * `null` je TRETÍ STAV, nie prázdno: KPI ešte nedobehli (alebo sa nedali
   * prečítať) a bunky preto povedia „nevieme", nie nulu. Tabuľka sa kreslí hneď
   * z toho, čo je v zrkadle — čakať na KPI by znamenalo pri každom prelistovaní
   * zablikať prázdnom namiesto názvov, ktoré appka pozná okamžite.
   */
  kpi?: ProductKpiPageView | null;
  /**
   * Okno, ktoré si obrazovka naklikala vo filtri. NIE je to okno zobrazených
   * kusov (to hovorí `kpi.shortWindowDays`) — používa sa len na vetu o tom, čo
   * robí triedenie „najmenej predané prvé".
   */
  soldWindowDays: number;
  total: number;
  /**
   * P7 — `total` je počet v ZRKADLE katalógu. Kým zrkadlo nie je úplné, je to
   * dolná hranica: v eshope môže byť viac. `true` → pätka číslo označí `≈`
   * a stlmí. Predvolene `false`, aby sa nedalo označiť merané číslo omylom.
   */
  totalIsLowerBound?: boolean;
  page: number;
  perPage: PerPage;
  loading: boolean;
  selected: ReadonlySet<number>;
  /** `true` = vybrané je všetko, čo vyhovuje filtru, nielen táto stránka. */
  allMatchingSelected: boolean;
  onToggleRow: (productId: number, checked: boolean) => void;
  onTogglePage: (checked: boolean) => void;
  onOpenDetail: (productId: number) => void;
  /**
   * Riadok, ktorý práve popisuje panel detailu vedľa tabuľky (K1). `null` =
   * žiadny, teda panel nie je otvorený.
   *
   * Kým bol detail prekryv, väzba bola zrejmá: panel priletel a odletel. Ako
   * trvalý druhý stĺpec by bez tejto značky ukazoval kus, ktorého riadok
   * v päťdesiatich ďalších nikto nenájde. Značka ide DVOMA kanálmi — `.open`
   * kreslí zvislý prúžok pri riadku (nie iba farbu) a `aria-current` to
   * povie čítačke.
   */
  openId?: number | null;
  onPage: (page: number) => void;
  onPerPage: (perPage: PerPage) => void;
  /** Platné poradie riadkov. Predvolene najdrahšie prvé (kontrakt UI, bod 19). */
  sort?: CatalogSort;
  /** Bez tejto funkcie sa hlavičky nedajú klikať a poradie len ukazujú. */
  onSort?: (sort: CatalogSort) => void;
  /**
   * Prečo sa na tento riadok zľava nezapíše. `null` = nič mu nevyčítame.
   * Rozhoduje o tom volajúci, nie tabuľka — pozri hlavičku modulu.
   */
  rowReason?: (row: CatalogRowView) => ProductReason | null;
  /**
   * Čo sa ukáže namiesto prázdnej tabuľky. Bez neho zostane holá veta o filtri,
   * ktorá je nad neúplným katalógom nepravdivá — preto ho obrazovka posiela.
   */
  emptyState?: ReactNode;
}

export function CatalogTable({
  rows,
  extras = EMPTY_EXTRAS,
  kpi = null,
  soldWindowDays,
  total,
  totalIsLowerBound = false,
  page,
  perPage,
  loading,
  selected,
  allMatchingSelected,
  onToggleRow,
  onTogglePage,
  onOpenDetail,
  openId = null,
  onPage,
  onPerPage,
  sort = DEFAULT_CATALOG_FILTER.sort,
  onSort,
  rowReason,
  emptyState,
}: CatalogTableProps) {
  const headBox = useRef<HTMLInputElement | null>(null);

  /* Dĺžky okien tak, ako ich POVEDALA odpoveď KPI. Kým odpoveď nie je, drží sa
     to, čo si obrazovka vypýtala (30 a 90 dní) — nadpis stĺpca sa nesmie
     rozísť s číslom, ktoré je pod ním. */
  const shortDays = kpi === null ? 30 : kpi.shortWindowDays;
  const longDays = kpi === null ? 90 : kpi.longWindowDays;

  /**
   * Nadpis stĺpca. Bez `onSort` je to len text — hlavička, ktorá vyzerá
   * klikateľne a nič nerobí, je horšia než hlavička bez šípky.
   *
   * `note` je veta o tom, čo triedenie NEVIE. Pri predaných kusoch je to
   * podstatné: poradie počíta SQL z nedočítaného súčtu, kým číslo v bunke má
   * bránu `status='complete'`.
   */
  function columnHead(column: SortColumn, label: string, note?: string): ReactNode {
    const direction = sortDirection(column, sort);
    if (onSort === undefined) return label;
    const next = nextSort(column, sort);
    return (
      <button
        type="button"
        style={SORT_BUTTON}
        title={note === undefined ? SORT_TITLES[next] : `${SORT_TITLES[next]} — ${note}`}
        onClick={() => onSort(next)}
        data-testid={`sort-${column}`}
      >
        {label}
        {/* Smer je pre čítačku na `<th aria-sort>`, nie tu — ikona by ho
            prečítala druhýkrát. Slovami ho hovorí `title` (SORT_TITLES). */}
        {direction === 'none' ? null : (
          <Icon name={direction === 'ascending' ? 'chevronUp' : 'chevronDown'} size={0.85} />
        )}
      </button>
    );
  }

  const onPageSelected = rows.filter((row) => selected.has(row.productId)).length;
  const pageAll = rows.length > 0 && onPageSelected === rows.length;
  const pageSome = onPageSelected > 0 && !pageAll;

  useEffect(() => {
    const node = headBox.current;
    if (node === null) return;
    node.indeterminate = pageSome && !allMatchingSelected;
  }, [pageSome, allMatchingSelected]);

  const pages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="tbl-frame" data-testid="catalog-table">
      <div className="tbl-scroll">
        <table className="tbl" style={COLUMNS}>
          {/* Pevná mriežka — pozri bod 1 v hlavičke modulu. V kartovom
              rozložení (≤ 640 px) sa tabuľka kreslí ako bloky a `col` sa
              neuplatní, čo je správne: karta má jeden stĺpec. */}
          <colgroup>
            <col style={COL_SELECT} />
            <col style={COL_NAME} />
            <col style={COL_SOLD} />
            <col style={COL_SOLD} />
            <col style={COL_SOLD_PER_STOCK} />
            <col style={COL_LAST_SALE} />
            <col style={COL_PRICE} />
            <col style={COL_DISCOUNT} />
            <col style={COL_SHOP_DISCOUNT} />
            <col style={COL_MARGIN} />
          </colgroup>
          <thead>
            <tr>
              <th className="sel">
                <input
                  ref={headBox}
                  className="cb"
                  type="checkbox"
                  checked={allMatchingSelected || pageAll}
                  disabled={rows.length === 0}
                  aria-label="Označiť celú stránku"
                  onChange={(event) => onTogglePage(event.target.checked)}
                  data-testid="select-page"
                />
              </th>
              <th aria-sort={sortDirection('name', sort)}>{columnHead('name', 'Názov')}</th>
              <th className="n" aria-sort={sortDirection('sold', sort)}>
                {columnHead(
                  'sold',
                  `Predané ${shortDays} d`,
                  `poradie počíta server zo súčtu za ${soldWindowDays} dní vrátane ` +
                    'nedočítaných dní, kým číslo v stĺpci je len za dočítané dni',
                )}
              </th>
              <th
                className="n"
                title={`Predané kusy za ${longDays} dní — len za dni, ktoré má appka naozaj stiahnuté.`}
              >
                Predané {longDays} d
              </th>
              {/* Stĺpec sa menuje tým, čo v ňom JE (`qty_in_orders / qty`).
                  „Ako rýchlo sa predáva" to nie je a pomenovať ho tak sa nesmie:
                  `getFull` dáva zásobu ako jednu momentku, nie priemer za
                  obdobie (I11, stráži to `sales-insights.spec.ts`). */}
              <th
                className="n"
                title="Koľkokrát sa aktuálna zásoba už predala: celkovo predané / sklad."
              >
                Predané / sklad
              </th>
              <th className="n" title="Posledný predaj podľa shopu, zmerané pri obohatení produktu.">
                Posledný predaj
              </th>
              <th className="n" aria-sort={sortDirection('price', sort)}>
                {columnHead('price', 'Cena')}
              </th>
              <th className="n" title="Podľa vlastných zápisov appky">
                Zľava teraz
              </th>
              <th
                className="n"
                title="Podľa shopu, k času obohatenia produktu — iná veta než „Zľava teraz“, ktorá hovorí o našich zápisoch."
              >
                Zľava v shope
              </th>
              <th className="n" title="Marža tak, ako ju poslal shop. Appka ju nepočíta.">
                Marža
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMN_COUNT} className="lvl-3" style={{ padding: '18px 12px' }}>
                  {loading ? (
                    'Načítavam…'
                  ) : emptyState !== undefined ? (
                    emptyState
                  ) : (
                    <>Filtru nevyhovuje ani jeden z načítaných produktov.</>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const checked = allMatchingSelected || selected.has(row.productId);
                const reason = rowReason?.(row) ?? null;
                /* KPI riadku. `undefined` = odpoveď o TOMTO riadku nie je
                   (ešte nedobehla, alebo ju stránka nedostala) — bunky z toho
                   spravia „nevieme", nikdy nulu. */
                const k = kpi === null ? undefined : kpi.byId.get(row.productId);
                /* D116 — na povrchu `referencia · názov`. Referencia sa berie
                   VÝHRADNE ako meraná hodnota (`kpiReference`): keby sa vzala
                   aj z medzery, appka by tvrdila, že produkt referenciu nemá. */
                const label = productLabel({
                  productId: row.productId,
                  reference: kpiReference(k),
                  name: row.name,
                });
                const noSale = kpiNoSaleMark(k?.noSale);
                const priceWithVat = kpiPriceWithVatCell(k);
                const marginEur = kpiCell(k?.margin, (value) => formatEur(value));
                const marginPercent = kpiCell(k?.marginPercent, (value) => `${value} %`);
                /* Otvorený a označený je to isté dvakrát len zdanlivo: výber
                   je „pôjde do zľavy", otvorenie je „toto teraz čítam vpravo".
                   Preto sa triedy skladajú, nie vylučujú. */
                const open = openId !== null && openId === row.productId;
                const classes = [checked ? 'on' : null, open ? 'open' : null]
                  .filter((name) => name !== null)
                  .join(' ');
                return (
                  <tr
                    key={row.productId}
                    className={classes === '' ? undefined : classes}
                    aria-current={open ? true : undefined}
                  >
                    <td className="sel">
                      <input
                        className="cb"
                        type="checkbox"
                        checked={checked}
                        aria-label={`Označiť ${label.text}`}
                        onChange={(event) => onToggleRow(row.productId, event.target.checked)}
                        data-testid={`select-row-${row.productId}`}
                      />
                    </td>
                    <td className="name" data-l="Produkt">
                      {/* `title` je celý názov — orezaný chvost sa dá prečítať
                          bez otvorenia panela (D10, bod 2 v hlavičke). */}
                      {/* Tlačidlo názvu otvára panel detailu vedľa tabuľky,
                          teda je to ROZKLIK — a rozklik musí povedať, či je
                          otvorený a čo otvára. Bez toho sa po stlačení názvu
                          čítačke nezmení nič: `.open` a `aria-current` sú na
                          RIADKU a hovoria „toto teraz čítam vpravo", nie
                          „stlačením tohto sa vpravo niečo otvorilo". */}
                      <button
                        type="button"
                        style={NAME_BUTTON}
                        /* `title` nesie celé pomenovanie AJ `id`: technický
                           identifikátor patrí do detailu (D116), ale musí byť
                           dosiahnuteľný bez otvorenia panela. */
                        title={`${label.text} · ${label.technical}`}
                        aria-expanded={open}
                        aria-controls={PRODUCT_DETAIL_ID}
                        onClick={() => onOpenDetail(row.productId)}
                        data-testid={`open-detail-${row.productId}`}
                      >
                        {/* NEOBOHATENÝ PRODUKT SA PRIZNÁ, NIE ZAMLČÍ (D116).
                            Pomlčka na mieste referencie znamená „zatiaľ
                            nevieme"; kreslí sa až KEĎ odpoveď KPI prišla —
                            pred ňou by to bolo priznanie niečoho, na čo sa
                            appka ešte nespýtala (tretí stav). */}
                        {label.referenceUnknown && k !== undefined ? (
                          <span
                            className="lvl-3"
                            title="Referenciu appka zatiaľ nemá — produkt nie je obohatený. Neznamená to, že produkt referenciu nemá."
                            data-testid={`row-reference-unknown-${row.productId}`}
                          >
                            {KPI_DASH}{' · '}
                          </span>
                        ) : null}
                        {label.text}
                      </button>
                      {/* Kód a EAN — tichý druhý riadok. Pri prázdne nesie
                          SLOVO, nie len pomlčku: „ešte sa doťahuje",
                          „vyžaduje kľúč" a „shop ho nevedie" sú tri rôzne veci
                          a zliať ich by zahodilo jedinú informáciu, ktorá pri
                          prázdnej bunke niekoho zaujíma. */}
                      <CodeLine line={codeLine(row, extras.byId.get(row.productId))} />
                      {reason === null ? null : (
                        // `.flag` nesie glyf aj farbu; text je tretí kanál —
                        // stav nikdy nie je len farba.
                        <div
                          className={reason.tone === 'attention' ? 'flag' : 'flag neutral'}
                          data-testid={`row-reason-${reason.id}`}
                        >
                          <FlagMark tone={reason.tone === 'attention' ? 'attention' : 'neutral'} />
                          {reason.short}
                        </div>
                      )}
                      {/* ZNAČKA „BEZ PREDAJA" LEN S DÔKAZOM (D119).
                          Neobohatený produkt NIE JE mŕtvy produkt — je to
                          neznámy produkt, a na jeho riadku sa táto značka
                          nesmie objaviť. Rozhoduje o tom `kpiNoSaleMark()`,
                          ktorý bez `proof` vráti `null`; tabuľka si podmienku
                          neskladá sama, aby sa nedala „doladiť" na povrchu. */}
                      {noSale === null ? null : (
                        <div
                          className="flag neutral"
                          title={noSale.title}
                          data-testid={`row-no-sale-${row.productId}`}
                        >
                          <FlagMark tone="neutral" />
                          {noSale.text}
                        </div>
                      )}
                      {/* I11 — riadok dohľadaný v eshope stojí na inej istote
                          než riadok zo zrkadla: zrkadlo je posledný prechod
                          synchronizácie, eshop je odpoveď z tejto chvíle.
                          Bez tohto by na obrazovke stáli vedľa seba dva rôzne
                          stupne istoty a vyzerali by rovnako. */}
                      {row.origin === 'shop' ? (
                        <div className="flag neutral" data-testid="row-origin-shop">
                          <FlagMark tone="neutral" />
                          dohľadané v eshope
                        </div>
                      ) : null}
                    </td>
                    <td className="n" data-l={`Predané ${shortDays} d`}>
                      <KpiText
                        cell={kpiUnitsCell(k?.units30)}
                        testId={`kpi-units30-${row.productId}`}
                      />
                    </td>
                    <td className="n" data-l={`Predané ${longDays} d`}>
                      <KpiText
                        cell={kpiUnitsCell(k?.units90)}
                        testId={`kpi-units90-${row.productId}`}
                      />
                    </td>
                    <td className="n" data-l="Predané / sklad">
                      <KpiText
                        cell={kpiSoldPerStockCell(k)}
                        testId={`kpi-sold-per-stock-${row.productId}`}
                      />
                    </td>
                    <td className="n" data-l="Posledný predaj">
                      <KpiText
                        cell={kpiLastSaleCell(k)}
                        testId={`kpi-last-sale-${row.productId}`}
                      />
                    </td>
                    {/* Cena je zo zoznamového prechodu katalógu, teda BEZ
                        obohatenia — pozná ju appka pre každý riadok. Cena
                        s DPH z `getFull` je v `title`, nie na povrchu: dva
                        peňažné stĺpce vedľa seba by sa čítali ako jedna cena
                        a druhý by vyzeral ako chyba. */}
                    <td className="n" data-l="Cena" title={`S DPH: ${priceWithVat.text}`}>
                      {formatEur(row.price)}
                    </td>
                    <td className="n" data-l="Zľava teraz">
                      {row.discountedNow ? 'v zľave' : KPI_DASH}
                    </td>
                    <td className="n" data-l="Zľava v shope">
                      <KpiText
                        cell={kpiDiscountCell(k?.discount)}
                        testId={`kpi-shop-discount-${row.productId}`}
                      />
                    </td>
                    {/* Marža v EUR a v % sú DVE hodnoty z `getFull` a každá má
                        vlastnú medzeru — preto dve bunky v jednom stĺpci a nie
                        jeden reťazec, ktorý by pri jednej chýbajúcej polovici
                        musel zmiznúť celý. */}
                    <td className="n" data-l="Marža">
                      <KpiText cell={marginEur} testId={`kpi-margin-${row.productId}`} />
                      {' · '}
                      <KpiText
                        cell={marginPercent}
                        testId={`kpi-margin-percent-${row.productId}`}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="tbl-foot">
        {/* P7 — dolná hranica sa píše `≈` a BEZ tučného: merané číslo a odhad
            nesmú mať rovnaký štýl. Čo `≈` znamená, hovorí popis pri čísle.
            Nula sa neoznačuje: „≈ 0" nie je odhad, ale nezmysel — o prázdnom
            výsledku hovorí prázdny stav, nie pätka. */}
        <span>
          Zobrazených {formatCountSk(rows.length)} z{' '}
          {totalIsLowerBound && total > 0 ? (
            <span
              className="num"
              title="Počet v načítaných riadkoch — v eshope ich môže byť viac."
              data-testid="table-total-approx"
            >
              ≈ {formatCountSk(total)}
            </span>
          ) : (
            <b className="num">{formatCountSk(total)}</b>
          )}
          {/* Kde v poradí človek stojí. Pri 41 220 riadkoch a 825 stránkach je
              samotné „zobrazených 50" údaj bez orientácie (D10). */}
          {pages > 1 ? (
            <span className="num" data-testid="table-page-of">
              {' · strana '}
              {formatCountSk(page)} z {formatCountSk(pages)}
            </span>
          ) : null}
        </span>
        <div className="row" style={{ gap: '14px' }}>
          {/* `role="group"` — bez roly je `aria-label` na `<div>` neplatný
              a čítačka ho zahodí (to isté vo filtroch a v paneli detailu). */}
          <div className="seg" role="group" aria-label="Riadkov na stránku">
            {PER_PAGE_CHOICES.map((size) => (
              <button
                key={size}
                type="button"
                className={size === perPage ? 'on' : undefined}
                aria-pressed={size === perPage}
                onClick={() => onPerPage(size)}
              >
                {size}
              </button>
            ))}
          </div>
          <nav className="pager" aria-label="Stránkovanie">
            {pageTokens(page, pages).map((token, index) =>
              token === 'gap' ? (
                <span key={`gap-${index}`}>…</span>
              ) : token === page ? (
                <span className="cur" key={token} aria-current="page">
                  {token}
                </span>
              ) : (
                <a
                  key={token}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    onPage(token);
                  }}
                >
                  {token}
                </a>
              ),
            )}
          </nav>
          {pages >= JUMP_FROM_PAGES ? <PageJump pages={pages} onPage={onPage} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ 3. Skok na stránku ═══════════════════════════ */

/**
 * Rýchly skok (D10). Stránkovač ponúka okolie aktuálnej strany a okraje —
 * z 825 strán je tak dosiahnuteľných šesť. Toto je zvyšok: napíš číslo, choď.
 *
 * Prečo formulár a nie skok pri písaní: každá zmena strany je dotaz na server
 * a písanie „412" by poslalo tri (4, 41, 412). Potvrdenie je jeden dotaz.
 * Mimo rozsahu sa nič nedeje — tabuľka nespadne na prvú stranu, lebo tichý
 * skok inam, než človek napísal, je horší než žiadny skok.
 */
export function PageJump({ pages, onPage }: { pages: number; onPage: (page: number) => void }) {
  const [draft, setDraft] = useState('');

  function jump(event: { preventDefault: () => void }) {
    event.preventDefault();
    const wanted = Number.parseInt(draft.trim(), 10);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > pages) return;
    onPage(wanted);
    setDraft('');
  }

  return (
    <form className="row" style={{ gap: '6px' }} onSubmit={jump}>
      <label className="lvl-3" htmlFor="catalog-page-jump">
        Strana
      </label>
      <input
        id="catalog-page-jump"
        className="inp"
        style={{ width: '72px', padding: '3px 7px', fontSize: '12px' }}
        inputMode="numeric"
        value={draft}
        placeholder={`1 – ${pages}`}
        aria-label={`Prejsť na stranu, 1 až ${pages}`}
        onChange={(event) => setDraft(event.target.value)}
        data-testid="page-jump-input"
      />
      <button type="submit" className="btn sm ghost" data-testid="page-jump-go">
        Prejsť
      </button>
    </form>
  );
}

export default CatalogTable;
