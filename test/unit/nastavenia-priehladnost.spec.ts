/**
 * Aura Zľavy — PRIEHĽADNOSŤ NASTAVENÍ (V12, kontrakt dokončenia C1–C5).
 *
 * Sprievodný test k prestavbe Nastavení na šesť otázok. Netestuje vzhľad —
 * testuje presne tie štyri veci, ktoré sa dajú ticho pokaziť a ktoré by si
 * nikto nevšimol, kým appka nezačne mlčať práve vtedy, keď má hovoriť:
 *
 *  A. **Kotvy a skupiny sedia.** Poradie sekcií aj bočná navigácia čítajú
 *     JEDNU štruktúru a každý odkaz v zozname funkcií vedie na kotvu, ktorá
 *     na stránke naozaj je. Odkaz do prázdna je horší než chýbajúci riadok.
 *  B. **Zápisy hovoria, prečo sa nezapisuje.** Tri podmienky, pri každej stav
 *     aj ďalší krok; vypnuté zápisy sú vysvetlené ako zámer, nie ako porucha;
 *     a obrazovka NEPONÚKA tlačidlo, ktoré by ich zapínalo — nedá sa to.
 *  C. **Farba ide podľa toho, ako sa vec rieši, nie podľa závažnosti.**
 *     Vyčerpaný denný rozpočet zastaví všetko a napriek tomu má pokojný tón
 *     (K2); chýbajúci kľúč nezastaví o nič viac, ale žiada si pozornosť.
 *  D. **Neznáme číslo sa nekreslí.** Prúžok rozpočtu, ktorý sa nedá prečítať,
 *     sa nenahradí nulou — na jeho mieste je veta s dôvodom.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna databáza,
 * žiadna sieť. Prekážky sa skladajú skutočným kódom zo `lib/status`, nie
 * ručne odpísanými vetami; keby sa tie vety zmenili, test to zachytí.
 *
 * Vlastník: V12 (testovú sadu ako celok vlastní V14).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BudgetSection, { resetPhraseSk } from '@/components/settings/BudgetSection';
import FeatureIndex, { APP_CAPABILITIES, isAnchor } from '@/components/settings/FeatureIndex';
import KeysSection, { keyRowState } from '@/components/settings/KeysSection';
import ScopeModeForm from '@/components/settings/ScopeModeForm';
import WritesSection, { writeConditions } from '@/components/settings/WritesSection';
import {
  SETTINGS_ANCHORS,
  SETTINGS_GROUPS,
} from '@/components/settings/SettingsPanel';
import { SETTINGS_CSS } from '@/components/settings/styles';
import {
  RESOLUTION_TONE,
  RESOLUTION_WORD,
  blockerTone,
  pickBlocker,
} from '@/components/settings/blockers-view';
import { collectOperationBlockers } from '@/lib/status/blockers';
import { toStatusPayload, type StatusPayload, type StatusReading } from '@/lib/status/snapshot';
import type { StatusSnapshot } from '@/lib/status/blockers';
import type {
  CatalogView,
  KeyMetaView,
  QueueView,
  SettingsView,
} from '@/components/settings/api';

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const NOW = new Date('2026-08-12T09:00:00.000Z');

const SETTINGS: SettingsView = {
  shopDomain: 'https://sperky-eshop.sk',
  domainConfirmedAt: '2026-08-10T09:12:00.000Z',
  eagerWriteDefault: true,
  writesLocked: false,
  writesLockedReason: null,
  onboardingDoneAt: null,
  scopeMode: 'pilot',
  maxProducts: 10,
  maxProductsPerCampaign: 10000,
  pilotMaxProducts: 10,
  scopeFailClosed: false,
  dailyWriteBudget: 200,
};

const WRITE_KEY: KeyMetaView = {
  present: true,
  last4: '2222',
  savedAt: '2026-08-11T09:12:00.000Z',
  expiresAt: '2026-08-13T09:12:00.000Z',
  secondsLeft: 172800,
  verifyStatus: 'valid',
};

const ORDERS_KEY: KeyMetaView = {
  present: false,
  last4: null,
  savedAt: null,
  expiresAt: null,
  secondsLeft: null,
  verifyStatus: null,
};

function queue(over: Partial<QueueView> = {}): QueueView {
  return {
    budget: { day: '2026-08-12', budget: 200, spent: 120, remaining: 80, exhausted: false },
    queue: { pending: 30, total: 150, done: 120, campaigns: 1 },
    estimate: { pending: 30, perDay: 200, days: 1, date: '2026-08-13' },
    heartbeat: { lastTickAt: '2026-08-12T08:59:00.000Z', staleMs: 60000, stale: false },
    limits: {
      shopPerUtcDay: 200,
      shopPerMinute: 20,
      configuredPerDay: 200,
      nextResetAt: '2026-08-13T00:00:00.000Z',
    },
    ...over,
  };
}

function catalog(over: Partial<CatalogView> = {}): CatalogView {
  return {
    loadedProducts: 2900,
    shopTotalProducts: 41082,
    percent: 7,
    complete: false,
    lastFetchedAt: '2026-08-12T08:00:00.000Z',
    nextBatchAt: '2026-08-12T09:30:00.000Z',
    estimatedDaysLeft: 2,
    estimatedFinishAt: '2026-08-14T00:00:00.000Z',
    reads: {
      day: '2026-08-12',
      limit: 240,
      used: 96,
      remaining: 144,
      exhausted: false,
      resetAt: '2026-08-13T00:00:00.000Z',
      minuteLimit: 24,
      usedThisMinute: 3,
      known: true,
    },
    ...over,
  };
}

/**
 * Stav appky poskladaný SKUTOČNÝM kódom — vety prekážok teda nie sú odpísané
 * v teste, ale prídu z `lib/status/blockers.ts`. Keď sa tam veta zmení, test
 * to prijme; keď sa zmení tón alebo spôsob riešenia, padne.
 */
