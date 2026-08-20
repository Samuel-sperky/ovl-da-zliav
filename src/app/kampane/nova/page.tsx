/**
 * Aura Zľavy — `/kampane/nova` → `/zlavy/nova` (V11; kontrakt V3 K9).
 *
 * Stará cesta na zakladanie zľavy. Presmerovanie nesie predvyplnený výber
 * ďalej, aby odkaz z poznámok alebo z onboardingu skončil presne tam, kde má.
 *
 * Vlastník: V11.
 */
import { redirect } from 'next/navigation';

function first(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewCampaignRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const params = await searchParams;
  const forwarded = new URLSearchParams();
  for (const key of ['produkty', 'filter', 'pocet']) {
    const value = first(params[key]);
    if (value !== undefined && value !== '') forwarded.set(key, value);
  }
  const query = forwarded.toString();
  redirect(query === '' ? '/zlavy/nova' : `/zlavy/nova?${query}`);
}
