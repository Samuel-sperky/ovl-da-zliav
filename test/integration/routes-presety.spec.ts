/**
 * Aura Zľavy — integračné testy route-ov presetov
 * (KONTRAKT-V4-2026-08-28: D112, K7; `src/app/api/presets/**`).
 *
 * Route-y bežia celou `defineRoute()` pipeline (actor D102, rate limit, Origin
 * check D72, zod); dátová vrstva je in-memory náhrada `presets.repo.ts` s tými
 * istými chybami, aké hádže ostrý repozitár. Žiadna DB a žiadna sieť — schému
 * 0015 a SQL dokazuje `presety-zliav.spec.ts` nad reálnou MariaDB.
 *
 * Čo sa tu stráži:
 *  1. tvar odpovede (ISO časy, `lastUsedAt: null` = ešte nepoužitý — I11),
 *  2. fail-closed na neexistujúcom presete (404, nie tiché „ok"),
 *  3. odmietnutie mutácie s CUDZÍM a s chýbajúcim `Origin` (D72) — a to, že sa
 *     pri odmietnutí repozitára nikto nedotkol,
 *  4. **I3** — v celom priečinku `presets/` nesmie byť cesta, ktorá z presetu
 *     vyrobí zápis do shopu,
 *  5. **audit uloženia a zmazania** (I4, D102) — riadok vznikne, nesie lokálneho
 *     actora a jeho typ NIE JE neznámy; odmietnutá mutácia riadok nevyrobí.
 *     Použitie presetu sa neaudituje a je to tvrdenie, nie opomenutie,
 *  6. **`mark-used`** — `last_used_at` sa naozaj zapíše (do 31. 8. 2026 nemala
 *     `markUsed()` v `src/` ani jedného volajúceho, takže SQL radilo podľa
 *     stĺpca, ktorý bol vždy NULL).
 *
 * Vlastník: V4 (presety).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import type {
  AuditInput,
  AuditWriter,
  DiscountPreset,
  DiscountPresetTier,
  NewDiscountPreset,
} from '@/contracts';

import { isAuditEventType } from '@/lib/audit/events';
import { resetRateLimiter, type RouteDeps } from '@/lib/http/define-route';
import {
  MAX_PRESETS,
  PresetLimitError,
  PresetNameTakenError,
  PresetNotFoundError,
  type PresetsRepoContract,
} from '@/lib/repo/presets.repo';

import { createPresetsGet, createPresetsPost } from '@/app/api/presets/route';
import { createPresetDelete } from '@/app/api/presets/[presetId]/route';
import { createPresetMarkUsed } from '@/app/api/presets/[presetId]/mark-used/route';
import type { PresetsRouteDeps } from '@/app/api/presets/_shared';

/* ═════════════════════════════ pomôcky ════════════════════════════════════ */

const APP_ORIGIN = 'https://zlavy.local';
const NOW = new Date('2026-08-31T09:00:00.000Z');
const TEST_USER_ID = 1;

/**
 * Actor pre pipeline (D102). Appka prihlásenie nemá (D99), ale mutácia bez
 * actora neprejde — FK `audit_log.user_id`/`campaigns.created_by`.
 */
function routeDeps(): RouteDeps {
  return {
    now: () => NOW,
    localActor: async () => ({ id: TEST_USER_ID, username: 'samuel' }),
  };
}

