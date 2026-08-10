/**
 * Aura Zľavy — FRONTA A DENNÝ ROZPOČET (V5, KONTRAKT V3 K2 + K3).
 *
 * Reálny shop klient proti reálnemu mock shopu (I6); repozitáre a audit sú
 * in-memory. Toto je povinný dôkaz k V5:
 *
 *   po vyčerpaní rozpočtu je stav `queued`, položky zostávajú `pending`
 *   a druhý deň sa pokračuje PRESNE tam, kde sa skončilo — žiadna položka
 *   sa nezapíše dvakrát a žiadna sa nepreskočí.
 *
 * Tri veci, ktoré test drží navyše:
 *  - **K3** — do shopu ide percento POLOŽKY (pásma), nie `campaigns.percent`.
 *  - **I10** — zápisy idú striktne sekvenčne podľa `position`.
 *  - **K2 (rýchlosť)** — pauza je závislosť (`sleepFn`), takže sa dá v teste
 *    preskočiť; produkčnú podlahu ≥ 3 s drží `executorFlagsFromEnv()`, čo je
 *    tiež overené nižšie.
 *
 * Čas beží cez injektovaný `now()`: „druhý deň" je posun UTC dňa, nie
 * `setTimeout`. Spotreba sa počíta z auditu (`write_attempt`) za UTC deň —
 * počítadlo tu preto nie je stav testu, ale odvodenina z auditných záznamov.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { AuditInput, CampaignRecord } from '@/contracts';

import { computePayloadHash } from '@/lib/crypto/preview-token';
import { budgetDay, type WriteAttemptCounter } from '@/lib/engine/budget';
import {
  MIN_WRITE_PAUSE_MS,
  createExecutor,
  executorFlagsFromEnv,
  resetGracefulStop,
  type ExecutorFlags,
} from '@/lib/engine/executor';
import { createWriteMutex } from '@/lib/engine/mutex';
import {
  createMemoryAllowlistRepo,
  createMemoryApiKeyRepo,
  createMemoryAudit,
  createMemoryCampaignWorld,
  createMemorySettingsRepo,
} from '@/lib/engine/testing';
import { createShopClient } from '@/lib/shop/client';

import { useMockShop, VALID_API_KEY } from '../helpers/mock';
import { makeCampaign } from '../helpers/factories';

const mock = useMockShop();

const PRODUCT_IDS = [201, 202, 203, 204, 205];

/** K3 — dve pásma v jednej zľave. Hlavička nesie NAJVYŠŠIE percento. */
const TIER_PERCENT: Record<number, number> = {
  201: 30,
  202: 30,
  203: 20,
  204: 20,
  205: 20,
};
const HEADER_PERCENT = 30;

const DATE_FROM = '2026-08-20';
const DATE_TO = '2026-09-20';

const FLAGS: ExecutorFlags = {
  nodeEnv: 'production',
  writesEnabled: true,
  maxProductsPerOperation: 10,
  runawayLimitPerHour: 60,
  // K2: rozpočet 2 zápisy na deň — 5 produktov teda vyžaduje tri dni.
  dailyWriteBudget: 2,
  // Pauza je závislosť; test ju nastavuje na 0 a `sleepFn` ju len počíta.
  writePauseMs: 0,
};

