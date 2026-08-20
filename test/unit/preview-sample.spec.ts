/**
 * Aura Zľavy — testy dry-run náhľadu pri pásmach a pri veľkej sade
 * (V6, K1, K3, K4, K7, I3).
 *
 * Dve veci, ktoré tu môžu zabiť dôveru používateľa:
 *
 *  1. **Vzorka „prvých 6".** Pri 8 000 produktoch v dvoch pásmach by prvých 6
 *     riadkov (nech už je zoznam zoradený podľa čohokoľvek) takmer isto padlo
 *     do jedného pásma. Používateľ by potvrdil zľavu, z ktorej videl jedinú
 *     skupinu — typicky tú najlacnejšiu. Testy nižšie vzorku merajú: musí byť
 *     rozložená naprieč pásmami a nesmie to byť prefix zoznamu.
 *
 *  2. **Percento z kampane namiesto z položky.** K3 hovorí, že percento sa
 *     rozhoduje pri POTVRDENÍ a je vlastnosťou položky. Ak by náhľad počítal
 *     zľavnenú cenu z hlavičkového percenta, používateľ by videl inú cenu, než
 *     sa zapíše.
 */
import { describe, expect, it } from 'vitest';

import type { CatalogCacheRecord, ProductDetail, ShopError, ShopCtx } from '@/contracts';
import { createPreviewTokenService } from '@/lib/crypto/preview-token';
import {
  PREVIEW_MAX_ITEM_BLOCKERS,
  PREVIEW_SAMPLE_SIZE,
  PREVIEW_SHOP_DETAIL_MAX,
  buildPreview,
  pickSample,
  type PreviewDeps,
  type PreviewInput,
} from '@/lib/engine/preview';

const CTX: ShopCtx = { operationId: '01JZZZZZZZZZZZZZZZZZZZZZZZ' };

const TOMORROW = '2026-08-11';
const LATER = '2026-08-25';
const NOW = () => new Date('2026-08-10T09:00:00.000Z');

/* ═══════════════════════════ pickSample (čistá) ═══════════════════════════ */

describe('pickSample: 6 riadkov naprieč pásmami, nie prvých 6', () => {
  const tierCandidates = (ord: number, ids: number[]) =>
    ids.map((productId, index) => ({ productId, tierOrd: ord, priceCents: 100 + index }));

  it('dve pásma dostanú 3 + 3, aj keď je jedno sedemnásobne väčšie', () => {
    const big = tierCandidates(1, Array.from({ length: 6940 }, (_, i) => 1000 + i));
    const small = tierCandidates(2, Array.from({ length: 1060 }, (_, i) => 90_000 + i));

    const picked = pickSample([...big, ...small]);
    expect(picked).toHaveLength(PREVIEW_SAMPLE_SIZE);
    expect(picked.filter((id) => id < 90_000)).toHaveLength(3);
    expect(picked.filter((id) => id >= 90_000)).toHaveLength(3);
  });

  it('tri pásma dostanú 2 + 2 + 2', () => {
    const picked = pickSample([
      ...tierCandidates(1, [1, 2, 3, 4, 5, 6, 7, 8]),
      ...tierCandidates(2, [11, 12, 13, 14]),
      ...tierCandidates(3, [21, 22, 23]),
    ]);
    expect(picked).toHaveLength(6);
    expect(picked.filter((id) => id < 10)).toHaveLength(2);
    expect(picked.filter((id) => id >= 10 && id < 20)).toHaveLength(2);
    expect(picked.filter((id) => id >= 20)).toHaveLength(2);
  });

  it('vyčerpané pásmo neblokuje — zvyšné miesta doberú ostatné', () => {
    const picked = pickSample([...tierCandidates(1, [1]), ...tierCandidates(2, [11, 12, 13, 14, 15])]);
    expect(picked).toHaveLength(6);
    expect(picked).toContain(1);
  });

  it('v rámci pásma je to prierez cenníkom, nie prvých N', () => {
    // 100 kandidátov, ceny 100…199. Vzorka jedného pásma musí siahnuť aj na
    // koniec zoznamu, inak by ukázala len jeden koniec cenníka.
    const candidates = Array.from({ length: 100 }, (_, i) => ({
      productId: 500 + i,
      tierOrd: 1,
      priceCents: 100 + i,
    }));
    const picked = pickSample(candidates);
    expect(picked).toHaveLength(6);
    const prefix = candidates.slice(0, 6).map((c) => c.productId);
    expect(picked).not.toEqual(prefix);
    // Najdrahší kus je vždy vo vzorke (zoradenie zostupne podľa ceny) a zároveň
    // sa siahne hlboko do zoznamu.
    expect(Math.max(...picked) - Math.min(...picked)).toBeGreaterThan(50);
  });

  it('je deterministický — potvrdenie sa nemení pod rukami', () => {
    const candidates = [
      ...tierCandidates(1, [5, 3, 9, 1, 7]),
      ...tierCandidates(2, [40, 20, 60]),
    ];
    expect(pickSample(candidates)).toEqual(pickSample(candidates));
  });

  it('menej kandidátov než 6 = všetci (zoradení od najdrahšieho)', () => {
    // `tierCandidates` dáva rastúcu cenu podľa poradia, takže zostupné
    // zoradenie vo vzorke obráti poradie — to je zámer, nie náhoda: v šiestich
    // riadkoch má byť vidieť aj to, čo v zľave stojí najviac.
    expect(pickSample(tierCandidates(1, [1, 2, 3]))).toEqual([3, 2, 1]);
    expect(pickSample([])).toEqual([]);
  });
});

