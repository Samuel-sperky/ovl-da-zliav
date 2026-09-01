/**
 * Aura Zľavy — SPOLOČNÉ ZÁZEMIE ČÍTACÍCH ROUTE-OV PRE GRAFY (sekcia B2).
 * NIE JE to route — Next.js registruje výhradne `route.ts`.
 *
 * Pravidlá, ktoré tu platia bez výnimky:
 *   · **Žiadna mutácia.** Každá route je `GET` a jediné, čo robí, je `SELECT`
 *     cez `insightsRepo`. Neexistuje tu cesta k zápisu do shopu ani do DB —
 *     teda ani cesta, ktorá by obišla potvrdenie (I3). Práve preto tu nič
 *     nechýba po tom, čo 27. 8. 2026 zmizlo prihlásenie (D99): brániť sa dá
 *     len zápisu, a tu žiadny nie je.
 *   · **Žiadny kľúč, žiadne tajomstvo v odpovedi (I1).** Telo aj tak prechádza
 *     centrálnym redaktorom v `responses.ts`, ale grafy o kľúči nevedia nič
 *     a ani ho nepotrebujú — TTL kreslí hlavička z vlastných dát.
 *   · **Žiadne dáta o objednávkach (I8).** Zdroje sú `catalog_cache`,
 *     `campaigns`, `campaign_items`, `audit_log` — nič iné. Od 28. 8. 2026
 *     pribudli `product_sales_daily`, `sales_sync_state` a `shop_revenue_daily`
 *     (D117): sú to DENNÉ SÚČTY za celý eshop, nie riadky objednávok, a
 *     zákaznícky údaj v nich nie je ani jeden (I8' bod 3).
 *   · **I11.** Odpovede nesú `lastOwnWrite`, nie „stav zľavy v shope".
 *     Pomenovanie v UI je povinné a robia ho komponenty grafov.
 *
 * ČO SEM PRIBUDLO PRE V4 (28. 8. 2026) A PREČO TO ŽIJE NA JEDNOM MIESTE
 * ---------------------------------------------------------------------
 * Obrazovky V4 (Prehľad, Produkty, detail panel) sa pýtajú na to isté okno
 * 7/30/90 dní a na tú istú otázku „koľko dní toho okna vôbec MÁME". Keby si
 * každá route počítala okno aj medzeru sama, boli by to tri odpovede na jednu
 * otázku a prvá zmena by ich rozviedla. Preto je tu:
 *
 *   · `windowQuery` + `windowRange()` — jediná definícia okna (dnes + N−1 dní),
 *   · `windowCoverage()` — jediná definícia toho, čo je MERANÉ a čo MEDZERA,
 *   · `upliftFor()` — jediná definícia okien „pred/počas" (D115, pasca d00e081).
 *
 * `windowCoverage()` je zámerne PRÍSNEJŠIA než `summarizeCoverage()`
 * z `lib/sales/insights.ts`: za známy deň berie VÝHRADNE `complete`. `partial`
 * je dolná hranica (sťahovanie dňa sa prerušilo), a dolná hranica sa nesmie
 * ukázať ako meranie — v grafe by z nej bol prepad, ktorý nikto nezmeral.
 *
 * Vlastník: B2; sekcie 4–6 (okno, pokrytie, uplift) vlna V4-ENDPOINTY.
 */
import { z } from 'zod';

import type { DateOnly, SalesDayCoverage, SalesSyncDay } from '@/contracts';

import { env } from '@/env';
import { addCalendarMonths, addDays, diffDays, isDateOnly, todayInZone } from '@/lib/domain/dates';
import { insightsRepo as defaultInsightsRepo } from '@/lib/repo/insights.repo';
import { campaignsRepo as defaultCampaignsRepo } from '@/lib/repo/campaigns.repo';
import { campaignItemsRepo as defaultCampaignItemsRepo } from '@/lib/repo/campaign-items.repo';

/* ═══════════════════════ 1. Závislosti route-ov ═══════════════════════════ */

export interface InsightsDeps {
  insightsRepo?: typeof defaultInsightsRepo;
  /** Okno platnosti zľavy pre sekciu „Výkon" — jediné, čo z nej treba. */
  campaignsRepo?: Pick<typeof defaultCampaignsRepo, 'getById'>;
  /**
   * História produkt ↔ zľava (D127 bod 3). Vyberajú sa VÝHRADNE čítacie
   * funkcie — `createMany()` ani `update()` sa do čítacej route nemajú ako
   * dostať, a tým je celá táto vrstva mimo brány I3 (viď hlavičku súboru).
   */
  campaignItemsRepo?: Pick<
    typeof defaultCampaignItemsRepo,
    'historyPage' | 'historyForProduct' | 'countByCampaign'
  >;
  now?: () => Date;
  timeZone?: string;
}

