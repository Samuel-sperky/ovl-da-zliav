'use client';

/**
 * Aura Zľavy — DETAIL ZĽAVY (V11; kontrakt UI 13. 8. 2026 body 4, 9–12, 22, 23;
 * kontrakt API v5 R1; architektúra §0 P1–P8, §1 TAB 3, §4).
 *
 * Obrazovka odpovedá na tri otázky v tomto poradí: **kde je zápis · čo sa
 * nepodarilo · čo sa dá urobiť.**
 *
 * SEKCIE (P5): najviac štyri.
 *
 *   1. **Priebeh** — dominanta (P1): koľko z koľkých je hotových (64 px).
 *      V nej aj štyri dlaždice fronty, denný rozpočet a dôvod, prečo sa
 *      prípadne nezapisuje.
 *   2. **Zopakovať to, čo sa nepodarilo** — len keď je čo.
 *   3. **Výkon výberu** — predané kusy pred zľavou a teraz.
 *   4. **Položky** — súhrn a len problémové riadky.
 *
 * Pod rozklikom (teda mimo počtu sekcií): **pásma**, **technický detail
 * problémových položiek** a **audit stopa**. Do 13. 8. mal detail šesť sekcií
 * a bol vyšší než dve obrazovky; percentá pásiem sú odteraz jednou vetou
 * v hlavičke priebehu a celá tabuľka pásiem je na jeden klik.
 *
 * ŠTYRI DLAŽDICE FRONTY SA NEZLIEVAJÚ (D45, kontrakt UI, bod 22)
 * -------------------------------------------------------------
 * `zapísané · čaká · nepodarilo sa · nevieme, či sa zapísalo`. Posledná je
 * vlastný stav, nie odroda zlyhania: zápis odišiel a odpoveď nedorazila, takže
 * produkt zlacnený BYŤ MÔŽE. Zliatie so „nepodarilo sa" by poslalo človeka
 * opravovať niečo, čo je možno v poriadku — preto sa tie dve čísla nikdy
 * nesčítajú a každé má vlastný ďalší krok.
 *
 * PRETO SA DUPLICITA RIEŠILA INAK (D15, 19. 8. 2026)
 * -------------------------------------------------
 * Dominanta a štyri dlaždice hovorili pri hotovej zľave to isté (`21 / 21`
 * a `21 · 0 · 0 · 0`), a nad dlaždicami to ešte raz opakovala veta
 * „zapísaných 21 · …" a pod nimi „ostáva zapísať 0". Dlaždice sa zrušiť
 * nesmú, tak sa zrušilo všetko ostatné: dominanta hovorí, koľko z fronty je
 * vybavených, pruh pod ňou je rozdelený na tie isté štyri stavy a dlaždice sú
 * jeho legenda. Kto sem pridá ďalšie číslo, nech si najprv overí, či už nemá
 * svoju dlaždicu.
 *
 * JEDEN ZOZNAM DÔVODOV, NIE DVE ČERVENÉ ŠKATULE (D16)
 * ---------------------------------------------------
 * Dôvod, prečo fronta stojí (`queueStandSentence`, stav BEHU appky), a
 * prekážky zápisu (`alarmingCards`, stav DÁT a poistiek) sú dve rôzne veci a
 * do jednej vety sa zliať nesmú — ale odpovedajú na tú istú otázku, takže
 * stoja v jednom ráme pod jedným nadpisom.
 *
 * ČO SA TU EŠTE NESMIE POKAZIŤ
 * ----------------------------
 *
 *  1. **Nič sa neobnovuje samo** (kontrakt UI, bod 4). Detail aj stav fronty
 *     sa čítajú JEDNÝM registrovaným načítaním v `layout/refresh.ts`, takže
 *     obe skupiny čísel platia k tomu istému okamihu a obrazovka ten okamih
 *     píše. Vlastné tlačidlo Obnoviť sa nekreslí — jediné je v stavovom pruhu.
 *  2. **Nula sa nekreslí z neznalosti** (P7). Čo sa nedá prečítať, je pomlčka
 *     alebo veta, nikdy nula.
 *  3. **Žiadna veta o kauzalite** (P8). Predané kusy stoja vedľa seba; appka
 *     nikdy nepovie, že ich priniesla zľava.
 *  4. **Odhad je označený `≈`** a tlmený (P7).
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { StandPanel } from '@/components/campaigns/BlockerList';
import DiscountPerformance from '@/components/campaigns/DiscountPerformance';
import DiscountState from '@/components/campaigns/DiscountState';
import RetryFailed from '@/components/campaigns/RetryFailed';
import styles from '@/components/campaigns/zlavy.module.css';
import { postJson } from '@/components/campaigns/api';
import { percentHeadline } from '@/components/campaigns/DiscountsList';
import { sentenceOf } from '@/components/campaigns/discounts-model';
import {
  alarmingCards,
  dayCount,
  queueStandSentence,
  resetPhrase,
  type QueueSnapshotView,
} from '@/components/campaigns/queue-model';
import {
  fetchQueue,
  getDiscount,
  stopDiscountQueue,
  type DiscountDetailData,
  type DiscountItemView,
} from '@/components/campaigns/zlavy-api';
import { useRefreshable } from '@/components/layout/refresh';
import BudgetMeter from '@/components/ui/BudgetMeter';
import Note from '@/components/ui/Note';
import StatTile from '@/components/ui/StatTile';
import { TONE_GLYPH } from '@/components/ui/ToneBadge';
import { formatDateSk, formatDateTimeSk, formatEur } from '@/lib/ui/format';
import { formatCountSk, itemSentence, pluralSk } from '@/lib/ui/vocabulary';

/** Koľko položiek si vypýtame. Detail nie je export katalógu (odpoveď 56). */
const ITEMS_LIMIT = 1000;

