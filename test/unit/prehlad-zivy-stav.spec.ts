/**
 * Aura Zľavy — PREHĽAD: verdikt a „prečo sa nič nedeje" (V9).
 *
 * Kontrakt UI (13. 8. 2026) žiada, aby Prehľad odpovedal na JEDNU otázku —
 * „je všetko v poriadku?" — do troch sekúnd, a aby nikdy netvrdil nič, čo
 * nevie. Sú to tvrdenia o produkčnom eshope, takže sa musia dať overiť bez
 * klikania.
 *
 * Testuje sa preto to, čo o obrazovke rozhoduje:
 *
 *   A. čítanie `/api/status` a `/api/catalog/sync` — čo sa nedá prečítať, je
 *      `null` alebo fail-closed, nikdy upokojujúca nula,
 *   B. riadok kontrol — nesie len to, čo stavový pruh NEHOVORÍ,
 *   C. VERDIKT — „Všetko v poriadku" padne len vtedy, keď sa naozaj všetko
 *      prečítalo a nič nezastavuje ani nebrzdí,
 *   D. prekážky — farbu volí SPÔSOB RIEŠENIA, nie závažnosť; kreslia sa všetky
 *      tri úrovne, ale sekcia sa otvorí len keď niečo naozaj stojí v ceste,
 *   E. zhoda zoznamov kódov s ich originálmi (kontrola typom, nie vierou),
 *   F. obrazovka sa naozaj vykreslí a hovorí to, čo model rozhodol.
 *
 * Vlastník: V9.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BlockersSection from '@/components/dashboard/BlockersSection';
import StatusSection from '@/components/dashboard/StatusSection';

import {
  parseCatalogSync,
  parseStatus,
  type BlockerRow,
  type CatalogSyncView,
  type CatalogWaitingCode,
  type StatusSectionCode,
  type StatusView,
} from '@/components/dashboard/status-api';
import {
  RESOLUTION_LOOK,
  hasObstacles,
  heartbeatSummary,
  resolutionLook,
  screenBlockers,
  shopPill,
  unreadableSentence,
} from '@/components/dashboard/live-status-model';
import {
  catalogCheck,
  overviewChecks,
  overviewVerdict,
  queueCheck,
  scopeCheck,
  shopCheck,
  type VerdictInput,
} from '@/components/dashboard/overview-verdict';
import { queueProgress, type QueueProgress } from '@/components/dashboard/overview-model';

import type { CatalogWaitingReason } from '@/lib/repo/catalog.repo';
import type { BlockerResolution, BlockerSeverity } from '@/lib/status/blockers';
import type { StatusSection as StatusSectionName } from '@/lib/status/snapshot';

const TODAY = '2026-08-12';

/* ═════════════════════════════ pomocné snímky ═════════════════════════════ */

function blocker(patch: Partial<BlockerRow> = {}): BlockerRow {
  return {
    id: 'key_missing',
    severity: 'blokuje',
    resolution: 'sam',
    what: 'Kľúč na zápis do shopu nie je vložený.',
    nextStep: 'Vložte kľúč v Nastaveniach.',
    path: '/nastavenia',
    assumed: false,
    ...patch,
  };
}

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

/** Fronta, ktorá pokojne zapisuje. Základ, ktorý si testy ohýbajú po svojom. */
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

/** Fronta, ktorá stojí po odstávke počítača. */
function paused(): QueueProgress {
  return { ...running(), mode: 'paused', pausedSince: '2026-08-11T21:04:00.000Z' };
}