function makeQueueWorld() {
  mock.state.setProducts(
    PRODUCT_IDS.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );

  /** Posúvateľné „teraz" — deň fronty sa mení posunom, nie čakaním. */
  let clock = new Date('2026-08-10T09:00:00.000Z');
  const now = (): Date => clock;
  const advanceOneDay = (): void => {
    clock = new Date(clock.getTime() + 86_400_000);
  };

  const world = createMemoryCampaignWorld();
  const settingsRepo = createMemorySettingsRepo();
  const allowlistRepo = createMemoryAllowlistRepo(PRODUCT_IDS);
  const baseAudit = createMemoryAudit();

  /**
   * K2 — spotreba sa počíta z auditu. Fake si preto značí `write_attempt`
   * podľa UTC dňa, v ktorom event vznikol; nič iné rozpočet nemíňa.
   */
  const attemptsByDay = new Map<string, number>();
  const audit = {
    ...baseAudit,
    async appendAudit(input: AuditInput): Promise<void> {
      if (input.eventType === 'write_attempt') {
        const day = budgetDay(now());
        attemptsByDay.set(day, (attemptsByDay.get(day) ?? 0) + 1);
      }
      await baseAudit.appendAudit(input);
    },
  };
  const writeAttemptCounter: WriteAttemptCounter = {
    async countWriteAttemptsOn(day: string) {
      return attemptsByDay.get(day) ?? 0;
    },
  };

  const campaign: CampaignRecord = {
    ...makeCampaign({ productIds: PRODUCT_IDS, percent: HEADER_PERCENT, status: 'scheduled' }),
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
    confirmedAt: new Date(),
    sudoAt: new Date(),
    // K4 — hash nad trojicami `id:percent:price`. Percentá sú PÁSMOVÉ, takže
    // hlavičkové `HEADER_PERCENT` do hashu nevstupuje ani raz (K3).
    confirmPayloadHash: computePayloadHash({
      kind: 'new',
      from: DATE_FROM,
      to: DATE_TO,
      items: PRODUCT_IDS.map((productId) => ({
        productId,
        percent: TIER_PERCENT[productId] as number,
        priceAtPreview: '19.99' as const,
      })),
    }),
  };
  world.seedCampaign(
    campaign,
    PRODUCT_IDS.map((productId) => ({ productId, priceAtPreview: '19.99' })),
  );
  // K3 — percento pásma je na POLOŽKE. `createMemoryCampaignWorld()` (A9) ho
  // zatiaľ neseje, tak sa doplní tu; executor ho z hlavičky NIKDY nedopočíta.
  for (const item of world.campaignItemsRepo.items.values()) {
    Object.assign(item, { percent: TIER_PERCENT[item.productId] });
  }

  const sleeps: number[] = [];
  const executor = createExecutor({
    shopClient: createShopClient({
      baseUrl: () => mock.baseUrl,
      version: '0.1.0-test',
      readTimeoutMs: 2000,
      writeTimeoutMs: 2000,
    }),
    campaignsRepo: world.campaignsRepo,
    campaignItemsRepo: world.campaignItemsRepo,
    allowlistRepo,
    settingsRepo,
    auditRepo: audit,
    writeAttemptCounter,
    apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
    audit,
    mutex: createWriteMutex({ dbLock: null }),
    flags: FLAGS,
    now,
    // Pauza ≥ 3 s je injektovaná závislosť — inak by tento test bežal minúty.
    sleepFn: async (ms: number) => {
      sleeps.push(ms);
    },
  });

  return { executor, world, audit, sleeps, advanceOneDay, attemptsByDay };
}

const statusesOf = async (world: ReturnType<typeof createMemoryCampaignWorld>) =>
  (await world.campaignItemsRepo.listByCampaign(1)).map((i) => i.status);

beforeEach(() => {
  resetGracefulStop();
});

