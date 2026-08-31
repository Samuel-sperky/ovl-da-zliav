/**
 * Aura Zľavy — VIDITEĽNOSŤ DÁVKY OBOHACOVANIA (D118 bod 2, D120; I11, I1, K8).
 *
 * ČO SA TU DOKAZUJE A PREČO TO NIE JE KOZMETIKA
 * ---------------------------------------------
 * Dávka obohacovania si od migrácie 0014 zapisovala pokrok, dnešný diel a hlavne
 * DÔVOD PAUZY do `catalog_enrich_state` — a nečítal to nikto. `grep -rn
 * loadEnrichState src/` vracal 28. 8. 2026 výhradne engine a repozitár: žiadny
 * endpoint, žiadny komponent. Dávka teda mohla stáť tri týždne
 * s `pause_reason = 'ip_banned'` a človek to zistil jedine `SELECT`-om do
 * databázy. To je presne stav, ktorý I11 zakazuje: appka VIE, že stojí,
 * a nepovie to.
 *
 * Test má štyri časti a každá stráži jednu vec, ktorá sa dá ticho pokaziť:
 *
 *  A. **Endpoint hovorí, PREČO dávka stojí.** Vrátane toho, že pri odmietnutej
 *     adrese `paused_until` chýba ZÁMERNE (dôvod trvá, kým nezasiahne človek)
 *     a že sa to nesmie zliať s „dokedy nevieme".
 *  B. **Tri stavy každého čísla** (I11). Nula obohatených je MERANÝ fakt;
 *     `null` je priznanie. Dnešné počítadlo z INÉHO dňa sa nesmie vydávať za
 *     dnešok — a keď sa stav nedá prečítať, nesmie z toho byť nula.
 *  C. **Vety sú po slovensky a bez kódov** (I1, K10). Kód `ip_banned` sa do
 *     vykresleného HTML nesmie dostať ani raz, a čakanie sa nesmie ponúkať ako
 *     riešenie odmietnutej adresy — bola by to nekonečná slučka.
 *  D. **Prázdny stav nevyzerá ako chyba** a neobohatený katalóg nie je poplach:
 *     ani jeden stav dávky nesmie dostať červenú (tá je vyhradená strate dát
 *     a zastavenému zápisu).
 *
 * Žiadna databáza, žiadny prehliadač, žiadna sieť: route dostane fake
 * repozitár, komponenty sa vykresľujú cez `renderToStaticMarkup`. Na eshop sa
 * nesiaha ani raz (K8) — GET si klienta shopu ani nepýta.
 *
 * Vlastník: V4 (obohacovanie).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  createCatalogEnrichStateRoute,
  type EnrichStateRouteDeps,
} from '@/app/api/catalog/enrich/route';
import StatusSection from '@/components/dashboard/StatusSection';
import { parseEnrichState } from '@/components/dashboard/status-api';
import EnrichSection from '@/components/settings/EnrichSection';
import {
  enrichNote,
  type EnrichBatchStateWire,
  type EnrichStatePayload,
} from '@/lib/catalog/enrich-view';
import type { RouteDeps } from '@/lib/http/define-route';
import {
  emptyCatalogEnrichState,
  type CatalogEnrichState,
  type CatalogSyncProgress,
} from '@/lib/repo/catalog.repo';

import { queueProgress, type QueueProgress } from '@/components/dashboard/overview-model';
import {
  overviewChecks,
  overviewVerdict,
  type VerdictInput,
} from '@/components/dashboard/overview-verdict';
import type { CatalogSyncView, StatusView } from '@/components/dashboard/status-api';

const NOW = new Date('2026-08-31T09:00:00.000Z');
/** UTC deň `NOW`. Dávka počíta deň v zóne SHOPU, nie v Bratislave. */
const TODAY_UTC = '2026-08-31';
const MIRROR_ROWS = 41_220;
const SHOP_TOTAL = 41_348;

/* ═══════════════════════════ 1. Fixtúry ═══════════════════════════════════ */

function routeDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J0000000000000000ENRICH1',
    localActor: async () => ({ id: 1, username: 'samuel' }),
  };
}

function progressRow(patch: Partial<CatalogSyncProgress> = {}): CatalogSyncProgress {
  return {
    perPage: 100,
    lastPage: 413,
    shopTotal: SHOP_TOTAL,
    rowsWritten: 41_220,
    completed: true,
    startedAt: null,
    lastReadAt: null,
    finishedAt: null,
    pausedUntil: null,
    pauseReason: null,
    lastError: null,
    updatedAt: null,
    ...patch,
  };
}

