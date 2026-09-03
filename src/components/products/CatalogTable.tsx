'use client';

/**
 * Aura Zľavy — tabuľka katalógu (V6b; predloha `design/v3/produkty.html`).
 *
 * Toto je DOMINANTA tabu Produkty (P1). Nie nadpis, nie filtre — tabuľka.
 * Skroluje výhradne ona, vo vlastnom ráme primitíva `Table` (P4); stránka pod
 * ňou stojí, takže hlavička aj lišta výberu zostávajú na mieste.
 *
 * OD V6b JE TO `Table` Z `components/ui`, NIE VLASTNÁ TABUĽKA (D137, D139)
 * ───────────────────────────────────────────────────────────────────────
 * Rám, posuvná plocha, kompaktná hustota (~36 px), PRILEPENÁ hlavička,
 * PRILEPENÉ prvé stĺpce, tri stavy bunky a pätka so stránkovaním sú
 * v `ui/tables.module.css` a `ui/Table.tsx`. Zmizli s tým tri veci a je to
 * zámer, nie strata:
 *
 *  · **`.tbl-frame` / `.tbl-scroll` / `.tbl`** — obrazovka na ne prestala
 *    siahať. Tie triedy ďalej žijú v `globals.css`, lebo ich kreslia História,
 *    Zľavy a Nastavenia; zmazať sa smelo len to, čo bolo VÝHRADNE tejto
 *    obrazovky (`.catalog-split > .tbl-frame` a dve pravidlá pre `tr.open`).
 *  · **Vlastná kópia `pageTokens()` a `PageJump`** — nový domov je
 *    `ui/Pagination.tsx`, ktorý to isté pravidlo aj skok na stranu už má.
 *    Dve kópie jedného výpočtu sú presne to, čo sa v tomto repe rozišlo pri
 *    strope zápisov.
 *  · **`<colgroup>`** — šírky nesie hlavička (`width` na `<th>`), pevné
 *    rozloženie je v `catalog-table.module.css`. Mriežka zostáva PEVNÁ, len
 *    ju už nedeklaruje druhá značka navyše.
 *
 * Čo NEZMIZLO ani o pixel: pomlčky s dôvodom, znak `≥`, dve rôzne vety o zľave,
 * značka „bez predaja" len s dôkazom a referencia bez skrátenia. Redizajn ich
 * smie spraviť krajšími, nie tichšími (kontrakt V6 §4).
 *
 * Stĺpce a čo v nich NIE JE
 * ─────────────────────────
 * `Referencia · Názov · Cena · Zľava v shope · Zľava teraz · Predané 30 d ·
 * Predané 90 d · Predané / sklad · Posledný predaj · Marža · Sklad`. Osem
 * z nich je JEDNOTNÁ SADA (D124, `lib/ui/product-columns.ts`) a idú v jej
 * záväznom poradí; tri stĺpce mimo sady (druhé okno predajnosti, posledný
 * predaj a zľava podľa vlastných zápisov appky) stoja pri svojom súrodencovi.
 * Číslo produktu hlavný stĺpec NIE JE (P3) — žije v „Technickom detaile"
 * bočného panela a v `title` názvu.
 *
 * REFERENCIA JE PRVÝ STĹPEC, NIE PREDPONA NÁZVU (D122, 1. 9. 2026)
 * ────────────────────────────────────────────────────────────────
 * Do 1. 9. 2026 bola referencia zlepená s názvom (`referencia · názov`, D116)
 * a neobohatený riadok začínal pomlčkou: „— · Náramok z chirurgickej…". To je
 * najhoršie z oboch — miesto zaberie, nič nepovie a názov, podľa ktorého sa
 * kus poznáva, sa o tú predponu skráti. Podľa referencie sa pritom produkt
 * hľadá v sklade aj v administrácii eshopu, takže dostala VLASTNÝ prvý stĺpec:
 *
 *  · **Nikdy sa neskracuje.** Je to identifikátor; orezaný identifikátor je iný
 *    identifikátor. Stĺpec preto nemá `truncate` — keby prišla referencia
 *    širšia než stĺpec, radšej pretečie (a je to vidieť), než by z nej ticho
 *    zostala polovica.
 *  · **Tri stavy ako každá iná bunka KPI** (I11): hodnota · „produkt nie je
 *    obohatený" · „KPI riadku sa ešte nenačítali". Text sa TU nevyrába —
 *    prichádza z jednotnej sady (`product-columns.ts`), aby tabuľka a bočný
 *    panel nemohli o tej istej medzere povedať dve rôzne veci. Pomlčka teda
 *    NIKDY netvrdí, že produkt referenciu v shope nemá; to hovorí len meraný
 *    `shop_has_none`.
 *  · **`productLabel()` sa v tabuľke NEPOUŽÍVA.** Zostáva pre miesta, kde je na
 *    produkt jeden riadok textu (audit, položky kampane, nadpis panela); rozdiel
 *    medzi vetou a stĺpcami je v hlavičke `lib/ui/product-label.ts`. Tabuľka
 *    berie z toho modulu `productNameCell()` — teda len názov a `#id` ako
 *    posledné východisko.
 *
 * Do 31. 8. 2026 tu boli štyri stĺpce s vysvetlením, že na viac appka nemá
 * dáta. To vysvetlenie prestalo platiť s migráciou 0014 a obohacovaním
 * `getFull` (D118): sklad, marža, dodávateľ aj stav zľavy v shope už V ZRKADLE
 * SÚ — ale len pre obohatené produkty, a tých je zlomok. Preto sa stĺpce
 * kreslia a **prázdna bunka je priznanie, nie šum**: pomlčka nesie v `title`
 * dôvod („produkt nie je obohatený", „shop o tom nič nevie", „z okna chýbajú
 * dni") a bunka to hlási aj strojovo (`data-value="unknown"` z primitíva,
 * `data-unknown` na samotnom texte).
 *
 * DVA STĹPCE O ZĽAVE SÚ ZÁMER (I11)
 * ─────────────────────────────────
 * `Zľava teraz` je VŽDY podľa vlastného zápisu appky a v jednotnej sade
 * ZÁMERNE NIE JE. `Zľava v shope` je jednotný stĺpec `discountNow` a je to to,
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
 * Čo klik urobí, hovorí `title` hlavičky SLOVAMI; šípka sama je hádanka a smer
 * pre čítačku nesie `aria-sort`, ktorý kreslí primitívum.
 *
 * POČET ZHÔD JE DOLNÁ HRANICA, KÝM JE ZRKADLO NEÚPLNÉ
 * ───────────────────────────────────────────────────
 * `total` je počet v zrkadle katalógu, nie v eshope. Kým zrkadlo nie je celé,
 * pätka ho označí `≈` a tlmene (P7) — presné číslo by bolo tvrdenie, ktoré
 * appka nemá kryté. Vetu o tom, čo `≈` znamená, aj pravidlo „nula sa
 * neoznačuje" drží `Pagination`.
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
 * dostane hotový `emptyState` od obrazovky, ktorá stav katalógu pozná. Appka
 * je dnes bez `shop_write` kľúča, takže prázdna tabuľka a pomlčky sú BEŽNÝ
 * stav, nie výnimka (kontrakt V6 R4) — a tak má aj vyzerať.
 *
 * HUSTOTA PRE 41 348 RIADKOV (D10, 19. 8. 2026; D137, 2. 9. 2026)
 * ──────────────────────────────────────────────────────────────
 * Zmerané na reálnej databáze: 41 220 produktov, priemerný názov 64 znakov,
 * NAJDLHŠÍ 117 znakov, ceny 0,00 – 1 758,46 €.
 *
 * 1. **Mriežka stĺpcov je pevná** (`table-layout: fixed` + šírky na `<th>`).
 *    S automatickým rozložením meria prehliadač VŠETKY názvy na stránke
 *    a najdlhší z nich rozhodne, kde začne stĺpec Cena — čísla sa teda pri
 *    každom preklikaní stránky posunú inam a oko ich hľadá odznova. Pri 825
 *    stránkach je to 825 rôznych mriežok. Pevná mriežka to zastaví: čísla
 *    stoja na tom istom mieste na každej stránke a na každom filtri. Šírky sú
 *    ODMERANÉ na najširšom obsahu, aký sa v stĺpci môže objaviť, plus 24 px
 *    odsadenia bunky a 14 px na šípku triedenia (`PREDANÉ 360 D` je 92 px
 *    textu, `1 758,46 €` 59 px, `ZĽAVA TERAZ` 78 px). Šípka sa počíta aj tam,
 *    kde práve nie je: keď sa poradie prehodí, stĺpec sa NESMIE zúžiť.
 * 2. **Názov je JEDEN riadok s výpustkou; celý je v `title` aj v bočnom
 *    paneli.** Zalamovanie sa zamietlo: rôzne vysoké riadky rozbijú zvislý
 *    rytmus, podľa ktorého sa stĺpec Cena skenuje, a stránku z 50 riadkov
 *    predĺžia z ≈ 1 600 px na až 2 600 px. Pevné dvojriadkové bunky by rytmus
 *    udržali a zmestili by každý názov, ale platili by +50 % výšky na KAŽDOM
 *    riadku za chvost, ktorý je pri týchto názvoch ozdoba — rozlišovacia časť
 *    („Prevliekací strieborný náhrdelník 925 …") stojí na začiatku.
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
 *    (Tie tri čísla sú z čias PIATICH stĺpcov. Odvtedy pribudlo šesť KPI
 *    stĺpcov (D114) a referencia (D122), takže platí ich POMER, nie hodnota:
 *    kto ich chce citovať, nech premeria dnešnú mriežku.)
 *
 *    Výpustka teda ZÁMER JE — chvost sa dá prečítať v `title` aj v paneli
 *    vedľa a mriežka drží. Pri OTVORENOM paneli to však už nie je „oreže sa
 *    chvost najdlhších", ale „z každého mena zostane začiatok": 886 px sa
 *    medzi 400 px panel a skenovateľnú tabuľku rozdeliť nedá. Nie je to
 *    vlastnosť tabuľky — rozhoduje o tom `flex` rámu (`catalog-table.module.css`)
 *    a šírka pásu filtrov. Kto bude tie čísla meniť, nech premeria toto, nie
 *    hlavičku.
 * 3. **Virtualizácia sa nepridáva.** V DOM nikdy nie je 41 348 riadkov —
 *    server stránkuje po 50/100 (strop je od V4 strop KPI, nie strop route).
 *    Chýbal spôsob, ako sa na riadok 30 000 DOSTAŤ, nie ako ho vykresliť.
 *    Preto skok na stránku a poradie stĺpcov, nie knižnica navyše.
 * 4. **Prilepené sú tri prvé stĺpce, nie dva** (D137). Kontrakt menuje
 *    referenciu a názov; pred nimi stojí ešte zaškrtávacie pole a prilepiť
 *    stĺpec bez toho, čo je pred ním, sa nedá (odsadenie sa počíta zo šírok
 *    predchádzajúcich — pozri `stickyOffsets()`). Políčko k referencii aj tak
 *    patrí: kto vyberá kusy, potrebuje vidieť, ktorý kus práve zaškrtol.
 * 5. **Prepínač hustoty NIE JE.** Kontrakt V6 §5 ho z rozsahu vylúčil —
 *    jedna hustota, žiadne nastavenie.
 *
 * Vlastník: V6b, obrazovka Produkty (tabuľka).
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import type {
  CatalogRowView,
  ProductKpiPageView,
  ProductKpiRowView,
} from '@/components/products/catalog-api';
import { PRODUCT_DETAIL_ID } from '@/components/products/ProductDetailPanel';
import { CodeLine } from '@/components/products/ProductFacts';
import { codeLine, EMPTY_EXTRAS, type ExtrasStore } from '@/components/products/product-extras';
import type { ProductReason } from '@/components/products/catalog-status';
import type { CatalogSort, PerPage } from '@/components/products/catalog-filter';
import { DEFAULT_CATALOG_FILTER, PER_PAGE_CHOICES } from '@/components/products/catalog-filter';
import type { KpiCellView } from '@/components/products/sold-coverage';
import {
  KPI_DASH,
  kpiLastSaleCell,
  kpiNoSaleMark,
  kpiPriceWithVatCell,
  kpiUnitsCell,
} from '@/components/products/sold-coverage';
import styles from '@/components/products/catalog-table.module.css';
import {
  FlagMark,
  Pagination,
  Table,
  type TableCell,
  type TableColumn,
  type TableSort,
} from '@/components/ui';
import { productNameCell } from '@/lib/ui/product-label';
import type {
  ProductCellView,
  ProductColumn,
  ProductColumnId,
  ProductRowValues,
} from '@/lib/ui/product-columns';
import { productColumn, productMarginCells, valueOrGap } from '@/lib/ui/product-columns';

/* ═══════════════════════════ 1. Mriežka stĺpcov ═══════════════════════════ */

