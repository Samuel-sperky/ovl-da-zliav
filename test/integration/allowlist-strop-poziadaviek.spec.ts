/**
 * Aura Zľavy — STROP POŽIADAVIEK na mutáciách povoleného zoznamu.
 *
 * Tri mutácie allowlistu (`POST /api/allowlist`,
 * `DELETE /api/allowlist/[productId]`, `POST /api/allowlist/[productId]/mark-unknown`)
 * boli jediné mutácie appky bez `rateLimit`. Sú to lokálne DB zápisy, nie zápis
 * do shopu, takže strop je 30/min ako pri porovnateľných mutáciách
 * `settings/*` — nie 2/min ako pri `catalog/sync`.
 *
 * Čo tento test stráži:
 *  1. **31. požiadavka v okne dostane 429** — na každej z troch ciest.
 *  2. **FAIL-CLOSED: odmietnutá požiadavka mutáciu NEVYKONÁ.** Preto je posledná
 *     požiadavka vždy taká, ktorá by BEZ stropu uspela (nový produkt, existujúci
 *     produkt na odobranie) — a stav v pamäti sa po nej nesmie zmeniť.
 *  3. **Vlastný `bucket`, nie predvolená cesta.** Pri dynamických cestách nesie
 *     cesta `productId`, takže per-cestový kľúč by sa dal obísť zmenou ID —
 *     test preto vyčerpá strop nad JEDNÝM produktom a odmietnutie čaká na INOM.
 *  4. **Strop nesmie zjesť prepočet poradia obohacovania (D118)** — počet volaní
 *     `refreshEnrichPriority()` sedí presne s počtom úspešných mutácií.
 *
 * Tri buckety sú oddelené, takže vyčerpanie jednej cesty ostatné dve nezhodí.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { createMarkUnknownPost } from '@/app/api/allowlist/[productId]/mark-unknown/route';
import { createAllowlistDelete } from '@/app/api/allowlist/[productId]/route';
import { createAllowlistPost } from '@/app/api/allowlist/route';
import { resetRateLimiter } from '@/lib/http/define-route';

import { useMockShop } from '../helpers/mock';
import {
  actorRouteDeps,
  makeRequest,
  makeRoutesWorld,
  parse,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

/** Rovnaké číslo, aké majú všetky tri routy v `rateLimit.limit`. */
const LIMIT = 30;

function world(allowlistIds: number[]): RoutesWorld {
  mock.state.setProducts(
    allowlistIds.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl, allowlistIds });
}

describe('mutácie povoleného zoznamu majú strop požiadaviek', () => {
  beforeEach(() => {
    // Limiter je modulový singleton — bez tohto by si testy strop podávali.
    resetRateLimiter();
  });

  it('POST /api/allowlist: 31. požiadavka je 429 a produkt sa NEPRIDÁ', async () => {
    const w = world([201]);
    const post = createAllowlistPost(w.deps, actorRouteDeps());

    // Strop sa vyčerpá požiadavkami, ktoré nič nemenia (neplatné telo → 400).
    // Strop sa počíta PRED zodom, takže aj odmietnuté telo slot v okne zaberie.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await parse(
        await post(makeRequest('POST', '/api/allowlist', { productId: -1 })),
      );
      expect(res.status).toBe(400);
    }

    const blocked = await parse(
      await post(makeRequest('POST', '/api/allowlist', { productId: 777 })),
    );

    expect(blocked.status).toBe(429);
    expect(blocked.body.error?.code).toBe('too_many_attempts');
    // Fail-closed: požiadavka, ktorá by inak uspela, nezapísala NIČ.
    expect(w.allowlist.has(777)).toBe(false);
    expect(w.enrichPriorityCalls).toHaveLength(0);
  });

  it('DELETE /api/allowlist/[productId]: 429 a produkt v zozname ZOSTANE', async () => {
    const w = world([201, 202]);
    const del = createAllowlistDelete(w.deps, actorRouteDeps());

    // Neexistujúci produkt → 404, žiadna zmena stavu; strop ho aj tak počíta.
    for (let i = 0; i < LIMIT; i += 1) {
      const res = await parse(
        await del(makeRequest('DELETE', '/api/allowlist/909'), { params: { productId: '909' } }),
      );
      expect(res.status).toBe(404);
    }

    // INÉ `productId` — dôkaz, že kľúč stropu nie je cesta.
    const blocked = await parse(
      await del(makeRequest('DELETE', '/api/allowlist/201'), { params: { productId: '201' } }),
    );

    expect(blocked.status).toBe(429);
    expect(blocked.body.error?.code).toBe('too_many_attempts');
    expect(w.allowlist.get(201)?.slot).not.toBeNull();
    expect(w.allowlist.get(201)?.removedAt).toBeNull();
    expect(w.enrichPriorityCalls).toHaveLength(0);
  });

  it('POST mark-unknown: 429 a stav druhého produktu sa NEOZNAČÍ', async () => {
    const w = world([201, 202]);
    const mark = createMarkUnknownPost(w.deps, actorRouteDeps());

    for (let i = 0; i < LIMIT; i += 1) {
      const res = await parse(
        await mark(makeRequest('POST', '/api/allowlist/201/mark-unknown', {}), {
          params: { productId: '201' },
        }),
      );
      expect(res.status).toBe(200);
    }
    // Strop prepočet poradia (D118) nezjedol ani nespomalil: 30 úspešných
    // mutácií = 30 prepočtov.
    expect(w.enrichPriorityCalls).toHaveLength(LIMIT);

    const blocked = await parse(
      await mark(makeRequest('POST', '/api/allowlist/202/mark-unknown', {}), {
        params: { productId: '202' },
      }),
    );

    expect(blocked.status).toBe(429);
    expect(blocked.body.error?.code).toBe('too_many_attempts');
    // Fail-closed: `statusNote` D38 na 202 nevznikol a prepočet nepribudol.
    expect(w.allowlist.get(202)?.statusNote).toBeNull();
    expect(w.enrichPriorityCalls).toHaveLength(LIMIT);
  });

  it('tri buckety sú oddelené — vyčerpaný POST nezhodí DELETE', async () => {
    const w = world([201]);
    const post = createAllowlistPost(w.deps, actorRouteDeps());
    const del = createAllowlistDelete(w.deps, actorRouteDeps());

    for (let i = 0; i < LIMIT + 1; i += 1) {
      await post(makeRequest('POST', '/api/allowlist', { productId: -1 }));
    }

    const res = await parse(
      await del(makeRequest('DELETE', '/api/allowlist/201'), { params: { productId: '201' } }),
    );

    expect(res.status).toBe(200);
    expect(w.enrichPriorityCalls).toHaveLength(1);
  });
});
