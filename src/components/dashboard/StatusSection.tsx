'use client';

/**
 * Aura Zľavy — DOMINANTA PREHĽADU: „je všetko v poriadku?" (V9, kontrakt UI
 * 13. 8. 2026, body 3–5 a 11).
 *
 * PREČO JE DOMINANTOU VETA A NIE ČÍSLO FRONTY
 * -------------------------------------------
 * Architektúra §1 mala dominantou `3 420 / 8 000` v 64 px. Je to pekné číslo,
 * ale odpovedá na otázku „aké mám čísla" — a používateľ sa na túto obrazovku
 * pozerá kvôli inej: či niekde nehorí. Číslo fronty na ňu neodpovedá ani
 * omylom: `3 420 / 8 000` vyzerá rovnako, keď fronta beží, aj keď stojí od
 * včera. Dominantou je preto VERDIKT — jedna veta v 44 px, ktorá je odpoveďou
 * a nie surovinou na jej odvodenie. Fronta zostáva hneď pod ňou, v 22 px, teda
 * na presne 50 % veľkosti dominanty (P1 povoľuje 55 %).
 *
 * Sekcia zlúčila tri bývalé: „Čo sa práve zapisuje", „Živý stav" a „Prvá
 * zľava". Živý stav zanikol, lebo štyri veci, ktoré ukazoval (spojenie, kľúč,
 * rozpočet, katalóg), od 13. 8. nesie stavový pruh; z neho tu zostal len
 * jednoriadkový RIADOK KONTROL s tým, čo pruh nehovorí.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Nič sa tu nerozhoduje.** Verdikt aj kontroly prichádzajú hotové
 *    z `overview-verdict.ts`, stav fronty z `overview-model.ts`. Oba majú
 *    testy bez prehliadača; podmienka dopísaná do JSX by sa dala overiť len
 *    klikaním.
 * 2. **Dominanta ostáva jedna.** Verdikt je `.lvl-1 .big.sm` (44 px). Číslo
 *    fronty má vlastnú triedu s 22 px a nič iné v tejto sekcii nesmie byť
 *    väčšie. Kto sem vráti `.prog-lg` (64 px) alebo `.calm` (32 px), zhodí P1.
 * 3. **Nula sa nedopĺňa, kreslí sa pomlčka** (bod 5 kontraktu). Keď appka
 *    stav fronty nepozná, je tu `—` a dôvod je pod rozklikom „Prečo —",
 *    rovnako ako v stavovom pruhu. `0 / 0` na prístrojovej doske eshopu je
 *    tvrdenie, nie medzera.
 * 4. **Prázdny stav je JEDNA VETA a JEDNO TLAČIDLO** (bod 11). Tri očíslované
 *    kroky, ktoré tu boli do 18. 8., sa zrušili — návod patrí do rozcestníka
 *    „Čo appka vie" v Nastaveniach. Preto sa v prázdnom stave NEKRESLÍ stĺpec
 *    akcií: druhé tlačidlo „Nová zľava" hneď vedľa prvého by bolo presne to,
 *    čo bod 11 zakazuje.
 * 5. **Fronta sa po odstávke NIKDY nerozbehne sama.** „Pokračovať" je vedomý
 *    klik a v tom jedinom stave je primárnym tlačidlom on, nie „Nová zľava".
 *
 * Vlastník: V9.
 */
import Link from 'next/link';
import { useState } from 'react';