interface World {
  /** `undefined` = repozitár hodí (stav sa nedal prečítať). */
  readonly state?: CatalogEnrichState;
  readonly rows?: number | 'throws';
  readonly shopTotal?: number | null | 'throws';
}

function deps(world: World = {}): EnrichStateRouteDeps {
  return {
    now: () => NOW,
    routeDeps: routeDeps(),
    catalog: {
      loadEnrichState: async (): Promise<CatalogEnrichState> => {
        if (world.state === undefined) throw new Error('DB je mimo');
        return world.state;
      },
      totalRows: async (): Promise<number> => {
        if (world.rows === 'throws') throw new Error('DB je mimo');
        return world.rows ?? MIRROR_ROWS;
      },
      loadSyncProgress: async (): Promise<CatalogSyncProgress> => {
        if (world.shopTotal === 'throws') throw new Error('DB je mimo');
        return progressRow(
          world.shopTotal === undefined ? {} : { shopTotal: world.shopTotal },
        );
      },
    },
  };
}

/** Stav dávky, ktorá bežala a nič ju nebrzdí. */
function ranState(patch: Partial<CatalogEnrichState> = {}): CatalogEnrichState {
  return {
    ...emptyCatalogEnrichState(),
    batchDay: TODAY_UTC,
    enrichedToday: 42,
    dailyTarget: 150,
    enrichedTotal: 1_240,
    startedAt: new Date('2026-08-20T01:00:00.000Z'),
    lastReadAt: new Date('2026-08-31T01:12:00.000Z'),
    ...patch,
  };
}

/** Dnešná realita (KONTRAKT-V4 §2b): shop odmieta našu adresu na všetko. */
function bannedState(): CatalogEnrichState {
  return ranState({
    // `paused_until` je pri `ip_banned` ZÁMERNE `NULL` — dôvod trvá, kým doň
    // nezasiahne človek (D120). Nie je to chýbajúci údaj.
    pausedUntil: null,
    pauseReason: 'ip_banned',
    lastError: 'ip_banned',
  });
}

async function call(world: World = {}): Promise<{ status: number; data: EnrichStatePayload; raw: string }> {
  const response = await createCatalogEnrichStateRoute(deps(world))(
    new Request('https://zlavy.local/api/catalog/enrich'),
  );
  const raw = await response.text();
  const body = JSON.parse(raw) as { ok: boolean; data: EnrichStatePayload };
  expect(body.ok, raw).toBe(true);
  return { status: response.status, data: body.data, raw };
}

/* ═══════════════ A. Endpoint hovorí, PREČO dávka stojí ════════════════════ */

describe('GET /api/catalog/enrich — stav dávky obohacovania', () => {
  it('vráti pokrok, denný cieľ aj DÔVOD pauzy', async () => {
    const { status, data } = await call({ state: bannedState() });

    expect(status).toBe(200);
    expect(data.state).not.toBeNull();
    expect(data.state?.pauseReason).toBe('ip_banned');
    expect(data.state?.paused).toBe(true);
    expect(data.state?.everRan).toBe(true);
    // Pokrok: čitateľ zo stavu dávky, menovateľ zo zrkadla, shopové číslo zvlášť.
    expect(data.coverage.enriched).toBe(1_240);
    expect(data.coverage.catalogProducts).toBe(MIRROR_ROWS);
    expect(data.coverage.shopTotalProducts).toBe(SHOP_TOTAL);
    expect(data.coverage.remaining).toBe(MIRROR_ROWS - 1_240);
    // Denný cieľ a spotreba sú DVE čísla a nezlievajú sa.
    expect(data.state?.dailyTarget).toBe(150);
    expect(data.state?.enrichedToday).toBe(42);
    expect(data.coverage.estimatedDaysLeft).toBe(Math.ceil((MIRROR_ROWS - 1_240) / 150));
  });

  it('`paused_until` pri odmietnutej adrese je NULL a čaká sa na ČLOVEKA', async () => {
    const { data } = await call({ state: bannedState() });

    expect(data.state?.pausedUntil).toBeNull();
    // Toto je celý rozdiel proti „dokedy nevieme": pauzu neuvoľní čakanie.
    expect(data.state?.waitsForHuman).toBe(true);
  });

  it('pauza s časom sa čakaním uvoľní sama — na človeka sa nečaká', async () => {
    const { data } = await call({
      state: ranState({
        pauseReason: 'daily_budget',
        pausedUntil: new Date('2026-09-01T00:00:00.000Z'),
        lastError: 'quota_reserve',
      }),
    });

    expect(data.state?.paused).toBe(true);
    expect(data.state?.waitsForHuman).toBe(false);
    expect(data.state?.pausedUntil).toBe('2026-09-01T00:00:00.000Z');
  });

  it('pauza, ktorej čas už uplynul, NIE JE pauza', async () => {
    const { data } = await call({
      state: ranState({
        pauseReason: 'rate_limited',
        pausedUntil: new Date('2026-08-31T08:00:00.000Z'),
      }),
    });

    expect(data.state?.paused).toBe(false);
  });

  it('KÓD chyby sa na povrch nedostane (I1, K10) — von ide len príznak', async () => {
    const { data, raw } = await call({
      state: ranState({ pauseReason: 'error', lastError: 'shop_500_internal' }),
    });

    expect(data.state?.failedLastTime).toBe(true);
    expect(raw).not.toContain('shop_500_internal');
    expect(raw).not.toContain('lastError');
    // A už vôbec nič o kľúči.
    expect(raw).not.toContain('apiKey');
  });
});

