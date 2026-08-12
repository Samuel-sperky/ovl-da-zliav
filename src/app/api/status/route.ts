/**
 * Aura Zľavy — `GET /api/status`: JEDNO miesto, odkiaľ si UI vypýta celý obraz.
 *
 * Doteraz si každá obrazovka skladala stav zo štyroch–piatich endpointov
 * (`/api/health`, `/api/queue`, `/api/settings`, `/api/key`, `/api/catalog/*`)
 * a ani jedna nevedela povedať, PREČO sa niečo nestalo. Tento endpoint vracia
 * fakty aj hotový zoznam prekážok z `lib/status/blockers.ts` — obrazovka už len
 * kreslí.
 *
 * Čo tu vlastne beží:
 *   1. `buildStatusSnapshot()` (V lib/status/snapshot.ts) prečíta fakty zo
 *      zapojených repozitárov; každé zlyhané čítanie skončí ako vynechaná
 *      sekcia, nie ako 500.
 *   2. `collectOperationBlockers()` z toho urobí zoznam prekážok.
 *   3. `toStatusPayload()` to preloží do JSON tvaru.
 * Rozhodovanie ani texty tu nie sú — sú v tých dvoch moduloch.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *  1. **Endpoint musí zostať LACNÝ.** Volá sa z každej obrazovky a pri každom
 *     obnovení. Rozpočet dotazov na jednu požiadavku je dnes tento:
 *       - `settings` (id = 1) — dvakrát: `readScope()` a `get()`,
 *       - `api_key` (jeden riadok podľa `kind`),
 *       - `audit_log` — `COUNT(*)` za UTC deň po indexe
 *         `ix_audit_event_ts (event_type, ts)`,
 *       - `catalogRepo.syncStatus()` — `COUNT(*)` a `MAX(fetched_at)` nad
 *         `catalog_cache`, jednoriadkový `catalog_sync_state`
 *         a jednoriadkový `shop_read_budget`.
 *     `syncStatus()` sa volá RAZ na požiadavku (memo v `productionStatusSources`),
 *     hoci ho čítajú dve sekcie stavu. Žiadne volanie shopu, žiadna agregácia
 *     bez indexu — a nič z toho sa tu nesmie pridať.
 *  2. **I1 — kľúč len ako `{present, expiresAt}`.** Telo odpovede prechádza
 *     `redact()` a meno `apiKey` je v jeho denylistu; prejde jedine vtedy, keď
 *     má objekt PRESNE tie dve polia (`SAFE_DENIED_SHAPES` v `lib/log/redact.ts`).
 *     Presne na tomto sa už raz `/api/health` popálil: redaktor zamaskoval celý
 *     objekt kľúča a UI potom natrvalo tvrdilo, že kľúč chýba. Tretie pole tu
 *     tú chybu zopakuje — odvodené hodnoty patria do vety prekážky.
 *  3. **Fail-closed sa nedopĺňa.** Keď sa niečo nedá prečítať, sekcia vypadne
 *     a jej meno je v `unreadable`. Dopísať sem „keď nevieme, pošli nulu" by
 *     znamenalo, že appka klame práve vtedy, keď má DB problém.
 *  4. **Žiadny `rateLimit`.** Je to čítanie, ktoré UI robí často; okenný limit
 *     by zhasol hlavičku appky presne vtedy, keď je najviac potrebná.
 *
 * `auth: 'session'` — na rozdiel od `/api/health` (ten je `none` kvôli docker
 * healthchecku) tu sú počty produktov, režim rozsahu a stav rozpočtu, teda
 * prevádzkové údaje appky. Sudo netreba: nič sa nemení.
 *
 * Vlastník: S2.
 */
import { writesAllowedByEnv } from '@/env';
import { createBudget } from '@/lib/engine/budget';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import {
  readStatusPayload,
  type StatusPayload,
  type StatusSources,
} from '@/lib/status/snapshot';

import type { CatalogSyncStatus } from '@/lib/repo/catalog.repo';

export interface StatusRouteDeps {
  /** Zdroje faktov. Keď chýbajú, zapoja sa produkčné repozitáre (nižšie). */
  sources?: StatusSources;
  now?: () => Date;
  routeDeps?: RouteDeps;
}

