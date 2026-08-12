'use client';

/**
 * Aura Zľavy — TAB ZĽAVY, zoznam (V11; predloha `design/v3/zlavy.html`,
 * architektúra §1 TAB 3, kontrakt V3 K2, K3, K5, K10).
 *
 * Dominanta obrazovky (P1) je zľava, ktorá sa PRÁVE ZAPISUJE — nie najnovšia
 * a nie najväčšia. Pod ňou riadky ostatných v poradí naliehavosti
 * `zapisuje sa` → `beží` → `pripravená`; hotové sú v tlmenej zbaliteľnej
 * sekcii „Skončené".
 *
 * Čo obrazovka NEROBÍ:
 *
 *  · nevymýšľa čísla — keď sa zoznam nedá prečítať, povie to vetou; nula
 *    v appke, ktorá zapisuje do produkčného eshopu, je tvrdenie (P7),
 *  · netvrdí, že pozná stav zľavy v shope — všetko je „podľa vlastných
 *    zápisov" (I11),
 *  · nepoužíva žargón: stav je jedno zo štyroch slov zo slovníka, zlyhanie je
 *    príznak za bodkou, nikdy stav a nikdy červená (K10, architektúra §4).
 *
 * ČO SA SEM DOPLNILO A PREČO (kontrakt dokončenia B5, C1, C2, C4)
 * --------------------------------------------------------------
 *  1. **Stav zľavy je čitateľný bez rozkliku.** Okrem stavu a zlyhaní nesie
 *     riadok aj počet položiek, o ktorých NEVIEME, či sa zapísali. Je to iná
 *     vec než zlyhanie a žiada si iný ďalší krok (D45), takže sa s ním nesmie
 *     sčítať ani skryť do rozkliku.
 *
 *     POZNÁMKA PRE VLASTNÍKA SLOVNÍKA: `campaignSentence()` dnes pozná
 *     `failedCount`, ale nie počet neistých položiek, takže tento príznak
 *     skladá obrazovka. Keď slovník dostane vstup pre neisté, patrí to tam
 *     a tento riadok sa má zrušiť.
 *
 *  2. **Prázdno učí.** Prázdny zoznam nie je „žiadne dáta" — povie, čo tu má
 *     byť a ako sa to sem dostane (`EmptyState`).
 *
 *  3. **Vidieť, čo appka práve robí.** V pätke je merací prúžok denného
 *     rozpočtu a nad zoznamom veta o tom, prečo fronta prípadne nezapisuje.
 *     Bez toho vyzerá stojaca fronta rovnako ako pokazená appka.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import BlockerList from '@/components/campaigns/BlockerList';
import DiscountState from '@/components/campaigns/DiscountState';
import styles from '@/components/campaigns/zlavy.module.css';
import {
  orderDiscounts,
  progressPercent,
  sentenceOf,
} from '@/components/campaigns/discounts-model';
import {
  alarmingCards,
  queueStandSentence,
  resetPhrase,
  type QueueSnapshotView,
} from '@/components/campaigns/queue-model';
import {
  fetchQueue,
  listDiscounts,
  stopDiscountQueue,
  type BudgetView,
  type DiscountRow,
} from '@/components/campaigns/zlavy-api';
import BudgetMeter from '@/components/ui/BudgetMeter';
import EmptyState from '@/components/ui/EmptyState';
import Note from '@/components/ui/Note';
import { dayMonthSk, formatCountSk, pluralSk } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ malé diely ═══════════════════════════════════ */

function Dot() {
  return (
    <span className="sep-dot" aria-hidden="true">
      ·
    </span>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <div className="bar" aria-hidden="true">
      <i style={{ width: `${percent.toFixed(2)}%` }} />
    </div>
  );
}

/** Zľava má buď jedno percento, alebo pásma — nikdy oboje naraz (K3). */
function percentLabel(row: DiscountRow): string {
  if (row.tiers.length > 1) {
    return `${formatCountSk(row.tiers.length)} ${pluralSk(row.tiers.length, 'pásmo', 'pásma', 'pásiem')}`;
  }
  return `${row.percent} %`;
}

