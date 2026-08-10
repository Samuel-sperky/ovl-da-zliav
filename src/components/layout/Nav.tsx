'use client';

/**
 * Aura Zľavy — hlavná navigácia (K9).
 *
 * PRESNE ŠTYRI TABY: Prehľad · Produkty · Zľavy · Nastavenia. Piaty sa sem
 * nepridáva — všetko ostatné sa skladá dovnútra týchto štyroch (analytika do
 * Prehľadu a Zliav, AI návrhy do Prehľadu, audit do Nastavení).
 *
 * `ALIASY` existujú len pre prechodné obdobie: staré cesty (`/kampane`,
 * `/audit`, `/analytika`, `/ai-agent`) ešte žijú, kým V13 nedodá presmerovania.
 * Bez nich by na starej ceste nesvietil žiadny tab a hlavička by tvrdila, že
 * používateľ nie je nikde. Keď presmerovania pribudnú, mapa môže zmiznúť.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export const TABS: readonly { href: string; label: string }[] = [
  { href: '/', label: 'Prehľad' },
  { href: '/produkty', label: 'Produkty' },
  { href: '/zlavy', label: 'Zľavy' },
  { href: '/nastavenia', label: 'Nastavenia' },
];

/** Stará cesta → tab, pod ktorý podľa K9 patrí. */
const ALIASES: readonly { prefix: string; href: string }[] = [
  { prefix: '/kampane', href: '/zlavy' },
  { prefix: '/audit', href: '/nastavenia' },
  { prefix: '/analytika', href: '/' },
  { prefix: '/ai-agent', href: '/' },
];

/**
 * Ktorý tab je aktívny pre danú cestu. Čistá funkcia — `null` znamená
 * „žiadny tab", čo je legitímny stav (napr. `/login`).
 */
export function activeTab(pathname: string | null): string | null {
  if (pathname === null || pathname === '') return null;
  if (pathname === '/') return '/';
  const alias = ALIASES.find((a) => pathname === a.prefix || pathname.startsWith(`${a.prefix}/`));
  if (alias !== undefined) return alias.href;
  const tab = TABS.find(
    (t) => t.href !== '/' && (pathname === t.href || pathname.startsWith(`${t.href}/`)),
  );
  return tab === undefined ? null : tab.href;
}

export function Nav() {
  const pathname = usePathname();
  const active = activeTab(pathname ?? null);

  return (
    <nav className="tabs" aria-label="Hlavná navigácia">
      {TABS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={href === active ? 'on' : undefined}
          aria-current={href === active ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export default Nav;
