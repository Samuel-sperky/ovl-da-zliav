'use client';

/**
 * Aura Zľavy — PREHĽAD (V9, architektúra §1 TAB 1, kontrakt UI 13. 8. 2026).
 *
 * OTÁZKA, NA KTORÚ TÁTO OBRAZOVKA ODPOVEDÁ: „je všetko v poriadku?" Nie „aké
 * mám čísla". Podľa toho je vybraná dominanta aj poradie sekcií.
 *
 * ŠTYRI SEKCIE, ZHORA PODĽA NALIEHAVOSTI (P5):
 *
 *   1. STAV — dominanta. Verdikt jednou vetou v 44 px, pod ním fronta v 22 px
 *      a riadok kontrol, ktoré nenesie stavový pruh. `StatusSection`.
 *   2. PREČO SA NEZAPISUJE — prekážky zo `/api/status`, všetky tri úrovne.
 *      Kreslí sa LEN vtedy, keď niečo zastavuje alebo brzdí; inak mlčí a celou
 *      odpoveďou je zelená značka v stavovom pruhu (kontrakt, bod 3).
 *   3. ZĽAVY — vľavo čo beží, vpravo čo sa ponúka. `CampaignsSection`.
 *   4. PREDAJ — čo sa predáva. `SalesSection`.
 *
 * Z pôvodných šiestich sekcií zmizli dve: „Živý stav" (opakoval štyri veci zo
 * stavového pruhu) a „Čaká na vás" (splynula so „Zľavami"). Prázdny stav
 * „Prvá zľava" už nie je sekcia — je to jedna veta a jedno tlačidlo vnútri
 * dominanty (bod 11).
 *
 * TVRDÁ HRANICA: Prehľad NIKDY neukazuje tabuľku produktov. Prehľad odpovedá
 * na „čo sa práve deje a ako sa darí"; „ktoré konkrétne kusy" patrí do
 * Produktov. Jediná zámerná duplicita je počet ležiakov — v Prehľade ako
 * návrh, v Produktoch ako výsledok toho istého filtra.
 *
 * NIČ SA NEOBNOVUJE SAMO (kontrakt, bod 4). Do 18. 8. tu bol `setInterval`
 * každých 60 s — čísla sa prepisovali pod rukami človeku, ktorý sa práve
 * rozhodoval, či zastaviť zápis do ostrého eshopu. Načítanie je preto
 * registrované v spoločnom mechanizme `layout/refresh.ts`: zbehne pri otvorení
 * obrazovky a potom až po stlačení tlačidla Obnoviť v stavovom pruhu. Vlastné
 * tlačidlo si obrazovka NEKRESLÍ.
 *
 * Dáta sa ťahajú zo šiestich ČÍTACÍCH endpointov naraz. `Promise.all` je tu
 * v poriadku a nemá NIČ spoločné so zákazom paralelných ZÁPISOV — na shop
 * z tejto obrazovky neodíde ani jeden request; zapisuje výhradne executor.
 * Dva z nich (`/api/status`, `/api/catalog/sync`) sú lacné a zámerne sa čítajú
 * TU, nie v každej sekcii zvlášť: inak by jedna obrazovka volala ten istý
 * endpoint trikrát a čísla v susedných sekciách by sa mohli rozísť o minútu.
 *
 * Vlastník: V9.
 */
import { useCallback, useState } from 'react';

import BlockersSection from '@/components/dashboard/BlockersSection';
import CampaignsSection from '@/components/dashboard/CampaignsSection';
import SalesSection from '@/components/dashboard/SalesSection';
import StatusSection from '@/components/dashboard/StatusSection';
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
  getStatus,
  type CatalogSyncView,
  type StatusView,
} from '@/components/dashboard/status-api';
import { unreadableSentence } from '@/components/dashboard/live-status-model';
import {
  calmNumbers,
  liveCampaigns,
  queueProgress,
  type LiveCampaign,
} from '@/components/dashboard/overview-model';
import { overviewChecks, overviewVerdict } from '@/components/dashboard/overview-verdict';
import { useRefreshable } from '@/components/layout/refresh';
import { todayHere } from '@/lib/ui/vocabulary';

interface OverviewData {
  queue: QueueSnapshot | null;
  campaigns: CampaignRow[] | null;
  sales: SalesSnapshot | null;
  insights: InsightRow[] | null;
  status: StatusView | null;
  catalog: CatalogSyncView | null;
}

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);

  const load = useCallback(async () => {
    const [queue, campaigns, sales, insights, status, catalog] = await Promise.all([
      getQueue(),
      getCampaigns(),
      getSales(),
      getInsights(),
      getStatus(),
      getCatalogSync(),
    ]);
    setData({ queue, campaigns, sales, insights, status, catalog });
  }, []);

  // Registrácia do spoločného obnovovania. Hook si zámerne NESLEDUJE identitu
  // `load` — sledovať ju by znamenalo načítanie pri každom prekreslení, teda
  // automatické obnovovanie zadnými dverami.
  useRefreshable(load);

  // Prvé načítanie: kostra v rozmeroch hotovej obrazovky, aby sa rozloženie
  // pod rukami nepreskladalo. Žiadne čísla — kým sa nič nevie, nič sa netvrdí.
  if (data === null) {
    return (
      <div className={styles.page} aria-busy="true">
        <div className="sec ovl-skeleton" style={{ minHeight: '212px' }} />
        <div className="sec ovl-skeleton" style={{ minHeight: '160px' }} />
        <div className="sec ovl-skeleton" style={{ minHeight: '190px' }} />
      </div>
    );
  }

  const today = todayHere();
  const snapshot = data.queue;
  const rows = data.campaigns;

  const progress = queueProgress({ snapshot, campaigns: rows, today });
  const live: LiveCampaign[] | null = rows === null ? null : liveCampaigns(rows, today);
  const calm = calmNumbers(rows ?? [], today);
  const heartbeat = snapshot === null ? null : snapshot.heartbeat;

  const verdictInput = {
    status: data.status,
    sync: data.catalog,
    heartbeat,
    progress,
  };

  return (
    <div className={styles.page} data-testid="overview">
      <StatusSection
        verdict={overviewVerdict(verdictInput)}
        checks={overviewChecks(verdictInput)}
        progress={progress}
        budget={
          snapshot === null || snapshot.budget === null
            ? null
            : {
                spent: snapshot.budget.spent,
                budget: snapshot.budget.budget,
                remaining: snapshot.budget.remaining,
              }
        }
        calm={calm}
        gap={
          data.status === null
            ? 'Stav appky sa nepodarilo prečítať. Čísla preto nedopĺňame.'
            : unreadableSentence(data.status.unreadable)
        }
        onChanged={() => void load()}
      />

      <BlockersSection blockers={data.status === null ? null : data.status.blockers} />
      <CampaignsSection campaigns={live} insights={data.insights} />
      <SalesSection sales={data.sales} />
    </div>
  );
}

export default Overview;
