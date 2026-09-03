/**
 * Aura Zľavy — PRVÁ STRANA HOVORÍ PRAVDU O TOM, ČO NEVIE (V4, D113).
 *
 * Prehľad sa 28. 8. 2026 prestavil: predaje a rebríček hore, zľavy pod nimi,
 * stav appky v jednom riadku. Každý z tých prvkov je tvrdenie o produkčnom
 * eshope a každé sa dá pokaziť tak, že to na obrazovke vyzerá presvedčivo.
 * Tento súbor meria PRESNE TIE TRI ZLIATIA, ktoré by prvá strana neprežila:
 *
 *  A. **Medzera sa nesmie zliať do nuly.** Nesťahovaný deň nedostane bod ani
 *     nulu — a nedostane ho ani vtedy, keď v ňom bežala zľava. Pás zľavy sa
 *     kreslí POD šrafovanie medzery; keby ležal nad ním, vyzeral by nemeraný
 *     deň ako zmeraný.
 *
 *  B. **Rozbehnutý deň nesmie vyzerať ako pokles.** Deň s `dayComplete: false`
 *     je DOLNÁ HRANICA tržby (sťahovanie sa nedočítalo). Bez značky `≈` a bez
 *     vety je z posledného dňa okna vždy prudký pád, ktorý sa nestal. Deň, ku
 *     ktorému appka nemá riadok, je pomlčka — nikdy `0.00`.
 *
 *  C. **Produkt bez dát nepatrí do topu ani do flopu.** „Nula predaných" nie je
 *     meranie, kým okno nie je dočítané; a aj potom je „za 30 dní ani jeden
 *     kus" iná otázka než „ktorý z predávaných je najslabší". Riadok bez
 *     nameraného predaja preto z rebríčka vypadne a sekcia to POVIE.
 *
 * Testy sú napísané tak, aby ZČERVENALI PRI ZLIATÍ, nie pri prekreslení: merajú
 * hodnoty a vety, nie pixely a nie triedy. Bez prehliadača a bez databázy —
 * geometria a modely sú čisté funkcie, komponenty sa vykresľujú cez
 * `renderToStaticMarkup`.
 *
 * Vlastník: V4.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import CampaignsSection from '@/components/dashboard/CampaignsSection';
import SalesChart from '@/components/dashboard/SalesChart';
import { salesChartView } from '@/components/dashboard/sales-chart-view';
import SalesSection from '@/components/dashboard/SalesSection';
import StatusBand from '@/components/dashboard/StatusBand';
import TopFlopSection from '@/components/dashboard/TopFlopSection';
import WindowSwitch from '@/components/dashboard/WindowSwitch';
import type { SalesDay, SalesSnapshot } from '@/components/dashboard/api';
import type { LiveCampaign, RankRow } from '@/components/dashboard/overview-model';
import {
  DEFAULT_OVERVIEW_WINDOW,
  OVERVIEW_WINDOWS,
  isOverviewWindow,
  lastWriteResult,
  liveCampaigns,
  nextPlannedFire,
  rankRows,
} from '@/components/dashboard/overview-model';
import type { SeriesDay } from '@/components/dashboard/sales-view';
import {
  CHART,
  chartGeometry,
  discountBands,
  revenueDays,
  windowDayList,
} from '@/components/dashboard/sales-view';
import type { Verdict } from '@/components/dashboard/overview-verdict';
import type { RevenueDailyView, TopFlopView } from '@/components/dashboard/window-api';
import { parseRevenueDaily, parseTopFlop } from '@/components/dashboard/window-api';

const TODAY = '2026-08-19';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/* ═════════════════════════════ Prípravky ═════════════════════════════════ */

/**
 * Rad s DIEROU: dva merané dni, potom trinásť dní ničoho, potom dnešok.
 * Presne taký stav mali tabuľky 19. 8. 2026 a je to najnepríjemnejší vstup,
 * aký graf dostane.
 */
const S_DIERA: SeriesDay[] = [
  { day: '2026-08-05', units: 578 },
  { day: '2026-08-06', units: 495 },
  { day: TODAY, units: 40 },
];

const NAMERANE: SalesDay[] = [
  { day: '2026-08-05', units: 578 },
  { day: '2026-08-06', units: 495 },
];

function snapshot(patch: Partial<SalesSnapshot> = {}): SalesSnapshot {
  return {
    today: TODAY,
    coverage: {
      syncEnabled: true,
      from: '2026-08-05',
      to: '2026-08-06',
      daysCovered: 2,
      lastSyncedAt: '2026-08-07T02:10:00.000Z',
      hasData: true,
    },
    windowUnits: 1073,
    unitsPerDay: null,
    recentUnits: null,
    previousUnits: null,
    days: NAMERANE,
    ...patch,
  };
}

function verdict(patch: Partial<Verdict> = {}): Verdict {
  return {
    kind: 'ok',
    tone: 'ok',
    word: 'v poriadku',
    headline: 'Všetko v poriadku',
    detail: 'Nič nezastavuje ani nespomaľuje zápis.',
    ...patch,
  };
}

