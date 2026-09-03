/**
 * Aura Zľavy — MODEL TABUĽKY PRODUKTOV NA PREHĽADE (V7, D159–D163).
 *
 * Čistý modul: žiadny React, žiadny `fetch`, žiadne `use client`. Kreslí
 * `ProductsTable.tsx`, číta `products-table-api.ts`, vzhľad je
 * v `products-table.module.css` (D143).
 *
 * ČO TENTO MODUL ROZHODUJE — a prečo to nie je v komponente
 * ────────────────────────────────────────────────────────
 * Štyri veci, ktoré sa dajú pokaziť tak, že to na obrazovke vyzerá v poriadku,
 * a preto sa dajú overiť BEZ prehliadača:
 *
 *  1. **Deväť stĺpcov v poradí D159.** Poradie NEURČUJE tento modul — určuje
 *     ho `PRODUCT_COLUMN_IDS` (D124) a `productColumns()` vstupné poradie
 *     zámerne ignoruje. Tu stojí len ZOZNAM toho, čo tabuľka kreslí, a je to
 *     celá sada: Prehľad je jediná tabuľka, ktorá nevynecháva ani jeden
 *     stĺpec.
 *  2. **Preklad riadku na hodnoty stĺpcov.** Chýbajúce KPI sa NEDOPĹŇA
 *     prázdnymi poľami: vynechané pole znamená `not_asked` („ešte sa
 *     nenačítali"), kým vyplnené pole s `null` znamená „pýtali sme sa a
 *     nevieme". Sú to dve rôzne vety a zliať ich je presne to, čo I11 zakazuje.
 *  3. **Triedenie v TROCH stavoch** (D162) — pozri `nextSortState()`.
 *  4. **Veta o riadkoch bez zmeraného predaja** (D121) — pozri
 *     `unknownSoldNote()`. Pásma predaných o produkte, ktorého predaj appka
 *     nezmerala, NEHOVORIA NIČ; obrazovka to musí povedať ČÍSLOM, nie
 *     zamlčať.
 *
 * ČO TENTO MODUL NEROBÍ
 * ─────────────────────
 *  · Nedrží stav okna predaja. Ten je JEDEN a leží v `Overview.tsx` (D155);
 *    `prehlad-kpi-okno.spec.ts` §B padne, keď si ho niekto otvorí druhý raz.
 *  · Nevymýšľa zamknuté rozmery. Zoznam je `LOCKED_DIMENSIONS`
 *    (`lib/ui/locked-dimensions.ts`), odvodený od typu v repozitári, takže
 *    pridanie či odobranie rozmeru PRESTANE SA KOMPILOVAŤ — nie je to grep
 *    (D125, K4, K7). Druhý zoznam vedľa neho sa tu nepíše.
 *  · Nefiltruje riadky. Filtruje SERVER nad celým zrkadlom; zúžiť naklikanú
 *    stránku a tvrdiť o 41 348 riadkoch niečo, čo appka overila na
 *    päťdesiatich, by bola tichá nepravda.
 *
 * Vlastník: V7, krok 3/4 (tabuľka s filtrami).
 */
import type {
  OverviewCatalogRow,
  OverviewKpiRow,
} from '@/components/dashboard/products-table-api';
import { OVERVIEW_KPI_IDS_MAX } from '@/components/dashboard/products-table-api';
import type { SoldWindow } from '@/components/dashboard/sold-window';
import { LOCKED_DIMENSIONS, LOCKED_DIMENSION_LABEL } from '@/lib/ui/locked-dimensions';
import { formatCountSk } from '@/lib/ui/vocabulary';
import {
  PRODUCT_COLUMN_IDS,
  productColumns,
  valueOrGap,
  type ProductColumn,
  type ProductRowValues,
} from '@/lib/ui/product-columns';

/* ═══════════════════════════ 1. Stĺpce (D159) ═════════════════════════════ */

