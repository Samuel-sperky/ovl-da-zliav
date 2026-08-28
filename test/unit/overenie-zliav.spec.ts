/**
 * Aura Zľavy — OVERENIE SKUTOČNÉHO STAVU ZĽAVY (KONTRAKT-API-V5, bod A2, R2, I11).
 *
 * Akceptačné kritérium 4 kontraktu v5 znie: „Pri produkte je vidieť SKUTOČNÚ
 * zľavu zo shopu aj to, čo o nej appka sama vie — a keď sa rozchádzajú, povie
 * to." Tento súbor to dokazuje, a k tomu štyri veci, ktoré sa pri takom
 * porovnaní dajú pokaziť ticho:
 *
 *  A. **„Nevieme" sa nesmie tváriť ako „sedí".** Keď `getFull` nemá oprávnenie,
 *     minie rozpočet alebo neodpovie, výrok je `unknown` — nikdy `match` a nikdy
 *     chýbajúci riadok. Prázdne miesto na obrazovke vyzerá ako poriadok.
 *  B. **Zápis dopredu nie je rozdiel.** Fronta píše zľavu týždne pred jej
 *     začiatkom a `getFull` hlási LEN práve bežiacu zľavu. Vyhlásiť dnešné
 *     `null` za nález by na jednej zľave vyrobilo 8 000 falošných rozdielov.
 *  C. **Rozpočet a strop.** Overenie je platené čítanie s kľúčom; rezervuje sa
 *     PRED volaním, nečitateľné počítadlo nie je minutý rozpočet, a strop na
 *     jedno overenie sa nedá prekročiť parametrom.
 *  D. **Nič sa neukladá.** `catalog_cache` je zrkadlo verejného zoznamu; hodnota
 *     z `getFull` starne v okamihu zápisu a z merania by sa stalo tvrdenie.
 *
 * Rozpočet sa NEFEJKUJE — beží skutočný `createReadBudget()` nad pamäťovým
 * úložiskom, takže testy merajú tú istú aritmetiku, ktorá chráni produkciu.
 * Žiadna DB, žiadny `fetch` (I6).
 *
 * Vlastník: V16 (overenie skutočnosti).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
  DateOnly,
  ItemStatus,
  ProductFullDetail,
  SecretHandle,
  SecretRef,
  ShopReductionState,
} from '@/contracts';

import { createReductionCheckRoute } from '@/app/api/catalog/reduction-check/route';
import type { ReductionCheckResponse } from '@/app/api/catalog/reduction-check/route';
import {
  REDUCTION_CHECK_MAX,
  checkReductionsInShop,
  type ReductionCheckDeps,
} from '@/lib/catalog/reduction-check';
import {
  compareReduction,
  deriveOwnReduction,
  summarizeReductions,
  type OwnReductionState,
} from '@/lib/catalog/reduction-compare';
import type { RouteDeps } from '@/lib/http/define-route';
import type { ProductWriteRow } from '@/lib/repo/insights.repo';
import type { ShopScope } from '@/lib/shop/client';
import { ShopRequestError, makeShopError } from '@/lib/shop/errors';
import {
  READ_LANE_LIMITS,
  createMemoryReadBudgetStore,
  createReadBudget,
  type ReadBudget,
  type ReadBudgetStore,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Prostredie ════════════════════════════════ */

const NOW = new Date('2026-08-18T09:00:00.000Z');
const now = (): Date => NOW;
const TODAY: DateOnly = '2026-08-18';

const ANON = READ_LANE_LIMITS.anon;

function memoryBudget(store: ReadBudgetStore = createMemoryReadBudgetStore()): ReadBudget {
  return createReadBudget({ store, lane: 'anon', now });
}

/** Úložisko, ktoré sa nedá prečítať — „nevieme, koľko dnes odišlo". */
function brokenStore(): ReadBudgetStore {
  return {
    async used() {
      throw new Error('DB nie je dostupná');
    },
    async add() {
      throw new Error('DB nie je dostupná');
    },
  };
}

/** `SecretRef` nad textom — kľúč v testoch nikdy nie je skutočný. */
const testKey: SecretRef = async (): Promise<SecretHandle> => ({
  value: Buffer.from('test-key', 'utf8'),
  release: () => undefined,
});

const notFound = (): ShopRequestError =>
  new ShopRequestError(makeShopError({ kind: 'not_found', code: 'not found' }));

const rateLimited = (): ShopRequestError =>
  new ShopRequestError(makeShopError({ kind: 'rate_limited', code: 'too many requests' }));

/** Jeden vlastný zápis tak, ako ho vracia `insightsRepo.productWrites()`. */
function ownWrite(patch: Partial<ProductWriteRow> = {}): ProductWriteRow {
  return {
    itemId: 1,
    campaignId: 1,
    campaignName: 'Ležiaky striebro — jeseň',
    status: 'ok',
    percent: 20,
    dateFrom: '2026-08-10',
    dateTo: '2026-08-24',
    at: '2026-08-11T07:00:00.000Z',
    ...patch,
  };
}

