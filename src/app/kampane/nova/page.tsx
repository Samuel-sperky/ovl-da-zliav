/**
 * Aura Zľavy — /kampane/nova: dvojkrokové vytvorenie kampane (A15, D2, I3).
 *
 * Krok 1 (produkty / percento / okno) → dry-run → krok 2 „Zapísať do
 * PRODUKCIE". Jednokroková cesta k zápisu v UI NEEXISTUJE.
 */
import type { Metadata } from 'next';

import NewCampaignWizard from '@/components/campaigns/NewCampaignWizard';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Nová kampaň — ${APP_DISPLAY_NAME}`,
};

export default function NewCampaignPage() {
  return (
    <>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 1rem' }}>Nová kampaň</h1>
      <NewCampaignWizard />
    </>
  );
}
