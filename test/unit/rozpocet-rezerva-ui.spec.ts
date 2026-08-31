/**
 * Aura Zľavy — REZERVA ZÁPISOV NA OBRAZOVKE (V4, úloha ROZPOČET-UI; I11).
 *
 * `engine/budget.ts` od 31. 8. 2026 odpočítava od zápisového stropu aj ČÍTANIA
 * na tom istom kľúči, a to len nad rezervou `WRITE_QUOTA_RESERVE`. Logika je
 * mutačne overená v `rozpocet-rezerva-zapisov.spec.ts` — tento súbor stráži tú
 * druhú polovicu: že sa to dá PREČÍTAŤ na obrazovke a že sa pritom nič
 * nevymyslí.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  A. **Ubúdanie stropu čítaniami je vidieť.** Bez toho človek vidí, že
 *     zápisový zostatok klesol, a nemá ako zistiť prečo — `budget − spent` sa
 *     s `remaining` nerovná.
 *  B. **Rezerva sa POMENUJE číslom.** „Appka o schopnosť zapísať neprichádza"
 *     je tvrdenie, ktoré má na obrazovke oporu jedine vtedy, keď je pri ňom
 *     počet zápisov.
 *  C. **Chýbajúce pole nie je nula (I11).** Staršia odpoveď polia `writeReserve`
 *     a `keyedReadsCharged` nemá. Veta o rezerve sa vtedy NEKRESLÍ a nič sa
 *     nedopočíta — ani z konštanty v komponente, ani zo `settings`.
 *  D. **Ubytok NIE JE poplach.** Červená je v tejto appke vyhradená strate dát
 *     a zastavenému zápisu; ubúdanie kvóty čítaniami nie je ani jedno, takže
 *     nové vety nesmú byť `err` a nesmú znieť ako porucha.
 *  E. **Pravidlo bez čísel platí vždy, veta s číslom len keď číslo prišlo.**
 *     Vysvetlenie pod rozklikom je trvalé pravidlo, preto sa kreslí aj pri
 *     staršej odpovedi — ale nesmie obsahovať ani jednu číslicu.
 *  F. **P2 — 90 znakov na blok povrchu.** Nové vety sú na povrchu Nastavení,
 *     takže platí ten istý strop ako pre zvyšok sekcie.
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna databáza,
 * žiadna sieť. Čísla rezervy sa NEOPISUJÚ: berú sa z toho istého engine kódu,
 * ktorý ich produkčne posiela do odpovede.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import BudgetSection from '@/components/settings/BudgetSection';
import EnrichSection from '@/components/settings/EnrichSection';
import type {
  BudgetStatusView,
  CatalogView,
  QueueView,
  SettingsView,
} from '@/components/settings/api';
import type { EnrichStatePayload } from '@/lib/catalog/enrich-view';
import {
  WRITE_QUOTA_RESERVE,
  chargeableKeyedReads,
  type BudgetStatus,
} from '@/lib/engine/budget';

/** Strop P2 — `design/v3/ARCHITEKTURA.md`, riadok P2. */
const P2_LIMIT = 90;

/* ═══════════════════════════ vzorka ═══════════════════════════════════════ */

const SETTINGS: SettingsView = {
  shopDomain: 'https://sperky-eshop.sk',
  domainConfirmedAt: '2026-08-30T09:12:00.000Z',
  eagerWriteDefault: true,
  writesLocked: false,
  writesLockedReason: null,
  onboardingDoneAt: null,
  scopeMode: 'plny',
  maxProducts: 10000,
  maxProductsPerCampaign: 10000,
  pilotMaxProducts: 10,
  scopeFailClosed: false,
  dailyWriteBudget: 200,
};

/** Zápisy sa dnes neminuli, ale čítania na kľúči áno — presne ten deň, keď sa obrazovka pýtala „prečo mi zostatok klesol". */
const KEYED_READS_TODAY = 160;
const CHARGED = chargeableKeyedReads(200, KEYED_READS_TODAY);

