/**
 * Aura Zľavy — ŽIVÝ STAV FRONTY V TABE ZĽAVY (V11; kontrakt dokončenia B1, B3,
 * B5, B7, C2; kontrakt V3 K1, K2, K5, K10, D45).
 *
 * Dôkaz, nie report agenta. Testuje sa presne to, čo sa dá na tomto povrchu
 * pokaziť ticho a čo by to stálo produkčný eshop:
 *
 *  A. **Jedno číslo z dvoch zdrojov** — koľko je vo fronte pred nami vie
 *     povedať `/api/queue` (presne) aj zoznam zliav (odhadom). Keď sa rozídu,
 *     musí byť jasné, ktoré platí; keď sa nedá prečítať ani jedno, odhad
 *     dobehnutia sa NESMIE dopočítať (P7).
 *  B. **Čas pred potvrdením** — zľava, ktorá nabehne skôr, než fronta dobehne,
 *     zlacní produkty po častiach. Musí sa to povedať vetou, nie mlčaním (K5).
 *  C. **Fail-closed čítanie odpovede** — nečitateľný stav fronty nikdy
 *     neznamená „všetko beží".
 *  D. **Farba podľa spôsobu riešenia, nie podľa závažnosti** — vyčerpaný
 *     rozpočet blokuje, ale nie je to chyba (K2).
 *  E. **Neisté nie je zlyhané** (D45) — dve čísla, dva ďalšie kroky.
 *  F. **Zopakovanie si pýta čerstvé potvrdenie** a obrazovka to vysvetlí skôr,
 *     než používateľ narazí na odmietnutie (I3, D16).
 *  G. **Strop výber neodmietne ticho** — ponúkne prepnutie a povie o hesle (R4).
 *
 * Renderuje sa `renderToStaticMarkup` — žiadny prehliadač, žiadna DB, žiadna
 * sieť. Efekty klienta sa pri statickom renderi nespúšťajú, takže test meria
 * značky a texty, nie načítanie dát.
 *
 * Vlastník: V11.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import DiscountsList from '@/components/campaigns/DiscountsList';
import NewDiscountStart from '@/components/campaigns/NewDiscountStart';
import QueueLive from '@/components/campaigns/QueueLive';
import RetryFailed from '@/components/campaigns/RetryFailed';
import ScopeRelease from '@/components/campaigns/ScopeRelease';
import {
  RESOLUTION_GLYPH,
  RESOLUTION_TONE,
  RESOLUTION_WORD,
  RETRY_WHY_FRESH,
  alarmingCards,
  cardOfWire,
  dayCount,
  findCard,
  judgeStart,
  parseQueueSnapshot,
  parseRetryPlan,
  previewBlockerText,
  productCount,
  queueStandSentence,
  quietCards,
  resetPhrase,
  resolveAhead,
  type BlockerCard,
  type QueueStandCode,
} from '@/components/campaigns/queue-model';
import { collectOperationBlockers } from '@/lib/status/blockers';

/* ═══════════════════════════ vzorka odpovede ══════════════════════════════ */

