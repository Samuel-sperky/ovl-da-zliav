/**
 * Aura Zľavy — REPRODUKCIA NÁLEZU L1 (D27, K3, I3, I7).
 *
 * Predĺženie zľavy s PÁSMAMI má zapísať KAŽDÝ produkt tým percentom, ktoré mu
 * pásma dali pri POTVRDENÍ pôvodnej zľavy — predĺženie mení výhradne `to`
 * (D27), percento nie. Tento test seeduje rodiča s pásmami 30/20/10, prejde
 * `/extend/preview` → `/extend` a pozrie sa, čo naozaj dorazilo do shopu.
 *
 * Test NIE JE opravou — dokazuje, že cesta predĺženia percentá pásiem stráca.
 */
import { describe, expect, it } from 'vitest';

// Do 27. 8. 2026 tu stál `vi.mock('argon2', …)` — natívny `argon2.node` bol na
// tomto stroji blokovaný Application Control policy a KAŽDÝ integračný test
// route-ov padol už pri importe. D100 zrušilo sudo a D104 vyhodilo `argon2` zo
// závislostí, takže route k nemu nevedie a stub je zbytočný.

import { createExtendPost } from '@/app/api/campaigns/[id]/extend/route';
import { createExtendPreviewPost } from '@/app/api/campaigns/[id]/extend/preview/route';

import { makeCampaign } from '../helpers/factories';
import { useMockShop } from '../helpers/mock';
import {
  day,
  makeRequest,
  makeRoutesWorld,
  parse,
  actorRouteDeps,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

/** Pásma pôvodnej zľavy: 201 → 30 %, 202 → 20 %, 203 → 10 %. */
const TIERS: Record<number, number> = { 201: 30, 202: 20, 203: 10 };

function world(): RoutesWorld {
  mock.state.setProducts(
    [201, 202, 203].map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl, allowlistIds: [201, 202, 203] });
}

describe('D27/K3 — predĺženie zľavy s pásmami', () => {
  it('zapíše každý produkt percentom SVOJHO pásma, nie najvyšším', async () => {
    const w = world();
    // Hlavička kampane = najvyššie pásmo (to vynucuje `assertTiersMatchToken`).
    const parent = w.seedCampaign(
      makeCampaign({ status: 'done', dateFrom: day(-5), dateTo: day(5), percent: 30 }),
      [201, 202, 203].map((productId) => ({
        productId,
        priceAtPreview: '19.99' as const,
        status: 'ok' as const,
        percent: TIERS[productId],
      })),
    );

    const previewPost = createExtendPreviewPost(w.deps, actorRouteDeps());
    const previewRes = await parse(
      await previewPost(
        makeRequest('POST', `/api/campaigns/${parent.id}/extend/preview`, { to: day(20) }),
        { params: { id: String(parent.id) } },
      ),
    );
    expect(previewRes.status).toBe(200);
    const previewToken = (previewRes.body.data as { previewToken: string }).previewToken;
    expect(previewToken).not.toBe('');

    const extendPost = createExtendPost(w.deps, actorRouteDeps());
    const extendRes = await parse(
      await extendPost(
        makeRequest('POST', `/api/campaigns/${parent.id}/extend`, { previewToken }),
        { params: { id: String(parent.id) } },
      ),
    );
    expect(extendRes.status).toBe(200);
    const childId = (extendRes.body.data as { campaignId: number }).campaignId;

    /* 1. Položky novej kampane nesú percento svojho pásma (K3). */
    const childPercents = new Map(
      [...w.items.values()]
        .filter((item) => item.campaignId === childId)
        .map((item) => [item.productId, item.percent]),
    );
    expect(Object.fromEntries(childPercents)).toEqual(TIERS);

    /* 2. To isté dorazilo do shopu — jediná pravda, ktorá zákazníka zaujíma. */
    const written = Object.fromEntries(
      [201, 202, 203].map((id) => [id, mock.state.products.get(id)?.lastReduction?.reduction]),
    );
    expect(written).toEqual(TIERS);
  });
});
