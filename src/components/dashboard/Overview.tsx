'use client';

/**
 * Aura Zľavy — PREHĽAD (V9, prestavaný V4 podľa D113, 28. 8. 2026).
 *
 * OTÁZKA, NA KTORÚ TÁTO OBRAZOVKA ODPOVEDÁ, SA ZMENILA. Do 28. 8. 2026 to bolo
 * „je všetko v poriadku?" a podľa toho bola postavená: dominantou bolo číslo
 * fronty v 44 px, stav appky bral vrchnú tretinu obrazovky aj vtedy, keď bolo
 * zeleno, a predaj bol štvrtá sekcia pod ohybom. D113 to obracia: prvá strana
 * odpovedá na **„čo sa predáva, čo leží, čo robia moje zľavy"**.
 *
 * Sekcia „Stav" sa NEPREPÍSALA ani nezmizla — zúžila sa do jedného riadku
 * (`StatusBand`) a celá zostáva pod jeho rozklikom. Dôvod je v hlavičke toho
 * komponentu; podstatné je, že sa neobjavila druhá formulácia toho istého stavu.
 *
 * PORADIE ZHORA (P5 — štyri sekcie sú STROP, nie cieľ)
 * ───────────────────────────────────────────────────
 *
 *   0. STAVOVÝ PÁS — jeden riadok: verdikt, kľúč, rozpočet, fronta. Rozklik
 *      nesie pôvodnú sekciu „Stav" so všetkými jej kontrolami a tlačidlami.
 *      Otvorí sa SÁM, keď verdikt nie je `ok`.
 *   0b. PREKÁŽKY — `BlockersSection`, hneď pod pásom a NIKDY pod rozklikom.
 *      Bez kľúča na zápis je celý zvyšok obrazovky dekorácia: grafy sú
 *      pravdivé a appka pritom nezapíše ani jednu zľavu.
 *   1. PREDAJ — denná krivka kusov s podfarbenými oknami zliav a priznanými
 *      medzerami, plus denná tržba CELÉHO ESHOPU (D117). `SalesSection`.
 *   2. ČO SA PREDÁVA — top 10 a flop 10 podľa kusov. `TopFlopSection`.
 *   3. ZĽAVY — čo beží, čo sa ponúka, najbližší plánovaný zápis a posledný
 *      výsledok zápisu. `CampaignsSection`.
 *
 * Pás ani prekážky nie sú sekcie: pás je jeden riadok a prekážky sa v pokoji
 * nekreslia vôbec. Sekcie sú teda tri, v najhoršom prípade štyri.
 *
 * OKNO 7 / 30 / 90 JE JEDNO PRE CELÚ OBRAZOVKU (predvolene 30). Graf, rebríček
 * aj tržba sa musia pýtať na to isté obdobie — tri čísla za tri rôzne obdobia
 * vedľa seba by vyzerali rovnako dôveryhodne ako tri čísla za jedno.
 *
 * NIČ SA NEOBNOVUJE SAMO (kontrakt, bod 4). Načítanie je registrované
 * v spoločnom mechanizme `layout/refresh.ts`: zbehne pri otvorení obrazovky a
 * potom až po stlačení Obnoviť v stavovom pruhu. Zmena okna je RUČNÁ akcia
 * človeka, takže načítanie po nej je tá istá kategória ako stlačenie Obnoviť —
 * nie automatické obnovovanie zadnými dverami.
 *
 * NA SHOP Z TEJTO OBRAZOVKY NEODÍDE ANI JEDEN REQUEST (K8). Všetkých desať
 * endpointov je čisto čítacích nad lokálnou databázou; do eshopu zapisuje
 * výhradne executor. `Promise.all` tu nemá NIČ spoločné so zákazom paralelných
 * ZÁPISOV.
 *
 * Vlastník: V9; prestavba V4.
 */
import { useCallback, useState } from 'react';

