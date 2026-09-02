'use client';

/**
 * Aura Zľavy — TOP 10 A FLOP 10 NA PREHĽADE (V4, D113; primitíva V6b).
 *
 * OTÁZKA: „čo sa predáva a čo leží?" Poradie stojí VÝHRADNE na predaných
 * KUSOCH — tržba per produkt neexistuje, API ceny položiek nevracia (D117),
 * takže tu nie je a nikdy nebude ani jedno euro na produkt.
 *
 * ═══ FORMA: VODOROVNÝ REBRÍK (D126, D136) ═══
 * „Čo je najviac a čo najmenej" je POROVNANIE MEDZI POLOŽKAMI, takže sa kreslí
 * `BarList`-om z `components/ui` — jedno pravidlo osi (`barListBars()`), jedno
 * šrafovanie a jedna podoba pomlčky pre celú appku. Do V6b tu stál vlastný
 * `<ul>` s vlastnou mierkou; dva rebríky s dvomi pravidlami sú presne ten dlh,
 * ktorý D142 zakazuje.
 *
 * Mierka je JEDNA cez oba zoznamy (`barListBars(barListInputs(top),
 * barListInputs(flop))`). Keby si flop škáloval sám, jeho najslabší produkt by
 * mal pás cez celý riadok a vyzeral by ako najpredávanejší.
 *
 * ═══ ČO ZNAMENÁ „FLOP" (a čo NEznamená) ═══
 * Flop je **najslabší Z PREDÁVANÝCH**, nie „nepredáva sa". Produkt bez jediného
 * nameraného predaja do rebríka NEVSTUPUJE — ani na dno flopu:
 *
 *  · Kým okno nie je celé dočítané, „0 predaných" o ňom nie je meranie (I11).
 *    Postaviť ho na dno by z výpadku sťahovania spravilo najhoršie predávaný
 *    produkt eshopu.
 *  · Aj pri dočítanom okne je „za 30 dní ani jeden kus" INÁ otázka než „ktorý
 *    z predávaných je najslabší". Prvá je zoznam ležiakov a odpovedá na ňu tab
 *    Produkty, kde sa dá filtrovať a stránkovať.
 *
 * Sekcia to musí POVEDAŤ, nie len ticho vynechať — inak vyzerá desať riadkov
 * flopu ako desať najhorších produktov eshopu.
 *
 * ═══ A MUSÍ TO POVEDAŤ ČÍSLOM (D121, 2. 9. 2026) ═══
 * Veta „produkt bez nameraného predaja tu nie je" je pravdivá a bola
 * NEMERATEĽNÁ: človek z nej nevedel, či sa to týka desiatich produktov, alebo
 * štyridsiatich tisíc — teda či je rebrík obrazom eshopu, alebo jeho stotinou.
 * Odpoveď `/api/insights/top-products` preto nesie `excludes.unknownSales`
 * a `excludes.measuredZeroSales` a sekcia ich vypisuje pod rebríkom.
 *
 * Sú to DVE čísla, nie jedno: „appka predaj nemerala" a „appka namerala nulu"
 * sú dve rôzne veci a zliať ich do jedného „vylúčených" je presne to, čo I11
 * zakazuje. Keď odpoveď čísla nedá (`null` — počty zrkadla platia len za
 * povolené okná predajnosti), sekcia to PRIZNÁ a nedopíše nulu.
 *
 * Pasca, ktorú to má chytiť: D121 raz už end-to-end NEPLATIL, lebo
 * `/api/catalog/search` posielala `unitsSold: 0` namiesto `null` a nemala ani
 * jeden test. Preto sa telo odpovede overuje v
 * `test/integration/insights-v4.spec.ts`, nie len model.
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
 * v technickom detaile. V rebríku je na produkt JEDEN RIADOK TEXTU, takže je to
 * `productLabel()`, nie `productNameCell()`: ten je pre tabuľky, kde má
 * referencia vlastný stĺpec (D122). Neobohatený produkt referenciu NEMÁ a
 * sekcia to priznáva: nie preto, že by ju nemal shop, ale preto, že sa k nej
 * appka ešte nedostala (D118).
 *
 * ═══ PRÁZDNO JE BEŽNÝ STAV (R4) ═══
 * Appka je dnes bez `orders_read` aj bez `shop_write` kľúča, takže prázdny
 * rebrík je to, čo človek uvidí najčastejšie — a preto sa kreslí rodinou
 * `components/states`, nie jednou tlmenou vetou. Štyri príbehy sa NEZLIEVAJÚ:
 *
 *   `undefined`                → `LoadingState`     (odpoveď ešte nedošla)
 *   `null`                     → `ErrorState`       (odpoveď sa nedá prečítať)
 *   `available: false`         → `UnmeasuredState`   (nemerali sme to)
 *   prázdno pri dočítanom okne → `EmptyState`        (nula je odpoveď)
 *
 * Posledné dva sú ten rozdiel, na ktorom appka stojí: „nič sa nepredalo" je
 * tvrdenie o eshope a smie zaznieť len vtedy, keď je okno celé dočítané.
 *
 * ČÍTA LEN LOKÁLNU DB (K8) — dáta prídu hotové z `/api/insights/top-products`.
 *
 * Vlastník: V4; primitíva V6b.
 */
