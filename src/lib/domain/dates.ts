/**
 * Aura Zľavy — dátumová logika (A7, D13, D29, D31, D32, D59).
 *
 * Jediné miesto v appke, kde sa prepočítava medzi kalendárnym dňom
 * (`DateOnly` = `YYYY-MM-DD`, bez zóny) a UTC časovou pečiatkou. Doménová zóna
 * je **Europe/Bratislava** (D31), v DB sú všetky `DATETIME` v UTC.
 *
 * Čo tu platí:
 *  - `fire_at` = `date_from` o `SCHEDULER_FIRE_TIME` (default `00:05`)
 *    bratislavského času prevedené do UTC — korektne aj cez DST hranicu (D32).
 *  - „+3 mesiace" je **kalendárne** (31.1. + 3M = 30.4.), nie 90 dní (D29).
 *  - Zápisové okno je „zamrznuté" ±`MIDNIGHT_FREEZE_SECONDS` okolo polnoci,
 *    aby sa dátumy neprepočítali na hrane dňa (D59).
 *  - Zobrazovací formát je `DD.MM.YYYY` (D13).
 *
 * Modul je **čistý**: žiadna DB, žiadna sieť, žiadne čítanie `process.env`.
 * Volajúci (scheduler/engine/routes) posiela `now` a prípadne konfiguráciu
 * z `@/env`; defaulty tu zodpovedajú defaultom zod schémy A0.
 *
 * Vlastník: A7.
 */
import { TZDate } from '@date-fns/tz';

import { DOMAIN_ERROR_CODES, DomainError } from '@/lib/domain/errors';
import type { DateOnly, UtcDate } from '@/contracts';

/* ═════════════════════════════ 1. Konštanty ═══════════════════════════════ */

/** Doménová zóna všetkej dátumovej logiky (D31, `LOGIC_TIMEZONE`). */
export const LOGIC_TIME_ZONE = 'Europe/Bratislava';

/** Default `SCHEDULER_FIRE_TIME` (D32). */
export const DEFAULT_FIRE_TIME = '00:05';

/** Default `MIDNIGHT_FREEZE_SECONDS` (D59). */
export const DEFAULT_MIDNIGHT_FREEZE_SECONDS = 60;

/** Kalendárny strop okna kampane v mesiacoch (D29 — nikdy nie 90 dní). */
export const MAX_WINDOW_MONTHS = 3;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HH_MM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MS_PER_DAY = 86_400_000;

/* ═══════════════════════ 2. `DateOnly` — parsing ══════════════════════════ */

