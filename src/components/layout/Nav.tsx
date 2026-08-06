'use client';

/**
 * Aura Zľavy — hlavná navigácia (§8).
 *
 * Na teal lište rodiny. Na úzkych obrazovkách je to jeden vodorovný scroll pás
 * (CSS), takže chrome neujedá výšku; aktívna položka sa doscrolluje do view.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * 6 tabov podľa plánu 33 §1 bod 6 (KISS, sekcia C1): audit žije v Analytike
 * (starý tab Audit presmeruje C2), /analytika a /ai-agent dodajú C2/C3 —
 * navigácia na ne len odkazuje.
 */
const LINKS: readonly { href: string; label: string }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/produkty', label: 'Produkty' },
  { href: '/kampane', label: 'Kampane' },
  { href: '/analytika', label: 'Analytika' },
  { href: '/nastavenia', label: 'Nastavenia' },
  { href: '/ai-agent', label: 'AI agent' },
];

export function Nav() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <nav className="ovl-nav" aria-label="Hlavná navigácia">
      {LINKS.map(({ href, label }) => {
        const active = href === '/' ? pathname === '/' : pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            ref={active ? activeRef : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default Nav;