/** Skrátená, ale tvarovo verná odpoveď `GET /api/queue`. */
const QUEUE_BODY = {
  budget: { day: '2026-08-12', budget: 200, spent: 160, remaining: 40, exhausted: false },
  writes: { spentToday: 160, budget: 200, resumeAt: '2026-08-13T00:00:00.000Z' },
  queue: { pending: 3240, total: 8000, done: 4760, campaigns: 2 },
  items: {
    total: 8000,
    pending: 3240,
    done: 4760,
    ok: 4700,
    failed: 41,
    uncertain: 12,
    otherResolved: 7,
    campaigns: 2,
  },
  current: {
    campaignId: 7,
    name: 'Ležiaky striebro',
    status: 'running',
    dateFrom: '2026-09-04',
    dateTo: '2026-09-18',
    itemsTotal: 5000,
    itemsOk: 4700,
    itemsFailed: 41,
    itemsUncertain: 12,
    itemsPending: 247,
    late: false,
  },
  estimate: { pending: 3240, perDay: 200, days: 17, date: '2026-08-29' },
  limits: {
    shopPerUtcDay: 200,
    shopPerMinute: 20,
    configuredPerDay: 200,
    belowShopCap: false,
    nextResetAt: '2026-08-13T00:00:00.000Z',
    secondsToReset: 41_000,
  },
  keyStatus: {
    present: true,
    verifyStatus: 'valid',
    expiresAt: '2026-08-14T09:00:00.000Z',
    secondsLeft: 170_000,
    usable: true,
    expired: false,
  },
  standing: {
    writing: true,
    reason: null,
    blockers: [
      {
        id: 'write_budget_low',
        area: 'rozpocet',
        severity: 'obmedzuje',
        subject: 'operacia',
        productIds: [],
        what: 'Dnes sa zmestí ešte 40 zápisov, vo výbere je 3 240 produktov.',
        nextStep: 'Netreba robiť nič — fronta pokračuje každý deň sama.',
        path: null,
        resolution: 'cakanie',
        passableNow: false,
        clearsAt: '2026-08-13T00:00:00.000Z',
        assumed: false,
      },
      {
        id: 'scope_full_cap',
        area: 'rozsah',
        severity: 'informuje',
        subject: 'operacia',
        productIds: [],
        what: 'V plnom režime prejde na jednu zľavu najviac 10 000 produktov.',
        nextStep: 'Strop sa dá zmeniť v Nastaveniach.',
        path: '/nastavenia',
        resolution: 'sam',
        passableNow: true,
        clearsAt: null,
        assumed: false,
      },
    ],
    blocked: false,
    waitUntil: '2026-08-13T00:00:00.000Z',
    writesLocked: false,
    writesLockedReason: null,
  },
  attention: {
    uncertain: {
      items: 12,
      campaigns: [{ campaignId: 7, name: 'Ležiaky striebro', status: 'running', items: 12 }],
      truncated: false,
      what: 'Shop odpovedal inak, než sme čakali.',
      nextStep: 'Pozrite sa na tieto produkty priamo v eshope.',
    },
    failed: {
      items: 41,
      campaigns: [{ campaignId: 7, name: 'Ležiaky striebro', status: 'running', items: 41 }],
      truncated: false,
      what: 'Shop neodpovedal ani po treťom pokuse.',
      nextStep: 'Spustite pri danej zľave zopakovanie.',
    },
  },
  heartbeat: { lastTickAt: '2026-08-12T09:40:00.000Z', staleMs: 20_000, stale: false },
  gate: { paused: false, since: null, bestEffort: true },
  lastRun: null,
};

/* ═════════ A. Koľko je vo fronte pred nami — jedno číslo z dvoch ══════════ */

describe('A — dve miesta nesmú hovoriť dve rôzne čísla', () => {
  it('presný počet z fronty má prednosť pred odhadom z počítadiel zliav', () => {
    const ahead = resolveAhead({ queuePending: 3240, listPending: 5820 });
    expect(ahead.pending).toBe(3240);
    expect(ahead.exact).toBe(true);
    expect(ahead.known).toBe(true);
    expect(ahead.source).toBe('fronta');
  });

  it('keď fronta mlčí, platí odhad zo zoznamu — ale prizná sa, že je odhad', () => {
    const ahead = resolveAhead({ queuePending: null, listPending: 5820 });
    expect(ahead.pending).toBe(5820);
    expect(ahead.exact).toBe(false);
    expect(ahead.known).toBe(true);
  });

  it('keď mlčia obe, číslo NIE JE nula — je neznáme (P7)', () => {
    const ahead = resolveAhead({ queuePending: null, listPending: null });
    expect(ahead.known).toBe(false);
    expect(ahead.exact).toBe(false);
    expect(ahead.source).toBe('nevieme');
  });

  it('prázdna fronta je fakt, nie medzera', () => {
    const ahead = resolveAhead({ queuePending: 0, listPending: 5820 });
    expect(ahead.pending).toBe(0);
    expect(ahead.known).toBe(true);
    expect(ahead.exact).toBe(true);
  });
});