export type ResolvedInsightsDeps = Required<Omit<InsightsDeps, 'timeZone'>> & {
  timeZone: string;
};

export function resolveInsightsDeps(overrides: InsightsDeps = {}): ResolvedInsightsDeps {
  return {
    insightsRepo: overrides.insightsRepo ?? defaultInsightsRepo,
    campaignsRepo: overrides.campaignsRepo ?? defaultCampaignsRepo,
    campaignItemsRepo: overrides.campaignItemsRepo ?? defaultCampaignItemsRepo,
    now: overrides.now ?? (() => new Date()),
    // LAZY: route moduly volajú resolve na module scope, takže eager čítanie
    // `env.*` by spustilo validáciu ENV už počas `next build` (rovnaký dôvod
    // ako v `api/campaigns/_shared.ts`).
    get timeZone(): string {
      return overrides.timeZone ?? env.LOGIC_TIMEZONE;
    },
  };
}

export const todayOf = (d: ResolvedInsightsDeps): DateOnly => todayInZone(d.now(), d.timeZone);

/* ═══════════════════════════ 2. Zod schémy ════════════════════════════════ */

export const productIdParamSchema = z.object({
  productId: z.coerce.number().int().positive(),
});

export const campaignIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Voliteľné kotvenie osi na konkrétny deň — inak „dnes" v logickom pásme. */
export const anchorQuery = z
  .string()
  .refine((v) => isDateOnly(v), 'Očakáva sa existujúci kalendárny deň v tvare RRRR-MM-DD.')
  .optional();

/* ═══════════════════════ 3. Rozsahy osí (§4) ══════════════════════════════ */

/** Prvý deň mesiaca, do ktorého `day` patrí. */
export function startOfMonth(day: DateOnly): DateOnly {
  return `${day.slice(0, 7)}-01` as DateOnly;
}

/** Posledný deň mesiaca, do ktorého `day` patrí. */
export function endOfMonth(day: DateOnly): DateOnly {
  return addDays(addCalendarMonths(startOfMonth(day), 1), -1);
}

/**
 * G1 — 3-mesačná os: predchádzajúci, aktuálny a nasledujúci kalendárny mesiac.
 * „Dnes" tak leží v prostrednej tretine a je vidieť aj to, čo práve dobehlo.
 */
export function timelineRange(today: DateOnly): { from: DateOnly; to: DateOnly } {
  const from = addCalendarMonths(startOfMonth(today), -1);
  const to = endOfMonth(addCalendarMonths(startOfMonth(today), 1));
  return { from, to };
}

/** G4 — okno aktivity zápisov; default 30 dní vrátane dneška. */
export function activityRange(today: DateOnly, days: number): { from: DateOnly; to: DateOnly } {
  const span = Math.min(Math.max(1, Math.trunc(days)), 90);
  return { from: addDays(today, -(span - 1)), to: today };
}

/* ═════════════════ 4. Okno 7/30/90 dní (D113, prepínač Prehľadu) ══════════ */

/**
 * Dĺžky okna, ktoré obrazovky V4 ponúkajú. Zoznam je uzavretý ZÁMERNE: každá
 * ďalšia hodnota je rozhodnutie o tom, čo appka tvrdí o čase, nie parameter.
 */
export const WINDOW_DAYS_ALLOWED: readonly number[] = [7, 30, 90];

/** Predvolené okno podľa kontraktu V4 §2 („okno predajov prepínač 7/30/90"). */
export const DEFAULT_WINDOW_DAYS = 30;

/**
 * `?window=7|30|90`. Nepovolená hodnota je 400, NIE tichý fallback: keď si
 * obrazovka vypýta 14 dní a dostane 30, kreslí graf s nadpisom, ktorý neplatí.
 */
export const windowQuery = z.coerce
  .number()
  .int()
  .refine((v) => WINDOW_DAYS_ALLOWED.includes(v), 'Okno smie byť 7, 30 alebo 90 dní.')
  .optional();

export interface WindowRange {
  /** Koľko dní okno má (vrátane dnešného dňa). */
  days: number;
  from: DateOnly;
  to: DateOnly;
}

