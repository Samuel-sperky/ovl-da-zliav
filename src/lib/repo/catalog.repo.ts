/**
 * Aura Zľavy — repozitár tabuľky `catalog_cache` (BUILD-SPEC §3, D57;
 * KONTRAKT V3: K7, K8, K1 bod 2).
 *
 * `catalog_cache` prestala byť cache desiatich produktov a stala sa ZRKADLOM
 * katalógu (40 483 riadkov, K7). Z toho plynie všetko ostatné v tomto súbore:
 *
 *  - **Zápis po dávkach** (`upsertMany`, ~500 riadkov na príkaz). 40 tisíc
 *    jednotlivých `INSERT`-ov nie je synchronizácia, to je DoS na vlastnú DB.
 *    Dávky idú SEKVENČNE — paralelné upserty do jednej tabuľky si nič
 *    nezrýchlia a rozbijú poradie chýb.
 *  - **Stránkované čítanie** (`search`, `LIMIT/OFFSET`) a `counts()` pre čísla
 *    v bočnom paneli. Nikdy sa nevracia celý katalóg.
 *  - **K1 bod 2** — v režime `plny` nahrádza allowlist podmienka „produkt je
 *    v katalógu a nie je `not_found`". Preto je `shop_status` prvotriedny
 *    filter a `search()` ho fail-closed nastavuje na `ok` + `unknown`, keď si
 *    volajúci nepovie inak.
 *  - **I11** — v katalógu NIE JE stav zľavy zo shopu (shop ho cez API nevracia,
 *    backlog B1). „Práve v zľave" a „nikdy nezlacnené" sa počítajú výhradne
 *    z VLASTNÝCH úspešných zápisov (`campaign_items.status = 'ok'`) a tak sa
 *    to musí aj pomenovať na povrchu.
 *  - **K8** — sklad, kategória, kov, typ šperku a marža v schéme NIE SÚ.
 *    `search()` ich preto nepredstiera: vráti ich v `lockedFilters` a filter
 *    NEAPLIKUJE. Tichá „nula" alebo ignorovanie filtra bez slova by bolo
 *    presne to klamstvo, ktoré K8 zakazuje.
 *
 * `raw` MUSÍ prísť už redigované volajúcim (I1, D66) — repozitár ho len
 * serializuje do JSON stĺpca, nič nemaskuje. I4: žiadny prístup k `audit_log`.
 *
 * POKROK DVOJDŇOVÉHO BEHU (A2, migrácia 0013)
 * -------------------------------------------
 * 41 082 produktov po 100 je 411 čítaní, anonymný strop je 300 za UTC deň —
 * celý katalóg sa do jedného dňa nezmestí. Preto tu okrem samotných riadkov žije
 * aj POKROK behu (`catalog_sync_state`): kde sa skončilo, koľko hlási shop, kedy
 * sa naposledy čítalo a prečo sa prípadne čaká. Bez neho by sa beh po každom
 * prerušení vracal na stránku 1 a chvost katalógu by sa neprečítal nikdy.
 *
 * Repozitár je zároveň JEDINÉ DVERE k zdieľanému rozpočtu čítaní
 * (`shop_read_budget` cez `@/lib/repo/read-budget.repo`), aby synchronizácia
 * nemusela poznať ani SQL, ani stropy — a aby si nikto nezaložil vlastné
 * počítadlo, ktoré by si so zvyškom appky kradlo rozpočet (A4).
 *
 * Raw parametrizované SQL, žiadne ORM. Do SQL sa NEINTERPOLUJE žiadna hodnota;
 * dynamické sú výhradne počty `?` placeholderov a whitelistované názvy stĺpcov
 * pri triedení.
 *
 * Vlastník: V4 (katalóg + pokrok behu: V7).
 */
