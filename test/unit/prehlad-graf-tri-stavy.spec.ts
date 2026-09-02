/**
 * Aura Zľavy — HLAVNÝ GRAF PREHĽADU: HODNOTA / NULA / NEVIEME (K6, I11, V6b).
 *
 * Graf predaja prešiel z vlastného inline SVG na `ChartCard` + Recharts (D135).
 * Tvrdenie, na ktorom stojí celá appka, sa tým NESMELO stať tichším:
 *
 *   · **hodnota** je číslo a kreslí sa,
 *   · **nula je MERANÝ FAKT** o eshope („deň sme stiahli, nepredalo sa nič")
 *     a kreslí sa ako nula,
 *   · **`null` je priznanie nevedomosti** („o tom dni nevieme") a kreslí sa
 *     ako MEDZERA — nikdy ako nula, nikdy ako vynechaný riadok.
 *
 * PREČO SA TO MERIA NA DÁTACH A NIE NA SVG
 * ────────────────────────────────────────
 * Dvakrát. Prvý dôvod je technický: plocha Rechartsu sa v teste NEKRESLÍ.
 * `ResponsiveContainer` meria rodiča, v jsdom aj v serverovom renderi má
 * rodič nulové rozmery, a graf vráti prázdny `<div>` — každé tvrdenie
 * o `<circle>` a `<path>` by prešlo aj nad grafom, ktorý medzeru zaslepil
 * nulou.
 *
 * Druhý dôvod je zapísaná skúsenosť. D121 („produkt s neznámym predajom sa
 * do pásiem nezaradí") fungoval v klientskom modeli, kým server posielal
 * `unitsSold: 0` namiesto `null` — takže `soldBucketOf(0)` dal tisícom
 * produktov legitímne vedro s 30 % zľavou. Nenašlo to 3756 testov, ale
 * preklik: model bol správny a dostal nepravdivý vstup. Preto sa tu meria
 * TELO DÁT na oboch koncoch prevodu:
 *
 *   A. model `sales-chart-view.ts` — čo z geometrie vyjde,
 *   B. props, ktoré komponent NAOZAJ odovzdá Rechartsu (`recharts` je
 *      podvrhnutý a zapisuje si, čo dostal) — vrátane `connectNulls`,
 *   C. celá cesta odpoveďou servera až po prepis pod grafom.
 *
 * Vlastník: V6b, hlavný graf Prehľadu.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalesSnapshot } from '@/components/dashboard/api';
import {
  SALES_TIP_NOTES,
  salesChartView,
  salesPointNote,
} from '@/components/dashboard/sales-chart-view';
import { chartGeometry, discountBands, type SeriesDay } from '@/components/dashboard/sales-view';
import { chartRowText } from '@/components/ui/chart-language';

/* ═══════════════════════ 0. Podvrhnutý Recharts ══════════════════════════ */

/**
 * `vi.hoisted` je tu povinné, nie ozdoba: `vi.mock` sa vykoná PRED telom
 * súboru, takže obyčajná `const` by v čase volania fabriky ešte neexistovala.
 */
const zaznam = vi.hoisted(() => ({
  volania: [] as Array<{ name: string; props: Record<string, unknown> }>,
}));

/**
 * Podvrh zapisuje PROPS a deti vykresľuje. Nemeria sa ním, ako Recharts
 * kreslí (to je jeho vec a je to odskúšané inde), ale ČO OD NÁS DOSTANE — to
 * je jediné, čo je naša chyba, a jediné, čo sa na skutočnej ploche v teste
 * zmerať nedá.
 */