function rank(patch: Partial<TopFlopView> = {}): TopFlopView {
  return {
    available: true,
    reason: null,
    top: [],
    flop: [],
    cohortSize: 0,
    unknownDays: 0,
    rankingState: 'measured',
    /*
     * Počty vylúčených sú predvolene „nevieme" (D121, 2. 9. 2026) — nie nula.
     * Prípravok, ktorý by tu mal nuly, by tvrdil „netýka sa to nikoho" v každom
     * teste, ktorý o vylúčených nič nemeria. Že sa čísla naozaj vypisujú a že
     * ich odpoveď servera nesie, meria `test/unit/prehlad-rebrik.spec.ts`
     * a `test/integration/insights-v4.spec.ts`.
     */
    unknownSales: null,
    measuredZeroSales: null,
    ...patch,
  };
}

function revenue(patch: Partial<RevenueDailyView> = {}): RevenueDailyView {
  return {
    today: TODAY,
    from: '2026-08-17',
    to: TODAY,
    scope: 'eshop',
    series: [],
    dayStates: null,
    missingDays: 0,
    emptyDays: 0,
    hasGap: false,
    ...patch,
  };
}

/* ══════════ A. Medzera zostáva medzerou, aj keď v nej bežala zľava ════════ */

describe('A. nesťahovaný deň sa nezleje do nuly ani pod pásom zľavy', () => {
  const geometry = chartGeometry(S_DIERA, TODAY);

  it('sanity — rad má naozaj dieru a geometria ju priznáva', () => {
    expect(geometry).not.toBeNull();
    expect(geometry!.gaps).toHaveLength(1);
    expect(geometry!.gaps[0]!.days).toBe(12);
    // Bodov je toľko, koľko MERANÍ — nie toľko, koľko dní osi.
    expect(geometry!.measuredDays).toBe(3);
    expect(geometry!.spanDays).toBe(15);
  });

  /**
   * JADRO ZLIATIA. Okno zľavy prekrýva celú dieru. Keby ju pás „vyplnil",
   * nemerané dni by na obrazovke prestali byť nemerané.
   */
  it('pás zľavy cez dieru NEVYROBÍ ani jeden nameraný deň', () => {
    const bands = discountBands(geometry!, [
      { id: 7, name: 'Letná', percent: 20, dateFrom: '2026-08-06', dateTo: TODAY },
    ]);
    expect(bands).toHaveLength(1);

    // Diera zostala dierou a jej dni majú stále „nevieme", nie nulu.
    expect(geometry!.gaps).toHaveLength(1);
    const unknown = geometry!.hover.filter((point) => point.units === null);
    expect(unknown).toHaveLength(0); // rad nesie len merané dni…
    // …a chýbajúce dni nie sú v `hover` vôbec, teda ani ako nula.
    expect(geometry!.hover.map((point) => point.units)).toEqual([578, 495, 40]);
  });

  /*
   * PRESMEROVANÉ VO V6b (2. 9. 2026): do 2. 9. sa poradie čítalo z polohy
   * reťazcov `discountBand` a `url(#sales-hatch)` vo vykreslenom SVG. Plochu
   * kreslí od V6b Recharts a v teste ju nekreslí VÔBEC (nulové rozmery), takže
   * ten istý test by po prevode prešiel aj s obráteným poradím. Poradie je
   * preto DÁTA (`view.underlays`) a komponent ich mapuje jediným `map` v tom
   * poradí — meria sa teda to, čo o poradí rozhoduje.
   */
  it('pás sa v značkách kreslí PRED šrafovaním diery, teda pod ním', () => {
    const view = salesChartView(
      geometry!,
      discountBands(geometry!, [
        { id: 7, name: 'Letná', percent: 20, dateFrom: '2026-08-06', dateTo: TODAY },
      ]),
    );
    const band = view.underlays.findIndex((area) => area.kind === 'discount');
    const hatch = view.underlays.findIndex((area) => area.kind === 'gap');
    expect(band).toBeGreaterThan(-1);
    expect(hatch).toBeGreaterThan(-1);
    /*
     * V SVG kreslí neskorší uzol NAD skorším. Keby sa poradie obrátilo, pás
     * zľavy by prekryl šrafovanie a nemeraný deň by vyzeral zmeraný — a nikto
     * by to nezistil inak než pohľadom.
     */
    expect(band).toBeLessThan(hatch);
  });

  it('legenda pásy POMENUJE, a hovorí, že sú to NAŠE zápisy', () => {
    const html = renderToStaticMarkup(
      createElement(SalesChart, {
        geometry: geometry!,
        caption: 'test',
        label: 'test',
        bands: discountBands(geometry!, [
          { id: 7, name: 'Letná', percent: 20, dateFrom: '2026-08-06', dateTo: TODAY },
        ]),
      }),
    );
    // Farba sama nie je informácia — pás musí mať aj slovo.
    expect(html).toContain('okná zliav podľa našich zápisov');
  });

  it('bez pásov sa graf kreslí presne ako predtým — žiadna legenda navyše', () => {
    const html = renderToStaticMarkup(
      createElement(SalesChart, { geometry: geometry!, caption: 'test', label: 'test' }),
    );
    expect(html).not.toContain('okná zliav');
    // A ani jeden podklad zľavy v dátach — pás bez okna by bol vymyslený.
    expect(salesChartView(geometry!).underlays.some((area) => area.kind === 'discount')).toBe(
      false,
    );
  });

  it('pás sedí na kalendár: 6.–19. 8. začína na dni 6., nie na hrane rámu', () => {
    const bands = discountBands(geometry!, [
      { id: 1, name: 'A', percent: 10, dateFrom: '2026-08-06', dateTo: TODAY },
    ]);
    // Deň 6. 8. je druhý deň 15-dňovej osi, teda ani zľava vľavo, ani vpravo.
    expect(bands[0]!.x1).toBeGreaterThan(CHART.left);
    expect(bands[0]!.x2).toBe(CHART.right);
    expect(bands[0]!.clippedStart).toBe(false);
  });

  it('zľava presahujúca os sa PRIZNÁ, nie skráti bez slova', () => {
    const bands = discountBands(geometry!, [
      { id: 2, name: 'B', percent: 15, dateFrom: '2026-07-01', dateTo: '2026-09-30' },
    ]);
    expect(bands[0]!.clippedStart).toBe(true);
    expect(bands[0]!.clippedEnd).toBe(true);
    expect(bands[0]!.x1).toBe(CHART.left);
    expect(bands[0]!.x2).toBe(CHART.right);
  });

  it('zľava mimo osi pás NEDOSTANE — prilepiť ju na hranu by ju vyrobilo', () => {
    expect(
      discountBands(geometry!, [
        { id: 3, name: 'C', percent: 10, dateFrom: '2026-06-01', dateTo: '2026-06-30' },
      ]),
    ).toEqual([]);
    expect(
      discountBands(geometry!, [
        { id: 4, name: 'D', percent: 10, dateFrom: '2026-09-01', dateTo: '2026-09-30' },
      ]),
    ).toEqual([]);
  });

  it('na PORADOVEJ osi sa pás nekreslí vôbec', () => {
    /* Nečitateľný deň prepne celú os na poradovú mierku (`byDate: false`).
       Dátumový pás na ňu priložiť nemožno a hádať sa nedá. */
    const ordinal = chartGeometry(
      [
        { day: 'nezmysel', units: 10 },
        { day: '2026-08-06', units: 495 },
        { day: '2026-08-07', units: 300 },
      ],
      TODAY,
    );
    expect(ordinal).not.toBeNull();
    expect(ordinal!.axis.byDate).toBe(false);
    expect(
      discountBands(ordinal!, [
        { id: 5, name: 'E', percent: 10, dateFrom: '2026-08-06', dateTo: '2026-08-07' },
      ]),
    ).toEqual([]);
  });

  it('nečitateľný alebo obrátený dátum okna pás NEVYROBÍ', () => {
    expect(
      discountBands(geometry!, [
        { id: 6, name: 'F', percent: 10, dateFrom: 'nezmysel', dateTo: TODAY },
        { id: 7, name: 'G', percent: 10, dateFrom: TODAY, dateTo: '2026-08-05' },
      ]),
    ).toEqual([]);
  });

  it('dni okna sa počítajú kalendárne — týždeň prechodu na letný čas nechýba', () => {
    /* 29. 3. 2026 je v EÚ prechod na letný čas. Pripočítavanie 86 400 000 ms
       by ten deň preskočilo a okno by malo o deň menej, než tvrdí. */
    const list = windowDayList('2026-03-27', '2026-03-31');
    expect(list).toEqual([
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ]);
  });

  it('nečitateľné hranice okna dajú prázdny zoznam, nie nula dní tvrdenia', () => {
    expect(windowDayList('nezmysel', TODAY)).toEqual([]);
    expect(windowDayList(TODAY, '2026-08-05')).toEqual([]);
  });
});