/**
 * Pevné šírky (bod 1 v hlavičke modulu). Názov v zozname NIE JE: je to jediný
 * pružný stĺpec a dostáva celý zvyšok mriežky. Zúžiť ostatné, aby dostal viac,
 * sa NEDÁ bez skrátenia ich nadpisov.
 *
 * Prvé tri šírky navyše nesú prilepenie: `stickyOffsets()` z nich počíta
 * vodorovné odsadenie, takže stĺpec bez šírky by sa NEPRILEPIL.
 */
const WIDTH = {
  select: '34px',
  reference: '120px',
  price: '100px',
  discountNow: '112px',
  discountOwn: '104px',
  soldWindow: '104px',
  soldWindowLong: '104px',
  soldPerStock: '112px',
  lastSale: '124px',
  margin: '132px',
  stock: '92px',
} as const;

/** Koľko PRVÝCH stĺpcov je prilepených (D137 + bod 4 v hlavičke). */
const STICKY_COLUMNS = 3;

/** Pod týmto počtom strán stránkovač vypisuje všetky čísla — skok netreba. */
const JUMP_FROM_PAGES = 8;

/**
 * Koľko čakacích riadkov sa nakreslí, kým nie je ani jeden skutočný. Nie je to
 * `perPage`: päťdesiat prúžkov je ozdoba, nie informácia, a strana sa aj tak
 * vykreslí naraz.
 */
