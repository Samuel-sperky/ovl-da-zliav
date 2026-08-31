/**
 * Aura Zľavy — REZERVA ZÁPISOV: ČÍTANIA NESMÚ VYHLADOVAŤ ZÁPISY
 * (nálezy 1 a 2 z review V4, 31. 8. 2026).
 *
 * Čo tento test stráži — štyri veci, ktoré tento sprint na jeden deň pokazil:
 *
 *  1. **Vyčerpaná čítacia dráha NEZASTAVÍ zápisy.** Odpočítanie čítaní od
 *     zápisového stropu bolo správne (jeden kľúč, jedna kvóta), ale bralo ich
 *     z CELÉHO stropu. Vyčerpaná dráha `product_read` (160) tak znížila
 *     rozpočet z 200 na 40 — a pri rozpočte na úrovni rezervy alebo pod ňou
 *     (vrátane fail-closed 1) až na NULU, čo `checkDailyBudget()` prekladá na
 *     odmietnutie celej fronty. `GET /api/catalog/reduction-check` pritom
 *     bránu pôvodu mať nemôže (je to GET) a appka nemá prihlásenie, takže
 *     dráhu vedela vyprázdniť aj cudzia stránka otvorená v tom istom
 *     prehliadači — bez jediného POSTu.
 *  2. **Rezerva nepreplní strop shopu.** `WRITE_QUOTA_RESERVE` je odvodená
 *     ako `200 − 160`, teda presne časť kvóty, na ktorú čítacia dráha
 *     nedosiahne. Súčet `zápisy + čítania + zvyšok` preto nikdy neprekročí
 *     strop shopu — inak by rezerva kupovala zápisy za 429.
 *  3. **Docblok a kód hovoria to isté.** Veta „zápisy majú prednosť pred
 *     obohacovaním" tu mesiac stála bez toho, aby jej v kóde čokoľvek
 *     odpovedalo (dávka sa pýta výhradne čítacej dráhy, poradie je časové).
 *     Prednosť je odteraz rezerva a nič iné.
 *  4. **Overenie zľavy nevyprázdni dráhu.** `reductionCheckDailyCeiling()` je
 *     denný podiel dráhy vyhradený overeniu; nad ním sa cesta zastaví s
 *     vlastným výrokom `budget_shared` (nie `budget_day` — dráha miesto ešte
 *     má, I11), a `POST /api/catalog/details` už svoje `getFull` účtuje.
 *
 * Žiadna DB, žiadny `fetch` (I6). Rozpočty sú skutočné `createReadBudget()`
 * nad pamäťovým úložiskom.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import type {
  DateOnly,
  MoneyString,
  ProductFullDetail,
  SecretHandle,
  SecretRef,
} from '@/contracts';

import { createReductionCheckRoute } from '@/app/api/catalog/reduction-check/route';
import { fillProductDetails, type ProductDetailsDeps } from '@/lib/catalog/product-details';
import {
  REDUCTION_CHECK_LANE_SHARE,
  checkReductionsInShop,
  reductionCheckDailyCeiling,
  type ReductionCheckDeps,
} from '@/lib/catalog/reduction-check';
import {
  DEFAULT_DAILY_WRITE_BUDGET,
  FAIL_CLOSED_DAILY_BUDGET,
  MAX_DAILY_WRITE_BUDGET,
  WRITE_QUOTA_RESERVE,
  chargeableKeyedReads,
  remainingToday,
  writeReserveFor,
} from '@/lib/engine/budget';
import type { CatalogCacheRecordV3, CatalogDetailRow } from '@/lib/repo/catalog.repo';
import { catalogDetailFromRecord, emptyCatalogDetail } from '@/lib/repo/catalog.repo';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import {
  READ_LANE_LIMITS,
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
  type ReadBudgetStore,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Prostredie ════════════════════════════════ */

const NOW = new Date('2026-08-31T09:00:00.000Z');
const now = (): Date => NOW;
/** UTC deň rozpočtu aj čítacej dráhy — tu je zhodou okolností ten istý. */
const TODAY = '2026-08-31' as DateOnly;
const LANE_DAY = READ_LANE_LIMITS.product_read.perUtcDay;

const testKey: SecretRef = async (): Promise<SecretHandle> => ({
  value: Buffer.from('test-key', 'utf8'),
  release: () => undefined,
});

/** Počítadlo zápisov, ktoré vždy odpovie číslom (žiadny audit, žiadna DB). */
const counterOf = (spent: number) => ({
  countWriteAttemptsOn: async (): Promise<number> => spent,
});

