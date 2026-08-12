'use client';

/**
 * Aura Zľavy — PREČO SA NIČ NEDEJE (V9; kontrakt dokončenia C2).
 *
 * Používateľova druhá sťažnosť znela: „nevidím, prečo sa niečo NEstalo."
 * Appka to pritom vie presne — `lib/status/blockers.ts` je jediný zdroj pravdy
 * o tom, čo blokuje čo, a `GET /api/status` posiela hotový zoznam aj s vetami.
 * Táto sekcia ho len vykreslí. Ani jedna veta sa tu neskladá znova.
 *
 * Sekcia je ZÁMERNE mlčanlivá: keď nič nezastavuje ani nebrzdí, nevykreslí sa
 * vôbec (vráti `null`). Trvalý prázdny panel „žiadne prekážky" by po týždni
 * nikto nečítal a v deň, keď by sa naplnil, by ho nikto nevšimol.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Farbu volí spôsob riešenia, nie závažnosť** (`RESOLUTION_LOOK`, pravidlo
 *    z doc-bloku `blockers.ts`). Vyčerpaný denný rozpočet zastavuje všetko,
 *    a napriek tomu je sivý — nie je to chyba, len sa čaká (K2).
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
  pathLabel,
  resolutionLook,
  screenBlockers,
  sigClass,
} from '@/components/dashboard/live-status-model';
import type { BlockerRow } from '@/components/dashboard/status-api';
import LockBadge from '@/components/ui/LockBadge';

export interface BlockersSectionProps {
  /** Prekážky zo `/api/status`; `null` = stav sa nepodarilo prečítať. */
  blockers: readonly BlockerRow[] | null;
}

function Row({ row }: { row: BlockerRow }) {
  const look = resolutionLook(row.resolution);

  return (
    <div className={styles.reason} data-testid="blocker-row" data-blocker={row.id}>
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
  const rows = screenBlockers(blockers);
  if (rows.length === 0) return null;

  const stopped = rows.some((row) => row.severity === 'blokuje');

  return (
    <section className="sec" data-testid="overview-blockers" data-stopped={stopped}>
      <div className="sec-h">
        <h2>{stopped ? 'Prečo sa nezapisuje' : 'Čo appku brzdí'}</h2>
        <div className="act">
          <span className={sigClass(stopped ? 'warn' : 'idle')}>
            {stopped ? 'zápis teraz neprejde' : 'zapisuje sa pomalšie'}
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
