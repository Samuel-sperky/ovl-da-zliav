/**
 * Aura Zľavy — `GET /api/insights/product-kpi` (V4, D114).
 *
 * KPI RIADKU PRE CELÚ STRÁNKU PRODUKTOV NARAZ. Tab Produkty stránkuje po 100
 * riadkov; táto route dostane ich ID a vráti pre každý riadok tie čísla, ktoré
 * D114 menuje: predané ks za 30 a 90 dní, podklady obrátkovosti, posledný
 * predaj, cenu, aktívnu zľavu a maržu.
 *
 * ═══ TÁTO ROUTE KPI NEPOČÍTA — A JE TO ZÁMER ═══
 * Celý výpočet je `productKpis()` v `lib/sales/insights.ts` (vlna čítacej vrstvy
 * KPI): tri dotazy bez ohľadu na počet riadkov, tri stavy každého čísla v type
 * `KpiValue<T>` z `contracts.ts`. Táto route je nad tým TENKÁ vrstva HTTP —
 * zvaliduje ID, povie okno a odpoveď pošle nezmenenú.
 *
 * Prvá verzia tejto route si KPI skladala sama z `enrichmentFor()`, `getMany()`
 * a `dailyUnits()`. Fungovala, ale boli to DVA výpočty tej istej veci v jednom
 * repe — a keď sa raz rozladia, obrazovka a repozitár budú tvrdiť o produkte
 * dve rôzne čísla a ani jedno nebude označené za nesprávne. Preto je tu už len
 * delegovanie; keď treba KPI zmeniť, mení sa `productKpis()`, nie route.
 *
 * ═══ TRI STAVY KAŽDÉHO ČÍSLA (I11) ═══
 * Nesie ich `KpiValue<T>`: `gap === null` znamená „hodnotu POZNÁME" (a `0` je
 * platná nula), `gap: 'not_enriched'` znamená „`getFull` sa na produkt nikdy
 * nepýtalo" (D118), `gap: 'shop_has_none'` znamená „pýtalo a shop o tom poli nič
 * nevie", `gap: 'days_missing'` znamená „okno nie je stiahnuté". Nula sa
 * z ani jedného z nich NESMIE stať — je to najčastejšia chyba tohto repa.
 * Či je súčet okna celý alebo len DOLNÁ HRANICA, hovorí `unknownDays` v
 * `window30`/`window90`.
 *
 * ═══ POZOR NA MENÁ `window30` / `window90` ═══
 * Sú to menovky KRÁTKEHO a DLHÉHO okna z kontraktu KPI, nie sľub, že majú 30 a
 * 90 dní: `?window=7` posunie KRÁTKE okno na sedem dní a `?long=360` DLHÉ na
 * 360. Skutočnú dĺžku hovorí `windowDays` v každom z tých dvoch objektov
 * a navyše `requested` v odpovedi. Kto číslo pripíše k nadpisu „30 dní" bez
 * pohľadu na `windowDays`, napíše nadpis, ktorý neplatí.
 *
 * ═══ `?long=` A PREČO JE 360 DNÍ NORMÁLNE „DOLNÁ HRANICA" (D149, V7) ═══
 * Dlhé okno sa dá vypýtať zo zoznamu okien predajnosti (30/60/90/180/360 —
 * `SOLD_WINDOW_CHOICES`). Do 3. 9. 2026 bolo pribité na 90 a ENV strop
 * `SALES_WINDOW_DAYS` bol tiež 90, kým prepínač v UI ponúkal 180 a 360: filter
 * teda sľuboval okná, za ktorými nikdy nemohli byť dáta (pasca D125).
 *
 * Zdvihnutý strop NIE JE sľub dát. Sťahovanie histórie je dlhé (dráha `orders`
 * má 800 čítaní na UTC deň a jedna objednávka je jeden request), takže pri okne
 * 360 dní bude `window90.completeDays` ešte dlho výrazne menšie než
 * `windowDays`. Odpoveď to hovorí ČÍSLOM na dvoch miestach naraz:
 *   · `window90.completeDays` / `unknownDays` — koľko dní okna appka MÁ,
 *   · `rows[].units90.lowerBound` — či je súčet kusov len dolná hranica.
 * Obrazovka má z toho povedať „≥ N za 360 dní (dočítaných M dní)". Nula sa
 * z nedočítaného okna NESMIE stať nikdy (I11).
 *
 * ═══ ČO TU NIE JE ═══
 * Tržba per produkt (D117 — API ceny položiek nevracia, takže NEEXISTUJE a nie
 * je tu ani jedno pole, z ktorého by sa dala zliať) a účtovná obrátkovosť
 * (`stockTurns` je pomer meraných faktov a hovorí to vo vlastnom docbloku).
 *
 * ČISTO ČÍTACIE. Žiadne volanie shopu (K8) — obohatenie doťahuje
 * `POST /api/catalog/enrich`, nie táto route. Žiadny zápis, žiadny kľúč (I1).
 *
 * Vlastník: vlna V4-ENDPOINTY.
 */
