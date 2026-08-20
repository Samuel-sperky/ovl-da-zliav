/**
 * Aura Zľavy — AGREGÁCIA CIEN NAD ZRKADLOM KATALÓGU (`catalog.repo.ts`, V1).
 *
 * `grafy-ceny.spec.ts` meria, či graf neklame o tvare rozdelenia.
 * `grafy-ceny-obrazovka.spec.ts` meria, či ho niekto kreslí. Tento súbor meria
 * TRETIU vec: či čísla, ktoré do grafu tečú, hovoria o tom, čo si graf myslí.
 *
 * Do 20. 8. 2026 tú agregáciu nerobil nikto — rozdelenie cien naprieč 41 220
 * produktmi sa v appke nepočítalo vôbec. Keď sa dopísala, skončila najprv
 * v `app/api/insights/_prices.ts`: raw SQL nad `catalog_cache` vo vrstve
 * route-ov, hoci tú tabuľku pozná `catalog.repo.ts` a `_shared.ts` pre čítacie
 * route-y grafov výslovne žiada „SELECT cez repozitár". Teraz je dotaz
 * v repozitári vedľa `counts()` a tento súbor drží, aby sa nevrátil hore.
 *
 * Štyri veci, ktoré sa na tejto ceste dajú pokaziť TICHO:
 *
 *  A. **Riadok bez ceny sa započíta ako nula.** `price` je `NULL`, kým sa
 *     produkt nestiahol. Nula ho posadí do najlacnejšieho pásma a vyrobí
 *     vrchol, ktorý v cenníku nie je.
 *  B. **Súčet stĺpcov prestane sedieť s číslom pod grafom.** Pod grafom je
 *     „41 220 produktov v miestnej kópii". Keď riadok s cenou vypadne
 *     z pásiem, graf a jeho vlastná poznámka si začnú protirečiť.
 *  C. **Chvost sa oreže bez priznania.** Všetko nad hranicou patrí do
 *     ZBERNÉHO pásma, nie do koša — inak graf tvrdí, že drahšie produkty
 *     neexistujú.
 *  D. **Neznáme sa zmení na nulu.** Prázdne zrkadlo nemá najvyššiu cenu;
 *     `null` musí prežiť až do grafu, kde je z neho POMLČKA.
 *
 * Bez DB (I6): repozitár dostane spojenie, ktoré si dotazy zapíše a odpovie
 * vopred pripravenými riadkami — presne ako `hladanie-viac-slov.spec.ts`.
 *
 * Vlastník: V1 (graf), V4 (repozitár).
 */
import { describe, expect, it } from 'vitest';

import type { Queryable } from '@/contracts';
import { createCatalogRepo } from '@/lib/repo/catalog.repo';
import { PRICE_BIN_COUNT, PRICE_BIN_WIDTH, catalogPrices } from '@/app/api/insights/_prices';

/* ═══════════════════════════ 1. Prostredie ════════════════════════════════ */

interface Call {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface Answers {
  /** Riedke počty tak, ako ich vracia `GROUP BY bucket`. */
  readonly buckets?: ReadonlyArray<Record<string, unknown>>;
  /** Jediný riadok súhrnu (`COUNT`, `MIN`, `MAX`). */
  readonly totals?: Record<string, unknown>;
}

/** Spojenie, ktoré si dotazy zapíše a odpovie pripravenými riadkami. */
function fakeConn(answers: Answers = {}): { conn: Queryable; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    conn: {
      query: (async (sql: string, values?: unknown) => {
        calls.push({ sql, values: Array.isArray(values) ? values : [] });
        if (sql.includes('GROUP BY bucket')) return answers.buckets ?? [];
        return [answers.totals ?? {}];
      }) as Queryable['query'],
    },
  };
}

const bucketsCall = (calls: readonly Call[]): Call => {
  const call = calls.find((item) => item.sql.includes('GROUP BY bucket'));
  if (call === undefined) throw new Error('Repozitár neposlal dotaz na pásma.');
  return call;
};

const totalsCall = (calls: readonly Call[]): Call => {
  const call = calls.find((item) => item.sql.includes('rows_without_price'));
  if (call === undefined) throw new Error('Repozitár neposlal dotaz na súhrny.');
  return call;
};

/** Tvar nameraný na živej kópii: ťažký vrchol nízko, dlhý riedky chvost. */
const ZIVE_PASMA = [
  { bucket: 0, count: 1_240 },
  { bucket: 2, count: 9_450 },
  { bucket: 4, count: 5_020 },
  { bucket: PRICE_BIN_COUNT, count: 180 },
];

