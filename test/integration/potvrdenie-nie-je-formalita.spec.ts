/**
 * Aura Zľavy — POTVRDENIE NIE JE FORMALITA: `POST /api/campaigns` bez neho
 * NEZAPÍŠE (I3 po D100, D106, kontrakt V6 §4 bod 2).
 *
 * ČO TENTO SÚBOR EXISTUJE ZATVORIŤ
 * ────────────────────────────────
 * I3 po D100 znie „žiadny zápis bez dry-runu **a potvrdenia**" a appka NEMÁ
 * prihlásenie (D98–D100: Caddy `basic_auth`, app session aj sudo sú zrušené
 * a zmazané). Tie dve veci sú teda všetko, čo pred PRODUKČNÝM eshopom stojí.
 *
 * Existujúce testy merajú DRUHÚ nohu — token — do detailu
 * (`no-write-without-confirm.spec.ts`: chýbajúci, nezmyselný, expirovaný,
 * cudzo podpísaný, už použitý; `preset-nie-je-zapisova-cesta.spec.ts`: token
 * vyrobený v prehliadači). PRVÚ nohu, `acknowledgements`, nemeral NIKTO:
 * **každé** telo v celom balíku posiela `acknowledgements: { irreversible:
 * true }`, takže o tom, čo sa stane BEZ nej, nepovedalo ani jedno tvrdenie.
 * Zo schémy sa dá `z.literal(true)` zmeniť na `.optional()` jedným slovom
 * a balík by zostal zelený — potvrdenie by sa stalo ozdobou.
 *
 * PASCA, KTORÚ TENTO SÚBOR OBCHÁDZA (nález 31. 8. 2026, mutačné overenie K7)
 * ─────────────────────────────────────────────────────────────────────────
 * Dvaja „strážcovia" presetov boli grepy nad `src/app/api/presets/` na
 * `setReduction`, kým brána stojí v `POST /api/campaigns` — skratka `presetId`
 * v tele kampane nechala 102 tvrdení zelených. Test, ktorý stráži bránu, musí
 * siahať TAM, KDE BRÁNA NAOZAJ JE. Preto sa tu volá route handler, nie model
 * obrazovky, a preto sa každý odmietnutý pokus meria aj na mock shope: keď na
 * shop nedorazí ani jeden request, nemá sa `setReduction` ako stať.
 *
 * ČO SA TU TVRDÍ
 * ──────────────
 *   A. Telo s **PLATNÝM tokenom zo skutočnej skúšky naprázdno**, ale bez
 *      potvrdenia (chýbajúce, prázdne, `false`, reťazec „true", `null`), je
 *      4xx, na shop neodíde ANI JEDEN request a kampaň nevznikne. Token je
 *      platný ZÁMERNE: jediný dôvod odmietnutia je vtedy chýbajúce potvrdenie.
 *   B. Meradlo nie je pokazené — to isté telo S potvrdením prejde a ZAPÍŠE.
 *   C. Odmietnuté potvrdenie NESPÁLI token: keď človek doplní potvrdenie,
 *      nemusí skúšku opakovať. (Inak by z chýbajúcej vety bola strata skúšky
 *      nad 8 000 produktami a používatelia by sa naučili klikať naslepo.)
 *   D. Tvar brány: `irreversible` je v schéme `z.literal(true)` a nie je
 *      nepovinný. Táto noha chytí mutáciu aj vtedy, keď telo v A neuhádne.
 *   E. Čo skúška naprázdno UKÁZALA, to sa aj zapíše: produkty a percentá zo
 *      súhrnu na obrazovke sedia s tým, čo dorazí na shop. Potvrdenie čísla,
 *      ktoré sa nezapíše, je divadlo.
 *
 * Proti mock shopu (I6), nikdy proti sperky-eshop.sk. Kampane sú v pamäťovom
 * svete `makeRoutesWorld()`.
 *
 * Vlastník: V6b (oblasť Nová zľava, krok 2 — dry-run a potvrdenie).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createCampaignsPost } from '@/app/api/campaigns/route';
import { createPreviewPost } from '@/app/api/campaigns/preview/route';
import { dryRunLines } from '@/components/campaigns/NewDiscountConfirm';
import {
  buildTiers,
  discountWriteRequest,
  type SelectableRow,
} from '@/components/campaigns/discounts-model';

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

/** Produkty, ktoré mock shop pozná. Dva stačia — meria sa brána, nie objem. */
const IDS = [201, 202] as const;

