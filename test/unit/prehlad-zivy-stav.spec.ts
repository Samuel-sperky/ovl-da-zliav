/**
 * Aura Zľavy — PREHĽAD: živý stav a „prečo sa nič nedeje" (V9).
 *
 * Kontrakt dokončenia (C1–C4) žiada, aby používateľ videl bez logov a bez
 * databázy dve veci: čo appka práve robí a prečo sa niečo NESTALO. Obe sú
 * tvrdenia o produkčnom eshope, takže sa musia dať overiť bez klikania.
 *
 * Testuje sa preto to, čo o obrazovke rozhoduje:
 *
 *   A. čítanie `/api/status` a `/api/catalog/sync` — čo sa nedá prečítať, je
 *      `null` alebo fail-closed, nikdy upokojujúca nula,
 *   B. rozhodovanie živého stavu — pilulky, prúžky a riadky „čo sa deje",
 *   C. prekážky — farbu volí SPÔSOB RIEŠENIA, nie závažnosť, a poradie zo
 *      servera sa nemení,
 *   D. zhoda zoznamov kódov s ich originálmi (kontrola typom, nie vierou),
 *   E. obrazovka sa naozaj vykreslí a hovorí to, čo model rozhodol.
 *
 * Vlastník: V9.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BlockersSection from '@/components/dashboard/BlockersSection';
import FirstDiscountSection from '@/components/dashboard/FirstDiscountSection';
import LiveStatusSection from '@/components/dashboard/LiveStatusSection';

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
  budgetResetPhrase,
  catalogActivity,
  catalogMeter,
  heartbeatSummary,
  keyPill,
  liveStatusView,
  resolutionLook,
  scopeActivity,
  screenBlockers,
  shopPill,
  unreadableSentence,
  writesActivity,
} from '@/components/dashboard/live-status-model';

import type { CatalogWaitingReason } from '@/lib/repo/catalog.repo';
import type { BlockerResolution, BlockerSeverity } from '@/lib/status/blockers';
import type { StatusSection } from '@/lib/status/snapshot';

const NOW = new Date('2026-08-12T09:00:00.000Z');

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

/* ═════════════════ B. Rozhodovanie živého stavu ═══════════════════════════ */

describe('Prehľad — pilulky a prúžky hovoria len to, čo appka vie', () => {
  it('kľúč: chýbajúci nie je červený, končiaci sa ozve včas', () => {
    expect(keyPill({ present: null, expiresAt: null }, NOW).tone).toBe('idle');

    const missing = keyPill({ present: false, expiresAt: null }, NOW);
    expect(missing.tone).toBe('attention');
    expect(missing.tone).not.toBe('critical');

    expect(keyPill({ present: true, expiresAt: '2026-08-14T09:00:00.000Z' }, NOW).tone).toBe('good');
    expect(keyPill({ present: true, expiresAt: '2026-08-12T15:00:00.000Z' }, NOW).tone).toBe(
      'attention',
    );
    expect(keyPill({ present: true, expiresAt: '2026-08-12T08:00:00.000Z' }, NOW).label).toContain(
      'skončil',
    );
    // Vložený kľúč bez známej platnosti sa NEBERIE ako platný.
    expect(keyPill({ present: true, expiresAt: null }, NOW).tone).toBe('attention');
  });

  it('kľúč: pilulka nikdy nenesie nič zo samotného kľúča', () => {
    const pill = keyPill({ present: true, expiresAt: '2026-08-14T09:00:00.000Z' }, NOW);
    expect(pill.label).toContain('platí ešte');
    expect(pill.detail).not.toBeNull();
    expect(pill.label).not.toMatch(/[A-Za-z0-9]{16,}/);
  });

  it('spojenie so shopom stojí na poslednom úspešnom čítaní, nie na domnienke', () => {
    expect(shopPill(null).tone).toBe('idle');
    expect(shopPill(sync({ lastReadAt: null })).tone).toBe('idle');
    expect(shopPill(sync()).tone).toBe('good');
    expect(shopPill(sync({ failedLastTime: true })).tone).toBe('attention');
    expect(shopPill(sync({ waiting: 'error' })).tone).toBe('attention');
  });

  /**
   * Najdôležitejšie tvrdenie sekcie: pri dočítanom katalógu by `BudgetMeter`
   * napísal „strop vyčerpaný", čo je presný opak toho, čo sa stalo.
   */
  it('prúžok katalógu zmizne, keď je katalóg celý alebo keď čísla nevieme', () => {
    expect(catalogMeter(sync(), null)).toEqual({ spent: 2900, limit: 41082 });
    expect(catalogMeter(sync({ complete: true }), null)).toBeNull();
    expect(catalogMeter(sync({ loadedProducts: 41082 }), null)).toBeNull();
    expect(catalogMeter(sync({ shopTotalProducts: null }), null)).toBeNull();
    expect(catalogMeter(null, null)).toBeNull();
  });

  it('rozpočet sa obnovuje o polnoci UTC, ale hovorí sa v miestnom čase', () => {
    expect(budgetResetPhrase(NOW)).toBe('o 02:00');
    expect(budgetResetPhrase(new Date('2026-01-12T09:00:00.000Z'))).toBe('o 01:00');
  });
});

