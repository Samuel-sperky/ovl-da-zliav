'use client';

/**
 * Aura Zľavy — POKRYTIE PREDAJNOSTI NA POVRCHU (KONTRAKT-PREDAJNOST P3;
 * kontrakt V3 K8, I11).
 *
 * Prečo tento modul existuje
 * ──────────────────────────
 * Stĺpec „Predané 180 d" aj pravidlo pásma „0 predaných za 180 dní → 30 %"
 * vyzerajú ako meraný fakt o 180 dňoch. Nie sú: okno prvého behu je zámerne
 * krátke (`SALES_WINDOW_DAYS`) a nočné dopĺňanie ho rozširuje po dni, takže
 * appka môže mať objednávky stiahnuté za dva dni a stĺpec sa aj tak menuje
 * podľa 180. `catalog/search` navyše dopĺňa chýbajúcu predajnosť nulou, čiže
 * „nevieme" a „nepredalo sa" vyjdú na obrazovke rovnako — a práve podľa toho
 * čísla si používateľ vyberá tisíce produktov do zľavy.
 *
 * Prehľad to priznáva („N dní s údajmi", „V grafe chýba N dní") a karta výkonu
 * čísla mimo pokrytia odmieta. Produkty a sprievodca to do 26. 8. 2026
 * nepriznávali nikde. Tento modul je ten chýbajúci kus: jedna veta, ktorá
 * povie, za koľko dní sú dáta NAOZAJ stiahnuté.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 * 1. **Tri stavy, nie dva.** „Ešte sme sa nepýtali", „pýtali sme sa a nevieme"
 *    a „vieme presne toto" sú tri rôzne veci. Kto prvé dva zlije, buď
 *    vykreslí varovanie skôr, než odpoveď prišla (bliká na každom otvorení
 *    obrazovky), alebo nečitateľnú odpoveď vydá za plné pokrytie.
 *
 * 2. **Pokrytie je MERANIE, nie nastavenie.** `daysCovered` prichádza z dní,
 *    ktoré appka naozaj stiahla; `windowDays` je len to, čo si používateľ
 *    naklikal. Porovnávať sa musia práve tieto dve čísla — nie `windowDays`
 *    s nastaveným oknom prvého behu, ktoré o stiahnutých dňoch nevie nič.
 *
 * 3. **Veta MLČÍ, keď je pokrytie plné.** Trvalá vysvetlivka pod stĺpcom by sa
 *    po týždni prestala čítať a odniesla by si aj tie prípady, keď platí.
 *
 * Vlastník: V10 (obrazovka Produkty), sprievodca V11.
 */
import { asRecord, readCount, readText, readTriState } from '@/components/dashboard/json';
import { fetchJson } from '@/components/layout/health';
import { useRefreshable } from '@/components/layout/refresh';
import { useState } from 'react';

import type {
  KpiDiscountView,
  KpiGapCode,
  KpiNoSaleView,
  KpiValueView,
  KpiWindowUnitsView,
  ProductKpiRowView,
} from '@/components/products/catalog-api';
import { formatDateSk, formatEur, formatPercentSk } from '@/lib/ui/format';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/** Pokrytie predajnosti tak, ako ho obrazovka potrebuje. */
export interface SoldCoverage {
  /** Sťahovanie objednávok je vôbec zapnuté? */
  readonly syncEnabled: boolean;
  /** Koľko dní appka NAOZAJ zmerala. Nie nastavené okno. */
  readonly daysCovered: number;
  /** Prvý a posledný zmeraný deň; `null` = ani jeden. */
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * Tri stavy, ktoré sa nesmú zliať (bod 1 v hlavičke). `asked: false` je stav
 * pred prvou odpoveďou — vtedy obrazovka nemá čo priznať ani vyvrátiť.
 */
export type SoldCoverageState =
  | { readonly asked: false }
  | { readonly asked: true; readonly coverage: SoldCoverage | null };

/** Obrazovka sa ešte nepýtala. */
export const SOLD_COVERAGE_UNASKED: SoldCoverageState = { asked: false };

/** Vysvetlivka na vykreslenie. `null` = niet čo priznať. */
export interface SoldCoverageNoteView {
  readonly variant: 'info' | 'warn';
  readonly text: string;
}

/**
 * `coverage` z odpovede `/api/insights/sales-daily`. `null` znamená „odpoveď sa
 * nedala prečítať" — nie prázdne pokrytie. Chýbajúci `syncEnabled` alebo
 * `daysCovered` je nečitateľná odpoveď: dopočítať si ich znamená vyrobiť
 * tvrdenie o tom, čo appka zmerala.
 */
export function parseSoldCoverage(raw: unknown): SoldCoverage | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const coverage = asRecord(root['coverage']);
  if (coverage === null) return null;
  const syncEnabled = readTriState(coverage, 'syncEnabled');
  const daysCovered = readCount(coverage, 'daysCovered');
  if (syncEnabled === null || daysCovered === null) return null;
  return {
    syncEnabled,
    daysCovered,
    from: readText(coverage, 'from'),
    to: readText(coverage, 'to'),
  };
}

