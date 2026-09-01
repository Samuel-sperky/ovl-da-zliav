'use client';

/**
 * Aura Zľavy — bočný panel s detailom produktu
 * (KONTRAKT-PRODUKTY-2026-08-13 časť A2; `design/v3/produkt-detail.html`).
 *
 * Panel sprava, nie nová stránka (odpoveď 91): používateľ neopúšťa filter ani
 * miesto v tabuľke. Dominantou panela je jedno číslo — koľko kusov sa za
 * zvolené okno predalo; presne kvôli nemu sa produkt otvára.
 *
 * ČO PANEL VYPÍŠE A PREČO PRÁVE TAKTO
 * ───────────────────────────────────
 * Zadanie znie „všetky údaje vypísané". Panel preto vypisuje všetko, čo appka
 * o produkte vie, a údaje sú zoskupené podľa toho, ODKIAĽ sú — nie podľa toho,
 * ako pekne to vyzerá. Bez toho by vedľa seba stáli údaj z posledného prechodu
 * synchronizácie a údaj vypýtaný z eshopu pred sekundou a vyzerali by rovnako.
 *
 *  · **Údaje o produkte** — zrkadlo katalógu alebo dohľadanie v eshope.
 *    Skupina má na konci ČAS, kedy bol načítaný práve TENTO riadok
 *    (`fetchedAt`). Nie je to obrazovkové „Dáta k …" (to je práve raz nad
 *    tabuľkou, architektúra §0) — je to čerstvosť jedného riadku, a bez nej sa
 *    nedá povedať, či cena ešte platí. Preto sa aj volá inak.
 *  · **Predané kusy** — vlastný výpočet z objednávok. Okno je voliteľné priamo
 *    tu: tá istá položka vyzerá inak za 30 a inak za 360 dní a kvôli tomuto
 *    rozdielu sa panel otvára.
 *  · **Varianty** — kód (`reference`), EAN a sklad po variantoch z verejného
 *    `products/get`. Je to JEDINÉ miesto, kde tie tri údaje vidno bez kľúča,
 *    a kreslí sa len pri kuse, ktorý varianty naozaj má.
 *  · **Zľavy podľa vlastných zápisov** — výhradne to, čo appka sama zapísala.
 *  · **Zatiaľ nedostupné / Podrobnosti z eshopu** — polia z `products/getFull`
 *    za oprávnením `product:read`, ktoré obohatenie v `catalog_cache` NENESIE:
 *    EAN produktu, cena s DPH, kategórie, či je kus v eshope zapnutý a kedy doň
 *    pribudol. Prázdna hodnota so slovom, NIE vynechaný riadok: keby riadok
 *    chýbal, nedalo by sa zistiť, že tá informácia vôbec existuje. Nadpis sa
 *    mení podľa toho, či hodnoty naozaj prišli, a skupina nesie ČAS MERANIA
 *    (`keyedMeasuredNote()`) — pozri bod 7 nižšie.
 *
 * ČO PRIBUDLO VO V4 (D115, D118 — 28. 8. 2026)
 * ────────────────────────────────────────────
 *  · **Predaj po dňoch · 90 dní** — denná krivka z lokálnych predajov s oknami
 *    NAŠICH zápisov zľavy a s PRIZNANÝMI medzerami: deň, ktorý sa nestiahol,
 *    dostane šrafovaný pás, nie stĺpec nulovej výšky. Pod ňou **výkon zľavy
 *    (uplift)** — a keď sa spočítať nedá, je tam SLOVO a dôvod, nikdy číslo
 *    (pasca `d00e081`, pozri `UpliftBlock`).
 *  · **Fakty z eshopu** (rozklik) — osem údajov z obohatenia `getFull`:
 *    referencia, dodávateľ, sklad, celkovo predané, posledný predaj, nákupná
 *    cena, marža (EUR aj %) a aktívna zľava v eshope. Marža sa NEPOČÍTA — shop
 *    ju posiela hotovú. Nadpis sa mení podľa toho, či fakty naozaj sú.
 *  · **Obohatenie NA DOPYT** — otvorenie panela dotiahne TENTO kus (D118 bod 1)
 *    práve raz, nikdy v cykle. Ako sa to skončilo, hovorí veta na povrchu; dnes
 *    je to typicky „eshop odmieta našu adresu" (`ip_banned`, KONTRAKT-V4 §2b)
 *    a to NIE JE porucha appky — je to bežná cesta a fakty zostanú pomlčkami.
 *  · Prázdna z KPI majú VLASTNÝ slovník (`KpiGapKind`), lebo „produkt nie je
 *    obohatený" a „dni chýbajú" sú dve rôzne vety a ani jedna nie je nula.
 *
 * ČO PRIBUDLO VO V5 (D127 bod 3 — 1. 9. 2026)
 * ───────────────────────────────────────────
 *  · **Kedy sme tento kus už zlacnili** (rozklik) — zoznam ZLIAV, do ktorých
 *    bol kus zaradený: meno zľavy, percento pásma, okno, cena pred/po a stav
 *    NÁŠHO zápisu. Nie je to druhý opis „Všetkých našich zápisov": ten log
 *    kreslí `productWrites()`, ktorý `pending` zahadzuje, a meno zľavy ani
 *    cenu nemá. Vykresľuje `ProductDiscountHistory.tsx`, kde je aj dôvod.
 *    Prázdna história je ODPOVEĎ, nie chyba, a zlyhané načítanie je tretia
 *    veta — nikdy prázdny zoznam.
 *
 * ČO JE NA POVRCHU A ČO POD ROZKLIKOM (24. 8. 2026, UX3)
 * ──────────────────────────────────────────────────────
 * Panel mal 1 148 px obsahu v stĺpci, ktorý má 620 px (`max-height:
 * calc(100vh - 280px)`). Vyše 500 px teda nedržal skrol, ale odseknutá hrana,
 * a posledný viditeľný riadok bol preseknutý vodorovne — to sa nečíta ako
 * „ide sa posúvať", ale ako chyba vykreslenia.
 *
 * NEUBRAL SA ANI JEDEN RIADOK. Zmenilo sa, čo je otvorené:
 *
 *   povrch  · hlavička (názov, cena, výhrady) · DOMINANTA: predané kusy
 *           · prekážky · zľavy podľa vlastných zápisov (šesť riadkov)
 *   rozklik · údaje o produkte · varianty · podrobnosti z eshopu
 *           · všetky naše zápisy · história zliav · technický detail
 *
 * Zavretá skupina NIE JE chýbajúca skupina: nesie svoj vlastný nadpis v tom
 * istom tvare ako otvorená a vedľa neho POČET riadkov, ktorý sa počíta z
 * obsahu (`facts`, `keyedRows`) — nikdy nie je napísaný ručne. Z povrchu sa
 * teda dá prečítať, že skupina existuje aj koľko toho v nej je, a to je presne
 * to, čo výnimka z 18. 8. 2026 chránila. Rozklik je P6 a je to `details.tech`,
 * teda ten istý tvar, aký má „Technický detail" a rozkliky inde v appke.
 *
 * Čo zostalo otvorené a prečo: prekážky rozhodujú, či sa kus dá zlacniť,
 * a „zľavy podľa vlastných zápisov" sú otázka, kvôli ktorej celá appka je.
 * Zvyšok je pôvod údaja a referencia — pomáha, ale nie je to dôvod otvorenia.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 * 1. **„Zľava teraz" nie je stav eshopu.** Appka nevie, aká zľava na produkte
 *    naozaj beží — vie len, čo sama zapísala. Výhrada preto nie je poznámka
 *    pod čiarou: nesie ju nadpis skupiny aj značka v hlavičke panela, a keď sa
 *    raz doplní skutočný stav z eshopu, pribudne ako ĎALŠÍ riadok, nikdy nie
 *    prepísaním tohto.
 * 2. **Skupina „Prekážky" mieša dva zdroje a nesmie ich zliať.** `blockers`
 *    prichádzajú zo stavu appky a hovoria o OPERÁCII (vypnuté zápisy, chýbajúci
 *    kľúč, strop rozsahu); `productReasons()` hovoria o KUSE (eshop ho nenašiel,
 *    už je v zľave). Informatívne prekážky sa sem nedávajú — veta o pilotnom
 *    strope je pri jednom kuse šum a patrí nad tabuľku, k výberu.
 * 3. **Zamknuté sa NEVYSVETĽUJE tu.** Vysvetlenie má jedno miesto (Nastavenia →
 *    Zamknuté funkcie) a odtiaľto naň vedie odkaz. Druhé vysvetlenie tej istej
 *    veci by si po prvej zmene s prvým protirečilo.
 * 4. **Čo appka nevie, je pomlčka — nikdy nula.** Nula je tvrdenie o predaji,
 *    ktoré sa pri nenačítanom riadku nedá urobiť. Pri doťahovaných údajoch to
 *    ide ešte o krok ďalej: TRI prázdna sa nesmú zliať. `pending` (ešte sme
 *    sa nepýtali) · `locked` (chýba kľúč) · `none` (shop to o kuse nevedie).
 *    Rozhoduje o tom `keyedField()` a `product-extras.ts`, nikdy JSX.
 * 5. **Časy sú konkrétne.** `12.05.2026 09:14`, nikdy „pred 3 minútami".
 * 6. **Pomlčka sa nekreslí do displejového rezu** (D11, 19. 8. 2026 — tu
 *    doriešené 19. 8. 2026). Bod 4 platí ďalej, ale em pomlčka je celoštvorcová
 *    vodorovná čiara: v 44 px a reze 660 (`.lvl-1 .big.sm`) prestáva byť
 *    interpunkciou a vykreslí sa ako vyplnený čierny obdĺžnik — dominanta
 *    panela potom vyzerá ako chyba vykreslenia. Neznáme sa preto píše pomlčkou
 *    SO SLOVOM a v čitateľnej veľkosti, presne v tom istom tvare, aký dostala
 *    karta potvrdenia novej zľavy (`.unknown`, 26 px, `--dim`). Nikdy nedávaj
 *    `'—'` do `.big` ani do `.big.sm`.
 *
 * 7. **TEN ISTÝ FAKT SA V PANELI NEKRESLÍ DVAKRÁT — a každá vykreslená skupina
 *    nesie čas merania** (31. 8. 2026, otvorený bod 5 kontraktu V4).
 *
 *    Panel mal dve skupiny z eshopu a osem faktov v oboch naraz: „Fakty
 *    z eshopu" (obohatenie, stĺpce `catalog_cache`, datované `enriched_at`)
 *    a „Podrobnosti z eshopu" (`extra.keyed`, teda `raw` odpoveď TOHO ISTÉHO
 *    riadku, BEZ času merania). Kód/referencia, sklad, nákupná cena, marža,
 *    dodávateľ, `qty_in_orders` aj `last_time_in_order` tak stáli v paneli
 *    dvakrát, z dvoch čítaní — a človek nemal ako zistiť, ktoré je novšie,
 *    lebo druhá skupina o svojom čase mlčala.
 *
 *    Rozhodlo sa PRE „Fakty z eshopu", a nie preto, že sú vyššie:
 *      (a) appka ich vie DATOVAŤ na povrchu (`enriched_at` → `measuredNote()`),
 *      (b) ich slovník prázdna (`KpiGapKind`) rozlišuje „produkt nie je
 *          obohatený" · „eshop to nevedie" · „dni chýbajú" — presne to, čo I11
 *          rozlišovať káže. `AbsenceKind` skupiny za kľúčom (`none`/`pending`/
 *          `locked`) prvé dve zliať MUSÍ, lebo naň slovo nemá,
 *      (c) je to kanonická cesta D118 (prioritizované obohacovanie, účtované
 *          do dráhy `product_read`).
 *
 *    Riadok „Skutočná zľava v eshope" bol `LockedRow` s pevným zámkom a s
 *    komentárom, že `getFull` ju nenesie. Obohatenie ju nesie
 *    (`reduction_percent/from/to`, migrácia 0014) a riadok „Aktívna zľava
 *    v eshope" ju vypisuje — ten zámok teda o tom istom fakte tvrdil opak.
 *    Zmizol spolu s duplicitami.
 *
 *    Skupina za kľúčom NEZMIZLA celá: päť jej riadkov obohatenie nenesie,
 *    takže inde v paneli nie sú. Dostala čas merania z `extra.at`, a keď ho
 *    nemá, povie to slovom — nikdy „asi teraz".
 *
 * Vlastník: V10 (rozšírenie na „všetky údaje": P2 kontraktu produktov).
 */
