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
 *
 * KPI PRODUKTU (sekcia 6, 28. 8. 2026 — D114 v revízii D117–D119)
 * ---------------------------------------------------------------
 * Pribudla druhá čítacia strana: KPI riadku produktu. Miešajú sa v nej DVA
 * zdroje a ten rozdiel je celý dôvod, prečo je to napísané tu a nie v repozitári:
 *
 *   · obohatenie z `GET /api/products/getFull` (cena, marža €/%, aktívna zľava,
 *     sklad, celkovo predané, posledný predaj, referencia, dodávateľ) — číta ho
 *     `catalogRepo.kpiRowsFor()`,
 *   · vlastné denné predaje (kusy za okno 30 a 90 dní) — číta ich SQL nižšie,
 *     a to VÝHRADNE za dni so `status = 'complete'`.
 *
 * Tri veci z hlavičky vyššie sa tým NEMENIA a treba ich čítať doslova:
 *
 *  1. **Účtovná obrátkovosť sa stále vypočítať NEDÁ.** `getFull` dodal nákupnú
 *     cenu (teda COGS na kus) aj sklad na úrovni produktu, ale sklad je JEDINÁ
 *     MOMENTKA, nie priemer za obdobie — a bez priemernej zásoby je
 *     `(Ø zásoba × dní) / COGS` vymyslené číslo. Preto sa pomer
 *     `qty_in_orders / qty` menuje `soldPerStock` a NIE menom účtovnej metriky
 *     — ani v kóde, ani na povrchu (stráži to `test/unit/sales-insights.spec.ts`,
 *     ktorý anglický názov tej metriky v tomto súbore zakazuje). D119 pod
 *     „obrátkovosťou" myslí práve tie merané fakty, nie účtovnú metriku.
 *  2. **Peniaze na produkt neexistujú.** Sonda 28. 8. 2026 potvrdila, že
 *     `order/get` vracia položky ako `{id, qty}` bez ceny (D117), takže KPI
 *     nesie marže a ceny z `getFull`, ale obrat na produkt NIE. Za okno sa
 *     počítajú výhradne KUSY.
 *  3. **Sieť tu nie je.** KPI čítajú len lokálnu DB (K8) — obrazovka nesmie pri
 *     renderi volať shop.
 */
import type {
  CatalogEnrichmentRecord,
  DateOnly,
  DbRow,
  KpiActiveDiscount,
  KpiGap,
  KpiNoSale,
  KpiValue,
  KpiWindowCoverage,
  KpiWindowUnits,
  ProductKpiPage,
  ProductKpiRow,
  ProductSalesDay,
  ProductSalesMetrics,
  Queryable,
  SalesCoverage,
  SalesDayCoverage,
  SalesSyncDay,
  UtcDate,
} from '@/contracts';

import { query as poolQuery } from '@/db/pool';
import { addDays, diffDays, isDateOnly, todayInZone } from '@/lib/domain/dates';
import type { CatalogKpiRow, CatalogRepoExt } from '@/lib/repo/catalog.repo';
import { catalogRepo } from '@/lib/repo/catalog.repo';
import type { SalesRepoContract } from '@/lib/repo/sales.repo';
import { salesRepo } from '@/lib/repo/sales.repo';
import type { SalesStopRecord } from '@/lib/sales/stop-policy';
import { MAX_SALES_WINDOW_DAYS } from '@/lib/sales/windows';

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

/** Dni, o ktorých appka NIEČO vie. `pending` je „ešte sa nesťahovalo". */
const TOUCHED_STATUSES: ReadonlySet<SalesSyncDay['status']> = new Set(['complete', 'partial']);

/**
 * Zmeral tento deň appka, alebo sa ho len dotkla?
 *
 * `complete` je meranie aj s nulou: appka deň prečítala celý a nič sa nepredalo.
 * `partial` je meranie len vtedy, keď z neho prečítala aspoň jednu objednávku;
 * `partial` s nulou znamená, že beh spadol skôr, než čokoľvek priniesol.
 *
 * Prečo na tom záleží: 24. 8. 2026 mala appka v `product_sales_daily` dva dni
 * (5. a 6. 8., 1073 kusov) a v `sales_sync_state` ďalších štrnásť dní
 * `partial / orders_seen = 0` — dni, ktoré shop odmietol. Kým sa počítali ako
 * pokryté, `unitsPerDay` sa delilo šestnástimi namiesto dvoma a KAŽDÉ číslo
 * o predajnosti bolo zhruba osemkrát nižšie než to, čo sa naozaj zmeralo.
 *
 * `ordersSeen === undefined` je „nevieme" a vyhodnocuje sa PRÍSNEJŠIE: deň sa
 * za zmeraný nepovažuje. Neoverené nie je to isté ako overene v poriadku.
 */
function isMeasuredDay(row: SalesSyncDay): boolean {
  if (row.status === 'complete') return true;
  if (row.status !== 'partial') return false;
  return typeof row.ordersSeen === 'number' && row.ordersSeen > 0;
}

