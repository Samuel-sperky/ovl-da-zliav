/**
 * Aura Zľavy — /kampane: tab Kampane (KISS, plán 33 §3).
 *
 * Toolbar štýl predlohy + tabuľka so stavovými glyfmi + drawer novej
 * kampane (2 kroky, dry-run potvrdenie — I3). Dáta číta klient
 * z `GET /api/campaigns` (kontrakt §5) — `next build` nezávisí od DB.
 * `useSearchParams` v klientovi vyžaduje Suspense hranicu.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import CampaignsView from '@/components/campaigns/CampaignsView';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Kampane — ${APP_DISPLAY_NAME}`,
};

export default function CampaignsPage() {
  return (
    <Suspense
      fallback={<div className="ovl-card ovl-skeleton" style={{ minHeight: '10rem' }} aria-busy="true" />}
    >
      <CampaignsView />
    </Suspense>
  );
}
