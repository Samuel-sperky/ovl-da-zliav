'use client';

/**
 * Aura Zľavy — DOMINANTA PREHĽADU: ČÍSLA (V9, kontrakt UI 13. 8. 2026, body
 * 3–5 a 11; šprint 20, vlna 3, pracovník C4).
 *
 * PREČO JE DOMINANTOU ČÍSLO A NIE VETA
 * ------------------------------------
 * Do 20. 8. 2026 bola dominantou VETA verdiktu v 44 px („Zápis stojí",
 * „Všetko v poriadku"). Bola to odpoveď na otázku „je všetko v poriadku?",
 * lenže na tú istú otázku odpovedá aj slovo pri značke, aj celá sekcia
 * prekážok pod dominantou — takže najväčší prvok obrazovky niesol tretiu
 * kópiu toho istého a údaje, kvôli ktorým sa človek na prístrojovú dosku
 * pozerá, boli pod ním v 12,5 px riadku. Prehľad preto vedie ČÍSLAMI:
 *
 *   dominanta ....... `3 420 / 8 000` v `.lvl-1 .big.sm` (44 px)
 *   pásmo čísel ..... štyri dlaždice `.kpi.dense` (18 px = 41 % dominanty)
 *   stavová veta .... jeden riadok `.ovl-verdict` (14 px, teda stupeň `.lvl-2`)
 *
 * „Zápis stojí" NEZMIZOL — presunul sa nad čísla ako stavová veta. Je druhý
 * v poradí čítania, nesie farbu + značku + slovo (nikdy len farbu) a je
 * necelú tretinu veľkosti dominanty. Dôvody sa nezdvojujú: verdikt povie
 * KOĽKO prekážok, vety o nich vypisuje `BlockersSection` hneď pod sekciou.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Nič sa tu nerozhoduje.** Verdikt aj kontroly prichádzajú hotové
 *    z `overview-verdict.ts`, stav fronty z `overview-model.ts`. Oba majú
 *    testy bez prehliadača; podmienka dopísaná do JSX by sa dala overiť len
 *    klikaním.
 * 2. **Dominanta ostáva jedna.** Číslo je `.lvl-1 .big.sm` (44 px) a je
 *    NAJVIAC JEDNO na celej obrazovke. Dlaždice pásma sú `.kpi.dense`
 *    (18 px), stavová veta 14 px — P1 povoľuje druhej veci 55 % dominanty,
 *    takže je tu rezerva. Veľkosť nesie od 19. 8. 2026 VÝHRADNE `.lvl-1
 *    .big`; `.prog-lg` je už len geometria. Kto sem vráti vlastnú veľkosť,
 *    zhodí P1 a nebude to vidieť inak než meraním.
 * 3. **Nula sa nedopĺňa, kreslí sa pomlčka** (bod 5 kontraktu). Platí to
 *    o KAŽDOM čísle na obrazovke, nielen o fronte: keď sa nedá prečítať
 *    zoznam zliav, je `calm` rovno `null` a dlaždice pokojného stavu majú
 *    pomlčku. Nula by tvrdila „nič nebeží", a to je tvrdenie o ostrom eshope.
 *    Rozpočet, odhad dokončenia ani okno zľavy sa nedopočítavajú.
 * 4. **Odhad je označený ako odhad** (P7). Dátum dobehnutia nesie `.est`,
 *    teda `≈` a tlmenejší odtieň. Meraný fakt ho nemá nikdy.
 * 5. **V displejovom slote nikdy nestojí samotná pomlčka** (D11). Keď sa
 *    stav fronty nedá prečítať, dominanta sa NEKRESLÍ — pomlčka so slovom
 *    stojí v čitateľnom 22 px stupni (`.queueNum`) a dôvod je pod rozklikom
 *    „Prečo —", rovnako ako v stavovom pruhu. Em pomlčka v 44 px reze nie je
 *    znak, ale vyplnený obdĺžnik.
 * 6. **Prázdny stav je JEDNA VETA a JEDNO TLAČIDLO** (bod 11) a je TICHÝ
 *    (oprava D5, 19. 8. 2026). Veta je tlmený riadok presne tam, kde inokedy
 *    stoja čísla, a JEDINÉ tlačidlo stojí v stĺpci akcií, teda tam, kde
 *    primárna akcia stojí vo všetkých ostatných stavoch — obrazovka sa medzi
 *    stavmi nepreskladá a tlačidlo neposkakuje. Tri očíslované kroky, ktoré
 *    tu boli do 18. 8., sa zrušili — návod patrí do rozcestníka „Čo appka
 *    vie" v Nastaveniach.
 * 7. **Fronta sa po odstávke NIKDY nerozbehne sama.** „Pokračovať" je vedomý
 *    klik a v tom jedinom stave je primárnym tlačidlom on, nie „Nová zľava".
 * 8. **Pásmo čísel nesmie opakovať stavový pruh.** Pruh (chróm) nesie ostrý
 *    zápis, kľúč, rozpočet zápisov a počty katalógu. Dlaždica „Dnes
 *    zapísaných" je jediný priesečník a je tu zámerne: bez nej sa nedá
 *    prečítať, či fronta dnes ešte prejde. Počty katalógu sem NEPATRIA.
 * 9. **Dominanta hovorí SPRACOVANÉ, nie zapísané.** Číslo v nej je
 *    `progress.done`, teda `total − pending` — položky, ktoré fronta vybavila,
 *    vrátane zlyhaných a neistých. „Zapísaných" by z toho spravilo tvrdenie
 *    o ostrom eshope, ktoré appka nezmerala (ARCHITEKTURA §3.2). Pokojný stav
 *    to isté číslo označuje ako „Spracované položky" a tie dva popisy sa
 *    nesmú rozísť — je to jedno číslo v jednej sekcii.
 *
 * Vlastník: V9; prestavba na čísla C4 (šprint 20, vlna 3).
 */
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import StateLine from '@/components/dashboard/StateLine';
import styles from '@/components/dashboard/overview.module.css';
import { resumeQueue, stopQueue, type ActionResult } from '@/components/dashboard/api';
import { sigClass } from '@/components/dashboard/live-status-model';
import type { CalmNumbers, QueueProgress } from '@/components/dashboard/overview-model';
import type { CheckMark, Verdict } from '@/components/dashboard/overview-verdict';
import Note from '@/components/ui/Note';
import { SigMark } from '@/components/ui/StatusMark';
import { formatDateSk } from '@/lib/ui/format';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/** Čím appka hovorí „toto nevieme". Nikdy nula, nikdy dopočítaný odhad. */
const DASH = '—';