const WAIT_ROWS = 8;

/* ───────────────── Jednotná sada stĺpcov (D124) na tejto tabuľke ──────────── */

/**
 * PRODUKTY POUŽÍVAJÚ JEDNOTNÚ SADU, NIE VLASTNÚ KÓPIU (D124, K3; 1. 9. 2026).
 *
 * Do tejto opravy si najväčšia z troch tabuliek produktov písala hlavičky aj
 * bunky sama, kým výber do zľavy a položky kampane už boli na
 * `lib/ui/product-columns.ts`. Bol to presne ten tvar zlyhania, ktorý má repo
 * zapísaný ako pascu: kto zmení vetu `PRODUCT_GAP_REASON` alebo meno stĺpca,
 * zmení dve tabuľky z troch a nikto to nezachytí. Odteraz sú mená, vety `title`
 * aj bunky VŠETKÝCH ôsmich jednotných stĺpcov z definície.
 *
 * PORADIE JE PODPOSTUPNOSŤ, NIE ZOZNAM
 * ────────────────────────────────────
 * `PRODUCT_COLUMN_IDS` je záväzné poradie sady. Produkty majú navyše tri
 * stĺpce, ktoré sada nepozná (druhé okno predajnosti, posledný predaj a zľava
 * podľa VLASTNÝCH zápisov appky) — tie stoja pri svojom súrodencovi, takže
 * jednotné stĺpce v hlavičke idú v poradí sady, len prekladané. Stráži to
 * `produkty-jednotne-stlpce.spec.ts`, ktorý číta `data-col` z hlavičky.
 *
 * `ean13` SA TU VYNECHÁVA — A JE TO D124, NIE VÝNIMKA Z NEHO (V7, 3. 9. 2026)
 * ──────────────────────────────────────────────────────────────────────────
 * Sada má od D159 deviaty stĺpec `ean13`. Táto tabuľka ho ako STĹPEC nemá,
 * pretože EAN v nej už stojí — tichým druhým riadkom v bunke názvu
 * (`CodeLine`), a berie ho z INEJ cesty než KPI riadok:
 * z `POST /api/catalog/details`, teda spoza kľúča, kde má TRI druhy prázdna
 * („doťahuje sa", „vyžaduje kľúč", „shop ho nevedie"). Druhý stĺpec s tým
 * istým menom z druhého zdroja by na jednej obrazovke postavil dve odpovede
 * na tú istú otázku — presne to, čo D124 zakazuje. Pravidlo znie „kde sa
 * stĺpec nehodí, VYNECHÁ sa", a toto je ten prípad.
 *
 * Kto stráži to, čo tá výnimka vyňala: `prehlad-tabulka.spec.ts` meria, že
 * tabuľka Prehľadu kreslí VŠETKÝCH DEVÄŤ stĺpcov v poradí D159 — stĺpec teda
 * nezostal bez jedinej tabuľky, ktorá ho naozaj kreslí.
 *
 * ČLENSTVO V SADE NESIE `data-col`, MENOVKU BUNKY `data-l`
 * ───────────────────────────────────────────────────────
 * `colId` dostane VÝHRADNE stĺpec sady, takže z vykresleného `<thead>` sa dá
 * prečítať, či je sada celá a v poradí. Tri stĺpce mimo sady majú len
 * `cardLabel` (`data-l`) — presne ako „Pásmo" v sprievodcovi novej zľavy
 * a „Zapísané" v položkách kampane. Prvá podoba primitíva vypisovala
 * `data-col` z KĽÚČA stĺpca, teda na každý; členstvo v sade sa tým prestalo
 * dať zmerať a s ním padla jediná poistka proti rozídeniu troch tabuliek.
 *
 * DVA STĹPCE O ZĽAVE MAJÚ ODTERAZ DVE RÔZNE MENÁ
 * ──────────────────────────────────────────────
 * `Zľava v shope` je jednotný stĺpec `discountNow` — čo o produkte povedal SHOP
 * pri obohatení. `Zľava teraz` je stĺpec TEJTO tabuľky a hovorí o vlastných
 * zápisoch appky; v jednotnej sade zámerne NIE JE. Do 1. 9. 2026 sa jednotný
 * stĺpec volal tiež „Zľava teraz", takže dve tabuľky mali pod jedným menom
 * opačný zdroj.
 */
