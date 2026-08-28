/**
 * Aura Zľavy — `POST /api/queue/resume`: tlačidlo „Pokračovať" (V8).
 *
 * Toto je jediná cesta, ktorou sa fronta po odstávke počítača znovu rozbehne,
 * a testy strážia práve to, čo sa na nej dalo najľahšie pokaziť:
 *
 *  1. **Brána sa naozaj otvorí.** Route ju kedysi neotvárala vôbec: vrátila
 *     `ok: true`, prepadnuté zľavy vrátila do fronty a tá potom stála pred
 *     zavretou bránou až do reštartu procesu.
 *  2. **Prepadnuté zľavy sa vrátia do fronty** jedným atomickým UPDATE (I12) a
 *     každá dostane záznam v audite (I4).
 *  3. **Zľavy čakajúce na KĽÚČ sa nepredstierajú.** Tlačidlo ich nerozbehne —
 *     chýba im kľúč, nie potvrdenie — a odpoveď to musí POVEDAŤ aj s cestou,
 *     kam ísť. Inak používateľ klikne, uvidí „hotovo" a čaká na frontu, ktorá
 *     stojí na niečom úplne inom (akceptačné kritérium 6 kontraktu).
 *  4. Route do shopu NEZAPISUJE a stav zľavy okrem `missed → queued` nemení.
 *
 * Bez DB a bez `fetch` (I6).
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  AuditInput,
  CampaignListFilter,
  CampaignRecord,
  CampaignStatus,
  Paged,
} from '@/contracts';

import { createQueueResumePost } from '@/app/api/queue/resume/route';
import type { RoutesDeps } from '@/app/api/campaigns/_shared';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import { isQueuePaused, pauseQueue, resetQueueGate } from '@/lib/scheduler/pause';

/* ═══════════════════════════ 1. Fixtures ══════════════════════════════════ */

const NOW = new Date('2026-08-12T09:00:00.000Z');
const APP_ORIGIN = 'https://zlavy.local';

/**
 * Deps pre `defineRoute()`. Do 27. 8. 2026 sa tu stubovala SESSION vrstva;
 * prihlásenie zmizlo (D99), takže zostal len lokálny actor (`samuel`, id 1),
 * ktorého route potrebuje pre FK `audit_log.user_id` a pre I11 (D102).
 */
function actorDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J000000000000000RESUME01',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

