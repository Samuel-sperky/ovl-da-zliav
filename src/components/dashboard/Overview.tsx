'use client';

/**
 * Aura Zľavy — PREHĽAD (V9, architektúra §1 TAB 1, mockupy `design/v3/prehlad*.html`).
 *
 * Štyri sekcie zhora, piata neexistuje a rozklik tu nie je ani jeden:
 *
 *   1. FRONTA          — dominanta, číslo `3 420 / 8 000` v 64 px,
 *   2. ČAKÁ NA VÁS     — návrhy ako riadky + primárne tlačidlo `Nová zľava`,
 *   3. TRŽBY           — tri čísla a čiarový graf s trendovou čiarou,
 *   4. ZĽAVY NAŽIVO    — tri riadky, bez tabuľky a bez akcií okrem prekliku.
 *
 * TVRDÁ HRANICA: Prehľad NIKDY neukazuje tabuľku produktov. Prehľad odpovedá
 * na „čo sa práve deje a ako sa darí"; „ktoré konkrétne kusy" patrí do
 * Produktov. Jediná zámerná duplicita je počet ležiakov — v Prehľade ako
 * návrh, v Produktoch ako výsledok toho istého filtra.
 *
 * Dáta sa ťahajú zo štyroch čítacích endpointov naraz. `Promise.all` je tu
 * v poriadku a nemá NIČ spoločné so zákazom paralelných ZÁPISOV — na shop
 * z tejto obrazovky neodíde ani jeden request; zapisuje výhradne executor.
 *
 * Vlastník: V9.
 */
import { useCallback, useEffect, useState } from 'react';

import AttentionSection from '@/components/dashboard/AttentionSection';
import LiveDiscountsSection from '@/components/dashboard/LiveDiscountsSection';
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
}

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);

  const load = useCallback(async () => {
    const [queue, campaigns, sales, insights] = await Promise.all([
      getQueue(),
      getCampaigns(),
      getSales(),
      getInsights(),
    ]);
    setData({ queue, campaigns, sales, insights });
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

  return (
    <div className={styles.page} data-testid="overview">
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
      <AttentionSection insights={data.insights} />
      <SalesSection sales={data.sales} />
      <LiveDiscountsSection campaigns={live} />
    </div>
  );
}

export default Overview;
