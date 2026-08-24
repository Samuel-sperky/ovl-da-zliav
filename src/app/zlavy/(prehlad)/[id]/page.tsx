/**
 * Aura Zľavy — `/zlavy/[id]` (V11; architektúra §1 TAB 3).
 *
 * Detail jednej zľavy: priebeh fronty, pásma, položky a technický detail.
 * Server komponent overí len tvar adresy — dáta číta klient
 * z `/api/campaigns/[id]`, takže `next build` nepotrebuje databázu.
 *
 * Od šprintu 20 sa detail vykresľuje do pravého stĺpca shellu
 * `(prehlad)/layout.tsx` — vľavo pri ňom zostáva rebrík zliav. Trasa sa tým
 * nemení: je to stále plnohodnotná adresa, takže priamy odkaz, obnovenie
 * stránky aj tlačidlo Späť fungujú ako predtým.
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
  /*
   * `key` je nutné: detail sa načítava cez spoločné obnovovanie
   * (`layout/refresh.ts`), ktoré beží na vyžiadanie, nie pri zmene vstupu.
   * Bez remountu by prechod na inú zľavu ukázal čísla tej predchádzajúcej.
   */
  return <DiscountDetail key={discountId} id={discountId} />;
}