/**
 * Zastavenie fronty. Dva kroky, nikdy jeden klik — zapísané zľavy v shope
 * ZOSTÁVAJÚ a appka ich zrušiť nevie ani nesmie (I7, D35).
 */
function StopQueue({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await stopDiscountQueue(id, 'Zastavené v zozname zliav');
    setBusy(false);
    if (res.ok) {
      setNote(null);
      onChanged();
      return;
    }
    setNote(res.error.message);
  }

  return (
    <details className="stopq" data-testid="discount-stop">
      <summary className="btn">Zastaviť frontu</summary>
      <div className="stopq-b">
        <span>Zapísané zostanú. Zrušiť sa nedajú.</span>
        <button
          type="button"
          className="btn sm danger"
          disabled={busy}
          onClick={() => void run()}
          data-testid="discount-stop-confirm"
        >
          Áno, zastaviť
        </button>
      </div>
      {note === null ? null : <div className={styles.note}>{note}</div>}
    </details>
  );
}

/* ═══════════════════════════ riadok zoznamu ═══════════════════════════════ */

function DiscountRowView({ row, today }: { row: DiscountRow; today?: string }) {
  const sentence = sentenceOf(row, today);
  const finished = sentence.state === 'skončila';

  return (
    <div className={finished ? 'zrow dim' : 'zrow'} data-testid="discount-row">
      <div className={`nm ${styles.rowName}`}>
        <Link href={`/zlavy/${row.id}`}>{row.name}</Link>
      </div>
      <div className="row wrapx">
        <DiscountState sentence={sentence} />
        {/* D45 — neisté nie je zlyhané a slovník preň zatiaľ vetu nemá. */}
        {row.itemsUncertain === 0 ? null : (
          <span data-testid="row-uncertain">
            <span className="sep-dot" aria-hidden="true">
              ·
            </span>
            <span className="flag">
              {formatCountSk(row.itemsUncertain)} nevieme, či sa zapísalo
            </span>
          </span>
        )}
      </div>
      <div className="num lvl-2">{formatCountSk(row.itemsTotal)}</div>
      <div className="num lvl-2">{percentLabel(row)}</div>
      <div className="lvl-3">
        {dayMonthSk(row.dateFrom)} – {dayMonthSk(row.dateTo)}
      </div>
      <div className="lvl-3">
        {formatCountSk(row.itemsOk)} zapísaných z {formatCountSk(row.itemsTotal)}
        {row.itemsPending === 0 ? null : <> · {formatCountSk(row.itemsPending)} čaká</>}
        {row.estimate === null ? null : (
          <>
            {' · '}
            <span className="est">{dayMonthSk(row.estimate.date)}</span>
          </>
        )}
      </div>
    </div>
  );
}

function ListHeader() {
  return (
    <div className={`zlist-h ${styles.cols}`}>
      <span>Zľava</span>
      <span>Stav</span>
      <span>Produktov</span>
      <span>Zľava</span>
      <span>Okno</span>
      <span>Zapísané</span>
    </div>
  );
}

/* ═══════════════════════════ obrazovka ════════════════════════════════════ */

