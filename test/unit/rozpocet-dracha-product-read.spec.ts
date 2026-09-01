/**
 * Aura Zľavy — DRÁHA `product_read` v zdieľanom rozpočte čítaní
 * (KONTRAKT-V4 §2b/D118; A4).
 *
 * Čo tento test stráži:
 *  1. **`product_read` má strop KĽÚČA, nie IP.** `getFull` je čítanie s kľúčom
 *     a shop ho účtuje na kľúč (od 1. 9. 2026 150/min, 1000/deň) — nie na
 *     anonymných 30/300.
 *     Čísla sa NEPÍŠU ručne, porovnávajú sa s `@/lib/shop/rate-limits`.
 *  2. **Tri dráhy, tri počítadlá.** Spotreba obohacovania nesmie ukrojiť
 *     z rozpočtu katalógovej synchronizácie (`anon`, beží dni) ani z rozpočtu
 *     predajnosti (`orders`, iný kľúč). Do 31. 8. 2026 sa obohacovanie účtovalo
 *     do `anon` a robilo presne to.
 *  3. **Zapojenie je naozaj prepnuté.** `/api/catalog/enrich` a
 *     `/api/catalog/reduction-check` musia brať `productReadBudget`; `anon` sa
 *     v nich nesmie objaviť. Bez tejto kontroly by dráha existovala a nikto by
 *     ju nepoužíval — a práve to bol stav od 13. 8. 2026.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ANON_READS_PER_MINUTE,
  ANON_READS_PER_UTC_DAY,
  RATE_SAFETY_FACTOR,
  SHOP_KEYED_LIMIT,
} from '@/lib/shop/rate-limits';
import {
  READ_LANE_LIMITS,
  createMemoryReadBudgetStore,
  createReadBudget,
} from '@/lib/shop/read-budget';

const repoRoot = join(import.meta.dirname, '..', '..');
const source = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

describe('READ_LANE_LIMITS.product_read — strop kľúča, nie IP', () => {
  it('má presne čísla kľúča po odrátaní rezervy', () => {
    expect(READ_LANE_LIMITS.product_read.perMinute).toBe(
      Math.floor(SHOP_KEYED_LIMIT.perMinute * RATE_SAFETY_FACTOR),
    );
    expect(READ_LANE_LIMITS.product_read.perUtcDay).toBe(
      Math.floor(SHOP_KEYED_LIMIT.perUtcDay * RATE_SAFETY_FACTOR),
    );
  });

  it('NEMÁ anonymné čísla — inak by sa škrtilo na cudzom strope', () => {
    expect(READ_LANE_LIMITS.product_read.perMinute).not.toBe(ANON_READS_PER_MINUTE);
    expect(READ_LANE_LIMITS.product_read.perUtcDay).not.toBe(ANON_READS_PER_UTC_DAY);
  });

  it('má rovnaké ČÍSLO ako `orders` (ten istý typ kvóty shopu)', () => {
    expect(READ_LANE_LIMITS.product_read).toEqual(READ_LANE_LIMITS.orders);
  });
});

describe('tri dráhy, tri počítadlá', () => {
  it('spotreba `product_read` neukrojí z `anon` ani z `orders`', async () => {
    const store = createMemoryReadBudgetStore();
    const now = (): Date => new Date('2026-08-31T09:00:00.000Z');
    const anon = createReadBudget({ store, lane: 'anon', now });
    const orders = createReadBudget({ store, lane: 'orders', now });
    const product = createReadBudget({ store, lane: 'product_read', now });

    const taken = await product.reserve(40);
    expect(taken.granted).toBe(40);

    expect((await product.status()).used).toBe(40);
    // Toto sú tie dve čísla, ktoré sa pred 31. 8. 2026 hýbali spolu.
    expect((await anon.status()).used).toBe(0);
    expect((await orders.status()).used).toBe(0);
  });

  it('rezervácia sa zastaví na strope KĽÚČA, nie na anonymnom', async () => {
    const store = createMemoryReadBudgetStore();
    const product = createReadBudget({
      store,
      lane: 'product_read',
      now: () => new Date('2026-08-31T09:00:00.000Z'),
    });

    /*
     * Žiadame VIAC, než dráha dovolí, a čakáme, že sa zastaví na SVOJOM strope.
     * Do 1. 9. 2026 sa tu žiadal `ANON_READS_PER_UTC_DAY` (240) a fungovalo to,
     * lebo kľúčová dráha bola vtedy nižšia (160). Po zdvihnutí kvóty je
     * kľúčová dráha 800, takže 240 by ju nevyčerpalo — žiadosť musí byť
     * odvodená od stropu tej dráhy, nie od anonymného čísla.
     */
    const all = await product.reserve(READ_LANE_LIMITS.product_read.perUtcDay + 1);
    expect(all.granted).toBe(READ_LANE_LIMITS.product_read.perUtcDay);
    expect(all.status.exhausted).toBe(true);
  });
});

describe('zapojenie — obohacovanie aj overenie zľavy účtujú do `product_read`', () => {
  const wired = [
    'src/app/api/catalog/enrich/route.ts',
    'src/app/api/catalog/reduction-check/route.ts',
  ];

  it.each(wired)('%s berie `productReadBudget`', (rel) => {
    expect(source(rel)).toContain('productReadBudget');
  });

  it.each(wired)('%s už nespomína `anonReadBudget`', (rel) => {
    expect(source(rel)).not.toContain('anonReadBudget');
  });
});