/** Koľko problémových riadkov sa vypíše; zvyšok je číslo, nie zoznam. */
const PROBLEM_ROWS = 20;

/** Stavy, ktoré sú v poriadku alebo sa ešte len chystajú — tie sa nevypisujú. */
const QUIET_STATUSES = new Set(['ok', 'pending', 'skipped']);

function isProblem(item: DiscountItemView): boolean {
  if (!QUIET_STATUSES.has(item.status)) return true;
  // D39c — rozhodovalo sa nad inou cenou. Nie je to chyba zápisu, ale
  // zamlčať sa to nesmie.
  return item.priceMismatch;
}

/**
 * Čas posledného načítania — vždy konkrétny, nikdy „pred 3 minútami"
 * (kontrakt UI, bod 10). V rámci dňa stačí `HH:MM`.
 */
function clockSk(at: number | null): string {
  if (at === null) return '—';
  const when = new Date(at);
  const stamp = formatDateTimeSk(when);
  if (stamp === '—') return '—';
  return formatDateSk(when) === formatDateSk(new Date()) ? stamp.slice(-5) : stamp;
}

/* ═══════════════════ zastavenie fronty a zrušenie zľavy ═══════════════════ */

/**
 * Zastavenie fronty — dva kroky. Týka sa VÝHRADNE toho, čo ešte nebolo
 * zapísané; už zapísané zľavy v eshope zostávajú a odstráni ich až akcia
 * „Zrušiť zľavu" nižšie, ktorá má vlastné potvrdenie.
 */
function StopQueue({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await stopDiscountQueue(id, 'Zastavené v detaile zľavy');
    setBusy(false);
    if (res.ok) {
      setNote(null);
      onChanged();
      return;
    }
    setNote(res.error.message);
  }

  return (
    <details className="stopq" data-testid="detail-stop">
      <summary className="btn">Zastaviť frontu</summary>
      <div className="stopq-b">
        <span>Zastaví sa len to, čo ešte nebolo zapísané. Zapísané v eshope zostanú.</span>
        <button
          type="button"
          className="btn sm danger"
          disabled={busy}
          onClick={() => void run()}
          data-testid="detail-stop-confirm"
        >
          Áno, zastaviť
        </button>
      </div>
      {note === null ? null : <div className={styles.note}>{note}</div>}
    </details>
  );
}

