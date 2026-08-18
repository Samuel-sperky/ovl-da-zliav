/**
 * Aura Zľavy — root layout (V3, design/v3/prehlad.html a prehlad-tmava.html).
 *
 * Shell je zámerne chudobný — tri riadky chrómu a pod nimi obsah:
 *
 *   PRODUKCIA — sperky-eshop.sk · každý zápis ide do ostrého shopu
 *   [Aura Zľavy]  Prehľad · Produkty · Zľavy 🔒 · Nastavenia   Fronta 3 420/8 000  ☾
 *   ✓ Ostrý zápis zapnutý · ✓ Kľúč do 09.09.2026 · ○ Zápisy 21/200 dnes ·
 *     ○ Katalóg 2 900 z 41 082                      Stav k 12:53 · [Obnoviť]
 *
 * Štvrtý riadok pribudne výhradne vtedy, keď kľúč chýba alebo vypršal (D10).
 * Nič iné do chrómu nepatrí — žiadne vyhľadávanie, žiadne notifikácie, žiadne
 * stavové badge (ARCHITEKTURA §0) a žiadny druhý nositeľ toho istého faktu.
 *
 * Celý chróm skladá `components/layout/AppHeader.tsx`, aby stav appky čítal
 * jeden dotaz pre celý shell. Čísla sa NEOBNOVUJÚ samy — obnoví ich tlačidlo
 * v stavovom pruhu (`components/layout/refresh.ts`).
 *
 * Téma: SVETLÁ je predvolená a `<html>` sa renderuje BEZ `data-theme`, takže
 * kým si používateľ nevyberie, rozhoduje systém (`prefers-color-scheme`).
 * Inline skript nižšie prečíta `localStorage` a atribút nastaví — alebo zmaže —
 * PRED prvým paintom, aby nič neblikalo. Skript je bez závislostí a nič
 * nezapisuje na server.
 */
import type { Metadata } from 'next';

import AppHeader from '@/components/layout/AppHeader';
import ProductionBar from '@/components/layout/ProductionBar';
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
        <AppHeader />
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