function world(): RoutesWorld {
  mock.state.setProducts(
    IDS.map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl });
}

const FROM = day(1);
const TO = day(10);
const PERCENT = 25;

/** Podpísaný jednorazový token zo SKUTOČNEJ skúšky naprázdno. */
async function freshToken(w: RoutesWorld): Promise<string> {
  const preview = createPreviewPost(w.deps, actorRouteDeps());
  const res = await parse(
    await preview(
      makeRequest('POST', '/api/campaigns/preview', {
        productIds: [...IDS],
        percent: PERCENT,
        from: FROM,
        to: TO,
        kind: 'new',
      }),
    ),
  );
  expect(res.status, 'skúška naprázdno sama musí prejsť — inak meriame ju, nie potvrdenie').toBe(
    200,
  );
  return (res.body.data as { previewToken: string }).previewToken;
}

/** Telo zápisu bez `acknowledgements` — tie si každý prípad doplní sám. */
const bodyWithout = (token: string) => ({
  previewToken: token,
  name: 'Pokus bez potvrdenia',
  mode: 'eager' as const,
});

/**
 * Podoby „potvrdenia", ktoré potvrdením NIE SÚ. Každá vyzerá ako vyplnené
 * pole, a ani jedna nie je veta „rozumiem, že sa to zapíše do ostrého eshopu
 * a nedá sa to vrátiť jedným klikom".
 */
const NEPOTVRDENIA: { label: string; ack: unknown }[] = [
  { label: 'kľúč `acknowledgements` chýba celý', ack: undefined },
  { label: 'prázdny objekt', ack: {} },
  { label: '`irreversible: false`', ack: { irreversible: false } },
  { label: '`irreversible` ako reťazec „true"', ack: { irreversible: 'true' } },
  { label: '`irreversible: 1`', ack: { irreversible: 1 } },
  { label: '`acknowledgements: null`', ack: null },
  { label: 'potvrdené je niečo INÉ', ack: { oneDay: true } },
];

/* ═══ A. Platný token, chýbajúce potvrdenie → odmietnuté ═══════════════════ */

describe('A. `POST /api/campaigns` s čerstvou skúškou ale BEZ potvrdenia', () => {
  for (const pripad of NEPOTVRDENIA) {
    it(`${pripad.label}: 4xx, žiadny request na shop, kampaň nevznikne`, async () => {
      const w = world();
      const token = await freshToken(w);
      /*
       * Skúška naprázdno je čítanie, nie zápis — na shop pri nej ísť MÔŽE
       * (ceny). Počítadlo sa preto nuluje AŽ TU: od tohto miesta nesmie na
       * shop odísť nič.
       */
      mock.state.recordedRequests.length = 0;

      const body: Record<string, unknown> = bodyWithout(token);
      if (pripad.ack !== undefined) body.acknowledgements = pripad.ack;

      const post = createCampaignsPost(w.deps, actorRouteDeps());
      const res = await parse(await post(makeRequest('POST', '/api/campaigns', body)));

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThanOrEqual(499);
      expect(res.body.ok).toBe(false);
      // Jadro I3: na shop nedorazil ANI JEDEN request — ani čítací.
      expect(mock.state.recordedRequests).toHaveLength(0);
      // A do fronty sa nič nezaradilo, takže sa k `setReduction` ani nedostane.
      expect(w.campaigns.size).toBe(0);
    });
  }
});

/* ═══ B. Meradlo funguje — s potvrdením tá istá cesta ZAPÍŠE ══════════════ */

describe('B. to isté telo S potvrdením prejde (kontrola meradla)', () => {
  it('skúška → potvrdenie → zápis: 200, kampaň a dva zápisy na shop', async () => {
    const w = world();
    const token = await freshToken(w);
    mock.state.recordedRequests.length = 0;

    const post = createCampaignsPost(w.deps, actorRouteDeps());
    const res = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          ...bodyWithout(token),
          acknowledgements: { irreversible: true },
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(w.campaigns.size).toBe(1);
    /*
     * Bez tohto tvrdenia by celá skupina A prešla aj nad routou, ktorá
     * neprijme NIKDY nič — a nemerala by bránu, ale mŕtvy kód.
     */
    expect(mock.state.writeRequests()).toHaveLength(IDS.length);
  });
});