import BlockersSection from '@/components/dashboard/BlockersSection';
import CampaignsSection from '@/components/dashboard/CampaignsSection';
import SalesSection from '@/components/dashboard/SalesSection';
import StatusBand from '@/components/dashboard/StatusBand';
import StatusSection from '@/components/dashboard/StatusSection';
import TopFlopSection from '@/components/dashboard/TopFlopSection';
import WindowSwitch from '@/components/dashboard/WindowSwitch';
import styles from '@/components/dashboard/overview.module.css';
import {
  getCampaigns,
  getInsights,
  getQueue,
  getSales,
  type CampaignRow,
  type InsightRow,
  type QueueSnapshot,
  type SalesSnapshot,
} from '@/components/dashboard/api';
import {
  getCatalogSync,
  getEnrichState,
  getStatus,
  type CatalogSyncView,
  type StatusView,
} from '@/components/dashboard/status-api';
import { unreadableSentence } from '@/components/dashboard/live-status-model';
import {
  DEFAULT_OVERVIEW_WINDOW,
  calmNumbers,
  lastWriteResult,
  liveCampaigns,
  nextPlannedFire,
  queueProgress,
  type LastWrite,
  type LiveCampaign,
  type NextFire,
  type OverviewWindow,
} from '@/components/dashboard/overview-model';
import { overviewChecks, overviewVerdict } from '@/components/dashboard/overview-verdict';
import {
  getRevenueDaily,
  getTimelineWindow,
  getTopFlop,
  getWriteActivity,
  type RevenueDailyView,
  type TimelineWindowView,
  type TopFlopView,
  type WriteActivityDayView,
} from '@/components/dashboard/window-api';
import { useRefreshable } from '@/components/layout/refresh';
import type { EnrichStatePayload } from '@/lib/catalog/enrich-view';
import { todayHere } from '@/lib/ui/vocabulary';

interface OverviewData {
  queue: QueueSnapshot | null;
  campaigns: CampaignRow[] | null;
  sales: SalesSnapshot | null;
  insights: InsightRow[] | null;
  status: StatusView | null;
  catalog: CatalogSyncView | null;
  /**
   * Stav DÁVKY obohacovania (`GET /api/catalog/enrich`). `null` = odpoveď sa
   * nedala prečítať; sekcia z toho nakreslí priznanie, nikdy nulu.
   */
  enrich: EnrichStatePayload | null;
}

