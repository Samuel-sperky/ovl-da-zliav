'use client';

/**
 * Aura Zľavy — PONUKA UVOĽNENIA ROZSAHU (kontrakt dokončenia B1, R4, C3;
 * kontrakt V3 K1).
 *
 * Appka má dva režimy rozsahu: pilotný so stropom desiatich produktov na jednu
 * zľavu a plný až do desaťtisíc. Prepínač žije v Nastaveniach a chráni ho heslo.
 * Lenže používateľ o ňom nevie — a keď narazil na strop, obrazovka mu výber
 * ticho orezala a nepovedala prečo. Presne to je jeden z dôvodov, prečo appku
 * nevedel použiť.
 *
 * Tento panel je odpoveď: keď strop výber orezal, obrazovka to POVIE, ukáže obe
 * čísla vedľa seba a rovno ponúkne cestu von — aj s upozornením, že si vyžiada
 * heslo. Odmietnuť bez ponuky je tu zakázané.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Veta prichádza z `lib/status/blockers.ts`.** Prekážka `scope_pilot_cap`
 *    má hotové vety s číslami aj s ďalším krokom a je označená ako riešiteľná
 *    heslom. Prepísať ju tu vlastnými slovami by znamenalo dve formulácie toho
 *    istého pravidla, ktoré sa časom rozídu.
 * 2. **Panel neprepína rozsah.** Prepnutie je zmena, ktorá otvorí zápis do
 *    desaťtisíc produktov naraz — patrí do Nastavení, kde má vlastné potvrdenie
 *    a heslo. Odtiaľto vedie odkaz, nie akcia.
 * 3. **Zámok stojí pri ponuke, nie v pätke.** Používateľ má vedieť o hesle
 *    SKÔR, než klikne — inak sa dozvie až v dialógu a bude to prekvapenie.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';

import styles from '@/components/campaigns/zlavy.module.css';
import { productCount, type BlockerCard } from '@/components/campaigns/queue-model';
import LockBadge from '@/components/ui/LockBadge';
import Note from '@/components/ui/Note';
import { formatCountSk } from '@/lib/ui/vocabulary';

export interface ScopeReleaseProps {
  /** Koľko produktov by do zľavy išlo, keby strop nebol. */
  wanted: number;
  /** Koľko ich prejde teraz — po orezaní stropom. */
  allowed: number;
  /**
   * Prekážka rozsahu z jediného zdroja pravdy. `null` = nepodarilo sa ju
   * získať; panel potom povie aspoň obe čísla a cestu do Nastavení.
   */
  blocker: BlockerCard | null;
  testId?: string;
}

export function ScopeRelease({ wanted, allowed, blocker, testId }: ScopeReleaseProps) {
  const dropped = Math.max(0, wanted - allowed);
  const needsSudo = blocker === null ? true : blocker.resolution === 'sudo';

  return (
    <div className={styles.scopeRelease} data-testid={testId ?? 'scope-release'}>
      <Note variant="warn">
        {blocker === null
          ? `Výberu vyhovuje ${productCount(wanted)}, ale na jednu zľavu teraz prejde len ${productCount(allowed)} — ${formatCountSk(dropped)} sa nezapíše.`
          : blocker.what}
      </Note>

      <div className={styles.scopeNumbers}>
        <div>
          <div className="lvl-3">Výberu vyhovuje</div>
          <div className={styles.scopeBig}>{formatCountSk(wanted)}</div>
        </div>
        <div>
          <div className="lvl-3">Na jednu zľavu prejde</div>
          <div className={styles.scopeBig} data-testid="scope-allowed">
            {formatCountSk(allowed)}
          </div>
        </div>
        <div>
          <div className="lvl-3">Ostane nezlacnených</div>
          <div className={styles.scopeBig}>{formatCountSk(dropped)}</div>
        </div>
      </div>

      <div className={styles.scopeStep}>
        {blocker === null
          ? 'Strop platí na jednu zľavu. Zúžte výber, alebo v Nastaveniach prepnite rozsah na plný.'
          : blocker.nextStep}
      </div>

      <div className="row wrapx gap-t">
        <Link className="btn primary sm" href="/nastavenia#rozsah" data-testid="scope-release-link">
          Prepnúť rozsah v Nastaveniach
        </Link>
        {needsSudo ? (
          <LockBadge
            label="Vyžiada si heslo"
            reason="Plný rozsah otvorí zápis do tisícov produktov naraz, preto ho appka nepustí bez overenia."
            testId="scope-release-lock"
          />
        ) : null}
      </div>
    </div>
  );
}

export default ScopeRelease;
