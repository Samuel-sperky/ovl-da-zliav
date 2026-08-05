/**
 * Aura Zľavy — /kampane: zoznam kampaní s filtrom (A15, D14, §8).
 *
 * Dáta číta klient z `GET /api/campaigns` (kontrakt §5) — `next build`
 * nezávisí od bežiacej DB.
 */
import type { Metadata } from 'next';

import CampaignList from '@/components/campaigns/CampaignList';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Kampane — ${APP_DISPLAY_NAME}`,
};

export default function CampaignsPage() {
  return (
    <>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 1rem' }}>Kampane</h1>
      <CampaignList />
    </>
  );
}