const UNIFIED_IDS: readonly ProductColumnId[] = [
  'reference',
  'name',
  'price',
  'discountNow',
  'soldWindow',
  'soldPerStock',
  'stock',
  'margin',
];

type UnifiedColumns = Readonly<Record<ProductColumnId, ProductColumn>>;

/** Jednotné stĺpce pre túto tabuľku; okno predajnosti pomenúva odpoveď KPI. */
function unifiedColumns(soldWindowDays: number): UnifiedColumns {
  const out = {} as Record<ProductColumnId, ProductColumn>;
  for (const id of UNIFIED_IDS) out[id] = productColumn(id, { soldWindowDays });
  return out;
}

/**
 * Riadok tabuľky → hodnoty jednotných stĺpcov.
 *
 * Chýbajúce `k` (KPI riadku ešte nedobehli) sa NEDOPĹŇA prázdnymi poľami:
 * vynechané pole znamená v definícii `not_asked`, teda „ešte sa nenačítali",
 * kým vyplnené pole s `null` by znamenalo „pýtali sme sa a nevieme". Sú to dve
 * rôzne vety a zliať ich je presne to, čo I11 zakazuje.
 */
function rowValues(
  row: CatalogRowView,
  k: ProductKpiRowView | undefined,
): ProductRowValues {
  return {
    productId: row.productId,
    /* Názov a cena sú zo ZRKADLA katalógu, nie z obohatenia — appka ich pozná
       pre každý riadok, takže ich prázdno je „shop o tom nič nevie". */
    name: valueOrGap(row.name, 'shop_has_none'),
    price: valueOrGap(row.price, 'shop_has_none'),
    ...(k === undefined
      ? {}
      : {
          reference: k.reference,
          discountNow: {
            state: k.discount.state,
            percent: k.discount.activePercent,
            from: k.discount.from,
            to: k.discount.to,
            measuredAt: k.discount.measuredAt,
          },
          soldWindow: k.units30,
          soldPerStock: { ratio: k.soldPerStock, soldTotal: k.soldTotal, stock: k.stock },
          margin: { eur: k.margin, percent: k.marginPercent },
          stock: k.stock,
        }),
  };
}

/* ═══════════════════════════ 2. Bunky ════════════════════════════════════ */