/** Okno vrátane dnešného dňa: 30 dní = dnes + 29 predchádzajúcich. */
export function windowRange(today: DateOnly, days: number = DEFAULT_WINDOW_DAYS): WindowRange {
  const span = WINDOW_DAYS_ALLOWED.includes(days) ? days : DEFAULT_WINDOW_DAYS;
  return { days: span, from: addDays(today, -(span - 1)), to: today };
}

/* ═══════════ 5. Pokrytie okna — koľko dní NEMÁME (I11, D119) ══════════════ */

/** Jeden deň okna a to, čo o ňom appka naozaj vie. */
export interface WindowCoverageDay {
  day: DateOnly;
  /** `complete` = meranie (aj s nulou). Všetko ostatné je „nevieme". */
  coverage: SalesDayCoverage;
}

/**
 * Pokrytie okna po dňoch — PRVOTRIEDNY údaj odpovede, nie poznámka pod čiarou.
 *
 * `unknownDays` je presne to číslo, ktoré kontrakt V4 žiada priznať („koľko dní
 * okna nemáme"). `missing` menuje tie dni, aby graf vedel, KDE má nakresliť
 * dieru — bez zoznamu by vedel len to, že niekde diera je.
 */
export interface WindowCoverage {
  windowDays: number;
  from: DateOnly;
  to: DateOnly;
  /** Riadok pre KAŽDÝ deň okna, aj pre ten, o ktorom nie je žiadny záznam. */
  days: WindowCoverageDay[];
  /** Dni so `complete` — jediné, ktorých súčet je meranie. */
  completeDays: number;
  /** Dni, ktorých sťahovanie sa začalo a neprinieslo celý deň (dolná hranica). */
  partialDays: number;
  pendingDays: number;
  /** Dni, o ktorých `sales_sync_state` nemá ani riadok. */
  missingDays: number;
  /** `missingDays + pendingDays + partialDays` — „koľko dní okna nemáme". */
  unknownDays: number;
  /** Ktoré dni okna nie sú `complete`, v kalendárnom poradí. */
  missing: DateOnly[];
  /** `true` = súčet okna je dolná hranica a obrazovka to MUSÍ povedať. */
  hasGap: boolean;
}

/**
 * Tri stavy jedného čísla nad oknom (I11) — a ani jeden z nich nie je „0".
 *
 *   · `measured`    — každý deň okna je `complete`; súčet je meranie,
 *   · `lower_bound` — časť dní chýba; súčet je DOLNÁ HRANICA, nie hodnota,
 *   · `unknown`     — ani jeden deň okna nie je `complete`; hodnota je `null`.
 *
 * Neobohatený produkt a nesťahovaný deň sú v tomto smere to isté: appka nevie,
 * a nula by bola tvrdenie. Práve toto rozlíšenie sa v tomto repe už raz
 * dostalo do produkcie zliate na nulu.
 */
export type MeasurementState = 'measured' | 'lower_bound' | 'unknown';

export function measurementState(coverage: WindowCoverage): MeasurementState {
  if (coverage.completeDays === 0) return 'unknown';
  return coverage.unknownDays === 0 ? 'measured' : 'lower_bound';
}

/**
 * Pokrytie okna zo stavu sťahovania predajov.
 *
 * Deň bez riadku v `sales_sync_state` je `missing` — nie nula. Deň mimo okna sa
 * ignoruje; okno sa prechádza KALENDÁRNE cez `addDays()`, nie pripočítavaním
 * 86 400 000 ms (v deň prechodu na letný čas by taká aritmetika deň preskočila).
 */
export function windowCoverage(
  rows: readonly SalesSyncDay[],
  range: WindowRange,
): WindowCoverage {
  const byDay = new Map<DateOnly, SalesSyncDay>();
  for (const row of rows) {
    if (!isDateOnly(row.saleDay)) continue;
    byDay.set(row.saleDay, row);
  }

  const days: WindowCoverageDay[] = [];
  const missing: DateOnly[] = [];
  let completeDays = 0;
  let partialDays = 0;
  let pendingDays = 0;
  let missingDays = 0;

  let cursor: DateOnly = range.from;
  for (let i = 0; i < range.days; i += 1) {
    const row = byDay.get(cursor);
    // Turbopack tu už raz zahodil null-guard cez `!row` — porovnávaj presne.
    const coverage: SalesDayCoverage = row === undefined ? 'missing' : row.status;
    if (coverage === 'complete') completeDays += 1;
    else {
      if (coverage === 'partial') partialDays += 1;
      else if (coverage === 'pending') pendingDays += 1;
      else missingDays += 1;
      missing.push(cursor);
    }
    days.push({ day: cursor, coverage });
    cursor = addDays(cursor, 1);
  }

  const unknownDays = partialDays + pendingDays + missingDays;
  return {
    windowDays: range.days,
    from: range.from,
    to: range.to,
    days,
    completeDays,
    partialDays,
    pendingDays,
    missingDays,
    unknownDays,
    missing,
    hasGap: unknownDays > 0,
  };
}