/** Stav zľavy tak, ako ho hlási eshop. */
function shopActive(percent: number, from: DateOnly, to: DateOnly): ShopReductionState {
  return { state: 'active', percent, from, to };
}

const SHOP_NONE: ShopReductionState = { state: 'none' };

/* ═════════════ 2. Vlastný záznam — ktorý zápis sa dňa týka ════════════════ */

describe('vlastné zápisy — ktorý z nich sa porovnávaného dňa týka', () => {
  it('okno, ktoré deň pokrýva, je „očakávame zľavu"', () => {
    const own = deriveOwnReduction([ownWrite()], TODAY);
    expect(own.state).toBe('expected');
    expect(own.state === 'expected' && own.write.percent).toBe(20);
  });

  it('okno, ktoré sa ešte nezačalo, je vlastný stav — nie „nič sme nezapísali"', () => {
    // Toto je tvar fronty Z-1: zapisuje sa od 24. 7., okno začína 4. 9.
    const own = deriveOwnReduction(
      [ownWrite({ dateFrom: '2026-09-04', dateTo: '2026-09-18' })],
      TODAY,
    );
    expect(own.state).toBe('ahead');
  });

  it('okno, ktoré je za nami, neznamená nič — appka dnes zľavu neočakáva', () => {
    const own = deriveOwnReduction(
      [ownWrite({ dateFrom: '2026-06-15', dateTo: '2026-07-15' })],
      TODAY,
    );
    expect(own.state).toBe('none');
  });

  it('neúspešné a nezapísané pokusy sa do očakávania nerátajú', () => {
    for (const status of ['failed', 'not_found', 'blocked', 'skipped', 'interrupted', 'pending'] as const) {
      expect(deriveOwnReduction([ownWrite({ status })], TODAY).state).toBe('none');
    }
  });

  it('„nevieme, či sa zapísalo" (D45) si nesie vlastný príznak, nezahodí sa', () => {
    const own = deriveOwnReduction([ownWrite({ status: 'uncertain' })], TODAY);
    expect(own.state === 'expected' && own.write.writeStatus).toBe('uncertain');
  });

  it('pri dvoch zápisoch na ten istý deň platí ten NOVŠÍ — shop si starý neodkladá', () => {
    const own = deriveOwnReduction(
      [
        ownWrite({ itemId: 1, campaignId: 1, percent: 10, at: '2026-08-11T07:00:00.000Z' }),
        ownWrite({ itemId: 2, campaignId: 2, percent: 25, at: '2026-08-15T07:00:00.000Z' }),
      ],
      TODAY,
    );
    expect(own.state === 'expected' && own.write.percent).toBe(25);
  });

  it('poradie na vstupe nerozhoduje — funkcia si triedi sama', () => {
    const rows = [
      ownWrite({ itemId: 2, campaignId: 2, percent: 25, at: '2026-08-15T07:00:00.000Z' }),
      ownWrite({ itemId: 1, campaignId: 1, percent: 10, at: '2026-08-11T07:00:00.000Z' }),
    ];
    const reversed = [...rows].reverse();
    expect(deriveOwnReduction(rows, TODAY)).toEqual(deriveOwnReduction(reversed, TODAY));
  });

  it('bez jediného zápisu je stav „nič", nie prázdno', () => {
    expect(deriveOwnReduction([], TODAY)).toEqual({ state: 'none' });
  });
});

/* ═══════════ 3. Porovnanie — tri výroky, ktoré sa nikdy nezlejú ═══════════ */

const EXPECTED: OwnReductionState = { state: 'expected', write: { ...toRecord(ownWrite()) } };

function toRecord(row: ProductWriteRow) {
  return {
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    percent: row.percent,
    from: row.dateFrom,
    to: row.dateTo,
    at: row.at,
    writeStatus: row.status === 'uncertain' ? ('uncertain' as const) : ('ok' as const),
  };
}

describe('porovnanie — sedí', () => {
  it('appka nič nezapísala a eshop žiadnu zľavu nehlási', () => {
    const result = compareReduction({ state: 'none' }, SHOP_NONE);
    expect(result.verdict).toBe('match');
    expect(result.differences).toEqual([]);
    expect(result.unknownCause).toBeNull();
    expect(result.nextStep).toBe('none');
  });

  it('rovnaké percento aj rovnaké okno', () => {
    const result = compareReduction(EXPECTED, shopActive(20, '2026-08-10', '2026-08-24'));
    expect(result.verdict).toBe('match');
  });

  it('`15` a `15.00` je to isté číslo — desatinný zápis nie je rozdiel', () => {
    const own: OwnReductionState = {
      state: 'expected',
      write: { ...toRecord(ownWrite({ percent: 15 })) },
    };
    expect(compareReduction(own, shopActive(15.0, '2026-08-10', '2026-08-24')).verdict).toBe('match');
  });
});

