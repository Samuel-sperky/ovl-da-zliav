/**
 * Aura Zľavy — `/produkty` (KISS, plán 33 §3; pravidlá A16/D7/D38/D40/I2 platia).
 *
 * Celá kompozícia (page-head, toolbar, karty, drawer) žije v `ProductsPanel`
 * ako klient — dáta číta z `/api/*`, takže `next build` nepotrebuje bežiacu DB.
 */
import type { Metadata } from 'next';

import ProductsPanel from '@/components/products/ProductsPanel';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Produkty — ${APP_DISPLAY_NAME}`,
};

export default function ProductsPage() {
  return <ProductsPanel />;
}
