/**
 * Aura Zľavy — repozitár predajnosti (`0009_sales.sql`, kontrakt P4/P6/P7).
 *
 * Dve tabuľky, obe bez akéhokoľvek zákazníckeho údaja (I8' bod 3):
 *   · `product_sales_daily` — súčet KUSOV `(product_id, sale_day) → units_sold`.
 *     Peniaze tu nie sú a nebudú: `total_paid` je za celú objednávku, nie za
 *     položku, takže obrat na produkt sa priradiť NEDÁ (kontrakt §3 NIE).
 *   · `sales_sync_state`    — stav sťahovania po dňoch. `orders_seen` je POČET,
 *     nie odkaz na objednávku; `last_error` je KÓD chyby, nikdy obsah odpovede (I1).
 *
 * **Idempotencia (P7)** je vlastnosť tohto repozitára, nie volajúceho:
 * `replaceDayUnits()` zapisuje ABSOLÚTNY súčet dňa (`ON DUPLICATE KEY UPDATE
 * units_sold = VALUES(units_sold)`), nikdy `units_sold + ?`. Opakovaný beh nad
 * tým istým dňom preto nemôže čísla zdvojnásobiť. Produkty, ktoré v novom
 * prepočte dňa už nefigurujú, sa pre daný deň zmažú — inak by po korekcii
 * ostal v tabuľke duch starého súčtu.
 *
 * Raw parametrizované SQL, žiadne ORM (rovnaký vzor ako ostatné repozitáre).
 * I4: žiadny prístup k `audit_log`.
 *
 * Vlastník: sales-sync.
 */
import type { DateOnly, DbRow, Queryable } from '@/contracts';

import { query as poolQuery } from '@/db/pool';

/* ═══════════════════════════════ 1. Typy ══════════════════════════════════ */

/** Jeden denný súčet kusov pre jeden produkt. */
export interface DailyUnitsRow {
  productId: number;
  day: DateOnly;
  units: number;
}

export type SalesSyncStatus = 'pending' | 'partial' | 'complete';

