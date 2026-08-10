/**
 * Aura Zľavy — root layout (V3, design/v3/prehlad.html a prehlad-tmava.html).
 *
 * Shell je zámerne chudobný — jeden sticky riadok 56 px:
 *
 *   [Aura Zľavy]  Prehľad · Produkty · Zľavy · Nastavenia   Zápisy 100/200 dnes ▮▮▯  Fronta 3 420/8 000  ☾
 *
 * Nad ním pruh PRODUKCIA (D6), pod ním nanajvýš dva tenké pruhy faktov:
 * „Ostrý zápis vypnutý" (I13) a read-only výzva pri chýbajúcom kľúči (D10).
 * Nič iné do hlavičky nepatrí — žiadne vyhľadávanie, žiadne notifikácie,
 * žiadne stavové badge (ARCHITEKTURA §0).
 *
 * Téma: SVETLÁ je predvolená a `<html>` sa renderuje BEZ `data-theme`, takže
 * kým si používateľ nevyberie, rozhoduje systém (`prefers-color-scheme`).
 * Inline skript nižšie prečíta `localStorage` a atribút nastaví — alebo zmaže —
 * PRED prvým paintom, aby nič neblikalo. Skript je bez závislostí a nič
 * nezapisuje na server.
 */
import type { Metadata } from 'next';

import Nav from '@/components/layout/Nav';
import ProductionBar from '@/components/layout/ProductionBar';
import {
  HeaderReadOnlyNotice,
  HeaderRight,
  HeaderWritesStrip,
} from '@/components/layout/HeaderStatus';
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
        <header className="hdr">
          <div className="hdr-in">
            <span className="brand">
              Aura <b>Zľavy</b>
            </span>
            <Nav />
            <HeaderRight />
          </div>
        </header>
        <HeaderWritesStrip />
        <HeaderReadOnlyNotice />
        <main className="wrap">{children}</main>
        <footer className="ovl-footer">
          Aura Zľavy v{APP_VERSION} · beží výhradne lokálne na{' '}
          <code>127.0.0.1:3070</code> · stavy zliav sú „posledný vlastný zápis“,
          nie stav shopu
        </footer>
      </body>
    </html>
  );
}