/* ═══════════ B. Kedy zľava nabehne oproti dobehnutiu fronty ═══════════════ */

describe('B — štart pred dobehnutím fronty sa musí povedať vopred (K5)', () => {
  it('dva dni rezervy sú v poriadku a nič nekričí', () => {
    const verdict = judgeStart('2026-10-20', '2026-10-18');
    expect(verdict.code).toBe('reserve');
    expect(verdict.reserveDays).toBe(2);
    expect(verdict.nextStep).toBeNull();
  });

  it('štart pred dobehnutím je varovanie s konkrétnym počtom dní', () => {
    const verdict = judgeStart('2026-10-10', '2026-10-18');
    expect(verdict.code).toBe('late');
    expect(verdict.reserveDays).toBe(-8);
    expect(verdict.what).toContain('8 dní');
    expect(verdict.nextStep).not.toBeNull();
  });

  it('štart presne v deň dobehnutia je tesný, nie pokojný', () => {
    expect(judgeStart('2026-10-18', '2026-10-18').code).toBe('tight');
  });

  it('bez odhadu dobehnutia sa dátum nevymýšľa', () => {
    const verdict = judgeStart('2026-10-20', null);
    expect(verdict.code).toBe('unknown');
    expect(verdict.reserveDays).toBeNull();
    expect(verdict.what).toContain('nevieme');
  });

  it('rozsypaný dátum render nezhodí', () => {
    expect(judgeStart('', '2026-10-18').code).toBe('unknown');
    expect(judgeStart('2026-10-20', 'zajtra').code).toBe('unknown');
  });
});

/* ═════════════════ C. Fail-closed čítanie stavu fronty ═══════════════════ */

describe('C — nečitateľná odpoveď nikdy neznamená „všetko beží"', () => {
  it('celá odpoveď sa prečíta aj s rozpadom položiek', () => {
    const snapshot = parseQueueSnapshot(QUEUE_BODY);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.queue.pending).toBe(3240);
    expect(snapshot?.items.ok).toBe(4700);
    expect(snapshot?.items.failed).toBe(41);
    expect(snapshot?.items.uncertain).toBe(12);
    expect(snapshot?.budget?.remaining).toBe(40);
    expect(snapshot?.estimate?.days).toBe(17);
    expect(snapshot?.current?.campaignId).toBe(7);
    expect(snapshot?.limits.nextResetAt).toBe('2026-08-13T00:00:00.000Z');
    expect(snapshot?.standing.writing).toBe(true);
    expect(snapshot?.standing.blockers).toHaveLength(2);
  });

  it('nezmysel nie je prázdna fronta — je to nič', () => {
    expect(parseQueueSnapshot(null)).toBeNull();
    expect(parseQueueSnapshot('ok')).toBeNull();
    expect(parseQueueSnapshot({})).toBeNull();
    expect(parseQueueSnapshot({ queue: { total: 5 } })).toBeNull();
  });

  it('chýbajúce vysvetlenie stavu sa berie prísnejšie, nie voľnejšie', () => {
    const snapshot = parseQueueSnapshot({ queue: { pending: 10, total: 20 } });
    expect(snapshot?.standing.writing).toBe(false);
    expect(snapshot?.standing.blocked).toBe(true);
    expect(snapshot?.standing.reason).toBe('state_unknown');
    expect(snapshot?.heartbeat.stale).toBe(true);
    // Rozpočet, ktorý sa nedá prečítať, NIE JE rozpočet s nulou.
    expect(snapshot?.budget).toBeNull();
    expect(snapshot?.estimate).toBeNull();
  });

  it('prekážka s neznámou závažnosťou sa berie ako blokujúca a neriešiteľná sama', () => {
    const snapshot = parseQueueSnapshot({
      queue: { pending: 1, total: 1 },
      standing: {
        writing: false,
        reason: 'writes_disabled',
        blockers: [{ id: 'nieco_nove', what: 'Niečo nové sa pokazilo.', severity: 'x' }],
      },
    });
    const card = snapshot?.standing.blockers[0];
    expect(card?.severity).toBe('blokuje');
    expect(card?.resolution).toBe('mimo_appky');
  });
});

