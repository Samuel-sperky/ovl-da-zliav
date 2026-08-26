'use client';

/**
 * Aura Zľavy — TAB ZĽAVY, MAJSTER/DETAIL (V11; kontrakt UI 13. 8. 2026 body 4,
 * 9–12, 21; kontrakt kostry 19. 8. 2026 K1; architektúra §0 P1–P8, §1 TAB 3,
 * §4).
 *
 * Obrazovka odpovedá na jedinú otázku: **o koľko percent sa zlacňuje a ako
 * ďaleko je zápis.**
 *
 * MAJSTER/DETAIL, NIE PRECHOD STRÁNKOU (K1, šprint 20 vlna 3)
 * -----------------------------------------------------------
 * Do šprintu 20 bol tab Zľavy stránka, z ktorej sa klikom ODCHÁDZALO na
 * `/zlavy/[id]`. Zoznam zmizol, a kto porovnával dve zľavy, chodil tam a späť.
 * Odteraz je vľavo rebrík zliav a vpravo detail tej vybranej — v tom istom
 * pohľade.
 *
 * TRASA `/zlavy/[id]` SA TÝM NERUŠÍ. Rebrík aj detail držia dokopy dve veci:
 *
 *   1. Shell (tento komponent) je vykreslený v `app/zlavy/(prehlad)/layout.tsx`.
 *      Next.js layout medzi súrodeneckými trasami NEODMOUNTUJE, takže klik na
 *      riadok nechá rebrík aj jeho načítané dáta na mieste a vymení len pravý
 *      stĺpec.
 *   2. Pravý stĺpec je slot: `detail` je `children` z trasy. Priamy odkaz,
 *      obnovenie stránky aj tlačidlo Späť teda fungujú presne ako predtým —
 *      adresa zostáva jediným zdrojom pravdy o tom, čo je otvorené, a nič sa
 *      nedrží v stave komponentu.
 *
 * Preto tu NIE JE ani `useState` na výber, ani vlastné načítanie detailu.
 * Kto by výber presunul do stavu, rozbije priamy odkaz na `/zlavy/[id]`.
 *
 * DOMINANTA JE PERCENTO (kontrakt UI, bod 21)
 * -------------------------------------------
 * Zľava sa nezakladá kvôli počtu položiek vo fronte — zakladá sa kvôli tomu,
 * o koľko sa zlacní. Preto je najväčším prvkom obrazovky percento, a to VŽDY
 * v pravom stĺpci: keď je zľava otvorená, nesie dominantu jej detail; keď nie
 * je otvorená nič, nesie ju karta zľavy na čele (`.lvl-1 .big`, 64 px). Nikdy
 * nie sú na obrazovke obe naraz — to by bola dvojitá dominanta (P1).
 *
 * V rebríku vľavo má percento 26 px = 41 % dominanty, teda druhé najväčšie
 * číslo obrazovky. P1 drží.
 *
 * Pri pásmach sa v dominante kreslí ROZSAH (`15–30 %`), nie najvyššie
 * percento. Najvyššie percento by tvrdilo, že toľko dostali všetky produkty.
 *
 * KARTA NA ČELE JE UŽ LEN NÁHĽAD, NIE RIADOK (šprint 20)
 * -------------------------------------------------------
 * Do šprintu 20 bola karta na čele zároveň prvým riadkom zoznamu, a preto
 * `featureDiscounts()` vracala `rest`/`finished` BEZ nej. Teraz je rebrík
 * vľavo úplný — vybrať sa musí dať každá zľava vrátane tej na čele — takže
 * riadky sa berú z `orderDiscounts()` a `featureDiscounts()` rozhoduje už len
 * o tom, ČO sa ukáže vpravo, kým nie je otvorená žiadna zľava. Rozhodnutie
 * o čele zostáva v modeli, nie v JSX: je to pravidlo o dominante a musí sa
 * dať overiť bez prehliadača.
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
 *     pruhu, rozpad v Nastaveniach (kontrakt UI, bod 15).
 *  5. **Texty sú neosobné a časy konkrétne** (kontrakt UI, body 9, 10).
 *  6. **Rám dôvodov (`StandPanel`) je na obrazovke práve raz.** Keď je zľava
 *     otvorená, hovorí o fronte jej detail — dva rámy s tým istým dôvodom
 *     vedľa seba sú presne defekt D16, len na šírku.
 *
 * SEKCIE (P5): dve, kým nie je otvorená zľava — karta zľavy na čele a „Čo
 * čaká na pozretie". Pri otvorenej zľave je vpravo detail a sekcie počíta on.
 * Rebrík vľavo je výberová lišta, nie sekcia obsahu — tú istú rolu má ľavý
 * panel appky. Skončené sú pod rozklikom.
 *
 * PRÁZDNE MIESTO JE ZAHODENÁ ODPOVEĎ (24. 8. 2026)
 * ------------------------------------------------
 * Obrazovka končila na ~390 px z 900 a spodné dve tretiny boli holé. Nebola
 * to chyba rozloženia: appka mala načítané dáta v ruke a nepoužila ich.
 * Doplnené sú dve veci a ani jedna sa nedopočítava — obe prišli zo servera:
 *
 *   · **pásma zľavy na čele** (`/api/campaigns` → `tiers`). Dominantou je pri
 *     pásmach ROZSAH („15–30 %"), a rozsah bez pásiem nie je odpoveď na
 *     otázku obrazovky, len jej náznak.
 *   · **Čo čaká na pozretie** (`/api/queue` → `attention`). Tá istá odpoveď,
 *     z ktorej sa už dnes číta dôvod stojacej fronty, nesie aj počty, mená
 *     dotknutých zliav a vetu o ďalšom kroku.
 *
 * Čo sa tam NEDALO: súčty naprieč zľavami (to by bolo dopočítavanie) a denný
 * rozpočet zápisov (ten na túto obrazovku nepatrí, pozri bod 4 nižšie).
 *
 * Vlastník: V11.
 */