import Link from 'next/link';
import { useCallback, useState } from 'react';

import styles from '@/components/dashboard/overview.module.css';
import type { OverviewWindow, RankRow } from '@/components/dashboard/overview-model';
import type { TopFlopView } from '@/components/dashboard/window-api';
import { fetchJson } from '@/components/layout/health';
import { useRefreshable } from '@/components/layout/refresh';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnmeasuredState,
} from '@/components/states';
import {
  BarList,
  Panel,
  PanelBody,
  PanelHead,
  SharePie,
  barListBars,
  barListInputs,
  CHART_KINDS,
  distributionCaption,
  distributionPieInput,
  readCatalogDistribution,
  type Bar,
  type BarListItem,
  type CatalogDistributionView,
} from '@/components/ui';
import { describeActionFailure } from '@/lib/ui/action-failure';
import { PRODUCT_GAP_REASON } from '@/lib/ui/product-columns';
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

/** Nadpis panela. Jedno miesto, nech ho prázdne stavy nepomenujú inak. */
const RANK_TITLE = 'Čo sa predáva';

function pieces(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'kus', 'kusy', 'kusov')}`;
}

function dayCount(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'deň', 'dni', 'dní')}`;
}

/** Genitív po predložke „u" — „u 1 produktu", „u 236 produktov". */
function productsGenitive(value: number): string {
  return `${formatCountSk(value)} ${pluralSk(value, 'produktu', 'produktov', 'produktov')}`;
}

/**
 * Jeden riadok rebríka ako položka `BarList`-u.
 *
 * Marža a sklad sú z obohatenia (`getFull`), takže pri neobohatenom produkte
 * NIE SÚ nula — sú pomlčka. `qty: 0` je naopak platná nula: „na sklade nič"
 * je meraný fakt a nesmie sa tváriť ako nevedomosť.
 *
 * `lowerBound` nie je vlastnosť riadku, ale OKNA: keď z okna chýbajú dni, je
 * dolnou hranicou každý súčet v oboch zoznamoch. `BarList` z toho spraví
 * `≥ N kusov` a je to ten istý znak, akým appka priznáva medzeru všade inde.
 */
function itemsOf(rows: readonly RankRow[], lowerBound: boolean): BarListItem[] {
  return rows.map((row) => {
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

    return {
      key: String(row.productId),
      label: (
        <Link className={styles.rankLink} href={`/produkty?produkt=${row.productId}`}>
          {label.text}
        </Link>
      ),
      value: row.units,
      /* Kusy sa píšu slovom — samotné „12" v rebríku kusov nepovie, čoho. */
      display: pieces(row.units),
      lowerBound,
      note: label.referenceUnknown
        ? `${label.technical} · kód produktu ešte nemáme · ${facts.join(' · ')}`
        : `${label.technical} · ${facts.join(' · ')}`,
      title: lowerBound ? PRODUCT_GAP_REASON.days_missing : undefined,
    };
  });
}