function statusFor(
  snapshot: Omit<StatusSnapshot, 'now'>,
  writeLock: StatusReading['writeLock'] = {
    writesLocked: false,
    writesLockedReason: null,
    writesLockedAt: null,
  },
): StatusPayload {
  return toStatusPayload({
    now: NOW,
    snapshot: { now: NOW, ...snapshot },
    unreadable: [],
    writeLock,
    effectiveMaxProducts: 10,
    catalogLastFetchedAt: null,
  });
}

/** Bežný stav pred prvým ostrým zápisom: zápisy vypnuté, kľúč vložený. */
const STATUS_WRITES_OFF = statusFor({
  writes: { enabled: false },
  apiKey: { present: true, expiresAt: new Date('2026-08-13T09:12:00.000Z') },
  writeBudget: { budget: 200, spent: 120, day: '2026-08-12' },
  scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
});

/** Všetko pripravené: zápisy zapnuté, kľúč platný, rozpočet voľný. */
const STATUS_READY = statusFor({
  writes: { enabled: true },
  apiKey: { present: true, expiresAt: new Date('2026-08-13T09:12:00.000Z') },
  writeBudget: { budget: 200, spent: 120, day: '2026-08-12' },
  scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
});

const noop = () => {};

/* ══════════════ A. Kotvy, skupiny a zoznam funkcií ════════════════════════ */

describe('Nastavenia — skupiny a kotvy', () => {
  it('ploché poradie kotiev je presne to, čo je v skupinách', () => {
    const fromGroups = SETTINGS_GROUPS.flatMap((g) => g.anchors.map((a) => a.id));
    expect(SETTINGS_ANCHORS.map((a) => a.id)).toEqual(fromGroups);
    expect(new Set(fromGroups).size).toBe(fromGroups.length);
  });

  it('každá skupina má názov a aspoň jednu kotvu', () => {
    for (const group of SETTINGS_GROUPS) {
      expect(group.title.length, 'skupina bez názvu').toBeGreaterThan(3);
      expect(group.anchors.length, `skupina ${group.title}`).toBeGreaterThan(0);
    }
  });

  it('štyri otázky používateľa sú medzi skupinami a rozsah je pred rozpočtom', () => {
    const ids = SETTINGS_ANCHORS.map((a) => a.id);
    // Rozsah zliav je vec, ktorú používateľ nenašiel — patrí pred čísla.
    expect(ids.indexOf('rozsah')).toBeLessThan(ids.indexOf('rozpocet'));
    // Zápisy vysvetľujú, prečo sa nič nedeje; patria hneď k rozsahu.
    expect(ids.indexOf('zapisy')).toBe(ids.indexOf('rozsah') + 1);
    // Núdzové brzdy končia červenou zónou — nikdy nie uprostred stránky.
    expect(ids[ids.length - 1]).toBe('cervena');
  });

  it('zoznam funkcií nevedie ani jedným odkazom do prázdna', () => {
    const ids = new Set(SETTINGS_ANCHORS.map((a) => a.id));
    for (const row of APP_CAPABILITIES) {
      if (!isAnchor(row.href)) continue;
      expect(ids, `odkaz ${row.href} nemá sekciu`).toContain(row.href.slice(1));
    }
  });

  it('zoznam funkcií hovorí o tom, čo appka VIE — nie o tom, čo jej chýba', () => {
    const markup = renderToStaticMarkup(createElement(FeatureIndex));
    expect(markup).toContain('id="covie"');
    // Prvý riadok je rozsah zliav: presne to, čo používateľ nenašiel.
    expect(APP_CAPABILITIES[0]?.href).toBe('#rozsah');
    for (const row of APP_CAPABILITIES) expect(markup).toContain(row.what);
    // Vysvetľovanie chýbajúcich údajov má JEDINÉ miesto — zamknuté funkcie.
    expect(markup).not.toContain('nákupné ceny');
  });
});

