'use client';

/**
 * Aura Zľavy — PREHĽAD (V7, D152/D153/D166; prepis obrazovky, 3. 9. 2026).
 *
 * Samuel preklikol V6 a povedal „nie je to čitateľné a prehľadné". Na otázku
 * čo presne označil VŠETKY ŠTYRI ponúknuté príčiny — nízky kontrast, priveľa
 * vecí na obrazovke, splývajúce panely, malé písmo a slabé čísla. Táto
 * obrazovka odpovedá na druhú z nich: **mala šesť vecí pod sebou a má mať
 * štyri.**
 *
 * ŠTYRI SEKCIE, V TOMTO PORADÍ (D152)
 * ───────────────────────────────────
 *
 *   0. HLAVIČKA — `PageHeader`. Nie je sekcia, je to jeden riadok nadpisu
 *      s vetou pod ním; rovnaký zvislý rytmus ako Zľavy, Produkty a Nastavenia.
 *   0a. TICHÝ ODKAZ, KEĎ NIEČO HORÍ — jeden riadok, a len vtedy, keď verdikt
 *      nie je `ok`. Dôvod, prečo tu nie je celý stavový pás, je nižšie.
 *   0b. PREPÍNAČ OKNA KARIET A TABUĽKY — 30/60/90/180/360 dní
 *      (`SoldWindowSwitch`, D155). Stojí NAD radom, pretože platí pre karty aj
 *      pre tabuľku pod grafom. Nie je sekcia — je to ovládanie dvoch z nich.
 *   1. KPI RIADOK — tri karty: produktov v katalógu, v zľave, predané na sklad
 *      (`KpiRow`, D148/D152/D154).
 *   2. DENNÝ PREDAJ — čiarový graf v TROCH krivkách: v zľave · bez zľavy ·
 *      nevieme, či bola (`DiscountSplitChart`, D156–D158). Tretia krivka nie je
 *      ozdoba: appka vie o zľave len to, čo sama zapísala, takže bez nej by
 *      každý deň pred jej prvým zápisom spadol do „bez zľavy" a graf by tvrdil,
 *      čo nevie.
 *   3. TABUĽKA PRODUKTOV — deväť stĺpcov, filtre, stránkovač
 *      (`ProductsTable`, D159–D163). Riadok NIE JE klikateľný: Prehľad je na
 *      čítanie, detail a výber zostávajú v Produktoch.
 *   4. ZĽAVY — čo beží, čo sa ponúka, najbližší plánovaný zápis a posledný
 *      výsledok zápisu (`CampaignsSection`). Toto je „bežiace zľavy" z D152;
 *      krátky zoznam, nie zoznam zliav — `liveCampaigns()` drží tri riadky.
 *
 * ČO ODIŠLO NA NASTAVENIA A PREČO TO NIE JE SCHOVANIE (D152)
 * ─────────────────────────────────────────────────────────
 * Stavový pás (`StatusBand` + celá sekcia „Stav" pod jeho rozklikom) a prekážky
 * (`BlockersSection`) sa z tejto obrazovky NEKRESLIA. Kreslí ich
 * `settings/AppStateSection.tsx` na podstránke „Čo smie robiť a koľko toho
 * smie" pod kotvou `#stav` — teda tam, kde už žijú rozsah, poistky zápisu
 * a rozpočty, ktorých sa prekážky týkajú.
 *
 * Hlavička `StatusBand` má na to dva body, ktoré sa NESMÚ pokaziť, a oba tento
 * presun rešpektuje:
 *
 *  · **„Prekážky nikdy neidú pod rozklik."** Na Nastaveniach stoja MIMO
 *    rozkliku, presne ako predtým stáli mimo neho tu. Nie sú v `<details>`.
 *  · **„Pás sa sám otvorí, keď nie je zeleno."** Otvára sa ďalej — `open` je
 *    vlastnosť komponentu, nie obrazovky, a na Nastaveniach platí rovnako.
 *
 * Čo sa presunom STRATILO, je jeden klik: bez kľúča na zápis je nezelený
 * verdikt BEŽNÝ stav (R4) a celý zvyšok tejto obrazovky je vtedy dekorácia —
 * grafy sú pravdivé a appka pritom nezapíše ani jednu zľavu. Preto tu zostáva
 * `TroubleLine`: JEDEN tichý riadok s farbou, značkou a slovom verdiktu a
 * s odkazom na stav. Keď je zeleno, nekreslí sa vôbec, takže „priveľa vecí na
 * obrazovke" sa ním nevracia. Verdikt sa nikde neformuluje druhýkrát —
 * `overviewVerdict()` je jeho jediný zdroj a riadok z neho berie hotové slovo.
 *
 * ČO SA NEKRESLÍ A NEZMAZALO SA
 * ─────────────────────────────
 * `SalesSection` (tri čísla + krivka + denná tržba eshopu) a `TopFlopSection`
 * (top 10 / flop 10 podľa kusov) sú pod D152 piata a šiesta sekcia, takže sa
 * odtiaľto nekreslia. Súbory ani ich testy sa NEZMAZALI — je to ten istý
 * postup, aký zvolila V7 pri `SalesSection` v kroku 2/4: keď sa pre sekciu
 * nájde domov, je to presun, nie nový výpočet. Rebríček navyše dnes vie
 * tabuľka: triedenie podľa „Predané N d" zostupne je top, vzostupne flop
 * (D162). Kto ktorúkoľvek z nich vracia SEM, musí najprv povedať, ktorá zo
 * štyroch sekcií D152 odchádza.
 *
 * DVE OKNÁ, DVA PREPÍNAČE, ŽIADNE PREKRÝVANIE (D155)
 * ─────────────────────────────────────────────────
 *  · **okno KARIET a TABUĽKY** — 30/60/90/180/360 (`soldWindow`). Stĺpce
 *    „Predané N d" a „predané/sklad" sú TÁ ISTÁ veličina, akú nesie tretia
 *    karta, takže tabuľka je jej rozpis a vlastné okno držať NESMIE. Stav je
 *    preto JEDEN a leží tu.
 *  · **okno GRAFU** — 7/30/90 (`windowDays`), teda `WINDOW_DAYS_ALLOWED`
 *    čítacích endpointov. Graf odpovedá na inú otázku: denný priebeh, nie súhrn
 *    okna.
 *
 * Ani jeden neťahá dáta toho druhého. Predvolené je v oboch 30 dní.
 *
 * NIČ SA NEOBNOVUJE SAMO (kontrakt, bod 4). Načítanie je registrované
 * v spoločnom mechanizme `layout/refresh.ts`: zbehne pri otvorení obrazovky a
 * potom až po stlačení Obnoviť v stavovom pruhu. Zmena okna je RUČNÁ akcia
 * človeka, takže načítanie po nej je tá istá kategória ako stlačenie Obnoviť.
 *
 * NA SHOP Z TEJTO OBRAZOVKY NEODÍDE ANI JEDEN REQUEST (K8). Všetky endpointy
 * sú čisto čítacie nad lokálnou databázou; do eshopu zapisuje výhradne
 * executor.
 *
 * Vlastník: V7, krok 4/4 (rozvrh štyroch sekcií a presun stavu na Nastavenia).
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';

import CampaignsSection from '@/components/dashboard/CampaignsSection';
import DiscountSplitChart from '@/components/dashboard/DiscountSplitChart';
import KpiRow from '@/components/dashboard/KpiRow';
import ProductsTable from '@/components/dashboard/ProductsTable';
import SoldWindowSwitch from '@/components/dashboard/SoldWindowSwitch';
import WindowSwitch from '@/components/dashboard/WindowSwitch';
import styles from '@/components/dashboard/overview.module.css';
import { LoadingState } from '@/components/states';
import { PageHeader } from '@/components/ui';
import { SigMark } from '@/components/ui/StatusMark';
import { hrefForAnchor } from '@/components/settings/sub-pages';
import {
  getCampaigns,
  getInsights,
  getQueue,
  type CampaignRow,
  type InsightRow,
  type QueueSnapshot,
} from '@/components/dashboard/api';
import {
  getCatalogSync,
  getStatus,
  type CatalogSyncView,
  type StatusView,
} from '@/components/dashboard/status-api';
import { sigClass } from '@/components/dashboard/live-status-model';
import {
  DEFAULT_OVERVIEW_WINDOW,
  lastWriteResult,
  liveCampaigns,
  nextPlannedFire,
  queueProgress,
  type LastWrite,
  type LiveCampaign,
  type NextFire,
  type OverviewWindow,
} from '@/components/dashboard/overview-model';
import { overviewVerdict, type Verdict } from '@/components/dashboard/overview-verdict';
import { previousWindowAnchor } from '@/components/dashboard/kpi-row-model';
import {
  getOwnDiscountShare,
  getSoldPerStock,
  type OwnDiscountShareView,
  type SoldPerStockView,
} from '@/components/dashboard/kpi-api';
import {
  DEFAULT_SOLD_WINDOW,
  type SoldWindow,
} from '@/components/dashboard/sold-window';
import {
  getTimelineWindow,
  getWriteActivity,
  type TimelineWindowView,
  type WriteActivityDayView,
} from '@/components/dashboard/window-api';
import {
  getSalesDaily,
  type SalesDailyView,
} from '@/components/dashboard/sales-daily-api';
import { useRefreshable } from '@/components/layout/refresh';
import { todayHere } from '@/lib/ui/vocabulary';

/**
 * Kam vedie tichý odkaz. Cesta sa TU neskladá z literálu — `hrefForAnchor()`
 * preloží kotvu na podstránku, ktorá ju naozaj má (`sub-pages.ts`). Dôvod je
 * zapísaná pasca: mesiac sa v rozcestníku Nastavení ponúkal odkaz do prázdna
 * po zmazanom `SignOut.tsx`, lebo cestu si napísal volajúci sám.
 */
