/**
 * Aura Zľavy — Z PRESETU NEEXISTUJE CESTA K `setReduction` (I3, K7).
 *
 * ČO TENTO SÚBOR EXISTUJE ZATVORIŤ
 * --------------------------------
 * Presety (V4, D89) majú byť VÝHRADNE predplnenie formulára. Existujúce testy
 * to merajú z dvoch strán, a obe sú TEXTOVÉ:
 *
 *   - `routes-presety.spec.ts` → „I3 — presety nezaložili druhú zápisovú
 *     cestu": grepuje priečinok `src/app/api/presets/` na `setReduction`,
 *     `engine/executor`, `previewTokens`…
 *   - `presety-zliav-ui.spec.ts` → „modul presetov nikde nesiaha na zápisové
 *     cesty": grepuje tri moduly povrchu.
 *
 * Obidva sa pýtajú „nespomína zápisovú cestu SÚBOR PRESETOV?". Ani jeden sa
 * nepýta „PUSTÍ zápisová cesta preset dovnútra?" — a to je iná otázka, lebo
 * brána nestojí v presetoch, ale v `POST /api/campaigns`.
 *
 * MERANÉ 31. 8. 2026 (mutačné overenie K7). Do `POST /api/campaigns` sa dočasne
 * pridala skratka `presetId`, ktorá pri jej prítomnosti PRESKOČILA
 * `verifyPreviewTokenFor()` a claims si vyrobila z NEOVERENÉHO tokenu:
 *
 *     const claims = ctx.body.presetId !== undefined
 *       ? ({ ...peeked, sub: ctx.actor.id } as never)
 *       : await verifyPreviewTokenFor(…);
 *
 * Po tejto mutácii zostalo ZELENÝCH všetkých 102 tvrdení v
 * `presety-zliav.spec.ts` + `routes-presety.spec.ts` + `presety-zliav-ui.spec.ts`
 * + `no-write-without-confirm.spec.ts` + `routes-campaigns.spec.ts`, a rovnako
 * `kontrakt-v3-kluc`, `kontrakt-v3-dokaz`, `preview-token` aj
 * `no-clear-reduction`. Preset sa teda stal druhou zápisovou cestou do
 * PRODUKČNÉHO eshopu a balík o tom nepovedal nič — grepy nič nenašli, lebo
 * slovo `preset` pribudlo v kampaniach, nie v presetoch.
 *
 * ČO SA TU TVRDÍ
 * --------------
 *   A. Telo zostavené z PRESETU (jeho percentá a dĺžka okna), ktoré si namiesto
 *      čerstvej skúšky naprázdno prináša vlastný „dôkaz" — `presetId`, meno
 *      presetu, `confirmed: true`, alebo prázdny token — je 4xx, na shop
 *      neodíde ANI JEDEN request a kampaň nevznikne.
 *   B. Meradlo nie je pokazené: TO ISTÉ telo s tokenom zo skutočného dry-runu
 *      prejde a zapíše. Bez tejto nohy by A bolo zelené aj nad rozbitou routou.
 *   C. Overenie tokenu je v štyroch zápisových routách BEZPODMIENEČNÉ — riadok
 *      s `verifyPreviewTokenFor(` je čisté `await`, nie vetva. Toto je tá noha,
 *      ktorá chytí mutáciu aj vtedy, keď sa skratka nebude volať `presetId`.
 *   D. Slovo `preset` v zápisových routách kampaní nemá čo robiť: preset sa
 *      končí na povrchu, do tela `POST /api/campaigns` nevstupuje.
 *
 * Prečo A aj C: A meria SPRÁVANIE (a padne aj na skratke bez slova „preset"),
 * C meria TVAR (a padne aj vtedy, keby skratka mala telo, ktoré A neuhádne).
 * Jedna bez druhej necháva dieru, ktorou mutácia 4c prešla.
 *
 * Proti mock shopu (I6), nikdy proti sperky-eshop.sk. Kampane sú v pamäťovom
 * svete `makeRoutesWorld()`.
 *
 * Vlastník: V4 (mutačné overenie K7).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createCampaignsPost } from '@/app/api/campaigns/route';
import { createPreviewPost } from '@/app/api/campaigns/preview/route';
import { presetPrefillHref, type PresetView } from '@/components/campaigns/presets-model';

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

function world(): RoutesWorld {
  mock.state.setProducts(
    [201, 202].map((id) => ({ id, name: `Šperk ${id}`, price: 19.99, has_attributes: false })),
  );
  return makeRoutesWorld({ shopBaseUrl: mock.baseUrl });
}

/** Preset tak, ako ho vracia `GET /api/presets`. */
const PRESET: PresetView = {
  id: 7,
  name: 'Ležiaky jeseň',
  filterQuery: 'soldWindowDays=180&soldBuckets=none%2Clow',
  tiers: [
    { ord: 1, label: 'A · 0 predaných za 180 dní', percent: 25, rule: { soldWindowDays: 180, bucket: 'none' } },
  ],
  durationDays: 21,
  createdAt: '2026-08-20T08:00:00.000Z',
  lastUsedAt: null,
};