describe('K2 — vyčerpaný rozpočet vráti kampaň do fronty', () => {
  it('po dvoch zápisoch je stav `queued`, zvyšok `pending` a nič nie je chyba', async () => {
    const { executor, world } = makeQueueWorld();

    const result = await executor.executeCampaign(1);

    expect(result.status).toBe('queued');
    // Nie `failed` a nie `partial` — vyčerpaný rozpočet je informácia (K2).
    expect(result.status).not.toBe('failed');
    expect(result.status).not.toBe('partial');

    const campaign = world.campaignsRepo.campaigns.get(1);
    expect(campaign?.status).toBe('queued');
    expect(campaign?.statusReason).toBe('budget_exhausted');
    // Kampaň nedobehla — `finished_at` sa nesmie nastaviť.
    expect(campaign?.finishedAt).toBeNull();

    expect(await statusesOf(world)).toEqual(['ok', 'ok', 'pending', 'pending', 'pending']);
    expect(mock.state.writeRequests()).toHaveLength(2);
  });

  it('druhý deň sa pokračuje presne tam, kde sa skončilo (žiadny duplikát, žiadne preskočenie)', async () => {
    const { executor, world, advanceOneDay } = makeQueueWorld();

    // Deň 1: 2 zápisy → queued.
    expect((await executor.executeCampaign(1)).status).toBe('queued');
    // Deň 2: ďalšie 2 → stále queued.
    advanceOneDay();
    expect((await executor.executeCampaign(1)).status).toBe('queued');
    expect(await statusesOf(world)).toEqual(['ok', 'ok', 'ok', 'ok', 'pending']);
    // Deň 3: posledná položka → done.
    advanceOneDay();
    const finished = await executor.executeCampaign(1);

    expect(finished.status).toBe('done');
    expect(finished.itemsOk).toBe(5);
    expect(await statusesOf(world)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(world.campaignsRepo.campaigns.get(1)?.status).toBe('done');

    // I10 + K2: každý produkt práve raz, v poradí `position`.
    const written = mock.state.writeRequests().map((r) => r.body.id);
    expect(written).toEqual(['201', '202', '203', '204', '205']);
    expect(new Set(written).size).toBe(written.length);
  });

  it('K3 — do shopu ide percento POLOŽKY, nie percento kampane', async () => {
    const { executor, advanceOneDay } = makeQueueWorld();

    await executor.executeCampaign(1);
    advanceOneDay();
    await executor.executeCampaign(1);
    advanceOneDay();
    await executor.executeCampaign(1);

    const sent = mock.state.writeRequests().map((r) => ({
      id: r.body.id,
      reduction: r.body.reduction,
    }));
    expect(sent).toEqual([
      { id: '201', reduction: '30' },
      { id: '202', reduction: '30' },
      { id: '203', reduction: '20' },
      { id: '204', reduction: '20' },
      { id: '205', reduction: '20' },
    ]);
  });

  it('rozpočet sa počíta z auditu — `write_attempt` sedí s počtom zápisov', async () => {
    const { executor, audit, attemptsByDay, advanceOneDay } = makeQueueWorld();

    await executor.executeCampaign(1);
    expect(attemptsByDay.get('2026-08-10')).toBe(2);
    expect(audit.byEvent('write_attempt')).toHaveLength(2);

    advanceOneDay();
    await executor.executeCampaign(1);
    // Nový UTC deň = nový rozpočet; včerajšia spotreba sa neprenáša.
    expect(attemptsByDay.get('2026-08-11')).toBe(2);
    expect(audit.byEvent('write_attempt')).toHaveLength(4);
  });

  it('nečitateľný rozpočet zastaví frontu fail-closed do `queued`, nie do `failed`', async () => {
    const { world } = makeQueueWorld();
    const executor = createExecutor({
      shopClient: createShopClient({
        baseUrl: () => mock.baseUrl,
        version: '0.1.0-test',
        readTimeoutMs: 2000,
        writeTimeoutMs: 2000,
      }),
      campaignsRepo: world.campaignsRepo,
      campaignItemsRepo: world.campaignItemsRepo,
      allowlistRepo: createMemoryAllowlistRepo(PRODUCT_IDS),
      settingsRepo: createMemorySettingsRepo(),
      auditRepo: createMemoryAudit(),
      audit: createMemoryAudit(),
      apiKeyRepo: createMemoryApiKeyRepo(VALID_API_KEY),
      mutex: createWriteMutex({ dbLock: null }),
      flags: FLAGS,
      now: () => new Date('2026-08-10T09:00:00.000Z'),
      sleepFn: async () => {},
      budget: {
        async spentToday() {
          throw new Error('audit nie je dostupný');
        },
        async remainingToday(): Promise<never> {
          throw new Error('audit nie je dostupný');
        },
      },
    });

    const result = await executor.executeCampaign(1);

    expect(result.status).toBe('queued');
    expect(world.campaignsRepo.campaigns.get(1)?.statusReason).toBe('budget_unknown');
    expect(await statusesOf(world)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    // Fail-closed: na shop nešiel ANI JEDEN request.
    expect(mock.state.requestCount).toBe(0);
  });
});

describe('K2 — rýchlosť zápisu (20/min)', () => {
  it('produkčná pauza je ≥ 3 s, testovacia sa injektuje', () => {
    expect(MIN_WRITE_PAUSE_MS).toBe(3000);
    // Produkčné flagy čítajú env, ale podlahu drží executor — 250 ms z D46
    // by pri 20 zápisoch/min znamenalo 4× prekročený strop.
    expect(executorFlagsFromEnv().writePauseMs).toBeGreaterThanOrEqual(MIN_WRITE_PAUSE_MS);
  });

  it('medzi položkami sa pauzuje, po poslednej nie', async () => {
    const { executor, sleeps, advanceOneDay } = makeQueueWorld();

    await executor.executeCampaign(1);
    // Dva zápisy a za nimi ešte čakajúce položky → dve pauzy. Druhá pauza
    // padne tesne pred tým, než rozpočet dávku zastaví; je to 3 s denne
    // navyše a je to lacnejšie než ďalšie čítanie rozpočtu len kvôli nej.
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((ms) => ms === FLAGS.writePauseMs)).toBe(true);

    advanceOneDay();
    await executor.executeCampaign(1);
    expect(sleeps).toHaveLength(4);
  });

  it('po POSLEDNEJ položke sa už nečaká', async () => {
    const { executor, sleeps, advanceOneDay } = makeQueueWorld();

    await executor.executeCampaign(1); // 201, 202
    advanceOneDay();
    await executor.executeCampaign(1); // 203, 204
    advanceOneDay();
    const before = sleeps.length;
    await executor.executeCampaign(1); // 205 — posledná, žiadna pauza za ňou
    expect(sleeps.length).toBe(before);
  });
});

describe('K3 + K4 — položka bez percenta neprejde potvrdením', () => {
  it('kampaň sa odmietne PRED prvým requestom a na shop nedorazí nič', async () => {
    const { executor, world } = makeQueueWorld();
    const items = [...world.campaignItemsRepo.items.values()];
    // Tretia položka stratí percento (napr. import z rozbitej migrácie).
    Object.assign(items[2] as object, { percent: undefined });

    // Percento je súčasťou potvrdzovacieho hashu (K4), takže bez neho sa hash
    // nedá prepočítať — a I3 hovorí, že bez zhody sa neodošle NIČ. Zápis
    // zvyšku s percentom uhádnutým z hlavičky kampane by porušil K3.
    await expect(executor.executeCampaign(1)).rejects.toMatchObject({
      name: 'EngineError',
      code: 'confirmation_mismatch',
    });

    expect(mock.state.requestCount).toBe(0);
    expect(await statusesOf(world)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
  });
});