function campaign(id: number, status: CampaignStatus, name: string): CampaignRecord {
  return {
    id,
    operationId: `01J00000000000000000000C0${id}`,
    name,
    kind: 'new',
    parentCampaignId: null,
    percent: 20,
    dateFrom: '2026-08-12',
    dateTo: '2026-08-31',
    dateFromOriginal: null,
    mode: 'scheduled',
    status,
    statusReason: null,
    fireAt: NOW,
    scheduledAt: NOW,
    needsKeySince: status === 'needs_key' ? NOW : null,
    claimedAt: null,
    startedAt: null,
    finishedAt: null,
    itemsTotal: 150,
    itemsOk: 0,
    itemsFailed: 0,
    itemsUncertain: 0,
    confirmedAt: NOW,
    confirmPayloadHash: 'hash',
    // 27. 8. 2026 (D100): produkčná cesta (`campaigns/_shared.ts`,
    // `campaigns/[id]/execute`) zapisuje `sudoAt: null` — sudo zmizlo. Fixtúra
    // s časom by merala stav, ktorý appka už nevyrobí.
    sudoAt: null,
    resultAckAt: null,
    createdBy: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** Metóda, ktorú táto route volať NESMIE — keby ju zavolala, test to povie. */
const forbidden = (name: string) => async (): Promise<never> => {
  throw new Error(`Route /api/queue/resume nesmie volať ${name}().`);
};

interface World {
  deps: RoutesDeps;
  audit: AuditInput[];
  requeued: number[];
  /** Ktoré `requeueMissed()` majú zlyhať (súbeh s inou kartou / schedulerom). */
  losesRace: Set<number>;
}

function makeWorld(byStatus: Partial<Record<CampaignStatus, CampaignRecord[]>>): World {
  const audit: AuditInput[] = [];
  const requeued: number[] = [];
  const losesRace = new Set<number>();

  const deps: RoutesDeps = {
    campaignsRepo: {
      create: forbidden('create'),
      getById: async () => null,
      list: async (filter: CampaignListFilter): Promise<Paged<CampaignRecord>> => {
        const status = Array.isArray(filter.status) ? filter.status[0] : filter.status;
        const data = status === undefined ? [] : (byStatus[status] ?? []);
        return { data, page: 1, perPage: filter.perPage ?? 100, total: data.length };
      },
      claim: forbidden('claim'),
      setStatus: forbidden('setStatus'),
      findUnacked: async () => [],
      ack: forbidden('ack'),
      findPlannedForProduct: async () => [],
      findFutureOverlaps: async () => [],
      lastOwnWrite: async () => null,
      requeueMissed: async (id: number) => {
        if (losesRace.has(id)) return false;
        requeued.push(id);
        return true;
      },
    },
    audit: {
      appendAudit: async (input: AuditInput) => {
        audit.push(input);
      },
    },
    // Shop klient by sa mal volať práve nikdy — táto route nezapisuje (I8', K11).
    shopClient: {
      batchGetProducts: forbidden('shopClient.batchGetProducts'),
      getProduct: forbidden('shopClient.getProduct'),
      setReduction: forbidden('shopClient.setReduction'),
    },
    now: () => NOW,
  };

  return { deps, audit, requeued, losesRace };
}

interface ResumeBody {
  ok: boolean;
  data: {
    resumed: number;
    campaignIds: number[];
    gate: { paused: boolean; bestEffort: true };
    gateWasPaused: boolean;
    notResumed: {
      reason: string;
      count: number;
      campaignIds: number[];
      what: string;
      nextStep: string;
      path: string | null;
    };
  };
}

function resumeRequest(): Request {
  return new Request(`${APP_ORIGIN}/api/queue/resume`, {
    method: 'POST',
    headers: {
      origin: APP_ORIGIN,
      host: 'zlavy.local',
      'content-type': 'application/json',
    },
    body: '{}',
  });
}

async function callResume(world: World): Promise<ResumeBody> {
  const handler = createQueueResumePost(world.deps, actorDeps());
  const response = await handler(resumeRequest());
  expect(response.status).toBe(200);
  return (await response.json()) as ResumeBody;
}

beforeEach(() => {
  resetQueueGate();
  // Okenný limit je stav modulu — bez vynulovania by sa testy tlmili navzájom.
  resetRateLimiter();
});

/* ══════════════════════ 2. Brána — jadro opravy ═══════════════════════════ */

describe('POST /api/queue/resume — brána po odstávke sa naozaj otvorí', () => {
  it('zatvorená brána je po kliknutí otvorená (predtým sa neotvárala vôbec)', async () => {
    pauseQueue('pc_downtime', new Date(NOW.getTime() - 3_600_000));
    expect(isQueuePaused()).toBe(true);

    const world = makeWorld({ missed: [] });
    const body = await callResume(world);

    expect(isQueuePaused()).toBe(false);
    expect(body.data.gateWasPaused).toBe(true);
    expect(body.data.gate.paused).toBe(false);
    // Brána je in-process stav a UI ju nesmie brať ako dôkaz (iný module graf).
    expect(body.data.gate.bestEffort).toBe(true);
  });

  it('otvorenie brány sa zapíše do auditu, aj keď sa nevrátila žiadna zľava', async () => {
    pauseQueue('pc_downtime', NOW);
    const world = makeWorld({ missed: [] });
    await callResume(world);

    expect(world.audit).toHaveLength(1);
    // `userId` je od 27. 8. 2026 LOKÁLNY ACTOR (`samuel`, id 1, D102) — nie
    // `sub` zo session, tá zmizla (D99). Audit ale actora stratiť nesmie (I11).
    expect(world.audit[0]).toMatchObject({ eventType: 'queue_resumed', actor: 'user', userId: 1 });
    expect(world.audit[0]?.campaignId).toBeUndefined();
  });

  it('otvorená brána + prázdna fronta = žiadny zbytočný audit', async () => {
    const world = makeWorld({ missed: [] });
    const body = await callResume(world);

    expect(body.data.gateWasPaused).toBe(false);
    expect(world.audit).toHaveLength(0);
  });
});

/* ═══════════════ 3. Prepadnuté zľavy späť do fronty (K2) ══════════════════ */

describe('POST /api/queue/resume — prepadnuté zľavy', () => {
  it('všetky `missed` sa vrátia do fronty a každá dostane audit', async () => {
    const world = makeWorld({
      missed: [campaign(11, 'missed', 'Prvá'), campaign(12, 'missed', 'Druhá')],
    });
    const body = await callResume(world);

    expect(body.data.resumed).toBe(2);
    expect(body.data.campaignIds).toEqual([11, 12]);
    expect(world.requeued).toEqual([11, 12]);
    expect(world.audit.map((a) => a.campaignId)).toEqual([11, 12]);
  });

  it('zľava, ktorú medzitým prevzal niekto iný, sa nezapočíta ani nezauditovuje', async () => {
    const world = makeWorld({
      missed: [campaign(11, 'missed', 'Prvá'), campaign(12, 'missed', 'Druhá')],
    });
    world.losesRace.add(11);

    const body = await callResume(world);
    expect(body.data.resumed).toBe(1);
    expect(body.data.campaignIds).toEqual([12]);
    expect(world.audit).toHaveLength(1);
  });
});

/* ═════════ 4. Čo tlačidlo NEROZBEHNE — zľavy čakajúce na kľúč (B6) ════════ */

describe('POST /api/queue/resume — zľavy, ktorým chýba kľúč', () => {
  it('odpoveď ich prizná, spočíta a povie, kam ísť', async () => {
    const world = makeWorld({
      missed: [],
      needs_key: [campaign(21, 'needs_key', 'Letná'), campaign(22, 'needs_key', 'Jesenná')],
    });
    const body = await callResume(world);

    expect(body.data.notResumed.count).toBe(2);
    expect(body.data.notResumed.campaignIds).toEqual([21, 22]);
    expect(body.data.notResumed.path).toBe('/nastavenia');
    // Veta musí niesť ČÍSLO a rozlíšiť „chýba kľúč" od „chýba potvrdenie".
    expect(body.data.notResumed.what).toContain('2');
    expect(body.data.notResumed.what).toContain('kľúč');
    expect(body.data.notResumed.nextStep).toContain('Nastaveniach');
  });

  it('sľubuje, že sa postup nestratí a nové potvrdenie netreba (kritérium 6)', async () => {
    const world = makeWorld({ missed: [], needs_key: [campaign(21, 'needs_key', 'Letná')] });
    const body = await callResume(world);

    expect(body.data.notResumed.nextStep).toContain('nestratí');
    expect(body.data.notResumed.nextStep).toContain('potvrdenie');
  });

  it('keď na kľúč nečaká nič, netvári sa, že áno', async () => {
    const world = makeWorld({ missed: [], needs_key: [] });
    const body = await callResume(world);

    expect(body.data.notResumed.count).toBe(0);
    expect(body.data.notResumed.path).toBeNull();
    expect(body.data.notResumed.nextStep).toBe('Netreba robiť nič.');
  });

  it('odpoveď neprejde cez masku redaktora — pole sa nesmie volať „…Key" (I1)', async () => {
    const world = makeWorld({ missed: [], needs_key: [campaign(21, 'needs_key', 'Letná')] });
    const handler = createQueueResumePost(world.deps, actorDeps());
    const response = await handler(
      new Request(`${APP_ORIGIN}/api/queue/resume`, {
        method: 'POST',
        headers: {
          origin: APP_ORIGIN,
          host: 'zlavy.local',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    );
    const text = await response.text();
    // Centrálny redaktor maskuje CELÚ hodnotu poľa s koncovkou „key". Keby sa
    // blok volal `waitingForKey`, klient by namiesto počtov dostal masku.
    expect(text).not.toContain('REDACTED');
    // A odpoveď sa nikde necachuje — to je vecou `defineRoute()`/`ok()`.
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('zľavu v `needs_key` NEVRACIA do fronty — tej chýba kľúč, nie potvrdenie', async () => {
    const world = makeWorld({
      missed: [],
      needs_key: [campaign(21, 'needs_key', 'Letná')],
    });
    const body = await callResume(world);

    expect(body.data.resumed).toBe(0);
    expect(world.requeued).toEqual([]);
  });
});

/* ══════════════════════ 5. Cena jedného kliknutia ═════════════════════════ */

describe('POST /api/queue/resume — okenný limit', () => {
  /**
   * JEDEN KLIK = AŽ ~200 ZÁPISOV DO DB.
   *
   * Route prejde až sto prepadnutých zliav a ku každej pripíše audit záznam,
   * takže jedna požiadavka je stovka `UPDATE`-ov a stovka `INSERT`-ov nad
   * `audit_log` (append-only, I4 — zmazať sa nedajú). Držané tlačidlo alebo
   * cyklus v skripte tým vie zaplniť audit a vyprázdniť pool (`DB_CONNECTION_LIMIT`,
   * default 8) presne vtedy, keď má fronta zapisovať. Rýchlejšie sa fronta
   * nerozbehne tým, že sa klikne desaťkrát — brána je otvorená po prvom klike.
   */
  it('opakované klikanie sa utlmí, nie sto zápisov na požiadavku', async () => {
    const world = makeWorld({
      missed: [campaign(1, 'missed', 'Prvá'), campaign(2, 'missed', 'Druhá')],
    });
    const handler = createQueueResumePost(world.deps, actorDeps());

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      statuses.push((await handler(resumeRequest())).status);
    }

    expect(statuses[0]).toBe(200);
    const throttled = statuses.filter((status) => status === 429);
    expect(throttled.length).toBeGreaterThan(0);
    // Utlmená požiadavka sa k DB vôbec nedostane — žiadne ďalšie zápisy.
    expect(world.audit.length).toBeLessThan(8 * 2);
  });

  it('utlmená odpoveď povie, kedy to skúsiť znova', async () => {
    const world = makeWorld({ missed: [] });
    const handler = createQueueResumePost(world.deps, actorDeps());

    let last = await handler(resumeRequest());
    for (let i = 0; i < 8 && last.status !== 429; i += 1) {
      last = await handler(resumeRequest());
    }

    expect(last.status).toBe(429);
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