/** Appka na otázku o fronte neodpovedala. */
function unknownQueue(): QueueProgress {
  return queueProgress({ snapshot: null, campaigns: null, today: TODAY });
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

/** Vstup verdiktu s pokojnými faktami; test si prepíše len to, čo skúša. */
function input(patch: Partial<VerdictInput> = {}): VerdictInput {
  return {
    status: status(),
    sync: sync(),
    heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', stale: false },
    progress: running(),
    ...patch,
  };
}

/* ══════════════ A. Čítanie stavu nikdy nedopĺňa upokojujúce čísla ═════════ */

describe('Prehľad — čítanie živého stavu', () => {
  it('nezmyselná odpoveď stavu skončí ako `null`', () => {
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus('toto nie je objekt')).toBeNull();
    expect(parseStatus([])).toBeNull();
  });

  it('prázdna odpoveď neznamená „všetko v poriadku", ale samé „nevieme"', () => {
    const parsed = parseStatus({});
    expect(parsed).not.toBeNull();
    expect(parsed?.writes.enabled).toBeNull();
    expect(parsed?.apiKey.present).toBeNull();
    expect(parsed?.writeBudget).toBeNull();
    expect(parsed?.scope.pilot).toBeNull();
    expect(parsed?.catalog).toBeNull();
  });

  /** Fail-closed: prekážka, ktorej závažnosť nepoznáme, sa nesmie stratiť. */
  it('prekážka s neznámou závažnosťou zostane a berie sa ako zastavujúca', () => {
    const parsed = parseStatus({
      blockers: [
        { id: 'a', severity: 'nieco_nove', resolution: 'nieco_nove', what: 'Veta.', nextStep: 'Krok.' },
        { id: 'b', what: 'Bez ďalšieho kroku.' },
      ],
    });
    expect(parsed?.blockers).toHaveLength(1);
    expect(parsed?.blockers[0]?.severity).toBe('blokuje');
    expect(parsed?.blockers[0]?.resolution).toBeNull();
    expect(parsed?.blocked).toBe(true);
  });

  it('rozpočet bez stropu sa nedopočítava — zostáva `null`', () => {
    expect(parseStatus({ writeBudget: { budget: 0, spent: 0 } })?.writeBudget).toBeNull();
    const ok = parseStatus({ writeBudget: { budget: 200, spent: 200 } })?.writeBudget;
    expect(ok?.remaining).toBe(0);
    expect(ok?.exhausted).toBe(true);
  });

  it('režim rozsahu je fail-closed pilotný, kým sa vedome neprečíta plný', () => {
    expect(parseStatus({ scope: { mode: 'plny', maxProducts: 150 } })?.scope.pilot).toBe(false);
    expect(parseStatus({ scope: { mode: 'pilot', maxProducts: 10 } })?.scope.pilot).toBe(true);
    // Prečítané „plny", ale hodnoty sú fail-closed default → neveríme im.
    expect(parseStatus({ scope: { mode: 'plny', failClosed: true } })?.scope.pilot).toBeNull();
  });

  it('neznámy názov nečitateľnej sekcie sa zahodí, nikdy nevykreslí', () => {
    const parsed = parseStatus({ unreadable: ['apiKey', 'nieco_nove', 42] });
    expect(parsed?.unreadable).toEqual(['apiKey']);
  });

  it('kód chyby katalógu sa na povrch nedostane, len príznak, že chyba bola', () => {
    const parsed = parseCatalogSync({ catalog: { loadedProducts: 10, lastError: 'shop_5xx' } });
    expect(parsed?.failedLastTime).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain('shop_5xx');
  });

  it('neznámy dôvod čakania katalógu je `null`, nie surový kód', () => {
    expect(parseCatalogSync({ catalog: { waiting: 'nieco_nove' } })?.waiting).toBeNull();
    expect(parseCatalogSync({ catalog: { waiting: 'daily_budget' } })?.waiting).toBe('daily_budget');
    expect(parseCatalogSync({})).toBeNull();
  });
});

/* ═════════════════ B. Riadok kontrol nesie len to, čo pruh nehovorí ═══════ */

