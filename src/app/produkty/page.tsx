/**
 * Aura Zľavy — `/produkty` (V10; kontrakt V3 K7–K10, architektúra §1).
 *
 * Tab odpovedá na „ktoré konkrétne kusy a aké majú čísla". Tržby eshopu tu
 * nie sú a nikdy nebudú — tie patria do Prehľadu (hranica z architektúry §1).
 *
 * Stránka je server komponent a robí presne dve veci: pomenuje záložku
 * prehliadača a rozbalí filter z adresy. Filter z adresy je dôležitý —
 * návrh v Prehľade („11 640 produktov sa 180 dní nepredalo") vedie sem
 * s presne nastaveným filtrom, takže odkaz musí fungovať aj po vložení do
 * poznámok. Dáta číta až klient z `/api/catalog/search`, takže `next build`
 * nepotrebuje bežiacu databázu.
 *
 * Vlastník: V10.
 */
import type { Metadata } from 'next';

import CatalogPanel from '@/components/products/CatalogPanel';
import { parseCatalogFilter } from '@/components/products/catalog-filter';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Produkty — ${APP_DISPLAY_NAME}`,
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <CatalogPanel initialFilter={parseCatalogFilter(params)} />;
}
