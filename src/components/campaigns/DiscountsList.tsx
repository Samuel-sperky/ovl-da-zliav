'use client';

/**
 * Aura Zľavy — TAB ZĽAVY, ZOZNAM (V11; kontrakt UI 13. 8. 2026 body 4, 9–12,
 * 21; architektúra §0 P1–P8, §1 TAB 3, §4).
 *
 * Obrazovka odpovedá na jedinú otázku: **o koľko percent sa zlacňuje a ako
 * ďaleko je zápis.**
 *
 * DOMINANTA JE PERCENTO (kontrakt UI, bod 21)
 * -------------------------------------------
 * Do 13. 8. bola dominantou obrazovky priebehová číslica `3 420 / 8 000`.
 * Zľava sa však nezakladá kvôli počtu položiek vo fronte — zakladá sa kvôli
 * tomu, o koľko sa zlacní. Preto je najväčším prvkom obrazovky percento
 * zľavy, ktorá je na čele (`.lvl-1 .big`, 64 px), a druhým najväčším je
 * percento v riadku zoznamu (`.pct`, 26 px = 41 % dominanty, P1 drží).
 * Priebeh fronty tým nezmizol — je pod percentom ako pruh a jeden riadok
 * čísel. Kto potrebuje priebeh ako dominantu, má na to Prehľad.
 *
 * Pri pásmach sa v dominante kreslí ROZSAH (`15–30 %`), nie najvyššie
 * percento. Najvyššie percento by tvrdilo, že toľko dostali všetky produkty.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 *  1. **Nula sa nekreslí z neznalosti.** Keď sa zoznam nedá prečítať, povie sa
 *     to vetou; prázdny zoznam je tvrdenie, že žiadna zľava neexistuje (P7).
 *  2. **Nič sa neobnovuje samo** (kontrakt UI, bod 4). Načítanie je
 *     zaregistrované v spoločnom mechanizme `layout/refresh.ts`; obrazovka si
 *     vlastné tlačidlo Obnoviť NEKRESLÍ — jediné je v stavovom pruhu.
 *  3. **Neisté nie je zlyhané** (D45). Príznak „nevieme, či sa zapísalo" sa
 *     nikdy nesčíta so zlyhaniami ani sa neschová.
 *  4. **Rozpočet zápisov na túto obrazovku nepatrí.** Číslo je v stavovom
 *     pruhu, rozpad v Nastaveniach (kontrakt UI, bod 15). Tretia kópia by
 *     bola tretie miesto, kde sa dá rozísť.
 *  5. **Texty sú neosobné a časy konkrétne** (kontrakt UI, body 9, 10).
 *
 * SEKCIE (P5): dve — zľava na čele a zoznam. Skončené sú pod rozklikom.
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';

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
  type QueueSnapshotView,
} from '@/components/campaigns/queue-model';
import {
  fetchQueue,
  listDiscounts,
  stopDiscountQueue,
  type DiscountRow,
} from '@/components/campaigns/zlavy-api';
import { useRefreshable } from '@/components/layout/refresh';
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

/** Percento zľavy pre dominantu aj pre riadok zoznamu. */
export interface PercentHeadline {
  /** Veľké číslo — jedno percento alebo rozsah pásiem. */
  readonly big: string;
  /** Doplnok pod ním („3 pásma"); `null` = zľava má jedno percento. */
  readonly sub: string | null;
}

/**
 * Zľava má buď jedno percento, alebo pásma — nikdy oboje naraz (K3).
 *
 * Pri pásmach sa kreslí ROZSAH od najnižšieho po najvyššie. Najvyššie percento
 * samo by tvrdilo, že toľko dostal celý výber, a to je pri troch pásmach
 * nepravda o tisíckach produktov.
 */
export function percentHeadline(
  percent: number,
  tiers: readonly { readonly percent: number }[],
): PercentHeadline {
  if (tiers.length <= 1) return { big: `${percent} %`, sub: null };

  let min = tiers[0]!.percent;
  let max = tiers[0]!.percent;
  for (const tier of tiers) {
    if (tier.percent < min) min = tier.percent;
    if (tier.percent > max) max = tier.percent;
  }
  const sub = `${formatCountSk(tiers.length)} ${pluralSk(tiers.length, 'pásmo', 'pásma', 'pásiem')}`;
  return { big: min === max ? `${max} %` : `${min}–${max} %`, sub };
}