/** Stav sťahovania jedného dňa. */
export interface SalesSyncStateRecord {
  day: DateOnly;
  ordersSeen: number;
  status: SalesSyncStatus;
  requestsUsed: number;
  /** KÓD chyby (napr. `rate_limited`), nikdy text odpovede (I1). */
  lastError: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/**
 * Celý stav dňa naraz. ZÁMERNE nie „patch": synchronizácia si stav dňa drží
 * v pamäti a zapisuje ho celý, takže tu netreba SQL akrobaciu s COALESCE
 * a zápis je triviálne idempotentný.
 */
export type SalesSyncStateWrite = Omit<SalesSyncStateRecord, 'day'>;

export interface SalesRepoContract {
  replaceDayUnits(day: DateOnly, rows: DailyUnitsRow[], conn?: Queryable): Promise<number>;
  getSyncState(day: DateOnly, conn?: Queryable): Promise<SalesSyncStateRecord | null>;
  listSyncStates(from: DateOnly, to: DateOnly, conn?: Queryable): Promise<SalesSyncStateRecord[]>;
  saveSyncState(day: DateOnly, state: SalesSyncStateWrite, conn?: Queryable): Promise<void>;
}

/* ═══════════════════════════ 2. Konštanty a SQL ═══════════════════════════ */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strop riadkov jedného upsertu — lokálny nástroj, nie dátový sklad. */
const MAX_UNITS_ROWS_PER_STATEMENT = 500;

/** Strop dní jedného čítania stavu (okno je podľa kontraktu 3 dni, nie roky). */
const MAX_STATE_ROWS = 400;

const STATE_COLUMNS =
  'sale_day, orders_seen, status, requests_used, last_error, started_at, finished_at';

const SQL_STATE_GET = `SELECT ${STATE_COLUMNS} FROM sales_sync_state WHERE sale_day = ? LIMIT 1`;

const SQL_STATE_RANGE =
  `SELECT ${STATE_COLUMNS} FROM sales_sync_state ` +
  'WHERE sale_day >= ? AND sale_day <= ? ORDER BY sale_day ASC LIMIT ?';

/** Upsert celého stavu dňa — posledný zápis vyhráva, opakovanie nič nezdvojí. */
const SQL_STATE_UPSERT =
  'INSERT INTO sales_sync_state ' +
  '(sale_day, orders_seen, status, requests_used, last_error, started_at, finished_at) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE ' +
  'orders_seen = VALUES(orders_seen), ' +
  'status = VALUES(status), ' +
  'requests_used = VALUES(requests_used), ' +
  'last_error = VALUES(last_error), ' +
  'started_at = VALUES(started_at), ' +
  'finished_at = VALUES(finished_at)';

const SQL_UNITS_DELETE_DAY = 'DELETE FROM product_sales_daily WHERE sale_day = ?';

/* ═══════════════════════════ 3. Pomocníci ═════════════════════════════════ */

const isDay = (value: string): boolean => DATE_ONLY_RE.test(value);

const isValidId = (id: number): boolean => Number.isInteger(id) && id > 0;

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** `DATE` stĺpec chodí ako `Date` aj ako string — chceme `YYYY-MM-DD`. */
function toDateOnly(value: unknown): DateOnly {
  if (value instanceof Date) {
    const pad = (n: number): string => String(n).padStart(2, '0');
    // `DATE` je kalendárny deň bez zóny; pool ho dáva ako lokálnu polnoc,
    // preto sa čítajú LOKÁLNE zložky — `toISOString()` by deň posunul.
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value ?? '');
  return (isDay(text) ? text : text.slice(0, 10)) as DateOnly;
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapState(row: DbRow): SalesSyncStateRecord {
  const status = String(row.status ?? 'pending');
  return {
    day: toDateOnly(row.sale_day),
    ordersSeen: num(row.orders_seen),
    status: (status === 'partial' || status === 'complete' ? status : 'pending') as SalesSyncStatus,
    requestsUsed: num(row.requests_used),
    lastError: row.last_error == null ? null : String(row.last_error),
    startedAt: toDateOrNull(row.started_at),
    finishedAt: toDateOrNull(row.finished_at),
  };
}

/* ═══════════════════════════ 4. Factory ═══════════════════════════════════ */

export interface SalesRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
}

export function createSalesRepo(deps: SalesRepoDeps = {}): SalesRepoContract {
  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  /**
   * Prepíše denné súčty pre `day` na presne `rows` (P7).
   *
   * Absolútny zápis, nie inkrement: opakovaný beh nad tým istým dňom vráti tie
   * isté čísla. Vracia počet zapísaných produktov.
   */
  async function replaceDayUnits(
    day: DateOnly,
    rows: DailyUnitsRow[],
    conn?: Queryable,
  ): Promise<number> {
    if (!isDay(day)) return 0;

    // Deduplikácia + sanitácia: do dotazu sa nikdy nedostane nezmyselné id.
    const totals = new Map<number, number>();
    for (const row of rows) {
      if (row.day !== day || !isValidId(row.productId)) continue;
      const units = Math.max(0, Math.trunc(num(row.units)));
      totals.set(row.productId, (totals.get(row.productId) ?? 0) + units);
    }

    const productIds = [...totals.keys()].sort((a, b) => a - b);
    if (productIds.length === 0) {
      // Deň bez predaja: nič sa nezapíše a prípadné staré súčty odídu.
      await run(conn, SQL_UNITS_DELETE_DAY, [day]);
      return 0;
    }

    for (let start = 0; start < productIds.length; start += MAX_UNITS_ROWS_PER_STATEMENT) {
      const chunk = productIds.slice(start, start + MAX_UNITS_ROWS_PER_STATEMENT);
      const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
      const values: unknown[] = [];
      for (const productId of chunk) values.push(productId, day, totals.get(productId) ?? 0);
      await run(
        conn,
        'INSERT INTO product_sales_daily (product_id, sale_day, units_sold) ' +
          `VALUES ${placeholders} ` +
          'ON DUPLICATE KEY UPDATE units_sold = VALUES(units_sold)',
        values,
      );
    }

    // Duchovia po korekcii: produkt, ktorý v novom prepočte dňa už nie je,
    // nesmie v tabuľke ostať so starým súčtom.
    const notIn = productIds.map(() => '?').join(', ');
    await run(
      conn,
      `${SQL_UNITS_DELETE_DAY} AND product_id NOT IN (${notIn})`,
      [day, ...productIds],
    );

    return productIds.length;
  }

  async function getSyncState(day: DateOnly, conn?: Queryable): Promise<SalesSyncStateRecord | null> {
    if (!isDay(day)) return null;
    const rows = await run<DbRow[]>(conn, SQL_STATE_GET, [day]);
    const list = Array.isArray(rows) ? rows : [];
    return list.length === 0 ? null : mapState(list[0]);
  }

  async function listSyncStates(
    from: DateOnly,
    to: DateOnly,
    conn?: Queryable,
  ): Promise<SalesSyncStateRecord[]> {
    if (!isDay(from) || !isDay(to) || from > to) return [];
    const rows = await run<DbRow[]>(conn, SQL_STATE_RANGE, [from, to, MAX_STATE_ROWS]);
    return (Array.isArray(rows) ? rows : []).map(mapState);
  }

  async function saveSyncState(
    day: DateOnly,
    state: SalesSyncStateWrite,
    conn?: Queryable,
  ): Promise<void> {
    if (!isDay(day)) return;
    // `last_error` je KÓD chyby a nič iné (I1) — dĺžka stĺpca je 200 znakov,
    // takže aj tak by sa telo odpovede nezmestilo, ale poistka je lacná.
    const lastError =
      state.lastError == null ? null : String(state.lastError).slice(0, 200);
    await run(conn, SQL_STATE_UPSERT, [
      day,
      Math.max(0, Math.trunc(num(state.ordersSeen))),
      state.status,
      Math.max(0, Math.trunc(num(state.requestsUsed))),
      lastError,
      state.startedAt,
      state.finishedAt,
    ]);
  }

  return { replaceDayUnits, getSyncState, listSyncStates, saveSyncState };
}

/** Default repozitár nad produkčným poolom. */
export const salesRepo: SalesRepoContract = createSalesRepo();