import type {
  AllowlistShopStatus,
  CatalogCacheRecord,
  CatalogRepo,
  CatalogSource,
  DateOnly,
  MoneyString,
  Paged,
  Queryable,
  UtcDate,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { addDays, todayInZone } from '@/lib/domain/dates';
import { anonReadBudget } from '@/lib/repo/read-budget.repo';
import {
  readDaysNeeded,
  type ReadBudget,
  type ReadBudgetStatus,
  type ReadReservation,
} from '@/lib/shop/read-budget';

/* ═══════════════════════════════ 1. Typy ══════════════════════════════════ */

/**
 * Stav produktu v shope. Zámerne tie isté hodnoty ako v `products_allowlist`
 * (D49, D38) — je to jedna vec, nie dve podobné.
 */
export type CatalogShopStatus = AllowlistShopStatus;

/** Riadok katalógu aj so stavom v shope (K1 bod 2). */
export interface CatalogCacheRecordV3 extends CatalogCacheRecord {
  shopStatus: CatalogShopStatus;
}

/**
 * Riadok výsledku vyhľadávania. `unitsSold`, `everDiscounted` a `discountedNow`
 * sú DOPOČÍTANÉ z vlastných tabuliek, nie zo shopu (I11).
 */
export interface CatalogSearchRow extends CatalogCacheRecordV3 {
  /** Predané kusy za okno `soldWindowDays` (0 = za okno sa nepredal). */
  unitsSold: number;
  /** `true` = appka na produkt už niekedy úspešne zapísala zľavu (I11). */
  everDiscounted: boolean;
  /** `true` = podľa VLASTNÉHO zápisu je dnes v okne zľavy (I11). */
  discountedNow: boolean;
}

/**
 * Čísla, ktoré appka o produkte vie z VLASTNÝCH tabuliek — bez ohľadu na to,
 * či ten produkt zrkadlo katalógu má (kontrakt UI, bod 26).
 *
 * Existuje to preto, že hľadanie cez `searchIndex` nájde produkt aj vtedy, keď
 * `catalog_cache` má 2 900 zo 41 082 riadkov. Taký produkt by inak prišiel na
 * obrazovku s prázdnymi číslami, hoci predajnosť (`product_sales_daily`) aj
 * vlastné zápisy zliav (`campaign_items`) sú kľúčované PRODUKTOM, nie zrkadlom
 * — a teda o ňom vieme presne to isté, čo o ktoromkoľvek riadku zrkadla.
 * Vracať tam nulu bez merania by bolo tvrdenie, nie údaj.
 */
export interface CatalogProductFacts {
  /** Predané kusy za okno. `0` znamená „za okno sa nepredal", nie „nevieme". */
  unitsSold: number;
  /** `true` = appka na produkt už niekedy úspešne zapísala zľavu (I11). */
  everDiscounted: boolean;
  /** `true` = podľa VLASTNÉHO zápisu je dnes v okne zľavy (I11). */
  discountedNow: boolean;
}

export interface CatalogFactsResult {
  /** Kľúč je `product_id`; chýbajúce ID znamená „bez predaja a bez zľavy". */
  facts: Map<number, CatalogProductFacts>;
  soldWindowDays: number;
  soldFrom: DateOnly;
  soldTo: DateOnly;
}

/** Vedrá predajnosti podľa bočného panela (`design/v3/produkty.html`). */
export type SoldBucket = 'none' | 'low' | 'mid' | 'high';

/** Podľa čoho sa dá triediť. Whitelist — do SQL sa nedostane nič iné. */
export type CatalogSort =
  | 'name'
  | 'price_asc'
  | 'price_desc'
  | 'sold_asc'
  | 'sold_desc'
  | 'id';

/**
 * Filtre, ktoré appka NEVIE splniť, lebo shop API dáta nevracia (K8).
 * Vracajú sa v odpovedi, aby ich UI ukázalo ako zamknuté — nie skryté.
 */
export type LockedCatalogFilter =
  | 'stock'
  | 'category'
  | 'metal'
  | 'jewelryType'
  | 'margin'
  | 'turnover';

export interface CatalogSearchFilter {
  /** Text: časť názvu, alebo presné ID (keď je vstup celé číslo). */
  query?: string;
  /** Cena v EUR ako string alebo číslo. Neplatná hodnota sa IGNORUJE. */
  priceFrom?: MoneyString | number | null;
  priceTo?: MoneyString | number | null;
  /** Okno predajnosti v dňoch (30/60/90/180/360). Default 180. */
  soldWindowDays?: number;
  /** Vedrá predajnosti spojené cez OR. Prázdne = bez filtra. */
  soldBuckets?: SoldBucket[];
  /** Len produkty, na ktoré appka NIKDY úspešne nezapísala zľavu (I11). */
  neverDiscounted?: boolean;
  /** Len produkty, ktoré sú podľa VLASTNÉHO zápisu dnes v okne zľavy (I11). */
  currentlyDiscounted?: boolean;
  /** Stavy v shope. Default `['ok','unknown']` — `not_found` von (K1 bod 2). */
  shopStatus?: CatalogShopStatus[];
  /** Konkrétne produkty (napr. hromadný výber z UI). */
  productIds?: number[];
  /** Deň, voči ktorému sa počíta okno a „práve v zľave". Default: dnes (D31). */
  today?: DateOnly;
  sort?: CatalogSort;
  page?: number;
  perPage?: number;
}

export interface CatalogSearchResult extends Paged<CatalogSearchRow> {
  /** Okno, za ktoré je `unitsSold` — bez neho je číslo nečitateľné (P7). */
  soldWindowDays: number;
  soldFrom: DateOnly;
  soldTo: DateOnly;
  /** Filtre, ktoré sa NEAPLIKOVALI, lebo na ne nie sú dáta (K8). */
  lockedFilters: LockedCatalogFilter[];
}

/** Čísla do bočného panela (K7). Jeden dotaz, nie šesť. */
export interface CatalogCounts {
  total: number;
  sold: Record<SoldBucket, number>;
  neverDiscounted: number;
  discountedNow: number;
  soldWindowDays: number;
  soldFrom: DateOnly;
  soldTo: DateOnly;
  lockedFilters: LockedCatalogFilter[];
}

/** Vstup upsertu — `shopStatus` je voliteľný, default `ok` (viď `upsertMany`). */
export type CatalogUpsertInput = Omit<CatalogCacheRecord, 'fetchedAt'> & {
  fetchedAt?: UtcDate;
  shopStatus?: CatalogShopStatus;
};

/* ─────────────── Pokrok dvojdňového behu (`catalog_sync_state`) ─────────── */

/**
 * Prečo beh stojí. `daily_budget` a `rate_limited` NIE SÚ chyby — sú to
 * naplánované čakania, z ktorých sa appka prebudí sama.
 */
export type CatalogPauseReason = 'rate_limited' | 'daily_budget' | 'error';

/**
 * Kde beh skončil. Jeden riadok pre celý katalóg (`id = 1`).
 *
 * `lastPage` je posledná stránka, ktorá sa ÚSPEŠNE zapísala — nie posledná,
 * o ktorú sa žiadalo. Pokračuje sa od `lastPage + 1`, takže prerušenie stojí
 * najviac jednu stránku.
 */
export interface CatalogSyncProgress {
  /** Veľkosť stránky, voči ktorej má `lastPage` význam. */
  perPage: number;
  /** Posledná úspešne zapísaná stránka; `0` = prechod sa ešte nezačal. */
  lastPage: number;
  /** Koľko produktov hlási shop. `null` = zatiaľ sme sa to nedozvedeli (I11). */
  shopTotal: number | null;
  /** Koľko riadkov zapísal AKTUÁLNY prechod (nie koľko má tabuľka celkovo). */
  rowsWritten: number;
  /** `true` = prechod dočítal katalóg po koniec; ďalší začne od stránky 1. */
  completed: boolean;
  startedAt: UtcDate | null;
  /** Kedy sa naposledy naozaj čítalo zo shopu (meraný fakt, P7). */
  lastReadAt: UtcDate | null;
  finishedAt: UtcDate | null;
  /** Dokedy beh stojí (`Retry-After`, polnoc UTC). `null` = nič nebráni. */
  pausedUntil: UtcDate | null;
  pauseReason: CatalogPauseReason | null;
  /** KÓD chyby, nikdy obsah odpovede shopu (I1). */
  lastError: string | null;
  updatedAt: UtcDate | null;
}

/** Prečo sa práve teraz nečíta. `null` = nič nebráni ďalšej dávke. */
export type CatalogWaitingReason = CatalogPauseReason | 'catalog_complete';

/**
 * Stav katalógu pre UI (A5) — „koľko z koľkých, kedy naposledy, kedy ďalšia
 * dávka, prečo sa čaká, dokedy to potrvá".
 *
 * Vracajú sa FAKTY a kódy, nie hotové vety: slovenské vety o katalógu skladá
 * `@/lib/status/blockers` (`catalog_incomplete`, `catalog_reads_day_exhausted`)
 * a duplikovať ich tu by znamenalo dva texty o tej istej veci. Názvy
 * `loadedProducts` a `shopTotalProducts` sú zámerne zhodné s `CatalogSnapshot`
 * v blockers, aby ich agregátor stavu vedel odovzdať bez prekladu.
 */
export interface CatalogSyncStatus {
  /** Koľko riadkov má katalóg teraz (`COUNT(*)`). */
  loadedProducts: number;
  /** Koľko ich hlási shop. `null` = nevieme — appka si číslo nedopočítava. */
  shopTotalProducts: number | null;
  /** `0`–`100`, alebo `null`, keď nevieme, z koľkých. */
  percent: number | null;
  /** `true` = posledný prechod dočítal katalóg po koniec. */
  complete: boolean;
  /**
   * `true` = katalóg už appka MÁ celý, ale práve nad ním beží nový prechod
   * (obnova). Je to iná vec než `complete` a bez nej si dve čísla v tej istej
   * karte protirečia: `loadedProducts` je `COUNT(*)` za celý katalóg, kdežto
   * `pagesDone` patrí AKTUÁLNEMU prechodu — a ten po dokončení predchádzajúceho
   * začína od stránky 0. Karta potom vedľa seba tvrdila „0 chýba" aj „411
   * stránok ostáva, ešte 2 dni". Nechýba nič; len sa znova čítajú tie isté
   * stránky, aby boli ceny čerstvé.
   */
  refreshing: boolean;
  /** „Dáta k …" — `MAX(fetched_at)`, meraný fakt (P7). */
  lastFetchedAt: UtcDate | null;
  /** Kedy sa naposledy čítalo zo shopu (aj keď stránka nič nezmenila). */
  lastReadAt: UtcDate | null;
  /** Koľko stránok má AKTUÁLNY prechod za sebou (nie celý katalóg). */
  pagesDone: number;
  /** Koľko stránok má katalóg celkovo. `null` = nevieme koľko. */
  pagesTotal: number | null;
  /**
   * Koľko stránok katalógu appka ešte NEMÁ. `null` = nevieme koľko.
   *
   * Pri obnove je to `0` — nie počet stránok, ktoré prechod ešte prečíta.
   * Pýtame sa „čo appke chýba", nie „kde je prechod"; to druhé je `pagesDone`.
   */
  pagesLeft: number | null;
  perPage: number;
  /** Zdieľaný denný rozpočet ANONYMNÝCH čítaní (A4). */
  reads: ReadBudgetStatus;
  /** Prečo sa nečíta. `null` = nič nebráni ďalšej dávke. */
  waiting: CatalogWaitingReason | null;
  /** Kedy sa smie čítať ďalšia dávka. `null` = hneď, ako scheduler tikne. */
  nextBatchAt: UtcDate | null;
  /** Koľko ďalších UTC dní potrvá dočítanie. `0` = ešte dnes, `null` = nevieme. */
  estimatedDaysLeft: number | null;
  /** Odhad dokončenia (presnosť na deň). `null` = nevieme. */
  estimatedFinishAt: UtcDate | null;
  /** KÓD poslednej chyby behu (I1). */
  lastError: string | null;
  /** Surový pokrok — pre diagnostiku a pre runner. */
  progress: CatalogSyncProgress;
}

/* ═══════════════════════════ 2. Konštanty ═════════════════════════════════ */

/** Koľko riadkov ide do jedného `INSERT … ON DUPLICATE KEY UPDATE` (K7). */
const UPSERT_CHUNK_ROWS = 500;

/** Strop jednej stránky výsledkov — tabuľka v UI stránkuje po 50–100. */
const MAX_PER_PAGE = 200;

/** Default okno predajnosti (bočný panel má prednastavených 180 dní). */
const DEFAULT_SOLD_WINDOW_DAYS = 180;

/** Povolené okná predajnosti podľa prepínača v UI. */
const ALLOWED_SOLD_WINDOWS: readonly number[] = [30, 60, 90, 180, 360];

/**
 * Filtre bez dát v schéme (K8). Zoznam je ZÁMERNE tu a nie v UI: keď dáta
 * pribudnú, zmizne filter odtiaľto a UI ho prestane kresliť zamknutý.
 */
const LOCKED_FILTERS: readonly LockedCatalogFilter[] = [
  'stock',
  'category',
  'metal',
  'jewelryType',
  'margin',
  'turnover',
];

const KNOWN_SHOP_STATUSES: readonly CatalogShopStatus[] = ['ok', 'not_found', 'unknown'];

/**
 * Veľkosť stránky, s ktorou sa počíta, kým pokrok neexistuje. Zhoda
 * s `CATALOG_PAGE_SIZE` v `shop/catalog-sync.ts` (tvrdý strop `per_page` shopu);
 * zrkadlí sa tu zámerne, aby repozitár nezávisel na module synchronizácie —
 * zhodu čísel stráži `test/unit/catalog-sync.spec.ts`.
 */
export const DEFAULT_CATALOG_PER_PAGE = 100;

const KNOWN_PAUSE_REASONS: readonly CatalogPauseReason[] = [
  'rate_limited',
  'daily_budget',
  'error',
];

/** Fail-closed default (K1 bod 2): `not_found` produkt sa neponúka na zápis. */
const DEFAULT_SHOP_STATUSES: readonly CatalogShopStatus[] = ['ok', 'unknown'];

/** Whitelist triedenia — jediné miesto, kde sa do SQL dostane názov stĺpca. */
const SORT_SQL: Record<CatalogSort, string> = {
  name: 'c.name ASC, c.product_id ASC',
  price_asc: 'c.price ASC, c.product_id ASC',
  price_desc: 'c.price DESC, c.product_id ASC',
  sold_asc: 'units_sold ASC, c.product_id ASC',
  sold_desc: 'units_sold DESC, c.product_id ASC',
  id: 'c.product_id ASC',
};

/* ═══════════════════════════ 3. SQL fragmenty ═════════════════════════════ */

const COLUMNS = 'product_id, name, price, has_attributes, shop_status, source, fetched_at, raw';

const SQL_GET = `SELECT ${COLUMNS} FROM catalog_cache WHERE product_id = ? LIMIT 1`;
const SQL_GET_MANY_PREFIX = `SELECT ${COLUMNS} FROM catalog_cache WHERE product_id IN `;

const SQL_UPSERT_PREFIX =
  'INSERT INTO catalog_cache ' +
  '(product_id, name, price, has_attributes, shop_status, source, fetched_at, raw) VALUES ';
const SQL_UPSERT_SUFFIX =
  ' ON DUPLICATE KEY UPDATE name = VALUES(name), price = VALUES(price), ' +
  'has_attributes = VALUES(has_attributes), shop_status = VALUES(shop_status), ' +
  'source = VALUES(source), fetched_at = VALUES(fetched_at), raw = VALUES(raw)';

/** D49: produkt, ktorý shop nenašiel. Ostatné stĺpce sa NEPREPISUJÚ. */
const SQL_MARK_SHOP_STATUS = 'UPDATE catalog_cache SET shop_status = ? WHERE product_id = ?';

const SQL_TOTAL_ROWS = 'SELECT COUNT(*) AS total FROM catalog_cache';
const SQL_LAST_FETCHED = 'SELECT MAX(fetched_at) AS last_fetched FROM catalog_cache';

/* Pokrok dvojdňového behu (`catalog_sync_state`, migrácia 0013). */

const PROGRESS_COLUMNS =
  'per_page, last_page, shop_total, rows_written, completed, started_at, ' +
  'last_read_at, finished_at, paused_until, pause_reason, last_error, updated_at';

const SQL_PROGRESS_GET = `SELECT ${PROGRESS_COLUMNS} FROM catalog_sync_state WHERE id = 1 LIMIT 1`;

/**
 * Zápis pokroku. `INSERT … ON DUPLICATE KEY UPDATE`, a nie `UPDATE`, zámerne:
 * riadok síce zakladá migrácia, ale beh, ktorý by kvôli chýbajúcemu riadku
 * potichu nezapisoval pokrok, by sa vrátil presne k pôvodnej chybe — reštart od
 * stránky 1 po každom prerušení.
 */
const SQL_PROGRESS_SAVE =
  'INSERT INTO catalog_sync_state ' +
  '(id, per_page, last_page, shop_total, rows_written, completed, started_at, ' +
  'last_read_at, finished_at, paused_until, pause_reason, last_error) ' +
  'VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
  'ON DUPLICATE KEY UPDATE per_page = VALUES(per_page), last_page = VALUES(last_page), ' +
  'shop_total = VALUES(shop_total), rows_written = VALUES(rows_written), ' +
  'completed = VALUES(completed), started_at = VALUES(started_at), ' +
  'last_read_at = VALUES(last_read_at), finished_at = VALUES(finished_at), ' +
  'paused_until = VALUES(paused_until), pause_reason = VALUES(pause_reason), ' +
  'last_error = VALUES(last_error)';

/**
 * Predané kusy za okno. Odvodená tabuľka (nie korelovaný poddotaz v SELECT-e):
 * poddotaz na riadok by sa pri 40 tisícoch riadkov vyhodnocoval 40-tisíckrát.
 */
const JOIN_SALES =
  'LEFT JOIN (SELECT product_id, SUM(units_sold) AS units FROM product_sales_daily ' +
  'WHERE sale_day >= ? AND sale_day <= ? GROUP BY product_id) s ON s.product_id = c.product_id ';

/**
 * VLASTNÉ úspešné zápisy zliav (I11). `now_on` je „dnes v okne" — okno berieme
 * z kampane, lebo shop skutočný stav zľavy nevracia (backlog B1).
 */
const JOIN_OWN_DISCOUNTS =
  'LEFT JOIN (SELECT i.product_id, ' +
  'MAX(CASE WHEN cm.date_from <= ? AND cm.date_to >= ? THEN 1 ELSE 0 END) AS now_on ' +
  'FROM campaign_items i JOIN campaigns cm ON cm.id = i.campaign_id ' +
  "WHERE i.status = 'ok' GROUP BY i.product_id) d ON d.product_id = c.product_id ";

/*
 * Tie isté dva výpočty pre ĽUBOVOĽNÉ ID — bez `catalog_cache` v `FROM`
 * (`factsFor()`). Sú to zámerne DVA dotazy a nie jeden JOIN: obe tabuľky sa
 * kľúčujú produktom, ale ani jedna nemusí mať riadok, takže by driving table
 * musela byť `catalog_cache` — a práve o produkty, ktoré v nej NIE SÚ, tu ide.
 */

const SQL_FACTS_SALES_PREFIX =
  'SELECT product_id, SUM(units_sold) AS units FROM product_sales_daily ' +
  'WHERE sale_day >= ? AND sale_day <= ? AND product_id IN ';
const SQL_FACTS_SALES_SUFFIX = ' GROUP BY product_id';

const SQL_FACTS_DISCOUNTS_PREFIX =
  'SELECT i.product_id, ' +
  'MAX(CASE WHEN cm.date_from <= ? AND cm.date_to >= ? THEN 1 ELSE 0 END) AS now_on ' +
  'FROM campaign_items i JOIN campaigns cm ON cm.id = i.campaign_id ' +
  "WHERE i.status = 'ok' AND i.product_id IN ";
const SQL_FACTS_DISCOUNTS_SUFFIX = ' GROUP BY i.product_id';

/* ═══════════════════════════ 4. Pomocníci ═════════════════════════════════ */

interface CatalogRow {
  product_id: number;
  name: string | null;
  price: string | number | null;
  has_attributes: number | boolean;
  shop_status: string | null;
  source: CatalogSource;
  fetched_at: Date | string;
  raw: unknown;
}

interface SearchRow extends CatalogRow {
  units_sold: number | string | null;
  ever_discounted: number | string | null;
  discounted_now: number | string | null;
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

const isShopStatus = (value: unknown): value is CatalogShopStatus =>
  KNOWN_SHOP_STATUSES.includes(value as CatalogShopStatus);

function mapRow(row: CatalogRow): CatalogCacheRecordV3 {
  return {
    productId: Number(row.product_id),
    name: row.name,
    price: toMoney(row.price),
    hasAttributes: Boolean(row.has_attributes),
    // Neznámu hodnotu čítame ako `unknown`, nie ako `ok` — o produkte, ktorého
    // stav nevieme prečítať, nesmieme tvrdiť, že v shope existuje (K1 bod 2).
    shopStatus: isShopStatus(row.shop_status) ? row.shop_status : 'unknown',
    source: row.source,
    fetchedAt: toDate(row.fetched_at),
    raw: parseJsonColumn(row.raw),
  };
}

function mapSearchRow(row: SearchRow): CatalogSearchRow {
  return {
    ...mapRow(row),
    unitsSold: Number(row.units_sold ?? 0),
    everDiscounted: Number(row.ever_discounted ?? 0) === 1,
    discountedNow: Number(row.discounted_now ?? 0) === 1,
  };
}

const isValidProductId = (id: number): boolean => Number.isInteger(id) && id > 0;

/* ── pokrok behu: riadok ⇄ objekt ───────────────────────────────────────── */

interface ProgressRow {
  per_page: number | string | null;
  last_page: number | string | null;
  shop_total: number | string | null;
  rows_written: number | string | null;
  completed: number | boolean | null;
  started_at: Date | string | null;
  last_read_at: Date | string | null;
  finished_at: Date | string | null;
  paused_until: Date | string | null;
  pause_reason: string | null;
  last_error: string | null;
  updated_at: Date | string | null;
}

const toDateOrNull = (value: Date | string | null): UtcDate | null =>
  value == null ? null : toDate(value);

/** Nezáporné celé číslo, alebo `fallback` pri čomkoľvek, čo sa nedá prečítať. */
function toCount(value: number | string | null, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

const isPauseReason = (value: unknown): value is CatalogPauseReason =>
  KNOWN_PAUSE_REASONS.includes(value as CatalogPauseReason);

/** Pokrok, ktorý platí, kým sa nič neprečítalo — „ešte sa nezačalo". */
export function emptyCatalogProgress(perPage = DEFAULT_CATALOG_PER_PAGE): CatalogSyncProgress {
  return {
    perPage,
    lastPage: 0,
    shopTotal: null,
    rowsWritten: 0,
    completed: false,
    startedAt: null,
    lastReadAt: null,
    finishedAt: null,
    pausedUntil: null,
    pauseReason: null,
    lastError: null,
    updatedAt: null,
  };
}

function mapProgressRow(row: ProgressRow): CatalogSyncProgress {
  const shopTotal = row.shop_total == null ? null : Number(row.shop_total);
  return {
    perPage: Math.max(1, toCount(row.per_page, DEFAULT_CATALOG_PER_PAGE)),
    lastPage: toCount(row.last_page, 0),
    shopTotal: shopTotal !== null && Number.isFinite(shopTotal) ? shopTotal : null,
    rowsWritten: toCount(row.rows_written, 0),
    completed: Boolean(row.completed),
    startedAt: toDateOrNull(row.started_at),
    lastReadAt: toDateOrNull(row.last_read_at),
    finishedAt: toDateOrNull(row.finished_at),
    pausedUntil: toDateOrNull(row.paused_until),
    pauseReason: isPauseReason(row.pause_reason) ? row.pause_reason : null,
    lastError: row.last_error,
    updatedAt: toDateOrNull(row.updated_at),
  };
}

const DECIMAL_RE = /^-?\d{1,8}(\.\d{1,2})?$/;

/** Cena do `?` parametra ako string; nezmysel sa ticho IGNORUJE (filter odpadne). */
function toPriceParam(value: MoneyString | number | null | undefined): string | null {
  if (value == null) return null;
  const text = typeof value === 'number' ? String(value) : value.trim().replace(',', '.');
  return DECIMAL_RE.test(text) ? text : null;
}

/** Escapuje `LIKE` wildcardy, aby `%` vo vyhľadávaní neznamenal „všetko". */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function normalizeWindowDays(value: number | undefined): number {
  const parsed = Math.trunc(Number(value));
  return ALLOWED_SOLD_WINDOWS.includes(parsed) ? parsed : DEFAULT_SOLD_WINDOW_DAYS;
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Predikáty vedier predajnosti. Výraz `COALESCE(s.units, 0)` sa opakuje, lebo
 * alias zo SELECT-u sa v `WHERE` použiť nedá (a `HAVING` by zabilo `LIMIT`).
 */
const SOLD_BUCKET_SQL: Record<SoldBucket, string> = {
  none: 'COALESCE(s.units, 0) = 0',
  low: 'COALESCE(s.units, 0) BETWEEN 1 AND 2',
  mid: 'COALESCE(s.units, 0) BETWEEN 3 AND 9',
  high: 'COALESCE(s.units, 0) >= 10',
};

const isSoldBucket = (value: unknown): value is SoldBucket =>
  value === 'none' || value === 'low' || value === 'mid' || value === 'high';

interface ResolvedWindow {
  windowDays: number;
  from: DateOnly;
  to: DateOnly;
}

/**
 * Okno predajnosti. Deň sa počíta v `Europe/Bratislava` cez `dates.ts` (D31) —
 * nikdy v UTC, inak by sa medzi 22:00 a 24:00 UTC filtrovalo podľa zajtrajška.
 */
function resolveWindow(filter: CatalogSearchFilter): ResolvedWindow {
  const windowDays = normalizeWindowDays(filter.soldWindowDays);
  const to =
    typeof filter.today === 'string' && DATE_ONLY_RE.test(filter.today)
      ? filter.today
      : todayInZone(new Date());
  // Okno vrátane dnešného dňa: 30 dní = dnes + 29 predchádzajúcich.
  const from = addDays(to, -(windowDays - 1));
  return { windowDays, from, to };
}

interface WhereParts {
  sql: string;
  values: unknown[];
}

/**
 * Zloží `WHERE` časť. Každá hodnota ide ako `?` — do SQL sa neinterpoluje nič
 * okrem počtu placeholderov a konštantných fragmentov z tohto súboru.
 */
function buildWhere(filter: CatalogSearchFilter, includeFacets: boolean): WhereParts {
  const where: string[] = [];
  const values: unknown[] = [];

  const statuses = (filter.shopStatus ?? []).filter(isShopStatus);
  const effectiveStatuses = statuses.length > 0 ? statuses : [...DEFAULT_SHOP_STATUSES];
  where.push(`c.shop_status IN (${effectiveStatuses.map(() => '?').join(', ')})`);
  values.push(...effectiveStatuses);

  if (filter.productIds !== undefined) {
    const unique = [...new Set(filter.productIds.filter(isValidProductId))];
    if (unique.length === 0) {
      // Prázdny výber nie je „bez filtra" — je to prázdny výsledok (fail-closed).
      where.push('1 = 0');
    } else {
      where.push(`c.product_id IN (${unique.map(() => '?').join(', ')})`);
      values.push(...unique);
    }
  }

  const term = (filter.query ?? '').trim();
  if (term.length > 0) {
    if (/^\d{1,9}$/.test(term)) {
      // Celé číslo je buď ID, alebo časť názvu — hľadáme oboje.
      where.push("(c.product_id = ? OR c.name LIKE CONCAT('%', ?, '%') ESCAPE '\\\\')");
      values.push(Number(term), escapeLike(term));
    } else {
      where.push("c.name LIKE CONCAT('%', ?, '%') ESCAPE '\\\\'");
      values.push(escapeLike(term.slice(0, 191)));
    }
  }

  const priceFrom = toPriceParam(filter.priceFrom);
  if (priceFrom !== null) {
    where.push('c.price >= ?');
    values.push(priceFrom);
  }
  const priceTo = toPriceParam(filter.priceTo);
  if (priceTo !== null) {
    where.push('c.price <= ?');
    values.push(priceTo);
  }

  if (includeFacets) {
    const buckets = [...new Set((filter.soldBuckets ?? []).filter(isSoldBucket))];
    if (buckets.length > 0 && buckets.length < 4) {
      where.push(`(${buckets.map((bucket) => SOLD_BUCKET_SQL[bucket]).join(' OR ')})`);
    }
    if (filter.neverDiscounted === true) {
      where.push('d.product_id IS NULL');
    }
    if (filter.currentlyDiscounted === true) {
      where.push('COALESCE(d.now_on, 0) = 1');
    }
  }

  return { sql: where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '', values };
}

/* ═══════════════════════════ 5. Factory ═══════════════════════════════════ */

export interface CatalogRepoDeps {
  /** Výhradne pre testy: spojenie namiesto poolu. */
  defaultConn?: Queryable;
  /**
   * Zdieľaný rozpočet anonymných čítaní. Default je jediná produkčná inštancia
   * (`anonReadBudget`) — vlastné počítadlo si tu nikto nezakladá (A4). Prepis
   * je výhradne pre testy.
   */
  readBudget?: ReadBudget;
}

/** Rozhranie po KONTRAKTE V3 — nadmnožina `CatalogRepo` z kontraktov. */
export interface CatalogRepoExt extends CatalogRepo {
  get(productId: number, conn?: Queryable): Promise<CatalogCacheRecordV3 | null>;
  getMany(productIds: number[], conn?: Queryable): Promise<Map<number, CatalogCacheRecordV3>>;
  upsert(record: CatalogUpsertInput, conn?: Queryable): Promise<void>;
  /** K7: dávkový upsert stránky synchronizácie. Vracia počet zapísaných riadkov. */
  upsertMany(records: CatalogUpsertInput[], conn?: Queryable): Promise<number>;
  /** D49: produkt, ktorý shop nenašiel — ostatné stĺpce zostanú (I11). */
  markShopStatus(
    productId: number,
    status: CatalogShopStatus,
    conn?: Queryable,
  ): Promise<void>;
  search(filter: CatalogSearchFilter, conn?: Queryable): Promise<CatalogSearchResult>;
  counts(filter: CatalogSearchFilter, conn?: Queryable): Promise<CatalogCounts>;
  /**
   * Predajnosť a vlastné zľavy pre konkrétne ID — aj pre produkty, ktoré
   * zrkadlo katalógu ešte nemá (kontrakt UI, bod 26). Čisto čítacie.
   */
  factsFor(
    productIds: readonly number[],
    opts?: { soldWindowDays?: number; today?: DateOnly; conn?: Queryable },
  ): Promise<CatalogFactsResult>;
  /** Koľko riadkov katalóg vôbec má (hlavička „z 40 483 produktov"). */
  totalRows(conn?: Queryable): Promise<number>;
  /** K7: „Dáta k …" — meraný fakt, nie odhad (P7). `null` = katalóg je prázdny. */
  lastFetchedAt(conn?: Queryable): Promise<UtcDate | null>;

  /* ── A2/A4: dvojdňový beh ────────────────────────────────────────────── */

  /** Kde beh skončil. Prázdny pokrok = „ešte sa nezačalo", nikdy výnimka. */
  loadSyncProgress(conn?: Queryable): Promise<CatalogSyncProgress>;
  /** Uloží pokrok (celý riadok naraz — jeden zápis na stránku). */
  saveSyncProgress(progress: CatalogSyncProgress, conn?: Queryable): Promise<void>;
  /**
   * A4 — rezervácia zo ZDIEĽANÉHO denného rozpočtu anonymných čítaní. Volá sa
   * PRED requestom na shop; neúspešný request sa do stropu shopu počíta rovnako
   * ako úspešný.
   */
  reserveShopReads(count?: number): Promise<ReadReservation>;
  /** Stav zdieľaného čítacieho rozpočtu bez rezervovania (pre UI). */
  shopReadBudget(): Promise<ReadBudgetStatus>;
  /** A5 — stav katalógu pre UI a pre agregátor stavu. */
  syncStatus(opts?: { now?: UtcDate; conn?: Queryable }): Promise<CatalogSyncStatus>;
}

export function createCatalogRepo(deps: CatalogRepoDeps = {}): CatalogRepoExt {
  const readBudget = deps.readBudget ?? anonReadBudget;

  const run = async <T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> => {
    const target = conn ?? deps.defaultConn;
    if (target) return (await target.query(sql, values)) as T;
    return poolQuery<T>(sql, values);
  };

  const repo: CatalogRepoExt = {
    async get(productId: number, conn?: Queryable): Promise<CatalogCacheRecordV3 | null> {
      if (!isValidProductId(productId)) return null;
      const rows = await run<CatalogRow[]>(conn, SQL_GET, [productId]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      // Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy.
      return row === undefined ? null : mapRow(row);
    },

    async getMany(
      productIds: number[],
      conn?: Queryable,
    ): Promise<Map<number, CatalogCacheRecordV3>> {
      const result = new Map<number, CatalogCacheRecordV3>();
      const unique = [...new Set(productIds.filter(isValidProductId))];
      if (unique.length === 0) return result;
      // Aj čítanie ide po dávkach — `IN (…)` s desiatimi tisíckami `?` by
      // narazilo na limit parametrov skôr než na limit trpezlivosti.
      for (let start = 0; start < unique.length; start += UPSERT_CHUNK_ROWS) {
        const chunk = unique.slice(start, start + UPSERT_CHUNK_ROWS);
        const placeholders = `(${chunk.map(() => '?').join(', ')})`;
        const rows = await run<CatalogRow[]>(conn, SQL_GET_MANY_PREFIX + placeholders, chunk);
        for (const row of Array.isArray(rows) ? rows : []) {
          const record = mapRow(row);
          result.set(record.productId, record);
        }
      }
      return result;
    },

    async upsert(record: CatalogUpsertInput, conn?: Queryable): Promise<void> {
      if (!isValidProductId(record.productId)) {
        throw new Error(`Neplatné product ID pre catalog_cache: ${String(record.productId)}.`);
      }
      await repo.upsertMany([record], conn);
    },

    /**
     * Dávkový upsert (K7). `shopStatus` je predvolene `ok`: do katalógu sa
     * zapisuje to, čo shop práve vrátil, takže produkt existuje. Produkt,
     * ktorý shop nenašiel, sa označuje `markShopStatus()` (D49), nie tu.
     */
    async upsertMany(records: CatalogUpsertInput[], conn?: Queryable): Promise<number> {
      const valid = records.filter((record) => isValidProductId(record.productId));
      if (valid.length === 0) return 0;

      let written = 0;
      for (let start = 0; start < valid.length; start += UPSERT_CHUNK_ROWS) {
        const chunk = valid.slice(start, start + UPSERT_CHUNK_ROWS);
        const tuples = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const values: unknown[] = [];
        for (const record of chunk) {
          values.push(
            record.productId,
            record.name == null ? null : record.name.slice(0, 255),
            record.price,
            record.hasAttributes ? 1 : 0,
            isShopStatus(record.shopStatus) ? record.shopStatus : 'ok',
            record.source,
            record.fetchedAt ?? new Date(),
            record.raw == null ? null : JSON.stringify(record.raw),
          );
        }
        await run(conn, SQL_UPSERT_PREFIX + tuples + SQL_UPSERT_SUFFIX, values);
        written += chunk.length;
      }
      return written;
    },

    async markShopStatus(
      productId: number,
      status: CatalogShopStatus,
      conn?: Queryable,
    ): Promise<void> {
      if (!isValidProductId(productId)) return;
      if (!isShopStatus(status)) {
        throw new Error(`Neznámy stav produktu v shope: ${String(status)}.`);
      }
      await run(conn, SQL_MARK_SHOP_STATUS, [status, productId]);
    },

    /**
     * Stránkované vyhľadávanie s filtrami. Dva dotazy: `COUNT(*)` a stránka —
     * `SQL_CALC_FOUND_ROWS` je v MariaDB deprecated a v tomto tvare pomalší.
     */
    async search(filter: CatalogSearchFilter, conn?: Queryable): Promise<CatalogSearchResult> {
      const page = Math.max(1, Math.trunc(filter.page ?? 1));
      const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.trunc(filter.perPage ?? 50)));
      const window = resolveWindow(filter);
      const sort = SORT_SQL[filter.sort ?? 'name'] ?? SORT_SQL.name;

      // Poradie parametrov MUSÍ zodpovedať poradiu JOIN-ov v `FROM`.
      const joinValues = [window.from, window.to, window.to, window.to];
      const from = `FROM catalog_cache c ${JOIN_SALES}${JOIN_OWN_DISCOUNTS}`;
      const where = buildWhere(filter, true);

      const countRows = await run<Array<{ total: number | bigint }>>(
        conn,
        `SELECT COUNT(*) AS total ${from}${where.sql}`,
        [...joinValues, ...where.values],
      );
      const total = Array.isArray(countRows) ? Number(countRows[0]?.total ?? 0) : 0;

      const dataSql =
        `SELECT ${COLUMNS.replace(/(^|, )/g, '$1c.')}, ` +
        'COALESCE(s.units, 0) AS units_sold, ' +
        'CASE WHEN d.product_id IS NULL THEN 0 ELSE 1 END AS ever_discounted, ' +
        'COALESCE(d.now_on, 0) AS discounted_now ' +
        `${from}${where.sql} ORDER BY ${sort} LIMIT ? OFFSET ?`;

      const rows = await run<SearchRow[]>(conn, dataSql, [
        ...joinValues,
        ...where.values,
        perPage,
        (page - 1) * perPage,
      ]);

      return {
        data: (Array.isArray(rows) ? rows : []).map(mapSearchRow),
        page,
        perPage,
        total,
        soldWindowDays: window.windowDays,
        soldFrom: window.from,
        soldTo: window.to,
        lockedFilters: [...LOCKED_FILTERS],
      };
    },

    /**
     * Čísla do bočného panela. Vedrá predajnosti a história zliav sa počítajú
     * BEZ vlastných facetových filtrov (inak by zaškrtnuté vedro vynulovalo
     * počty ostatných), ale S filtrami ceny, textu a stavu — presne tak, ako
     * to bočný panel v `design/v3/produkty.html` ukazuje.
     */
    async counts(filter: CatalogSearchFilter, conn?: Queryable): Promise<CatalogCounts> {
      const window = resolveWindow(filter);
      const joinValues = [window.from, window.to, window.to, window.to];
      const from = `FROM catalog_cache c ${JOIN_SALES}${JOIN_OWN_DISCOUNTS}`;
      const where = buildWhere(filter, false);

      const sql =
        'SELECT COUNT(*) AS total, ' +
        'SUM(CASE WHEN COALESCE(s.units, 0) = 0 THEN 1 ELSE 0 END) AS sold_none, ' +
        'SUM(CASE WHEN COALESCE(s.units, 0) BETWEEN 1 AND 2 THEN 1 ELSE 0 END) AS sold_low, ' +
        'SUM(CASE WHEN COALESCE(s.units, 0) BETWEEN 3 AND 9 THEN 1 ELSE 0 END) AS sold_mid, ' +
        'SUM(CASE WHEN COALESCE(s.units, 0) >= 10 THEN 1 ELSE 0 END) AS sold_high, ' +
        'SUM(CASE WHEN d.product_id IS NULL THEN 1 ELSE 0 END) AS never_discounted, ' +
        'SUM(CASE WHEN COALESCE(d.now_on, 0) = 1 THEN 1 ELSE 0 END) AS discounted_now ' +
        `${from}${where.sql}`;

      const rows = await run<Array<Record<string, number | bigint | null>>>(conn, sql, [
        ...joinValues,
        ...where.values,
      ]);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      const num = (key: string): number => Number(row?.[key] ?? 0);

      return {
        total: num('total'),
        sold: {
          none: num('sold_none'),
          low: num('sold_low'),
          mid: num('sold_mid'),
          high: num('sold_high'),
        },
        neverDiscounted: num('never_discounted'),
        discountedNow: num('discounted_now'),
        soldWindowDays: window.windowDays,
        soldFrom: window.from,
        soldTo: window.to,
        lockedFilters: [...LOCKED_FILTERS],
      };
    },

    /**
     * Čísla z vlastných tabuliek pre zoznam ID. Dva dotazy PO SEBE, nie
     * `Promise.all`: rovnaký dôvod ako v `syncStatus()` — dve súbežné spojenia
     * z poolu (default 8) na požiadavku, ktorú vyvolá každé hľadanie, sú horší
     * obchod než jednotky milisekúnd navyše.
     */
    async factsFor(
      productIds: readonly number[],
      opts: { soldWindowDays?: number; today?: DateOnly; conn?: Queryable } = {},
    ): Promise<CatalogFactsResult> {
      const window = resolveWindow({
        ...(opts.soldWindowDays !== undefined ? { soldWindowDays: opts.soldWindowDays } : {}),
        ...(opts.today !== undefined ? { today: opts.today } : {}),
      });
      const empty: CatalogFactsResult = {
        facts: new Map<number, CatalogProductFacts>(),
        soldWindowDays: window.windowDays,
        soldFrom: window.from,
        soldTo: window.to,
      };

      const unique = [...new Set(productIds.filter(isValidProductId))];
      if (unique.length === 0) return empty;

      const facts = empty.facts;
      const touch = (productId: number): CatalogProductFacts => {
        const existing = facts.get(productId);
        if (existing !== undefined) return existing;
        const created: CatalogProductFacts = {
          unitsSold: 0,
          everDiscounted: false,
          discountedNow: false,
        };
        facts.set(productId, created);
        return created;
      };

      // Dávkovanie z rovnakého dôvodu ako v `getMany()`: `IN (…)` s tisíckami
      // `?` narazí na limit parametrov. Volajúci sem posiela desiatky ID, nie
      // tisíce — dávka je poistka, nie očakávaný stav.
      for (let start = 0; start < unique.length; start += UPSERT_CHUNK_ROWS) {
        const chunk = unique.slice(start, start + UPSERT_CHUNK_ROWS);
        const placeholders = `(${chunk.map(() => '?').join(', ')})`;

        const salesRows = await run<Array<{ product_id: number; units: number | string | null }>>(
          opts.conn,
          SQL_FACTS_SALES_PREFIX + placeholders + SQL_FACTS_SALES_SUFFIX,
          [window.from, window.to, ...chunk],
        );
        for (const row of Array.isArray(salesRows) ? salesRows : []) {
          touch(Number(row.product_id)).unitsSold = Number(row.units ?? 0);
        }

        const discountRows = await run<
          Array<{ product_id: number; now_on: number | string | null }>
        >(
          opts.conn,
          SQL_FACTS_DISCOUNTS_PREFIX + placeholders + SQL_FACTS_DISCOUNTS_SUFFIX,
          [window.to, window.to, ...chunk],
        );
        for (const row of Array.isArray(discountRows) ? discountRows : []) {
          const entry = touch(Number(row.product_id));
          // Riadok v `campaign_items` so stavom `ok` JE ten úspešný zápis —
          // preto `everDiscounted` bez ohľadu na to, či okno práve beží.
          entry.everDiscounted = true;
          entry.discountedNow = Number(row.now_on ?? 0) === 1;
        }
      }

      return { ...empty, facts };
    },

    async totalRows(conn?: Queryable): Promise<number> {
      const rows = await run<Array<{ total: number | bigint }>>(conn, SQL_TOTAL_ROWS, []);
      return Array.isArray(rows) ? Number(rows[0]?.total ?? 0) : 0;
    },

    async lastFetchedAt(conn?: Queryable): Promise<UtcDate | null> {
      const rows = await run<Array<{ last_fetched: Date | string | null }>>(
        conn,
        SQL_LAST_FETCHED,
        [],
      );
      const value = Array.isArray(rows) ? rows[0]?.last_fetched : null;
      return value == null ? null : toDate(value);
    },

    /* ── A2/A4: dvojdňový beh ──────────────────────────────────────────── */

    async loadSyncProgress(conn?: Queryable): Promise<CatalogSyncProgress> {
      const rows = await run<ProgressRow[]>(conn, SQL_PROGRESS_GET, []);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      // Chýbajúci riadok nie je chyba: migrácia ho síce zakladá, ale „ešte sa
      // nezačalo" je platný stav a beh z neho vie vyjsť (začne od stránky 1).
      return row === undefined ? emptyCatalogProgress() : mapProgressRow(row);
    },

    async saveSyncProgress(progress: CatalogSyncProgress, conn?: Queryable): Promise<void> {
      await run(conn, SQL_PROGRESS_SAVE, [
        Math.max(1, Math.trunc(progress.perPage)),
        Math.max(0, Math.trunc(progress.lastPage)),
        progress.shopTotal === null ? null : Math.max(0, Math.trunc(progress.shopTotal)),
        Math.max(0, Math.trunc(progress.rowsWritten)),
        progress.completed ? 1 : 0,
        progress.startedAt,
        progress.lastReadAt,
        progress.finishedAt,
        progress.pausedUntil,
        progress.pauseReason,
        // I1 — do `last_error` ide KÓD, nikdy obsah odpovede shopu; orez je
        // poistka proti stĺpcu `VARCHAR(200)`, nie filter obsahu.
        progress.lastError === null ? null : progress.lastError.slice(0, 200),
      ]);
    },

    reserveShopReads(count = 1): Promise<ReadReservation> {
      return readBudget.reserve(count);
    },

    shopReadBudget(): Promise<ReadBudgetStatus> {
      return readBudget.status();
    },

    /**
     * A5 — jeden dotaz do sveta pre celé UI: koľko z koľkých, kedy naposledy,
     * kedy ďalšia dávka, prečo sa čaká a dokedy to potrvá.
     *
     * Odhad je zámerne hrubý (presnosť na deň): denný strop čítaní je tvrdý,
     * takže o dokončení rozhodujú DNI, nie minúty. Presnejší odhad by bol
     * presnejšie vyzerajúce klamstvo.
     *
     * DOTAZY IDÚ PO JEDNOM, NIE V `Promise.all`. Endpoint `GET /api/status` sa
     * volá z každej obrazovky pri každom obnovení a tri súbežné dotazy si berú
     * tri spojenia z poolu (`DB_CONNECTION_LIMIT`, default 8) namiesto jedného.
     * Dve otvorené karty a pool je na hrane presne vtedy, keď má appka povedať,
     * čo sa deje. Séria je tu o jednotky milisekúnd pomalšia a o tri spojenia
     * lacnejšia.
     */
    async syncStatus(opts: { now?: UtcDate; conn?: Queryable } = {}): Promise<CatalogSyncStatus> {
      const now = opts.now ?? new Date();
      const conn = opts.conn;

      const loadedProducts = await repo.totalRows(conn);
      const lastFetchedAt = await repo.lastFetchedAt(conn);
      const progress = await repo.loadSyncProgress(conn);
      const reads = await readBudget.status();

      const perPage = Math.max(1, progress.perPage);
      const shopTotalProducts = progress.shopTotal;
      const pagesTotal =
        shopTotalProducts === null ? null : Math.max(1, Math.ceil(shopTotalProducts / perPage));

      /**
       * OBNOVA NIE JE CHÝBAJÚCI KATALÓG.
       *
       * `pagesDone` je pokrok AKTUÁLNEHO prechodu, `loadedProducts` je `COUNT(*)`
       * za celý katalóg. Po dokončenom prechode začína obnova od stránky 0, takže
       * holý rozdiel `pagesTotal - pagesDone` tvrdil, že appke chýba celý katalóg,
       * ktorý má na disku — a karta vedľa seba ukázala „0 chýba" aj „411 stránok
       * ostáva, ešte 2 dni". Keď máme aspoň toľko riadkov, koľko shop hlási,
       * nechýba ani stránka; prechod len osviežuje ceny.
       */
      const refreshing =
        !progress.completed &&
        shopTotalProducts !== null &&
        shopTotalProducts > 0 &&
        loadedProducts >= shopTotalProducts;

      const pagesDone = progress.completed ? (pagesTotal ?? progress.lastPage) : progress.lastPage;
      const pagesLeft =
        pagesTotal === null ? null : refreshing ? 0 : Math.max(0, pagesTotal - pagesDone);

      const paused =
        progress.pausedUntil !== null && progress.pausedUntil.getTime() > now.getTime();

      /**
       * NEZNÁME POČÍTADLO NIE JE MINUTÝ ROZPOČET (A4, I11).
       *
       * `reads.exhausted` je pri `known: false` fail-closed domnienka: nečítať je
       * správne, ale hlásiť „dnešný rozpočet je vyčerpaný" znamená tvrdiť číslo,
       * ktoré appka nepozná — počítadlo môže stáť na 12 z 240. Dôvod čakania sa
       * preto uvádza len z prečítaného stavu; neprečítané počítadlo má vlastnú
       * prekážku (`catalog_reads_day_exhausted` s `assumed: true`), ktorá to
       * povie ako domnienku.
       */
      const budgetSpent = reads.known && reads.exhausted;

      const waiting: CatalogWaitingReason | null = progress.completed
        ? 'catalog_complete'
        : paused
          ? (progress.pauseReason ?? 'rate_limited')
          : budgetSpent
            ? 'daily_budget'
            : null;

      const nextBatchAt: UtcDate | null = progress.completed
        ? null
        : paused
          ? progress.pausedUntil
          : budgetSpent
            ? reads.resetAt
            : null;

      /**
       * Koľko ďalších UTC dní to potrvá. `0` = dočíta sa ešte dnes, `null` =
       * nevieme, z koľkých stránok (shop zatiaľ nepovedal `total`) — a vtedy sa
       * odhad NEVYMÝŠĽA (I11). Rovnako sa nevymýšľa z neprečítaného počítadla:
       * fail-closed `remaining: 0` by aj pri jednej chýbajúcej stránke tvrdilo
       * „ešte deň".
       */
      let estimatedDaysLeft: number | null = null;
      if (progress.completed || refreshing) estimatedDaysLeft = 0;
      else if (pagesLeft !== null && reads.known) {
        estimatedDaysLeft = readDaysNeeded(pagesLeft, reads.remaining, reads.limit);
      }

      // Odhad dokončenia s presnosťou na deň: `0` je koniec dnešného UTC dňa
      // (`reads.resetAt` je najbližšia polnoc UTC), každý ďalší deň o 24 h viac.
      // Pri dočítanom katalógu to nie je odhad, ale meraný čas dokončenia.
      // Pri obnove nie je čo dokončovať — katalóg už je celý, preto `null`;
      // vetu o obnove nesie `refreshing`, nie vymyslený dátum.
      let estimatedFinishAt: UtcDate | null = progress.finishedAt;
      if (refreshing) {
        estimatedFinishAt = null;
      } else if (!progress.completed) {
        estimatedFinishAt =
          estimatedDaysLeft === null
            ? null
            : new Date(reads.resetAt.getTime() + Math.max(0, estimatedDaysLeft - 1) * 86_400_000);
      }

      return {
        loadedProducts,
        shopTotalProducts,
        percent:
          shopTotalProducts === null || shopTotalProducts <= 0
            ? null
            : Math.min(100, Math.round((loadedProducts / shopTotalProducts) * 100)),
        complete: progress.completed,
        refreshing,
        lastFetchedAt,
        lastReadAt: progress.lastReadAt,
        pagesDone,
        pagesTotal,
        pagesLeft,
        perPage,
        reads,
        waiting,
        nextBatchAt,
        estimatedDaysLeft,
        estimatedFinishAt,
        lastError: progress.lastError,
        progress,
      };
    },
  };

  return repo;
}

/** Singleton pre route-y a engine preview. */
export const catalogRepo: CatalogRepoExt = createCatalogRepo();
