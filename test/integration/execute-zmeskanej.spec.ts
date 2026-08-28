/**
 * Aura Zľavy — MANUÁLNE DOPÁLENIE ZMEŠKANEJ KAMPANE (`POST /api/campaigns/[id]/execute`).
 *
 * D33b robí z tejto route JEDINÚ cestu, ktorou sa zmeškaná kampaň dopáli.
 * Preto tu meriame práve to, čo sa stane, keď čerstvé potvrdenie NESEDÍ so
 * skutočnou sadou kampane: executor prepočítava hash z riadkov
 * `campaign_items` (`product_id:percent:price_at_preview`, K4), route overuje
 * token nad hlavičkou (`kind`/`productIds`/`percent`/`from`/`to`). Keď sa tie
 * dva rozídu — iná cena než pri vytvorení zľavy, iné pásma (K3) — zápis sa
 * MUSÍ odmietnuť BEZ toho, aby kampaň stratila svoj stav: `running` kampaň
 * nevidí ani `findQueued`, ani `findMissed`, takže by ju už nedopálil nikto.
 *
 * Happy path (`needs_key`/`missed` s tokenom, ktorý sedí) je v
 * `routes-campaigns.spec.ts`; tu je len jeho pásmová podoba (K3).
 */
import { describe, expect, it } from 'vitest';

// Do 27. 8. 2026 tu stál `vi.mock('argon2', …)`: `defineRoute` ťahal
// `auth/sudo` → `auth/password` → natívny modul `argon2`, ktorý Windows
// Application Control na tomto stroji blokuje, a import padol ešte pred prvým
// tvrdením. D100 zrušilo sudo a D104 vyhodilo `argon2` zo závislostí, takže
// tá reťaz už neexistuje a stub nemá čo nahrádzať.

import { createExecutePost } from '@/app/api/campaigns/[id]/execute/route';

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

function world(productIds: number[] = [201, 202]): RoutesWorld {
  mock.state.setProducts(
    productIds.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl, allowlistIds: productIds });
}

async function execute(w: RoutesWorld, campaignId: number, previewToken: string) {
  const handler = createExecutePost(w.deps, actorRouteDeps());
  return parse(
    await handler(makeRequest('POST', `/api/campaigns/${campaignId}/execute`, { previewToken }), {
      params: { id: String(campaignId) },
    }),
  );
}

describe('execute zmeškanej kampane — potvrdenie proti SKUTOČNEJ sade (D33b, I3, K4)', () => {
  it('cena sa medzičasom zmenila: 409, kampaň zostáva `missed` a na shop neodíde nič', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'missed', dateFrom: day(1), dateTo: day(10), percent: 15 }),
      [
        { productId: 201, priceAtPreview: '19.99' },
        { productId: 202, priceAtPreview: '19.99' },
      ],
    );

    // Čerstvá skúška naprázdno po zlacnení: token nesie NOVÉ ceny, riadky
    // kampane stále staré. Hlavička (produkty, percento, okno) sedí presne.
    const { token } = await w.previewTokens.issue({
      sub: 1,
      kind: 'new',
      productIds: [201, 202],
      percent: 15,
      from: day(1),
      to: day(10),
      pricesAtPreview: { '201': '17.99', '202': '17.99' },
    });

    const res = await execute(w, campaign.id, token);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('confirmation_required');
    expect(mock.state.writeRequests()).toHaveLength(0);
    // Jadro nálezu: stav sa NESMIE prepísať. `running` by kampaň vyradilo
    // z `findQueued` aj `findMissed` a D33b by stratil svoju jedinú cestu.
    expect(w.campaigns.get(campaign.id)?.status).toBe('missed');
    expect(w.campaigns.get(campaign.id)?.confirmPayloadHash).toBeNull();
    expect(w.campaigns.get(campaign.id)?.confirmedAt).toBeNull();
  });

  it('pásma (K3): token bez pásiem proti pásmovej sade → 409 a stav `missed` zostáva', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'missed', dateFrom: day(1), dateTo: day(10), percent: 30 }),
      [
        { productId: 201, priceAtPreview: '19.99', percent: 30 },
        { productId: 202, priceAtPreview: '19.99', percent: 20 },
      ],
    );

    // Token nad hlavičkovým percentom (30 na celú sadu) — riadky majú 30/20.
    const { token } = await w.previewTokens.issue({
      sub: 1,
      kind: 'new',
      productIds: [201, 202],
      percent: 30,
      from: day(1),
      to: day(10),
      pricesAtPreview: { '201': '19.99', '202': '19.99' },
    });

    const res = await execute(w, campaign.id, token);

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('confirmation_required');
    expect(mock.state.writeRequests()).toHaveLength(0);
    expect(w.campaigns.get(campaign.id)?.status).toBe('missed');
    expect(w.campaigns.get(campaign.id)?.confirmPayloadHash).toBeNull();
  });

  it('pásmový token, ktorý sedí s riadkami, dopáli kampaň a zapíše percentá pásiem', async () => {
    const w = world();
    const campaign = w.seedCampaign(
      makeCampaign({ status: 'missed', dateFrom: day(1), dateTo: day(10), percent: 30 }),
      [
        { productId: 201, priceAtPreview: '19.99', percent: 30 },
        { productId: 202, priceAtPreview: '19.99', percent: 20 },
      ],
    );

    const { token } = await w.previewTokens.issue({
      sub: 1,
      kind: 'new',
      productIds: [201, 202],
      percent: 30,
      from: day(1),
      to: day(10),
      pricesAtPreview: { '201': '19.99', '202': '19.99' },
      percents: { '201': 30, '202': 20 },
    });

    const res = await execute(w, campaign.id, token);

    expect(res.status).toBe(200);
    expect((res.body.data as { status: string }).status).toBe('done');
    expect(mock.state.writeRequests().map((r) => r.body.reduction)).toEqual(['30', '20']);
  });
});
