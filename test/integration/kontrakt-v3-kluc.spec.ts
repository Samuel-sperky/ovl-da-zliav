/**
 * Aura Zľavy — K6: KĽÚČ KRATŠÍ NEŽ FRONTA (V14).
 *
 * Kontrakt V3, K6: „Pri zaradení do fronty appka porovná expiráciu kľúča
 * s odhadom dobehnutia a ak je kľúč kratší, zobrazí varovanie a ponúkne obnovu
 * kľúča. **Zaradiť frontu to nebráni.**"
 *
 * Je to jediné miesto kontraktu, kde sa appka vedome zmieri s dierou: kľúč má
 * TTL 48 h (nastavením 30 dní) a fronta beží aj 40 dní. Riešením je priznanie,
 * nie ticho — a nie brzda. Preto sa tu testujú obe polovice vety naraz:
 *
 *   1. varovanie SA objaví (`keyExpiresBeforeFinish: true`),
 *   2. zľava sa napriek nemu ZARADÍ (`status: 'queued'`, položky vzniknú),
 *   3. keď kľúč prežije odhad, varovanie sa NEVYMÝŠĽA,
 *   4. keď sa metadáta kľúča nedajú prečítať, varuje sa (fail-closed smerom
 *      k varovaniu — mlčať je horšie než varovať zbytočne),
 *   5. odhad, o ktorý sa varovanie opiera, počíta CELÚ frontu — aj to, čo stojí
 *      pred novou zľavou (K5). Z veľkosti kampane by vyšiel optimistický dátum
 *      a varovanie by sa podľa neho preskočilo.
 *
 * Zapisuje sa pri tom NIČ: fronta je práca schedulera (K2), nie odpoveď na
 * HTTP požiadavku. Test to overuje na mock shope (I6).
 *
 * UI polovicu K6 (veta a ponuka obnovy) drží `test/unit/zlavy-v11.spec.ts`;
 * tu ide o server, ktorý ten príznak vydáva.
 *
 * Vlastník: V14.
 */
import { describe, expect, it } from 'vitest';

import type { ApiKeyMeta, DiscountPercent, MoneyString } from '@/contracts';

import { createCampaignsPost } from '@/app/api/campaigns/route';
import type { RoutesDeps } from '@/app/api/campaigns/_shared';
import type { BudgetStatus } from '@/lib/engine/budget';

