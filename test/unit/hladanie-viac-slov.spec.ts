/**
 * Aura Zľavy — HĽADANIE PODĽA VIACERÝCH SLOV (`catalog.repo.ts`, `buildWhere`).
 *
 * Hľadanie v zrkadle katalógu dlho hľadalo jeden SÚVISLÝ podreťazec: celý text
 * z poľa išiel do jediného `c.name LIKE CONCAT('%', ?, '%')`. Kto napísal dve
 * slová, dostal frázu v presnom poradí — a to do vyhľadávacieho poľa nikto
 * nepíše. Zmerané na živej DB (41 220 riadkov):
 *
 *  | text                | jeden podreťazec | slovo po slove cez `AND` |
 *  |---------------------|-----------------:|-------------------------:|
 *  | naramok zirkon      |               10 |                      797 |
 *  | piercing do brady   |              141 |                      262 |
 *  | 4 mm                |              340 |                    1 269 |
 *  | zlate nausnice zirkon |             0 |                    1 835 |
 *
 * Tento súbor stráži tvar `WHERE`, ktorý tie čísla vyrába, a tri veci, ktoré sa
 * pri ňom dajú pokaziť ticho:
 *
 *  A. **Strop slov.** Bez neho je zlepený vstup so štyridsiatimi slovami
 *     štyridsať `LIKE`-ov v jednom `WHERE` — pomalý full scan bez skratky.
 *  B. **Číselná vetva.** Celé číslo je ID ALEBO časť názvu a musí zostať `OR`.
 *     Rozdelenie na slová sa jej nesmie dotknúť.
 *  C. **Escapovanie.** Každé slovo ide cez `escapeLike()` zvlášť; `%` napísané
 *     človekom nesmie znamenať „všetko".
 *
 * Testuje sa cez `defaultConn`, ktoré si SQL a parametre len zapíše — žiadna
 * DB (I6). `buildWhere` je zámerne neexportované: stráži sa SPRÁVANIE
 * repozitára, nie súkromná funkcia.
 *
 * Vlastník: V15 (hľadanie).
 */
import { describe, expect, it } from 'vitest';

import type { Queryable } from '@/contracts';
import { createCatalogRepo } from '@/lib/repo/catalog.repo';

/* ═══════════════════════════ 1. Prostredie ════════════════════════════════ */

interface Call {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** Spojenie, ktoré na nič neodpovie a všetko si zapíše. */
function recordingConn(): { conn: Queryable; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    conn: {
      query: (async (sql: string, values?: unknown) => {
        calls.push({ sql, values: Array.isArray(values) ? values : [] });
        return [];
      }) as Queryable['query'],
    },
  };
}

/** Jeden `LIKE` nad názvom tak, ako ho skladá repozitár. */
const NAME_LIKE = "c.name LIKE CONCAT('%', ?, '%') ESCAPE '\\\\'";

const countLikes = (sql: string): number => sql.split(NAME_LIKE).length - 1;

/** Dotaz `COUNT(*)` — prvý z dvojice, ktorú `search()` posiela. */
const countCall = (calls: readonly Call[]): Call => {
  const call = calls.find((item) => item.sql.startsWith('SELECT COUNT(*)'));
  if (call === undefined) throw new Error('Repozitár neposlal `COUNT(*)` dotaz.');
  return call;
};

/**
 * Hodnoty, ktoré patria hľadanému textu. Pred nimi idú štyri parametre JOIN-ov
 * (okno predajnosti a dva dni pre „práve v zľave") a dva stavy v shope
 * (`ok`, `unknown`) — poradie je dané `buildWhere` a je súčasťou kontraktu SQL.
 */
const termValues = (call: Call): readonly unknown[] => call.values.slice(6);

const search = async (query: string): Promise<Call[]> => {
  const { conn, calls } = recordingConn();
  await createCatalogRepo({ defaultConn: conn }).search({ query, today: '2026-08-19' });
  return calls;
};

/* ═══════════════ 2. Slová sa spájajú cez `AND`, nie do frázy ══════════════ */

describe('hľadanie delí text na slová a spája ich cez AND', () => {
  it('dve slová sú dva samostatné `LIKE`, každé s vlastným parametrom', async () => {
    const calls = await search('naramok zirkon');
    const call = countCall(calls);

    expect(countLikes(call.sql)).toBe(2);
    // Nie fráza: v `WHERE` nesmie zostať zlepený text s medzerou.
    expect(termValues(call)).toEqual(['naramok', 'zirkon']);
    expect(call.values).not.toContain('naramok zirkon');
  });

  it('poradie slov je jedno — `WHERE` je pri oboch poradiach rovnaký tvar', async () => {
    const prve = countCall(await search('naramok zirkon'));
    const druhe = countCall(await search('zirkon naramok'));

    expect(druhe.sql).toBe(prve.sql);
    expect(termValues(druhe)).toEqual(['zirkon', 'naramok']);
  });

  it('jedno slovo zostáva jedným `LIKE` — nič sa nezhoršilo', async () => {
    const call = countCall(await search('naramok'));

    expect(countLikes(call.sql)).toBe(1);
    expect(termValues(call)).toEqual(['naramok']);
  });

  it('viacnásobné medzery, tabulátory a okraje nevyrobia prázdne slová', async () => {
    const call = countCall(await search('  strieborny \t\n naramok  '));

    expect(countLikes(call.sql)).toBe(2);
    expect(termValues(call)).toEqual(['strieborny', 'naramok']);
  });

  it('slová sa spájajú cez AND, nie cez OR — inak by „náramok zirkón" našlo aj samotné náramky', async () => {
    const call = countCall(await search('naramok zirkon'));
    const where = call.sql.slice(call.sql.indexOf(' WHERE '));

    expect(where).toContain(`${NAME_LIKE} AND ${NAME_LIKE}`);
    expect(where).not.toContain(`${NAME_LIKE} OR ${NAME_LIKE}`);
  });

  it('to isté delenie platí pre `counts()` — bočný panel nesmie počítať inú otázku', async () => {
    const { conn, calls } = recordingConn();
    await createCatalogRepo({ defaultConn: conn }).counts({
      query: 'naramok zirkon',
      today: '2026-08-19',
    });

    expect(calls).toHaveLength(1);
    expect(countLikes(calls[0]?.sql ?? '')).toBe(2);
    expect(termValues(calls[0] as Call)).toEqual(['naramok', 'zirkon']);
  });
});

