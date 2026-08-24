/**
 * Aura Zľavy — KOREŇ NEZNÁMEHO KÓDU STAVU (B6, vlna 24. 8. 2026).
 *
 * ČO SA STALO PREDTÝM
 * -------------------
 * `test/unit/neznamy-stav-zlavy.spec.ts` uzavrel JEDEN výhonok: zoznam zliav
 * pretypoval `row.status as CampaignStatusCode` a `Icon` nemal náhradný tvar.
 * Koreň zostal — slovník sám neznámy kód neriešil, kryli ho až volajúci, a
 * každý po svojom:
 *
 *   · `dashboard/overview-model.ts` mal `toStatusCode()` a kód ticho nahradil,
 *   · `campaigns/discounts-model.ts` si ho importoval CEZ obrazovku Prehľadu,
 *   · `api/campaigns/[id]/ack/route.ts` nemal nič a jeho hláška znela
 *     „Zľava „X" () ešte nemá výsledok" — s prázdnou zátvorkou.
 *
 * ČO TENTO SÚBOR MERIA
 * --------------------
 * Správanie, nie text zdroja. Kód sa nikde nehľadá `grep`-om: pretypovanie je
 * práve to, čo v TypeScripte NEVYVOLÁ žiadnu udalosť, takže sa musí zavolať
 * skutočná cesta a pozrieť, čo z nej vypadne.
 *
 *  A. Slovník sám dá neznámemu kódu slovo, tón — a PRIZNÁ náhradu.
 *  B. Prevod je JEDEN. `overview-model` už nemá vlastnú kópiu, len re-export;
 *     dve fail-closed náhrady by sa po prvej zmene rozišli.
 *  C. Zoznam zliav prizná náhradu PRÁVE RAZ, nie dvakrát.
 *  D. `ack` hláška nesie stav v zátvorke — nikdy prázdne `()` a nikdy kód.
 *
 * Vlastník: B6, vlna 24. 8. 2026.
 */
import { describe, expect, it } from 'vitest';

import type {
  CampaignItemRecord,
  CampaignRecord,
  CampaignStatus,
  SessionClaims,
} from '@/contracts';

import { createAckPost } from '@/app/api/campaigns/[id]/ack/route';
import type { RoutesDeps } from '@/app/api/campaigns/_shared';
import { sentenceOf, UNKNOWN_STATUS_FLAG } from '@/components/campaigns/discounts-model';
import { toStatusCode as toStatusCodeFromOverview } from '@/components/dashboard/overview-model';
import type { RouteDeps } from '@/lib/http/define-route';
import { SudoRequiredError } from '@/lib/auth/sudo';
import {
  CAMPAIGN_STATUS_CODES,
  SURFACE_STATES,
  UNKNOWN_STATUS_FLAG as SLOVNIK_UNKNOWN_FLAG,
  campaignSentence,
  isCampaignStatusCode,
  toStatusCode,
} from '@/lib/ui/vocabulary';

/** Kód, ktorý appka nepozná — presne ten, ktorý obrazovku zhodil. */
const NEZNAMY = 'writing';

const TODAY = '2026-08-24';

/* ═══════════ A. Slovník rieši neznámy kód sám a prizná to ═════════════════ */

