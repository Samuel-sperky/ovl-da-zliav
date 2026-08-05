/**
 * Aura Zľavy — repozitár tabuľky `products_allowlist` (BUILD-SPEC §3, R1, I2).
 *
 * INVARIANT I2: maximálne 10 AKTÍVNYCH záznamov. Aktívny záznam drží `slot`
 * 1–10 s UNIQUE indexom; odobraný má `slot = NULL` a `removed_at` vyplnené.
 * DB constraint je POSLEDNÁ poistka — `addProduct()`:
 *   1. obsadí najnižší voľný slot jediným `INSERT … SELECT` (žiadny
 *      SELECT-then-INSERT race),
 *   2. keď voľný slot neexistuje (`affectedRows = 0`) ALEBO keď race predsa
 *      narazí na UNIQUE `uq_allowlist_slot` (ER_DUP_ENTRY), preloží to na
 *      doménovú chybu `allowlist_full`,
 *   3. NIKDY neuvoľňuje cudzí slot, aby si urobil miesto (fail-closed).
 *
 * `areAllActive()` je fail-closed kontrola pred KAŽDÝM volaním shop API
 * (I2, R1): pri prázdnom vstupe alebo pochybnosti vracia `false`.
 *
 * I4: žiadny prístup k `audit_log` — eventy `allowlist_added`/`allowlist_removed`
 * zapisuje volajúci cez `appendAudit()` (A2). Vlastník: A8.
 */
