/**
 * Aura Zľavy — `/zlavy/nova` (V11; architektúra §2, kontrakt V3 K1, K7).
 *
 * Sem vedie tlačidlo `Zlacniť` z tabu Produkty a `Nová zľava` z Prehľadu.
 * Adresa má dva tvary a oba tu musia fungovať, lebo sa dajú uložiť do
 * poznámok aj do záložiek prehliadača:
 *
 *   `?produkty=18342,21170`   — používateľ označil konkrétne riadky,
 *   `?filter=…&pocet=11640`   — vybral všetko, čo vyhovuje filtru.
 *
 * Zoznam desiatich tisícov čísel sa do adresy nezmestí, preto hromadný výber
 * nesie FILTER a sprievodca sa spýta API na tie isté riadky.
 *
 * Bez parametrov sa predvyplní filter ležiakov (0 predaných za 180 dní) —
 * je to prvý klik používateľa a appka existuje na zlacňovanie toho, čo sa
 * nepredáva (architektúra §2).
 *
 * Vlastník: V11.
 */
import type { Metadata } from 'next';

import NewDiscount, { type NewDiscountInitial } from '@/components/campaigns/NewDiscount';
import {
  DEFAULT_CATALOG_FILTER,
  parseCatalogFilterQuery,
  type CatalogFilterState,
} from '@/components/products/catalog-filter';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Nová zľava — ${APP_DISPLAY_NAME}`,
};

/** Predvolený výber: ležiaky za 180 dní. Nie celý katalóg. */
const LEZIAKY: CatalogFilterState = {
  ...DEFAULT_CATALOG_FILTER,
  soldWindowDays: 180,
  soldBuckets: ['none'],
};

function first(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** `18342,21170` → `[18342, 21170]`. Nezmysly sa zahadzujú, nie dopočítavajú. */
function parseProductIds(raw: string | undefined): number[] | null {
  if (raw === undefined || raw.trim() === '') return null;
  const ids = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return ids.length === 0 ? null : ids;
}

export default async function NewDiscountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const productIds = parseProductIds(first(params['produkty']));
  const filterQuery = first(params['filter']);
  const expected = Number(first(params['pocet']));

  const initial: NewDiscountInitial = {
    productIds,
    filter:
      filterQuery === undefined || filterQuery.trim() === ''
        ? productIds === null
          ? LEZIAKY
          : DEFAULT_CATALOG_FILTER
        : parseCatalogFilterQuery(filterQuery),
    expectedTotal: Number.isInteger(expected) && expected > 0 ? expected : null,
  };

  return <NewDiscount initial={initial} />;
}
