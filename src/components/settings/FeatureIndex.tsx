'use client';

/**
 * Aura Zľavy — ČO APPKA VIE A KDE TO JE (Nastavenia, prvá sekcia).
 *
 * Používateľ mesiace nevedel, že strop desiatich produktov je len prepínač
 * v Nastaveniach. Nebolo to skryté — bolo to štvrté z desiatich rovnako
 * vyzerajúcich blokov. Tento zoznam je odpoveď na otázku „čo tá appka vlastne
 * vie": jedna hustá tabuľka, v ktorej každý riadok vedie priamo na miesto, kde
 * sa daná vec robí.
 *
 * ČO TENTO ZOZNAM NIE JE
 * ----------------------
 * NIE JE to zoznam toho, čo appke chýba. To má svoje jediné miesto v sekcii
 * „Zamknuté funkcie" a rozširovať sa nesmie — kategórie, nákupné ceny a sklad
 * sa vysvetľujú tam a nikde inde. Tu sú výhradne veci, ktoré appka MÁ.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 * 1. **Každý odkaz musí niekam viesť.** Riadok, ktorý ukazuje na kotvu, čo na
 *    stránke nie je, je horší než chýbajúci riadok — používateľ klikne a nič sa
 *    nestane, takže prestane veriť celej tabuľke. Zhodu kotiev so sekciami
 *    stráži test.
 * 2. **Sľubuje sa len to, čo appka naozaj robí.** Žiadny riadok „pripravujeme".
 * 3. **Poradie je od najdôležitejšieho.** Prvý riadok je rozsah zliav, lebo
 *    presne ten používateľ nenašiel.
 *
 * Vlastník: V12.
 */
import Link from 'next/link';

/** Jedna schopnosť appky a miesto, kde sa používa. */
export interface AppCapability {
  /** Čo appka vie — veta, ktorá začína činnosťou. */
  readonly what: string;
  /** Ako sa miesto menuje na obrazovke. */
  readonly where: string;
  /** Kotva na tejto stránke (`#…`), alebo cesta na iný tab. */
  readonly href: string;
}

/**
 * Zoznam schopností. Poradie je poradie dôležitosti, nie poradie sekcií na
 * stránke — hore je to, čo používateľ hľadal a nenašiel.
 */
export const APP_CAPABILITIES: readonly AppCapability[] = [
  {
    what: 'Zdvihnúť strop jednej zľavy z desiatich produktov na tisíce',
    where: 'Rozsah zliav',
    href: '#rozsah',
  },
  {
    what: 'Povedať, prečo sa práve teraz nič nezapisuje',
    where: 'Zápisy do eshopu',
    href: '#zapisy',
  },
  {
    what: 'Ukázať, koľko zápisov a koľko čítaní ostáva na dnes',
    where: 'Rozpočty',
    href: '#rozpocet',
  },
  {
    what: 'Zastaviť sa sama, keď by zapisovala rýchlejšie, než je bezpečné',
    where: 'Poistky',
    href: '#poistky',
  },
  {
    what: 'Zmazať oba kľúče a zrušiť čakajúce zľavy, keď kľúč unikol',
    where: 'Červená zóna',
    href: '#cervena',
  },
  {
    what: 'Vypísať každý pokus o zápis aj s tým, ako skončil',
    where: 'História',
    href: '#historia',
  },
  {
    what: 'Zabaliť stav appky do súboru, ktorý sa dá poslať na pomoc',
    where: 'Diagnostika',
    href: '#diagnostika',
  },
  {
    what: 'Priznať, čo z rozhrania eshopu nedostane',
    where: 'Zamknuté funkcie',
    href: '#zamknute',
  },
  {
    what: 'Načítať katalóg eshopu a vyberať z neho produkty do zľavy',
    where: 'Produkty',
    href: '/produkty',
  },
  {
    what: 'Spočítať z objednávok, čo sa predáva',
    where: 'Prehľad',
    href: '/',
  },
];

/** Kotva na tej istej stránke, alebo odkaz na iný tab? */
export function isAnchor(href: string): boolean {
  return href.startsWith('#');
}

export function FeatureIndex() {
  return (
    <section className="sec" id="covie" data-testid="feature-index">
      <div className="sec-h">
        <h2>Čo appka vie a kde to je</h2>
        <div className="act lvl-3">Klik vedie priamo na to miesto</div>
      </div>

      <div className="tbl-frame">
        <table className="tbl plain">
          <thead>
            <tr>
              <th>Appka vie</th>
              <th>Nájdeš to tu</th>
            </tr>
          </thead>
          <tbody data-testid="feature-index-rows">
            {APP_CAPABILITIES.map((row) => (
              <tr key={row.href}>
                <td className="name">{row.what}</td>
                <td data-l="Nájdeš to tu">
                  {isAnchor(row.href) ? (
                    <a className="set-jump" href={row.href}>
                      {row.where}
                    </a>
                  ) : (
                    <Link className="set-jump" href={row.href}>
                      {row.where}
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tbl-foot">
          <span>
            Čo appke z eshopu chýba, je vysvetlené na jednom mieste — v Zamknutých funkciách
            nižšie. Inde v appke sú na tých miestach len tlmené pomlčky.
          </span>
        </div>
      </div>
    </section>
  );
}

export default FeatureIndex;