export interface StatusSectionProps {
  verdict: Verdict;
  /** Kontroly, ktoré stavový pruh nenesie. Poradie určuje model. */
  checks: readonly CheckMark[];
  progress: QueueProgress;
  /** Koľko sa dnes zapísalo a z akého rozpočtu; `null` = nevieme. */
  budget: { spent: number; budget: number; remaining: number } | null;
  /** Čísla pokojného stavu; `null` = zoznam zliav sa nedal prečítať. */
  calm: CalmNumbers | null;
  /** Veta o tom, čo sa nedalo prečítať; `null` = prečítalo sa všetko. */
  gap: string | null;
  /** Prekreslenie po akcii, ktorá zmenila stav fronty. */
  onChanged: () => void;
}

/* ═══════════════════════════ Malé stavebné diely ══════════════════════════ */

/**
 * Jedna dlaždica pásma čísel.
 *
 * `unknown` nie je kozmetika: stlmí hodnotu cez `.kpi.dense .v[data-unknown]`,
 * takže pomlčka vyzerá inak než nameraná nula a nedá sa s ňou zameniť.
 */
function Figure({
  label,
  value,
  unknown = false,
}: {
  label: string;
  value: ReactNode;
  unknown?: boolean;
}) {
  return (
    <div className="kpi dense">
      <div className="k">{label}</div>
      <div className="v" data-unknown={unknown ? 'ano' : undefined}>
        {value}
      </div>
    </div>
  );
}

/**
 * Dominanta — jediné 44 px číslo na obrazovke.
 *
 * `of` je menovateľ (`/ 8 000`) a má vlastný, menší stupeň: zlomok sa má dať
 * prečítať ako jedno číslo s kontextom, nie ako dve rovnako dôležité čísla.
 */
