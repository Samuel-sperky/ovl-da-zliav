/**
 * Aura Zľavy — testy agregátora stavu (`src/lib/status/snapshot.ts`
 * a `GET /api/status`).
 *
 * Endpoint konzumuje päť obrazoviek, takže testy nestrážia kozmetiku, ale to,
 * na čom stojí:
 *
 *  1. **Fail-closed.** Každý zdroj, ktorý zlyhá, MUSÍ skončiť ako vynechaná
 *     sekcia + meno v `unreadable` — nikdy ako optimistická nula. Je na to aj
 *     plošný test, ktorý postupne rozbíja jeden zdroj za druhým.
 *  2. **I1 a redakcia.** Telo odpovede prechádza `redact()` a meno `apiKey` je
 *     v jeho denylistu. Test posiela odpoveď skutočnou route pipeline
 *     a kontroluje, že `apiKey.present` PREŽIJE (na tomto sa už raz popálil
 *     `/api/health`) a že sa v tele neobjaví nič z kľúča.
 *  3. **Prekážky sedia s číslami v sekciách.** `blockers` sa počítajú nad tým
 *     istým snapshotom, aký ide do payloadu — test to overuje porovnaním
 *     s priamym volaním `collectOperationBlockers()`.
 *  4. **`missingProductIds` sa nefabrikuje.** Payload ich nenesie a prilepenie
 *     výberu cez `statusSnapshotFromPayload()` NESMIE vyrobiť tvrdenie, že
 *     vybrané produkty sú overené.
 *
 * Vlastník: S2.
 */
import { describe, expect, it } from 'vitest';

import type { SessionClaims } from '@/contracts';

import { createStatusRoute, productionStatusSources } from '@/app/api/status/route';
import type { RouteDeps } from '@/lib/http/define-route';
import { REDACTED } from '@/lib/log/redact';
import { collectOperationBlockers, type BlockerId } from '@/lib/status/blockers';
import {
  blockerFromWire,
  buildStatusSnapshot,
  effectiveMaxProducts,
  readStatusPayload,
  statusSnapshotFromPayload,
  toStatusPayload,
  type StatusPayload,
  type StatusSection,
  type StatusSources,
} from '@/lib/status/snapshot';

// Vety prekážok sa merajú ako FAKT, nie ako slovné spojenie — pomôcka aj dôvod
// sú v jednom súbore spolu s `status-blockers.spec.ts`.
import { nesieCislo } from '../helpers/vety';

/* ════════════════════════════ 1. Prostredie ═══════════════════════════════ */

const NOW = new Date('2026-08-12T10:00:00.000Z');
const KEY_EXPIRES = new Date('2026-08-14T08:00:00.000Z');
const LAST_FETCH = new Date('2026-08-12T03:00:00.000Z');

/** Nikdy nie tvar reálneho kľúča poskytovateľa (I1, GitHub push protection). */
const FAKE_KEY = 'fake-shop-key-ABCD1234';

/** Zdravý stav: všetko sa dá prečítať, zápisy sú zapnuté, katalóg je celý. */
function healthySources(patch: Partial<StatusSources> = {}): StatusSources {
  return {
    writesEnabled: () => true,
    settings: {
      readScope: async () => ({
        mode: 'plny',
        maxProductsPerCampaign: 500,
        dailyWriteBudget: 200,
        failClosed: false,
      }),
      readWriteLock: async () => ({
        writesLocked: false,
        writesLockedReason: null,
        writesLockedAt: null,
      }),
    },
    apiKey: {
      getMeta: async () => ({ present: true, expiresAt: KEY_EXPIRES }),
    },
    writeBudget: {
      remainingToday: async (dailyBudget) => ({
        day: '2026-08-12',
        budget: dailyBudget,
        spent: 40,
        remaining: dailyBudget - 40,
        exhausted: false,
      }),
    },
    catalog: {
      read: async () => ({
        loadedProducts: 41_082,
        shopTotalProducts: 41_082,
        lastFetchedAt: LAST_FETCH,
      }),
    },
    catalogReads: async () => ({ usedThisMinute: 0, usedThisUtcDay: 12 }),
    now: () => NOW,
    ...patch,
  };
}