/* ═══════════════════════════ 2. Pomocníci ═════════════════════════════════ */

async function run<T>(conn: Queryable | undefined, sql: string, values: unknown[]): Promise<T> {
  if (conn) return conn.query<T>(sql, values);
  return poolQuery<T>(sql, values);
}

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * `DATE` chodí z drivera ako `Date` aj ako string — chceme vždy `YYYY-MM-DD`.
 *
 * ČÍTAJÚ SA **LOKÁLNE** ZLOŽKY, NIE `toISOString()`
 * ------------------------------------------------
 * `DATE` je kalendárny deň bez zóny a pool ho dáva ako LOKÁLNU polnoc
 * (`2026-08-31` → `2026-08-30T22:00:00.000Z` v Európe/Bratislave, `timezone: 'Z'`
 * to nemení — pozri docblock v `src/db/pool.ts`). `toISOString().slice(0, 10)`
 * z toho preto urobí `2026-08-30` a KAŽDÝ deň predajov sa posunie o jeden
 * dozadu — v pásme východne od UTC vždy, západne nikdy.
 *
 * Kým to tu bolo takto, `syncDays()` hlásil pokrytie o deň skôr, než sa naozaj
 * stiahlo: posledný dočítaný deň každého okna vychádzal ako `missing`, takže
 * `upliftFor()` odpovedal `coverage_gap` na okno, ktoré pokryté BOLO. Číslo sa
 * nepokazilo — appka priznávala nevedomosť, ktorú nemala (I11 v opačnom smere),
 * a pri ktoromkoľvek posune okna by to isté zaokrúhlenie mohlo padnúť aj na
 * stranu tvrdenia.
 *
 * Rovnaký prepis (a rovnaký dôvod) je v `repo/sales.repo.ts`,
 * `repo/campaigns.repo.ts` a `repo/catalog.repo.ts`. Tento súbor bol jediný,
 * ktorý ho nemal.
 */
