'use client';

/**
 * Aura Zľavy — KOSTRA APPKY: ľavý panel a obsahová plocha
 * (kontrakt kostry 19. 8. 2026, rozhodnutie K1).
 *
 * PREČO TOTO VZNIKLO
 * ------------------
 * Do 19. 8. mala appka tri vodorovné pásy nad obsahom — pruh PRODUKCIA,
 * hlavičku so štyrmi tabmi a stavový pruh — teda ≈ 140 px chrómu, než sa appka
 * vôbec začala. K tomu boli všetky karty 100 % šírky a naskladané pod sebou,
 * takže sa nič nezarovnávalo naprieč nimi a oko nemalo kam ísť. Používateľ to
 * pomenoval ako šum a mal pravdu: nebolo to od sparse obsahu, ale od chýbajúcej
 * štruktúry.
 *
 * Kostra je teraz **pracovný nástroj**, nie stránka: navigácia vľavo, stav appky
 * v JEDNOM riadku nad obsahom, obsah v mriežke.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Jedno čítanie stavu pre celý shell.** `useStatus()` sa volá RAZ a výsledok
 *    sa posunie navigácii, topbaru aj pätke sidebaru. Keby si ho každý bral sám,
 *    appka pošle pri každom obnovení tri rovnaké požiadavky na `/api/status` —
 *    presne to, čo doc-blok toho endpointu zakazuje. Toto pravidlo sem prišlo
 *    z pôvodného `AppHeader.tsx` a platí ďalej.
 *
 * 2. **Chróm je JEDEN riadok.** Produkčné varovanie je štítok v topbare, nie
 *    celý pás cez celú šírku. Kto sem pridá druhý vodorovný pás, vráti appku
 *    tam, odkiaľ odišla. (Presun kľúča a rozpočtu do päty sidebaru je ďalší
 *    krok — dnes ich nesie stavový pruh v topbare.)
 *
 * 3. **Sidebar sa neskladá na ikonky.** Štyri položky to nepotrebujú a ikonka
 *    bez slova porušuje pravidlo appky „stav nikdy nie je len farba" aj jeho
 *    ducha — navigácia bez slov je to isté pre čítačku obrazovky.
 *
 * 4. **Pod 1100 px sa sidebar mení na horný riadok.** Appka má fungovať na
 *    720 px (P4). Mobil sa nerieši, ale polovica obrazovky áno.
 *
 * Vlastník: kontrakt kostry, 19. 8. 2026.
 */
import { HeaderReadOnlyNotice, HeaderRight } from '@/components/layout/HeaderStatus';
import Nav from '@/components/layout/Nav';
import { navLocks, useStatus } from '@/components/layout/status';
import StatusBar from '@/components/layout/StatusBar';
import ProductionBar from '@/components/layout/ProductionBar';
import { APP_VERSION } from '@/version';

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const state = useStatus();
  const locks = navLocks(state);

  return (
    <div className="shell">
      <aside className="shell-side" data-testid="app-sidebar">
        <div className="shell-brand">
          Aura <b>Zľavy</b>
        </div>

        {/* `Nav` zostáva ten istý komponent aj s tou istou logikou zámkov —
            zvislé usporiadanie robí CSS (`.shell-side .tabs`), nie druhá navigácia. */}
        <Nav locks={locks} />

        {/* Trvalé fakty — dokedy platí kľúč a koľko zápisov dnes ostáva.
            Nie sú to správy, preto nepatria do riadku nad obsahom; v topbare
            navyše spôsobovali, že sa štyri menovky na 1280 px odsekli. */}
        <div className="shell-side-foot">
          <StatusBar state={state} place="side" />
        </div>

      </aside>

      <div className="shell-main">
        <div className="topbar" data-testid="app-topbar">
          <ProductionBar />
          <StatusBar state={state} place="topbar" />
          <HeaderRight state={state} />
        </div>

        {/* Výzva „len na čítanie" je jediná vec, ktorá smie pribudnúť ako druhý
            riadok — a len keď kľúč chýba alebo vypršal. Vtedy to nie je šum,
            ale jediná cesta, ako sa appka dá znovu rozbehnúť. */}
        <HeaderReadOnlyNotice state={state} />

        <main className="wrap">{children}</main>

        <footer className="shell-foot">
          v{APP_VERSION} · beží lokálne na <code>127.0.0.1:3070</code> · stavy
          zliav sú „posledný vlastný zápis“, nie stav shopu
        </footer>
      </div>
    </div>
  );
}

export default AppShell;