/* ═════════ D. Farba podľa spôsobu riešenia, nie podľa závažnosti ═════════ */

describe('D — vyčerpaný rozpočet blokuje, ale nie je to chyba (K2)', () => {
  it('čakanie je pokojné, riešiteľné je jantárové, mimo appky červené', () => {
    expect(RESOLUTION_TONE.cakanie).toBe('idle');
    expect(RESOLUTION_TONE.sam).toBe('attention');
    expect(RESOLUTION_TONE.sudo).toBe('attention');
    expect(RESOLUTION_TONE.mimo_appky).toBe('critical');
  });

  it('každý spôsob riešenia má okrem farby aj glyf a slovo', () => {
    const keys = ['sam', 'sudo', 'cakanie', 'mimo_appky'] as const;
    for (const key of keys) {
      expect(RESOLUTION_GLYPH[key].length).toBeGreaterThan(0);
      expect(RESOLUTION_WORD[key].length).toBeGreaterThan(3);
    }
    // Glyfy sa musia líšiť — inak je farba jediný rozlišovač.
    expect(new Set(keys.map((key) => RESOLUTION_GLYPH[key])).size).toBe(keys.length);
  });

  it('blokujúci rozpočet nedostane výstražnú farbu, hoci zastavuje všetko', () => {
    const budgetBlocker = collectOperationBlockers({
      now: new Date('2026-08-12T10:00:00.000Z'),
      writes: { enabled: true },
      apiKey: { present: true, expiresAt: new Date('2026-08-14T09:00:00.000Z') },
      writeBudget: { budget: 200, spent: 200, day: '2026-08-12' },
      scope: { mode: 'plny', maxProducts: 10_000, failClosed: false },
      selection: { selectedCount: 150 },
    }).find((blocker) => blocker.id === 'write_budget_exhausted');

    expect(budgetBlocker?.severity).toBe('blokuje');
    expect(budgetBlocker?.resolution).toBe('cakanie');
    expect(RESOLUTION_TONE[budgetBlocker?.resolution ?? 'sam']).toBe('idle');
  });

  it('informatívne pravidlá nekričia medzi skutočnými prekážkami', () => {
    const cards = (parseQueueSnapshot(QUEUE_BODY)?.standing.blockers ?? []) as BlockerCard[];
    expect(alarmingCards(cards).map((card) => card.id)).toEqual(['write_budget_low']);
    expect(quietCards(cards).map((card) => card.id)).toEqual(['scope_full_cap']);
    expect(findCard(cards, 'scope_full_cap')?.path).toBe('/nastavenia');
    expect(findCard(cards, 'toto_neexistuje')).toBeNull();
  });

  it('prekážka zo servera a prekážka z lokálneho prepočtu majú jeden tvar', () => {
    const wire = {
      id: 'key_missing' as const,
      area: 'kluc' as const,
      severity: 'blokuje' as const,
      subject: 'operacia' as const,
      productIds: [],
      what: 'Kľúč na zápis do shopu nie je vložený.',
      nextStep: 'Vložte kľúč v Nastaveniach.',
      path: '/nastavenia',
      resolution: 'sam' as const,
      passableNow: true,
      clearsAt: null,
      assumed: false,
    };
    expect(cardOfWire(wire).resolution).toBe('sam');
    expect(cardOfWire(wire).what).toBe(wire.what);
  });
});

/* ═════════════ Dôvod, prečo fronta stojí — vždy veta, nikdy kód ══════════ */