/* ═══ C. Odmietnuté potvrdenie NESPÁLI skúšku ═════════════════════════════ */

describe('C. chýbajúce potvrdenie neberie človeku skúšku naprázdno', () => {
  it('po odmietnutí sa TEN ISTÝ token s potvrdením ešte použiť dá', async () => {
    const w = world();
    const token = await freshToken(w);
    const post = createCampaignsPost(w.deps, actorRouteDeps());

    const bez = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          ...bodyWithout(token),
          acknowledgements: { irreversible: false },
        }),
      ),
    );
    expect(bez.status).toBeGreaterThanOrEqual(400);
    expect(w.campaigns.size).toBe(0);

    const s = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          ...bodyWithout(token),
          acknowledgements: { irreversible: true },
        }),
      ),
    );
    expect(s.status, 'token sa spálil na chýbajúcej vete — skúška 8 000 produktov zahodená').toBe(
      200,
    );
    expect(w.campaigns.size).toBe(1);
  });

  it('ale jednorazovosť platí ďalej: druhý zápis tým istým tokenom je 4xx', async () => {
    /* Poistka k predošlému prípadu — „nespáli sa" nesmie znamenať
       „dá sa použiť dvakrát" (I3, D16). */
    const w = world();
    const token = await freshToken(w);
    const post = createCampaignsPost(w.deps, actorRouteDeps());
    const ok = { ...bodyWithout(token), acknowledgements: { irreversible: true } };

    expect((await parse(await post(makeRequest('POST', '/api/campaigns', ok)))).status).toBe(200);
    const druhy = await parse(await post(makeRequest('POST', '/api/campaigns', ok)));
    expect(druhy.status).toBeGreaterThanOrEqual(400);
    expect(w.campaigns.size).toBe(1);
  });
});

/* ═══ D. Tvar brány: potvrdenie nie je nepovinné pole ═════════════════════ */

const ROUTE = '../../src/app/api/campaigns/route.ts';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Riadky kódu (bez komentárov), aby zdôvodnenia v docblokoch nič nefalšovali. */
function codeLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .filter((line) => !line.startsWith('*') && !line.startsWith('/*') && !line.startsWith('//'));
}

describe('D. `acknowledgements` je v schéme povinné a `irreversible` je literál', () => {
  it('schéma žiada `z.literal(true)`, nie `boolean` ani `optional`', () => {
    const lines = codeLines(read(ROUTE));
    const ack = lines.filter((line) => line.startsWith('acknowledgements:'));
    // Presne jedno miesto — dve schémy by znamenali dve rôzne brány.
    expect(ack).toHaveLength(1);
    expect(ack[0]).toBe('acknowledgements: z.object({');
    /*
     * `.optional()` na `acknowledgements` je celá mutácia: zod by telo bez
     * potvrdenia prijal a `ctx.body.acknowledgements.oneDay` by spadlo až za
     * `verify()`, teda po spálení tokenu.
     */
    const at = lines.indexOf(ack[0]!);
    const blok = lines.slice(at, at + 8);
    // Riadok `irreversible` je LITERÁL a je povinný — presne tento tvar.
    // `oneDay` má `.optional()` legitímne (D30 platí len pri `from = to`),
    // takže sa `optional()` nedá zakázať plošne; meria sa TEN riadok.
    const irreversible = blok.filter((line) => line.startsWith('irreversible:'));
    expect(irreversible).toEqual(['irreversible: z.literal(true),']);
    // A samotný objekt potvrdení nesmie byť nepovinný.
    expect(blok.join('\n')).toContain('}),');
    expect(blok.join('\n')).not.toContain('}).optional()');
  });

  it('kontrola jednodňovej zľavy stojí PRED overením tokenu', () => {
    /*
     * D30 a zároveň dôvod skupiny C: keby sa `oneDay` kontrolovalo za
     * `verify()`, chýbajúce potvrdenie by spálilo jednorazový token.
     */
    const lines = codeLines(read(ROUTE));
    const oneDay = lines.findIndex((line) => line.includes('acknowledgements.oneDay !== true'));
    const verify = lines.findIndex((line) => line.includes('verifyPreviewTokenFor('));
    expect(oneDay).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(-1);
    expect(oneDay).toBeLessThan(verify);
  });

  it('sanity — zdroj sa naozaj číta', () => {
    const text = read(ROUTE);
    expect(text.length).toBeGreaterThan(1000);
    expect(text).toContain('verifyPreviewTokenFor');
  });
});

