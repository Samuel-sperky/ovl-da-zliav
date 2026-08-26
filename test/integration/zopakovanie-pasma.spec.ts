/**
 * Aura Zľavy — NÁLEZ L2: „zopakovať zlyhané" pri zľave s PÁSMAMI (K3, I3, D15).
 *
 * Opravná zľava (`kind='retry'`) dostane presne tie produkty, ktoré rodičovi
 * neprešli — a KAŽDÝ z nich si nesie percento svojho pásma. Percentá žijú
 * v podpísanom `previewToken` (`buildPreview()` ich doň vloží vždy, keď náhľad
 * dostal `tiers`), takže `POST /retry-failed` ich musí podať do
 * `insertConfirmedCampaign()` rovnako, ako to robí `POST /api/campaigns`.
 *
 * Keď ich nepodá, položky sa založia s hlavičkovým percentom kampane,
 * `assertConfirmed()` prepočíta hash z riadkov, nedopočíta ho k podpísanému
 * (I3) a zápis padne: do shopu nedorazí nič, opravná zľava zostane visieť ako
 * `draft` a jednorazový token je spálený. Test meria OBE strany — čo dostal
 * shop aj v akom stave zostala kampaň.
 *
 * Token si test vydáva sám (tá istá služba, tie isté claims, ako ho vydá
 * `/api/campaigns/preview`) — rovnako ako `no-write-without-confirm.spec.ts`.
 * Náhľad sám by v tomto svete nič nevydal: harness nemá rozpočet čítaní zo
 * shopu ani zrkadlo katalógu, takže by (správne, fail-closed) vrátil blokátory.
 *
 * Vlastník: tím LOGIKA (audit 30).
 */
import { describe, expect, it, vi } from 'vitest';

// Prostredie: natívny `argon2.node` je na tomto stroji blokovaný Application
// Control policy, takže integračný test route-ov padne už pri importe. Heslá
// so zopakovaním zlyhaných nemajú nič spoločné — stub len odblokuje import.
vi.mock('argon2', () => ({
  default: { argon2id: 2, async hash() { return '$stub'; }, async verify() { return false; } },
}));

import type { MoneyString } from '@/contracts';

import { createPreviewPost } from '@/app/api/campaigns/preview/route';
import { createRetryFailedPost } from '@/app/api/campaigns/[id]/retry-failed/route';

import { makeCampaign } from '../helpers/factories';
import { useMockShop } from '../helpers/mock';
import {
  day,
  makeRequest,
  makeRoutesWorld,
  parse,
  sessionRouteDeps,
  TEST_USER_ID,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

/**
 * Pásma rodičovskej zľavy: 201 → 30 %, 202 → 20 %, 203 → 10 %.
 * Rodičovi neprešli 201 a 202, takže sada opravnej zľavy je {201, 202} a jej
 * hlavičkové percento je 30 — najvyššie percento tejto sady (K3).
 */
const PARENT_TIERS: Record<number, number> = { 201: 30, 202: 20, 203: 10 };
const RETRIED: readonly number[] = [201, 202];

function world(): RoutesWorld {
  mock.state.setProducts(
    [201, 202, 203].map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl, allowlistIds: [201, 202, 203] });
}

/** Rodič s pásmami 30/20/10, kde 203 prešlo a 201 s 202 zlyhali (D15). */
function seedParent(): { w: RoutesWorld; parent: ReturnType<RoutesWorld['seedCampaign']> } {
  const w = world();
  const parent = w.seedCampaign(
    makeCampaign({
      status: 'partial',
      percent: 30,
      dateFrom: day(2),
      dateTo: day(12),
      name: 'Letná akcia',
    }),
    [201, 202, 203].map((productId) => ({
      productId,
      priceAtPreview: '19.99' as MoneyString,
      status: productId === 203 ? ('ok' as const) : ('failed' as const),
      percent: PARENT_TIERS[productId],
    })),
  );
  return { w, parent };
}