function makeRequest(
  method: string,
  path: string,
  body?: unknown,
  opts: { origin?: string | null } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
  if (origin !== null && method !== 'GET') headers.origin = origin;
  return new Request(`${APP_ORIGIN}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

interface ParsedResponse {
  status: number;
  body: { ok: boolean; data?: unknown; error?: { code: string; message: string } };
}

async function parse(response: Response): Promise<ParsedResponse> {
  return { status: response.status, body: (await response.json()) as ParsedResponse['body'] };
}

/* ═══════════════════ in-memory náhrada `presets.repo.ts` ══════════════════ */

interface FakeRepo extends PresetsRepoContract {
  /** Koľkokrát sa route naozaj dotkla úložiska (dôkaz pri odmietnutých mutáciách). */
  calls: { create: number; remove: number; list: number; markUsed: number };
  seed(preset: DiscountPreset): void;
}

function makeRepo(): FakeRepo {
  const rows = new Map<number, DiscountPreset>();
  let nextId = 1;
  const calls = { create: 0, remove: 0, list: 0, markUsed: 0 };

  const byName = (name: string): DiscountPreset | null => {
    for (const row of rows.values()) if (row.name === name) return row;
    return null;
  };

  const repo: FakeRepo = {
    calls,
    seed(preset: DiscountPreset): void {
      rows.set(preset.id, preset);
      nextId = Math.max(nextId, preset.id + 1);
    },
    async create(input: NewDiscountPreset): Promise<DiscountPreset> {
      calls.create += 1;
      if (rows.size >= MAX_PRESETS) throw new PresetLimitError(MAX_PRESETS);
      if (byName(input.name) !== null) throw new PresetNameTakenError(input.name);
      const preset: DiscountPreset = {
        id: nextId,
        name: input.name,
        filterQuery: input.filterQuery,
        tiers: input.tiers,
        durationDays: input.durationDays,
        createdAt: NOW,
        lastUsedAt: null,
      };
      nextId += 1;
      rows.set(preset.id, preset);
      return preset;
    },
    async list(): Promise<DiscountPreset[]> {
      calls.list += 1;
      // Poradie určuje SQL v repozitári; tu ho vraciame v poradí vloženia,
      // aby sa dalo dokázať, že route nepreradzuje.
      return [...rows.values()];
    },
    async getById(id: number): Promise<DiscountPreset | null> {
      return rows.get(id) ?? null;
    },
    async getByName(name: string): Promise<DiscountPreset | null> {
      return byName(name);
    },
    async count(): Promise<number> {
      return rows.size;
    },
    async markUsed(id: number, at: Date): Promise<void> {
      calls.markUsed += 1;
      const existing = rows.get(id);
      if (existing === undefined) throw new PresetNotFoundError(id);
      rows.set(id, { ...existing, lastUsedAt: at });
    },
    async remove(id: number): Promise<void> {
      calls.remove += 1;
      if (!rows.has(id)) throw new PresetNotFoundError(id);
      rows.delete(id);
    },
  };
  return repo;
}

function tier(ord: number, percent: number, label = `Pásmo ${ord}`): DiscountPresetTier {
  return { ord, label, percent };
}

function seeded(
  id: number,
  name: string,
  overrides: Partial<DiscountPreset> = {},
): DiscountPreset {
  return {
    id,
    name,
    filterQuery: 'hasDiscount=0&supplier=Zlatnictvo',
    tiers: [tier(1, 20)],
    durationDays: 7,
    createdAt: new Date('2026-08-20T10:00:00.000Z'),
    lastUsedAt: null,
    ...overrides,
  };
}

/**
 * Audit ako v produkcii — s tým rozdielom, že riadky zostanú v pamäti.
 *
 * `appendAudit()` v ostrom kóde NIKDY nehodí (zlyhanie len zaloguje), takže
 * tento dvojník tiež nehádže: keby hádzal, test by dokazoval niečo, čo sa
 * v produkcii nestane.
 */
interface FakeAudit extends AuditWriter {
  rows: AuditInput[];
}

function makeAudit(): FakeAudit {
  const rows: AuditInput[] = [];
  return {
    rows,
    async appendAudit(input: AuditInput): Promise<void> {
      rows.push(input);
    },
  };
}

function world(): { repo: FakeRepo; audit: FakeAudit; deps: PresetsRouteDeps } {
  const repo = makeRepo();
  const audit = makeAudit();
  return { repo, audit, deps: { presetsRepo: repo, audit, now: () => NOW } };
}

const validBody = {
  name: 'Ležiaky −20 %',
  filterQuery: 'hasDiscount=0&soldWindow=0',
  tiers: [tier(1, 20), tier(2, 10)],
  durationDays: 14,
};

beforeEach(() => {
  resetRateLimiter();
});

/* ═══════════════════════════ 1. GET — zoznam ══════════════════════════════ */

describe('GET /api/presets', () => {
  it('vráti zoznam v tvare kontraktu: ISO časy a `lastUsedAt: null` je „ešte nepoužitý" (I11)', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(1, 'Nepoužitý'));
    repo.seed(
      seeded(2, 'Použitý', {
        lastUsedAt: new Date('2026-08-29T18:30:00.000Z'),
        tiers: [{ ord: 1, label: 'Bez predaja', percent: 30, rule: { soldWindow: 0 } }],
      }),
    );

    const res = await parse(await createPresetsGet(deps, routeDeps())(makeRequest('GET', '/api/presets')));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toEqual([
      {
        id: 1,
        name: 'Nepoužitý',
        filterQuery: 'hasDiscount=0&supplier=Zlatnictvo',
        tiers: [{ ord: 1, label: 'Pásmo 1', percent: 20 }],
        durationDays: 7,
        createdAt: '2026-08-20T10:00:00.000Z',
        // NIE epocha a NIE `createdAt` — pomlčku si domyslí UI (I11).
        lastUsedAt: null,
      },
      {
        id: 2,
        name: 'Použitý',
        filterQuery: 'hasDiscount=0&supplier=Zlatnictvo',
        tiers: [{ ord: 1, label: 'Bez predaja', percent: 30, rule: { soldWindow: 0 } }],
        durationDays: 7,
        createdAt: '2026-08-20T10:00:00.000Z',
        lastUsedAt: '2026-08-29T18:30:00.000Z',
      },
    ]);
  });

  it('prázdny zoznam je prázdne pole, nie chyba a nie „nevieme"', async () => {
    const { deps } = world();
    const res = await parse(await createPresetsGet(deps, routeDeps())(makeRequest('GET', '/api/presets')));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('route poradie z repozitára NEPRERADZUJE — triedenie je vec SQL', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(7, 'Tretí'));
    repo.seed(seeded(3, 'Prvý'));
    repo.seed(seeded(5, 'Druhý'));

    const res = await parse(await createPresetsGet(deps, routeDeps())(makeRequest('GET', '/api/presets')));
    expect((res.body.data as { id: number }[]).map((row) => row.id)).toEqual([7, 3, 5]);
    expect(repo.calls.list).toBe(1);
  });
});

/* ═══════════════════════════ 2. POST — vytvorenie ═════════════════════════ */

describe('POST /api/presets', () => {
  it('uloží preset a vráti ho v tom istom tvare ako zoznam', async () => {
    const { repo, deps } = world();
    const res = await parse(
      await createPresetsPost(deps, routeDeps())(makeRequest('POST', '/api/presets', validBody)),
    );

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      id: 1,
      name: 'Ležiaky −20 %',
      filterQuery: 'hasDiscount=0&soldWindow=0',
      tiers: [
        { ord: 1, label: 'Pásmo 1', percent: 20 },
        { ord: 2, label: 'Pásmo 2', percent: 10 },
      ],
      durationDays: 14,
      createdAt: NOW.toISOString(),
      lastUsedAt: null,
    });
    expect(await repo.count()).toBe(1);
  });

  it('`itemsCount` sa do presetu NEDOSTANE ani keď ho klient pošle (I11)', async () => {
    const { repo, deps } = world();
    const res = await parse(
      await createPresetsPost(deps, routeDeps())(
        makeRequest('POST', '/api/presets', {
          ...validBody,
          tiers: [{ ord: 1, label: 'Pásmo 1', percent: 20, itemsCount: 1234 }],
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect((res.body.data as { tiers: unknown[] }).tiers).toEqual([
      { ord: 1, label: 'Pásmo 1', percent: 20 },
    ]);
    const stored = await repo.getById(1);
    expect(stored === null ? null : stored.tiers).toEqual([
      { ord: 1, label: 'Pásmo 1', percent: 20 },
    ]);
  });

  const badBodies: [string, Record<string, unknown>][] = [
    ['percento 31 (I9)', { tiers: [tier(1, 31)] }],
    ['percento 0 (I9)', { tiers: [tier(1, 0)] }],
    ['percento s desatinami', { tiers: [tier(1, 10.5)] }],
    ['žiadne pásmo', { tiers: [] }],
    ['prázdne meno', { name: '   ' }],
    ['dĺžka okna 0', { durationDays: 0 }],
    ['dĺžka okna 91 (I9, D29)', { durationDays: 91 }],
    ['dĺžka okna v pol dni', { durationDays: 7.5 }],
  ];

  it.each(badBodies)('%s je 400 na zode, nie 500 z repozitára — a nič sa neuloží', async (_name, patch) => {
    const { repo, deps } = world();
    const res = await parse(
      await createPresetsPost(deps, routeDeps())(
        makeRequest('POST', '/api/presets', { ...validBody, ...patch }),
      ),
    );

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('validation_failed');
    // Dôkaz, že brána je zod: repozitár sa nezavolal ANI RAZ.
    expect(repo.calls.create).toBe(0);
  });

  it('duplicitné meno je 409 `preset_name_taken` a pôvodný preset zostane', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(1, validBody.name, { durationDays: 3 }));

    const res = await parse(
      await createPresetsPost(deps, routeDeps())(makeRequest('POST', '/api/presets', validBody)),
    );

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('preset_name_taken');
    const kept = await repo.getById(1);
    expect(kept === null ? null : kept.durationDays).toBe(3);
    expect(await repo.count()).toBe(1);
  });

  it('nad stropom je 409 `preset_limit`, nie 500', async () => {
    const { repo, deps } = world();
    for (let i = 1; i <= MAX_PRESETS; i += 1) repo.seed(seeded(i, `Preset ${i}`));

    const res = await parse(
      await createPresetsPost(deps, routeDeps())(makeRequest('POST', '/api/presets', validBody)),
    );

    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('preset_limit');
    expect(await repo.count()).toBe(MAX_PRESETS);
  });

  it('GET na túto cestu nie je zápis: `POST` handler odmietne inú metódu (405)', async () => {
    const { repo, deps } = world();
    const res = await parse(
      await createPresetsPost(deps, routeDeps())(makeRequest('DELETE', '/api/presets')),
    );
    expect(res.status).toBe(405);
    expect(repo.calls.create).toBe(0);
  });
});

/* ═══════════════════════ 3. DELETE — fail-closed ══════════════════════════ */

describe('DELETE /api/presets/[presetId]', () => {
  const del = (deps: PresetsRouteDeps, id: string, opts: { origin?: string | null } = {}) =>
    createPresetDelete(deps, routeDeps())(
      makeRequest('DELETE', `/api/presets/${id}`, undefined, opts),
      { params: Promise.resolve({ presetId: id }) },
    );

  it('zmaže existujúci preset a povie ktorý', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(4, 'Na zmazanie'));

    const res = await parse(await del(deps, '4'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ deleted: true, presetId: 4 });
    expect(await repo.getById(4)).toBeNull();
  });

  it('neexistujúci preset je 404 `preset_not_found` — NIKDY tiché „ok" (fail-closed)', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(4, 'Ostáva'));

    const res = await parse(await del(deps, '99'));

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('preset_not_found');
    expect(res.body.ok).toBe(false);
    // Route sa NAOZAJ pokúsila mazať (chyba nie je z pipeline, ale z úložiska).
    expect(repo.calls.remove).toBe(1);
    // A nič iné sa nezmazalo.
    expect(await repo.count()).toBe(1);
  });

  it('nezmyselné ID (0, text, záporné) padne na zode a úložiska sa nedotkne', async () => {
    const { repo, deps } = world();
    for (const id of ['0', '-3', 'abc']) {
      const res = await parse(await del(deps, id));
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('validation_failed');
    }
    expect(repo.calls.remove).toBe(0);
  });
});

/* ═════════ 3b. POST mark-used — „naposledy predplnil formulár" ════════════ */

describe('POST /api/presets/[presetId]/mark-used', () => {
  const use = (deps: PresetsRouteDeps, id: string, opts: { origin?: string | null } = {}) =>
    createPresetMarkUsed(deps, routeDeps())(
      makeRequest('POST', `/api/presets/${id}/mark-used`, undefined, opts),
      { params: Promise.resolve({ presetId: id }) },
    );

  it('zapíše čas použitia a vráti presne ten, ktorý zapísal (I11)', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(4, 'Ležiaky'));

    const res = await parse(await use(deps, '4'));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ presetId: 4, lastUsedAt: NOW.toISOString() });
    expect(repo.calls.markUsed).toBe(1);
    // Čas je NAOZAJ v úložisku, nie len v odpovedi.
    expect((await repo.getById(4))?.lastUsedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('po zápise ide preset v zozname pred nepoužité — sľub `SQL_LIST` má krytie', async () => {
    /*
     * Poradie určuje SQL (dokazuje ho `presety-zliav.spec.ts` nad MariaDB);
     * TU sa dokazuje to, čo bolo do 31. 8. 2026 rozbité: že `last_used_at`
     * vôbec NIEKTO zapíše. Bez volajúceho zostával NULL, takže SQL radilo
     * podľa stĺpca, ktorý bol vždy prázdny, a dvadsaťkrát použitý preset sa
     * hlásil ako nepoužitý (D112).
     */
    const { repo, deps } = world();
    repo.seed(seeded(1, 'Prvý'));
    repo.seed(seeded(2, 'Druhý'));

    await parse(await use(deps, '2'));

    const rows = await repo.list();
    const used = rows.filter((row) => row.lastUsedAt !== null).map((row) => row.id);
    expect(used).toEqual([2]);
  });

  it('neexistujúci preset je 404 `preset_not_found`, nie tiché „ok" (fail-closed)', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(4, 'Ostáva'));

    const res = await parse(await use(deps, '99'));

    expect(res.status).toBe(404);
    expect(res.body.error?.code).toBe('preset_not_found');
    expect(repo.calls.markUsed).toBe(1);
    expect((await repo.getById(4))?.lastUsedAt).toBeNull();
  });

  it('s CUDZÍM Origin je 403 a úložiska sa nedotkne (D72)', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(4, 'Ležiaky'));

    const res = await parse(await use(deps, '4', { origin: 'https://zly.example' }));

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('origin_mismatch');
    expect(repo.calls.markUsed).toBe(0);
  });

  it('použitie presetu sa NEAUDITUJE — je to rozhodnutie, nie zabudnuté miesto', async () => {
    /*
     * `last_used_at` je sám záznamom o použití: nesie čas, je vidieť v paneli
     * presetov a nedá sa ním nič uvoľniť. História je forenzný záznam o
     * zápisoch do PRODUKČNÉHO eshopu a nikdy sa nemaže (I4, D75) — riadok za
     * každé predplnenie formulára by v nej utopil `write_*`. Zdôvodnenie je aj
     * v hlavičke route, aby si to o mesiac nikto nevysvetlil ako dieru.
     */
    const { repo, audit, deps } = world();
    repo.seed(seeded(4, 'Ležiaky'));

    await parse(await use(deps, '4'));

    expect(audit.rows).toEqual([]);
  });
});

/* ══════════════════════ 4. Origin check na mutáciách (D72) ════════════════ */

describe('mutácie dedia Origin check (D72)', () => {
  it('POST s CUDZÍM Origin je 403 `origin_mismatch` a preset nevznikne', async () => {
    const { repo, deps } = world();
    const res = await parse(
      await createPresetsPost(deps, routeDeps())(
        makeRequest('POST', '/api/presets', validBody, { origin: 'https://zly.example' }),
      ),
    );

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('origin_mismatch');
    expect(repo.calls.create).toBe(0);
    expect(await repo.count()).toBe(0);
  });

  it('POST bez hlavičky Origin je 403 `origin_missing`', async () => {
    const { repo, deps } = world();
    const res = await parse(
      await createPresetsPost(deps, routeDeps())(
        makeRequest('POST', '/api/presets', validBody, { origin: null }),
      ),
    );

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('origin_missing');
    expect(repo.calls.create).toBe(0);
  });

  it('DELETE s cudzím Origin je 403 a preset ZOSTANE', async () => {
    const { repo, deps } = world();
    repo.seed(seeded(4, 'Nezmazať'));

    const res = await parse(
      await createPresetDelete(deps, routeDeps())(
        makeRequest('DELETE', '/api/presets/4', undefined, { origin: 'https://zly.example' }),
        { params: Promise.resolve({ presetId: '4' }) },
      ),
    );

    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('origin_mismatch');
    expect(repo.calls.remove).toBe(0);
    expect(await repo.getById(4)).not.toBeNull();
  });

  it('GET Origin nepotrebuje — čítanie nie je mutácia', async () => {
    const { deps } = world();
    const res = await parse(
      await createPresetsGet(deps, routeDeps())(
        makeRequest('GET', '/api/presets', undefined, { origin: null }),
      ),
    );
    expect(res.status).toBe(200);
  });
});

/* ═════════════ 5. I3 — z presetu NEVEDIE cesta do shopu ══════════════════ */

describe('I3 — presety nezaložili druhú zápisovú cestu', () => {
  const dir = fileURLToPath(new URL('../../src/app/api/presets/', import.meta.url));

  const sources = (): { file: string; text: string }[] => {
    const out: { file: string; text: string }[] = [];
    const walk = (rel: string): void => {
      for (const entry of readdirSync(`${dir}${rel}`, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(`${rel}${entry.name}/`);
        else out.push({ file: `${rel}${entry.name}`, text: readFileSync(`${dir}${rel}${entry.name}`, 'utf8') });
      }
    };
    walk('');
    return out;
  };

  it('sanity — zdroje sa naozaj čítajú', () => {
    const files = sources();
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const source of files) expect(source.text.length).toBeGreaterThan(500);
  });

  it('priečinok obsahuje LEN zoznam, vytvorenie, zmazanie a mark-used — žiadne „spusti preset"', () => {
    /*
     * Zoznam je ÚPLNÝ naschvál: nová route v tomto priečinku má byť vedomé
     * rozhodnutie. `[presetId]/mark-used/route.ts` pribudol 31. 8. 2026 a je
     * to protipól „spusti preset" — zapíše JEDEN časový údaj do lokálneho
     * `last_used_at`, nevracia z presetu nič a nedotýka sa kampaní. Ostatné
     * tvrdenia tohto describe naň platia rovnako ako na zvyšok priečinku
     * (walk() ho číta), takže tým, že je v zozname, nie je z ničoho vyňatý.
     */
    expect(sources().map((s) => s.file).sort()).toEqual([
      '[presetId]/mark-used/route.ts',
      '[presetId]/route.ts',
      '_shared.ts',
      'route.ts',
    ]);
  });

  it('mark-used nevracia obsah presetu — z jej odpovede sa nedá nič zapísať', () => {
    const markUsed = sources().find((s) => s.file === '[presetId]/mark-used/route.ts');
    expect(markUsed).toBeDefined();
    const text = markUsed?.text ?? '';
    // Jediné volanie úložiska je `markUsed()`; čítanie presetu tu nie je,
    // takže route nemá čo vrátiť ani keby chcela.
    const repoCalls = text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*'))
      .filter((line) => line.includes('d.presetsRepo.'));
    expect(repoCalls).toHaveLength(1);
    expect(repoCalls[0]).toContain('markUsed(');
  });

  it('žiadny súbor presetov nesiaha na shop, executor ani preview token', () => {
    // Preset smie formulár len PREDPLNIŤ. Dry-run a potvrdenie sa odohrajú
    // nanovo v `POST /api/campaigns`; keby tu pribudlo ktorékoľvek z týchto
    // mien, znamenalo by to druhú cestu k zápisu do PRODUKČNÉHO eshopu (I3).
    const forbidden = [
      'setReduction',
      'engine/executor',
      'previewTokens',
      'previewToken',
      'insertConfirmedCampaign',
      'shopClient',
      'campaignsRepo',
    ];
    for (const source of sources()) {
      for (const needle of forbidden) {
        // Zdôvodnenia v komentároch tie slová menujú, preto sa hľadá volanie
        // alebo import, nie výskyt v texte: riadok s `import` alebo s `(`.
        const hits = source.text
          .split('\n')
          .filter((line) => line.includes(needle) && !line.trimStart().startsWith('*'))
          .filter((line) => line.includes('import') || line.includes(`${needle}(`));
        expect(hits, `${source.file} → ${needle}`).toEqual([]);
      }
    }
  });

  it('mazanie presetu nemá `confirmed` — a je to zdôvodnené v zdroji, nie len tu', () => {
    const remove = sources().find((s) => s.file === '[presetId]/route.ts');
    expect(remove).toBeDefined();
    const text = remove?.text ?? '';
    // Zdôvodnenie musí v súbore byť; bez neho si to niekto vysvetlí ako dieru.
    expect(text).toContain('confirmed');
    expect(text).toContain('Nie je to zápis do shopu');
    /*
     * A skutočne tam žiadna brána `confirmed` NIE JE — slovo sa v súbore
     * vyskytuje len v komentároch, ktoré vysvetľujú, prečo tam nie je. Hľadá sa
     * teda výskyt MIMO komentára (riadok, ktorý nezačína `*` ani `//`).
     */
    const codeLines = text
      .split('\n')
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
      })
      .filter((line) => line.includes('confirmed'));
    expect(codeLines).toEqual([]);
  });
});