/**
 * Pásma na TVAR RIADKU Z DB. Stĺpec sa v dotaze menuje `n`, nie `count` —
 * a je to presne ten preklep, ktorý by mlčky vyrobil samé nuly: pásma by
 * v grafe boli, len prázdne, a histogram by tvrdil, že katalóg je prázdny.
 */
const dbRows = (bins: ReadonlyArray<{ bucket: number; count: number }>) =>
  bins.map((bin) => ({ bucket: bin.bucket, n: BigInt(bin.count) }));

const ZIVE_SUHRNY = {
  rows_total: 41_220n,
  rows_without_price: 138n,
  // DECIMAL podáva driver ako string — je to tá istá cena, nie iné číslo.
  min_price: '0.00',
  max_price: '1758.46',
  oldest: new Date('2026-07-02T10:00:00.000Z'),
  newest: new Date('2026-08-18T21:30:00.000Z'),
};

const repoWith = (answers: Answers) => {
  const { conn, calls } = fakeConn(answers);
  return { repo: createCatalogRepo({ defaultConn: conn }), calls };
};

/* ═════════════════════ 2. Dotaz — čo sa smie čítať ════════════════════════ */

describe('dotaz nad zrkadlom katalógu', () => {
  it('číta VÝHRADNE catalog_cache a nič nezapisuje', async () => {
    const { repo, calls } = repoWith({});
    await repo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT);

    expect(calls.length).toBe(2);
    for (const call of calls) {
      expect(call.sql.startsWith('SELECT ')).toBe(true);
      expect(call.sql).toContain('FROM catalog_cache');
      // I8 — graf o objednávkach nevie a nesmie sa k nim dostať.
      expect(call.sql).not.toMatch(/orders|order_items|sales_daily/i);
      expect(call.sql).not.toMatch(/INSERT|UPDATE|DELETE|REPLACE/i);
    }
  });

  it('rozmery pásiem idú ako parametre, nie do textu dotazu', async () => {
    const { repo, calls } = repoWith({});
    await repo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT);

    const call = bucketsCall(calls);
    expect(call.values).toEqual([PRICE_BIN_WIDTH, PRICE_BIN_COUNT]);
    // Šírka pásma v texte dotazu by bola prvá interpolovaná hodnota v repozitári.
    expect(call.sql).not.toContain(String(PRICE_BIN_WIDTH));
    expect(call.sql).toContain('FLOOR(price / ?)');
  });

  it('riadky bez ceny do pásiem nevstupujú, ale spočítané sú', async () => {
    // A + B: `NULL` v pásmach je falošný vrchol pri nule, `NULL` zamlčaný je
    // rozdiel medzi súčtom stĺpcov a číslom pod grafom.
    const { repo, calls } = repoWith({ totals: ZIVE_SUHRNY });
    const raw = await repo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT);

    expect(bucketsCall(calls).sql).toContain('WHERE price IS NOT NULL');
    expect(totalsCall(calls).sql).toContain('WHEN price IS NULL');
    expect(raw.withoutPrice).toBe(138);
    expect(raw.rows).toBe(41_220);
  });

  it('cena nad hranicou padne do ZBERNÉHO pásma, nie do koša', async () => {
    // C: `LEAST` je celý rozdiel medzi zhrnutým chvostom a tvrdením, že
    // drahšie produkty neexistujú.
    const { repo, calls } = repoWith({});
    await repo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT);
    expect(bucketsCall(calls).sql).toContain('LEAST(FLOOR(price / ?), ?)');
  });

  it('nezmyselná šírka pásma nespôsobí delenie nulou', async () => {
    const { repo, calls } = repoWith({});
    await repo.priceBuckets(0, 0);
    expect(bucketsCall(calls).values).toEqual([1, 1]);
  });
});

/* ═════════════════ 3. Čísla — čo z dotazu vyjde ══════════════════════════ */