vi.mock('recharts', () => {
  const zapis =
    (name: string, kresliDeti: boolean) =>
    (props: Record<string, unknown>): ReactNode => {
      zaznam.volania.push({ name, props });
      if (!kresliDeti) return null;
      return createElement('div', { 'data-recharts': name }, props.children as ReactNode);
    };
  return {
    ResponsiveContainer: zapis('ResponsiveContainer', true),
    ComposedChart: zapis('ComposedChart', true),
    CartesianGrid: zapis('CartesianGrid', false),
    XAxis: zapis('XAxis', false),
    YAxis: zapis('YAxis', false),
    Tooltip: zapis('Tooltip', false),
    ReferenceArea: zapis('ReferenceArea', false),
    ReferenceLine: zapis('ReferenceLine', false),
    Area: zapis('Area', false),
    Line: zapis('Line', false),
  };
});

/* Import až za `vi.mock` — komponent musí vidieť podvrh. */
const { default: SalesChart, SeriesDot, SalesTip } = await import(
  '@/components/dashboard/SalesChart'
);
const { default: SalesSection } = await import('@/components/dashboard/SalesSection');

/* ═══════════════════════════ 1. Prípravok ════════════════════════════════ */

const DNES = '2026-08-07';

/**
 * Rad so VŠETKÝMI stavmi, aké denný predaj pozná — vrátane dvoch spôsobov,
 * ako sa v odpovedi objaví „nevieme":
 *
 *  · 2. 8. je MERANÁ NULA (deň sa stiahol, nepredalo sa nič),
 *  · 3. 8. je `null` (sťahovanie spadlo a neprinieslo ani riadok),
 *  · 4. 8. je DOLNÁ HRANICA (neúplný deň),
 *  · 5. a 6. 8. v rade VÔBEC NIE SÚ (odpoveď ich neposlala) — a napriek tomu
 *    musia byť na osi, inak by sa os stiahla a graf by tvrdil, že medzi 4.
 *    a 7. augustom nie je čo ukázať,
 *  · 7. 8. je dnešok, teda fakt „zatiaľ".
 */
function rad(): SeriesDay[] {
  return [
    { day: '2026-08-01', units: 12 },
    { day: '2026-08-02', units: 0 },
    { day: '2026-08-03', units: null },
    { day: '2026-08-04', units: 9, partial: true },
    { day: DNES, units: 4 },
  ];
}

const pohlad = () => salesChartView(chartGeometry(rad(), DNES)!);

const kusy = (view = pohlad()) => view.points.map((point) => point.units);

/* ═════════════ A. Tri stavy v riadkoch, z ktorých sa kreslí ═══════════════ */