/** Dáta, ktoré závisia od okna prepínača. Menia sa spolu, tak sa aj ťahajú. */
interface WindowData {
  timeline: TimelineWindowView | null;
  revenue: RevenueDailyView | null;
  rank: TopFlopView | null;
  activity: WriteActivityDayView[] | null;
}

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [windowData, setWindowData] = useState<WindowData | null>(null);
  const [windowDays, setWindowDays] = useState<OverviewWindow>(DEFAULT_OVERVIEW_WINDOW);

  const load = useCallback(async () => {
    const [queue, campaigns, sales, insights, status, catalog, enrich] = await Promise.all([
      getQueue(),
      getCampaigns(),
      getSales(),
      getInsights(),
      getStatus(),
      getCatalogSync(),
      /*
       * Dávka obohacovania. Je to ĎALŠIE volanie na obrazovku a je tu vedome:
       * do 31. 8. 2026 `catalog_enrich_state` nečítal nikto, takže dávka mohla
       * stáť tri týždne s odmietnutou adresou a Prehľad o tom mlčal. Cena je
       * tri dotazy po indexe, žiadne volanie eshopu (K8).
       */
      getEnrichState(),
    ]);
    setData({ queue, campaigns, sales, insights, status, catalog, enrich });
  }, []);

  /*
   * Okno sa ťahá zvlášť. Nie preto, aby to bolo pekné: keď človek prepne
   * 30 → 90, mení sa len tieto štyri odpovede a načítať pri tom aj stav appky
   * by znamenalo, že sa mu pod rukami prekreslí verdikt a prípadne aj tlačidlá
   * v rozkliku — teda niečo, o čo vôbec nežiadal.
   */
  const loadWindow = useCallback(async (days: OverviewWindow) => {
    const [timeline, revenue, rank, activity] = await Promise.all([
      getTimelineWindow(days),
      getRevenueDaily(days),
      getTopFlop(days),
      getWriteActivity(days),
    ]);
    setWindowData({ timeline, revenue, rank, activity });
  }, []);

  // Registrácia do spoločného obnovovania. Hook si zámerne NESLEDUJE identitu
  // `load` — sledovať ju by znamenalo načítanie pri každom prekreslení, teda
  // automatické obnovovanie zadnými dverami.
  useRefreshable(load);
  useRefreshable(useCallback(() => loadWindow(windowDays), [loadWindow, windowDays]));

  /** Kliknutie do prepínača: nové okno a hneď aj jeho dáta. */
  const changeWindow = useCallback(
    (days: OverviewWindow) => {
      setWindowDays(days);
      void loadWindow(days);
    },
    [loadWindow],
  );

  // Prvé načítanie: kostra v rozmeroch hotovej obrazovky, aby sa rozloženie
  // pod rukami nepreskladalo. Žiadne čísla — kým sa nič nevie, nič sa netvrdí.
  if (data === null) {
    return (
      <div className={styles.page} aria-busy="true">
        <div className="sec ovl-skeleton" style={{ minHeight: '44px' }} />
        <div className="sec ovl-skeleton" style={{ minHeight: '212px' }} />
        <div className="sec ovl-skeleton" style={{ minHeight: '190px' }} />
        <div className="sec ovl-skeleton" style={{ minHeight: '160px' }} />
      </div>
    );
  }

  const today = todayHere();
  const snapshot = data.queue;
  const rows = data.campaigns;

  const progress = queueProgress({ snapshot, campaigns: rows, today });
  const live: LiveCampaign[] | null = rows === null ? null : liveCampaigns(rows, today);
  // Nečitateľný zoznam zliav je `null`, nie prázdne pole: `calmNumbers([])`
  // vráti samé nuly a „0 zliav beží" je tvrdenie o ostrom eshope, nie priznaná
  // medzera (P7, kontrakt UI bod 5). Sekcia z `null` nakreslí pomlčky.
  const calm = rows === null ? null : calmNumbers(rows, today);
  const heartbeat = snapshot === null ? null : snapshot.heartbeat;

  const verdictInput = {
    status: data.status,
    sync: data.catalog,
    heartbeat,
    progress,
  };
  const verdict = overviewVerdict(verdictInput);

  const budget =
    snapshot === null || snapshot.budget === null
      ? null
      : {
          spent: snapshot.budget.spent,
          budget: snapshot.budget.budget,
          remaining: snapshot.budget.remaining,
        };

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
    <div className={styles.page} data-testid="overview">
      <StatusBand
        verdict={verdict}
        keyPresent={data.status === null ? null : data.status.apiKey.present}
        budget={budget === null ? null : { spent: budget.spent, budget: budget.budget }}
        pending={snapshot === null ? null : snapshot.queue.pending}
      >
        <StatusSection
          verdict={verdict}
          checks={overviewChecks(verdictInput)}
          progress={progress}
          budget={budget}
          calm={calm}
          enrich={data.enrich}
          gap={
            data.status === null
              ? 'Stav appky sa nepodarilo prečítať. Čísla preto nedopĺňame.'
              : unreadableSentence(data.status.unreadable)
          }
          onChanged={() => void load()}
        />
      </StatusBand>

      {/* Prekážky MIMO rozkliku — dôvod je v hlavičke `StatusBand`. */}
      <BlockersSection blockers={data.status === null ? null : data.status.blockers} />

      <SalesSection
        sales={data.sales}
        windowDays={windowDays}
        switcher={<WindowSwitch value={windowDays} onChange={changeWindow} />}
        discountWindows={timeline === undefined || timeline === null ? [] : timeline.campaigns}
        revenue={windowData === null ? undefined : windowData.revenue}
      />

      <TopFlopSection
        data={windowData === null ? undefined : windowData.rank}
        windowDays={windowDays}
      />

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