import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';

import { StandPanel } from '@/components/campaigns/BlockerList';
import DiscountState from '@/components/campaigns/DiscountState';
import styles from '@/components/campaigns/zlavy.module.css';
import {
  featureDiscounts,
  orderDiscounts,
  progressPercent,
  sentenceOf,
} from '@/components/campaigns/discounts-model';
import {
  alarmingCards,
  queueStandSentence,
  type QueueAttentionGroup,
  type QueueSnapshotView,
} from '@/components/campaigns/queue-model';
import {
  fetchQueue,
  listDiscounts,
  stopDiscountQueue,
  type DiscountRow,
  type TierView,
} from '@/components/campaigns/zlavy-api';
import { useRefreshable } from '@/components/layout/refresh';
import EmptyState from '@/components/ui/EmptyState';
import Note from '@/components/ui/Note';
import { FlagMark, SigMark, type SigVariant } from '@/components/ui/StatusMark';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { formatDateSk } from '@/lib/ui/format';

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
 * v eshope zostávajú a appka ich nezruší (I7) — skončia samy dňom konca zľavy.
 * Detail to o zľave, ktorá ešte beží, aj napíše (`expiryNoteText()`).
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

/* ═══════════════════════ riadok rebríka (majster) ═════════════════════════ */

/**
 * Jeden riadok výberu. Celý riadok je odkaz na `/zlavy/[id]` — v majster/detail
 * je cieľom riadku práve otvorenie detailu, takže klikacia plocha nesmie byť
 * len názov.
 *
 * Rebrík má 380 px, teda tretinu toho, čo mala pôvodná šesťstĺpcová tabuľka.
 * Nesie preto len to, čím sa zľavy od seba odlišujú pri VÝBERE: percento,
 * názov, stav, okno a koľko z koľkých je zapísaných. Ostatné čísla nezmizli —
 * stoja vpravo v detaile, ktorý sa otvorí jedným klikom a nikam neodvedie.
 */