/* ══════════════ B. Zápisy do eshopu — prečo sa nezapisuje ═════════════════ */

describe('Zápisy do eshopu', () => {
  it('vypnuté zápisy sú vysvetlené ako zámer, nie ako porucha', () => {
    const markup = renderToStaticMarkup(
      createElement(WritesSection, { status: STATUS_WRITES_OFF, settings: SETTINGS }),
    );
    expect(markup).toContain('id="zapisy"');
    expect(markup).toContain('Nie je to chyba');
    expect(markup).toContain('vypnuté');
  });

  it('obrazovka nepredstiera, že sa zápisy dajú zapnúť odtiaľto', () => {
    const markup = renderToStaticMarkup(
      createElement(WritesSection, { status: STATUS_WRITES_OFF, settings: SETTINGS }),
    );
    // Žiadne tlačidlo v celej sekcii: povolenie žije v konfigurácii počítača.
    expect(markup).not.toContain('<button');
  });

  it('tri podmienky zápisu majú stav aj ďalší krok', () => {
    const conditions = writeConditions(STATUS_WRITES_OFF, SETTINGS);
    expect(conditions.map((c) => c.key)).toEqual(['povolenie', 'kluc', 'poistka']);

    const permission = conditions[0]!;
    expect(permission.state).toBe('vypnuté');
    // Nedá sa to vyriešiť v appke → cesta nikam nevedie a tón je najprísnejší.
    expect(permission.anchor).toBeNull();
    expect(permission.tone).toBe('critical');
    expect(permission.nextStep?.length ?? 0).toBeGreaterThan(10);

    // Kľúč je vložený a platný, poistka nezasiahla → obe sú v poriadku.
    expect(conditions[1]?.tone).toBe('good');
    expect(conditions[2]?.tone).toBe('good');
  });

  it('neznámy stav zápisov sa prizná ako domnienka, nie ako „všetko je fajn"', () => {
    const conditions = writeConditions(null, SETTINGS);
    expect(conditions[0]?.state).toBe('zatiaľ neviem');
    expect(conditions[0]?.assumed).toBe(true);
    expect(conditions[0]?.tone).not.toBe('good');
  });

  it('zastavené zápisy ukážu dôvod a vedú do poistiek', () => {
    const locked = statusFor(
      {
        writes: { enabled: true },
        apiKey: { present: true, expiresAt: new Date('2026-08-13T09:12:00.000Z') },
        writeBudget: { budget: 200, spent: 120, day: '2026-08-12' },
        scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
      },
      {
        writesLocked: true,
        writesLockedReason: 'appka zapisovala rýchlejšie, než je bezpečné',
        writesLockedAt: new Date('2026-08-12T08:00:00.000Z'),
      },
    );
    const poistka = writeConditions(locked, SETTINGS)[2]!;
    expect(poistka.tone).toBe('critical');
    expect(poistka.anchor).toBe('#poistky');
    expect(poistka.what).toContain('rýchlejšie');
  });

  it('chýbajúci kľúč berie vetu zo zoznamu prekážok, neskladá si vlastnú', () => {
    const noKey = statusFor({
      writes: { enabled: true },
      apiKey: { present: false, expiresAt: null },
      writeBudget: { budget: 200, spent: 0, day: '2026-08-12' },
      scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
    });
    const fromBlockers = pickBlocker(noKey.blockers, ['key_missing']);
    expect(fromBlockers).not.toBeNull();
    const kluc = writeConditions(noKey, SETTINGS)[1]!;
    expect(kluc.state).toBe('chýba');
    expect(kluc.what).toBe(fromBlockers?.what);
    expect(kluc.nextStep).toBe(fromBlockers?.nextStep);
    expect(kluc.anchor).toBe('#kluce');
  });

  it('keď je všetko pripravené, sekcia to povie a nič nestraší', () => {
    const markup = renderToStaticMarkup(
      createElement(WritesSection, { status: STATUS_READY, settings: SETTINGS }),
    );
    expect(markup).toContain('Appka smie zapisovať');
    expect(markup).not.toContain('Nie je to chyba');
  });
});

