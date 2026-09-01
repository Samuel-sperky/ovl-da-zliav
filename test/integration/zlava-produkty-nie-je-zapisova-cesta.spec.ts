/**
 * Aura Zľavy — ZO ZOZNAMU PRODUKTOV ZĽAVY NEVEDIE CESTA K `setReduction`
 * (I3, D127 bod 2, K6).
 *
 * ČO TENTO SÚBOR EXISTUJE ZATVORIŤ
 * --------------------------------
 * D127 otvoril druhé miesto, z ktorého sa zľava „začína": rozklik s produktmi
 * jednej zľavy (zaškrtnem riadky → `/zlavy/nova?produkty=…`) a rozcestník
 * „Nová zľava" na stránke Zliav (→ `/zlavy/nova?filter=…&pasma=…&dni=…`).
 * Obe majú byť VÝHRADNE predplnenie formulára.
 *
 * MERANÉ 31. 8. 2026 (mutačné overenie K7) a zapísané v CLAUDE.md: pri
 * presetoch boli „strážcovia" GREPY nad priečinkom presetov, kým brána stojí
 * v `POST /api/campaigns` — skratka `presetId` v tele kampane nechala 102
 * tvrdení zelených. Preto sa tu NEGREPUJE nad `DiscountsList.tsx` ani nad
 * `DiscountDetail.tsx`. Tvrdí sa SPRÁVANIE tej strany, kde brána naozaj je:
 *
 *   A. Telo `POST /api/campaigns` poskladané z HODNÔT, ktoré tieto dve nové
 *      cesty vyrábajú (vybrané `productIds`, percentá pásiem, dĺžka okna),
 *      a nesúce namiesto čerstvej skúšky naprázdno vlastný „dôkaz" — je 4xx,
 *      na shop neodíde ANI JEDEN request a kampaň nevznikne.
 *   B. Meradlo nie je pokazené: TIE ISTÉ produkty s tokenom zo skutočného
 *      dry-runu prejdú a zapíšu sa. Bez tejto nohy by A bolo zelené aj nad
 *      routou, ktorá neprijme nikdy nič.
 *   C. Adresy, ktoré povrch vyrába, vedú do SPRIEVODCU — nikdy na `/api/`.
 *      Je to tvrdenie o tvare, a preto stojí vedľa A, nie namiesto neho.
 *
 * Proti mock shopu (I6), nikdy proti sperky-eshop.sk.
 *
 * Vlastník: úloha ZLAVA-PRODUKTY (V5, D127).
 */
import { describe, expect, it } from 'vitest';

import { createCampaignsPost } from '@/app/api/campaigns/route';
import { createPreviewPost } from '@/app/api/campaigns/preview/route';
import {
  newDiscountFromProductsHref,
  NEW_DISCOUNT_HREF,
} from '@/components/campaigns/DiscountsList';
import { repeatDiscountHref } from '@/components/campaigns/presets-model';
import type { DiscountRow } from '@/components/campaigns/zlavy-api';

import { useMockShop } from '../helpers/mock';
import {
  actorRouteDeps,
  day,
  makeRequest,
  makeRoutesWorld,
  parse,
  TEST_USER_ID,
  type RoutesWorld,
} from './routes-harness';

const mock = useMockShop();

/** Produkty, ktoré si človek zaškrtne v rozkliku zľavy. */
const VYBRANE = [201, 202];

function world(): RoutesWorld {
  mock.state.setProducts(
    VYBRANE.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl });
}

/** Minulá zľava tak, ako ju vracia `GET /api/campaigns` — vstup „zopakovať". */
const MINULA: DiscountRow = {
  id: 41,
  name: 'Letné dočistenie skladu',
  status: 'finished',
  statusReason: null,
  percent: 25,
  dateFrom: '2026-07-01',
  dateTo: '2026-07-21',
  mode: 'eager',
  itemsTotal: 21,
  itemsOk: 21,
  itemsFailed: 0,
  itemsUncertain: 0,
  itemsPending: 0,
  late: false,
  createdAt: '2026-07-01T08:00:00.000Z',
  tiers: [
    {
      ord: 1,
      label: 'A · 0 predaných za 180 dní',
      percent: 25,
      itemsCount: 21,
      rule: { soldWindowDays: 180, bucket: 'none' },
    },
  ],
  estimate: null,
};

/** Hodnoty, ktoré nový povrch naozaj posiela do sprievodcu. */
const VYBER_HREF = newDiscountFromProductsHref(VYBRANE);
const ZOPAKOVAT_PARAMS = new URLSearchParams(repeatDiscountHref(MINULA).split('?')[1] ?? '');
const ZOPAKOVAT_DNI = Number(ZOPAKOVAT_PARAMS.get('dni'));

/**
 * Token s TVAROM podpísaného náhľadu, ktorý ale nikto nevydal — presne to, čo
 * by si vedel poskladať prehliadač z hodnôt na obrazovke. `peek` ho prečíta,
 * `verify()` ho MUSÍ odmietnuť. Bez neho by sa skupina A o obídené overenie
 * ani nezavadila: nezmyselný reťazec spadne už na čítaní.
 */
function podvrhnutyToken(): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: 'HS256', typ: 'JWT' }),
    b64({
      sub: TEST_USER_ID,
      kind: 'new',
      productIds: VYBRANE,
      percent: MINULA.percent,
      from: day(1),
      to: day(10),
      pricesAtPreview: { '201': '19.99', '202': '19.99' },
      iat: nowSec,
      exp: nowSec + 900,
    }),
    'tento-podpis-nikto-nevydal',
  ].join('.');
}