describe('A. hodnota / nula / nevieme — v TELE DÁT grafu', () => {
  it('rad má riadok na KAŽDÝ deň osi, aj na ten, ktorý sa nesťahoval', () => {
    const view = pohlad();
    // 1.–7. 8. je sedem dní; odpoveď priniesla päť riadkov.
    expect(view.points.map((point) => point.day)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ]);
  });

  it('HODNOTA je číslo, NULA zostane nulou a NEVIEME zostane `null`', () => {
    expect(kusy()).toEqual([12, 0, null, 9, null, null, 4]);
  });

  it('nula je MERANIE, nie medzera — a nesie značku merania', () => {
    const nula = pohlad().points.find((point) => point.day === '2026-08-02');
    expect(nula?.units).toBe(0);
    expect(nula?.kind).toBe('measured');
    expect(nula?.lowerBound).toBe(false);
    // A v prepise je to nula, nie pomlčka: „nepredalo sa nič" je odpoveď.
    expect(chartRowText({ label: '2. 8.', value: 0, lowerBound: false }, String)).toBe('0');
  });

  it('NEVIEME sa nikde nedopĺňa nulou — ani v rade, ani v prepise', () => {
    const view = pohlad();
    const nemerane = view.points.filter((point) => point.kind === 'unmeasured');
    expect(nemerane).toHaveLength(3);
    for (const point of nemerane) {
      expect(point.units, point.day).toBeNull();
      expect(point.pointLabel, point.day).toBeNull();
    }
    // Ani jedna nula, ktorá by nebola meraním.
    for (const point of view.points.filter((p) => p.units === 0)) {
      expect(point.kind, point.day).toBe('measured');
    }
    // Prepis pre čítačku hovorí to isté: pomlčka U+2014, nikdy 0.
    const prepis = view.summaryRows.map((row) => chartRowText(row, String));
    expect(prepis).toEqual(['12', '0', '—', '≥ 9', '—', '—', '4']);
    expect(view.unknownDays).toBe(3);
    expect(view.measuredDays).toBe(4);
  });

  it('dolná hranica si nesie `≥` a dnešok sa značí tvarom, nie odtieňom', () => {
    const view = pohlad();
    const odhad = view.points.find((point) => point.day === '2026-08-04');
    expect(odhad?.kind).toBe('lower_bound');
    expect(odhad?.lowerBound).toBe(true);

    const dnesok = view.points.find((point) => point.day === DNES);
    expect(dnesok?.kind).toBe('today');
    // Dnešok do trendu nevstupuje — deň ešte beží.
    expect(dnesok?.trend).toBeNull();
  });

  it('bublina povie o každom stave VETU, nie len číslo', () => {
    const view = pohlad();
    const veta = (day: string): string | null =>
      salesPointNote(view.points.find((point) => point.day === day)!);
    expect(veta('2026-08-01')).toBeNull();
    // Meraná nula nie je priznanie — nemá čo priznávať.
    expect(veta('2026-08-02')).toBeNull();
    expect(veta('2026-08-03')).toBe(SALES_TIP_NOTES.unmeasured);
    expect(veta('2026-08-04')).toBe(SALES_TIP_NOTES.estimate);
    expect(veta(DNES)).toBe(SALES_TIP_NOTES.today);
  });

  it('priznanie o medzerách je pod grafom SLOVOM aj POČTOM', () => {
    const notes = pohlad().notes.join(' ');
    expect(notes).toContain('nesťahované');
    expect(notes).toContain('kreslí sa medzera, nie nula');
    expect(notes).toContain('dnešok, deň ešte beží');
    expect(notes).toContain('neúplný deň, aspoň toľko');
  });

  it('bez jedinej medzery graf o medzerách MLČÍ — nula priznaní nie je hluk', () => {
    const suvisly = salesChartView(
      chartGeometry(
        [
          { day: '2026-08-01', units: 4 },
          { day: '2026-08-02', units: 0 },
          { day: '2026-08-03', units: 6 },
        ],
        DNES,
      )!,
    );
    expect(suvisly.unknownDays).toBe(0);
    expect(suvisly.notes).toEqual([]);
    expect(suvisly.legend.map((item) => item.kind)).not.toContain('gap');
    // Meraná nula pritom v rade zostala.
    expect(suvisly.points.map((point) => point.units)).toEqual([4, 0, 6]);
  });
});

/* ═══════ B. Čo komponent NAOZAJ odovzdá Rechartsu (drôtovanie) ════════════ */