describe('Prehľad — kontroly pri dominante', () => {
  it('sú štyri a v pevnom poradí: fronta, shop, katalóg, rozsah', () => {
    expect(overviewChecks(input()).map((check) => check.id)).toEqual([
      'fronta',
      'shop',
      'katalog',
      'rozsah',
    ]);
  });

  /**
   * Stavový pruh (chróm) nesie ostrý zápis, kľúč, rozpočet zápisov a počty
   * katalógu. Keby ich niesli aj kontroly, tie dve kópie sa raz rozídu a nedá
   * sa povedať, ktorá klame. Test stráži presne to.
   */
  it('neopakujú stavový pruh — žiadny kľúč, žiadny rozpočet, žiadne počty', () => {
    const text = overviewChecks(input())
      .map((check) => check.text)
      .join(' | ');
    expect(text).not.toContain('Kľúč');
    expect(text).not.toContain('Zápisy');
    expect(text).not.toContain('2 900');
    expect(text).not.toContain('41 082');
  });

  it('chýbajúci krok fronty znamená „nekontroluje", nie pokoj', () => {
    expect(heartbeatSummary(null).tone).toBe('warn');
    expect(queueCheck(null).tone).toBe('warn');
    expect(queueCheck(null).text).toBe('Fronta sa nekontroluje');
    expect(queueCheck({ lastTickAt: '2026-08-12T08:59:00.000Z', stale: false }).tone).toBe('ok');
  });

  it('spojenie so shopom stojí na poslednom úspešnom čítaní, nie na domnienke', () => {
    expect(shopPill(null).tone).toBe('idle');
    expect(shopCheck(null).tone).toBe('idle');
    expect(shopCheck(sync({ lastReadAt: null })).tone).toBe('idle');
    expect(shopCheck(sync()).tone).toBe('ok');
    expect(shopCheck(sync({ failedLastTime: true })).tone).toBe('warn');
    expect(shopCheck(sync({ waiting: 'error' })).tone).toBe('warn');
  });

  it('katalóg hovorí, čo robí — nie koľko ho je (to je v pruhu)', () => {
    expect(catalogCheck(sync(), null).text).toBe('Katalóg sa dočítava');
    expect(catalogCheck(sync({ waiting: 'daily_budget' }), null).text).toContain('rozpočet');
    expect(catalogCheck(sync({ waiting: 'rate_limited' }), null).text).toContain('prestávku');
    expect(catalogCheck(sync({ waiting: 'error' }), null).tone).toBe('warn');
    expect(catalogCheck(null, null).text).toBe('Stav katalógu nevieme');

    const done = catalogCheck(sync({ complete: true, loadedProducts: 41082 }), null);
    expect(done.tone).toBe('ok');
    expect(done.text).toBe('Katalóg načítaný celý');
  });

  it('prázdny katalóg NIE JE načítaný celý — nula nie je hotovo', () => {
    // Nájdené na snímke z prehliadača 12. 8.: hore svietilo „Katalóg prázdny"
    // a o kúsok nižšie „✓ načítaný celý". Príčinou bolo holé `loaded >= total`,
    // kde 0 >= 0 vyjde ako pravda.
    const prazdny = catalogCheck(
      sync({ loadedProducts: 0, shopTotalProducts: 0, complete: false }),
      null,
    );
    expect(prazdny.text).toBe('Katalóg prázdny');
    expect(prazdny.tone).not.toBe('ok');

    // Ani meraný príznak z `catalog_sync_state` neplatí nad prázdnou tabuľkou.
    expect(
      catalogCheck(sync({ loadedProducts: 0, shopTotalProducts: 41_082, complete: true }), null)
        .text,
    ).toBe('Katalóg prázdny');
  });

  /**
   * Po KAŽDOM dokončenom prechode beží nový a ten začína od stránky 0. Kým to
   * kontrola nepovedala, javilo sa čítanie shopu pri „hotovom" katalógu ako
   * záhada.
   */
  it('obnova nad celým katalógom je vidieť, a nie je to odhad', () => {
    const obnova = catalogCheck(
      sync({ loadedProducts: 41_082, complete: false, refreshing: true }),
      null,
    );
    expect(obnova.tone).toBe('ok');
    expect(obnova.text).toContain('načítaný celý');
    expect(obnova.text).toContain('obnovuje');
    expect(obnova.text).not.toContain('≈');
  });

  it('rozsah nesie číslo stropu a pilotný má zámok s cestou k odomknutiu', () => {
    const pilot = scopeCheck({ pilot: true, maxProducts: 10 });
    expect(pilot.tone).toBe('lock');
    expect(pilot.text).toContain('10 produktov');
    expect(pilot.path).toBe('/nastavenia');

    const full = scopeCheck({ pilot: false, maxProducts: 150 });
    expect(full.tone).toBe('ok');
    expect(full.text).toContain('150 produktov');

    expect(scopeCheck({ pilot: null, maxProducts: null }).tone).toBe('idle');
  });
});

