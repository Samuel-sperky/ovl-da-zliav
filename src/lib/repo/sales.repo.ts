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
 * DENNÁ TRŽBA ESHOPU A POKRYTIE OKNA (28. 8. 2026, migrácia 0014, D117)
 * ---------------------------------------------------------------------
 * Sonda 28. 8. 2026 potvrdila, že API NEVRACIA ceny položiek objednávky
 * (`order/get` → `products: [{id, qty}]`). Tržba v eurách preto pribudla
 * VÝHRADNE na úrovni celého eshopu — `shop_revenue_daily`, súčet `total_paid`
 * za deň a menu. **Rozdeľovať ju medzi položky je zakázané** (D117): v sume je
 * poštovné, zľavy a kupóny, takže akékoľvek rozdelenie by bolo vymyslené číslo
 * vydávané za obrat produktu (I11). Per produkt zostávajú výhradne KUSY.
 *
 * `coverageFor()` je čítacia strana rozlíšenia, ktoré do schémy zaviedla 0009 a
 * ktoré je pre I11 kľúčové: `product_sales_daily` má riadok len pre (produkt,
 * deň) s predajom, takže „žiadny riadok" znamená DVE úplne rôzne veci a rozhodne
 * o nich až `sales_sync_state`:
 *
 *   · deň so `status = 'complete'`  ⇒ produkt sa v ten deň NEPREDAL (platná nula),
 *   · deň bez riadku, `pending` alebo `partial` ⇒ NEVIEME (pomlčka); `partial`
 *     je navyše len DOLNÁ HRANICA, nikdy súčet.
 *
 * Samotný `SUM(units_sold)` nad oknom ticho sčíta stiahnuté aj nestiahnuté dni
 * do jedného čísla, preto obrazovka musí pokrytie priznať — a `coverageFor()` je
 * to, čím ho zistí bez druhého zdroja pravdy.
 *
 * TO ISTÉ PRE TRŽBU (31. 8. 2026, migrácia 0016)
 * ----------------------------------------------
 * `shop_revenue_daily` má mena V KĽÚČI, takže deň BEZ jedinej objednávky žiadnu
 * menu neprinesie a riadok nedostane — čítacia strana ho potom vidí ako
 * „nevieme", hoci sme ho dočítali. Zatvára to `shop_revenue_read_state` (0016):
 * jeden riadok NA DEŇ, bez meny, s príznakom `day_complete`. Platí z toho presne
 * toto a nič iné:
 *
 *   · stav `day_complete = 1` a žiadny riadok v `shop_revenue_daily`
 *     ⇒ prečítali sme celý deň a NEPREDALO SA NIČ (meraná nula),
 *   · stav `day_complete = 0` ⇒ suma je dolná hranica a o nule netvrdíme nič
 *     („`≥ 0`" je prázdna veta, nie priznanie),
 *   · žiadny riadok stavu ani hodnôt ⇒ NEVIEME (pomlčka).
 *
 * Deň, ktorý mal riadky v `shop_revenue_daily` ešte pred 0016 (a stav teda nemá),
 * zostáva „čítaný" — to hovorí jeho vlastný `day_complete`. Preto tu nie je
 * žiadny backfill: stav sa nedopĺňa dozadu, len sa odteraz zapisuje.
 *
 * Raw parametrizované SQL, žiadne ORM (rovnaký vzor ako ostatné repozitáre).
 * I4: žiadny prístup k `audit_log`.
 *
 * Vlastník: sales-sync.
 */
import type {
  DateOnly,
  DbRow,
  MoneyString,
  Queryable,
  SalesDayCoverage,
  ShopRevenueDayRecord,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { addDays } from '@/lib/domain/dates';

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

/**
 * Zápis jedného dňa tržby ESHOPU (D117). Bez `day` a `currency` — tie sú kľúč.
 *
 * `dayComplete` MUSÍ hovoriť pravdu: `false` znamená, že súčet je zatiaľ len
 * dolná hranica. Bez toho posledný (rozbehnutý) deň vždy vyzerá ako prudký
 * pokles tržieb a graf kreslí pád, ktorý sa nestal.
 */
export interface ShopRevenueDayWrite {
  /** Súčet `total_paid` ako string (DECIMAL) alebo číslo. */
  totalPaidSum: MoneyString | number;
  ordersCount: number;
  dayComplete: boolean;
  pagesRead?: number;
}

/**
 * Zápis prečítanosti jedného dňa tržby (`shop_revenue_read_state`, 0016).
 *
 * Je to STAV DŇA, nie suma — a menu zámerne nepozná. Deň bez jedinej objednávky
 * žiadnu menu neprinesie, takže v `shop_revenue_daily` nemá ako dostať riadok;
 * bez tohto stavu ho čítacia strana vidí ako „nevieme", hoci sme ho dočítali.
 */
export interface ShopRevenueReadStateWrite {
  /** `true` = prečítali sme VŠETKY strany zoznamu objednávok tohto dňa. */
  dayComplete: boolean;
  /** POČET videných objednávok, nie odkaz na objednávku (I8' bod 3). */
  ordersSeen: number;
  pagesRead?: number;
  /** KÓD chyby, NIKDY obsah odpovede shopu (I1). */
  lastError?: string | null;
}

/** Prečítanosť jedného dňa tržby tak, ako je v DB (`0016`). */
export interface ShopRevenueReadStateRecord {
  day: DateOnly;
  dayComplete: boolean;
  ordersSeen: number;
  pagesRead: number;
  lastError: string | null;
  firstReadAt: Date | null;
  updatedAt: Date | null;
}

/**
 * Pokrytie jedného dňa okna (I11). `units` je súčet kusov produktu za ten deň
 * — má význam LEN pri `coverage === 'complete'`.
 */
export interface SalesDayCoverageRow {
  day: DateOnly;
  coverage: SalesDayCoverage;
  /** Koľko dní z okna appka naozaj má, sa nedá odvodiť z jedného riadku. */
  ordersSeen: number;
}

/** Pokrytie celého okna naraz — podklad pre priznanú medzeru v grafe (D119). */
export interface SalesCoverageResult {
  from: DateOnly;
  to: DateOnly;
  /** Riadok pre KAŽDÝ deň okna; nesťahovaný deň má `coverage: 'missing'`. */
  days: SalesDayCoverageRow[];
  /** Koľko dní okna je naozaj dočítaných (`complete`). */
  completeDays: number;
  /**
   * Koľko dní okna je „nevieme" (`missing` + `pending` + `partial`). `0` je
   * jediný stav, pri ktorom smie obrazovka súčet okna ukázať bez medzery.
   */
  unknownDays: number;
}

export interface SalesRepoContract {
  replaceDayUnits(day: DateOnly, rows: DailyUnitsRow[], conn?: Queryable): Promise<number>;
  getSyncState(day: DateOnly, conn?: Queryable): Promise<SalesSyncStateRecord | null>;
  listSyncStates(from: DateOnly, to: DateOnly, conn?: Queryable): Promise<SalesSyncStateRecord[]>;
  saveSyncState(day: DateOnly, state: SalesSyncStateWrite, conn?: Queryable): Promise<void>;

  /* ── D117: denná tržba ESHOPU (nikdy per produkt) ────────────────────── */

  /**
   * Upsert dennej tržby eshopu pre (deň, menu). Idempotentný ABSOLÚTNY zápis
   * ako `replaceDayUnits()` — opakovaný beh nad tým istým dňom nemôže sumu
   * zdvojnásobiť.
   */
  upsertRevenueDay(
    day: DateOnly,
    currency: string,
    write: ShopRevenueDayWrite,
    conn?: Queryable,
  ): Promise<void>;
  /**
   * Denná tržba za okno, zoradená podľa dňa. Vracia LEN dni, ktoré sa naozaj
   * čítali — chýbajúci deň sa NEDOPLŇUJE nulou (I11), to je práca čítacej
   * strany, ktorá vie, koľko dní graf kreslí.
   */
  listRevenue(from: DateOnly, to: DateOnly, conn?: Queryable): Promise<ShopRevenueDayRecord[]>;

  /**
   * Upsert prečítanosti dňa (0016). Volá sa LEN pre deň, z ktorého sa naozaj
   * prečítala aspoň jedna strana zoznamu — riadok tu znamená „tento deň sme
   * čítali", takže predvyplnenie dní dopredu by z celého okna urobilo
   * „prečítané, nič sa nepredalo" a to je tá istá lož ako nula (I11).
   */
  upsertRevenueReadState(
    day: DateOnly,
    write: ShopRevenueReadStateWrite,
    conn?: Queryable,
  ): Promise<void>;
  /**
   * Prečítanosť dní okna. Vracia LEN dni, ktoré sa naozaj čítali — deň BEZ
   * riadku je „nevieme" a nedopĺňa sa (I11).
   */
  listRevenueReadStates(
    from: DateOnly,
    to: DateOnly,
    conn?: Queryable,
  ): Promise<ShopRevenueReadStateRecord[]>;

  /* ── I11: „0 predaných" verzus „tento deň sa nesťahoval" ─────────────── */

  /**
   * Pokrytie okna po dňoch. Riadok dostane KAŽDÝ deň okna, aj ten, o ktorom
   * `sales_sync_state` nič nemá — vtedy je `coverage: 'missing'`.
   */
  coverageFor(from: DateOnly, to: DateOnly, conn?: Queryable): Promise<SalesCoverageResult>;
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

/* ── D117: denná tržba ESHOPU (`shop_revenue_daily`, migrácia 0014) ─────── */

const REVENUE_COLUMNS =
  'revenue_day, currency, total_paid_sum, orders_count, day_complete, pages_read, updated_at';

/**
 * Absolútny upsert dňa, nie inkrement — presne z toho istého dôvodu ako
 * `replaceDayUnits()`: opakovaný beh nad tým istým dňom musí vrátiť to isté
 * číslo. `total_paid_sum = VALUES(...)`, NIKDY `total_paid_sum + ?`.
 *
 * `day_complete` sa PREPÍŠE na to, čo hovorí posledný beh. Zámerne aj z `1` na
 * `0`: keď sa deň prepočítava znova a beh sa preruší, deň už dočítaný NIE JE a
 * tvrdiť opak by bola presne tá lož, ktorú tento stĺpec má zabrániť.
 */
const SQL_REVENUE_UPSERT =
  'INSERT INTO shop_revenue_daily ' +
  '(revenue_day, currency, total_paid_sum, orders_count, day_complete, pages_read) ' +
  'VALUES (?, ?, ?, ?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE ' +
  'total_paid_sum = VALUES(total_paid_sum), ' +
  'orders_count = VALUES(orders_count), ' +
  'day_complete = VALUES(day_complete), ' +
  'pages_read = VALUES(pages_read)';

const SQL_REVENUE_RANGE =
  `SELECT ${REVENUE_COLUMNS} FROM shop_revenue_daily ` +
  'WHERE revenue_day >= ? AND revenue_day <= ? ' +
  'ORDER BY revenue_day ASC, currency ASC LIMIT ?';

/** Strop riadkov jedného čítania tržieb — dva roky a dve meny sa zmestia. */
const MAX_REVENUE_ROWS = 1500;

/* ── D117 + I11: prečítanosť dňa tržby (`shop_revenue_read_state`, 0016) ── */

const REVENUE_STATE_COLUMNS =
  'revenue_day, day_complete, orders_seen, pages_read, last_error, first_read_at, updated_at';

/**
 * Absolútny upsert stavu dňa, nie inkrement — z toho istého dôvodu ako
 * `SQL_REVENUE_UPSERT`: opakovaný beh nad tým istým dňom musí vrátiť to isté.
 *
 * `day_complete` sa PREPÍŠE na to, čo hovorí posledný zápis, vrátane `1 → 0`:
 * keď sa deň prepočítava a beh sa preruší, dočítaný už NIE JE. To, že neúplné
 * čítanie neznehodnotí deň, o ktorom sme už vedeli viac, rieši volajúci
 * (`sales-sync.ts`) — rovnako ako pri menových riadkoch, aby oba zápisy jedného
 * dňa hovorili to isté.
 *
 * `first_read_at` sa NEPREPISUJE (nie je vo `VALUES`): je to prvý raz, kedy sme
 * o dni vôbec niečo prečítali, a to sa druhým behom nemení.
 */
const SQL_REVENUE_STATE_UPSERT =
  'INSERT INTO shop_revenue_read_state ' +
  '(revenue_day, day_complete, orders_seen, pages_read, last_error) ' +
  'VALUES (?, ?, ?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE ' +
  'day_complete = VALUES(day_complete), ' +
  'orders_seen = VALUES(orders_seen), ' +
  'pages_read = VALUES(pages_read), ' +
  'last_error = VALUES(last_error)';

const SQL_REVENUE_STATE_RANGE =
  `SELECT ${REVENUE_STATE_COLUMNS} FROM shop_revenue_read_state ` +
  'WHERE revenue_day >= ? AND revenue_day <= ? ' +
  'ORDER BY revenue_day ASC LIMIT ?';

/** Strop dní jedného okna pokrytia. 400 dní je viac než najdlhšie okno UI. */
const MAX_COVERAGE_DAYS = 400;

/** Kód meny podľa API shopu (ISO, `'EUR'`). Nič iné sa do kľúča nedostane. */
const CURRENCY_RE = /^[A-Za-z]{3}$/;

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

  /* ── D117: denná tržba ESHOPU ─────────────────────────────────────────── */

  async function upsertRevenueDay(
    day: DateOnly,
    currency: string,
    write: ShopRevenueDayWrite,
    conn?: Queryable,
  ): Promise<void> {
    if (!isDay(day)) return;
    const code = String(currency ?? '').trim().toUpperCase();
    // Mena je časť primárneho kľúča a súčasne to, čo obrazovka NESMIE sčítať
    // cez meny. Nezmyselný kód by vyrobil štvrtý riadok dňa, o ktorom nikto nič
    // nevie — fail-closed teda nezapíšeme nič.
    if (!CURRENCY_RE.test(code)) return;

    // `DECIMAL` ide do DB ako string (pool má `decimalAsNumber: false`), aby sa
    // suma po ceste nestala floatom. `Number` sa preto formátuje na 2 desatiny.
    const sum =
      typeof write.totalPaidSum === 'number'
        ? write.totalPaidSum.toFixed(2)
        : String(write.totalPaidSum);

    await run(conn, SQL_REVENUE_UPSERT, [
      day,
      code,
      sum,
      Math.max(0, Math.trunc(num(write.ordersCount))),
      write.dayComplete ? 1 : 0,
      Math.max(0, Math.trunc(num(write.pagesRead ?? 0))),
    ]);
  }

  async function listRevenue(
    from: DateOnly,
    to: DateOnly,
    conn?: Queryable,
  ): Promise<ShopRevenueDayRecord[]> {
    if (!isDay(from) || !isDay(to) || from > to) return [];
    const rows = await run<DbRow[]>(conn, SQL_REVENUE_RANGE, [from, to, MAX_REVENUE_ROWS]);
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      day: toDateOnly(row.revenue_day),
      currency: String(row.currency ?? ''),
      // Suma zostáva STRINGOM až na obrazovku — `Number` by z 12 desatinných
      // miest DECIMAL(12,2) urobil float a z tržby zaokrúhlenú približnosť.
      totalPaidSum: String(row.total_paid_sum ?? '0.00'),
      ordersCount: num(row.orders_count),
      dayComplete: num(row.day_complete) === 1,
      pagesRead: num(row.pages_read),
      updatedAt: toDateOrNull(row.updated_at),
    }));
  }

  async function upsertRevenueReadState(
    day: DateOnly,
    write: ShopRevenueReadStateWrite,
    conn?: Queryable,
  ): Promise<void> {
    if (!isDay(day)) return;
    // `last_error` je KÓD, nikdy obsah odpovede shopu (I1) — dĺžka stĺpca je
    // 200 znakov a dlhší vstup by zápis zhodil, nie skrátil.
    const lastError =
      write.lastError === undefined || write.lastError === null
        ? null
        : String(write.lastError).slice(0, 200);

    await run(conn, SQL_REVENUE_STATE_UPSERT, [
      day,
      write.dayComplete ? 1 : 0,
      Math.max(0, Math.trunc(num(write.ordersSeen))),
      Math.max(0, Math.trunc(num(write.pagesRead ?? 0))),
      lastError,
    ]);
  }

  async function listRevenueReadStates(
    from: DateOnly,
    to: DateOnly,
    conn?: Queryable,
  ): Promise<ShopRevenueReadStateRecord[]> {
    if (!isDay(from) || !isDay(to) || from > to) return [];
    const rows = await run<DbRow[]>(conn, SQL_REVENUE_STATE_RANGE, [from, to, MAX_STATE_ROWS]);
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      day: toDateOnly(row.revenue_day),
      dayComplete: num(row.day_complete) === 1,
      ordersSeen: num(row.orders_seen),
      pagesRead: num(row.pages_read),
      lastError: row.last_error == null ? null : String(row.last_error),
      firstReadAt: toDateOrNull(row.first_read_at),
      updatedAt: toDateOrNull(row.updated_at),
    }));
  }

  /* ── I11: „0 predaných" verzus „tento deň sa nesťahoval" ──────────────── */

  async function coverageFor(
    from: DateOnly,
    to: DateOnly,
    conn?: Queryable,
  ): Promise<SalesCoverageResult> {
    const empty: SalesCoverageResult = {
      from,
      to,
      days: [],
      completeDays: 0,
      unknownDays: 0,
    };
    if (!isDay(from) || !isDay(to) || from > to) return empty;

    const states = await listSyncStates(from, to, conn);
    const byDay = new Map<DateOnly, SalesSyncStateRecord>();
    for (const state of states) byDay.set(state.day, state);

    const days: SalesDayCoverageRow[] = [];
    let completeDays = 0;
    let unknownDays = 0;

    /*
     * Dni sa prechádzajú KALENDÁRNE cez `addDays()` (`@/lib/domain/dates`), nie
     * pripočítavaním 86 400 000 ms k `Date`: v deň prechodu na letný čas by
     * milisekundová aritmetika deň preskočila alebo zdvojila.
     */
    let cursor: DateOnly = from;
    for (let i = 0; i < MAX_COVERAGE_DAYS && cursor <= to; i += 1) {
      const state = byDay.get(cursor);
      // Turbopack tu už raz zahodil null-guard cez `!state` — porovnávaj presne.
      const coverage: SalesDayCoverage = state === undefined ? 'missing' : state.status;
      if (coverage === 'complete') completeDays += 1;
      else unknownDays += 1;
      days.push({ day: cursor, coverage, ordersSeen: state === undefined ? 0 : state.ordersSeen });
      cursor = addDays(cursor, 1);
    }

    return { from, to, days, completeDays, unknownDays };
  }

  return {
    replaceDayUnits,
    getSyncState,
    listSyncStates,
    saveSyncState,
    upsertRevenueDay,
    listRevenue,
    upsertRevenueReadState,
    listRevenueReadStates,
    coverageFor,
  };
}

/** Default repozitár nad produkčným poolom. */
export const salesRepo: SalesRepoContract = createSalesRepo();