/* ═══════════════════════ 3. Strop počtu slov ══════════════════════════════ */

describe('počet slov je zastropovaný', () => {
  it('šesť slov prejde celých', async () => {
    const call = countCall(await search('a b c d e f'));

    expect(countLikes(call.sql)).toBe(6);
    expect(termValues(call)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('štyridsať slov sa oreže na šesť — `WHERE` so 40 `LIKE`-mi je full scan', async () => {
    const words = Array.from({ length: 40 }, (_, i) => `slovo${i}`);
    const call = countCall(await search(words.join(' ')));

    expect(countLikes(call.sql)).toBe(6);
    expect(termValues(call)).toEqual(words.slice(0, 6));
  });

  it('dlhé slovo sa skráti na 191 znakov — `name` je VARCHAR(255)', async () => {
    const call = countCall(await search(`${'x'.repeat(300)} zirkon`));
    const [prve, druhe] = termValues(call);

    expect(prve).toBe('x'.repeat(191));
    expect(druhe).toBe('zirkon');
  });
});

/* ═══════════════════ 4. Číselná vetva sa nezmenila ════════════════════════ */

describe('celé číslo zostáva „ID alebo časť názvu"', () => {
  it('`12345` je `product_id = ?` ALEBO jeden `LIKE`, nikdy dva `LIKE`', async () => {
    const call = countCall(await search('12345'));

    expect(call.sql).toContain(`(c.product_id = ? OR ${NAME_LIKE})`);
    expect(countLikes(call.sql)).toBe(1);
    expect(termValues(call)).toEqual([12345, '12345']);
  });

  it('desaťciferné číslo už číslom nie je — ide slovom cez `LIKE`', async () => {
    const call = countCall(await search('1234567890'));

    expect(call.sql).not.toContain('c.product_id = ?');
    expect(countLikes(call.sql)).toBe(1);
    expect(termValues(call)).toEqual(['1234567890']);
  });

  it('„4 mm" nie je číslo — sú to dve slová, a preto 1 269 zhôd namiesto 340', async () => {
    const call = countCall(await search('4 mm'));

    expect(call.sql).not.toContain('c.product_id = ?');
    expect(countLikes(call.sql)).toBe(2);
    expect(termValues(call)).toEqual(['4', 'mm']);
  });
});

/* ═════════════════ 5. Escapovanie a parametrizácia ════════════════════════ */

describe('do SQL sa nedostane žiadna hodnota', () => {
  it('`%` a `_` sa escapujú v KAŽDOM slove zvlášť', async () => {
    const call = countCall(await search('100% zlava_teraz'));

    expect(termValues(call)).toEqual(['100\\%', 'zlava\\_teraz']);
  });

  it('pokus o injektáž ide celý ako parametre, nie do SQL', async () => {
    const calls = await search("naramok'; DROP TABLE catalog_cache; --");

    for (const call of calls) {
      expect(call.sql).not.toContain('DROP TABLE');
      expect(call.sql).not.toContain('naramok');
    }
    // Päť „slov" (`naramok';` · `DROP` · `TABLE` · `catalog_cache;` · `--`),
    // teda päť `LIKE` — a všetkých päť ako `?`.
    expect(countLikes(countCall(calls).sql)).toBe(5);
  });

  it('prázdny text nepridá do `WHERE` ani jeden `LIKE`', async () => {
    const call = countCall(await search('   '));

    expect(countLikes(call.sql)).toBe(0);
  });
});

/* ═══════════════ 6. Čo sa pri tejto zmene nesmelo pohnúť ══════════════════ */

describe('tvar odpovede a zamknuté filtre zostávajú', () => {
  it('`search()` vracia rovnaké zamknuté filtre ako predtým (K8)', async () => {
    const { conn } = recordingConn();
    const result = await createCatalogRepo({ defaultConn: conn }).search({
      query: 'naramok zirkon',
      today: '2026-08-19',
    });

    expect([...result.lockedFilters].sort()).toEqual([
      'category',
      'jewelryType',
      'margin',
      'metal',
      'stock',
      'turnover',
    ]);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('fail-closed stavy v shope idú stále pred hľadaný text', async () => {
    const call = countCall(await search('naramok zirkon'));

    // Štyri parametre JOIN-ov, potom `ok` + `unknown`, až potom slová.
    expect(call.values.slice(4, 6)).toEqual(['ok', 'unknown']);
  });
});