/**
 * Zastavenie fronty. Dva kroky, nikdy jeden klik.
 *
 * Zastavenie sa týka VÝHRADNE toho, čo ešte nebolo zapísané. Už zapísané zľavy
 * v eshope zostávajú — odstrániť ich vie iba akcia „Zrušiť zľavu" na detaile,
 * a to je iné rozhodnutie s vlastným potvrdením.
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
        <span>Zastaví sa len to, čo ešte nebolo zapísané. Zapísané v eshope zostanú.</span>
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
  const head = percentHeadline(row.percent, row.tiers);

  return (
    <div
      className={finished ? `${styles.drow} ${styles.drowDim}` : styles.drow}
      data-testid="discount-row"
    >
      {/* Percento je najsilnejšia bunka riadku (kontrakt UI, bod 21). */}
      <div className={styles.cPct}>
        <span className={styles.pct}>{head.big}</span>
        {head.sub === null ? null : <span className={styles.pctSub}>{head.sub}</span>}
      </div>

      <div className={styles.cName}>
        <Link href={`/zlavy/${row.id}`}>{row.name}</Link>
      </div>

      <div className={styles.cState}>
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

      <div className={`${styles.cCount} num lvl-2`}>{formatCountSk(row.itemsTotal)}</div>

      <div className={`${styles.cWindow} lvl-3`}>
        {dayMonthSk(row.dateFrom)} – {dayMonthSk(row.dateTo)}
      </div>

      <div className={`${styles.cWritten} lvl-3`}>
        {formatCountSk(row.itemsOk)} z {formatCountSk(row.itemsTotal)}
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
      <span>Názov</span>
      <span>Stav</span>
      <span>Produktov</span>
      <span>Okno</span>
      <span>Zapísané</span>
    </div>
  );
}

/* ═══════════════════════════ obrazovka ════════════════════════════════════ */

