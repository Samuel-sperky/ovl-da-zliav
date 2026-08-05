/**
 * Aura Zľavy — root layout (A13, §8).
 *
 * Na KAŽDEJ stránke: `ProductionBar` (D6), navigácia, `KeyTtlBadge` (D5),
 * `SchedulerBadge` (D87), `WriteModeBadge` (D77/D79) a `ReadOnlyNotice`
 * (D10). Jazyk UI je slovenčina, dátumy DD.MM.YYYY, desatinná čiarka.
 */
import type { Metadata } from 'next';

import Nav from '@/components/layout/Nav';
import ProductionBar from '@/components/layout/ProductionBar';
import { HeaderBadges, HeaderReadOnlyNotice } from '@/components/layout/HeaderStatus';
import { APP_DISPLAY_NAME, APP_VERSION } from '@/version';

import './globals.css';

export const metadata: Metadata = {
  title: APP_DISPLAY_NAME,
  description: 'Lokálny nástroj na časovo obmedzené percentuálne zľavy',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sk">
      <body>
        <ProductionBar />
        <header className="ovl-header">
          <div className="ovl-header-inner">
            <span className="ovl-brand">{APP_DISPLAY_NAME}</span>
            <Nav />
            <div className="ovl-header-badges">
              <HeaderBadges />
            </div>
          </div>
        </header>
        <div className="ovl-main" style={{ padding: '0.75rem 1rem 0' }}>
          <HeaderReadOnlyNotice />
        </div>
        <main className="ovl-main">{children}</main>
        <footer className="ovl-footer">
          Aura Zľavy v{APP_VERSION} · beží výhradne lokálne na{' '}
          <code>127.0.0.1:3050</code> · stavy zliav sú „posledný vlastný zápis“,
          nie stav shopu
        </footer>
      </body>
    </html>
  );
}