/**
 * Čo tabuľka Prehľadu kreslí: CELÚ jednotnú sadu, teda deväť stĺpcov —
 * referencia · názov · cena · zľava v shope · predané za okno · predané/sklad ·
 * sklad · marža · EAN (D159).
 *
 * Poradie sa tu NEDEKLARUJE. `productColumns()` vstupné poradie ignoruje a
 * berie `PRODUCT_COLUMN_IDS`, takže tento zoznam je len ČLENSTVO; keby sa
 * poradie D159 malo zmeniť, mení sa definícia sady, nie táto obrazovka.
 * Zoznam je preto odvodený a nie prepísaný — druhá kópia deviatich mien by sa
 * pri prvej zmene sady rozišla a nikto by si to nevšimol.
 */
export const OVERVIEW_TABLE_COLUMN_IDS = PRODUCT_COLUMN_IDS;

/** Stĺpce pripravené na vykreslenie; okno pomenúva nadpis „Predané N d". */
export function overviewTableColumns(soldWindowDays: number | null): readonly ProductColumn[] {
  return productColumns(OVERVIEW_TABLE_COLUMN_IDS, { soldWindowDays });
}

/**
 * Riadok zrkadla + KPI riadku → hodnoty jednotných stĺpcov.
 *
 * `kpi === undefined` znamená „KPI tejto stránky ešte nedobehli" a vtedy sa
 * polia NEPOSIELAJÚ vôbec — definícia stĺpca z toho urobí `not_asked`, teda
 * pomlčku s vetou „KPI tohto riadku sa ešte nenačítali". Poslať namiesto toho
 * `{ value: null, gap: null }` by tvrdilo „pýtali sme sa a shop nič nevie", čo
 * je iná veta o inom stave (bod 2 hlavičky).
 *
 * Názov a cena idú zo ZRKADLA, nie z obohatenia: appka ich pozná pre každý
 * riadok, takže ich prázdno je „shop o tom nič nevie" (`shop_has_none`), nie
 * „neobohatené". `productId` sa posiela VŽDY — je to posledné východisko
 * identifikácie riadku (`#id`, D151).
 */
export function overviewRowValues(
  row: OverviewCatalogRow,
  kpi: OverviewKpiRow | undefined,
): ProductRowValues {
  return {
    productId: row.productId,
    name: valueOrGap(row.name, 'shop_has_none'),
    price: valueOrGap(row.price, 'shop_has_none'),
    ...(kpi === undefined
      ? {}
      : {
          reference: kpi.reference,
          ean13: kpi.ean13,
          discountNow: {
            state: kpi.discount.state,
            percent: kpi.discount.activePercent,
            from: kpi.discount.from,
            to: kpi.discount.to,
            measuredAt: kpi.discount.measuredAt,
          },
          soldWindow: kpi.unitsWindow,
          soldPerStock: {
            ratio: kpi.soldPerStock,
            soldTotal: kpi.soldTotal,
            stock: kpi.stock,
          },
          margin: { eur: kpi.margin, percent: kpi.marginPercent },
          stock: kpi.stock,
        }),
  };
}

/* ═══════════════════════════ 2. Filtre (D160) ═════════════════════════════ */

/**
 * Pásma predaných za okno. Kódy sú tie isté, aké pozná repozitár
 * (`SoldBucket`), hranice sú TIE ISTÉ, aké má SQL — 0 · 1–2 · 3–9 · 10+.
 *
 * `none` (nula predaných) je dosiahnuteľné VÝHRADNE z celého dočítaného okna
 * (D121): pri neúplnom okne nie je nula meraný fakt a server v tom pásme
 * nevráti nič. Popisok to preto NESĽUBUJE ako „žiadny predaj", ale ako
 * „0 predaných", a vetu o nezmeraných riadkoch nesie `unknownSoldNote()`.
 */
export const SOLD_BANDS = [
  { code: 'none', label: '0' },
  { code: 'low', label: '1–2' },
  { code: 'mid', label: '3–9' },
  { code: 'high', label: '10+' },
] as const;

export type SoldBandCode = (typeof SOLD_BANDS)[number]['code'];

const SOLD_BAND_CODES: readonly SoldBandCode[] = SOLD_BANDS.map((band) => band.code);