/**
 * Je serverová cesta zrušenia zapojená?
 *
 * `POST /api/products/clearReduction` pribudlo v API v5 a scope `product:edit`
 * appka má, takže akcia je možná — ale klient shopu, vykonávač, audit a grep
 * test, ktorý dnes rušenie zakazuje, sú mimo tejto obrazovky a zatiaľ
 * neexistujú. Kým nepribudnú, akcia je VIDIEŤ aj s potvrdením, ale posledný
 * krok je vypnutý a povie prečo — tlačidlo, ktoré ticho nič neurobí, je horšie
 * než tlačidlo, ktoré prizná, že ešte nie je zapojené.
 *
 * Zapojenie = doplniť serverovú cestu a prepnúť túto konštantu na `true`.
 * Typ je uvedený zámerne: bez neho by TypeScript odvodil `false` a celú
 * odosielaciu vetvu vyhlásil za mŕtvy kód.
 */
const END_IN_SHOP_READY: boolean = false;

/** Cesta, ktorou sa zrušenie odošle. Serverovú časť vlastní tím API. */
const endInShopPath = (id: number): string => `/api/campaigns/${id}/end-in-shop`;

export interface EndInShopFacts {
  /** Koľko produktov appka do eshopu naozaj zapísala. */
  readonly written: number;
  /** Koľko je takých, o ktorých nevie, či sa zapísali (D45). */
  readonly uncertain: number;
  /** Koľko ešte čaká vo fronte. */
  readonly pending: number;
  /** Zostatok denného rozpočtu; `null` = nedá sa prečítať (P7). */
  readonly budgetRemaining: number | null;
  readonly budgetTotal: number | null;
}

/**
 * Veta potvrdenia pri rušení zľavy (kontrakt UI, bod 23).
 *
 * Musí obsahovať POČET PRODUKTOV, ktorých sa zrušenie dotkne, a to, že sa
 * každý z nich počíta do denného rozpočtu zápisov. Bez počtu je to potvrdenie
 * naslepo; bez rozpočtu človek nevie, že si tým zabrzdí bežiacu frontu.
 */
export function endInShopConfirmText(facts: EndInShopFacts): string {
  const parts: string[] = [];

  parts.push(
    `Zľava sa v eshope skončí u ${formatCountSk(facts.written)} ${pluralSk(
      facts.written,
      'produktu',
      'produktov',
      'produktov',
    )}, ktoré appka zapísala.`,
  );

  if (facts.uncertain > 0) {
    parts.push(
      `Pridá sa k nim ${formatCountSk(facts.uncertain)} ${pluralSk(
        facts.uncertain,
        'produkt',
        'produkty',
        'produktov',
      )}, o ktorých appka nevie, či sa zapísali.`,
    );
  }

  if (facts.budgetRemaining === null || facts.budgetTotal === null) {
    parts.push(
      'Každé zrušenie je jeden zápis z denného rozpočtu; koľko ho dnes ostáva, appka teraz nevie.',
    );
  } else {
    parts.push(
      `Každé zrušenie je jeden zápis z denného rozpočtu — dnes ostáva ${formatCountSk(
        facts.budgetRemaining,
      )} z ${formatCountSk(facts.budgetTotal)}.`,
    );
  }

  if (facts.pending > 0) {
    parts.push(
      `Vo fronte ešte čaká ${formatCountSk(facts.pending)} ${pluralSk(
        facts.pending,
        'produkt',
        'produkty',
        'produktov',
      )} tejto zľavy — najprv treba zastaviť frontu, inak by appka zapisovala a rušila naraz.`,
    );
  }

  return parts.join(' ');
}

