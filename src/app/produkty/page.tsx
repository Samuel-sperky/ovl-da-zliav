/**
 * Aura Zľavy — `/produkty` (A16, §8, D7, D38, D40, I2).
 *
 * Správa allowlistu: tabuľka 10 povolených produktov, pridanie (blokované na
 * 11. produkte), odobranie (blokované pri naplánovanej kampani, s vysvetlením),
 * „obnoviť z shopu" a „označiť stav ako neznámy". Dáta číta klient z `/api/*`,
 * takže `next build` nepotrebuje bežiacu DB.
 */
import type { Metadata } from 'next';

import ProductsPanel from '@/components/products/ProductsPanel';
import { APP_DISPLAY_NAME } from '@/version';

export const metadata: Metadata = {
  title: `Produkty — ${APP_DISPLAY_NAME}`,
};

export default function ProductsPage() {
  return (
    <>
      <h1 style={{ fontSize: '1.3rem', margin: '0 0 0.35rem' }}>Produkty (allowlist)</h1>
      <p className="ovl-small ovl-muted" style={{ margin: '0 0 1rem' }}>
        Zľavu je možné zapísať výhradne produktom z tohto zoznamu — maximum je 10
        a strop je vynútený aj v databáze. Uvedené zľavy sú vždy „posledný
        vlastný zápis", nie stav shopu.
      </p>
      <ProductsPanel />
    </>
  );
}