describe('Prečo fronta stojí — každý dôvod má vetu a ďalší krok (K10)', () => {
  const CODES: readonly QueueStandCode[] = [
    'queue_paused',
    'queue_empty',
    'writes_disabled',
    'writes_locked',
    'key_missing',
    'key_expired',
    'budget_exhausted',
    'budget_unknown',
    'executor_unavailable',
    'scheduler_down',
    'state_unknown',
  ];

  it('žiadny známy dôvod nezostane bez vysvetlenia', () => {
    for (const code of CODES) {
      const sentence = queueStandSentence(code);
      expect(sentence, `dôvod ${code}`).not.toBeNull();
      expect(sentence?.what.length ?? 0, `dôvod ${code}`).toBeGreaterThan(10);
      expect(sentence?.nextStep.length ?? 0, `dôvod ${code}`).toBeGreaterThan(5);
      // Kód sa na povrch nedostane nikdy — ani v texte, ani cez podčiarkovník.
      expect(`${sentence?.what} ${sentence?.nextStep}`).not.toContain('_');
    }
  });

  it('keď nič nestojí, nekreslí sa žiadna veta', () => {
    expect(queueStandSentence(null)).toBeNull();
    expect(queueStandSentence('')).toBeNull();
  });

  it('neznámy dôvod nikdy neprebliká surový', () => {
    const sentence = queueStandSentence('celkom_novy_dovod');
    expect(sentence).not.toBeNull();
    expect(sentence?.what).not.toContain('celkom_novy_dovod');
    expect(sentence?.what).not.toContain('_');
  });

  it('mŕtvy plánovač a nezapojený zapisovač sú vážne, čakanie na rozpočet nie', () => {
    expect(queueStandSentence('scheduler_down')?.tone).toBe('critical');
    expect(queueStandSentence('executor_unavailable')?.tone).toBe('critical');
    expect(queueStandSentence('budget_exhausted')?.tone).toBe('idle');
    expect(queueStandSentence('budget_unknown')?.tone).toBe('idle');
  });

  it('pozastavená fronta vedie tam, kde sa dá pokračovať', () => {
    expect(queueStandSentence('queue_paused')?.path).toBe('/');
    expect(queueStandSentence('key_expired')?.path).toBe('/nastavenia');
  });
});

/* ══════════════ E + F. Neisté nie je zlyhané, oprava chce potvrdenie ═════ */

describe('E — neisté a zlyhané sú dve čísla s dvoma ďalšími krokmi (D45)', () => {
  it('rozpad fronty ich drží oddelene', () => {
    const items = parseQueueSnapshot(QUEUE_BODY)?.items;
    expect(items?.failed).toBe(41);
    expect(items?.uncertain).toBe(12);
    expect(items?.failed).not.toBe(items?.uncertain);
  });

  it('popis opakovania ich tiež nesčíta', () => {
    const plan = parseRetryPlan({
      campaignId: 7,
      name: 'Ležiaky striebro',
      percent: 20,
      possible: true,
      blockedBy: null,
      what: 'Opravná zľava by zopakovala 53 produktov.',
      nextStep: 'Spustite skúšku naprázdno a potvrďte ju.',
      productIds: [101, 102, 103],
      items: { total: 5000, retryable: 53, notWritten: 41, uncertain: 12, pending: 0, ok: 4700, skipped: 7 },
      window: { from: '2026-09-04', to: '2026-09-18', originalFrom: '2026-09-04', today: '2026-08-12' },
      requires: { freshPreview: true, confirmation: true, sudo: true },
    });
    expect(plan?.items.notWritten).toBe(41);
    expect(plan?.items.uncertain).toBe(12);
    expect(plan?.possible).toBe(true);
    expect(plan?.requiresSudo).toBe(true);
    expect(plan?.window.from).toBe('2026-09-04');
  });
});