/* ══════════════ C. Farba podľa riešenia, nie podľa závažnosti ═════════════ */

describe('Prekážky — farbí sa podľa toho, ako sa to rieši', () => {
  it('vyčerpaný rozpočet zastaví všetko a napriek tomu má pokojný tón (K2)', () => {
    const blockers = collectOperationBlockers({
      now: NOW,
      writes: { enabled: true },
      apiKey: { present: true, expiresAt: new Date('2026-08-13T09:12:00.000Z') },
      writeBudget: { budget: 200, spent: 200, day: '2026-08-12' },
      scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
    });
    const budget = blockers.find((b) => b.id === 'write_budget_exhausted');
    expect(budget, 'prekážka vyčerpaného rozpočtu chýba').toBeDefined();
    // Zastavuje — a predsa sa nič nepokazilo, takže žiadna červená.
    expect(budget?.severity).toBe('blokuje');
    expect(blockerTone({ resolution: budget!.resolution })).toBe('idle');
  });

  it('chýbajúci kľúč zastavuje rovnako, ale žiada si pozornosť', () => {
    const blockers = collectOperationBlockers({
      now: NOW,
      writes: { enabled: true },
      apiKey: { present: false, expiresAt: null },
      writeBudget: { budget: 200, spent: 0, day: '2026-08-12' },
      scope: { mode: 'pilot', maxProducts: 10000, failClosed: false },
    });
    const key = blockers.find((b) => b.id === 'key_missing');
    expect(key?.severity).toBe('blokuje');
    expect(blockerTone({ resolution: key!.resolution })).toBe('attention');
  });

  it('každý spôsob riešenia má tón aj SLOVO — stav nie je nikdy len farba', () => {
    for (const resolution of Object.keys(RESOLUTION_TONE) as (keyof typeof RESOLUTION_TONE)[]) {
      expect(RESOLUTION_WORD[resolution]?.length ?? 0).toBeGreaterThan(5);
    }
  });
});

/* ══════════════ D. Rozsah zliav — číslo po prepnutí ═══════════════════════ */

describe('Rozsah zliav', () => {
  const pilot = renderToStaticMarkup(
    createElement(ScopeModeForm, { settings: SETTINGS, onChanged: noop }),
  );

  it('v pilotnom rozsahu je vidieť aj strop, ktorý by platil po uvoľnení', () => {
    expect(pilot).toContain('10 produktov');
    // Toto číslo používateľ nikdy nevidel — je to celý dôvod prestavby.
    expect(pilot).toContain('10 000 produktov');
    expect(pilot).toContain('Po uvoľnení by prešlo');
  });

  it('oba rozsahy stoja vedľa seba aj s tým, ako sa na ne prepína', () => {
    expect(pilot).toContain('data-testid="scope-modes"');
    expect(pilot).toContain('sprísnenie je vždy voľné, heslo netreba');
    expect(pilot).toContain('uvoľnenie si vypýta heslo');
    // Ktorý rozsah platí teraz, sa nesie slovom, nie len farbou riadku.
    expect(pilot).toContain('data-testid="scope-row-pilot"');
    expect(pilot).not.toContain('data-testid="scope-row-full"');
  });

  it('v plnom rozsahu ukazuje tretia dlaždica číslo pilotného rozsahu', () => {
    const full = renderToStaticMarkup(
      createElement(ScopeModeForm, {
        settings: { ...SETTINGS, scopeMode: 'plny', maxProducts: 10000 },
        onChanged: noop,
      }),
    );
    expect(full).toContain('Po sprísnení by prešlo');
    expect(full).toContain('data-testid="scope-row-full"');
  });
});

/* ══════════════ E. Rozpočty — dva prúžky, žiadne výmysly ══════════════════ */