import type {
  AllowlistRecord,
  AllowlistRepo,
  AllowlistShopStatus,
  Queryable,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ─────────────────────────── doménové chyby (I2) ───────────────────────── */

export type AllowlistErrorCode = 'allowlist_full' | 'already_listed' | 'invalid_product_id';

/** Chyba s pevným kódom — route vrstva ju mapuje na 409/400. */
export class AllowlistError extends Error {
  readonly code: AllowlistErrorCode;

  constructor(code: AllowlistErrorCode, message: string) {
    super(message);
    this.name = 'AllowlistError';
    this.code = code;
  }
}

export const MAX_ALLOWLIST_SLOTS = 10;

/* ─────────────────────────────────── SQL ───────────────────────────────── */

const COLUMNS =
  'id, product_id, slot, label, shop_status, status_note, added_at, removed_at';

const SQL_LIST_ACTIVE =
  `SELECT ${COLUMNS} FROM products_allowlist WHERE removed_at IS NULL ORDER BY slot ASC`;
const SQL_LIST_ALL =
  `SELECT ${COLUMNS} FROM products_allowlist ORDER BY (removed_at IS NULL) DESC, slot ASC, id ASC`;
const SQL_ACTIVE_BY_PRODUCT =
  `SELECT ${COLUMNS} FROM products_allowlist WHERE product_id = ? AND removed_at IS NULL LIMIT 1`;

/**
 * Jediný INSERT: vyberie najnižší voľný slot 1–10 priamo v SQL. Keď je
 * všetkých 10 obsadených, `affectedRows = 0` — žiadny riadok nevznikne.
 */
const SQL_INSERT_WITH_FREE_SLOT =
  'INSERT INTO products_allowlist (product_id, slot, label) ' +
  'SELECT ?, s.slot, ? FROM (' +
  'SELECT 1 AS slot UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 ' +
  'UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 ' +
  'UNION ALL SELECT 9 UNION ALL SELECT 10' +
  ') s LEFT JOIN products_allowlist a ON a.slot = s.slot ' +
  'WHERE a.slot IS NULL ORDER BY s.slot ASC LIMIT 1';

/** Odobranie uvoľní slot a nastaví `removed_at` — riadok sa NEMAŽE (história). */
const SQL_REMOVE =
  'UPDATE products_allowlist SET slot = NULL, removed_at = UTC_TIMESTAMP(3) ' +
  'WHERE product_id = ? AND removed_at IS NULL';

const SQL_MARK_STATUS =
  'UPDATE products_allowlist SET shop_status = ?, status_note = ? ' +
  'WHERE product_id = ? AND removed_at IS NULL';

const SQL_COUNT_ACTIVE_IN =
  'SELECT COUNT(DISTINCT product_id) AS total FROM products_allowlist ' +
  'WHERE removed_at IS NULL AND product_id IN ';

/* ──────────────────────────────── mapovanie ────────────────────────────── */

interface AllowlistRow {
  id: number;
  product_id: number;
  slot: number | null;
  label: string | null;
  shop_status: AllowlistShopStatus;
  status_note: string | null;
  added_at: Date | string;
  removed_at: Date | string | null;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

function mapRow(row: AllowlistRow): AllowlistRecord {
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    slot: row.slot == null ? null : Number(row.slot),
    label: row.label,
    shopStatus: row.shop_status,
    statusNote: row.status_note,
    addedAt: toDate(row.added_at),
    removedAt: row.removed_at == null ? null : toDate(row.removed_at),
  };
}

const isValidProductId = (id: number): boolean => Number.isInteger(id) && id > 0;

/** ER_DUP_ENTRY (1062) — race na UNIQUE `uq_allowlist_slot`. */
function isDuplicateEntryError(error: unknown): boolean {
  const e = error as { errno?: number; code?: string } | null;
  return e != null && (e.errno === 1062 || e.code === 'ER_DUP_ENTRY');
}

/* ──────────────────────────────── factory ──────────────────────────────── */

export interface AllowlistRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createAllowlistRepo(deps: AllowlistRepoDeps = {}): AllowlistRepo {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: AllowlistRepo = {
    async listActive(conn?: Queryable): Promise<AllowlistRecord[]> {
      const rows = await run<AllowlistRow[]>(conn, SQL_LIST_ACTIVE, []);
      return (Array.isArray(rows) ? rows : []).map(mapRow);
    },

    async listAll(conn?: Queryable): Promise<AllowlistRecord[]> {
      const rows = await run<AllowlistRow[]>(conn, SQL_LIST_ALL, []);
      return (Array.isArray(rows) ? rows : []).map(mapRow);
    },

    async addProduct(
      productId: number,
      label: string | null,
      conn?: Queryable,
    ): Promise<AllowlistRecord> {
      if (!isValidProductId(productId)) {
        throw new AllowlistError('invalid_product_id', `Neplatné product ID: ${String(productId)}.`);
      }
      // Duplicitný aktívny produkt nemá zmysel a zožral by slot (I2).
      const existing = await run<AllowlistRow[]>(conn, SQL_ACTIVE_BY_PRODUCT, [productId]);
      if (Array.isArray(existing) && existing.length > 0) {
        throw new AllowlistError(
          'already_listed',
          `Produkt ${productId} už v allowliste je (slot ${existing[0]?.slot ?? '?'}).`,
        );
      }

      let result: { affectedRows?: number };
      try {
        result =
          (await run<{ affectedRows?: number }>(conn, SQL_INSERT_WITH_FREE_SLOT, [
            productId,
            label,
          ])) ?? {};
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          // DB constraint zafungoval ako posledná poistka (I2) — NIKDY
          // neuvoľňujeme cudzí slot, prekladáme na doménovú chybu.
          throw new AllowlistError(
            'allowlist_full',
            'Allowlist je plný — maximum je 10 aktívnych produktov. Najprv niektorý odoberte.',
          );
        }
        throw error;
      }

      if (!result.affectedRows) {
        throw new AllowlistError(
          'allowlist_full',
          'Allowlist je plný — maximum je 10 aktívnych produktov. Najprv niektorý odoberte.',
        );
      }

      const rows = await run<AllowlistRow[]>(conn, SQL_ACTIVE_BY_PRODUCT, [productId]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (!row) throw new Error(`Allowlist záznam produktu ${productId} sa po zápise nedá načítať.`);
      return mapRow(row);
    },

    async removeProduct(productId: number, conn?: Queryable): Promise<boolean> {
      if (!isValidProductId(productId)) return false;
      // Kontrolu naplánovaných kampaní (D40) robí volajúci PRED týmto volaním.
      const result = (await run<{ affectedRows?: number }>(conn, SQL_REMOVE, [productId])) ?? {};
      return typeof result.affectedRows === 'number' ? result.affectedRows > 0 : false;
    },

    async markShopStatus(
      productId: number,
      status: AllowlistShopStatus,
      note: string | null,
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidProductId(productId)) return;
      await run(conn, SQL_MARK_STATUS, [status, note == null ? null : note.slice(0, 191), productId]);
    },

    async areAllActive(productIds: number[], conn?: Queryable): Promise<boolean> {
      // Fail-closed (I2, R1): prázdna alebo pochybná sada NIE JE povolená.
      if (!Array.isArray(productIds) || productIds.length === 0) return false;
      if (!productIds.every(isValidProductId)) return false;
      const unique = [...new Set(productIds)];
      const placeholders = `(${unique.map(() => '?').join(', ')})`;
      const rows = await run<Array<{ total: number | bigint }>>(
        conn,
        SQL_COUNT_ACTIVE_IN + placeholders,
        unique,
      );
      const total = Array.isArray(rows) ? Number(rows[0]?.total ?? 0) : 0;
      return total === unique.length;
    },
  };

  return repo;
}

/** Singleton pre route-y a engine guardy. */
export const allowlistRepo: AllowlistRepo = createAllowlistRepo();