import Link from 'next/link';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/*
 * `.unknown` je TVAR „dominanta, ktorú appka nevie" (D11) a musí byť na oboch
 * miestach jeden a ten istý — dva tvary tej istej veci by sa po prvej úprave
 * rozišli. Býva v module zliav, lebo tam vznikol; jeho správne miesto je
 * `ui/primitives.module.css` a presun patrí integrátorovi (globals/primitives
 * nie sú v rozsahu tejto vlny).
 */
import styles from '@/components/campaigns/zlavy.module.css';
import BlockerNotes from '@/components/products/BlockerNotes';
import type { CatalogRowView, ProductWriteView } from '@/components/products/catalog-api';
import { catalogRow, isAborted, productWrites } from '@/components/products/catalog-api';
import type { SoldWindow } from '@/components/products/catalog-filter';
import { newDiscountHref, SOLD_WINDOWS } from '@/components/products/catalog-filter';
import { productReasons } from '@/components/products/catalog-status';
import {
  enrichProduct,
  fetchExtras,
  fetchProductInsights,
  fetchProductKpi,
  type ProductInsightsView,
} from '@/components/products/extras-api';
import {
  absent,
  curveGapNote,
  enrichNotice,
  fieldOf,
  known,
  keyedMeasuredNote,
  kpiFactRows,
  measuredNote,
  upliftView,
  type EnrichOutcomeKind,
  type Field,
  type KpiFactRow,
  type ProductCurveView,
  type ProductExtraView,
  type ProductKpiView,
  type UpliftView,
} from '@/components/products/product-extras';
import { FieldValue, KpiValueText } from '@/components/products/ProductFacts';
import {
  DiscountHistoryList,
  fetchProductCampaigns,
  historyHint,
  isHistoryAborted,
  type ProductCampaignsWire,
} from '@/components/products/ProductDiscountHistory';
import ProductVariants from '@/components/products/ProductVariants';
import type { KpiCellView, SoldCoverageState } from '@/components/products/sold-coverage';
import { SOLD_COVERAGE_UNASKED, soldUnitsViaCoverage } from '@/components/products/sold-coverage';
import Icon from '@/components/ui/Icon';
import type { Blocker } from '@/lib/status/blockers';
import { FlagMark } from '@/components/ui/StatusMark';
import { formatDateSk, formatDateTimeSk, formatEur, formatPercentSk } from '@/lib/ui/format';
import { productLabel } from '@/lib/ui/product-label';
import { formatCountSk, itemSentence, pluralSk, SURFACE_TERMS } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Pomôcky ═══════════════════════════════════ */

const SHOP_STATUS_TEXT: Readonly<Record<CatalogRowView['shopStatus'], string>> = {
  ok: 'eshop ho pozná',
  not_found: 'eshop ho nenašiel',
  unknown: 'stav nevieme',
};

/** Odkiaľ je riadok (I11). Dva rôzne stupne istoty, dve rôzne vety. */
const ORIGIN_TEXT: Readonly<Record<CatalogRowView['origin'], string>> = {
  mirror: 'z načítaného katalógu',
  shop: 'dohľadané v eshope',
};

/** Pomlčka namiesto čísla — appka o tomto riadku nič netvrdí. */
const DASH = '—';

/** Cena po zľave — obyčajná aritmetika nad známou cenou, nie odhad. */
function priceAfter(price: string | null, percent: number): string {
  if (price === null) return DASH;
  const value = Number(price);
  if (!Number.isFinite(value)) return DASH;
  return formatEur(value * (1 - percent / 100));
}

/** Okno zľavy ako jeden údaj: `12.05.2026 – 26.05.2026`. */
function windowText(write: ProductWriteView): string {
  return `${formatDateSk(write.dateFrom)} – ${formatDateSk(write.dateTo)}`;
}

/**
 * Zápis, ktorý podľa NÁŠHO záznamu práve platí.
 *
 * `today` prichádza z odpovede servera, nie z hodín prehliadača — inak by sa
 * o polnoci líšilo, čo vidí panel, od toho, čo si myslí fronta.
 */
export function runningWrite(
  writes: readonly ProductWriteView[],
  today: string | null,
): ProductWriteView | null {
  if (today === null) return null;
  const running = writes.filter(
    (write) => write.status === 'ok' && write.dateFrom <= today && today <= write.dateTo,
  );
  if (running.length === 0) return null;
  // Pri prekryve vyhráva ten, čo začal neskôr — to je zápis, ktorý prepísal ten
  // predošlý.
  return running.reduce((best, write) => (write.dateFrom > best.dateFrom ? write : best));
}

/**
 * Posledný ÚSPEŠNÝ zápis — „kedy naposledy zlacnené". Radí sa podľa času
 * zápisu; keď ho zápis nemá, podľa začiatku okna. Nepodarené a nepotvrdené
 * zápisy sa sem nepočítajú: o tých práve nevieme, že zlacnili.
 */
export function lastWrittenDiscount(
  writes: readonly ProductWriteView[],
): ProductWriteView | null {
  const done = writes.filter((write) => write.status === 'ok');
  if (done.length === 0) return null;
  const rank = (write: ProductWriteView): string => write.at ?? write.dateFrom;
  return done.reduce((best, write) => (rank(write) > rank(best) ? write : best));
}

/** Okno predajnosti z tabuľky; nezmysel spadne na najkratšie, nie na najdlhšie. */
function asSoldWindow(days: number): SoldWindow {
  return (SOLD_WINDOWS as readonly number[]).includes(days) ? (days as SoldWindow) : 30;
}

/**
 * Nadpis skupiny. JEDEN tvar pre otvorenú aj zavretú skupinu — keby zavretá
 * skupina vyzerala inak, čítalo by sa to ako iná vec, nie ako tá istá vec
 * zabalená.
 */