/* ═══════════════ B. Tri stavy každého čísla (I11) ═════════════════════════ */

describe('dávka obohacovania — hodnota, „dnes nebežala" a „nevieme"', () => {
  it('dávka, ktorá NIKDY nebežala: nula je meraný fakt, nie chyba', async () => {
    const { data } = await call({ state: emptyCatalogEnrichState() });

    expect(data.state?.everRan).toBe(false);
    // Nula obohatených je fakt (nič sa neobohatilo), ale DNEŠNÉ počítadlo
    // neexistuje — dávka dnes nebežala, a to je iná veta než nula.
    expect(data.coverage.enriched).toBe(0);
    expect(data.state?.enrichedToday).toBeNull();
    expect(data.coverage.percent).toBe(0);
    expect(data.unreadable).toEqual([]);
  });

  it('počítadlo z INÉHO dňa sa nevydáva za dnešok', async () => {
    const { data } = await call({ state: ranState({ batchDay: '2026-08-30', enrichedToday: 150 }) });

    expect(data.state?.batchDay).toBe('2026-08-30');
    expect(data.state?.enrichedToday).toBeNull();
    // Celkový súčet ostáva — ten o dni netvrdí nič.
    expect(data.coverage.enriched).toBe(1_240);
  });

  it('nečitateľný stav dávky je `null` a priznaná medzera, nie nula a nie 500', async () => {
    const { status, data } = await call({});

    expect(status).toBe(200);
    expect(data.state).toBeNull();
    expect(data.coverage.enriched).toBeNull();
    expect(data.coverage.remaining).toBeNull();
    expect(data.coverage.percent).toBeNull();
    expect(data.coverage.estimatedDaysLeft).toBeNull();
    expect(data.unreadable).toContain('enrich');
  });

  it('nečitateľný katalóg zhasne len menovateľa, nie celú odpoveď', async () => {
    const { data } = await call({ state: ranState(), rows: 'throws' });

    expect(data.coverage.enriched).toBe(1_240);
    expect(data.coverage.catalogProducts).toBeNull();
    expect(data.coverage.percent).toBeNull();
    expect(data.unreadable).toContain('catalog');
  });

  it('keď shop počet produktov nepovedal, appka si ho NEDOPOČÍTA', async () => {
    const { data } = await call({ state: ranState(), shopTotal: null });

    expect(data.coverage.shopTotalProducts).toBeNull();
    expect(data.coverage.catalogProducts).toBe(MIRROR_ROWS);
  });

  it('odpoveď prežije bezpečné čítanie na klientovi', async () => {
    const { data } = await call({ state: bannedState() });
    const parsed = parseEnrichState(data);

    expect(parsed).not.toBeNull();
    expect(parsed?.state?.pauseReason).toBe('ip_banned');
    expect(parsed?.state?.waitsForHuman).toBe(true);
    expect(parsed?.coverage.enriched).toBe(1_240);
  });
});

/* ═══════════════ C. Vety: po slovensky, bez kódov, bez slučky ═════════════ */

function payload(state: EnrichBatchStateWire | null, patch: Partial<EnrichStatePayload> = {}): EnrichStatePayload {
  return {
    state,
    coverage: {
      enriched: 1_240,
      catalogProducts: MIRROR_ROWS,
      shopTotalProducts: SHOP_TOTAL,
      remaining: MIRROR_ROWS - 1_240,
      percent: 3,
      estimatedDaysLeft: 267,
    },
    unreadable: [],
    at: NOW.toISOString(),
    ...patch,
  };
}

