'use client';

/**
 * Aura Zľavy — TAB ZĽAVY, ZOZNAM A DETAIL (V6b, krok 1/3; kontrakt
 * `KONTRAKT-V6-DIZAJN-2026-09-02.md` D127, D133, D139, D143).
 *
 * Obrazovka odpovedá na jedinú otázku: **o koľko percent sa zlacňuje, koľkých
 * produktov sa to týka a ako ďaleko je zápis.**
 *
 * PREČO SA REBRÍK ZMENIL NA TABUĽKU (V6b, 2. 9. 2026)
 * ───────────────────────────────────────────────────
 * Do V6b bol majster 380 px široký rebrík (`.zsplit-rail`, `.zpick*`) a detail
 * stál vedľa neho. Samuel na túto obrazovku ukázal priamo: *„nevidím tam zoznam
 * produktov, neviem vytvoriť zľavu, nevidím, ktoré produkty sa nachádzali
 * v zľavách."* Všetky tri sťažnosti mali jednu príčinu — do 380 px sa nezmestí
 * nič okrem percenta, mena a stavu, takže:
 *
 *   · počet produktov v zľave na obrazovke NEBOL vôbec,
 *   · odkaz na položky zľavy tiež nie (viedol tam len detail),
 *   · a „Nová zľava" bolo `<summary>` v rozkliku, teda tlačidlo, ktoré treba
 *     najprv nájsť a otvoriť.
 *
 * Odteraz je majster **plnošírková tabuľka** (primitívum `Table`, D133/D137:
 * prilepená hlavička, kompaktný riadok) a detail sa kreslí POD ňou. Adresa
 * zostáva jediným zdrojom pravdy — mení sa geometria, nie mechanika:
 *
 *   1. Shell (tento komponent) je vykreslený v `app/zlavy/(prehlad)/layout.tsx`.
 *      Next.js layout medzi súrodeneckými trasami NEODMOUNTUJE, takže klik na
 *      riadok nechá tabuľku aj jej načítané dáta na mieste a vymení len obsah
 *      pod ňou.
 *   2. Detail je slot: `detail` je `children` z trasy `/zlavy/[id]`. Priamy
 *      odkaz, obnovenie stránky aj tlačidlo Späť fungujú presne ako predtým.
 *
 * Preto tu NIE JE ani `useState` na výber, ani vlastné načítanie detailu.
 * Kto by výber presunul do stavu, rozbije priamy odkaz na `/zlavy/[id]`.
 *
 * DOMINANTA JE PERCENTO (kontrakt UI, bod 21)
 * ───────────────────────────────────────────
 * Zľava sa nezakladá kvôli počtu položiek vo fronte — zakladá sa kvôli tomu,
 * o koľko sa zlacní. Najväčším prvkom obrazovky je preto percento a VŽDY len
 * jedno: keď je zľava otvorená, nesie dominantu jej detail; keď nie je otvorená
 * nič, nesie ju karta zľavy na čele (`.lvl-1 .big`, 64 px). Nikdy nie sú na
 * obrazovke obe naraz — to by bola dvojitá dominanta (P1).
 *
 * V riadku tabuľky je percento prvý a najsilnejší stĺpec, ale už len v hustote
 * tabuľky (`.rowPct b`). Do V6b malo 26 px, lebo riadok rebríka bol vysoký
 * 64 px; kompaktný riadok (D137: ~36 px) 26 px číslo neunesie a P1 dáva len
 * STROP (55 % dominanty), nie predpis. Nález UX2 („percento sa kvôli miestu
 * nesmie zmenšiť") tým neprestal platiť — zmizol jeho dôvod: v tabuľke má
 * každá hodnota vlastnú bunku, takže percento sa už nemá o čo tlačiť so
 * slovom „zapisuje sa" vedľa.
 *
 * Pri pásmach sa v dominante aj v riadku kreslí ROZSAH (`15–30 %`), nie
 * najvyššie percento. Najvyššie percento by tvrdilo, že toľko dostali všetky
 * produkty.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * ───────────────────────
 *
 *  1. **Nula sa nekreslí z neznalosti.** Keď sa zoznam nedá prečítať, povie sa
 *     to vetou; prázdny zoznam je tvrdenie, že žiadna zľava neexistuje (P7).
 *     Prázdno a „hľadanie nič nenašlo" sú DVE rôzne veci a majú dva rôzne
 *     stavové komponenty (`EmptyState` vs `NoResultsState`) — appka je dnes bez
 *     `shop_write` kľúča, takže prázdny zoznam je BEŽNÝ stav, nie výnimka (R4).
 *  2. **Odtiaľto sa nič nezapíše.** Každá cesta k novej zľave je `href` do
 *     `/zlavy/nova`, teda hodnoty formulára; skúška naprázdno a potvrdenie sa
 *     odohrajú tam nanovo (I3). Veta `NEW_DISCOUNT_GATE_SK` stojí pri tlačidle
 *     VIDITEĽNE, nie v rozkliku — do V6b sa dala prečítať až po otvorení
 *     `<summary>`, teda po tom, čo sa človek rozhodol.
 *  3. **Nič sa neobnovuje samo** (kontrakt UI, bod 4). Načítanie je
 *     zaregistrované v spoločnom mechanizme `layout/refresh.ts`; obrazovka si
 *     vlastné tlačidlo Obnoviť NEKRESLÍ — jediné je v stavovom pruhu.
 *  4. **Neisté nie je zlyhané** (D45). Príznak „nevieme, či sa zapísalo" sa
 *     nikdy nesčíta so zlyhaniami ani sa neschová.
 *  5. **Rozpočet zápisov na túto obrazovku nepatrí.** Číslo je v stavovom
 *     pruhu, rozpad v Nastaveniach (kontrakt UI, bod 15).
 *  6. **Stav nesie farba + značka + slovo** (§4 bod 3). Kreslí ho VÝHRADNE
 *     `DiscountState` (`campaigns/DiscountState.tsx`) a značky zo
 *     `ui/StatusMark.tsx`; druhý mechanizmus stavu zľavy tu vzniknúť nesmie.
 *  7. **Prečo fronta stojí, sa hovorí RAZ.** Keď je zľava otvorená, hovorí to
 *     jej detail; keď stojí z dôvodu, hovorí to `StandPanel`; inak to hovorí
 *     `StatusPill`. Dva rámy s tým istým dôvodom vedľa seba sú defekt D16.
 *
 * Vlastník: V6b, oblasť Zľavy — krok 1 (zoznam).
 */
