/**
 * Aura Zľavy — `GET /api/insights/catalog-prices` (V1).
 *
 * ROZDELENIE CIEN V MIESTNEJ KÓPII KATALÓGU plus ceny povolených produktov ako
 * referenčné značky. Odpovedá na otázku, ktorú si človek kladie PRED zľavou:
 * „leží môj výber v tučnej časti cenníka, alebo v chvoste?"
 *
 * Je to jediný dataset tejto appky, ktorý je na rozdelenie dosť veľký — všetko
 * ostatné (jedna zľava, dvadsať položiek, desať povolených produktov) je
 * tabuľka, nie histogram.
 *
 * ČO ODPOVEĎ PRIZNÁVA a volajúci MUSÍ zobraziť:
 *   · `withoutPrice` — riadky bez ceny do pásiem nevstupujú,
 *   · `oldestFetchedAt` / `newestFetchedAt` — ceny sú KÓPIA, nie dnešný cenník,
 *   · `maxPrice` — kam siaha chvost za zberným pásmom,
 *   · `rows` — koľko produktov kópia vôbec pozná (nie koľko ich má eshop).
 *
 * ČISTO ČÍTACIE. Žiadne volanie shopu — obnovu kópie katalógu má na starosti
 * `/api/catalog/*`, nie graf. Žiadny zápis, teda ani cesta, ktorá by obišla
 * potvrdenie. Žiadne objednávky ani zákaznícke dáta.
 *
 * Vlastník: V1.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { insightsRepo as defaultInsightsRepo } from '@/lib/repo/insights.repo';

import { catalogPrices as defaultCatalogPrices } from '../_prices';
import { resolveInsightsDeps, todayOf, type InsightsDeps } from '../_shared';

export interface CatalogPricesDeps extends InsightsDeps {
  catalogPrices?: typeof defaultCatalogPrices;
  insightsRepo?: typeof defaultInsightsRepo;
}

export function createInsightsCatalogPricesGet(
  overrides: CatalogPricesDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const d = resolveInsightsDeps(overrides);
  const prices = overrides.catalogPrices ?? defaultCatalogPrices;

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async () => {
        const distribution = await prices();

        /*
         * Referenčné značky = ceny povolených produktov. Produkt bez ceny
         * v kópii značku NEDOSTANE — nula na osi cien by tvrdila, že je
         * zadarmo.
         */
        const selection = (await d.insightsRepo.discountDepth())
          .map((row) => ({
            productId: row.productId,
            price: row.price === null ? null : Number(row.price),
          }))
          .filter(
            (row): row is { productId: number; price: number } =>
              row.price !== null && Number.isFinite(row.price),
          );

        return { today: todayOf(d), ...distribution, selection };
      },
    },
    routeDeps,
  );
}

export const GET = createInsightsCatalogPricesGet();
