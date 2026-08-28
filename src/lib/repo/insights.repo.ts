/**
 * Aura Zľavy — repozitár podkladov pre grafy G1–G5 (plán §4, sekcia B2).
 *
 * VÝHRADNE ČÍTANIE. V tomto súbore nie je a nesmie byť žiadny `INSERT`,
 * `UPDATE` ani `DELETE` — grafy nič nemenia. `audit_log` je navyše append-only
 * (I4) a aplikačný DB user na ňom mutácie ani nemá.
 *
 * Čo je zdrojom dát (a prečo nič iné):
 *   · `catalog_cache`   — názov a cena produktu (shop API viac o produkte nedá;
 *                         obrázky NEEXISTUJÚ, preto ich žiadny graf nepoužíva),
 *   · `campaigns` + `campaign_items` — čo appka NAPLÁNOVALA a čo SAMA zapísala,
 *   · `audit_log`       — kedy sa zapisovalo a s akým výsledkom.
 *
 * Čo tu ZÁMERNE nikdy nebude (I8): objednávky, tržby, zásoby, zákaznícke dáta.
 * Appka nemá a nikdy nebude mať scope na `/api/order*` — akýkoľvek graf
 * postavený na predajnosti by bol porušením invariantu, nie funkciou navyše.
 *
 * I11: nič z toho netvrdí, aký je stav zľavy v shope. Všetko sú VLASTNÉ zápisy
 * appky; volajúci to musí v UI takto aj pomenovať (`SelfWriteBadge`).
 *
 * Časy: `ts`/`finished_at` sú v DB v UTC (§2, D31). Dni sa preto NEskupujú
 * v SQL (`DATE(ts)` by zápis o 00:05 bratislavského času zaradil do
 * predchádzajúceho dňa) — bucketuje sa v JS cez `todayInZone()`.
 *
 * Vlastník: B2.
 */
