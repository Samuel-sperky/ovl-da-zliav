/**
 * Aura Zľavy — odchýlka D33b: zmeškaný fire sa NIKDY nedobehne automaticky.
 *
 * Najtvrdšia požiadavka úlohy A10: kampaň so `fire_at` starším než 5 min
 * prejde do `missed` a ŽIADNY počet ďalších tickov ju nespustí. Dopáliť ju
 * smie výhradne manuálna akcia (`/execute`, A12) s novým potvrdením.
 *
 * Test navyše statickou kontrolou zdrojákov overuje, že v scheduleri
 * neexistuje catch-up konštanta ani vetva, ktorá by `missed` kampaň claimla.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeConfirmedCampaign, TEST_NOW } from '../helpers/factories';
import { makeClock, makeWorld } from './scheduler-fakes';

const MINUTE = 60_000;

describe('D33b — missed detekcia', () => {
  it('kampaň so fire_at starším než 5 min prejde do missed + audit', async () => {
    const world = makeWorld();
    world.addCampaign(
      makeConfirmedCampaign({
        id: 1,
        status: 'scheduled',
        fireAt: new Date(TEST_NOW.getTime() - 6 * MINUTE),
      }),
    );

    const result = await world.ticker.runTick();

    expect(result.missed).toBe(1);
    expect(world.statusOf(1)).toBe('missed');
    expect(world.auditEvents()).toContain('campaign_missed');
    expect(world.campaigns.get(1)?.statusReason).toContain('Zmeškaný fire');
    // Nikdy sa nedostala k executoru ani ku canary.
    expect(world.executorCalls).toHaveLength(0);
    expect(world.canaryCalls).toBe(0);
  });

  it('kampaň vo vnútri 5-min tolerancie NIE JE missed a normálne sa spustí', async () => {
    const world = makeWorld();
    world.addCampaign(
      makeConfirmedCampaign({
        id: 1,
        status: 'scheduled',
        fireAt: new Date(TEST_NOW.getTime() - 4 * MINUTE),
        dateFrom: '2026-08-05',
        dateTo: '2026-08-20',
      }),
    );

    const result = await world.ticker.runTick();

    expect(result.missed).toBe(0);
    expect(result.fired).toBe(1);
    expect(world.statusOf(1)).toBe('done');
  });

  it('ŽIADNY počet ďalších tickov missed kampaň nespustí — ani po hodinách', async () => {
    const clock = makeClock();
    const world = makeWorld({ clock });
    world.addCampaign(
      makeConfirmedCampaign({
        id: 1,
        status: 'scheduled',
        fireAt: new Date(TEST_NOW.getTime() - 10 * MINUTE),
        dateFrom: '2026-08-05',
        dateTo: '2026-12-31', // okno je stále živé — o to tvrdší test
      }),
    );

    await world.ticker.runTick();
    expect(world.statusOf(1)).toBe('missed');

    for (let i = 0; i < 50; i += 1) {
      clock.advanceMinutes(17);
      await world.ticker.runTick();
    }

    expect(world.statusOf(1)).toBe('missed');
    expect(world.executorCalls).toHaveLength(0);
    expect(world.canaryCalls).toBe(0);
    // Ani jeden claim/needs_key pre túto kampaň po označení missed.
    const eventsAfterMissed = world.auditEvents().filter((e) => e !== 'campaign_missed');
    expect(eventsAfterMissed).not.toContain('campaign_claimed');
  });
});

describe('D33b — statická kontrola zdrojákov schedulera', () => {
  it("scheduler nikdy neclaimuje zo stavu 'missed' a nemá catch-up vetvu", () => {
    const dir = join(process.cwd(), 'src', 'lib', 'scheduler');
    const sources = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));

    expect(sources.length).toBeGreaterThanOrEqual(6);
    for (const { file, text } of sources) {
      // claim() sa v schedulery volá VÝHRADNE so ['scheduled'] — nikdy 'missed'.
      const claimCalls = text.match(/\.claim\([^)]*\)/g) ?? [];
      for (const call of claimCalls) {
        expect(call, `${file}: ${call}`).not.toContain('missed');
      }
      // Žiadna catch-up konštanta/vetva.
      expect(text.toLowerCase(), file).not.toContain('catchup');
      expect(text.toLowerCase(), file).not.toContain('catch_up');
      expect(text.toLowerCase(), file).not.toContain('catch-up okno: áno');
    }
  });
});