export function PickRow({ row, selected }: { row: DiscountRow; selected: boolean }) {
  const sentence = sentenceOf(row);
  const finished = sentence.state === 'skončila';
  const head = percentHeadline(row.percent, row.tiers);
  const cls = ['zpick', selected ? 'on' : '', finished ? 'dim' : ''].filter(Boolean).join(' ');

  return (
    <Link
      href={`/zlavy/${row.id}`}
      className={cls}
      aria-current={selected ? 'page' : undefined}
      data-testid="discount-row"
    >
      {/* Percento je najsilnejšia bunka riadku (kontrakt UI, bod 21). */}
      <span className="zpick-pct">
        <b>{head.big}</b>
        {head.sub === null ? null : <i>{head.sub}</i>}
      </span>

      <span className="zpick-main">
        {/*
          Od 24. 8. 2026 sa v riadku nereže NIČ: percento dostalo šírku, ktorú
          potrebuje jeho rozsah, a názov sa preto láme na druhý riadok namiesto
          troch bodiek. `title` zostáva pre myš — je to lacná pomôcka, nie
          náhrada za čitateľný názov.
        */}
        <span className="zpick-name" title={row.name}>
          {row.name}
        </span>

        <span className="zpick-state">
          <DiscountState sentence={sentence} />
          {/* D45 — neisté nie je zlyhané a slovník preň zatiaľ vetu nemá. */}
          {row.itemsUncertain === 0 ? null : (
            <span data-testid="row-uncertain">
              <Dot />
              <span className="flag">
                <FlagMark />
                {formatCountSk(row.itemsUncertain)} nevieme, či sa zapísalo
              </span>
            </span>
          )}
        </span>

        {/*
          Dva riadky, nie jeden orezaný. Do jedného sa okno platnosti aj počet
          zapísaných nezmestili a `text-overflow` odkrajoval sprava — teda
          práve to číslo, kvôli ktorému meta riadok existuje („…zapísané 948
          z “). Skrátiť sa nedalo ani jedno: okno hovorí, KEDY zľava svieti,
          počet KAM sa zápis dostal. Keď je aj tak úzko, ustúpi odhad
          dobehnutia — ten stojí aj na karte na čele aj v detaile.
        */}
        <span className="zpick-meta lvl-3">
          <span className={styles.pickWindow}>
            {formatDateSk(row.dateFrom)} – {formatDateSk(row.dateTo)}
          </span>
          <span className={styles.pickWritten}>
            <span className={styles.pickCounts} data-testid="row-written">
              zapísané {formatCountSk(row.itemsOk)} z {formatCountSk(row.itemsTotal)}
            </span>
            {row.estimate === null ? null : (
              <span className={styles.pickEst}>
                <Dot />
                <span className="est">{formatDateSk(row.estimate.date)}</span>
              </span>
            )}
          </span>
        </span>
      </span>
    </Link>
  );
}

/* ═════════════════ čím je vyplnená pravá polovica obrazovky ═══════════════ */

/**
 * Pásma zľavy na čele.
 *
 * Dominantou obrazovky je pri pásmach ROZSAH („15–30 %“). Rozsah sám o sebe
 * nehovorí, čo ktorý produkt dostal — do 24. 8. 2026 stálo pod ním len
 * „3 pásma“ a jediná cesta k percentám viedla cez detail. Čísla pritom appka
 * má rovno v odpovedi `/api/campaigns`, takže sa nič nedopočítava ani
 * nedoťahuje: vypisuje sa presne to, čo prišlo.
 *
 * V detaile sú pásma pod rozklikom, tu nie — a je to zámer. Detail má na
 * povrchu svoju vlastnú prácu (priebeh, oprava, položky); zoznam nemá inú
 * otázku než „o koľko percent sa zlacňuje“, a to je práve táto tabuľka.
 */
