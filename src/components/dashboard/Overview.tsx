'use client';

/**
 * Aura Zľavy — PREHĽAD (V9, architektúra §1 TAB 1, mockupy `design/v3/prehlad*.html`,
 * kontrakt dokončenia C1–C5).
 *
 * PORADIE SEKCIÍ JE OBSAH, NIE ROZLOŽENIE. Zhora nadol podľa naliehavosti:
 *
 *   1. PREČO SA NEZAPISUJE — prekážky zo `/api/status`. Sekcia sa kreslí LEN
 *      vtedy, keď niečo naozaj zastavuje alebo brzdí; inak mlčí a dominanta
 *      zostáva prvá. Trvalý panel „všetko v poriadku" by nikto nečítal.
 *   2. ČO SA PRÁVE ZAPISUJE — dominanta (`QueueSection`), alebo prázdny stav,
 *      ktorý učí (`FirstDiscountSection`), keď v appke ešte nie je zľava.
 *   3. ŽIVÝ STAV — čo appka robí a čím je obmedzená (rozpočet, katalóg, kľúč,
 *      spojenie, rozsah). Odpoveď na „je všetko v poriadku?" do troch sekúnd.
 *   4. ČAKÁ NA VÁS — návrhy a to, čo si pýta pozornosť.
 *   5. TRŽBY — čo sa predáva.
 *   6. ZĽAVY NAŽIVO — tri riadky; pri nule zliav sa nekreslí vôbec, lebo o tom
 *      už hovorí sekcia 2 a druhé „Žiadna zľava" na jednej obrazovke je šum.
 *
 * TVRDÁ HRANICA: Prehľad NIKDY neukazuje tabuľku produktov. Prehľad odpovedá
 * na „čo sa práve deje a ako sa darí"; „ktoré konkrétne kusy" patrí do
 * Produktov. Jediná zámerná duplicita je počet ležiakov — v Prehľade ako
 * návrh, v Produktoch ako výsledok toho istého filtra.
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
import { useCallback, useEffect, useState } from 'react';

import AttentionSection from '@/components/dashboard/AttentionSection';
import BlockersSection from '@/components/dashboard/BlockersSection';
import FirstDiscountSection from '@/components/dashboard/FirstDiscountSection';
import LiveDiscountsSection from '@/components/dashboard/LiveDiscountsSection';
import LiveStatusSection from '@/components/dashboard/LiveStatusSection';
import QueueSection from '@/components/dashboard/QueueSection';
import SalesSection from '@/components/dashboard/SalesSection';
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
import { liveStatusView } from '@/components/dashboard/live-status-model';
import {
  calmNumbers,
  liveCampaigns,
  queueProgress,
  type LiveCampaign,
} from '@/components/dashboard/overview-model';
import { todayHere } from '@/lib/ui/vocabulary';

/** Ako často sa prístrojová doska obnovuje. Fronta sa hýbe v dávkach, nie v sekundách. */
const REFRESH_MS = 60_000;

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

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Prvé načítanie: kostra v rozmeroch hotovej obrazovky, aby sa rozloženie
  // pod rukami nepreskladalo. Žiadne čísla — kým sa nič nevie, nič sa netvrdí.
  if (data === null) {
    return (
      <div className={styles.page} aria-busy="true">
        <div className="sec ovl-skeleton" style={{ minHeight: '168px' }} />
        <div className="sec ovl-skeleton" style={{ minHeight: '150px' }} />
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

  const liveStatus = liveStatusView({
    status: data.status,
    sync: data.catalog,
    heartbeat: snapshot === null ? null : snapshot.heartbeat,
    now: new Date(),
  });

  // „Ešte nie je žiadna zľava" je jediný stav, v ktorom má dominanta učiť, čo
  // sa dá spraviť — vo zvyšných štyroch má ukázať, kde je fronta.
  //
  // `rows !== null` je tu podstatné: keď sa zoznam zliav NEPODARILO prečítať,
  // appka nesmie tvrdiť, že žiadna neexistuje. Vtedy zostáva pôvodná dominanta
  // a sekcia „Zľavy naživo" prizná, že sa nenačítala.
  const firstRun = progress.mode === 'empty' && rows !== null;

  return (
    <div className={styles.page} data-testid="overview">
      <BlockersSection blockers={data.status === null ? null : data.status.blockers} />

      {firstRun ? (
        <FirstDiscountSection />
      ) : (
        <QueueSection
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
          onChanged={() => void load()}
        />
      )}

      <LiveStatusSection view={liveStatus} />
      <AttentionSection insights={data.insights} />
      <SalesSection sales={data.sales} />
      {firstRun ? null : <LiveDiscountsSection campaigns={live} />}
    </div>
  );
}

export default Overview;
