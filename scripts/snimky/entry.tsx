/**
 * Aura Zľavy — SNÍMKOVAČ: to, čo beží v prehliadači.
 *
 * PREČO SA APPKA NESPÚŠŤA
 * -----------------------
 * Binárka `argon2` je na tomto počítači zablokovaná Windows Application
 * Control — je to bezpečnostné opatrenie a neobchádza sa. Appka sa teda
 * nedá naštartovať a jedenásť mesiacov práce nikto nevidel.
 *
 * Nemusí sa ale spúšťať. Obrazovky sú klientské komponenty; server im
 * neposiela nič okrem odpovedí na `fetch`. Keď sa `fetch` nahradí vymyslenými
 * odpoveďami, tie isté komponenty sa vykreslia v prehliadači úplne rovnako —
 * bez servera, bez databázy, bez kľúča a bez jediného bajtu do siete.
 *
 * Škrupina je SKUTOČNÁ `AppShell` a štýly sú skutočný `globals.css` aj skutočné
 * CSS moduly (zabalí ich Vite, takže mená tried ostávajú rozsahované rovnako
 * ako v appke). Písmo je `@fontsource-variable/inter` — to isté, ktoré posiela
 * `app/layout.tsx`. Snímka teda ukazuje appku, nie jej nápodobu.
 *
 * Obrazovka a téma sa vyberajú z adresy: `#obrazovka=produkty&tema=tmava`.
 *
 * Vlastník: snímkovač (`scripts/snimky.ts`).
 */
import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

import DiscountDetail from '@/components/campaigns/DiscountDetail';
import DiscountsList from '@/components/campaigns/DiscountsList';
import Overview from '@/components/dashboard/Overview';
import AppShell from '@/components/layout/AppShell';
import CatalogPanel from '@/components/products/CatalogPanel';
import { DEFAULT_CATALOG_FILTER } from '@/components/products/catalog-filter';
import SettingsIndex from '@/components/settings/SettingsIndex';
import SettingsSubPage from '@/components/settings/SettingsSubPage';

import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/inter/wght-italic.css';
import '@/app/globals.css';

import { nasadFetch, poslednyDotaz } from './fixtury';
import { zbierNalezy } from './kontroly';
import { nastavCestu } from './next-navigation';

/** Jedna obrazovka snímkovača: adresa, na ktorej žije, a čo sa na nej kreslí. */
interface Obrazovka {
  readonly cesta: string;
  readonly telo: () => ReactElement;
}

/**
 * Zoznam obrazoviek. Kľúč je to, čo sa píše do adresy aj do mena súboru —
 * jedno meno pre snímku, adresu aj hlásenie o náleze.
 */
export const OBRAZOVKY: Readonly<Record<string, Obrazovka>> = {
  prehlad: { cesta: '/', telo: () => <Overview /> },
  produkty: {
    cesta: '/produkty',
    telo: () => <CatalogPanel initialFilter={DEFAULT_CATALOG_FILTER} />,
  },
  zlavy: { cesta: '/zlavy', telo: () => <DiscountsList /> },
  'zlavy-detail': {
    cesta: '/zlavy/42',
    telo: () => <DiscountsList selectedId={42} detail={<DiscountDetail id={42} />} />,
  },
  nastavenia: { cesta: '/nastavenia', telo: () => <SettingsIndex /> },
  'nastavenia-zapisy': {
    cesta: '/nastavenia/co-smie',
    telo: () => <SettingsSubPage slug="co-smie" />,
  },
  'nastavenia-zamknute': {
    cesta: '/nastavenia/historia',
    telo: () => <SettingsSubPage slug="historia" />,
  },
};

function parametre(): URLSearchParams {
  return new URLSearchParams(window.location.hash.replace(/^#/, ''));
}

function spusti(): void {
  const params = parametre();
  const meno = params.get('obrazovka') ?? 'prehlad';
  const obrazovka = OBRAZOVKY[meno];
  if (obrazovka === undefined) throw new Error(`neznáma obrazovka: ${meno}`);

  // Téma sa prepína presne tak, ako ju prepína appka — atribútom na `<html>`
  // (`components/layout/theme.ts`). Žiadny vlastný mechanizmus.
  if (params.get('tema') === 'tmava') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  nasadFetch();
  nastavCestu(obrazovka.cesta);

  // Meranie nálezov beží v prehliadači nad hotovou obrazovkou. Cestuje sem
  // v balíčku, nie ako text funkcie poslaný zvonku — inak by ho musel Node
  // importovať z `.ts` súboru, čo `tsconfig` projektu nedovoľuje.
  Object.assign(window, { __snimkyNalezy: zbierNalezy });

  const koren = document.getElementById('root');
  if (koren === null) throw new Error('chýba #root');

  createRoot(koren).render(
    <StrictMode>
      <AppShell>{obrazovka.telo()}</AppShell>
    </StrictMode>,
  );

  // Hotovo = pol sekundy sa nikto na nič nepýtal. Obrazovky si dopytujú čísla
  // v niekoľkých vlnách (chróm → sekcia → doplnky), takže „prvý render" je
  // priskoro a fotka by zachytila kostry namiesto čísel.
  const dozor = window.setInterval(() => {
    if (Date.now() - poslednyDotaz() < 500) return;
    window.clearInterval(dozor);
    document.documentElement.setAttribute('data-snimky', 'hotovo');
  }, 100);
}

spusti();
