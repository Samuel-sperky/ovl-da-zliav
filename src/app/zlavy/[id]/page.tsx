/**
 * Aura Zľavy — `/zlavy/[id]` (V11; architektúra §1 TAB 3).
 *
 * Detail jednej zľavy: priebeh fronty, pásma, položky a technický detail.
 * Server komponent overí len tvar adresy — dáta číta klient
 * z `/api/campaigns/[id]`, takže `next build` nepotrebuje databázu.
 *
 * Vlastník: V11.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import DiscountDetail from '@/components/campaigns/DiscountDetail';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Zľava — ${APP_DISPLAY_NAME}`,
};

export default async function DiscountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const discountId = Number(id);
  if (!Number.isInteger(discountId) || discountId <= 0) notFound();
  return <DiscountDetail id={discountId} />;
}
