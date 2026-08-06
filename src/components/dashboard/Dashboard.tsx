'use client';

/**
 * Aura Zľavy — KISS dashboard (plán 33 §3, sekcia C1).
 *
 * Presne päť blokov, nič viac:
 *   1. page-head: eyebrow „Riadenie zliav" (gold), titul, „+ Nová kampaň",
 *   2. 3 KPI karty — Aktívne zľavy n/10 · Vyžaduje zásah · TTL kľúča (oblúk G6),
 *   3. 1 graf — časová os kampaní (G1, komponent vlastní C2),
 *   4. riadok „Najbližšie spustenie" pod grafom,
 *   5. banner zásahu LEN keď n > 0 (needs_key a missed s ROVNAKOU váhou, D8/D33b).
 *
 * Dokumentačná karta „čo dashboard vie a nevie" je zrušená — jej obsah nesie
 * ⓘ tooltip pri KPI karte Aktívne zľavy (a Nastavenia). Neodklikané výsledky
 * (D17) zostávajú: sú to poistky, nie šum — vykreslia sa len keď existujú.
 *
 * I11: „Aktívne zľavy" sú počítané z VLASTNÝCH zápisov; karta to priznáva
 * vo footri aj v tooltipe. Dashboard nikdy netvrdí, že pozná stav shopu.
 *
 * Dáta: existujúce API (/api/key, /api/allowlist, /api/campaigns,
 * /api/notifications); agregáty sa počítajú klientsky — žiadny nový endpoint.
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import AlertsBanner from '@/components/dashboard/AlertsBanner';
import UnackedResults from '@/components/dashboard/UnackedResults';
import ErrorMessage from '@/components/ui/ErrorMessage';
import Eyebrow from '@/components/ui/Eyebrow';
import KpiCard from '@/components/ui/KpiCard';
import KeyTtlArc from '@/components/charts/KeyTtlArc';
import { formatDateSk, formatDateTimeSk } from '@/lib/ui/format';
import {
  getAllowlist,
  getCampaigns,
  getKey,
  getNotifications,
  type AllowlistItem,
  type CampaignRow,
  type KeyData,
  type UnackedResult,
} from '@/components/dashboard/api';

/**
 * G1 dodáva C2 v `@/components/charts/CampaignTimeline` — dynamický import
 * so skeleton fallbackom, aby shell nestál na cudzom module.
 */
const CampaignTimeline = dynamic(() => import('@/components/charts/CampaignTimeline'), {
  ssr: false,
  loading: () => (
    <div
      className="ovl-shimmer"
      style={{ height: '180px', width: '100%' }}
      aria-busy="true"
      aria-label="Načítavam časovú os kampaní"
    />
  ),
});

/** Obsah zrušenej dokumentačnej karty — teraz ⓘ tooltip (plán 33 §3). */
const HONESTY_TEXT =
  'Appka pozná len vlastné zápisy do shopu. Skutočný stav zliav v shope cez API overiť nevie — počet je preto „podľa vlastného zápisu", nie potvrdený stav. Zapísanú zľavu nemožno z appky zrušiť; dobehne sama.';

interface DashboardData {
  keyData: KeyData | null;
  allowlist: AllowlistItem[] | null;
  needsKey: CampaignRow[];
  missed: CampaignRow[];
  partialCount: number;
  scheduled: CampaignRow[];
  unacked: UnackedResult[];
}

/** Aktívny vlastný zápis = dnešok leží v okne posledného vlastného zápisu. */
function hasActiveOwnWrite(item: AllowlistItem, todayIso: string): boolean {
  const w = item.lastOwnWrite;
  if (w == null) return false;
  return w.from.slice(0, 10) <= todayIso && todayIso <= w.to.slice(0, 10);
}