/* ═══════ B. Rozbehnutý deň tržby je dolná hranica, nie pokles ═════════════ */

describe('B. čiastočný deň tržby je označený a chýbajúci deň nie je nula', () => {
  const WINDOW = ['2026-08-17', '2026-08-18', TODAY];

  it('dočítaný deň je meranie bez značky', () => {
    const days = revenueDays(
      WINDOW,
      [{ day: '2026-08-17', totalPaidSum: '412.50', ordersCount: 9, dayComplete: true }],
      // Odpoveď o prečítaných nulách nič nepovedala — deň bez riadku preto
      // zostáva „nevieme". Nula sa z ticha nevyrobí (fail-closed).
      null,
    );
    expect(days[0]).toEqual({
      day: '2026-08-17',
      amount: '412.50',
      state: 'measured',
      text: '412.50',
      ordersCount: 9,
    });
  });

  /** JADRO ZLIATIA B: bez `≈` je rozbehnutý deň nerozoznateľný od hotového. */
  it('nedočítaný deň je DOLNÁ HRANICA a nesie `≈`', () => {
    const days = revenueDays(
      WINDOW,
      [{ day: TODAY, totalPaidSum: '88.00', ordersCount: 2, dayComplete: false }],
      null,
    );
    const row = days[2]!;
    expect(row.state).toBe('lower_bound');
    expect(row.text).toBe('≈ 88.00');
    expect(row.text.startsWith('≈')).toBe(true);
  });

  it('deň BEZ riadku je „nevieme" — pomlčka, nikdy `0.00`', () => {
    const days = revenueDays(
      WINDOW,
      [{ day: '2026-08-17', totalPaidSum: '412.50', ordersCount: 9, dayComplete: true }],
      // Odpoveď o prečítaných nulách nič nepovedala — deň bez riadku preto
      // zostáva „nevieme". Nula sa z ticha nevyrobí (fail-closed).
      null,
    );
    for (const row of days.slice(1)) {
      expect(row.state).toBe('unknown');
      expect(row.amount).toBeNull();
      expect(row.text).toBe('—');
      expect(row.text).not.toBe('0.00');
      expect(row.ordersCount).toBeNull();
    }
  });

  it('riadok na KAŽDÝ deň okna — chýbajúci deň sa nevynechá bez slova', () => {
    expect(revenueDays(WINDOW, [], null).map((row) => row.day)).toEqual(WINDOW);
  });

  it('sekcia povie, že posledný deň sa dopočítava a NIE JE to pokles', () => {
    const html = renderToStaticMarkup(
      createElement(SalesSection, {
        sales: snapshot(),
        revenue: revenue({
          series: [
            {
              currency: 'EUR',
              days: [
                { day: '2026-08-17', totalPaidSum: '412.50', ordersCount: 9, dayComplete: true },
                { day: '2026-08-18', totalPaidSum: '380.00', ordersCount: 8, dayComplete: true },
                { day: TODAY, totalPaidSum: '61.00', ordersCount: 1, dayComplete: false },
              ],
              sum: '853.50',
              sumState: 'lower_bound',
              lowerBoundDays: 1,
              measuredZeroDays: [],
            },
          ],
        }),
      }),
    );
    expect(html).toContain('nie je to pokles');
    expect(html).toContain('≈');
  });

  it('suma pri nedočítanom okne je označená ako dolná hranica', () => {
    const html = renderToStaticMarkup(
      createElement(SalesSection, {
        sales: snapshot(),
        revenue: revenue({
          series: [
            {
              currency: 'EUR',
              days: [
                { day: '2026-08-17', totalPaidSum: '412.50', ordersCount: 9, dayComplete: true },
              ],
              sum: '412.50',
              sumState: 'lower_bound',
              lowerBoundDays: 0,
              measuredZeroDays: [],
            },
          ],
          missingDays: 2,
        }),
      }),
    );
    expect(html).toContain('aspoň toľko');
    expect(html).toContain('nie je to nula');
  });

  it('sekcia menuje ROZSAH: je to tržba celého eshopu, nie produktu ani zľavy', () => {
    const html = renderToStaticMarkup(
      createElement(SalesSection, {
        sales: snapshot(),
        revenue: revenue({
          series: [
            {
              currency: 'EUR',
              days: [{ day: TODAY, totalPaidSum: '10.00', ordersCount: 1, dayComplete: true }],
              sum: '10.00',
              sumState: 'measured',
              lowerBoundDays: 0,
              measuredZeroDays: [],
            },
          ],
        }),
      }),
    );
    expect(html).toContain('Tržba celého eshopu');
  });

  it('bez tržby v props sa nekreslí ani suma, ani priznanie', () => {
    const html = renderToStaticMarkup(createElement(SalesSection, { sales: snapshot() }));
    expect(html).not.toContain('Tržba celého eshopu');
  });

  /**
   * `scope: 'eshop'` je jediná menovka, ktorá na povrchu drží rozdiel medzi
   * tržbou eshopu a tržbou za produkt. Odpoveď bez nej sa nečíta vôbec.
   */
  it('odpoveď bez menovky `scope: eshop` sa NEPREČÍTA', () => {
    const body = {
      today: TODAY,
      window: { days: 30, from: '2026-07-21', to: TODAY },
      scope: 'product',
      series: [],
      missing: [],
      readDays: 0,
      hasGap: false,
    };
    expect(parseRevenueDaily(body)).toBeNull();
    expect(parseRevenueDaily({ ...body, scope: 'eshop' })).not.toBeNull();
  });

  it('chýbajúci `dayComplete` je fail-closed dolná hranica, nie hotový deň', () => {
    const parsed = parseRevenueDaily({
      today: TODAY,
      window: { days: 1, from: TODAY, to: TODAY },
      scope: 'eshop',
      series: [
        {
          currency: 'EUR',
          days: [{ day: TODAY, totalPaidSum: '5.00', ordersCount: 1 }],
          sum: '5.00',
          sumState: 'measured',
          lowerBoundDays: 0,
        },
      ],
      missing: [],
      readDays: 1,
      hasGap: false,
    });
    expect(parsed!.series[0]!.days[0]!.dayComplete).toBe(false);
    expect(revenueDays([TODAY], parsed!.series[0]!.days, null)[0]!.state).toBe('lower_bound');
  });
});