/** Sú VŠETKY dni úseku `[from, to]` dočítané? Prázdny úsek nie je pokrytý. */
export function isFullyMeasured(
  rows: readonly SalesSyncDay[],
  from: DateOnly,
  to: DateOnly,
): boolean {
  if (from > to) return false;
  const span = diffDays(from, to) + 1;
  const coverage = windowCoverage(rows, { days: span, from, to });
  return coverage.days.length === span && coverage.unknownDays === 0;
}

/** Ktoré dni úseku nie sú dočítané (pre priznanie medzery v odpovedi). */
export function missingDaysIn(
  rows: readonly SalesSyncDay[],
  from: DateOnly,
  to: DateOnly,
): DateOnly[] {
  if (from > to) return [];
  const span = diffDays(from, to) + 1;
  return windowCoverage(rows, { days: span, from, to }).missing;
}

/* ═══════════ 6. UPLIFT „pred / počas" (D115) — a pasca d00e081 ════════════ */

/**
 * Najkratšie okno, ktoré sa ešte dá porovnať. Dva dni proti dvom dňom je šum
 * s dvoma desatinnými miestami; `MIN_DAYS_FOR_TREND` v `lib/sales/insights.ts`
 * odmieta z toho istého dôvodu obdobie kratšie než štyri dni.
 */
export const UPLIFT_MIN_WINDOW_DAYS = 3;

/** VLASTNÉ úspešne zapísané okno zľavy na produkte (I11), nie stav v shope. */
export interface OwnDiscountWindow {
  campaignId: number;
  campaignName: string;
  percent: number;
  from: DateOnly;
  to: DateOnly;
}

/** Prečo sa uplift spočítať NEDÁ. Vždy kód, nikdy číslo namiesto dôvodu. */
export type UpliftReason =
  /** Appka na tento produkt nikdy úspešne nezapísala zľavu. */
  | 'no_discount_window'
  /** Zľava sa ešte nezačala — presne pasca d00e081. */
  | 'not_started'
  /** Okno „počas" má menej dní než `UPLIFT_MIN_WINDOW_DAYS`. */
  | 'window_too_short'
  /** Do porovnávacej základne zasahuje INÁ zľava toho istého produktu. */
  | 'baseline_overlaps_discount'
  /** Niektorý deň jedného z okien sa nesťahoval alebo sa nedosťahoval. */
  | 'coverage_gap';

export interface UpliftWindow {
  from: DateOnly;
  to: DateOnly;
  days: number;
  /** Kusy za okno. `null` = okno nie je celé dočítané, takže NEVIEME (I11). */
  units: number | null;
  /** Kusy na deň (2 desatiny). `null` z toho istého dôvodu ako `units`. */
  perDay: number | null;
}

export interface UpliftResult {
  /** `true` LEN keď obe okná stoja na dočítaných dňoch a sú porovnateľné. */
  available: boolean;
  reason: UpliftReason | null;
  /** Ktoré vlastné okno zľavy sa porovnáva (`null`, keď žiadne nesedí). */
  campaignId: number | null;
  campaignName: string | null;
  percent: number | null;
  /** Odkedy zľava platí — aby obrazovka povedala KEDY, nie len „ešte nie". */
  startsOn: DateOnly | null;
  /** Dĺžka OBOCH okien v dňoch (sú rovnako dlhé zámerne). */
  spanDays: number | null;
  /** `true` = zľava ešte beží, „počas" je len po dnešok. */
  duringTruncated: boolean;
  before: UpliftWindow | null;
  during: UpliftWindow | null;
  /**
   * Rozdiel kusov na deň v percentách. `null`, keď je základňa nula —
   * delenie nulou nie je „nekonečný rast", je to „nedá sa vyjadriť".
   */
  deltaPercent: number | null;
  /** Prečo `deltaPercent` chýba, hoci `available` je `true`. */
  deltaReason: 'zero_baseline' | null;
  /** Dni okna „počas", ktoré appka nemá. */
  missingDuring: DateOnly[];
  /** Dni okna „pred", ktoré appka nemá. */
  missingBefore: DateOnly[];
}