/* ═════════════════ C. Verdikt — najsilnejšie tvrdenie appky ═══════════════ */

describe('Prehľad — verdikt', () => {
  it('„Všetko v poriadku" padne, len keď naozaj nič nestojí v ceste', () => {
    const verdict = overviewVerdict(input());
    expect(verdict.kind).toBe('ok');
    expect(verdict.headline).toBe('Všetko v poriadku');
    expect(verdict.tone).toBe('ok');
  });

  it('bez odpovede stavu sa netvrdí nič — a už vôbec nie, že je dobre', () => {
    const verdict = overviewVerdict(input({ status: null }));
    expect(verdict.kind).toBe('unknown');
    expect(verdict.headline).not.toContain('poriadku');
  });

  /** Nedočítaný stav sa nesmie vydávať za dobrú správu (P7). */
  it('nečitateľná sekcia stavu zhodí „v poriadku" na „nevieme"', () => {
    const verdict = overviewVerdict(input({ status: status({ unreadable: ['writeBudget'] }) }));
    expect(verdict.kind).toBe('unknown');
    expect(verdict.headline).toBe('Časť stavu nevieme');
  });

  it('zastavujúca prekážka zastaví verdikt a povie ich počet, nie dôvod', () => {
    const verdict = overviewVerdict(
      input({ status: status({ blockers: [blocker(), blocker({ id: 'writes_disabled' })] }) }),
    );
    expect(verdict.kind).toBe('stopped');
    expect(verdict.headline).toBe('Zápis stojí');
    expect(verdict.tone).toBe('warn');
    expect(verdict.detail).toBe('2 prekážky zastavujú zápis.');
    // Dôvod je veta zo servera a patrí do sekcie prekážok, nie do verdiktu.
    expect(verdict.detail).not.toContain('Kľúč');
  });

  /**
   * Bod 7 kontraktu: farbu volí SPÔSOB RIEŠENIA, nie závažnosť. Vyčerpaný
   * denný rozpočet zastavuje všetko, a predsa je to pokojný stav (K2).
   */
  it('keď sa na zastavenie len čaká, verdikt je pokojný a sivý', () => {
    const verdict = overviewVerdict(
      input({
        status: status({
          blockers: [blocker({ id: 'write_budget_exhausted', resolution: 'cakanie' })],
        }),
      }),
    );
    expect(verdict.kind).toBe('stopped');
    expect(verdict.headline).toBe('Zápis čaká');
    expect(verdict.tone).toBe('idle');
    expect(verdict.tone).not.toBe('bad');
  });

  it('runaway zámok je jediný červený verdikt Prehľadu', () => {
    const verdict = overviewVerdict(
      input({ status: status({ writes: { enabled: true, locked: true } }) }),
    );
    expect(verdict.tone).toBe('bad');
    expect(verdict.headline).toContain('poistka');
  });

  it('brzdiaca prekážka nezastavuje, ale verdikt sa ňou nedá prehlušiť', () => {
    const verdict = overviewVerdict(
      input({
        status: status({ blockers: [blocker({ severity: 'obmedzuje', resolution: 'sam' })] }),
      }),
    );
    expect(verdict.kind).toBe('slowed');
    expect(verdict.headline).toBe('Zapisuje sa pomalšie');
    expect(verdict.detail).toBe('1 prekážka spomaľuje zápis.');
  });

  /**
   * Mŕtvy scheduler je fakt z databázy a Prehľad ho nesmie prehliadnuť ani
   * vtedy, keď zoznam prekážok mlčí — prekážky o fronte nevedia nič.
   */
  it('stojaca fronta zhodí verdikt aj bez jedinej prekážky', () => {
    const verdict = overviewVerdict(input({ progress: paused() }));
    expect(verdict.kind).toBe('stopped');
    expect(verdict.headline).toBe('Fronta stojí');
    expect(verdict.detail).toContain('11.08.2026');
  });

  it('nečitateľná fronta je „nevieme", nikdy nula', () => {
    const verdict = overviewVerdict(input({ progress: unknownQueue() }));
    expect(verdict.kind).toBe('unknown');
    expect(verdict.headline).toBe('Stav fronty nevieme');
  });
});