/**
 * Jediné miesto, kde sa veta o pokrytí formuluje — pre tabuľku Produktov aj pre
 * pásma v sprievodcovi. Poradie vetiev je poradie závažnosti: vypnuté
 * sťahovanie je iná veta než „ešte nič nestiahol", a obe sú iné než „stiahol
 * menej, než sa pýtaš".
 */
export function soldCoverageNote(
  state: SoldCoverageState,
  windowDays: number,
): SoldCoverageNoteView | null {
  if (!state.asked) return null;

  const asked = Math.max(1, Math.trunc(windowDays));

  if (state.coverage === null) {
    return {
      variant: 'warn',
      text:
        `Za koľko dní má appka objednávky naozaj stiahnuté, sa nepodarilo zistiť. ` +
        `Predané kusy preto môžu pokrývať kratšie obdobie než ${asked} dní.`,
    };
  }

  const { syncEnabled, daysCovered } = state.coverage;

  if (!syncEnabled) {
    return {
      variant: 'warn',
      text:
        `Sťahovanie objednávok je vypnuté, takže predané kusy za ${asked} dní appka ` +
        `nemá zmerané. Nula neznamená, že sa produkt nepredáva.`,
    };
  }

  if (daysCovered <= 0) {
    return {
      variant: 'warn',
      text:
        `Objednávky sa zatiaľ nestiahli ani za jeden deň, takže predané kusy za ` +
        `${asked} dní appka nemá zmerané. Nula neznamená, že sa produkt nepredáva.`,
    };
  }

  if (daysCovered < asked) {
    return {
      variant: 'warn',
      text:
        `Objednávky má appka stiahnuté za ${daysCovered} z ${asked} dní. Nula predaných ` +
        `preto môže znamenať aj to, že sa produkt za toto obdobie nepredal — nie že ` +
        `sa nepredáva.`,
    };
  }

  // Pokrytie je plné. Vysvetlivka mlčí (bod 3 v hlavičke).
  return null;
}

/**
 * Pokrytie z `/api/insights/sales-daily`. Tá istá odpoveď, akú číta graf
 * predaja na Prehľade — obrazovka Produktov z nej berie len hlavičku
 * o pokrytí, nie rad po dňoch.
 *
 * Zlyhané načítanie skončí ako `{ asked: true, coverage: null }`, teda ako
 * priznané „nevieme". Ticho by znamenalo, že obrazovka tvrdí plné pokrytie.
 */
export function useSoldCoverage(): SoldCoverageState {
  const [state, setState] = useState<SoldCoverageState>(SOLD_COVERAGE_UNASKED);

  useRefreshable(async () => {
    const body = await fetchJson<unknown>('/api/insights/sales-daily');
    setState({ asked: true, coverage: parseSoldCoverage(body) });
  });

  return state;
}
/* ════════ 2. BUNKY KPI (kontrakt V4 D114, D119; I11) ══════════════════════ */

