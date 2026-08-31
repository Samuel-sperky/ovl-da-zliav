/**
 * Aura Zľavy — migrácia 0015 + `presets.repo.ts`: úložisko presetov zliav
 * (KONTRAKT-V4-2026-08-28: D112, K7).
 *
 * Prečo tento súbor beží proti REÁLNEJ MariaDB a nie nad pamäťou: celé
 * rozhodnutie D112 je „preset patrí do DB, nie do prehliadača" (rozbor je
 * v hlavičke 0015). Dôkazom o tom rozhodnutí je práve to, že tabuľka existuje,
 * že do nej smie písať APLIKAČNÝ user (D89) a že jej brzdy drží schéma —
 * nie tvrdenie v teste s fake spojením.
 *
 * Čo sa tu overuje:
 *  1. Migrácia prejde tým istým runnerom ako produkcia (`scripts/migrate.ts`)
 *     a OPAKOVANÝ beh je no-op, nie chyba (D88, A0).
 *  2. Schéma: UNIQUE na mene, CHECK na dĺžke okna, `last_used_at` NULLABLE
 *     bez defaultu (I11 — `NULL` je „ešte nepoužitý", nie epocha).
 *  3. CHECK naozaj ODMIETNE dĺžku okna mimo 1–90. `SHOW CREATE TABLE` dokazuje
 *     len text constraintu; dôkaz, že brzda drží, je odmietnutý zápis
 *     (K1 bod 3 — aplikačná validácia sama nikdy nestačila).
 *  4. Životný cyklus cez repozitár APLIKAČNÝM userom: vytvorenie, zoznam,
 *     zmena, použitie, zmazanie.
 *  5. Strop {@link MAX_PRESETS} — 21. preset sa neuloží a zoznam zostane celý.
 *  6. Duplicitné meno sa ODMIETNE a pôvodný preset sa NEZMENÍ (to je celý
 *     rozdiel oproti `saved-filters.ts`, ktorý prepisuje).
 *  7. Zmazanie neexistujúceho presetu je FAIL-CLOSED — chyba, nie tiché „ok".
 *  8. Pásma prežijú round-trip znak za znakom a neplatné percento sa neuloží
 *     (I9); `itemsCount` sa do presetu NEDOSTANE (I11).
 *
 * Čo sa tu NEOVERUJE a kto to stráži: že spustenie presetu prejde dry-runom a
 * potvrdením (I3, K7). Táto sada je úložisko — nemá route ani formulár. Stráži
 * to `test/integration/no-write-without-confirm.spec.ts` nad zápisovou cestou;
 * dôkaz, že sa preset k zápisu nedostane inak, je tu len negatívny (repozitár
 * nepozná `previewToken`, shop ani executor) a overuje ho typecheck plus grep
 * v `no-orders-scope.spec.ts`.
 *
 * Bez dostupnej DB sa blok korektne preskočí (`dbAvailable()`).
 *
 * Vlastník: V4 (presety).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Connection } from 'mariadb';

import type { DiscountPresetTier, NewDiscountPreset } from '@/contracts';

import {
  createPresetsRepo,
  MAX_PRESETS,
  PresetLimitError,
  PresetNameTakenError,
  PresetNotFoundError,
  type PresetsRepoContract,
} from '@/lib/repo/presets.repo';

import {
  applyMigrations,
  dbAvailable,
  setupTestDb,
  showCreateTable,
  withAppConn,
  withMigrationConn,
} from '../helpers/db';

const available = await dbAvailable();

/**
 * `discount_presets` je tabuľka TEJTO sady a `truncateAll()` sa jej nedotýka
 * (nie je v `DATA_TABLES`). Súbor si ju preto čistí sám a celú — test stropu
 * inak nemá ako zmerať dvadsiatku.
 */
async function cleanup(): Promise<void> {
  await withMigrationConn(async (conn) => {
    await conn.query('DELETE FROM discount_presets');
  });
}

/** Repozitár nad spojením APLIKAČNÉHO usera — presne tie granty, čo appka. */
async function asApp<T>(fn: (repo: PresetsRepoContract) => Promise<T>): Promise<T> {
  return withAppConn(async (conn) => fn(createPresetsRepo({ defaultConn: conn })));
}

interface ColumnInfo {
  column_type: string;
  is_nullable: string;
  column_default: string | null;
}

