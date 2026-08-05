/**
 * Aura Zľavy — /kampane/[id]: detail kampane (A15, D15, D16, D19, I7).
 *
 * Detail, položky ✓/✗/neistý, „Zopakovať zlyhané" (vždy cez nový dry-run),
 * „Predĺžiť" (len `to`), „Zrušiť kampaň" (len plán v DB) a audit stopa.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import CampaignDetail from '@/components/campaigns/CampaignDetail';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Detail kampane — ${APP_DISPLAY_NAME}`,
};

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) notFound();
  return <CampaignDetail campaignId={campaignId} />;
}
