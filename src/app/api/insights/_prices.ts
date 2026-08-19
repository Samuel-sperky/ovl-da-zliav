/**
 * Aura Zľavy — PODKLAD PRE HISTOGRAM CIEN KATALÓGU (V1).
 * NIE JE to route — Next.js registruje výhradne `route.ts`.
 *
 * PREČO SA POČÍTA V SQL A NIE V PREHLIADAČI
 * ─────────────────────────────────────────
 *
 * Miestna kópia katalógu má rádovo 40 000 riadkov. Poslať ich do prehliadača,
 * aby si tam narátal dvadsať stĺpcov, znamená prejsť 40 000 cien cez sieť pri
 * každom otvorení obrazovky. Zaraďovanie do pásiem preto robí databáza a von
 * ide dvadsaťjeden čísel.
 *
 * ČO SA TU SMIE TICHO POKAZIŤ
 * ───────────────────────────
 *
 *  1. **Orezanie chvosta bez priznania.** Ceny idú od nuly po vyše 1 700 €,
 *     ale drvivá väčšina katalógu leží pod 200 €. Bez orezania by histogram
 *     bol jeden stĺpec vľavo a 170 prázdnych vpravo. Posledné pásmo je preto
 *     ZBERNÉ (`to: null`) a odpoveď nesie `maxPrice`, aby graf vedel povedať,
 *     kam až chvost siaha. Kto zberné pásmo označí ako obyčajné, začne graf
 *     tvrdiť, že najdrahší produkt stojí 200 €.
 *
 *  2. **Produkt bez ceny sa započíta ako nula.** `catalog_cache.price` je
 *     `NULL`, kým sa produkt nestiahol. Nula by ho posadila do najlacnejšieho
 *     pásma a vyrobila neexistujúci vrchol pri nule. Riadky bez ceny sa preto
 *     z pásiem VYNECHÁVAJÚ a počítajú sa zvlášť (`withoutPrice`) — graf ich
 *     musí priznať, nie zamlčať.
 *
 *  3. **Cena sa vydáva za dnešnú.** Je to KÓPIA. Obnovuje sa pri otvorení
 *     zápisového formulára a ručne, nie na pozadí — takže riadok môže byť
 *     týždne starý. Odpoveď preto nesie najstarší aj najnovší čas stiahnutia
 *     a graf musí obe ukázať. Bez toho by histogram tvrdil, že takto vyzerá
 *     cenník TERAZ.
 *
 *  4. **Zámena za „ceny v eshope".** Sú to ceny v miestnej kópii. Produkty,
 *     ktoré sa nikdy nestiahli, tu nie sú vôbec — a to sa z počtu riadkov
 *     nedá zistiť. Graf preto hovorí „miestna kópia katalógu", nikdy „katalóg".
 *
 * ČISTO ČÍTACIE: samé `SELECT`, žiadne volanie shopu, žiadny zápis.
 *
 * Vlastník: V1.
 */
import type { DbRow, Queryable } from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ═══════════════════════════ 1. Rozmery pásiem ════════════════════════════ */

/** Šírka pásma v eurách. */
export const PRICE_BIN_WIDTH = 10;

/** Koľko obyčajných pásiem je pred zberným. 20 × 10 € = 0 až 200 €. */
export const PRICE_BIN_COUNT = 20;

/* ═══════════════════════════════ 2. Typy ══════════════════════════════════ */

/** Jedno pásmo histogramu. `to === null` je ZBERNÉ pásmo (a viac). */
export interface PriceBin {
  from: number;
  to: number | null;
  count: number;
}

export interface CatalogPrices {
  bins: PriceBin[];
  /** Koľko riadkov má miestna kópia katalógu spolu. */
  rows: number;
  /** Z toho bez ceny — do pásiem nevstupujú a graf ich musí priznať. */
  withoutPrice: number;
  minPrice: number | null;
  maxPrice: number | null;
  /** Najstarší a najnovší čas stiahnutia riadku (ISO). */
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}

/* ═══════════════════════════════ 3. SQL ═══════════════════════════════════ */

/*
 * `LEAST(FLOOR(price / w), n)` posadí všetko nad hranicou do zberného pásma.
 * Robí to databáza, nie appka: 40 000 cien cez sieť je zbytočná záťaž
 * a zaraďovanie v prehliadači by sa nedalo otestovať bez prehliadača.
 */
const SQL_BUCKETS =
  'SELECT LEAST(FLOOR(price / ?), ?) AS bucket, COUNT(*) AS n ' +
  'FROM catalog_cache WHERE price IS NOT NULL GROUP BY bucket ORDER BY bucket ASC';

const SQL_TOTALS =
  'SELECT COUNT(*) AS rows_total, ' +
  'SUM(CASE WHEN price IS NULL THEN 1 ELSE 0 END) AS rows_without_price, ' +
  'MIN(price) AS min_price, MAX(price) AS max_price, ' +
  'MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest ' +
  'FROM catalog_cache';

/* ═══════════════════════════ 4. Pomocníci ═════════════════════════════════ */

async function run<T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> {
  if (conn) return conn.query<T>(sql, values);
  return poolQuery<T>(sql, values);
}

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const numOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ═══════════════════════════ 5. Čistá časť ════════════════════════════════ */

/**
 * Riedke počty z databázy → súvislý rad pásiem.
 *
 * Pásmo, ktoré v odpovedi databázy CHÝBA, dostane nulu — a to je tu správne:
 * dotaz prešiel celú tabuľku, takže „žiadny riadok v tomto pásme" je meraný
 * fakt, nie medzera v poznaní. Je to presne opačný prípad než nesťahovaný deň
 * v grafe predaja a je to jediné miesto v grafoch tejto appky, kde sa nula
 * dopĺňa zámerne.
 */
export function foldBuckets(counts: ReadonlyMap<number, number>): PriceBin[] {
  const bins: PriceBin[] = [];
  for (let i = 0; i < PRICE_BIN_COUNT; i += 1) {
    bins.push({
      from: i * PRICE_BIN_WIDTH,
      to: (i + 1) * PRICE_BIN_WIDTH,
      count: counts.get(i) ?? 0,
    });
  }
  bins.push({
    from: PRICE_BIN_COUNT * PRICE_BIN_WIDTH,
    to: null,
    count: counts.get(PRICE_BIN_COUNT) ?? 0,
  });
  return bins;
}

/* ═══════════════════════════ 6. Čítanie ═══════════════════════════════════ */

export async function catalogPrices(conn?: Queryable): Promise<CatalogPrices> {
  const bucketRows = await run<DbRow[]>(conn, SQL_BUCKETS, [PRICE_BIN_WIDTH, PRICE_BIN_COUNT]);
  const counts = new Map<number, number>();
  for (const row of Array.isArray(bucketRows) ? bucketRows : []) {
    const bucket = Math.trunc(num(row.bucket));
    if (bucket < 0 || bucket > PRICE_BIN_COUNT) continue;
    counts.set(bucket, (counts.get(bucket) ?? 0) + num(row.n));
  }

  const totalRows = await run<DbRow[]>(conn, SQL_TOTALS, []);
  const totals = (Array.isArray(totalRows) ? totalRows[0] : undefined) ?? {};

  return {
    bins: foldBuckets(counts),
    rows: num(totals.rows_total),
    withoutPrice: num(totals.rows_without_price),
    minPrice: numOrNull(totals.min_price),
    maxPrice: numOrNull(totals.max_price),
    oldestFetchedAt: toIsoOrNull(totals.oldest),
    newestFetchedAt: toIsoOrNull(totals.newest),
  };
}
