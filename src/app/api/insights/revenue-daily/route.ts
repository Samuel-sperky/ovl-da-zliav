/**
 * Aura Zľavy — `GET /api/insights/revenue-daily` (V4, D117).
 *
 * DENNÁ TRŽBA ESHOPU pre graf na Prehľade. Nič viac a nič iné.
 *
 * ═══ PREČO JE TO VLASTNÁ ROUTE A NIE POLE V `sales-daily` ═══
 * Sonda 28. 8. 2026 zmerala, že objednávkové API NEVRACIA ceny položiek
 * (`products: [{id, qty}]`, žiadna cena). Tržba v eurách preto existuje VÝHRADNE
 * na úrovni CELÉHO ESHOPU — denný súčet `total_paid` — kým predané kusy sú per
 * produkt a v `sales-daily` navyše len za AKTÍVNY VÝBER. Sú to teda dva rôzne
 * rozsahy, dve rôzne jednotky a dva rôzne fakty o úplnosti dňa.
 *
 * Keby obe čísla prišli v jednej odpovedi, ležali by vedľa seba ako dve strany
 * tej istej veci a stačilo by jedno delenie, aby vznikla „cena za kus" alebo
 * „obrat produktu". Presne to D117 ZAKAZUJE: v `total_paid` je poštovné, zľavy
 * a kupóny, takže akékoľvek rozdelenie medzi položky je vymyslené číslo vydávané
 * za obrat (I11). Oddelená route je tá najlacnejšia prekážka, akú sa tomu dalo
 * postaviť — a `scope: 'eshop'` v odpovedi je jej menovka.
 *
 * ═══ ČO TÁTO ODPOVEĎ NIKDY NEOBSAHUJE ═══
 *  · `productId` (ani v jednom riadku, ani v jednom type — stráži to test),
 *  · súčet cez MENY. Každá mena má vlastný rad; 125,50 EUR + 2 500 CZK nie je
 *    2 625,50 čohokoľvek.
 *  · čokoľvek zo zákazníckych dát (I8' bod 3) — zdrojom je denný agregát
 *    `shop_revenue_daily`, kde je iba deň, mena, súčet a POČET objednávok.
 *
 * ═══ ČO PRIZNÁVA (a obrazovka MUSÍ vykresliť) ═══
 *  · `days[].dayComplete === false` — súčet dňa je DOLNÁ HRANICA (sťahovanie
 *    zoznamu sa nedočítalo). Bez toho posledný, rozbehnutý deň vždy vyzerá ako
 *    prudký pokles tržieb a graf kreslí pád, ktorý sa nestal.
 *  · `missing` — dni okna, ku ktorým appka NEMÁ riadok. Nulou sa NEDOPLŇUJÚ.
 *  · `sumState` — čím je `sum`: meranie, dolná hranica, alebo „nevieme".
 *
 * MEDZERA, KTORÁ SEM PATRÍ NAHLAS: deň, ktorý sa naozaj čítal a NEMAL ani jednu
 * objednávku, nemá menu, takže v `shop_revenue_daily` nemá ani riadok — a tu
 * vyjde ako `missing`, teda „nevieme". Je to nepresnosť v BEZPEČNOM smere (I11
 * zakazuje vydávať neznáme za nulu, nie naopak) a zavrie ju až stav čítania
 * tržby po dňoch v ďalšej aditívnej migrácii. Dovtedy sa nesmie „opraviť" tak,
 * že chýbajúci deň dostane nulu.
 *
 * ČISTO ČÍTACIE. Žiadne volanie shopu (K8) — sťahovanie tržby má na starosti
 * `lib/engine/sales-sync.ts` a beží nočne. Žiadny zápis, teda ani cesta, ktorá
 * by obišla potvrdenie (I3). Žiadny kľúč (I1).
 *
 * Vlastník: vlna V4-ENDPOINTY.
 */
import { z } from 'zod';

import type { DateOnly, MoneyString, ShopRevenueDayRecord } from '@/contracts';

import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { addDays } from '@/lib/domain/dates';
import { salesRepo as defaultSalesRepo } from '@/lib/repo/sales.repo';

import {
  DEFAULT_WINDOW_DAYS,
  anchorQuery,
  resolveInsightsDeps,
  todayOf,
  windowQuery,
  windowRange,
  type InsightsDeps,
  type MeasurementState,
  type WindowRange,
} from '../_shared';

const querySchema = z.object({ anchor: anchorQuery, window: windowQuery });

/** Jeden deň jednej meny. ŽIADNY produkt — tržba je eshopová (D117). */
export interface RevenueDayRow {
  day: DateOnly;
  /** Súčet `total_paid` ako string (`DECIMAL`), nikdy float. */
  totalPaidSum: MoneyString;
  /** POČET objednávok v súčte, nie odkaz na objednávku (I8' bod 3). */
  ordersCount: number;
  /** `false` = súčet dňa je dolná hranica, nie celý deň. */
  dayComplete: boolean;
}

/** Rad jednej meny za okno. Meny sa NIKDY nesčítavajú do jedného čísla. */
export interface RevenueSeries {
  currency: string;
  /** Len dni, ku ktorým riadok naozaj je. Chýbajúci deň sa nedopĺňa nulou. */
  days: RevenueDayRow[];
  /** Dni okna s riadkom a `dayComplete = true`. */
  completeDays: number;
  /** Dni okna s riadkom, ktorý je zatiaľ len dolná hranica. */
  lowerBoundDays: number;
  /** Dni okna BEZ riadku — „nevieme", nikdy nula. */
  missing: DateOnly[];
  /** Súčet okna. `null` = v okne nie je ani jeden riadok tejto meny. */
  sum: MoneyString | null;
  sumState: MeasurementState;
}