export const OVERVIEW_TROUBLE_PATH = hrefForAnchor('#stav');

/** Slovo odkazu. Jedna formulácia — je to zároveň menovka kotvy v Nastaveniach. */
export const OVERVIEW_TROUBLE_LINK = 'Stav a prekážky';

/**
 * Hlavička obrazovky. Vlastný komponent preto, aby ju vetva kostry a vetva
 * s dátami nemohli napísať dvomi rôznymi vetami — nadpis, ktorý sa pri
 * načítaní zmení, je ten istý druh tichého rozchodu ako dve kópie čísla.
 */
function OverviewHeader() {
  return (
    <PageHeader
      title="Prehľad"
      description="Čo sa predáva, čo leží a čo robia zľavy, ktoré appka zapísala."
      testId="overview-header"
    />
  );
}

/**
 * JEDEN TICHÝ RIADOK, KEĎ NIEČO HORÍ (D152).
 *
 * Nekreslí sa, kým je verdikt `ok` — inak by na najlepšom mieste obrazovky
 * stál prázdny pás, čo Samuel pri V6b výslovne odmietol (D136).
 *
 * Nesie tri kanály v JEDNOM uzle (farba triedy tónu, značka `<svg>`, slovo
 * verdiktu) a jednu vetu detailu, ktorú už poskladal `overviewVerdict()`.
 * Vlastnú vetu si NESKLADÁ: druhá formulácia toho istého stavu by sa raz
 * rozišla s tou, ktorú kreslí sekcia stavu v Nastaveniach.
 *
 * Exportovaný je zámerne: obe vetvy (zeleno → nič, inak → riadok) sa dajú
 * dokázať len tak, že sa vykreslia. Postaviť pre druhú vetvu celú odpoveď
 * `/api/status` by znamenalo merať parser namiesto rozhodnutia.
 */
