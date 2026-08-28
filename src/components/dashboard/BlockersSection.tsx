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
 * 1b. **Slovo o závažnosti je slovom ZNAČKY** (oprava D6, 19. 8. 2026). Do
 *    tohto dátumu stálo na začiatku druhého riadku textu, teda mimo značky,
 *    ku ktorej patrí, a hneď za ním pokračovala veta o ďalšom kroku — čitateľ
 *    ho prečítal ako začiatok tej vety a tri riadky pod sebou sa nedali prejsť
 *    očami po stĺpci. Teraz značka nesie všetky tri kanály stavu naraz: FARBU
 *    a GLYF podľa spôsobu riešenia, SLOVO podľa závažnosti. Spôsob riešenia
 *    tým o slovo neprišiel — presunul sa k ďalšiemu kroku, ktorý aj tak
 *    popisuje („rieši sa mimo appky · Zapnúť ich môže len správca…").
 * 1c. **Tón, glyf aj slová prichádzajú z JEDINÉHO slovníka** (19. 8. 2026,
 *    `ui/blocker-look.ts`). Do tohto dátumu mala sekcia vlastnú tabuľku, kde
 *    bolo `mimo_appky` jantárové a `potvrdenie` malo tlmený „tón" `lock`, kým tab
 *    Zľavy kreslil tú istú prekážku červeno a jantárovo. Slovník je odvtedy
 *    jeden a `SEVERITY_WORD` je v ňom preto, aby ho kreslil aj
 *    `campaigns/BlockerList.tsx` — oprava D6 platila dovtedy na jednej zo
 *    štyroch obrazoviek. Zámok už nie je tón, ale `look.locked`.
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
  screenBlockers,
} from '@/components/dashboard/live-status-model';
import type { BlockerRow } from '@/components/dashboard/status-api';
import { resolutionLook, severityWord, toneSigClass } from '@/components/ui/blocker-look';
import LockBadge from '@/components/ui/LockBadge';
import { ToneSigMark } from '@/components/ui/StatusMark';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface BlockersSectionProps {
  /** Prekážky zo `/api/status`; `null` = stav sa nepodarilo prečítať. */
  blockers: readonly BlockerRow[] | null;
}

function Row({ row }: { row: BlockerRow }) {
  const look = resolutionLook(row.resolution);
  // Zámok už slovo o spôsobe riešenia povie sám („Vyžiada si potvrdenie — …"),
  // takže sa v tlmenom riadku pod ním neopakuje. Dve kópie tej istej vety
  // v jednom riadku sú šum, nie dôraz. `locked` je vlastnosť spôsobu riešenia,
  // nie tón — farba riadku ostáva jantárová ako pri `sam`.
  const locked = look.locked;

  return (
    <div className={styles.reason} data-testid="blocker-row" data-blocker={row.id} data-severity={row.severity}>
      {/* Značka so stavom — vlastný stĺpec, rovnaké x na každom riadku (D6). */}
      <div className={styles.reasonMark}>
        <span className={toneSigClass(look.tone)} data-testid="blocker-severity">
          <ToneSigMark tone={look.tone} />
          {severityWord(row.severity)}
        </span>
      </div>

      <div className={styles.reasonBody}>
        <div className="lvl-2">
          {locked ? <LockBadge label="Vyžiada si potvrdenie" reason={row.what} /> : row.what}
        </div>
        <div className="lvl-3">
          {locked ? null : (
            <>
              {look.word}
              <span className="sep-dot" aria-hidden="true">
                {' · '}
              </span>
            </>
          )}
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
