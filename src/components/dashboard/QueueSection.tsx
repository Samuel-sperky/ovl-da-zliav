'use client';

/**
 * Aura Zľavy — SEKCIA 1 PREHĽADU: fronta (V9, architektúra §1 TAB 1).
 *
 * Dominanta celej obrazovky (P1). Číslo `3 420 / 8 000` v 64 px, pod ním pruh
 * a JEDEN riadok faktov. Piaty prvok tu nie je a rozklik tiež nie — Prehľad je
 * prístrojová doska, nie príručka.
 *
 * Päť podôb podľa predlôh `design/v3/`:
 *
 *   `prehlad.html`            — fronta zapisuje,
 *   `prehlad-pozastavene.html`— po odstávke počítača čaká na potvrdenie,
 *   `prehlad-pokoj.html`      — nič sa nezapisuje, „Všetko beží",
 *   `prazdne-stavy.html`      — ešte nie je žiadna zľava,
 *   a piata, ktorú mockupy nemajú: appka neodpovedala. Vtedy sa NETVRDÍ nič —
 *   nula na prístrojovej doske eshopu je tvrdenie, nie medzera.
 *
 * Fronta sa po odstávke NIKDY nerozbehne sama; „Pokračovať" je vedomý klik.
 *
 * Vlastník: V9.
 */
import Link from 'next/link';
import { useState } from 'react';

import StateLine from '@/components/dashboard/StateLine';
import styles from '@/components/dashboard/overview.module.css';
import { resumeQueue, stopQueue, type ActionResult } from '@/components/dashboard/api';
import type { QueueProgress } from '@/components/dashboard/overview-model';
import { dayMonthSk, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateTimeSk } from '@/lib/ui/format';

export interface QueueSectionProps {
  progress: QueueProgress;
  /** Koľko sa dnes zapísalo a z akého rozpočtu; `null` = nevieme. */
  budget: { spent: number; budget: number; remaining: number } | null;
  /** Čísla pokojného stavu — bežiace, pripravené, zlacnené. */
  calm: { live: number; ready: number; discounted: number };
  /** Prekreslenie po akcii, ktorá zmenila stav fronty. */
  onChanged: () => void;
}

/* ═══════════════════════════ Malé stavebné diely ══════════════════════════ */

function Bar({ percent, paused }: { percent: number; paused: boolean }) {
  return (
    <div className={paused ? 'bar paused' : 'bar'} aria-hidden="true">
      <i style={{ width: `${percent.toFixed(2)}%` }} />
    </div>
  );
}

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
        className="btn primary lg"
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

/* ═══════════════════════════════ Sekcia ═══════════════════════════════════ */

export function QueueSection({ progress, budget, calm, onChanged }: QueueSectionProps) {
  /* ── appka neodpovedala ── */
  if (progress.mode === 'unknown') {
    return (
      <section className="sec" data-testid="overview-queue" data-mode="unknown">
        <div className="sec-h">
          <h2>Stav</h2>
        </div>
        <div className="empty">
          <div className="t">Stav fronty nevieme</div>
          <div>Appka neodpovedala na otázku, čo sa práve zapisuje.</div>
          <div className="a">
            <Link className="btn" href="/nastavenia">
              Otvoriť Nastavenia
            </Link>
          </div>
        </div>
      </section>
    );
  }

  /* ── ešte niet čo ukazovať ── */
  if (progress.mode === 'empty') {
    return (
      <section className="sec" data-testid="overview-queue" data-mode="empty">
        <div className="sec-h">
          <h2>Stav</h2>
        </div>
        <div className="empty">
          <div className="t">Žiadna zľava</div>
          <div>Začnite tým, čo sa nepredáva.</div>
          <div className="a">
            <Link className="btn primary" href="/zlavy/nova">
              Nová zľava
            </Link>
            <Link className="btn" href="/produkty">
              Nájsť ležiaky
            </Link>
          </div>
        </div>
      </section>
    );
  }

  /* ── nič sa nezapisuje (pokojný stav) ── */
  if (progress.mode === 'calm') {
    return (
      <section className="sec" data-testid="overview-queue" data-mode="calm">
        <div className="sec-h">
          <h2>Stav</h2>
          <div className="act">
            <span className="sig ok">nič sa nezapisuje</span>
          </div>
        </div>
        <div className={styles.top}>
          <div className="calm">
            <div>
              <div className={`t ${styles.calmBig}`}>Všetko beží</div>
              <div className="prog-meta" style={{ marginTop: '10px' }}>
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
                      Rozpočet na dnes <b>{formatCountSk(budget.remaining)}</b> voľných zápisov
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={styles.actions}>
            <Link className="btn primary" href="/zlavy/nova">
              Nová zľava
            </Link>
            <Link className="btn ghost" href="/zlavy">
              Zoznam zliav
            </Link>
          </div>
        </div>
      </section>
    );
  }

  /* ── fronta zapisuje alebo stojí po odstávke ── */
  const paused = progress.mode === 'paused';
  const detailHref = progress.campaignId === null ? '/zlavy' : `/zlavy/${progress.campaignId}`;

  return (
    <section className="sec" data-testid="overview-queue" data-mode={progress.mode}>
      <div className="sec-h">
        <h2>Zapisuje sa</h2>
        <div className="act">
          {progress.sentence === null ? null : (
            <StateLine sentence={progress.sentence} testId="queue-state" />
          )}
        </div>
      </div>

      <div className={styles.top}>
        <div>
          <div className="prog-lg">
            <div className="n num" data-testid="queue-number">
              {formatCountSk(progress.done)}{' '}
              <span className="of">/ {formatCountSk(progress.total)}</span>
            </div>
            <div className="side lvl-2">
              <b>{progress.campaignName}</b>
              <br />
              <span className="lvl-3">
                {formatCountSk(progress.total)}{' '}
                {pluralSk(progress.total, 'produkt', 'produkty', 'produktov')}
                {progress.tiersLabel === null ? null : ` · ${progress.tiersLabel}`}
              </span>
            </div>
          </div>

          <Bar percent={progress.percent} paused={paused} />

          <div className="prog-meta">
            {progress.finishDay === null ? (
              <span className="lvl-3">Odhad dokončenia zatiaľ nevieme</span>
            ) : (
              <span>
                Hotové <b className="est">{dayMonthSk(progress.finishDay)}</b>
              </span>
            )}
            {progress.dateFrom === null ? null : (
              <>
                <Dot />
                <span>
                  Štart zľavy <b>{dayMonthSk(progress.dateFrom)}</b>
                </span>
              </>
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
                  Dnes zapísaných <b>{formatCountSk(budget.spent)}</b> z{' '}
                  {formatCountSk(budget.budget)}
                </span>
              </>
            )}
            {paused && progress.pausedSince !== null ? (
              <>
                <Dot />
                <span>
                  Zastavené <b>{formatDateTimeSk(progress.pausedSince)}</b>
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className={styles.actions}>
          {paused ? (
            <>
              <ResumeQueue onChanged={onChanged} />
              <Link className="btn ghost" href={detailHref}>
                Detail zľavy
              </Link>
            </>
          ) : (
            <>
              <Link className="btn primary" href={detailHref}>
                Detail zľavy
              </Link>
              {progress.campaignId === null ? null : (
                <StopQueue campaignId={progress.campaignId} onChanged={onChanged} />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default QueueSection;