function budget(over: Partial<BudgetStatusView> = {}): BudgetStatusView {
  return {
    day: '2026-08-31',
    budget: 200,
    spent: 0,
    keyedReadsToday: KEYED_READS_TODAY,
    keyedReadsCharged: CHARGED,
    writeReserve: WRITE_QUOTA_RESERVE,
    remaining: 200 - CHARGED,
    exhausted: false,
    ...over,
  };
}

/** Odpoveď, ktorá o čítaniach na kľúči NEVIE — presný tvar spred 31. 8. 2026. */
const OLD_BUDGET: BudgetStatusView = {
  day: '2026-08-31',
  budget: 200,
  spent: 12,
  remaining: 188,
  exhausted: false,
};

function queue(over: Partial<QueueView> = {}): QueueView {
  return {
    budget: budget(),
    queue: { pending: 0, total: 0, done: 0, campaigns: 0 },
    estimate: null,
    heartbeat: { lastTickAt: '2026-08-31T08:59:00.000Z', staleMs: 60_000, stale: false },
    limits: {
      shopPerUtcDay: 200,
      shopPerMinute: 20,
      configuredPerDay: 200,
      nextResetAt: '2026-09-01T00:00:00.000Z',
    },
    ...over,
  };
}

const CATALOG: CatalogView = {
  loadedProducts: 41_220,
  shopTotalProducts: 41_348,
  percent: 99,
  complete: false,
  lastFetchedAt: '2026-08-31T08:00:00.000Z',
  nextBatchAt: '2026-08-31T09:30:00.000Z',
  estimatedDaysLeft: 1,
  estimatedFinishAt: '2026-09-01T00:00:00.000Z',
  reads: {
    day: '2026-08-31',
    limit: 240,
    used: 53,
    remaining: 187,
    exhausted: false,
    resetAt: '2026-09-01T00:00:00.000Z',
    minuteLimit: 24,
    usedThisMinute: 2,
    known: true,
  },
};

const ENRICH: EnrichStatePayload = {
  state: {
    everRan: true,
    batchDay: '2026-08-31',
    enrichedToday: 42,
    dailyTarget: 150,
    startedAt: '2026-08-20T01:00:00.000Z',
    lastReadAt: '2026-08-31T01:12:00.000Z',
    pauseReason: null,
    pausedUntil: null,
    paused: false,
    waitsForHuman: false,
    failedLastTime: false,
    updatedAt: '2026-08-31T01:12:00.000Z',
  },
  coverage: {
    enriched: 1_240,
    catalogProducts: 41_220,
    shopTotalProducts: 41_348,
    remaining: 39_980,
    percent: 3,
    estimatedDaysLeft: 267,
  },
  unreadable: [],
  at: '2026-08-31T09:00:00.000Z',
};

/* ═══════════════════════════ pomocníci ════════════════════════════════════ */

const renderBudget = (q: QueueView | null): string =>
  renderToStaticMarkup(
    createElement(BudgetSection, { settings: SETTINGS, queue: q, catalog: CATALOG }),
  );

/** Text jedného uzla podľa `data-testid`. Uzly nižšie sú čistý text bez tagov. */
function textOf(markup: string, testId: string): string {
  const found = new RegExp(`data-testid="${testId}"[^>]*>([^<]*)<`).exec(markup);
  return found === null ? '' : found[1]!.trim();
}

/** Markup bez obsahu rozkliku — to, čo človek vidí bez kliknutia. */
const surface = (markup: string): string => markup.replace(/<details[\s\S]*?<\/details>/g, '');

/* ══════════════ 0. Tvar drôtu: engine → obrazovka bez prekladu ════════════ */

describe('`GET /api/queue` posiela rozpočet BEZ prekladu', () => {
  it('klientský typ je nadmnožina toho, čo vracia engine', () => {
    const fromEngine: BudgetStatus = {
      day: '2026-08-31',
      budget: 200,
      spent: 0,
      keyedReadsToday: KEYED_READS_TODAY,
      keyedReadsCharged: CHARGED,
      writeReserve: WRITE_QUOTA_RESERVE,
      remaining: 200 - CHARGED,
      exhausted: false,
    };

    // Route vracia `budget: budgetStatus`, teda presne tento objekt. Keby sa
    // typy rozišli, obrazovka by čítala pole, ktoré nikto neposiela — a padlo
    // by to až v prehliadači, nie tu.
    const onScreen: BudgetStatusView = fromEngine;

    expect(onScreen.writeReserve).toBe(WRITE_QUOTA_RESERVE);
    expect(onScreen.keyedReadsCharged).toBe(CHARGED);
    expect(onScreen.keyedReadsToday).toBe(KEYED_READS_TODAY);
  });
});