/**
 * Stav zľavy podľa VLASTNÝCH zápisov appky (I11).
 *
 * Nie je to stav v shope — ten je v stĺpci „Zľava v shope" a je to iná veta.
 * Zliať ich do jedného filtra by znamenalo, že človek nevie, čie tvrdenie
 * práve zúžil.
 *
 * `ever` („bola už niekedy") zahŕňa AJ zľavu, ktorá beží dnes: je to otázka
 * o histórii, nie o dnešku. Do 3. 9. 2026 sa podľa neho filtrovať nedalo —
 * príznak niesol každý riadok, ale server preň nemal parameter, takže tretia
 * možnosť by musela zúžiť naklikanú stránku (D160, `everDiscounted`).
 */
export const DISCOUNT_FILTERS = [
  { code: 'all', label: 'Všetky', param: null },
  { code: 'now', label: 'V zľave', param: 'currentlyDiscounted' },
  { code: 'never', label: 'Bez zľavy', param: 'neverDiscounted' },
  { code: 'ever', label: 'Bola už niekedy', param: 'everDiscounted' },
] as const;

export type DiscountFilterCode = (typeof DISCOUNT_FILTERS)[number]['code'];

/** Fail-closed: čokoľvek mimo zoznamu je `all`, teda „nezúžené". */
export function isDiscountFilter(value: string): value is DiscountFilterCode {
  return DISCOUNT_FILTERS.some((entry) => entry.code === value);
}

/**
 * Koľko riadkov na stránku (D161).
 *
 * Odvodené od stropu route KPI (`MAX_KPI_IDS = 100`), nie prepísané: 200 už
 * raz V4 vrátil späť, pretože širšia strana znamená riadky BEZ KPI — teda sto
 * riadkov pomlčiek, ktoré nič nepriznávajú. Kto strop zdvihne, zdvihne ho na
 * jednom mieste.
 */
export const PER_PAGE_CHOICES = [50, OVERVIEW_KPI_IDS_MAX] as const;

export type OverviewPerPage = (typeof PER_PAGE_CHOICES)[number];

export const DEFAULT_PER_PAGE: OverviewPerPage = 50;

/** Fail-closed: neznáma veľkosť stránky sa NEPRIJME (tichý fallback klame). */
export function isPerPage(value: number): value is OverviewPerPage {
  return (PER_PAGE_CHOICES as readonly number[]).includes(value);
}

/* ═══════════════════════════ 3. Triedenie (D162) ══════════════════════════ */

/**
 * Podľa čoho sa dá triediť — a prečo len podľa dvoch stĺpcov.
 *
 * Zrkadlo vie v SQL zoradiť podľa mena, ceny a predaných kusov (`SORT_SQL`
 * v `catalog.repo.ts`). Z toho má OBA smery iba cena a predané; meno má
 * v API len vzostupné poradie, takže by jeho hlavička mala DVA stavy tam, kde
 * ostatné majú tri — a „tri stavy" by prestalo byť pravidlo. Ostatné stĺpce
 * (referencia, sklad, marža, EAN, zľava v shope) v SQL poradie NEMAJÚ vôbec.
 *
 * Hlavička, ktorá vyzerá klikateľne a nič nerobí, je horšia než hlavička bez
 * šípky (to isté rozhodnutie, aké má referencia na Produktoch), preto sa
 * netriediteľné stĺpce ako triediteľné NEKRESLIA.
 */
export const SORTABLE_COLUMNS = ['price', 'soldWindow'] as const;

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export type SortDir = 'asc' | 'desc';

/** Naklikané poradie. `null` = pôvodné poradie zrkadla (tretí stav). */
export interface OverviewSort {
  readonly key: SortableColumn;
  readonly dir: SortDir;
}

export function isSortableColumn(value: string): value is SortableColumn {
  return (SORTABLE_COLUMNS as readonly string[]).includes(value);
}

/**
 * TRI STAVY JEDNEJ HLAVIČKY (D162): vzostupne → zostupne → zrušené.
 *
 * Tretí stav nie je kozmetika. Bez neho sa človek k pôvodnému poradiu už
 * nedostane — musel by obnoviť stránku, a to je „vypni a zapni" ako súčasť
 * ovládania. Zrušené poradie je `null` a query z neho pošle `sort=id`, teda
 * `product_id ASC`: SKUTOČNÉ pôvodné poradie zrkadla, nie „podľa mena", ktoré
 * by tretí stav zamenilo za štvrtý spôsob triedenia.
 *
 * Klik na INÝ stĺpec začína odznova vzostupne — prenášať smer z predošlého
 * stĺpca znamená, že prvý klik niekedy zoradí opačne, než človek čaká.
 */