describe('porovnanie — rozchádza sa (NÁLEZ, nie chyba)', () => {
  it('iné percento: my 20 %, eshop 15 %', () => {
    const result = compareReduction(EXPECTED, shopActive(15, '2026-08-10', '2026-08-24'));
    expect(result.verdict).toBe('differs');
    expect(result.differences).toEqual(['percent']);
    // Obe strany sú vo výsledku — obrazovka musí vedieť napísať obe čísla.
    expect(result.own.state === 'expected' && result.own.write.percent).toBe(20);
    expect(result.shop.state === 'active' && result.shop.percent).toBe(15);
  });

  it('iné okno pri rovnakom percente', () => {
    const result = compareReduction(EXPECTED, shopActive(20, '2026-08-10', '2026-09-30'));
    expect(result.differences).toEqual(['window']);
  });

  it('iné percento AJ iné okno sa hlásia obe, nie jedno', () => {
    const result = compareReduction(EXPECTED, shopActive(15, '2026-08-01', '2026-09-30'));
    expect(result.differences).toEqual(['percent', 'window']);
  });

  it('appka zľavu zapísala, eshop ju nehlási — dá sa zapísať znova', () => {
    const result = compareReduction(EXPECTED, SHOP_NONE);
    expect(result.verdict).toBe('differs');
    expect(result.differences).toEqual(['missing']);
    expect(result.nextStep).toBe('write_again');
  });

  it('eshop hlási zľavu, ktorú appka nezapisovala — to je tá cudzia ruka v admine', () => {
    const result = compareReduction({ state: 'none' }, shopActive(35, '2026-08-01', '2026-08-31'));
    expect(result.verdict).toBe('differs');
    expect(result.differences).toEqual(['extra']);
    expect(result.nextStep).toBe('decide');
  });

  it('percento mimo nášho rozsahu 1–30 sa neupravuje ani nezamlčí', () => {
    const result = compareReduction(EXPECTED, shopActive(70, '2026-08-10', '2026-08-24'));
    expect(result.differences).toEqual(['percent']);
    expect(result.shop.state === 'active' && result.shop.percent).toBe(70);
  });
});

describe('porovnanie — NEVIEME (a nikdy to nevyzerá ako „sedí")', () => {
  it('nečitateľný eshop prebíja všetko — ani „sedí", ani „rozchádza sa"', () => {
    for (const reason of ['read_failed', 'partial', 'invalid'] as const) {
      const result = compareReduction(EXPECTED, { state: 'unknown', reason });
      expect(result.verdict).toBe('unknown');
      expect(result.unknownCause).toBe('shop_unread');
      expect(result.differences).toEqual([]);
      expect(result.nextStep).toBe('read_again');
    }
  });

  it('„nepýtali sme sa" ponúka iný krok než „nedozvedeli sme sa"', () => {
    const notChecked = compareReduction(EXPECTED, { state: 'unknown', reason: 'not_checked' });
    expect(notChecked.unknownCause).toBe('shop_unread');
    // Tlačidlo „skúsiť znova" tu nemá čo spraviť — chýba oprávnenie.
    expect(notChecked.nextStep).toBe('need_permission');
  });

  it('zápis dopredu a tichý eshop je NEVIEME, nie rozdiel (inak 8 000 falošných nálezov)', () => {
    const ahead: OwnReductionState = {
      state: 'ahead',
      write: { ...toRecord(ownWrite({ dateFrom: '2026-09-04', dateTo: '2026-09-18' })) },
    };
    const result = compareReduction(ahead, SHOP_NONE);
    expect(result.verdict).toBe('unknown');
    expect(result.unknownCause).toBe('not_started');
    expect(result.nextStep).toBe('check_after_start');
    expect(result.differences).toEqual([]);
  });

  it('zápis dopredu, ktorý eshop hlási presne tak, ako sme ho poslali, sedí', () => {
    const ahead: OwnReductionState = {
      state: 'ahead',
      write: { ...toRecord(ownWrite({ dateFrom: '2026-09-04', dateTo: '2026-09-18' })) },
    };
    expect(compareReduction(ahead, shopActive(20, '2026-09-04', '2026-09-18')).verdict).toBe('match');
  });

  it('zápis dopredu a INÁ bežiaca zľava je rozdiel — na dnešok appka nič nezapisovala', () => {
    const ahead: OwnReductionState = {
      state: 'ahead',
      write: { ...toRecord(ownWrite({ dateFrom: '2026-09-04', dateTo: '2026-09-18' })) },
    };
    const result = compareReduction(ahead, shopActive(35, '2026-08-01', '2026-08-31'));
    expect(result.verdict).toBe('differs');
    expect(result.differences).toEqual(['extra']);
  });

  it('nečitateľné VLASTNÉ zápisy sú tiež NEVIEME — nie „appka nič nezapísala"', () => {
    const result = compareReduction({ state: 'unknown' }, shopActive(20, '2026-08-10', '2026-08-24'));
    expect(result.verdict).toBe('unknown');
    expect(result.unknownCause).toBe('own_unread');
    // Keby sa nečitateľná vlastná DB čítala ako `none`, každá bežiaca zľava by
    // sa ohlásila ako cudzia zmena v admine.
    expect(result.differences).toEqual([]);
  });

  it('výrok `unknown` má VŽDY dôvod a výrok `match` ho nemá NIKDY', () => {
    const cases = [
      compareReduction(EXPECTED, SHOP_NONE),
      compareReduction(EXPECTED, shopActive(20, '2026-08-10', '2026-08-24')),
      compareReduction(EXPECTED, { state: 'unknown', reason: 'read_failed' }),
      compareReduction({ state: 'unknown' }, SHOP_NONE),
    ];
    for (const result of cases) {
      if (result.verdict === 'unknown') expect(result.unknownCause).not.toBeNull();
      else expect(result.unknownCause).toBeNull();
    }
  });

  it('súhrn počíta `unknown` zvlášť — nikdy sa nepripočíta k „sedí"', () => {
    const summary = summarizeReductions([
      { verdict: 'match' },
      { verdict: 'differs' },
      { verdict: 'unknown' },
      { verdict: 'unknown' },
    ]);
    expect(summary).toEqual({ match: 1, differs: 1, unknown: 2 });
  });
});

