'use client';

/**
 * Aura Zľavy — ČÍTANIE OKNA PREHĽADU (V4, D113).
 *
 * Štyri čisto čítacie endpointy, ktoré sa pýtajú na TO ISTÉ okno 7/30/90 dní:
 *
 *   `/api/insights/timeline?window=N`      — okná zliav pod krivku,
 *   `/api/insights/revenue-daily?window=N` — denná tržba ESHOPU (D117),
 *   `/api/insights/top-products?window=N`  — top 10 a flop 10 podľa kusov,
 *   `/api/insights/activity?days=N`        — posledný výsledok zápisu.
 *
 * ŽIADNY Z NICH NEVOLÁ SHOP (K8). Všetko sú `SELECT`-y nad lokálnou databázou;
 * sťahovanie z eshopu má na starosti scheduler a beží mimo tejto obrazovky.
 *
 * PRAVIDLO MODULU JE TO ISTÉ AKO V `api.ts`: čo sa nedá prečítať, je `null` —
 * nikdy nula a nikdy dopočítaný odhad. Rozdiel proti `api.ts` je len rozsah:
 * tieto štyri odpovede závisia od okna prepínača, takže ich načítanie sa
 * opakuje pri každej jeho zmene, a preto majú vlastný modul.
 *
 * PRAVIDLO PLATÍ NA VŠETKY ŠTYRI PARSERY, BEZ VÝNIMKY (31. 8. 2026). Do tohto
 * dňa tu boli dve protichodné pravidlá v jednom súbore: `parseRevenueDaily` aj
 * `parseTopFlop` vracali na nečitateľné pole `null`, ale `parseWriteActivity`
 * a `parseRevenueRow` dosadzovali `?? 0`. Tá nula nebola kozmetická —
 * `lastWriteResult()` z nej spravila „posledný výsledok zápisu" a karta zliav
 * napísala „0 sa nepodarilo" o PRODUKČNÝCH ZÁPISOCH, teda tvrdenie, ktoré
 * appka nikdy nezmerala. Nula je meraný fakt, pomlčka je priznaná nevedomosť
 * a zliať sa nesmú (I11).
 *
 * Porovnáva sa explicitne (`value === null`, `typeof … !== 'number'`) —
 * Turbopack tu už raz zahodil `if (!row)` ako compile-time falsy.
 *
 * Vlastník: V4.
 */
import {
  asRecord,
  readCount as count,
  readNumber as num,
  readText as str,
  readTriState as tri,
} from '@/components/dashboard/json';
import type { FireWindowInput, OverviewWindow, RankRow } from '@/components/dashboard/overview-model';
import { rankRows } from '@/components/dashboard/overview-model';
import type { DiscountWindowInput, RevenueRowInput } from '@/components/dashboard/sales-view';
import { fetchJson } from '@/components/layout/health';

/* ═══════════════════════ 1. Okná zliav na osi grafu ═══════════════════════ */

/**
 * Okno zľavy nesie naraz dve veci: pás pod krivkou (`dateFrom`/`dateTo`) a čas
 * plánovaného zápisu (`fireAt`). Sú to dva rôzne fakty o tej istej zľave a
 * odpoveď ich vracia spolu, takže sa spolu aj čítajú.
 */
export interface TimelineWindowRow extends DiscountWindowInput, FireWindowInput {}

export interface TimelineWindowView {
  today: string;
  from: string;
  to: string;
  campaigns: TimelineWindowRow[];
}

function parseTimelineRow(raw: unknown): TimelineWindowRow | null {
  const row = asRecord(raw);
  if (row === null) return null;
  const id = count(row, 'id');
  const dateFrom = str(row, 'dateFrom');
  const dateTo = str(row, 'dateTo');
  const percent = num(row, 'percent');
  if (id === null || dateFrom === null || dateTo === null || percent === null) return null;
  return {
    id,
    name: str(row, 'name') ?? '',
    percent,
    dateFrom,
    dateTo,
    fireAt: str(row, 'fireAt'),
  };
}

export function parseTimelineWindow(raw: unknown): TimelineWindowView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const today = str(root, 'today');
  const from = str(root, 'from');
  const to = str(root, 'to');
  if (today === null || from === null || to === null) return null;
  const list = Array.isArray(root.campaigns) ? root.campaigns : [];
  const campaigns: TimelineWindowRow[] = [];
  for (const entry of list) {
    const row = parseTimelineRow(entry);
    if (row !== null) campaigns.push(row);
  }
  return { today, from, to, campaigns };
}