/* ═════ C. Produkt bez nameraného predaja nie je v topu ani vo flope ═══════ */

describe('C. rebríček je len o produktoch, o ktorých appka niečo vie', () => {
  const ZERO = {
    productId: 111,
    reference: 'AB-1',
    name: 'Náramok',
    units: 0,
    discountedNow: false,
    marginPercent: null,
    qty: null,
    enriched: false,
  };

  /** JADRO ZLIATIA C. */
  it('nula, `null`, chýbajúce pole aj `NaN` v `units` riadok VYHODIA', () => {
    const rows = rankRows([
      ZERO,
      { ...ZERO, productId: 112, units: null },
      { ...ZERO, productId: 113, units: undefined },
      { ...ZERO, productId: 114, units: Number.NaN },
      { ...ZERO, productId: 115, units: -3 },
    ]);
    expect(rows).toEqual([]);
  });

  it('riadok s aspoň jedným nameraným kusom v rebríčku zostane', () => {
    const rows = rankRows([{ ...ZERO, units: 1 }, { ...ZERO, productId: 116, units: 42 }]);
    expect(rows.map((row) => row.units)).toEqual([1, 42]);
  });

  it('neobohatený produkt má maržu a sklad „nevieme", nie nulu', () => {
    const row = rankRows([{ ...ZERO, units: 5 }])[0]!;
    expect(row.marginPercent).toBeNull();
    expect(row.qty).toBeNull();
    expect(row.enriched).toBe(false);
  });

  it('`qty: 0` je platná NULA — na sklade nič je meraný fakt', () => {
    const row = rankRows([{ ...ZERO, units: 5, qty: 0, enriched: true }])[0]!;
    expect(row.qty).toBe(0);
    expect(row.enriched).toBe(true);
  });

  it('prázdna referencia je `null`, nikdy prázdny string (D116)', () => {
    const row = rankRows([{ ...ZERO, units: 5, reference: '   ' }])[0]!;
    expect(row.reference).toBeNull();
  });

  it('nulový riadok z odpovede sa na obrazovku NEDOSTANE ani po prečítaní', () => {
    const parsed = parseTopFlop({
      available: true,
      reason: null,
      top: [{ ...ZERO, units: 12 }],
      flop: [ZERO],
      cohort: { size: 1 },
      excludes: { zeroSales: true, notFound: true },
      gaps: { unknownDays: 0 },
      rankingState: 'measured',
    });
    expect(parsed!.top.map((row) => row.productId)).toEqual([111]);
    expect(parsed!.flop).toEqual([]);

    const html = renderToStaticMarkup(
      createElement(TopFlopSection, { data: parsed, windowDays: 30 }),
    );
    // Riadok topu je vidieť…
    expect(html).toContain('data-testid="rank-top"');
    // …a nulový riadok flopu nie je nikde, ani ako „0 kusov".
    expect(html).toContain('data-testid="rank-flop-empty"');
    expect(html).not.toContain('0 kusov');
  });

  /*
   * PRESMEROVANÉ V6b (2. 9. 2026): prípravok dostal RIADKY.
   *
   * Test tvrdí dve veci — priznanie „produkt bez predaja tu nie je" a názov
   * stĺpca „najslabší z predávaných". Do V6b mu stačil prázdny `rank()`, lebo
   * sekcia stĺpce kreslila aj bez jediného riadku, teda dvakrát tú istú vetu
   * „Za toto okno nemáme ani jeden nameraný predaj." vedľa seba. Od V6b je celý
   * prázdny rebrík JEDEN stavový panel (`EmptyState` pri dočítanom okne,
   * `UnmeasuredState` inak — pozri hlavičku `TopFlopSection`), takže hlavička
   * stĺpca v prázdnom stave neexistuje. Tvrdenia sa NEOSLABILI: sú tie isté a
   * merajú sa nad rebríkom, ktorý riadky naozaj má, čo je aj stav, v ktorom môže
   * flop klamať.
   */
  it('sekcia POVIE, že produkt bez predaja tam nie je — inak flop klame', () => {
    const html = renderToStaticMarkup(
      createElement(TopFlopSection, {
        data: rank({
          top: rankRows([{ ...ZERO, units: 42 }]),
          flop: rankRows([{ ...ZERO, productId: 116, units: 1 }]),
          cohortSize: 2,
        }),
        windowDays: 30,
      }),
    );
    expect(html).toContain('Produkt bez nameraného predaja');
    expect(html).toContain('Ležiaky sú v Produktoch');
    // Stĺpec sa menuje presne tým, čo je — „najslabší z predávaných".
    expect(html).toContain('Najmenej predané z predávaných');
  });

  /*
   * Prázdny rebrík ROZLIŠUJE „nula" od „nemerali sme" (D134, I11). Zliať ich do
   * jednej vety by na dočítanom okne zamlčalo tvrdenie o eshope a na
   * nedočítanom by ho VYMYSLELO.
   */
  it('prázdny rebrík pri dočítanom okne je NULA, pri nedočítanom „nemerali sme"', () => {
    const docitane = renderToStaticMarkup(
      createElement(TopFlopSection, { data: rank(), windowDays: 30 }),
    );
    expect(docitane).toContain('data-story="prazdno"');
    expect(docitane).toContain('Ani jeden nameraný predaj');

    const nedocitane = renderToStaticMarkup(
      createElement(TopFlopSection, {
        data: rank({ rankingState: 'lower_bound', unknownDays: 9 }),
        windowDays: 30,
      }),
    );
    expect(nedocitane).toContain('data-story="nemerane"');
    // A nikde netvrdí nulu predaja — to je práve to, čo appka nezmerala.
    expect(nedocitane).not.toContain('Ani jeden nameraný predaj');
  });

  it('nedočítané okno robí dolnú hranicu aj z PORADIA, nie len zo súčtov', () => {
    const html = renderToStaticMarkup(
      createElement(TopFlopSection, {
        data: rank({ rankingState: 'lower_bound', unknownDays: 12 }),
        windowDays: 30,
      }),
    );
    expect(html).toContain('poradie sú dolná hranica');
  });

  it('nečitateľné `gaps` NIE JE „nechýba nič" — a veta to nepopiera číslom', () => {
    /*
     * Nález z 31. 8. 2026: `unknownDays: gaps === null ? 0 : …` bol fail-OPEN,
     * takže sekcia pri nečitateľnom `gaps` napísala „0 dní okna appka nemá
     * celé, takže súčty aj poradie sú dolná hranica" — priznanie, ktoré si
     * protirečí číslom, aké appka nezmerala.
     */
    const parsed = parseTopFlop({
      available: true,
      top: [{ ...ZERO, units: 12 }],
      flop: [],
      cohort: 'nečitateľné',
      gaps: 'nečitateľné',
      rankingState: 'lower_bound',
    });
    expect(parsed!.unknownDays).toBeNull();
    expect(parsed!.cohortSize).toBeNull();

    const html = renderToStaticMarkup(
      createElement(TopFlopSection, { data: parsed, windowDays: 30 }),
    );
    expect(html).toContain('sa nepodarilo zistiť');
    expect(html).not.toContain('0 dní okna appka nemá celé');
    expect(html).toContain('poradie sú dolná hranica');
  });

  it('neznámy `rankingState` je „nevieme", nie meranie (fail-closed)', () => {
    const parsed = parseTopFlop({
      available: true,
      top: [],
      flop: [],
      cohort: { size: 0 },
      gaps: { unknownDays: 0 },
      rankingState: 'vymyslene',
    });
    expect(parsed!.rankingState).toBe('unknown');
  });

  it('nedostupný rebríček povie DÔVOD, nie „žiadne dáta"', () => {
    const noCoverage = renderToStaticMarkup(
      createElement(TopFlopSection, {
        data: rank({ available: false, reason: 'no_coverage' }),
        windowDays: 7,
      }),
    );
    expect(noCoverage).toContain('nie je dočítaný ani jeden deň');

    const tooLarge = renderToStaticMarkup(
      createElement(TopFlopSection, {
        data: rank({ available: false, reason: 'cohort_too_large' }),
        windowDays: 7,
      }),
    );
    expect(tooLarge).toContain('priveľa');
  });

  it('„ešte sa nenačítalo" NIE JE „nepodarilo sa načítať"', () => {
    const loading = renderToStaticMarkup(
      createElement(TopFlopSection, { data: undefined, windowDays: 30 }),
    );
    // Kostra netvrdí nič: ani poruchu, ani prázdny rebríček.
    expect(loading).toContain('aria-busy');
    expect(loading).not.toContain('data-testid="overview-rank"');

    const broken = renderToStaticMarkup(
      createElement(TopFlopSection, { data: null, windowDays: 30 }),
    );
    expect(broken).toContain('data-testid="overview-rank"');
    expect(broken).toContain('data-mode="empty"');
  });

  it('produkt sa menuje „ref · názov" a `#id` ostáva technickým detailom (D116)', () => {
    const row: RankRow = {
      productId: 18342,
      reference: 'NR-0042',
      name: 'Náramok z chirurgickej ocele',
      units: 12,
      discountedNow: true,
      marginPercent: 41,
      qty: 3,
      enriched: true,
    };
    const html = renderToStaticMarkup(
      createElement(TopFlopSection, {
        data: rank({ top: [row], cohortSize: 1 }),
        windowDays: 30,
      }),
    );
    expect(html).toContain('NR-0042 · Náramok z chirurgickej ocele');
    expect(html).toContain('#18342');
    expect(html).toContain('teraz zlacnený');
  });

  it('produkt bez referencie priznáva, že kód ešte NEMÁME (nie že ho nemá)', () => {
    const html = renderToStaticMarkup(
      createElement(TopFlopSection, {
        data: rank({
          top: [
            {
              productId: 900,
              reference: null,
              name: 'Prívesok',
              units: 4,
              discountedNow: false,
              marginPercent: null,
              qty: null,
              enriched: false,
            },
          ],
          cohortSize: 1,
        }),
        windowDays: 30,
      }),
    );
    expect(html).toContain('kód produktu ešte nemáme');
    expect(html).toContain('marža —');
    expect(html).toContain('sklad —');
  });
});

