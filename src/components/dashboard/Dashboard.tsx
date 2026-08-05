'use client';

/**
 * Aura Zľavy — klientská kompozícia dashboardu (D1).
 *
 * Číta z API kontraktu §5 (`/api/key`, `/api/campaigns`, `/api/allowlist`,
 * `/api/notifications`). Chyby siete degradujú na priznaný „nedostupné“
 * stav — dashboard nikdy nezobrazí falošné dáta.
 */
import { useEffect, useState } from 'react';

import AlertsBanner from '@/components/dashboard/AlertsBanner';
import AllowlistGrid from '@/components/dashboard/AllowlistGrid';
import CampaignsMini from '@/components/dashboard/CampaignsMini';
import KeyCard from '@/components/dashboard/KeyCard';
import UnackedResults from '@/components/dashboard/UnackedResults';
import ErrorMessage from '@/components/ui/ErrorMessage';
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

interface DashboardData {
  keyData: KeyData | null;
  allowlist: AllowlistItem[] | null;
  recent: CampaignRow[] | null;
  needsKey: CampaignRow[];
  missed: CampaignRow[];
  unacked: UnackedResult[];
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const [keyData, allowlist, recent, needsKey, missed, notifications] =
        await Promise.all([
          getKey(),
          getAllowlist(),
          getCampaigns('page=1&perPage=8'),
          getCampaigns('status=needs_key'),
          getCampaigns('status=missed'),
          getNotifications(),
        ]);
      const everythingDown =
        keyData == null && allowlist == null && recent == null && notifications == null;
      setFailed(everythingDown);
      setData({
        keyData,
        allowlist,
        recent: recent?.data ?? null,
        needsKey: needsKey?.data ?? [],
        missed: missed?.data ?? [],
        unacked: notifications?.unacked ?? [],
      });
    })();
  }, []);

  if (data == null) {
    return (
      <div className="ovl-grid ovl-grid--dashboard" aria-busy="true">
        <div className="ovl-card ovl-skeleton" style={{ minHeight: '8rem' }} />
        <div className="ovl-card ovl-skeleton" style={{ minHeight: '8rem' }} />
        <div className="ovl-card ovl-skeleton ovl-span-2" style={{ minHeight: '10rem' }} />
      </div>
    );
  }

  if (failed) {
    return (
      <ErrorMessage message="Dashboard sa nepodarilo načítať — API appky neodpovedá. Skús obnoviť stránku." />
    );
  }

  return (
    <div className="ovl-stack" style={{ gap: '1rem' }}>
      <AlertsBanner needsKey={data.needsKey} missed={data.missed} />
      <UnackedResults results={data.unacked} />
      <div className="ovl-grid ovl-grid--dashboard">
        <KeyCard keyData={data.keyData} />
        <section className="ovl-card" data-testid="dashboard-honesty">
          <h2>Čo tento dashboard vie a nevie</h2>
          <p className="ovl-small">
            Appka pozná len <strong>vlastné zápisy</strong> do shopu. Skutočný
            stav zliav v shope cez API overiť nevie — každý produkt preto nesie
            badge „podľa vlastného zápisu z DD.MM.“. Zapísanú zľavu nemožno
            z appky zrušiť; dobehne sama.
          </p>
        </section>
        <CampaignsMini campaigns={data.recent ?? []} />
        <AllowlistGrid items={data.allowlist ?? []} />
      </div>
    </div>
  );
}

export default Dashboard;