export async function getTimelineWindow(
  windowDays: OverviewWindow,
): Promise<TimelineWindowView | null> {
  return parseTimelineWindow(await fetchJson(`/api/insights/timeline?window=${windowDays}`));
}

/* ══════════════════ 2. Denná tržba ESHOPU (D117), po menách ═══════════════ */

/**
 * Jeden menový rad. Meny sa NIKDY nesčítavajú do jedného čísla — 125,50 EUR
 * plus 2 500 CZK nie je 2 625,50 čohokoľvek; server to tak vracia a obrazovka
 * to tak aj kreslí.
 */
export interface RevenueSeriesView {
  currency: string;
  days: RevenueRowInput[];
  /** Súčet okna zo servera. `null` = v okne nie je ani jeden riadok. */
  sum: string | null;
  /** Čím je `sum`: meranie, dolná hranica, alebo „nevieme". */
  sumState: 'measured' | 'lower_bound' | 'unknown';
  /**
   * Dni okna s riadkom, ktorý je zatiaľ len dolná hranica. `null` = pole sa
   * nedalo prečítať; nula by tvrdila „všetky dni sú dočítané", a to je presne
   * to, čo `sumState: 'lower_bound'` popiera.
   */
  lowerBoundDays: number | null;
}

export interface RevenueDailyView {
  today: string;
  from: string;
  to: string;
  /** Menovka rozsahu zo servera. Iná hodnota než `eshop` sa NEKRESLÍ. */
  scope: 'eshop';
  series: RevenueSeriesView[];
  /**
   * Dni okna, ku ktorým nie je riadok v ŽIADNEJ mene. Nikdy nuly — a `null`,
   * keď odpoveď zoznam chýbajúcich dní vôbec nenesie: sekcia potom priznanie
   * medzery nezamlčí len preto, že nevie zrátať, koľkých dní sa týka.
   */
  missingDays: number | null;
  /** `null` = odpoveď o medzere nič nepovedala; nie je to „medzera nie je". */
  hasGap: boolean | null;
}

function parseRevenueRow(raw: unknown): RevenueRowInput | null {
  const row = asRecord(raw);
  if (row === null) return null;
  const day = str(row, 'day');
  const totalPaidSum = str(row, 'totalPaidSum');
  if (day === null || totalPaidSum === null) return null;
  return {
    day,
    totalPaidSum,
    // Nečitateľný počet objednávok je `null`, nie nula: „v tento deň nebola ani
    // jedna objednávka" je tvrdenie o eshope, nie o odpovedi servera.
    ordersCount: count(row, 'ordersCount'),
    // Chýbajúci príznak je fail-closed DOLNÁ HRANICA: tvrdiť „deň je dočítaný"
    // z nečitateľnej odpovede by z rozbehnutého dňa spravilo hotové číslo.
    dayComplete: row.dayComplete === true,
  };
}

function parseRevenueSeries(raw: unknown): RevenueSeriesView | null {
  const row = asRecord(raw);
  if (row === null) return null;
  const currency = str(row, 'currency');
  if (currency === null) return null;
  const list = Array.isArray(row.days) ? row.days : [];
  const days: RevenueRowInput[] = [];
  for (const entry of list) {
    const day = parseRevenueRow(entry);
    if (day !== null) days.push(day);
  }
  const state = row.sumState;
  return {
    currency,
    days,
    sum: str(row, 'sum'),
    sumState:
      state === 'measured' || state === 'lower_bound' ? state : ('unknown' as const),
    lowerBoundDays: count(row, 'lowerBoundDays'),
  };
}

/**
 * `scope: 'eshop'` je podmienka, nie ozdoba.
 *
 * Je to jediná menovka, ktorá na povrchu drží rozdiel medzi „tržba eshopu" a
 * „tržba za produkt". Odpoveď bez nej sa preto NEČÍTA vôbec (`null`) — radšej
 * pomlčka než suma, o ktorej appka nevie, čoho je súčtom (D117, I11).
 */
export function parseRevenueDaily(raw: unknown): RevenueDailyView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  if (root.scope !== 'eshop') return null;
  const today = str(root, 'today');
  const window = asRecord(root.window);
  if (today === null || window === null) return null;
  const from = str(window, 'from');
  const to = str(window, 'to');
  if (from === null || to === null) return null;

  const list = Array.isArray(root.series) ? root.series : [];
  const series: RevenueSeriesView[] = [];
  for (const entry of list) {
    const row = parseRevenueSeries(entry);
    if (row !== null) series.push(row);
  }
  // Odpoveď bez zoznamu chýbajúcich dní NEZNAMENÁ, že nechýba ani jeden.
  const missing = Array.isArray(root.missing) ? root.missing.length : null;
  return {
    today,
    from,
    to,
    scope: 'eshop',
    series,
    missingDays: missing,
    hasGap: tri(root, 'hasGap'),
  };
}