/** Čítania na tom istom kľúči — presne to, čo vidí `createBudget()`. */
const readsOf = (used: number, known = true) => ({
  status: async (): Promise<{ used: number; known: boolean }> => ({ used, known }),
});

/** Dráha `product_read` nad pamäťou, prípadne už z časti minutá. */
async function keyedLane(used = 0): Promise<ReadBudget> {
  const store: ReadBudgetStore = createMemoryReadBudgetStore();
  if (used > 0) await store.add('product_read', TODAY, used);
  return createReadBudget({ store, lane: 'product_read', now });
}

const repoRoot = join(import.meta.dirname, '..', '..');
const source = (rel: string): string => readFileSync(join(repoRoot, rel), 'utf8');

/* ═════════ 2. Nález 1 — čítania nesmú zobrať schopnosť zapísať ════════════ */

describe('WRITE_QUOTA_RESERVE — rezerva, na ktorú čítania nedosiahnu', () => {
  it('je ODVODENÁ zo stropu kľúča a dennej dráhy, nie zvolená', () => {
    expect(WRITE_QUOTA_RESERVE).toBe(MAX_DAILY_WRITE_BUDGET - LANE_DAY);
    // Keby bola väčšia, súčet čítaní a rezervy by preliezol strop shopu.
    expect(WRITE_QUOTA_RESERVE + LANE_DAY).toBe(MAX_DAILY_WRITE_BUDGET);
    expect(WRITE_QUOTA_RESERVE).toBeGreaterThan(0);
  });

  it('pri rozpočte pod rezervou je rezervou celý rozpočet', () => {
    expect(writeReserveFor(MAX_DAILY_WRITE_BUDGET)).toBe(WRITE_QUOTA_RESERVE);
    expect(writeReserveFor(WRITE_QUOTA_RESERVE)).toBe(WRITE_QUOTA_RESERVE);
    expect(writeReserveFor(FAIL_CLOSED_DAILY_BUDGET)).toBe(FAIL_CLOSED_DAILY_BUDGET);
    expect(writeReserveFor(5)).toBe(5);
  });

  it('odpočítava sa LEN to, čo sa zmestí nad rezervu', () => {
    // Plný rozpočet: čítania ukroja najviac 160 zo 200.
    expect(chargeableKeyedReads(MAX_DAILY_WRITE_BUDGET, 0)).toBe(0);
    expect(chargeableKeyedReads(MAX_DAILY_WRITE_BUDGET, 10)).toBe(10);
    expect(chargeableKeyedReads(MAX_DAILY_WRITE_BUDGET, LANE_DAY)).toBe(LANE_DAY);
    expect(chargeableKeyedReads(MAX_DAILY_WRITE_BUDGET, 10_000)).toBe(
      MAX_DAILY_WRITE_BUDGET - WRITE_QUOTA_RESERVE,
    );
    // Malý ručne nastavený rozpočet: neodpočítava sa nič, je celý rezerva.
    expect(chargeableKeyedReads(FAIL_CLOSED_DAILY_BUDGET, LANE_DAY)).toBe(0);
    expect(chargeableKeyedReads(5, LANE_DAY)).toBe(0);
  });
});