import type {
  DateOnly,
  DbRow,
  DiscountPercent,
  ItemStatus,
  MoneyString,
  Queryable,
  UtcDate,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { WRITE_OUTCOME_EVENTS } from '@/lib/audit/events';
import {
  LOGIC_TIME_ZONE,
  dbDateOnly,
  endOfDayExclusiveUtc,
  startOfDayUtc,
  todayInZone,
} from '@/lib/domain/dates';
import { isItemStatus } from '@/lib/domain/status';

/* ═════════════════════════════ 1. Typy ════════════════════════════════════ */

/** G1 — okno jednej kampane na časovej osi. */
export interface CampaignWindowRow {
  id: number;
  name: string;
  status: string;
  percent: DiscountPercent;
  dateFrom: DateOnly;
  dateTo: DateOnly;
  mode: string;
  fireAt: string | null;
  /** ID produktov v kampani — prekryv sa počíta cez produkty, nie len cez dátumy. */
  productIds: number[];
}

/** G2 — jeden riadok hĺbky zľavy (posledný VLASTNÝ zápis, I11). */
export interface DiscountDepthRow {
  productId: number;
  slot: number | null;
  label: string | null;
  name: string | null;
  price: MoneyString | null;
  hasAttributes: boolean;
  shopStatus: string;
  /** `null` = appka na tento produkt nikdy nezapísala (prázdna dráha grafu). */
  lastOwnWrite: {
    percent: DiscountPercent;
    from: DateOnly;
    to: DateOnly;
    at: string;
    campaignId: number;
  } | null;
}

/** G3 — jeden bod histórie vlastných zápisov na produkt. */
export interface ProductWriteRow {
  itemId: number;
  campaignId: number;
  campaignName: string;
  status: ItemStatus;
  percent: DiscountPercent;
  dateFrom: DateOnly;
  dateTo: DateOnly;
  /** Kedy sa pokus uzavrel (ISO). `null`, keď sa ešte nedobehol. */
  at: string | null;
}

/** G4 — denné počítadlá výsledkov zápisu (v logickom pásme, nie v UTC). */
export interface WriteActivityDay {
  day: DateOnly;
  ok: number;
  failed: number;
  uncertain: number;
  skipped: number;
}

export interface WriteActivity {
  from: DateOnly;
  to: DateOnly;
  days: WriteActivityDay[];
  /** `true`, keď sa strop riadkov vyčerpal a graf nekreslí celé obdobie. */
  truncated: boolean;
}

/** G5 — rozpad položiek kampane po ZNÁMYCH stavoch. */
export type CampaignItemTally = Record<ItemStatus, number>;

/**
 * G5 — celý rozpad položiek kampane.
 *
 * `unrecognized` je počet položiek so stavom mimo číselníka `ITEM_STATUSES`.
 * Nesie sa oddelene a NIKDY sa nezahadzuje: do 24. 8. 2026 taký riadok z tally
 * ticho vypadol a `total` v odpovedi bol nižší než skutočnosť — appka tvrdila
 * počet, ktorý nesedel, bez najmenšieho náznaku, že niečo nezarátala. Nula
 * namiesto pomlčky. S týmto číslom vedľa tally súčet zase sedí a obrazovka má
 * medzeru v poznaní z čoho priznať.
 */
export interface CampaignItemBreakdown {
  readonly tally: CampaignItemTally;
  /** Počet položiek, ktorých stav appka nepozná. `0` = zaradili sme všetky. */
  readonly unrecognized: number;
}

export interface InsightsRepoContract {
  campaignWindows(from: DateOnly, to: DateOnly, conn?: Queryable): Promise<CampaignWindowRow[]>;
  discountDepth(conn?: Queryable): Promise<DiscountDepthRow[]>;
  productWrites(productId: number, limit?: number, conn?: Queryable): Promise<ProductWriteRow[]>;
  writeActivity(from: DateOnly, to: DateOnly, conn?: Queryable): Promise<WriteActivity>;
  campaignItemTally(campaignId: number, conn?: Queryable): Promise<CampaignItemBreakdown>;
}

/* ═══════════════════════════ 2. Konštanty ═════════════════════════════════ */

/** Strop riadkov jedného dotazu — lokálny nástroj, nie analytická platforma. */
const MAX_CAMPAIGNS = 300;
const MAX_ITEMS = 2_000;
const MAX_PRODUCT_WRITES = 200;
const MAX_ACTIVITY_ROWS = 20_000;

const EMPTY_TALLY: CampaignItemTally = {
  pending: 0,
  skipped: 0,
  ok: 0,
  failed: 0,
  uncertain: 0,
  interrupted: 0,
  not_found: 0,
  blocked: 0,
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ═══════════════════════════ 3. Pomocníci ═════════════════════════════════ */

async function run<T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> {
  if (conn) return conn.query<T>(sql, values);
  return poolQuery<T>(sql, values);
}

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const str = (value: unknown): string => (value == null ? '' : String(value));

const strOrNull = (value: unknown): string | null => (value == null ? null : String(value));

const boolOf = (value: unknown): boolean => value != null && Number(value) !== 0;

/**
 * `DATE` stĺpec chodí ako `Date` aj ako string — chceme `YYYY-MM-DD`.
 *
 * Prevod z `Date` robí `dbDateOnly()` z `domain/dates.ts`: driver skladá `DATE`
 * ako LOKÁLNU polnoc, takže tunajšie pôvodné `toISOString().slice(0, 10)`
 * vracalo v `Europe/Bratislava` deň dozadu — okno vlastného zápisu sa
 * v detaile produktu kreslilo ako `31. 7. – 30. 8.` namiesto `1. 8. – 31. 8.`.
 */
function toDateOnly(value: unknown): DateOnly {
  if (value instanceof Date) return dbDateOnly(value);
  const text = String(value ?? '');
  return (DATE_ONLY_RE.test(text) ? text : text.slice(0, 10)) as DateOnly;
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Fail-closed sanitácia ID: nečíselný vstup sa nikdy nedostane do dotazu. */
const isValidId = (id: number): boolean => Number.isInteger(id) && id > 0;

/** Kalendárny deň alebo `null` — dotaz s nezmyselným rozsahom sa nespustí. */
const isDay = (value: string): boolean => DATE_ONLY_RE.test(value);

/* ═══════════════════════════════ 4. SQL ═══════════════════════════════════ */

const SQL_CAMPAIGN_WINDOWS =
  'SELECT id, name, status, percent, date_from, date_to, mode, fire_at ' +
  'FROM campaigns WHERE date_from <= ? AND date_to >= ? ' +
  'ORDER BY date_from ASC, id ASC LIMIT ?';

const SQL_ITEMS_FOR_CAMPAIGNS_PREFIX =
  'SELECT campaign_id, product_id FROM campaign_items WHERE campaign_id IN ';

const SQL_ACTIVE_ALLOWLIST =
  'SELECT a.product_id, a.slot, a.label, a.shop_status, ' +
  'c.name, c.price, c.has_attributes ' +
  'FROM products_allowlist a LEFT JOIN catalog_cache c ON c.product_id = a.product_id ' +
  'WHERE a.removed_at IS NULL ORDER BY a.slot ASC';

const SQL_LAST_OWN_WRITES_PREFIX =
  'SELECT i.product_id, i.finished_at, c.id AS campaign_id, c.percent, c.date_from, c.date_to ' +
  "FROM campaign_items i JOIN campaigns c ON c.id = i.campaign_id " +
  "WHERE i.status = 'ok' AND i.finished_at IS NOT NULL AND i.product_id IN ";

const SQL_PRODUCT_WRITES =
  'SELECT i.id, i.status, i.finished_at, i.started_at, ' +
  'c.id AS campaign_id, c.name, c.percent, c.date_from, c.date_to ' +
  'FROM campaign_items i JOIN campaigns c ON c.id = i.campaign_id ' +
  "WHERE i.product_id = ? AND i.status <> 'pending' " +
  'ORDER BY COALESCE(i.finished_at, i.started_at) DESC, i.id DESC LIMIT ?';

const SQL_WRITE_ACTIVITY =
  'SELECT ts, event_type FROM audit_log ' +
  `WHERE event_type IN (${WRITE_OUTCOME_EVENTS.map(() => '?').join(', ')}) ` +
  'AND ts >= ? AND ts < ? ORDER BY ts ASC LIMIT ?';

const SQL_ITEM_TALLY =
  'SELECT status, COUNT(*) AS n FROM campaign_items WHERE campaign_id = ? GROUP BY status';

/* ═══════════════════════════ 5. Implementácia ═════════════════════════════ */

/**
 * G1 — okná kampaní, ktoré aspoň jedným dňom zasahujú do `[from, to]`.
 * Vracia aj ID produktov, aby UI vedelo odlíšiť „prekrývajú sa v čase" od
 * „prekrývajú sa NA TOM ISTOM produkte" (to druhé je blokujúce, D28).
 */
async function campaignWindows(
  from: DateOnly,
  to: DateOnly,
  conn?: Queryable,
): Promise<CampaignWindowRow[]> {
  if (!isDay(from) || !isDay(to) || from > to) return [];
  const rows = await run<DbRow[]>(conn, SQL_CAMPAIGN_WINDOWS, [to, from, MAX_CAMPAIGNS]);
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return [];

  const ids = list.map((row) => num(row.id)).filter(isValidId);
  const byCampaign = new Map<number, number[]>();
  if (ids.length > 0) {
    const placeholders = `(${ids.map(() => '?').join(', ')})`;
    const itemRows = await run<DbRow[]>(
      conn,
      `${SQL_ITEMS_FOR_CAMPAIGNS_PREFIX}${placeholders} ORDER BY campaign_id ASC, product_id ASC LIMIT ?`,
      [...ids, MAX_ITEMS],
    );
    for (const row of Array.isArray(itemRows) ? itemRows : []) {
      const campaignId = num(row.campaign_id);
      const bucket = byCampaign.get(campaignId);
      if (bucket) bucket.push(num(row.product_id));
      else byCampaign.set(campaignId, [num(row.product_id)]);
    }
  }

  return list.map((row) => {
    const id = num(row.id);
    return {
      id,
      name: str(row.name),
      status: str(row.status),
      percent: num(row.percent) as DiscountPercent,
      dateFrom: toDateOnly(row.date_from),
      dateTo: toDateOnly(row.date_to),
      mode: str(row.mode),
      fireAt: toIsoOrNull(row.fire_at),
      productIds: byCampaign.get(id) ?? [],
    };
  });
}

/**
 * G2 — aktívny allowlist s posledným VLASTNÝM zápisom na produkt (I11).
 * Produkt bez zápisu má `lastOwnWrite: null` a v grafe prázdnu dráhu — appka
 * o ňom netvrdí nič, lebo nič nevie.
 */
async function discountDepth(conn?: Queryable): Promise<DiscountDepthRow[]> {
  const rows = await run<DbRow[]>(conn, SQL_ACTIVE_ALLOWLIST, []);
  const list = Array.isArray(rows) ? rows : [];
  const productIds = list.map((row) => num(row.product_id)).filter(isValidId);

  const latest = new Map<number, DiscountDepthRow['lastOwnWrite']>();
  if (productIds.length > 0) {
    const placeholders = `(${productIds.map(() => '?').join(', ')})`;
    const writeRows = await run<DbRow[]>(
      conn,
      `${SQL_LAST_OWN_WRITES_PREFIX}${placeholders} ORDER BY i.product_id ASC, i.finished_at DESC, i.id DESC`,
      productIds,
    );
    for (const row of Array.isArray(writeRows) ? writeRows : []) {
      const productId = num(row.product_id);
      // Zoradené DESC — prvý výskyt produktu je ten najnovší.
      if (latest.has(productId)) continue;
      latest.set(productId, {
        percent: num(row.percent) as DiscountPercent,
        from: toDateOnly(row.date_from),
        to: toDateOnly(row.date_to),
        at: toIsoOrNull(row.finished_at) ?? '',
        campaignId: num(row.campaign_id),
      });
    }
  }

  return list.map((row) => {
    const productId = num(row.product_id);
    return {
      productId,
      slot: row.slot == null ? null : num(row.slot),
      label: strOrNull(row.label),
      name: strOrNull(row.name),
      price: (row.price == null ? null : String(row.price)) as MoneyString | null,
      hasAttributes: boolOf(row.has_attributes),
      shopStatus: str(row.shop_status),
      lastOwnWrite: latest.get(productId) ?? null,
    };
  });
}

/** G3 — história pokusov appky o zápis na jeden produkt (aj neúspešných). */
async function productWrites(
  productId: number,
  limit = MAX_PRODUCT_WRITES,
  conn?: Queryable,
): Promise<ProductWriteRow[]> {
  if (!isValidId(productId)) return [];
  const capped = Math.min(Math.max(1, Math.trunc(limit)), MAX_PRODUCT_WRITES);
  const rows = await run<DbRow[]>(conn, SQL_PRODUCT_WRITES, [productId, capped]);
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    itemId: num(row.id),
    campaignId: num(row.campaign_id),
    campaignName: str(row.name),
    status: str(row.status) as ItemStatus,
    percent: num(row.percent) as DiscountPercent,
    dateFrom: toDateOnly(row.date_from),
    dateTo: toDateOnly(row.date_to),
    at: toIsoOrNull(row.finished_at) ?? toIsoOrNull(row.started_at),
  }));
}