export function nextSortState(current: OverviewSort | null, key: SortableColumn): OverviewSort | null {
  if (current === null || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

/**
 * Poradie v jazyku API (`sort=`). `id` je pôvodné poradie zrkadla.
 *
 * Mená sú z whitelistu route (`SORTS` v `api/catalog/search/route.ts`);
 * čokoľvek iné by route zahodila a poradie by sa ticho rozišlo s tým, čo
 * hlavička hlási cez `aria-sort`.
 */
export function sortParam(sort: OverviewSort | null): string {
  if (sort === null) return 'id';
  if (sort.key === 'price') return sort.dir === 'asc' ? 'price_asc' : 'price_desc';
  return sort.dir === 'asc' ? 'sold_asc' : 'sold_desc';
}

/**
 * Čo urobí klik, povedané slovami. Šípka sama o sebe je hádanka a `aria-sort`
 * hovorí len stav, nie ďalší krok.
 */
export function sortActionTitle(current: OverviewSort | null, key: SortableColumn): string {
  const next = nextSortState(current, key);
  if (next === null) return 'Klik zruší poradie a vráti pôvodné poradie zrkadla.';
  if (key === 'price') {
    return next.dir === 'asc' ? 'Klik zoradí: najlacnejšie prvé.' : 'Klik zoradí: najdrahšie prvé.';
  }
  return next.dir === 'asc'
    ? 'Klik zoradí: najmenej predané prvé.'
    : 'Klik zoradí: najviac predané prvé.';
}

/* ═══════════════════════════ 4. Otázka do query ═══════════════════════════ */

/** Naklikaná otázka. Jeden objekt, aby sa dala porovnať aj poslať ako celok. */
export interface OverviewTableQuery {
  /** Hľadaný text — názov, referencia alebo EAN (D160). Prázdny = bez filtra. */
  readonly search: string;
  readonly discount: DiscountFilterCode;
  readonly bands: readonly SoldBandCode[];
  readonly sort: OverviewSort | null;
  readonly page: number;
  readonly perPage: OverviewPerPage;
}

export const DEFAULT_TABLE_QUERY: OverviewTableQuery = {
  search: '',
  discount: 'all',
  bands: [],
  sort: null,
  page: 1,
  perPage: DEFAULT_PER_PAGE,
};

/**
 * Otázka + okno → `URLSearchParams` pre `/api/catalog/search`.
 *
 * Okno je PARAMETER, nie pole otázky: drží ho `Overview.tsx` (D155) a tabuľka
 * si ho nesmie zapamätať, inak by po prepnutí prepínača kreslila iné obdobie
 * než tretia karta nad ňou.
 *
 * `counts=1` sa neposiela — je to predvolené správanie route a počty tabuľka
 * POTREBUJE: `soldUnknown` je jediný spôsob, ako povedať číslom, koľko riadkov
 * do pásiem nepatrí (D121).
 *
 * Predvolené voľby sa NEPOSIELAJÚ: prázdne hľadanie, `all` a prázdne pásma
 * znamenajú „bez filtra", takže adresa zostáva krátka a odpoveď je tá istá.
 * Poradie sa posiela VŽDY (aj `id`), pretože repozitár má vlastný default
 * `name` — nepovedať poradie znamená dostať iné, než hlavička hlási.
 */
export function overviewTableParams(
  query: OverviewTableQuery,
  soldWindowDays: SoldWindow,
): URLSearchParams {
  const params = new URLSearchParams();
  const search = query.search.trim();
  if (search !== '') params.set('q', search);
  params.set('soldWindowDays', String(soldWindowDays));

  /* Poradie pásiem je poradie ZOZNAMU, nie poradie klikania — dve rovnaké
     otázky musia dať ten istý query string, inak sa nedajú porovnať. */
  const bands = SOLD_BAND_CODES.filter((code) => query.bands.includes(code));
  if (bands.length > 0) params.set('soldBuckets', bands.join(','));

  const filter = DISCOUNT_FILTERS.find((entry) => entry.code === query.discount);
  // Výslovne `=== null`: Turbopack tu už raz skrátený guard zahodil.
  if (filter !== undefined && filter.param !== null) params.set(filter.param, '1');

  params.set('sort', sortParam(query.sort));
  params.set('page', String(Math.max(1, Math.trunc(query.page))));
  params.set('perPage', String(query.perPage));
  return params;
}

export function overviewTableQueryString(
  query: OverviewTableQuery,
  soldWindowDays: SoldWindow,
): string {
  return overviewTableParams(query, soldWindowDays).toString();
}

/* ═══════════════════════════ 5. Zamknuté rozmery (K7) ═════════════════════ */

/**
 * Zamknuté rozmery pre lištu filtrov: kód a slovenské meno, v záväznom poradí.
 *
 * Zoznam sa tu NEPÍŠE. `LOCKED_DIMENSIONS` je odvodený od typu
 * `LockedCatalogFilter` v repozitári (`Record<LockedCatalogFilter, …>`), takže
 * pridanie alebo odobranie rozmeru PRESTANE SA KOMPILOVAŤ — a to je jediná
 * poistka, ktorú sa nedá obísť grepom. Odpoveď servera nesie tie isté kódy
 * v `lockedFilters`; keby sa rozišli, obrazovka kreslí to, čo hovorí TYP, a
 * `prehlad-tabulka.spec.ts` porovná obe strany.
 */
export interface LockedFilterView {
  readonly code: string;
  readonly label: string;
}

export function lockedFilterViews(): readonly LockedFilterView[] {
  return LOCKED_DIMENSIONS.map((code) => ({ code, label: LOCKED_DIMENSION_LABEL[code] }));
}

/* ═══════════════════════════ 6. Vety pod tabuľkou ═════════════════════════ */

/**
 * Koľko riadkov filtra nemá predaj za okno ZMERANÝ (D121) — povedané ČÍSLOM.
 *
 * Toto je celé to rozhodnutie: produkt s neznámym predajom do žiadneho pásma
 * NEPATRÍ, takže súčet pásiem je menší než počet riadkov a bez tejto vety by
 * to vyzeralo, že takých produktov niet. Pri nedočítanom okne ich pritom môže
 * byť celý katalóg.
 *
 * `null` (odpoveď počty nepovedala) NIE JE nula: vtedy sa nepovie nič — veta
 * „0 riadkov nevieme" by bola tvrdenie, ktoré appka neoverila. Nula sa
 * nepovie tiež, a je to zámer: „všetky riadky sú zmerané" nie je priznanie,
 * je to bežný stav a veta by len šumela.
 */
export function unknownSoldNote(
  soldUnknown: number | null,
  soldWindowDays: number,
): string | null {
  if (soldUnknown === null || soldUnknown <= 0) return null;
  return (
    `${formatCountSk(soldUnknown)} z týchto riadkov nemá predaj za ${String(soldWindowDays)} dní ` +
    'zmeraný — appka tie dni nemá stiahnuté. Do pásiem predaných preto nepatria ' +
    'a v stĺpci „predané za okno" majú pomlčku, nie nulu.'
  );
}

/**
 * Koľkých riadkov sa referencia a EAN vôbec týkajú (I11, D151).
 *
 * Oba kódy sú v zrkadle vyplnené LEN pri obohatených riadkoch, takže pomlčka
 * v prvom a poslednom stĺpci je pri neobohatenom produkte NORMÁLNY stav — nie
 * chyba a nie „shop ich nevedie". Bez tejto vety by človek hľadal poruchu tam,
 * kde je len nedočítané obohatenie.
 */
export function enrichedRowsNote(
  enrichedRows: number | null,
  total: number | null,
): string | null {
  if (enrichedRows === null || total === null) return null;
  if (enrichedRows >= total) return null;
  return (
    `Referenciu a EAN má appka len pri obohatených riadkoch — z ${formatCountSk(total)} ` +
    `je obohatených ${formatCountSk(enrichedRows)}. Pri ostatných je v tých stĺpcoch ` +
    'pomlčka a v názve zostáva `#id`, aby sa riadok dal nahlásiť.'
  );
}