/* ══════════════════════════════ buildPreview ══════════════════════════════ */

interface World {
  deps: PreviewDeps;
  shopCalls: number[][];
  catalogCalls: number[][];
  lastOwnWriteCalls: number[];
  overlapCalls: number[][];
}

function makeWorld(options: {
  productIds: number[];
  /** `plny` režim (K1) — inak platí strop 10 z `pilot`. */
  scopeMode?: 'pilot' | 'plny';
  priceOf?: (productId: number) => number;
  /** Ktoré ID sú v zrkadle katalógu (K7). Default: všetky. */
  inCatalog?: Set<number>;
}): World {
  const priceOf = options.priceOf ?? ((id: number) => 10 + (id % 500));
  const inCatalog = options.inCatalog ?? new Set(options.productIds);
  const shopCalls: number[][] = [];
  const catalogCalls: number[][] = [];
  const lastOwnWriteCalls: number[] = [];
  const overlapCalls: number[][] = [];

  const catalogRepo = {
    async getMany(ids: number[]): Promise<Map<number, CatalogCacheRecord>> {
      catalogCalls.push([...ids]);
      const out = new Map<number, CatalogCacheRecord>();
      for (const id of ids) {
        if (!inCatalog.has(id)) continue;
        out.set(id, {
          productId: id,
          name: `Šperk ${id}`,
          price: priceOf(id).toFixed(2),
          hasAttributes: false,
          source: 'list',
          fetchedAt: new Date('2026-08-10T03:00:00.000Z'),
          raw: null,
        });
      }
      return out;
    },
    async upsert(): Promise<void> {
      /* cache je best-effort */
    },
  };

  const deps: PreviewDeps = {
    shopClient: {
      async batchGetProducts(ids: number[]) {
        shopCalls.push([...ids]);
        const results = new Map<number, ProductDetail | ShopError>();
        for (const id of ids) {
          results.set(id, {
            id,
            name: `Šperk ${id}`,
            price: priceOf(id),
            has_attributes: false,
          } as ProductDetail);
        }
        return { results, via: 'batch' as const };
      },
    },
    allowlistRepo: {
      async areAllActive() {
        return true;
      },
      async listActive() {
        return [];
      },
    } as never,
    campaignsRepo: {
      async lastOwnWrite(productId: number) {
        lastOwnWriteCalls.push(productId);
        return null;
      },
      async findFutureOverlaps(ids: number[]) {
        overlapCalls.push([...ids]);
        return [];
      },
    } as never,
    catalogRepo,
    previewTokens: createPreviewTokenService({ secret: Buffer.alloc(32, 7) }),
    guards: {
      settingsRepo: {
        async readScope() {
          return { mode: options.scopeMode ?? 'plny', maxProductsPerCampaign: 10_000 };
        },
      } as never,
      catalogRepo: catalogRepo as never,
    },
    now: NOW,
  };

  return { deps, shopCalls, catalogCalls, lastOwnWriteCalls, overlapCalls };
}

const baseInput = (productIds: number[]): PreviewInput => ({
  userId: 1,
  kind: 'new',
  productIds,
  percent: 30,
  from: TOMORROW,
  to: LATER,
});