/* ══════════════════ D. Prepínač okna 7 / 30 / 90 ═════════════════════════ */

describe('D. okno je jedno pre celú obrazovku a predvolene 30 dní', () => {
  it('tri okná, predvolené 30 — a server iné nepozná', () => {
    expect(OVERVIEW_WINDOWS).toEqual([7, 30, 90]);
    expect(DEFAULT_OVERVIEW_WINDOW).toBe(30);
    expect(isOverviewWindow(30)).toBe(true);
    expect(isOverviewWindow(60)).toBe(false);
    expect(isOverviewWindow(Number.NaN)).toBe(false);
  });

  it('prepínač označí práve jedno okno a nesie zmysel čísel pre čítačku', () => {
    const html = renderToStaticMarkup(
      createElement(WindowSwitch, { value: 30, onChange: () => {} }),
    );
    expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(1);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Za koľko dní sa počítajú predaje a rebríček"');
  });

  it('prepínač sa kreslí V HLAVIČKE sekcie Predaj, nie vedľa grafu', () => {
    const html = renderToStaticMarkup(
      createElement(SalesSection, {
        sales: snapshot(),
        switcher: createElement(WindowSwitch, { value: 90, onChange: () => {} }),
      }),
    );
    const header = html.indexOf('</h2>');
    const seg = html.indexOf('data-testid="overview-window"');
    expect(seg).toBeGreaterThan(header);
    expect(seg).toBeLessThan(html.indexOf('<svg'));
  });
});

