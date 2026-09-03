/**
 * Aura Zľavy — PREHĽAD, rozhodnutia bez prehliadača (V9).
 *
 * Prehľad je prístrojová doska nad appkou, ktorá zapisuje do PRODUKČNÉHO
 * eshopu. Vety typu „nič sa nezapisuje" alebo „hotové ≈ 2. 9." sú tvrdenia
 * o produkcii, nie dekorácia — musia sa dať overiť bez klikania.
 *
 * Testuje sa preto to, čo o obrazovke rozhoduje:
 *
 *   A. čítanie API — čo sa nedá prečítať, je `null`, nikdy nula,
 *   B. stav dominanty — päť podôb a hlavne tá, ktorá tvrdí, že fronta STOJÍ,
 *   C. zoznam „Zľavy naživo" — poradie stavov a slová zo slovníka,
 *   D. sekcia tržieb — dnešok nikdy nevstupuje do priemeru ani do trendu,
 *   E. tvrdá hranica architektúry: Prehľad NIKDY nevykreslí tabuľku produktov.
 *
 * Vlastník: V9.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CampaignsSection from '@/components/dashboard/CampaignsSection';
import SalesSection from '@/components/dashboard/SalesSection';

import {
  parseCampaignList,
  parseInsights,
  parseQueueSnapshot,
  parseSalesSnapshot,
  type CampaignRow,
  type InsightRow,
  type QueueSnapshot,
} from '@/components/dashboard/api';
import {
  calmNumbers,
  liveCampaigns,
  progressPercent,
  queueProgress,
  tiersLabel,
  toStatusCode,
} from '@/components/dashboard/overview-model';
import {
  axisDay,
  chartGeometry,
  closedDays,
  salesNumbers,
  trendPercent,
} from '@/components/dashboard/sales-view';
import { chartScaleMax } from '@/components/ui/chart-language';
import { NEVIEME } from '@/lib/ui/product-label';

const TODAY = '2026-08-10';

/* ═════════════════════════════ pomocné snímky ═════════════════════════════ */

function queueSnapshot(patch: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    budget: { day: TODAY, budget: 200, spent: 100, remaining: 100, exhausted: false },
    queue: { pending: 4580, total: 8000, done: 3420, campaigns: 1 },
    current: {
      campaignId: 1,
      name: 'Ležiaky striebro — jeseň',
      status: 'queued',
      dateFrom: '2026-09-04',
      dateTo: '2026-09-18',
      itemsTotal: 8000,
      itemsOk: 3408,
      itemsFailed: 12,
      itemsUncertain: 0,
      itemsPending: 4580,
      late: false,
    },
    estimate: { pending: 4580, perDay: 200, days: 23, date: '2026-09-02' },
    heartbeat: { lastTickAt: '2026-08-10T09:40:00.000Z', stale: false },
    gate: { paused: false, since: null },
    ...patch,
  };
}

function campaign(patch: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: 1,
    name: 'Zľava',
    status: 'queued',
    percent: 30,
    dateFrom: '2026-09-04',
    dateTo: '2026-09-18',
    itemsTotal: 100,
    itemsOk: 40,
    itemsFailed: 0,
    itemsUncertain: 0,
    itemsPending: 60,
    late: false,
    tiers: [],
    estimate: null,
    ...patch,
  };
}

/* ══════════════════ A. Čo sa nedá prečítať, je `null` ═════════════════════ */