/**
 * G4 — denné počty výsledkov zápisu. Deň sa určuje v logickom pásme
 * (`Europe/Bratislava`), pretože plánovaný zápis beží o 00:05 miestneho času,
 * čo je v UTC ešte PREDCHÁDZAJÚCI deň — `GROUP BY DATE(ts)` by ho posunul.
 */
async function writeActivity(
  from: DateOnly,
  to: DateOnly,
  conn?: Queryable,
  timeZone: string = LOGIC_TIME_ZONE,
): Promise<WriteActivity> {
  const empty: WriteActivity = { from, to, days: [], truncated: false };
  if (!isDay(from) || !isDay(to) || from > to) return empty;

  const rangeStart = startOfDayUtc(from, timeZone);
  const rangeEnd = endOfDayExclusiveUtc(to, timeZone);
  const rows = await run<DbRow[]>(conn, SQL_WRITE_ACTIVITY, [
    ...WRITE_OUTCOME_EVENTS,
    rangeStart,
    rangeEnd,
    MAX_ACTIVITY_ROWS + 1,
  ]);
  const list = Array.isArray(rows) ? rows : [];
  const truncated = list.length > MAX_ACTIVITY_ROWS;
  const used = truncated ? list.slice(0, MAX_ACTIVITY_ROWS) : list;

  const buckets = new Map<DateOnly, WriteActivityDay>();
  for (const row of used) {
    const ts = row.ts instanceof Date ? row.ts : new Date(String(row.ts));
    if (Number.isNaN(ts.getTime())) continue;
    const day = todayInZone(ts as UtcDate, timeZone);
    let bucket = buckets.get(day);
    if (!bucket) {
      bucket = { day, ok: 0, failed: 0, uncertain: 0, skipped: 0 };
      buckets.set(day, bucket);
    }
    const event = str(row.event_type);
    if (event === 'write_ok') bucket.ok += 1;
    else if (event === 'write_failed') bucket.failed += 1;
    else if (event === 'write_uncertain') bucket.uncertain += 1;
    else if (event === 'write_skipped') bucket.skipped += 1;
  }

  return {
    from,
    to,
    days: [...buckets.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)),
    truncated,
  };
}