describe('odpoveď repozitára', () => {
  it('vracia RIEDKE pásma — dopĺňanie núl nie je jeho práca', async () => {
    const { repo } = repoWith({ buckets: dbRows(ZIVE_PASMA), totals: ZIVE_SUHRNY });
    const raw = await repo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT);

    // Presne to, čo dotaz našiel: štyri pásma, nie dvadsaťjeden.
    expect(raw.buckets).toEqual(ZIVE_PASMA);
  });

  it('cena z DECIMAL stĺpca je číslo, nie string', async () => {
    const { repo } = repoWith({ totals: ZIVE_SUHRNY });
    const raw = await repo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT);

    expect(raw.minPrice).toBe(0);
    expect(raw.maxPrice).toBe(1_758.46);
  });

  it('prázdne zrkadlo nemá najvyššiu cenu — a nevymyslí si nulu', async () => {
    // D: pod grafom je z `null` pomlčka. Nula by tvrdila, že je to zadarmo.
    const { repo } = repoWith({
      totals: { rows_total: 0n, rows_without_price: 0n, min_price: null, max_price: null },
    });
    const raw = await repo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT);

    expect(raw.maxPrice).toBeNull();
    expect(raw.minPrice).toBeNull();
    expect(raw.oldestFetchedAt).toBeNull();
    expect(raw.newestFetchedAt).toBeNull();
  });

  it('pásmo mimo rozsahu sa zahodí, nie priloží ako ďalší stĺpec', async () => {
    // SQL ho zovrie, takže vzniknúť nevie — ale keby prišlo, je to poškodená
    // odpoveď a graf by dostal stĺpec na mieste, ktoré na osi neexistuje.
    const { repo } = repoWith({
      buckets: dbRows([
        { bucket: 1, count: 10 },
        { bucket: PRICE_BIN_COUNT + 5, count: 7 },
        { bucket: -1, count: 3 },
      ]),
    });
    const raw = await repo.priceBuckets(PRICE_BIN_WIDTH, PRICE_BIN_COUNT);
    expect(raw.buckets).toEqual([{ bucket: 1, count: 10 }]);
  });
});

/* ═════════════ 4. Tvar pre graf — čo dostane obrazovka ═══════════════════ */

describe('tvar pre graf (`catalogPrices`)', () => {
  it('z riedkych počtov urobí súvislý rad so zberným pásmom na konci', async () => {
    const { conn } = fakeConn({ buckets: dbRows(ZIVE_PASMA), totals: ZIVE_SUHRNY });
    const view = await catalogPrices(conn);

    expect(view.bins.length).toBe(PRICE_BIN_COUNT + 1);
    // Pásmo, ktoré dotaz nenašiel, je meraná NULA — dotaz prešiel celú tabuľku.
    expect(view.bins[1]).toEqual({ from: 10, to: 20, count: 0 });
    expect(view.bins[2]).toEqual({ from: 20, to: 30, count: 9_450 });
    // Zberné pásmo je jediné bez hornej hranice.
    expect(view.bins.at(-1)).toEqual({ from: 200, to: null, count: 180 });
    expect(view.bins.filter((bin) => bin.to === null).length).toBe(1);
  });

  it('súčet stĺpcov sedí s číslom pod grafom', async () => {
    /*
     * B, a je to tvrdenie o CELEJ ceste: pod grafom stojí „41 220 produktov
     * v miestnej kópii, z toho 138 bez ceny". Keby sa cestou stratil riadok
     * s cenou, graf a jeho vlastná poznámka si protirečia — a nikto to
     * z výšok stĺpcov nezistí.
     */
    const buckets = [
      { bucket: 0, count: 20_000 },
      { bucket: 7, count: 21_000 },
      { bucket: PRICE_BIN_COUNT, count: 82 },
    ];
    const { conn } = fakeConn({ buckets: dbRows(buckets), totals: ZIVE_SUHRNY });
    const view = await catalogPrices(conn);

    const inBins = view.bins.reduce((sum, bin) => sum + bin.count, 0);
    expect(inBins).toBe(view.rows - view.withoutPrice);
  });

  it('čas stiahnutia ide na drôt ako ISO, nie ako `Date`', async () => {
    const { conn } = fakeConn({ totals: ZIVE_SUHRNY });
    const view = await catalogPrices(conn);

    expect(view.oldestFetchedAt).toBe('2026-07-02T10:00:00.000Z');
    expect(view.newestFetchedAt).toBe('2026-08-18T21:30:00.000Z');
  });

  it('neznámy čas stiahnutia zostane `null` — graf o ňom povie vetu', async () => {
    const { conn } = fakeConn({ totals: { rows_total: 0n } });
    const view = await catalogPrices(conn);

    expect(view.oldestFetchedAt).toBeNull();
    expect(view.newestFetchedAt).toBeNull();
    expect(view.rows).toBe(0);
  });
});