export interface RevenueDailyResponse {
  today: DateOnly;
  window: WindowRange;
  /** Menovka rozsahu. Konštanta — aby sa tržba nedala prečítať ako produktová. */
  scope: 'eshop';
  currencies: string[];
  series: RevenueSeries[];
  /** Dni okna, ku ktorým nie je riadok v ŽIADNEJ mene. */
  missing: DateOnly[];
  /** Koľko dní okna má aspoň jeden riadok. */
  readDays: number;
  /** `true` = v okne je aspoň jeden deň, ktorý appka nemá alebo nedočítala. */
  hasGap: boolean;
}

export interface RevenueDailyDeps extends InsightsDeps {
  /** Čítacia strana `shop_revenue_daily` (migrácia 0014). */
  salesRepo?: Pick<typeof defaultSalesRepo, 'listRevenue'>;
}

/* ═══════════════════════════ Peniaze v centoch ════════════════════════════ */

/**
 * Súčet dennych súm JEDNEJ meny. Sčítava sa v CENTOCH (celé čísla) a von ide
 * string s dvoma desatinami: `DECIMAL(12,2)` má presne to isté rozlíšenie, kým
 * `number` s desatinami by na tridsiatich dňoch nazbieral halier, ktorý by
 * nikto neuvidel a nikto by ho nevedel vysvetliť.
 *
 * Nečitateľná suma sa NEPRESKOČÍ — vráti `null`. Preskočený deň by nechal
 * súčet vyzerať úplne a ticho nižšie, čo je presne ten druh lži, pred ktorou
 * `orders-client.ts` fail-closed zavrel celú stranu.
 */
function sumMoney(values: readonly string[]): MoneyString | null {
  let cents = 0;
  for (const raw of values) {
    const text = String(raw).trim();
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (match === null) return null;
    const sign = match[1] === '-' ? -1 : 1;
    const whole = Number(match[2]);
    const frac = Number((match[3] ?? '0').padEnd(2, '0'));
    if (!Number.isSafeInteger(whole) || !Number.isFinite(frac)) return null;
    cents += sign * (whole * 100 + frac);
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const text = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return (negative ? `-${text}` : text) as MoneyString;
}

/* ═══════════════════════════════ Route ════════════════════════════════════ */

export function createInsightsRevenueDailyGet(
  overrides: RevenueDailyDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  const sales = overrides.salesRepo ?? defaultSalesRepo;

  return defineRoute(
    {
      method: 'GET',
      query: querySchema,
      handler: async (ctx): Promise<RevenueDailyResponse> => {
        const today = ctx.query.anchor ?? todayOf(d);
        const range = windowRange(today, ctx.query.window ?? DEFAULT_WINDOW_DAYS);

        const rows = await sales.listRevenue(range.from, range.to);

        /* Zoskupenie po menách. Mena je časť kľúča a nikdy sa nesčítava. */
        const byCurrency = new Map<string, ShopRevenueDayRecord[]>();
        for (const row of rows) {
          const code = String(row.currency ?? '').trim().toUpperCase();
          if (code.length === 0) continue;
          const bucket = byCurrency.get(code);
          if (bucket === undefined) byCurrency.set(code, [row]);
          else bucket.push(row);
        }

        /* Dni okna kalendárne — nie pripočítavaním milisekúnd (letný čas). */
        const windowDays: DateOnly[] = [];
        let cursor: DateOnly = range.from;
        for (let i = 0; i < range.days; i += 1) {
          windowDays.push(cursor);
          cursor = addDays(cursor, 1);
        }

        const currencies = [...byCurrency.keys()].sort();
        const series: RevenueSeries[] = currencies.map((currency) => {
          const list = (byCurrency.get(currency) ?? [])
            .slice()
            .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
          const present = new Set(list.map((row) => row.day));

          const days: RevenueDayRow[] = list.map((row) => ({
            day: row.day,
            totalPaidSum: row.totalPaidSum,
            ordersCount: row.ordersCount,
            dayComplete: row.dayComplete,
          }));

          const completeDays = days.filter((row) => row.dayComplete).length;
          const lowerBoundDays = days.length - completeDays;
          const missing = windowDays.filter((day) => !present.has(day));

          /*
           * Súčet je meranie LEN vtedy, keď je každý deň okna prítomný aj
           * dočítaný. Inak je to dolná hranica — a keď nie je ani jeden riadok,
           * je to „nevieme" a `sum` je `null`, nie `0.00`.
           */
          const sumState: MeasurementState =
            days.length === 0
              ? 'unknown'
              : missing.length === 0 && lowerBoundDays === 0
                ? 'measured'
                : 'lower_bound';

          return {
            currency,
            days,
            completeDays,
            lowerBoundDays,
            missing,
            sum: days.length === 0 ? null : sumMoney(days.map((row) => row.totalPaidSum)),
            sumState,
          };
        });

        const anyDay = new Set(rows.map((row) => row.day));
        const missing = windowDays.filter((day) => !anyDay.has(day));

        return {
          today,
          window: range,
          scope: 'eshop',
          currencies,
          series,
          missing,
          readDays: windowDays.length - missing.length,
          hasGap: missing.length > 0 || series.some((row) => row.lowerBoundDays > 0),
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsRevenueDailyGet();