/**
 * PREČO SÚ BUNKY KPI PRÁVE TU
 * ───────────────────────────
 * Tento modul už raz odpovedal na presne tú istú otázku: „koľko sa predalo" má
 * dve celkom rôzne prázdna — „nepredalo sa nič" a „appka to nemá stiahnuté" —
 * a keď sa zlejú, obrazovka klame trendom. KPI riadku (D114) tú otázku len
 * rozšírili z jedného stĺpca na deväť. Keby si každý stĺpec formátoval sám
 * v `CatalogTable.tsx`, prvý `?? 0` v tabuľke by tú prácu zahodil a nikto by si
 * to nevšimol — preto sú tieto funkcie ČISTÉ, mimo Reactu a pod testom.
 *
 * PRAVIDLO, KTORÉ SA TU NESMIE PORUŠIŤ
 * ────────────────────────────────────
 * `KpiValueView` má hodnotu a dôvod (`gap`). Všeobecná bunka (`kpiCell`) vypíše
 * číslo LEN vtedy, keď `gap === null` a hodnota naozaj je. Akýkoľvek iný stav je
 * pomlčka a vysvetlenie v `title` — fail-closed znamená pomlčku, nie nulu. Nula
 * na tejto obrazovke je dôvod, prečo niekto zlacní tisíc kusov.
 *
 * JEDNA VÝNIMKA, A JE TO PRIZNANIE, NIE ZLIATIE (31. 8. 2026)
 * ──────────────────────────────────────────────────────────
 * Kusy za okno majú TRETÍ stav, ktorý ostatné KPI nemajú: „toľko appka za
 * dočítané dni ZMERALA a zvyšok okna nemá". Server ho posiela ako hodnotu
 * A dôvod `days_missing` naraz (`insights.ts` → `kpiWindowUnits`, doc-blok tam:
 * „hodnota JE, ale je to DOLNÁ HRANICA"). `kpiUnitsCell` tú kombináciu preto
 * pozná a vypíše ju ako `≥ N` s vetou, koľko dní chýba.
 *
 * Do 31. 8. 2026 ju kontrolovala poradím `gap` PRED hodnotou, takže čiastočne
 * pokryté okno skončilo ako pomlčka a celá vetva s `≥` bola nedosiahnuteľný
 * kód: pri dnešnom pokrytí (objednávky za pár dní, okno 30/90 nikdy celé) boli
 * stĺpce „Predané 30 d" a „Predané 90 d" pomlčka na KAŽDOM riadku. To je druhé
 * zlyhanie I11 — schovať číslo, ktoré appka zmerala — a K4/D119 nesplnené.
 * Hodnota `null` s dôvodom `days_missing` (ani jeden dočítaný deň) zostáva
 * pomlčkou; to sa nezmenilo.
 */


/** Pomlčka, ktorou appka hovorí „toto nevieme" (nie „toto je nula"). */
export const KPI_DASH = '—';

/** Prečo hodnota nie je. Jedno miesto, jedna veta pre všetky stĺpce. */
export const KPI_GAP_REASON: Readonly<Record<KpiGapCode, string>> = {
  not_enriched:
    'Produkt ešte nie je obohatený — appka sa na jeho podrobnosti shopu nepýtala. ' +
    'Nie je to nula ani prázdna hodnota v shope.',
  shop_has_none: 'Appka sa shopu pýtala a shop k tomuto poľu o produkte nič nevedie.',
  days_missing: 'Z okna chýbajú dni, takže súčet by bol nižší než skutočnosť.',
  not_computable: 'Pomer nemá hodnotu — menovateľ je nula.',
};

/** Riadok, ku ktorému KPI ešte nedobehli. Tretí stav: ani hodnota, ani dôvod. */
export const KPI_UNASKED_REASON = 'KPI tohto riadku sa ešte nenačítali.';

/** Hodnota je `null` a odpoveď dôvod nepovedala — priznáva sa to bez výmyslu. */
export const KPI_NO_REASON = 'Appka túto hodnotu nemá a odpoveď nepovedala prečo.';

/** Jedna bunka: čo sa vypíše, či je to priznanie a čo o tom povie `title`. */
export interface KpiCellView {
  readonly text: string;
  /** `true` ⇔ je to pomlčka, teda priznanie „nevieme", nie hodnota. */
  readonly unknown: boolean;
  readonly title: string | null;
  /** `true` ⇔ hodnota JE, ale je len dolná hranica (chýbajú dni okna). */
  readonly lowerBound: boolean;
}