describe('buildPreview: pásma (K3)', () => {
  const productIds = [11, 12, 13, 14, 15, 16];
  const tiers = [
    { ord: 1, label: '0 predaných za 360 dní', percent: 30, productIds: [11, 12, 13] },
    { ord: 2, label: '0 predaných za 180 dní', percent: 20, productIds: [14, 15, 16] },
  ];

  it('percento a zľavnená cena idú z PÁSMA položky, nie z hlavičky', async () => {
    const world = makeWorld({ productIds, priceOf: () => 100 });
    const result = await buildPreview({ ...baseInput(productIds), tiers }, world.deps, CTX);

    expect(result.blockers).toEqual([]);
    const byId = new Map(result.items.map((item) => [item.productId, item]));
    expect(byId.get(11)).toMatchObject({ percent: 30, discountedPrice: '70.00', tierOrd: 1 });
    expect(byId.get(16)).toMatchObject({ percent: 20, discountedPrice: '80.00', tierOrd: 2 });
    expect(result.tiers).toEqual([
      { ord: 1, label: '0 predaných za 360 dní', percent: 30, count: 3 },
      { ord: 2, label: '0 predaných za 180 dní', percent: 20, count: 3 },
    ]);
  });

  it('token nesie percento KAŽDEJ položky — executor pásma nevyhodnocuje (K3, K4)', async () => {
    const world = makeWorld({ productIds });
    const result = await buildPreview({ ...baseInput(productIds), tiers }, world.deps, CTX);

    expect(result.previewToken).not.toBe('');
    const claims = await world.deps.previewTokens!.verify(result.previewToken, {
      kind: 'new',
      productIds,
      percent: 30,
      from: TOMORROW,
      to: LATER,
    });
    expect(claims.percents).toEqual({ '11': 30, '12': 30, '13': 30, '14': 20, '15': 20, '16': 20 });
    expect(Object.keys(claims.pricesAtPreview).sort()).toEqual(
      productIds.map(String).sort(),
    );
  });

  it('hlavička, ktorá nie je najvyšším pásmom, je blokátor (K3)', async () => {
    const world = makeWorld({ productIds });
    const result = await buildPreview(
      { ...baseInput(productIds), percent: 20, tiers },
      world.deps,
      CTX,
    );
    expect(result.blockers.some((b) => b.code === 'tier_percent_header')).toBe(true);
    expect(result.previewToken).toBe('');
  });

  it('produkt bez pásma je blokátor — appka nesmie hádať percento', async () => {
    const world = makeWorld({ productIds });
    const result = await buildPreview(
      {
        ...baseInput(productIds),
        tiers: [{ ord: 1, label: 'A', percent: 30, productIds: [11, 12] }],
      },
      world.deps,
      CTX,
    );
    expect(result.blockers.some((b) => b.code === 'tier_product_uncovered')).toBe(true);
    expect(result.previewToken).toBe('');
  });

  it('produkt v dvoch pásmach je blokátor', async () => {
    const world = makeWorld({ productIds });
    const result = await buildPreview(
      {
        ...baseInput(productIds),
        tiers: [
          { ord: 1, label: 'A', percent: 30, productIds: [11, 12, 13, 14, 15, 16] },
          { ord: 2, label: 'B', percent: 20, productIds: [16] },
        ],
      },
      world.deps,
      CTX,
    );
    expect(result.blockers.some((b) => b.code === 'tier_product_duplicate')).toBe(true);
    expect(result.previewToken).toBe('');
  });
});

