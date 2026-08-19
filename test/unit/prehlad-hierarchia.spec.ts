/**
 * Aura Zľavy — PREHĽAD: hierarchia obrazovky (kontrakt UX/dizajn 19. 8. 2026,
 * vlna O1; defekty D5, D6, D7).
 *
 * Tri defekty, ktoré tento súbor stráži, majú spoločnú príčinu: každý z nich
 * vznikol tým, že na obrazovku pribudol prvok, ktorý sa NIKDE nemeral. Preto
 * sa merajú tu, a nie okom nad snímkou.
 *
 *   D5  Na jednej karte stáli dve dominanty — verdikt v 44 px a pod ním
 *       vycentrovaná škatuľa prázdneho stavu s vlastným plným tlačidlom.
 *       Test počíta `.lvl-1` a `.empty`: dominanta je práve jedna a prázdny
 *       stav nie je škatuľa.
 *
 *   D6  Slovo o závažnosti prekážky („zastavuje zápis") stálo na začiatku
 *       druhého riadku textu, mimo značky, ku ktorej patrí, a hneď za ním
 *       pokračovala veta o ďalšom kroku. Test overuje, že slovo je slovom
 *       ZNAČKY, že značka stojí v riadku ako prvá a že slovo o spôsobe
 *       riešenia sa nikde neopakuje dvakrát.
 *
 *   D7  „Predaj" bez pokrytia zaberal celú kartu kvôli jednej vete. Test
 *       overuje, že bez dát to nie je `<section>` ani nadpis, ale jeden
 *       riadok — a že s dátami sekciou znova je.
 *
 * A nad tým všetkým dve pravidlá naraz na celej obrazovke: najviac ŠTYRI
 * sekcie (P5) a presne JEDNA dominanta (P1).
 *
 * Vlastník: vlna O1, kontrakt UX/dizajn 19. 8. 2026.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BlockersSection from '@/components/dashboard/BlockersSection';
import CampaignsSection from '@/components/dashboard/CampaignsSection';
import SalesSection from '@/components/dashboard/SalesSection';
import StatusSection from '@/components/dashboard/StatusSection';

import type { SalesSnapshot } from '@/components/dashboard/api';
import { liveCampaigns, queueProgress, type QueueProgress } from '@/components/dashboard/overview-model';
import {
  overviewChecks,
  overviewVerdict,
  type VerdictInput,
} from '@/components/dashboard/overview-verdict';
import type {
  BlockerRow,
  CatalogSyncView,
  StatusView,
} from '@/components/dashboard/status-api';

const TODAY = '2026-08-12';

/* ═════════════════════════════ pomocné snímky ═════════════════════════════ */

function sync(patch: Partial<CatalogSyncView> = {}): CatalogSyncView {
  return {
    loadedProducts: 2900,
    shopTotalProducts: 41082,
    complete: false,
    refreshing: false,
    lastReadAt: '2026-08-12T08:40:00.000Z',
    waiting: null,
    nextBatchAt: '2026-08-12T09:15:00.000Z',
    estimatedFinishAt: '2026-08-14T00:00:00.000Z',
    failedLastTime: false,
    ...patch,
  };
}

function status(patch: Partial<StatusView> = {}): StatusView {
  return {
    writes: { enabled: true, locked: false },
    apiKey: { present: true, expiresAt: '2026-08-13T09:00:00.000Z' },
    writeBudget: { budget: 200, spent: 100, remaining: 100, exhausted: false },
    scope: { pilot: true, maxProducts: 10 },
    catalog: { loadedProducts: 2900, shopTotalProducts: 41082 },
    blockers: [],
    blocked: false,
    unreadable: [],
    ...patch,
  };
}

/** Fronta, ktorá pokojne zapisuje. */
function running(): QueueProgress {
  return queueProgress({
    snapshot: {
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
      heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', stale: false },
      gate: { paused: false, since: null },
    },
    campaigns: [],
    today: TODAY,
  });
}

/** V appke ešte nie je ani jedna zľava. */
function firstRun(): QueueProgress {
  return queueProgress({
    snapshot: {
      budget: null,
      queue: { pending: 0, total: 0, done: 0, campaigns: 0 },
      current: null,
      estimate: null,
      heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', stale: false },
      gate: { paused: false, since: null },
    },
    campaigns: [],
    today: TODAY,
  });
}

function input(patch: Partial<VerdictInput> = {}): VerdictInput {
  return {
    status: status(),
    sync: sync(),
    heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', stale: false },
    progress: running(),
    ...patch,
  };
}

function renderStatus(patch: Partial<VerdictInput> = {}): string {
  const view = input(patch);
  return renderToStaticMarkup(
    createElement(StatusSection, {
      verdict: overviewVerdict(view),
      checks: overviewChecks(view),
      progress: view.progress,
      budget: { spent: 100, budget: 200, remaining: 100 },
      calm: { live: 1, ready: 1, discounted: 2380 },
      gap: null,
      onChanged: (): void => {},
    }),
  );
}

