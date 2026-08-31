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
 *  · `missing` — dni okna, ktoré appka NEPOZNÁ. Nulou sa NEDOPLŇUJÚ.
 *  · `emptyDays` — dni, ktoré appka PREČÍTALA a nepredalo sa v nich nič.
 *  · `sumState` — čím je `sum`: meranie, dolná hranica, alebo „nevieme".
 *
 * ═══ TRI STAVY DŇA, NIE DVA (31. 8. 2026, migrácia 0016) ═══
 * Do 0016 táto route poznala len dva: „mám riadok" a „nemám riadok". Deň, ktorý
 * sa naozaj čítal a NEMAL ani jednu objednávku, pritom žiadnu menu neprinesie,
 * takže v `shop_revenue_daily` riadok nemá — a vychádzal ako `missing`, teda
 * „nevieme", hoci sme ho dočítali. Bola to nepresnosť v BEZPEČNOM smere (I11
 * zakazuje vydávať neznáme za nulu, nie naopak), ale znamenala, že appka NIKDY
 * nepovie „v tento deň sa nepredalo nič".
 *
 * Zatvára to `shop_revenue_read_state` (0016) — príznak prečítanosti dňa oddelený
 * od sumy, bez meny. `dayStates[]` má preto riadok pre KAŽDÝ deň okna a hovorí:
 *
 *   · `measured`    — deň dočítaný, objednávky boli; suma je celý deň,
 *   · `empty`       — deň DOČÍTANÝ a objednávka v ňom NEBOLA. Meraná nula.
 *   · `lower_bound` — čítanie sa nedočítalo; suma je dolná hranica a o nule
 *                     nehovorí nič (`≥ 0` je prázdna veta, nie priznanie),
 *   · `unknown`     — o dni appka nevie nič. Pomlčka, NIKDY nula.
 *
 * Deň s riadkami v `shop_revenue_daily`, ale bez stavu (čítal sa ešte pred 0016),
 * zostáva čítaný — hovorí to jeho vlastný `dayComplete`. Žiadny backfill.
 *
 * ČO SA TÝM NEUVOĽNILO: chýbajúci deň naďalej NEDOSTANE nulu. Nula tu vzniká
 * VÝHRADNE z príznaku „prečítali sme celý deň", nikdy z ticha.
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

/**
 * Čím je jeden deň okna. Štyri stavy, nie dva (0016) — a rozdiel medzi `empty`
 * a `unknown` je celý dôvod, prečo tá migrácia vznikla.
 */
export type RevenueDayKnowledge = 'measured' | 'empty' | 'lower_bound' | 'unknown';

/** Jeden deň okna a to, čo o ňom appka naozaj vie. */
export interface RevenueDayStateRow {
  day: DateOnly;
  state: RevenueDayKnowledge;
  /**
   * POČET objednávok dňa z príznaku prečítanosti (0016). `null` = stav appka
   * nemá; nula je MERANÝ fakt „čítali sme a objednávka nebola".
   */
  ordersSeen: number | null;
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
  /**
   * Dni okna, o ktorých táto mena NEVIE NIČ — deň bez stavu čítania, alebo deň
   * prečítaný len čiastočne. „Nevieme", nikdy nula.
   */
  missing: DateOnly[];
  /**
   * Dni okna bez riadku tejto meny, ktoré sa ale DOČÍTALI (0016) — teda meraná
   * nula: „čítali sme celý deň a v tejto mene nebolo nič". Do `sum` nepridávajú
   * nič (nula sa nesčítava), ale sú to práve ony, čo z dolnej hranice robí
   * meranie.
   */
  measuredZeroDays: DateOnly[];
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
  /** Riadok pre KAŽDÝ deň okna — tri stavy naraz, na jednom mieste (0016). */
  dayStates: RevenueDayStateRow[];
  /** Dni okna, o ktorých appka NEVIE NIČ. Nulou sa nedopĺňajú (I11). */
  missing: DateOnly[];
  /** Dni okna, ktoré sa DOČÍTALI a nepredalo sa v nich nič. Meraná nula. */
  emptyDays: DateOnly[];
  /** Koľko dní okna appka naozaj pozná (vrátane prečítaných prázdnych dní). */
  readDays: number;
  /** `true` = v okne je aspoň jeden deň, ktorý appka nemá alebo nedočítala. */
  hasGap: boolean;
}

export interface RevenueDailyDeps extends InsightsDeps {
  /**
   * Čítacia strana tržby: `shop_revenue_daily` (0014) A `shop_revenue_read_state`
   * (0016). Obe naraz zámerne — bez stavu čítania sa deň bez objednávok nedá
   * odlíšiť od dňa, ktorý sa nikdy nesťahoval, a route by opäť vydávala meranú
   * nulu za „nevieme".
   */
  salesRepo?: Pick<typeof defaultSalesRepo, 'listRevenue' | 'listRevenueReadStates'>;
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
        /* 0016 — príznak prečítanosti dňa. Bez neho by dočítaný deň bez
         * objednávok vyšiel ako „nevieme", hoci sa nepredalo nič. */
        const states = await sales.listRevenueReadStates(range.from, range.to);

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

