'use client';

/**
 * Aura Zľavy — SPOLOČNÝ CHRÓM: hlavička, stavový pruh a read-only výzva.
 *
 * Existuje z jediného dôvodu: **jedno čítanie stavu pre celý shell**. Navigácia
 * potrebuje vedieť, čo je zamknuté, stavový pruh potrebuje tie isté fakty
 * a read-only výzva takisto. Keby si každý z nich volal `/api/status` sám,
 * appka by pri každom obnovení poslala tri rovnaké požiadavky na endpoint,
 * ktorého doc-blok výslovne žiada opak. `useStatus()` sa tu volá RAZ a výsledok
 * sa posunie všetkým.
 *
 * KOĽKO RIADKOV MÁ CHRÓM
 * ----------------------
 * Pokojný stav sú TRI: pruh PRODUKCIA (D6), hlavička so štyrmi tabmi (56 px)
 * a stavový pruh (jeden riadok). Štvrtý riadok pribudne výhradne vtedy, keď
 * kľúč chýba alebo vypršal — vtedy je pod pruhom výzva s odkazom na opravu.
 * Bočný panel sa nezavádza a piaty tab nepribúda (K9).
 *
 * Prečo je celý shell client komponent: `Nav` už ním bol (`usePathname`)
 * a značkovanie hlavičky je statické, takže sa nič nestráca — server ho aj tak
 * vykreslí dopredu.
 *
 * Vlastník: L1.
 */
import { HeaderReadOnlyNotice, HeaderRight } from '@/components/layout/HeaderStatus';
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
          <HeaderRight state={state} />
        </div>
      </header>
      <StatusBar state={state} />
      <HeaderReadOnlyNotice state={state} />
    </>
  );
}

export default AppHeader;