describe('vyčerpaná čítacia dráha NEZASTAVÍ zápisy (nález 1)', () => {
  it('plná dráha zníži rozpočet najviac na rezervu, nikdy na nulu', async () => {
    const status = await remainingToday({
      counter: counterOf(0),
      dailyBudget: MAX_DAILY_WRITE_BUDGET,
      keyedReads: readsOf(LANE_DAY),
      now,
    });

    expect(status.keyedReadsToday).toBe(LANE_DAY);
    expect(status.keyedReadsCharged).toBe(LANE_DAY);
    expect(status.writeReserve).toBe(WRITE_QUOTA_RESERVE);
    expect(status.remaining).toBe(WRITE_QUOTA_RESERVE);
    expect(status.exhausted).toBe(false);
  });

  it('ani čítanie NAD strop dráhy (nečitateľné počítadlo, cudzí GET) rezervu nezje', async () => {
    for (const reads of [LANE_DAY, LANE_DAY * 2, MAX_DAILY_WRITE_BUDGET, 10_000]) {
      const status = await remainingToday({
        counter: counterOf(0),
        dailyBudget: MAX_DAILY_WRITE_BUDGET,
        keyedReads: readsOf(reads, false),
        now,
      });
      expect(status.remaining).toBe(WRITE_QUOTA_RESERVE);
      expect(status.exhausted).toBe(false);
    }
  });

  it('pri `daily_write_budget = 1` sa fronta SPOMALÍ, nezastaví — presne ako tvrdí docblok', async () => {
    const status = await remainingToday({
      counter: counterOf(0),
      dailyBudget: FAIL_CLOSED_DAILY_BUDGET,
      keyedReads: readsOf(LANE_DAY),
      now,
    });

    // Toto je tá veta z `FAIL_CLOSED_DAILY_BUDGET` a z `FAIL_CLOSED_SCOPE`:
    // jeden zápis za deň, fronta pokračuje zajtra. Do 31. 8. 2026 tu bola 0.
    expect(status.budget).toBe(1);
    expect(status.keyedReadsToday).toBe(LANE_DAY);
    expect(status.keyedReadsCharged).toBe(0);
    expect(status.remaining).toBe(1);
    expect(status.exhausted).toBe(false);
  });

  it('vyčerpanie hlási LEN spotreba ZÁPISOV — nikdy čítania samé', async () => {
    // Zápisy minuli všetko: to je vyčerpanie a je to informácia, nie chyba.
    const byWrites = await remainingToday({
      counter: counterOf(MAX_DAILY_WRITE_BUDGET),
      dailyBudget: MAX_DAILY_WRITE_BUDGET,
      keyedReads: readsOf(0),
      now,
    });
    expect(byWrites.exhausted).toBe(true);

    // Sweep: `exhausted` nikdy nenastane bez toho, aby zápisy minuli aspoň
    // rezervu. Tým je nález 1 zavretý na celom rozsahu, nie na jednom bode.
    for (const budget of [1, 5, WRITE_QUOTA_RESERVE, 100, MAX_DAILY_WRITE_BUDGET]) {
      for (const reads of [0, 40, LANE_DAY, 10_000]) {
        for (const spent of [0, 1, WRITE_QUOTA_RESERVE - 1]) {
          const status = await remainingToday({
            counter: counterOf(spent),
            dailyBudget: budget,
            keyedReads: readsOf(reads),
            now,
          });
          if (status.exhausted) {
            expect(spent).toBeGreaterThanOrEqual(writeReserveFor(budget));
          }
          expect(status.remaining).toBeGreaterThanOrEqual(
            Math.max(0, writeReserveFor(budget) - spent),
          );
        }
      }
    }
  });

  it('rezerva NEPREPLNÍ strop shopu: zápisy + čítania + zvyšok ≤ 200', async () => {
    for (const budget of [1, WRITE_QUOTA_RESERVE, 120, MAX_DAILY_WRITE_BUDGET]) {
      for (const reads of [0, 40, LANE_DAY]) {
        for (const spent of [0, 10, 39]) {
          const status = await remainingToday({
            counter: counterOf(spent),
            dailyBudget: budget,
            keyedReads: readsOf(reads),
            now,
          });
          expect(status.spent + reads + status.remaining).toBeLessThanOrEqual(
            MAX_DAILY_WRITE_BUDGET,
          );
        }
      }
    }
  });

  it('bez sledovania čítaní sa rezerva nikde neprejaví ako zľava zo stropu', async () => {
    const status = await remainingToday({
      counter: counterOf(10),
      dailyBudget: DEFAULT_DAILY_WRITE_BUDGET,
      keyedReads: null,
      now,
    });
    expect(status.keyedReadsToday).toBe(0);
    expect(status.keyedReadsCharged).toBe(0);
    expect(status.remaining).toBe(DEFAULT_DAILY_WRITE_BUDGET - 10);
  });
});

/* ═════════════ 3. Nález 2 — docbloky nesmú tvrdiť nepravdu ════════════════ */

describe('docbloky hovoria to, čo kód naozaj robí (nález 2)', () => {
  it('`budget.ts` netvrdí prednosť zápisov bez toho, aby ju pomenoval rezervou', () => {
    const text = source('src/lib/engine/budget.ts');
    // Pôvodná veta bez pokrytia v kóde. Keď sa vráti, vráti sa aj nález 2.
    expect(text).not.toContain('Zápisy majú prednosť pred obohacovaním, nie naopak');
    expect(text).toContain('PREDNOSŤ ZÁPISOV NIE JE V PORADÍ, JE V REZERVE');
    expect(text).toContain('WRITE_QUOTA_RESERVE');
  });

  it('`settings.repo.ts` vysvetľuje, čím to „nezastaví sa" naozaj drží', () => {
    const text = source('src/lib/repo/settings.repo.ts');
    expect(text).toContain('WRITE_QUOTA_RESERVE');
    expect(text).toContain('SPOMALÍ');
  });

  it('`guards.ts` priznáva, že vyčerpanie hlási spotreba zápisov', () => {
    expect(source('src/lib/engine/guards.ts')).toContain('WRITE_QUOTA_RESERVE');
  });
});

