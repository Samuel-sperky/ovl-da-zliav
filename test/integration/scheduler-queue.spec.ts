/**
 * Aura Zľavy — FRONTA V TICKU (V7; KONTRAKT V3 K2, K5, K6, odpoveď 43).
 *
 * Riadený čas + in-memory svet (`scheduler-fakes.ts`), shop sa nevolá (I6).
 * Produkčný wiring fronty (skutočný `executeCampaign` proti mock shopu) drží
 * `scheduler-wiring.spec.ts`; tu sa overuje SPRÁVANIE ticku:
 *
 *  - `queued` kampane sa dobehnú v poradí „najskorší `date_from` prvý",
 *  - denný rozpočet (K2) sa počíta z auditu a fronta ho neprekročí,
 *  - po odstávke počítača sa fronta NEROZBEHNE sama (odpoveď 43),
 *  - bez kľúča / s vypnutými zápismi fronta ČAKÁ a kampaň zostáva `queued`
 *    (nepreklápa sa do `needs_key`, viď hlavička `queue.ts`),
 *  - prepadnuté okno je `lapsed` a NIKDY sa neposúva (K5, I7),
 *  - meškajúca fronta dostane príznak `late` s nezmeneným oknom (K5),
 *  - deň pred expiráciou kľúča pri bežiacej fronte vznikne pripomienka (K6).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { CampaignItemRecord } from '@/contracts';

import { getActiveKeyExpiryReminder, resetActiveReminders } from '@/lib/scheduler/reminders';
import { resetQueueGate, resumeQueue, isQueuePaused } from '@/lib/scheduler/pause';
import { lastQueueReport, resetQueueReport } from '@/lib/scheduler/queue';
import type { SchedulerCampaign } from '@/lib/scheduler/types';

import { makeCampaignItem, makeConfirmedCampaign, TEST_NOW, testDay } from '../helpers/factories';
import { makeClock, makeWorld } from './scheduler-fakes';

const MINUTE = 60_000;

/** Kampaň vo fronte. `queued` nie je v `CampaignStatus` (A0), preto tento tvar. */
function queuedCampaign(options: {
  id: number;
  dateFrom?: string;
  dateTo?: string;
  itemsTotal?: number;
  late?: boolean;
}): SchedulerCampaign {
  const base = makeConfirmedCampaign({
    id: options.id,
    status: 'draft',
    dateFrom: options.dateFrom ?? testDay(1),
    dateTo: options.dateTo ?? testDay(30),
    itemsTotal: options.itemsTotal ?? 2,
  });
  return { ...base, status: 'queued', late: options.late ?? false };
}

function pendingItem(campaignId: number, id: number): CampaignItemRecord {
  return makeCampaignItem({ id, campaignId, productId: 200 + id, position: id, status: 'pending' });
}

beforeEach(() => {
  resetQueueGate();
  resetQueueReport();
  resetActiveReminders();
});

describe('K2 — tick dobehne frontu', () => {
  it('queued kampaň prejde executorom fronty a skončí done', async () => {
    const world = makeWorld();
    world.addCampaign(queuedCampaign({ id: 1 }));

    const result = await world.ticker.runTick();

    expect(result.error).toBeNull();
    expect(result.queueProcessed).toBe(1);
    expect(result.queueSkipped).toBeNull();
    expect(world.queueCalls.map((c) => c.id)).toEqual([1]);
    expect(world.statusOf(1)).toBe('done');
    // Fire naplánovaných kampaní sa fronty netýka — `due` krok nemal čo robiť.
    expect(world.executorCalls).toHaveLength(0);
  });

  it('poradie je najstaršia fronta prvá — rozhoduje date_from, nie id', async () => {
    const world = makeWorld();
    world.addCampaign(queuedCampaign({ id: 7, dateFrom: testDay(2) }));
    world.addCampaign(queuedCampaign({ id: 3, dateFrom: testDay(9) }));
    world.addCampaign(queuedCampaign({ id: 5, dateFrom: testDay(1) }));

    await world.ticker.runTick();

    expect(world.queueCalls.map((c) => c.id)).toEqual([5, 7, 3]);
  });

  it('denný rozpočet frontu zastaví a ďalšia kampaň zostáva queued (K2)', async () => {
    // Rozpočet 2, prvá kampaň má 2 položky → druhá sa dnes už nedostane na rad.
    const world = makeWorld({ dailyBudget: 2 });
    world.addCampaign(queuedCampaign({ id: 1, dateFrom: testDay(1), itemsTotal: 2 }));
    world.addCampaign(queuedCampaign({ id: 2, dateFrom: testDay(5), itemsTotal: 2 }));

    const result = await world.ticker.runTick();

    expect(world.queueCalls.map((c) => c.id)).toEqual([1]);
    expect(world.statusOf(2)).toBe('queued');
    expect(result.queueSkipped).toBe('budget_exhausted');
    // Vyčerpaný rozpočet NIE JE chyba — tick prešiel bez `last_error` (K2).
    expect(result.error).toBeNull();
    expect(world.writeAttempts()).toBe(2);
  });

  it('pri vyčerpanom rozpočte sa v ďalšom ticku nezapíše nič navyše', async () => {
    const world = makeWorld({ dailyBudget: 2 });
    world.addCampaign(queuedCampaign({ id: 1, itemsTotal: 2 }));
    world.addCampaign(queuedCampaign({ id: 2, itemsTotal: 2 }));

    await world.ticker.runTick();
    await world.ticker.runTick();

    expect(world.queueCalls).toHaveLength(1);
    expect(world.writeAttempts()).toBe(2);
    expect(lastQueueReport()?.skipped).toBe('budget_exhausted');
  });
});