function Dominant({
  value,
  of = null,
  caption,
}: {
  value: string;
  of?: string | null;
  caption: string;
}) {
  return (
    <div className="lvl-1">
      <span className="big sm" data-testid="queue-number">
        {value}
        {of === null ? null : <span className="of"> / {of}</span>}
      </span>
      <span className="sub">{caption}</span>
    </div>
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

/**
 * Fronta zapisuje alebo stojí: zlomok v dominante, pruh a pásmo štyroch čísel.
 *
 * Meno zľavy, jej stav a počet pásiem stoja v tlmenom riadku medzi dominantou
 * a pruhom. Sú to popisky čísla nad nimi, nie samostatné údaje — dlaždica by
 * z názvu zľavy spravila piatu vec, ktorá súperí o pozornosť.
 */
function RunningBody({
  progress,
  budget,
}: {
  progress: QueueProgress;
  budget: StatusSectionProps['budget'];
}) {
  const paused = progress.mode === 'paused';
  const windowKnown = progress.dateFrom !== null && progress.dateTo !== null;

  return (
    <div data-testid="queue-running">
      {/*
        Popis dominanty hovorí SPRACOVANÉ, nie zapísané. `progress.done` je
        `total − pending` (`app/api/queue/route.ts`), teda položky, ktoré fronta
        vybavila — vrátane `failed`, `uncertain`, `skipped` a `interrupted`.
        Do 26. 8. 2026 tu stálo „zapísaných položiek", takže najväčšie číslo
        Prehľadu tvrdilo o dvanástich zlyhaných položkách, že sú v shope; tá
        istá sekcia pritom to isté číslo označuje ako „Spracované položky"
        (pokojný stav) a `ARCHITEKTURA.md §3.2` to hovorí doslova: „Pruh počíta
        spracované, nie úspešné." Koľko z nich naozaj vyšlo, je príznak
        „12 sa nepodarilo" a detail zľavy, nie dominanta.
      */}
      <Dominant
        value={formatCountSk(progress.done)}
        of={formatCountSk(progress.total)}
        caption="spracovaných položiek"
      />

      <div className="prog-meta">
        <b className={`lvl-2 ${styles.queueName}`}>{progress.campaignName}</b>
        {progress.sentence === null ? null : (
          <StateLine sentence={progress.sentence} testId="queue-state" />
        )}
        <span className="lvl-3">
          {formatCountSk(progress.total)}{' '}
          {pluralSk(progress.total, 'produkt', 'produkty', 'produktov')}
          {progress.tiersLabel === null ? null : ` · ${progress.tiersLabel}`}
        </span>
      </div>

      <div className={paused ? 'bar paused' : 'bar'} aria-hidden="true">
        <i style={{ width: `${progress.percent.toFixed(2)}%` }} />
      </div>

      {/*
        `styles.figs` patrí LEN k tomuto štvorpásmu: štvrtá bunka („Okno
        zľavy") nesie dva dátumy a v rovnako širokých bunkách sa zalamovala,
        čím zdvíhala celý rad o riadok. Trojpásmo pokojného stavu ho NEMÁ —
        malo by o jeden stĺpec viac než dlaždíc.
      */}
      <div className={`kpis ovl-figs ${styles.figs}`} data-testid="queue-figures">
        <Figure label="Zostáva zapísať" value={formatCountSk(progress.pending)} />
        <Figure
          label="Dnes zapísaných"
          value={
            budget === null
              ? DASH
              : `${formatCountSk(budget.spent)} z ${formatCountSk(budget.budget)}`
          }
          unknown={budget === null}
        />
        <Figure
          label="Odhad dokončenia"
          value={
            progress.finishDay === null ? (
              DASH
            ) : (
              <span className="est">{formatDateSk(progress.finishDay)}</span>
            )
          }
          unknown={progress.finishDay === null}
        />
        <Figure
          label="Okno zľavy"
          value={
            windowKnown
              ? `${formatDateSk(progress.dateFrom)} – ${formatDateSk(progress.dateTo)}`
              : DASH
          }
          unknown={!windowKnown}
        />
      </div>
    </div>
  );
}

/**
 * Nič sa nezapisuje: žiadny pruh na nule, len čísla, ktoré appka naozaj má.
 *
 * Dominantou je počet zlacnených produktov — jediné číslo pokojného stavu,
 * ktoré hovorí o eshope, a nie o appke. Je to počet PODĽA VLASTNÝCH ZÁPISOV;
 * appka nekontroluje, čo v shope naozaj visí, a nesmie to predstierať.
 *
 * Keď sa zoznam zliav nedal prečítať, nie je tu nula, ale pomlčka so slovom —
 * a v 22 px stupni, nie v displejovom (D11).
 *
 * Rozpočet sem NEPATRÍ. „Voľných zápisov dnes 200" tu bol stavový pruh
 * v hlavičke druhýkrát — a keď sa tie dve čísla rozišli o jedno kolo fronty,
 * obrazovka si protirečila sama so sebou o dva riadky nižšie.
 */
function CalmBody({ calm, done }: { calm: CalmNumbers | null; done: number }) {
  return (
    <div data-testid="queue-calm">
      {calm === null ? (
        <div className={styles.queueHead}>
          <span className={`num ${styles.queueNum}`} data-testid="queue-number">
            {DASH} zoznam zliav nevieme
          </span>
        </div>
      ) : (
        <Dominant
          value={formatCountSk(calm.discounted)}
          caption="zlacnených produktov podľa vlastných zápisov"
        />
      )}

      <div className="kpis ovl-figs" data-testid="queue-figures">
        <Figure
          label="Zľavy bežia"
          value={calm === null ? DASH : formatCountSk(calm.live)}
          unknown={calm === null}
        />
        <Figure
          label="Pripravené"
          value={calm === null ? DASH : formatCountSk(calm.ready)}
          unknown={calm === null}
        />
        <Figure label="Spracované položky" value={formatCountSk(done)} />
      </div>
    </div>
  );
}

/**
 * Stav fronty sa nedá prečítať. Pomlčka namiesto čísla a dôvod pod rozklikom —
 * ten istý tvar, aký má stavový pruh, aby sa pomlčka čítala rovnako všade.
 *
 * Dominanta sa v tomto stave NEKRESLÍ (D11): em pomlčka v 44 px reze nie je
 * znak, ale vyplnený obdĺžnik. Pomlčka preto stojí so slovom v 22 px.
 */
function UnknownBody() {
  return (
    <div data-testid="queue-unknown">
      <div className={styles.queueHead}>
        <span className={`num ${styles.queueNum}`} data-testid="queue-number">
          {DASH} stav fronty nevieme
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
      </div>

      {/*
        Stavová veta. Do 20. 8. 2026 to bola dominanta v 44 px; dnes je druhá
        v poradí čítania a necelú tretinu veľkosti čísla pod ňou. Tri kanály
        zostávajú v JEDNOM uzle — farba (trieda tónu), značka (`<svg>`) aj
        slovo — aby sa nemohli rozísť. Slovo verdiktu (`verdict.word`) sa
        v hlavičke sekcie už nekreslí: bola to tretia formulácia tej istej veci
        vedľa tejto vety a vedľa sekcie prekážok.
      */}
      <div className="ovl-verdict">
        <span className={sigClass(verdict.tone)} data-testid="verdict-headline">
          <SigMark variant={verdict.tone} />
          {verdict.headline}
        </span>
        <span className="lvl-3" data-testid="verdict-detail">
          {verdict.detail}
        </span>
      </div>

      <div className={styles.top}>
        <div>
          <div className={styles.queueBody}>
            {progress.mode === 'unknown' ? <UnknownBody /> : null}
            {progress.mode === 'calm' ? <CalmBody calm={calm} done={progress.done} /> : null}
            {running ? <RunningBody progress={progress} budget={budget} /> : null}
            {/*
              D5 — prázdny stav je jeden tlmený riadok na mieste čísel fronty,
              nie vycentrovaná škatuľa s vlastným tlačidlom. Dominanta sa
              nekreslí: appka nemá ani jedno číslo, ktoré by do nej patrilo.
            */}
            {empty ? (
              <div className="prog-meta" data-testid="overview-empty">
                <span>Zatiaľ nie je žiadna zľava.</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className={styles.actions} data-testid="overview-actions">
          {/* Bod 11: v prázdnom stave presne jedno tlačidlo, nič vedľa neho. */}
          {empty ? (
            <Link className="btn primary" href="/zlavy/nova" data-testid="first-new-campaign">
              Nová zľava
            </Link>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>

      <div className={styles.checks} data-testid="overview-checks">
        {checks.map((check) => {
          const mark = (
            <span className={sigClass(check.tone)} data-check={check.id}>
              <SigMark variant={check.tone} />
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