export async function getRevenueDaily(
  windowDays: OverviewWindow,
): Promise<RevenueDailyView | null> {
  return parseRevenueDaily(await fetchJson(`/api/insights/revenue-daily?window=${windowDays}`));
}

/* ═════════════════════ 3. Top 10 a flop 10 podľa kusov ════════════════════ */

export interface TopFlopView {
  /** `false` = rebríček sa poctivo zostaviť nedá; `reason` hovorí prečo. */
  available: boolean;
  reason: 'no_coverage' | 'cohort_too_large' | null;
  top: RankRow[];
  flop: RankRow[];
  /**
   * Koľko produktov má v okne aspoň jeden NAMERANÝ predaj. `null` = odpoveď sa
   * v tomto poli nedala prečítať; nula by bola tvrdenie „nič sa nepredáva".
   */
  cohortSize: number | null;
  /**
   * Dni okna, ktoré nie sú dočítané — poradie je vtedy dolná hranica. `null` =
   * appka nevie, koľko dní chýba (fail-closed, 31. 8. 2026): nula by tvrdila
   * „nechýba nič", a to je práve to, čo `rankingState: 'lower_bound'`
   * popiera. Nečitateľná odpoveď nesmie zaznieť ako plné pokrytie.
   */
  unknownDays: number | null;
  rankingState: 'measured' | 'lower_bound' | 'unknown';
}

export function parseTopFlop(raw: unknown): TopFlopView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const cohort = asRecord(root.cohort);
  const gaps = asRecord(root.gaps);
  const state = root.rankingState;
  const reason = root.reason;
  return {
    available: root.available === true,
    reason:
      reason === 'no_coverage' || reason === 'cohort_too_large' ? reason : null,
    // `rankRows()` je druhá brána proti nule v rebríčku — dôvod je v jej hlavičke.
    top: rankRows(root.top),
    flop: rankRows(root.flop),
    /*
     * Fail-closed ako `parseRevenueRow()`: nečitateľné pole je `null`, nie nula.
     * Do 31. 8. 2026 tu bola nula, takže sekcia pri nečitateľnom `gaps` písala
     * „0 dní okna appka nemá celé, takže súčty aj poradie sú dolná hranica" —
     * veta, ktorá medzeru priznáva aj popiera naraz, číslom, ktoré appka
     * nezmerala.
     */
    cohortSize: cohort === null ? null : count(cohort, 'size'),
    unknownDays: gaps === null ? null : count(gaps, 'unknownDays'),
    rankingState:
      state === 'measured' || state === 'lower_bound' ? state : ('unknown' as const),
  };
}

export async function getTopFlop(windowDays: OverviewWindow): Promise<TopFlopView | null> {
  return parseTopFlop(await fetchJson(`/api/insights/top-products?window=${windowDays}`));
}

/* ═══════════════════ 4. Posledný výsledok zápisu do shopu ═════════════════ */

/**
 * Jeden deň zápisovej aktivity.
 *
 * Všetky štyri počty sú `number | null` a to `null` je celý zmysel tohto typu:
 * sú to počty PRODUKČNÝCH ZÁPISOV do eshopu a karta ich cituje ako výsledok.
 * Nula sem smie prísť len z odpovede servera — vtedy znamená „appka zmerala,
 * že sa nič nepodarilo/nič sa nepreskočilo". `null` znamená „appka to pole
 * neprečítala" a povrch to musí priznať, nie dopísať nulu (I11).
 */
export interface WriteActivityDayView {
  day: string;
  ok: number | null;
  failed: number | null;
  uncertain: number | null;
  skipped: number | null;
}

export function parseWriteActivity(raw: unknown): WriteActivityDayView[] | null {
  const root = asRecord(raw);
  if (root === null) return null;
  if (!Array.isArray(root.days)) return null;
  const out: WriteActivityDayView[] = [];
  for (const entry of root.days) {
    const row = asRecord(entry);
    if (row === null) continue;
    const day = str(row, 'day');
    if (day === null) continue;
    out.push({
      day,
      ok: count(row, 'ok'),
      failed: count(row, 'failed'),
      uncertain: count(row, 'uncertain'),
      skipped: count(row, 'skipped'),
    });
  }
  return out;
}

export async function getWriteActivity(
  windowDays: OverviewWindow,
): Promise<WriteActivityDayView[] | null> {
  return parseWriteActivity(await fetchJson(`/api/insights/activity?days=${windowDays}`));
}