const GROUP_TITLE = {
  fontSize: '10px',
  letterSpacing: '0.13em',
  textTransform: 'uppercase',
  color: 'var(--dim)',
  fontWeight: 650,
} as const;

/**
 * Skupina panela — otvorená, alebo pod rozklikom (P6).
 *
 * PREČO SA SKUPINY ZAVIERAJÚ A PREČO TO NIE JE STRATA ÚDAJOV
 * ──────────────────────────────────────────────────────────
 * Panel vypisuje všetko, čo appka o kuse vie, a pri kuse s variantmi to je
 * vyše tisíc pixelov obsahu v 620 px vysokom stĺpci. Zvyšok potom nedržal
 * skrol, ale odseknutá hrana — a odseknutý riadok sa nečíta ako „pokračuje",
 * ale ako chyba vykreslenia.
 *
 * Riešenie NIE JE vynechať riadky. Z chýbajúceho riadku sa nedá zistiť, že tá
 * informácia existuje, a práve preto panel vznikol (architektúra, výnimka
 * z 18. 8. 2026). Zavretá skupina nechýba: nesie SVOJ VLASTNÝ NADPIS v tom
 * istom tvare ako otvorená a vedľa neho POČET, ktorý sa počíta z toho, čo je
 * naozaj vnútri (`hint`). Z povrchu sa teda dá prečítať aj to, že skupina je,
 * aj koľko je v nej riadkov — a jeden klik ich ukáže všetky naraz.
 *
 * Zavretá skupina stojí jeden riadok namiesto 160–350 px. Tvar rozkliku je
 * `details.tech`, teda TEN ISTÝ, aký má „Technický detail" na konci panela
 * a rozkliky na ostatných obrazovkách — nie druhý podobný.
 */
function DetailGroup({
  title,
  hint,
  fold,
  testId,
  children,
}: {
  title: string;
  /** Čo je vnútri, keď je skupina zavretá. Počíta sa z obsahu, nepíše ručne. */
  hint?: string;
  fold?: true;
  testId?: string;
  children: ReactNode;
}) {
  if (fold !== true) {
    return (
      <div style={{ borderTop: '1px solid var(--line)', padding: '12px 0 4px' }}>
        <h3 style={{ ...GROUP_TITLE, marginBottom: '8px' }}>{title}</h3>
        {children}
      </div>
    );
  }
  return (
    <details className="tech" data-testid={testId}>
      <summary>
        <h3 style={{ ...GROUP_TITLE, margin: 0 }}>{title}</h3>
        {hint === undefined ? null : <span style={{ fontWeight: 500 }}>· {hint}</span>}
      </summary>
      <div style={{ marginTop: '8px' }}>{children}</div>
    </details>
  );
}

/**
 * `13` → `13 údajov`. Počet do nadpisu zavretej skupiny.
 *
 * Exportované kvôli meraniu: test si ním overí, že číslo v nadpise sedí s tým,
 * koľko riadkov je vnútri. Číslo sa NIKDY nepíše ručne — pozri `keyedRows`.
 */
export function fieldCount(count: number): string {
  return `${formatCountSk(count)} ${pluralSk(count, 'údaj', 'údaje', 'údajov')}`;
}

/**
 * Čo je v zavretej skupine variantov.
 *
 * TRI STAVY, TRI RÔZNE VETY — a to je celý dôvod, prečo je to funkcia a nie
 * `extra?.variants.length ?? 0`. Nedoťahaný zoznam sa nesmie tváriť ako
 * zoznam, v ktorom nič nie je (bod 4 hlavičky modulu); nula v nadpise by bola
 * tvrdenie, ktoré appka pri `undefined` nemá čím kryť.
 *
 * Meria sa priamo nad ňou: `extra` sa do panela dostane až efektom a efekty
 * v `renderToStaticMarkup` nebežia, takže cez panel by sa dala odmerať jediná
 * z troch vetiev — presne tá istá pasca, akú má `SoldDominant`.
 */
export function variantsHint(extra: ProductExtraView | undefined): string {
  if (extra === undefined) return 'zatiaľ nenačítané';
  const count = extra.variants.length;
  if (count === 0) return 'shop ich nevedie';
  return `${formatCountSk(count)} ${pluralSk(count, 'variant', 'varianty', 'variantov')}`;
}

/**
 * DOMINANTA PANELA — jedno číslo, alebo priznanie, že ho appka nemá.
 *
 * Vlastný komponent, nie kus JSX vnútri panela, a je to zámerné (19. 8. 2026):
 * `sold === null` je stav, do ktorého sa panel dostane až efektom (prepnutie
 * okna predajnosti, riadok, ktorý sa pre nové okno nevrátil). Vykreslený panel
 * sa v testoch renderuje `renderToStaticMarkup`, kde efekty nebežia — takže
 * práve tá vetva, v ktorej pomlčka stála v 44 px reze, sa cez panel odmerať
 * NEDÁ. Nad týmto komponentom sa dajú odmerať obe vetvy naraz.
 *
 * ČÍSLO SI TU NEVYRÁBA: dostane hotovú bunku zo `soldUnitsViaCoverage()`
 * (`sold-coverage.ts`), teda z toho istého miesta, ktoré formuluje vetu
 * o pokrytí pre tabuľku. Panel a tabuľka tak o tej istej medzere nemôžu
 * povedať dve rôzne veci (31. 8. 2026, nález I11 č. 2).
 */
export function SoldDominant({ cell, windowDays }: { cell: KpiCellView; windowDays: number }) {
  return (
    <div className="lvl-1">
      {cell.unknown ? (
        /*
         * D11 — tu bola do 19. 8. 2026 em pomlčka v `.big.sm`, teda v 44 px
         * a reze 660. V tej veľkosti pomlčka nie je znak, ale vyplnený
         * obdĺžnik: dominanta panela vyzerala ako chyba vykreslenia a popisok
         * pod ňou nemal nad sebou hodnotu. Pomlčka zostáva — dostala len slovo
         * a veľkosť, v ktorej sa dá prečítať. Je to TEN ISTÝ tvar, aký dostala
         * karta potvrdenia novej zľavy, nie druhý podobný.
         */
        <span
          className={styles.unknown}
          data-testid="detail-units-sold"
          title={cell.title ?? undefined}
        >
          {DASH} zatiaľ nevieme
        </span>
      ) : (
        <span
          className="big sm num"
          data-testid="detail-units-sold"
          title={cell.title ?? undefined}
          data-lower-bound={cell.lowerBound ? 'true' : undefined}
        >
          {cell.text}
        </span>
      )}
      <span className="sub">
        {cell.unknown
          ? `koľko sa predalo za posledných ${windowDays} dní`
          : `predaných za posledných ${windowDays} dní`}
      </span>
    </div>
  );
}

/* ───────── Údaje spoza kľúča `product:read` ──────────────────────────────
 *
 * Panel ich kreslí ako RIADKY, nie ako vynechanie: keby riadok chýbal, nedalo
 * by sa zistiť, že tá informácia vôbec existuje. Ktoré z troch prázdien to je,
 * rozhoduje `keyedField()` a nikto iný:
 *
 *   detail sme ešte nepýtali        → `pending`
 *   detail prišiel bez bloku `keyed` → `locked`  (chýba kľúč)
 *   blok `keyed` prišiel, pole prázdne → `none`  (shop to o kuse nevedie)
 *
 * `lockcell` JE NA KAŽDOM PRÁZDNOM RIADKU (31. 8. 2026). `.lockcell` je iba
 * tlmená bunka (`color: var(--dim)`), nie tvrdenie — čo presne chýba, hovorí
 * SLOVO vnútri (`AbsenceValue`). Do 31. 8. 2026 ju držalo len historických
 * šesť riadkov (kód, sklad, nákupná cena, marža, kategórie, skutočná zľava),
 * lebo na ich počte stála kontrola, že sa zamknuté NEVYNECHÁVA. Päť z tých
 * šiestich odišlo ako duplicita (viď hlavičku modulu) a jednoprvková výnimka
 * by tú kontrolu nekryla, tak triedu nesú všetky riadky skupiny naraz.
 * Vizuálne je to bez zmeny: `AbsenceValue` si `--dim` nesie aj sama.
 */

/**
 * Hodnota spoza kľúča, alebo správne prázdno.
 *
 * `extra === undefined` je „nepýtali sme sa", NIE „nie je" — riadok, ktorý sa
 * ešte nedoťahal, sa nesmie tváriť ako riadok bez údaja.
 */
function keyedField<T>(
  extra: ProductExtraView | undefined,
  pick: (keyed: NonNullable<ProductExtraView['keyed']>) => T | null | undefined,
): Field<T> {
  if (extra === undefined) return absent('pending');
  if (extra.keyed === null) return absent('locked');
  return fieldOf(pick(extra.keyed), 'none');
}

/** To isté pre zoznam — prázdny zoznam je `none`, nie prázdna bunka. */
function keyedList(
  extra: ProductExtraView | undefined,
  pick: (keyed: NonNullable<ProductExtraView['keyed']>) => readonly string[],
): Field<readonly string[]> {
  if (extra === undefined) return absent('pending');
  if (extra.keyed === null) return absent('locked');
  const list = pick(extra.keyed);
  return list.length === 0 ? absent('none') : known(list);
}