const unknownCell = (title: string): KpiCellView => ({
  text: KPI_DASH,
  unknown: true,
  title,
  lowerBound: false,
});

/**
 * Jedno KPI do bunky. `undefined`/`null` znamená „KPI riadku ešte nedobehli",
 * čo je iná veta než „shop o tom nič nevie" — preto sa nezlieva.
 *
 * Pozor na poradie podmienok: `gap` sa kontroluje PRED hodnotou. Odpoveď
 * `{ value: 0, gap: 'days_missing' }` je nekonzistentná a jediná bezpečná
 * odpoveď na ňu je pomlčka; keby sa pozeralo najprv na hodnotu, appka by tú
 * medzeru vypísala ako nulu.
 */
export function kpiCell<T>(
  value: KpiValueView<T> | null | undefined,
  format: (known: T) => string,
  knownTitle: string | null = null,
): KpiCellView {
  if (value === null || value === undefined) return unknownCell(KPI_UNASKED_REASON);
  if (value.gap !== null) return unknownCell(KPI_GAP_REASON[value.gap]);
  if (value.value === null) return unknownCell(KPI_NO_REASON);
  return { text: format(value.value), unknown: false, title: knownTitle, lowerBound: false };
}

/**
 * Predané kusy za okno (D119). Nula je MERANÝ fakt len vtedy, keď je celé okno
 * dočítané; inak je číslo dolná hranica a bunka to hovorí znakom `≥` aj vetou.
 *
 * `{ value: N, gap: 'days_missing' }` NIE JE nekonzistentná odpoveď (na rozdiel
 * od všeobecnej `kpiCell`) — je to práve tá dolná hranica, viď výnimku
 * v hlavičke sekcie. Bez hodnoty (`value === null`) je to pomlčka ako predtým.
 */
