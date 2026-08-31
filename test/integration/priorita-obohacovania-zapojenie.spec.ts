/**
 * Aura Zľavy — ZAPOJENIE prepočtu poradia obohacovania (D118, KONTRAKT-V4 §2b).
 *
 * `catalogRepo.refreshEnrichPriority()` existovala a nevolal ju NIKTO okrem
 * samotnej dávky. Dôsledok: produkt pridaný do povoleného zoznamu dostal
 * prioritu 1 až pri najbližšom behu dávky a produkt odobraný zo zoznamu sa vo
 * fronte vozil dopredu až dovtedy.
 *
 * Čo tento test stráži:
 *  1. **Každá mutácia povoleného zoznamu končí prepočtom** — pridanie, odobranie
 *     aj `mark-unknown`. Pri `mark-unknown` je prepočet dnes prakticky prázdny
 *     (priorita sa pozerá len na `removed_at`), ale pravidlo bez výnimky je to,
 *     čo prežije zmenu kritérií priority.
 *  2. **Vytvorenie kampane** prepočíta poradie — a AŽ PO COMMITE, teda BEZ
 *     `conn` transakcie, ktorá kampaň vložila.
 *  3. **Ukončenie kampane** (`cancelled`, `failed`) prepočíta poradie; prechod,
 *     ktorým kampaň NEKONČÍ (`running`), nie.
 *  4. **Padnutý prepočet mutáciu NEZHODÍ.** Priorita je poradie vo fronte, nie
 *     fakt o dátach — odmietnuť pridanie produktu preto, že sa nedal
 *     preusporiadať front, by bola horšia porucha než horšie poradie.
 *  5. **Deň ide v zóne logiky (D31), nie v UTC.** Inak by kampaň končiaca dnes
 *     stratila prednosť medzi 22:00 a 24:00 UTC o dve hodiny skôr.
 *
 * Odmietnutá mutácia (409) poradie prepočítať NESMIE — inak by test „volá sa to"
 * prešiel aj vtedy, keby prepočet visel pred bránou namiesto za zápisom.
 */
import { describe, expect, it } from 'vitest';

import { createMarkUnknownPost } from '@/app/api/allowlist/[productId]/mark-unknown/route';
import { createAllowlistDelete } from '@/app/api/allowlist/[productId]/route';
import { createAllowlistPost } from '@/app/api/allowlist/route';
import { createCancelPost } from '@/app/api/campaigns/[id]/cancel/route';
import { createPreviewPost } from '@/app/api/campaigns/preview/route';
import { createCampaignsPost } from '@/app/api/campaigns/route';
import { CAMPAIGN_ENDING_STATUSES, resolveRoutesDeps } from '@/app/api/campaigns/_shared';
import { todayInZone } from '@/lib/domain/dates';

import { makeCampaign } from '../helpers/factories';
import { useMockShop } from '../helpers/mock';
import {
  actorRouteDeps,
  day,
  makeRequest,
  makeRoutesWorld,
  parse,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

/** Tá istá zóna, akú harness dáva do `RoutesDeps.timeZone`. */
const LOGIC_ZONE = 'Europe/Bratislava';

function world(opts: { allowlistIds?: number[] } = {}): RoutesWorld {
  const ids = opts.allowlistIds ?? [201, 202, 203];
  mock.state.setProducts(
    ids.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl, ...opts });
}

/* ═════════════════════════ 1. Povolený zoznam ═════════════════════════════ */