/* ═════════════════ D. Prekážky — farbu volí spôsob riešenia ═══════════════ */

describe('Prehľad — prečo sa nič nedeje', () => {
  /**
   * Pravidlo z doc-bloku `lib/status/blockers.ts`: vyčerpaný denný rozpočet
   * ZASTAVUJE všetko, a napriek tomu nie je chyba — len sa čaká (K2).
   */
  it('vyčerpaný rozpočet zastavuje, a predsa je pokojný', () => {
    const look = resolutionLook('cakanie');
    expect(look.tone).toBe('idle');
    expect(look.tone).not.toBe('bad');
    expect(RESOLUTION_LOOK.sam.tone).toBe('warn');
    expect(RESOLUTION_LOOK.sudo.tone).toBe('lock');
    expect(RESOLUTION_LOOK.mimo_appky.tone).toBe('warn');
  });

  it('prekážka bez známeho spôsobu riešenia si nič nedomýšľa', () => {
    expect(resolutionLook(null).tone).toBe('warn');
    expect(resolutionLook(null).word.length).toBeGreaterThan(0);
  });

  /**
   * Bod 6 kontraktu UI: keď sa sekcia kreslí, sú v nej VŠETKY tri úrovne.
   * Do 18. 8. sa `informuje` zahadzovalo, lebo malo vlastnú sekciu „Živý
   * stav"; tá zanikla a s ňou aj dôvod filtrovať.
   */
  it('zo zoznamu nevypadne ani jedna úroveň a poradie zo servera drží', () => {
    const rows = [
      blocker({ id: 'writes_disabled', severity: 'blokuje' }),
      blocker({ id: 'catalog_incomplete', severity: 'obmedzuje' }),
      blocker({ id: 'scope_pilot_cap', severity: 'informuje' }),
    ];
    expect(screenBlockers(rows).map((row) => row.id)).toEqual([
      'writes_disabled',
      'catalog_incomplete',
      'scope_pilot_cap',
    ]);
  });

  /**
   * Bod 3 kontraktu UI: keď zápisu nič nebráni, sekcia sa NEKRESLÍ VÔBEC.
   * Samotné `informuje` (platný pilotný strop) nie je dôvod, prečo sa niečo
   * nedeje — to je trvalé pravidlo a jeho miesto je v riadku kontrol.
   */
  it('sekciu otvorí len to, čo naozaj zastavuje alebo brzdí', () => {
    expect(hasObstacles([])).toBe(false);
    expect(hasObstacles([blocker({ severity: 'informuje' })])).toBe(false);
    expect(hasObstacles([blocker({ severity: 'obmedzuje' })])).toBe(true);
    expect(hasObstacles([blocker({ severity: 'blokuje' })])).toBe(true);
  });
});

/* ═════════════════ E. Zoznamy kódov sa nesmú rozísť s originálom ══════════ */