/**
 * Jeden stĺpec rebríka.
 *
 * Prázdny stĺpec je len JEDNA VETA, nie stavová obrazovka: druhý stĺpec vedľa
 * neho čísla má, takže plocha prázdna nie je. Celopanelové prázdno rieši
 * `RankEmpty` nižšie a rozlišuje pri ňom „nula" od „nemerali sme".
 */
function Column({
  title,
  items,
  empty,
  testId,
  bars,
}: {
  title: string;
  items: readonly BarListItem[];
  empty: string;
  testId: string;
  /** Pásy z JEDNEJ mierky cez oba zoznamy. */
  bars: ReadonlyMap<string, Bar>;
}) {
  return (
    <Panel soft className={styles.rankCol}>
      <PanelHead as="h3" title={title} />
      <PanelBody>
        {items.length === 0 ? (
          <div className="lvl-3" data-testid={`${testId}-empty`}>
            {empty}
          </div>
        ) : (
          <BarList items={items} bars={bars} testId={testId} />
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * Prázdny stav CELÉHO rebríka. Príbeh volí volajúci — pozri „PRÁZDNO JE BEŽNÝ
 * STAV" v hlavičke; predvolený je `nemerane`, lebo to je dnešný stav appky.
 *
 * `reason` sa vypisuje VŽDY a doslovne: je to jediná veta, ktorá hovorí PREČO,
 * a prázdny stav bez dôvodu je to isté ako „žiadne dáta".
 */
function RankEmpty({
  reason,
  story = 'nemerane',
}: {
  reason: string;
  story?: 'nemerane' | 'prazdno' | 'zlyhalo';
}) {
  const action = (
    <Link className="btn sm" href="/produkty">
      Otvoriť Produkty
    </Link>
  );

  if (story === 'zlyhalo') {
    return (
      <ErrorState
        title={`${RANK_TITLE} — načítanie zlyhalo`}
        description={reason}
        failure={describeActionFailure(null, { action: 'Načítanie rebríka' })}
        action={action}
        testId="rank-state"
      />
    );
  }
  if (story === 'prazdno') {
    return (
      <EmptyState
        title="Ani jeden nameraný predaj"
        description={reason}
        action={action}
        testId="rank-state"
      />
    );
  }
  return <UnmeasuredState reason={reason} action={action} testId="rank-state" />;
}

/**
 * Prázdny rebrík PLUS koláč rozdelenia.
 *
 * Sú to dve nezávislé tvrdenia z dvoch dotazov: rebrík hovorí o desiatich
 * riadkoch, koláč o celom katalógu. Keď zlyhá prvé, druhé platí ďalej — a je
 * to práve to, čo pri chudobnom rebríku človek potrebuje vidieť.
 */
export function ThinWithPie({
  reason,
  story,
  distribution,
  windowDays,
}: {
  reason: string;
  /** Ktorý z príbehov prázdna to je. Predvolene „nemerali sme to". */
  story?: 'nemerane' | 'prazdno' | 'zlyhalo';
  distribution: CatalogDistributionView | null | undefined;
  windowDays: OverviewWindow;
}) {
  return (
    <Panel data-testid="overview-rank" data-mode="empty">
      <PanelHead title={RANK_TITLE} />
      <PanelBody>
        <RankEmpty reason={reason} story={story} />
        <Distribution view={distribution} windowDays={windowDays} />
      </PanelBody>
    </Panel>
  );
}

/* ═══════════ Rozdelenie katalógu — koláč (D126, `by=sold`) ═══════════════ */

/**
 * Rozdelenie miestnej kópie katalógu do vedier predajnosti.
 *
 * Číta sa VLASTNÝM dotazom, nie z props: je to tvrdenie o CELOM katalógu, kým
 * rebrík je tvrdenie o desiatich riadkoch. Zliať ich do jednej odpovede by
 * znamenalo, že sa jedno bez druhého nedá ukázať — a práve ten diel „nevieme"
 * je zaujímavý aj vtedy, keď je rebrík chudobný.
 *
 * Okno sa ZÁMERNE neposiela. Prepínač Prehľadu ponúka aj 7 dní, ktoré route
 * medzi povolenými oknami predajnosti nemá; posielať ho by znamenalo buď 400,
 * alebo druhý zoznam povolených okien v klientovi. Server preto vyberie svoje
 * a koláč povie, za aké okno platí — vrátane vety, keď sa od rebríka líši.
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
   * a rebrík vyzerali ako dve odpovede na tú istú otázku.
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

/* ═════════════════ Priznanie, koho sa rebrík NETÝKA (D121) ════════════════ */

/**
 * Veta s ČÍSLOM o vylúčených produktoch.
 *
 * Dve čísla, dve rôzne veci, a ani jedno sa nedopĺňa nulou:
 *
 *  · `unknownSales` — appka ich predaj za okno NEMERALA. To je „nevieme".
 *  · `measuredZeroSales` — appka namerala nulu. To je odpoveď.
 *
 * Keď odpoveď ani jedno číslo nedala, veta to povie a NEHÁDA — rovnaká úvaha
 * ako pri `cohortNote` a `gapNote` nižšie.
 */
export function excludedCountSentence(
  view: Pick<TopFlopView, 'unknownSales' | 'measuredZeroSales'>,
  windowDays: OverviewWindow,
): string {
  const unknown = view.unknownSales;
  const zero = view.measuredZeroSales;

  // Explicitné `=== null`: skrátený guard tu Turbopack už raz zahodil.
  if (unknown === null && zero === null) {
    return 'Koľkých produktov katalógu sa to týka, sa nepodarilo zistiť — číslo si nedopĺňame.';
  }

  const parts: string[] = [];
  if (unknown !== null) {
    parts.push(
      `predaj za ${dayCount(windowDays)} appka nemerala u ${productsGenitive(unknown)}`,
    );
  }
  if (zero !== null) {
    parts.push(`nameranú nulu má ${productsGenitive(zero)}`);
  }
  return `Týka sa to katalógu takto: ${parts.join(' · ')}.`;
}

export function TopFlopSection({ data, windowDays }: TopFlopSectionProps) {
  // Hook stojí PRED prázdnymi stavmi — podmienené volanie hooku React zakazuje.
  const distribution = useCatalogDistribution();

  if (data === undefined) {
    /*
     * Kostra, nie prázdny stav: kým odpoveď nedošla, appka netvrdí ani poruchu,
     * ani prázdny rebrík. Dva bloky sú dva stĺpce, ktoré prídu.
     */
    return <LoadingState blocks={2} label="Načítavam rebrík…" />;
  }
  /*
   * KOLÁČ PREŽIJE CHUDOBNÝ REBRÍK (1. 9. 2026, nález overovateľa I11).
   *
   * Do tejto opravy stál `<Distribution/>` až v poslednej vetve, takže sa pri
   * `data.available === false` nenakreslil vôbec — a to je DNEŠNÝ stav appky:
   * `orders_read` je neoverený a nie je stiahnutý ani jeden deň predajov (P1
   * kontraktu V5). Človek teda videl jednu vetu „nie je dočítaný ani jeden deň"
   * a NEVIDEL jediný graf, ktorý mu vie povedať, že 100 % katalógu je v diele
   * „nevieme". Docblock `useCatalogDistribution()` pritom sľuboval presný opak:
   * „práve ten diel ‚nevieme' je zaujímavý aj vtedy, keď je rebrík chudobný."
   *
   * Koláč je vlastné čítanie nad CELÝM katalógom (`/api/insights/catalog-distribution`),
   * nezávislé od rebríka — nedostupný rebrík o ňom nehovorí nič.
   */
  if (data === null) {
    return (
      <ThinWithPie
        reason="rebríček sa nepodarilo načítať."
        story="zlyhalo"
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
   * Dolná hranica je vlastnosť OKNA, nie riadku — pozri `itemsOf()`. Číta sa
   * z `rankingState`, teda z toho istého poľa, z ktorého sa kreslí `gapNote`;
   * druhá podmienka by sa s ním rozišla.
   */
  const lowerBound = data.rankingState !== 'measured';
  const topItems = itemsOf(data.top, lowerBound);
  const flopItems = itemsOf(data.flop, lowerBound);
  /*
   * JEDNA mierka cez oba zoznamy. Flop má z definície menšie čísla než top;
   * keby si škáloval sám, jeho najslabší produkt by mal pás cez celý riadok.
   */
  const bars = barListBars(barListInputs(topItems), barListInputs(flopItems));

  /*
   * Priznanie medzery nesmie samo klamať číslom: pri nečitateľnom `gaps`
   * (`unknownDays === null`) sa nepíše „0 dní", ale to, že sa počet dní
   * nezistil (31. 8. 2026).
   */
  const gapNote =
    data.unknownDays === null
      ? 'Koľko dní okna appka nemá celé, sa nepodarilo zistiť — súčty aj poradie sú dolná hranica'
      : `${dayCount(data.unknownDays)} okna appka nemá celé, takže súčty aj poradie sú dolná hranica`;

  /*
   * Celý rebrík prázdny je iný príbeh než prázdny jeden stĺpec, a ROZLIŠUJE SA
   * podľa toho, či je okno dočítané:
   *
   *  · dočítané → nula je odpoveď o eshope, teda `EmptyState`,
   *  · nedočítané → „ani jeden predaj" nie je meranie, teda `UnmeasuredState`.
   *
   * Zliať ich do jednej vety by znamenalo tvrdiť o produkčnom eshope niečo, čo
   * appka nezmerala (I11). Dve rovnaké vety v dvoch prázdnych stĺpcoch vedľa
   * seba by pritom nepovedali ani jedno z toho.
   */
  const nothingRanked = topItems.length === 0 && flopItems.length === 0;

  return (
    <Panel data-testid="overview-rank" data-mode="data">
      <PanelHead title={RANK_TITLE} subtitle={cohortNote} />
      <PanelBody>
        {nothingRanked ? (
          <RankEmpty
            story={lowerBound ? 'nemerane' : 'prazdno'}
            reason={
              lowerBound
                ? PRODUCT_GAP_REASON.days_missing
                : `Za ${dayCount(windowDays)} appka nenamerala ani jeden predaný kus a okno má celé, takže je to nula.`
            }
          />
        ) : (
          <div className={styles.rankGrid}>
            <Column
              title="Najviac predané"
              items={topItems}
              empty="Za toto okno nemáme ani jeden nameraný predaj."
              testId="rank-top"
              bars={bars}
            />
            <Column
              title="Najmenej predané z predávaných"
              items={flopItems}
              empty="Za toto okno nemáme ani jeden nameraný predaj."
              testId="rank-flop"
              bars={bars}
            />
          </div>
        )}

        {/*
          Tri priznania, každé o inej veci:
           · KOHO sa rebrík netýka (produkt bez predaja) — bez tejto vety je
             flop čitateľný ako „desať najhorších produktov eshopu",
           · KOĽKÝCH sa to týka — číslom, inak je prvá veta nemerateľná (D121),
           · AKO ÚPLNÉ je okno — pri nedočítaných dňoch je dolnou hranicou aj
             samotné PORADIE, nie len súčty.
        */}
        <div className="fresh" data-testid="rank-excludes">
          Produkt bez nameraného predaja tu nie je ani v jednom stĺpci — „nula
          predaných" o ňom appka netvrdí. Ležiaky sú v Produktoch.
        </div>

        <div className="fresh" data-testid="rank-excluded-count">
          {excludedCountSentence(data, windowDays)}
        </div>

        {data.rankingState === 'measured' ? null : (
          <div className="fresh" data-testid="rank-gap">
            {gapNote}
          </div>
        )}

        {/*
          Koláč odpovedá na to, na čo rebrík odpovedať NEVIE: koľko z katalógu
          vôbec do rebríka mohlo vstúpiť. Diel „nevieme" je tá časť, o ktorej
          appka predaj nezmerala — bez neho by desať riadkov vyzeralo ako obraz
          celého eshopu.
        */}
        <Distribution view={distribution} windowDays={windowDays} />
      </PanelBody>
    </Panel>
  );
}

export default TopFlopSection;