/** Jeden riadok skupiny za kľúčom. Prázdna bunka je tlmená — pozri vyššie. */
function KeyedRow<T>({
  label,
  field,
  render,
}: {
  label: string;
  field: Field<T>;
  render: (value: T) => ReactNode;
}) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={field.known ? undefined : 'lockcell'}>
        <FieldValue field={field} render={render} />
      </dd>
    </>
  );
}

function WriteRow({ write }: { write: ProductWriteView }) {
  const sentence = itemSentence(write.status);
  return (
    <div
      className="row"
      style={{
        alignItems: 'baseline',
        gap: '10px',
        fontSize: '13px',
        padding: '5px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <b style={{ fontWeight: 640, color: 'var(--ink)', minWidth: '44px' }}>
        {formatPercentSk(write.percent)}
      </b>
      <span style={{ color: 'var(--ink2)' }}>{windowText(write)}</span>
      <span className="lvl-3" style={{ marginLeft: 'auto' }}>
        {sentence.label}
      </span>
    </div>
  );
}

/* ═══════ 1b. Krivka 90 dní, uplift a fakty z eshopu (V4, D115) ════════════
 *
 * Tri vlastné komponenty, nie kusy JSX vnútri panela — a je to z toho istého
 * dôvodu ako pri `SoldDominant`: stavy, na ktorých tu všetko stojí, sa do
 * panela dostanú AŽ EFEKTOM (KPI, krivka, výsledok obohatenia). Vykreslený
 * panel sa v testoch renderuje `renderToStaticMarkup`, kde efekty nebežia,
 * takže cez panel by sa dala odmerať jediná vetva — tá prázdna. Nad týmito
 * komponentmi sa dajú odmerať všetky.
 */

/** Geometria krivky. 90 dní × 3 px sa zmestí do stĺpca panela (620 px). */
const CURVE = { dayWidth: 3, height: 44, baseline: 43 } as const;

/** Jeden riadok uplift-u. Tri stĺpce v jednom riadku, nie tabuľka. */
const UPLIFT_ROW = {
  alignItems: 'baseline',
  gap: '8px',
  fontSize: '13px',
  padding: '3px 0',
} as const;

/**
 * DENNÁ KRIVKA PREDAJA S OKNAMI ZĽIAV A PRIZNANÝMI MEDZERAMI.
 *
 * TRI VECI, KTORÉ SA V TEJTO KRIVKE NESMÚ ZLIAŤ
 * ─────────────────────────────────────────────
 *  1. **Nestiahnutý deň nie je nula.** Deň, ktorý appka nemá, dostane
 *     ŠRAFOVANÝ PÁS na celú výšku, nie stĺpec nulovej výšky. Nula by tvrdila,
 *     že sa v ten deň nepredalo — a to je presne chyba, ktorá sa v tomto repe
 *     už raz dostala do produkcie (`sales_sync_state`, štrnásť dní `partial`
 *     počítaných ako pokryté).
 *  2. **Meraná nula je meranie.** Deň, ktorý sa stiahol CELÝ a produkt sa
 *     v ňom nepredal, dostane 1 px pri základni. Je to viditeľné tvrdenie
 *     „tu sme merali a bola nula", nie prázdne miesto.
 *  3. **Okno zľavy je NAŠE okno.** Podfarbenie hovorí, kedy appka zľavu
 *     ÚSPEŠNE ZAPÍSALA, nie kedy zľava v eshope bežala (I11). Hovorí to
 *     legenda slovom, nie len farbou.
 *
 * Šrafovanie je vzorka, nie farba — na to, aby ju niekto spojil s výpadkom
 * sťahovania, musí byť v legende SLOVO. Tri kanály (tvar, odtieň, slovo) sú tu
 * z toho istého dôvodu ako v `SalesChart`.
 */
export function ProductCurveChart({ curve }: { curve: ProductCurveView }) {
  // `useId()` vracia znaky, ktoré sa v odkaze `url(#…)` čítajú zle.
  const hatchId = `curve-hatch-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const days = curve.days;
  if (days.length === 0) {
    return (
      <div className="lvl-3" data-testid="detail-curve-empty">
        Za toto okno appka nemá ani jeden deň, takže krivku nekreslí.
      </div>
    );
  }

  const width = days.length * CURVE.dayWidth;
  /* Mierka stojí na NAJVYŠŠOM DOČÍTANOM dni. Bez dočítaného dňa niet mierky
     a stĺpce sa nekreslia vôbec — vymyslená mierka by bola vymyslený graf. */
  const top = curve.maxUnits === null || curve.maxUnits <= 0 ? null : curve.maxUnits;

  return (
    <div data-testid="detail-curve">
      <svg
        viewBox={`0 0 ${width} ${CURVE.height}`}
        width="100%"
        height={CURVE.height}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Predané kusy po dňoch od ${formatDateSk(curve.from)} do ${formatDateSk(curve.to)}. ${curveGapNote(curve)}`}
      >
        <defs>
          <pattern
            id={hatchId}
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--line2)" strokeWidth="1.5" />
          </pattern>
        </defs>

        {/* Okná VLASTNÝCH zápisov zľavy — pod dátami, nie nad nimi. */}
        {curve.bands.map((band) => (
          <rect
            key={`${band.campaignId}-${band.fromIndex}`}
            x={band.fromIndex * CURVE.dayWidth}
            y={0}
            width={(band.toIndex - band.fromIndex + 1) * CURVE.dayWidth}
            height={CURVE.height}
            fill="var(--sel)"
            data-testid="detail-curve-band"
          />
        ))}

        {days.map((day, index) => {
          const x = index * CURVE.dayWidth;
          if (day.units === null) {
            /* Medzera na celú výšku — NIE stĺpec nulovej výšky (bod 1). */
            return (
              <rect
                key={day.day}
                x={x}
                y={0}
                width={CURVE.dayWidth}
                height={CURVE.height}
                fill={`url(#${hatchId})`}
                data-testid="detail-curve-gap"
              />
            );
          }
          const scaled = top === null ? 0 : Math.round((day.units / top) * (CURVE.height - 6));
          /* Meraná nula (aj meraný najnižší deň) má viditeľnú 1 px stopu (bod 2). */
          const barHeight = Math.max(1, scaled);
          return (
            <rect
              key={day.day}
              x={x + 0.5}
              y={CURVE.baseline - barHeight}
              width={CURVE.dayWidth - 1}
              height={barHeight}
              fill="var(--barfill)"
              data-testid="detail-curve-day"
            />
          );
        })}
        <line
          x1="0"
          y1={CURVE.baseline + 0.5}
          x2={width}
          y2={CURVE.baseline + 0.5}
          stroke="var(--line)"
          strokeWidth="1"
        />
      </svg>

      <div className="lvl-3" data-testid="detail-curve-legend">
        stĺpec = predané kusy · šrafovanie = dni, ktoré appka nemá · podfarbenie =
        okno NÁŠHO zápisu zľavy
      </div>
    </div>
  );
}

/**
 * UPLIFT — A PRIZNANIE, KEĎ SA SPOČÍTAŤ NEDÁ.
 *
 * ZAPÍSANÁ PASCA (commit `d00e081`, 26. 8. 2026): v tomto repe sa už raz DVE
 * OKNÁ, KTORÉ ZĽAVE OBE PREDCHÁDZALI, vydávali za výkon zľavy — graf nakreslil
 * dva stĺpce, jeden bol „silnejší" a tvrdil tým vplyv, ktorý sa nemohol stať.
 *
 * Okná definuje `upliftFor()` na serveri a ten ich aj ODMIETNE spočítať, keď to
 * poctivo nejde (zľava sa ešte nezačala, okno je krátke, do základne zasahuje
 * iná zľava, chýbajú stiahnuté dni). ÚLOHA TOHTO KOMPONENTU JE TO NEZAKRYŤ:
 *
 *  · keď server povie „nedá sa", tu je SLOVO a dôvod — a ani jedno číslo
 *    porovnania,
 *  · uplift sa TU NIKDY NEDOPOČÍTAVA. Žiadne `during − before`, žiadne
 *    percento z dvoch čísel, ktoré by po ruke boli.
 *
 * Rozhodnutie „hodnota, alebo priznanie" robí `upliftView()`; tu je len
 * vykreslenie, aby sa to dalo zmerať bez prehliadača.
 */
