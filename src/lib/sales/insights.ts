/**
 * Aura Zľavy — PREDAJNOSŤ: čítacie dotazy a odvodené metriky
 * (KONTRAKT-PREDAJNOST-2026-08-06, rozhodnutia P1, P3, P4, P6, P7).
 *
 * Čo tento modul JE: `SELECT` nad vlastnými tabuľkami `product_sales_daily`
 * a `sales_sync_state` + čisté funkcie, ktoré z riadkov spočítajú kusy,
 * kusy na deň a dni od posledného predaja.
 *
 * Čo tento modul NIE JE a nikdy nebude:
 *   · **Obrátkovosť.** `(Ø zásoba × počet dní) / COGS` sa naďalej vypočítať
 *     NEDÁ — shop API neposkytuje COGS vôbec a zásobu vracia len pri
 *     variantoch. Predajnosť je iná metrika a nikdy sa nesmie volať
 *     obrátkovosťou (I11).
 *   · **Peniaze.** Zaplatená suma patrí celej objednávke, nie položke, takže
 *     obrat na produkt sa priradiť nedá. Merajú sa výhradne KUSY (P4).
 *   · **Sieť.** Tento modul nevolá shop. Číta len vlastnú DB; sťahovanie má
 *     na starosti jediný povolený modul (I8' bod 1).
 *
 * Poctivosť pokrytia (P3): okno je zámerne krátke (`SALES_WINDOW_DAYS`,
 * default 3 dni) a nočne sa rozširuje. „0 kusov" preto znamená „za pokryté
 * obdobie sa nepredalo", nie „nepredáva sa" — a `SalesCoverage` nesie presné
 * od–do aj čas poslednej synchronizácie, aby to UI vedelo povedať. Keď nie je
 * pokrytý ani jeden deň, `hasData` je `false` a volajúci NESMIE zobraziť nuly:
 * nula bez dát je vymyslené číslo.
 *
 * Delenie SQL a výpočtu je zámerné: metriky sú čisté funkcie a testujú sa
 * bez DB, presne ako `src/lib/ai/rules.ts`.
 */