/** Najbližšie naplánované spustenie (fireAt, fallback začiatok okna). */
function nextRun(scheduled: readonly CampaignRow[]): { campaign: CampaignRow; at: string } | null {
  let best: { campaign: CampaignRow; at: string } | null = null;
  for (const campaign of scheduled) {
    const at = campaign.fireAt ?? `${campaign.dateFrom.slice(0, 10)}T00:00:00`;
    if (best == null || at < best.at) best = { campaign, at };
  }
  return best;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const [keyData, allowlist, needsKey, missed, partial, scheduled, notifications] =
        await Promise.all([
          getKey(),
          getAllowlist(),
          getCampaigns('status=needs_key&perPage=100'),
          getCampaigns('status=missed&perPage=100'),
          getCampaigns('status=partial&perPage=1'),
          getCampaigns('status=scheduled&perPage=100'),
          getNotifications(),
        ]);
      const everythingDown =
        keyData == null && allowlist == null && needsKey == null && notifications == null;
      setFailed(everythingDown);
      setData({
        keyData,
        allowlist,
        needsKey: needsKey?.data ?? [],
        missed: missed?.data ?? [],
        partialCount: partial?.total ?? 0,
        scheduled: scheduled?.data ?? [],
        unacked: notifications?.unacked ?? [],
      });
    })();
  }, []);

  if (failed) {
    return (
      <ErrorMessage message="Dashboard sa nepodarilo načítať — API appky neodpovedá. Skús obnoviť stránku." />
    );
  }

  const head = (
    <div className="ovl-page-head ovl-view-in">
      <div>
        <Eyebrow>Riadenie zliav</Eyebrow>
        <h1>Dashboard</h1>
        <p className="ovl-page-desc">
          Kampane, vlastné zápisy a platnosť kľúča na jednom mieste.
        </p>
      </div>
      <div className="ovl-page-actions">
        {/* Drawer novej kampane dodáva C3 (§5) — do jeho dodania vedie akcia
            na existujúcu stránku; dry-run + potvrdenie (I3) platia rovnako. */}
        <Link href="/kampane/nova" className="ovl-btn ovl-btn--primary">
          + Nová kampaň
        </Link>
      </div>
    </div>
  );

  if (data == null) {
    return (
      <div className="ovl-w-wide">
        {head}
        <div className="ovl-grid ovl-grid--kpis" aria-busy="true">
          <div className="ovl-card ovl-skeleton" style={{ minHeight: '9rem' }} />
          <div className="ovl-card ovl-skeleton" style={{ minHeight: '9rem' }} />
          <div className="ovl-card ovl-skeleton" style={{ minHeight: '9rem' }} />
        </div>
      </div>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const allowlist = data.allowlist ?? [];
  const activeCount = allowlist.filter((item) => hasActiveOwnWrite(item, todayIso)).length;
  const interventionCount = data.needsKey.length + data.missed.length + data.partialCount;
  const upcoming = nextRun(data.scheduled);

  return (
    <div className="ovl-w-wide ovl-stack ovl-stack--fill" style={{ gap: '1rem' }}>
      {head}

      <div className="ovl-grid ovl-grid--kpis ovl-stagger" data-testid="dashboard-kpis">
        <KpiCard
          label={
            <>
              Aktívne zľavy teraz{' '}
              <span
                className="ovl-info-tip"
                role="img"
                tabIndex={0}
                title={HONESTY_TEXT}
                aria-label={`Poznámka k počtu: ${HONESTY_TEXT}`}
              >
                i
              </span>
            </>
          }
          icon={<span aria-hidden="true">%</span>}
          value={
            data.allowlist == null ? (
              '—'
            ) : (
              <>
                {activeCount}
                <span className="ovl-muted" style={{ fontSize: '0.6em', fontWeight: 600 }}>
                  /10
                </span>
              </>
            )
          }
          foot={
            data.allowlist == null
              ? 'allowlist sa nepodarilo načítať'
              : 'podľa vlastných zápisov appky, nie stavu shopu'
          }
          testId="kpi-active-discounts"
        />
        <KpiCard
          label="Vyžaduje zásah"
          icon={<span aria-hidden="true">⚿</span>}
          value={interventionCount}
          {...(interventionCount > 0 ? { tone: 'attention' as const } : {})}
          foot={
            interventionCount > 0
              ? `vyžaduje kľúč ${data.needsKey.length} · zmeškané ${data.missed.length} · čiastočné ${data.partialCount}`
              : '✓ žiadna kampaň nečaká na tvoje rozhodnutie'
          }
          testId="kpi-intervention"
        />
        <KpiCard testId="kpi-key-ttl">
          <KeyTtlArc secondsLeft={data.keyData?.secondsLeft ?? null} />
        </KpiCard>
      </div>

      <section
        className="ovl-card ovl-lift"
        style={{ borderRadius: 'var(--r-lg)', boxShadow: 'var(--kiss-shadow-sm)' }}
        data-testid="dashboard-timeline"
      >
        <CampaignTimeline />
      </section>

      <p className="ovl-nextrun" data-testid="dashboard-next-run">
        <strong>Najbližšie spustenie:</strong>{' '}
        {upcoming ? (
          <span>
            <Link href={`/kampane/${upcoming.campaign.id}`}>
              <strong>{upcoming.campaign.name}</strong>
            </Link>{' '}
            · −{upcoming.campaign.percent} % ·{' '}
            <span className="ovl-date">
              {upcoming.campaign.fireAt
                ? formatDateTimeSk(upcoming.campaign.fireAt)
                : formatDateSk(upcoming.campaign.dateFrom)}
            </span>
          </span>
        ) : (
          <span className="ovl-muted">žiadne naplánované</span>
        )}
      </p>

      <AlertsBanner needsKey={data.needsKey} missed={data.missed} />
      <UnackedResults results={data.unacked} />
    </div>
  );
}

export default Dashboard;