/**
 * Text bunky KPI aj so strojovým priznaním.
 *
 * `ProductCellView` (jednotné stĺpce) a `KpiCellView` (`sold-coverage.ts`) majú
 * ten istý tvar — tabuľka kreslí obe rovnako, aby priznanie z jednotného
 * stĺpca vyzeralo presne ako priznanie zo stĺpca mimo sady.
 *
 * PREČO `data-unknown` NA TEXTE, KEĎ `Table` OZNAČUJE BUNKU
 * ────────────────────────────────────────────────────────
 * Primitívum hlási stav na `<td data-value>` a to je zdroj VZHĽADU (stlmenie).
 * Značka na samotnom texte je zdroj DÔKAZU pre testy, ktoré merajú JEDNU
 * hodnotu v riadku o dvanástich bunkách (`kpi-units30-…`), a tá cesta je
 * v tomto repe zapísaná ako jediná spoľahlivá: „trojstavovosť overuj na TELE
 * ODPOVEDE, nie na modeli". Obe značky vznikajú z toho istého objektu v tom
 * istom volaní, takže sa nemajú ako rozísť.
 *
 * `title` nesie VÝHRADNE bunka (`<td>`), nie tento text — dva vnorené `title`
 * by si v prehliadači brali kurzor jeden druhému.
 */
function KpiText({
  cell,
  testId,
}: {
  cell: KpiCellView | ProductCellView;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-unknown={cell.unknown ? 'true' : undefined}
      data-lower-bound={cell.lowerBound ? 'true' : undefined}
    >
      {cell.text}
    </span>
  );
}

/** Bunka jednotného stĺpca → bunka primitíva. Text ani značky sa neprepisujú. */
function kpiTableCell(
  cell: KpiCellView | ProductCellView,
  testId?: string,
): TableCell {
  return {
    content: <KpiText cell={cell} testId={testId} />,
    unknown: cell.unknown,
    lowerBound: cell.lowerBound,
    title: cell.title,
  };
}

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

/**
 * `key` stĺpca tabuľky → stĺpec triedenia. Primitívum vracia v `onSortChange`
 * kľúč stĺpca, nie svoje vlastné mená, takže preklad je presne jeden.
 */