/**
 * Zapojenie SKUTOČNÝCH zdrojov.
 *
 * Predvolené hodnoty zámerne ukazujú na produkčné singletony: v tomto repe už
 * raz integračný test s fake závislosťou zamaskoval, že produkčné zapojenie
 * vôbec nefunguje. `deps` sú tu pre testy, nie pre prevádzku.
 *
 * POZOR: funkcia sa volá pre KAŽDÚ požiadavku (viď `createStatusRoute`), lebo
 * si drží memo na jedno čítanie katalógu. Keby sa zavolala raz pri štarte,
 * endpoint by donekonečna vracal stav z prvého requestu.
 */
export function productionStatusSources(now: () => Date = () => new Date()): StatusSources {
  /**
   * `syncStatus()` vracia naraz počty katalógu aj stav čítacieho rozpočtu.
   * Memo je preto per požiadavka: dve sekcie stavu = jedno čítanie, nie dve.
   */
  let catalogOnce: Promise<CatalogSyncStatus> | null = null;
  const catalogStatus = (): Promise<CatalogSyncStatus> => {
    catalogOnce ??= defaultCatalogRepo.syncStatus({ now: now() });
    return catalogOnce;
  };

  return {
    // Celá poistka I13 (`NODE_ENV=production && WRITES_ENABLED=true`), nie
    // samotná premenná — inak by sa polovica poistky dala prehliadnuť.
    writesEnabled: () => writesAllowedByEnv(),

    settings: {
      readScope: () => defaultSettingsRepo.readScope(),
      /** Runaway zámok (D79/I12). `get()` hádže — `buildStatusSnapshot` to čaká. */
      readWriteLock: async () => {
        const record = await defaultSettingsRepo.get();
        return {
          writesLocked: record.writesLocked,
          writesLockedReason: record.writesLockedReason,
          writesLockedAt: record.writesLockedAt,
        };
      },
    },

    // I1 — z celého `ApiKeyMeta` sa berie len `present` a `expiresAt`;
    // `last4`, `verifyStatus` ani `lastUsedAt` sem nepatria.
    apiKey: {
      getMeta: async () => {
        const meta = await defaultApiKeyRepo.getMeta();
        return { present: meta.present, expiresAt: meta.expiresAt };
      },
    },

    writeBudget: {
      // Strop prichádza z už prečítaných nastavení, takže `createBudget` po ne
      // nechodí druhýkrát; spotreba sa aj tak počíta z auditu (K2).
      remainingToday: (dailyBudget) => createBudget({ dailyBudget, now }).remainingToday(),
    },

    catalog: {
      /**
       * `shopTotalProducts` prichádza z `catalog_sync_state` (A2), nie z pamäte
       * procesu — číslo teda prežije reštart. Keď ho shop ešte nepovedal, je
       * `null` a `blockers.ts` o neúplnosti katalógu mlčí; odhad si appka
       * nedopočítava (I11).
       */
      read: async () => {
        const status = await catalogStatus();
        return {
          loadedProducts: status.loadedProducts,
          shopTotalProducts: status.shopTotalProducts,
          lastFetchedAt: status.lastFetchedAt,
        };
      },
    },

    /**
     * Spotreba ANONYMNÝCH čítaní (A4). Sekcia je opt-in — čítania idú bez kľúča
     * na inú kvótu než zápisy, takže vyčerpané čítania zápisu NEBRÁNIA
     * (dokumentovaná výnimka z fail-closed v `blockers.ts`).
     */
    catalogReads: async () => {
      const reads = (await catalogStatus()).reads;
      return {
        usedThisMinute: reads.usedThisMinute,
        // `known: false` znamená, že počítadlo sa nedalo prečítať a `used` je
        // fail-closed domnienka. Domnienku neposielame ako fakt — pošleme
        // `null` a `blockers.ts` si prísnejší záver spraví sám.
        usedThisUtcDay: reads.known ? reads.used : null,
      };
    },

    now,
  };
}

export function createStatusRoute(deps: StatusRouteDeps = {}): NextRouteHandler {
  const now = deps.now ?? ((): Date => new Date());
  const injected = deps.sources;
  // Zdroje sa stavajú NA KAŽDÚ požiadavku — držia si memo na jedno čítanie
  // katalógu a to nesmie prežiť do ďalšieho requestu.
  const sourcesFor = (): StatusSources => injected ?? productionStatusSources(now);

  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async (ctx): Promise<StatusPayload> => {
        const payload = await readStatusPayload(sourcesFor());
        ctx.log.debug('status_read', {
          blocked: payload.summary.blocked,
          blockers: payload.blockers.length,
          unreadable: payload.unreadable.length,
        });
        return payload;
      },
    },
    deps.routeDeps,
  );
}

export const GET = createStatusRoute();