import StateLine from '@/components/dashboard/StateLine';
import styles from '@/components/dashboard/overview.module.css';
import { resumeQueue, stopQueue, type ActionResult } from '@/components/dashboard/api';
import { sigClass } from '@/components/dashboard/live-status-model';
import type { QueueProgress } from '@/components/dashboard/overview-model';
import type { CheckMark, Verdict } from '@/components/dashboard/overview-verdict';
import Note from '@/components/ui/Note';
import { dayMonthSk, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

export interface StatusSectionProps {
  verdict: Verdict;
  /** Kontroly, ktoré stavový pruh nenesie. Poradie určuje model. */
  checks: readonly CheckMark[];
  progress: QueueProgress;
  /** Koľko sa dnes zapísalo a z akého rozpočtu; `null` = nevieme. */
  budget: { spent: number; budget: number; remaining: number } | null;
  /** Čísla pokojného stavu — bežiace, pripravené, zlacnené. */
  calm: { live: number; ready: number; discounted: number };
  /** Veta o tom, čo sa nedalo prečítať; `null` = prečítalo sa všetko. */
  gap: string | null;
  /** Prekreslenie po akcii, ktorá zmenila stav fronty. */
  onChanged: () => void;
}

/* ═══════════════════════════ Malé stavebné diely ══════════════════════════ */

function Dot() {
  return (
    <span className="sep-dot" aria-hidden="true">
      ·
    </span>
  );
}

/** Potvrdenie zastavenia — dvojkrok, nikdy jeden klik (predloha `prehlad.html`). */
function StopQueue({ campaignId, onChanged }: { campaignId: number; onChanged: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result: ActionResult = await stopQueue(campaignId);
    setBusy(false);
    if (result.ok) {
      setNote(null);
      onChanged();
      return;
    }
    setNote(result.message);
  }

  return (
    <details className="stopq" data-testid="queue-stop">
      <summary className="btn ghost">Zastaviť frontu</summary>
      <div className="stopq-b">
        <span>Zapísané zostanú. Zrušiť sa nedajú.</span>
        <button
          type="button"
          className="btn sm danger"
          onClick={() => void run()}
          disabled={busy}
          data-testid="queue-stop-confirm"
        >
          Áno, zastaviť
        </button>
      </div>
      {note === null ? null : <div className={styles.actionNote}>{note}</div>}
    </details>
  );
}

/** Pokračovanie po odstávke — fronta sa sama nerozbehne, čaká na človeka. */
function ResumeQueue({ onChanged }: { onChanged: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await resumeQueue();
    setBusy(false);
    if (result.ok) {
      setNote(null);
      onChanged();
      return;
    }
    setNote(result.message);
  }

  return (
    <>
      <button
        type="button"
        className="btn primary"
        onClick={() => void run()}
        disabled={busy}
        data-testid="queue-resume"
      >
        Pokračovať
      </button>
      {note === null ? null : <div className={styles.actionNote}>{note}</div>}
    </>
  );
}

/* ══════════════════════════ Telo podľa stavu fronty ═══════════════════════ */

/** Fronta zapisuje alebo stojí: číslo, pruh a jeden riadok faktov. */
function RunningBody({
  progress,
  budget,
}: {
  progress: QueueProgress;
  budget: StatusSectionProps['budget'];
}) {
  const paused = progress.mode === 'paused';

  return (
    <div data-testid="queue-running">
      <div className={styles.queueHead}>
        <span className={`num ${styles.queueNum}`} data-testid="queue-number">
          {formatCountSk(progress.done)}{' '}
          <span className={styles.queueOf}>/ {formatCountSk(progress.total)}</span>
        </span>
        <span className={styles.queueName}>
          <b className="lvl-2">{progress.campaignName}</b>
          <br />
          {progress.sentence === null ? null : (
            <StateLine sentence={progress.sentence} testId="queue-state" />
          )}
          <span className="lvl-3">
            <Dot />
            {formatCountSk(progress.total)}{' '}
            {pluralSk(progress.total, 'produkt', 'produkty', 'produktov')}
            {progress.tiersLabel === null ? null : ` · ${progress.tiersLabel}`}
          </span>
        </span>
      </div>

      <div className={paused ? 'bar paused' : 'bar'} aria-hidden="true">
        <i style={{ width: `${progress.percent.toFixed(2)}%` }} />
      </div>

      <div className="prog-meta">
        {progress.finishDay === null ? (
          <span className="lvl-3">Odhad dokončenia zatiaľ nevieme</span>
        ) : (
          <span>
            Hotové <b className="est">{dayMonthSk(progress.finishDay)}</b>
          </span>
        )}
        {progress.dateFrom === null || progress.dateTo === null ? null : (
          <>
            <Dot />
            <span>
              Okno{' '}
              <b>
                {dayMonthSk(progress.dateFrom)} – {dayMonthSk(progress.dateTo)}
              </b>
            </span>
          </>
        )}
        {budget === null ? null : (
          <>
            <Dot />
            <span>
              Dnes zapísaných <b>{formatCountSk(budget.spent)}</b> z {formatCountSk(budget.budget)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/** Nič sa nezapisuje: žiadny pruh na nule, len čísla, ktoré appka naozaj má. */
function CalmBody({
  calm,
  budget,
}: {
  calm: StatusSectionProps['calm'];
  budget: StatusSectionProps['budget'];
}) {
  return (
    <div className="prog-meta" data-testid="queue-calm">
      <span>
        <b>{formatCountSk(calm.live)}</b>{' '}
        {pluralSk(calm.live, 'zľava beží', 'zľavy bežia', 'zliav beží')}
      </span>
      <Dot />
      <span>
        <b>{formatCountSk(calm.ready)}</b>{' '}
        {pluralSk(calm.ready, 'pripravená', 'pripravené', 'pripravených')}
      </span>
      <Dot />
      <span>
        <b>{formatCountSk(calm.discounted)}</b> zlacnených{' '}
        <span className="lvl-3">podľa vlastných zápisov</span>
      </span>
      {budget === null ? null : (
        <>
          <Dot />
          <span>
            Voľných zápisov dnes <b>{formatCountSk(budget.remaining)}</b>
          </span>
        </>
      )}
    </div>
  );
}

/**
 * Stav fronty sa nedá prečítať. Pomlčka namiesto čísla a dôvod pod rozklikom —
 * ten istý tvar, aký má stavový pruh, aby sa pomlčka čítala rovnako všade.
 */
function UnknownBody() {
  return (
    <div data-testid="queue-unknown">
      <div className={styles.queueHead}>
        <span className={`num ${styles.queueNum}`} data-testid="queue-number">
          —
        </span>
      </div>
      <details className={styles.why} data-testid="queue-why">
        <summary>Prečo —</summary>
        <div className="lvl-3">
          Nula by bola tvrdenie o ostrom eshope. Appka ju nedopĺňa, kým čísla nepozná.
        </div>
      </details>
    </div>
  );
}

/* ═══════════════════════════════ Sekcia ═══════════════════════════════════ */

export function StatusSection({
  verdict,
  checks,
  progress,
  budget,
  calm,
  gap,
  onChanged,
}: StatusSectionProps) {
  const empty = progress.mode === 'empty';
  const paused = progress.mode === 'paused';
  const running = progress.mode === 'running' || paused;
  const detailHref = progress.campaignId === null ? '/zlavy' : `/zlavy/${progress.campaignId}`;

  return (
    <section className="sec" data-testid="overview-status" data-verdict={verdict.kind}>
      <div className="sec-h">
        <h2>Stav</h2>
        <div className="act">
          <span className={sigClass(verdict.tone)} data-testid="verdict-word">
            {verdict.word}
          </span>
        </div>
      </div>

      <div className={styles.top}>
        <div>
          <div className="lvl-1">
            <span className="big sm" data-testid="verdict-headline">
              {verdict.headline}
            </span>
            <span className="sub" data-testid="verdict-detail">
              {verdict.detail}
            </span>
          </div>

          <div className={styles.queueBody}>
            {progress.mode === 'unknown' ? <UnknownBody /> : null}
            {progress.mode === 'calm' ? <CalmBody calm={calm} budget={budget} /> : null}
            {running ? <RunningBody progress={progress} budget={budget} /> : null}
            {empty ? (
              <div className="empty" data-testid="overview-empty">
                <div className="t">Zatiaľ nie je žiadna zľava</div>
                <div className="a">
                  <Link className="btn primary" href="/zlavy/nova" data-testid="first-new-campaign">
                    Nová zľava
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Bod 11: v prázdnom stave je jedno tlačidlo a to stojí v ňom samom. */}
        {empty ? null : (
          <div className={styles.actions}>
            {paused ? <ResumeQueue onChanged={onChanged} /> : null}
            <Link
              className={paused ? 'btn' : 'btn primary'}
              href="/zlavy/nova"
              data-testid="overview-new-campaign"
            >
              Nová zľava
            </Link>
            {running ? (
              <Link className="btn ghost" href={detailHref}>
                Detail zľavy
              </Link>
            ) : (
              <Link className="btn ghost" href="/zlavy">
                Zoznam zliav
              </Link>
            )}
            {progress.mode === 'running' && progress.campaignId !== null ? (
              <StopQueue campaignId={progress.campaignId} onChanged={onChanged} />
            ) : null}
          </div>
        )}
      </div>

      <div className={styles.checks} data-testid="overview-checks">
        {checks.map((check) => {
          const mark = (
            <span className={sigClass(check.tone)} data-check={check.id}>
              {check.text}
            </span>
          );
          return check.path === null ? (
            <span key={check.id}>{mark}</span>
          ) : (
            <Link key={check.id} className={styles.checkLink} href={check.path}>
              {mark}
            </Link>
          );
        })}
      </div>

      {gap === null ? null : (
        <div className={styles.gapNote}>
          <Note variant="warn" testId="overview-gap">
            {gap}
          </Note>
        </div>
      )}
    </section>
  );
}

export default StatusSection;
