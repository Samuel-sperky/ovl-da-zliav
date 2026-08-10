/**
 * Aura Zľavy — `/kampane/[id]` → `/zlavy/[id]` (V11; kontrakt V3 K9).
 *
 * Detail pod starou cestou. Číslo zľavy zostáva rovnaké, mení sa len adresa,
 * takže starý odkaz vedie presne na tú istú zľavu. Nezmyselné číslo končí
 * v zozname — nie na chybovej stránke.
 *
 * Vlastník: V11.
 */
import { redirect } from 'next/navigation';

export default async function CampaignDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) redirect('/zlavy');
  redirect(`/zlavy/${campaignId}`);
}