export function DiscountsList() {
  const [rows, setRows] = useState<readonly DiscountRow[] | null>(null);
  const [queue, setQueue] = useState<QueueSnapshotView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * Jedno registrované načítanie pre obe čítania naraz. Zoznam hovorí, ČO
   * existuje; `/api/queue` hovorí, ČO SA PRÁVE DEJE a prečo prípadne nič.
   * Keď sa nedá prečítať fronta, zoznam sa kreslí ďalej — len bez vety o nej.
   */
  const load = useCallback(async () => {
    const [list, snapshot] = await Promise.all([listDiscounts(50), fetchQueue()]);
    if (list.ok) {
      setRows(list.data.data);
      setFailed(null);
    } else {
      // Zlyhanie čítania NIE JE prázdny zoznam — prázdny zoznam je tvrdenie,
      // že žiadna zľava neexistuje, a to tu nikto nevie (P7).
      setRows(null);
      setFailed(list.error.message);
    }
    setQueue(snapshot.ok ? snapshot.data : null);
  }, []);

  // Obnovuje sa VÝHRADNE na vyžiadanie — tlačidlo je v stavovom pruhu.
  const { pending } = useRefreshable(load);

  const ordered =
    rows === null
      ? {
          leading: null,
          active: [] as readonly DiscountRow[],
          finished: [] as readonly DiscountRow[],
        }
      : orderDiscounts(rows);

  /*
   * Na čele stojí zľava, ktorá sa práve zapisuje. Keď žiadna nezapisuje,
   * postúpi prvá v poradí naliehavosti — obrazovka bez dominanty by porušila
   * P1 a percento by sa nemalo kde ukázať.
   */
  const featured = ordered.leading ?? ordered.active[0] ?? null;
  const rest = ordered.leading === null ? ordered.active.slice(1) : ordered.active;

  const stand = queue === null ? null : queueStandSentence(queue.standing.reason);
  const writing = queue !== null && queue.standing.writing;
  const alarming = queue === null ? [] : alarmingCards(queue.standing.blockers);
  /*
   * Prázdna fronta nie je problém a nemá o sebe hovoriť — bola by to veta,
   * ktorá stojí na obrazovke stále a nič nehlási (kontrakt UI, bod 3).
   */
  const showStand =
    stand !== null && !writing && queue !== null && queue.standing.reason !== 'queue_empty';

  const empty = rows !== null && rows.length === 0;
  const head = featured === null ? null : percentHeadline(featured.percent, featured.tiers);
  const featuredDone =
    featured === null ? 0 : featured.itemsOk + featured.itemsFailed + featured.itemsUncertain;

  return (
    <div className={styles.page} data-testid="discounts-list">
      <div className={styles.head}>
        <h1>Zľavy</h1>
        {/* Pri prázdnej obrazovke nesie jedinú akciu prázdny stav (bod 11). */}
        {empty ? null : (
          <Link className="btn primary" href="/zlavy/nova" data-testid="new-discount-link">
            Nová zľava
          </Link>
        )}
      </div>

      {failed === null ? null : (
        <Note variant="err" testId="discounts-error">
          Zoznam zliav sa nepodarilo načítať: {failed} Ďalší pokus: tlačidlo Obnoviť v stavovom
          pruhu.
        </Note>
      )}

      {pending && rows === null && failed === null ? (
        <div className={styles.busy}>Načítavam zľavy…</div>
      ) : null}

      {/* Prečo sa práve teraz nezapisuje — nad zoznamom, nie v logu.
          Nie je to sekcia: kreslí sa len vtedy, keď niečo naozaj stojí. */}
      {showStand && stand !== null ? (
        <div data-testid="discounts-standing">
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
        </div>
      ) : null}

      {empty ? (
        <section className="sec" data-testid="discounts-empty">
          <EmptyState
            title="Zatiaľ tu nie je ani jedna zľava"
            description="Zľava je sada produktov, ktorým appka zapíše nižšiu cenu na zvolené obdobie."
            action={
              <Link className="btn primary" href="/zlavy/nova">
                Nová zľava
              </Link>
            }
          />
        </section>
      ) : null}

      {/* 1 · DOMINANTA — percento zľavy, ktorá je na čele (kontrakt UI, 21) */}
      {featured === null || head === null ? null : (
        <section className="sec" data-testid="discounts-leading">
          {/*
           * Karta na čele JE riadkom zoznamu, len nakresleným veľkým — preto
           * nesie aj `discount-row`. Kto hľadá „prvú zľavu v zozname", ju musí
           * nájsť bez ohľadu na to, či práve zapisuje.
           */}
          <div className={styles.top} data-testid="discount-row">
            <div>
              <div className={styles.feature}>
                <div className="lvl-1" data-testid="leading-percent">
                  <span className="big">{head.big}</span>
                </div>
                <div className={styles.featureMeta}>
                  <div className={styles.featureName}>
                    <Link href={`/zlavy/${featured.id}`}>{featured.name}</Link>
                  </div>
                  <div className="row wrapx">
                    <DiscountState sentence={sentenceOf(featured)} testId="leading-state" />
                  </div>
                  <div className="lvl-3">
                    {head.sub === null ? null : (
                      <>
                        {head.sub}
                        <Dot />
                      </>
                    )}
                    {formatCountSk(featured.itemsTotal)}{' '}
                    {pluralSk(featured.itemsTotal, 'produkt', 'produkty', 'produktov')}
                    <Dot />
                    zľava svieti {dayMonthSk(featured.dateFrom)} – {dayMonthSk(featured.dateTo)}
                  </div>
                </div>
              </div>

              <Bar percent={progressPercent(featuredDone, featured.itemsTotal)} />

              <div className="prog-meta" data-testid="leading-progress">
                <span>
                  zapísaných <b>{formatCountSk(featured.itemsOk)}</b> z{' '}
                  {formatCountSk(featured.itemsTotal)}
                </span>
                {featured.itemsPending === 0 ? null : (
                  <>
                    <Dot />
                    <span>
                      ostáva zapísať <b>{formatCountSk(featured.itemsPending)}</b>
                    </span>
                  </>
                )}
                {featured.estimate === null ? (
                  featured.itemsPending === 0 ? null : (
                    <>
                      <Dot />
                      <span>odhad dokončenia zatiaľ nevieme</span>
                    </>
                  )
                ) : (
                  <>
                    <Dot />
                    <span>
                      hotové <b className="est">{dayMonthSk(featured.estimate.date)}</b>
                    </span>
                  </>
                )}
                {featured.itemsUncertain === 0 ? null : (
                  <>
                    <Dot />
                    <span className="flag">
                      {formatCountSk(featured.itemsUncertain)} nevieme, či sa zapísalo
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className={styles.side}>
              <Link className="btn lg primary" href={`/zlavy/${featured.id}`}>
                Detail
              </Link>
              {featured.itemsPending === 0 ? null : (
                <StopQueue id={featured.id} onChanged={() => void load()} />
              )}
            </div>
          </div>
        </section>
      )}

      {/* 2 · Zoznam ostatných — dátová tabuľka vo vlastnom ráme (P4) */}
      {rest.length === 0 ? null : (
        <section className="zlist" data-testid="discounts-active">
          <ListHeader />
          <div className={styles.listScroll}>
            {rest.map((row) => (
              <DiscountRowView key={row.id} row={row} />
            ))}
          </div>
        </section>
      )}

      {/* Skončené — pod rozklikom, teda mimo počtu sekcií (P5). */}
      {ordered.finished.length === 0 ? null : (
        <details
          className={styles.fold}
          open={featured === null && rest.length === 0}
          data-testid="discounts-finished"
        >
          <summary>Skončené ({formatCountSk(ordered.finished.length)})</summary>
          <div className={styles.foldBody}>
            <div className="zlist">
              <ListHeader />
              <div className={styles.listScroll}>
                {ordered.finished.map((row) => (
                  <DiscountRowView key={row.id} row={row} />
                ))}
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

export default DiscountsList;
