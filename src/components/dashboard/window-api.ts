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
  readCode as code,
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
  /**
   * Dni okna BEZ riadku tejto meny, ktoré sa ale DOČÍTALI — teda MERANÁ NULA:
   * „čítali sme celý deň a v tejto mene nebolo nič" (route `measuredZeroDays`,
   * migrácia 0016).
   *
   * `null` = odpoveď ten zoznam vôbec nenesie. Vtedy taký deň zostáva
   * „nevieme" a dostane pomlčku — fail-closed do priznania, nikdy do nuly.
   * Prázdne pole je NAOPAK meranie: „ani jeden deň okna takýto nie je".
   */
  measuredZeroDays: string[] | null;
}

/** Čím je jeden deň okna. Štyri stavy servera, prenesené bez zliatia. */
export type RevenueDayKnowledgeView = 'measured' | 'empty' | 'lower_bound' | 'unknown';

const REVENUE_DAY_KNOWLEDGE: readonly RevenueDayKnowledgeView[] = [
  'measured',
  'empty',
  'lower_bound',
  'unknown',
];

/**
 * Jeden deň okna a to, čo o ňom appka naozaj vie (route `dayStates[]`).
 *
 * Je to stav CELÉHO DŇA cez všetky meny, nie stav jedného menového radu —
 * preto sa nesmie zamieňať s `RevenueSeriesView.measuredZeroDays`, ktorý
 * hovorí o jednej mene.
 */
export interface RevenueDayStateView {
  day: string;
  state: RevenueDayKnowledgeView;
  /**
   * Počet objednávok dňa z príznaku prečítanosti. `null` = stav appka nemá;
   * nula je MERANÝ fakt „čítali sme a objednávka nebola" (I11).
   */
  ordersSeen: number | null;
}

export interface RevenueDailyView {
  today: string;
  from: string;
  to: string;
  /** Menovka rozsahu zo servera. Iná hodnota než `eshop` sa NEKRESLÍ. */
  scope: 'eshop';
  series: RevenueSeriesView[];
  /**
   * Riadok pre KAŽDÝ deň okna tak, ako ho pomenoval server. `null` = odpoveď
   * `dayStates` nenesie; prázdne pole by tvrdilo „okno nemá ani jeden deň".
   */
  dayStates: RevenueDayStateView[] | null;
  /**
   * Dni okna, ku ktorým nie je riadok v ŽIADNEJ mene. Nikdy nuly — a `null`,
   * keď odpoveď zoznam chýbajúcich dní vôbec nenesie: sekcia potom priznanie
   * medzery nezamlčí len preto, že nevie zrátať, koľkých dní sa týka.
   */
  missingDays: number | null;
  /**
   * POČET dní okna, ktoré appka PREČÍTALA a nepredalo sa v nich nič (route
   * `emptyDays`). Nula je meranie „taký deň v okne nie je"; `null` znamená,
   * že odpoveď ten zoznam nenesie, a vtedy sa o prečítaných nulách NETVRDÍ
   * nič — dni samé zostanú pomlčkou, čo je priznanie, nie nula.
   */
  emptyDays: number | null;
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
    measuredZeroDays: dayList(row.measuredZeroDays),
  };
}

/**
 * Zoznam dátumov z odpovede. `null` = pole tam nie je alebo nie je poľom;
 * nečitateľný prvok sa VYNECHÁ, nie dosadí — deň, ktorý sa nedá prečítať,
 * potom zostane „nevieme" a dostane pomlčku.
 */
function dayList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const entry of raw) if (typeof entry === 'string' && entry !== '') out.push(entry);
  return out;
}

/**
 * Jeden riadok `dayStates[]`. Neznámy kód stavu riadok ZAHODÍ — vykresliť
 * surový kód K10 zakazuje a dosadiť za neho `measured` by z nevedomosti
 * spravilo meranie.
 */
function parseRevenueDayState(raw: unknown): RevenueDayStateView | null {
  const row = asRecord(raw);
  if (row === null) return null;
  const day = str(row, 'day');
  const state = code(row, 'state', REVENUE_DAY_KNOWLEDGE);
  if (day === null || state === null) return null;
  // Nula je MERANÝ počet objednávok; nečitateľné pole je `null`, nie nula.
  return { day, state, ordersSeen: count(row, 'ordersSeen') };
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
  /*
   * `dayStates` a `emptyDays` sa čítajú od 3. 9. 2026 — dovtedy ich parser
   * ZAHADZOVAL, hoci route obe posielala. Deň, ktorý appka PREČÍTALA a nič sa
   * v ňom nepredalo, tak prišiel na obrazovku ako deň, ktorý nemerala:
   * `revenueDays()` mu dal `unknown` a pomlčku. To je I11 naopak — appka
   * priznávala nevedomosť o niečom, čo zmerala, a robila svoje pokrytie dát
   * HORŠÍM, než je. Nameraná nula je fakt, medzera je priznanie; zliať sa
   * nesmú ani v tomto smere.
   */
  const states = Array.isArray(root.dayStates) ? root.dayStates : null;
  const dayStates: RevenueDayStateView[] | null = states === null ? null : [];
  if (states !== null && dayStates !== null) {
    for (const entry of states) {
      const row = parseRevenueDayState(entry);
      if (row !== null) dayStates.push(row);
    }
  }
  const empty = Array.isArray(root.emptyDays) ? root.emptyDays.length : null;
  return {
    today,
    from,
    to,
    scope: 'eshop',
    series,
    dayStates,
    missingDays: missing,
    emptyDays: empty,
    hasGap: tri(root, 'hasGap'),
  };
}

