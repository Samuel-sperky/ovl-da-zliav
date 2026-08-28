/**
 * Aura Zľavy — „Zopakovať zlyhané" a odkliknutie výsledku (A12, D15, D16, D45).
 *
 * Dve veci, ktoré appka predtým nevedela povedať:
 *
 *  1. **Čo by sa vlastne zopakovalo.** `POST` bez `previewToken` je správne
 *     odmietnutý (I3), ale používateľ z toho nevyčítal ani sadu produktov, ani
 *     dôvod, ani ďalší krok. `GET` na tú istú cestu to teraz popíše — a testy
 *     strážia, že popis a samotná akcia počítajú s TOU ISTOU sadou.
 *  2. **Neisté nie je zlyhané (D45).** „Nezapísalo sa" a „nevieme, či sa
 *     zapísalo" sú dve rôzne veci s dvoma rôznymi ďalšími krokmi a odpoveď ich
 *     nesmie zliať do jedného čísla.
 *
 * Navyše: každé odmietnutie je 4xx s vetou pre človeka a bez vnútorného kódu
 * stavu na povrchu (K10), a `POST` bez čerstvého potvrdenia neurobí NIC (I3).
 *
 * Bez DB a bez `fetch` (I6).
 */
import { describe, expect, it } from 'vitest';

import type {
  CampaignItemRecord,
  CampaignRecord,
  CampaignStatus,
  ItemStatus,
} from '@/contracts';

import {
  buildRetryPlan,
  createRetryFailedGet,
  createRetryFailedPost,
  retrySentence,
} from '@/app/api/campaigns/[id]/retry-failed/route';
import { createAckPost, uncertainNote } from '@/app/api/campaigns/[id]/ack/route';
import type { RoutesDeps } from '@/app/api/campaigns/_shared';
import type { RouteDeps } from '@/lib/http/define-route';

/* ═══════════════════════════ 1. Fixtures ══════════════════════════════════ */

const NOW = new Date('2026-08-12T09:00:00.000Z');
const TODAY = '2026-08-12';
const APP_ORIGIN = 'https://zlavy.local';

function actorDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J0000000000000000RETRY01',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

function campaign(patch: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: 5,
    operationId: '01J000000000000000000000C5',
    name: 'Letná zľava',
    kind: 'new',
    parentCampaignId: null,
    percent: 20,
    dateFrom: '2026-08-10',
    dateTo: '2026-08-31',
    dateFromOriginal: null,
    mode: 'eager',
    status: 'partial',
    statusReason: null,
    fireAt: null,
    scheduledAt: NOW,
    needsKeySince: null,
    claimedAt: NOW,
    startedAt: NOW,
    finishedAt: NOW,
    itemsTotal: 6,
    itemsOk: 2,
    itemsFailed: 2,
    itemsUncertain: 1,
    confirmedAt: NOW,
    confirmPayloadHash: 'hash',
    sudoAt: NOW,
    resultAckAt: null,
    createdBy: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function item(productId: number, status: ItemStatus, position: number): CampaignItemRecord {
  return {
    id: position,
    campaignId: 5,
    productId,
    position,
    status,
    attemptCount: 1,
    nameAtWrite: null,
    priceAtPreview: '19.99',
    priceAtWrite: null,
    priceMismatch: false,
    hasAttributes: false,
    reductionUnverifiable: false,
    requestId: null,
    httpStatus: null,
    errorCode: null,
    errorMessage: null,
    sentPayload: null,
    rawResponse: null,
    startedAt: null,
    finishedAt: null,
  };
}

/** Šesť položiek: 2 hotové, 1 preskočená, 1 zlyhaná, 1 neistá, 1 prerušená. */
const MIXED_ITEMS: CampaignItemRecord[] = [
  item(301, 'ok', 1),
  item(302, 'ok', 2),
  item(303, 'skipped', 3),
  item(304, 'failed', 4),
  item(305, 'uncertain', 5),
  item(306, 'interrupted', 6),
];

const forbidden = (name: string) => async (): Promise<never> => {
  throw new Error(`Route nesmie volať ${name}().`);
};

interface World {
  deps: RoutesDeps;
  acked: number[];
}

function makeWorld(record: CampaignRecord, items: CampaignItemRecord[]): World {
  const acked: number[] = [];
  const deps: RoutesDeps = {
    campaignsRepo: {
      create: forbidden('create'),
      getById: async (id: number) => (id === record.id ? record : null),
      list: async () => ({ data: [], page: 1, perPage: 20, total: 0 }),
      claim: forbidden('claim'),
      setStatus: forbidden('setStatus'),
      findUnacked: async () => [],
      ack: async (id: number) => {
        acked.push(id);
      },
      findPlannedForProduct: async () => [],
      findFutureOverlaps: async () => [],
      lastOwnWrite: async () => null,
    },
    campaignItemsRepo: {
      createMany: forbidden('createMany'),
      listByCampaign: async () => items,
      update: forbidden('update'),
      markRemaining: forbidden('markRemaining'),
    },
    // Zápisová cesta do shopu sa v tomto teste nesmie otvoriť ani omylom (I3).
    shopClient: {
      batchGetProducts: forbidden('shopClient.batchGetProducts'),
      getProduct: forbidden('shopClient.getProduct'),
      setReduction: forbidden('shopClient.setReduction'),
    },
    audit: { appendAudit: async () => undefined },
    now: () => NOW,
    timeZone: 'Europe/Bratislava',
  };
  return { deps, acked };
}

interface Body {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; detail?: unknown };
}