describe('campaignSentence() s kódom, ktorý slovník nepozná', () => {
  it('dá jedno zo štyroch slov povrchu, nie undefined', () => {
    const veta = campaignSentence({ status: NEZNAMY, today: TODAY });
    expect(SURFACE_STATES).toContain(veta.state);
    expect(veta.tone).toBeDefined();
    // Fail-closed: `draft` → „pripravená". Appka radšej podcení, čo sa deje,
    // než aby tvrdila, že sa niekde zapisuje.
    expect(veta.state).toBe('pripravená');
  });

  it('náhradu PRIZNÁ — tichá by predstierala známy stav', () => {
    const veta = campaignSentence({ status: NEZNAMY, today: TODAY });
    expect(veta.flags).toContain(SLOVNIK_UNKNOWN_FLAG);
    expect(veta.text).toContain(SLOVNIK_UNKNOWN_FLAG.text);
  });

  it('vnútorný kód sa do vety nedostane (K10)', () => {
    expect(campaignSentence({ status: NEZNAMY, today: TODAY }).text).not.toContain(NEZNAMY);
  });

  it('príznak stojí až za tým, čo o zľave naozaj vieme', () => {
    const veta = campaignSentence({ status: NEZNAMY, today: TODAY, failedCount: 3 });
    expect(veta.flags[veta.flags.length - 1]).toBe(SLOVNIK_UNKNOWN_FLAG);
    expect(veta.text).toContain('3 sa nepodarilo');
  });

  it('KAŽDÝ známy kód dostane slovo a žiadny z nich príznak nedostane', () => {
    for (const code of CAMPAIGN_STATUS_CODES) {
      const veta = campaignSentence({ status: code, today: TODAY });
      expect(SURFACE_STATES).toContain(veta.state);
      expect(veta.flags).not.toContain(SLOVNIK_UNKNOWN_FLAG);
      expect(veta.text).not.toContain(SLOVNIK_UNKNOWN_FLAG.text);
    }
  });

  it('prevod pozná presne to, čo je v zozname kódov', () => {
    expect(toStatusCode('queued')).toBe('queued');
    expect(toStatusCode(NEZNAMY)).toBe('draft');
    expect(isCampaignStatusCode(NEZNAMY)).toBe(false);
    expect(isCampaignStatusCode('partial')).toBe(true);
  });
});

/* ═══════════════ B. Prevod je jeden, nie dva ══════════════════════════════ */

describe('toStatusCode() žije v slovníku', () => {
  it('Prehľad neponúka druhú kópiu, len tú istú funkciu', () => {
    // Identita, nie len rovnaký výsledok: dva rôzne fail-closed prevody by sa
    // po prvej zmene rozišli a jedna obrazovka by o tej istej zľave tvrdila
    // niečo iné než druhá.
    expect(toStatusCodeFromOverview).toBe(toStatusCode);
  });
});

/* ═══════════════ C. Zoznam zliav prizná náhradu práve raz ═════════════════ */

describe('zoznam zliav po presune prevodu', () => {
  const row = {
    id: 1,
    status: NEZNAMY,
    dateFrom: '2026-08-01',
    dateTo: '2026-08-31',
    itemsOk: 3,
    itemsFailed: 0,
    itemsPending: 7,
    late: false,
  };

  it('príznak „nepoznáme" je vo vete PRÁVE RAZ', () => {
    const veta = sentenceOf(row, TODAY);
    const kolko = veta.flags.filter((flag) => flag.text === UNKNOWN_STATUS_FLAG.text).length;
    expect(kolko).toBe(1);
  });

  it('slovo aj naďalej padá na najpasívnejšie tvrdenie', () => {
    expect(sentenceOf(row, TODAY).state).toBe('pripravená');
  });
});

/* ═══════════════ D. `ack` hláška nesie stav, nie prázdnu zátvorku ═════════ */

const NOW = new Date('2026-08-24T09:00:00.000Z');
const APP_ORIGIN = 'https://zlavy.local';

function claims(): SessionClaims {
  return {
    sub: 7,
    username: 'admin',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: null,
  };
}

function sessionDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J00000000000000000ACK001',
    requireSudo: (c: SessionClaims | null | undefined) => {
      if (c === null || c === undefined || c.sudoUntil === null) throw new SudoRequiredError();
      return c.sudoUntil;
    },
    verifySession: async () => ({
      claims: claims(),
      refreshed: {
        token: 'refreshed',
        claims: claims(),
        cookie: {
          name: 'ovl_zliav_session' as const,
          value: 'refreshed',
          options: {
            httpOnly: true as const,
            secure: true as const,
            sameSite: 'strict' as const,
            path: '/',
            maxAge: 1800,
          },
        },
      },
    }),
  };
}