const boom = (): never => {
  throw new Error('zdroj je nedostupný');
};

/* ═════════════════════ 2. Zloženie snapshotu zo zdrojov ═══════════════════ */

describe('buildStatusSnapshot — číta fakty a priznáva medzery', () => {
  it('zo zdravých zdrojov zloží úplný snapshot bez jedinej medzery', async () => {
    const reading = await buildStatusSnapshot(healthySources());

    expect(reading.unreadable).toEqual([]);
    expect(reading.now).toEqual(NOW);
    expect(reading.snapshot.writes?.enabled).toBe(true);
    expect(reading.snapshot.apiKey?.present).toBe(true);
    expect(reading.snapshot.apiKey?.expiresAt).toEqual(KEY_EXPIRES);
    expect(reading.snapshot.writeBudget).toEqual({ budget: 200, spent: 40, day: '2026-08-12' });
    expect(reading.snapshot.scope).toEqual({ mode: 'plny', maxProducts: 500, failClosed: false });
    expect(reading.snapshot.catalog?.loadedProducts).toBe(41_082);
    expect(reading.snapshot.catalog?.shopTotalProducts).toBe(41_082);
    expect(reading.effectiveMaxProducts).toBe(500);
    expect(reading.writeLock?.writesLocked).toBe(false);
    expect(reading.snapshot.catalogReads).toEqual({ usedThisMinute: 0, usedThisUtcDay: 12 });
  });

  /**
   * Odhad dočítania katalógu počíta `catalogRepo.syncStatus()` — pozná pokrok
   * prechodu, nie len počty riadkov. Snapshot ho preto musí PRENIESŤ, inak si ho
   * `blockers.ts` dopočíta z hrubších vstupov a v jednom paneli stoja dve čísla
   * o tej istej veci.
   */
  it('prenesie odhad dočítania od servera, nedopočítava druhý', async () => {
    const finish = new Date('2026-08-14T00:00:00.000Z');
    const reading = await buildStatusSnapshot(
      healthySources({
        catalog: {
          read: async () => ({
            loadedProducts: 12_000,
            shopTotalProducts: 40_483,
            lastFetchedAt: LAST_FETCH,
            estimatedDaysLeft: 2,
            estimatedFinishAt: finish,
          }),
        },
      }),
    );

    expect(reading.snapshot.catalog?.estimatedDaysLeft).toBe(2);
    expect(reading.snapshot.catalog?.estimatedFinishAt).toEqual(finish);

    // A prekážka z toho vyrobí vetu aj čas, nie vlastný odhad.
    const blocker = collectOperationBlockers(reading.snapshot).find(
      (row) => row.id === 'catalog_incomplete',
    );
    // Odhad sa 24. 8. 2026 presunul z popisu stavu do ďalšieho kroku (tempo
    // čítania bolo technika, P6) — číslo je stále SERVEROVO, nie dopočítané.
    // Odhad ako FAKT: „približne" (P7 — odhad sa nevydáva za meranie), počet
    // dní a to, že je to číslo zo SERVERA. Väzba „približne za 2 dni" by padla
    // pri každom skrátení vety, hoci údaj v nej zostal.
    expect(blocker?.nextStep).toContain('približne');
    expect(blocker?.nextStep).toMatch(/\d+ (deň|dni|dní)/);
    expect(nesieCislo(blocker?.nextStep ?? '', 2), 'odhad nenesie serverové 2 dni').toBe(true);
    expect(blocker?.what).not.toContain('približne');
    expect(blocker?.clearsAt).toEqual(finish);
  });

  it('bez merača čítaní sa sekcia catalogReads NEPOSIELA (je opt-in)', async () => {
    const sources = healthySources();
    delete (sources as { catalogReads?: unknown }).catalogReads;

    const reading = await buildStatusSnapshot(sources);
    expect(reading.snapshot.catalogReads).toBeUndefined();
    // Opt-in znamená mlčať, nie hlásiť medzeru — čítania zápisu nebránia.
    expect(reading.unreadable).not.toContain('catalogReads');
    expect(toStatusPayload(reading).catalogReads).toBeNull();
  });

  it('denný strop berie z už prečítaných nastavení, nečíta settings druhýkrát', async () => {
    const seen: number[] = [];
    await buildStatusSnapshot(
      healthySources({
        writeBudget: {
          remainingToday: async (dailyBudget) => {
            seen.push(dailyBudget);
            return {
              day: '2026-08-12',
              budget: dailyBudget,
              spent: 0,
              remaining: dailyBudget,
              exhausted: false,
            };
          },
        },
      }),
    );
    expect(seen).toEqual([200]);
  });

  it('fail-closed rozsah sa NEVYDÁVA za prečítané nastavenie', async () => {
    const reading = await buildStatusSnapshot(
      healthySources({
        settings: {
          readScope: async () => ({
            mode: 'pilot',
            maxProductsPerCampaign: 10,
            dailyWriteBudget: 1,
            failClosed: true,
          }),
        },
      }),
    );

    expect(reading.unreadable).toContain('scope');
    expect(reading.snapshot.scope).toEqual({ mode: null, maxProducts: null, failClosed: true });
    // Bez známeho stropu sa rozpočet nečíta vôbec — vymyslený strop by bol horší
    // než priznané „neviem".
    expect(reading.unreadable).toContain('writeBudget');
    expect(reading.snapshot.writeBudget).toBeUndefined();
  });

  it('nečitateľný katalóg sekciu VYNECHÁ, nehlási nulu', async () => {
    const reading = await buildStatusSnapshot(
      healthySources({
        catalog: { read: boom },
      }),
    );

    expect(reading.unreadable).toContain('catalog');
    expect(reading.snapshot.catalog).toBeUndefined();
  });

  it('prázdny výber znamená overene prázdnu množinu chýbajúcich produktov', async () => {
    const reading = await buildStatusSnapshot(healthySources());
    expect(reading.snapshot.catalog?.missingProductIds).toEqual([]);
    // …a v režime `plny` preto nevzniká fail-closed `catalog_unknown`.
    const ids = collectOperationBlockers(reading.snapshot).map((blocker) => blocker.id);
    expect(ids).not.toContain('catalog_unknown');
  });

  it('žiadne zlyhanie zdroja nezhodí staviteľa a každé je priznané', async () => {
    const cases: ReadonlyArray<{ patch: Partial<StatusSources>; section: StatusSection }> = [
      { patch: { writesEnabled: boom }, section: 'writes' },
      {
        patch: {
          settings: {
            readScope: async () => ({
              mode: 'plny',
              maxProductsPerCampaign: 500,
              dailyWriteBudget: 200,
              failClosed: false,
            }),
            readWriteLock: boom,
          },
        },
        section: 'writes',
      },
      { patch: { settings: { readScope: boom } }, section: 'scope' },
      { patch: { apiKey: { getMeta: boom } }, section: 'apiKey' },
      { patch: { writeBudget: { remainingToday: boom } }, section: 'writeBudget' },
      {
        patch: { catalog: { read: boom } },
        section: 'catalog',
      },
      { patch: { catalogReads: boom }, section: 'catalogReads' },
    ];

    for (const testCase of cases) {
      const reading = await buildStatusSnapshot(healthySources(testCase.patch));
      expect(reading.unreadable, testCase.section).toContain(testCase.section);
    }
  });

  it('úplne rozbité zdroje dajú prázdny obraz, nie výnimku a nie „všetko OK"', async () => {
    const reading = await buildStatusSnapshot({
      writesEnabled: boom,
      settings: { readScope: boom, readWriteLock: boom },
      apiKey: { getMeta: boom },
      writeBudget: { remainingToday: boom },
      catalog: { read: boom },
      catalogReads: boom,
      now: () => NOW,
    });

    expect(new Set(reading.unreadable)).toEqual(
      new Set<StatusSection>(['writes', 'scope', 'apiKey', 'writeBudget', 'catalog', 'catalogReads']),
    );
    expect(reading.snapshot.writes?.enabled).toBeNull();
    expect(reading.snapshot.apiKey?.present).toBeNull();
    expect(reading.effectiveMaxProducts).toBeNull();

    const payload = toStatusPayload(reading);
    expect(payload.summary.blocked).toBe(true);
    expect(payload.summary.anyAssumed).toBe(true);
  });
});