const SORT_KEYS: Readonly<Record<string, SortColumn>> = {
  name: 'name',
  price: 'price',
  soldWindow: 'sold',
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
 * Platné poradie v jazyku primitíva. `undefined` = podľa žiadneho stĺpca
 * tabuľky sa netriedi (poradie z adresy, ktoré tabuľka nekreslí).
 */
export function tableSort(current: CatalogSort): TableSort | undefined {
  for (const key of Object.keys(SORT_KEYS)) {
    const column = SORT_KEYS[key];
    if (column === undefined) continue;
    const direction = sortDirection(column, current);
    if (direction === 'none') continue;
    return { key, dir: direction === 'ascending' ? 'asc' : 'desc' };
  }
  return undefined;
}

/* ═══════════════════════════ 3. Tabuľka ═══════════════════════════════════ */

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
   * v päťdesiatich ďalších nikto nenájde. Značka ide TROMA kanálmi — prúžok
   * v prvej (prilepenej) bunke, podfarbenie riadku a `aria-current` na tlačidle
   * názvu pre čítačku. Farba teda nikdy nie je jediný kanál.
   */
  openId?: number | null;
  onPage: (page: number) => void;
  onPerPage: (perPage: PerPage) => void;
  /** Platné poradie riadkov. Predvolene najmenej predané prvé (V4 §5 K4). */
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

/** Čo si tabuľka o riadku spočíta RAZ, aby to nerobilo dvanásť buniek zvlášť. */
interface PreparedRow {
  /** KPI riadku; `undefined` = odpoveď o TOMTO riadku nie je. */
  readonly k: ProductKpiRowView | undefined;
  readonly values: ProductRowValues;
  /** Bunka názvu (D122) — text, priznanie a dôvod medzery. */
  readonly name: ProductCellView;
  /** `#id` ako posledné východisko identifikácie (D116). */
  readonly technical: string;
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

  /* Jednotná sada (D124). Okno pomenúva odpoveď KPI, nie filter — nadpis sa
     nesmie rozísť s číslom pod ním. */
  const col = unifiedColumns(shortDays);

  /** Jeden riadok, spočítaný raz. */
  function prepare(row: CatalogRowView): PreparedRow {
    const k = kpi === null ? undefined : kpi.byId.get(row.productId);
    const values = rowValues(row, k);
    return {
      k,
      values,
      name: col.name.cell(values),
      technical: productNameCell({ productId: row.productId, name: row.name }).technical,
    };
  }

  const prepared = new Map<number, PreparedRow>(
    rows.map((row) => [row.productId, prepare(row)]),
  );

  /** Pripravený riadok. Riadok mimo `rows` sa do bunky dostať nemá; keby áno,
   *  spočíta sa načisto — odhad by bol tichá nepravda. */
  function view(row: CatalogRowView): PreparedRow {
    const found = prepared.get(row.productId);
    return found === undefined ? prepare(row) : found;
  }

  const isChecked = (row: CatalogRowView): boolean =>
    allMatchingSelected || selected.has(row.productId);

  const isOpen = (row: CatalogRowView): boolean =>
    openId !== null && openId === row.productId;

  /**
   * Nadpis stĺpca ako JEDNA veta v `title` (`<th>` má na `title` jedno miesto).
   *
   * Do V6b to boli dva `title` — jeden na hlavičke o význame stĺpca, druhý na
   * tlačidle o tom, čo urobí klik. V prilepenej hlavičke sa prekrývali a
   * kurzor si ich bral navzájom; text je preto zložený a poradie je záväzné:
   * najprv ČO stĺpec znamená, potom čo o poradí NEVIE, a nakoniec čo urobí klik.
   */
  function headTitle(base: string, column?: SortColumn, note?: string): string {
    const parts = [base];
    if (note !== undefined) parts.push(`Poradie: ${note}.`);
    if (column !== undefined && onSort !== undefined) {
      parts.push(`Klik zoradí: ${SORT_TITLES[nextSort(column, sort)].toLowerCase()}.`);
    }
    return parts.join(' ');
  }

  const onPageSelected = rows.filter((row) => selected.has(row.productId)).length;
  const pageAll = rows.length > 0 && onPageSelected === rows.length;
  const pageSome = onPageSelected > 0 && !pageAll;

  useEffect(() => {
    const node = headBox.current;
    if (node === null) return;
    node.indeterminate = pageSome && !allMatchingSelected;
  }, [pageSome, allMatchingSelected]);

  /** Meno stĺpca ako rozklik aj s príznakmi pod ním (D122 + „prečo neprejde"). */
  function nameCell(row: CatalogRowView): TableCell {
    const { k, name, technical } = view(row);
    const open = isOpen(row);
    const reason = rowReason?.(row) ?? null;
    /* ZNAČKA „BEZ PREDAJA" LEN S DÔKAZOM (D119). Neobohatený produkt NIE JE
       mŕtvy produkt — je to neznámy produkt, a na jeho riadku sa táto značka
       nesmie objaviť. Rozhoduje o tom `kpiNoSaleMark()`, ktorý bez `proof`
       vráti `null`; tabuľka si podmienku neskladá sama, aby sa nedala
       „doladiť" na povrchu. */
    const noSale = kpiNoSaleMark(k?.noSale);
    return {
      content: (
        <>
          {/* Tlačidlo názvu otvára panel detailu vedľa tabuľky, teda je to
              ROZKLIK — a rozklik musí povedať, či je otvorený a čo otvára.
              `aria-current` je tretí kanál väzby na panel: prúžok a
              podfarbenie hovoria oku, toto čítačke. */}
          <button
            type="button"
            className={styles.nameBtn}
            /* `title` nesie celé pomenovanie AJ `id`: technický identifikátor
               patrí do detailu (D116), ale musí byť dosiahnuteľný bez
               otvorenia panela. */
            title={name.unknown ? technical : `${name.text} · ${technical}`}
            aria-expanded={open}
            aria-controls={PRODUCT_DETAIL_ID}
            aria-current={open ? true : undefined}
            onClick={() => onOpenDetail(row.productId)}
            data-testid={`open-detail-${row.productId}`}
          >
            {/* Názov stojí SÁM (D122). Keď ho zrkadlo nemá, je tu `#id` —
                a je STLMENÉ triedou `lvl-3`, teda tým istým spôsobom, akým
                celá appka hovorí „potlačený kontext" (P1). Nie je to ozdoba:
                bez toho by priznanie „názov nevieme" vyzeralo ako meno. Bunka
                to hlási aj strojovo (`data-value="unknown"`), ale to je pre
                testy a čítačku — oku to musí povedať trieda. */}
            <span className={name.unknown ? 'lvl-3' : undefined}>{name.text}</span>
          </button>
          {/* EAN — tichý druhý riadok. Pri prázdne nesie SLOVO, nie len
              pomlčku: „ešte sa doťahuje", „vyžaduje kľúč" a „shop ho nevedie"
              sú tri rôzne veci a zliať ich by zahodilo jedinú informáciu,
              ktorá pri prázdnej bunke niekoho zaujíma. Kód v ňom po D122 UŽ
              NIE JE — má vlastný stĺpec (dôvod je v `product-extras.ts`). */}
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
          {/* I11 — riadok dohľadaný v eshope stojí na inej istote než riadok
              zo zrkadla: zrkadlo je posledný prechod synchronizácie, eshop je
              odpoveď z tejto chvíle. Bez tohto by na obrazovke stáli vedľa
              seba dva rôzne stupne istoty a vyzerali by rovnako. */}
          {row.origin === 'shop' ? (
            <div className="flag neutral" data-testid="row-origin-shop">
              <FlagMark tone="neutral" />
              dohľadané v eshope
            </div>
          ) : null}
        </>
      ),
      unknown: name.unknown,
      title: name.unknown ? name.title : null,
    };
  }

  const columns: readonly TableColumn<CatalogRowView>[] = [
    {
      key: 'select',
      width: WIDTH.select,
      header: (
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
      ),
      cell: (row) => ({
        content: (
          <>
            {/* Prúžok otvoreného riadku (K1). Je to ozdoba nad `aria-current`,
                preto `aria-hidden` — čítačka by inak povedala to isté dvakrát. */}
            {isOpen(row) ? <span className={styles.openMark} aria-hidden="true" /> : null}
            <input
              className="cb"
              type="checkbox"
              checked={isChecked(row)}
              aria-label={`Označiť ${view(row).name.text}`}
              onChange={(event) => onToggleRow(row.productId, event.target.checked)}
              data-testid={`select-row-${row.productId}`}
            />
          </>
        ),
      }),
    },
    /* D122 — referencia PRVÁ a bez triedenia: API triedi katalóg podľa mena,
       ceny a predaných, referenciu medzi nimi nemá (`CatalogSort`). Hlavička,
       ktorá vyzerá klikateľne a nič nerobí, je horšia než hlavička bez šípky.
       Meno aj veta `title` sú z jednotnej sady (D124) — tabuľka si ich nedrží
       vo vlastnej kópii. */
    {
      key: 'reference',
      colId: 'reference',
      cardLabel: col.reference.label,
      header: col.reference.label,
      headerTitle: col.reference.headTitle,
      width: WIDTH.reference,
      cell: (row) =>
        kpiTableCell(col.reference.cell(view(row).values), `row-reference-${row.productId}`),
    },
    {
      key: 'name',
      colId: 'name',
      /* Menovka BUNKY nie je meno stĺpca, a tu sa to rozchádza zámerne:
         stĺpec sa volá `Názov` (jednotná sada), ale v bunke stojí meno,
         kód EAN a príznaky riadku — teda celý PRODUKT. Menovka sa preto
         menuje tým, čo v bunke naozaj je, presne ako pred prechodom na
         primitívum. Druhé meno pre tú istú VELIČINU to nie je (D124). */
      cardLabel: 'Produkt',
      header: col.name.label,
      headerTitle: headTitle(col.name.headTitle, 'name'),
      sortable: true,
      truncate: true,
      cell: nameCell,
    },
    {
      /* Cena je zo zoznamového prechodu katalógu, teda BEZ obohatenia — pozná
         ju appka pre každý riadok. Cena s DPH z `getFull` je v `title`, nie na
         povrchu: dva peňažné stĺpce vedľa seba by sa čítali ako jedna cena
         a druhý by vyzeral ako chyba. */
      key: 'price',
      colId: 'price',
      cardLabel: col.price.label,
      header: col.price.label,
      headerTitle: headTitle(col.price.headTitle, 'price'),
      align: 'right',
      width: WIDTH.price,
      sortable: true,
      cell: (row) => ({
        ...kpiTableCell(col.price.cell(view(row).values)),
        title: `S DPH: ${kpiPriceWithVatCell(view(row).k).text}`,
      }),
    },
    {
      key: 'discountNow',
      colId: 'discountNow',
      cardLabel: col.discountNow.label,
      header: col.discountNow.label,
      headerTitle: col.discountNow.headTitle,
      align: 'right',
      width: WIDTH.discountNow,
      cell: (row) =>
        kpiTableCell(
          col.discountNow.cell(view(row).values),
          `kpi-shop-discount-${row.productId}`,
        ),
    },
    {
      /* MIMO SADY — vlastné zápisy appky. Sada takýto stĺpec nemá a mať nemôže:
         je to účtovníctvo appky, nie stav v shope. Pomlčka tu neznamená „shop
         nič nehlási", ale „appka si na tento produkt zľavu nezapísala" — je to
         MERANÝ fakt o vlastnej knihe, takže bunka ho ako priznanie nehlási. */
      key: 'discountOwn',
      cardLabel: 'Zľava teraz',
      header: 'Zľava teraz',
      headerTitle:
        'Podľa vlastných zápisov appky — nie je to stav v shope, ten hovorí stĺpec „Zľava v shope“.',
      align: 'right',
      width: WIDTH.discountOwn,
      cell: (row) => ({
        content: row.discountedNow ? 'v zľave' : KPI_DASH,
        title: row.discountedNow
          ? 'Appka si na tento produkt zapísala zľavu.'
          : 'Appka si na tento produkt zľavu nezapísala. O stave v shope to nehovorí nič.',
      }),
    },
    {
      key: 'soldWindow',
      colId: 'soldWindow',
      cardLabel: col.soldWindow.label,
      header: col.soldWindow.label,
      headerTitle: headTitle(
        col.soldWindow.headTitle,
        'sold',
        `počíta ho server zo súčtu za ${soldWindowDays} dní vrátane nedočítaných dní, ` +
          'kým číslo v stĺpci je len za dočítané dni',
      ),
      align: 'right',
      width: WIDTH.soldWindow,
      sortable: true,
      cell: (row) =>
        kpiTableCell(col.soldWindow.cell(view(row).values), `kpi-units30-${row.productId}`),
    },
    {
      /* MIMO SADY — druhé okno predajnosti. Sada pozná JEDNO okno
         (`soldWindow`); druhé je vlastnosť tejto obrazovky. */
      key: 'soldWindowLong',
      cardLabel: `Predané ${longDays} d`,
      header: `Predané ${longDays} d`,
      headerTitle: `Predané kusy za ${longDays} dní — len za dni, ktoré má appka naozaj stiahnuté.`,
      align: 'right',
      width: WIDTH.soldWindowLong,
      cell: (row) =>
        kpiTableCell(kpiUnitsCell(view(row).k?.units90), `kpi-units90-${row.productId}`),
    },
    {
      /* Stĺpec sa menuje tým, čo v ňom JE (`qty_in_orders / qty`). „Ako rýchlo
         sa predáva" to nie je a pomenovať ho tak sa nesmie: `getFull` dáva
         zásobu ako jednu momentku, nie priemer za obdobie (I11, stráži to
         `sales-insights.spec.ts`). */
      key: 'soldPerStock',
      colId: 'soldPerStock',
      cardLabel: col.soldPerStock.label,
      header: col.soldPerStock.label,
      headerTitle: col.soldPerStock.headTitle,
      align: 'right',
      width: WIDTH.soldPerStock,
      cell: (row) =>
        kpiTableCell(
          col.soldPerStock.cell(view(row).values),
          `kpi-sold-per-stock-${row.productId}`,
        ),
    },
    {
      /* MIMO SADY — posledný predaj podľa shopu. */
      key: 'lastSale',
      cardLabel: 'Posledný predaj',
      header: 'Posledný predaj',
      headerTitle: 'Posledný predaj podľa shopu, zmerané pri obohatení produktu.',
      align: 'right',
      width: WIDTH.lastSale,
      cell: (row) => kpiTableCell(kpiLastSaleCell(view(row).k), `kpi-last-sale-${row.productId}`),
    },
    {
      /* PORADIE SA 3. 9. 2026 OTOČILO (V7, D159): sklad stojí PRED maržou.
         Nie je to voľba tejto obrazovky — poradie je vlastnosť jednotnej sady
         (`PRODUCT_COLUMN_IDS`), takže sa zmenilo aj tu. Dve tabuľky s tou
         istou sadou v inom poradí sa nedajú porovnať o nič lepšie než dve
         tabuľky s inými menami (D124). */
      key: 'stock',
      colId: 'stock',
      cardLabel: col.stock.label,
      header: col.stock.label,
      headerTitle: col.stock.headTitle,
      align: 'right',
      width: WIDTH.stock,
      cell: (row) => kpiTableCell(col.stock.cell(view(row).values), `kpi-stock-${row.productId}`),
    },
    {
      /* Marža v EUR a v % sú DVE hodnoty z `getFull` a každá má vlastnú
         medzeru — preto dva texty v jednej bunke a nie jeden reťazec, ktorý by
         pri jednej chýbajúcej polovici musel zmiznúť celý. Stav a `title`
         bunky hovorí jednotný stĺpec: pomlčka za celý stĺpec je až vtedy, keď
         nevieme ani jednu polovicu. */
      key: 'margin',
      colId: 'margin',
      cardLabel: col.margin.label,
      header: col.margin.label,
      headerTitle: col.margin.headTitle,
      align: 'right',
      width: WIDTH.margin,
      cell: (row) => {
        const values = view(row).values;
        const { eur, percent } = productMarginCells(values.margin);
        const whole = col.margin.cell(values);
        return {
          content: (
            <>
              <KpiText cell={eur} testId={`kpi-margin-${row.productId}`} />
              {' · '}
              <KpiText cell={percent} testId={`kpi-margin-percent-${row.productId}`} />
            </>
          ),
          unknown: whole.unknown,
          lowerBound: whole.lowerBound,
          title: whole.title,
        };
      },
    },
  ];

  return (
    <Table<CatalogRowView>
      className={styles.catalog}
      testId="catalog-table"
      caption="Katalóg produktov"
      columns={columns}
      rows={rows}
      rowKey={(row) => String(row.productId)}
      /* Otvorený a označený je to isté dvakrát len zdanlivo: výber je „pôjde do
         zľavy", otvorenie je „toto teraz čítam vpravo". Preto sa značky
         skladajú, nie vylučujú — a podfarbenie výberu má prednosť. */
      rowMeta={(row) => ({ selected: isChecked(row) })}
      stickyColumns={STICKY_COLUMNS}
      sort={tableSort(sort)}
      onSortChange={
        onSort === undefined
          ? undefined
          : (key) => {
              const column = SORT_KEYS[key];
              if (column === undefined) return;
              onSort(nextSort(column, sort));
            }
      }
      /* Čakacie prúžky sú LEN kým nie je čo ukázať. Pri prelistovaní zostávajú
         na obrazovke staré riadky — zablikať prázdnom pri každom kliku je
         horšie než chvíľu ukazovať to, čo appka ešte drží. */
      loading={loading && rows.length === 0}
      loadingRows={WAIT_ROWS}
      empty={
        emptyState === undefined ? (
          <>Filtru nevyhovuje ani jeden z načítaných produktov.</>
        ) : (
          emptyState
        )
      }
      footer={
        <Pagination
          page={page}
          pageSize={perPage}
          total={total}
          totalIsLowerBound={totalIsLowerBound}
          onPageChange={onPage}
          onPageSizeChange={(size) => {
            /* Voľba z pätky sa vracia ako číslo; `PerPage` je uzavretá dvojica,
               takže sa hodnota NEPRETYPUJE, ale nájde. Neznáme číslo je omyl
               volajúceho a tabuľka na ňom nemení stránku. */
            const wanted = PER_PAGE_CHOICES.find((choice) => choice === size);
            if (wanted === undefined) return;
            onPerPage(wanted);
          }}
          pageSizeOptions={PER_PAGE_CHOICES}
          jumpFromPages={JUMP_FROM_PAGES}
          idPrefix="catalog"
        />
      }
    />
  );
}

export default CatalogTable;