describe('B. props, ktoré do grafu naozaj dotečú', () => {
  beforeEach(() => {
    zaznam.volania.length = 0;
  });

  const vykresli = (bands: ReturnType<typeof discountBands> = []): string =>
    renderToStaticMarkup(
      createElement(SalesChart, {
        geometry: chartGeometry(rad(), DNES)!,
        caption: '1. 8. – 7. 8. · 4 dni s údajmi · povolené produkty',
        label: 'Čiarový graf — predané kusy po dňoch',
        bands,
      }),
    );

  const prvy = (name: string): Record<string, unknown> => {
    const hit = zaznam.volania.find((call) => call.name === name);
    expect(hit, `${name} sa Rechartsu vôbec neodovzdal`).toBeDefined();
    return hit!.props;
  };

  it('graf dostane TIE ISTÉ riadky, aké má model — vrátane `null`', () => {
    vykresli();
    const data = prvy('ComposedChart').data as Array<{ units: number | null }>;
    expect(data.map((row) => row.units)).toEqual(kusy());
    // Žiadny riadok sa po ceste nevynechal a žiadny sa nezaslepil nulou.
    expect(data).toHaveLength(7);
  });

  it('`connectNulls` je VÝSLOVNE `false` — nie „nejako falsy"', () => {
    vykresli();
    /*
     * Toto je jadro K6 preložené do jazyka Rechartsu. Pri `true` by knižnica
     * cez medzeru natiahla spojnicu a z priznania „toto sme nemerali" by
     * spravila tvrdenie „medzi tými dňami to šlo takto". Predvolená hodnota
     * knižnice sa nepočíta: cudzia predvoľba nie je náš invariant.
     */
    expect(prvy('Area').connectNulls).toBe(false);
  });

  it('os x je KALENDÁR (ISO deň), nie popis — a základňa osi y je nula', () => {
    vykresli();
    expect(prvy('XAxis').dataKey).toBe('day');
    expect(prvy('YAxis').domain).toEqual([0, pohlad().scaleMax]);
  });

  it('medzera dostane ŠRAFOVANIE, nie výplň — a zľava leží POD ňou', () => {
    const bands = discountBands(chartGeometry(rad(), DNES)!, [
      { id: 3, name: 'Letná', percent: 20, dateFrom: '2026-08-02', dateTo: '2026-08-06' },
    ]);
    expect(bands).toHaveLength(1);
    vykresli(bands);

    const plochy = zaznam.volania.filter((call) => call.name === 'ReferenceArea');
    // Jedna zľava a dve medzery (3. 8. a 5.–6. 8.).
    expect(plochy).toHaveLength(3);
    // Zľava je PRVÁ, teda pod šrafovaním: v SVG kreslí neskorší uzol nad
    // skorším a nemeraný deň musí zostať čitateľne nemeraný.
    expect(String(plochy[0]!.props.fill)).toContain('var(--sel)');
    for (const medzera of plochy.slice(1)) {
      expect(String(medzera.props.fill)).toContain('url(#sales-hatch');
      expect(medzera.props.fillOpacity).toBe(1);
    }
  });

  it('popis osi je slovenský dátum a NEZLOMÍ sa na dva riadky', () => {
    vykresli();
    /*
     * `Text` Rechartsu láme popisky po slovách, takže „5. 8." vie rozdeliť na
     * dva riadky pod sebou — z jedného dátumu by boli dva. Medzera je preto
     * nezlomiteľná; zmerané v jsdom, nie odhadnuté.
     */
    const popis = prvy('XAxis').tickFormatter as (day: string) => string;
    expect(popis('2026-08-05')).toBe('5.\u00a08.');
    expect(popis('2026-08-05')).not.toContain(' ');
  });

  it('legenda a priznania sú po slovensky a marka nie je nikdy sama', () => {
    vykresli();
    const view = pohlad();
    // Slovo je POVINNÉ pri každej marke (tretí kanál); farba sama nestačí.
    for (const item of view.legend) expect(item.label.length).toBeGreaterThan(3);
    expect(view.legend.map((item) => item.label)).toContain('predané kusy');
    expect(view.legend.map((item) => item.label)).toContain('nesťahované dni, predaj nepoznáme');
  });

  it('nad radom s medzerou sa NEKRESLÍ trendová čiara', () => {
    vykresli();
    // Sklon by počítal s dňami, ktoré nikto nezmeral.
    expect(pohlad().drawTrend).toBe(false);
    expect(zaznam.volania.some((call) => call.name === 'Line')).toBe(false);
  });

  it('nad súvislým radom trend čiaru dostane a je to VLASTNÝ rad', () => {
    const suvisly = chartGeometry(
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'].map((day, i) => ({
        day,
        units: 10 + i,
      })),
      DNES,
    )!;
    renderToStaticMarkup(
      createElement(SalesChart, { geometry: suvisly, caption: 'test', label: 'test' }),
    );
    const trend = prvy('Line');
    expect(trend.dataKey).toBe('trend');
    expect(trend.connectNulls).toBe(false);
    // Farbu trendu nesie TRIEDA, nie prop — zlatá sa do `.tsx` dostať nesmie.
    expect(String(trend.className)).toContain('trendLine');
    expect(trend.stroke).toBeUndefined();
  });

  it('značka bodu vzniká len z merania — medzera bod NEDOSTANE', () => {
    for (const point of pohlad().points) {
      const dot = SeriesDot({ cx: 5, cy: 5, payload: point });
      expect(dot === null, point.day).toBe(point.units === null);
    }
  });

  it('bublina nad nemeraným dňom ukáže POMLČKU a vetu, nie číslo suseda', () => {
    const view = pohlad();
    const html = renderToStaticMarkup(
      createElement(SalesTip, { active: true, label: '2026-08-03', points: view.points }),
    );
    expect(html).toContain('—');
    expect(html).toContain(SALES_TIP_NOTES.unmeasured);
    // A nad meranou nulou ukáže NULU, nie pomlčku.
    const nula = renderToStaticMarkup(
      createElement(SalesTip, { active: true, label: '2026-08-02', points: view.points }),
    );
    expect(nula).toContain('0 kusov');
    expect(nula).not.toContain('—');
  });
});