describe('Rozpočty na dnes', () => {
  it('zápisy a čítania majú vlastný prúžok', () => {
    const markup = renderToStaticMarkup(
      createElement(BudgetSection, { settings: SETTINGS, queue: queue(), catalog: catalog() }),
    );
    expect(markup).toContain('data-testid="budget-meter-writes"');
    expect(markup).toContain('data-testid="budget-meter-reads"');
    // Prúžok čítaní meria SVOJU kvótu, nie zápisovú.
    expect(markup).toContain('96/240');
    expect(markup).toContain('120/200');
  });

  it('rozpočet, ktorý sa nedá prečítať, sa nenahradí nulou', () => {
    const markup = renderToStaticMarkup(
      createElement(BudgetSection, {
        settings: SETTINGS,
        queue: queue({ budget: null }),
        catalog: null,
      }),
    );
    expect(markup).not.toContain('data-testid="budget-meter-writes"');
    expect(markup).not.toContain('data-testid="budget-meter-reads"');
    expect(markup).toContain('data-testid="budget-writes-unknown"');
    expect(markup).toContain('data-testid="budget-reads-unknown"');
    expect(markup).toContain('zatiaľ neviem');
  });

  it('neisté počítadlo čítaní sa nekreslí ako meraná hodnota', () => {
    const markup = renderToStaticMarkup(
      createElement(BudgetSection, {
        settings: SETTINGS,
        queue: queue(),
        catalog: catalog({ reads: { ...catalog().reads, known: false } }),
      }),
    );
    expect(markup).not.toContain('data-testid="budget-meter-reads"');
    expect(markup).toContain('data-testid="budget-reads-unknown"');
  });

  it('stav katalógu je vidieť aj tu, nielen v Produktoch', () => {
    const markup = renderToStaticMarkup(
      createElement(BudgetSection, { settings: SETTINGS, queue: queue(), catalog: catalog() }),
    );
    expect(markup).toContain('2 900');
    expect(markup).toContain('41 082');
  });

  it('veta o obnove stropu vzniká z času, nikdy z odhadu', () => {
    expect(resetPhraseSk(null)).toBeNull();
    expect(resetPhraseSk('')).toBeNull();
    expect(resetPhraseSk('toto nie je čas')).toBeNull();
    expect(resetPhraseSk('2026-08-13T00:00:00.000Z')).toMatch(/^o \d{2}:\d{2}$/);
  });

  it('vyčerpaný rozpočet ani tu nie je chyba', () => {
    const markup = renderToStaticMarkup(
      createElement(BudgetSection, {
        settings: SETTINGS,
        queue: queue({
          budget: { day: '2026-08-12', budget: 200, spent: 200, remaining: 0, exhausted: true },
        }),
        catalog: catalog(),
      }),
    );
    expect(markup).toContain('pokračujem zajtra');
    for (const word of ['chyba', 'zlyhal', 'porucha']) {
      expect(markup.toLowerCase(), `vyčerpaný rozpočet nesmie znieť ako ${word}`).not.toContain(
        word,
      );
    }
  });
});

/* ══════════════ F. Kľúče — dokedy platia a čo potom ═══════════════════════ */

describe('Kľúče', () => {
  it('stav kľúča rozlišuje chýbajúci, platný, dochádzajúci a neplatný', () => {
    expect(keyRowState(null).label).toBe('chýba');
    expect(keyRowState(ORDERS_KEY).label).toBe('chýba');
    expect(keyRowState(WRITE_KEY)).toEqual({ label: 'vložený a platný', tone: 'good' });
    expect(keyRowState({ ...WRITE_KEY, secondsLeft: 3600 })).toEqual({
      label: 'vložený, čoskoro vyprší',
      tone: 'attention',
    });
    expect(keyRowState({ ...WRITE_KEY, secondsLeft: 0 })).toEqual({
      label: 'už neplatí',
      tone: 'critical',
    });
  });

  it('obrazovka povie, čo sa stane po expirácii a ako sa kľúč obnovuje', () => {
    const markup = renderToStaticMarkup(
      createElement(KeysSection, { writeKey: WRITE_KEY, ordersKey: ORDERS_KEY, onStored: noop }),
    );
    expect(markup).toContain('data-testid="keys-expiry-note"');
    expect(markup).toContain('nič sa nestratí');
    expect(markup).toContain('48 hodín');
    expect(markup).toContain('30 dní');
  });
});

/* ══════════════ G. Mobil — nové mriežky sa skladajú ═══════════════════════ */

describe('Mobil', () => {
  it('dva prúžky rozpočtov sa na úzkej obrazovke poskladajú pod seba', () => {
    const mobile = SETTINGS_CSS.slice(SETTINGS_CSS.indexOf('@media (max-width:760px)'));
    expect(mobile).toContain('.set-page .set-meters{grid-template-columns:1fr}');
  });
});
