/**
 * Aura Zľavy — root layout.
 *
 * MINIMÁLNY PLACEHOLDER od A0. Vlastníctvo PREBERÁ A13, ktorý sem pridá
 * `ProductionBar` (D6), `KeyTtlBadge` (D5), `SchedulerBadge` (D87),
 * `WriteModeBadge` (D77/D79), `ReadOnlyNotice` (D10) a navigáciu.
 *
 * Jazyk UI je slovenčina, dátumy DD.MM.YYYY, desatinná čiarka (§8).
 */
import type { Metadata } from 'next';

import { APP_DISPLAY_NAME } from '@/version';

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
      <body>{children}</body>
    </html>
  );
}
