/**
 * Aura Zľavy — repozitár tabuľky `catalog_cache` (BUILD-SPEC §3, D57).
 *
 * Cache `name`/`price`/`has_attributes` zo shopu. Obnovuje sa pri otvorení
 * zápisového formulára a manuálne — žiadny background polling (D57).
 *
 * POZOR (I11): v cache NIE JE stav zľavy — shop ho cez API nevracia (backlog
 * B1). `raw` MUSÍ byť už redigované volajúcim (I1, D66) — repozitár ho len
 * serializuje do JSON stĺpca, nič nemaskuje.
 *
 * I4: žiadny prístup k `audit_log`. Vlastník: A8.
 */
import type {
  CatalogCacheRecord,
  CatalogRepo,
  CatalogSource,
  MoneyString,
  Queryable,
  UtcDate,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS = 'product_id, name, price, has_attributes, source, fetched_at, raw';

const SQL_GET = `SELECT ${COLUMNS} FROM catalog_cache WHERE product_id = ? LIMIT 1`;
const SQL_GET_MANY_PREFIX = `SELECT ${COLUMNS} FROM catalog_cache WHERE product_id IN `;
const SQL_UPSERT =
  'INSERT INTO catalog_cache (product_id, name, price, has_attributes, source, fetched_at, raw) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), ' +
  'has_attributes = VALUES(has_attributes), source = VALUES(source), ' +
  'fetched_at = VALUES(fetched_at), raw = VALUES(raw)';

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface CatalogRow {
  product_id: number;
  name: string | null;
  price: string | number | null;
  has_attributes: number | boolean;
  source: CatalogSource;
  fetched_at: Date | string;
  raw: unknown;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

/** `DECIMAL(10,2)` chodí ako string (pool má `decimalAsNumber:false`) — nikdy float (§2). */
const toMoney = (value: string | number | null): MoneyString | null =>
  value == null ? null : String(value);

/** JSON stĺpec môže prísť ako string aj ako už rozparsovaný objekt. */
function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapRow(row: CatalogRow): CatalogCacheRecord {
  return {
    productId: Number(row.product_id),
    name: row.name,
    price: toMoney(row.price),
    hasAttributes: Boolean(row.has_attributes),
    source: row.source,
    fetchedAt: toDate(row.fetched_at),
    raw: parseJsonColumn(row.raw),
  };
}

const isValidProductId = (id: number): boolean => Number.isInteger(id) && id > 0;

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface CatalogRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createCatalogRepo(deps: CatalogRepoDeps = {}): CatalogRepo {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: CatalogRepo = {
    async get(productId: number, conn?: Queryable): Promise<CatalogCacheRecord | null> {
      if (!isValidProductId(productId)) return null;
      const rows = await run<CatalogRow[]>(conn, SQL_GET, [productId]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      return row ? mapRow(row) : null;
    },

    async getMany(
      productIds: number[],
      conn?: Queryable,
    ): Promise<Map<number, CatalogCacheRecord>> {
      const result = new Map<number, CatalogCacheRecord>();
      const unique = [...new Set(productIds.filter(isValidProductId))];
      if (unique.length === 0) return result;
      const placeholders = `(${unique.map(() => '?').join(', ')})`;
      const rows = await run<CatalogRow[]>(conn, SQL_GET_MANY_PREFIX + placeholders, unique);
      for (const row of Array.isArray(rows) ? rows : []) {
        const record = mapRow(row);
        result.set(record.productId, record);
      }
      return result;
    },

    async upsert(
      record: Omit<CatalogCacheRecord, 'fetchedAt'> & { fetchedAt?: UtcDate },
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidProductId(record.productId)) {
        throw new Error(`Neplatné product ID pre catalog_cache: ${String(record.productId)}.`);
      }
      await run(conn, SQL_UPSERT, [
        record.productId,
        record.name == null ? null : record.name.slice(0, 255),
        record.price,
        record.hasAttributes ? 1 : 0,
        record.source,
        record.fetchedAt ?? new Date(),
        record.raw == null ? null : JSON.stringify(record.raw),
      ]);
    },
  };

  return repo;
}

/** Singleton pre route-y a engine preview. */
export const catalogRepo: CatalogRepo = createCatalogRepo();
