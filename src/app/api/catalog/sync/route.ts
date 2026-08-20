/**
 * Aura Zľavy — `POST /api/catalog/sync` (KONTRAKT V3: K7).
 *
 * Manuálne načítanie celého katalógu („Načítať katalóg" v Nastaveniach).
 * K7 žiada plnú synchronizáciu stránkovane **manuálne aj raz denne cronom**;
 * cron vlastní scheduler (V7, `runCatalogSyncIfDue`), túto polovicu route.
 *
 * Čo tu platí:
 *
 *  - **Je to ČÍTANIE.** Synchronizácia nemíňa zápisový rozpočet (K7) a nedotkne
 *    sa `setReduction` — klient sa sem podáva len cez `listProducts`, takže
 *    zápis sa do tejto cesty nedá podstrčiť ani omylom (I10, K11 bod 2).
 *  - **Súbežnosť je jediná vec, ktorú manuálny beh NEobchádza.** `runCatalogSyncNow()`
 *    obíde okno mimo špičky aj odstup 20 h — človek si oň povedal — ale dva
 *    behy naraz odmietne (`already_running`), lebo by z jedného katalógu
 *    urobili dva a zdvojili ~400 requestov.
 *  - **Trvá to minúty**, nie milisekundy: 40 483 produktov po 100 na stránku
 *    s pauzou medzi stránkami. UI to musí zniesť (a preto je `rateLimit`
 *    prísny — dva klikatia za sebou nič nezrýchlia).
 *
 * Vlastník: V8.
 */
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import {
  lastCatalogRun,
  runCatalogSyncNow,
  type CatalogRunnerDeps,
  type CatalogRunReport,
} from '@/lib/scheduler/catalog-runner';
import { createShopClientFromSettings } from '@/lib/shop/client';

export interface CatalogSyncRouteDeps {
  /** Prepis celého behu — testy nevolajú shop ani DB. */
  run?: (deps: CatalogRunnerDeps) => Promise<CatalogRunReport>;
  runnerDeps?: Partial<CatalogRunnerDeps>;
  routeDeps?: RouteDeps;
}

export function createCatalogSyncRoute(deps: CatalogSyncRouteDeps = {}): NextRouteHandler {
  const run = deps.run ?? ((d: CatalogRunnerDeps) => runCatalogSyncNow(d));

  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      // Jeden beh za minútu na IP. Katalóg sa nezosynchronizuje rýchlejšie tým,
      // že sa tlačidlo stlačí päťkrát.
      rateLimit: { limit: 2, windowMs: 60_000, bucket: 'catalog-sync' },
      handler: async () => {
        // ENV a doména shopu sa čítajú AŽ TU, vo funkcii — na module scope by
        // eager `env.*` zlomilo `next build` (route factory beží pri kompilácii).
        const runnerDeps: CatalogRunnerDeps = {
          shopClient:
            deps.runnerDeps?.shopClient ?? createShopClientFromSettings(defaultSettingsRepo),
          catalog: deps.runnerDeps?.catalog ?? defaultCatalogRepo,
          ...(deps.runnerDeps?.audit !== undefined ? { audit: deps.runnerDeps.audit } : {}),
          ...(deps.runnerDeps?.logger !== undefined ? { logger: deps.runnerDeps.logger } : {}),
        };

        const report = await run(runnerDeps);
        return {
          outcome: report.outcome,
          sync: report.sync,
          /** Posledný známy beh (aj keď tento skončil na `already_running`). */
          lastRun: lastCatalogRun(),
        };
      },
    },
    deps.routeDeps,
  );
}

export const POST = createCatalogSyncRoute();