export function TroubleLine({ verdict }: { verdict: Verdict }) {
  if (verdict.kind === 'ok') return null;

  return (
    <p className={styles.trouble} data-testid="overview-trouble" data-verdict={verdict.kind}>
      <span className={sigClass(verdict.tone)} data-testid="trouble-verdict">
        <SigMark variant={verdict.tone} />
        {verdict.word}
      </span>
      <span className="lvl-3" data-testid="trouble-detail">
        {verdict.detail}
      </span>
      <Link className={styles.troubleLink} href={OVERVIEW_TROUBLE_PATH}>
        {OVERVIEW_TROUBLE_LINK}
      </Link>
    </p>
  );
}

interface OverviewData {
  queue: QueueSnapshot | null;
  campaigns: CampaignRow[] | null;
  insights: InsightRow[] | null;
  /**
   * Živý stav appky. Obrazovka z neho kreslí JEDINÝ prvok — tichý riadok
   * verdiktu (`TroubleLine`). Celé prekážky aj sekcia „Stav" žijú od V7
   * v Nastaveniach; tu zostal verdikt, pretože bez neho by sa človek o
   * chýbajúcom kľúči na prvej strane nedozvedel vôbec.
   */
  status: StatusView | null;
  catalog: CatalogSyncView | null;
}