import { z } from 'zod';

import type { DateOnly, ProductKpiPage } from '@/contracts';

import { env } from '@/env';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { todayInZone } from '@/lib/domain/dates';
import {
  KPI_WINDOW_LONG_DAYS,
  productKpis as defaultProductKpis,
  type ProductKpiOptions,
} from '@/lib/sales/insights';

import {
  DEFAULT_WINDOW_DAYS,
  anchorQuery,
  soldWindowQuery,
  windowQuery,
  type InsightsDeps,
} from '../_shared';

/* ═══════════════════════════ 1. Konštanty ═════════════════════════════════ */

/** Stránka tabuľky Produkty je podľa kontraktu V4 §2 sto riadkov. */
export const MAX_KPI_IDS = 100;

/* ═══════════════════════════════ 2. Typy ══════════════════════════════════ */

export interface ProductKpiResponse extends ProductKpiPage {
  /**
   * Aké okná si volajúci vypýtal. Je to tu preto, že `window30` sa tak volá aj
   * vtedy, keď má sedem dní — obrazovka si tak vie overiť, že nadpis, ktorý
   * kreslí, sedí s tým, o čo požiadala.
   */
  requested: { shortWindowDays: number; longWindowDays: number };
  /** ID, ktoré prišli v dotaze a v odpovedi nie sú (neplatné alebo duplikáty). */
  skippedIds: number[];
}

export interface ProductKpiDeps extends InsightsDeps {
  /** Výhradne pre testy: náhrada výpočtu KPI. */
  productKpis?: typeof defaultProductKpis;
  /** Náhradné repozitáre a spojenie, ktoré sa posielajú do `productKpis()`. */
  kpiSources?: Pick<ProductKpiOptions, 'catalog' | 'sales' | 'conn'>;
}

/* ═══════════════════════════ 3. Zod pre query ════════════════════════════ */

/**
 * `?ids=101,102,103` (aj viackrát). Strop je `MAX_KPI_IDS` — väčšia stránka je
 * rozhodnutie o obrazovke, nie parameter dotazu, a bez stropu by jedna
 * požiadavka vedela vyžiadať KPI pre celý katalóg.
 */
const idsQuery = z
  .union([z.string(), z.array(z.string())])
  .transform((value): string[] => {
    const parts = Array.isArray(value) ? value : [value];
    return parts
      .flatMap((part) => part.split(','))
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  })
  .refine((list) => list.length >= 1, 'Očakáva sa aspoň jedno ID produktu.')
  .refine((list) => list.length <= MAX_KPI_IDS, `Najviac ${MAX_KPI_IDS} ID naraz.`);

const querySchema = z.object({
  ids: idsQuery,
  anchor: anchorQuery,
  window: windowQuery,
  /**
   * `?long=180` — DLHÉ okno (D149). Bez neho zostáva 90 dní, takže existujúci
   * volajúci sa nezmení; s ním sa dá požiadať o 180 a 360, čo prepínač
   * predajnosti ponúka od začiatku, ale ENV strop `SALES_WINDOW_DAYS` (90)
   * nedovoľoval naplniť.
   */
  long: soldWindowQuery,
});

/* ═══════════════════════════════ 4. Route ═════════════════════════════════ */

export function createInsightsProductKpiGet(
  overrides: ProductKpiDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const kpis = overrides.productKpis ?? defaultProductKpis;
  const now = overrides.now ?? (() => new Date());

  return defineRoute(
    {
      method: 'GET',
      query: querySchema,
      handler: async (ctx): Promise<ProductKpiResponse> => {
        // LAZY čítanie ENV — eager na module scope láme `next build`.
        const timeZone = overrides.timeZone ?? env.LOGIC_TIMEZONE;
        const today: DateOnly = ctx.query.anchor ?? todayInZone(now(), timeZone);

        /* Sanitácia ID: nečíselné a duplikáty von, ale POVEDANÉ nahlas. */
        const seen = new Set<number>();
        const ids: number[] = [];
        const skippedIds: number[] = [];
        for (const raw of ctx.query.ids) {
          const parsed = Number(raw);
          if (!Number.isInteger(parsed) || parsed <= 0 || seen.has(parsed)) {
            if (Number.isInteger(parsed)) skippedIds.push(parsed);
            continue;
          }
          seen.add(parsed);
          ids.push(parsed);
        }

        const shortWindowDays = ctx.query.window ?? DEFAULT_WINDOW_DAYS;
        const longWindowDays = ctx.query.long ?? KPI_WINDOW_LONG_DAYS;
        const requested = { shortWindowDays, longWindowDays };

        /*
         * Prázdny zoznam po sanitácii sa DB nepýta vôbec a `productKpis()` vráti
         * okná ako nepokryté — „nevieme" sa nakresliť dá, vymyslené pokrytie nie.
         */
        const page = await kpis(ids, {
          today,
          shortWindowDays,
          longWindowDays,
          ...(overrides.kpiSources ?? {}),
        });

        return { ...page, requested, skippedIds };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsProductKpiGet();