function blocker(patch: Partial<BlockerRow> = {}): BlockerRow {
  return {
    id: 'key_missing',
    severity: 'blokuje',
    resolution: 'mimo_appky',
    what: 'Zápisy do shopu sú vypnuté.',
    nextStep: 'Zapnúť ich môže len správca počítača.',
    path: '/nastavenia',
    assumed: false,
    ...patch,
  };
}

/** Tri prekážky, tri úrovne závažnosti, tri spôsoby riešenia — ako na snímke. */
function threeBlockers(): BlockerRow[] {
  return [
    blocker(),
    blocker({
      id: 'scope_pilot_cap',
      severity: 'informuje',
      resolution: 'sudo',
      what: 'V pilotnom režime prejde na jednu zľavu najviac 10 produktov.',
      nextStep: 'Prepnite rozsah na plný v Nastaveniach.',
      assumed: true,
    }),
    blocker({
      id: 'catalog_empty',
      severity: 'obmedzuje',
      resolution: 'sam',
      what: 'Katalóg je prázdny.',
      nextStep: 'Spustite načítanie katalógu v Produktoch.',
      path: '/produkty',
    }),
  ];
}

function renderBlockers(rows: readonly BlockerRow[] = threeBlockers()): string {
  return renderToStaticMarkup(createElement(BlockersSection, { blockers: rows }));
}

function salesWithData(): SalesSnapshot {
  return {
    today: TODAY,
    coverage: {
      syncEnabled: true,
      from: '2026-08-06',
      to: TODAY,
      daysCovered: 7,
      lastSyncedAt: '2026-08-12T03:00:00.000Z',
      hasData: true,
    },
    windowUnits: 65,
    unitsPerDay: null,
    recentUnits: null,
    previousUnits: null,
    days: [
      { day: '2026-08-06', units: 8 },
      { day: '2026-08-07', units: 8 },
      { day: '2026-08-08', units: 8 },
      { day: '2026-08-09', units: 12 },
      { day: '2026-08-10', units: 12 },
      { day: '2026-08-11', units: 14 },
      { day: TODAY, units: 3 },
    ],
  };
}

/** Bez pokrytia: prvé sťahovanie objednávok ešte nedobehlo. */
function salesWithoutData(): SalesSnapshot {
  return {
    ...salesWithData(),
    coverage: {
      syncEnabled: true,
      from: null,
      to: null,
      daysCovered: 0,
      lastSyncedAt: null,
      hasData: false,
    },
    days: [],
  };
}

/** Koľkokrát sa vzorka v texte vyskytne. */
function count(html: string, needle: RegExp): number {
  return html.match(needle)?.length ?? 0;
}

/* ═══════════ D5 — prázdny stav nesmie byť druhou dominantou ═══════════════ */

describe('D5 — na Prehľade je jedna dominanta, aj keď ešte nie je zľava', () => {
  it('prázdny stav nie je vycentrovaná škatuľa s vlastným tlačidlom', () => {
    const html = renderStatus({ progress: firstRun() });

    // `.empty` je 34 px vzduchu, 15 px nadpis a tlačidlo v strede — presne to
    // druhé ohnisko, kvôli ktorému D5 vznikol.
    expect(html).not.toContain('class="empty"');
    expect(html).toContain('data-testid="overview-empty"');
    expect(html).toContain('Zatiaľ nie je žiadna zľava');
  });

  it('dominanta je práve jedna a je ňou verdikt', () => {
    const html = renderStatus({ progress: firstRun() });

    expect(count(html, /class="lvl-1"/g)).toBe(1);
    // 44 px verdiktu. Druhé `.big` (64 px) by dominantu prebilo.
    expect(count(html, /class="big sm"/g)).toBe(1);
    expect(html).not.toContain('prog-lg');
  });

  it('prázdny stav má JEDNU vetu a JEDNO tlačidlo (kontrakt UI, bod 11)', () => {
    const html = renderStatus({ progress: firstRun() });

    expect(count(html, /Nová zľava/g)).toBe(1);
    expect(html).not.toContain('Zoznam zliav');
    expect(html).not.toContain('<ol');
    expect(html).not.toContain('<li>');
  });

  it('tlačidlo stojí v stĺpci akcií vo VŠETKÝCH stavoch, nepreskakuje', () => {
    // Keby prázdny stav kreslil svoje vlastné tlačidlo v strede karty, prvý
    // klik používateľa by po vzniku prvej zľavy skočil o pol obrazovky vedľa.
    for (const progress of [firstRun(), running()]) {
      expect(renderStatus({ progress })).toContain('data-testid="overview-actions"');
    }
  });
});

/* ═════════════ D6 — stav prekážky patrí k svojej značke ═══════════════════ */