/**
 * Telá, ktorými by sa zoznam produktov zľavy pokúsil zastúpiť skúšku
 * naprázdno. Každé nesie niečo, čo vyzerá ako dôkaz — a ani jedno ním nie je:
 * dôkazom je LEN podpísaný jednorazový token z `POST /api/campaigns/preview`.
 */
const SKRATKY: { label: string; body: Record<string, unknown> }[] = [
  {
    label: 'zaškrtnuté produkty a `confirmed: true` namiesto tokenu',
    body: {
      productIds: VYBRANE,
      confirmed: true,
      percent: MINULA.percent,
      from: day(1),
      to: day(10),
      name: 'Z rozkliku zľavy',
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
  {
    label: 'zaškrtnuté produkty s tokenom vymysleným na obrazovke',
    body: {
      previewToken: 'z-vyberu-zlavy',
      productIds: VYBRANE,
      name: 'Z rozkliku zľavy',
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
  {
    label: 'zaškrtnuté produkty s tokenom vyrobeným v prehliadači (tvar JWT)',
    body: {
      previewToken: podvrhnutyToken(),
      productIds: VYBRANE,
      name: 'Z rozkliku zľavy',
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
  {
    label: '„zopakovať zľavu" ako odkaz na minulú kampaň namiesto tokenu',
    body: {
      repeatCampaignId: MINULA.id,
      zopakovat: MINULA.name,
      percent: MINULA.percent,
      durationDays: ZOPAKOVAT_DNI,
      productIds: VYBRANE,
      name: MINULA.name,
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
  {
    label: 'hodnoty rozcestníka (pásma + dni) úplne bez tokenu',
    body: {
      pasma: ZOPAKOVAT_PARAMS.get('pasma'),
      dni: ZOPAKOVAT_DNI,
      filter: ZOPAKOVAT_PARAMS.get('filter'),
      productIds: VYBRANE,
      name: 'Z rozcestníka Nová zľava',
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
];

/* ═══ A. Výber v rozkliku si potvrdenie nedonesie ══════════════════════════ */

describe('A. telo poskladané z výberu v zľave je odmietnuté', () => {
  for (const skratka of SKRATKY) {
    it(`${skratka.label}: 4xx, žiadny request na shop, kampaň nevznikne`, async () => {
      const w = world();
      const post = createCampaignsPost(w.deps, actorRouteDeps());
      const res = await parse(
        await post(makeRequest('POST', '/api/campaigns', skratka.body)),
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThanOrEqual(499);
      expect(res.body.ok).toBe(false);
      // Jadro I3: na shop nedorazil ANI JEDEN request — ani čítací.
      expect(mock.state.recordedRequests).toHaveLength(0);
      expect(w.campaigns.size).toBe(0);
    });
  }
});

/* ═══ B. Meradlo funguje — tie isté produkty s čerstvou skúškou ZAPÍŠU ═════ */

describe('B. tie isté produkty s tokenom zo skutočnej skúšky naprázdno prejdú', () => {
  it('dry-run → token → zaradenie: 200 a dva zápisy (kontrola meradla)', async () => {
    const w = world();
    const preview = createPreviewPost(w.deps, actorRouteDeps());
    const previewRes = await parse(
      await preview(
        makeRequest('POST', '/api/campaigns/preview', {
          productIds: VYBRANE,
          percent: MINULA.percent,
          from: day(1),
          to: day(10),
          kind: 'new',
        }),
      ),
    );
    expect(previewRes.status).toBe(200);
    const token = (previewRes.body.data as { previewToken: string }).previewToken;

    const post = createCampaignsPost(w.deps, actorRouteDeps());
    const res = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          previewToken: token,
          name: 'Z rozkliku zľavy, poriadnou cestou',
          mode: 'eager',
          acknowledgements: { irreversible: true },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(w.campaigns.size).toBe(1);
    expect(mock.state.writeRequests().length).toBe(VYBRANE.length);
  });
});

/* ═══ C. Povrch vyrába adresy sprievodcu, nie volania API ══════════════════ */

describe('C. odkazy, ktoré nové cesty vyrábajú, vedú do sprievodcu', () => {
  it('výber v rozkliku → `/zlavy/nova?produkty=…`, nikdy `/api/`', () => {
    expect(VYBER_HREF).not.toBeNull();
    expect(VYBER_HREF!.startsWith(`${NEW_DISCOUNT_HREF}?`)).toBe(true);
    expect(VYBER_HREF).toContain('produkty=');
    expect(VYBER_HREF).not.toContain('/api/');
  });

  it('„zopakovať zľavu" → tá istá adresa sprievodcu, bez zoznamu produktov', () => {
    const href = repeatDiscountHref(MINULA);
    expect(href.startsWith(`${NEW_DISCOUNT_HREF}?`)).toBe(true);
    expect(href).not.toContain('/api/');
    /*
     * Produkty sa zámerne NEPRENÁŠAJÚ: minulá zľava bežala nad iným katalógom
     * a prenesený zoznam ID by predstieral, že appka vie, čo je dnes v pásme.
     * To vie až dry-run.
     */
    expect(href).not.toContain('produkty=');
  });
});
