'use client';

/**
 * Aura Zľavy — hlavná navigácia (K9).
 *
 * PRESNE ŠTYRI TABY: Prehľad · Produkty · Zľavy · Nastavenia. Piaty sa sem
 * nepridáva — všetko ostatné sa skladá dovnútra týchto štyroch (analytika do
 * Prehľadu a Zliav, AI návrhy do Prehľadu, audit do Nastavení).
 *
 * `ALIASY` mapujú staré cesty (`/kampane`, `/audit`, `/analytika`,
 * `/ai-agent`) na tab, pod ktorý po K9 patria. Presmerovania na nich už
 * existujú, ale mapa má zostať: bez nej by počas presmerovania — a pri
 * otvorení starej záložky — nesvietil žiadny tab a hlavička by tvrdila, že
 * používateľ nie je nikde.
 *
 * ZÁMKY (C3, predloha `sperky-admin.html`, `.lock`)
 * -------------------------------------------------
 * Keď sa hlavná akcia tabu teraz nedá urobiť (chýba kľúč, vypnuté zápisy),
 * visí pri jeho názve zámok. Platia pri ňom dve tvrdé pravidlá:
 *
 *  1. **Odkaz zostáva živý.** Zamknuté sa NESKRÝVA a nerobí sa z neho mŕtvy
 *     text — zoznam zliav sa dá čítať vždy, len sa z neho teraz nedá zapísať
 *     nová. Mŕtvy odkaz by z dočasného stavu spravil zmiznutú funkciu.
 *  2. **Zámok bez dôvodu sa nekreslí.** Emodži je dekorácia (`aria-hidden`);
 *     dôvod nesie `aria-label` odkazu, celá veta `title` a viditeľne ho píše
 *     `LockBadge` v stavovom pruhu. Zámok, ku ktorému sa dôvod nedá dočítať,
 *     vyzerá ako pokazená appka.
 *
 * Čo je zamknuté, sa NEROZHODUJE tu — prichádza to z `layout/status.ts`, ktorý
 * to odvodí z prekážok servera.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { NavLock } from '@/components/layout/status';
import Icon from '@/components/ui/Icon';

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

export interface NavProps {
  /** Zamknuté taby aj s dôvodom. Prázdne pole = nič nie je zamknuté. */
  locks?: readonly NavLock[];
}

export function Nav({ locks = [] }: NavProps) {
  const pathname = usePathname();
  const active = activeTab(pathname ?? null);

  return (
    <nav className="tabs" aria-label="Hlavná navigácia">
      {TABS.map(({ href, label }) => {
        const lock = locks.find((candidate) => candidate.href === href);
        return (
          <Link
            key={href}
            href={href}
            className={href === active ? 'on' : undefined}
            aria-current={href === active ? 'page' : undefined}
            data-locked={lock === undefined ? undefined : 'true'}
            title={lock?.title}
            aria-label={lock === undefined ? undefined : `${label} — zamknuté: ${lock.reason}`}
          >
            {label}
            {lock === undefined ? null : (
              <Icon className="tab-lock" name="lock" size={0.85} />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export default Nav;