export function DiscountsList() {
  const [rows, setRows] = useState<readonly DiscountRow[] | null>(null);
  const [budget, setBudget] = useState<BudgetView | null>(null);
  const [queue, setQueue] = useState<QueueSnapshotView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listDiscounts(50);
    setLoading(false);
    if (res.ok) {
      setRows(res.data.data);
      setBudget(res.data.budget);
      setFailed(null);
      return;
    }
    // Zlyhanie čítania NIE JE prázdny zoznam — prázdny zoznam je tvrdenie,
    // že žiadna zľava neexistuje, a to tu nikto nevie (P7).
    setRows(null);
    setFailed(res.error.message);
  }, []);

  /**
   * Živý stav fronty je samostatné čítanie: zoznam zliav hovorí, ČO existuje,
   * `/api/queue` hovorí, ČO SA PRÁVE DEJE a prečo prípadne nič. Keď sa nedá
   * prečítať, zoznam sa kreslí ďalej — len bez vety o fronte.
   */
  const loadQueue = useCallback(async () => {
    const res = await fetchQueue();
    setQueue(res.ok ? res.data : null);
  }, []);

  useEffect(() => {
    void load();
    void loadQueue();
  }, [load, loadQueue]);

  const ordered =
    rows === null
      ? { leading: null, active: [] as readonly DiscountRow[], finished: [] as readonly DiscountRow[] }
      : orderDiscounts(rows);

  const stand = queue === null ? null : queueStandSentence(queue.standing.reason);
  const writing = queue !== null && queue.standing.writing;
  const alarming = queue === null ? [] : alarmingCards(queue.standing.blockers);
  /*
   * Prázdna fronta nie je problém a nemá o sebe hovoriť nad zoznamom — bola by
   * to veta, ktorá stojí na obrazovke stále a nič nehlási.
   */
  const showStand =
    stand !== null && !writing && queue !== null && queue.standing.reason !== 'queue_empty';
  const meterBudget = queue !== null && queue.budget !== null ? queue.budget : budget;

  return (
    <div className={styles.page} data-testid="discounts-list">
      <div className={styles.head}>
        <h1>Zľavy</h1>
        <Link className="btn primary" href="/zlavy/nova" data-testid="new-discount-link">
          Nová zľava
        </Link>
      </div>

      {failed === null ? null : (
        <section className="sec" data-testid="discounts-error">
          <Note variant="err">Zoznam zliav sa nepodarilo načítať: {failed}</Note>
          <div className="row gap-t">
            <button type="button" className="btn" onClick={() => void load()}>
              Skúsiť znova
            </button>
          </div>
        </section>
      )}

      {loading && rows === null && failed === null ? (
        <section className="sec">
          <div className={styles.busy}>Načítavam zľavy…</div>
        </section>
      ) : null}

      {/* Prečo sa práve teraz nezapisuje — hneď nad zoznamom, nie v logu (C2). */}
      {showStand && stand !== null ? (
        <section className="sec" data-testid="discounts-standing">
          <Note
            variant={stand.tone === 'critical' ? 'err' : stand.tone === 'idle' ? 'info' : 'warn'}
          >
            {stand.what} {stand.nextStep}
            {stand.path === null ? null : (
              <>
                {' '}
                <Link href={stand.path}>Otvoriť</Link>
              </>
            )}
          </Note>
          {alarming.length === 0 ? null : (
            <div className="gap-t">
              <BlockerList cards={alarming} title="Čo bráni zápisu" />
            </div>
          )}
        </section>
      ) : null}

      {rows !== null && rows.length === 0 ? (
        <section className="sec" data-testid="discounts-empty">
          <EmptyState
            title="Zatiaľ tu nie je ani jedna zľava"
            description={
              <>
                Zľava je sada produktov, ktorým appka postupne zapíše do eshopu nižšiu cenu na
                zvolené obdobie. Začnite tým, čo sa nepredáva: v Produktoch si vyfiltrujte
                ležiakov, označte ich a stlačte Zlacniť — alebo rovno založte novú zľavu a výber
                spravte v nej.
              </>
            }
            action={
              <div className="row wrapx">
                <Link className="btn primary" href="/zlavy/nova">
                  Nová zľava
                </Link>
                <Link className="btn" href="/produkty">
                  Nájsť ležiaky
                </Link>
              </div>
            }
          />
        </section>
      ) : null}

      {/* 1 · DOMINANTA — zľava, ktorá sa práve zapisuje */}
      {ordered.leading === null ? null : (
        <section className="sec" data-testid="discounts-leading">
          <div className="sec-h">
            <h2>Zapisuje sa</h2>
            <div className="act">
              <DiscountState sentence={sentenceOf(ordered.leading)} />
            </div>
          </div>

          <div className={styles.top}>
            <div>
              <div className="prog-lg">
                <div className="n num" data-testid="leading-number">
                  {formatCountSk(
                    ordered.leading.itemsOk +
                      ordered.leading.itemsFailed +
                      ordered.leading.itemsUncertain,
                  )}{' '}
                  <span className="of">/ {formatCountSk(ordered.leading.itemsTotal)}</span>
                </div>
                <div className="side lvl-3">
                  <Link href={`/zlavy/${ordered.leading.id}`}>{ordered.leading.name}</Link> ·{' '}
                  {formatCountSk(ordered.leading.itemsTotal)}{' '}
                  {pluralSk(ordered.leading.itemsTotal, 'produkt', 'produkty', 'produktov')} ·{' '}
                  {percentLabel(ordered.leading)}
                </div>
              </div>

              <Bar
                percent={progressPercent(
                  ordered.leading.itemsOk +
                    ordered.leading.itemsFailed +
                    ordered.leading.itemsUncertain,
                  ordered.leading.itemsTotal,
                )}
              />

              <div className="prog-meta">
                {ordered.leading.estimate === null ? (
                  <span className="lvl-3">Odhad dokončenia zatiaľ nevieme</span>
                ) : (
                  <span>
                    Hotové{' '}
                    <b className="est">{dayMonthSk(ordered.leading.estimate.date)}</b>
                  </span>
                )}
                <Dot />
                <span>
                  štart zľavy <b>{dayMonthSk(ordered.leading.dateFrom)}</b> — koniec{' '}
                  <b>{dayMonthSk(ordered.leading.dateTo)}</b>
                </span>
                {budget === null ? null : (
                  <>
                    <Dot />
                    <span>
                      dnes zapísaných <b>{formatCountSk(budget.spent)}</b> z{' '}
                      {formatCountSk(budget.budget)}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className={styles.side}>
              <Link className="btn lg primary" href={`/zlavy/${ordered.leading.id}`}>
                Detail
              </Link>
              <StopQueue id={ordered.leading.id} onChanged={() => void load()} />
            </div>
          </div>
        </section>
      )}

      {/* 2 · Ostatné bežiace a rozpísané */}
      {ordered.active.length === 0 ? null : (
        <section className="zlist" data-testid="discounts-active">
          <ListHeader />
          {ordered.active.map((row) => (
            <DiscountRowView key={row.id} row={row} />
          ))}
        </section>
      )}

      {/* 3 · Skončené — tlmené a zbalené */}
      {ordered.finished.length === 0 ? null : (
        <details data-testid="discounts-finished">
          <summary className="lvl-3" style={{ cursor: 'pointer', padding: '6px 0' }}>
            Skončené ({formatCountSk(ordered.finished.length)})
          </summary>
          <section className="zlist">
            <ListHeader />
            {ordered.finished.map((row) => (
              <DiscountRowView key={row.id} row={row} />
            ))}
          </section>
        </details>
      )}

      {meterBudget === null ? null : (
        <section className="sec" data-testid="discounts-budget">
          <div className={styles.listFoot}>
            <BudgetMeter
              label="Zápisy dnes"
              spent={meterBudget.spent}
              limit={meterBudget.budget}
              resetsAt={queue === null ? null : resetPhrase(queue.limits.nextResetAt)}
              testId="list-budget-meter"
            />
            <div className={styles.listFootText}>
              Denný rozpočet {formatCountSk(meterBudget.budget)}{' '}
              {pluralSk(meterBudget.budget, 'zápisu', 'zápisov', 'zápisov')} sa delí medzi všetky
              zľavy vo fronte — dnes ostáva {formatCountSk(meterBudget.remaining)}. Väčšia zľava
              preto beží aj niekoľko dní a appka po obnove rozpočtu pokračuje sama.{' '}
              <Link href="/nastavenia">Rozdelenie v Nastaveniach</Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default DiscountsList;
