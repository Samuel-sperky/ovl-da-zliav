'use client';

/**
 * Aura Zľavy — TOP 10 A FLOP 10 NA PREHĽADE (V4, D113).
 *
 * OTÁZKA: „čo sa predáva a čo leží?" Poradie stojí VÝHRADNE na predaných
 * KUSOCH — tržba per produkt neexistuje, API ceny položiek nevracia (D117),
 * takže tu nie je a nikdy nebude ani jedno euro na produkt.
 *
 * ═══ ČO ZNAMENÁ „FLOP" (a čo NEznamená) ═══
 * Flop je **najslabší Z PREDÁVANÝCH**, nie „nepredáva sa". Produkt bez jediného
 * nameraného predaja do rebríčka NEVSTUPUJE — ani na dno flopu:
 *
 *  · Kým okno nie je celé dočítané, „0 predaných" o ňom nie je meranie (I11).
 *    Postaviť ho na dno by z výpadku sťahovania spravilo najhoršie predávaný
 *    produkt eshopu.
 *  · Aj pri dočítanom okne je „za 30 dní ani jeden kus" INÁ otázka než „ktorý
 *    z predávaných je najslabší". Prvá je zoznam ležiakov a odpovedá na ňu tab
 *    Produkty, kde sa dá filtrovať a stránkovať.
 *
 * Sekcia to musí POVEDAŤ, nie len ticho vynechať — inak vyzerá desať riadkov
 * flopu ako desať najhorších produktov eshopu. Preto tá veta pod zoznamom.
 *
 * ═══ ŽIADNA TABUĽKA ═══
 * Architektúra §1: „Tabuľka produktov — Prehľad NIKDY, Produkty vždy." Toto je
 * ZOZNAM desiatich zistení, nie nástroj na prácu s katalógom: bez zaškrtávania,
 * bez triedenia, bez stránkovania. Stráži to `prehlad.spec.ts`, ktorý v celom
 * `components/dashboard` nedovolí ani jednu tabuľkovú značku. POZOR: ten skener
 * NEODSTRIHUJE komentáre, takže sa tá značka nesmie napísať ani sem — vypísať
 * ju v tejto vete znamená zhodiť test, ktorý vetu popisuje.
 *
 * ═══ POMENOVANIE (D116) ═══
 * Každý riadok ide cez `productLabel()` — „referencia · názov", `#id` až
 * v technickom detaile. Neobohatený produkt referenciu NEMÁ a sekcia to
 * priznáva: nie preto, že by ju nemal shop, ale preto, že sa k nej appka ešte
 * nedostala (D118).
 *
 * ČÍTA LEN LOKÁLNU DB (K8) — dáta prídu hotové z `/api/insights/top-products`.
 *
 * Vlastník: V4.
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';

import styles from '@/components/dashboard/overview.module.css';
import type { OverviewWindow, RankRow } from '@/components/dashboard/overview-model';
import type { TopFlopView } from '@/components/dashboard/window-api';
import { fetchJson } from '@/components/layout/health';
import { useRefreshable } from '@/components/layout/refresh';
import { RowBar, SharePie } from '@/components/ui/Charts';
import {
  CHART_KINDS,
  barLayout,
  distributionCaption,
  distributionPieInput,
  readCatalogDistribution,
  type Bar,
  type CatalogDistributionView,
} from '@/components/ui/chart-language';
import {
  LOCKED_DIMENSION_REASON,
  lockedDimensionName,
} from '@/lib/ui/locked-dimensions';
import { formatCountSk, pluralSk } from '@/lib/ui/vocabulary';
import { NEVIEME, productLabel } from '@/lib/ui/product-label';

export interface TopFlopSectionProps {
  /**
   * `null` = odpoveď sa nepodarilo prečítať. `undefined` = ešte sa nenačítala,
   * a to je INÝ stav: „nepodarilo sa" je tvrdenie o appke, kým „ešte nemáme" je
   * tvrdenie o čase. Zliať ich znamená hlásiť poruchu počas načítavania.
   */
  data: TopFlopView | null | undefined;
  windowDays: OverviewWindow;
}

function pieces(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'kus', 'kusy', 'kusov')}`;
}

function dayCount(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'deň', 'dni', 'dní')}`;
}

/**
 * Jeden riadok rebríčka.
 *
 * Marža a sklad sú z obohatenia (`getFull`), takže pri neobohatenom produkte
 * NIE SÚ nula — sú pomlčka. `qty: 0` je naopak platná nula: „na sklade nič"
 * je meraný fakt a nesmie sa tváriť ako nevedomosť.
 */