describe('odpoveď 43 — po odstávke počítača sa fronta nerozbehne sama', () => {
  it('diera v heartbeate zatvorí bránu a fronta čaká na potvrdenie', async () => {
    const clock = makeClock();
    const world = makeWorld({
      clock,
      // Posledný heartbeat pred dvoma hodinami = počítač bol vypnutý.
      lastTickAt: new Date(TEST_NOW.getTime() - 120 * MINUTE),
    });
    world.addCampaign(queuedCampaign({ id: 1 }));

    const result = await world.ticker.runTick();

    expect(result.queuePaused).toBe(true);
    expect(result.queueSkipped).toBe('queue_paused');
    expect(isQueuePaused()).toBe(true);
    expect(world.queueCalls).toHaveLength(0);
    // Kampaň sa NEPOKAZILA — čaká presne tam, kde bola.
    expect(world.statusOf(1)).toBe('queued');

    // Ani ďalší tick ju sám nespustí — brána sa neotvára časom.
    clock.advanceMinutes(5);
    await world.ticker.runTick();
    expect(world.queueCalls).toHaveLength(0);

    // Až potvrdenie („Pokračovať") frontu rozbehne.
    resumeQueue();
    clock.advanceMinutes(1);
    await world.ticker.runTick();
    expect(world.queueCalls.map((c) => c.id)).toEqual([1]);
    expect(world.statusOf(1)).toBe('done');
  });

  it('krátky restart appky nie je odstávka — fronta pokračuje sama', async () => {
    const world = makeWorld({ lastTickAt: new Date(TEST_NOW.getTime() - 3 * MINUTE) });
    world.addCampaign(queuedCampaign({ id: 1 }));

    const result = await world.ticker.runTick();

    expect(result.queuePaused).toBe(false);
    expect(world.queueCalls).toHaveLength(1);
  });

  it('prvý štart na čistej DB (bez heartbeatu) frontu nezastaví', async () => {
    const world = makeWorld({ lastTickAt: null });
    world.addCampaign(queuedCampaign({ id: 1 }));

    await world.ticker.runTick();

    expect(isQueuePaused()).toBe(false);
    expect(world.queueCalls).toHaveLength(1);
  });
});

describe('fronta fail-closed: kľúč, env poistka, zámok, executor', () => {
  it('bez kľúča fronta ČAKÁ a kampaň zostáva queued (nie needs_key)', async () => {
    const world = makeWorld({ keyMeta: null });
    world.addCampaign(queuedCampaign({ id: 1 }));

    const result = await world.ticker.runTick();

    expect(result.queueSkipped).toBe('key_missing');
    expect(world.queueCalls).toHaveLength(0);
    expect(world.statusOf(1)).toBe('queued');
    // Žiadny audit event navyše — inak by kľúč chýbajúci deň vyrobil 1440 riadkov.
    expect(world.auditEvents()).not.toContain('campaign_needs_key');
  });

  it('vypnuté zápisy (I13) frontu zastavia bez zmeny stavu kampane', async () => {
    const world = makeWorld({ writesEnabledByEnv: false });
    world.addCampaign(queuedCampaign({ id: 1 }));

    const result = await world.ticker.runTick();

    expect(result.queueSkipped).toBe('writes_disabled');
    expect(world.queueCalls).toHaveLength(0);
    expect(world.statusOf(1)).toBe('queued');
  });

  it('runaway zámok (I12) má prednosť pred env poistkou aj rozpočtom', async () => {
    const world = makeWorld({ writesLocked: true });
    world.addCampaign(queuedCampaign({ id: 1 }));

    const result = await world.ticker.runTick();

    expect(result.queueSkipped).toBe('writes_locked');
    expect(world.queueCalls).toHaveLength(0);
  });

  it('nezapojený executor je fail-closed — žiadny zápis, žiadna zmena stavu', async () => {
    const world = makeWorld({ queueExecutor: null });
    world.addCampaign(queuedCampaign({ id: 1 }));

    const result = await world.ticker.runTick();

    expect(result.queueSkipped).toBe('executor_unavailable');
    expect(world.statusOf(1)).toBe('queued');
  });
});