/**
 * G5 — rozpad položiek kampane; chýbajúci stav je 0, nie „nezobrazený" (U6).
 *
 * Stav, ktorý v číselníku nie je, sa NEZAHADZUJE — spočíta sa do
 * `unrecognized`. Do 24. 8. 2026 tu stálo `if (status in tally)` a taký riadok
 * ticho zmizol; `total` postavený nad tally potom hlásil menej položiek, než
 * kampaň má, a nikde sa nedalo dozvedieť, že chýbajú. Zaraďuje sa runtime
 * číselníkom, nie pretypovaním: `str(row.status) as ItemStatus` je len sľub
 * typu, hodnota chodí z `ENUM` v databáze a prvá migrácia ju rozšíri.
 *
 * (`status in tally` malo aj druhú chybu: `in` vidí aj kľúče z prototypu, takže
 * riadok so stavom `constructor` alebo `toString` by prešiel ako známy stav.)
 */
async function campaignItemTally(
  campaignId: number,
  conn?: Queryable,
): Promise<CampaignItemBreakdown> {
  if (!isValidId(campaignId)) return { tally: { ...EMPTY_TALLY }, unrecognized: 0 };
  const rows = await run<DbRow[]>(conn, SQL_ITEM_TALLY, [campaignId]);
  const tally: CampaignItemTally = { ...EMPTY_TALLY };
  let unrecognized = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const status = str(row.status);
    if (isItemStatus(status)) tally[status] = num(row.n);
    else unrecognized += num(row.n);
  }
  return { tally, unrecognized };
}

/* ═══════════════════════════ 6. Export ════════════════════════════════════ */

export const insightsRepo = {
  campaignWindows,
  discountDepth,
  productWrites,
  writeActivity,
  campaignItemTally,
};

/** Kontrola konformity s rozhraním vyššie (rovnaký vzor ako ostatné repozitáre). */
const _conformsToContract: InsightsRepoContract = insightsRepo;
void _conformsToContract;