function toDay(value: unknown): DateOnly {
  if (value instanceof Date) {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` as DateOnly;
  }
  return String(value ?? '').slice(0, 10) as DateOnly;
}

function toDateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoOrNull(value: unknown): string | null {
  return toDateOrNull(value)?.toISOString() ?? null;
}

/** Fail-closed sanitácia ID: nečíselný vstup sa nikdy nedostane do dotazu. */
const isValidId = (id: number): boolean => Number.isInteger(id) && id > 0;

/** Zaokrúhlenie na dve desatinné miesta — kusy na deň sú zlomok, nie ilúzia. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/* ═══════════════════════════════ 3. SQL ═══════════════════════════════════ */

const SQL_SYNC_DAYS =
  'SELECT sale_day, status, orders_seen, finished_at, updated_at FROM sales_sync_state ' +
  'ORDER BY sale_day ASC LIMIT ?';

/**
 * Posledné slovo shopu o objednávkach + odkedy stojí nevyriešená chyba.
 *
 * Prečo to nečíta `salesRepo.getSyncState(den)`: spúšťač predajnosti sa pýta
 * „stojí to na niečom?", a nie „ako dopadol konkrétny deň" — deň, na ktorom sa
 * to zastavilo, sa s posúvajúcim sa oknom mení každý deň (7. 8. → 18. 8. 2026
 * je dvanásť rôznych dní s tým istým kódom).
 *
 * `last_code` je kód z naposledy dotknutého dňa: keď posledný beh prešiel,
 * je `NULL` a prekážka tým padá. `since` je najstarší deň, ktorý kód STÁLE
 * nesie — dopočítaný deň si `last_error` prepíše na `NULL`, takže sa do neho
 * nezapočíta dávno vyriešená chyba.
 */
const SQL_SYNC_STOP =
  'SELECT ' +
  '(SELECT last_error FROM sales_sync_state ORDER BY updated_at DESC, sale_day DESC LIMIT 1) ' +
  'AS last_code, ' +
  '(SELECT MAX(updated_at) FROM sales_sync_state) AS last_at, ' +
  '(SELECT MIN(updated_at) FROM sales_sync_state WHERE last_error IS NOT NULL) AS since';

/**
 * Súčet PREDANÝCH KUSOV produktov jednej zľavy za obdobie.
 *
 * Join na `campaign_items` zámerne nahrádza zoznam ID v `IN (…)`: zľava má aj
 * 8 000 položiek a taký dotaz by bol neúnosný a krehký.
 *
 * POZOR, čo to NIE JE: nie sú to tržby. `product_sales_daily` drží výhradne
 * počty kusov — appka cenu predaja nikdy nevidela a násobiť kusy dnešnou
 * cenníkovou cenou by vyrobilo číslo, ktoré vyzerá ako tržba, ale nie je ňou
 * (K8: appka nesmie predstierať dáta, ktoré nemá).
 */
const SQL_CAMPAIGN_UNITS =
  'SELECT COALESCE(SUM(s.units_sold), 0) AS units ' +
  'FROM product_sales_daily s ' +
  'JOIN campaign_items i ON i.product_id = s.product_id AND i.campaign_id = ? ' +
  'WHERE s.sale_day BETWEEN ? AND ?';

/**
 * DENNÉ kusy VŠETKÝCH produktov jednej zľavy (D127 bod 4).
 *
 * Prečo denne a nie jedným súčtom ako `SQL_CAMPAIGN_UNITS`: účinnosť zľavy sa
 * počíta nad DVOMA oknami a to, či sa vôbec smie spočítať, rozhoduje pokrytie
 * po dňoch. Jeden súčet za okno by tú otázku už neuniesol — z okna, ktorému
 * chýbajú tri dni, by vyšlo číslo, ktoré vyzerá ako súčet okna.
 *
 * `JOIN campaign_items` nemôže zdvojiť riadok: `uq_items_campaign_product`
 * (migrácia 0005) drží jeden produkt v jednej zľave najviac raz.
 *
 * Stav sťahovania sa TU nefiltruje ZÁMERNE — o tom, ktoré dni sú dočítané,
 * rozhoduje `upliftFor()` cez `sales_sync_state`, a to na jednom mieste. Keby
 * sa nedočítané dni odrezali už tu, vyzerali by ako dni s nulou.
 *
 * A ako všade v tomto module: sú to KUSY, nie eurá (D117, I11).
 */
const SQL_CAMPAIGN_DAILY_UNITS =
  'SELECT s.sale_day, COALESCE(SUM(s.units_sold), 0) AS units ' +
  'FROM product_sales_daily s ' +
  'JOIN campaign_items i ON i.product_id = s.product_id AND i.campaign_id = ? ' +
  'WHERE s.sale_day BETWEEN ? AND ? ' +
  'GROUP BY s.sale_day ORDER BY s.sale_day ASC LIMIT ?';

const SQL_DAILY_UNITS_PREFIX =
  'SELECT product_id, sale_day, units_sold FROM product_sales_daily ' +
  'WHERE sale_day >= ? AND sale_day <= ? AND product_id IN ';

/**
 * KPI: predané kusy za KRÁTKE aj DLHÉ okno, jedným dotazom na celú stránku
 * produktov (D114, D119).
 *
 * `JOIN sales_sync_state … status = 'complete'` je celý zmysel tohto dotazu a
 * NIE JE to optimalizácia. Bez neho `SUM(units_sold)` ticho sčíta stiahnuté aj
 * nestiahnuté dni do jedného čísla, ktoré vyzerá ako súčet okna — a to je presne
 * tá lož, ktorú I11 zakazuje. `INNER JOIN` znamená, že deň, ktorý nie je
 * dočítaný, do sumy neprispeje ani nulou: v okne o ňom nevieme nič a povie to
 * `unknownDays` (viď `windowCoverage()`).
 *
 * `partial` deň je z rovnakého dôvodu VONKU. Jeho kusy sú len časť dňa a
 * pripočítať ich by znamenalo vydávať dolnú hranicu dňa za deň.
 *
 * Krátke okno je poddotazom TOHO ISTÉHO prechodu (`CASE WHEN sale_day >= ?`),
 * nie druhým dotazom: 30 dní je podmnožina 90 dní, takže druhé čítanie tých
 * istých riadkov by bola len druhá príležitosť, ako sa rozísť s prvým.
 */
const SQL_KPI_UNITS_PREFIX =
  'SELECT s.product_id, ' +
  'SUM(CASE WHEN s.sale_day >= ? THEN s.units_sold ELSE 0 END) AS units_short, ' +
  'SUM(s.units_sold) AS units_long ' +
  'FROM product_sales_daily s ' +
  "JOIN sales_sync_state t ON t.sale_day = s.sale_day AND t.status = 'complete' " +
  'WHERE s.sale_day >= ? AND s.sale_day <= ? AND s.product_id IN ';

const SQL_KPI_UNITS_SUFFIX = ' GROUP BY s.product_id';

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
      status: TOUCHED_STATUSES.has(status as SalesSyncDay['status'])
        ? (status as SalesSyncDay['status'])
        : 'pending',
      finishedAt: toIsoOrNull(row.finished_at),
      updatedAt: toIsoOrNull(row.updated_at),
      ordersSeen: Math.max(0, Math.trunc(num(row.orders_seen))),
    });
  }
  return out;
}

/**
 * Na čom stojí synchronizácia predajnosti — jeden riadok pre `sync-runner.ts`.
 *
 * Vracia surové fakty, NIE rozhodnutie: čo z nich vyplýva, hovorí čistý modul
 * `lib/sales/stop-policy.ts`. Prázdna tabuľka vráti samé `null`, teda „nič
 * nestojí" — appka ešte nikdy nebežala a to prekážka nie je.
 */
export async function latestSyncStop(conn?: Queryable): Promise<SalesStopRecord> {
  const rows = await run<DbRow[]>(conn, SQL_SYNC_STOP, []);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (row === undefined) return { code: null, at: null, since: null };
  const code = typeof row.last_code === 'string' && row.last_code.length > 0 ? row.last_code : null;
  return { code, at: toDateOrNull(row.last_at), since: toDateOrNull(row.since) };
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

/**
 * Koľko kusov produktov tejto zľavy sa predalo v danom okne.
 *
 * Vracia `null`, keď okno nie je platné — nie 0. Nula znamená „nepredalo sa
 * nič", `null` znamená „nevieme", a v UI sa tie dve veci NESMÚ zliať.
 */
export async function campaignUnits(
  campaignId: number,
  from: DateOnly,
  to: DateOnly,
  conn?: Queryable,
): Promise<number | null> {
  if (!isValidId(campaignId)) return null;
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) return null;

  const rows = await run<DbRow[]>(conn, SQL_CAMPAIGN_UNITS, [campaignId, from, to]);
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (first === undefined) return null;
  return Math.max(0, Math.trunc(num(first.units)));
}

/** Jeden deň zľavy: kalendárny deň a kusy VŠETKÝCH jej produktov spolu. */
export interface CampaignDayUnits {
  day: DateOnly;
  units: number;
}

/**
 * Denná krivka kusov pre celú zľavu — podklad účinnosti (D127 bod 4).
 *
 * Vracia LEN dni, v ktorých sa niečo predalo. Deň, ktorý v odpovedi CHÝBA, nie
 * je „nula": môže to byť dočítaný deň bez predaja aj deň, ktorý sa nesťahoval,
 * a rozdiel medzi nimi vie povedať výhradne `sales_sync_state`. Preto sa tie
 * dve veci rozlišujú až tam, kde je pokrytie po ruke (`upliftFor()`), a nikdy
 * sa tu nedopĺňa rad nulami.
 *
 * Nezmyselný rozsah alebo ID dotaz vôbec nespustí (fail-closed).
 */
export async function campaignDailyUnits(
  campaignId: number,
  from: DateOnly,
  to: DateOnly,
  conn?: Queryable,
): Promise<CampaignDayUnits[]> {
  if (!isValidId(campaignId)) return [];
  if (!isDateOnly(from) || !isDateOnly(to) || from > to) return [];

  const rows = await run<DbRow[]>(conn, SQL_CAMPAIGN_DAILY_UNITS, [
    campaignId,
    from,
    to,
    MAX_SYNC_DAYS,
  ]);
  const out: CampaignDayUnits[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const day = toDay(row.sale_day);
    if (!isDateOnly(day)) continue;
    out.push({ day, units: Math.max(0, Math.trunc(num(row.units))) });
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
 *
 * POKRYTIE JE MERANIE, NIE DOTYK. Do `daysCovered`, `from` a `to` ide len deň,
 * ktorý prešiel cez `isMeasuredDay()`. Deň, ktorý sa začal a hneď spadol
 * (`partial` s nulou objednávok), je dotyk bez merania a v pokrytí nemá čo
 * hľadať — inak sa ním delí priemer a appka ukazuje čísla, ktoré nezmerala.
 * `lastSyncedAt` sa toho NETÝKA: ten hovorí, kedy sa appka naposledy pokúsila,
 * a pokus je pokus aj vtedy, keď nič nepriniesol.
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
    if (!isMeasuredDay(row)) continue;
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

/* ══════════ 6. KPI produktu (D114 v revízii D117–D119, I11) ══════════════ */

/** Krátke okno KPI — D114 „predané ks 30 d". */
export const KPI_WINDOW_SHORT_DAYS = 30;
/** Dlhé okno KPI — D114 „ks 90 d"; z neho vzniká aj značka „bez predaja". */
export const KPI_WINDOW_LONG_DAYS = 90;
/**
 * Strop okna — presne najdlhšie okno, ktoré appka ponúka (`lib/sales/windows.ts`).
 *
 * Do 3. 9. 2026 tu stálo `400` s poznámkou „viac než najdlhšie okno, ktoré UI
 * ponúka". Bola to druhá kópia tej istej vedomosti a mlčala by: keby zoznam
 * okien niekto rozšíril nad 400 dní, `clampWindowDays()` by okno TICHO skrátil
 * a odpoveď by nesla iné `windowDays`, než o aké obrazovka požiadala. Odvodením
 * sa z toho stane nemožnosť, nie disciplína.
 */
const MAX_KPI_WINDOW_DAYS = MAX_SALES_WINDOW_DAYS;
/** Strop jednej strany KPI. UI stránkuje po 100; 500 je poistka, nie plán. */
const MAX_KPI_PRODUCTS = 500;

const kpiKnown = <T>(value: T): KpiValue<T> => ({ value, gap: null });
const kpiMissing = <T>(gap: KpiGap): KpiValue<T> => ({ value: null, gap });

/**
 * Hodnota z obohatenia — a keď chýba, DÔVOD prečo (I11).
 *
 * Dva dôvody, ktoré sa nesmú zliať: `not_enriched` znamená, že `getFull` sa na
 * produkt nikdy nepýtalo (kvóta ~200/deň, D118), `shop_has_none` znamená, že
 * pýtalo a shop o tom poli nič nevie. Prvý sa rieši otvorením produktu, druhý
 * sa nerieši vôbec — a nula nie je odpoveď ani na jeden.
 *
 * Porovnania sú EXPLICITNE proti `null`: `!value` by z vypredaného produktu
 * (`qty === 0`) urobilo neznámy sklad a Turbopack taký guard v tomto repe už
 * raz zahodil ako compile-time falsy.
 */
function fromEnrichment<T>(enrichedAt: UtcDate | null, value: T | null): KpiValue<T> {
  if (enrichedAt === null) return kpiMissing('not_enriched');
  return value === null ? kpiMissing('shop_has_none') : kpiKnown(value);
}

/**
 * Beží na produkte zľava PODĽA SHOPU v deň `today`?
 *
 * Porovnáva sa po DŇOCH, nie po okamihoch, a to zámerne: shop posiela
 * `reduction_from`/`reduction_to` ako dátum s hodinami a keby sa `to` bralo ako
 * presný okamih (typicky polnoc koncového dňa), zľava, ktorá celý ten deň beží,
 * by od druhej sekundy po polnoci vyzerala ako `ended`. Deň sa počíta v zóne
 * logiky cez `todayInZone()` (D31), NIKDY v UTC — inak by sa medzi 22:00 a
 * 24:00 UTC posudzovalo voči zajtrajšku. Je to tá istá dohoda, akú má
 * `campaigns.date_from/date_to` (okno je vrátane oboch krajných dní).
 *
 * `state === 'none'` je MERANÝ FAKT („shop povedal, že nič nebeží"), kým
 * `unknown` je nevedomosť. `measuredAt` hovorí, kedy to bolo zmerané — bez neho
 * by obrazovka tvrdila, že pozná stav zľavy v shope TERAZ (I11).
 */
export function kpiActiveDiscount(
  enrichment: CatalogEnrichmentRecord,
  today: DateOnly,
): KpiActiveDiscount {
  const { enrichedAt, reductionPercent, reductionFrom, reductionTo } = enrichment;

  if (enrichedAt === null) {
    return {
      state: 'unknown',
      activePercent: kpiMissing('not_enriched'),
      reportedPercent: kpiMissing('not_enriched'),
      from: null,
      to: null,
      measuredAt: null,
    };
  }

  // Všetky tri naraz `null` je jediná veta, ktorú shop o „žiadnej zľave" hovorí
  // (kontrakt `CatalogEnrichmentRecord`). Preto `none`, nie `unknown`.
  if (reductionPercent === null && reductionFrom === null && reductionTo === null) {
    return {
      state: 'none',
      activePercent: kpiMissing('shop_has_none'),
      reportedPercent: kpiMissing('shop_has_none'),
      from: null,
      to: null,
      measuredAt: enrichedAt,
    };
  }

  // Nekonzistentná trojica: zápisová strana ju neukládá (`isReductionStorable`),
  // takže sem sa dostať nemá. Keď sa dostane, je to NEVEDOMOSŤ — dopočítať si
  // chýbajúcu hranicu okna by znamenalo vymyslieť si stav zľavy v produkcii.
  if (reductionPercent === null || reductionFrom === null || reductionTo === null) {
    return {
      state: 'unknown',
      activePercent: kpiMissing('shop_has_none'),
      reportedPercent: kpiMissing('shop_has_none'),
      from: reductionFrom,
      to: reductionTo,
      measuredAt: enrichedAt,
    };
  }

  const fromDay = todayInZone(reductionFrom);
  const toDay = todayInZone(reductionTo);
  const state = toDay < today ? 'ended' : fromDay > today ? 'scheduled' : 'running';

  return {
    state,
    // Mimo `running` je „aktívna zľava" nula prípadov — a percento budúceho či
    // uplynulého okna do toho stĺpca NESMIE, inak obrazovka ukáže zľavu, ktorá
    // nebeží. Kto potrebuje to číslo, má `reportedPercent`.
    activePercent: state === 'running' ? kpiKnown(reductionPercent) : kpiMissing('shop_has_none'),
    reportedPercent: kpiKnown(reductionPercent),
    from: reductionFrom,
    to: reductionTo,
    measuredAt: enrichedAt,
  };
}

/**
 * Koľko dní okna je DOČÍTANÝCH a koľko z neho appka NEMÁ (D119).
 *
 * `unknownDays` sa počíta ako „okno mínus dočítané dni", NIE ako počet riadkov,
 * ktoré nemajú `complete`. Rozdiel je celý zmysel funkcie: deň, o ktorom
 * `sales_sync_state` nemá ANI RIADOK, sa nesťahoval — a keby sa počítali len
 * existujúce riadky, prázdna tabuľka by vyšla ako plne pokryté okno.
 */
export function windowCoverage(
  days: readonly { day: DateOnly; coverage: SalesDayCoverage }[],
  from: DateOnly,
  to: DateOnly,
): KpiWindowCoverage {
  const windowDays = isDateOnly(from) && isDateOnly(to) ? Math.max(0, diffDays(from, to) + 1) : 0;
  let completeDays = 0;
  for (const row of days) {
    if (!isDateOnly(row.day) || row.day < from || row.day > to) continue;
    if (row.coverage === 'complete') completeDays += 1;
  }
  const capped = Math.min(completeDays, windowDays);
  return { windowDays, from, to, completeDays: capped, unknownDays: windowDays - capped };
}

/**
 * Kusy za okno pre jeden produkt — s priznaním, čo z okna chýba.
 *
 * TRI STAVY, ktoré sa tu rozhodujú:
 *  · `completeDays === 0` → `units.value = null`, `gap: 'days_missing'`. Z okna
 *    nie je dočítaný ani jeden deň, takže nula by bola tvrdenie o nepredaní.
 *  · `unknownDays > 0` → hodnota JE, ale je to DOLNÁ HRANICA (`lowerBound`).
 *  · `unknownDays === 0` → hodnota je celé okno; `0` znamená „nepredalo sa nič".
 *
 * `units ?? 0` NIE JE dosadená nula: `product_sales_daily` má riadok len pre
 * (produkt, deň) s predajom, a `status = 'complete'` znamená, že ten deň sa
 * prečítal CELÝ (0009 + hlavička 0014 §4). Chýbajúci riadok v dočítanom dni je
 * teda ZMERANÁ nula. Keď nie je dočítaný ani jeden deň, sem sa to nedostane.
 */
function kpiWindowUnits(coverage: KpiWindowCoverage, units: number | undefined): KpiWindowUnits {
  if (coverage.completeDays === 0) {
    return { ...coverage, units: kpiMissing('days_missing'), lowerBound: coverage.windowDays > 0 };
  }
  const value = Math.max(0, Math.trunc(units ?? 0));
  const lowerBound = coverage.unknownDays > 0;
  return {
    ...coverage,
    units: lowerBound ? { value, gap: 'days_missing' } : kpiKnown(value),
    lowerBound,
  };
}

/**
 * Značka „bez predaja" (ležiak). Vzniká LEN s dôkazom (D119).
 *
 * NEOBOHATENÝ PRODUKT NIE JE MŔTVY PRODUKT — je to neznámy produkt, a preto
 * neobohatený riadok s nestiahnutým oknom dostane `mark: false` bez dôkazu.
 * Dva dôkazy, ktoré značku unesú:
 *
 *  1. `shop_never_ordered` — `getFull` povedal `last_time_in_order = NULL` A
 *     `qty_in_orders = 0`. Vyžadujú sa OBE: `qty_in_orders > 0` bez dátumu je
 *     protirečivá odpoveď a z protirečenia sa značka odvodiť nesmie. Toto je
 *     dôkaz, ktorý D119 myslí — jeden request na produkt namiesto tisícov
 *     objednávok.
 *  2. `no_sale_in_covered_days` — DLHÉ okno je celé dočítané (`unknownDays === 0`)
 *     a v ňom nula kusov. Čiastočne pokryté okno s nulou nedokazuje nič.
 *
 * Krátke okno značku nedáva zámerne: tridsať dní bez predaja nie je pri šperkoch
 * ležiak, a keby sa značka viazala na kratšie okno, sypala by sa na polovicu
 * katalógu.
 *
 * ZVAŽOVANÝ A ZAMIETNUTÝ tretí dôkaz: „`last_time_in_order` je starší než
 * začiatok okna". Vyzerá lákavo, ale hodnota platí k času `enriched_at`, takže
 * o období medzi obohatením a dneškom nehovorí nič — pri týždeň starom obohatení
 * by značka tvrdila viac, než sa zmeralo. UI má na to `lastSaleAt` spolu
 * s `measuredAt` a môže povedať „posledný predaj pred N dňami (stav k …)".
 */
export function kpiNoSale(
  enrichment: CatalogEnrichmentRecord,
  longWindow: KpiWindowUnits,
): KpiNoSale {
  const { enrichedAt, lastTimeInOrder, qtyInOrders } = enrichment;
  if (enrichedAt !== null && lastTimeInOrder === null && qtyInOrders === 0) {
    return { mark: true, proof: 'shop_never_ordered' };
  }
  if (longWindow.unknownDays === 0 && longWindow.units.value === 0) {
    return { mark: true, proof: 'no_sale_in_covered_days' };
  }
  return { mark: false, proof: null };
}

/**
 * Koľkokrát sa aktuálna zásoba už predala (`qty_in_orders / qty`).
 *
 * NIE JE to účtovná obrátkovosť (viď hlavička modulu). Keď je sklad `0`, pomer
 * hodnotu nemá — a to je `not_computable`, teda TRETÍ dôvod, iný než „nevieme".
 * Vypredaný produkt totiž poznáme presne; len ten pomer sa o ňom povedať nedá.
 */
function kpiSoldPerStock(
  soldTotal: KpiValue<number>,
  stock: KpiValue<number>,
): KpiValue<number> {
  if (soldTotal.value === null) return kpiMissing(soldTotal.gap ?? 'shop_has_none');
  if (stock.value === null) return kpiMissing(stock.gap ?? 'shop_has_none');
  if (stock.value === 0) return kpiMissing('not_computable');
  return kpiKnown(round2(soldTotal.value / stock.value));
}

/**
 * Dni od posledného predaja podľa shopu. Je to HORNÁ hranica: hodnota je meraná
 * k času `enriched_at`, takže od obohatenia mohol pribudnúť predaj, o ktorom
 * appka nevie. Deň sa berie v zóne logiky (D31), nikdy v UTC.
 */
function kpiDaysSinceLastSale(lastSaleAt: KpiValue<UtcDate>, today: DateOnly): KpiValue<number> {
  if (lastSaleAt.value === null) return kpiMissing(lastSaleAt.gap ?? 'shop_has_none');
  const saleDay = todayInZone(lastSaleAt.value);
  if (!isDateOnly(saleDay) || !isDateOnly(today)) return kpiMissing('not_computable');
  return kpiKnown(Math.max(0, diffDays(saleDay, today)));
}

/** Kusy oboch okien pre jeden produkt tak, ako ich vrátil jeden dotaz. */
export interface KpiUnitsRow {
  shortUnits: number;
  longUnits: number;
}

export interface ProductKpiInput {
  /** Riadky zrkadla s obohatením — v poradí, v akom ich má tabuľka nakresliť. */
  products: readonly CatalogKpiRow[];
  /**
   * Kusy za obe okná. CHÝBAJÚCI KĽÚČ znamená „v dočítaných dňoch bez predaja",
   * nie „nevieme" — či sa vôbec niečo dočítalo, hovorí `window30`/`window90`.
   */
  units: ReadonlyMap<number, KpiUnitsRow>;
  window30: KpiWindowCoverage;
  window90: KpiWindowCoverage;
  /** Deň, voči ktorému sa posudzuje zľava a dni od predaja (D31). */
  today: DateOnly;
}

/**
 * Čisté zloženie KPI riadku z dvoch zdrojov. Bez DB a bez siete — presne preto
 * sa dajú všetky tri stavy každého KPI otestovať bez MariaDB.
 */
export function buildProductKpis(input: ProductKpiInput): ProductKpiRow[] {
  const { today, window30, window90 } = input;
  return input.products.map((product) => {
    const e = product.enrichment;
    const at = e.enrichedAt;
    const units = input.units.get(product.productId);
    const units30 = kpiWindowUnits(window30, units?.shortUnits);
    const units90 = kpiWindowUnits(window90, units?.longUnits);
    const stock = fromEnrichment(at, e.qty);
    const soldTotal = fromEnrichment(at, e.qtyInOrders);
    const lastSaleAt = fromEnrichment<UtcDate>(at, e.lastTimeInOrder);

    return {
      productId: product.productId,
      missing: product.missing,
      name: product.name,
      reference: fromEnrichment(at, e.reference),
      /* EAN z toho istého riadku obohatenia ako referencia (D150, V7). Ide tou
         istou cestou `fromEnrichment()`, takže neobohatený riadok dostane
         `not_enriched` a nie prázdny reťazec. */
      ean13: fromEnrichment(at, e.ean13),
      supplier: fromEnrichment(at, e.supplier),
      listPrice: product.price,
      priceWithVat: fromEnrichment(at, e.sellPriceWithVat),
      purchasePrice: fromEnrichment(at, e.purchasePrice),
      // Marža sa NEPOČÍTA — shop ju dáva hotovú a appka číta uloženú hodnotu.
      margin: fromEnrichment(at, e.margin),
      marginPercent: fromEnrichment(at, e.marginPercent),
      discount: kpiActiveDiscount(e, today),
      stock,
      soldTotal,
      lastSaleAt,
      daysSinceLastSale: kpiDaysSinceLastSale(lastSaleAt, today),
      soldPerStock: kpiSoldPerStock(soldTotal, stock),
      units30,
      units90,
      noSale: kpiNoSale(e, units90),
      enrichedAt: at,
    };
  });
}

/**
 * Kusy za krátke aj dlhé okno pre celú stránku produktov — JEDEN dotaz, žiadne
 * N+1 (viď `SQL_KPI_UNITS_PREFIX`, kde je aj dôvod `JOIN`-u na `complete`).
 *
 * Produkt, ktorý v mape nie je, sa v dočítaných dňoch nepredal. Že to nie je
 * „nevieme", vie volajúci z pokrytia okna, nie z tejto mapy.
 */
export async function kpiUnitsInCompleteDays(
  productIds: readonly number[],
  range: { shortFrom: DateOnly; longFrom: DateOnly; to: DateOnly },
  conn?: Queryable,
): Promise<Map<number, KpiUnitsRow>> {
  const out = new Map<number, KpiUnitsRow>();
  const ids = [...new Set(productIds)].filter(isValidId).slice(0, MAX_KPI_PRODUCTS);
  if (ids.length === 0) return out;
  if (!isDateOnly(range.shortFrom) || !isDateOnly(range.longFrom) || !isDateOnly(range.to)) {
    return out;
  }
  if (range.longFrom > range.to || range.shortFrom > range.to) return out;

  const placeholders = `(${ids.map(() => '?').join(', ')})`;
  const rows = await run<DbRow[]>(
    conn,
    SQL_KPI_UNITS_PREFIX + placeholders + SQL_KPI_UNITS_SUFFIX,
    [range.shortFrom, range.longFrom, range.to, ...ids],
  );
  for (const row of Array.isArray(rows) ? rows : []) {
    out.set(num(row.product_id), {
      shortUnits: Math.max(0, Math.trunc(num(row.units_short))),
      longUnits: Math.max(0, Math.trunc(num(row.units_long))),
    });
  }
  return out;
}

export interface ProductKpiOptions {
  /** Deň, voči ktorému sa počítajú okná. Default: dnes v zóne logiky (D31). */
  today?: DateOnly;
  /** Náhrada „teraz" pre testy — z nej sa `today` odvodí, nikdy v UTC. */
  now?: UtcDate;
  shortWindowDays?: number;
  longWindowDays?: number;
  /** Zrkadlo katalógu (obohatenie). Default: produkčný repozitár. */
  catalog?: Pick<CatalogRepoExt, 'kpiRowsFor'>;
  /** Pokrytie dní po dňoch. Default: produkčný repozitár predajnosti. */
  sales?: Pick<SalesRepoContract, 'coverageFor'>;
  conn?: Queryable;
}

/** Okno v dňoch: nezmysel spadne na predvoľbu, nie na nulu. */
function clampWindowDays(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const days = Math.trunc(Number(value));
  if (!Number.isFinite(days) || days < 1) return fallback;
  return Math.min(days, MAX_KPI_WINDOW_DAYS);
}

/**
 * KPI celej stránky produktov (D114) — TRI dotazy bez ohľadu na počet riadkov:
 *
 *  1. `catalogRepo.kpiRowsFor()` — názov, cenníková cena a obohatenie,
 *  2. `salesRepo.coverageFor()`  — pokrytie dní dlhého okna (z neho sa spočíta
 *     aj krátke, lebo 30 dní je jeho podmnožina),
 *  3. `kpiUnitsInCompleteDays()` — kusy za obe okná.
 *
 * Dotazy idú SEKVENČNE, nie v `Promise.all`: volajúci môže poslať `conn`, a to
 * je JEDNO spojenie MariaDB — dva súbežné dotazy na ňom sa pobijú. Zrýchlenie
 * by aj tak žiadne nebolo, dotazy sú tri.
 *
 * Prázdny (alebo celý neplatný) zoznam ID nečíta DB vôbec a vráti okná ako
 * NEPOKRYTÉ. Je to bezpečný smer: „nevieme" sa dá nakresliť, vymyslené pokrytie
 * nie (I11).
 */
export async function productKpis(
  productIds: readonly number[],
  opts: ProductKpiOptions = {},
): Promise<ProductKpiPage> {
  const today =
    opts.today !== undefined && isDateOnly(opts.today)
      ? opts.today
      : todayInZone(opts.now ?? new Date());
  const longDays = clampWindowDays(opts.longWindowDays, KPI_WINDOW_LONG_DAYS);
  const shortDays = Math.min(clampWindowDays(opts.shortWindowDays, KPI_WINDOW_SHORT_DAYS), longDays);
  const longFrom = addDays(today, -(longDays - 1));
  const shortFrom = addDays(today, -(shortDays - 1));

  const ids = [...new Set(productIds)].filter(isValidId).slice(0, MAX_KPI_PRODUCTS);
  if (ids.length === 0) {
    return {
      today,
      window30: windowCoverage([], shortFrom, today),
      window90: windowCoverage([], longFrom, today),
      rows: [],
    };
  }

  const catalog = opts.catalog ?? catalogRepo;
  const sales = opts.sales ?? salesRepo;

  const rowsById = await catalog.kpiRowsFor(ids, opts.conn);
  const coverage = await sales.coverageFor(longFrom, today, opts.conn);
  const units = await kpiUnitsInCompleteDays(ids, { shortFrom, longFrom, to: today }, opts.conn);

  const window30 = windowCoverage(coverage.days, shortFrom, today);
  const window90 = windowCoverage(coverage.days, longFrom, today);

  // Poradie riadkov je poradie, v akom ID prišli — tabuľka si triedenie
  // rozhodla dotazom v katalógu a KPI ho nesmú prehodiť.
  const products: CatalogKpiRow[] = [];
  for (const productId of ids) {
    const row = rowsById.get(productId);
    if (row !== undefined) products.push(row);
  }

  return { today, window30, window90, rows: buildProductKpis({ products, units, window30, window90, today }) };
}

export const salesInsights = {
  syncDays,
  dailyUnits,
  latestSyncStop,
  productKpis,
};