async function columnInfo(
  conn: Connection,
  table: string,
  column: string,
): Promise<ColumnInfo | null> {
  const rows = (await conn.query(
    `SELECT COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable,
            COLUMN_DEFAULT AS column_default
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  )) as ColumnInfo[];
  // Turbopack tu už raz zahodil null-guard cez `!row` — porovnávaj explicitne.
  const row = rows[0];
  return row === undefined ? null : row;
}

/** Pásma, ktoré vyzerajú ako to, čo prijíma `POST /api/campaigns`. */
const TIERS_FIRST: DiscountPresetTier = {
  ord: 1,
  label: '0 predaných za 360 dní',
  percent: 30,
  rule: { soldWindowDays: 360, sold: 0 },
};
const TIERS_SECOND: DiscountPresetTier = { ord: 2, label: '0 predaných za 180 dní', percent: 20 };
const TIERS: DiscountPresetTier[] = [TIERS_FIRST, TIERS_SECOND];

const FILTER_QUERY = 'hasDiscount=0&soldWindowDays=90&supplier=Zlat%C3%A1%20d%C3%ADlna';

function preset(name: string, overrides: Partial<NewDiscountPreset> = {}): NewDiscountPreset {
  return {
    name,
    filterQuery: FILTER_QUERY,
    tiers: TIERS,
    durationDays: 14,
    ...overrides,
  };
}

describe.skipIf(!available)('0015 — presety zliav (D112): úložisko, strop, fail-closed', () => {
  beforeAll(async () => {
    await setupTestDb();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  /* ═════════════════ 1. Migrácia: prejde a znesie opakovanie ══════════════ */

  it('migrácia 0015 je v `_migrations` presne raz a opakovaný beh runnera je no-op', async () => {
    // `setupTestDb()` v `beforeAll` už migrácie pustil — toto je DRUHÝ beh
    // tým istým runnerom, aký beží v produkcii. Runner o sebe povie, že
    // nemal čo robiť; to je dôkaz idempotencie, nie len „nespadlo to".
    const stdout = await applyMigrations();
    expect(stdout).toContain('opakovaný beh je no-op');
    expect(stdout).toContain('0015_presety_zliav.sql — už aplikovaná, preskakujem');

    const rows = await withMigrationConn(
      async (conn) =>
        (await conn.query(
          'SELECT id, name, checksum FROM _migrations WHERE id = 15',
        )) as Array<{ id: number; name: string; checksum: string }>,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe('0015_presety_zliav.sql');
    // Checksum je uložený, takže ďalšia editácia migrácie zhodí štart (D88, I14).
    expect((rows[0]?.checksum ?? '').length).toBe(64);

    // A ešte raz, aby „idempotentná" nebolo tvrdenie o jednom behu.
    await applyMigrations();
    const again = await withMigrationConn(
      async (conn) =>
        (await conn.query('SELECT COUNT(*) AS total FROM _migrations WHERE id = 15')) as Array<{
          total: number | bigint;
        }>,
    );
    expect(Number(again[0]?.total)).toBe(1);
  });

  /* ═════════════════════════ 2. Schéma a brzdy ════════════════════════════ */

  it('`last_used_at` je NULLABLE bez defaultu — „ešte nepoužitý" nie je epocha (I11)', async () => {
    const info = await withMigrationConn((conn) =>
      columnInfo(conn, 'discount_presets', 'last_used_at'),
    );
    expect(info).not.toBeNull();
    expect(info?.is_nullable).toBe('YES');
    /*
     * MariaDB vracia pre nullable stĺpec bez defaultu REŤAZEC 'NULL', nie SQL
     * NULL — obe podoby znamenajú „žiadny default". Tvrdenie I11 je, že tam
     * nie je ČAS: `DEFAULT CURRENT_TIMESTAMP` ani epocha, ktoré by z
     * „nepoužitého" presetu urobili „použitý kedysi dávno".
     */
    expect((info?.column_default ?? 'NULL').toUpperCase()).toBe('NULL');
  });

  it('schéma drží UNIQUE meno, CHECK na dĺžke okna aj platnosť JSON pásiem', async () => {
    const ddl = await showCreateTable('discount_presets');
    expect(ddl).toContain('uq_presets_name');
    expect(ddl).toContain('ck_presets_duration');
    expect(ddl).toContain('ck_presets_name_not_blank');
    // MariaDB implementuje `JSON` ako LONGTEXT s vlastným CHECK-om na validitu.
    expect(ddl.toLowerCase()).toContain('json_valid');
  });

  it('CHECK naozaj ODMIETNE dĺžku okna 0 aj 91 — nie len text v schéme', async () => {
    const attempt = async (days: number): Promise<boolean> =>
      withMigrationConn(async (conn) => {
        try {
          await conn.query(
            'INSERT INTO discount_presets (name, filter_query, tiers, duration_days) ' +
              'VALUES (?, ?, ?, ?)',
            [`ck-${days}`, '', JSON.stringify(TIERS), days],
          );
          await conn.query('DELETE FROM discount_presets WHERE name = ?', [`ck-${days}`]);
          return true;
        } catch {
          return false;
        }
      });

    expect(await attempt(0)).toBe(false);
    expect(await attempt(91)).toBe(false);
    // Kontrola, že brzda nie je zaseknutá na všetkom: 90 je povolený strop.
    expect(await attempt(90)).toBe(true);
  });

  it('prázdne meno neprejde ani cez SQL — CHECK na `TRIM(name)`', async () => {
    const inserted = await withMigrationConn(async (conn) => {
      try {
        await conn.query(
          'INSERT INTO discount_presets (name, filter_query, tiers, duration_days) ' +
            'VALUES (?, ?, ?, ?)',
          ['   ', '', JSON.stringify(TIERS), 7],
        );
        return true;
      } catch {
        return false;
      }
    });
    expect(inserted).toBe(false);
  });

  /* ═══════════════ 3. Životný cyklus aplikačným DB userom ═════════════════ */

  it('aplikačný user preset vytvorí, prečíta v zozname, zmení a zmaže (D89)', async () => {
    await cleanup();

    const created = await asApp((repo) => repo.create(preset('Ležiaky −30/−20')));
    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe('Ležiaky −30/−20');
    expect(created.filterQuery).toBe(FILTER_QUERY);
    expect(created.durationDays).toBe(14);
    // I11: nepoužitý preset má `null`, nie čas vzniku a nie nulu.
    expect(created.lastUsedAt).toBeNull();
    expect(created.createdAt instanceof Date).toBe(true);

    const listed = await asApp((repo) => repo.list());
    expect(listed.map((row) => row.name)).toEqual(['Ležiaky −30/−20']);

    const changed = await asApp((repo) =>
      repo.update(created.id, { durationDays: 21, name: 'Ležiaky −30/−20 (dlhšie)' }),
    );
    expect(changed.durationDays).toBe(21);
    expect(changed.name).toBe('Ležiaky −30/−20 (dlhšie)');
    expect(changed.id).toBe(created.id);

    await asApp((repo) => repo.remove(created.id));
    expect(await asApp((repo) => repo.getById(created.id))).toBeNull();
    expect(await asApp((repo) => repo.count())).toBe(0);
  });

  it('pásma prežijú round-trip aj s `rule`; `itemsCount` sa do presetu nedostane (I11)', async () => {
    await cleanup();
    /*
     * `itemsCount` je snímka z času potvrdenia (`campaign_tiers.items_count`) —
     * do presetu nepatrí, lebo koľko produktov padne do pásma sa vie až pri
     * dry-rune nad aktuálnym katalógom. Posielame ho tu ZÁMERNE, aby sa dalo
     * dokázať, že ho repozitár zahodí a neuloží ako fakt.
     */
    const withItemsCount = {
      ord: 1,
      label: '0 predaných za 360 dní',
      percent: 30,
      rule: { soldWindowDays: 360, sold: 0 },
      itemsCount: 123,
    } as unknown as DiscountPresetTier;
    const created = await asApp((repo) =>
      repo.create(preset('Round-trip pásiem', { tiers: [withItemsCount, TIERS_SECOND] })),
    );

    const back = await asApp((repo) => repo.getById(created.id));
    expect(back).not.toBeNull();
    expect(back?.tiers.length).toBe(2);
    expect(back?.tiers[0]?.ord).toBe(1);
    expect(back?.tiers[0]?.label).toBe('0 predaných za 360 dní');
    expect(back?.tiers[0]?.percent).toBe(30);
    expect(back?.tiers[0]?.rule).toEqual({ soldWindowDays: 360, sold: 0 });
    expect(back?.tiers[1]?.rule).toBeUndefined();
    // Kľúč `itemsCount` sa v uloženom JSON nesmie objaviť vôbec.
    expect(Object.keys(back?.tiers[0] ?? {})).toEqual(['ord', 'label', 'percent', 'rule']);

    await asApp((repo) => repo.remove(created.id));
  });

  it('percento mimo 1–30 sa neuloží (I9) a dĺžka okna nad 90 tiež nie', async () => {
    await cleanup();
    await expect(
      asApp((repo) =>
        repo.create(preset('Zlé percento', { tiers: [{ ord: 1, label: 'x', percent: 31 }] })),
      ),
    ).rejects.toThrow(/1–30/);
    await expect(
      asApp((repo) => repo.create(preset('Zlé okno', { durationDays: 91 }))),
    ).rejects.toThrow(/1–90/);
    await expect(asApp((repo) => repo.create(preset('Bez pásiem', { tiers: [] })))).rejects.toThrow(
      /aspoň jedno pásmo/,
    );
    expect(await asApp((repo) => repo.count())).toBe(0);
  });

  it('`markUsed()` zapíše čas použitia a druhé použitie tým istým časom neprepadne', async () => {
    await cleanup();
    const created = await asApp((repo) => repo.create(preset('Použitý preset')));
    const at = new Date('2026-08-30T10:20:30.000Z');

    await asApp((repo) => repo.markUsed(created.id, at));
    const used = await asApp((repo) => repo.getById(created.id));
    expect(used?.lastUsedAt).not.toBeNull();
    expect(used?.lastUsedAt?.toISOString()).toBe(at.toISOString());

    // Rovnaký čas znova: MariaDB vráti `affectedRows = 0`, čo NIE JE
    // „preset neexistuje" — inak by sa druhé použitie javilo ako chyba.
    await asApp((repo) => repo.markUsed(created.id, at));
    await asApp((repo) => repo.remove(created.id));
  });

  it('zoznam radí naposledy použité pred nepoužité', async () => {
    await cleanup();
    const first = await asApp((repo) => repo.create(preset('A — nepoužitý')));
    const second = await asApp((repo) => repo.create(preset('B — použitý')));
    await asApp((repo) => repo.markUsed(second.id, new Date('2026-08-29T08:00:00.000Z')));

    const names = (await asApp((repo) => repo.list())).map((row) => row.name);
    expect(names).toEqual(['B — použitý', 'A — nepoužitý']);

    await asApp((repo) => repo.remove(first.id));
    await asApp((repo) => repo.remove(second.id));
  });

  /* ═════════════════════ 4. Strop a duplicitné meno ═══════════════════════ */

  it(`strop ${MAX_PRESETS} presetov: ďalší sa neuloží a zoznam zostane celý`, async () => {
    await cleanup();
    for (let i = 1; i <= MAX_PRESETS; i += 1) {
      await asApp((repo) => repo.create(preset(`Preset ${i}`)));
    }
    expect(await asApp((repo) => repo.count())).toBe(MAX_PRESETS);

    await expect(asApp((repo) => repo.create(preset('Jeden navyše')))).rejects.toBeInstanceOf(
      PresetLimitError,
    );
    // Odmietnutie nesmie nič vyhodiť ani prepísať — dvadsiatka stojí.
    expect(await asApp((repo) => repo.count())).toBe(MAX_PRESETS);
    expect(await asApp((repo) => repo.getByName('Jeden navyše'))).toBeNull();

    await cleanup();
  });

  it('duplicitné meno sa ODMIETNE a pôvodný preset sa nezmení (nie prepis ako v prehliadači)', async () => {
    await cleanup();
    const original = await asApp((repo) => repo.create(preset('Vianoce')));

    await expect(
      asApp((repo) =>
        repo.create(preset('Vianoce', { durationDays: 3, filterQuery: 'hasDiscount=1' })),
      ),
    ).rejects.toBeInstanceOf(PresetNameTakenError);

    const after = await asApp((repo) => repo.getByName('Vianoce'));
    expect(after?.id).toBe(original.id);
    expect(after?.durationDays).toBe(14);
    expect(after?.filterQuery).toBe(FILTER_QUERY);
    expect(await asApp((repo) => repo.count())).toBe(1);

    // Ani premenovanie na obsadené meno neprejde.
    const other = await asApp((repo) => repo.create(preset('Veľká noc')));
    await expect(
      asApp((repo) => repo.update(other.id, { name: 'Vianoce' })),
    ).rejects.toBeInstanceOf(PresetNameTakenError);
    expect((await asApp((repo) => repo.getById(other.id)))?.name).toBe('Veľká noc');

    await cleanup();
  });

  /* ═════════════════════════ 5. Fail-closed ═══════════════════════════════ */

  it('zmazanie neexistujúceho presetu je CHYBA, nie tiché „ok" (fail-closed)', async () => {
    await cleanup();
    await expect(asApp((repo) => repo.remove(987_654))).rejects.toBeInstanceOf(
      PresetNotFoundError,
    );
    // Aj nezmyselné ID: `0` a záporné číslo musia skončiť rovnako, nie ticho.
    await expect(asApp((repo) => repo.remove(0))).rejects.toBeInstanceOf(PresetNotFoundError);
    await expect(asApp((repo) => repo.remove(-1))).rejects.toBeInstanceOf(PresetNotFoundError);
  });

  it('`markUsed()` a `update()` nad neexistujúcim presetom sú tiež fail-closed', async () => {
    await expect(
      asApp((repo) => repo.markUsed(987_655, new Date('2026-08-30T00:00:00.000Z'))),
    ).rejects.toBeInstanceOf(PresetNotFoundError);
    await expect(
      asApp((repo) => repo.update(987_656, { durationDays: 5 })),
    ).rejects.toBeInstanceOf(PresetNotFoundError);
    // Ani prázdny patch nesmie vrátiť vymyslený preset.
    await expect(asApp((repo) => repo.update(987_657, {}))).rejects.toBeInstanceOf(
      PresetNotFoundError,
    );
  });
});