export function UpliftBlock({ view }: { view: UpliftView }) {
  if (view.kind === 'unavailable') {
    return (
      <div data-testid="detail-uplift" data-uplift="unavailable">
        <div className="lvl-2">
          Výkon zľavy — <b>{view.word}</b>
        </div>
        <div className="lvl-3">{view.why}</div>
        {view.ranges === null ? null : (
          <div className="lvl-3" data-testid="detail-uplift-ranges">
            Porovnávalo by sa {view.ranges}.
          </div>
        )}
      </div>
    );
  }

  return (
    <div data-testid="detail-uplift" data-uplift="value">
      <div className="lvl-2">
        Výkon zľavy{view.campaign === null ? '' : ` · ${view.campaign}`}
      </div>
      {/*
        Tri riadky ako `<div>`, NIE ako `<dl>`. Rozpočet výšky povrchu panela sa
        meria počtom `<dt>` (`produkty-detail-rozklik.spec.ts`) a je vyčerpaný
        šiestimi riadkami skupiny „Zľavy podľa vlastných zápisov". Uplift patrí
        na povrch — je to celý dôvod, prečo sa panel vo V4 otvára — takže výšku
        neberie riadkom dvojstĺpcovej tabuľky.
      */}
      <div data-testid="detail-uplift-windows">
        <div className="row" style={UPLIFT_ROW}>
          <span className="lvl-3">Pred</span>
          <span className="num">{view.beforeText}</span>
          <span className="lvl-3" style={{ marginLeft: 'auto' }}>
            {view.beforeRange}
          </span>
        </div>
        <div className="row" style={UPLIFT_ROW}>
          <span className="lvl-3">Počas</span>
          <span className="num">{view.duringText}</span>
          <span className="lvl-3" style={{ marginLeft: 'auto' }}>
            {view.duringRange}
          </span>
        </div>
        <div className="row" style={UPLIFT_ROW} data-testid="detail-uplift-delta">
          <span className="lvl-3">Rozdiel na deň</span>
          {view.deltaText === null ? (
            <span style={{ color: 'var(--dim)' }}>{DASH} nedá sa vyjadriť</span>
          ) : (
            <b className="num">{view.deltaText}</b>
          )}
        </div>
      </div>
      {view.deltaNote === null ? null : <div className="lvl-3">{view.deltaNote}</div>}
      {view.truncatedNote === null ? null : <div className="lvl-3">{view.truncatedNote}</div>}
      <div className="lvl-3">{view.caveat}</div>
    </div>
  );
}

/**
 * Osem faktov z obohatenia ako `<dl>`.
 *
 * Riadky prichádzajú HOTOVÉ z `kpiFactRows()` — vrátane toho, ktoré z prázdien
 * to je. Komponent si o hodnote nič nedomýšľa a nič neformátuje: keby si tu
 * čokoľvek dopočítal, existoval by ten výpočet v repe dvakrát.
 */
