/**
 * Aura Zľavy — root layout (A13, §8; redizajn podľa 32-UX-UI-PLAN §2, §3).
 *
 * Na KAŽDEJ stránke: `ProductionBar` (D6), teal lišta rodiny s korunou ♛,
 * navigácia, `KeyTtlBadge` (D5), `SchedulerBadge` (D87), `WriteModeBadge`
 * (D77/D79), prepínač témy a `ReadOnlyNotice` (D10). Jazyk UI je slovenčina,
 * dátumy DD.MM.YYYY, desatinná čiarka.
 *
 * Téma: dark je default. Inline skript nižšie prečíta `localStorage` a nastaví
 * `data-theme` na `<html>` PRED prvým paintom, aby neblikla svetlá plocha.
 * Skript je zámerne bez závislostí (package.json je zamknutý) a nič nezapisuje.
 */
import type { Metadata } from 'next';

import Nav from '@/components/layout/Nav';
import ProductionBar from '@/components/layout/ProductionBar';
import { HeaderBadges, HeaderReadOnlyNotice } from '@/components/layout/HeaderStatus';
import { THEME_BOOTSTRAP_SCRIPT } from '@/components/layout/theme';
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
    <html lang="sk" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <ProductionBar />
        <header className="ovl-header">
          <div className="ovl-header-inner">
            <span className="ovl-brand">
              <span className="ovl-crown" aria-hidden="true">
                ♛
              </span>
              {APP_DISPLAY_NAME}
            </span>
            <Nav />
            <div className="ovl-header-badges">
              <HeaderBadges />
            </div>
          </div>
        </header>
        <HeaderReadOnlyNotice />
        <main className="ovl-main ovl-anim-in">{children}</main>
        <footer className="ovl-footer">
          Aura Zľavy v{APP_VERSION} · beží výhradne lokálne na{' '}
          <code>127.0.0.1:3070</code> · stavy zliav sú „posledný vlastný zápis“,
          nie stav shopu
        </footer>
      </body>
    </html>
  );
}