describe('neistý zápis (D45) sa práve tu uzatvára', () => {
  const uncertain: OwnReductionState = {
    state: 'expected',
    write: { ...toRecord(ownWrite({ status: 'uncertain' })) },
  };

  it('eshop odpovedal — neistota je uzavretá, nech odpovedal čokoľvek', () => {
    expect(compareReduction(uncertain, SHOP_NONE).resolvesUncertainWrite).toBe(true);
    expect(
      compareReduction(uncertain, shopActive(20, '2026-08-10', '2026-08-24')).resolvesUncertainWrite,
    ).toBe(true);
  });

  it('eshop neodpovedal — neistota trvá ďalej', () => {
    const result = compareReduction(uncertain, { state: 'unknown', reason: 'read_failed' });
    expect(result.resolvesUncertainWrite).toBe(false);
  });

  it('istý zápis príznak nikdy nenesie', () => {
    expect(compareReduction(EXPECTED, SHOP_NONE).resolvesUncertainWrite).toBe(false);
  });
});

/* ═══════════════ 4. Čítanie zo shopu — brány pred `getFull` ═══════════════ */

interface WorldOptions {
  readonly scopes?: readonly ShopScope[];
  readonly hasKey?: boolean;
  /** Stav zľavy, ktorý eshop vráti pre dané ID. */
  readonly reductions?: Readonly<Record<number, ShopReductionState>>;
  /** ID, na ktorých `getFull` spadne inak než na „nenašiel". */
  readonly broken?: readonly number[];
  /** ID, ktoré eshop nepozná. */
  readonly missing?: readonly number[];
  /** Vlastné zápisy podľa ID produktu. */
  readonly own?: Readonly<Record<number, readonly ProductWriteRow[]>>;
  /** ID, pri ktorých vlastná DB spadne. */
  readonly ownBroken?: readonly number[];
  readonly budget?: ReadBudget;
}

interface World {
  readonly deps: ReductionCheckDeps;
  readonly fullCalls: number[];
  readonly budget: ReadBudget;
}

function world(options: WorldOptions = {}): World {
  const fullCalls: number[] = [];
  const budget = options.budget ?? memoryBudget();
  return {
    fullCalls,
    budget,
    deps: {
      shop: {
        async getProductFull(id: number): Promise<ProductFullDetail> {
          fullCalls.push(id);
          if ((options.missing ?? []).includes(id)) throw notFound();
          if ((options.broken ?? []).includes(id)) throw rateLimited();
          return {
            id,
            name: `Produkt ${id}`,
            price: 34.9,
            has_attributes: false,
            reduction: (options.reductions ?? {})[id] ?? SHOP_NONE,
          };
        },
      },
      apiKey: {
        loadForUse: async () => (options.hasKey === false ? null : testKey),
        recallScopes: () => ({
          scopes: options.scopes === undefined ? null : options.scopes,
          checkedAt: options.scopes === undefined ? null : NOW,
        }),
      },
      ownWrites: async (productId: number) => {
        if ((options.ownBroken ?? []).includes(productId)) throw new Error('DB nie je dostupná');
        return (options.own ?? {})[productId] ?? [];
      },
      reads: budget,
      day: TODAY,
      now,
    },
  };
}

const WITH_SCOPE: readonly ShopScope[] = ['product:edit', 'product:read'];