function wire(patch: Partial<EnrichBatchStateWire> = {}): EnrichBatchStateWire {
  return {
    everRan: true,
    batchDay: TODAY_UTC,
    enrichedToday: 42,
    dailyTarget: 150,
    startedAt: '2026-08-20T01:00:00.000Z',
    lastReadAt: '2026-08-31T01:12:00.000Z',
    pauseReason: null,
    pausedUntil: null,
    paused: false,
    waitsForHuman: false,
    failedLastTime: false,
    updatedAt: '2026-08-31T01:12:00.000Z',
    ...patch,
  };
}

const BANNED = wire({
  pauseReason: 'ip_banned',
  pausedUntil: null,
  paused: true,
  waitsForHuman: true,
  failedLastTime: true,
});

describe('veta o odmietnutej adrese', () => {
  it('povie, čo sa deje, čo s tým a PREČO tu nie je čas ďalšieho pokusu', () => {
    const note = enrichNote(payload(BANNED));

    expect(note.label).toContain('adresu');
    expect(note.what).toContain('adresy');
    // Vysvetlenie chýbajúceho času je povinné: bez neho to vyzerá ako chyba appky.
    expect(note.what).toContain('Čas ďalšieho pokusu preto neexistuje');
    expect(note.nextStep).not.toBeNull();
    expect(note.nextStep).toContain('odblokovanie');
    // Čakanie sa NESMIE ponúkať ako riešenie — bola by to nekonečná slučka.
    expect(`${note.what} ${note.nextStep ?? ''}`.toLowerCase()).not.toContain('o chvíľu');
  });

  it('ani jeden stav dávky nedostane červenú', () => {
    const tones = [
      enrichNote(null).tone,
      enrichNote(payload(null)).tone,
      enrichNote(payload(wire({ everRan: false }))).tone,
      enrichNote(payload(BANNED)).tone,
      enrichNote(payload(wire({ pauseReason: 'no_key', paused: true, waitsForHuman: true }))).tone,
      enrichNote(payload(wire({ pauseReason: 'daily_budget', paused: true }))).tone,
      enrichNote(payload(wire({ pauseReason: 'rate_limited', paused: true }))).tone,
      enrichNote(payload(wire({ pauseReason: 'error', paused: true }))).tone,
      enrichNote(payload(wire())).tone,
    ];

    // `EnrichTone` červenú ani nemá; tento test drží ten zámer aj po pridaní
    // nového dôvodu pauzy, ktorý by ju chcel.
    for (const tone of tones) expect(tone).not.toBe('critical');
  });

  it('dôvody, ktoré prejdú samy, ponúkajú čakanie — a povedia dokedy', () => {
    const note = enrichNote(
      payload(
        wire({
          pauseReason: 'daily_budget',
          paused: true,
          pausedUntil: '2026-09-01T00:00:00.000Z',
        }),
      ),
    );

    expect(note.tone).toBe('progress');
    expect(note.nextStep).toContain('Netreba robiť nič');
  });
});

describe('sekcia Nastavení — dávku obohacovania konečne VIDNO', () => {
  const render = (enrich: EnrichStatePayload | null): string =>
    renderToStaticMarkup(createElement(EnrichSection, { enrich }));

  it('odmietnutú adresu vykreslí čitateľne a BEZ kódu', () => {
    const markup = render(payload(BANNED));

    expect(markup).toContain('id="obohacovanie"');
    expect(markup).toContain('Eshop neprijíma čítanie z tejto adresy');
    expect(markup).toContain('odblokovanie');
    // `paused_until = NULL` je ZÁMER (D120) a technický detail to hovorí rovno —
    // prázdna bunka by vyzerala ako chýbajúci údaj.
    expect(markup).toContain('Čas ďalšieho pokusu preto neexistuje');
    expect(markup).toContain('čaká sa na človeka');
    // Kód shopu na obrazovke nikdy (I1, K10).
    expect(markup).not.toContain('ip_banned');
    // Ani červená: dávka, ktorá stojí, nie je strata dát.
    expect(markup).not.toContain('critical');
  });

  it('prázdny stav (dávka nikdy nebežala) nevyzerá ako chyba', () => {
    const markup = render(
      payload(wire({ everRan: false, batchDay: null, enrichedToday: null, lastReadAt: null }), {
        coverage: {
          enriched: 0,
          catalogProducts: MIRROR_ROWS,
          shopTotalProducts: SHOP_TOTAL,
          remaining: MIRROR_ROWS,
          percent: 0,
          estimatedDaysLeft: 275,
        },
      }),
    );

    expect(markup).toContain('začne sama');
    expect(markup).toContain('dnes dávka nebežala');
    for (const word of ['chyba', 'zlyhal', 'porucha', 'critical']) {
      expect(markup.toLowerCase(), `prázdny stav nesmie znieť ako ${word}`).not.toContain(word);
    }
  });

  it('nečitateľný stav je pomlčka, nie vymyslená nula', () => {
    const markup = render(null);

    expect(markup).toContain('—');
    expect(markup).toContain('nepodarilo prečítať');
    expect(markup).not.toContain('critical');
  });

  it('pokrok je vidieť ako číslo z čísla', () => {
    const markup = render(payload(wire()));

    expect(markup).toContain('1 240');
    expect(markup).toContain('41 220');
    // Denný diel a jeho cieľ vedľa seba.
    expect(markup).toContain('42');
    expect(markup).toContain('150');
  });
});