/* ══════ 4. `reduction-check` — cudzí GET nevyprázdni celú čítaciu dráhu ═══ */

const fullOf = (id: number): ProductFullDetail => ({
  id,
  name: `Prívesok ${id}`,
  price: 9.9,
  has_attributes: false,
  reduction: { state: 'none' },
});

interface CheckWorld {
  readonly deps: ReductionCheckDeps;
  readonly fullCalls: number[];
}

function checkWorld(reads: ReadBudget): CheckWorld {
  const fullCalls: number[] = [];
  return {
    fullCalls,
    deps: {
      shop: {
        async getProductFull(id: number) {
          fullCalls.push(id);
          return fullOf(id);
        },
      },
      apiKey: {
        loadForUse: async () => testKey,
        recallScopes: () => ({ scopes: ['product:read'] as const, checkedAt: NOW }),
      },
      ownWrites: async () => [],
      reads,
      day: TODAY,
      now,
    },
  };
}

describe('reductionCheckDailyCeiling — denný podiel dráhy pre overenie', () => {
  it('je podiel zo stropu dráhy, nie ručne opísané číslo', () => {
    expect(reductionCheckDailyCeiling(LANE_DAY)).toBe(
      Math.floor(LANE_DAY * REDUCTION_CHECK_LANE_SHARE),
    );
    // Obohacovaniu katalógu zostane vždy aspoň druhá polovica dráhy.
    expect(LANE_DAY - reductionCheckDailyCeiling(LANE_DAY)).toBeGreaterThanOrEqual(
      reductionCheckDailyCeiling(LANE_DAY),
    );
  });

  it('nikdy nie nula — jeden produkt sa overiť dá aj pri smiešnej dráhe', () => {
    expect(reductionCheckDailyCeiling(1)).toBe(1);
    expect(reductionCheckDailyCeiling(0)).toBe(1);
    expect(reductionCheckDailyCeiling(Number.NaN)).toBe(1);
  });
});

describe('overenie zľavy sa zastaví na svojom podiele, nie na celej dráhe', () => {
  it('nad podielom nevolá NIČ a povie `budget_shared` — nie `budget_day`', async () => {
    const ceiling = reductionCheckDailyCeiling(LANE_DAY);
    const world = checkWorld(await keyedLane(ceiling));

    const result = await checkReductionsInShop([1, 2], world.deps);

    expect(result.outcome).toBe('budget_shared');
    expect(world.fullCalls).toEqual([]);
    expect(result.readsUsed).toBe(0);
    // Dráha ako celok miesto MÁ — tvrdiť „rozpočet je minutý" by bola nepravda.
    expect(result.reads?.exhausted).toBe(false);
    expect(result.reads?.remaining).toBe(LANE_DAY - ceiling);
    // Riadok pre KAŽDÉ vyžiadané ID aj tak je, s priznaným „nevieme".
    expect(result.products).toHaveLength(2);
    expect(result.products.every((row) => row.verdict === 'unknown')).toBe(true);
    expect(result.products.every((row) => row.shop.state === 'unknown')).toBe(true);
  });

  it('na hrane podielu sa plán SKRÁTI a zvyšok sa prizná', async () => {
    const ceiling = reductionCheckDailyCeiling(LANE_DAY);
    const world = checkWorld(await keyedLane(ceiling - 2));

    const result = await checkReductionsInShop([1, 2, 3, 4], world.deps);

    expect(world.fullCalls).toEqual([1, 2]);
    expect(result.readsUsed).toBe(2);
    expect(result.outcome).toBe('budget_shared');
    expect(result.products).toHaveLength(4);
    expect(result.products.slice(2).every((row) => row.checkedAt === null)).toBe(true);
  });

  it('cudzí GET tak nevie prekročiť podiel ani opakovaním celý deň', async () => {
    const ceiling = reductionCheckDailyCeiling(LANE_DAY);
    /*
     * Zdieľané je ÚLOŽISKO, nie inštancia počítadla: `usedThisMinute` žije
     * v pamäti procesu, takže jedna inštancia by sa zastavila na minútovom
     * strope a dennú poistku by tento test vôbec nepreveril. Cudzia stránka sa
     * o minútu vráti — a v produkcii je za tým reštart appky alebo iná minúta,
     * teda čerstvé minútové okno nad TÝM ISTÝM denným počítadlom.
     */
    const store: ReadBudgetStore = createMemoryReadBudgetStore();
    const freshLane = (): ReadBudget =>
      createReadBudget({ store, lane: 'product_read', now });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      await checkReductionsInShop([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], checkWorld(freshLane()).deps);
    }

    const status = await freshLane().status();
    // Štyridsať dopytov po desiatich = 400 čítaní, keby ich nič nedržalo.
    expect(status.used).toBe(ceiling);
    // Obohacovaniu katalógu zostalo presne to, čo mu patrí.
    expect(status.remaining).toBe(LANE_DAY - ceiling);
    expect(status.exhausted).toBe(false);
  });
});