describe('effectiveMaxProducts — rovnaké pravidlo ako settings.effectiveMaxProducts()', () => {
  it('v pilote je strop vždy 10, uložená hodnota sa ignoruje', () => {
    expect(
      effectiveMaxProducts({
        mode: 'pilot',
        maxProductsPerCampaign: 5_000,
        dailyWriteBudget: 200,
        failClosed: false,
      }),
    ).toBe(10);
  });

  it('v plnom režime sa uložený strop zastropuje tvrdým DB stropom', () => {
    expect(
      effectiveMaxProducts({
        mode: 'plny',
        maxProductsPerCampaign: 99_999,
        dailyWriteBudget: 200,
        failClosed: false,
      }),
    ).toBe(10_000);
  });

  it('fail-closed rozsah spadne na pilotný strop', () => {
    expect(
      effectiveMaxProducts({
        mode: 'plny',
        maxProductsPerCampaign: 500,
        dailyWriteBudget: 1,
        failClosed: true,
      }),
    ).toBe(10);
  });
});

/* ══════════════════════════ 3. Tvar odpovede ══════════════════════════════ */

describe('toStatusPayload — tvar, ktorý konzumuje UI', () => {
  it('prekážky sú tie isté, aké dá collectOperationBlockers nad snapshotom', async () => {
    const reading = await buildStatusSnapshot(
      healthySources({
        writesEnabled: () => false,
        catalog: {
          read: async () => ({
            loadedProducts: 2_900,
            shopTotalProducts: 41_082,
            lastFetchedAt: LAST_FETCH,
          }),
        },
      }),
    );
    const payload = toStatusPayload(reading);
    const direct = collectOperationBlockers(reading.snapshot);

    expect(payload.blockers.map((blocker) => blocker.id)).toEqual(direct.map((b) => b.id));
    expect(payload.blockers.map((blocker) => blocker.what)).toEqual(direct.map((b) => b.what));
    expect(payload.summary.worstBlockerId).toBe('writes_disabled');
    expect(payload.summary.blocked).toBe(true);
  });

  it('časy sú ISO reťazce a `clearsAt` prežije cestu tam aj späť', async () => {
    const reading = await buildStatusSnapshot(
      healthySources({ writeBudget: { remainingToday: boom } }),
    );
    const payload = toStatusPayload(reading);

    expect(payload.now).toBe(NOW.toISOString());
    expect(payload.apiKey.expiresAt).toBe(KEY_EXPIRES.toISOString());
    expect(payload.catalog?.lastFetchedAt).toBe(LAST_FETCH.toISOString());

    const exhausted = payload.blockers.find((b) => b.id === 'write_budget_exhausted');
    expect(exhausted?.clearsAt).toBe('2026-08-13T00:00:00.000Z');
    expect(blockerFromWire(exhausted!).clearsAt).toEqual(new Date('2026-08-13T00:00:00.000Z'));
  });

  it('celé telo je serializovateľné bez straty (žiadne Date, žiadne undefined)', async () => {
    const payload = await readStatusPayload(healthySources());
    const roundTrip = JSON.parse(JSON.stringify(payload)) as StatusPayload;
    expect(roundTrip).toEqual(payload);
  });

  it('payload NENESIE missingProductIds — inak by si ich obrazovka prilepila k výberu', async () => {
    const payload = await readStatusPayload(healthySources());
    expect(JSON.stringify(payload)).not.toContain('missingProductIds');
  });

  it('rozpočet dopočíta zvyšok a vyčerpanie z rovnakých dvoch čísel', async () => {
    const payload = await readStatusPayload(
      healthySources({
        writeBudget: {
          remainingToday: async () => ({
            day: '2026-08-12',
            budget: 200,
            spent: 200,
            remaining: 0,
            exhausted: true,
          }),
        },
      }),
    );
    expect(payload.writeBudget).toEqual({
      day: '2026-08-12',
      budget: 200,
      spent: 200,
      remaining: 0,
      exhausted: true,
    });
  });
});