describe('Prehľad — kódy sedia s originálmi (kontroluje typ, nie viera)', () => {
  /**
   * Tieto štyri mapy nič nemerajú za behu — ich zmysel je, že sa NESKOMPILUJÚ,
   * keď v pôvodnom module pribudne alebo zmizne kód. Bez nich by sa neznámy
   * kód prejavil tichým `null` na obrazovke a nikto by sa to nedozvedel.
   */
  it('závažnosť, spôsob riešenia, sekcie stavu aj dôvody čakania sedia', () => {
    const severity: Record<BlockerSeverity, string> = {
      blokuje: 'blokuje',
      obmedzuje: 'obmedzuje',
      informuje: 'informuje',
    };
    const resolution: Record<BlockerResolution, keyof typeof RESOLUTION_LOOK> = {
      sam: 'sam',
      sudo: 'sudo',
      cakanie: 'cakanie',
      mimo_appky: 'mimo_appky',
    };
    const sections: Record<StatusSectionName, StatusSectionCode> = {
      writes: 'writes',
      apiKey: 'apiKey',
      writeBudget: 'writeBudget',
      scope: 'scope',
      catalog: 'catalog',
      catalogReads: 'catalogReads',
    };
    const waiting: Record<CatalogWaitingReason, CatalogWaitingCode> = {
      rate_limited: 'rate_limited',
      daily_budget: 'daily_budget',
      error: 'error',
      catalog_complete: 'catalog_complete',
    };

    expect(Object.keys(severity)).toHaveLength(3);
    expect(Object.keys(resolution)).toHaveLength(4);
    expect(Object.keys(sections)).toHaveLength(6);
    expect(Object.keys(waiting)).toHaveLength(4);
  });
});

/* ══════════════════ F. Obrazovka sa naozaj vykreslí ══════════════════════ */

