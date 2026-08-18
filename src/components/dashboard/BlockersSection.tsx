'use client';

/**
 * Aura Zľavy — PREČO SA NIČ NEDEJE (V9; kontrakt dokončenia C2, kontrakt UI
 * 13. 8. 2026, body 3, 6 a 7).
 *
 * Používateľova druhá sťažnosť znela: „nevidím, prečo sa niečo NEstalo."
 * Appka to pritom vie presne — `lib/status/blockers.ts` je jediný zdroj pravdy
 * o tom, čo blokuje čo, a `GET /api/status` posiela hotový zoznam aj s vetami.
 * Táto sekcia ho len vykreslí. Ani jedna veta sa tu neskladá znova.
 *
 * KEDY SA KRESLÍ A ČO JE V NEJ
 * ----------------------------
 * Bod 3: keď zápisu NIČ nebráni, sekcia sa nekreslí VÔBEC a celou odpoveďou je
 * zelená značka v stavovom pruhu. Rozhoduje o tom `hasObstacles()` — teda či
 * existuje aspoň jedna prekážka úrovne `blokuje` alebo `obmedzuje`.
 *
 * Bod 6: keď sa kreslí, sú v nej VŠETKY TRI úrovne vrátane `informuje`. Trvalé
 * pravidlo (platný pilotný strop, neúplný katalóg) samo sekciu neotvorí, ale
 * keď už raz otvorená je, patrí do nej: človek, ktorý zisťuje, prečo to stojí,
 * potrebuje vidieť aj to, čo cez to prejde. Do 18. 8. mali informatívne riadky
 * vlastnú sekciu „Živý stav"; tá zanikla, lebo opakovala stavový pruh.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Farbu volí spôsob riešenia, nie závažnosť** (`resolutionLook`, pravidlo
 *    z doc-bloku `blockers.ts`). Vyčerpaný denný rozpočet zastavuje všetko,
 *    a napriek tomu je sivý — nie je to chyba, len sa čaká (K2). Závažnosť
 *    preto nesie SLOVO (`SEVERITY_WORD`), nikdy nie farba: bez neho by sa
 *    z troch úrovní v jednom zozname nedalo poznať, čo zastavuje a čo nie.
 * 2. **Každý riadok má ČO a ČO S TÝM.** Prekážka bez ďalšieho kroku je log,
 *    nie obrazovka. Keď prekážka vedie niekam v appke, riadok má aj tlačidlo.
 * 3. **Poradie zo servera sa nemení.** `blockers.ts` ho drží ako súčasť
 *    správania a má naň test; preusporiadanie na obrazovke by to ticho zhodilo.
 * 4. **Domnienka sa prizná.** `assumed` znamená, že veta stojí na fail-closed
 *    predpoklade, lebo sa údaj nedal prečítať. Appka sa nesmie tváriť, že vie.
 *
 * Vlastník: V9.
 */
import Link from 'next/link';

import styles from '@/components/dashboard/overview.module.css';
import {
  hasObstacles,
  pathLabel,
  resolutionLook,
  screenBlockers,
  sigClass,
} from '@/components/dashboard/live-status-model';
import type { BlockerRow, BlockerSeverityCode } from '@/components/dashboard/status-api';
import LockBadge from '@/components/ui/LockBadge';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface BlockersSectionProps {
  /** Prekážky zo `/api/status`; `null` = stav sa nepodarilo prečítať. */
  blockers: readonly BlockerRow[] | null;
}

/**
 * Závažnosť ako SLOVO. Farba patrí spôsobu riešenia, takže bez tohto slova by
 * riadok, ktorý zastavuje zápis, vyzeral rovnako ako riadok, ktorý len hlási
 * platné pravidlo.
 */
const SEVERITY_WORD: Readonly<Record<BlockerSeverityCode, string>> = {
  blokuje: 'zastavuje zápis',
  obmedzuje: 'spomaľuje zápis',
  informuje: 'nezastavuje nič',
};

function Row({ row }: { row: BlockerRow }) {
  const look = resolutionLook(row.resolution);

  return (
    <div className={styles.reason} data-testid="blocker-row" data-blocker={row.id} data-severity={row.severity}>
      <div className={styles.reasonBody}>
        <div className="lvl-2">
          {row.resolution === 'sudo' ? (
            <LockBadge label="Vyžiada si heslo" reason={row.what} />
          ) : (
            <>
              <span className={sigClass(look.tone)}>{look.word}</span> {row.what}
            </>
          )}
        </div>
        <div className="lvl-3">
          <b>{SEVERITY_WORD[row.severity]}</b>
          <span className="sep-dot" aria-hidden="true">
            {' · '}
          </span>
          {row.nextStep}
          {row.assumed ? <span className={styles.assumed}> Appka to teraz nevie overiť.</span> : null}
        </div>
      </div>
      {row.path === null ? null : (
        <Link className="btn sm" href={row.path}>
          {pathLabel(row.path)}
        </Link>
      )}
    </div>
  );
}

export function BlockersSection({ blockers }: BlockersSectionProps) {
  if (blockers === null) return null;
  if (!hasObstacles(blockers)) return null;

  const rows = screenBlockers(blockers);
  const stopped = rows.some((row) => row.severity === 'blokuje');

  return (
    <section className="sec" data-testid="overview-blockers" data-stopped={stopped}>
      <div className="sec-h">
        <h2>{stopped ? 'Prečo sa nezapisuje' : 'Čo appku brzdí'}</h2>
        <div className="act">
          <span className="lvl-3">
            {formatCountSk(rows.length)} {pluralSk(rows.length, 'riadok', 'riadky', 'riadkov')}
          </span>
        </div>
      </div>

      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </section>
  );
}

export default BlockersSection;
