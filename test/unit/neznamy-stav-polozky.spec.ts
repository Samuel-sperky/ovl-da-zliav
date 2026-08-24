/**
 * Aura Zľavy — KEĎ APPKA NEVIE, PATRÍ TAM POMLČKA (audit B7, 24. 8. 2026).
 *
 * Dve miesta, kde sa neznáma hodnota menila na ticho vyzerajúce číslo:
 *
 *  A. `insightsRepo.campaignItemTally()` + `GET /api/insights/campaign/[id]/items`
 *     — položka so stavom mimo číselníka z rozpadu vypadla a `total` sa počítal
 *     z už prefiltrovanej tally. Odpoveď teda hlásila menej položiek, než
 *     kampaň má, a nikde nebolo vidieť, že niečo chýba. Nula namiesto pomlčky.
 *  B. `orderDiscounts()` v `campaigns/discounts-model.ts` — poradie stavov bez
 *     stráže, kým dvojička na Prehľade (`overview-model.liveCampaigns()`) ju má.
 *     `undefined` v odčítaní dáva `NaN`, `sort()` potom nie je usporiadanie
 *     a zoznam sa medzi dvoma načítaniami preskladá.
 *
 * DOSIAHNUTEĽNOSŤ. Ani jedno sa dnes z databázy spustiť nedá: `campaign_items.
 * status` je `ENUM` s ôsmimi hodnotami a `ITEM_STATUSES` má tých istých osem.
 * Ožije to prvou migráciou, ktorá stav pridá — presne tým, čo vyrobilo `writing`
 * v `campaigns.status`. Meria sa to preto FIXTÚROU (podvrhnutý riadok, resp.
 * podvrhnutý stav povrchu), nie zmenou schémy: obe funkcie hodnotu preberajú
 * ako reťazec z databázy a typ ju neoveruje.
 *
 * Meria sa SPRÁVANIE — návratové hodnoty funkcií a telo odpovede. Hľadanie
 * reťazcov v zdroji by o žiadnej z týchto chýb nepovedalo nič.
 *
 * Vlastník: B7, vlna 24. 8. 2026.
 */
import { describe, expect, it } from 'vitest';

import type { DbRow, Queryable, SessionClaims } from '@/contracts';

import { createInsightsCampaignItemsGet } from '@/app/api/insights/campaign/[id]/items/route';
import { stateRank } from '@/components/campaigns/discounts-model';
import type { RouteDeps } from '@/lib/http/define-route';
import { insightsRepo, type CampaignItemBreakdown } from '@/lib/repo/insights.repo';
import { SURFACE_STATES, type SurfaceState } from '@/lib/ui/vocabulary';

/* ═══════════════════════════ 1. Prostredie ════════════════════════════════ */

const NOW = new Date('2026-08-24T09:00:00.000Z');

/** Stav, ktorý appka nepozná — presne ten tvar, ktorý vyrobí migrácia. */
const NEZNAMY_STAV = 'writing';

/** Spojenie, ktoré vráti pripravené riadky `GROUP BY status`. */
function conn(rows: readonly DbRow[]): Queryable {
  return {
    query: async <T,>(): Promise<T> => rows as unknown as T,
  };
}

function claims(): SessionClaims {
  return {
    sub: 7,
    username: 'admin',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: null,
  };
}

/** Session vrstva ako stub — testuje sa trasa, nie podpis (to vlastní A4). */
function sessionDeps(): RouteDeps {
  return {
    now: () => NOW,
    verifySession: async () => ({
      claims: claims(),
      refreshed: {
        token: 'refreshed',
        claims: claims(),
        cookie: {
          name: 'ovl_zliav_session' as const,
          value: 'refreshed',
          options: {
            httpOnly: true as const,
            secure: true as const,
            sameSite: 'strict' as const,
            path: '/',
            maxAge: 1800,
          },
        },
      },
    }),
  };
}

interface ItemsBody {
  ok: boolean;
  data: {
    campaignId: number;
    total: number;
    tally: Record<string, number>;
    unrecognized: number;
  };
}