describe('K3/I3 — zopakovanie zlyhaných pri zľave s pásmami', () => {
  it('zapíše každý zopakovaný produkt percentom SVOJHO pásma', async () => {
    const w = world();
    const parent = w.seedCampaign(
      makeCampaign({
        status: 'partial',
        percent: 30,
        dateFrom: day(2),
        dateTo: day(12),
        name: 'Letná akcia',
      }),
      [201, 202, 203].map((productId) => ({
        productId,
        priceAtPreview: '19.99' as MoneyString,
        // 203 prešlo, 201 a 202 nie — tie idú do opravnej zľavy (D15).
        status: productId === 203 ? ('ok' as const) : ('failed' as const),
        percent: PARENT_TIERS[productId],
      })),
    );

    /*
     * TOKEN MUSÍ PRÍSŤ ZO SKUTOČNÉHO NÁHĽADU (26. 8. 2026).
     *
     * Do 26. 8. si ho tento test vyrobil sám cez `previewTokens.issue()` a
     * `percents` doň vložil ručne — takže prešiel aj vtedy, keď produkčná cesta
     * percentá stratila. Zmerané: s vypnutým doplnením pásiem v
     * `campaigns/preview` bol test naďalej zelený. Fabrikovaný token nemeria
     * appku, meria test.
     *
     * Obrazovka opravy (`RetryFailed.tsx`) `tiers` neposiela a posielať ich
     * nemá — pri oprave nie sú voľbou človeka. Dopĺňa ich SERVER z riadkov
     * rodiča, a práve to musí tento test prejsť.
     */
    const previewPost = createPreviewPost(w.deps, sessionRouteDeps());
    const previewRes = await parse(
      await previewPost(
        makeRequest('POST', '/api/campaigns/preview', {
          productIds: [...RETRIED],
          percent: 30,
          from: day(2),
          to: day(12),
          kind: 'retry',
          parentCampaignId: parent.id,
        }),
      ),
    );
    expect(previewRes.status).toBe(200);
    const token = (previewRes.body.data as { previewToken: string }).previewToken;
    expect(token).not.toBe('');

    const retryPost = createRetryFailedPost(w.deps, sessionRouteDeps());
    const retryRes = await parse(
      await retryPost(
        makeRequest('POST', `/api/campaigns/${parent.id}/retry-failed`, { previewToken: token }),
        { params: { id: String(parent.id) } },
      ),
    );
    expect(retryRes.status).toBe(200);
    const childId = (retryRes.body.data as { campaignId: number }).campaignId;

    /* 1. Položky opravnej zľavy nesú percento svojho pásma (K3). */
    const childPercents = Object.fromEntries(
      [...w.items.values()]
        .filter((item) => item.campaignId === childId)
        .map((item) => [item.productId, item.percent]),
    );
    expect(childPercents).toEqual({ 201: 30, 202: 20 });

    /* 2. To isté dorazilo do shopu — jediné číslo, ktoré vidí zákazník. */
    const written = Object.fromEntries(
      RETRIED.map((id) => [id, mock.state.getProduct(id)?.lastReduction?.reduction]),
    );
    expect(written).toEqual({ 201: 30, 202: 20 });

    /* 3. Zápis naozaj prebehol — opravná zľava neuvisla v `draft` s potvrdením,
     *    ktoré sa nedá prepočítať, a produkt mimo sady sa nikto nedotkol. */
    expect(w.campaigns.get(childId)?.status).not.toBe('draft');
    expect(mock.state.getProduct(203)?.lastReduction).toBeNull();
  });

  /**
   * Podvrhnutý token sa nezapíše — a kde tá záruka NAOZAJ leží.
   *
   * Pôvodne som tento test napísal s tvrdením, že drží podanie mapy percent do
   * `verify()` v POST-e. Zmeranie to vyvrátilo: mutácia, ktorá mapu z `verify()`
   * odoberie, tento test NEZHODÍ. Dôvod je, že podvrh zachytí `assertConfirmed()`
   * v executore, ktorý si hash prepočíta z RIADKOV `campaign_items` — a tá
   * kontrola tu bola dávno predtým.
   *
   * Takže: podanie mapy do `verify()` je obrana do hĺbky (padne to skôr a s
   * lepšou hláškou), nie tá záruka. Záruka je, že POST zapíše percentá odvodené
   * z DB a náhľad vydá token nad tými istými — čo meria prvý test v tomto
   * súbore tým, čo naozaj dorazilo do shopu.
   *
   * Za pozornosť stojí aj to, čo sa pritom ukázalo: `verify()` počíta očakávaný
   * hash ako `percents: wanted.percents ?? claims.percents`
   * (`preview-token.ts:612`), takže volajúci, ktorý mapu nepodá, uverí tokenu.
   * Cesta vytvorenia zľavy ten fallback používa legitímne (percentá si kontroluje
   * proti `tiers` z tela), preto sa zaplátať naplocho nedá — ale je to fail-open
   * predvoľba v bezpečnostnej pomôcke a patrí sem napísaná.
   */
  it('token s percentami, ktoré nesedia s riadkami rodiča, POST odmietne', async () => {
    const { w, parent } = seedParent();

    /*
     * Podvrh musí PREHODIŤ percentá medzi produktmi, nie ich zmenšiť: `issue()`
     * sám odmietne mapu, ktorej najvyššie percento nesedí s hlavičkou (K3), a to
     * je správne. V DB má 201 tridsať a 202 dvadsať; token to tvrdí naopak.
     */
    const { token } = await w.previewTokens.issue({
      sub: TEST_USER_ID,
      kind: 'retry',
      productIds: [...RETRIED],
      percent: 30,
      from: day(2),
      to: day(12),
      pricesAtPreview: Object.fromEntries(RETRIED.map((id) => [String(id), '19.99'])),
      percents: { '201': 20, '202': 30 },
    });

    const retryPost = createRetryFailedPost(w.deps, sessionRouteDeps());
    const res = await parse(
      await retryPost(
        makeRequest('POST', `/api/campaigns/${parent.id}/retry-failed`, { previewToken: token }),
        { params: { id: String(parent.id) } },
      ),
    );

    expect(res.status).not.toBe(200);
    // A do shopu nešlo NIČ — fail-closed, nie „zapíšeme aspoň niečo".
    expect(mock.state.writeRequests()).toHaveLength(0);
  });
});