/**
 * Akcia „Zrušiť zľavu" (kontrakt UI, bod 23; kontrakt API v5, R1).
 *
 * Invariant I7 sa týmto MENÍ: appka zľavu zruší, ale výhradne na výslovný
 * pokyn človeka, s vlastným potvrdením a z denného rozpočtu. Automatické ani
 * hromadné rušenie nevzniká. Bez hesla a mimo červenej zóny — poistkou je
 * dvojkrokové potvrdenie s počtom produktov, nie ďalšia prihlasovacia obrazovka.
 */
function EndDiscountInShop({
  id,
  facts,
  onChanged,
}: {
  id: number;
  facts: EndInShopFacts;
  onChanged: () => void;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const res = await postJson(endInShopPath(id), { reason: 'Zrušené v detaile zľavy' });
    setBusy(false);
    if (res.ok) {
      setNote(null);
      onChanged();
      return;
    }
    setNote(res.error.message);
  }

  return (
    <details className="stopq" data-testid="detail-end">
      <summary className="btn">Zrušiť zľavu</summary>
      <div className="stopq-b">
        <span data-testid="detail-end-confirm-text">{endInShopConfirmText(facts)}</span>
        <button
          type="button"
          className="btn sm"
          disabled={busy || !END_IN_SHOP_READY}
          onClick={() => void run()}
          data-testid="detail-end-confirm"
        >
          Áno, zrušiť zľavu
        </button>
      </div>
      {END_IN_SHOP_READY ? null : (
        <div className={styles.noteQuiet} data-testid="detail-end-not-wired">
          Táto akcia ešte nie je zapojená — appka zatiaľ nemá cestu, ktorou by zrušenie do eshopu
          poslala.
        </div>
      )}
      {note === null ? null : <div className={styles.note}>{note}</div>}
    </details>
  );
}

/* ═══════════════════════════ obrazovka ════════════════════════════════════ */

