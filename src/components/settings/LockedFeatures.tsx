'use client';

/**
 * Aura Zľavy — ZAMKNUTÉ FUNKCIE (V12; kontrakt V3, bod K-osem; architektúra §5).
 *
 * Eshop dnes nevracia kategóriu, kov, typ šperku, nákupné ceny ani sklad
 * nevariantných produktov. Appka to nesmie skrývať ani predstierať — a toto je
 * JEDINÉ miesto v celej appke, kde je k tomu vysvetlenie. Vo filtroch a
 * v bunkách tabuliek zostáva len tlmená pomlčka; žiadny žltý pruh cez stránku,
 * žiadne opakované hlášky pri každom čísle, žiadne počítadlo v hlavičke.
 *
 * Tlačidlo skopíruje zoznam do schránky, aby si ho používateľ mohol poslať
 * dodávateľovi eshopu sám. Appka žiadny e-mail neposiela.
 *
 * Vlastník: V12.
 */
import { Fragment, useState } from 'react';

import Button from '@/components/ui/Button';

interface LockedRow {
  readonly feature: string;
  readonly missing: string;
}

/** Presne štyri riadky z architektúry §5. Piaty sa sem nevymýšľa. */
export const LOCKED_FEATURES: readonly LockedRow[] = [
  { feature: 'Filter podľa kategórie a kovu', missing: 'zoznam kategórií a kovov' },
  { feature: 'Marža a odhad dopadu', missing: 'nákupné ceny' },
  { feature: 'Obrátkovosť', missing: 'nákupné ceny' },
  { feature: 'Sklad nevariantných produktov', missing: 'stavy skladu' },
];

/** Text do schránky — čistá funkcia, aby sa dal otestovať bez prehliadača. */
export function lockedFeaturesText(rows: readonly LockedRow[] = LOCKED_FEATURES): string {
  const lines = rows.map((r) => `- ${r.feature}: chýba ${r.missing}`);
  return [
    'Aura Zľavy — čo appke chýba z rozhrania eshopu:',
    ...lines,
    '',
    'Bez týchto údajov ostávajú uvedené funkcie v appke viditeľné, ale vypnuté.',
  ].join('\n');
}

export function LockedFeatures() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(lockedFeaturesText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Bez práv na schránku si používateľ text označí sám — je na obrazovke.
      setCopied(false);
    }
  }

  return (
    <section className="sec" id="zamknute" data-testid="locked-features">
      <div className="sec-h">
        <h2>Zamknuté funkcie</h2>
        <div className="act">
          <Button small onClick={() => void copy()} data-testid="locked-copy">
            {copied ? 'Skopírované' : 'Skopírovať zoznam pre dodávateľa eshopu'}
          </Button>
        </div>
      </div>
      {/* Zoznam, nie rámovaná tabuľka. Slovo „chýba" nesie každý riadok sám,
          takže hlavička „Funkcia / Chýba" ani rám nemajú čo pridať — a na
          podstránke s piatimi sekciami bolo tých 192 px cítiť. Text je do
          písmena ten istý; zmenilo sa iba, ako je poskladaný, a ostáva celý
          na POVRCHU: pod rozklik tento zoznam nesmie (kontrakt bod 18). */}
      <div className="locked-list" data-testid="locked-list">
        {LOCKED_FEATURES.map((row) => (
          <Fragment key={row.feature}>
            <span className="lf-f">{row.feature}</span>
            <span className="lf-m">chýba {row.missing}</span>
          </Fragment>
        ))}
      </div>
      <p className="set-note gap-t" data-testid="locked-sold">
        Predané kusy fungujú vždy — tie appka počíta z objednávok.
      </p>
    </section>
  );
}

export default LockedFeatures;