describe('mutácie povoleného zoznamu prepočítajú poradie obohacovania', () => {
  it('pridanie produktu (POST /api/allowlist)', async () => {
    const w = world({ allowlistIds: [] });
    const post = createAllowlistPost(w.deps, actorRouteDeps());

    const res = await parse(await post(makeRequest('POST', '/api/allowlist', { productId: 201 })));

    expect(res.status).toBe(200);
    expect(w.enrichPriorityCalls).toHaveLength(1);
  });

  it('odobranie produktu (DELETE /api/allowlist/[productId])', async () => {
    const w = world({ allowlistIds: [201] });
    const del = createAllowlistDelete(w.deps, actorRouteDeps());

    const res = await parse(
      await del(makeRequest('DELETE', '/api/allowlist/201'), { params: { productId: '201' } }),
    );

    expect(res.status).toBe(200);
    expect(w.enrichPriorityCalls).toHaveLength(1);
  });

  it('mark-unknown (POST /api/allowlist/[productId]/mark-unknown)', async () => {
    const w = world({ allowlistIds: [201] });
    const mark = createMarkUnknownPost(w.deps, actorRouteDeps());

    const res = await parse(
      await mark(makeRequest('POST', '/api/allowlist/201/mark-unknown', {}), {
        params: { productId: '201' },
      }),
    );

    expect(res.status).toBe(200);
    expect(w.enrichPriorityCalls).toHaveLength(1);
  });

  it('ODMIETNUTÁ mutácia poradie neprepočítava (409 z D40)', async () => {
    const w = world({ allowlistIds: [201] });
    w.seedCampaign(makeCampaign({ status: 'scheduled', dateFrom: day(1), dateTo: day(5) }), [
      { productId: 201, priceAtPreview: '19.99' },
    ]);

    const del = createAllowlistDelete(w.deps, actorRouteDeps());
    const res = await parse(
      await del(makeRequest('DELETE', '/api/allowlist/201'), { params: { productId: '201' } }),
    );

    expect(res.status).toBe(409);
    expect(w.enrichPriorityCalls).toHaveLength(0);
  });

  it('deň ide v zóne logiky a bez `conn` transakcie', async () => {
    const w = world({ allowlistIds: [] });
    const post = createAllowlistPost(w.deps, actorRouteDeps());
    await post(makeRequest('POST', '/api/allowlist', { productId: 202 }));

    const call = w.enrichPriorityCalls[0];
    expect(call).toBeDefined();
    expect(call?.today).toBe(todayInZone(new Date(), LOGIC_ZONE));
    expect(call?.conn).toBeUndefined();
  });
});

/* ═══════════════════ 2. Prepočet NIKDY nezhodí mutáciu ════════════════════ */

describe('padnutý prepočet priority mutáciu NEZHODÍ', () => {
  it('pridanie prejde a produkt je naozaj v zozname', async () => {
    const w = world({ allowlistIds: [] });
    w.failEnrichPriority(new Error('catalog_cache je preč'));
    const post = createAllowlistPost(w.deps, actorRouteDeps());

    const res = await parse(await post(makeRequest('POST', '/api/allowlist', { productId: 203 })));

    expect(res.status).toBe(200);
    expect(w.enrichPriorityCalls).toHaveLength(1);
    expect(w.allowlist.get(203)?.removedAt ?? null).toBeNull();
    // Audit sa zapísal — mutácia je hotová, nie polovičná.
    expect(w.audit.byEvent('allowlist_added')).toHaveLength(1);
  });

  it('odobranie prejde a produkt je naozaj odobraný', async () => {
    const w = world({ allowlistIds: [201] });
    w.failEnrichPriority(new Error('catalog_cache je preč'));
    const del = createAllowlistDelete(w.deps, actorRouteDeps());

    const res = await parse(
      await del(makeRequest('DELETE', '/api/allowlist/201'), { params: { productId: '201' } }),
    );

    expect(res.status).toBe(200);
    expect(w.allowlist.get(201)?.removedAt ?? null).not.toBeNull();
  });

  it('mark-unknown prejde a stav je zapísaný', async () => {
    const w = world({ allowlistIds: [201] });
    w.failEnrichPriority(new Error('catalog_cache je preč'));
    const mark = createMarkUnknownPost(w.deps, actorRouteDeps());

    const res = await parse(
      await mark(makeRequest('POST', '/api/allowlist/201/mark-unknown', {}), {
        params: { productId: '201' },
      }),
    );

    expect(res.status).toBe(200);
    expect(w.allowlist.get(201)?.shopStatus).toBe('unknown');
  });
});