        /*
         * TRI STAVY DŇA (0016). Poradie podmienok je tu to podstatné:
         *
         *  · riadky sú  ⇒ deň sa čítal; `measured` alebo `lower_bound` podľa
         *    toho, či je dočítaný. Deň s riadkami z času PRED 0016 stav nemá,
         *    takže rozhoduje `dayComplete` samotných riadkov — žiadny backfill.
         *  · riadky nie sú a stav hovorí „dočítané"  ⇒ `empty`: PREČÍTALI SME
         *    a nepredalo sa nič. To je meraný fakt, ktorý 0016 pridala.
         *  · riadky nie sú a stav je čiastočný alebo chýba ⇒ `unknown`. Dolná
         *    hranica `≥ 0` je prázdna veta, nie priznanie nuly.
         */
        const rowsByDay = new Map<DateOnly, ShopRevenueDayRecord[]>();
        for (const row of rows) {
          const bucket = rowsByDay.get(row.day);
          if (bucket === undefined) rowsByDay.set(row.day, [row]);
          else bucket.push(row);
        }
        const stateByDay = new Map<DateOnly, (typeof states)[number]>();
        for (const state of states) stateByDay.set(state.day, state);

        const dayStates: RevenueDayStateRow[] = windowDays.map((day) => {
          // Turbopack tu už raz zahodil guard cez `!row` — porovnávaj presne.
          const state = stateByDay.get(day) ?? null;
          const dayRows = rowsByDay.get(day) ?? [];
          const rowsComplete = dayRows.length > 0 && dayRows.every((row) => row.dayComplete);
          const ordersSeen = state === null ? null : state.ordersSeen;

          if (dayRows.length > 0) {
            /*
             * Dva fakty o tom istom dni musia súhlasiť OBA. Zápisová strana ich
             * drží v zhode, ale nie vždy: keď mal deň dočítanú NULU (stav áno,
             * riadok nie) a neskoršie ČIASTOČNÉ čítanie v ňom nájde objednávku,
             * vznikne nedočítaný riadok pri stave, ktorý ešte hovorí „dočítané".
             * `||` by vtedy tvrdilo, že suma je celý deň — a to už nie je pravda.
             */
            const complete = state === null ? rowsComplete : state.dayComplete && rowsComplete;
            return { day, state: complete ? 'measured' : 'lower_bound', ordersSeen };
          }
          if (state !== null && state.dayComplete) return { day, state: 'empty', ordersSeen };
          return { day, state: 'unknown', ordersSeen };
        });

        const knowledgeOf = new Map<DateOnly, RevenueDayKnowledge>(
          dayStates.map((row) => [row.day, row.state]),
        );
        /** Deň sa DOČÍTAL — chýbajúca mena v ňom je meraná nula, nie medzera. */
        const readWhole = (day: DateOnly): boolean => {
          const state = knowledgeOf.get(day);
          return state === 'measured' || state === 'empty';
        };

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
          /*
           * Deň bez riadku tejto meny má DVE úplne rôzne príčiny a rozhodne
           * o nich stav dňa (0016), nie ticho v tabuľke hodnôt:
           *  · deň dočítaný ⇒ v tejto mene nebolo nič. MERANÁ nula.
           *  · inak         ⇒ nevieme.
           */
          const absent = windowDays.filter((day) => !present.has(day));
          const measuredZeroDays = absent.filter((day) => readWhole(day));
          const missing = absent.filter((day) => !readWhole(day));

          /*
           * Súčet je meranie LEN vtedy, keď o každom dni okna vieme — buď má
           * dočítaný riadok, alebo je to prečítaná nula. Inak je to dolná
           * hranica; a keď nevieme nič, `sum` je `null`, nie `0.00`.
           */
          const sumState: MeasurementState =
            days.length === 0 && measuredZeroDays.length === 0
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
            measuredZeroDays,
            sum: days.length === 0 ? null : sumMoney(days.map((row) => row.totalPaidSum)),
            sumState,
          };
        });

        /*
         * `missing` je odteraz „nevieme", nie „nemám riadok". Deň, ktorý sa
         * dočítal a nepredalo sa v ňom nič, je v `emptyDays` — appka o ňom VIE
         * a tvrdiť pri ňom pomlčku by bolo priznanie nevedomosti, ktorú nemá.
         */
        const missing = dayStates.filter((row) => row.state === 'unknown').map((row) => row.day);
        const emptyDays = dayStates.filter((row) => row.state === 'empty').map((row) => row.day);

        return {
          today,
          window: range,
          scope: 'eshop',
          currencies,
          series,
          dayStates,
          missing,
          emptyDays,
          readDays: windowDays.length - missing.length,
          hasGap: missing.length > 0 || series.some((row) => row.lowerBoundDays > 0),
        };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsRevenueDailyGet();
