/**
 * Aura Zľavy — `GET /api/sales` (KONTRAKT-PREDAJNOST-2026-08-06, P1).
 *
 * ČISTO ČÍTACIA route: kusy predané na produkt allowlistu za obdobie, ktoré je
 * v DB skutočne pokryté, plus hlavička o pokrytí (od–do, počet dní, kedy sa
 * naposledy synchronizovalo, či je synchronizácia zapnutá).
 *
 * Odkiaľ dáta sú: výhradne vlastné tabuľky `product_sales_daily`
 * a `sales_sync_state`. Táto route NIKDY nevolá shop — sťahovanie má na
 * starosti jediný povolený modul (I8' bod 1) a beží nočne, mimo požiadavky
 * používateľa.
 *
 * Čo tu nie je a nebude: obrátkovosť (chýba COGS a zásoba nevariantných
 * produktov — I11), peniaze na produkt (zaplatená suma patrí objednávke, nie
 * položke — P4) a čokoľvek zákaznícke (I8' bod 3). Žiadny zápis, teda ani
 * cesta, ktorá by obišla dry-run potvrdenie (I3).
 */
import { z } from 'zod';

import type { SalesInsightsReport } from '@/contracts';

import { env } from '@/env';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { isDateOnly, todayInZone } from '@/lib/domain/dates';
import { insightsRepo as defaultInsightsRepo } from '@/lib/repo/insights.repo';
import {
  dailyUnits as defaultDailyUnits,
  salesMetrics,
  summarizeCoverage,
  syncDays as defaultSyncDays,
} from '@/lib/sales/insights';

/** Voliteľné kotvenie „dneška" — testy nemajú prepisovať systémový čas. */
const querySchema = z.object({
  anchor: z
    .string()
    .refine((v) => isDateOnly(v), 'Očakáva sa existujúci kalendárny deň v tvare RRRR-MM-DD.')
    .optional(),
});

export interface SalesRouteDeps {
  salesInsights?: {
    syncDays: typeof defaultSyncDays;
    dailyUnits: typeof defaultDailyUnits;
  };
  insightsRepo?: Pick<typeof defaultInsightsRepo, 'discountDepth'>;
  now?: () => Date;
  timeZone?: string;
  syncEnabled?: boolean;
  windowDays?: number;
}

export function createSalesGet(
  overrides: SalesRouteDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const sales = overrides.salesInsights ?? {
    syncDays: defaultSyncDays,
    dailyUnits: defaultDailyUnits,
  };
  const insights = overrides.insightsRepo ?? defaultInsightsRepo;
  const now = overrides.now ?? (() => new Date());

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      query: querySchema,
      handler: async (ctx): Promise<SalesInsightsReport> => {
        // LAZY env — rovnaký dôvod ako `api/insights/_shared.ts`: eager čítanie
        // by spustilo validáciu ENV už počas `next build`.
        const timeZone = overrides.timeZone ?? env.LOGIC_TIMEZONE;
        const syncEnabled = overrides.syncEnabled ?? env.SALES_SYNC_ENABLED;
        const windowDays = overrides.windowDays ?? env.SALES_WINDOW_DAYS;
        const today = ctx.query.anchor ?? todayInZone(now(), timeZone);

        /* 1. Pokrytie — za aké obdobie dáta NAOZAJ sú (P3). */
        const coverage = summarizeCoverage(await sales.syncDays(), { syncEnabled, windowDays });

        /* 2. Produkty allowlistu; `not_found` sa vynechá — v shope neexistuje,
              takže nulová predajnosť by o ňom nič nepovedala. */
        const products = (await insights.discountDepth())
          .filter((row) => row.shopStatus !== 'not_found')
          .map((row) => ({ productId: row.productId, name: row.name, label: row.label }));

        /* 3. Denné súčty len za pokryté obdobie; bez pokrytia sa dotaz ani
              nespustí a metriky vyjdú nulové s `hasData: false` — volajúci
              MUSÍ v tom prípade zobraziť „bez dát", nie nuly (I11). */
        const days =
          coverage.hasData && coverage.from != null && coverage.to != null
            ? await sales.dailyUnits(
                products.map((p) => p.productId),
                coverage.from,
                coverage.to,
              )
            : [];

        return {
          today,
          coverage,
          products: salesMetrics({ products, days, coverage, today }),
        };
      },
    },
    routeDeps,
  );
}

export const GET = createSalesGet();