describe('Prehľad — riadky „čo appka práve robí"', () => {
  it('zamknuté zápisy sú jediný kritický stav, vypnuté sú pokojné', () => {
    expect(writesActivity({ enabled: true, locked: true }).tone).toBe('bad');
    expect(writesActivity({ enabled: false, locked: false }).tone).toBe('idle');
    expect(writesActivity({ enabled: null, locked: null }).word).toBe('nevieme');
    expect(writesActivity({ enabled: true, locked: false }).tone).toBe('ok');
  });

  it('pilotný rozsah nesie zámok a cestu, kde sa dá zdvihnúť', () => {
    const pilot = scopeActivity({ pilot: true, maxProducts: 10 });
    expect(pilot.tone).toBe('lock');
    expect(pilot.text).toContain('10 produktov');
    expect(pilot.path).toBe('/nastavenia');

    const full = scopeActivity({ pilot: false, maxProducts: 150 });
    expect(full.tone).toBe('ok');
    expect(full.text).toContain('150 produktov');

    expect(scopeActivity({ pilot: null, maxProducts: null }).tone).toBe('idle');
  });

  it('katalóg povie, kde je, prečo stojí a dokedy to potrvá', () => {
    const running = catalogActivity(sync(), null);
    expect(running.text).toContain('2 900 z 41 082');
    expect(running.text).toContain('≈ 14. 8.');

    expect(catalogActivity(sync({ waiting: 'daily_budget' }), null).text).toContain('po polnoci');
    expect(catalogActivity(sync({ waiting: 'rate_limited' }), null).text).toContain('11:15');
    expect(catalogActivity(sync({ waiting: 'error' }), null).tone).toBe('warn');

    const done = catalogActivity(sync({ complete: true, loadedProducts: 41082 }), null);
    expect(done.tone).toBe('ok');
    expect(done.word).toBe('načítaný celý');
    expect(done.text).toContain('41 082');

    expect(catalogActivity(null, null).word).toBe('nevieme');
  });

  it('prázdny katalóg NIE JE načítaný celý — nula nie je hotovo', () => {
    // Nájdené na snímke z prehliadača 12. 8.: hore svietilo „Katalóg prázdny"
    // a o kúsok nižšie „✓ načítaný celý — Načítaných je všetkých 0".
    // Príčinou bolo holé `loaded >= total`, kde 0 >= 0 vyjde ako pravda,
    // takže appka o prázdnej tabuľke tvrdila, že má celý katalóg.
    const prazdny = catalogActivity(
      sync({ loadedProducts: 0, shopTotalProducts: 0, complete: false }),
      null,
    );
    expect(prazdny.word).not.toBe('načítaný celý');
    expect(prazdny.tone).not.toBe('ok');

    // Ani meraný príznak z `catalog_sync_state` neplatí nad prázdnou tabuľkou.
    const klamlivyPriznak = catalogActivity(
      sync({ loadedProducts: 0, shopTotalProducts: 41_082, complete: true }),
      null,
    );
    expect(klamlivyPriznak.word).not.toBe('načítaný celý');
  });

  /**
   * Po KAŽDOM dokončenom prechode beží nový (obnovovací) a ten začína od
   * stránky 0. Prehľad vtedy hlásil „načítaný celý", kým karta v Produktoch
   * vedľa toho tvrdila „382 stránok ostáva, ešte 2 dni". Katalóg je celý — a
   * Prehľad má povedať aj to, že sa práve obnovuje, inak je čítanie shopu
   * pri „hotovom" katalógu záhada.
   */
  it('obnova nad celým katalógom je „načítaný celý", a je vidieť, že beží', () => {
    const obnova = catalogActivity(
      sync({ loadedProducts: 41_082, complete: false, refreshing: true }),
      null,
    );

    expect(obnova.tone).toBe('ok');
    expect(obnova.word).toBe('načítaný celý');
    expect(obnova.text).toContain('obnovuje');
    // Žiadny odhad dokončenia — nie je čo dokončovať.
    expect(obnova.text).not.toContain('≈');
  });

  it('chýbajúci krok fronty znamená „appka nekontroluje", nie pokoj', () => {
    expect(heartbeatSummary(null).tone).toBe('warn');
    expect(heartbeatSummary({ lastTickAt: null, stale: true }).detail).toContain('nepoznáme');
    expect(heartbeatSummary({ lastTickAt: '2026-08-12T08:59:00.000Z', stale: false }).tone).toBe(
      'ok',
    );
  });

  it('nečitateľná sekcia sa prizná slovom, nikdy vnútorným kódom', () => {
    const sentence = unreadableSentence(['apiKey', 'writeBudget']);
    expect(sentence).toContain('kľúč na zápis');
    expect(sentence).toContain('rozpočet zápisov');
    expect(sentence).not.toContain('apiKey');
    expect(unreadableSentence([])).toBeNull();
  });
});