/* ═════════ C. Celá cesta: odpoveď → sekcia → prepis pod grafom ════════════ */

describe('C. na obrazovke to hovorí to isté', () => {
  /*
   * `SalesSnapshot.days` je typovo `SalesDay[]`, teda `units: number` — dolnú
   * hranicu ani `null` v ňom NEVYJADRÍŠ a je to správne: tie dva stavy
   * prichádzajú z `/api/insights/sales-daily` cez `toSeriesDay()` a v statickom
   * renderi klientský efekt nebeží. Sekcia sa tu preto meria na TREŤOM stave,
   * ktorý sa dá vyrobiť aj bez fetchu: dni 3.–6. 8. v odpovedi VÔBEC NIE SÚ.
   * Nemeraný deň teda nevzniká z `null`, ale z toho, že o ňom nie je riadok —
   * a graf ho aj tak MUSÍ ukázať ako medzeru (inak by sa os stiahla).
   */
  function snapshot(): SalesSnapshot {
    return {
      today: DNES,
      coverage: {
        syncEnabled: true,
        from: '2026-08-01',
        to: DNES,
        daysCovered: 7,
        lastSyncedAt: '2026-08-07T02:10:00.000Z',
        hasData: true,
      },
      windowUnits: 16,
      unitsPerDay: null,
      recentUnits: null,
      previousUnits: null,
      days: [
        { day: '2026-08-01', units: 12 },
        { day: '2026-08-02', units: 0 },
        { day: DNES, units: 4 },
      ],
    };
  }

  const html = renderToStaticMarkup(createElement(SalesSection, { sales: snapshot() }));

  it('prepis pre čítačku nesie meranie, nulu aj pomlčku vedľa seba', () => {
    const prepis = html.slice(
      html.indexOf('data-testid="sales-chart-summary"'),
      html.indexOf('data-testid="sales-chart-legend"'),
    );
    expect(prepis).toContain('<td>12</td>');
    // Nula je odpoveď o eshope a v prepise zostáva nulou.
    expect(prepis).toContain('<td>0</td>');
    // Štyri dni, o ktorých odpoveď nič nehovorí, sú POMLČKY — a sú v prepise.
    expect((prepis.match(/<td>—<\/td>/g) ?? []).length).toBe(4);
  });

  it('sekcia pod grafom povie, koľko dní chýba — číslom, nie mlčaním', () => {
    expect(html).toContain('data-testid="sales-gap-note"');
    expect(html).toContain('tie dni sa nesťahovali');
    expect(html).toContain('4 dni');
  });

  it('dátová tabuľka priznáva medzeru vlastným riadkom, nie nulou', () => {
    const tabulka = html.slice(html.indexOf('data-testid="sales-chart-table"'));
    expect(tabulka).toContain('nesťahované');
    expect(tabulka).toContain('deň stiahnutý, predaj žiadny');
    expect(tabulka).toContain('dnešok, deň ešte beží');
  });
});
