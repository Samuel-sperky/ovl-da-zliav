'use client';

/**
 * Aura Zľavy — STAVOVÝ PÁS PREHĽADU (V4, kontrakt §2 bod 1).
 *
 * OTÁZKA, KTORÚ TENTO PÁS ZODPOVEDÁ, JE STÁLE „je všetko v poriadku?" — len
 * prestala byť tou PRVOU otázkou obrazovky.
 *
 * ČO SA 28. 8. 2026 ZMENILO A PREČO
 * ─────────────────────────────────
 * Do tohto dňa bola dominantou Prehľadu sekcia „Stav": číslo fronty v 44 px,
 * pásmo štyroch čísel a riadok kontrol — vrchná tretina obrazovky, a to aj
 * vtedy, keď bolo všetko zelené a nebolo čo riešiť. Otázka, s ktorou sa človek
 * na prvú stranu naozaj chodí pozerať („čo sa predáva, čo leží, čo robia moje
 * zľavy", D113), sa tým odsunula pod ohyb.
 *
 * Sekcia „Stav" NEZMIZLA a ani sa neprepísala. Zúžila sa do jedného riadku a
 * celá pôvodná sekcia zostáva pod rozklikom — vrátane tlačidiel, ktoré vedia
 * frontu zastaviť a rozbehnúť. To je zámer: keby sa pás pokúsil pôvodnú sekciu
 * ZASTÚPIT vlastnými vetami, vznikla by druhá formulácia toho istého stavu a
 * jedna z nich by sa časom rozišla s pravdou.
 *
 * TRI VECI, KTORÉ SA TU NESMÚ POKAZIŤ
 * ───────────────────────────────────
 *
 *  1. **PREKÁŽKY NIKDY NEIDÚ POD ROZKLIK.** Kreslí ich `BlockersSection` a stojí
 *     MIMO tohto komponentu, hneď pod pásom. Bez kľúča na zápis je celý zvyšok
 *     obrazovky dekorácia — grafy sú pravdivé a appka pritom nezapíše ani jednu
 *     zľavu. Zabaliť prekážku do `<details>` by z povinného čítania spravilo
 *     voliteľné.
 *  2. **PÁS SA SÁM OTVORÍ, KEĎ NIE JE ZELENO.** `open` je predvolene `true` pri
 *     každom verdikte okrem `ok`. Zavretý pás nad zastavenou frontou by bol
 *     presne to, čo tu už raz prežilo do produkcie: stav, ktorý sa nedá
 *     prehliadnuť, schovaný za jedno kliknutie.
 *  3. **TRI KANÁLY V JEDNOM UZLE.** Farba (trieda tónu), značka (`<svg>`) aj
 *     slovo verdiktu držia pohromade, presne ako v `StatusSection`. Farba sama
 *     nie je informácia.
 *
 * Rozklik je `<details>`, nie stav v Reacte. Nič sa tým neobnovuje, nič sa
 * nesynchronizuje a po prekreslení obrazovky si prehliadač otvorenie pamätá sám.
 *
 * Vlastník: V4.
 */
import type { ReactNode } from 'react';

import styles from '@/components/dashboard/overview.module.css';
import { sigClass } from '@/components/dashboard/live-status-model';
import type { Verdict } from '@/components/dashboard/overview-verdict';
import { SigMark } from '@/components/ui/StatusMark';
import { formatCountSk } from '@/lib/ui/vocabulary';
import { NEVIEME } from '@/lib/ui/product-label';

export interface StatusBandProps {
  verdict: Verdict;
  /** Kľúč na zápis do shopu. `null` = nevieme, a to nie je „nie je". */
  keyPresent: boolean | null;
  /** Koľko sa dnes zapísalo a z akého rozpočtu; `null` = nevieme. */
  budget: { spent: number; budget: number } | null;
  /** Položiek vo fronte, ktoré ešte nie sú zapísané. `null` = nevieme. */
  pending: number | null;
  /** Pôvodná sekcia „Stav" — celá, pod rozklikom. */
  children: ReactNode;
}

/**
 * Kľúč ako fakt, nie ako uistenie.
 *
 * `null` sa NESMIE zliať s `false`: „nevieme, či kľúč je" a „kľúč nie je" vedú
 * k dvom rôznym ďalším krokom a to prvé je priznanie, nie diagnóza.
 */
function keySentence(present: boolean | null): string {
  if (present === null) return `Kľúč ${NEVIEME}`;
  return present ? 'Kľúč vložený' : 'Kľúč chýba';
}

export function StatusBand({ verdict, keyPresent, budget, pending, children }: StatusBandProps) {
  /* Zeleno = zavreté. Všetko ostatné sa otvorí samo — viď bod 2 v hlavičke. */
  const open = verdict.kind !== 'ok';

  return (
    <details
      className={styles.bandFold}
      open={open}
      data-testid="overview-status-band"
      data-verdict={verdict.kind}
    >
      <summary className={styles.band}>
        <span className={sigClass(verdict.tone)} data-testid="band-verdict">
          <SigMark variant={verdict.tone} />
          {verdict.word}
        </span>
        <span className="lvl-3" data-testid="band-detail">
          {verdict.detail}
        </span>
        <span className={styles.bandFacts}>
          <span className="lvl-3" data-testid="band-key">
            {keySentence(keyPresent)}
          </span>
          <span className="lvl-3" data-testid="band-budget">
            {budget === null
              ? `Zápisy ${NEVIEME}`
              : `Zápisy ${formatCountSk(budget.spent)}/${formatCountSk(budget.budget)} dnes`}
          </span>
          <span className="lvl-3" data-testid="band-pending">
            {pending === null ? `Fronta ${NEVIEME}` : `Fronta ${formatCountSk(pending)}`}
          </span>
          {/* Slovo, nie len trojuholník: čo sa pod rozklikom skrýva, sa musí dať
              prečítať bez toho, aby to človek najprv otvoril. */}
          <span className="lvl-3">Podrobný stav</span>
        </span>
      </summary>

      <div className={styles.bandBody}>{children}</div>
    </details>
  );
}

export default StatusBand;