describe('K5 — meškanie a prepadnuté okno', () => {
  it('kampaň, ktorej nabehlo okno a má pending položky, dostane late — okno sa NEMENÍ', async () => {
    const world = makeWorld();
    const campaign = queuedCampaign({ id: 1, dateFrom: testDay(-2), dateTo: testDay(20) });
    world.addCampaign(campaign);
    world.addItem(pendingItem(1, 1));

    await world.ticker.runTick();

    expect(world.lateMarked).toEqual([1]);
    const stored = world.campaigns.get(1);
    expect(stored?.late).toBe(true);
    // I7/K5 — appka okno nikdy neskracuje ani neposúva.
    expect(stored?.dateFrom).toBe(campaign.dateFrom);
    expect(stored?.dateTo).toBe(campaign.dateTo);
  });

  it('príznak late sa nastaví raz, opakovaný tick ho nenastavuje znova', async () => {
    const world = makeWorld();
    world.addCampaign(queuedCampaign({ id: 1, dateFrom: testDay(-2) }));
    world.addItem(pendingItem(1, 1));

    await world.ticker.runTick();
    await world.ticker.runTick();

    expect(world.lateMarked).toEqual([1]);
  });

  it('kampaň s oknom v minulosti je lapsed a NIČ sa nezapíše (D25)', async () => {
    const world = makeWorld();
    world.addCampaign(queuedCampaign({ id: 1, dateFrom: testDay(-40), dateTo: testDay(-1) }));

    await world.ticker.runTick();

    expect(world.statusOf(1)).toBe('lapsed');
    expect(world.queueCalls).toHaveLength(0);
    expect(world.auditEvents()).toContain('campaign_lapsed');
  });
});

describe('K6 — pripomienka deň pred expiráciou kľúča pri bežiacej fronte', () => {
  it('kľúč do 24 h + fronta s prácou → pripomienka existuje', async () => {
    const world = makeWorld({
      keyMeta: { expiresAt: new Date(TEST_NOW.getTime() + 12 * 60 * MINUTE) },
      // Rozpočet 0 by frontu zastavil; stačí, že kampaň vo fronte JE.
      dailyBudget: 200,
    });
    world.addCampaign(queuedCampaign({ id: 1 }));

    await world.ticker.runTick();

    const reminder = getActiveKeyExpiryReminder();
    expect(reminder).not.toBeNull();
    expect(reminder?.queuedCampaigns).toBe(1);
    expect(reminder?.hoursLeft).toBeGreaterThan(0);
    expect(reminder?.hoursLeft).toBeLessThanOrEqual(24);
  });

  it('bez fronty sa pripomienka nevytvára — expirujúci kľúč sám o sebe nie je udalosť', async () => {
    const world = makeWorld({
      keyMeta: { expiresAt: new Date(TEST_NOW.getTime() + 12 * 60 * MINUTE) },
    });

    await world.ticker.runTick();

    expect(getActiveKeyExpiryReminder()).toBeNull();
  });

  it('kľúč s TTL ďalej než 24 h pripomienku nevytvára', async () => {
    const world = makeWorld({
      keyMeta: { expiresAt: new Date(TEST_NOW.getTime() + 40 * 60 * MINUTE) },
    });
    world.addCampaign(queuedCampaign({ id: 1 }));

    await world.ticker.runTick();

    expect(getActiveKeyExpiryReminder()).toBeNull();
  });
});

describe('K7 — katalóg beží až po zápisoch', () => {
  it('keď fronta pracovala, sync dostane queueBusy = true', async () => {
    const world = makeWorld();
    world.addCampaign(queuedCampaign({ id: 1 }));

    await world.ticker.runTick();

    expect(world.catalogCalls).toEqual([{ queueBusy: true }]);
  });

  it('pri prázdnej fronte môže sync bežať (queueBusy = false)', async () => {
    const world = makeWorld();

    const result = await world.ticker.runTick();

    expect(world.catalogCalls).toEqual([{ queueBusy: false }]);
    expect(result.queueSkipped).toBe('queue_empty');
  });
});