/* ═══════════ 4. Späť do snapshotu — obrazovka s vlastným výberom ══════════ */

describe('statusSnapshotFromPayload — prepočet prekážok nad vlastným výberom', () => {
  it('bez overlay dá presne ten istý zoznam prekážok ako server', async () => {
    const reading = await buildStatusSnapshot(healthySources({ writesEnabled: () => false }));
    const payload = toStatusPayload(reading);

    const rebuilt = statusSnapshotFromPayload(payload);
    expect(collectOperationBlockers(rebuilt).map((b) => b.id)).toEqual(
      payload.blockers.map((b) => b.id),
    );
  });

  it('výber nad pilotným stropom vyrobí blokujúcu prekážku rozsahu s číslami', async () => {
    const payload = await readStatusPayload(
      healthySources({
        settings: {
          readScope: async () => ({
            mode: 'pilot',
            maxProductsPerCampaign: 10,
            dailyWriteBudget: 200,
            failClosed: false,
          }),
        },
      }),
    );

    const snapshot = statusSnapshotFromPayload(payload, { selection: { selectedCount: 150 } });
    const scopeBlocker = collectOperationBlockers(snapshot).find(
      (blocker) => blocker.id === 'scope_pilot_cap',
    );

    expect(scopeBlocker?.severity).toBe('blokuje');
    expect(scopeBlocker?.resolution).toBe('sudo');
    expect(scopeBlocker?.what).toContain('150');
    expect(scopeBlocker?.assumed).toBe(false);
  });

  it('výber BEZ overených ID nesmie zdediť prázdnu množinu chýbajúcich produktov', async () => {
    const payload = await readStatusPayload(healthySources());

    const withSelection = statusSnapshotFromPayload(payload, {
      selection: { selectedCount: 150 },
    });
    expect(withSelection.catalog?.missingProductIds).toBeNull();

    const ids = collectOperationBlockers(withSelection).map((blocker) => blocker.id);
    // Fail-closed: neoverené NIE JE to isté ako overene v poriadku.
    expect(ids).toContain('catalog_unknown');
  });

  it('overený výber sa prijme presne tak, ako ho volajúci doložil', async () => {
    const payload = await readStatusPayload(healthySources());

    const verified = statusSnapshotFromPayload(payload, {
      selection: { productIds: [11, 22, 33] },
      missingProductIds: [22],
    });
    const missing = collectOperationBlockers(verified).find(
      (blocker) => blocker.id === 'catalog_product_missing',
    );

    expect(missing?.productIds).toEqual([22]);
    expect(missing?.what).toContain('22');
  });
});