/* ═════ 5. `POST /api/catalog/details` — `getFull` sa už neplatí naslepo ════ */

function listRow(productId: number): CatalogCacheRecordV3 {
  return {
    productId,
    name: `Zrkadlo ${productId}`,
    price: '19.90' as MoneyString,
    hasAttributes: false,
    shopStatus: 'ok',
    source: 'list',
    fetchedAt: new Date('2026-08-30T03:00:00.000Z'),
    raw: null,
  };
}

interface DetailWorld {
  readonly deps: Omit<ProductDetailsDeps, 'productReads'>;
  readonly fullCalls: number[];
  readonly anon: ReadBudget;
}

function detailWorld(ids: readonly number[]): DetailWorld {
  const rows = new Map<number, CatalogCacheRecordV3>(ids.map((id) => [id, listRow(id)]));
  const fullCalls: number[] = [];
  const anon = createReadBudget({ store: createMemoryReadBudgetStore(), lane: 'anon', now });

  return {
    fullCalls,
    anon,
    deps: {
      shop: {
        async batchGetProducts() {
          throw new Error('verejná dávka sa v tejto ceste volať nesmie');
        },
        async getProductFull(id: number) {
          fullCalls.push(id);
          return fullOf(id);
        },
      },
      catalog: {
        async detailsFor(productIds: readonly number[]) {
          const out = new Map<number, CatalogDetailRow>();
          for (const id of productIds) {
            const row = rows.get(id);
            out.set(id, row === undefined ? emptyCatalogDetail(id) : catalogDetailFromRecord(row));
          }
          return out;
        },
        async upsertMany() {
          return 1;
        },
        async markShopStatus() {
          return undefined;
        },
        reserveShopReads: (count = 1) => anon.reserve(count),
        shopReadBudget: () => anon.status(),
      },
      apiKey: {
        loadForUse: async () => testKey,
        recallScopes: () => ({ scopes: ['product:read'] as const, checkedAt: NOW }),
      },
      now,
    },
  };
}

