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

/** Jeden `LIKE` nad stĺpcom tak, ako ho skladá repozitár. */
const like = (column: string): string => `${column} LIKE CONCAT('%', ?, '%') ESCAPE '\\\\'`;

const NAME_LIKE = like('c.name');

/**
 * Jedno slovo = ZÁTVORKA nad názvom, kódom produktu a EAN-om (D116, migrácia
 * 0014). `reference` a `ean13` sú vyplnené len pri obohatených riadkoch, takže
 * `LIKE` na nich pri ostatných nesadne — a práve preto sú v `OR`, nie v `AND`.
 */
const WORD_SQL = `(${NAME_LIKE} OR ${like('c.reference')} OR ${like('c.ean13')})`;

/** Koľko stĺpcov jedno slovo prehľadáva — toľko `?` naň aj ide. */
const COLUMNS_PER_WORD = 3;

const countLikes = (sql: string): number => sql.split(NAME_LIKE).length - 1;

/**
 * Dotaz `COUNT(*)` NAD ZRKADLOM. Od D121 posiela `search()` ako prvé pokrytie
 * okna (`COUNT(*)` nad `sales_sync_state`), takže „prvý počítací dotaz" už nie
 * je ten, o ktorom tento súbor hovorí — rozhoduje tabuľka, nie poradie.
 */
const countCall = (calls: readonly Call[]): Call => {
  const call = calls.find(
    (item) => item.sql.startsWith('SELECT COUNT(*)') && item.sql.includes('FROM catalog_cache'),
  );
  if (call === undefined) throw new Error('Repozitár neposlal `COUNT(*)` dotaz nad zrkadlom.');
  return call;
};

/** Dotaz počtov do bočného panela — ten, ktorý skladá vedrá predajnosti. */
const countsCall = (calls: readonly Call[]): Call => {
  const call = calls.find((item) => item.sql.includes('AS sold_none'));
  if (call === undefined) throw new Error('Repozitár neposlal dotaz počtov.');
  return call;
};

/**
 * Hodnoty, ktoré patria hľadanému textu. Pred nimi idú štyri parametre JOIN-ov
 * (okno predajnosti a dva dni pre „práve v zľave") a dva stavy v shope
 * (`ok`, `unknown`) — poradie je dané `buildWhere` a je súčasťou kontraktu SQL.
 *
 * `counts()` má pred tým všetkým ešte DVA parametre zo SELECT-u: hranice dňa
 * pre stav zľavy v shope (D116). Preto sa dá predsadenie posunúť — poradie `?`
 * je poradie v SQL, nie poradie významu.
 */
const termValues = (call: Call, prefix = 6): readonly unknown[] => call.values.slice(prefix);

/** Predsadené parametre dotazu `counts()`: dve hranice dňa + štvorica + stavy. */
const COUNTS_PREFIX = 8;

/**
 * SLOVÁ z hľadaného textu, každé RAZ. To isté slovo ide do dotazu
 * `COLUMNS_PER_WORD`-krát (názov, kód, EAN), takže sa berie každé tretie;
 * číselná vetva má pred nimi navyše `product_id` ako číslo a to sa vyfiltruje.
 */
const termWords = (call: Call, prefix = 6): readonly string[] =>
  termValues(call, prefix)
    .filter((value): value is string => typeof value === 'string')
    .filter((_value, index) => index % COLUMNS_PER_WORD === 0);

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
    expect(termWords(call)).toEqual(['naramok', 'zirkon']);
    expect(call.values).not.toContain('naramok zirkon');
  });

  it('poradie slov je jedno — `WHERE` je pri oboch poradiach rovnaký tvar', async () => {
    const prve = countCall(await search('naramok zirkon'));
    const druhe = countCall(await search('zirkon naramok'));

    expect(druhe.sql).toBe(prve.sql);
    expect(termWords(druhe)).toEqual(['zirkon', 'naramok']);
  });

  it('jedno slovo zostáva jedným `LIKE` — nič sa nezhoršilo', async () => {
    const call = countCall(await search('naramok'));

    expect(countLikes(call.sql)).toBe(1);
    expect(termWords(call)).toEqual(['naramok']);
  });

  it('viacnásobné medzery, tabulátory a okraje nevyrobia prázdne slová', async () => {
    const call = countCall(await search('  strieborny \t\n naramok  '));

    expect(countLikes(call.sql)).toBe(2);
    expect(termWords(call)).toEqual(['strieborny', 'naramok']);
  });

  it('slová sa spájajú cez AND, nie cez OR — inak by „náramok zirkón" našlo aj samotné náramky', async () => {
    const call = countCall(await search('naramok zirkon'));
    const where = call.sql.slice(call.sql.indexOf(' WHERE '));

    expect(where).toContain(`${WORD_SQL} AND ${WORD_SQL}`);
    // `OR` je LEN v zátvorke jedného slova. Bez zátvorky by rozvalilo `AND`
    // medzi slovami a „náramok zirkón" by našlo aj samotné náramky.
    expect(where).not.toContain(`${NAME_LIKE} OR ${NAME_LIKE}`);
  });

  it('to isté delenie platí pre `counts()` — bočný panel nesmie počítať inú otázku', async () => {
    const { conn, calls } = recordingConn();
    await createCatalogRepo({ defaultConn: conn }).counts({
      query: 'naramok zirkon',
      today: '2026-08-19',
    });

    // Dva dotazy: pokrytie okna (D121) a samotné počty. Nič viac.
    expect(calls).toHaveLength(2);
    const counts = countsCall(calls);
    expect(countLikes(counts.sql)).toBe(2);
    expect(termWords(counts, COUNTS_PREFIX)).toEqual(['naramok', 'zirkon']);
  });
});

