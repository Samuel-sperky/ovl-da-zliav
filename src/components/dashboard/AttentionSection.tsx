'use client';

/**
 * Aura Zľavy — SEKCIA 2 PREHĽADU: „Čaká na vás" (V9, architektúra §1 TAB 1).
 *
 * Vpravo hore JEDNO primárne tlačidlo `Nová zľava` — je to prvý klik
 * používateľa a druhý najsilnejší prvok obrazovky po čísle fronty (P1).
 *
 * Pod ním dva stĺpce RIADKOV, nie kariet a nie chatbota: vľavo návrhy
 * („čo by sa dalo zlacniť"), vpravo to, čo si pýta pozornosť. Návrh je číslo,
 * sloveso a jedno tlačidlo — nič viac. Vety skladá server (deterministické
 * pravidlá), obrazovka si žiadnu nedopisuje.
 *
 * Posledný riadok vpravo je trvalý a zámerný: zamknuté funkcie sa nesmú ani
 * skryť, ani predstierať. Vysvetlenie má jediné miesto — Nastavenia.
 *
 * Vlastník: V9.
 */
import Link from 'next/link';

import styles from '@/components/dashboard/overview.module.css';
import type { InsightRow } from '@/components/dashboard/api';

export interface AttentionSectionProps {
  /** Zistenia zo servera; `null` = nepodarilo sa načítať. */
  insights: InsightRow[] | null;
}

/** Koľko riadkov sa do stĺpca zmestí, kým sekcia neprerastie obrazovku (P4). */
const MAX_ROWS = 3;

function Row({ row }: { row: InsightRow }) {
  const action = row.action;
  return (
    <div className="suggest">
      {row.tone === 'attention' ? (
        <span className="flag">{row.text}</span>
      ) : (
        <span>{row.text}</span>
      )}
      {action === null ? (
        <Link className="btn sm" href={row.href}>
          Otvoriť
        </Link>
      ) : (
        <Link className="btn sm" href={action.href}>
          {action.label}
        </Link>
      )}
    </div>
  );
}

function Column({
  title,
  rows,
  empty,
  testId,
}: {
  title: string;
  rows: readonly InsightRow[];
  empty: string;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className={`${styles.colh} lvl-3`}>{title}</div>
      {rows.length === 0 ? (
        <div className="suggest">
          <span className="lvl-3">{empty}</span>
        </div>
      ) : (
        rows.map((row) => <Row key={row.id} row={row} />)
      )}
    </div>
  );
}

export function AttentionSection({ insights }: AttentionSectionProps) {
  const suggestions = (insights ?? []).filter((row) => row.tone === 'info').slice(0, MAX_ROWS);
  const attention = (insights ?? []).filter((row) => row.tone === 'attention').slice(0, MAX_ROWS);

  return (
    <section className="sec" data-testid="overview-attention">
      <div className="sec-h">
        <h2>Čaká na vás</h2>
        <div className="act">
          <Link className="btn primary" href="/zlavy/nova" data-testid="overview-new-campaign">
            Nová zľava
          </Link>
        </div>
      </div>

      <div className={styles.mid}>
        <Column
          title="Návrhy"
          rows={suggestions}
          empty={
            insights === null
              ? 'Návrhy sa nepodarilo načítať.'
              : 'Zatiaľ žiadny návrh. Ležiaky nájdete v Produktoch.'
          }
          testId="overview-suggestions"
        />

        <div data-testid="overview-warnings">
          <div className={`${styles.colh} lvl-3`}>Vyžaduje pozornosť</div>
          {attention.map((row) => (
            <Row key={row.id} row={row} />
          ))}
          <div className="suggest">
            <span className="sig lock">Marža a obrátkovosť zamknuté</span>
            <span className="lvl-3">chýbajú nákupné ceny</span>
            <Link className="btn sm" href="/nastavenia">
              Nastavenia
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default AttentionSection;
