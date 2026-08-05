'use client';

/**
 * Aura Zľavy — hlavná navigácia (§8).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS: readonly { href: string; label: string }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/produkty', label: 'Produkty' },
  { href: '/kampane', label: 'Kampane' },
  { href: '/audit', label: 'Audit' },
  { href: '/nastavenia', label: 'Nastavenia' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="ovl-nav" aria-label="Hlavná navigácia">
      {LINKS.map(({ href, label }) => {
        const active = href === '/' ? pathname === '/' : pathname?.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default Nav;
