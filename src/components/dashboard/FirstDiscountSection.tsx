'use client';

/**
 * Aura Zľavy — PRÁZDNY STAV, KTORÝ UČÍ (V9; kontrakt dokončenia C3, C4).
 *
 * Kreslí sa namiesto dominanty vtedy, keď v appke NIE JE ani jedna zľava.
 * Dovtedy tam bola veta „Žiadna zľava" a dve tlačidlá — čo je z pohľadu
 * používateľa nerozlíšiteľné od poruchy. Prázdna obrazovka má povedať, čo tam
 * má byť a ako sa to tam dostane (vzor `EmptyState` z predlohy).
 *
 * Sekcia rieši aj tretiu sťažnosť („neviem, čo appka vôbec vie"): posledný
 * riadok vymenúva funkcie, ktoré appka MÁ a používateľ ich nenájde — dočítanie
 * katalógu, strop rozsahu, zastavenie všetkých zápisov, predajnosť, záznam
 * o zápisoch. Je to zoznam MOŽNOSTÍ, nie zoznam toho, čo appke chýba: to druhé
 * má jediné miesto v Nastaveniach (`settings/LockedFeatures.tsx`) a rozširovať
 * sa nesmie.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Nesľubovať, čo appka nevie.** Zľavu appka ZAPÍŠE, ale nikdy ju neruší —
 *    v eshope skončí sama koncom okna (I7). Veta, ktorá by tvrdila opak, by
 *    sľubovala funkciu, ktorá zámerne neexistuje.
 * 2. **Kroky v poradí, v akom sa naozaj robia.** Výber → percento a okno →
 *    potvrdenie. Nie je to sprievodca a `NewDiscount.tsx` ním ani nebude —
 *    tri riadky sú len mapa, nie ďalšia obrazovka.
 * 3. **Čo na to treba, sa tu NEOPAKUJE.** Katalóg, kľúč, rozsah a rozpočet
 *    ukazuje Živý stav hneď pod touto sekciou; druhá kópia tých istých čísel by
 *    sa s ním rozišla.
 *
 * Vlastník: V9.
 */
import Link from 'next/link';

import styles from '@/components/dashboard/overview.module.css';
import EmptyState from '@/components/ui/EmptyState';
import Note from '@/components/ui/Note';

/** Tri kroky prvej zľavy. Poradie je súčasťou obsahu, nie dekorácia. */
const STEPS: readonly { readonly id: string; readonly text: string }[] = [
  { id: 'vyber', text: 'Vyberte produkty v Produktoch — filtre, hľadanie, výber sa pamätá.' },
  { id: 'nastavenie', text: 'V Novej zľave zadajte percento a okno platnosti.' },
  { id: 'potvrdenie', text: 'Pozrite si náhľad a potvrďte. Bez potvrdenia neodíde ani jeden zápis.' },
];

export function FirstDiscountSection() {
  return (
    <section className="sec" data-testid="overview-first-discount">
      <div className="sec-h">
        <h2>Prvá zľava</h2>
      </div>

      <EmptyState
        icon="◇"
        title="Zatiaľ žiadna zľava"
        description="Appka zlacní vybrané produkty na určený čas. Zľava potom v eshope skončí sama."
        action={
          <div className="a">
            <Link className="btn primary" href="/zlavy/nova" data-testid="first-new-campaign">
              Nová zľava
            </Link>
            <Link className="btn" href="/produkty">
              Nájsť ležiaky
            </Link>
          </div>
        }
        testId="first-discount-empty"
      />

      <ol className={styles.steps} data-testid="first-steps">
        {STEPS.map((step) => (
          <li key={step.id}>{step.text}</li>
        ))}
      </ol>

      <Note testId="first-discovery">
        Appka vie aj dočítať katalóg a ukázať predajnosť v{' '}
        <Link href="/produkty">Produktoch</Link>; zdvihnúť strop produktov, zastaviť všetky zápisy
        naraz a ukázať záznam o každom zápise v <Link href="/nastavenia">Nastaveniach</Link>.
      </Note>
    </section>
  );
}

export default FirstDiscountSection;