describe('bez oprávnenia sa `getFull` NEVOLÁ, ale mlčí sa tiež nie', () => {
  it('neoverený kľúč = NEVIEME, nie „nemá" — a riadky sú aj tak vyplnené', async () => {
    const { deps, fullCalls } = world({ own: { 5: [ownWrite()] } });
    const result = await checkReductionsInShop([5], deps);

    expect(result.outcome).toBe('unknown_scope');
    expect(result.capability.state).toBe('unknown');
    // Veta existuje a je JEDNA (`missingScopeSentence`); kreslí ju LockedFeatures.
    expect(result.capability.note).not.toBeNull();
    expect(fullCalls).toEqual([]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.verdict).toBe('unknown');
    expect(result.products[0]?.shop).toEqual({ state: 'unknown', reason: 'not_checked' });
    // Vlastný záznam je vidieť aj tak — je z vlastnej DB a nič nestojí.
    expect(result.products[0]?.own.state).toBe('expected');
    expect(result.summary).toEqual({ match: 0, differs: 0, unknown: 1 });
  });

  it('kľúč BEZ oprávnenia je meraný fakt „nemá", nie „nevieme"', async () => {
    const { deps, fullCalls } = world({ scopes: ['product:edit'] });
    const result = await checkReductionsInShop([5], deps);

    expect(result.outcome).toBe('locked');
    expect(result.capability.state).toBe('locked');
    expect(fullCalls).toEqual([]);
    expect(result.products[0]?.verdict).toBe('unknown');
  });

  it('chýbajúci kľúč je tretia vec — a tiež nie „zľava nebeží"', async () => {
    const { deps, fullCalls } = world({ scopes: WITH_SCOPE, hasKey: false });
    const result = await checkReductionsInShop([5], deps);

    expect(result.outcome).toBe('no_key');
    expect(fullCalls).toEqual([]);
    expect(result.products[0]?.shop.state).toBe('unknown');
  });

  it('prázdny zoznam nič nevolá a nič netvrdí', async () => {
    const { deps, fullCalls } = world({ scopes: WITH_SCOPE });
    const result = await checkReductionsInShop([], deps);
    expect(result.outcome).toBe('no_ids');
    expect(result.products).toEqual([]);
    expect(fullCalls).toEqual([]);
  });
});

describe('rozpočet — rezervuje sa PRED volaním a nečíta sa, čo sa nezmestí', () => {
  it('minutý denný rozpočet je meraný fakt a shop sa nevolá', async () => {
    const budget = memoryBudget();
    await budget.reserve(ANON.perUtcDay);
    const { deps, fullCalls } = world({ scopes: WITH_SCOPE, budget });

    const result = await checkReductionsInShop([5], deps);
    expect(result.outcome).toBe('budget_day');
    expect(fullCalls).toEqual([]);
    expect(result.products[0]?.verdict).toBe('unknown');
  });

  it('nečitateľné počítadlo NIE JE minutý rozpočet — sú to dve rôzne vety', async () => {
    const { deps, fullCalls } = world({
      scopes: WITH_SCOPE,
      budget: memoryBudget(brokenStore()),
    });

    const result = await checkReductionsInShop([5], deps);
    expect(result.outcome).toBe('budget_unknown');
    expect(fullCalls).toEqual([]);
  });

  it('každé prečítanie stojí presne jedno čítanie a je zarátané', async () => {
    const { deps, fullCalls, budget } = world({
      scopes: WITH_SCOPE,
      reductions: { 5: SHOP_NONE, 6: SHOP_NONE, 7: SHOP_NONE },
    });

    const result = await checkReductionsInShop([5, 6, 7], deps);
    expect(fullCalls).toEqual([5, 6, 7]);
    expect(result.readsUsed).toBe(3);
    expect((await budget.status()).used).toBe(3);
    expect(result.reads?.used).toBe(3);
  });

  it('minútový strop plán SKRÁTI, nezruší — zvyšok ostane priznaný ako NEVIEME', async () => {
    const budget = memoryBudget();
    // Minútový strop je 24 z 30; necháme miesto na dve čítania.
    await budget.reserve(ANON.perMinute - 2);
    const { deps, fullCalls } = world({ scopes: WITH_SCOPE, budget });

    const result = await checkReductionsInShop([1, 2, 3, 4], deps);
    expect(fullCalls).toEqual([1, 2]);
    expect(result.outcome).toBe('budget_minute');
    expect(result.products).toHaveLength(4);
    expect(result.products[2]?.shop).toEqual({ state: 'unknown', reason: 'not_checked' });
    expect(result.products[3]?.verdict).toBe('unknown');
  });

  it('strop jedného overenia sa nedá prekročiť parametrom', async () => {
    const ids = Array.from({ length: REDUCTION_CHECK_MAX + 5 }, (_, i) => i + 1);
    const { deps, fullCalls } = world({ scopes: WITH_SCOPE });

    const result = await checkReductionsInShop(ids, { ...deps, limit: 999 });
    expect(fullCalls).toHaveLength(REDUCTION_CHECK_MAX);
    expect(result.products).toHaveLength(REDUCTION_CHECK_MAX);
    expect(result.skippedIds).toEqual(ids.slice(REDUCTION_CHECK_MAX));
  });

  it('rovnaké ID dvakrát je jedno čítanie, nie dve', async () => {
    const { deps, fullCalls } = world({ scopes: WITH_SCOPE });
    await checkReductionsInShop([5, 5, 5], deps);
    expect(fullCalls).toEqual([5]);
  });
});