/** Dáta, ktoré závisia od okna prepínača GRAFU. Menia sa spolu, tak sa aj ťahajú. */
interface WindowData {
  /**
   * Denný predaj po dňoch pre graf troch kriviek (D156). `null` = odpoveď sa
   * nedala prečítať; graf z toho nakreslí chybovú vetu, NIE nuly.
   */
  daily: SalesDailyView | null;
  /**
   * Okná vlastných zliav. Graf z nich rozhoduje, do ktorej krivky deň patrí —
   * a `status` v riadku hovorí, či sa kampaň naozaj zapísala (D156).
   */
  timeline: TimelineWindowView | null;
  /** Zapísané dni — z nich je posledný výsledok zápisu v sekcii Zľavy. */
  activity: WriteActivityDayView[] | null;
}

/**
 * Dáta TROCH KPI KARIET (D152). Vlastné okno, vlastné načítanie.
 *
 * Prečo nie spolu s `WindowData`: prepínač kariet a tabuľky je INÝ prepínač než
 * prepínač grafu (D155) a jeho okná sú iné (30/60/90/180/360 proti 7/30/90).
 * Jeden objekt pre oboje by znamenal, že prepnutie okna kariet znovu ťahá graf
 * — teda niečo, o čo človek vôbec nežiadal.
 */