/* ══════════════ A + B. Čítania a rezerva sú na obrazovke ══════════════════ */

describe('Rozpočet zápisov — ubúdanie čítaniami je vidieť', () => {
  it('prúžok zápisov nesie spotrebované čítania aj rezervu, obe číslom', () => {
    const markup = renderBudget(queue());

    // Prúžok zostáva ten istý; vety stoja pod ním, nie namiesto neho.
    expect(markup).toContain('data-testid="budget-meter-writes"');

    const reads = textOf(surface(markup), 'budget-writes-keyed-reads');
    const reserve = textOf(surface(markup), 'budget-writes-reserve');

    expect(reads).toContain(String(CHARGED));
    expect(reads).toContain('kľúči');
    expect(reserve).toContain(String(WRITE_QUOTA_RESERVE));
    expect(reserve.toLowerCase()).toContain('rezerva');
  });

  it('rezerva na obrazovke je TÁ ISTÁ rezerva, ktorú počíta engine', () => {
    const markup = surface(renderBudget(queue()));

    // Keby obrazovka číslo odpísala, tento test padne až vtedy, keď sa zmení
    // engine — teda presne vtedy, keď má.
    expect(textOf(markup, 'budget-writes-reserve')).toContain(String(WRITE_QUOTA_RESERVE));
    expect(WRITE_QUOTA_RESERVE).toBeGreaterThan(0);
    expect(CHARGED).toBe(200 - WRITE_QUOTA_RESERVE);
  });

  it('technický detail rozpíše čítania na kľúči, odpočet aj rezervu', () => {
    const cell = textOf(renderBudget(queue()), 'budget-keyed-reads-detail');

    expect(cell).toContain(`${KEYED_READS_TODAY} dnes`);
    expect(cell).toContain(`${CHARGED} odpočítaných`);
    expect(cell).toContain(`rezerva ${WRITE_QUOTA_RESERVE}`);
  });

  it('nula odpočítaných čítaní je MERANÝ fakt a povie sa ako nula', () => {
    const markup = surface(
      renderBudget(queue({ budget: budget({ keyedReadsToday: 0, keyedReadsCharged: 0, remaining: 200 }) })),
    );

    expect(textOf(markup, 'budget-writes-keyed-reads')).toContain('0');
    // Rezerva pri nulových čítaniach nezmizne — je to trvalá vlastnosť kvóty.
    expect(textOf(markup, 'budget-writes-reserve')).toContain(String(WRITE_QUOTA_RESERVE));
  });
});

/* ══════════════ C. Chýbajúce pole nie je nula (I11) ═══════════════════════ */

describe('Staršia odpoveď — o rezerve sa MLČÍ, nič sa nedopočíta', () => {
  it('bez polí `writeReserve` a `keyedReadsCharged` sa veta nevykreslí', () => {
    const markup = renderBudget(queue({ budget: OLD_BUDGET }));

    expect(markup).not.toContain('data-testid="budget-writes-reserve"');
    expect(markup).not.toContain('data-testid="budget-writes-keyed-reads"');
    expect(markup).not.toContain('data-testid="budget-keyed-reads-detail"');
    // Ani slovo, ktoré by rezervu tvrdilo inými prostriedkami.
    expect(markup).not.toContain('nedotknuteľná');
    // Prúžok zápisov sa tým NESTRÁCA — vieme, koľko sa dnes zapísalo.
    expect(markup).toContain('data-testid="budget-meter-writes"');
  });

  it('nedopočíta sa ani rezerva zo `settings`, ani nula odpočítaných', () => {
    const markup = renderBudget(queue({ budget: OLD_BUDGET }));

    expect(markup).not.toContain('ubrali dnes 0');
    expect(markup).not.toContain(`rezerva ${WRITE_QUOTA_RESERVE}`);
    expect(markup).not.toContain(`Rezerva ${SETTINGS.dailyWriteBudget}`);
  });

  it('nečitateľný rozpočet o rezerve tiež nič netvrdí', () => {
    const markup = renderBudget(queue({ budget: null }));

    expect(markup).toContain('data-testid="budget-writes-unknown"');
    expect(markup).not.toContain('data-testid="budget-writes-reserve"');
    expect(markup).not.toContain('data-testid="budget-keyed-reads-detail"');
  });
});