/* ═════════════════ C. Prekážky — farbu volí spôsob riešenia ═══════════════ */

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

  it('informatívne riadky nie sú dôvod, prečo sa nič nedeje', () => {
    const rows = [
      blocker({ id: 'writes_disabled', severity: 'blokuje' }),
      blocker({ id: 'catalog_incomplete', severity: 'obmedzuje' }),
      blocker({ id: 'scope_pilot_cap', severity: 'informuje' }),
    ];
    expect(screenBlockers(rows).map((row) => row.id)).toEqual([
      'writes_disabled',
      'catalog_incomplete',
    ]);
  });

  it('poradie zo servera sa na obrazovke nemení', () => {
    const rows = [
      blocker({ id: 'prva' }),
      blocker({ id: 'druha', severity: 'obmedzuje' }),
      blocker({ id: 'tretia' }),
    ];
    expect(screenBlockers(rows).map((row) => row.id)).toEqual(['prva', 'druha', 'tretia']);
  });
});

/* ═════════════════ D. Zoznamy kódov sa nesmú rozísť s originálom ══════════ */

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
    const sections: Record<StatusSection, StatusSectionCode> = {
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

/* ═════════════════ E. Obrazovka sa naozaj vykreslí ════════════════════════ */

describe('Prehľad — nové sekcie sa vykreslia', () => {
  function renderLive(view: Parameters<typeof liveStatusView>[0]): string {
    return renderToStaticMarkup(
      createElement(LiveStatusSection, { view: liveStatusView(view) }),
    );
  }

  it('živý stav ukáže rozpočet, katalóg, kľúč, spojenie aj tri riadky', () => {
    const html = renderLive({
      status: status(),
      sync: sync(),
      heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', stale: false },
      now: NOW,
    });

    expect(html).toContain('Živý stav');
    expect(html).toContain('100/200');
    expect(html).toContain('2 900/41 082');
    expect(html).toContain('Spojené so shopom');
    expect(html).toContain('Kľúč platí ešte');
    expect(html).toContain('appka kontroluje frontu');
    expect(html.match(/data-testid="live-line"/g)).toHaveLength(3);
    expect(html).not.toContain('<table');
  });

  it('neznámy rozpočet sa nekreslí ako nula, ale ako priznaná medzera', () => {
    const html = renderLive({
      status: status({ writeBudget: null, unreadable: ['writeBudget'] }),
      sync: null,
      heartbeat: null,
      now: NOW,
    });

    expect(html).toContain('nepodarilo zistiť');
    expect(html).toContain('rozpočet zápisov');
    expect(html).not.toContain('0/200');
    expect(html).toContain('appka frontu nekontroluje');
  });

  it('bez odpovede stavu sa netvrdí nič a obrazovka to povie', () => {
    const html = renderLive({ status: null, sync: null, heartbeat: null, now: NOW });
    expect(html).toContain('Stav appky sa nepodarilo prečítať');
  });

  it('prekážky sa nekreslia, keď nič nezastavuje ani nebrzdí', () => {
    expect(
      renderToStaticMarkup(createElement(BlockersSection, { blockers: [] })),
    ).toBe('');
    expect(
      renderToStaticMarkup(createElement(BlockersSection, { blockers: null })),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        createElement(BlockersSection, { blockers: [blocker({ severity: 'informuje' })] }),
      ),
    ).toBe('');
  });

  it('každá prekážka ukáže čo sa deje, čo s tým a kam ísť', () => {
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
            severity: 'obmedzuje',
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
    expect(html).toContain('Nastavenia');
    expect(html).toContain('Netreba robiť nič');
    // Domnienka sa prizná, nezamlčí.
    expect(html).toContain('nevie overiť');
    // Zámok pri kroku, ktorý si vypýta heslo.
    expect(html).toContain('Vyžiada si heslo');
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

  it('prázdny stav učí, čo sa dá spraviť a čo appka ešte vie', () => {
    const html = renderToStaticMarkup(createElement(FirstDiscountSection, {}));
    expect(html).toContain('Zatiaľ žiadna zľava');
    expect(html).toContain('Nová zľava');
    expect(html).toContain('Nájsť ležiaky');
    // Tri kroky v poradí, v akom sa naozaj robia.
    expect(html.match(/<li>/g)).toHaveLength(3);
    // Zľavu appka zapíše, ale nikdy neruší — veta to nesmie sľubovať.
    expect(html).toContain('skončí sama');
    expect(html).not.toContain('zruší');
    // Objaviteľnosť: funkcie, ktoré appka MÁ a nikto ich nenájde.
    expect(html).toContain('predajnosť');
    expect(html).toContain('zastaviť všetky zápisy');
  });
});
