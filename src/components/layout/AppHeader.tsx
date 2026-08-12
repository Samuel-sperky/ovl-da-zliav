'use client';

/**
 * Aura Zľavy — SPOLOČNÝ CHRÓM: hlavička + stály stavový pruh.
 *
 * Existuje z jediného dôvodu: **jeden poller pre celý shell**. Navigácia
 * potrebuje vedieť, čo je zamknuté, a stavový pruh potrebuje tie isté fakty.
 * Keby si každý z nich volal `/api/status` sám, appka by pri každom obnovení
 * poslala dve rovnaké požiadavky na endpoint, ktorého doc-blok výslovne žiada
 * opak. `useStatus()` sa tu volá RAZ a výsledok sa posunie do oboch.
 *
 * ROZLOŽENIE SA TU NEMENÍ. Hlavička zostáva jeden sticky riadok 56 px
 * (`.hdr`) so štyrmi tabmi; pod ňou pribudol pruh so stavom. Bočný panel sa
 * nezavádza a piaty tab nepribúda (K9).
 *
 * Prečo je celý shell client komponent: `Nav` už ním bol (`usePathname`) a
 * značkovanie hlavičky je statické, takže sa nič nestráca — server ho aj tak
 * vykreslí dopredu.
 *
 * Vlastník: L1.
 */
import { HeaderRight } from '@/components/layout/HeaderStatus';
import Nav from '@/components/layout/Nav';
import { navLocks, useStatus } from '@/components/layout/status';
import StatusBar from '@/components/layout/StatusBar';

export function AppHeader() {
  const state = useStatus();
  const locks = navLocks(state);

  return (
    <>
      <header className="hdr">
        <div className="hdr-in">
          <span className="brand">
            Aura <b>Zľavy</b>
          </span>
          <Nav locks={locks} />
          <HeaderRight />
        </div>
      </header>
      <StatusBar state={state} locks={locks} />
    </>
  );
}

export default AppHeader;