/* ══════════ E. Karta bežiacich zliav: plánovaný a posledný zápis ══════════ */

describe('E. „beží" nie je to isté ako „zapisuje sa"', () => {
  it('najbližší plánovaný zápis je najskorší BUDÚCI, minulé sa preskočia', () => {
    const found = nextPlannedFire(
      [
        { id: 1, name: 'Stará', percent: 10, fireAt: '2026-08-10T02:00:00.000Z' },
        { id: 2, name: 'Neskoršia', percent: 25, fireAt: '2026-09-01T02:00:00.000Z' },
        { id: 3, name: 'Najbližšia', percent: 15, fireAt: '2026-08-20T02:00:00.000Z' },
        { id: 4, name: 'Bez času', percent: 5, fireAt: null },
      ],
      '2026-08-19T12:00:00.000Z',
    );
    expect(found).not.toBeNull();
    expect(found!.campaignId).toBe(3);
    expect(found!.percent).toBe(15);
  });

  it('bez budúceho zápisu je to `null`, teda „nevidíme", nie „nič nie je"', () => {
    expect(
      nextPlannedFire(
        [{ id: 1, name: 'Stará', percent: 10, fireAt: '2026-08-10T02:00:00.000Z' }],
        '2026-08-19T12:00:00.000Z',
      ),
    ).toBeNull();
    expect(nextPlannedFire([], '2026-08-19T12:00:00.000Z')).toBeNull();
  });

  /**
   * Deň so samými nulami sa preskočí: `writeActivity` vracia riadok pre každý
   * deň obdobia, takže „posledný deň" je takmer vždy dnešok a jeho nuly by na
   * karte vyzerali ako „naposledy sa nezapísalo nič".
   */
  it('posledný výsledok zápisu preskočí dni, v ktorých sa nezapisovalo', () => {
    const found = lastWriteResult([
      { day: '2026-08-15', ok: 240, failed: 12, uncertain: 0, skipped: 3 },
      { day: '2026-08-18', ok: 0, failed: 0, uncertain: 0, skipped: 0 },
      { day: TODAY, ok: 0, failed: 0, uncertain: 0, skipped: 0 },
    ]);
    expect(found).not.toBeNull();
    expect(found!.day).toBe('2026-08-15');
    expect(found!.ok).toBe(240);
    expect(found!.failed).toBe(12);
  });

  it('bez jediného zápisu je to `null`', () => {
    expect(lastWriteResult([{ day: TODAY, ok: 0, failed: 0, uncertain: 0, skipped: 0 }])).toBeNull();
    expect(lastWriteResult([])).toBeNull();
  });

  it('karta vypíše plánovaný zápis aj to, čo sa NEPODARILO', () => {
    const rows = liveCampaigns(
      [
        {
          id: 5,
          name: 'Letná',
          status: 'done',
          percent: 20,
          dateFrom: '2026-08-10',
          dateTo: '2026-08-31',
          itemsTotal: 100,
          itemsOk: 88,
          itemsFailed: 12,
          itemsUncertain: 0,
          itemsPending: 0,
          late: false,
          tiers: [],
          estimate: null,
        },
      ],
      TODAY,
    );
    const html = renderToStaticMarkup(
      createElement(CampaignsSection, {
        campaigns: rows as LiveCampaign[],
        insights: [],
        nextFire: { campaignId: 3, name: 'Jesenná', percent: 15, fireAt: '2026-08-20T02:00:00.000Z' },
        lastWrite: { day: '2026-08-15', ok: 240, failed: 12, uncertain: 0, skipped: 0 },
      }),
    );
    expect(html).toContain('Najbližší plánovaný zápis');
    expect(html).toContain('Jesenná');
    expect(html).toContain('240 zlacnených');
    // Poloprávda „zapísalo sa 240" bez zlyhaní je zakázaná.
    expect(html).toContain('12 sa nepodarilo');
  });

  it('„nevidíme" sa nevydáva za „nič nie je"', () => {
    const html = renderToStaticMarkup(
      createElement(CampaignsSection, {
        campaigns: [],
        insights: [],
        nextFire: null,
        lastWrite: null,
      }),
    );
    expect(html).toContain('žiadny nevidíme');
    expect(html).toContain('ani jeden');
  });

  it('bez týchto props sa riadok nekreslí vôbec — sekcia zostáva pôvodná', () => {
    const html = renderToStaticMarkup(
      createElement(CampaignsSection, { campaigns: [], insights: [] }),
    );
    expect(html).not.toContain('campaigns-write-facts');
  });
});

