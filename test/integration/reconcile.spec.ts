/**
 * Aura Zľavy — reconciliácia po havárii (D86, §9 krok 3).
 *
 * Overuje sa:
 *  - reconcile beží VÝHRADNE pri prvom ticku po štarte,
 *  - položky potvrdené auditom (`write_ok` s rovnakým `request_id`) zostávajú OK,
 *  - všetko ostatné je `uncertain` na manuálne rozhodnutie,
 *  - kampaň prejde do `partial`/`failed` + audit `reconcile_uncertain`,
 *  - automatický re-run NEPREBEHNE (executor sa nevolá).
 */
import { describe, expect, it } from 'vitest';

import { makeCampaignItem, makeConfirmedCampaign, testUlid, TEST_NOW } from '../helpers/factories';
import { makeWorld } from './scheduler-fakes';

function crashedCampaign(id: number) {
  return makeConfirmedCampaign({
    id,
    status: 'running',
    startedAt: new Date(TEST_NOW.getTime() - 60_000),
    finishedAt: null,
    fireAt: new Date(TEST_NOW.getTime() - 60_000),
  });
}

describe('reconcile po havárii (D86)', () => {
  it('potvrdené OK zostáva, nepotvrdené je uncertain, kampaň je partial', async () => {
    const world = makeWorld();
    const campaign = crashedCampaign(1);
    world.addCampaign(campaign);

    const confirmedRequestId = testUlid();
    const unconfirmedRequestId = testUlid();
    world.addItem(
      makeCampaignItem({ id: 1, campaignId: 1, productId: 201, position: 1, status: 'ok', requestId: confirmedRequestId }),
    );
    // 'ok' v DB, ale bez write_ok v audite — po havárii NEVERIŤ, ide do uncertain.
    world.addItem(
      makeCampaignItem({ id: 2, campaignId: 1, productId: 202, position: 2, status: 'ok', requestId: unconfirmedRequestId }),
    );
    world.addItem(
      makeCampaignItem({ id: 3, campaignId: 1, productId: 203, position: 3, status: 'pending' }),
    );
    world.confirmedWrites.set(1, [confirmedRequestId]);

    const result = await world.ticker.runTick();

    expect(result.reconciled).toBe(1);
    expect(world.items.get(1)?.status).toBe('ok');
    expect(world.items.get(2)?.status).toBe('uncertain');
    expect(world.items.get(3)?.status).toBe('uncertain');

    const record = world.campaigns.get(1);
    expect(record?.status).toBe('partial');
    expect(record?.itemsOk).toBe(1);
    expect(record?.itemsUncertain).toBe(2);
    expect(record?.finishedAt).not.toBeNull();
    expect(record?.resultAckAt).toBeNull();
    expect(world.auditEvents()).toContain('reconcile_uncertain');

    // Automatický re-run NEPREBEHOL.
    expect(world.executorCalls).toHaveLength(0);
  });

  it('kampaň bez jediného potvrdeného zápisu končí ako failed', async () => {
    const world = makeWorld();
    world.addCampaign(crashedCampaign(1));
    world.addItem(makeCampaignItem({ id: 1, campaignId: 1, productId: 201, position: 1, status: 'pending' }));
    world.addItem(makeCampaignItem({ id: 2, campaignId: 1, productId: 202, position: 2, status: 'pending' }));

    await world.ticker.runTick();

    expect(world.statusOf(1)).toBe('failed');
    expect(world.items.get(1)?.status).toBe('uncertain');
    expect(world.items.get(2)?.status).toBe('uncertain');
    expect(world.executorCalls).toHaveLength(0);
  });

  it('rozhodnuté položky (failed/not_found/skipped) reconcile neprepisuje', async () => {
    const world = makeWorld();
    world.addCampaign(crashedCampaign(1));
    const confirmed = testUlid();
    world.addItem(makeCampaignItem({ id: 1, campaignId: 1, productId: 201, position: 1, status: 'ok', requestId: confirmed }));
    world.addItem(makeCampaignItem({ id: 2, campaignId: 1, productId: 202, position: 2, status: 'failed' }));
    world.addItem(makeCampaignItem({ id: 3, campaignId: 1, productId: 203, position: 3, status: 'not_found' }));
    world.confirmedWrites.set(1, [confirmed]);

    await world.ticker.runTick();

    expect(world.items.get(2)?.status).toBe('failed');
    expect(world.items.get(3)?.status).toBe('not_found');
    expect(world.statusOf(1)).toBe('partial');
  });

  it('reconcile beží len pri PRVOM ticku po štarte', async () => {
    const world = makeWorld();
    const first = await world.ticker.runTick();
    expect(first.reconciled).toBe(0);

    // Kampaň „zamrzne" v running až PO prvom ticku — ďalší tick ju nereconciluje.
    world.addCampaign(crashedCampaign(9));
    world.addItem(makeCampaignItem({ id: 1, campaignId: 9, productId: 201, position: 1, status: 'pending' }));

    const second = await world.ticker.runTick();
    expect(second.reconciled).toBe(0);
    expect(world.statusOf(9)).toBe('running');
  });

  it('dokončené kampane (finished_at ≠ null) reconcile nechytá', async () => {
    const world = makeWorld();
    world.addCampaign(
      makeConfirmedCampaign({ id: 1, status: 'running', finishedAt: TEST_NOW }),
    );
    const result = await world.ticker.runTick();
    expect(result.reconciled).toBe(0);
    expect(world.statusOf(1)).toBe('running');
  });
});