describe('Prehľad — dominanta a prekážky sa vykreslia', () => {
  const CALM = { live: 1, ready: 1, discounted: 2380 };
  const BUDGET = { spent: 100, budget: 200, remaining: 100 };
  const noop = (): void => {};

  function renderStatus(patch: Partial<VerdictInput> = {}, gap: string | null = null): string {
    const view = input(patch);
    return renderToStaticMarkup(
      createElement(StatusSection, {
        verdict: overviewVerdict(view),
        checks: overviewChecks(view),
        progress: view.progress,
        budget: BUDGET,
        calm: CALM,
        gap,
        onChanged: noop,
      }),
    );
  }

  /**
   * Najdôležitejšie tvrdenie tohto súboru. Dominantou Prehľadu je VETA, ktorá
   * je odpoveďou na „je všetko v poriadku?" — nie číslo fronty, z ktorého sa
   * odpoveď musí odvodiť. Číslo zostáva, ale na polovičnej veľkosti (P1).
   */
  it('dominantou je veta, nie číslo fronty', () => {
    const html = renderStatus();
    expect(html).toContain('Všetko v poriadku');
    expect(html).toContain('class="big sm"');
    expect(html).toContain('3 420');
    expect(html).toContain('/ 8 000');
    // Staré 64 px číslo fronty sa nesmie vrátiť — zhodilo by P1.
    expect(html).not.toContain('prog-lg');
    expect(html).not.toContain('<table');
  });

  it('riadok kontrol je na obrazovke vždy, aj keď je všetko v poriadku', () => {
    const html = renderStatus();
    expect(html).toContain('data-testid="overview-checks"');
    expect(html).toContain('Fronta sa kontroluje');
    expect(html).toContain('Spojené so shopom');
    expect(html).toContain('Katalóg sa dočítava');
    expect(html).toContain('Rozsah pilotný');
  });

  it('odhad dokončenia je označený ako odhad (P7)', () => {
    // Trieda `est` kreslí pred číslo `≈` a stlmí ho.
    expect(renderStatus()).toContain('class="est"');
  });

  it('bez odpovede appky je pomlčka a dôvod pod rozklikom, nikdy nula', () => {
    const html = renderStatus({
      status: null,
      sync: null,
      heartbeat: null,
      progress: unknownQueue(),
    });
    expect(html).toContain('Stav appky nevieme');
    expect(html).toContain('—');
    expect(html).toContain('Prečo —');
    expect(html).not.toContain('0 / 0');
  });

  it('zastavená fronta ponúkne „Pokračovať" a pruh je tlmený', () => {
    const html = renderStatus({ progress: paused() });
    expect(html).toContain('Pokračovať');
    expect(html).toContain('bar paused');
    expect(html).not.toContain('Zastaviť frontu');
  });

  it('pokojný stav nekreslí pruh na nule, len čísla, ktoré appka má', () => {
    const html = renderStatus({
      progress: { ...running(), mode: 'calm', campaignId: null, campaignName: null },
    });
    expect(html).toContain('2 380');
    expect(html).toContain('Zoznam zliav');
    expect(html).not.toContain('/ 8 000');
  });

  it('prázdny stav je JEDNA VETA a JEDNO tlačidlo, žiadne očíslované kroky', () => {
    const html = renderStatus({ progress: firstRun() });
    expect(html).toContain('Zatiaľ nie je žiadna zľava');
    expect(html.match(/Nová zľava/g)).toHaveLength(1);
    expect(html).not.toContain('<li>');
    expect(html).not.toContain('<ol');
  });

  it('priznaná medzera sa kreslí ako vysvetlivka, nie ako číslo', () => {
    const html = renderStatus({}, unreadableSentence(['writeBudget']));
    expect(html).toContain('rozpočet zápisov');
    expect(html).not.toContain('0/200');
  });

  it('prekážky sa nekreslia, keď nič nezastavuje ani nebrzdí', () => {
    expect(renderToStaticMarkup(createElement(BlockersSection, { blockers: [] }))).toBe('');
    expect(renderToStaticMarkup(createElement(BlockersSection, { blockers: null }))).toBe('');
    expect(
      renderToStaticMarkup(
        createElement(BlockersSection, { blockers: [blocker({ severity: 'informuje' })] }),
      ),
    ).toBe('');
  });

  it('každá prekážka ukáže čo sa deje, ako je to vážne, čo s tým a kam ísť', () => {
    const html = renderToStaticMarkup(
      createElement(BlockersSection, {
        blockers: [
          blocker(),
          blocker({
            id: 'write_budget_exhausted',
            severity: 'blokuje',
            resolution: 'cakanie',
            what: 'Dnešný rozpočet zápisov je vyčerpaný.',
            nextStep: 'Netreba robiť nič — pokračuje to samo.',
            path: null,
            assumed: true,
          }),
          blocker({
            id: 'scope_pilot_cap',
            severity: 'informuje',
            resolution: 'sudo',
            what: 'V pilotnom režime prejde 10 produktov.',
            nextStep: 'Prepnite rozsah v Nastaveniach.',
          }),
        ],
      }),
    );

    expect(html).toContain('Prečo sa nezapisuje');
    expect(html).toContain('Kľúč na zápis do shopu nie je vložený.');
    expect(html).toContain('Vložte kľúč v Nastaveniach.');
    expect(html).toContain('Netreba robiť nič');
    // Domnienka sa prizná, nezamlčí.
    expect(html).toContain('nevie overiť');
    // Zámok pri kroku, ktorý si vypýta heslo.
    expect(html).toContain('Vyžiada si heslo');
    // Závažnosť nesie SLOVO, nie farba — inak sa tri úrovne nedajú rozlíšiť.
    expect(html).toContain('zastavuje zápis');
    expect(html).toContain('nezastavuje nič');
    // Informatívny riadok sa v otvorenej sekcii kreslí tiež (bod 6).
    expect(html.match(/data-testid="blocker-row"/g)).toHaveLength(3);
  });

  it('bez zastavujúcej prekážky má sekcia miernejší nadpis', () => {
    const html = renderToStaticMarkup(
      createElement(BlockersSection, {
        blockers: [blocker({ severity: 'obmedzuje', resolution: 'cakanie', path: null })],
      }),
    );
    expect(html).toContain('Čo appku brzdí');
    expect(html).not.toContain('Prečo sa nezapisuje');
  });
});