function campaign(status: string): CampaignRecord {
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
    // Kód z databázy, ktorý sa rozišiel s typom — presne to, čo sa stalo
    // s `writing`. Cast je TU zámerný: simuluje realitu, v ktorej typ
    // nechráni nič.
    status: status as CampaignStatus,
    statusReason: null,
    fireAt: null,
    scheduledAt: NOW,
    needsKeySince: null,
    claimedAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    itemsTotal: 6,
    itemsOk: 2,
    itemsFailed: 0,
    itemsUncertain: 0,
    confirmedAt: NOW,
    confirmPayloadHash: 'hash',
    sudoAt: NOW,
    resultAckAt: null,
    createdBy: 7,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const forbidden = (name: string) => async (): Promise<never> => {
  throw new Error(`Route nesmie volať ${name}().`);
};

function deps(record: CampaignRecord): RoutesDeps {
  return {
    campaignsRepo: {
      create: forbidden('create'),
      getById: async (id: number) => (id === record.id ? record : null),
      list: async () => ({ data: [], page: 1, perPage: 20, total: 0 }),
      claim: forbidden('claim'),
      setStatus: forbidden('setStatus'),
      findUnacked: async () => [],
      ack: forbidden('ack'),
      findPlannedForProduct: async () => [],
      findFutureOverlaps: async () => [],
      lastOwnWrite: async () => null,
    },
    campaignItemsRepo: {
      createMany: forbidden('createMany'),
      listByCampaign: async (): Promise<CampaignItemRecord[]> => [],
      update: forbidden('update'),
      markRemaining: forbidden('markRemaining'),
    },
    now: () => NOW,
  };
}

interface AckBody {
  error?: { code?: string; message?: string };
}

async function callAck(status: string): Promise<{ code: number; message: string }> {
  const handler = createAckPost(deps(campaign(status)), sessionDeps());
  const response = await handler(
    new Request(`${APP_ORIGIN}/api/campaigns/5/ack`, {
      method: 'POST',
      headers: { cookie: 'ovl_zliav_session=x', origin: APP_ORIGIN, host: 'zlavy.local' },
    }),
    { params: { id: '5' } },
  );
  const body = (await response.json()) as AckBody;
  return { code: response.status, message: String(body.error?.message ?? '') };
}

describe('POST /api/campaigns/[id]/ack pri kóde, ktorý appka nepozná', () => {
  it('odmietne s vetou, v ktorej zátvorka NIE JE prázdna', async () => {
    const { code, message } = await callAck(NEZNAMY);
    expect(code).toBe(409);
    expect(message).toContain('Letná zľava');
    // Toto je celá chyba, ktorá sa opravuje: „(…)" bez obsahu.
    expect(message).not.toContain('()');
    expect(message).not.toContain('( )');
  });

  it('v zátvorke stojí stav aj priznaná náhrada', async () => {
    const { message } = await callAck(NEZNAMY);
    const zatvorka = /\(([^)]*)\)/.exec(message)?.[1] ?? '';
    expect(zatvorka).not.toBe('');
    expect(SURFACE_STATES.some((state) => zatvorka.includes(state))).toBe(true);
    expect(zatvorka).toContain(SLOVNIK_UNKNOWN_FLAG.text);
  });

  it('vnútorný kód sa do hlášky nedostane (K10)', async () => {
    expect((await callAck(NEZNAMY)).message).not.toContain(NEZNAMY);
  });

  it('známy neodklikateľný stav hlási stav bez príznaku o neznalosti', async () => {
    // `running` sa odkliknúť nedá (ešte nedobehla) — zátvorka teda musí niesť
    // slovo, ale nesmie tvrdiť, že kód nepoznáme.
    const { code, message } = await callAck('running');
    expect(code).toBe(409);
    const zatvorka = /\(([^)]*)\)/.exec(message)?.[1] ?? '';
    expect(zatvorka).toContain('zapisuje sa');
    expect(zatvorka).not.toContain(SLOVNIK_UNKNOWN_FLAG.text);
  });
});