import { makeCampaign } from '../helpers/factories';
import { useMockShop } from '../helpers/mock';
import {
  TEST_USER_ID,
  makeRequest,
  makeRoutesWorld,
  parse,
  actorRouteDeps,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

/** Fronta, ktorá sa do jednej požiadavky nezmestí ani náhodou (K2). */
const PRODUCT_IDS = Array.from({ length: 60 }, (_, i) => 1001 + i);
const PERCENT = 20 as DiscountPercent;
const PRICE: MoneyString = '19.99';

const NOW = new Date('2026-08-10T09:00:00.000Z');
const DAY_MS = 86_400_000;
const day = (offset: number): string =>
  new Date(NOW.getTime() + offset * DAY_MS).toISOString().slice(0, 10);

/**
 * Rozpočet 10 zápisov na deň: 60 produktov dobehne až o 5 dní. Kľúč s TTL 48 h
 * teda vyprší uprostred fronty — presne situácia, o ktorej hovorí K6.
 */
function budget(remaining = 10): { spentToday(): Promise<number>; remainingToday(): Promise<BudgetStatus> } {
  const status: BudgetStatus = {
    day: day(0),
    budget: 10,
    spent: 10 - remaining,
    remaining,
    exhausted: remaining <= 0,
  };
  return {
    async spentToday() {
      return status.spent;
    },
    async remainingToday() {
      return status;
    },
  };
}

function keyMeta(expiresAt: Date | null): ApiKeyMeta {
  return {
    present: true,
    last4: '0001',
    savedAt: NOW,
    expiresAt,
    secondsLeft: expiresAt === null ? null : Math.floor((expiresAt.getTime() - NOW.getTime()) / 1000),
    verifyStatus: 'valid',
    lastUsedAt: null,
  };
}

/** Svet route-ov s vlastným rozpočtom a vlastnou expiráciou kľúča. */
function world(opts: { keyExpiresAt?: Date | null; keyMetaFails?: boolean } = {}): {
  world: RoutesWorld;
  deps: RoutesDeps;
} {
  mock.state.setProducts(
    PRODUCT_IDS.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  const w = makeRoutesWorld({ shopBaseUrl: mock.baseUrl, allowlistIds: PRODUCT_IDS.slice(0, 3) });
  const deps: RoutesDeps = {
    ...w.deps,
    now: () => NOW,
    budget: budget(),
    apiKeyRepo: {
      ...w.apiKeyRepo,
      getMeta: async (): Promise<ApiKeyMeta> => {
        if (opts.keyMetaFails === true) throw new Error('kľúč sa nedá prečítať');
        return keyMeta(opts.keyExpiresAt === undefined ? new Date(NOW.getTime() + 2 * DAY_MS) : opts.keyExpiresAt);
      },
    },
  };
  return { world: w, deps };
}

/**
 * Podpísaný preview token pre celú sadu. Vydáva sa priamo službou, nie cez
 * `/preview`: náhľad 60 produktov je vec režimu `plny` (K1) a K6 sa pýta na
 * niečo iné — čo urobí zaradenie do fronty s krátkym kľúčom.
 */
async function tokenFor(w: RoutesWorld): Promise<string> {
  const { token } = await w.previewTokens.issue({
    sub: TEST_USER_ID,
    kind: 'new',
    productIds: PRODUCT_IDS,
    percent: PERCENT,
    from: day(3),
    to: day(40),
    pricesAtPreview: Object.fromEntries(PRODUCT_IDS.map((id) => [String(id), PRICE])),
  });
  return token;
}

async function createDiscount(deps: RoutesDeps, token: string) {
  const post = createCampaignsPost(deps, actorRouteDeps());
  return parse(
    await post(
      makeRequest('POST', '/api/campaigns', {
        previewToken: token,
        name: 'Jesenné ležiaky',
        mode: 'eager',
        acknowledgements: { irreversible: true },
      }),
    ),
  );
}

describe('K6 — kľúč kratší než fronta varuje, ale zaradenie nezablokuje', () => {
  it('kľúč na 2 dni pri 5-dňovej fronte: varovanie ÁNO, zaradenie tiež', async () => {
    const { world: w, deps } = world({ keyExpiresAt: new Date(NOW.getTime() + 2 * DAY_MS) });
    const res = await createDiscount(deps, await tokenFor(w));

    expect(res.status).toBe(200);
    const data = res.body.data as {
      campaignId: number;
      status: string;
      itemsTotal: number;
      estimate: { date: string; days: number } | null;
      keyExpiresBeforeFinish: boolean;
    };

    // 1. Varovanie sa objaví…
    expect(data.keyExpiresBeforeFinish).toBe(true);
    // …a je podložené odhadom, nie dojmom: dnes sa zmestí 10 zvyšných zápisov,
    // ostatných 50 pri 10/deň je ďalších 5 dní.
    expect(data.estimate?.days).toBe(5);
    expect(data.estimate?.date).toBe(day(5));

    // 2. …a zaradenie NIE JE zablokované.
    expect(data.status).toBe('queued');
    expect(data.itemsTotal).toBe(PRODUCT_IDS.length);
    expect(w.campaigns.get(data.campaignId)?.status).toBe('queued');
    expect([...w.items.values()].filter((i) => i.campaignId === data.campaignId)).toHaveLength(60);

    // 3. Zápis je fronta, nie akcia — teraz na shop neodišlo nič (K2).
    expect(mock.state.writeRequests()).toHaveLength(0);
  });

  it('kľúč, ktorý prežije odhad, varovanie NEVYMÝŠĽA', async () => {
    const { world: w, deps } = world({ keyExpiresAt: new Date(NOW.getTime() + 30 * DAY_MS) });
    const res = await createDiscount(deps, await tokenFor(w));

    expect(res.status).toBe(200);
    const data = res.body.data as { keyExpiresBeforeFinish: boolean; status: string };
    expect(data.keyExpiresBeforeFinish).toBe(false);
    expect(data.status).toBe('queued');
  });

  it('kľúč bez expirácie sa nepovažuje za krátky', async () => {
    const { world: w, deps } = world({ keyExpiresAt: null });
    const res = await createDiscount(deps, await tokenFor(w));

    const data = res.body.data as { keyExpiresBeforeFinish: boolean };
    expect(data.keyExpiresBeforeFinish).toBe(false);
  });

  /*
   * K5 — odhad dobehnutia je o FRONTE, nie o veľkosti kampane.
   *
   * Fronta má jednu spoločnú dennú kvótu (K2), takže nová zľava dobehne až po
   * tom, čo sa vybaví všetko pred ňou. Že pred ňou niečo stojí, je normálny
   * zdokumentovaný stav (ARCHITEKTURA §3.3, Z-2: „Zapisovať začnem, keď dobehne
   * Ležiaky striebro"). Kým sa odhad počítal len z vlastných položiek, karta
   * „Zaradené do fronty" vypísala SKORŠÍ dátum, než aký sekundu predtým ukázala
   * obrazovka nastavenia zľavy — a K6 varovanie sa podľa toho optimistického
   * dátumu preskočilo, hoci kľúč frontu preukázateľne neprežije.
   */
  it('odhad počíta aj frontu PRED novou zľavou a K6 sa podľa nej ozve', async () => {
    const { world: w, deps } = world({ keyExpiresAt: new Date(NOW.getTime() + 30 * DAY_MS) });

    // 300 položiek staršej pripravenej zľavy — tie sa zapíšu skôr než naše.
    w.seedCampaign(
      makeCampaign({ name: 'Ležiaky striebro — jeseň', status: 'scheduled', percent: 30 }),
      Array.from({ length: 300 }, (_, i) => ({
        productId: 5001 + i,
        priceAtPreview: PRICE,
      })),
    );

    const res = await createDiscount(deps, await tokenFor(w));
    expect(res.status).toBe(200);
    const data = res.body.data as {
      status: string;
      itemsTotal: number;
      estimate: { date: string; days: number; pending: number } | null;
      keyExpiresBeforeFinish: boolean;
    };

    // 300 pred nami + 60 našich = 360; dnes sa zmestí 10, zvyšok 350 pri 10/deň
    // je 35 dní. Odhad z vlastných 60 položiek by tvrdil 5 dní.
    expect(data.estimate?.pending).toBe(360);
    expect(data.estimate?.days).toBe(35);
    expect(data.estimate?.date).toBe(day(35));

    // Kľúč vydrží 30 dní, fronta beží 35 — K6 varovanie sa MUSÍ ozvať. Pri
    // odhade z vlastných položiek (5 dní) by kľúč vyzeral ako dostatočný.
    expect(data.keyExpiresBeforeFinish).toBe(true);

    // Ani dlhá fronta zaradenie nezablokuje a našu zľavu nezmenšila.
    expect(data.status).toBe('queued');
    expect(data.itemsTotal).toBe(PRODUCT_IDS.length);
  });

  it('nečitateľné metadáta kľúča → radšej varovať než mlčať (fail-closed)', async () => {
    const { world: w, deps } = world({ keyMetaFails: true });
    const res = await createDiscount(deps, await tokenFor(w));

    expect(res.status).toBe(200);
    const data = res.body.data as { keyExpiresBeforeFinish: boolean; status: string };
    expect(data.keyExpiresBeforeFinish).toBe(true);
    // Ani neznámy stav kľúča frontu nezablokuje — je to varovanie, nie brzda.
    expect(data.status).toBe('queued');
  });
});