function Row({ row, bar }: { row: RankRow; bar: Bar | undefined }) {
  const label = productLabel({
    productId: row.productId,
    reference: row.reference,
    name: row.name,
  });

  const facts: string[] = [];
  facts.push(row.qty === null ? `sklad ${NEVIEME}` : `sklad ${formatCountSk(row.qty)}`);
  facts.push(
    row.marginPercent === null ? `marža ${NEVIEME}` : `marža ${row.marginPercent} %`,
  );
  if (row.discountedNow) facts.push('teraz zlacnený');

  return (
    <li className={styles.rankRow} data-testid="rank-row" data-product={row.productId}>
      <Link className={styles.rankName} href={`/produkty?produkt=${row.productId}`}>
        {label.text}
      </Link>
      <span className="num">{pieces(row.units)}</span>
      {/*
        Stĺpec je DRUHÝ kanál nad číslom, ktoré v riadku už stojí (D126).
        Mierka je jedna pre OBA stĺpce rebríčka — keby si flop škáloval sám,
        jeho najslabší produkt by mal pás cez celý riadok a vyzeral by ako
        najpredávanejší. Preto je `aria-hidden`: číslo vedľa neho hovorí to isté.
      */}
      {bar === undefined ? null : <RowBar bar={bar} />}
      <span className={styles.rankNote}>
        {label.referenceUnknown
          ? `${label.technical} · kód produktu ešte nemáme · ${facts.join(' · ')}`
          : `${label.technical} · ${facts.join(' · ')}`}
      </span>
    </li>
  );
}