/* ═══════════════ D. Stavový pás Prehľadu ══════════════════════════════════ */

const TODAY_LOCAL = '2026-08-31';

function sync(): CatalogSyncView {
  return {
    loadedProducts: MIRROR_ROWS,
    shopTotalProducts: SHOP_TOTAL,
    complete: true,
    refreshing: false,
    lastReadAt: '2026-08-31T01:12:00.000Z',
    waiting: null,
    nextBatchAt: null,
    estimatedFinishAt: null,
    failedLastTime: false,
    ipBanned: false,
  };
}

function status(): StatusView {
  return {
    writes: { enabled: true, locked: false },
    apiKey: { present: true, expiresAt: '2026-09-01T09:00:00.000Z' },
    writeBudget: { budget: 200, spent: 10, remaining: 190, exhausted: false },
    scope: { pilot: true, maxProducts: 10 },
    catalog: { loadedProducts: MIRROR_ROWS, shopTotalProducts: SHOP_TOTAL },
    blockers: [],
    blocked: false,
    unreadable: [],
  };
}

function calmProgress(): QueueProgress {
  return queueProgress({
    snapshot: {
      budget: { day: TODAY_LOCAL, budget: 200, spent: 10, remaining: 190, exhausted: false },
      queue: { pending: 0, total: 0, done: 0, campaigns: 0 },
      current: null,
      estimate: null,
      heartbeat: { lastTickAt: '2026-08-31T08:59:00.000Z', stale: false },
      gate: { paused: false, since: null },
    },
    campaigns: [],
    today: TODAY_LOCAL,
  });
}

function renderBand(enrich: EnrichStatePayload | null | undefined): string {
  const view: VerdictInput = {
    status: status(),
    sync: sync(),
    heartbeat: { lastTickAt: '2026-08-31T08:59:00.000Z', stale: false },
    progress: calmProgress(),
  };
  return renderToStaticMarkup(
    createElement(StatusSection, {
      verdict: overviewVerdict(view),
      checks: overviewChecks(view),
      progress: view.progress,
      budget: { spent: 10, budget: 200, remaining: 190 },
      calm: { live: 0, ready: 0, discounted: 0 },
      gap: null,
      ...(enrich === undefined ? {} : { enrich }),
      onChanged: (): void => {},
    }),
  );
}

describe('Prehľad — stavový pás nesie dávku obohacovania', () => {
  it('stojaca dávka je v páse aj s vetou, čo s tým', () => {
    const markup = renderBand(payload(BANNED));

    expect(markup).toContain('data-check="enrich"');
    expect(markup).toContain('adresu');
    // Pauza, ktorú nevylieči čakanie, musí byť VIDNO — nie len pod odkazom.
    expect(markup).toContain('overview-enrich-stuck');
    expect(markup).toContain('/nastavenia/co-smie#obohacovanie');
    expect(markup).not.toContain('ip_banned');
  });

  it('dávka, ktorá beží, je v páse tichá — bez vety navyše', () => {
    const markup = renderBand(payload(wire()));

    expect(markup).toContain('data-check="enrich"');
    expect(markup).not.toContain('overview-enrich-stuck');
  });

  it('„nežiadali sme" a „nevieme" sú dve rôzne veci', () => {
    // `undefined` = obrazovka o dávku nežiadala, takže o nej ani nehovorí.
    expect(renderBand(undefined)).not.toContain('data-check="enrich"');
    // `null` = odpoveď sa nedala prečítať, a to appka POVIE.
    const unknown = renderBand(null);
    expect(unknown).toContain('data-check="enrich"');
    expect(unknown).toContain('Stav dávky nevieme');
  });
});