/* ═══════════════ 5. Route: skutočná pipeline vrátane redakcie ═════════════ */

const ORIGIN = 'https://zlavy.local';

function claims(): SessionClaims {
  return {
    sub: 7,
    username: 'admin',
    absoluteExpiresAt: new Date(NOW.getTime() + 8 * 3_600_000),
    idleExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
    sudoUntil: null,
  };
}

/** Falošná session vrstva — route sa testuje celá, len bez prihlásenia. */
function sessionDeps(): RouteDeps {
  return {
    now: () => NOW,
    newRequestId: () => '01J0000000000000000000TEST',
    verifySession: async () => ({
      claims: claims(),
      refreshed: {
        token: 'refreshed-token',
        claims: claims(),
        cookie: {
          name: 'ovl_zliav_session' as const,
          value: 'refreshed-token',
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

async function callStatus(sources: StatusSources): Promise<{
  status: number;
  body: { ok: boolean; data: StatusPayload };
  raw: string;
}> {
  const handler = createStatusRoute({ sources, now: () => NOW, routeDeps: sessionDeps() });
  const response = await handler(
    new Request(`${ORIGIN}/api/status`, {
      method: 'GET',
      headers: { cookie: 'ovl_zliav_session=token', host: 'zlavy.local' },
    }),
  );
  const raw = await response.text();
  return { status: response.status, body: JSON.parse(raw), raw };
}

describe('GET /api/status — celá pipeline vrátane redaktora (I1)', () => {
  it('vráti 200 a obálku {ok:true,data}', async () => {
    const { status, body } = await callStatus(healthySources());
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.summary.blocked).toBe(false);
  });

  it('`apiKey` PREŽIJE redakciu — na tomto sa už raz popálil /api/health', async () => {
    const { body, raw } = await callStatus(healthySources());

    expect(raw).not.toContain(REDACTED);
    expect(body.data.apiKey.present).toBe(true);
    expect(body.data.apiKey.expiresAt).toBe(KEY_EXPIRES.toISOString());
  });

  it('objekt kľúča má PRESNE dve polia — tretie by zhodilo úzku výnimku redaktora', async () => {
    const { body } = await callStatus(healthySources());
    expect(Object.keys(body.data.apiKey).sort()).toEqual(['expiresAt', 'present']);
  });

  it('chýbajúci kľúč je „nie je vložený", nie zamaskovaný objekt', async () => {
    const { body } = await callStatus(
      healthySources({ apiKey: { getMeta: async () => ({ present: false, expiresAt: null }) } }),
    );

    expect(body.data.apiKey).toEqual({ present: false, expiresAt: null });
    expect(body.data.blockers.some((blocker) => blocker.id === 'key_missing')).toBe(true);
  });

  it('v tele sa neobjaví nič, čo pripomína kľúč (I1)', async () => {
    const { raw } = await callStatus(
      healthySources({
        settings: {
          readScope: async () => ({
            mode: 'plny',
            // Dôvod zámku je jediné voľné textové pole v odpovedi — ani cez
            // neho sa nesmie dať vypísať tajomstvo.
            maxProductsPerCampaign: 500,
            dailyWriteBudget: 200,
            failClosed: false,
          }),
          readWriteLock: async () => ({
            writesLocked: true,
            writesLockedReason: `api_key=${FAKE_KEY}`,
            writesLockedAt: NOW,
          }),
        },
      }),
    );

    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).toContain(REDACTED);
  });

  it('rozbité zdroje neurobia 500 — endpoint prizná medzery a povie prečo', async () => {
    const { status, body } = await callStatus({
      writesEnabled: boom,
      settings: { readScope: boom },
      apiKey: { getMeta: boom },
      writeBudget: { remainingToday: boom },
      catalog: { read: boom },
      now: () => NOW,
    });

    expect(status).toBe(200);
    expect(body.data.unreadable).toContain('scope');
    expect(body.data.summary.blocked).toBe(true);

    // Každá veta musí niesť konkrétny ďalší krok, nie „nastala chyba".
    for (const blocker of body.data.blockers) {
      expect(blocker.what.length).toBeGreaterThan(20);
      expect(blocker.nextStep.length).toBeGreaterThan(10);
      expect(blocker.what).not.toContain('undefined');
      expect(blocker.what).not.toContain('NaN');
    }
  });

  it('bez session vráti 401 a žiadne dáta o stave', async () => {
    const handler = createStatusRoute({
      sources: healthySources(),
      now: () => NOW,
      routeDeps: {
        now: () => NOW,
        verifySession: async () => {
          const error = new Error('Session chýba alebo je neplatná.');
          error.name = 'SessionError';
          (error as Error & { code: string }).code = 'missing';
          throw error;
        },
      },
    });
    const response = await handler(new Request(`${ORIGIN}/api/status`, { method: 'GET' }));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('scope');
  });

  it('odpoveď sa nikdy necachuje', async () => {
    const handler = createStatusRoute({
      sources: healthySources(),
      now: () => NOW,
      routeDeps: sessionDeps(),
    });
    const response = await handler(
      new Request(`${ORIGIN}/api/status`, {
        method: 'GET',
        headers: { cookie: 'ovl_zliav_session=token', host: 'zlavy.local' },
      }),
    );
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('id prekážok sú z uzavretej množiny — UI podľa nich páruje ikony', async () => {
    const { body } = await callStatus(healthySources({ writesEnabled: () => false }));
    const known: readonly BlockerId[] = [
      'writes_disabled',
      'key_missing',
      'key_expired',
      'key_expires_soon',
      'write_budget_exhausted',
      'write_budget_low',
      'scope_unknown',
      'scope_pilot_cap',
      'scope_full_cap',
      'catalog_unknown',
      'catalog_product_missing',
      'catalog_incomplete',
      'catalog_reads_day_exhausted',
      'catalog_reads_minute_exhausted',
    ];
    for (const blocker of body.data.blockers) {
      expect(known).toContain(blocker.id);
    }
  });
});

/* ══════════ 5. Odmietnuté čítanie objednávok (predajnosť, 24. 8. 2026) ═════ */

describe('salesSync — prekážka predajnosti prejde celou cestou na povrch', () => {
  const SINCE = new Date('2026-08-09T07:18:54.000Z');
  const PROBE = new Date('2026-08-31T06:58:08.000Z');

  it('bez zdroja je sekcia `null` a v `unreadable` sa neobjaví (opt-in)', async () => {
    const reading = await buildStatusSnapshot(healthySources());

    expect(toStatusPayload(reading).salesSync).toBeNull();
    expect(reading.unreadable).not.toContain('salesSync');
  });

  it('zablokovaná IP dorazí do payloadu aj s časmi v ISO', async () => {
    const reading = await buildStatusSnapshot(
      healthySources({
        salesSync: async () => ({ block: 'ip_ban', since: SINCE, probeAt: PROBE }),
      }),
    );
    const payload = toStatusPayload(reading);

    expect(payload.salesSync).toEqual({
      block: 'ip_ban',
      since: SINCE.toISOString(),
      probeAt: PROBE.toISOString(),
    });
    expect(payload.blockers.some((b) => b.id === 'sales_reads_ip_banned')).toBe(true);
  });

  it('payload sa vráti do snapshotu bez straty — obrazovka si prekážky prepočíta', () => {
    const payload: StatusPayload = {
      now: NOW.toISOString(),
      writes: { enabled: true, locked: false, lockedReason: null, lockedAt: null },
      apiKey: { present: true, expiresAt: null },
      writeBudget: null,
      scope: { mode: 'plny', maxProductsSetting: 500, maxProducts: 500, failClosed: false },
      catalog: null,
      catalogReads: null,
      salesSync: { block: 'permission', since: SINCE.toISOString(), probeAt: null },
      blockers: [],
      summary: {
        blocked: false,
        blockingCount: 0,
        worstBlockerId: null,
        waitUntil: null,
        anyAssumed: false,
      },
      unreadable: [],
    };

    const snapshot = statusSnapshotFromPayload(payload);

    expect(snapshot.salesSync?.block).toBe('permission');
    expect(snapshot.salesSync?.since?.toISOString()).toBe(SINCE.toISOString());
    expect(snapshot.salesSync?.probeAt).toBeNull();
    expect(
      collectOperationBlockers(snapshot).some((b) => b.id === 'sales_reads_forbidden'),
    ).toBe(true);
  });

  it('nečitateľný zdroj sa prizná, nie zamlčí', async () => {
    const reading = await buildStatusSnapshot(
      healthySources({
        salesSync: async () => {
          throw new Error('DB spadla');
        },
      }),
    );

    expect(reading.unreadable).toContain('salesSync');
    expect(toStatusPayload(reading).salesSync).toBeNull();
  });
});

describe('produkčné zapojenie — sekcia predajnosti naozaj visí na spúšťači', () => {
  it('zdroj existuje a bez behu tvrdí, že nič nestojí', async () => {
    // Bez tohto testu sa dá celá cesta odpojiť jedným zmazaným riadkom v route
    // a všetko ostatné zostane zelené.
    const source = productionStatusSources(() => NOW).salesSync;
    expect(source).toBeDefined();

    // Po štarte procesu spúšťač ešte nebežal — appka o prekážke nič netvrdí.
    expect(await source?.()).toEqual({ block: null, since: null, probeAt: null });
  });
});