/* ══════════════ D. Ubytok nie je poplach ═════════════════════════════════ */

describe('Tón — ubúdanie kvóty čítaniami je priebeh, nie porucha', () => {
  it('nové vety nie sú výstraha ani chyba', () => {
    const markup = renderBudget(queue());

    // `err` je v tejto sekcii vyhradená strate dát a zastavenému zápisu.
    expect(markup).not.toContain('data-variant="err"');
    for (const word of ['chyba', 'zlyhal', 'porucha', 'critical']) {
      expect(markup.toLowerCase(), `rezerva nesmie znieť ako ${word}`).not.toContain(word);
    }
  });
});

/* ══════════════ E. Pravidlo bez čísel platí vždy ═════════════════════════ */

describe('Vysvetlenie pod rozklikom', () => {
  it('pravidlo o jednej kvóte sa kreslí aj vtedy, keď čísla neprišli', () => {
    for (const q of [queue(), queue({ budget: OLD_BUDGET }), queue({ budget: null })]) {
      expect(renderBudget(q)).toContain('data-testid="budget-why-shared-quota"');
    }
  });

  it('pravidlo je BEZ čísel — inak by tvrdilo stav, ktorý appka nečítala', () => {
    const text = textOf(renderBudget(queue({ budget: OLD_BUDGET })), 'budget-why-shared-quota');

    expect(text).toContain('tú istú dennú kvótu');
    expect(text).toContain('rezerv');
    expect(text).not.toMatch(/\d/);
  });

  it('pravidlo NIE JE na povrchu — povrch nesie len krátke vety s číslami', () => {
    expect(surface(renderBudget(queue()))).not.toContain('data-testid="budget-why-shared-quota"');
  });
});

/* ══════════════ F. P2 — 90 znakov na blok povrchu ════════════════════════ */

describe('P2 — nové vety na povrchu sú do 90 znakov', () => {
  it('veta o čítaniach aj veta o rezerve sú krátke', () => {
    const markup = surface(renderBudget(queue()));

    for (const id of ['budget-writes-keyed-reads', 'budget-writes-reserve']) {
      const text = textOf(markup, id);
      expect(text.length, `${id}: „${text}"`).toBeGreaterThan(0);
      expect(text.length, `${id}: „${text}"`).toBeLessThanOrEqual(P2_LIMIT);
    }
  });
});

/* ══════════════ Obohacovanie — tá istá pravda, bez čísel ═════════════════ */

describe('Sekcia obohacovania priznáva, že kvótu delí so zľavami', () => {
  it('povie, že číta zápisovým kľúčom, a že rezervu zápisov nezmenšuje', () => {
    const markup = renderToStaticMarkup(createElement(EnrichSection, { enrich: ENRICH }));

    const shared = textOf(markup, 'enrich-shared-quota');
    const reserve = textOf(markup, 'enrich-write-reserve');

    expect(shared).toContain('zápisovým kľúčom');
    expect(shared).toContain('tú istú dennú kvótu');
    expect(reserve.toLowerCase()).toContain('rezervu zápisov');

    // Čísla vlastní rozpočtová sekcia; tu by museli byť odpísané (I11).
    expect(shared).not.toMatch(/\d/);
    expect(reserve).not.toMatch(/\d/);

    // P2 platí aj tu.
    expect(shared.length).toBeLessThanOrEqual(P2_LIMIT);
    expect(reserve.length).toBeLessThanOrEqual(P2_LIMIT);
  });

  it('veta platí aj vtedy, keď sa stav dávky nedal prečítať', () => {
    const markup = renderToStaticMarkup(createElement(EnrichSection, { enrich: null }));

    expect(markup).toContain('data-testid="enrich-shared-quota"');
    expect(markup).toContain('data-testid="enrich-write-reserve"');
  });
});