export function DiscountDetail({ id }: { id: number }) {
  const [data, setData] = useState<DiscountDetailData | null>(null);
  const [queue, setQueue] = useState<QueueSnapshotView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * Detail zľavy a stav celej fronty JEDNÝM načítaním. Do 13. 8. sa fronta
   * doťahovala vlastným časovačom každých 30 s — dve skupiny čísel na jednej
   * obrazovke tak platili k rôznym okamihom a riadok sa pod rukami prepisoval.
   */
  const load = useCallback(async () => {
    const [detail, snapshot] = await Promise.all([getDiscount(id, ITEMS_LIMIT), fetchQueue()]);
    if (detail.ok) {
      setData(detail.data);
      setFailed(null);
    } else {
      setData(null);
      setFailed(detail.error.message);
    }
    setQueue(snapshot.ok ? snapshot.data : null);
  }, [id]);

  const { at, pending } = useRefreshable(load);

  if (failed !== null) {
    return (
      <section className="sec" data-testid="detail-error">
        <div className="empty">
          <div className="t">Zľavu sa nepodarilo načítať</div>
          <div>{failed} Ďalší pokus: tlačidlo Obnoviť v stavovom pruhu.</div>
          <div className="a">
            <Link className="btn" href="/zlavy">
              Späť na zoznam
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (data === null) {
    return (
      <div className={styles.busy}>
        {pending ? 'Načítavam zľavu…' : 'Zľava nie je k dispozícii.'}
      </div>
    );
  }

  const campaign = data.campaign;
  const done = campaign.itemsOk + campaign.itemsFailed + campaign.itemsUncertain;
  const sentence = sentenceOf(campaign);
  const head = percentHeadline(campaign.percent, data.tiers);
  const problems = data.items.filter(isProblem);
  const shown = problems.slice(0, PROBLEM_ROWS);
  const scanned = data.items.length;

  const budget = queue === null ? null : queue.budget;
  const stand = queue === null ? null : queueStandSentence(queue.standing.reason);
  const writing = queue !== null && queue.standing.writing;
  const alarming = queue === null ? [] : alarmingCards(queue.standing.blockers);
  const showStand =
    stand !== null && !writing && queue !== null && queue.standing.reason !== 'queue_empty';

  /*
   * Panel opakovania sa ponúka vtedy, keď má o čom hovoriť — teda keď niečo
   * neprešlo alebo o niečom nevieme (D45). Či sa naozaj dá zopakovať, rozhodne
   * server; panel si to vypýta sám a prípadné „ešte nie" aj vysvetlí.
   */
  const retryWorthShowing = campaign.itemsFailed > 0 || campaign.itemsUncertain > 0;

  /* Rušiť sa dá len to, čo v eshope naozaj môže svietiť. */
  const endFacts: EndInShopFacts = {
    written: campaign.itemsOk,
    uncertain: campaign.itemsUncertain,
    pending: campaign.itemsPending,
    budgetRemaining: budget === null ? null : budget.remaining,
    budgetTotal: budget === null ? null : budget.budget,
  };
  const canEnd = sentence.state !== 'skončila' && campaign.itemsOk + campaign.itemsUncertain > 0;

  /** Podiel jedného stavu na celej zľave — šírka jeho úseku v pruhu fronty. */
  const shareOf = (units: number): string =>
    campaign.itemsTotal <= 0 ? '0' : ((units / campaign.itemsTotal) * 100).toFixed(2);

  /** Má stav čo hlásiť? Prúžok farby dostane len dlaždica s nenulovým číslom. */
  const anyOf = (units: number): 'ano' | 'nie' => (units > 0 ? 'ano' : 'nie');

  return (
    <div className={styles.page} data-testid="discount-detail">
      <div className={styles.dhead}>
        <Link className="lvl-3" href="/zlavy">
          ← Zľavy
        </Link>
        <h1>{campaign.name}</h1>
        <DiscountState sentence={sentence} testId="detail-state" />
      </div>

      {/* 1 · DOMINANTA — priebeh fronty, štyri dlaždice a denný rozpočet */}
      <section className="sec" data-testid="detail-progress">
        <div className="sec-h">
          <h2>Priebeh</h2>
          <div className="act lvl-3">
            zľava <b>{head.big}</b>
            {head.sub === null ? null : <> · {head.sub}</>} · svieti{' '}
            <b>
              {formatDateSk(campaign.dateFrom)} – {formatDateSk(campaign.dateTo)}
            </b>
          </div>
        </div>

        <div className={`${styles.top} ${styles.topStart}`}>
          <div>
            {/*
             * D15 — dominanta a dlaždice sú JEDEN ÚTVAR, nie dva zoznamy tých
             * istých čísel. Dominanta hovorí, koľko z fronty je vybavených;
             * pruh pod ňou je rozdelený na tie isté štyri stavy a dlaždice
             * pod pruhom sú jeho legenda. Vetu „zapísaných 21 · 0 sa
             * nepodarilo · 0 nevieme" sme zrušili — bola to štvorica dlaždíc
             * napísaná ešte raz, slovami.
             */}
            <div className="prog-lg">
              <div className="n num" data-testid="detail-number">
                {formatCountSk(done)}{' '}
                <span className="of">/ {formatCountSk(campaign.itemsTotal)}</span>
              </div>
              <div className="side lvl-3">
                {campaign.itemsPending === 0
                  ? 'fronta má túto zľavu vybavenú'
                  : 'vybavených z fronty'}
              </div>
            </div>

            <div className={styles.queueBar} aria-hidden="true">
              <i data-state="ok" style={{ width: `${shareOf(campaign.itemsOk)}%` }} />
              <i data-state="uncertain" style={{ width: `${shareOf(campaign.itemsUncertain)}%` }} />
              <i data-state="failed" style={{ width: `${shareOf(campaign.itemsFailed)}%` }} />
              <i data-state="pending" style={{ width: `${shareOf(campaign.itemsPending)}%` }} />
            </div>

            {/*
             * Štyri dlaždice fronty — nikdy tri (D45, kontrakt UI, bod 22).
             * „Nevieme, či sa zapísalo" je vlastný stav: zápis odišiel a
             * odpoveď nedorazila, takže produkt zlacnený BYŤ MÔŽE. Farbu
             * dostane len dlaždica, ktorá má čo hlásiť — červený prúžok nad
             * nulou zlyhaní by bol falošný poplach. Stav preto nesie farbu,
             * glyf aj slovo naraz.
             */}
            <div className={`kpis ${styles.queueTiles}`}>
              <div className={styles.queueTile} data-state="ok" data-any={anyOf(campaign.itemsOk)}>
                <StatTile
                  label={`${TONE_GLYPH.good} Zapísané`}
                  value={formatCountSk(campaign.itemsOk)}
                  detail={`z ${formatCountSk(campaign.itemsTotal)} produktov tejto zľavy`}
                  testId="tile-ok"
                />
              </div>
              <div
                className={styles.queueTile}
                data-state="pending"
                data-any={anyOf(campaign.itemsPending)}
              >
                <StatTile
                  label={`${TONE_GLYPH.progress} Čaká na zápis`}
                  value={formatCountSk(campaign.itemsPending)}
                  detail={
                    campaign.itemsPending === 0
                      ? 'fronta má túto zľavu vybavenú'
                      : 'fronta na ne ešte nedošla'
                  }
                  testId="tile-pending"
                />
              </div>
              <div
                className={styles.queueTile}
                data-state="failed"
                data-any={anyOf(campaign.itemsFailed)}
              >
                <StatTile
                  label={`${TONE_GLYPH.critical} Nepodarilo sa`}
                  value={formatCountSk(campaign.itemsFailed)}
                  detail={
                    campaign.itemsFailed === 0
                      ? 'nič sa nepokazilo'
                      : 'tieto produkty zlacnené nie sú — dajú sa zopakovať'
                  }
                  testId="tile-failed"
                />
              </div>
              <div
                className={styles.queueTile}
                data-state="uncertain"
                data-any={anyOf(campaign.itemsUncertain)}
              >
                <StatTile
                  label={`${TONE_GLYPH.attention} Nevieme, či sa zapísalo`}
                  value={formatCountSk(campaign.itemsUncertain)}
                  detail={
                    campaign.itemsUncertain === 0
                      ? 'každý zápis dostal odpoveď'
                      : 'zápis odišiel, odpoveď nedorazila'
                  }
                  testId="tile-uncertain"
                />
              </div>
            </div>

            {/*
             * Pod dlaždicami zostáva už len to, čo v nich NIE JE — deň
             * dobehnutia. „Ostáva zapísať N" tu bolo tretí raz to isté číslo,
             * ktoré má vlastnú dlaždicu.
             */}
            {data.estimate === null ? (
              campaign.itemsPending === 0 ? null : (
                <div className="prog-meta">
                  <span>odhad dokončenia zatiaľ nevieme</span>
                </div>
              )
            ) : (
              <div className="prog-meta">
                <span>
                  hotové <b className="est">{formatDateSk(data.estimate.date)}</b>
                  {data.estimate.days === 0 ? null : (
                    <> · pobeží ešte {dayCount(data.estimate.days)}</>
                  )}
                </span>
              </div>
            )}

            {campaign.itemsUncertain === 0 ? null : (
              <div className={styles.startNote}>
                <Note variant="warn" testId="detail-uncertain-note">
                  Pri týchto produktoch zápis odišiel, ale odpoveď nedorazila — appka nevie
                  potvrdiť, že zľava naozaj platí. Ďalší krok je pozrieť ich priamo v eshope a ak
                  zľava neplatí, spustiť zopakovanie nižšie.
                </Note>
              </div>
            )}

            <div className={styles.liveGrid}>
              <div>
                {budget === null ? (
                  <div className="lvl-3">Dnešný rozpočet zápisov sa nepodarilo prečítať.</div>
                ) : (
                  <BudgetMeter
                    label="Zápisy dnes"
                    spent={budget.spent}
                    limit={budget.budget}
                    resetsAt={queue === null ? null : resetPhrase(queue.limits.nextResetAt)}
                    testId="detail-budget"
                  />
                )}
              </div>
              <div className={styles.liveNext}>
                {budget === null ? (
                  <span className="lvl-3">
                    Koľko zápisov dnes ostáva, sa nedá prečítať — odhad preto nedopočítavame.
                  </span>
                ) : (
                  <span className="lvl-3">
                    Dnes ostáva {formatCountSk(budget.remaining)}{' '}
                    {pluralSk(budget.remaining, 'zápis', 'zápisy', 'zápisov')} z{' '}
                    {formatCountSk(budget.budget)}. Rozpočet sa delí medzi všetky zľavy vo fronte.
                  </span>
                )}
              </div>
            </div>

            {/*
             * D16 — jeden zoznam, nie dve červené škatule pod sebou. Dôvod,
             * prečo fronta stojí (stav BEHU appky), a prekážky zápisu (stav
             * DÁT a poistiek) sú dve rôzne veci, ktoré sa nesmú zliať do
             * jednej vety — ale odpovedajú na tú istú otázku, takže patria do
             * jedného rámu s jedným nadpisom. Do 19. 8. 2026 bola prvá z nich
             * vyplnená ružová `Note` a druhá skupina s vlastným nadpisom;
             * obrazovka tak mala dva poplachy tam, kde je jeden dôvod.
             */}
            <StandPanel
              stand={showStand ? stand : null}
              cards={alarming}
              testId="detail-blockers"
              className="gap-t"
            />

            <div className="fresh">
              Podľa vlastných zápisov appky · dáta k {clockSk(at)}
            </div>
          </div>

          <div className={styles.side}>
            {campaign.itemsPending === 0 ? null : (
              <StopQueue id={campaign.id} onChanged={() => void load()} />
            )}
            {canEnd ? (
              <EndDiscountInShop id={campaign.id} facts={endFacts} onChanged={() => void load()} />
            ) : null}
            <Link className="btn" href="/zlavy">
              Späť na zoznam
            </Link>
          </div>
        </div>
      </section>

      {/* Pásma — pod rozklikom, teda mimo počtu sekcií (P5, P6). Percentá sú
          na povrchu v hlavičke priebehu, tu je pravidlo a počty. */}
      <details className={styles.fold} data-testid="detail-tiers">
        <summary>Pásma — podľa čoho ktorý produkt zlacnel</summary>
        <div className={styles.foldBody}>
          {data.tiers.length === 0 ? (
            <div className="lvl-3">
              Jedno percento pre celý výber: <b>{campaign.percent} %</b>
            </div>
          ) : (
            <table className={styles.tiersRead}>
              <thead>
                <tr>
                  <th>Pásmo</th>
                  <th>Pravidlo</th>
                  <th className="n">Produktov</th>
                  <th className="n">Zľava</th>
                </tr>
              </thead>
              <tbody>
                {data.tiers.map((tier) => (
                  <tr key={tier.ord}>
                    <td>
                      <b className="lvl-2">{tier.ord}</b>
                    </td>
                    <td>{tier.label}</td>
                    <td className="n num">{formatCountSk(tier.itemsCount)}</td>
                    <td className="n num">
                      <b className="lvl-2">{tier.percent} %</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="lvl-3 gap-t">
            Dopad na maržu <span className="lockline">odomkne sa po doplnení nákupných cien</span>
          </div>
        </div>
      </details>

      {/* 2 · Zopakovanie — len keď je čo. Panel si sadu aj dôvody vypýta sám
          a bez čerstvého potvrdenia nezaradí nič (I3, D16). */}
      {retryWorthShowing ? (
        <RetryFailed campaignId={campaign.id} onCreated={() => void load()} />
      ) : null}

      {/* 3 · Výkon výberu — dva z troch panelov sú zamknuté, lebo appka tržby
          ani vlaňajšie dáta nemá (K8). Žiadny záver o príčine (P8). */}
      <DiscountPerformance id={campaign.id} />

      {/* 4 · Položky — súhrn a len problémové riadky */}
      <section className="sec" data-testid="detail-items">
        <div className="sec-h">
          <h2>Položky</h2>
          <div className="act lvl-3">
            {formatCountSk(campaign.itemsTotal)} celkom · {formatCountSk(campaign.itemsOk)}{' '}
            zapísaných · {formatCountSk(campaign.itemsPending)} čaká ·{' '}
            {formatCountSk(campaign.itemsFailed)} sa nepodarilo
          </div>
        </div>

        <div className="tbl-frame">
          <div className={styles.itemsScroll}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Názov</th>
                  <th className="n">Cena pri príprave</th>
                  <th className="n">Zľava</th>
                  <th>Zapísané</th>
                  <th>Poznámka</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td className="name lvl-3">Zatiaľ sa nič nepokazilo.</td>
                    <td className="n">—</td>
                    <td className="n">—</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                ) : (
                  shown.map((item) => {
                    const say = itemSentence(item.status);
                    return (
                      <tr key={item.id}>
                        <td className="name">{item.nameAtWrite ?? 'bez názvu'}</td>
                        <td className="n" data-l="Cena">
                          {formatEur(item.priceAtPreview)}
                        </td>
                        <td className="n" data-l="Zľava">
                          {item.percent === undefined
                            ? `${campaign.percent} %`
                            : `${item.percent} %`}
                        </td>
                        <td data-l="Zapísané">
                          <span className={item.status === 'ok' ? 'sig ok' : 'sig warn'}>
                            {say.label}
                          </span>
                        </td>
                        <td data-l="Poznámka">
                          {item.priceMismatch ? 'Cena sa medzitým zmenila' : say.reason}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="tbl-foot">
            <span>
              Vypisuje sa len to, čo sa nepodarilo alebo je podozrivé
              {problems.length > shown.length
                ? ` — z ${formatCountSk(problems.length)} takých riadkov je vidieť prvých ${formatCountSk(shown.length)}`
                : ''}
              {scanned < campaign.itemsTotal
                ? `, prezretých bolo prvých ${formatCountSk(scanned)} z ${formatCountSk(campaign.itemsTotal)}`
                : ''}
              . Ak niekto zmení percentá v administrácii shopu, appka o tom nevie.
            </span>
          </div>
        </div>

        <details className="tech" data-testid="detail-tech">
          <summary>Technický detail</summary>
          <div className="body mono">
            {shown.length === 0 ? (
              <div>zatiaľ žiadny problémový riadok</div>
            ) : (
              shown.map((item) => (
                <div key={`raw-${item.id}`}>
                  {item.productId} → {item.status}
                  {item.httpStatus === null ? '' : ` · ${item.httpStatus}`}
                  {item.errorCode === null ? '' : ` · ${item.errorCode}`}
                  {` · ${item.attemptCount}×`}
                  {item.finishedAt === null ? '' : ` · ${formatDateTimeSk(item.finishedAt)}`}
                </div>
              ))
            )}
          </div>
        </details>

        <details className="tech" data-testid="detail-audit">
          <summary>
            História zápisov — posledných {formatCountSk(Math.min(8, data.auditTrail.length))}{' '}
            {pluralSk(Math.min(8, data.auditTrail.length), 'záznam', 'záznamy', 'záznamov')}
          </summary>
          <div className="body">
            <table>
              <tbody>
                {data.auditTrail.slice(0, 8).map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTimeSk(row.ts)}</td>
                    <td>
                      <b>{row.message ?? row.eventType}</b>
                    </td>
                  </tr>
                ))}
                {data.auditTrail.length === 0 ? (
                  <tr>
                    <td>—</td>
                    <td>zatiaľ žiadny záznam</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <div style={{ marginTop: '6px' }}>
              <Link href="/nastavenia#historia">Celá história v Nastaveniach</Link>
            </div>
          </div>
        </details>
      </section>
    </div>
  );
}

export default DiscountDetail;