describe('Prehľad — čítanie API nikdy nedopĺňa čísla', () => {
  it('nezmyselná odpoveď fronty skončí ako `null`, nie ako nula', () => {
    expect(parseQueueSnapshot(null)).toBeNull();
    expect(parseQueueSnapshot('nie je to objekt')).toBeNull();
    expect(parseQueueSnapshot({})).toBeNull();
    expect(parseQueueSnapshot({ queue: { pending: -1, total: 8000, done: 0 } })).toBeNull();
  });

  it('rozpočet, ktorý sa nedá prečítať, zostáva `null` a fronta sa číta ďalej', () => {
    const parsed = parseQueueSnapshot({
      budget: null,
      queue: { pending: 10, total: 20, done: 10, campaigns: 1 },
      current: null,
      estimate: null,
      heartbeat: { lastTickAt: null, staleMs: null, stale: true },
      gate: { paused: false, since: null, bestEffort: true },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.budget).toBeNull();
    expect(parsed?.queue.done).toBe(10);
  });

  it('chýbajúci heartbeat znamená „fronta stojí", nie „všetko v poriadku"', () => {
    const parsed = parseQueueSnapshot({
      queue: { pending: 5, total: 10, done: 5, campaigns: 1 },
    });
    expect(parsed?.heartbeat.stale).toBe(true);
  });

  it('zoznam zliav prežije pokazený riadok a nevyrobí zo zvyšku nulu', () => {
    const rows = parseCampaignList({
      data: [
        { id: 7, name: 'Prstene', status: 'done', percent: 35, itemsTotal: 640, itemsOk: 637 },
        { id: null, name: 'pokazený riadok' },
        'toto vôbec nie je riadok',
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.itemsOk).toBe(637);
    expect(parseCampaignList({ data: 'nie je pole' })).toBeNull();
  });

  it('predaj sa poskladá zo súčtov produktov a pozná svoje pokrytie', () => {
    const snapshot = parseSalesSnapshot({
      today: TODAY,
      coverage: { syncEnabled: true, from: '2026-07-28', to: TODAY, daysCovered: 14, hasData: true },
      products: [
        { productId: 1, unitsSold: 10, unitsPerDay: 0.7, recentUnits: 6, previousUnits: 4 },
        { productId: 2, unitsSold: 4, unitsPerDay: 0.3, recentUnits: 1, previousUnits: 3 },
      ],
    });
    expect(snapshot?.windowUnits).toBe(14);
    expect(snapshot?.recentUnits).toBe(7);
    expect(snapshot?.previousUnits).toBe(7);
    expect(snapshot?.days).toEqual([]);
  });

  it('zistenia bez vety sa zahodia — riadok návrhu bez textu nemá zmysel', () => {
    const rows = parseInsights({
      findings: [
        { id: 'a', tone: 'info', text: 'Návrh', href: '/produkty' },
        { id: 'b', tone: 'attention' },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.tone).toBe('info');
    expect(parseInsights({})).toBeNull();
  });
});

/* ══════════════════════ B. Stav dominantnej sekcie ═══════════════════════ */

describe('Prehľad — dominanta hovorí pravdu o fronte', () => {
  it('bez odpovede appky sa netvrdí nič', () => {
    const p = queueProgress({ snapshot: null, campaigns: null, today: TODAY });
    expect(p.mode).toBe('unknown');
    expect(p.total).toBe(0);
  });

  it('prázdna fronta bez zliav je prázdny stav, nie pokoj', () => {
    const snapshot = queueSnapshot({
      queue: { pending: 0, total: 0, done: 0, campaigns: 0 },
      current: null,
    });
    expect(queueProgress({ snapshot, campaigns: [], today: TODAY }).mode).toBe('empty');
  });

  /**
   * Bod E1 (24. 8. 2026). `campaigns: null` je „zoznam sa nepodarilo prečítať",
   * `campaigns: []` je „žiadne zľavy nie sú". Do 24. 8. z oboch vychádzal
   * `mode: 'empty'`, takže appka na nečitateľnú odpoveď kreslila pokojnú
   * prázdnu obrazovku a tvrdila stav, ktorý nezmerala.
   *
   * Celý test je ten ROZDIEL, preto sa oba vstupy porovnávajú vedľa seba —
   * tvrdenie „null dá unknown" samo o sebe by prežilo aj to, keby `empty`
   * prestalo vznikať vôbec.
   */
  it('nečitateľný zoznam zliav NIE JE prázdny stav', () => {
    const snapshot = queueSnapshot({
      queue: { pending: 0, total: 0, done: 0, campaigns: 0 },
      current: null,
    });

    expect(queueProgress({ snapshot, campaigns: null, today: TODAY }).mode).toBe('unknown');
    expect(queueProgress({ snapshot, campaigns: [], today: TODAY }).mode).toBe('empty');
  });

  it('prázdna fronta so zľavami je pokojný stav', () => {
    const snapshot = queueSnapshot({
      queue: { pending: 0, total: 8000, done: 8000, campaigns: 0 },
      current: null,
    });
    expect(queueProgress({ snapshot, campaigns: [campaign()], today: TODAY }).mode).toBe('calm');
  });

  it('bežiaca fronta dá číslo, pruh aj odhad označený ako odhad', () => {
    const p = queueProgress({ snapshot: queueSnapshot(), campaigns: [campaign()], today: TODAY });
    expect(p.mode).toBe('running');
    expect(p.done).toBe(3420);
    expect(p.total).toBe(8000);
    expect(p.percent).toBeCloseTo(42.75, 2);
    expect(p.finishDay).toBe('2026-09-02');
    expect(p.sentence?.text).toBe('zapisuje sa · 12 sa nepodarilo');
  });

  /**
   * Najdôležitejšie tvrdenie tohto súboru. Brána po odstávke je in-process
   * stav, ktorý route handler nemusí vidieť rovnako ako scheduler — preto
   * o zastavení rozhoduje AJ heartbeat z databázy. Keby platila len brána,
   * Prehľad by pri mŕtvom scheduleri veselo tvrdil, že sa zapisuje.
   */
  it('mŕtvy scheduler znamená „fronta stojí" aj keď je brána otvorená', () => {
    const snapshot = queueSnapshot({
      gate: { paused: false, since: null },
      heartbeat: { lastTickAt: '2026-08-09T21:04:00.000Z', stale: true },
    });
    const p = queueProgress({ snapshot, campaigns: [campaign()], today: TODAY });
    expect(p.mode).toBe('paused');
    expect(p.sentence?.text).toContain('pozastavené');
    expect(p.pausedSince).toBe('2026-08-09T21:04:00.000Z');
  });

  it('zatvorená brána zastaví frontu aj pri živom heartbeate', () => {
    const snapshot = queueSnapshot({ gate: { paused: true, since: '2026-08-09T21:04:00.000Z' } });
    expect(queueProgress({ snapshot, campaigns: [campaign()], today: TODAY }).mode).toBe('paused');
  });

  it('vyčerpaný rozpočet je neutrálna informácia, nie chyba', () => {
    const snapshot = queueSnapshot({
      budget: { day: TODAY, budget: 200, spent: 200, remaining: 0, exhausted: true },
    });
    const p = queueProgress({ snapshot, campaigns: [campaign()], today: TODAY });
    const tones = p.sentence?.flags.map((flag) => flag.tone) ?? [];
    expect(tones).toContain('neutral');
    expect(tones).not.toContain('critical');
  });

  it('podiel v pruhu nikdy nevyjde mimo 0–100 ani ako `NaN`', () => {
    expect(progressPercent(3420, 8000)).toBeCloseTo(42.75, 2);
    expect(progressPercent(10, 0)).toBe(0);
    expect(progressPercent(-5, 100)).toBe(0);
    expect(progressPercent(500, 100)).toBe(100);
    expect(progressPercent(Number.NaN, 100)).toBe(0);
  });

  it('neznámy kód stavu sa nikdy nedostane do slovníka surový', () => {
    expect(toStatusCode('queued')).toBe('queued');
    expect(toStatusCode('celkom_novy_stav')).toBe('draft');
  });
});

/* ═════════════════════════ C. Zľavy naživo ═══════════════════════════════ */

describe('Prehľad — zoznam „Zľavy naživo"', () => {
  const rows = [
    campaign({ id: 1, name: 'Jarná obnova', status: 'done', dateFrom: '2026-06-15', dateTo: '2026-07-15' }),
    campaign({ id: 2, name: 'Náušnice', status: 'scheduled', dateFrom: '2026-10-01', dateTo: '2026-10-15' }),
    campaign({ id: 3, name: 'Prstene', status: 'done', dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
    campaign({ id: 4, name: 'Ležiaky', status: 'queued', dateFrom: '2026-09-04', dateTo: '2026-09-18' }),
  ];

  it('hore je to, čo sa hýbe: zapisuje sa → beží → pripravená → skončila', () => {
    const live = liveCampaigns(rows, TODAY, 4);
    expect(live.map((item) => item.sentence.state)).toEqual([
      'zapisuje sa',
      'beží',
      'pripravená',
      'skončila',
    ]);
  });

  it('tri riadky, nie štyri — Prehľad nie je zoznam zliav', () => {
    expect(liveCampaigns(rows, TODAY)).toHaveLength(3);
  });

  it('pásma sa vypíšu od najväčšej zľavy, hlavička hovorí najvyššie percento', () => {
    expect(
      tiersLabel(
        campaign({
          percent: 30,
          tiers: [
            { ord: 1, label: 'A', percent: 20, itemsCount: 3420 },
            { ord: 2, label: 'B', percent: 30, itemsCount: 3180 },
            { ord: 3, label: 'C', percent: 15, itemsCount: 1400 },
          ],
        }),
      ),
    ).toBe('3 pásma · 30 / 20 / 15 %');
    expect(tiersLabel(campaign({ percent: 25, tiers: [] }))).toBe('25 %');
  });

  it('viac pásiem sa v hlavičke povie ako počet pásiem, nie ako jedno percento', () => {
    const [item] = liveCampaigns(
      [
        campaign({
          percent: 30,
          tiers: [
            { ord: 1, label: 'A', percent: 30, itemsCount: 3180 },
            { ord: 2, label: 'B', percent: 20, itemsCount: 3420 },
          ],
        }),
      ],
      TODAY,
    );
    expect(item?.percentLabel).toBe('2 pásma');
    expect(item?.writing).toBe(true);
  });

  it('pokojný stav počíta bežiace, pripravené a zlacnené podľa vlastných zápisov', () => {
    const numbers = calmNumbers(rows, TODAY);
    expect(numbers.live).toBe(1);
    expect(numbers.ready).toBe(1);
    expect(numbers.discounted).toBe(40);
  });
});

/* ═══════════════════════════ D. Sekcia tržieb ════════════════════════════ */

describe('Prehľad — tržby počítajú len uzavreté dni', () => {
  const days = [
    { day: '2026-08-04', units: 8 },
    { day: '2026-08-05', units: 8 },
    { day: '2026-08-06', units: 8 },
    { day: '2026-08-07', units: 12 },
    { day: '2026-08-08', units: 12 },
    { day: '2026-08-09', units: 14 },
    { day: TODAY, units: 3 },
  ];

  const snapshot = {
    today: TODAY,
    coverage: {
      syncEnabled: true,
      from: '2026-08-04',
      to: TODAY,
      daysCovered: 7,
      lastSyncedAt: '2026-08-10T03:00:00.000Z',
      hasData: true,
    },
    windowUnits: 63,
    unitsPerDay: null,
    recentUnits: null,
    previousUnits: null,
    days,
  };

  it('dnešok je fakt „zatiaľ", ale do priemeru nevstupuje', () => {
    expect(closedDays(days, TODAY)).toHaveLength(6);
    const numbers = salesNumbers(snapshot);
    expect(numbers.today).toBe(3);
    expect(numbers.closedDays).toBe(6);
    // (8+8+8+12+12+14)/6 = 10,33 → 10. So započítaným dneškom by vyšlo 9.
    expect(numbers.perDay).toBe(10);
  });

  it('trend porovnáva dve polovice okna, nikdy nedelí nulou', () => {
    expect(trendPercent(100, 104)).toBe(4);
    expect(trendPercent(0, 40)).toBeNull();
    expect(trendPercent(null, 40)).toBeNull();
    // Staršia polovica 8+8+8 = 24, novšia 12+12+14 = 38 → +58 %.
    expect(salesNumbers(snapshot).trendPercent).toBe(58);
  });

  it('bez denného priebehu sa priemer vezme zo súčtov produktov a „dnes" mlčí', () => {
    const numbers = salesNumbers({ ...snapshot, days: [], unitsPerDay: 9.4 });
    expect(numbers.today).toBeNull();
    expect(numbers.perDay).toBe(9);
    expect(numbers.closedDays).toBe(0);
  });

  it('graf kreslí uzavreté dni plnou čiarou a dnešok osobitne', () => {
    const geometry = chartGeometry(days, TODAY);
    expect(geometry).not.toBeNull();
    expect(geometry?.points).toHaveLength(6);
    expect(geometry?.todayPoint?.day).toBe(TODAY);
    expect(geometry?.trendLine).not.toBeNull();
    expect(geometry?.xLabels.length).toBeLessThanOrEqual(5);
    // Prvý bod sedí na ľavom okraji sústavy, posledný uzavretý pred dneškom.
    expect(geometry?.points[0]?.x).toBe(30);
    expect(geometry?.scaleMax).toBe(20);
  });

  it('jeden deň sa nekreslí — čiara cez jediný bod by predstierala priebeh', () => {
    expect(chartGeometry([{ day: TODAY, units: 3 }], TODAY)).toBeNull();
  });

  it('os grafu používa slovenský krátky dátum a okrúhlu hornú hranicu', () => {
    /*
     * PRESMEROVANÉ 2. 9. 2026 (K5, V6b). Hranicu tu merali tri riadky na
     * `niceCeiling()` — znakovo zhodnú KÓPIU `chartScaleMax()` z jazyka
     * grafov. Tri kópie sú zlúčené na jednu, takže `niceCeiling` už
     * neexistuje a `sales-view.ts` si pravidlo importuje. Rebrík a základňu
     * nula stráži `grafy-jazyk.spec.ts` sekcia A (vlastná tabuľka očakávaní
     * plus závora na druhé telo v `src/`); tu zostáva to, čo do Prehľadu
     * patrí — že os grafu predaja to pravidlo NAOZAJ dostane.
     */
    expect(axisDay('2026-08-04')).toBe('4. 8.');
    expect(axisDay('nezmysel')).toBe('nezmysel');
    expect(chartScaleMax(1180)).toBe(2000);
    expect(chartGeometry([{ day: '2026-08-08', units: 1180 }, { day: '2026-08-09', units: 14 }], TODAY)?.scaleMax).toBe(2000);
  });
});

/* ═════════════ E. Hranica voči Produktom: JEDNA tabuľka, na čítanie ══════ */

describe('Prehľad — hranica voči Produktom', () => {
  const DIR = resolve(process.cwd(), 'src/components/dashboard');

  function sources(): Array<{ path: string; code: string }> {
    return readdirSync(DIR)
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => ({ path: name, code: readFileSync(join(DIR, name), 'utf8') }));
  }

  /** Značky aj primitívum. `<ChartTable` sa nechytá — `Table` ním nezačína. */
  const TABULKA = /<table|<thead|<tbody|ovl-table|\btbl-|<Table\b|components\/ui\/Table/;

  /**
   * ČO SA TU ZMENILO 3. 9. 2026 A PREČO TO NIE JE ROZPUSTENÁ HRANICA
   * ────────────────────────────────────────────────────────────────
   * Architektúra §1 znela „Tabuľka produktov — Prehľad NIKDY, Produkty vždy."
   * a tento test to meral zákazom značky `<table>` v celom priečinku. D159 to
   * rozhodnutie MENÍ: Prehľad má deväťstĺpcovú tabuľku s filtrami, pretože
   * Samuelova otázka „čo leží" sa v desiatich riadkoch rebríka nedala
   * zodpovedať.
   *
   * Hranica sa tým ale nezrušila, len sa presunula z formy na SPRÁVANIE
   * a jej dnešnú polovicu meria `prehlad-tabulka.spec.ts` §E: riadok NIE JE
   * klikateľný (D163), tabuľka nemá výber ani obohacovanie strany a na shop
   * z nej neodíde ani jeden request. Prehľad je na čítanie, Produkty sú
   * pracovná obrazovka.
   *
   * Čo zostáva TU, je to, čo tá druhá polovica nevie zmerať: **tabuľka je na
   * Prehľade PRESNE JEDNA.** Bez tohto tvrdenia by stačilo, aby si druhá
   * sekcia nakreslila „malý zoznam" v `<table>`, a o mesiac by boli na jednej
   * obrazovke dve tabuľky produktov s dvomi rôznymi sadami stĺpcov — presne
   * ten rozchod, pre ktorý existuje `product-columns.ts` (D124).
   */
  it('tabuľku kreslí PRESNE JEDEN komponent Prehľadu — `ProductsTable`', () => {
    const hits = sources()
      .filter((file) => TABULKA.test(file.code))
      .map((file) => file.path)
      .sort();
    expect(hits).toEqual(['ProductsTable.tsx']);
  });

  it('sanity — skener naozaj číta komponenty Prehľadu', () => {
    const files = sources();
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.some((file) => file.path === 'ProductsTable.tsx')).toBe(true);
    expect(files.some((file) => file.path === 'Overview.tsx')).toBe(true);
  });
});

/* ══════════════════ F. Obrazovka sa naozaj vykreslí ══════════════════════ */

/**
 * Report agenta nie je dôkaz — pasca, ktorá tu už raz prežila do produkcie.
 * Preto sa sekcie naozaj vykreslia a kontroluje sa VÝSTUP, nie zámer.
 */
describe('Prehľad — sekcie sa vykreslia', () => {
  /** Text medzi značkami — na kontrolu dĺžky viet (P2). */
  function textNodes(html: string): string[] {
    return html
      .split(/<[^>]+>/)
      .map((chunk) => chunk.replace(/<!--\s*-->/g, '').trim())
      .filter((chunk) => chunk !== '');
  }

  function renderCampaigns(
    campaigns: CampaignRow[] | null,
    insights: InsightRow[] | null,
  ): string {
    return renderToStaticMarkup(
      createElement(CampaignsSection, {
        campaigns: campaigns === null ? null : liveCampaigns(campaigns, TODAY),
        insights,
      }),
    );
  }

  const INSIGHTS: InsightRow[] = [
    {
      id: 'a',
      tone: 'info',
      text: '11 640 produktov sa 180 dní nepredalo',
      href: '/produkty',
      action: { label: 'Použiť', href: '/zlavy/nova' },
    },
    {
      id: 'b',
      tone: 'attention',
      text: '12 sa nepodarilo',
      href: '/zlavy/1',
      action: null,
    },
  ];

  it('„Zľavy" sú dva stĺpce: čo beží a čo sa ponúka', () => {
    const rows = [
      campaign({ id: 3, name: 'Prstene', status: 'done', dateFrom: '2026-08-01', dateTo: '2026-08-31' }),
      campaign({ id: 4, name: 'Ležiaky', status: 'queued' }),
      campaign({ id: 2, name: 'Náušnice', status: 'scheduled', dateFrom: '2026-10-01', dateTo: '2026-10-15' }),
    ];
    const html = renderCampaigns(rows, INSIGHTS);

    expect(html).toContain('Beží teraz');
    expect(html).toContain('Návrhy');
    expect(html.match(/data-testid="live-row"/g)).toHaveLength(3);
    expect(html).toContain('11 640 produktov sa 180 dní nepredalo');
    expect(html).toContain('Použiť');
    // Pozornosť stojí pred návrhom — zlyhanie je fakt, návrh je len ponuka.
    expect(html.indexOf('12 sa nepodarilo')).toBeLessThan(html.indexOf('11 640 produktov'));
    // K8 — zamknuté funkcie sa nesmú ani skryť, ani predstierať. Na Prehľade
    // ich ale NEOZNAMUJE stĺpec NÁVRHY: riadok „Marža a obrátkovosť zamknuté"
    // odtiaľ 19. 8. 2026 odišiel, lebo to nie je návrh a tú istú vetu hovorí
    // ľavý panel Produktov aj Nastavenia. K8 tým neutrpelo — schopnosť je
    // priznaná tam, kam patrí (stráži to nastavenia-v12 a produkty-hustota).
    // Tu sa preto tvrdí opak: v stĺpci návrhov to už byť nesmie.
    expect(html).not.toContain('Marža a obrátkovosť zamknuté');
    expect(html).not.toContain('<table');
  });

  /**
   * Prázdne pole = „appka nemá ani jednu zľavu"; `null` = „nepodarilo sa
   * prečítať". Splynúť nesmú a druhé „Žiadna zľava" na jednej obrazovke by
   * bolo len opakovanie dominanty.
   */
  it('bez jedinej zľavy sa ľavý stĺpec nekreslí, návrhy zostávajú', () => {
    const html = renderCampaigns([], INSIGHTS);
    expect(html).not.toContain('Beží teraz');
    expect(html).toContain('Návrhy');
    expect(html).toContain('11 640 produktov');

    const unreadable = renderCampaigns(null, null);
    expect(unreadable).toContain('Zoznam zliav sa nepodarilo načítať');
    expect(unreadable).toContain('Návrhy sa nepodarilo načítať');
  });

  it('predaj kreslí graf z kusov a nikde neuvedie euro, ktoré appka nepozná', () => {
    const html = renderToStaticMarkup(
      createElement(SalesSection, {
        sales: {
          today: TODAY,
          coverage: {
            syncEnabled: true,
            from: '2026-08-04',
            to: TODAY,
            daysCovered: 7,
            lastSyncedAt: '2026-08-10T03:00:00.000Z',
            hasData: true,
          },
          windowUnits: 65,
          unitsPerDay: null,
          recentUnits: null,
          previousUnits: null,
          days: [
            { day: '2026-08-04', units: 8 },
            { day: '2026-08-05', units: 8 },
            { day: '2026-08-06', units: 8 },
            { day: '2026-08-07', units: 12 },
            { day: '2026-08-08', units: 12 },
            { day: '2026-08-09', units: 14 },
            { day: TODAY, units: 3 },
          ],
        },
      }),
    );
    expect(html).toContain('<svg');
    /* PRESMEROVANÉ VO V6b (2. 9. 2026): trendovú čiaru kreslil inline SVG
       triedou `line trend`; od prevodu na `ChartCard` + Recharts (D135) ju
       kreslí rad Rechartsu a v teste sa plocha nekreslí vôbec. Že trend
       v grafe JE, hovorí odteraz jeho slovo v legende — a to je zároveň ten
       kanál, ktorý sa nikdy stratiť nesmie (marka bez slova je obrázok). */
    expect(html).toContain('trend cez uzavreté dni');
    expect(html).toContain('Priemer za deň');
    expect(html).toContain('Dáta k');
    expect(html).not.toContain('€');
    // Nadpis hovorí to, čo sekcia meria: kusy, nie tržbu v eurách.
    expect(html).toContain('<h2>Predaj</h2>');
    expect(html).not.toContain('<h2>Tržby</h2>');
  });

  /**
   * TRI ČÍSLA NAD GRAFOM PRIZNÁVAJÚ, KEĎ NEMERALI (§4 bod 1, K10).
   *
   * Doplnené 3. 9. 2026 po verifikácii V6c: mutácia pomlčky v dlaždici
   * „Priemer za deň" na `pieces(0)` neprebudila ANI JEDNO tvrdenie v repe.
   * Appka by pri prázdnom pokrytí (dnešný stav — `shop_write` kľúč chýba)
   * napísala „0 kusov za deň" ako meranie o eshope, ktoré nikdy neurobila.
   * Priznanie je tu jediný pravdivý obsah, takže sa meria znakom, nie dojmom.
   *
   * Znak sa neopisuje ručne — `NEVIEME` je jediné miesto, kde žije (D116).
   */
  it('tri čísla nad grafom sú pomlčky, keď appka nemerala — nikdy nuly', () => {
    const html = renderToStaticMarkup(
      createElement(SalesSection, {
        sales: {
          today: TODAY,
          coverage: {
            syncEnabled: true,
            from: null,
            to: null,
            daysCovered: 0,
            lastSyncedAt: null,
            hasData: true,
          },
          windowUnits: 0,
          unitsPerDay: null,
          recentUnits: null,
          previousUnits: null,
          days: [],
        },
      }),
    );

    const values = [...html.matchAll(/<div class="v num">([^<]*)</g)].map((m) => m[1]);
    expect(values).toHaveLength(3);
    expect(values).toEqual([NEVIEME, NEVIEME, NEVIEME]);
    // Ani jedna číslica: „0 kusov" a „0 %" sú tvrdenia o eshope, nie o appke.
    for (const value of values) expect(value).not.toMatch(/\d/);
    /* Ani podpisy pod tromi číslami nesmú niesť číslicu — „bez uzavretého dňa"
       je veta, „0 uzavretých dní" by bolo meranie. (Hlavička sekcie sa tu
       nemeria: `windowUnits` je číslo zo servera, nie dopočet obrazovky.) */
    const notes = [...html.matchAll(/<div class="s">([^<]*)</g)].map((m) => m[1]);
    expect(notes).toHaveLength(3);
    for (const note of notes) expect(note).not.toMatch(/\d/);
    // A podpis pod číslom hovorí PREČO, aby pomlčka nebola len znak.
    expect(html).toContain('denný priebeh zatiaľ nemáme');
    expect(html).toContain('bez uzavretého dňa');
    expect(html).toContain('obdobie zatiaľ nevieme');
  });

  it('bez pokrytia predaja je jedna veta a jedno tlačidlo, nie nuly', () => {
    const html = renderToStaticMarkup(createElement(SalesSection, { sales: null }));
    expect(html).toContain('Údaje o predaji sa nepodarilo načítať.');
    expect(html).toContain('Otvoriť Nastavenia');
    expect(html).not.toContain('<svg');
  });

  it('žiadny odstavec dlhší ako 90 znakov a žiadny `<p>` (P2)', () => {
    const html = [
      renderCampaigns([campaign()], INSIGHTS),
      renderCampaigns([], null),
      renderToStaticMarkup(createElement(SalesSection, { sales: null })),
    ].join('\n');

    expect(html).not.toContain('<p>');
    const tooLong = textNodes(html).filter((text) => text.length > 90);
    expect(tooLong.join('\n')).toBe('');
  });
});
