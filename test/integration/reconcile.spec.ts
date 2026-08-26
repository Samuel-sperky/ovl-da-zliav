/**
 * Aura Zľavy — reconciliácia po havárii (D86, §9 krok 3; KONTRAKT V3 K2, K6).
 *
 * Overuje sa:
 *  - reconcile beží VÝHRADNE pri prvom ticku po štarte,
 *  - položky potvrdené auditom (`write_ok` s rovnakým `request_id`) zostávajú OK,
 *  - položka, ktorej zápis MOHOL odísť (má `request_id`, chýba potvrdenie), je
 *    `uncertain` na manuálne rozhodnutie,
 *  - položka, ktorá sa nikdy nezačala zapisovať (`pending` bez `request_id`),
 *    zostáva `pending` a kampaň sa VRACIA DO FRONTY (`queued`),
 *  - kampaň, ktorej už nič nezostáva, prejde do `partial`/`failed` + audit
 *    `reconcile_uncertain`,
 *  - automatický re-run NEPREBEHNE (executor sa nevolá).
 *
 * ── Prečo sa tvrdenie tohto testu ZMENILO (audit 30, nález L3) ──────────────
 *
 * Do 26. 8. 2026 tu stálo, že `pending` položka sa po havárii stane `uncertain`
 * a kampaň sa zavrie ako `partial`/`failed`. Bolo to napísané v čase, keď dávka
 * mala desať produktov a zmestila sa do jedného behu — vtedy „proces spadol
 * uprostred dávky" naozaj znamenalo „o celej dávke nevieme".
 *
 * K2 zaviedol frontu 200 zápisov na deň, takže 8 000 produktov beží 40 dní a v
 * momente reštartu je nezapísaná VÄČŠINA kampane. Reštart kontejnera je pritom
 * normálna cesta upgradu (D100), nie havária. Staré tvrdenie preto zamykalo dva
 * defekty naraz:
 *  - K6 („žiadny zápis sa nestratí") — kampaň zavretá s `finished_at` zmizne
 *    z `findQueued()` a zvyšných 7 800 zápisov už nikto nezapíše,
 *  - I11 — položka, o ktorej sa VIE, že sa neodoslala (nemá `request_id`, teda
 *    ani `write_attempt`), sa označila za „nevieme".
 *
 * D86 sa tým neruší: `uncertain` naďalej dostane každá položka, ktorej zápis
 * mohol odísť, a automatický re-run neprebehne — executor sa `uncertain`
 * položky už nikdy nedotkne, spracúva výhradne `pending`.
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
  it('potvrdené OK zostáva, rozbehnutý zápis je uncertain, nikdy neposlané ostávajú vo fronte', async () => {
    // `queueExecutor: null` — tento test skúma VÝSTUP reconcilu, nie to, čo s
    // kampaňou urobí fronta o krok neskôr (na to je ďalší test).
    const world = makeWorld({ queueExecutor: null });
    const campaign = crashedCampaign(1);
    world.addCampaign(campaign);

    const confirmedRequestId = testUlid();
    const unconfirmedRequestId = testUlid();
    const inFlightRequestId = testUlid();
    world.addItem(
      makeCampaignItem({ id: 1, campaignId: 1, productId: 201, position: 1, status: 'ok', requestId: confirmedRequestId }),
    );
    // 'ok' v DB, ale bez write_ok v audite — po havárii NEVERIŤ, ide do uncertain.
    world.addItem(
      makeCampaignItem({ id: 2, campaignId: 1, productId: 202, position: 2, status: 'ok', requestId: unconfirmedRequestId }),
    );
    // `pending` s `request_id`: executor už bol za `write_attempt` a request
    // MOHOL odísť — presne to je „nevieme" podľa D86.
    world.addItem(
      makeCampaignItem({ id: 3, campaignId: 1, productId: 203, position: 3, status: 'pending', requestId: inFlightRequestId }),
    );
    // `pending` bez `request_id`: `write_attempt` nikdy nevznikol, do shopu nič
    // neodišlo. Zostáva vo fronte (K6, I11).
    world.addItem(
      makeCampaignItem({ id: 4, campaignId: 1, productId: 204, position: 4, status: 'pending' }),
    );
    world.confirmedWrites.set(1, [confirmedRequestId]);

    const result = await world.ticker.runTick();

    expect(result.reconciled).toBe(1);
    expect(world.items.get(1)?.status).toBe('ok');
    expect(world.items.get(2)?.status).toBe('uncertain');
    expect(world.items.get(3)?.status).toBe('uncertain');
    expect(world.items.get(4)?.status).toBe('pending');
    // Nikdy neposlaná položka sa NEDOTKLA: bez error kódu a bez `finished_at`.
    expect(world.items.get(4)?.errorCode).toBeNull();
    expect(world.items.get(4)?.finishedAt).toBeNull();

    const record = world.campaigns.get(1);
    expect(record?.status).toBe('queued');
    expect(record?.itemsOk).toBe(1);
    expect(record?.itemsUncertain).toBe(2);
    // `queued` nie je výsledok: nedobehnutá kampaň nesmie mať `finished_at`.
    expect(record?.finishedAt).toBeNull();
    expect(world.auditEvents()).toContain('reconcile_uncertain');

    // Automatický re-run NEPREBEHOL.
    expect(world.executorCalls).toHaveLength(0);
  });

  it('kampaň s nezapísanými položkami sa vracia do fronty a fronta ju prevezme', async () => {
    const world = makeWorld();
    world.addCampaign(crashedCampaign(1));
    world.addItem(makeCampaignItem({ id: 1, campaignId: 1, productId: 201, position: 1, status: 'pending' }));
    world.addItem(makeCampaignItem({ id: 2, campaignId: 1, productId: 202, position: 2, status: 'pending' }));

    const result = await world.ticker.runTick();

    expect(result.reconciled).toBe(1);
    // Ani jedna položka sa nezmenila na „nevieme" — ani jedna neodišla.
    expect(world.items.get(1)?.status).toBe('pending');
    expect(world.items.get(2)?.status).toBe('pending');
    // K6 — jadro nálezu L3: kampaň je po reconcile stále vo fronte, takže
    // `findQueued()` ju nájde a zvyšné zápisy sa dopíšu.
    expect(world.queueCalls.map((c) => c.id)).toContain(1);
    expect(result.queueProcessed).toBe(1);
  });

  it('kampaň bez nezapísaných položiek sa uzavrie ako failed', async () => {
    const world = makeWorld();
    world.addCampaign(crashedCampaign(1));
    // Obe položky boli v momente havárie rozbehnuté (majú `request_id`) a ani
    // jedna nemá potvrdenie — nezostáva nič, čo by sa dalo dopísať.
    world.addItem(
      makeCampaignItem({ id: 1, campaignId: 1, productId: 201, position: 1, status: 'pending', requestId: testUlid() }),
    );
    world.addItem(
      makeCampaignItem({ id: 2, campaignId: 1, productId: 202, position: 2, status: 'pending', requestId: testUlid() }),
    );

    await world.ticker.runTick();

    expect(world.statusOf(1)).toBe('failed');
    expect(world.items.get(1)?.status).toBe('uncertain');
    expect(world.items.get(2)?.status).toBe('uncertain');
    expect(world.campaigns.get(1)?.finishedAt).not.toBeNull();
    expect(world.campaigns.get(1)?.resultAckAt).toBeNull();
    expect(world.executorCalls).toHaveLength(0);
    expect(world.queueCalls).toHaveLength(0);
  });

  it('rozhodnuté položky (failed/not_found/skipped/interrupted) reconcile neprepisuje', async () => {
    const world = makeWorld();
    world.addCampaign(crashedCampaign(1));
    const confirmed = testUlid();
    world.addItem(makeCampaignItem({ id: 1, campaignId: 1, productId: 201, position: 1, status: 'ok', requestId: confirmed }));
    world.addItem(makeCampaignItem({ id: 2, campaignId: 1, productId: 202, position: 2, status: 'failed' }));
    world.addItem(makeCampaignItem({ id: 3, campaignId: 1, productId: 203, position: 3, status: 'not_found' }));
    // D85/D51 — `interrupted` znamená „zápis sa neodoslal, čaká na retry". Prepis
    // na `uncertain` by zahodil istotu a odrezal položku od dopálenia z needs_key.
    world.addItem(makeCampaignItem({ id: 4, campaignId: 1, productId: 204, position: 4, status: 'interrupted' }));
    world.confirmedWrites.set(1, [confirmed]);

    await world.ticker.runTick();

    expect(world.items.get(2)?.status).toBe('failed');
    expect(world.items.get(3)?.status).toBe('not_found');
    expect(world.items.get(4)?.status).toBe('interrupted');
    expect(world.statusOf(1)).toBe('partial');
    expect(world.campaigns.get(1)?.itemsUncertain).toBe(0);
    // `not_found` a `interrupted` sa z počítadla neúspešných nesmú vytratiť.
    expect(world.campaigns.get(1)?.itemsFailed).toBe(3);
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