import type {
  DateOnly,
  DbRow,
  ProductSalesDay,
  ProductSalesMetrics,
  Queryable,
  SalesCoverage,
  SalesSyncDay,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { addDays, diffDays, isDateOnly } from '@/lib/domain/dates';

/* ═══════════════════════════ 1. Konštanty ═════════════════════════════════ */

/** Strop riadkov jedného dotazu — lokálny nástroj, nie analytická platforma. */
const MAX_SALES_ROWS = 20_000;
/** Strop dní stavu synchronizácie — pokrytie nikdy nebude dlhšie než rok. */
const MAX_SYNC_DAYS = 400;

/**
 * Najkratšie pokrytie, ktoré sa dá rozdeliť na „novšia vs. staršia polovica".
 * Pri troch dňoch by porovnanie 2 : 1 dňa bolo číslo bez výpovede — radšej
 * `null` než falošný trend (I11).
 */
export const MIN_DAYS_FOR_TREND = 4;

/** Dni, ktoré nesú skutočné dáta. `pending` je „ešte sa nesťahovalo". */
const COVERED_STATUSES: ReadonlySet<SalesSyncDay['status']> = new Set(['complete', 'partial']);

/* ═══════════════════════════ 2. Pomocníci ═════════════════════════════════ */

async function run<T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> {
  if (conn) return conn.query<T>(sql, values);
  return poolQuery<T>(sql, values);
}

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** `DATE` chodí z drivera ako `Date` aj ako string — chceme vždy `YYYY-MM-DD`. */
function toDay(value: unknown): DateOnly {
  if (value instanceof Date) return value.toISOString().slice(0, 10) as DateOnly;
  return String(value ?? '').slice(0, 10) as DateOnly;
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Fail-closed sanitácia ID: nečíselný vstup sa nikdy nedostane do dotazu. */
const isValidId = (id: number): boolean => Number.isInteger(id) && id > 0;

/** Zaokrúhlenie na dve desatinné miesta — kusy na deň sú zlomok, nie ilúzia. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/* ═══════════════════════════════ 3. SQL ═══════════════════════════════════ */

const SQL_SYNC_DAYS =
  'SELECT sale_day, status, finished_at, updated_at FROM sales_sync_state ' +
  'ORDER BY sale_day ASC LIMIT ?';

const SQL_DAILY_UNITS_PREFIX =
  'SELECT product_id, sale_day, units_sold FROM product_sales_daily ' +
  'WHERE sale_day >= ? AND sale_day <= ? AND product_id IN ';

/* ══════════════════════════ 4. Čítacie dotazy ═════════════════════════════ */

/**
 * Stav synchronizácie po dňoch. Zámerne sa NEČÍTA počítadlo objednávok:
 * pokrytie sa dá povedať zo dní a stavov, a čím menej sa o objednávkach
 * hovorí, tým menšia šanca, že sa niečo z nich dostane do UI (I8' bod 3).
 */
export async function syncDays(conn?: Queryable): Promise<SalesSyncDay[]> {
  const rows = await run<DbRow[]>(conn, SQL_SYNC_DAYS, [MAX_SYNC_DAYS]);
  const out: SalesSyncDay[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const saleDay = toDay(row.sale_day);
    if (!isDateOnly(saleDay)) continue;
    const status = String(row.status ?? 'pending');
    out.push({
      saleDay,
      status: COVERED_STATUSES.has(status as SalesSyncDay['status'])
        ? (status as SalesSyncDay['status'])
        : 'pending',
      finishedAt: toIsoOrNull(row.finished_at),
      updatedAt: toIsoOrNull(row.updated_at),
    });
  }
  return out;
}

/**
 * Denné súčty kusov pre dané produkty v `[from, to]`. Prázdny zoznam produktov
 * alebo nezmyselný rozsah dotaz vôbec nespustí (fail-closed).
 */
export async function dailyUnits(
  productIds: readonly number[],
  from: DateOnly,
  to: DateOnly,
  conn?: Queryable,
): Promise<ProductSalesDay[]> {
  const ids = [...new Set(productIds)].filter(isValidId);
  if (ids.length === 0) return [];
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) return [];

  const placeholders = `(${ids.map(() => '?').join(', ')})`;
  const rows = await run<DbRow[]>(
    conn,
    `${SQL_DAILY_UNITS_PREFIX}${placeholders} ORDER BY product_id ASC, sale_day ASC LIMIT ?`,
    [from, to, ...ids, MAX_SALES_ROWS],
  );
  const out: ProductSalesDay[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const saleDay = toDay(row.sale_day);
    if (!isDateOnly(saleDay)) continue;
    out.push({
      productId: num(row.product_id),
      saleDay,
      unitsSold: Math.max(0, Math.trunc(num(row.units_sold))),
    });
  }
  return out;
}

/* ══════════════════ 5. Čisté funkcie — pokrytie a metriky ═════════════════ */

/**
 * Za aké obdobie dáta NAOZAJ sú. Pokrytie sa počíta zo skutočných dní
 * v `sales_sync_state`, nie z nastaveného okna: okno je len to, čo si prvý beh
 * vzal, a nočné dopĺňanie ho postupne rozširuje (P3).
 *
 * `lastSyncedAt` je najnovší dotyk ktoréhokoľvek dňa — aj toho, ktorý zostal
 * `pending`, pretože aj neúspešný beh je informácia o tom, kedy sa naposledy
 * synchronizovalo (P6, fail-soft).
 */
export function summarizeCoverage(
  rows: readonly SalesSyncDay[],
  opts: { syncEnabled: boolean; windowDays: number },
): SalesCoverage {
  let from: DateOnly | null = null;
  let to: DateOnly | null = null;
  let daysCovered = 0;
  let daysPartial = 0;
  let lastSyncedAt: string | null = null;

  for (const row of rows) {
    if (!isDateOnly(row.saleDay)) continue;
    for (const stamp of [row.finishedAt, row.updatedAt]) {
      if (stamp != null && (lastSyncedAt == null || stamp > lastSyncedAt)) lastSyncedAt = stamp;
    }
    if (!COVERED_STATUSES.has(row.status)) continue;
    daysCovered += 1;
    if (row.status === 'partial') daysPartial += 1;
    if (from == null || row.saleDay < from) from = row.saleDay;
    if (to == null || row.saleDay > to) to = row.saleDay;
  }

  return {
    syncEnabled: opts.syncEnabled,
    windowDays: Math.max(1, Math.trunc(opts.windowDays)),
    from,
    to,
    daysCovered,
    daysPartial,
    lastSyncedAt,
    hasData: daysCovered > 0,
  };
}

export interface SalesTrendSplit {
  previousFrom: DateOnly;
  previousTo: DateOnly;
  recentFrom: DateOnly;
  recentTo: DateOnly;
}

/**
 * Rozdelí pokryté obdobie na staršiu a novšiu polovicu (novšia dostane
 * pri nepárnom počte dní ten deň navyše). `null`, keď je obdobie na porovnanie
 * príliš krátke — falošný trend z dvoch dní je horší než žiadny (I11).
 */
export function splitCoverage(coverage: SalesCoverage): SalesTrendSplit | null {
  const { from, to } = coverage;
  if (from == null || to == null || !isDateOnly(from) || !isDateOnly(to)) return null;
  const total = diffDays(from, to) + 1;
  if (total < MIN_DAYS_FOR_TREND) return null;
  const recentLength = Math.ceil(total / 2);
  const recentFrom = addDays(to, -(recentLength - 1));
  return {
    previousFrom: from,
    previousTo: addDays(recentFrom, -1),
    recentFrom,
    recentTo: to,
  };
}

export interface SalesMetricsInput {
  /** Produkty allowlistu, pre ktoré sa metriky počítajú (aj tie bez predaja). */
  products: ReadonlyArray<{ productId: number; name: string | null; label: string | null }>;
  /** Denné súčty kusov — riadky mimo pokrytého obdobia sa ignorujú. */
  days: readonly ProductSalesDay[];
  coverage: SalesCoverage;
  /** Dnešný deň v logickom pásme — voči nemu sa merajú „dni od predaja". */
  today: DateOnly;
}

/**
 * Odvodené metriky na produkt. Produkt bez jediného predaja tu JE, s nulou
 * a s `daysSinceLastSale: null` — „za pokryté obdobie sa nepredal" je pravdivé
 * zistenie, ale volajúci ho smie zobraziť len keď `coverage.hasData`.
 *
 * `unitsPerDay` je `null` bez pokrytia — delenie nulou sa nedopočítava.
 */
export function salesMetrics(input: SalesMetricsInput): ProductSalesMetrics[] {
  const { coverage, today } = input;
  const split = splitCoverage(coverage);
  const inWindow = (day: DateOnly): boolean =>
    coverage.from != null &&
    coverage.to != null &&
    day >= coverage.from &&
    day <= coverage.to;

  const totals = new Map<number, { units: number; last: DateOnly | null; recent: number; prev: number }>();
  for (const product of input.products) {
    totals.set(product.productId, { units: 0, last: null, recent: 0, prev: 0 });
  }
  for (const row of input.days) {
    const bucket = totals.get(row.productId);
    if (!bucket) continue;
    if (!isDateOnly(row.saleDay) || !inWindow(row.saleDay)) continue;
    const units = Math.max(0, Math.trunc(row.unitsSold));
    bucket.units += units;
    if (units > 0 && (bucket.last == null || row.saleDay > bucket.last)) bucket.last = row.saleDay;
    if (split) {
      if (row.saleDay >= split.recentFrom && row.saleDay <= split.recentTo) bucket.recent += units;
      else if (row.saleDay >= split.previousFrom && row.saleDay <= split.previousTo) {
        bucket.prev += units;
      }
    }
  }

  const canMeasureAge = isDateOnly(today);
  return input.products.map((product) => {
    const bucket = totals.get(product.productId) ?? { units: 0, last: null, recent: 0, prev: 0 };
    return {
      productId: product.productId,
      name: product.name,
      label: product.label,
      unitsSold: bucket.units,
      unitsPerDay: coverage.daysCovered > 0 ? round2(bucket.units / coverage.daysCovered) : null,
      lastSaleDay: bucket.last,
      daysSinceLastSale:
        bucket.last != null && canMeasureAge ? Math.max(0, diffDays(bucket.last, today)) : null,
      recentUnits: split ? bucket.recent : null,
      previousUnits: split ? bucket.prev : null,
    };
  });
}

/** Slovenský popis pokrytého obdobia — jediné miesto, kde sa formuluje. */
export function describeCoverageSk(coverage: SalesCoverage): string {
  if (!coverage.hasData || coverage.from == null || coverage.to == null) {
    return 'zatiaľ bez dát';
  }
  if (coverage.from === coverage.to) return `${coverage.from} (1 deň)`;
  return `${coverage.from} – ${coverage.to} (${coverage.daysCovered} dní)`;
}

export const salesInsights = {
  syncDays,
  dailyUnits,
};