export function LeadTiers({ tiers }: { tiers: readonly TierView[] }) {
  if (tiers.length <= 1) return null;

  return (
    <div className={styles.leadTiers} data-testid="leading-tiers">
      <div className={`lvl-3 ${styles.leadTiersHead}`}>Podľa čoho ktorý produkt zlacnel</div>
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
          {tiers.map((tier) => (
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
    </div>
  );
}

/** Jedna skupina pozornosti z `/api/queue` — stav, počet, kroky, dotknuté zľavy. */
interface WatchGroup {
  readonly key: string;
  readonly sig: SigVariant;
  /* Slovo pri značke. Stav nikdy nenesie iba farba (§3.2). */
  readonly word: string;
  readonly group: QueueAttentionGroup;
}

/**
 * ČO ČAKÁ NA POZRETIE — druhá sekcia zoznamu (UX2, 24. 8. 2026).
 *
 * Obrazovka končila na ~390 px z 900 a zvyšok bol prázdny. Nebolo to
 * rozloženie, bola to zahodená odpoveď: `/api/queue` sa na tejto obrazovke
 * číta už dnes (kvôli vete o stojacej fronte) a v tej istej odpovedi príde
 * `attention` — počty, MENÁ dotknutých zliav a veta o ďalšom kroku. Zoznam
 * z toho nepoužil nič.
 *
 * Prečo to nie je duplicita karty na čele (D16): karta hovorí, ako ďaleko je
 * JEDNA zľava. Táto sekcia hovorí, ktorých zliav sa problém týka a čo s ním
 * robiť — to karta niesť nevie a nikde inde na obrazovke to nestojí.
 *
 * Nekreslí sa, keď nie je čo: prázdny rám s nulami by bol veta, ktorá stojí
 * na obrazovke stále a nič nehlási (kontrakt UI, bod 3).
 */
export function WatchSection({ queue }: { queue: QueueSnapshotView }) {
  const groups: WatchGroup[] = [];
  if (queue.attention.failed !== null && queue.attention.failed.items > 0) {
    groups.push({
      key: 'failed',
      sig: 'bad',
      word: 'nepodarilo sa',
      group: queue.attention.failed,
    });
  }
  if (queue.attention.uncertain !== null && queue.attention.uncertain.items > 0) {
    // D45 — neisté nie je zlyhané a nikdy sa s ním nesčíta.
    groups.push({
      key: 'uncertain',
      sig: 'warn',
      word: 'nevieme, či sa zapísalo',
      group: queue.attention.uncertain,
    });
  }
  if (groups.length === 0) return null;

  return (
    <section className="sec" data-testid="discounts-attention">
      <div className="sec-h">
        <h2>Čo čaká na pozretie</h2>
        <div className="act lvl-3">
          {/* Odhad celej fronty, nie tejto jednej zľavy — preto „celá fronta“.
              Keď ho appka nemá, povie to; nula by tu bola tvrdenie (P7). */}
          {queue.estimate === null ? (
            'celá fronta — odhad dobehnutia zatiaľ nevieme'
          ) : (
            <>
              celá fronta hotová <b className="est">{formatDateSk(queue.estimate.date)}</b>
            </>
          )}
        </div>
      </div>

      {groups.map((item) => (
        <div className={styles.watch} key={item.key} data-testid={`watch-${item.key}`}>
          <div className={styles.watchHead}>
            <span className={`sig ${item.sig}`}>
              <SigMark variant={item.sig} />
              {item.word}
            </span>
            <b className="lvl-2 num">{formatCountSk(item.group.items)}</b>
            <span className="lvl-3">
              {pluralSk(item.group.items, 'kus', 'kusy', 'kusov')}
            </span>
          </div>
          {item.group.what === '' ? null : (
            <div className={`lvl-3 ${styles.watchWhat}`}>{item.group.what}</div>
          )}
          {item.group.nextStep === '' ? null : (
            <div className={`hint ${styles.watchStep}`}>{item.group.nextStep}</div>
          )}
          {item.group.campaigns.length === 0 ? null : (
            <div className={styles.watchWho}>
              {item.group.campaigns.map((one) => (
                <Link key={one.campaignId} className="lvl-3" href={`/zlavy/${one.campaignId}`}>
                  {one.name} <Dot />
                  {formatCountSk(one.items)}
                </Link>
              ))}
              {item.group.truncated ? <span className="lvl-3">a ďalšie zľavy</span> : null}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

/**
 * Hlavička rebríka. Drží `.zlist-h`, teda tú istú rolu popisku stĺpca ako
 * `table.tbl thead th` — dve tabuľky v jednej appke nesmú vyzerať ako z dvoch
 * rôznych appiek (D2).
 */
function RailHeader() {
  return (
    <div className="zlist-h zpick-h">
      <span>Zľava</span>
      <span>Názov a stav</span>
    </div>
  );
}

/* ═══════════════════════════ obrazovka ════════════════════════════════════ */

export interface DiscountsListProps {
  /**
   * Ktorá zľava je otvorená vpravo. `null` = trasa `/zlavy`, teda nič.
   * Číta sa z ADRESY (pozri `app/zlavy/(prehlad)/workspace.tsx`), nie zo stavu.
   */
  readonly selectedId?: number | null;
  /**
   * Obsah pravého stĺpca pri otvorenej zľave — `children` trasy `/zlavy/[id]`.
   * Kým nie je otvorené nič, kreslí sa namiesto neho karta zľavy na čele.
   */
  readonly detail?: ReactNode;
}

export function DiscountsList({ selectedId = null, detail = null }: DiscountsListProps) {
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
   * Rebrík je ÚPLNÝ zoznam živých zliav vrátane tej na čele — v majster/detail
   * musí byť vybrateľná každá. Poradie určuje `orderDiscounts()`.
   */
  const live = ordered.leading === null ? ordered.active : [ordered.leading, ...ordered.active];

  /*
   * Kto stojí na čele, rozhoduje `featureDiscounts()` — je to pravidlo
   * o dominante (P1) a musí sa dať overiť bez prehliadača. Obrazovka si tu
   * nesmie dopísať vlastnú podmienku; dve rôzne pravidlá o tom istom sa raz
   * rozídu a nebude vidieť, ktoré platí.
   */
  const { featured } = featureDiscounts(ordered);

  const stand = queue === null ? null : queueStandSentence(queue.standing.reason);
  const writing = queue !== null && queue.standing.writing;
  const alarming = queue === null ? [] : alarmingCards(queue.standing.blockers);
  /*
   * Prázdna fronta nie je problém a nemá o sebe hovoriť — bola by to veta,
   * ktorá stojí na obrazovke stále a nič nehlási (kontrakt UI, bod 3).
   *
   * Pri otvorenej zľave rám nekreslíme vôbec: dôvod, prečo fronta stojí, je
   * v tej chvíli v detaile vpravo a dva rovnaké rámy vedľa seba sú D16.
   */
  const showStand =
    selectedId === null &&
    stand !== null &&
    !writing &&
    queue !== null &&
    queue.standing.reason !== 'queue_empty';

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

      {/* Prečo sa práve teraz nezapisuje — nad rebríkom, nie v logu.
          Nie je to sekcia: kreslí sa len vtedy, keď niečo naozaj stojí. */}
      {showStand ? (
        <StandPanel stand={stand} cards={alarming} testId="discounts-standing" />
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

      {empty ? null : (
        <div className="zsplit">
          {/* MAJSTER — rebrík výberu vľavo. `styles.rail` je len háčik pre
              opravy geometrie riadku; tvar rebríka kreslí `globals.css`. */}
          <div className={`zsplit-rail ${styles.rail}`}>
            <div className="zlist" data-testid="discounts-active">
              <RailHeader />
              <div className={styles.listScroll}>
                {live.map((row) => (
                  <PickRow key={row.id} row={row} selected={row.id === selectedId} />
                ))}
              </div>
            </div>

            {/* Skončené — pod rozklikom, teda mimo počtu sekcií (P5). */}
            {ordered.finished.length === 0 ? null : (
              <details
                className={styles.fold}
                open={live.length === 0}
                data-testid="discounts-finished"
              >
                <summary>Skončené ({formatCountSk(ordered.finished.length)})</summary>
                <div className={styles.foldBody}>
                  <div className="zlist">
                    <div className={styles.listScroll}>
                      {ordered.finished.map((row) => (
                        <PickRow key={row.id} row={row} selected={row.id === selectedId} />
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            )}
          </div>

          {/* DETAIL — vpravo. Buď otvorená zľava z trasy, alebo, kým nie je
              otvorené nič, karta zľavy na čele: dominanta obrazovky (P1). */}
          <div className="zsplit-detail">
            {selectedId !== null
              ? detail
              : featured === null || head === null
                ? null
                : (
                    <section className="sec" data-testid="discounts-leading">
                      <div className={styles.top}>
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
                                <DiscountState
                                  sentence={sentenceOf(featured)}
                                  testId="leading-state"
                                />
                              </div>
                              <div className="lvl-3">
                                {head.sub === null ? null : (
                                  <>
                                    {head.sub}
                                    <Dot />
                                  </>
                                )}
                                {formatCountSk(featured.itemsTotal)}{' '}
                                {pluralSk(
                                  featured.itemsTotal,
                                  'produkt',
                                  'produkty',
                                  'produktov',
                                )}
                                <Dot />
                                zľava svieti {formatDateSk(featured.dateFrom)} –{' '}
                                {formatDateSk(featured.dateTo)}
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
                                  hotové{' '}
                                  <b className="est">{formatDateSk(featured.estimate.date)}</b>
                                </span>
                              </>
                            )}
                            {featured.itemsUncertain === 0 ? null : (
                              <>
                                <Dot />
                                <span className="flag">
                                  <FlagMark />
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

                      {/* Pásma zľavy na čele — výklad rozsahu v dominante. */}
                      <LeadTiers tiers={featured.tiers} />
                    </section>
                  )}

            {/* Druhá sekcia — len kým nie je otvorená zľava. Pri otvorenej
                zľave hovorí o nepodarených a neistých kusoch jej detail a dva
                rovnaké zoznamy vedľa seba sú D16. */}
            {selectedId === null && queue !== null ? <WatchSection queue={queue} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default DiscountsList;