/* ═══════════════════════ 3. Strop počtu slov ══════════════════════════════ */

describe('počet slov je zastropovaný', () => {
  it('šesť slov prejde celých', async () => {
    const call = countCall(await search('a b c d e f'));

    expect(countLikes(call.sql)).toBe(6);
    expect(termWords(call)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('štyridsať slov sa oreže na šesť — `WHERE` so 40 `LIKE`-mi je full scan', async () => {
    const words = Array.from({ length: 40 }, (_, i) => `slovo${i}`);
    const call = countCall(await search(words.join(' ')));

    expect(countLikes(call.sql)).toBe(6);
    expect(termWords(call)).toEqual(words.slice(0, 6));
  });

  it('dlhé slovo sa skráti na 191 znakov — `name` je VARCHAR(255)', async () => {
    const call = countCall(await search(`${'x'.repeat(300)} zirkon`));
    const [prve, druhe] = termWords(call);

    expect(prve).toBe('x'.repeat(191));
    expect(druhe).toBe('zirkon');
  });
});

/* ═══════════════════ 4. Číselná vetva sa nezmenila ════════════════════════ */

describe('celé číslo zostáva „ID alebo časť názvu"', () => {
  it('`12345` je `product_id = ?` ALEBO jeden `LIKE`, nikdy dva `LIKE`', async () => {
    const call = countCall(await search('12345'));

    expect(call.sql).toContain(`(c.product_id = ? OR ${WORD_SQL.slice(1, -1)})`);
    expect(countLikes(call.sql)).toBe(1);
    // Číslo ako ID, potom to isté číslo ako text do všetkých troch stĺpcov —
    // `ean13` je celé číslo, takže bez tejto vetvy by sa nedal nájsť vôbec.
    expect(termValues(call)[0]).toBe(12345);
    expect(termWords(call)).toEqual(['12345']);
  });

  it('desaťciferné číslo už číslom nie je — ide slovom cez `LIKE`', async () => {
    const call = countCall(await search('1234567890'));

    expect(call.sql).not.toContain('c.product_id = ?');
    expect(countLikes(call.sql)).toBe(1);
    expect(termWords(call)).toEqual(['1234567890']);
  });

  it('„4 mm" nie je číslo — sú to dve slová, a preto 1 269 zhôd namiesto 340', async () => {
    const call = countCall(await search('4 mm'));

    expect(call.sql).not.toContain('c.product_id = ?');
    expect(countLikes(call.sql)).toBe(2);
    expect(termWords(call)).toEqual(['4', 'mm']);
  });
});

/* ═════════════════ 5. Escapovanie a parametrizácia ════════════════════════ */

describe('do SQL sa nedostane žiadna hodnota', () => {
  it('`%` a `_` sa escapujú v KAŽDOM slove zvlášť', async () => {
    const call = countCall(await search('100% zlava_teraz'));

    expect(termWords(call)).toEqual(['100\\%', 'zlava\\_teraz']);
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

    // D125 (1. 9. 2026) — zamknuté sú už len tri: kategória (v zrkadle sú len
    // ID bez slovníka názvov), kov a typ šperku (`getFull` také pole nemá).
    expect([...result.lockedFilters].sort()).toEqual(['category', 'jewelryType', 'metal']);
    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
    // I11 — hľadanie podľa kódu a EAN-u, filter „zľava v shope" a štyri filtre
    // z obohatenia (marža, sklad, celkovo objednané, posledný predaj) platia
    // LEN pre obohatené riadky a odpoveď to musí priznať. Zamknuté nie sú:
    // aplikujú sa a vracajú pravdivé riadky, len nad časťou katalógu.
    expect([...result.enrichedOnly].sort()).toEqual([
      'ean13Search',
      'lastSale',
      'marginPercent',
      'orderedTotal',
      'referenceSearch',
      'shopDiscounted',
      'stock',
    ]);
  });

  it('fail-closed stavy v shope idú stále pred hľadaný text', async () => {
    const call = countCall(await search('naramok zirkon'));

    // Štyri parametre JOIN-ov, potom `ok` + `unknown`, až potom slová.
    expect(call.values.slice(4, 6)).toEqual(['ok', 'unknown']);
  });
});