import Link from 'next/link';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { StandPanel } from '@/components/campaigns/BlockerList';
import DiscountPresets from '@/components/campaigns/DiscountPresets';
import DiscountState from '@/components/campaigns/DiscountState';
import DiscountTimeline from '@/components/campaigns/DiscountTimeline';
import styles from '@/components/campaigns/zlavy.module.css';
import {
  featureDiscounts,
  orderDiscounts,
  progressPercent,
  sentenceOf,
  type OrderedDiscounts,
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
import { repeatDiscountHref } from '@/components/campaigns/presets-model';
import { useRefreshable } from '@/components/layout/refresh';
import { EmptyState, LoadingState, NoResultsState } from '@/components/states';
import {
  FlagMark,
  Note,
  PageHeader,
  Panel,
  PanelBody,
  PanelHead,
  Segmented,
  StatusPill,
  Table,
  ToneBadge,
  Toolbar,
  ToolbarSearch,
  ToolbarSpacer,
  type StatusTone,
  type TableCell,
  type TableColumn,
} from '@/components/ui';
import { NEVIEME } from '@/lib/ui/product-label';
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

/** Percento zľavy pre dominantu aj pre riadok tabuľky. */
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

/* ═════════════════ začatie novej zľavy odtiaľto (D127 bod 2) ══════════════ */

/** Sprievodca novou zľavou bez predplnenia — vyberie sa filtrom. */
export const NEW_DISCOUNT_HREF = '/zlavy/nova';

/**
 * Koľko minulých zliav sa ponúkne ako východisko. Rozbaľovadlo je rozcestník,
 * nie druhá tabuľka — zliav môže byť päťdesiat a všetky sú v tabuľke vyššie.
 */
export const REPEAT_CHOICES = 5;

/**
 * Veta, ktorá stojí nad KAŽDOU cestou k novej zľave. Nie je to zdvorilosť:
 * z tejto obrazovky sa zľava zapísať NEDÁ a človek to má vedieť skôr, než
 * klikne — inak by tlačidlo „Nová zľava" pri produktoch existujúcej zľavy
 * vyzeralo ako príkaz na zlacnenie.
 */
export const NEW_DISCOUNT_GATE_SK =
  'Odtiaľto sa nič nezapíše. Otvorí sa sprievodca, ktorý urobí skúšku naprázdno a vypýta si potvrdenie.';

/**
 * Adresa sprievodcu s KONKRÉTNYM výberom produktov (`?produkty=…`).
 *
 * Sú to hodnoty formulára, nie príkaz na zápis: percento, okno, skúška
 * naprázdno aj potvrdenie sa odohrajú v sprievodcovi nanovo (I3). Route, ktorá
 * by z tohto zoznamu vyrobila kampaň, neexistuje a vzniknúť nesmie.
 *
 * Neplatné a opakované ID sa ZAHADZUJÚ, nie opravujú — adresa je vstup od
 * človeka a sprievodca si aj tak vypýta riadky od API. Prázdny výber vracia
 * `null`: odkaz na sprievodcu „s ničím" by predstieral výber, ktorý neexistuje.
 */
export function newDiscountFromProductsHref(
  productIds: readonly number[],
): string | null {
  const seen = new Set<number>();
  for (const id of productIds) {
    if (Number.isInteger(id) && id > 0) seen.add(id);
  }
  if (seen.size === 0) return null;
  const params = new URLSearchParams();
  params.set('produkty', [...seen].join(','));
  return `${NEW_DISCOUNT_HREF}?${params.toString()}`;
}

/**
 * NOVÁ ZĽAVA ODTIAĽTO — tlačidlo, nie rozklik (D127 bod 2; V6b).
 *
 * Do 1. 9. 2026 tu stálo `<Link href="/zlavy/nova">`, čo je odkaz do prázdneho
 * formulára. Potom z toho bol `<details><summary class="btn">`, teda tlačidlo,
 * ktoré po kliknutí NIČ neotvorí, len sa rozbalí — a presne na to Samuel
 * povedal „neviem vytvoriť zľavu". Odteraz je hlavná cesta obyčajný odkaz
 * a rozklik nesie len DRUHÚ, menej častú cestu:
 *
 *   · **Nová zľava** — výber podľa filtra (predvolene ležiaky),
 *   · **Zopakovať minulú** — prenesú sa pásma a dĺžka okna, PRODUKTY NIE.
 *     Sada sa vyberie znova z dnešného katalógu, lebo minulá zľava bežala nad
 *     iným (`repeatDiscountHref`, D112).
 *
 * I3 sa tým NEOSLABUJE ani o kúsok: obe vetvy sú `href` do `/zlavy/nova`, teda
 * hodnoty formulára, a veta o skúške naprázdno je odteraz vidieť BEZ kliknutia.
 */
export function NewDiscountStart({ rows }: { rows: readonly DiscountRow[] }) {
  const choices = rows.slice(0, REPEAT_CHOICES);
  return (
    <div className={styles.startBox} data-testid="new-discount-start">
      <div className={styles.startRow}>
        <Link className="btn primary" href={NEW_DISCOUNT_HREF} data-testid="new-discount-link">
          Nová zľava
        </Link>
        {choices.length === 0 ? null : (
          <details className="stopq" data-testid="new-discount-repeat">
            <summary className="btn">Zopakovať minulú</summary>
            <div className="stopq-b">
              <span>
                Prenesú sa pásma a dĺžka okna; produkty sa vyberú nanovo z dnešného katalógu.
              </span>
              {choices.map((row) => (
                <Link
                  key={row.id}
                  className="btn sm"
                  href={repeatDiscountHref(row)}
                  data-testid="new-discount-repeat-one"
                >
                  {row.name} <Dot />
                  {row.percent} %
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
      {/* Bod 2 „čo sa tu nesmie pokaziť" — veta o I3 je vidieť bez kliknutia. */}
      <p className={styles.startGate}>{NEW_DISCOUNT_GATE_SK}</p>
    </div>
  );
}

/* ═════════════════ čo je v tabuľke vidieť a v akom poradí ═════════════════ */

/** Ktoré zľavy tabuľka práve ukazuje. Uzavretý zoznam. */
export const DISCOUNT_VIEWS = ['vsetky', 'zive', 'skoncene'] as const;

export type DiscountView = (typeof DISCOUNT_VIEWS)[number];

/** Slovenský popis prepínača. Slovo je platba, nie ozdoba. */
export const DISCOUNT_VIEW_LABEL: Readonly<Record<DiscountView, string>> = {
  vsetky: 'Všetky',
  zive: 'Živé',
  skoncene: 'Skončené',
};

/**
 * Hľadá sa v NÁZVE zľavy, nič viac.
 *
 * Zámerne to nie je fulltext nad položkami: zoznam zliav má päťdesiat riadkov
 * a človek v ňom hľadá „to letné dočistenie". Hľadanie podľa produktu je iná
 * otázka a má vlastnú obrazovku (Produkty → stĺpec „zľava v shope").
 *
 * Prázdny dopyt prepustí VŠETKO — filter, ktorý pri prázdnom poli nič
 * nenájde, vyzerá ako pokazený zoznam.
 */
export function matchesQuery(name: string, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('sk');
  if (needle === '') return true;
  return name.toLocaleLowerCase('sk').includes(needle);
}

/** Čo tabuľka ukáže a čo o tom povie pätka. */
export interface DiscountListView {
  /** Riadky v poradí naliehavosti (živé pred skončenými). */
  readonly rows: readonly DiscountRow[];
  readonly liveCount: number;
  readonly finishedCount: number;
  /**
   * `true` ⇔ zľavy EXISTUJÚ, ale filter ani hľadanie nenašli ani jednu. Je to
   * iná veta než prázdny zoznam (`NoResultsState` vs `EmptyState`) a zliať sa
   * nesmú: jedno je „ešte nič nevzniklo", druhé „hľadanie nič nenašlo".
   */
  readonly filteredOut: boolean;
}

/**
 * Prepínač a hľadanie nad UŽ USPORIADANÝM zoznamom.
 *
 * Poradie určuje `orderDiscounts()` a tento výber ho NEMENÍ — len z neho
 * vyberá. Keby si tabuľka triedila sama, mala by appka dve pravidlá o poradí
 * tých istých zliav a nebolo by vidieť, ktoré platí.
 */
export function viewDiscounts(
  ordered: OrderedDiscounts<DiscountRow>,
  view: DiscountView,
  query: string,
): DiscountListView {
  const live =
    ordered.leading === null ? ordered.active : [ordered.leading, ...ordered.active];
  const pool =
    view === 'zive'
      ? live
      : view === 'skoncene'
        ? ordered.finished
        : [...live, ...ordered.finished];
  const rows = pool.filter((row) => matchesQuery(row.name, query));
  const total = live.length + ordered.finished.length;

  return {
    rows,
    liveCount: live.length,
    finishedCount: ordered.finished.length,
    filteredOut: total > 0 && rows.length === 0,
  };
}

/**
 * STĹPCE TABUĽKY ZLIAV.
 *
 * Vlastná definícia, nie `lib/ui/product-columns.ts`: to je jednotná sada pre
 * tabuľky PRODUKTOV (D124) a zľava nie je produkt — nemá referenciu, nákupnú
 * cenu ani sklad. Pravidlo D124 („kde sa stĺpec nehodí, VYNECHÁ sa; nikdy sa
 * nepremenuje ani nenaplní inou veličinou") sem prišlo aj tak: každý stĺpec
 * nižšie nesie práve jednu veličinu a nič sa nedopočítava.
 *
 * Tri veci, ktoré sa v tomto zozname nesmú pokaziť:
 *
 *  A. **Počet produktov je ODKAZ** (D127, sťažnosť Samuela). Číslo samo
 *     nepovie, KTORÉ produkty to sú; odkaz vedie na detail zľavy, kde je ich
 *     zoznam s referenciou, cenou pred a po a stavom zápisu. Pri nule sa
 *     odkaz nekreslí — viedol by na prázdny zoznam.
 *  B. **Odhad dobehnutia je trojstavový.** Známy deň je hodnota, neznámy je
 *     POMLČKA s dôvodom v `title` (I11) — nikdy dnešný dátum ani nula.
 *     Tabuľka to označí `data-value="unknown"` a čítačke dopovie slovo.
 *  C. **Stav kreslí `DiscountState`.** Farba + značka + slovo v jednom uzle;
 *     príznak („nevieme, či sa zapísalo") stojí ZA stavom a nikdy namiesto
 *     neho — zľava so zlyhanými položkami stále beží (D45).
 */
export function discountColumns(
  selectedId: number | null,
): readonly TableColumn<DiscountRow>[] {
  return [
    {
      key: 'percent',
      header: 'Zľava',
      /* 112 px unesie aj rozsah pásiem („15–30 %") v hustote tabuľky. Do V6b
         to bolo 116 px pri 26 px písme v 64 px riadku rebríka. */
      width: '112px',
      headerTitle: 'Pri pásmach je to rozsah od najnižšieho po najvyššie percento.',
      cell: (row): TableCell => {
        const head = percentHeadline(row.percent, row.tiers);
        return {
          content: (
            <span className={styles.rowPct}>
              <b>{head.big}</b>
              {head.sub === null ? null : <i>{head.sub}</i>}
            </span>
          ),
        };
      },
    },
    {
      key: 'name',
      header: 'Názov',
      cell: (row): TableCell => {
        const open = row.id === selectedId;
        return {
          content: (
            <span className={styles.rowName}>
              <Link href={`/zlavy/${row.id}`} aria-current={open ? 'page' : undefined}>
                {row.name}
              </Link>
              {/* Tretí kanál otvoreného riadku: pozadie (farba) + `aria-current`
                  (značka) + SLOVO. Výber vyjadrený len pozadím by bol presne to,
                  čo pravidlo troch kanálov zakazuje. */}
              {open ? <span className={styles.rowOpen}>otvorená</span> : null}
            </span>
          ),
        };
      },
    },
    {
      key: 'state',
      header: 'Stav',
      width: '208px',
      cell: (row): TableCell => ({
        content: (
          <span className={styles.rowState}>
            <DiscountState sentence={sentenceOf(row)} />
            {/* D45 — neisté nie je zlyhané a slovník preň zatiaľ vetu nemá. */}
            {row.itemsUncertain === 0 ? null : (
              <span className="flag" data-testid="row-uncertain">
                <FlagMark />
                {formatCountSk(row.itemsUncertain)} nevieme, či sa zapísalo
              </span>
            )}
          </span>
        ),
      }),
    },
    {
      key: 'window',
      header: 'Okno platnosti',
      width: '154px',
      headerTitle: 'Odkedy dokedy je zľava v eshope viditeľná.',
      cell: (row): TableCell => ({
        content: (
          <span className={styles.nowrap}>
            {formatDateSk(row.dateFrom)} – {formatDateSk(row.dateTo)}
          </span>
        ),
      }),
    },
    {
      key: 'products',
      header: 'Produktov',
      align: 'right',
      width: '108px',
      headerTitle: 'Koľko produktov je v zľave. Číslo je odkaz na ich zoznam.',
      cell: (row): TableCell => {
        const count = formatCountSk(row.itemsTotal);
        if (row.itemsTotal === 0) {
          return {
            content: <span className={styles.nowrap}>{count}</span>,
            title: 'Do tejto zľavy nevstúpil ani jeden produkt.',
          };
        }
        return {
          content: (
            <Link
              className={styles.rowItems}
              href={`/zlavy/${row.id}`}
              aria-label={`Zoznam produktov zľavy ${row.name}`}
              data-testid="row-products"
            >
              {count}
            </Link>
          ),
          title: 'Otvorí zľavu; zoznam jej produktov je v nej pod rozklikom.',
        };
      },
    },
    {
      key: 'written',
      header: 'Zapísané',
      align: 'right',
      width: '124px',
      headerTitle: 'Koľkým produktom appka nižšiu cenu do eshopu naozaj zapísala.',
      cell: (row): TableCell => ({
        /*
         * Nález UX2: „zapísané 948 z 1 180" sa v jednoriadkovom rebríku
         * orezávalo presne na čísle. V tabuľke je to jedna bunka s vlastnou
         * šírkou, ale nedeliteľné to zostáva — inak sa pri úzkom okne odláme
         * práve to, kvôli čomu stĺpec existuje.
         */
        content: (
          <span className={styles.nowrap} data-testid="row-written">
            {formatCountSk(row.itemsOk)} z {formatCountSk(row.itemsTotal)}
          </span>
        ),
      }),
    },
    {
      key: 'estimate',
      header: 'Dobehne',
      width: '118px',
      headerTitle:
        'Odhadovaný deň, keď appka dopíše zvyšok tejto zľavy. Pomlčka = odhad zatiaľ nevieme.',
      cell: (row): TableCell => {
        if (row.estimate === null) {
          return {
            content: NEVIEME,
            unknown: true,
            title: 'Odhad dobehnutia zatiaľ nevieme — nie je to „hneď" ani „nikdy".',
          };
        }
        return {
          content: <b className={`est ${styles.nowrap}`}>{formatDateSk(row.estimate.date)}</b>,
        };
      },
    },
  ];
}

/* ═════════════════ čím je vyplnená obrazovka pod tabuľkou ═════════════════ */

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
    <Panel soft data-testid="leading-tiers">
      {/* `h3`: nadpis obrazovky je `h1` v `PageHeader`, meno zľavy na čele `h2`
          — preskočený stupeň by čítačke povedal, že medzi nimi niečo chýba. */}
      <PanelHead as="h3" title="Podľa čoho ktorý produkt zlacnel" />
      <PanelBody flush>
        <Table
          caption="Pásma zľavy na čele — pravidlo, počet produktov a percento"
          rows={tiers}
          rowKey={(tier) => String(tier.ord)}
          columns={[
            {
              key: 'ord',
              header: 'Pásmo',
              width: '76px',
              cell: (tier) => ({ content: <b className="lvl-2">{tier.ord}</b> }),
            },
            { key: 'label', header: 'Pravidlo', cell: (tier) => ({ content: tier.label }) },
            {
              key: 'items',
              header: 'Produktov',
              align: 'right',
              width: '112px',
              cell: (tier) => ({ content: formatCountSk(tier.itemsCount) }),
            },
            {
              key: 'percent',
              header: 'Zľava',
              align: 'right',
              width: '96px',
              cell: (tier) => ({ content: <b className="lvl-2">{tier.percent} %</b> }),
            },
          ]}
        />
      </PanelBody>
    </Panel>
  );
}

/** Jedna skupina pozornosti z `/api/queue` — stav, počet, kroky, dotknuté zľavy. */
interface WatchGroup {
  readonly key: string;
  readonly tone: StatusTone;
  /* Slovo pri značke. Stav nikdy nenesie iba farba (§4 bod 3). */
  readonly word: string;
  readonly group: QueueAttentionGroup;
}

/**
 * ČO ČAKÁ NA POZRETIE — druhá plocha zoznamu (UX2, 24. 8. 2026).
 *
 * Obrazovka končila na ~390 px z 900 a zvyšok bol prázdny. Nebolo to
 * rozloženie, bola to zahodená odpoveď: `/api/queue` sa na tejto obrazovke
 * číta už dnes (kvôli vete o stojacej fronte) a v tej istej odpovedi príde
 * `attention` — počty, MENÁ dotknutých zliav a veta o ďalšom kroku. Zoznam
 * z toho nepoužil nič.
 *
 * Prečo to nie je duplicita karty na čele (D16): karta hovorí, ako ďaleko je
 * JEDNA zľava. Táto plocha hovorí, ktorých zliav sa problém týka a čo s ním
 * robiť — to karta niesť nevie a nikde inde na obrazovke to nestojí.
 *
 * Nekreslí sa, keď nie je čo: prázdny rám s nulami by bol veta, ktorá stojí
 * na obrazovke stále a nič nehlási (kontrakt UI, bod 3).
 *
 * Značku stavu kreslí `ToneBadge` — kanonický vykresľovač tónu v riadku
 * (pozri hlavičku `ui/StatusPill.tsx`). Do V6b to bola trieda `.sig` z
 * `globals.css` so `SigMark` vedľa; badge robí to isté, ale slovo si vynúti
 * sám (`ui/signals.ts`), takže sa z troch kanálov nedajú stratiť dva.
 */
export function WatchSection({ queue }: { queue: QueueSnapshotView }) {
  const groups: WatchGroup[] = [];
  if (queue.attention.failed !== null && queue.attention.failed.items > 0) {
    groups.push({
      key: 'failed',
      tone: 'critical',
      word: 'nepodarilo sa',
      group: queue.attention.failed,
    });
  }
  if (queue.attention.uncertain !== null && queue.attention.uncertain.items > 0) {
    // D45 — neisté nie je zlyhané a nikdy sa s ním nesčíta.
    groups.push({
      key: 'uncertain',
      tone: 'attention',
      word: 'nevieme, či sa zapísalo',
      group: queue.attention.uncertain,
    });
  }
  if (groups.length === 0) return null;

  return (
    <Panel data-testid="discounts-attention">
      <PanelHead
        title="Čo čaká na pozretie"
        subtitle={
          /* Odhad celej fronty, nie tejto jednej zľavy — preto „celá fronta“.
             Keď ho appka nemá, povie to; nula by tu bola tvrdenie (P7). */
          queue.estimate === null ? (
            'celá fronta — odhad dobehnutia zatiaľ nevieme'
          ) : (
            <>
              celá fronta hotová <b className="est">{formatDateSk(queue.estimate.date)}</b>
            </>
          )
        }
      />
      <PanelBody>
        {groups.map((item) => (
          <div className={styles.watch} key={item.key} data-testid={`watch-${item.key}`}>
            <div className={styles.watchHead}>
              <ToneBadge tone={item.tone}>{item.word}</ToneBadge>
              <b className="lvl-2 num">{formatCountSk(item.group.items)}</b>
              <span className="lvl-3">{pluralSk(item.group.items, 'kus', 'kusy', 'kusov')}</span>
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
      </PanelBody>
    </Panel>
  );
}

/* ═══════════════════════ pilulka stavu fronty ═════════════════════════════ */

/** Čo má `StatusPill` nad tabuľkou povedať. `null` = nekreslí sa (D16). */
export interface QueuePillView {
  readonly tone: StatusTone;
  readonly label: string;
  readonly detail: string | null;
}

/**
 * STAV ZÁPISU JEDNOU PILULKOU — a nikdy vedľa `StandPanel`u (D16).
 *
 * Obrazovka o fronte hovorí najviac na jednom mieste. Rozdelenie je preto
 * úplné a nepretína sa:
 *
 *   · fronta stojí Z DÔVODU → hovorí `StandPanel`, pilulka je `null`,
 *   · fronta zapisuje → pilulka „Zapisuje sa" + odhad dobehnutia,
 *   · fronta je prázdna → pilulka „Fronta je prázdna",
 *   · odpoveď nedošla → pilulka „Stav fronty nepoznáme". Nie „prázdna": prázdno
 *     by bolo tvrdenie o fronte, ktorú appka nevidela (P7, I11).
 *
 * Do detailu ide odhad alebo nič — NIKDY doména, kľúč ani ich časť
 * (pozri bod 3 hlavičky `ui/StatusPill.tsx`).
 */
export function queuePillView(
  queue: QueueSnapshotView | null,
  standing: boolean,
): QueuePillView | null {
  if (queue === null) {
    return { tone: 'idle', label: 'Stav fronty nepoznáme', detail: null };
  }
  if (standing) return null;
  if (queue.standing.writing) {
    return {
      tone: 'progress',
      label: 'Zapisuje sa',
      detail:
        queue.estimate === null
          ? 'odhad dobehnutia zatiaľ nevieme'
          : `celá fronta hotová ${formatDateSk(queue.estimate.date)}`,
    };
  }
  if (queue.standing.reason === 'queue_empty') {
    return { tone: 'idle', label: 'Fronta je prázdna', detail: 'niet čo zapisovať' };
  }
  return null;
}

/* ═══════════════════════════ obrazovka ════════════════════════════════════ */

export interface DiscountsListProps {
  /**
   * Ktorá zľava je otvorená pod tabuľkou. `null` = trasa `/zlavy`, teda nič.
   * Číta sa z ADRESY (pozri `app/zlavy/(prehlad)/workspace.tsx`), nie zo stavu.
   */
  readonly selectedId?: number | null;
  /**
   * Obsah pod tabuľkou pri otvorenej zľave — `children` trasy `/zlavy/[id]`.
   * Kým nie je otvorené nič, kreslí sa namiesto neho karta zľavy na čele.
   */
  readonly detail?: ReactNode;
}

export function DiscountsList({ selectedId = null, detail = null }: DiscountsListProps) {
  const [rows, setRows] = useState<readonly DiscountRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [queue, setQueue] = useState<QueueSnapshotView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<DiscountView>('vsetky');
  const [query, setQuery] = useState('');

  /**
   * Jedno registrované načítanie pre obe čítania naraz. Zoznam hovorí, ČO
   * existuje; `/api/queue` hovorí, ČO SA PRÁVE DEJE a prečo prípadne nič.
   * Keď sa nedá prečítať fronta, zoznam sa kreslí ďalej — len bez vety o nej.
   */
  const load = useCallback(async () => {
    const [list, snapshot] = await Promise.all([listDiscounts(50), fetchQueue()]);
    if (list.ok) {
      setRows(list.data.data);
      setTotal(list.data.total);
      setFailed(null);
    } else {
      // Zlyhanie čítania NIE JE prázdny zoznam — prázdny zoznam je tvrdenie,
      // že žiadna zľava neexistuje, a to tu nikto nevie (P7).
      setRows(null);
      setTotal(null);
      setFailed(list.error.message);
    }
    setQueue(snapshot.ok ? snapshot.data : null);
  }, []);

  // Obnovuje sa VÝHRADNE na vyžiadanie — tlačidlo je v stavovom pruhu.
  const { pending } = useRefreshable(load);

  const ordered = useMemo<OrderedDiscounts<DiscountRow>>(
    () =>
      rows === null
        ? { leading: null, active: [], finished: [] }
        : orderDiscounts(rows),
    [rows],
  );

  const shown = useMemo(() => viewDiscounts(ordered, view, query), [ordered, view, query]);

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
   * v tej chvíli v detaile a dva rovnaké rámy pod sebou sú D16.
   */
  const showStand =
    selectedId === null &&
    stand !== null &&
    !writing &&
    queue !== null &&
    queue.standing.reason !== 'queue_empty';

  const pill = selectedId === null ? queuePillView(queue, showStand) : null;

  const loading = pending && rows === null && failed === null;
  const empty = rows !== null && rows.length === 0;
  const head = featured === null ? null : percentHeadline(featured.percent, featured.tiers);
  const featuredDone =
    featured === null ? 0 : featured.itemsOk + featured.itemsFailed + featured.itemsUncertain;
  /* Server vracia najviac 50 riadkov; keď ich je viac, obrazovka to MUSÍ
     povedať číslom — inak by mlčky tvrdila, že zliav je päťdesiat. */
  const truncated = total !== null && rows !== null && total > rows.length;

  return (
    <div className={styles.page} data-testid="discounts-list">
      <PageHeader
        title="Zľavy"
        description="Zľava je sada produktov, ktorým appka na zvolené obdobie zapíše nižšiu cenu."
        /* Pri prázdnej obrazovke nesie jedinú akciu prázdny stav (bod 11). */
        actions={
          empty ? null : (
            <>
              {pill === null ? null : (
                <StatusPill
                  tone={pill.tone}
                  label={pill.label}
                  detail={pill.detail}
                  testId="discounts-queue-pill"
                />
              )}
              <NewDiscountStart rows={[...shown.rows, ...ordered.finished]} />
            </>
          )
        }
        testId="discounts-head"
      />

      {failed === null ? null : (
        <Note variant="err" testId="discounts-error">
          Zoznam zliav sa nepodarilo načítať: {failed} Ďalší pokus: tlačidlo Obnoviť v stavovom
          pruhu.
        </Note>
      )}

      {/* Prečo sa práve teraz nezapisuje — nad tabuľkou, nie v logu.
          Kreslí sa len vtedy, keď niečo naozaj stojí. */}
      {showStand ? (
        <StandPanel stand={stand} cards={alarming} testId="discounts-standing" />
      ) : null}

      {loading ? <LoadingState label="Načítavam zľavy…" blocks={3} /> : null}

      {empty ? (
        <EmptyState
          story="prazdno"
          title="Zatiaľ tu nie je ani jedna zľava"
          description="Založte prvú: vyberiete produkty filtrom a appka im na zvolené obdobie zapíše nižšiu cenu."
          /* Druhá veta patrí do slotu, nie do `description` — a je to práve tá
             veta o I3, ktorá sa oslabiť nesmie. */
          note={<Note variant="info">{NEW_DISCOUNT_GATE_SK}</Note>}
          action={
            <Link className="btn primary" href={NEW_DISCOUNT_HREF} data-testid="new-discount-link">
              Nová zľava
            </Link>
          }
          testId="discounts-empty"
        />
      ) : null}

      {loading || empty ? null : (
        <>
          <Toolbar>
            <ToolbarSearch
              value={query}
              onChange={setQuery}
              placeholder="Hľadať zľavu podľa názvu"
              ariaLabel="Hľadať zľavu podľa názvu"
              testId="discounts-search"
            />
            <ToolbarSpacer />
            <Segmented
              value={view}
              onChange={setView}
              ariaLabel="Ktoré zľavy sa majú vypísať"
              options={DISCOUNT_VIEWS.map((one) => ({
                value: one,
                label: DISCOUNT_VIEW_LABEL[one],
              }))}
              testId="discounts-view"
            />
          </Toolbar>

          <Table
            caption="Zľavy — percento, názov, stav, okno platnosti, počet produktov a koľko z nich je zapísaných"
            columns={discountColumns(selectedId)}
            rows={shown.rows}
            rowKey={(row) => String(row.id)}
            rowMeta={(row) => ({
              selected: row.id === selectedId,
              /* Skončená zľava je tlmená — je to kontext, nie práca. Tlmenie
                 NIE JE stav: stav nesie stĺpec „Stav" farbou, značkou a slovom. */
              muted: sentenceOf(row).state === 'skončila',
              testId: 'discount-row',
            })}
            empty={
              <NoResultsState
                description="Filtru ani hľadanému názvu neodpovedá ani jedna zľava — prázdna tabuľka to neznamená."
                action={
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setQuery('');
                      setView('vsetky');
                    }}
                    data-testid="discounts-filters-reset"
                  >
                    Zrušiť filtre
                  </button>
                }
                testId="discounts-noresults"
              />
            }
            footer={
              <p className={styles.tableFoot} data-testid="discounts-count">
                {formatCountSk(shown.liveCount)}{' '}
                {pluralSk(shown.liveCount, 'živá', 'živé', 'živých')}
                <Dot />
                {formatCountSk(shown.finishedCount)}{' '}
                {pluralSk(shown.finishedCount, 'skončená', 'skončené', 'skončených')}
                {truncated ? (
                  <>
                    <Dot />
                    <span data-testid="discounts-truncated">
                      appka číta najnovších {formatCountSk(rows!.length)} z{' '}
                      {formatCountSk(total!)} — starším sa zoznam zatiaľ nedostane
                    </span>
                  </>
                ) : null}
              </p>
            }
            testId="discounts-table"
          />
        </>
      )}

      {/* DETAIL — pod tabuľkou. Buď otvorená zľava z trasy, alebo, kým nie je
          otvorené nič, karta zľavy na čele: dominanta obrazovky (P1). */}
      {selectedId !== null ? (
        detail
      ) : featured === null || head === null ? null : (
        <Panel data-testid="discounts-leading">
          <PanelHead
            title={<Link href={`/zlavy/${featured.id}`}>{featured.name}</Link>}
            subtitle={
              <>
                {head.sub === null ? null : (
                  <>
                    {head.sub}
                    <Dot />
                  </>
                )}
                {formatCountSk(featured.itemsTotal)}{' '}
                {pluralSk(featured.itemsTotal, 'produkt', 'produkty', 'produktov')}
                <Dot />
                zľava svieti {formatDateSk(featured.dateFrom)} – {formatDateSk(featured.dateTo)}
              </>
            }
            actions={
              <>
                <Link className="btn primary" href={`/zlavy/${featured.id}`}>
                  Detail
                </Link>
                {featured.itemsPending === 0 ? null : (
                  <StopQueue id={featured.id} onChanged={() => void load()} />
                )}
              </>
            }
          />
          <PanelBody>
            <div className={styles.feature}>
              <div className="lvl-1" data-testid="leading-percent">
                <span className="big">{head.big}</span>
              </div>
              <div className={styles.featureMeta}>
                <div className="row wrapx">
                  <DiscountState sentence={sentenceOf(featured)} testId="leading-state" />
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
                    hotové <b className="est">{formatDateSk(featured.estimate.date)}</b>
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

            {/* Pásma zľavy na čele — výklad rozsahu v dominante. */}
            <LeadTiers tiers={featured.tiers} />
          </PanelBody>
        </Panel>
      )}

      {/* Len kým nie je otvorená zľava. Pri otvorenej zľave hovorí
          o nepodarených a neistých kusoch jej detail a dva rovnaké zoznamy pod
          sebou sú D16. */}
      {selectedId === null && queue !== null ? <WatchSection queue={queue} /> : null}

      {/*
       * DVA ROZKLIKY POD OBRAZOVKOU (V4, 31. 8. 2026) — teda mimo počtu sekcií
       * (P5) a pod dominantou (P1):
       *
       *  · PRESETY (D112) — pomenované kombinácie filtra, pásiem a dĺžky okna.
       *    Klik na preset je ODKAZ na formulár novej zľavy; zľava sa aj z neho
       *    zapíše až po skúške naprázdno a po potvrdení (I3, K7).
       *  · OKNÁ ZLIAV V ČASE (graf G1) — `/api/insights/timeline`. Tabuľka
       *    hovorí, ktoré zľavy existujú; os hovorí, kedy sa prekrývajú.
       *
       * Kreslia sa aj na prázdnej obrazovke: preset môže existovať skôr než
       * prvá zľava a os to vie priznať vetou.
       */}
      <DiscountPresets />
      <DiscountTimeline />
    </div>
  );
}

export default DiscountsList;
