/**
 * Aura Zľavy — `GET /api/catalog/reduction-check` proti REÁLNEMU mocku shopu
 * (KONTRAKT-API-V5-2026-08-13: bod A2, rozhodnutie R2, I6, I11).
 *
 * Čo sa tu dokazuje a prečo práve to:
 *
 *  1. **Za nepoloženú otázku sa neplatí.** Kým kľúč nemá oprávnenie
 *     `product:read`, na shop nesmie odísť ANI JEDEN request a rozpočet čítaní
 *     musí zostať nedotknutý. Jednotkový test to overuje cez fake; tu to overuje
 *     počítadlo skutočného HTTP servera.
 *  2. **Mlčanie shopu sa NIKDY nestane „sedí".** Mock shop `getFull` zatiaľ
 *     nepozná a odpovedá `404 invalid_action`. Presne v takej chvíli je
 *     najlákavejšie prečítať prázdnu odpoveď ako „žiadna zľava nebeží" — a je to
 *     tvrdenie o produkčnom eshope, ktoré nikto nepremeral (I11). Route musí
 *     vrátiť `unknown`, a to aj vtedy, keď appka má vlastný zápis, ktorý by sa
 *     dal vydávať za pravdu.
 *  3. **Kľúč ide do hlavičky, nikam inam** (I1, D64). `getFull` je prvé ČÍTANIE
 *     s kľúčom, takže sa overuje, že sa nedostal do query stringu.
 *
 * Shop je skutočný mock server (I6) — žiadne stubovanie `fetch`. Rozpočet je
 * skutočný `createReadBudget()` nad pamäťovým úložiskom, takže aritmetika je tá
 * istá, ktorá chráni produkciu.
 *
 * ROZDIEL NAOSTRO (31. 8. 2026)
 * ----------------------------
 * `test/mock-shop/server.ts` už `GET /api/products/getFull` implementuje, ale
 * stav zľavy v ňom odvádzal z `lastReduction`, teda z toho, čo appka sama
 * predtým zapísala — proti takému mocku sa rozdiel NIKDY neobjavil a route,
 * ktorá existuje práve na hľadanie rozdielu, nemala čo dokázať. Mock preto vie
 * `state.setShopReduction(id, …)`: nezávislé tvrdenie shopu (`null` = „zľava
 * nebeží", objekt = „beží TÁTO"). Posledný describe v tomto súbore odohrá „my
 * 20 %, eshop 15 %" cez skutočné HTTP.
 *
 * Vlastník: V16 (overenie skutočnosti).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DateOnly, SecretHandle, SecretRef } from '@/contracts';

import type { ReductionCheckResponse } from '@/app/api/catalog/reduction-check/route';
import { createReductionCheckRoute } from '@/app/api/catalog/reduction-check/route';
import { resetRateLimiter } from '@/lib/http/define-route';
import type { ProductWriteRow } from '@/lib/repo/insights.repo';
import { createShopClient, type ShopScope } from '@/lib/shop/client';
import {
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
} from '@/lib/shop/read-budget';

import { startMockShopWithOverride, VALID_API_KEY, type RunningMockShop } from '../helpers/mock';
import { makeRequest, parse, actorRouteDeps } from './routes-harness';

const NOW = new Date('2026-08-18T09:00:00.000Z');
const now = (): Date => NOW;
const TODAY: DateOnly = '2026-08-18';

/** `SecretRef` nad textom — kľúč v testoch nikdy nie je skutočný. */
const testKey: SecretRef = async (): Promise<SecretHandle> => {
  const value = Buffer.from('test-key', 'utf8');
  return { value, release: () => value.fill(0) };
};

/**
 * Kľúč, ktorý mock POZNÁ — bez neho končí `getFull` na `401` a všetko je
 * `unknown`, teda rozdiel by sa nemal ako ukázať.
 */
const knownKey: SecretRef = async (): Promise<SecretHandle> => {
  const value = Buffer.from(VALID_API_KEY, 'utf8');
  return { value, release: () => value.fill(0) };
};

/** Vlastný zápis, ktorý porovnávaný deň pokrýva. */
function ownWrite(): ProductWriteRow {
  return {
    itemId: 1,
    campaignId: 1,
    campaignName: 'Ležiaky striebro — jeseň',
    status: 'ok',
    percent: 20,
    dateFrom: '2026-08-10',
    dateTo: '2026-08-24',
    at: '2026-08-11T07:00:00.000Z',
  };
}

let mock: RunningMockShop;
let budget: ReadBudget;

beforeAll(async () => {
  mock = await startMockShopWithOverride();
});

afterAll(async () => {
  await mock.stop();
});

beforeEach(() => {
  resetRateLimiter();
  mock.state.reset();
  budget = createReadBudget({ store: createMemoryReadBudgetStore(), lane: 'anon', now });
});

function routeWith(scopes: readonly ShopScope[] | null, key: SecretRef = testKey) {
  return createReductionCheckRoute({
    // Skutočný klient A3 proti mocku (I6) — nič sa nestubuje.
    shop: createShopClient({ baseUrl: mock.baseUrl, policy: { maxAttempts: 1, retryAfterCapSeconds: 1 } }),
    apiKey: {
      loadForUse: async () => key,
      recallScopes: () => ({ scopes, checkedAt: scopes === null ? null : NOW }),
    },
    ownWrites: async () => [ownWrite()],
    reads: budget,
    now,
    routeDeps: actorRouteDeps(),
  });
}

async function call(
  scopes: readonly ShopScope[] | null,
  query: string,
  key: SecretRef = testKey,
): Promise<ReductionCheckResponse> {
  const response = await routeWith(scopes, key)(
    makeRequest('GET', `/api/catalog/reduction-check${query}`),
  );
  const parsed = await parse(response);
  expect(parsed.status).toBe(200);
  return parsed.body.data as ReductionCheckResponse;
}