describe('`getFull` v doťahovaní detailov sa účtuje do dráhy `product_read`', () => {
  it('každé volanie stojí jedno čítanie dráhy — a anonymné počítadlo sa nedotkne', async () => {
    const world = detailWorld([1, 2, 3]);
    const lane = await keyedLane();

    const result = await fillProductDetails([1, 2, 3], { ...world.deps, productReads: lane });

    expect(result.route).toBe('getFull');
    expect(world.fullCalls).toEqual([1, 2, 3]);
    expect(result.keyedReadsUsed).toBe(3);
    expect((await lane.status()).used).toBe(3);
    // Anonymná kvóta je na IP a patrí synchronizácii katalógu — tá zostáva nedotknutá.
    expect(result.readsUsed).toBe(0);
    expect((await world.anon.status()).used).toBe(0);
  });

  it('bez počítadla dráhy sa NEVOLÁ nič (fail-closed, nie tiché platenie)', async () => {
    const world = detailWorld([1, 2]);

    const result = await fillProductDetails([1, 2], world.deps);

    expect(result.outcome).toBe('budget_unknown');
    expect(result.notFilledReason).toBe('budget_unknown');
    expect(world.fullCalls).toEqual([]);
    expect(result.keyedReadsUsed).toBe(0);
  });

  it('minutá dráha je meraný fakt `budget_day` a nič sa nezaplatí', async () => {
    const world = detailWorld([1, 2]);
    const lane = await keyedLane(LANE_DAY);

    const result = await fillProductDetails([1, 2], { ...world.deps, productReads: lane });

    expect(result.outcome).toBe('budget_day');
    expect(world.fullCalls).toEqual([]);
    expect(result.keyedReadsUsed).toBe(0);
    expect(result.keyedReads?.exhausted).toBe(true);
  });

  it('plán sa skrátí na minútu dráhy a zvyšok sa prizná, nie zahodí', async () => {
    const world = detailWorld([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const lane = await keyedLane();
    // Dráha má minútový strop 16; vyčerpáme ho na 3 voľné miesta.
    const minuteLimit = READ_LANE_LIMITS.product_read.perMinute;
    await lane.reserve(minuteLimit - 3);

    const result = await fillProductDetails([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {
      ...world.deps,
      productReads: lane,
    });

    expect(world.fullCalls).toEqual([1, 2, 3]);
    expect(result.keyedReadsUsed).toBe(3);
    expect(result.notFilled).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(result.notFilledReason).toBe('budget_minute');
  });
});

/* ═════ 6. `GET /api/catalog/reduction-check` — cudzia stránka a strop ══════ */

/*
 * GET origin check (D72) mať nemôže — tá posudzuje mutácie. Cesta preto stojí
 * na POZITÍVNOM dôkaze cudzieho pôvodu: nesúhlasný `Origin` (posiela každý
 * cross-origin `fetch`, aj GET) alebo `Sec-Fetch-Site: cross-site` (posiela
 * prehliadač aj pri `<img>`/`<script>`, kde `Origin` nie je). Chýbajúce
 * hlavičky NEODMIETAME: `curl` ani adresný riadok ich nemá a toto je čítanie.
 */
function reductionRoute(reads: ReadBudget) {
  const routeDeps: RouteDeps = {
    now,
    newRequestId: () => '01J0000000000000000CHECK',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
  const world = checkWorld(reads);
  return createReductionCheckRoute({
    shop: world.deps.shop,
    apiKey: world.deps.apiKey,
    ownWrites: world.deps.ownWrites,
    reads,
    now,
    routeDeps,
  });
}

async function callCheck(
  reads: ReadBudget,
  headers: Record<string, string> = {},
): Promise<{ status: number; code: string | null }> {
  const response = await reductionRoute(reads)(
    new Request('https://zlavy.local/api/catalog/reduction-check?productIds=1', { headers }),
  );
  const body = (await response.json()) as { ok: boolean; error?: { code: string } };
  return { status: response.status, code: body.error?.code ?? null };
}

describe('GET /api/catalog/reduction-check — brána cudzieho pôvodu', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('cudzí `Origin` je odmietnutý a shop sa nedotkne', async () => {
    const lane = await keyedLane();
    const result = await callCheck(lane, { origin: 'https://cudzia.example' });

    expect(result.status).toBe(403);
    expect(result.code).toBe('origin_mismatch');
    // Nezaplatilo sa ani jedno čítanie z kvóty zápisového kľúča.
    expect((await lane.status()).used).toBe(0);
  });

  it('`Sec-Fetch-Site: cross-site` je odmietnutý aj bez `Origin` (`<img>`, `<script>`)', async () => {
    const lane = await keyedLane();
    const result = await callCheck(lane, { 'sec-fetch-site': 'cross-site' });

    expect(result.status).toBe(403);
    expect((await lane.status()).used).toBe(0);
  });

  it('vlastná appka prejde — `Origin` sa rovná hostu, `Sec-Fetch-Site: same-origin`', async () => {
    const lane = await keyedLane();
    const result = await callCheck(lane, {
      origin: 'https://zlavy.local',
      'sec-fetch-site': 'same-origin',
    });

    expect(result.status).toBe(200);
    expect(result.code).toBe(null);
  });

  it('chýbajúce hlavičky nie sú dôkaz cudzieho pôvodu (curl, adresný riadok)', async () => {
    expect((await callCheck(await keyedLane())).status).toBe(200);
  });

  it('minútový strop cesty je 6, nie 12 — siedmy dopyt v minúte dostane 429', async () => {
    const lane = await keyedLane();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await callCheck(lane)).status).toBe(200);
    }
    const seventh = await callCheck(lane);
    expect(seventh.status).toBe(429);
    expect(seventh.code).toBe('too_many_attempts');
  });
});