describe('F — zopakovanie si vždy vypýta čerstvé potvrdenie (I3, D16)', () => {
  it('bez výslovného súhlasu servera sa opakovanie neponúka', () => {
    const plan = parseRetryPlan({
      campaignId: 7,
      what: 'Zľava ešte beží.',
      possible: true,
      productIds: [],
    });
    expect(plan?.possible).toBe(false);
  });

  it('keď server nepovie inak, počíta sa s heslom', () => {
    const plan = parseRetryPlan({ campaignId: 7, what: 'Nieco.', productIds: [1] });
    expect(plan?.requiresSudo).toBe(true);
  });

  it('nezmysel sa nevydá za plán', () => {
    expect(parseRetryPlan(null)).toBeNull();
    expect(parseRetryPlan({ campaignId: 7 })).toBeNull();
  });

  it('vysvetlenie hovorí ľudsky, prečo staré potvrdenie neplatí', () => {
    expect(RETRY_WHY_FRESH).toContain('potvrdili');
    expect(RETRY_WHY_FRESH).toContain('skúška naprázdno');
    // Kód invariantu ani vnútorný identifikátor sem nepatria (K10).
    expect(RETRY_WHY_FRESH).not.toMatch(/\b[IDK]\d{1,3}\b/);
    expect(RETRY_WHY_FRESH).not.toContain('_');
  });
});

/* ════════════ G. Strop výber neodmietne ticho — ponúkne cestu ═══════════ */

describe('G — pri narazení na strop sa ponúka prepnutie, nie odmietnutie (R4)', () => {
  const pilotCap = collectOperationBlockers({
    now: new Date('2026-08-12T10:00:00.000Z'),
    writes: { enabled: true },
    apiKey: { present: true, expiresAt: new Date('2026-08-14T09:00:00.000Z') },
    writeBudget: { budget: 200, spent: 0, day: '2026-08-12' },
    scope: { mode: 'pilot', maxProducts: 10, failClosed: false },
    selection: { selectedCount: 150 },
  }).find((blocker) => blocker.id === 'scope_pilot_cap');

  it('prekážka stropu je riešiteľná heslom a nesie obe čísla', () => {
    expect(pilotCap).toBeDefined();
    expect(pilotCap?.resolution).toBe('sudo');
    expect(pilotCap?.what).toContain('150');
    expect(pilotCap?.what).toContain('10');
  });

  it('panel ukáže obe čísla, ponúkne prepnutie a upozorní na heslo', () => {
    const html = renderToStaticMarkup(
      createElement(ScopeRelease, {
        wanted: 150,
        allowed: 10,
        blocker:
          pilotCap === undefined
            ? null
            : {
                id: pilotCap.id,
                severity: pilotCap.severity,
                resolution: pilotCap.resolution,
                what: pilotCap.what,
                nextStep: pilotCap.nextStep,
                path: pilotCap.path,
                assumed: pilotCap.assumed,
                clearsAt: null,
              },
      }),
    );

    expect(html).toContain('150');
    expect(html).toContain('140');
    expect(html).toContain('/nastavenia#rozsah');
    expect(html).toContain('heslo');
    // Odmietnutie bez cesty von je tu zakázané.
    expect(html).toContain('Prepnúť rozsah');
  });

  it('panel funguje aj bez prekážky — povie aspoň čísla a cestu', () => {
    const html = renderToStaticMarkup(
      createElement(ScopeRelease, { wanted: 150, allowed: 10, blocker: null }),
    );
    expect(html).toContain('150');
    expect(html).toContain('/nastavenia#rozsah');
  });
});

/* ═════════ H. Obrazovky sa vykreslia aj vtedy, keď dáta ešte nie sú ══════ */