describe('GET /api/catalog/reduction-check — bez oprávnenia sa shop nedotkne', () => {
  it('neoverený kľúč: nula requestov, nula čítaní, a predsa celá odpoveď', async () => {
    const data = await call(null, `?productIds=18342&day=${TODAY}`);

    expect(data.outcome).toBe('unknown_scope');
    expect(data.capability.state).toBe('unknown');
    // Za nepoloženú otázku sa neplatí — ani requestom, ani rozpočtom.
    expect(mock.state.recordedRequests).toHaveLength(0);
    expect(data.readsUsed).toBe(0);
    expect((await budget.status()).used).toBe(0);

    // Riadok tam JE a priznáva sa. Prázdna odpoveď by na obrazovke vyzerala
    // rovnako ako „všetko sedí".
    expect(data.products).toHaveLength(1);
    expect(data.products[0]?.verdict).toBe('unknown');
    expect(data.products[0]?.shop).toEqual({ state: 'unknown', reason: 'not_checked' });
    // Vlastný záznam je vidieť aj tak — je z vlastných tabuliek a nič nestojí.
    expect(data.products[0]?.own.state).toBe('expected');
  });

  it('kľúč BEZ `product:read` je meraný fakt „nemá", nie „nevieme"', async () => {
    const data = await call(['product:edit'], `?productIds=18342&day=${TODAY}`);

    expect(data.outcome).toBe('locked');
    expect(data.capability.state).toBe('locked');
    expect(mock.state.recordedRequests).toHaveLength(0);
    expect(data.products[0]?.verdict).toBe('unknown');
  });
});

describe('GET /api/catalog/reduction-check — mlčanie shopu nie je „sedí"', () => {
  it('shop, ktorý `getFull` nepozná, nesmie skončiť ako zhoda', async () => {
    const data = await call(['product:edit', 'product:read'], `?productIds=18342&day=${TODAY}`);

    // Request odišiel a stál jedno čítanie — to je meraný fakt, nie odhad.
    expect(mock.state.recordedRequests).toHaveLength(1);
    expect(data.readsUsed).toBe(1);
    expect((await budget.status()).used).toBe(1);

    const row = data.products[0];
    // Toto je celý zmysel testu: appka má vlastný zápis (20 % na dnešok), shop
    // neodpovedal — a výsledok NIE JE ani „sedí", ani „zľava nebeží".
    expect(row?.verdict).toBe('unknown');
    expect(row?.shop.state).toBe('unknown');
    expect(row?.own.state).toBe('expected');
    expect(row?.unknownCause).toBe('shop_unread');
    // Čas je konkrétny — pýtali sme sa naozaj (kontrakt UI, bod 10).
    expect(row?.checkedAt).toBe(NOW.toISOString());
  });

  it('kľúč ide výhradne do hlavičky, nikdy do adresy (I1, D64)', async () => {
    await call(['product:edit', 'product:read'], `?productIds=18342&day=${TODAY}`);

    const request = mock.state.recordedRequests[0];
    expect(request?.path).toBe('/api/products/getFull');
    expect(request?.apiKey).toBe('test-key');
    expect(request?.url).not.toContain('test-key');
    expect(request?.query.id).toBe('18342');
    // Overenie je ČÍTANIE — na zápisovom endpointe sa nič neobjaví (I7, I13).
    expect(mock.state.writeCount).toBe(0);
  });
});

describe('GET /api/catalog/reduction-check — rozdiel medzi shopom a appkou naostro', () => {
  /** Produkt z default fixtures mocku; vlastný zápis je 20 % na 10.–24. 8. */
  const PRODUCT_ID = 201;
  const QUERY = `?productIds=${PRODUCT_ID}&day=${TODAY}`;
  const SCOPES: readonly ShopScope[] = ['product:edit', 'product:read'];

  it('eshop hlási 15 %, appka zapísala 20 % → `differs`, nie „sedí"', async () => {
    // Stav shopu je nastavený NEZÁVISLE od appky — appka nezapísala nič.
    mock.state.setShopReduction(PRODUCT_ID, {
      reduction: 15,
      from: '2026-08-10',
      to: '2026-08-24',
    });

    const data = await call(SCOPES, QUERY, knownKey);
    const row = data.products[0];

    expect(row?.shop).toEqual({
      state: 'active',
      percent: 15,
      from: '2026-08-10',
      to: '2026-08-24',
    });
    expect(row?.own.state).toBe('expected');
    expect(row?.verdict).toBe('differs');
    expect(row?.differences).toContain('percent');
    // Zápis sa nedotkol ničoho — overenie je čítanie (I7, I13).
    expect(mock.state.writeCount).toBe(0);
  });

  it('eshop hlási „žiadna zľava", appka má zápis → `differs`', async () => {
    // `null` je tvrdenie shopu, nie „nevieme" — a NESMIE ho prekryť zápis appky.
    mock.state.setShopReduction(PRODUCT_ID, null);

    const data = await call(SCOPES, QUERY, knownKey);
    const row = data.products[0];

    expect(row?.shop).toEqual({ state: 'none' });
    expect(row?.verdict).toBe('differs');
    expect(row?.unknownCause).toBeNull();
  });

  it('to isté percento aj okno → `match` (aby „differs" nebolo len šum)', async () => {
    mock.state.setShopReduction(PRODUCT_ID, {
      reduction: 20,
      from: '2026-08-10',
      to: '2026-08-24',
    });

    const data = await call(SCOPES, QUERY, knownKey);
    const row = data.products[0];

    expect(row?.verdict).toBe('match');
    expect(row?.differences).toEqual([]);
  });
});