describe('buildPreview: veľká sada (K1, K7)', () => {
  const productIds = Array.from({ length: 8000 }, (_, i) => 1000 + i);
  const tiers = [
    { ord: 1, label: 'A', percent: 30, productIds: productIds.slice(0, 6940) },
    { ord: 2, label: 'B', percent: 20, productIds: productIds.slice(6940) },
  ];

  it('8 000 produktov: vzorka je 6 riadkov naprieč pásmami a shop sa nevolá', async () => {
    const world = makeWorld({ productIds });
    const result = await buildPreview({ ...baseInput(productIds), tiers }, world.deps, CTX);

    expect(result.blockers).toEqual([]);
    expect(result.itemsTotal).toBe(8000);
    expect(result.itemsTruncated).toBe(true);
    expect(result.sample).toHaveLength(PREVIEW_SAMPLE_SIZE);
    expect(new Set(result.sample.map((item) => item.tierOrd))).toEqual(new Set([1, 2]));
    expect(result.sample.filter((item) => item.tierOrd === 1)).toHaveLength(3);

    // K7 — ceny sú zo zrkadla katalógu a „Dáta k …" je meraný fakt (P7).
    expect(result.priceSource).toBe('catalog');
    expect(result.dataAsOf).toBe('2026-08-10T03:00:00.000Z');
    expect(world.shopCalls).toEqual([]);

    // Vzorka NIE JE prefix sady.
    expect(result.sample.map((item) => item.productId)).not.toEqual(productIds.slice(0, 6));
  });

  it('nerobí dotaz na kampaň per produkt — inak by dry-run trval minúty', async () => {
    const world = makeWorld({ productIds });
    const result = await buildPreview({ ...baseInput(productIds), tiers }, world.deps, CTX);

    // Prekryv: 8 000 / 500 = 16 dávkových dotazov, žiadny per-produkt (nič sa
    // nenašlo, takže sa blok nerozpisuje).
    expect(world.overlapCalls).toHaveLength(16);
    expect(world.overlapCalls.every((call) => call.length > 1)).toBe(true);

    // `lastOwnWrite` len pre riadky, ktoré sa naozaj zobrazia.
    expect(world.lastOwnWriteCalls).toHaveLength(result.items.length);
    expect(result.items.length).toBeLessThanOrEqual(PREVIEW_SAMPLE_SIZE);
  });

  it('produkt mimo zrkadla katalógu neprejde rozsahom, token sa nevydá (K1 bod 2)', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => 2000 + i);
    const world = makeWorld({
      productIds: ids,
      inCatalog: new Set(ids.filter((id) => id !== 2100)),
    });
    const result = await buildPreview(baseInput(ids), world.deps, CTX);

    // Prvý, kto to zachytí, je guard rozsahu — do produktu, ktorý appka nikdy
    // nevidela, sa zapísať nedá.
    expect(result.previewToken).toBe('');
    expect(result.blockers.some((b) => b.code === 'not_in_catalog')).toBe(true);
  });

  it('keď katalóg medzitým stratí riadok, náhľad ho zachytí sám (obrana v hĺbke)', async () => {
    // Guard rozsahu vidí všetkých 200 produktov, ale kým sa dostane na rad
    // čítanie cien, riadok 2100 v zrkadle nie je (napr. rozbehnutá
    // synchronizácia). Bez vlastnej kontroly by položka išla do potvrdenia
    // s cenou `null` a token by sa aj tak vydal.
    const ids = Array.from({ length: 200 }, (_, i) => 2000 + i);
    const world = makeWorld({ productIds: ids });
    const partial: PreviewDeps = {
      ...world.deps,
      catalogRepo: {
        async getMany(requested: number[]) {
          const full = await world.deps.catalogRepo!.getMany!(requested);
          full.delete(2100);
          return full;
        },
        async upsert() {
          /* noop */
        },
      },
    };
    const result = await buildPreview(baseInput(ids), partial, CTX);

    expect(result.previewToken).toBe('');
    expect(
      result.blockers.some((b) => b.code === 'product_not_in_catalog' && b.productId === 2100),
    ).toBe(true);
  });

  it('pri desiatkach chýbajúcich produktov nevysype tisíc hlášok', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => 5000 + i);
    const world = makeWorld({ productIds: ids });
    const partial: PreviewDeps = {
      ...world.deps,
      catalogRepo: {
        async getMany() {
          return new Map();
        },
        async upsert() {
          /* noop */
        },
      },
    };
    const result = await buildPreview(baseInput(ids), partial, CTX);

    const perProduct = result.blockers.filter((b) => b.code === 'product_not_in_catalog');
    expect(perProduct).toHaveLength(PREVIEW_MAX_ITEM_BLOCKERS);
    const summary = result.blockers.find((b) => b.code === 'more_blocked_products');
    expect(summary?.message).toContain(String(500 - PREVIEW_MAX_ITEM_BLOCKERS));
    expect(result.previewToken).toBe('');
  });

  it('malá sada číta ceny zo shopu (D57) a vracia všetky riadky', async () => {
    const ids = Array.from({ length: PREVIEW_SHOP_DETAIL_MAX }, (_, i) => 3000 + i);
    const world = makeWorld({ productIds: ids });
    const result = await buildPreview(baseInput(ids), world.deps, CTX);

    expect(result.priceSource).toBe('shop');
    expect(world.shopCalls).toHaveLength(1);
    expect(result.itemsTruncated).toBe(false);
    expect(result.items).toHaveLength(PREVIEW_SHOP_DETAIL_MAX);
    expect(result.sample).toHaveLength(PREVIEW_SAMPLE_SIZE);
    expect(result.dataAsOf).toBeNull();
  });

  it('režim pilot naďalej odmietne viac než 10 produktov (K1, fail-closed)', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => 4000 + i);
    const world = makeWorld({ productIds: ids, scopeMode: 'pilot' });
    const result = await buildPreview(baseInput(ids), world.deps, CTX);

    expect(result.previewToken).toBe('');
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});