export function kpiUnitsCell(window: KpiWindowUnitsView | null | undefined): KpiCellView {
  if (window === null || window === undefined) return unknownCell(KPI_UNASKED_REASON);
  const { units, windowDays, completeDays, unknownDays } = window;
  const measuredFloor = units.gap === 'days_missing' && units.value !== null;
  if (units.gap !== null && !measuredFloor) {
    return unknownCell(
      `${KPI_GAP_REASON[units.gap]} Z ${windowDays} ${pluralSk(windowDays, 'dňa', 'dní', 'dní')} ` +
        `je dočítaných ${completeDays}.`,
    );
  }
  if (units.value === null) return unknownCell(KPI_NO_REASON);
  const lowerBound = measuredFloor || window.lowerBound || unknownDays > 0;
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

/** Pokrytie sa ešte nezistilo — číslo z objednávok je preto len dolná hranica. */
const SOLD_DOMINANT_UNASKED_COVERAGE =
  'Za koľko dní má appka objednávky naozaj stiahnuté, sa ešte nezistilo.';

/** Dominanta panela sa ešte nedopočítala (prepnuté okno, riadok sa nevrátil). */
const SOLD_DOMINANT_UNASKED = 'Predané kusy za toto okno appka zatiaľ nemá.';

/**
 * DOMINANTA BOČNÉHO PANELA — to isté priznanie ako v tabuľke (I11, D119).
 *
 * Číslo panela prichádza z `catalog/search` (`unitsSold`), a tá cesta bránu
 * `status='complete'` NEMÁ: nestiahnutý deň v nej vyjde ako deň s nulou. Do
 * 31. 8. 2026 ho panel vypisoval v 44 px reze ako meraný fakt s vetou
 * „predaných za posledných 30 dní", kým tabuľka vedľa neho to isté číslo
 * zámerne nezobrazovala vôbec — jedna obrazovka, dve odpovede na tú istú
 * otázku a ani jedna označená (nález I11 č. 2).
 *
 * Preto sa dominanta odteraz opiera o POKRYTIE (`useSoldCoverage`, tá istá
 * odpoveď a tá istá veta, akú nesie vysvetlivka nad tabuľkou):
 *
 *  · plné pokrytie okna → číslo je celý počet,
 *  · čiastočné / nezistené / vypnuté sťahovanie a `sold > 0` → `≥ N`, teda
 *    hodnota, ktorú appka NAOZAJ zmerala, plus veta, čo z okna chýba,
 *  · `sold === 0` bez plného pokrytia → POMLČKA. Nula je pri neúplnom pokrytí
 *    tvrdenie „nepredáva sa", a práve podľa neho niekto zlacní tisíc kusov.
 *
 * `≥ 0` by nebolo priznanie, ale prázdna veta, preto sa nekreslí.
 */
export function soldUnitsViaCoverage(
  sold: number | null,
  windowDays: number,
  coverage: SoldCoverageState,
): KpiCellView {
  if (sold === null) return unknownCell(SOLD_DOMINANT_UNASKED);

  const note = soldCoverageNote(coverage, windowDays);
  if (note === null && coverage.asked) {
    return {
      text: formatCountSk(sold),
      unknown: false,
      title: `Objednávky má appka stiahnuté za celé okno ${windowDays} dní, takže je to celý počet.`,
      lowerBound: false,
    };
  }

  const why = note === null ? SOLD_DOMINANT_UNASKED_COVERAGE : note.text;
  if (sold === 0) return unknownCell(why);
  return {
    text: `≥ ${formatCountSk(sold)}`,
    unknown: false,
    title: `${why} Toľko kusov appka zmerala; skutočný počet môže byť vyšší.`,
    lowerBound: true,
  };
}

/**
 * Aktívna zľava PODĽA SHOPU. Je to iná veta než stĺpec „Zľava teraz", ktorý
 * hovorí o VLASTNÝCH zápisoch appky (I11) — preto dva stĺpce a nie jeden.
 *
 * `none` je meraný fakt („shop k tomu času povedal, že nič nebeží"), nie
 * pomlčka; `unknown` je pomlčka. Zliať ich by znamenalo tvrdiť o neobohatenom
 * produkte, že naň zľava nebeží.
 */
export function kpiDiscountCell(discount: KpiDiscountView | null | undefined): KpiCellView {
  if (discount === null || discount === undefined) return unknownCell(KPI_UNASKED_REASON);
  const measured =
    discount.measuredAt === null
      ? 'Produkt nie je obohatený, takže stav zľavy v shope appka nepozná.'
      : `Podľa shopu, zmerané ${formatDateSk(discount.measuredAt)}.`;
  const window =
    discount.from === null && discount.to === null
      ? ''
      : ` Okno ${formatDateSk(discount.from)} – ${formatDateSk(discount.to)}.`;

  if (discount.state === 'unknown') return unknownCell(measured);
  if (discount.state === 'running') {
    const percent = discount.activePercent;
    if (percent.gap !== null) return unknownCell(`${KPI_GAP_REASON[percent.gap]} ${measured}`);
    if (percent.value === null) return unknownCell(`${KPI_NO_REASON} ${measured}`);
    return {
      text: formatPercentSk(percent.value),
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
 * POMER PREDANÝCH KUSOV K SKLADU — to, čo D119 pod tým slovom naozaj myslí:
 * koľkokrát sa AKTUÁLNA zásoba už predala (`qty_in_orders / qty`).
 *
 * Volá sa `soldPerStock`, nie inak, a je to zámer: `getFull` dáva zásobu ako
 * JEDNU MOMENTKU, nie priemer za obdobie, takže „ako rýchlo sa predáva" sa
 * z toho spočítať nedá (I11 — a `test/unit/sales-insights.spec.ts` to stráži
 * tým, že to slovo v povrchových moduloch zakazuje). `title` preto pri každom
 * čísle hovorí, čo je v ňom, aj čo v ňom NIE JE.
 */
export function kpiSoldPerStockCell(row: ProductKpiRowView | null | undefined): KpiCellView {
  if (row === null || row === undefined) return unknownCell(KPI_UNASKED_REASON);
  const sold = row.soldTotal.gap === null ? row.soldTotal.value : null;
  const stock = row.stock.gap === null ? row.stock.value : null;
  const detail =
    sold === null || stock === null
      ? 'Koľkokrát sa aktuálna zásoba už predala (celkovo predané / sklad).'
      : `Celkovo predané ${formatCountSk(sold)}, sklad ${formatCountSk(stock)}. ` +
        'Nehovorí to, ako rýchlo sa predáva — priemernú zásobu za obdobie appka nemá.';
  return kpiCell(row.soldPerStock, (value) => `${value.toFixed(1)}×`, detail);
}

/**
 * Posledný predaj podľa shopu. Je to HORNÁ hranica veku: hodnota sa zmerala pri
 * obohatení, takže odvtedy mohol pribudnúť predaj, o ktorom appka nevie.
 *
 * `shop_has_none` sa tu NEPREKLÁDA na „nikdy sa nepredalo". To tvrdenie má
 * vlastnú značku s vlastným dôkazom (`kpiNoSaleMark`), ktorý žiada aj nulové
 * `qty_in_orders`; jedno prázdne pole na to nestačí.
 */
export function kpiLastSaleCell(row: ProductKpiRowView | null | undefined): KpiCellView {
  if (row === null || row === undefined) return unknownCell(KPI_UNASKED_REASON);
  const days = row.daysSinceLastSale.gap === null ? row.daysSinceLastSale.value : null;
  const detail =
    days === null
      ? 'Posledný predaj podľa shopu, zmerané pri obohatení produktu.'
      : `Pred ${formatCountSk(days)} ${pluralSk(days, 'dňom', 'dňami', 'dňami')} — ` +
        'merané pri obohatení, takže novší predaj appka nemusí poznať.';
  return kpiCell(row.lastSaleAt, (value) => formatDateSk(value), detail);
}

/** Značka „bez predaja" na vykreslenie. `null` = značka nevzniká. */
export interface KpiNoSaleMarkView {
  readonly text: string;
  readonly title: string;
}

/**
 * ZNAČKA „BEZ PREDAJA" LEN S DÔKAZOM (D119) — najľahšia chyba tejto obrazovky.
 *
 * Neobohatený produkt NIE JE mŕtvy produkt, je to NEZNÁMY produkt: appka sa naň
 * shopu nikdy nepýtala (kvóta ~200 čítaní/deň, celý katalóg ~207 dní — D118).
 * Značka preto vzniká len vtedy, keď ju odpoveď dokázala jedným z dvoch
 * spôsobov, a `catalog-api.ts` `mark` bez dôkazu zahadzuje už pri čítaní.
 */
export function kpiNoSaleMark(
  noSale: KpiNoSaleView | null | undefined,
): KpiNoSaleMarkView | null {
  if (noSale === null || noSale === undefined) return null;
  if (!noSale.mark || noSale.proof === null) return null;
  return {
    text: 'bez predaja',
    title:
      noSale.proof === 'shop_never_ordered'
        ? 'Shop o produkte nemá ani jednu objednávku: posledný predaj je prázdny ' +
          'a celkovo predaných je nula.'
        : 'Celé dlhé okno je dočítané a v ňom nula predaných kusov.',
  };
}

/**
 * Referencia pre `productLabel()` (D116). Vracia ju LEN ako meranú hodnotu;
 * medzera je `null`, aby pomenovanie produktu vedelo priznať „zatiaľ nevieme"
 * namiesto toho, aby tvrdilo, že produkt referenciu nemá.
 */
export function kpiReference(row: ProductKpiRowView | null | undefined): string | null {
  if (row === null || row === undefined) return null;
  if (row.reference.gap !== null) return null;
  return row.reference.value;
}

/** Cena s DPH z obohatenia — do `title` stĺpca Cena, nie na jeho povrch. */
export function kpiPriceWithVatCell(row: ProductKpiRowView | null | undefined): KpiCellView {
  if (row === null || row === undefined) return unknownCell(KPI_UNASKED_REASON);
  return kpiCell(row.priceWithVat, (value) => formatEur(value), 'Predajná cena s DPH podľa shopu.');
}