/* ═══════════ 6. Audit presetov (I4, D102) — dopojený 31. 8. 2026 ══════════ */

describe('audit presetov (I4, D102)', () => {
  it('typ udalosti pre presety EXISTUJE, takže sa riadok nezahodí ako neznámy', () => {
    /*
     * Toto je tvrdenie, ktoré chýbajúci typ usvedčí. `appendAudit()` neznámy
     * string nezahodí ticho — zaloguje ho ako `audit_unknown_event_type`
     * a zapíše ho do stĺpca, ktorý ho História nedokáže pomenovať. Zápis,
     * o ktorom si volajúci myslí, že je v audite, a v audite ho nikto neprečíta,
     * je horší než priznaná medzera (I11). Do 31. 8. 2026 tu bolo `false`.
     */
    expect(isAuditEventType('preset_created')).toBe(true);
    expect(isAuditEventType('preset_deleted')).toBe(true);
  });

  it('uloženie presetu zapíše `preset_created` s lokálnym actorom (D102)', async () => {
    const { audit, deps } = world();

    const res = await parse(
      await createPresetsPost(deps, routeDeps())(makeRequest('POST', '/api/presets', validBody)),
    );
    expect(res.status).toBe(200);

    expect(audit.rows).toHaveLength(1);
    const row = audit.rows[0]!;
    expect(row.eventType).toBe('preset_created');
    expect(isAuditEventType(row.eventType)).toBe(true);
    expect(row.actor).toBe('user');
    expect(row.userId).toBe(TEST_USER_ID);
    expect(row.ok).toBe(true);
    expect(row.message).toContain('Ležiaky −20 %');
    // Snapshot nesie PERCENTÁ — to je jediné miesto, kde po zmazaní presetu
    // zostane, čo v ňom bolo.
    expect(row.afterSnapshot).toMatchObject({
      name: 'Ležiaky −20 %',
      durationDays: 14,
      tiers: [
        { ord: 1, label: 'Pásmo 1', percent: 20 },
        { ord: 2, label: 'Pásmo 2', percent: 10 },
      ],
    });
  });

  it('zmazanie zapíše `preset_deleted` a v snapshote to, ČO zmizlo', async () => {
    const { repo, audit, deps } = world();
    repo.seed(
      seeded(4, 'Na zmazanie', { tiers: [{ ord: 1, label: 'Bez predaja', percent: 30 }] }),
    );

    const res = await parse(
      await createPresetDelete(deps, routeDeps())(
        makeRequest('DELETE', '/api/presets/4', undefined),
        { params: Promise.resolve({ presetId: '4' }) },
      ),
    );
    expect(res.status).toBe(200);

    expect(audit.rows).toHaveLength(1);
    const row = audit.rows[0]!;
    expect(row.eventType).toBe('preset_deleted');
    expect(isAuditEventType(row.eventType)).toBe(true);
    expect(row.actor).toBe('user');
    expect(row.userId).toBe(TEST_USER_ID);
    expect(row.message).toContain('Na zmazanie');
    expect(row.beforeSnapshot).toMatchObject({
      presetId: 4,
      name: 'Na zmazanie',
      tiers: [{ ord: 1, label: 'Bez predaja', percent: 30 }],
    });
  });

  it('odmietnutá mutácia auditný riadok NEVYROBÍ (nič sa nestalo)', async () => {
    const { repo, audit, deps } = world();
    repo.seed(seeded(4, 'Ostáva'));

    // 404 — mazanie neexistujúceho presetu.
    await parse(
      await createPresetDelete(deps, routeDeps())(
        makeRequest('DELETE', '/api/presets/99', undefined),
        { params: Promise.resolve({ presetId: '99' }) },
      ),
    );
    // 409 — obsadené meno.
    await parse(
      await createPresetsPost(deps, routeDeps())(
        makeRequest('POST', '/api/presets', { ...validBody, name: 'Ostáva' }),
      ),
    );

    expect(audit.rows).toEqual([]);
  });

  it('obe routy, ktoré menia zoznam presetov, audit NAOZAJ volajú', () => {
    /*
     * Strážca proti zabudnutému miestu: keby audit z ktorejkoľvek z týchto
     * dvoch ciest vypadol, testy vyššie by ho síce nezachytili len vtedy, keby
     * niekto zmenil aj ich — toto tvrdenie stojí v zdroji, nie v dvojníkovi.
     * `mark-used` tu ZÁMERNE nie je (viď describe 3b).
     */
    const dir = fileURLToPath(new URL('../../src/app/api/presets/', import.meta.url));
    for (const file of ['route.ts', '[presetId]/route.ts']) {
      const calls = readFileSync(`${dir}${file}`, 'utf8')
        .split('\n')
        .filter((line) => {
          const trimmed = line.trimStart();
          return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
        })
        .filter((line) => line.includes('appendAudit('));
      expect(calls, `${file} nezapisuje audit`).toHaveLength(1);
    }
  });
});
