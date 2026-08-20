/**
 * Aura Zľavy — `/kampane` → `/zlavy` (V11; kontrakt V3 K9, K10).
 *
 * Tab sa volá Zľavy, nie Kampane — „kampaň" je vnútorné slovo a na povrch
 * nepatrí. Stará cesta ale zostáva ako presmerovanie: odkazy v poznámkach,
 * v histórii prehliadača a v starších záznamoch sa nesmú zlomiť.
 *
 * Prenáša sa aj `?nova=1` (starý drawer novej kampane) — vedie na sprievodcu
 * `/zlavy/nova` aj s predvyplneným výberom, ak ho adresa niesla.
 *
 * Vlastník: V11.
 */
import { redirect } from 'next/navigation';

function first(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export default async function CampaignsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = await searchParams;
  const wantsNew = first(params['nova']);
  if (wantsNew === undefined) redirect('/zlavy');

  const forwarded = new URLSearchParams();
  const products = first(params['produkty']);
  if (products !== undefined && products !== '') forwarded.set('produkty', products);
  const filter = first(params['filter']);
  if (filter !== undefined && filter !== '') forwarded.set('filter', filter);
  const total = first(params['pocet']);
  if (total !== undefined && total !== '') forwarded.set('pocet', total);

  const query = forwarded.toString();
  redirect(query === '' ? '/zlavy/nova' : `/zlavy/nova?${query}`);
}