/** Zavolá trasu s podvrhnutým rozpadom a vráti telo odpovede. */
async function callItems(breakdown: CampaignItemBreakdown): Promise<ItemsBody> {
  const handler = createInsightsCampaignItemsGet(
    { insightsRepo: { ...insightsRepo, campaignItemTally: async () => breakdown } },
    sessionDeps(),
  );
  const response = await handler(
    new Request('https://zlavy.local/api/insights/campaign/5/items', {
      headers: { cookie: 'ovl_zliav_session=x' },
    }),
    { params: { id: '5' } },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ItemsBody;
}

/* ═════════ A. Rozpad položiek — neznámy stav sa počíta, nie zahadzuje ═════ */

describe('rozpad položiek kampane nezahodí stav, ktorý appka nepozná', () => {
  it('položka s neznámym stavom sa spočíta zvlášť, nie do stratena', async () => {
    const breakdown = await insightsRepo.campaignItemTally(
      5,
      conn([
        { status: 'ok', n: 3 },
        { status: NEZNAMY_STAV, n: 2 },
      ]),
    );
    expect(breakdown.tally.ok).toBe(3);
    expect(breakdown.unrecognized).toBe(2);
  });

  it('známe stavy sa zaraďujú ako predtým a neznámy ich neposunie', async () => {
    const breakdown = await insightsRepo.campaignItemTally(
      5,
      conn([
        { status: 'ok', n: 4 },
        { status: 'failed', n: 1 },
        { status: 'uncertain', n: 2 },
        { status: NEZNAMY_STAV, n: 7 },
      ]),
    );
    expect(breakdown.tally).toMatchObject({ ok: 4, failed: 1, uncertain: 2, pending: 0 });
    expect(breakdown.unrecognized).toBe(7);
  });

  it('bez neznámeho stavu je priznanie nula — príznak nehlási pri každej kampani', async () => {
    const breakdown = await insightsRepo.campaignItemTally(5, conn([{ status: 'ok', n: 3 }]));
    expect(breakdown.unrecognized).toBe(0);
  });

  it('stav menom kľúča z prototypu sa tiež nezaradí medzi známe', async () => {
    // `if (status in tally)` videlo aj `toString` a `constructor` — kľúče, ktoré
    // v číselníku nikdy neboli. Runtime číselník ich pozná ako neznáme.
    const breakdown = await insightsRepo.campaignItemTally(
      5,
      conn([{ status: 'toString', n: 2 }]),
    );
    expect(breakdown.unrecognized).toBe(2);
    expect(Object.values(breakdown.tally).every((n) => typeof n === 'number')).toBe(true);
  });

  it('nezmyselné ID nič nevymyslí — prázdny rozpad a nula neznámych', async () => {
    const breakdown = await insightsRepo.campaignItemTally(0, conn([{ status: 'ok', n: 3 }]));
    expect(breakdown.unrecognized).toBe(0);
    expect(Object.values(breakdown.tally).reduce((sum, n) => sum + n, 0)).toBe(0);
  });
});

/* ═════════ A2. Odpoveď API — `total` sedí a medzeru priznáva ══════════════ */

describe('GET /api/insights/campaign/[id]/items hlási skutočný počet', () => {
  it('`total` počíta aj položky, ktorých stav appka nepozná', async () => {
    const body = await callItems({
      tally: {
        pending: 0,
        skipped: 0,
        ok: 3,
        failed: 0,
        uncertain: 0,
        interrupted: 0,
        not_found: 0,
        blocked: 0,
      },
      unrecognized: 2,
    });
    // Kampaň má päť položiek. Do 24. 8. 2026 odpoveď hlásila tri.
    expect(body.data.total).toBe(5);
    expect(body.data.total).not.toBe(3);
  });

  it('a medzeru PRIZNÁVA — počet neznámych je v odpovedi, nie len v súčte', async () => {
    const body = await callItems({
      tally: {
        pending: 0,
        skipped: 0,
        ok: 3,
        failed: 0,
        uncertain: 0,
        interrupted: 0,
        not_found: 0,
        blocked: 0,
      },
      unrecognized: 2,
    });
    expect(body.data.unrecognized).toBe(2);
    // Súčet rozpadu a priznaných neznámych je celý počet — nič sa nestráca.
    const zoradene = Object.values(body.data.tally).reduce((sum, n) => sum + n, 0);
    expect(zoradene + body.data.unrecognized).toBe(body.data.total);
  });

  it('bez neznámych sa nič nemení — súčet tally je celý počet', async () => {
    const body = await callItems({
      tally: {
        pending: 1,
        skipped: 0,
        ok: 3,
        failed: 2,
        uncertain: 0,
        interrupted: 0,
        not_found: 0,
        blocked: 0,
      },
      unrecognized: 0,
    });
    expect(body.data.total).toBe(6);
    expect(body.data.unrecognized).toBe(0);
  });

  it('vnútorný kód stavu sa do odpovede nedostane (K10)', async () => {
    const body = await callItems({
      tally: {
        pending: 0,
        skipped: 0,
        ok: 3,
        failed: 0,
        uncertain: 0,
        interrupted: 0,
        not_found: 0,
        blocked: 0,
      },
      unrecognized: 2,
    });
    expect(JSON.stringify(body.data)).not.toContain(NEZNAMY_STAV);
  });
});

/* ═════════ B. Poradie zoznamu zliav — stav mimo číselníka nedá NaN ════════ */

describe('poradie stavov v zozname zliav znesie stav mimo číselníka', () => {
  /** Stav povrchu, ktorý v `STATE_ORDER` nie je. */
  const MIMO = 'zapisuje sa niekde inde' as SurfaceState;

  it('stav mimo číselníka dostane konečné číslo, nie NaN', () => {
    expect(Number.isFinite(stateRank(MIMO))).toBe(true);
  });

  it('ide na koniec — za každý známy stav, rovnako ako na Prehľade', () => {
    for (const state of SURFACE_STATES) {
      expect(stateRank(state)).toBeLessThan(stateRank(MIMO));
    }
  });

  it('známe poradie ostáva `zapisuje sa` → `beží` → `pripravená` → `skončila`', () => {
    const poradie = [...SURFACE_STATES].sort((a, b) => stateRank(a) - stateRank(b));
    expect(poradie).toEqual(['zapisuje sa', 'beží', 'pripravená', 'skončila']);
  });

  it('triedenie je stabilné — poradie nezávisí od poradia na vstupe', () => {
    const vstup: SurfaceState[] = ['skončila', MIMO, 'beží', 'zapisuje sa', 'pripravená'];
    const zoradene = [...vstup].sort((a, b) => stateRank(a) - stateRank(b));
    const zoradeneOdzadu = [...vstup].reverse().sort((a, b) => stateRank(a) - stateRank(b));
    expect(zoradene).toEqual(zoradeneOdzadu);
    // Bez stráže by `NaN` porovnávač rozbil a neznámy stav by skončil hocikde.
    expect(zoradene[zoradene.length - 1]).toBe(MIMO);
  });
});