/**
 * `anchor` posúva „dnešok" odpovede na zadaný deň — presne to, čo route
 * ponúka svojím `?anchor=`. KPI riadok ho používa na PREDCHÁDZAJÚCE okno
 * (§5 nižšie); bez neho by porovnanie „oproti minulému obdobiu" neexistovalo
 * a pilulka smeru by musela navždy hovoriť „zmenu nevieme".
 */
export async function getRevenueDaily(
  windowDays: OverviewWindow,
  anchor?: string,
): Promise<RevenueDailyView | null> {
  const at = anchor === undefined ? '' : `&anchor=${anchor}`;
  return parseRevenueDaily(await fetchJson(`/api/insights/revenue-daily?window=${windowDays}${at}`));
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
  /**
   * KOĽKÝCH produktov sa týka to, že do rebríčka nevstupujú, pretože appka ich
   * predaj za okno NEMERALA (`unitsSold === null`, D121). `null` = odpoveď to
   * číslo nedala; nula by tvrdila „netýka sa to nikoho".
   *
   * Bez tohto čísla je veta „produkt bez nameraného predaja tu nie je" síce
   * pravdivá, ale nemerateľná — človek z nej nevie, či je rebríček obrazom
   * eshopu, alebo jeho stotinou.
   */
  unknownSales: number | null;
  /**
   * To isté pre produkty s NAMERANOU nulou. Sú to dve rôzne veci a appka ich
   * zliať nesmie: jedno je meranie, druhé jeho absencia (I11).
   */
  measuredZeroSales: number | null;
}

export function parseTopFlop(raw: unknown): TopFlopView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const cohort = asRecord(root.cohort);
  const gaps = asRecord(root.gaps);
  const excludes = asRecord(root.excludes);
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
    /*
     * Rovnaké fail-closed pravidlo ako `gaps`: chýbajúce `excludes` je „appka
     * to nevie", nie „netýka sa to nikoho". Server tie čísla za niektoré okná
     * poslať NEMÔŽE (počty zrkadla platia len za povolené okná predajnosti), a
     * práve preto sa tu nesmú dopĺňať nulou.
     */
    unknownSales: excludes === null ? null : count(excludes, 'unknownSales'),
    measuredZeroSales: excludes === null ? null : count(excludes, 'measuredZeroSales'),
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

/* ══════════ 5. Súčet kusov za okno — hlavička KPI riadku (D136) ═══════════ */

/**
 * Súhrn okna z `/api/insights/sales-daily`. Rad po dňoch tu ZÁMERNE nie je:
 * ten číta graf v sekcii Predaj a KPI dlaždica z neho nič nepočíta — inak by
 * na jednej obrazovke stáli dva výpočty toho istého čísla a rozišli by sa pri
 * prvej zmene pravidla „čo je meraný deň".
 *
 * Tri polia = tri stavy jedného čísla (I11), presne ako ich posiela route:
 *  · `unitsState: 'measured'`    → `windowUnits` je súčet celého okna,
 *  · `unitsState: 'lower_bound'` → je to DOLNÁ HRANICA (časť dní nemáme),
 *  · `unitsState: 'unknown'`     → `windowUnits` je `null`, NIE nula.
 */
export interface SalesWindowView {
  from: string;
  to: string;
  /** Súčet kusov za dočítané dni okna. `null` = ani jeden deň nie je dočítaný. */
  windowUnits: number | null;
  unitsState: 'measured' | 'lower_bound' | 'unknown';
  /**
   * Koľko dní okna appka NEMÁ. `null` = odpoveď to nepovedala (fail-closed,
   * ten istý dôvod ako `TopFlopView.unknownDays`): nula by tvrdila „nechýba
   * nič", a to je práve to, čo `lower_bound` popiera.
   */
  unknownDays: number | null;
}

/**
 * Súhrn okna z odpovede. Neznámy stav merania NIE JE `measured`.
 *
 * Poradie podmienok je záväzné: najprv sa pýtame, čím číslo JE, a až potom ho
 * čítame. Kto to obráti, dosadí súčet dočítaných dní ako meranie celého okna.
 */
export function parseSalesWindow(raw: unknown): SalesWindowView | null {
  const root = asRecord(raw);
  if (root === null) return null;
  const window = asRecord(root.window);
  if (window === null) return null;
  const from = str(window, 'from');
  const to = str(window, 'to');
  if (from === null || to === null) return null;

  const state = root.unitsState;
  const unitsState =
    state === 'measured' || state === 'lower_bound' ? state : ('unknown' as const);
  const gaps = asRecord(root.gaps);
  return {
    from,
    to,
    /* Pri `unknown` sa číslo NEČÍTA vôbec — odpoveď ho v tom stave neposiela
       a keby ho poslala, bola by to hodnota, o ktorej sama tvrdí, že ju nemá. */
    windowUnits: unitsState === 'unknown' ? null : count(root, 'windowUnits'),
    unitsState,
    unknownDays: gaps === null ? null : count(gaps, 'unknownDays'),
  };
}

export async function getSalesWindow(
  windowDays: OverviewWindow,
  anchor?: string,
): Promise<SalesWindowView | null> {
  const at = anchor === undefined ? '' : `&anchor=${anchor}`;
  return parseSalesWindow(await fetchJson(`/api/insights/sales-daily?window=${windowDays}${at}`));
}