async function callGet(world: World, id = 5): Promise<{ status: number; body: Body }> {
  const handler = createRetryFailedGet(world.deps, actorDeps());
  const response = await handler(
    new Request(`${APP_ORIGIN}/api/campaigns/${id}/retry-failed`),
    { params: { id: String(id) } },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function callPost(
  world: World,
  body: unknown,
): Promise<{ status: number; body: Body }> {
  const handler = createRetryFailedPost(world.deps, actorDeps());
  const response = await handler(
    new Request(`${APP_ORIGIN}/api/campaigns/5/retry-failed`, {
      method: 'POST',
      headers: {
        origin: APP_ORIGIN,
        host: 'zlavy.local',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    { params: { id: '5' } },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

/* ══════════════ 2. Čistý plán — čo by sa zopakovalo (D15, D45) ════════════ */

describe('buildRetryPlan — sada opravnej zľavy', () => {
  it('opakuje všetko, čo neskončilo `ok` ani `skipped`, vzostupne podľa ID (I10)', () => {
    const plan = buildRetryPlan(campaign(), MIXED_ITEMS, TODAY);
    expect(plan.productIds).toEqual([304, 305, 306]);
    expect(plan.blockedBy).toBeNull();
  });

  it('rozlišuje „nezapísalo sa" od „nevieme, či sa zapísalo" (D45)', () => {
    const plan = buildRetryPlan(campaign(), MIXED_ITEMS, TODAY);
    expect(plan.breakdown).toEqual({
      ok: 2,
      skipped: 1,
      // `failed` + `interrupted` — produkt určite nie je zlacnený.
      notWritten: 2,
      // `uncertain` — zápis odišiel, odpoveď nedorazila.
      uncertain: 1,
      pending: 0,
    });
  });

  it('neznámy budúci stav položky sa fail-closed ZOPAKUJE, nie zabudne', () => {
    const plan = buildRetryPlan(
      campaign(),
      [item(401, 'not_found', 1), item(402, 'blocked', 2)],
      TODAY,
    );
    expect(plan.productIds).toEqual([401, 402]);
    expect(plan.breakdown.notWritten).toBe(2);
  });

  it('`from` v minulosti sa posúva na dnešok, `to` sa NIKDY nemení (D25, I7)', () => {
    const plan = buildRetryPlan(campaign({ dateFrom: '2026-08-01' }), MIXED_ITEMS, TODAY);
    expect(plan.effectiveFrom).toBe(TODAY);
    expect(plan.effectiveTo).toBe('2026-08-31');
  });

  it('budúci `from` sa neposúva dopredu ani dozadu', () => {
    const plan = buildRetryPlan(campaign({ dateFrom: '2026-08-20' }), MIXED_ITEMS, TODAY);
    expect(plan.effectiveFrom).toBe('2026-08-20');
  });

  it.each<[CampaignStatus, string]>([
    ['running', 'invalid_status'],
    ['queued' as CampaignStatus, 'invalid_status'],
    ['done', 'invalid_status'],
  ])('zo stavu `%s` sa opakovať nedá', (status, expected) => {
    expect(buildRetryPlan(campaign({ status }), MIXED_ITEMS, TODAY).blockedBy).toBe(expected);
  });

  it('uplynuté okno je prekážka, nie dôvod na posun okna (D25, I7)', () => {
    const plan = buildRetryPlan(campaign({ dateTo: '2026-08-11' }), MIXED_ITEMS, TODAY);
    expect(plan.blockedBy).toBe('window_lapsed');
  });

  it('keď nie je čo opakovať, povie to — nezaloží prázdnu zľavu', () => {
    const plan = buildRetryPlan(campaign(), [item(301, 'ok', 1), item(302, 'skipped', 2)], TODAY);
    expect(plan.productIds).toEqual([]);
    expect(plan.blockedBy).toBe('nothing_to_retry');
  });
});

/* ═════════════════ 3. Vety pre človeka, nie kódy (K10) ════════════════════ */

describe('retrySentence — každé odmietnutie má vetu s číslami a ďalší krok', () => {
  it('možné zopakovanie vymenuje obe skupiny osobitne', () => {
    const plan = buildRetryPlan(campaign(), MIXED_ITEMS, TODAY);
    const sentence = retrySentence(plan, campaign(), TODAY);
    expect(sentence.what).toContain('3 produkty');
    expect(sentence.what).toContain('určite nezapísala');
    expect(sentence.what).toContain('nevieme, či sa zapísala');
    expect(sentence.nextStep).toContain('potvrďte');
  });

  it('uplynuté okno vysvetlí, že appka okno sama neposúva (I7)', () => {
    const record = campaign({ dateTo: '2026-08-11' });
    const sentence = retrySentence(buildRetryPlan(record, MIXED_ITEMS, TODAY), record, TODAY);
    expect(sentence.what).toContain('2026-08-11');
    expect(sentence.nextStep).toContain('novú zľavu');
  });

  it('nesprávny stav neukáže vnútorný kód stavu na povrchu (K10)', () => {
    const record = campaign({ status: 'running' });
    const sentence = retrySentence(buildRetryPlan(record, MIXED_ITEMS, TODAY), record, TODAY);
    expect(`${sentence.what} ${sentence.nextStep}`).not.toContain('partial');
    expect(`${sentence.what} ${sentence.nextStep}`).not.toContain('running');
  });
});

/* ═════════════════ 4. GET — popis toho, čo by sa stalo ════════════════════ */

describe('GET /api/campaigns/[id]/retry-failed', () => {
  it('vráti sadu produktov, rozpad, okno a to, čo si POST vyžiada', async () => {
    const { status, body } = await callGet(makeWorld(campaign(), MIXED_ITEMS));
    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;

    expect(data.possible).toBe(true);
    expect(data.blockedBy).toBeNull();
    expect(data.productIds).toEqual([304, 305, 306]);
    expect(data.items).toMatchObject({ retryable: 3, notWritten: 2, uncertain: 1, ok: 2, skipped: 1 });
    expect(data.window).toMatchObject({ from: TODAY, to: '2026-08-31' });
    // `sudo: true` tu stálo do 27. 8. 2026; D100 sudo zrušilo a I3 odvtedy znie
    // „žiadny zápis bez dry-runu a potvrdenia". Zoznam je preto ÚPLNÝ (`toEqual`,
    // nie `toMatchObject`): keby sa do neho vrátilo pole, ktoré route nedodrží,
    // alebo z neho vypadol čerstvý náhľad či potvrdenie, tento test spadne.
    expect(data.requires).toEqual({ freshPreview: true, confirmation: true });
  });

  it('neexistujúca zľava je 404, nie prázdny popis', async () => {
    const { status } = await callGet(makeWorld(campaign(), MIXED_ITEMS), 99);
    expect(status).toBe(404);
  });

  it('keď to teraz nejde, GET povie prečo — a nevráti 4xx bez vysvetlenia', async () => {
    const record = campaign({ dateTo: '2026-08-11' });
    const { status, body } = await callGet(makeWorld(record, MIXED_ITEMS));
    expect(status).toBe(200);
    const data = body.data as Record<string, unknown>;
    expect(data.possible).toBe(false);
    expect(data.blockedBy).toBe('window_lapsed');
    expect(String(data.what)).toContain('Okno zľavy');
    expect(String(data.nextStep).length).toBeGreaterThan(0);
  });
});

/* ═════════════════ 5. POST — I3 a zrozumiteľné odmietnutia ════════════════ */

describe('POST /api/campaigns/[id]/retry-failed', () => {
  /*
   * Test „bez sudo okna sa nedostane ani k načítaniu zľavy" tu bol do
   * 27. 8. 2026 (I3, D70). Sudo zrušilo D100. Čo z I3 na TEJTO ceste
   * pretrváva a je strážené hneď nižšie: bez čerstvého preview tokenu je to
   * 400 a zľava sa nezopakuje — potvrdenie drží token, nie heslo.
   */
  it('chýbajúci token je 400 s vetou o tom, že treba nový náhľad (I3, D16)', async () => {
    const { status, body } = await callPost(makeWorld(campaign(), MIXED_ITEMS), {});
    expect(status).toBe(400);
    const fields = (body.error?.detail as { fields?: Array<{ message?: string }> })?.fields ?? [];
    expect(fields.some((f) => String(f.message).includes('náhľad'))).toBe(true);
  });

  it('uplynuté okno je 409 s TOU ISTOU vetou, akú vráti GET', async () => {
    const record = campaign({ dateTo: '2026-08-11' });
    const world = makeWorld(record, MIXED_ITEMS);
    const get = await callGet(world);
    const post = await callPost(world, { previewToken: 'x' });

    expect(post.status).toBe(409);
    expect(post.body.error?.code).toBe('window_lapsed');
    expect(post.body.error?.message).toContain(String((get.body.data as { what: string }).what));
  });

  it('keď nie je čo opakovať, odmietne to s číslami a bez zápisu', async () => {
    const world = makeWorld(campaign(), [item(301, 'ok', 1), item(302, 'skipped', 2)]);
    const { status, body } = await callPost(world, { previewToken: 'x' });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('nothing_to_retry');
    expect(body.error?.message).toContain('1');
  });

  it('nesprávny stav zľavy je 409 `invalid_transition` s ľudským vysvetlením', async () => {
    const world = makeWorld(campaign({ status: 'running' }), MIXED_ITEMS);
    const { status, body } = await callPost(world, { previewToken: 'x' });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('invalid_transition');
    expect(body.error?.message).toContain('dobehla');
  });
});

/* ═════════════════════ 6. Odkliknutie výsledku (D17, D45) ═════════════════ */

describe('POST /api/campaigns/[id]/ack', () => {
  async function callAck(world: World, id = 5): Promise<{ status: number; body: Body }> {
    const handler = createAckPost(world.deps, actorDeps());
    const response = await handler(
      new Request(`${APP_ORIGIN}/api/campaigns/${id}/ack`, {
        method: 'POST',
        headers: {
          origin: APP_ORIGIN,
          host: 'zlavy.local',
        },
      }),
      { params: { id: String(id) } },
    );
    return { status: response.status, body: (await response.json()) as Body };
  }

  it('odklikne výsledok a povie, čo z panelu zmizlo', async () => {
    const world = makeWorld(campaign(), MIXED_ITEMS);
    const { status, body } = await callAck(world);
    expect(status).toBe(200);
    expect(world.acked).toEqual([5]);
    expect(body.data?.items).toMatchObject({ ok: 2, failed: 2, uncertain: 1 });
  });

  it('neisté položky odkliknutím nezmiznú — a odpoveď to prizná (D45)', async () => {
    const { body } = await callAck(makeWorld(campaign(), MIXED_ITEMS));
    const note = String(body.data?.uncertainNote);
    expect(note).toContain('nevieme');
    expect(note).toContain('eshope');
    expect(note).toContain('Zopakovať zlyhané');
  });

  it('bez neistých položiek sa nič zbytočné nepripomína', () => {
    expect(uncertainNote(0)).toBeNull();
    expect(uncertainNote(1)).toContain('1');
  });

  it('už odkliknutý výsledok je 409 bez vnútorného kódu stavu (K10)', async () => {
    const world = makeWorld(campaign({ resultAckAt: NOW }), MIXED_ITEMS);
    const { status, body } = await callAck(world);
    expect(status).toBe(409);
    expect(body.error?.code).toBe('nothing_to_ack');
    expect(body.error?.message).not.toContain('partial');
    expect(world.acked).toEqual([]);
  });

  it('bežiaca zľava ešte nemá čo odklikávať a povie to slovami povrchu', async () => {
    const world = makeWorld(campaign({ status: 'running' }), MIXED_ITEMS);
    const { status, body } = await callAck(world);
    expect(status).toBe(409);
    expect(body.error?.message).not.toContain('running');
    expect(body.error?.message).toContain('zapisuje sa');
  });
});
