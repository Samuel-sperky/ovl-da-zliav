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
 * Celý chróm skladá `components/layout/AppShell.tsx`, aby stav appky čítal
 * jeden dotaz pre celý shell. Čísla sa NEOBNOVUJÚ samy — obnoví ich tlačidlo
 * v stavovom pruhu (`components/layout/refresh.ts`).
 *
 * Téma: TMAVÁ je od V6a predvolená (D131, D145) a nesie ju HOLÝ `:root`;
 * `<html>` sa renderuje BEZ `data-theme`, takže kým skript nedobehne, platí
 * tmavá — nie systém. Inline skript nižšie prečíta `localStorage` a atribút
 * nastaví PRED prvým paintom, aby nič neblikalo; pri voľbe „systém" atribút
 * NEMAŽE, ale svetlú stampuje explicitne (celý rozbor je v `layout/theme.ts`).
 * Táto veta tu do 2. 9. 2026 tvrdila, že predvolená je SVETLÁ — bola pravdivá
 * pred obrátením tém a prežila ho. Skript je bez závislostí a nič nezapisuje
 * na server.
 */
import type { Metadata } from 'next';

/*
 * PÍSMO SA DODÁVA S APPKOU (19. 8. 2026). Predtým `--ovl-font` deklaroval
 * 'Inter', ale v repozitári nebol ani jeden súbor písma, žiadny `@font-face`
 * ani `next/font` — appka teda reálne bežala v systémovom Segoe UI a celá
 * typografia sa ladila proti písmu, ktoré nikto nevidel.
 *
 * Variant je VARIABILNÝ zámerne: `globals.css` používa rezy 550, 620, 640,
 * 650, 660 a 680. Statický Inter (400/500/600/700) by ich zaokrúhlil a jemná
 * gradácia hierarchie by zanikla.
 *
 * Súbory idú z `node_modules`, bundluje ich Next — appka po sieti nesiaha
 * (I6). Kurzíva je tu preto, že ju appka naozaj používa (napr. „Appka to teraz
 * nevie overiť."), a latin-ext preto, že bez neho by slovenská diakritika
 * (č, š, ž, ť, ľ, ô) vypadla do náhradného písma uprostred slova.
 */
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';

import AppShell from '@/components/layout/AppShell';
import { THEME_BOOTSTRAP_SCRIPT } from '@/components/layout/theme';
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
    <html lang="sk" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
