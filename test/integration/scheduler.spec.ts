/**
 * Aura Zľavy — integračné testy ticku schedulera (§9, D21, D59, D84, D87, I13).
 *
 * Riadený čas + fake tick (SPRINT-PLAN A10): svet je in-memory implementácia
 * kontraktov, shop sa nevolá (I6). Overuje sa:
 *  - normatívne PORADIE krokov ticku,
 *  - heartbeat KAŽDÝ tick, aj po výnimke (výnimka → `last_error`, proces žije),
 *  - due kampaň bez platného kľúča → `needs_key` (NIE `failed`),
 *  - `writes_locked` / env poistka → `needs_key` s dôvodom `writes_disabled`,
 *  - zamrznutie ±60 s okolo polnoci preskočí fire do ďalšieho ticku,
 *  - atomický claim → executor beží len raz,
 *  - reminders 48/24/2 h.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { bandFor, getActiveReminders, resetActiveReminders } from '@/lib/scheduler/reminders';

import { makeConfirmedCampaign, TEST_NOW } from '../helpers/factories';
import { makeClock, makeWorld } from './scheduler-fakes';

const MINUTE = 60_000;

function dueCampaign(id: number, fireAgoMinutes: number, now: Date = TEST_NOW) {
  return makeConfirmedCampaign({
    id,
    status: 'scheduled',
    fireAt: new Date(now.getTime() - fireAgoMinutes * MINUTE),
    dateFrom: '2026-08-05',
    dateTo: '2026-08-20',
  });
}

beforeEach(() => {
  resetActiveReminders();
});

describe('tick — šťastná cesta a poradie krokov', () => {
  it('due kampaň prejde claim → executor a zapíše sa heartbeat', async () => {
    const world = makeWorld();
    world.addCampaign(dueCampaign(1, 1));

    const result = await world.ticker.runTick();

    expect(result.error).toBeNull();
    expect(result.fired).toBe(1);
    expect(world.executorCalls).toHaveLength(1);
    expect(world.canaryCalls).toBe(1);
    expect(world.statusOf(1)).toBe('done');
    expect(world.auditEvents()).toContain('campaign_claimed');
    expect(world.heartbeats).toHaveLength(1);
    expect(world.heartbeats[0]?.lastError).toBeNull();
  });

  it('TTL wipe beží PRED due krokom — expirovaný kľúč nikdy nespustí zápis', async () => {
    const world = makeWorld({
      keyMeta: { expiresAt: new Date(TEST_NOW.getTime() - MINUTE) },
    });
    world.addCampaign(dueCampaign(1, 1));

    const result = await world.ticker.runTick();

    expect(result.keyWiped).toBe(true);
    expect(world.wipes).toEqual(['ttl_expired']);
    // Kľúč je preč skôr, než sa due krok dostal k slovu → needs_key, žiadny executor.
    expect(world.executorCalls).toHaveLength(0);
    expect(world.statusOf(1)).toBe('needs_key');
  });

  it('heartbeat sa aktualizuje každý tick', async () => {
    const world = makeWorld();
    await world.ticker.runTick();
    await world.ticker.runTick();
    await world.ticker.runTick();
    expect(world.heartbeats).toHaveLength(3);
  });
});

describe('tick — needs_key vetvy (D21, I13)', () => {
  it('chýbajúci kľúč → needs_key, NIE failed, žiadny zápis', async () => {
    const world = makeWorld({ keyMeta: null });
    world.addCampaign(dueCampaign(1, 1));

    const result = await world.ticker.runTick();

    expect(world.statusOf(1)).toBe('needs_key');
    expect(result.needsKey).toBe(1);
    expect(world.executorCalls).toHaveLength(0);
    expect(world.auditEvents()).toContain('campaign_needs_key');
    const campaign = world.campaigns.get(1);
    expect(campaign?.statusReason).toContain('key_missing_or_invalid');
    expect(campaign?.needsKeySince).not.toBeNull();
  });

  it('neoverený kľúč (verify_status ≠ valid) → needs_key', async () => {
    const world = makeWorld({ keyMeta: { verifyStatus: 'unverified' } });
    world.addCampaign(dueCampaign(1, 1));
    await world.ticker.runTick();
    expect(world.statusOf(1)).toBe('needs_key');
    expect(world.executorCalls).toHaveLength(0);
  });

  it('writes_locked → needs_key s dôvodom writes_disabled', async () => {
    const world = makeWorld({ writesLocked: true });
    world.addCampaign(dueCampaign(1, 1));
    await world.ticker.runTick();
    expect(world.statusOf(1)).toBe('needs_key');
    expect(world.campaigns.get(1)?.statusReason).toContain('writes_disabled');
    expect(world.executorCalls).toHaveLength(0);
  });

  it('WRITES_ENABLED≠true (env poistka) → needs_key s dôvodom writes_disabled', async () => {
    const world = makeWorld({ writesEnabledByEnv: false });
    world.addCampaign(dueCampaign(1, 1));
    await world.ticker.runTick();
    expect(world.statusOf(1)).toBe('needs_key');
    expect(world.campaigns.get(1)?.statusReason).toContain('writes_disabled');
  });

  it('zlyhaný canary GET → needs_key s dôvodom shop_unreachable', async () => {
    const world = makeWorld({ canaryOk: false });
    world.addCampaign(dueCampaign(1, 1));
    await world.ticker.runTick();
    expect(world.statusOf(1)).toBe('needs_key');
    expect(world.campaigns.get(1)?.statusReason).toContain('shop_unreachable');
    expect(world.executorCalls).toHaveLength(0);
  });

  it('nezapojený executor → needs_key (fail-closed), nikdy priamy zápis', async () => {
    const world = makeWorld({ executor: null });
    world.addCampaign(dueCampaign(1, 1));
    await world.ticker.runTick();
    expect(world.statusOf(1)).toBe('needs_key');
    expect(world.campaigns.get(1)?.statusReason).toContain('executor_unavailable');
  });
});

describe('tick — polnočné zamrznutie (D59)', () => {
  it('fire v ±60 s okolo polnoci Bratislavy sa preskočí do ďalšieho ticku', async () => {
    // 2026-08-05 00:00:30 Bratislava (UTC+2) = 2026-08-04T22:00:30Z.
    const frozenNow = new Date('2026-08-04T22:00:30.000Z');
    const clock = makeClock(frozenNow);
    const world = makeWorld({ clock });
    world.addCampaign(dueCampaign(1, 1, frozenNow));

    const first = await world.ticker.runTick();
    expect(first.fired).toBe(0);
    expect(world.statusOf(1)).toBe('scheduled');
    expect(world.executorCalls).toHaveLength(0);

    // O 2 minúty neskôr už okno nie je zamrznuté a fire prebehne.
    clock.advanceMinutes(2);
    const second = await world.ticker.runTick();
    expect(second.fired).toBe(1);
    expect(world.statusOf(1)).toBe('done');
  });
});

describe('tick — odolnosť (D87)', () => {
  it('výnimka executora nezhodí tick — kampaň fail-closed do needs_key, heartbeat sa zapíše', async () => {
    const world = makeWorld({
      executor: async () => {
        throw new Error('executor exploded');
      },
    });
    world.addCampaign(dueCampaign(1, 1));

    const result = await world.ticker.runTick();

    expect(result.error).toBeNull();
    expect(world.heartbeats).toHaveLength(1);
    expect(world.statusOf(1)).toBe('needs_key');
    expect(world.campaigns.get(1)?.statusReason).toContain('fire_error');
  });

  it('výnimka v kroku ticku nezhodí proces a skončí v last_error heartbeatu', async () => {
    const world = makeWorld({ failSetStatus: true });
    // Kampaň zmeškaná o 10 min → krok missed volá sabotovaný setStatus.
    world.addCampaign(dueCampaign(1, 10));

    const result = await world.ticker.runTick();

    expect(result.error).toContain('setStatus sabotovaný testom');
    expect(world.heartbeats).toHaveLength(1);
    expect(world.heartbeats[0]?.lastError).toContain('setStatus sabotovaný testom');

    // Ďalší tick normálne beží — proces žije.
    const next = await world.ticker.runTick();
    expect(world.heartbeats).toHaveLength(2);
    void next;
  });
});

describe('reminders — pásma 48/24/2 h (D26)', () => {
  it('bandFor vracia najbližšie pásmo', () => {
    expect(bandFor(1.5)).toBe(2);
    expect(bandFor(2)).toBe(2);
    expect(bandFor(10)).toBe(24);
    expect(bandFor(30)).toBe(48);
    expect(bandFor(48)).toBe(48);
    expect(bandFor(49)).toBeNull();
    expect(bandFor(0)).toBeNull();
    expect(bandFor(-1)).toBeNull();
  });

  it('tick naplní aktívne pripomienky pre scheduled kampane', async () => {
    const world = makeWorld();
    world.addCampaign(
      makeConfirmedCampaign({
        id: 7,
        status: 'scheduled',
        fireAt: new Date(TEST_NOW.getTime() + 90 * MINUTE), // 1,5 h → pásmo 2
      }),
    );
    world.addCampaign(
      makeConfirmedCampaign({
        id: 8,
        status: 'scheduled',
        fireAt: new Date(TEST_NOW.getTime() + 30 * 60 * MINUTE), // 30 h → pásmo 48
      }),
    );

    await world.ticker.runTick();

    const reminders = getActiveReminders();
    expect(reminders.map((r) => [r.campaignId, r.band])).toEqual([
      [7, 2],
      [8, 48],
    ]);
  });
});


describe('D25 — prepadnuté okno pri fire sa NEclaimuje (E7)', () => {
  it('kampaň s to < dnes ide do lapsed bez claimu a bez falošného campaign_claimed', async () => {
    const world = makeWorld();
    world.addCampaign(
      makeConfirmedCampaign({
        id: 5,
        status: 'scheduled',
        fireAt: new Date(TEST_NOW.getTime() - 1 * MINUTE), // due, ešte nie missed
        dateFrom: '2026-07-01',
        dateTo: '2026-08-01', // celé okno v minulosti (dnes je 2026-08-05)
      }),
    );

    const result = await world.ticker.runTick();

    expect(world.statusOf(5)).toBe('lapsed');
    expect(result.fired).toBe(0);
    expect(world.executorCalls).toHaveLength(0);
    expect(world.auditEvents()).toContain('campaign_lapsed');
    // Pred opravou: claim PRED prepočtom okna → falošný campaign_claimed
    // a neexistujúci prechod running → lapsed.
    expect(world.auditEvents()).not.toContain('campaign_claimed');
  });
});