function Column({
  title, rows, empty, testId, bars,
}: {
  title: string;
  rows: readonly RankRow[];
  empty: string;
  testId: string;
  /** Stĺpce podľa produktu — z JEDNEJ mierky cez oba zoznamy. */
  bars: ReadonlyMap<number, Bar>;
}) {
  return (
    <div className={styles.rankCol}>
      <span className="lvl-2">{title}</span>
      {rows.length === 0 ? (
        <div className="lvl-3" data-testid={`${testId}-empty`}>
          {empty}
        </div>
      ) : (
        <ul className={styles.rankList} data-testid={testId}>
          {rows.map((row) => (
            <Row key={row.productId} row={row} bar={bars.get(row.productId)} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Prázdny stav je JEDNA VETA s DÔVODOM, nikdy „žiadne dáta". Prázdny rebríček
 * môže znamenať nedočítané okno alebo príliš veľkú kohortu — a to sú dve rôzne
 * veci s dvomi rôznymi ďalšími krokmi.
 */
function Thin({ reason }: { reason: string }) {
  return (
    <div className={styles.thin} data-testid="overview-rank" data-mode="empty">
      <span className="lvl-2">{`Čo sa predáva — ${reason}`}</span>
      <Link className="btn sm" href="/produkty">
        Otvoriť Produkty
      </Link>
    </div>
  );
}

/**
 * Prázdny rebríček PLUS koláč rozdelenia.
 *
 * Sú to dve nezávislé tvrdenia z dvoch dotazov: rebríček hovorí o desiatich
 * riadkoch, koláč o celom katalógu. Keď zlyhá prvé, druhé platí ďalej — a je
 * to práve to, čo pri chudobnom rebríčku človek potrebuje vidieť.
 */
export function ThinWithPie({
  reason,
  distribution,
  windowDays,
}: {
  reason: string;
  distribution: CatalogDistributionView | null | undefined;
  windowDays: OverviewWindow;
}) {
  return (
    <section className="sec" data-testid="overview-rank-empty">
      <Thin reason={reason} />
      <Distribution view={distribution} windowDays={windowDays} />
    </section>
  );
}

/* ═══════════ Rozdelenie katalógu — koláč (D126, `by=sold`) ═══════════════ */

/**
 * Rozdelenie miestnej kópie katalógu do vedier predajnosti.
 *
 * Číta sa VLASTNÝM dotazom, nie z props: je to tvrdenie o CELOM katalógu, kým
 * rebríček je tvrdenie o desiatich riadkoch. Zliať ich do jednej odpovede by
 * znamenalo, že sa jedno bez druhého nedá ukázať — a práve ten diel „nevieme"
 * je zaujímavý aj vtedy, keď je rebríček chudobný.
 *
 * Okno sa ZÁMERNE neposiela. Prepínač Prehľadu ponúka aj 7 dní, ktoré route
 * medzi povolenými oknami predajnosti nemá; posielať ho by znamenalo buď 400,
 * alebo druhý zoznam povolených okien v klientovi. Server preto vyberie svoje
 * a koláč povie, za aké okno platí — vrátane vety, keď sa od rebríčka líši.
 *
 * TRI STAVY (I11): `undefined` = ešte sa nenačítalo, `null` = nedá sa prečítať,
 * pohľad = dáta. Prvé dva sa nesmú zliať — jedno je o čase, druhé o poruche.
 */
function useCatalogDistribution(): CatalogDistributionView | null | undefined {
  const [view, setView] = useState<CatalogDistributionView | null | undefined>(undefined);

  const load = useCallback(async () => {
    const body = await fetchJson<unknown>('/api/insights/catalog-distribution?by=sold');
    setView(readCatalogDistribution(body));
  }, []);

  useRefreshable(load);

  return view;
}

function Distribution({
  view,
  windowDays,
}: {
  view: CatalogDistributionView | null | undefined;
  windowDays: OverviewWindow;
}) {
  if (view === undefined) return null;
  if (view === null) {
    return (
      <div className="fresh" data-testid="rank-distribution" data-mode="unreadable">
        Rozdelenie katalógu sa nepodarilo prečítať, tak ho neuvádzame
      </div>
    );
  }

  /*
   * Dve rôzne okná vedľa seba sa musia POVEDAŤ. Bez tejto vety by koláč
   * a rebríček vyzerali ako dve odpovede na tú istú otázku.
   *
   * Veta nehovorí PREČO sa líšia — dôvod závisí od toho, ktoré okná route
   * povoľuje, a to je vec servera. Tvrdiť tu príčinu by znamenalo držať
   * v klientovi druhý zoznam povolených okien, ktorý sa raz rozíde.
   */
  const windowNote =
    view.soldWindowDays === windowDays
      ? null
      : `Rebríček je za ${dayCount(windowDays)}, rozdelenie za ${dayCount(view.soldWindowDays)} — nie sú to čísla za to isté obdobie.`;

  /*
   * ZAMKNUTÉ ROZMERY SÚ VIDIEŤ, NIE SKRYTÉ (K4, 1. 9. 2026).
   *
   * Routa posiela `locked` a jej vlastný komentár hovorí, že ich UI má ukázať
   * zamknuté; klient ich do tejto opravy ZAHADZOVAL. Koláč teda ukázal
   * rozdelenie podľa predajnosti a mlčal o tom, že podľa kategórie, kovu ani
   * typu šperku sa katalóg rozdeliť NEDÁ — takže to vyzeralo, že iné rozmery
   * appka neponúka, namiesto toho, aby bolo vidieť zámok a dôvod.
   */
  const locked = view.locked
    .map((dimension) => lockedDimensionName(dimension))
    .filter((name) => name !== null);

  return (
    <div data-testid="rank-distribution" data-mode="data">
      <SharePie
        input={distributionPieInput(view)}
        caption={`Rozdelenie: ${distributionCaption(view)}`}
        label={`Koláčový graf, ${CHART_KINDS.pie} — ako sa miestna kópia katalógu delí podľa predaja; diel „nevieme" je vidieť`}
        note={windowNote}
        testId="rank-distribution-pie"
      />
      {locked.length === 0 ? null : (
        <div className="fresh" data-testid="rank-distribution-locked">
          {`Rozdeliť sa nedá podľa: ${locked.join(' · ')}. ${LOCKED_DIMENSION_REASON}`}
        </div>
      )}
    </div>
  );
}

export function TopFlopSection({ data, windowDays }: TopFlopSectionProps) {
  // Hook stojí PRED prázdnymi stavmi — podmienené volanie hooku React zakazuje.
  const distribution = useCatalogDistribution();

  if (data === undefined) {
    return (
      <div className="sec ovl-skeleton" style={{ minHeight: '160px' }} aria-busy="true" />
    );
  }
  /*
   * KOLÁČ PREŽIJE CHUDOBNÝ REBRÍČEK (1. 9. 2026, nález overovateľa I11).
   *
   * Do tejto opravy stál `<Distribution/>` až v poslednej vetve, takže sa pri
   * `data.available === false` nenakreslil vôbec — a to je DNEŠNÝ stav appky:
   * `orders_read` je neoverený a nie je stiahnutý ani jeden deň predajov (P1
   * kontraktu V5). Človek teda videl jednu vetu „nie je dočítaný ani jeden deň"
   * a NEVIDEL jediný graf, ktorý mu vie povedať, že 100 % katalógu je v diele
   * „nevieme". Docblock `useCatalogDistribution()` pritom sľuboval presný opak:
   * „práve ten diel ‚nevieme' je zaujímavý aj vtedy, keď je rebríček chudobný."
   *
   * Koláč je vlastné čítanie nad CELÝM katalógom (`/api/insights/catalog-distribution`),
   * nezávislé od rebríčka — nedostupný rebríček o ňom nehovorí nič.
   */
  if (data === null) {
    return (
      <ThinWithPie
        reason="rebríček sa nepodarilo načítať."
        distribution={distribution}
        windowDays={windowDays}
      />
    );
  }
  if (!data.available) {
    return (
      <ThinWithPie
        reason={
          data.reason === 'cohort_too_large'
            ? 'predávaných produktov je na poctivé poradie priveľa.'
            : `za ${dayCount(windowDays)} nie je dočítaný ani jeden deň predajov.`
        }
        distribution={distribution}
        windowDays={windowDays}
      />
    );
  }

  /*
   * `null` = odpoveď to pole nepovedala. Nula by tvrdila „ani jeden produkt sa
   * nepredáva" a to je tvrdenie, ktoré appka nemá čím kryť (I11).
   */
  const cohort = data.cohortSize;
  const cohortNote =
    cohort === null
      ? `koľko produktov má predaj za ${dayCount(windowDays)}, sa nepodarilo zistiť`
      : `${formatCountSk(cohort)} ${pluralSk(cohort, 'produkt s predajom', 'produkty s predajom', 'produktov s predajom')} za ${dayCount(windowDays)}`;
  /*
   * Priznanie medzery nesmie samo klamať číslom: pri nečitateľnom `gaps`
   * (`unknownDays === null`) sa nepíše „0 dní", ale to, že sa počet dní
   * nezistil (31. 8. 2026).
   */
  /*
   * JEDNA mierka cez oba zoznamy. Flop má z definície menšie čísla než top;
   * keby si škáloval sám, jeho najslabší produkt by mal pás cez celý riadok.
   */
  const layout = barLayout(
    [...data.top, ...data.flop].map((row) => ({ key: String(row.productId), value: row.units })),
  );
  const bars = new Map<number, Bar>(layout.bars.map((bar) => [Number(bar.key), bar]));

  const gapNote =
    data.unknownDays === null
      ? 'Koľko dní okna appka nemá celé, sa nepodarilo zistiť — súčty aj poradie sú dolná hranica'
      : `${dayCount(data.unknownDays)} okna appka nemá celé, takže súčty aj poradie sú dolná hranica`;

  return (
    <section className="sec" data-testid="overview-rank" data-mode="data">
      <div className="sec-h">
        <h2>Čo sa predáva</h2>
        <div className="act">
          <span className="lvl-3">{cohortNote}</span>
        </div>
      </div>

      <div className={styles.rankGrid}>
        <Column
          title="Najviac predané"
          rows={data.top}
          empty="Za toto okno nemáme ani jeden nameraný predaj."
          testId="rank-top"
          bars={bars}
        />
        <Column
          title="Najmenej predané z predávaných"
          rows={data.flop}
          empty="Za toto okno nemáme ani jeden nameraný predaj."
          testId="rank-flop"
          bars={bars}
        />
      </div>

      {/*
        Dve priznania, obe povinné a obe o inej veci:
         · KOHO sa rebríček netýka (produkt bez predaja) — bez tejto vety je
           flop čitateľný ako „desať najhorších produktov eshopu",
         · AKO ÚPLNÉ je okno — pri nedočítaných dňoch je dolnou hranicou aj
           samotné PORADIE, nie len súčty.
      */}
      <div className="fresh" data-testid="rank-excludes">
        Produkt bez nameraného predaja tu nie je ani v jednom stĺpci — „nula
        predaných" o ňom appka netvrdí. Ležiaky sú v Produktoch.
      </div>

      {data.rankingState === 'measured' ? null : (
        <div className="fresh" data-testid="rank-gap">
          {gapNote}
        </div>
      )}

      {/*
        Koláč odpovedá na to, na čo rebríček odpovedať NEVIE: koľko z katalógu
        vôbec do rebríčka mohlo vstúpiť. Diel „nevieme" je tá časť, o ktorej
        appka predaj nezmerala — bez neho by desať riadkov vyzeralo ako obraz
        celého eshopu.
      */}
      <Distribution view={distribution} windowDays={windowDays} />
    </section>
  );
}

export default TopFlopSection;