/** Percento a dĺžka okna PRESETU — telá nižšie sú naozaj z neho, nie vymyslené. */
const PRESET_PERCENT = PRESET.tiers[0]!.percent;
const PRESET_PARAMS = new URLSearchParams(presetPrefillHref(PRESET).split('?')[1] ?? '');

/**
 * Token, ktorý má TVAR podpísaného náhľadu, ale podpis nikto nevydal — presne
 * to, čo by si vedel poskladať prehliadač (alebo cudzia stránka) z hodnôt
 * presetu. `peekPreviewToken()` ho prečíta, `verify()` ho MUSÍ odmietnuť.
 *
 * Existuje tu preto, že bez neho skupina A mutáciu 4c nechytila: nezmyselný
 * token spadol už na `peek`-u a k obídenému `verify()` sa beh nedostal.
 */
function podvrhnutyToken(): string {
  const b64 = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: TEST_USER_ID,
    kind: 'new',
    productIds: [201, 202],
    percent: PRESET_PERCENT,
    from: day(1),
    to: day(10),
    pricesAtPreview: { '201': '19.99', '202': '19.99' },
    iat: nowSec,
    exp: nowSec + 900,
  });
  return `${header}.${payload}.tento-podpis-nikto-nevydal`;
}

/**
 * Telá, ktorými by sa preset pokúsil zastúpiť skúšku naprázdno. Každé nesie
 * niečo, čo vyzerá ako dôkaz — a ani jedno ním nie je: dôkazom je LEN podpísaný
 * jednorazový token z `POST /api/campaigns/preview`.
 */