describe('overenie naostro — čo obrazovka dostane', () => {
  it('sedí, rozchádza sa a nevieme naraz — a súhrn ich nezlieva', async () => {
    const { deps } = world({
      scopes: WITH_SCOPE,
      own: {
        1: [ownWrite({ percent: 20 })],
        2: [ownWrite({ percent: 10 })],
        3: [ownWrite({ dateFrom: '2026-09-04', dateTo: '2026-09-18' })],
      },
      reductions: {
        1: shopActive(20, '2026-08-10', '2026-08-24'),
        2: shopActive(15, '2026-08-10', '2026-08-24'),
        3: SHOP_NONE,
      },
    });

    const result = await checkReductionsInShop([1, 2, 3], deps);
    expect(result.outcome).toBe('done');
    expect(result.products.map((row) => row.verdict)).toEqual(['match', 'differs', 'unknown']);
    expect(result.products[1]?.differences).toEqual(['percent']);
    expect(result.products[2]?.unknownCause).toBe('not_started');
    expect(result.summary).toEqual({ match: 1, differs: 1, unknown: 1 });
    // Čas overenia je konkrétny, nikdy „pred chvíľou" (kontrakt UI, bod 10).
    expect(result.products[0]?.checkedAt).toEqual(NOW);
    expect(result.day).toBe(TODAY);
  });

  it('cudzia zľava, ktorú appka nikdy nezapisovala, sa nájde', async () => {
    const { deps } = world({
      scopes: WITH_SCOPE,
      reductions: { 9: shopActive(35, '2026-08-01', '2026-08-31') },
    });
    const result = await checkReductionsInShop([9], deps);
    expect(result.products[0]?.verdict).toBe('differs');
    expect(result.products[0]?.differences).toEqual(['extra']);
  });

  it('„eshop taký produkt nemá" je fakt o jednom riadku a zvyšok pokračuje', async () => {
    const { deps, fullCalls } = world({
      scopes: WITH_SCOPE,
      missing: [2],
      reductions: { 1: SHOP_NONE, 3: SHOP_NONE },
    });

    const result = await checkReductionsInShop([1, 2, 3], deps);
    expect(fullCalls).toEqual([1, 2, 3]);
    expect(result.outcome).toBe('done');
    expect(result.products[1]?.verdict).toBe('unknown');
    expect(result.products[1]?.error).toBe('not found');
    // Z „produkt nemám" sa NEODVODZUJE „zľava nebeží".
    expect(result.products[1]?.shop).toEqual({ state: 'unknown', reason: 'read_failed' });
  });

  it('iná chyba zastaví zvyšok, ale to, čo sa stihlo, ostáva', async () => {
    const { deps, fullCalls } = world({
      scopes: WITH_SCOPE,
      broken: [2],
      own: { 1: [ownWrite()] },
      reductions: { 1: shopActive(20, '2026-08-10', '2026-08-24') },
    });

    const result = await checkReductionsInShop([1, 2, 3], deps);
    expect(fullCalls).toEqual([1, 2]);
    expect(result.outcome).toBe('failed');
    expect(result.error).toBe('too many requests');
    expect(result.products[0]?.verdict).toBe('match');
    expect(result.products[1]?.shop).toEqual({ state: 'unknown', reason: 'read_failed' });
    // Riadok, na ktorý sa nedostalo, tam JE a je priznaný.
    expect(result.products[2]?.verdict).toBe('unknown');
    expect(result.products[2]?.shop).toEqual({ state: 'unknown', reason: 'not_checked' });
  });

  it('nečitateľná vlastná DB neznamená „nič sme nezapísali"', async () => {
    const { deps, fullCalls } = world({
      scopes: WITH_SCOPE,
      ownBroken: [4],
      reductions: { 4: shopActive(20, '2026-08-10', '2026-08-24') },
    });

    const result = await checkReductionsInShop([4], deps);
    expect(result.products[0]?.verdict).toBe('unknown');
    expect(result.products[0]?.unknownCause).toBe('own_unread');
    // Za produkt, ktorý sa nedá porovnať, sa neplatí čítaním.
    expect(fullCalls).toEqual([]);
  });

  it('modul NIKDY nehádže — ani keď spadne všetko naraz', async () => {
    const { deps } = world({
      scopes: WITH_SCOPE,
      broken: [1],
      budget: memoryBudget(),
    });
    await expect(checkReductionsInShop([1], deps)).resolves.toBeTruthy();
  });
});

/* ═══════════════ 5. Do zrkadla katalógu sa nezapisuje nič ═════════════════ */

describe('overenie nič neukladá', () => {
  it('modul nepozná ani zápis do zrkadla, ani zápis do shopu', () => {
    const file = resolve(process.cwd(), 'src/lib/catalog/reduction-check.ts');
    const raw = readFileSync(file, 'utf8');
    // Komentáre preč — vysvetlenia o `catalog_cache` a o zápise tam byť smú.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

    // `catalog_cache` je zrkadlo VEREJNÉHO zoznamu a jeho počty sa porovnávajú
    // so `shopTotal`. Riadok dopísaný z `getFull` by tie čísla posunul bez toho,
    // aby prechod synchronizácie čokoľvek prečítal.
    expect(code).not.toMatch(/upsert|catalogRepo|catalog_cache/);
    // I7/I13 — overenie je ČÍTANIE. Zápis ani rušenie zľavy sa sem nedostane.
    expect(code).not.toMatch(/setReduction|clearReduction/);
    // Poistka, že orez naozaj nechal kód.
    expect(code).toMatch(/getProductFull/);
  });
});

/* ═══════════════════════════ 6. Route ═════════════════════════════════════ */

