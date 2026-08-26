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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BlockersSection from '@/components/dashboard/BlockersSection';
import CampaignsSection from '@/components/dashboard/CampaignsSection';
import SalesSection from '@/components/dashboard/SalesSection';
import StatusSection from '@/components/dashboard/StatusSection';

import type { SalesSnapshot } from '@/components/dashboard/api';
import {
  liveCampaigns,
  queueProgress,
  type CalmNumbers,
  type QueueProgress,
} from '@/components/dashboard/overview-model';
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
    ipBanned: false,
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

  /*
   * Od 20. 8. 2026 (šprint 20, vlna 3) je dominantou Prehľadu ČÍSLO, nie veta
   * verdiktu. Prázdny stav preto dominantu NEMÁ: appka nemá ani jedno číslo,
   * ktoré by do 44 px slotu patrilo, a nula ani pomlčka tam stáť nesmú
   * (kontrakt UI bod 5, D11). Tvrdenie sa tým nezmäkčilo — nula dominánt je
   * prísnejšia hranica než jedna, a že v OSTATNÝCH stavoch dominanta naozaj
   * je, meria blok „Prehľad vedie číslami" nižšie.
   */
  it('prázdny stav nemá dominantu — nie je z čoho ju spraviť', () => {
    const html = renderStatus({ progress: firstRun() });

    expect(count(html, /class="lvl-1"/g)).toBe(0);
    expect(count(html, /class="big sm"/g)).toBe(0);
    expect(html).not.toContain('prog-lg');
    // A už vôbec nie pomlčka či nula v displejovom reze (D11).
    expect(html).not.toMatch(/class="big[^"]*"[^>]*>\s*[—0]/);
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

    // Značka nesie všetky tri kanály naraz: farbu (trieda `.sig …`), ZNAČKU a
    // slovo — a všetky tri v JEDNOM uzle, aby sa nemohli rozísť.
    //
    // Od 19. 8. 2026 je značka `<svg class="ovl-ic">`, nie znak v `::before`:
    // rodina `.sig` prestala kresliť glyfy cez CSS a začala ich kresliť
    // komponentom (`ui/StatusMark.tsx`), čím zanikla aj CSS maska zámoku, teda
    // druhá kópia cesty ikony v repe. Vzor to preto berie ako povinné —
    // `[^<]*` by prešlo aj vtedy, keby značka vypadla a zostala len farba.
    for (const slovo of ['zastavuje zápis', 'nezastavuje nič', 'spomaľuje zápis']) {
      expect(html, slovo).toMatch(
        new RegExp(
          `<span class="sig \\w+" data-testid="blocker-severity"><svg[^>]*class="ovl-ic"[^>]*>.*?</svg>${slovo}</span>`,
        ),
      );
    }

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

/* ═════════ C4 — Prehľad vedie ČÍSLAMI, nie vetou (šprint 20, vlna 3) ══════ */

/**
 * Do 20. 8. 2026 stála v 44 px slote VETA („Zápis stojí", „Všetko v poriadku").
 * Bola to tretia kópia tej istej odpovede — nesie ju aj značka pri vete, aj
 * celá sekcia prekážok pod ňou — a údaje, kvôli ktorým sa človek na prístrojovú
 * dosku pozerá, boli pod ňou v 12,5 px riadku.
 *
 * Tento blok meria opak, a to na VYKRESLENOM markupe aj na SKUTOČNOM CSS:
 * v displejovom slote je číslo, veta zostáva na obrazovke o dva stupne nižšie
 * a každé číslo, ktoré appka nepozná, je pomlčka — nikdy nula.
 */
describe('Prehľad vedie číslami — dominantou je údaj, nie veta', () => {
  const GLOBALS = readFileSync(
    fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
    'utf8',
  );

  const noop = (): void => {};

  /** Veľkosť písma prvého pravidla daného selektora, v px. */
  function fontSizeOf(selector: string): number {
    const at = GLOBALS.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    const block = GLOBALS.slice(at, GLOBALS.indexOf('}', at));
    const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(block);
    expect(size, selector).not.toBeNull();
    return Number(size![1]);
  }

  /**
   * Obsah každého displejového slotu (`.big`) vo vykreslenom markupe — presne
   * ten istý meter, aký používa `dominanta-pomlcka.spec.ts` (D11).
   */
  function displaySlots(html: string): string[] {
    const found: string[] = [];
    const pattern = /<(\w+)[^>]*class="[^"]*\bbig\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
    for (const hit of html.matchAll(pattern)) found.push(hit[2]!);
    return found;
  }

  /** Hodnoty všetkých dlaždíc pásma čísel. */
  function figureValues(html: string): string[] {
    return [...html.matchAll(/<div class="v"[^>]*>([\s\S]*?)<\/div>/g)].map((hit) => hit[1]!);
  }

  /** Render s voľným `calm` aj `budget` — tie starý helper fixuje napevno. */
  function renderWith(
    patch: Partial<VerdictInput> = {},
    opts: {
      calm?: CalmNumbers | null;
      budget?: { spent: number; budget: number; remaining: number } | null;
    } = {},
  ): string {
    const view = input(patch);
    return renderToStaticMarkup(
      createElement(StatusSection, {
        verdict: overviewVerdict(view),
        checks: overviewChecks(view),
        progress: view.progress,
        budget:
          opts.budget === undefined ? { spent: 100, budget: 200, remaining: 100 } : opts.budget,
        calm: opts.calm === undefined ? { live: 1, ready: 1, discounted: 2380 } : opts.calm,
        gap: null,
        onChanged: noop,
      }),
    );
  }

  /** Fronta nemá čo zapisovať — pokojný stav. */
  function calmQueue(): QueueProgress {
    return {
      ...running(),
      mode: 'calm',
      pending: 0,
      campaignId: null,
      campaignName: null,
      sentence: null,
    };
  }

  it('v displejovom slote stojí číslo fronty, nie veta verdiktu', () => {
    const html = renderWith();
    const slots = displaySlots(html);

    expect(slots).toHaveLength(1);
    expect(slots[0]).toContain('3 420');
    expect(slots[0]).toContain('8 000');

    // Veta z obrazovky nezmizla — len prestala byť najväčšou vecou na nej.
    expect(html).toContain('Všetko v poriadku');
    expect(slots[0]).not.toContain('Všetko v poriadku');
  });

  it('„Zápis stojí" je vidieť, ale nie je najväčším prvkom karty', () => {
    const html = renderWith({
      status: status({ blockers: [blocker(), blocker({ id: 'catalog_empty' })] }),
    });

    expect(html).toContain('Zápis stojí');
    const slots = displaySlots(html);
    expect(slots).toHaveLength(1);
    expect(slots[0]).not.toContain('Zápis stojí');
  });

  it('stavová veta nesie farbu, ZNAČKU aj slovo v jednom uzle', () => {
    expect(renderWith()).toMatch(
      /<span class="sig ok" data-testid="verdict-headline"><svg[^>]*class="[^"]*ovl-ic[\s\S]*?<\/svg>Všetko v poriadku<\/span>/,
    );
  });

  it('hierarchia je zmeraná v CSS: 44 px číslo, 18 px dlaždica, 14 px veta', () => {
    const dominant = fontSizeOf('.lvl-1 .big.sm');
    const tile = fontSizeOf('.kpi.dense .v');
    const sentence = fontSizeOf('.ovl-verdict > .sig');

    expect(sentence).toBeLessThan(tile);
    expect(tile).toBeLessThan(dominant);
    // P1: druhá najväčšia vec smie mať najviac 55 % dominanty.
    expect(tile / dominant).toBeLessThanOrEqual(0.55);
    // Menovateľ zlomku je časťou dominanty, nie druhým ohniskom.
    expect(fontSizeOf('.lvl-1 .big.sm .of')).toBeLessThan(dominant);
  });

  it('pokojný stav vedie počtom zlacnených, nie zlomkom fronty', () => {
    const html = renderWith({ progress: calmQueue() });

    expect(displaySlots(html)[0]).toContain('2 380');
    expect(html).not.toContain('/ 8 000');
  });

  it('nečitateľný zoznam zliav dá pomlčky, NIKDY nuly', () => {
    const html = renderWith({ progress: calmQueue() }, { calm: null });

    // Dominanta sa v tomto stave nekreslí — pomlčka v 44 px reze je obdĺžnik.
    expect(displaySlots(html)).toEqual([]);
    expect(html).toContain('— zoznam zliav nevieme');

    const values = figureValues(html);
    expect(values.filter((value) => value.includes('—'))).toHaveLength(2);
    expect(values.some((value) => value.trim() === '0')).toBe(false);
    expect(html).toContain('data-unknown="ano"');
  });

  it('chýbajúci rozpočet, odhad ani okno sa nedopočítavajú nulou', () => {
    const html = renderWith(
      { progress: { ...running(), finishDay: null, dateFrom: null, dateTo: null } },
      { budget: null },
    );

    const values = figureValues(html);
    expect(values).toHaveLength(4);
    expect(values.filter((value) => value.includes('—'))).toHaveLength(3);
    expect(values.some((value) => value.trim() === '0')).toBe(false);
    // Bez odhadu nesmie zostať visieť ani značka odhadu.
    expect(html).not.toContain('class="est"');
  });

  it('odhad dokončenia je označený ako odhad (P7)', () => {
    expect(renderWith()).toContain('class="est"');
  });

  it('pásmo čísel neopakuje počty katalógu zo stavového pruhu', () => {
    const html = renderWith();
    expect(html).not.toContain('41 082');
    expect(html).not.toContain('2 900');
  });
});