/* ═══ E. Čo skúška UKÁZALA, to sa aj zapíše ═══════════════════════════════ */

/**
 * Model môže byť správny a dostať nepravdivý vstup (D121, 1. 9. 2026): pásma
 * fungovali v klientskom modeli, kým server posielal `unitsSold: 0` namiesto
 * `null`. Tu sa preto neporovnávajú dva výpočty, ale VETY SÚHRNU s tým, čo
 * dorazilo na shop. Keby súhrn hlásil päť produktov a zapísali sa dva,
 * potvrdenie by bolo divadlo — a človek by potvrdil číslo, ktoré nikdy
 * neexistovalo.
 */
describe('E. súhrn skúšky a zápis na shop hovoria to isté číslo', () => {
  it('produkty aj percentá zo súhrnu sedia s requestami na shop', async () => {
    const w = world();

    /* Výber, v ktorom JEDEN produkt predaj zmeraný nemá — po D121 do zápisu
       nejde, a súhrn to teda nesmie počítať. */
    const rows: SelectableRow[] = [
      { productId: 201, name: 'Šperk 201', price: '19.99', unitsSold: 0, discountedNow: false },
      { productId: 202, name: 'Šperk 202', price: '19.99', unitsSold: 0, discountedNow: false },
      { productId: 999, name: 'Nezmeraný', price: '19.99', unitsSold: null, discountedNow: false },
    ];
    const partition = buildTiers(rows, 180, {});
    const request = discountWriteRequest(partition);
    expect(request.productIds).toEqual([...IDS]);
    expect(partition.unknownProductIds).toEqual([999]);

    const lines = dryRunLines({
      itemsCount: request.productIds.length,
      tiers: partition.tiers,
      from: FROM,
      to: TO,
      budget: { spent: 0, limit: 1000 },
    });
    const produkty = lines.find((l) => l.key === 'produkty')!.value;
    const percenta = lines.find((l) => l.key === 'percenta')!.value;
    const rozpocet = lines.find((l) => l.key === 'rozpocet')!.value;

    /* Súhrn hovorí o DVOCH produktoch, nie o troch označených. */
    expect(produkty).toContain('2 produkty');
    expect(rozpocet).toContain('2 zápisy');

    const preview = createPreviewPost(w.deps, actorRouteDeps());
    const previewRes = await parse(
      await preview(
        makeRequest('POST', '/api/campaigns/preview', {
          productIds: [...request.productIds],
          percent: request.percent,
          from: FROM,
          to: TO,
          kind: 'new',
          tiers: request.tiers.map((tier) => ({ ...tier, productIds: [...tier.productIds] })),
        }),
      ),
    );
    expect(previewRes.status).toBe(200);
    const token = (previewRes.body.data as { previewToken: string }).previewToken;
    mock.state.recordedRequests.length = 0;

    const post = createCampaignsPost(w.deps, actorRouteDeps());
    const res = await parse(
      await post(
        makeRequest('POST', '/api/campaigns', {
          previewToken: token,
          name: 'Zľava zo súhrnu',
          mode: 'eager',
          tiers: request.tiers.map((tier) => ({
            ord: tier.ord,
            label: tier.label,
            percent: tier.percent,
            itemsCount: tier.productIds.length,
          })),
          acknowledgements: { irreversible: true },
        }),
      ),
    );
    expect(res.status).toBe(200);

    const writes = mock.state.writeRequests();
    // Toľko zápisov, koľko súhrn sľúbil — a na tie isté produkty.
    expect(writes).toHaveLength(request.productIds.length);
    expect(writes.map((r) => Number(r.body.id)).sort((a, b) => a - b)).toEqual([...IDS]);
    // A percentá, ktoré súhrn vypísal, sú tie, ktoré shop naozaj dostal.
    for (const written of new Set(writes.map((r) => String(r.body.reduction)))) {
      expect(percenta, `shop dostal ${written} %, súhrn o tom nehovoril`).toContain(written);
    }
  });
});
