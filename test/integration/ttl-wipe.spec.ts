/**
 * Aura Zľavy — TTL wipe kľúča v ticku (D63, §9 krok 2).
 *
 * Overuje sa:
 *  - expirovaný kľúč je wipnutý minútovým tickom AJ KEĎ sa appky nikto
 *    nedotkne (žiadne kampane, žiadne requesty),
 *  - wipe je PRVÝ vecný krok ticku — due kampaň v tom istom ticku už
 *    expirovaný kľúč nedostane,
 *  - platný kľúč sa newipuje,
 *  - wipe prebehne len raz (idempotencia naprieč tickami).
 */
import { describe, expect, it } from 'vitest';

import { makeConfirmedCampaign, TEST_NOW } from '../helpers/factories';
import { makeClock, makeWorld } from './scheduler-fakes';

const MINUTE = 60_000;

describe('TTL wipe (D63)', () => {
  it('expirovaný kľúč je wipnutý aj bez akéhokoľvek iného diania', async () => {
    const world = makeWorld({
      keyMeta: { expiresAt: new Date(TEST_NOW.getTime() - 1) },
    });
    // Žiadne kampane — appky sa „nikto nedotkol".
    const result = await world.ticker.runTick();

    expect(result.keyWiped).toBe(true);
    expect(world.wipes).toEqual(['ttl_expired']);
    expect(world.keyMeta.present).toBe(false);
    expect(world.auditEvents()).toContain('key_wiped');
  });

  it('kľúč expiruje medzi tickami → wipne ho najbližší tick', async () => {
    const clock = makeClock();
    const world = makeWorld({
      clock,
      keyMeta: { expiresAt: new Date(TEST_NOW.getTime() + 90 * MINUTE) },
    });

    await world.ticker.runTick();
    expect(world.wipes).toHaveLength(0);

    clock.advanceMinutes(91);
    const result = await world.ticker.runTick();
    expect(result.keyWiped).toBe(true);
    expect(world.wipes).toEqual(['ttl_expired']);
  });

  it('platný kľúč sa newipuje', async () => {
    const world = makeWorld();
    const result = await world.ticker.runTick();
    expect(result.keyWiped).toBe(false);
    expect(world.wipes).toHaveLength(0);
    expect(world.keyMeta.present).toBe(true);
  });

  it('wipe beží PRED due krokom — kampaň ide do needs_key, žiadny executor', async () => {
    const world = makeWorld({
      keyMeta: { expiresAt: new Date(TEST_NOW.getTime() - MINUTE) },
    });
    world.addCampaign(
      makeConfirmedCampaign({
        id: 1,
        status: 'scheduled',
        fireAt: new Date(TEST_NOW.getTime() - MINUTE),
        dateFrom: '2026-08-05',
        dateTo: '2026-08-20',
      }),
    );

    const result = await world.ticker.runTick();

    expect(result.keyWiped).toBe(true);
    expect(world.statusOf(1)).toBe('needs_key');
    expect(world.executorCalls).toHaveLength(0);
    // Poradie auditu: najprv key_wiped, až potom campaign_needs_key.
    const events = world.auditEvents();
    expect(events.indexOf('key_wiped')).toBeLessThan(events.indexOf('campaign_needs_key'));
  });

  it('wipe prebehne len raz — ďalšie ticky už nemajú čo wipnúť', async () => {
    const world = makeWorld({
      keyMeta: { expiresAt: new Date(TEST_NOW.getTime() - 1) },
    });
    await world.ticker.runTick();
    await world.ticker.runTick();
    await world.ticker.runTick();
    expect(world.wipes).toEqual(['ttl_expired']);
  });
});