/* ════════ F. Stav appky je pás; prekážky NIKDY nie sú pod rozklikom ══════ */

describe('F. stavový pás sa zúžil, prekážky zostali viditeľné', () => {
  const band = (v: Verdict): string =>
    renderToStaticMarkup(
      createElement(StatusBand, {
        verdict: v,
        keyPresent: true,
        budget: { spent: 12, budget: 200 },
        pending: 340,
        children: 'PODROBNY_STAV',
      }),
    );

  it('kým je zeleno, pás je ZAVRETÝ', () => {
    const html = band(verdict());
    expect(html).toContain('data-verdict="ok"');
    // Značka `<details>` tam je vždy; rozhoduje `open`, a ten pri `ok` chýba.
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  /**
   * Zavretý pás nad zastavenou frontou by bol presne to, čo tu už raz prežilo
   * do produkcie: stav, ktorý sa nedá prehliadnuť, schovaný za jedno kliknutie.
   */
  it('keď nie je zeleno, pás sa otvorí SÁM', () => {
    for (const kind of ['stopped', 'slowed', 'unknown'] as const) {
      const html = band(verdict({ kind, word: 'stojí', tone: 'bad' }));
      expect(html, kind).toMatch(/<details[^>]*\sopen/);
    }
  });

  it('pás nesie kľúč, rozpočet aj frontu — bez kľúča je zvyšok dekorácia', () => {
    const html = band(verdict());
    expect(html).toContain('Kľúč vložený');
    expect(html).toContain('Zápisy 12/200 dnes');
    expect(html).toContain('Fronta 340');
    expect(html).toContain('PODROBNY_STAV');
  });

  it('„nevieme, či kľúč je" sa nezleje s „kľúč nie je"', () => {
    const unknown = renderToStaticMarkup(
      createElement(StatusBand, {
        verdict: verdict(),
        keyPresent: null,
        budget: null,
        pending: null,
        children: 'x',
      }),
    );
    expect(unknown).toContain('Kľúč —');
    expect(unknown).toContain('Zápisy —');
    expect(unknown).toContain('Fronta —');

    const missing = renderToStaticMarkup(
      createElement(StatusBand, {
        verdict: verdict(),
        keyPresent: false,
        budget: null,
        pending: null,
        children: 'x',
      }),
    );
    expect(missing).toContain('Kľúč chýba');
  });

  it('rozklik má aj SLOVO, nie len trojuholník', () => {
    expect(band(verdict())).toContain('Podrobný stav');
  });

  /**
   * Tvrdenie o USPORIADANÍ obrazovky sa nedá zmerať vykreslením jednej sekcie,
   * lebo `Overview` potrebuje šesť odpovedí zo servera. Meria sa preto zdroj —
   * a je to zmysluplné meranie: zabaliť prekážky do pásu znamená presunúť
   * `<BlockersSection>` medzi jeho značky, a to je práve to, čo sa tu hľadá.
   */
  it('`BlockersSection` stojí MIMO pásu, nie v jeho rozkliku', () => {
    const source = read('../../src/components/dashboard/Overview.tsx');
    const closeBand = source.indexOf('</StatusBand>');
    const blockers = source.indexOf('<BlockersSection');
    expect(closeBand).toBeGreaterThan(-1);
    expect(blockers).toBeGreaterThan(-1);
    expect(blockers).toBeGreaterThan(closeBand);
  });

  it('pás si prekážky nekreslí ani sám — má na ne len miesto pod sebou', () => {
    /*
     * Komentáre sa odstrihnú, inak by test meral PRÓZU: hlavička `StatusBand`
     * o `BlockersSection` píše práve preto, že ju kresliť NESMIE. Bez tohto
     * kroku by test hlásil chybu tam, kde je vysvetlenie.
     */
    const source = read('../../src/components/dashboard/StatusBand.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    expect(source).not.toContain('BlockersSection');
  });

  it('predaje a rebríček stoja NAD zľavami (D113)', () => {
    const source = read('../../src/components/dashboard/Overview.tsx');
    const sales = source.indexOf('<SalesSection');
    const rankPos = source.indexOf('<TopFlopSection');
    const campaigns = source.indexOf('<CampaignsSection');
    expect(sales).toBeGreaterThan(-1);
    expect(sales).toBeLessThan(rankPos);
    expect(rankPos).toBeLessThan(campaigns);
  });
});