function sessionDeps(): RouteDeps {
  return {
    now,
    newRequestId: () => '01J0000000000000000CHECK1',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

async function callRoute(
  query: string,
  options: WorldOptions = {},
): Promise<{ body: { ok: boolean; data: ReductionCheckResponse }; fullCalls: number[] }> {
  const { deps, fullCalls } = world(options);
  const response = await createReductionCheckRoute({
    routeDeps: sessionDeps(),
    shop: deps.shop,
    apiKey: deps.apiKey,
    ownWrites: deps.ownWrites,
    reads: deps.reads,
    now,
  })(
    new Request(`https://zlavy.local/api/catalog/reduction-check${query}`, {
      headers: { cookie: 'ovl_zliav_session=x' },
    }),
  );
  expect(response.status).toBe(200);
  return { body: (await response.json()) as { ok: boolean; data: ReductionCheckResponse }, fullCalls };
}

describe('GET /api/catalog/reduction-check', () => {
  it('bez oprávnenia odpovie celým tvarom — nie chybou a nie prázdnom', async () => {
    const { body, fullCalls } = await callRoute('?productIds=1,2', { own: { 1: [ownWrite()] } });

    expect(body.ok).toBe(true);
    expect(body.data.outcome).toBe('unknown_scope');
    expect(body.data.capability.state).toBe('unknown');
    expect(body.data.products).toHaveLength(2);
    expect(body.data.products.every((row) => row.verdict === 'unknown')).toBe(true);
    expect(body.data.comparedWith).toBe('shop_getfull');
    expect(body.data.limit).toBe(REDUCTION_CHECK_MAX);
    expect(fullCalls).toEqual([]);
  });

  it('s oprávnením vráti obe strany a konkrétny čas', async () => {
    const { body } = await callRoute('?productIds=1&day=2026-08-18', {
      scopes: WITH_SCOPE,
      own: { 1: [ownWrite({ percent: 20 })] },
      reductions: { 1: shopActive(15, '2026-08-10', '2026-08-24') },
    });

    expect(body.data.outcome).toBe('done');
    expect(body.data.day).toBe('2026-08-18');
    const row = body.data.products[0];
    expect(row?.verdict).toBe('differs');
    expect(row?.differences).toEqual(['percent']);
    expect(row?.own.state).toBe('expected');
    expect(row?.shop).toEqual({ state: 'active', percent: 15, from: '2026-08-10', to: '2026-08-24' });
    expect(row?.checkedAt).toBe(NOW.toISOString());
    expect(body.data.at).toBe(NOW.toISOString());
    expect(body.data.readsUsed).toBe(1);
    expect(body.data.reads?.known).toBe(true);
  });

  it('bez ID sa na shop nesiahne', async () => {
    const { body, fullCalls } = await callRoute('', { scopes: WITH_SCOPE });
    expect(body.data.outcome).toBe('no_ids');
    expect(body.data.products).toEqual([]);
    expect(fullCalls).toEqual([]);
  });

  it('nezmyselné ID sa zahodí a nič nevolá', async () => {
    const { body, fullCalls } = await callRoute('?productIds=0,-4,abc', { scopes: WITH_SCOPE });
    expect(body.data.outcome).toBe('no_ids');
    expect(fullCalls).toEqual([]);
  });
});

/* ═══════ 6. Stav položky, ktorý appka nepozná (audit B7, 24. 8. 2026) ══════ */

/**
 * `campaign_items.status` je dnes `ENUM` s ôsmimi hodnotami a `ITEM_STATUSES`
 * má presne tých istých osem, takže z databázy sem deviaty stav dnes nepríde.
 * Príde prvou migráciou, ktorá stav pridá — presne tak, ako vznikol `writing`
 * v `campaigns.status`. Meria sa to preto FIXTÚROU: `productWrites()` typuje
 * stĺpec cez `str(row.status) as ItemStatus`, takže hodnota mimo číselníka je
 * v tejto vrstve bežný reťazec a schéma sa na to meniť nemusí.
 *
 * Čo sa dialo do 24. 8. 2026: taký zápis vypadol z filtra `USABLE_ITEM_STATUSES`
 * rovnako ako `failed`, vlastný stav klesol na `none` a porovnanie vyhlásilo
 * `differs` / `extra` — teda „eshop hlási zľavu, appka ju nezapisovala".
 * Appka tým tvrdila, že do admina eshopu siahol človek.
 */
const NEZNAMY_STAV = 'writing' as ItemStatus;

describe('neznámy stav položky sa neprelieva na obvinenie z ručného zásahu', () => {
  it('zápis s neznámym stavom nie je „appka nič nezapisovala"', () => {
    const own = deriveOwnReduction([ownWrite({ status: NEZNAMY_STAV })], TODAY);
    expect(own.state).toBe('unrecognized');
    expect(own.state).not.toBe('none');
  });

  it('a porovnanie z toho NEVYVODÍ cudzí zásah — je to priznané NEVIEME', () => {
    const own = deriveOwnReduction([ownWrite({ status: NEZNAMY_STAV })], TODAY);
    const result = compareReduction(own, shopActive(20, '2026-08-10', '2026-08-24'));

    expect(result.verdict).toBe('unknown');
    expect(result.verdict).not.toBe('differs');
    expect(result.differences).toEqual([]);
    // `extra` je veta „toto tam dal niekto ručne". Nesmie zaznieť z nevedomosti.
    expect(result.differences).not.toContain('extra');
    expect(result.unknownCause).toBe('own_unrecognized');
    // Opakované čítanie vráti ten istý neznámy stav — tlačidlo by klamalo.
    expect(result.nextStep).toBe('inspect_own_record');
    expect(result.nextStep).not.toBe('read_again');
  });

  it('nevedomosť sa nezlieva ani s tichým eshopom — dôvod je vlastný', () => {
    const own = deriveOwnReduction([ownWrite({ status: NEZNAMY_STAV })], TODAY);
    expect(compareReduction(own, SHOP_NONE).verdict).toBe('unknown');
    expect(compareReduction(own, SHOP_NONE).unknownCause).toBe('own_unrecognized');
    // Aj keď eshop mlčí: „nevideli sme" a „nerozumieme tomu" sú dve medzery.
    const shopTicho = compareReduction(own, { state: 'unknown', reason: 'read_failed' });
    expect(shopTicho.unknownCause).toBe('own_unrecognized');
    expect(shopTicho.unknownCause).not.toBe('own_unread');
  });

  it('platí to aj pre zápis dopredu — okno pred nami nevedomosť nezmaže', () => {
    const own = deriveOwnReduction(
      [ownWrite({ status: NEZNAMY_STAV, dateFrom: '2026-09-04', dateTo: '2026-09-18' })],
      TODAY,
    );
    expect(own.state).toBe('unrecognized');
    expect(compareReduction(own, SHOP_NONE).unknownCause).toBe('own_unrecognized');
  });

  it('rozhoduje NAJNOVŠÍ zápis — neznámy stav pod starším „ok" ho neprebije', () => {
    const own = deriveOwnReduction(
      [
        ownWrite({ itemId: 1, status: 'ok', at: '2026-08-11T07:00:00.000Z' }),
        ownWrite({ itemId: 2, status: NEZNAMY_STAV, at: '2026-08-15T07:00:00.000Z' }),
      ],
      TODAY,
    );
    expect(own.state).toBe('unrecognized');
  });

  it('novší „ok" nad starším neznámym zápisom naopak platí — shop drží posledný', () => {
    const own = deriveOwnReduction(
      [
        ownWrite({ itemId: 1, status: NEZNAMY_STAV, at: '2026-08-11T07:00:00.000Z' }),
        ownWrite({ itemId: 2, status: 'ok', percent: 25, at: '2026-08-15T07:00:00.000Z' }),
      ],
      TODAY,
    );
    expect(own.state === 'expected' && own.write.percent).toBe(25);
  });

  it('neznámy stav v okne ZA NAMI dnešok neovplyvní', () => {
    const own = deriveOwnReduction(
      [ownWrite({ status: NEZNAMY_STAV, dateFrom: '2026-06-15', dateTo: '2026-07-15' })],
      TODAY,
    );
    expect(own.state).toBe('none');
  });

  it('známe stavy sa nezmenili — inak by príznak hlásil pri každej zľave', () => {
    expect(deriveOwnReduction([ownWrite({ status: 'ok' })], TODAY).state).toBe('expected');
    expect(deriveOwnReduction([ownWrite({ status: 'uncertain' })], TODAY).state).toBe('expected');
    for (const status of ['failed', 'not_found', 'blocked', 'skipped', 'interrupted', 'pending'] as const) {
      expect(deriveOwnReduction([ownWrite({ status })], TODAY).state).toBe('none');
    }
  });

  it('celá cesta až do odpovede API hovorí NEVIEME, nie „niekto zasiahol"', async () => {
    const { body } = await callRoute('?productIds=1&day=2026-08-18', {
      scopes: WITH_SCOPE,
      own: { 1: [ownWrite({ status: NEZNAMY_STAV })] },
      reductions: { 1: shopActive(15, '2026-08-10', '2026-08-24') },
    });

    const row = body.data.products[0];
    expect(row?.verdict).toBe('unknown');
    expect(row?.differences).toEqual([]);
    expect(row?.unknownCause).toBe('own_unrecognized');
    expect(row?.own.state).toBe('unrecognized');
    // Meraný stav eshopu ostáva v odpovedi — nevedomosť je na NAŠEJ strane.
    expect(row?.shop).toEqual({ state: 'active', percent: 15, from: '2026-08-10', to: '2026-08-24' });
    expect(body.data.summary).toEqual({ match: 0, differs: 0, unknown: 1 });
  });

  it('vnútorný kód stavu sa do odpovede neprepašuje (K10)', async () => {
    const { body } = await callRoute('?productIds=1&day=2026-08-18', {
      scopes: WITH_SCOPE,
      own: { 1: [ownWrite({ status: NEZNAMY_STAV })] },
    });
    expect(JSON.stringify(body.data.products[0])).not.toContain(NEZNAMY_STAV);
  });
});