interface KpiData {
  /** Katalóg aj počet vlastných zliav z JEDNEJ odpovede (podiel a menovateľ). */
  catalog: OwnDiscountShareView | null;
  /** Pomer „predané na sklad" za vybrané okno. */
  soldPerStock: SoldPerStockView | null;
  /**
   * To isté za PREDCHÁDZAJÚCE okno rovnakej dĺžky. Je to jediné „oproti čomu"
   * pre pilulku smeru: bez neho by musela navždy hovoriť „zmenu nevieme".
   * Nie je to nový endpoint — je to tá istá route s iným `?anchor=`.
   */
  soldPerStockBefore: SoldPerStockView | null;
}

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [windowData, setWindowData] = useState<WindowData | null>(null);
  const [windowDays, setWindowDays] = useState<OverviewWindow>(DEFAULT_OVERVIEW_WINDOW);
  /*
   * JEDEN stav okna pre KARTY A TABUĽKU (D155). Tabuľka je rozpis tretej karty,
   * takže si vlastné okno DRŽAŤ NESMIE — dva stavy nad jednou veličinou by na
   * obrazovke postavili dve čísla za dve rôzne obdobia. Kto pridáva tabuľku,
   * berie si `soldWindow` odtiaľto; `test/unit/prehlad-kpi-okno.spec.ts` padne,
   * keď si niekto v `components/dashboard/` otvorí druhý stav okna predaja.
   */
  const [soldWindow, setSoldWindow] = useState<SoldWindow>(DEFAULT_SOLD_WINDOW);
  const [kpiData, setKpiData] = useState<KpiData | null>(null);

  const load = useCallback(async () => {
    const [queue, campaigns, insights, status, catalog] = await Promise.all([
      getQueue(),
      getCampaigns(),
      getInsights(),
      getStatus(),
      getCatalogSync(),
    ]);
    setData({ queue, campaigns, insights, status, catalog });
  }, []);

  /*
   * Okno grafu sa ťahá zvlášť. Nie preto, aby to bolo pekné: keď človek prepne
   * 30 → 90, menia sa len tieto tri odpovede a načítať pri tom aj stav appky by
   * znamenalo, že sa mu pod rukami prekreslí verdikt — teda niečo, o čo vôbec
   * nežiadal.
   */
  const loadWindow = useCallback(async (days: OverviewWindow) => {
    const [daily, timeline, activity] = await Promise.all([
      getSalesDaily(days),
      getTimelineWindow(days),
      getWriteActivity(days),
    ]);
    setWindowData({ daily, timeline, activity });
  }, []);

  /**
   * Dáta troch KPI kariet. Vlastné načítanie, lebo majú vlastný prepínač
   * (D155) — a prepnutie okna kariet nemá dôvod znovu ťahať graf.
   *
   * Kotva predchádzajúceho okna sa počíta TU, z „dneška" v logickom pásme, a
   * nie z odpovede aktuálneho okna — inak by predchádzajúce okno muselo čakať
   * na to aktuálne a zmena prepínača by mala dve kolá namiesto jedného. Cena
   * je, že sa kotva môže na hrane polnoci s dňom servera rozísť o deň; preto
   * model porovnanie pripustí len vtedy, keď okná na seba naozaj naväzujú
   * (`windowsAdjoin()`), a inak povie „zmenu nevieme".
   */
  const loadKpi = useCallback(async (days: SoldWindow) => {
    const before = previousWindowAnchor(todayHere(), days);
    const [catalog, soldPerStock, soldPerStockBefore] = await Promise.all([
      getOwnDiscountShare(),
      getSoldPerStock(days),
      before === null ? Promise.resolve(null) : getSoldPerStock(days, before),
    ]);
    setKpiData({ catalog, soldPerStock, soldPerStockBefore });
  }, []);

  // Registrácia do spoločného obnovovania. Hook si zámerne NESLEDUJE identitu
  // `load` — sledovať ju by znamenalo načítanie pri každom prekreslení, teda
  // automatické obnovovanie zadnými dverami.
  useRefreshable(load);
  useRefreshable(useCallback(() => loadWindow(windowDays), [loadWindow, windowDays]));
  useRefreshable(useCallback(() => loadKpi(soldWindow), [loadKpi, soldWindow]));

  /** Kliknutie do prepínača grafu: nové okno a hneď aj jeho dáta. */
  const changeWindow = useCallback(
    (days: OverviewWindow) => {
      setWindowDays(days);
      void loadWindow(days);
    },
    [loadWindow],
  );

  /**
   * Kliknutie do prepínača kariet. Prekresľuje karty AJ tabuľku (D155), preto
   * je stav jeden a leží tu — nie v `KpiRow` a nie v tabuľke.
   */
  const changeSoldWindow = useCallback(
    (days: SoldWindow) => {
      setSoldWindow(days);
      void loadKpi(days);
    },
    [loadKpi],
  );

  /*
   * Prvé načítanie: kostra v tvare hotovej obrazovky, aby sa rozloženie pod
   * rukami nepreskladalo. Žiadne čísla — kým sa nič nevie, nič sa netvrdí.
   * TRI dlaždice sú rad KPI, tri bloky sú graf, tabuľka a zľavy.
   *
   * Hlavička sa kreslí AJ tu — je to jediná časť obrazovky, ktorá na žiadnu
   * odpoveď nečaká, a keby dobehla až s dátami, nadpis by pod rukami poskočil.
   */
  if (data === null) {
    return (
      <div className={styles.page} aria-busy="true">
        <OverviewHeader />
        <LoadingState tiles={3} blocks={3} label="Načítavam Prehľad…" />
      </div>
    );
  }

  const today = todayHere();
  const snapshot = data.queue;
  const rows = data.campaigns;

  const progress = queueProgress({ snapshot, campaigns: rows, today });
  const live: LiveCampaign[] | null = rows === null ? null : liveCampaigns(rows, today);

  /*
   * Verdikt — jediný zdroj vety o tom, či niečo stojí v ceste. Ten istý model
   * kreslí stav aj v Nastaveniach; obrazovka si z neho berie hotové slovo.
   */
  const verdict = overviewVerdict({
    status: data.status,
    sync: data.catalog,
    heartbeat: snapshot === null ? null : snapshot.heartbeat,
    progress,
  });

  /*
   * Okno sa ešte nenačítalo → `undefined`, teda „nežiadali sme". Sekcie potom
   * nekreslia ani sumu, ani priznanie — priznávať medzeru v dátach, ktoré sa
   * práve ťahajú, by bolo tvrdenie o eshope namiesto tvrdenia o načítaní.
   */
  const timeline = windowData === null ? undefined : windowData.timeline;
  const nextFire: NextFire | null | undefined =
    timeline === undefined
      ? undefined
      : timeline === null
        ? null
        : nextPlannedFire(timeline.campaigns, new Date().toISOString());
  const lastWrite: LastWrite | null | undefined =
    windowData === null
      ? undefined
      : windowData.activity === null
        ? null
        : lastWriteResult(windowData.activity);

  return (
    /*
     * `data-sold-window` je JEDINÝ zdroj okna kariet a tabuľky na povrchu
     * obrazovky (D155). Nie je to ozdoba pre test: tabuľka má z čoho overiť, že
     * kreslí to isté obdobie, aké nesie tretia karta — a keby si otvorila
     * vlastný stav, dva atribúty by si na jednom strome odporovali.
     */
    <div className={styles.page} data-testid="overview" data-sold-window={soldWindow}>
      <OverviewHeader />

      {/* Jeden riadok, a len keď niečo horí. Celý stav je v Nastaveniach. */}
      <TroubleLine verdict={verdict} />

      {/*
       * PREPÍNAČ OKNA KARIET A TABUĽKY stojí NAD radom (D155), pretože platí
       * pre karty aj pre tabuľku pod grafom — prepínač pod číslami by sa čítal
       * ako ovládanie toho, čo je pod ním. Prepínač GRAFU je druhý a patrí do
       * hlavičky karty grafu; tento ho neovláda.
       */}
      <SoldWindowSwitch value={soldWindow} onChange={changeSoldWindow} />

      {/*
       * 1. KPI RIADOK. Tri karty (D152) čítajú DVE odpovede a obe sú čisto
       * čítacie (K8):
       *  · `catalog` je `catalog-distribution?by=own-discount` — počet riadkov
       *    zrkadla A počet vlastných zliav z JEDNEJ odpovede, takže podiel a
       *    jeho menovateľ nemôžu byť z dvoch rôznych okamihov.
       *  · `soldPerStock` / `soldPerStockBefore` je pomer za okno prepínača a
       *    za predchádzajúce okno rovnakej dĺžky (`?anchor=`).
       *
       * `undefined` sa tu NESMIE zliať s `null`: prvé je „nežiadali sme"
       * (a vtedy sa medzera v dátach NEPRIZNÁVA), druhé je „odpoveď sa nedala
       * prečítať" a to karta povedať MUSÍ. Preto explicitné `=== null`.
       */}
      <KpiRow
        windowDays={soldWindow}
        catalog={kpiData === null ? undefined : kpiData.catalog}
        soldPerStock={kpiData === null ? undefined : kpiData.soldPerStock}
        soldPerStockBefore={kpiData === null ? undefined : kpiData.soldPerStockBefore}
      />

      {/*
       * 2. HLAVNÝ GRAF (D156–D158). `undefined` je „nežiadali sme" (kostra),
       * `null` je „odpoveď sa nedala prečítať" (chybová veta). Preto výslovné
       * `=== null`.
       */}
      <DiscountSplitChart
        daily={windowData === null ? undefined : windowData.daily}
        campaigns={timeline === undefined || timeline === null ? [] : timeline.campaigns}
        windowDays={windowDays}
        switcher={<WindowSwitch value={windowDays} onChange={changeWindow} />}
      />

      {/*
       * 3. TABUĽKA PRODUKTOV (D159–D163). Stojí HNEĎ POD GRAFOM zámerne: graf
       * má ~300 px (D158) práve preto, aby pod ním bolo vidieť prvé riadky.
       *
       * Okno dostáva PROPOM z jediného stavu okna kariet (D155). Kto sem podá
       * `windowDays` (okno GRAFU), postaví na jednu obrazovku dve čísla za dve
       * rôzne obdobia a obe budú vyzerať rovnako dôveryhodne.
       *
       * Dáta si ťahá SAMA a je to zámer: filter, poradie a strana sú jej
       * vlastný stav, takže prelistovanie nemá dôvod znovu ťahať graf. Obe jej
       * volania sú čisto čítacie (K8).
       */}
      <ProductsTable soldWindow={soldWindow} />

      {/* 4. BEŽIACE ZĽAVY — čo beží, čo sa ponúka a či sa naozaj zapisuje. */}
      <CampaignsSection
        campaigns={live}
        insights={data.insights}
        nextFire={nextFire}
        lastWrite={lastWrite}
      />
    </div>
  );
}

export default Overview;