export interface UpliftInput {
  today: DateOnly;
  /** VLASTNÉ úspešné okná zliav produktu, v ľubovoľnom poradí. */
  windows: readonly OwnDiscountWindow[];
  /** Stav sťahovania predajov — rozhoduje, či sa uplift SMIE spočítať. */
  syncDays: readonly SalesSyncDay[];
  /** Denné kusy TOHO JEDNÉHO produktu. Deň mimo okien sa ignoruje. */
  days: readonly { day: DateOnly; units: number }[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

const EMPTY_UPLIFT: UpliftResult = {
  available: false,
  reason: null,
  campaignId: null,
  campaignName: null,
  percent: null,
  startsOn: null,
  spanDays: null,
  duringTruncated: false,
  before: null,
  during: null,
  deltaPercent: null,
  deltaReason: null,
  missingDuring: [],
  missingBefore: [],
};

/**
 * UPLIFT ZĽAVY NA JEDNOM PRODUKTE — definícia okien je TU a nikde inde.
 *
 * PREČO JE TÁTO DEFINÍCIA NAPÍSANÁ TAK NAHLAS
 * -------------------------------------------
 * 26. 8. 2026 (commit `d00e081`) sa v tomto repe ukázalo, že sekcia „Výkon"
 * porovnávala DVE OKNÁ, KTORÉ ZĽAVE OBE PREDCHÁDZALI, a nazývala to výkonom
 * zľavy: obe končili dneškom a `date_from` do výpočtu vôbec nevstupoval. Kým je
 * zápis fronta, normálny stav zľavy v detaile je „zapisuje sa" a jej okno je
 * v BUDÚCNOSTI — takže graf kreslil dva stĺpce, z ktorých jeden bol „silnejší",
 * a tvrdil tým vplyv, ktorý sa nemohol stať. Nasledujúce štyri definície sú
 * odpoveďou presne na to.
 *
 * 1. ČO JE OKNO „POČAS"
 * ---------------------
 * `[from, min(to, dnes)]` toho VLASTNÉHO okna zľavy, ktoré už ZAČALO a začalo
 * NAJNESKÔR (`from <= dnes`, najvyšší `from`). Deň po dnešku sa doň nikdy
 * nedostane — ešte sa nestal. Keď zľava ešte beží, okno je skrátené a odpoveď
 * to hovorí príznakom `duringTruncated`, nie mlčaním.
 * Keď ani jedno okno nezačalo, výsledok je `not_started` + `startsOn` a ŽIADNE
 * čísla. To je celá oprava d00e081 prenesená na produkt.
 *
 * 2. ČO JE OKNO „PRED"
 * --------------------
 * `[from − n, from − 1]`, kde `n` je dĺžka okna „počas". Základňa teda končí
 * DEŇ PRED začiatkom zľavy a je rovnako dlhá ako to, s čím sa porovnáva.
 *
 * 3. NEROVNAKÁ DĹŽKA
 * ------------------
 * Nemôže nastať: „pred" sa STAVIA z dĺžky okna „počas", nie z dĺžky kampane.
 * Preto tu nie je žiadne prepočítavanie ani „normalizácia" — a keď je „počas"
 * skrátené dneškom, skráti sa s ním aj „pred". Napriek tomu sa vracia aj
 * `perDay`: keby niekto v budúcnosti dĺžky rozviedol, číslo na deň zostane
 * porovnateľné a `spanDays` v odpovedi rozdiel ukáže.
 * Okno kratšie než `UPLIFT_MIN_WINDOW_DAYS` sa neporovnáva vôbec
 * (`window_too_short`).
 *
 * 4. NESTIAHNUTÉ DNI
 * ------------------
 * Uplift sa spočíta LEN vtedy, keď je KAŽDÝ deň OBOCH okien `complete`.
 * Nestačí „väčšina": `partial` deň je dolná hranica a chýbajúci deň nie je
 * nula, takže z ich zmesi vzniká rozdiel, ktorý meria výpadok sťahovania,
 * nie zľavu. Vtedy je `available: false`, `reason: 'coverage_gap'`, `units`
 * v oboch oknách `null` a `missingDuring` / `missingBefore` menujú KTORÉ dni
 * chýbajú. Dátumy okien sa vracajú aj tak — obrazovka má povedať, čo by
 * porovnávala, keby dáta mala.
 *
 * ČO TÁTO FUNKCIA NEROBÍ
 * ----------------------
 * Nevyslovuje príčinu. Vracia dve čísla vedľa seba a rozdiel medzi nimi, nikdy
 * vetu „zľava priniesla +18 %" (P8): appka nevie oddeliť vplyv zľavy od sezóny,
 * kampaní a skladu, a tváriť sa, že vie, by bolo klamstvo s číslom v ruke.
 * Do základne navyše NESMIE zasahovať iná zľava toho istého produktu
 * (`baseline_overlaps_discount`) — inak by sa zľava porovnávala so zľavou.
 */
export function upliftFor(input: UpliftInput): UpliftResult {
  const { today } = input;
  const valid = input.windows.filter(
    (w) => isDateOnly(w.from) && isDateOnly(w.to) && w.from <= w.to,
  );
  if (valid.length === 0) return { ...EMPTY_UPLIFT, reason: 'no_discount_window' };

  /* 1. Okno „počas": posledné okno, ktoré UŽ ZAČALO. */
  const started = valid.filter((w) => w.from <= today);
  if (started.length === 0) {
    const soonest = valid.reduce((best, w) => (w.from < best.from ? w : best), valid[0]!);
    return {
      ...EMPTY_UPLIFT,
      reason: 'not_started',
      campaignId: soonest.campaignId,
      campaignName: soonest.campaignName,
      percent: soonest.percent,
      startsOn: soonest.from,
    };
  }
  const chosen = started.reduce((best, w) => (w.from > best.from ? w : best), started[0]!);

  const duringTo = chosen.to < today ? chosen.to : today;
  const span = diffDays(chosen.from, duringTo) + 1;
  const head = {
    campaignId: chosen.campaignId,
    campaignName: chosen.campaignName,
    percent: chosen.percent,
    startsOn: chosen.from,
    duringTruncated: chosen.to > today,
  };

  if (span < UPLIFT_MIN_WINDOW_DAYS) {
    return { ...EMPTY_UPLIFT, ...head, reason: 'window_too_short', spanDays: span };
  }

  /* 2. Okno „pred": rovnako dlhé, končí deň pred začiatkom zľavy. */
  const beforeTo = addDays(chosen.from, -1);
  const beforeFrom = addDays(beforeTo, -(span - 1));

  const ranges: Pick<UpliftResult, 'spanDays' | 'before' | 'during'> = {
    spanDays: span,
    before: { from: beforeFrom, to: beforeTo, days: span, units: null, perDay: null },
    during: { from: chosen.from, to: duringTo, days: span, units: null, perDay: null },
  };

  /* Zľava sa nesmie porovnávať so zľavou. */
  const overlap = valid.find((w) => w !== chosen && w.from <= beforeTo && w.to >= beforeFrom);
  if (overlap !== undefined) {
    return { ...EMPTY_UPLIFT, ...head, ...ranges, reason: 'baseline_overlaps_discount' };
  }

  /* 4. Bez dočítaných dní sa neporovnáva nič. */
  const missingDuring = missingDaysIn(input.syncDays, chosen.from, duringTo);
  const missingBefore = missingDaysIn(input.syncDays, beforeFrom, beforeTo);
  if (missingDuring.length > 0 || missingBefore.length > 0) {
    return {
      ...EMPTY_UPLIFT,
      ...head,
      ...ranges,
      reason: 'coverage_gap',
      missingDuring,
      missingBefore,
    };
  }

  const sumIn = (from: DateOnly, to: DateOnly): number => {
    let total = 0;
    for (const row of input.days) {
      if (!isDateOnly(row.day) || row.day < from || row.day > to) continue;
      total += Math.max(0, Math.trunc(row.units));
    }
    return total;
  };

  const beforeUnits = sumIn(beforeFrom, beforeTo);
  const duringUnits = sumIn(chosen.from, duringTo);
  const beforePerDay = round2(beforeUnits / span);
  const duringPerDay = round2(duringUnits / span);

  return {
    available: true,
    reason: null,
    ...head,
    spanDays: span,
    before: {
      from: beforeFrom,
      to: beforeTo,
      days: span,
      units: beforeUnits,
      perDay: beforePerDay,
    },
    during: {
      from: chosen.from,
      to: duringTo,
      days: span,
      units: duringUnits,
      perDay: duringPerDay,
    },
    deltaPercent:
      beforePerDay === 0 ? null : round1(((duringPerDay - beforePerDay) / beforePerDay) * 100),
    deltaReason: beforePerDay === 0 ? 'zero_baseline' : null,
    missingDuring: [],
    missingBefore: [],
  };
}
