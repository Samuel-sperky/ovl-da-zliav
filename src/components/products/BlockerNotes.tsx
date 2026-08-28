'use client';

/**
 * Aura Zľavy — PREKÁŽKA AKO VYSVETLIVKA PRI MIESTE VÝSKYTU (V10).
 *
 * `lib/status/blockers.ts` vie o každej prekážke štyri veci: čo sa deje
 * (`what`), čo s tým (`nextStep`), kam v appke to vedie (`path`) a KTO to
 * odstráni (`resolution`). Tento komponent z toho robí značky — a nič viac.
 * Ani jedno slovo tu nevzniká; vety prichádzajú hotové aj s číslami.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Tón podľa `resolution`, nikdy podľa `severity`.** Je to napísané
 *    v doc-bloku `blockers.ts` a je to jediný spôsob, ako sa čakanie na denný
 *    rozpočet neprefarbí na poruchu — vyčerpaný rozpočet je `blokuje`, a pritom
 *    sa nič nepokazilo (K2). Mapovanie drží `noteVariantForResolution()`.
 * 2. **Prekážka, ktorú otvorí potvrdenie, vyzerá ako ZÁMOK.**
 *    `resolution: 'potvrdenie'` dostane `LockBadge` s dôvodom — používateľ tak
 *    vidí, že cesta existuje, ešte skôr, než ju vedome otvorí. Zámok bez dôvodu
 *    sa v tejto appke nekreslí, preto ide do `reason` celá veta, nie len názov.
 *    Kód sa do 27. 8. 2026 volal `sudo` a zámok sľuboval heslo (D105).
 * 3. **Domnienka sa PRIZNÁVA.** `assumed: true` znamená, že veta stojí na
 *    fail-closed predpoklade, lebo sa údaj nedal prečítať. Appka sa nesmie
 *    tváriť, že niečo vie — je to tretí riadok vysvetlivky, nie skrytý detail.
 * 4. **Odkaz na obrazovku, na ktorej práve stojím, sa nekreslí.** Odkaz „choď
 *    tam, kde si" je klamlivý sľub, že sa niekam dostaneš.
 *
 * Vlastník: V10.
 */
import Link from 'next/link';

import {
  clockPhrase,
  noteVariantForResolution,
  pathLabel,
} from '@/components/products/catalog-status';
import LockBadge from '@/components/ui/LockBadge';
import Note from '@/components/ui/Note';
import type { Blocker } from '@/lib/status/blockers';

/* ═══════════════════════════ 1. Kúsky vety ════════════════════════════════ */

function BlockerBody({ blocker, here }: { blocker: Blocker; here: string | null }) {
  const label = blocker.path === null || blocker.path === here ? null : pathLabel(blocker.path);
  const clears = blocker.passableNow ? null : clockPhrase(blocker.clearsAt);

  return (
    <>
      <span>{blocker.what}</span>{' '}
      <span className="lvl-3" style={{ display: 'inline' }}>
        {blocker.nextStep}
      </span>
      {clears === null ? null : (
        <span className="lvl-3" style={{ display: 'inline' }}>
          {' '}
          Uvoľní sa {clears}.
        </span>
      )}
      {blocker.assumed ? (
        <span className="lvl-3" style={{ display: 'inline' }}>
          {' '}
          Appka si to teraz nevie overiť, preto počíta s prísnejšou možnosťou.
        </span>
      ) : null}
      {label === null || blocker.path === null ? null : (
        <>
          {' '}
          <Link href={blocker.path} className="lvl-3">
            Otvoriť {label}
          </Link>
        </>
      )}
    </>
  );
}

/* ═══════════════════════════ 2. Zoznam ════════════════════════════════════ */

export interface BlockerNotesProps {
  /** Už vyfiltrované prekážky — komponent ich neprehadzuje ani nedopĺňa. */
  blockers: readonly Blocker[];
  /**
   * Cesta obrazovky, na ktorej sa práve stojí. Prekážka, ktorá vedie sem, sa
   * vykreslí bez odkazu.
   */
  here?: string;
  /** `data-testid` obalu. */
  testId?: string;
}

export function BlockerNotes({ blockers, here, testId }: BlockerNotesProps) {
  if (blockers.length === 0) return null;

  return (
    // Stĺpec, nie riadok: vysvetlivky sú vety a dve vedľa seba by sa zúžili na
    // dva úzke stĺpce textu. `flex-start` necháva zámku aj krátkej vete ich
    // vlastnú šírku — dlhá veta sa aj tak zalomí na šírku obrazovky.
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '8px',
        marginTop: '8px',
      }}
      data-testid={testId}
    >
      {blockers.map((blocker) =>
        // Zámok kreslíme len tam, kde cesta existuje a otvorí ju potvrdenie.
        // Kým prekážka nič nezastavuje, je to tichá poznámka o pravidle —
        // a presne tak má vyzerať: strop sa má vidieť skôr, než doň niekto
        // narazí.
        blocker.resolution === 'potvrdenie' && blocker.severity === 'informuje' ? (
          <LockBadge
            key={blocker.id}
            reason={<BlockerBody blocker={blocker} here={here ?? null} />}
            testId={`blocker-${blocker.id}`}
          />
        ) : (
          <Note
            key={blocker.id}
            variant={noteVariantForResolution(blocker.resolution)}
            testId={`blocker-${blocker.id}`}
          >
            <BlockerBody blocker={blocker} here={here ?? null} />
          </Note>
        ),
      )}
    </div>
  );
}

export default BlockerNotes;