describe('H — prvý render bez dát nespadne a nič si nevymyslí (P7, C4)', () => {
  it('zoznam zliav sa vykreslí a ešte nič netvrdí o počte zliav', () => {
    const html = renderToStaticMarkup(createElement(DiscountsList));
    expect(html).toContain('Načítavam zľavy');
    // Prázdny zoznam je tvrdenie — kým sa dáta nenačítajú, nekreslí sa.
    expect(html).not.toContain('Zatiaľ tu nie je ani jedna zľava');
  });

  it('panel fronty prizná, že stav ešte nepozná', () => {
    const html = renderToStaticMarkup(
      createElement(QueueLive, {
        campaign: {
          id: 7,
          itemsTotal: 150,
          itemsOk: 100,
          itemsFailed: 4,
          itemsUncertain: 3,
          itemsPending: 43,
        },
      }),
    );
    expect(html).toContain('Fronta naživo');
    expect(html).toContain('Stav fronty nepoznáme');
    // Štyri čísla vedľa seba — neisté má vlastnú dlaždicu (D45).
    expect(html).toContain('Nevieme, či sa zapísalo');
    expect(html).toContain('Nepodarilo sa');
  });

  it('panel opakovania najprv zisťuje, čo by sa zopakovalo — nič nezapisuje', () => {
    const html = renderToStaticMarkup(createElement(RetryFailed, { campaignId: 7 }));
    expect(html).toContain('Zisťujem, čo by sa dalo zopakovať');
    expect(html).not.toContain('Potvrdiť a zaradiť opravu');
  });

  it('panel štartu povie čas aj vtedy, keď rozpočet aj fronta chýbajú', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscountStart, {
        itemsCount: 150,
        perDay: null,
        aheadPending: 0,
        aheadNames: [],
        ahead: resolveAhead({ queuePending: null, listPending: null }),
        finishDay: null,
        queueDays: null,
        proposedStart: null,
        from: '',
        onUseProposal: () => {},
        keyExpiresAt: null,
        keyPresent: true,
        budget: null,
      }),
    );
    expect(html).toContain('Fronta pobeží');
    expect(html).toContain('Zľava nabehne');
    expect(html).toContain('nevieme');
  });

  it('panel štartu s dátami povie dni, deň dobehnutia aj deň nábehu', () => {
    const html = renderToStaticMarkup(
      createElement(NewDiscountStart, {
        itemsCount: 150,
        perDay: 200,
        aheadPending: 3240,
        aheadNames: [{ name: 'Ležiaky striebro', pending: 3240 }],
        ahead: resolveAhead({ queuePending: 3240, listPending: null }),
        finishDay: '2026-08-29',
        queueDays: 17,
        proposedStart: '2026-08-31',
        from: '2026-08-31',
        onUseProposal: () => {},
        keyExpiresAt: '2026-12-01T10:00:00.000Z',
        keyPresent: true,
        budget: { spent: 160, limit: 200, resetsAt: 'o 02:00' },
      }),
    );
    expect(html).toContain('17 dní');
    expect(html).toContain('29.08.2026');
    expect(html).toContain('31.08.2026');
    expect(html).toContain('160/200');
    expect(html).toContain('presný počet z fronty');
  });
});

/* ═══════════════════════ Drobnosti, ktoré držia texty ════════════════════ */

describe('Slovenské tvary a fráza o obnove rozpočtu', () => {
  it('počty dní a produktov sú v správnom páde', () => {
    expect(dayCount(1)).toBe('1 deň');
    expect(dayCount(3)).toBe('3 dni');
    expect(dayCount(12)).toBe('12 dní');
    expect(productCount(1)).toBe('1 produkt');
    expect(productCount(150)).toBe('150 produktov');
    expect(productCount(1500)).toBe('1 500 produktov');
  });

  it('fráza o obnove rozlíši dnešok od zajtrajška v miestnom čase', () => {
    const reset = '2026-08-13T00:00:00.000Z';
    // 23:00 UTC je v Bratislave už 13. 8. — teda ten istý deň ako obnova.
    expect(resetPhrase(reset, new Date('2026-08-12T23:10:00.000Z'))).toBe('o 02:00');
    // Napoludnie 12. 8. je obnova až zajtra; deň sa počíta v miestnom čase.
    expect(resetPhrase(reset, new Date('2026-08-12T10:00:00.000Z'))).toBe('zajtra o 02:00');
    expect(resetPhrase(null)).toBeNull();
    expect(resetPhrase('zajtra')).toBeNull();
  });

  it('blokátor skúšky dostane vetu zo slovníka, neznámy si nechá správu', () => {
    expect(previewBlockerText('budget_exhausted', 'x')).toContain('rozpočet');
    expect(previewBlockerText('budget_exhausted', 'x')).not.toContain('_');
    expect(previewBlockerText('nieco_nove', 'Vlastná správa servera.')).toBe(
      'Vlastná správa servera.',
    );
  });
});