export function KpiFacts({ rows }: { rows: readonly KpiFactRow[] }) {
  return (
    <dl className="dl" data-testid="detail-kpi-facts">
      {rows.map((row) => (
        <Fragment key={row.key}>
          <dt>{row.label}</dt>
          <dd>
            <KpiValueText field={row.field} render={(value) => <span className="num">{value}</span>} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/* ═══════════════════════════ 2. Panel ═════════════════════════════════════ */

/**
 * `id` panela. Nesie ho `<aside>` a ODKAZUJE naň `aria-controls` na tlačidle
 * názvu v `CatalogTable` — rozklik a to, čo rozkliká, musia byť spojené jedným
 * reťazcom, nie dvoma zhodnými literálmi v dvoch súboroch.
 *
 * Na obrazovke je panel najviac raz, takže `id` je pevné a nie z `productId`:
 * pri prepnutí riadku sa väzba nesmie na okamih rozpadnúť.
 */
export const PRODUCT_DETAIL_ID = 'product-detail';

/** D115: detail kreslí krivku za 90 dní. Endpoint má to isté ako predvoľbu. */
export const DETAIL_CURVE_DAYS = 90;

/**
 * ČO SA STANE S KLÁVESOU V PANELI.
 *
 * Escape zatvára — panel je jediné miesto obrazovky, z ktorého sa inak
 * klávesnicou nedá vyjsť inak než pretabulovaním celého zvyšku stránky.
 * `defaultPrevented` je tu z toho istého dôvodu ako v `ui/Drawer`: keď si
 * Escape spracoval vnorený dialóg, panel sa ho nesmie chytiť ako druhý
 * a zatvoriť sa pod ním. (Do 27. 8. 2026 tu ako príklad stálo sudo okno;
 * D100 ho zrušila.)
 *
 * Je to čistá funkcia, nie `if` v obsluhe, aby sa dala zmerať bez prehliadača.
 */
export function detailPanelKeyAction(
  key: string,
  defaultPrevented: boolean,
): 'close' | 'ignore' {
  if (key !== 'Escape') return 'ignore';
  if (defaultPrevented) return 'ignore';
  return 'close';
}

export interface ProductDetailPanelProps {
  row: CatalogRowView;
  /** Okno, v ktorom je `row.unitsSold` — to isté, aké má tabuľka. */
  soldWindowDays: number;
  /**
   * Za koľko dní má appka objednávky NAOZAJ stiahnuté. Bez neho je dominanta
   * len dolná hranica (a nula pomlčka) — číslo z `catalog/search` bránu
   * `status='complete'` nemá, viď `soldUnitsViaCoverage()`.
   */
  soldCoverage?: SoldCoverageState;
  /**
   * Prekážky, ktoré by zápis na TENTO produkt zastavili
   * (`collectProductBlockers`). Informatívne riadky sem neposielajte —
   * odfiltruje ich panel sám, ale zbytočne.
   */
  blockers?: readonly Blocker[];
  onClose: () => void;
}

interface DetailState {
  writes: readonly ProductWriteView[] | null;
  /** Dnešok podľa servera — rozhoduje, ktorý zápis práve platí. */
  today: string | null;
  failed: boolean;
}

const EMPTY: DetailState = { writes: null, today: null, failed: false };

export function ProductDetailPanel({
  row,
  soldWindowDays,
  soldCoverage,
  blockers,
  onClose,
}: ProductDetailPanelProps) {
  const [state, setState] = useState<DetailState>(EMPTY);
  /** Okno predajnosti PANELA. Začína na okne tabuľky, ďalej si ho volí človek. */
  const [windowDays, setWindowDays] = useState<SoldWindow>(asSoldWindow(soldWindowDays));
  /** Predané kusy za `windowDays`. `null` = nevieme, teda pomlčka (nie nula). */
  const [sold, setSold] = useState<number | null>(row.unitsSold);
  /**
   * Doťahnutý detail TOHTO kusu — varianty s kódom, EAN a skladom, a keď je
   * kľúč, aj polia spoza neho. `undefined` = zatiaľ sme sa nepýtali, takže
   * všetky bunky sú `pending`; nikdy nie `none`.
   */
  const [extra, setExtra] = useState<ProductExtraView | undefined>(undefined);
  /**
   * Fakty z obohatenia (D114). `null` = odpoveď zatiaľ neprišla, takže riadky
   * sú „zatiaľ nenačítané" — NIKDY nuly a nikdy „produkt nie je obohatený".
   */
  const [kpi, setKpi] = useState<ProductKpiView | null>(null);
  /** Ako sa skončilo doťahovanie na dopyt. `null` = ešte nedobehlo. */
  const [enriched, setEnriched] = useState<EnrichOutcomeKind | null>(null);
  /** Krivka, okná zliav a uplift. `null` = zatiaľ nenačítané. */
  const [insights, setInsights] = useState<ProductInsightsView | null>(null);
  /**
   * História zliav tohto kusu (D127 bod 3). `null` = zatiaľ nenačítané, a to
   * NIE JE prázdna história: prázdny zoznam je odpoveď, `null` je nevedomosť.
   */
  const [history, setHistory] = useState<ProductCampaignsWire | null>(null);
  /** Načítanie histórie zlyhalo — vlastná veta, nikdy prázdny zoznam. */
  const [historyFailed, setHistoryFailed] = useState(false);

  const panelRef = useRef<HTMLElement | null>(null);
  /**
   * Prvok, z ktorého sa panel otvoril — tlačidlo názvu v riadku tabuľky.
   * Po zavretí mu fokus PATRÍ SPÄŤ: bez toho spadne na `document.body`
   * a človek, ktorý sa dovnútra dostal klávesnicou, začína od hlavičky
   * stránky a svoj riadok medzi päťdesiatimi hľadá odznova.
   */
  const openerRef = useRef<HTMLElement | null>(null);

  /*
   * FOKUS IDE DO PANELA PRI OTVORENÍ — a to nie je ozdoba.
   *
   * Panel je v DOM ZA celou tabuľkou (`CatalogPanel`: `.catalog-split` má
   * tabuľku a panel ako súrodencov v tomto poradí). Kto ho otvorí z prvého
   * riadku, má k jeho obsahu pri päťdesiatich riadkoch na stránku vyše sto
   * tabulátorov — zaškrtávacie políčko a názov na každom riadku. Poradie
   * tabulátora pritom sedí s obrazovkou (panel je vpravo), takže sa to
   * neopravuje presúvaním v DOM, ale tým, že sa fokus presunie tam, kam sa
   * presunula pozornosť.
   *
   * Beží aj pri PREPNUTÍ riadku, nielen pri prvom otvorení: panel sa
   * neodmontuje, len prekreslí, a obsah je vtedy o inom kuse.
   */
  useEffect(() => {
    const active = document.activeElement;
    const panel = panelRef.current;
    if (active instanceof HTMLElement && (panel === null || !panel.contains(active))) {
      openerRef.current = active;
    }
    panel?.focus();
  }, [row.productId]);

  /* Zavretie panela vracia fokus tam, odkiaľ sa otvoril. Prvok, ktorý medzitým
     z obrazovky zmizol (prelistovanie, iný filter), sa preskočí. */
  useEffect(
    () => () => {
      const opener = openerRef.current;
      if (opener !== null && opener.isConnected) opener.focus();
    },
    [],
  );

  /* Vlastné zápisy appky — jediný zdroj všetkého, čo panel povie o zľavách. */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setState(EMPTY);

    void (async () => {
      const history = await productWrites(row.productId, controller.signal);
      if (!live) return;
      if (history.ok) {
        setState({ writes: history.data.writes, today: history.data.today, failed: false });
      } else if (!isAborted(history.error)) {
        setState({ writes: null, today: null, failed: true });
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId]);

  /*
   * DETAIL JEDNÉHO KUSU — varianty, kódy, sklad a polia spoza kľúča.
   *
   * Doťahuje sa práve ten kus, ktorý má používateľ otvorený, a práve raz na
   * otvorenie. Riadok, ktorý detail už má, server znovu zo shopu NEČÍTA
   * (`fillProductDetails` ho preskočí), takže otvorenie kusu z už doplnenej
   * stránky nestojí z rozpočtu čítaní nič.
   *
   * Neúspech NIE JE prázdny výsledok: `extra` zostane `undefined`, teda bunky
   * ostanú „zatiaľ nenačítané" a nie „shop nič nemá".
   */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setExtra(undefined);

    void (async () => {
      const { view } = await fetchExtras([row.productId], controller.signal);
      if (!live || view === null) return;
      setExtra(view.items.find((item) => item.productId === row.productId));
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId]);

  /*
   * OBOHATENIE NA DOPYT (D118 bod 1) A FAKTY PO ŇOM.
   *
   * Používateľ otvoril kus, takže sa TENTO kus dotiahne HNEĎ — presne to D118
   * hovorí, a je to jediná cesta, ktorá smie do rezervy kvóty (~50 čítaní,
   * ktoré si dávka na pozadí nesmie vziať).
   *
   * RAZ NA OTVORENIE, NIKDY V CYKLE. Efekt visí VÝHRADNE na `row.productId`;
   * závislosť na čomkoľvek, čo sa mení odpoveďou (KPI, výsledok), by z panela
   * urobila slučku, ktorá minie dennú kvótu za sekundy. Idempotenciu drží aj
   * route (svieži riadok `getFull` vôbec nezavolá), ale to je druhá poistka,
   * nie tá prvá.
   *
   * Poradie je zámerné: najprv doťahovanie, POTOM čítanie KPI — inak by panel
   * ukázal fakty spred obohatenia a človek by videl pomlčky aj vtedy, keď sa
   * hodnoty práve dotiahli. Keď doťahovanie neuspeje (dnes typicky `ip_banned`,
   * KONTRAKT-V4 §2b), KPI sa čítajú AJ TAK: v DB môže ležať starší, stále
   * pravdivý riadok, a „appka nemá nič" by bolo tvrdenie navyše.
   */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setKpi(null);
    setEnriched(null);

    void (async () => {
      const done = await enrichProduct(row.productId, controller.signal);
      if (!live) return;
      // Odmietnutie shopu je MERANÝ výsledok, nie chyba appky — panel z neho
      // spraví vetu (`enrichNotice`), nie chybové hlásenie.
      if (done.ok) setEnriched(done.data.outcome);
      const facts = await fetchProductKpi(row.productId, controller.signal);
      if (!live || !facts.ok) return;
      setKpi(facts.data);
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId]);

  /*
   * Krivka 90 dní, okná NAŠICH zliav a uplift (D115).
   *
   * Čisto čítacie, z lokálnej DB (K8) — táto cesta shop nevolá, takže sa smie
   * spustiť pri každom otvorení bez ohľadu na kvótu.
   */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setInsights(null);

    void (async () => {
      const res = await fetchProductInsights(row.productId, DETAIL_CURVE_DAYS, controller.signal);
      if (!live || !res.ok) return;
      setInsights(res.data);
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId]);

  /*
   * HISTÓRIA ZĽIAV TOHTO KUSU (D127 bod 3).
   *
   * Čisto čítacie, z lokálnej DB (K8) — táto cesta shop nevolá, takže sa smie
   * spustiť pri každom otvorení bez ohľadu na kvótu. Neúspech NIE JE prázdna
   * história: `history` zostane `null` a `historyFailed` povie vetu, inak by
   * výpadok siete tvrdil, že produkt nikdy v zľave nebol.
   */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setHistory(null);
    setHistoryFailed(false);

    void (async () => {
      const res = await fetchProductCampaigns(row.productId, controller.signal);
      if (!live) return;
      if (res.ok) setHistory(res.data);
      else if (!isHistoryAborted(res.error)) setHistoryFailed(true);
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId]);

  /* Zmena riadku alebo okna tabuľky vráti panel na to isté okno ako tabuľka. */
  useEffect(() => {
    setWindowDays(asSoldWindow(soldWindowDays));
  }, [row.productId, soldWindowDays]);

  /* Predané kusy za okno panela. Okno tabuľky už máme v riadku — nedopytujeme
     sa naň druhýkrát. */
  useEffect(() => {
    if (windowDays === soldWindowDays) {
      setSold(row.unitsSold);
      return;
    }
    const controller = new AbortController();
    let live = true;
    setSold(null);

    void (async () => {
      const res = await catalogRow(row.productId, windowDays, controller.signal);
      if (!live || !res.ok) return;
      const found = res.data.data[0];
      // Riadok, ktorý sa nevrátil, NIE JE nula predaných — je to neznáme.
      setSold(found === undefined ? null : found.unitsSold);
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [row.productId, row.unitsSold, soldWindowDays, windowDays]);

  /*
   * Dominanta panela: číslo z objednávok, prečítané cez pokrytie (I11, D119).
   * Chýbajúce pokrytie znamená DOLNÚ HRANICU, nie fakt — a nula bez plného
   * pokrytia je pomlčka. Rozhoduje o tom jediné miesto, `soldUnitsViaCoverage()`.
   */
  const soldCell = soldUnitsViaCoverage(sold, windowDays, soldCoverage ?? SOLD_COVERAGE_UNASKED);

  const writes = state.writes ?? [];
  const planned = writes.find((write) => write.status === 'pending');
  const running = runningWrite(writes, state.today);
  const last = lastWrittenDiscount(writes);

  // Informatívne prekážky sú o výbere, nie o kuse — pozri hlavičku modulu.
  const stopping = (blockers ?? []).filter((blocker) => blocker.severity !== 'informuje');
  const reasons = productReasons(row);
  const nothingInTheWay = stopping.length === 0 && reasons.length === 0;

  /**
   * „Zľava teraz" podľa VLASTNÝCH zápisov. Keď appka o zľave vie, ale zápis
   * k nej ešte nemá načítaný, je to pomlčka — percento by bolo vymyslené.
   */
  const discountNow = ((): string => {
    if (running !== null) return formatPercentSk(running.percent);
    if (!row.discountedNow) return 'bez zľavy';
    return state.writes === null ? DASH : 'v zľave';
  })();

  /** `true` = blok spoza kľúča naozaj prišiel, takže skupina nesie hodnoty. */
  const keyedShown = extra !== undefined && extra.keyed !== null;

  /**
   * Zrkadlo katalógu ako ZOZNAM, nie ako natvrdo napísané `<dt>`/`<dd>` páry.
   * Počet v nadpise zavretej skupiny sa počíta z tohto poľa, takže sa nedá
   * rozísť s tým, čo je vnútri: kto riadok pridá alebo uberie, zmení oboje
   * naraz.
   */
  const facts: readonly { label: string; value: ReactNode }[] = [
    { label: 'Názov', value: row.name ?? DASH },
    { label: 'Cena', value: formatEur(row.price) },
    { label: 'Varianty', value: row.hasAttributes ? 'má varianty' : 'bez variantov' },
    { label: 'Stav v eshope', value: SHOP_STATUS_TEXT[row.shopStatus] },
    { label: 'Odkiaľ je tento riadok', value: ORIGIN_TEXT[row.origin] },
  ];

  /** Čo je v zavretej skupine variantov — tri stavy, tri vety (`variantsHint`). */
  const variantHint = variantsHint(extra);

  /* Osem faktov z obohatenia; `kpi === null` znamená „zatiaľ nenačítané". */
  const factRows = kpiFactRows(kpi);
  /** Veta o doťahovaní. `null` = dotiahlo sa (alebo bol riadok svieži). */
  const notice = enrichNotice(enriched);
  /** Uplift — hodnota, alebo PRIZNANIE. Nikdy dopočítané v komponente (D115). */
  const uplift: UpliftView = upliftView(insights === null ? null : insights.uplift);

  /**
   * „referencia · názov" (D116). Referencia je z obohatenia, takže neobohatený
   * produkt ju NEMÁ — a `productLabel()` z toho nespraví prázdno: ostane názov
   * a `#id` v technickom detaile.
   */
  const label = ((): ReturnType<typeof productLabel> => {
    const reference = kpi === null ? null : kpi.reference.known ? kpi.reference.value : null;
    return productLabel({ productId: row.productId, reference, name: row.name });
  })();

  /**
   * PÄŤ RIADKOV SPOZA KĽÚČA AKO ZOZNAM — a je ich päť, nie trinásť.
   *
   * Osem z pôvodných trinástich riadkov hovorilo TO ISTÉ, čo skupina „Fakty
   * z eshopu" nad nimi (rozhodnutie 31. 8. 2026, celý dôvod je v hlavičke
   * modulu). Zostalo presne to, čo `getFull` dá a čo obohatenie v `catalog_cache`
   * NENESIE, takže inde v paneli nie je: EAN, cena s DPH, kategórie, či je kus
   * v eshope zapnutý a kedy doň pribudol.
   *
   * Dôvod, prečo je to ZOZNAM, je ten istý ako pri `facts`: počet v nadpise
   * zavretej skupiny sa počíta z `keyedRows.length`, takže sa NEDÁ dostať do
   * stavu, keď nadpis sľubuje päť údajov a vnútri ich sú štyri. Riadok sa tu
   * pridáva aj uberá práve raz.
   */
  const keyedRows: readonly ReactNode[] = [
    <KeyedRow
      key="ean13"
      label="EAN produktu"
      field={keyedField(extra, (k) => k.ean13)}
      render={(value) => <span className="num">{value}</span>}
    />,
    <KeyedRow
      key="price-tax"
      label="Cena s DPH"
      field={keyedField(extra, (k) => k.priceWithTax)}
      render={(value) => formatEur(value)}
    />,
    <KeyedRow
      key="categories"
      label="Kategórie"
      field={keyedList(extra, (k) => k.categories)}
      render={(value) => value.join(' · ')}
    />,
    <KeyedRow
      key="active"
      label="Zapnutý v eshope"
      field={keyedField(extra, (k) => k.active)}
      render={(value) => (value ? 'áno' : 'nie')}
    />,
    <KeyedRow
      key="added"
      label="Pridané do eshopu"
      field={keyedField(extra, (k) => k.addedAt)}
      render={(value) => formatDateSk(value)}
    />,
  ];

  return (
    <aside
      ref={panelRef}
      id={PRODUCT_DETAIL_ID}
      className="drawer"
      /* `-1` = fokus sem ide programovo, do poradia tabulátora panel
         NEPRIBUDNE. Panel nie je ovládací prvok a pridať ho medzi zastávky
         by tabulátor len predĺžilo. */
      tabIndex={-1}
      /* Escape sa berie z panela, nie z `document`: panel NIE JE modálny,
         pozadie zostáva ovládateľné, a globálny odposluch by zatváral aj
         vtedy, keď je človek myšlienkami aj fokusom úplne inde. */
      onKeyDown={(event) => {
        if (detailPanelKeyAction(event.key, event.defaultPrevented) === 'ignore') return;
        event.preventDefault();
        onClose();
      }}
      data-testid="product-detail"
      aria-label="Detail produktu"
    >
      <div className="drawer-h">
        <div>
          {/* D116: na povrchu „referencia · názov", `#id` v technickom detaile. */}
          <div className="t">{label.text}</div>
          <div className="lvl-3" style={{ marginTop: '3px' }}>
            {formatEur(row.price)}
          </div>
          {row.discountedNow ? (
            <div className="flag neutral" style={{ marginTop: '4px' }} data-testid="detail-own-write">
              <FlagMark tone="neutral" />
              v zľave podľa vlastného zápisu
            </div>
          ) : null}
          {row.shopStatus === 'not_found' ? (
            <div className="flag" style={{ marginTop: '4px' }}>
              <FlagMark />
              {SHOP_STATUS_TEXT.not_found}
            </div>
          ) : null}
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Zavrieť detail">
          {/* Meno nesie `aria-label` tlačidla; ikona je `aria-hidden`. */}
          <Icon name="x" />
        </button>
      </div>

      <SoldDominant cell={soldCell} windowDays={windowDays} />
      {/* `role="group"` — bez roly je `aria-label` na `<div>` neplatný
          a čítačka ho zahodí (to isté vo filtroch a v pätke tabuľky). */}
      <div className="seg" role="group" aria-label="Za koľko dní sa počítajú predané kusy">
        {SOLD_WINDOWS.map((days: SoldWindow) => (
          <button
            key={days}
            type="button"
            className={days === windowDays ? 'on' : undefined}
            aria-pressed={days === windowDays}
            onClick={() => setWindowDays(days)}
            data-testid={`detail-window-${days}`}
          >
            {days}
          </button>
        ))}
      </div>
      <div className="lvl-3" style={{ marginTop: '4px' }}>
        Vlastný výpočet z objednávok.
      </div>

      {/*
       * KRIVKA 90 DNÍ A VÝKON ZĽAVY (D115) — na povrchu, nie pod rozklikom.
       *
       * Toto je vo V4 dôvod, prečo sa panel otvára: jedno číslo nad ním hovorí
       * KOĽKO, krivka hovorí KEDY a uplift hovorí, či to zľava spravila (alebo
       * že sa to povedať nedá). Schované pod rozklikom by to bola referencia,
       * a referencia sa neotvára.
       */}
      <DetailGroup title={`Predaj po dňoch · ${DETAIL_CURVE_DAYS} dní`}>
        {insights === null ? (
          <div className="lvl-3" data-testid="detail-curve-loading">
            Krivka sa načítava.
          </div>
        ) : (
          <>
            <ProductCurveChart curve={insights.curve} />
            <div className="lvl-3" data-testid="detail-curve-gaps">
              {curveGapNote(insights.curve)}
            </div>
          </>
        )}
        <div style={{ marginTop: '8px' }}>
          <UpliftBlock view={uplift} />
        </div>
      </DetailGroup>

      {/*
       * PREKÁŽKY MAJÚ NADPIS LEN VTEDY, KEĎ JE ČO VYMENOVAŤ.
       *
       * Skupina s vlastným nadpisom nad JEDINOU vetou „nič tu nie je" stála
       * 55 px, z toho 34 px na chróm nad nulovým obsahom. Nadpis skupiny je
       * sľub, že pod ním je zoznam; nad jednou vetou je to prázdna miestnosť
       * s menovkou na dverách. Presne to isté rozhodnutie má D8 v `CatalogTiles`
       * (dlaždica bez hodnoty nekreslí vysvetlivku, prázdny rozklik sa nekreslí
       * vôbec).
       *
       * Nič sa tým nestráca: veta si tému pomenuje sama a nesie aj to, ČIE je
       * to pozorovanie — appka nehovorí „nič nebráni", hovorí „appka nevidí
       * nič". Len čo je prekážka naozaj čo vymenovať, nadpis je späť aj so
       * skupinou. Jeden riadok, nie dva: slová „pri tomto produkte" povedal
       * panel už tým, že je otvorený nad kusom.
       */}
      {nothingInTheWay ? (
        <div
          className="lvl-3"
          style={{ borderTop: '1px solid var(--line)', marginTop: '10px', paddingTop: '8px' }}
          data-testid="product-no-blockers"
        >
          Appka nevidí nič, čo by zápisu zľavy bránilo.
        </div>
      ) : (
        <DetailGroup title="Prekážky">
          {reasons.map((reason) => (
            <div
              key={reason.id}
              style={{ padding: '4px 0' }}
              data-testid={`product-reason-${reason.id}`}
            >
              <div className={reason.tone === 'attention' ? 'flag' : 'flag neutral'}>
                <FlagMark tone={reason.tone === 'attention' ? 'attention' : 'neutral'} />
                {reason.short}
              </div>
              <div className="lvl-2" style={{ marginTop: '3px' }}>
                {reason.what}
              </div>
              <div className="lvl-3">{reason.nextStep}</div>
            </div>
          ))}
          <BlockerNotes blockers={stopping} here="/produkty" testId="product-blockers" />
        </DetailGroup>
      )}

      {/*
       * Zrkadlo katalógu je pod rozklikom, a to zámerne: názov aj cena stoja
       * o 200 px vyššie v hlavičke panela v čitateľnejšej veľkosti, takže
       * otvorená skupina ich na povrchu opakovala. Zvyšok (varianty, stav
       * v eshope, pôvod riadku, čas načítania) je pôvod údaja — pomáha
       * rozhodnúť, či sa cene dá veriť, ale nie je to dôvod, prečo sa panel
       * otvára. Nadpis a počet zostávajú na povrchu.
       */}
      <DetailGroup
        title="Údaje o produkte"
        hint={fieldCount(facts.length)}
        fold
        testId="detail-facts-fold"
      >
        <dl className="dl" data-testid="detail-facts">
          {facts.map((fact) => (
            <Fragment key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="detail-row-fetched-at">
          Načítané {formatDateTimeSk(row.fetchedAt)}.
        </div>
      </DetailGroup>

      {/*
       * AKO SA SKONČILO DOŤAHOVANIE — NA POVRCHU, a to je celé rozhodnutie.
       *
       * Veta vysvetľuje, prečo sú fakty pod ňou prázdne. Pod rozklikom by ju
       * nikto nevidel a pomlčky by vyzerali ako chyba appky. Od 28. 8. 2026
       * eshop odmieta našu adresu (`ip_banned`), takže toto je dnes NORMÁLNY
       * stav — hovorí sa preto vetou, nie chybovým hlásením.
       */}
      {notice === null ? null : notice.tone === 'attention' ? (
        <div className="flag" style={{ marginTop: '8px' }} data-testid="detail-enrich-notice">
          <FlagMark />
          {notice.text}
        </div>
      ) : (
        <div className="lvl-3" style={{ marginTop: '8px' }} data-testid="detail-enrich-notice">
          {notice.text}
        </div>
      )}

      {/*
       * FAKTY Z OBOHATENIA (D114 v revízii §2b). Nadpis sa mení s tým, čo appka
       * naozaj má — nadpis „Fakty z eshopu" nad ôsmimi pomlčkami by klamal.
       * Marža sa NEPOČÍTA: shop ju posiela hotovú a appka ukazuje presne to.
       */}
      <DetailGroup
        title={kpi !== null && kpi.enrichedAt !== null ? 'Fakty z eshopu' : 'Fakty z eshopu zatiaľ nemáme'}
        hint={fieldCount(factRows.length)}
        fold
        testId="detail-kpi-fold"
      >
        <KpiFacts rows={factRows} />
        <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="detail-kpi-measured">
          {measuredNote(kpi)}
        </div>
      </DetailGroup>

      {/*
       * Varianty sú jediné miesto, kde je kód a sklad vidieť BEZ kľúča. Kus
       * bez variantov ich nemá o čom povedať — to už hovorí riadok „Varianty"
       * vyššie a druhá veta o tom istom by bola šum.
       *
       * Zoznam je pod rozklikom: kus s ôsmimi variantmi má osem dvojriadkových
       * položiek, teda vyše 200 px, a to je pri kuse, ktorý sa otvára kvôli
       * predajnosti, príliš veľa miesta. Koľko variantov to je, hovorí nadpis
       * — a to je práve tá informácia, kvôli ktorej by sa zoznam otváral.
       */}
      {row.hasAttributes ? (
        <DetailGroup title="Varianty" hint={variantHint} fold testId="detail-variants-fold">
          <ProductVariants extra={extra} />
        </DetailGroup>
      ) : null}

      <DetailGroup title="Zľavy podľa vlastných zápisov">
        <dl className="dl" data-testid="detail-discounts">
          <dt>Zľava teraz</dt>
          <dd data-testid="detail-discount-now">{discountNow}</dd>
          <dt>Okno tejto zľavy</dt>
          <dd>{running === null ? DASH : windowText(running)}</dd>
          <dt>Naposledy zlacnené</dt>
          <dd>{last === null ? DASH : formatDateSk(last.at ?? last.dateFrom)}</dd>
          <dt>Vtedy o</dt>
          <dd>{last === null ? DASH : `${formatPercentSk(last.percent)} · ${windowText(last)}`}</dd>
          <dt>V pripravovanej zľave</dt>
          <dd>{planned === undefined ? DASH : planned.campaignName}</dd>
          <dt>Cena po nej</dt>
          <dd>{planned === undefined ? DASH : priceAfter(row.price, planned.percent)}</dd>
        </dl>

        {state.failed ? (
          <div className="lvl-3" style={{ marginTop: '8px' }}>
            Zápisy sa nepodarilo načítať.
          </div>
        ) : state.writes === null ? (
          <div className="lvl-3" style={{ marginTop: '8px' }}>
            Načítavam…
          </div>
        ) : writes.length === 0 ? (
          /*
           * Stav zápisov a výhrada pod ním sú DVE VETY O TOM ISTOM (o tom, čo
           * appka o zľavách vie), takže stoja v jednom bloku s jedným
           * odsadením. Dva samostatné 8 px odstupy z nich robili dve
           * nesúvisiace poznámky a stáli výšku, ktorá v paneli nie je.
           */
          <div className="lvl-3" style={{ marginTop: '8px' }}>
            Tento produkt sme ešte nezlacňovali.
          </div>
        ) : (
          /*
           * Zoznam zápisov je LOG, a log patrí pod rozklik (P6). Šesť riadkov
           * dl nad ním už povedalo, čo z neho človek potrebuje — čo platí
           * teraz, kedy sa naposledy zlacňovalo a o koľko. Celá história je
           * odpoveď na inú otázku a pri kuse s desiatimi zápismi vytlačila
           * z panela všetko ostatné. Počet je v nadpise, takže sa dá zistiť,
           * že tam je, aj bez otvorenia.
           */
          <details className="tech" data-testid="detail-writes-fold">
            <summary>
              Všetky naše zápisy · {formatCountSk(writes.length)}{' '}
              {pluralSk(writes.length, 'zápis', 'zápisy', 'zápisov')}
            </summary>
            <div style={{ marginTop: '6px' }}>
              {writes.map((write) => (
                <WriteRow key={write.itemId} write={write} />
              ))}
            </div>
          </details>
        )}

        <div className="lvl-3" style={{ marginTop: '4px' }}>
          Appka vidí len to, čo sama zapísala — nie stav eshopu.
        </div>
      </DetailGroup>

      {/*
       * HISTÓRIA ZĽIAV — „kedy sme toto už zlacnili?" (D127 bod 3).
       *
       * Pod rozklikom, a to zámerne: je to LOG, a log patrí pod rozklik (P6).
       * Čo z neho človek potrebuje na povrchu, už povedala skupina nad ním —
       * čo platí teraz, kedy sa naposledy zlacňovalo a o koľko. Nadpis nesie
       * POČET zliav, takže sa dá zistiť, že história je, aj koľko toho v nej
       * je, bez otvorenia. Prázdna história tam má vlastnú vetu („zatiaľ
       * v žiadnej"), nie nulu — a zlyhané načítanie tretiu, aby sa výpadok
       * nečítal ako odpoveď.
       *
       * PREČO TO NIE JE DRUHÝ ZOZNAM TOHO ISTÉHO: „Všetky naše zápisy" vyššie
       * je log DOKONČENÝCH pokusov o zápis (`productWrites()` zahadzuje
       * `pending`). Táto skupina je zoznam ZLIAV, do ktorých bol kus zaradený
       * — vrátane tých, ktoré sa ešte nezapisovali — a nesie meno zľavy a cenu
       * pred/po, teda dva údaje, ktoré ten log nemá. Rozdiel je napísaný aj na
       * obrazovke (`HISTORY_SCOPE_NOTE`), nie len tu.
       */}
      <DetailGroup
        title="Kedy sme tento kus už zlacnili"
        hint={historyHint(history, historyFailed)}
        fold
        testId="detail-history-fold"
      >
        <DiscountHistoryList view={history} failed={historyFailed} />
      </DetailGroup>

      {/*
       * Nadpis sa mení s tým, čo appka naozaj má: kým blok spoza kľúča
       * neprišiel, je celá skupina „Zatiaľ nedostupné"; keď príde, sú to
       * podrobnosti z eshopu. Nadpis, ktorý by nad vypísanými hodnotami tvrdil
       * „nedostupné", by bol nepravdivý.
       *
       * ČAS MERANIA JE POVINNÝ (31. 8. 2026). Skupina o ňom mlčala, a keďže
       * osem jej riadkov opakovalo „Fakty z eshopu", nedalo sa povedať, ktoré
       * z dvoch čísel o tom istom poli je novšie. Duplicita odišla; mlčanie
       * odchádza spolu s ňou, lebo skupina bez času merania sa v tomto paneli
       * nekreslí. Vetu skladá `keyedMeasuredNote()`, nie JSX.
       */}
      <DetailGroup
        title={keyedShown ? 'Podrobnosti z eshopu' : 'Zatiaľ nedostupné'}
        hint={fieldCount(keyedRows.length)}
        fold
        testId="detail-locked-fold"
      >
        <dl className="dl" data-testid="detail-locked">
          {keyedRows}
        </dl>
        <div className="lvl-3" style={{ marginTop: '6px' }} data-testid="detail-keyed-measured">
          {keyedMeasuredNote(extra)}
        </div>
        <div className="lvl-3">
          {SURFACE_TERMS.lockedFeature} · <Link href="/nastavenia#zamknute">viac</Link>
        </div>
      </DetailGroup>

      <details className="tech">
        <summary>{SURFACE_TERMS.technicalDetail}</summary>
        <div className="body">
          <table>
            <tbody>
              <tr>
                <td>Číslo produktu</td>
                <td>
                  <b>{row.productId}</b>
                </td>
              </tr>
              <tr>
                <td>Posledné načítanie</td>
                <td>
                  <b>{formatDateTimeSk(row.fetchedAt)}</b>
                </td>
              </tr>
              <tr>
                <td>Detail kusu načítaný</td>
                <td>
                  <b>{extra === undefined ? DASH : formatDateTimeSk(extra.at)}</b>
                </td>
              </tr>
              <tr>
                <td>Variantov v detaile</td>
                <td>
                  <b>{extra === undefined ? DASH : extra.variants.length}</b>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>

      <div className="row" style={{ marginTop: '10px' }}>
        <Link
          className="btn primary"
          href={newDiscountHref({ kind: 'products', productIds: [row.productId] })}
          data-testid="discount-single"
        >
          Zlacniť tento produkt
        </Link>
      </div>
    </aside>
  );
}

export default ProductDetailPanel;