describe('D6 — závažnosť prekážky sa dá prejsť očami po stĺpci', () => {
  it('slovo o závažnosti je slovom ZNAČKY, nie začiatkom vety o ďalšom kroku', () => {
    const html = renderBlockers();

    // Značka nesie všetky tri kanály naraz: farbu, glyf (oboje `.sig`) a slovo.
    expect(html).toMatch(
      /<span class="sig \w+" data-testid="blocker-severity">zastavuje zápis<\/span>/,
    );
    expect(html).toMatch(
      /<span class="sig \w+" data-testid="blocker-severity">nezastavuje nič<\/span>/,
    );
    expect(html).toMatch(
      /<span class="sig \w+" data-testid="blocker-severity">spomaľuje zápis<\/span>/,
    );

    // Starý tvar — holé `<b>` na začiatku tlmeného riadku — sa nesmie vrátiť.
    expect(html).not.toContain('<b>zastavuje zápis</b>');
  });

  it('každý riadok má svoju značku a značka je v riadku prvá', () => {
    const html = renderBlockers();
    expect(count(html, /data-testid="blocker-severity"/g)).toBe(3);

    // Prvý riadok: značka pred vetou o tom, čo sa deje.
    expect(html.indexOf('blocker-severity')).toBeLessThan(
      html.indexOf('Zápisy do shopu sú vypnuté.'),
    );
  });

  it('spôsob riešenia sa presunul k ďalšiemu kroku a nikde sa nezdvojuje', () => {
    const html = renderBlockers();

    expect(html).toContain('rieši sa mimo appky');
    expect(html).toContain('rieši sa v appke');

    // Zámok už slovo o riešení povie sám — druhá kópia v tlmenom riadku by
    // bola tá istá veta dvakrát v jednom riadku.
    expect(html).toContain('Vyžiada si heslo');
    expect(count(html, /vyžiada si heslo/g)).toBe(0);
  });

  it('priznaná domnienka a cesta ďalej zostali v riadku', () => {
    const html = renderBlockers();
    expect(html).toContain('Appka to teraz nevie overiť.');
    expect(html).toContain('Spustite načítanie katalógu v Produktoch.');
    expect(html).toContain('Produkty');
  });
});

/* ═══════════ D7 — jedna veta nedostane celú kartu ═════════════════════════ */

describe('D7 — „Predaj" je sekciou len vtedy, keď má čo ukázať', () => {
  it('bez pokrytia je to jeden riadok, nie sekcia s nadpisom', () => {
    const html = renderToStaticMarkup(
      createElement(SalesSection, { sales: salesWithoutData() }),
    );

    expect(html).not.toContain('<section');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('class="empty"');
    expect(html).toContain('Prvé sťahovanie objednávok ešte nedobehlo.');
    expect(html).toContain('Otvoriť Nastavenia');
    // Jedna veta, jedno tlačidlo — nič viac sa do riadku nezmestí ani nesmie.
    expect(count(html, /<a /g)).toBe(1);
  });

  it('vypnuté sťahovanie je iná veta než nedobehnuté prvé (P7)', () => {
    const snapshot = salesWithoutData();
    const html = renderToStaticMarkup(
      createElement(SalesSection, {
        sales: { ...snapshot, coverage: { ...snapshot.coverage, syncEnabled: false } },
      }),
    );
    expect(html).toContain('Sťahovanie objednávok je vypnuté v Nastaveniach.');
  });

  it('s dátami sa „Predaj" sekciou znova stane', () => {
    const html = renderToStaticMarkup(createElement(SalesSection, { sales: salesWithData() }));
    expect(html).toContain('<section');
    expect(html).toContain('<h2>Predaj</h2>');
    expect(html).toContain('<svg');
    // Appka pozná kusy, nie eurá — sekcia to nesmie začať tvrdiť.
    expect(html).not.toContain('€');
  });
});

/* ═══════════ P5 a P1 na celej obrazovke naraz ═════════════════════════════ */

describe('Prehľad ako celok — najviac štyri sekcie a jedna dominanta', () => {
  /** Najhustší možný stav: prekážky, zľavy aj predaj majú čo ukázať. */
  function wholeScreen(sales: SalesSnapshot): string {
    return [
      renderStatus(),
      renderBlockers(),
      renderToStaticMarkup(
        createElement(CampaignsSection, {
          campaigns: liveCampaigns([], TODAY),
          insights: [],
        }),
      ),
      renderToStaticMarkup(createElement(SalesSection, { sales })),
    ].join('\n');
  }

  it('sekcií sú najviac štyri, aj keď má obrazovka čo povedať (P5)', () => {
    expect(count(wholeScreen(salesWithData()), /<section/g)).toBeLessThanOrEqual(4);
  });

  it('bez pokrytia predaja klesnú sekcie na tri — riadok nie je sekcia', () => {
    expect(count(wholeScreen(salesWithoutData()), /<section/g)).toBe(3);
  });

  it('na celej obrazovke je presne jedna dominanta (P1)', () => {
    for (const sales of [salesWithData(), salesWithoutData()]) {
      expect(count(wholeScreen(sales), /class="lvl-1"/g)).toBe(1);
    }
  });
});