const SKRATKY: { label: string; body: Record<string, unknown> }[] = [
  {
    label: '`presetId` namiesto tokenu',
    body: {
      previewToken: 'z-presetu',
      presetId: PRESET.id,
      name: PRESET.name,
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
  {
    label: 'meno presetu a `confirmed: true` namiesto tokenu',
    body: {
      previewToken: 'z-presetu',
      preset: PRESET.name,
      confirmed: true,
      name: PRESET.name,
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
  {
    label: 'preset s percentom a oknom v tele, token prázdny',
    body: {
      previewToken: '',
      presetId: PRESET.id,
      percent: PRESET_PERCENT,
      durationDays: Number(PRESET_PARAMS.get('dni')),
      productIds: [201, 202],
      name: PRESET.name,
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
  {
    label: 'preset úplne bez tokenu',
    body: {
      presetId: PRESET.id,
      prefillFrom: { kind: 'preset', label: PRESET.name },
      name: PRESET.name,
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
  {
    label: 'preset s tokenom vyrobeným v prehliadači (tvar JWT, cudzí podpis)',
    body: {
      previewToken: podvrhnutyToken(),
      presetId: PRESET.id,
      name: PRESET.name,
      mode: 'eager',
      acknowledgements: { irreversible: true },
    },
  },
];

/* ═══ A. Preset si potvrdenie nedonesie — ani pod žiadnym z jeho mien ═══════ */

describe('A. z presetu odvodené telo `POST /api/campaigns` je odmietnuté', () => {
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
      // A do fronty sa nič nezaradilo, takže sa k `setReduction` ani nedostane.
      expect(w.campaigns.size).toBe(0);
    });
  }
});

/* ═══ B. Meradlo funguje — s čerstvou skúškou tá istá cesta ZAPÍŠE ═════════ */

describe('B. tá istá route s tokenom zo skutočnej skúšky naprázdno prejde', () => {
  it('dry-run → token → zaradenie: 200 a jeden zápis (kontrola meradla)', async () => {
    const w = world();
    const preview = createPreviewPost(w.deps, actorRouteDeps());
    const previewRes = await parse(
      await preview(
        makeRequest('POST', '/api/campaigns/preview', {
          productIds: [201, 202],
          percent: PRESET_PERCENT,
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
          name: PRESET.name,
          mode: 'eager',
          acknowledgements: { irreversible: true },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(w.campaigns.size).toBe(1);
    // Bez tohto tvrdenia by celá skupina A prešla aj nad routou, ktorá
    // neprijme NIKDY nič — a nemerala by bránu, ale mŕtvy kód.
    expect(mock.state.writeRequests().length).toBe(2);
  });
});

/* ═══ C. Overenie tokenu je bezpodmienečné, nie vetva ══════════════════════ */

const ZAPISOVE_ROUTY = [
  '../../src/app/api/campaigns/route.ts',
  '../../src/app/api/campaigns/[id]/execute/route.ts',
  '../../src/app/api/campaigns/[id]/extend/route.ts',
  '../../src/app/api/campaigns/[id]/retry-failed/route.ts',
];

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Riadky kódu (bez komentárov), aby zdôvodnenia v docblokoch nič nefalšovali. */
function codeLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .filter((line) => !line.startsWith('*') && !line.startsWith('/*') && !line.startsWith('//'));
}

describe('C. `verifyPreviewTokenFor()` je v zápisových routách BEZPODMIENEČNÉ', () => {
  for (const rel of ZAPISOVE_ROUTY) {
    it(`${rel.split('api/')[1]}: volanie je čisté \`await\`, nie vetva`, () => {
      const lines = codeLines(read(rel)).filter((line) => line.includes('verifyPreviewTokenFor('));
      // Presne jedno volanie na route — dve by znamenali dve rôzne brány.
      expect(lines).toHaveLength(1);
      /*
       * Tvar sa fixuje zámerne prísne. Mutácia 4c z tohto riadku spravila
       * `const claims = ctx.body.presetId !== undefined` a volanie odsunula do
       * druhej vetvy ternárneho operátora; tvrdenie o tvare je to jediné, čo
       * takú zmenu chytí bez ohľadu na to, ako sa skratka menuje.
       */
      expect(lines[0]).toBe('const claims = await verifyPreviewTokenFor(');
    });
  }

  it('žiadna zo štyroch routín nemá pri overení podmienku s `?` alebo `if`', () => {
    for (const rel of ZAPISOVE_ROUTY) {
      const lines = codeLines(read(rel));
      const at = lines.findIndex((line) => line.includes('verifyPreviewTokenFor('));
      expect(at, rel).toBeGreaterThan(-1);
      // Riadok NAD volaním nesmie otvárať vetvu, ktorá by ho preskočila.
      const above = lines[at - 1] ?? '';
      expect(above.includes('?'), `${rel} → ${above}`).toBe(false);
      expect(above.startsWith('if ('), `${rel} → ${above}`).toBe(false);
    }
  });
});

/* ═══ D. Preset do tela zápisu kampane nevstupuje ══════════════════════════ */

describe('D. zápisové routy kampaní o presetoch nevedia', () => {
  it('slovo `preset` nie je v kóde ani jednej zo štyroch routín', () => {
    for (const rel of ZAPISOVE_ROUTY) {
      const hits = codeLines(read(rel)).filter((line) => /preset/i.test(line));
      expect(hits, `${rel} → ${hits.join(' | ')}`).toEqual([]);
    }
  });

  it('sanity — zdroje sa naozaj čítajú', () => {
    for (const rel of ZAPISOVE_ROUTY) {
      const text = read(rel);
      expect(text.length, rel).toBeGreaterThan(1000);
      expect(text, rel).toContain('verifyPreviewTokenFor');
    }
  });
});