export interface CalendarDay {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `true` len pre existujúci kalendárny deň v tvare `YYYY-MM-DD`. */
export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string') return false;
  const m = DATE_ONLY_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/** Rozloží `YYYY-MM-DD` na kalendárne zložky. Neplatný vstup = `DomainError`. */
export function parseDateOnly(value: string, field = 'dátum'): CalendarDay {
  if (!isDateOnly(value)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.invalidDateFormat,
      `Neplatný ${field}: očakáva sa existujúci kalendárny deň v tvare RRRR-MM-DD.`,
      { field, value },
    );
  }
  const m = DATE_ONLY_RE.exec(value) as RegExpExecArray;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

/** Zloží `DateOnly` z kalendárnych zložiek (bez akejkoľvek zóny). */
export function toDateOnly(day: CalendarDay): DateOnly {
  return `${pad(day.year, 4)}-${pad(day.month)}-${pad(day.day)}`;
}

/** Zobrazovací formát `DD.MM.YYYY` (D13). */
export function formatDateOnlySk(value: DateOnly): string {
  const d = parseDateOnly(value);
  return `${pad(d.day)}.${pad(d.month)}.${pad(d.year, 4)}`;
}

/**
 * Výklad okna pod dátumovými poľami (D13) — appka ho MUSÍ zobraziť slovom,
 * aby bolo jasné, že `to` je vrátane a ide o čas shopu.
 */
export function describeWindowSk(from: DateOnly, to: DateOnly): string {
  return `platí od 00:00 dňa ${formatDateOnlySk(from)} do 23:59 dňa ${formatDateOnlySk(to)} (čas shopu)`;
}

/** Lexikografické porovnanie je pri `YYYY-MM-DD` totožné s kalendárnym. */
export function compareDateOnly(a: DateOnly, b: DateOnly): number {
  parseDateOnly(a, 'dátum A');
  parseDateOnly(b, 'dátum B');
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isSameOrBefore = (a: DateOnly, b: DateOnly): boolean => compareDateOnly(a, b) <= 0;
export const isSameOrAfter = (a: DateOnly, b: DateOnly): boolean => compareDateOnly(a, b) >= 0;
export const isBefore = (a: DateOnly, b: DateOnly): boolean => compareDateOnly(a, b) < 0;
export const isAfter = (a: DateOnly, b: DateOnly): boolean => compareDateOnly(a, b) > 0;

/** `min`/`max` nad kalendárnymi dňami. */
export const maxDateOnly = (a: DateOnly, b: DateOnly): DateOnly => (isAfter(a, b) ? a : b);
export const minDateOnly = (a: DateOnly, b: DateOnly): DateOnly => (isBefore(a, b) ? a : b);

/* ══════════════════════ 3. Kalendárna aritmetika ══════════════════════════ */

/** Pripočíta celé dni (kalendárne, bez zóny — nie hodinami, takže DST nehrá rolu). */
export function addDays(value: DateOnly, days: number): DateOnly {
  const d = parseDateOnly(value);
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day) + days * MS_PER_DAY);
  return toDateOnly({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

/**
 * Kalendárne „+N mesiacov" so zaseknutím na poslednom dni mesiaca (D29):
 * `31.1. + 3M = 30.4.`, `30.11. + 3M = 28./29.2.`. NIKDY nie 90 dní.
 */
export function addCalendarMonths(value: DateOnly, months: number): DateOnly {
  const d = parseDateOnly(value);
  const totalMonths = d.year * 12 + (d.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return toDateOnly({ year, month, day: Math.min(d.day, daysInMonth(year, month)) });
}

/** Počet celých dní medzi dvoma kalendárnymi dňami (`to − from`). */
export function diffDays(from: DateOnly, to: DateOnly): number {
  const a = parseDateOnly(from);
  const b = parseDateOnly(to);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY,
  );
}

/** Najvzdialenejší povolený `to` pre dané `from` (kalendárne +3 mesiace, D29). */
export function maxAllowedTo(from: DateOnly, months = MAX_WINDOW_MONTHS): DateOnly {
  return addCalendarMonths(from, months);
}

/** `to` musí byť najviac `from + 3 kalendárne mesiace` (D29, I9). */
export function isWithinMaxWindow(
  from: DateOnly,
  to: DateOnly,
  months = MAX_WINDOW_MONTHS,
): boolean {
  return isSameOrBefore(to, maxAllowedTo(from, months));
}

/* ════════════════════ 4. Prevody medzi zónou a UTC ════════════════════════ */

/** Rozloženie UTC instantu na lokálny čas doménovej zóny. */
export interface ZonedParts extends CalendarDay {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  /** `YYYY-MM-DD` toho istého momentu v zóne. */
  dateOnly: DateOnly;
}

/** Rozloží UTC `Date` na lokálne zložky v `timeZone` (default Europe/Bratislava). */
export function zonedParts(now: UtcDate, timeZone = LOGIC_TIME_ZONE): ZonedParts {
  const z = new TZDate(now.getTime(), timeZone);
  const day: CalendarDay = { year: z.getFullYear(), month: z.getMonth() + 1, day: z.getDate() };
  return {
    ...day,
    hour: z.getHours(),
    minute: z.getMinutes(),
    second: z.getSeconds(),
    millisecond: z.getMilliseconds(),
    dateOnly: toDateOnly(day),
  };
}

/** Dnešný kalendárny deň v doménovej zóne (D31) — základ pre `from ≥ dnes`. */
export function todayInZone(now: UtcDate, timeZone = LOGIC_TIME_ZONE): DateOnly {
  return zonedParts(now, timeZone).dateOnly;
}

export interface ResolvedLocalTime {
  /** Výsledný UTC instant. */
  utc: UtcDate;
  /** Skutočný lokálny čas `HH:mm`, ktorý instant reprezentuje. */
  localTime: string;
  /**
   * `true`, ak požadovaný lokálny čas v ten deň neexistoval (jarný DST skok)
   * a zóna ho posunula dopredu. Pri default `00:05` sa nestane nikdy —
   * európske prechody sú o 02:00/03:00 lokálneho času.
   */
  adjusted: boolean;
}

/**
 * Prevedie „kalendárny deň + `HH:mm` lokálneho času" na UTC instant.
 * Zvládne obe DST hranice: v marci je 00:05 ešte CET (+01:00), v apríli až
 * októbri CEST (+02:00) — a pri neexistujúcom lokálnom čase vráti
 * `adjusted: true`, aby to volajúci mohol zalogovať namiesto tichej odchýlky.
 */
export function resolveLocalTimeToUtc(
  date: DateOnly,
  time = DEFAULT_FIRE_TIME,
  timeZone = LOGIC_TIME_ZONE,
): ResolvedLocalTime {
  const d = parseDateOnly(date);
  const m = HH_MM_RE.exec(time);
  if (!m) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.invalidDateFormat,
      'Neplatný čas spustenia: očakáva sa tvar HH:mm (00:00–23:59).',
      { time },
    );
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const zoned = new TZDate(d.year, d.month - 1, d.day, hour, minute, 0, 0, timeZone);
  const utc = new Date(zoned.getTime());
  const actual = zonedParts(utc, timeZone);
  return {
    utc,
    localTime: `${pad(actual.hour)}:${pad(actual.minute)}`,
    adjusted: actual.hour !== hour || actual.minute !== minute,
  };
}

/**
 * `fire_at` kampane: `date_from` o `SCHEDULER_FIRE_TIME` bratislavského času
 * v UTC (D32). Scheduler ho porovnáva s `now()` v UTC.
 */
export function fireAtUtc(
  dateFrom: DateOnly,
  fireTime = DEFAULT_FIRE_TIME,
  timeZone = LOGIC_TIME_ZONE,
): UtcDate {
  return resolveLocalTimeToUtc(dateFrom, fireTime, timeZone).utc;
}

/** Začiatok dňa (00:00 lokálne) v UTC. */
export function startOfDayUtc(date: DateOnly, timeZone = LOGIC_TIME_ZONE): UtcDate {
  return resolveLocalTimeToUtc(date, '00:00', timeZone).utc;
}

/**
 * Koniec dňa v UTC = začiatok NASLEDUJÚCEHO dňa (exkluzívna hranica).
 * Používa sa na „okno kampane skončilo" — `to` je vrátane celého dňa (D13).
 */
export function endOfDayExclusiveUtc(date: DateOnly, timeZone = LOGIC_TIME_ZONE): UtcDate {
  return startOfDayUtc(addDays(date, 1), timeZone);
}

/* ══════════════════════ 5. Polnočná hrana (D59) ═══════════════════════════ */

/** Sekundy od lokálnej polnoci (0 – 86 399). */
export function secondsSinceLocalMidnight(now: UtcDate, timeZone = LOGIC_TIME_ZONE): number {
  const p = zonedParts(now, timeZone);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

/**
 * Zápisové okno je „zamrznuté" ±`freezeSeconds` okolo lokálnej polnoci (D59):
 * v tomto pásme sa dátumy neprepočítavajú a zápis sa odloží na ďalší tick,
 * aby kampaň nedostala `from` z iného dňa, než nad ktorým padlo rozhodnutie.
 */
export function isMidnightFrozen(
  now: UtcDate,
  freezeSeconds = DEFAULT_MIDNIGHT_FREEZE_SECONDS,
  timeZone = LOGIC_TIME_ZONE,
): boolean {
  if (freezeSeconds <= 0) return false;
  const s = secondsSinceLocalMidnight(now, timeZone);
  return s < freezeSeconds || s >= 86_400 - freezeSeconds;
}

/** Tvrdá varianta pre engine: v zamrznutom okne sa nezapisuje (D59, fail-closed). */
export function assertNotMidnightFrozen(
  now: UtcDate,
  freezeSeconds = DEFAULT_MIDNIGHT_FREEZE_SECONDS,
  timeZone = LOGIC_TIME_ZONE,
): void {
  if (isMidnightFrozen(now, freezeSeconds, timeZone)) {
    throw new DomainError(
      DOMAIN_ERROR_CODES.midnightFreeze,
      'Zápis je pozastavený na hrane dňa (±60 s okolo polnoci). Skús to o minútu — dátumy sa prepočítajú až po prechode dňa.',
      { freezeSeconds },
    );
  }
}

/* ════════════════════════ 6. Pomôcky pre scheduler ════════════════════════ */

/** Hodiny do `target` (môže byť negatívne, ak už uplynul). */
export function hoursUntil(target: UtcDate, now: UtcDate): number {
  return (target.getTime() - now.getTime()) / 3_600_000;
}

/** `fire_at` už nastal? (`fire_at ≤ now`, D32). */
export function isDue(fireAt: UtcDate, now: UtcDate): boolean {
  return fireAt.getTime() <= now.getTime();
}

/**
 * Kampaň je zmeškaná, ak `fire_at` je starší než `now − graceMinutes` (D33b).
 * Toto NIE JE „catch-up okno": po uplynutí tolerancie sa kampaň NIKDY
 * nedobehne automaticky, len sa označí ako `missed` a čaká na ručné rozhodnutie.
 */
export function isMissedFire(fireAt: UtcDate, now: UtcDate, graceMinutes = 5): boolean {
  return now.getTime() - fireAt.getTime() > graceMinutes * 60_000;
}

/** Okno kampane je v deň `today` ešte živé (`to ≥ dnes`) — inak je prepadnutá (D25). */
export function isWindowStillOpen(dateTo: DateOnly, today: DateOnly): boolean {
  return isSameOrAfter(dateTo, today);
}