/* ═══════════════════════════ 3. Kampane ═══════════════════════════════════ */

describe('vytvorenie a ukončenie kampane prepočítajú poradie', () => {
  async function previewToken(w: RoutesWorld, body: Record<string, unknown>): Promise<string> {
    const handler = createPreviewPost(w.deps, actorRouteDeps());
    const res = await parse(await handler(makeRequest('POST', '/api/campaigns/preview', body)));
    expect(res.status).toBe(200);
    const data = res.body.data as { previewToken: string; blockers: unknown[] };
    expect(data.blockers).toEqual([]);
    return data.previewToken;
  }

  it('vytvorenie naplánovanej kampane prepočíta poradie po commite', async () => {
    const w = world();
    const token = await previewToken(w, {
      productIds: [201, 202],
      percent: 15,
      from: day(2),
      to: day(6),
      kind: 'new',
    });
    // Dry-run poradie nemení — počítadlo musí byť ešte na nule.
    expect(w.enrichPriorityCalls).toHaveLength(0);

    const post = createCampaignsPost(w.deps, actorRouteDeps());
    const res = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          previewToken: token,
          name: 'Jesenná akcia',
          mode: 'scheduled',
          acknowledgements: { irreversible: true },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(w.enrichPriorityCalls).toHaveLength(1);
    expect(w.enrichPriorityCalls[0]?.conn).toBeUndefined();
  });

  it('zrušenie kampane prepočíta poradie', async () => {
    const w = world();
    const scheduled = w.seedCampaign(
      makeCampaign({ status: 'scheduled', dateFrom: day(1), dateTo: day(5) }),
      [{ productId: 201, priceAtPreview: '19.99' }],
    );

    const cancel = createCancelPost(w.deps, actorRouteDeps());
    const res = await parse(
      await cancel(makeRequest('POST', `/api/campaigns/${scheduled.id}/cancel`, {}), {
        params: { id: String(scheduled.id) },
      }),
    );

    expect(res.status).toBe(200);
    expect(w.campaigns.get(scheduled.id)?.status).toBe('cancelled');
    expect(w.enrichPriorityCalls).toHaveLength(1);
  });

  it('ODMIETNUTÉ zrušenie (409 z `done`) poradie neprepočítava', async () => {
    const w = world();
    const done = w.seedCampaign(
      makeCampaign({ status: 'done', dateFrom: day(-5), dateTo: day(5) }),
      [{ productId: 202, priceAtPreview: '19.99' }],
    );

    const cancel = createCancelPost(w.deps, actorRouteDeps());
    const res = await parse(
      await cancel(makeRequest('POST', `/api/campaigns/${done.id}/cancel`, {}), {
        params: { id: String(done.id) },
      }),
    );

    expect(res.status).toBe(409);
    expect(w.enrichPriorityCalls).toHaveLength(0);
  });

  it('prechod do NEKONCOVÉHO stavu poradie neprepočítava, koncový áno', async () => {
    const w = world();
    const scheduled = w.seedCampaign(
      makeCampaign({ status: 'scheduled', dateFrom: day(1), dateTo: day(5) }),
      [{ productId: 201, priceAtPreview: '19.99' }],
    );
    // Obal na `setStatus` žije v `resolveRoutesDeps()`, nie v surových `deps` —
    // testuje sa preto to, čo route naozaj dostane.
    const d = resolveRoutesDeps(w.deps);

    // `running` je „beží", nie „skončila" — priorita 2 jej stále patrí.
    await d.campaignsRepo.setStatus(scheduled.id, 'running', {});
    expect(w.enrichPriorityCalls).toHaveLength(0);

    await d.campaignsRepo.setStatus(scheduled.id, 'failed', {});
    expect(w.enrichPriorityCalls).toHaveLength(1);
  });

  it('zoznam koncových stavov je doplnkom k tým, čo prednosť dávajú', () => {
    expect([...CAMPAIGN_ENDING_STATUSES].sort()).toEqual([
      'cancelled',
      'failed',
      'lapsed',
      'missed',
    ]);
  });
});
