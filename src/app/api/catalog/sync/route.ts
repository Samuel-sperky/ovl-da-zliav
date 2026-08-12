/**
 * Aura Zľavy — `GET`/`POST /api/catalog/sync` (KONTRAKT V3: K7;
 * KONTRAKT-DOKONCENIE-2026-08-12: A2–A5).
 *
 * Dve polovice tej istej veci:
 *
 *  - **GET** — STAV katalógu na čítanie: koľko z koľkých je načítaných, kedy sa
 *    naposledy čítalo, kedy pôjde ďalšia dávka, prečo sa čaká a dokedy to
 *    potrvá (A5). Nič nespúšťa a na shop neodošle ani jeden request, takže sa
 *    dá volať aj z hlavičky každých pár sekúnd.
 *  - **POST** — manuálne načítanie („Načítať katalóg" v Nastaveniach). K7 žiada
 *    plnú synchronizáciu **manuálne aj raz denne cronom**; cron vlastní
 *    scheduler (V7, `runCatalogSyncIfDue`), túto polovicu route.
 *
 * Čo tu platí:
 *
 *  - **Je to ČÍTANIE.** Synchronizácia nemíňa zápisový rozpočet (K7) a nedotkne
 *    sa `setReduction` — klient sa sem podáva len cez `listProducts`, takže
 *    zápis sa do tejto cesty nedá podstrčiť ani omylom (I10, K11 bod 2).
 *  - **Jeden POST nie je celý katalóg.** 41 082 produktov po 100 na stránku je
 *    411 čítaní a anonymný denný strop je 300 — celý katalóg je dvojdňový beh.
 *    Jeden POST prečíta dávku, uloží pokrok a povie, kde skončil; zvyšok
 *    dočítava scheduler sám. Odpoveď preto vždy nesie aj `catalog` (stav),
 *    nielen `sync` (čo urobil tento beh).
 *  - **Súbežnosť POST NEobchádza.** `runCatalogSyncNow()` obíde okno mimo špičky
 *    aj odstup 20 h, ale dva behy naraz odmietne (`already_running`), lebo by si
 *    prepisovali pokrok. Denný rozpočet ani pauzu po 429 neobíde tiež — strop
 *    shopu neprehovorí ani kliknutie.
 *
 *    Drží to DB advisory lock (`CATALOG_SYNC_LOCK_NAME`), nie in-process
 *    premenná: `running` v runneri žije v module grafe TEJTO route, kdežto tick
 *    schedulera má vlastný (`instrumentation`) — takže sama by odmietla len
 *    druhé kliknutie, nie beh, ktorý práve robí scheduler. Nález review z 12. 8.
 *  - **`lastRun` je IN-PROCESS a best-effort** z toho istého dôvodu: je to
 *    posledný beh, ktorý videl module graf tejto route. Keď naposledy
 *    synchronizoval scheduler, býva `null`, hoci katalóg sa hýbal. Dôkazom
 *    pokroku je `catalog` (číta sa z `catalog_sync_state`), nie `lastRun`.
 *  - **`restart: true`** znamená „zabudni pokrok a načítaj odznova od stránky 1".
 *    Bez neho POST POKRAČUJE tam, kde beh skončil (A2).
 *
 * Vlastník: V8.
 */
import { z } from 'zod';

import { tryAcquireLock } from '@/db/advisory-lock';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  catalogRepo as defaultCatalogRepo,
  type CatalogRepoExt,
  type CatalogSyncStatus,
} from '@/lib/repo/catalog.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import {
  lastCatalogRun,
  runCatalogSyncNow,
  CATALOG_READ_RETRY_POLICY,
  CATALOG_SYNC_LOCK_NAME,
  type CatalogRunnerDeps,
  type CatalogRunReport,
} from '@/lib/scheduler/catalog-runner';
import { createShopClientFromSettings } from '@/lib/shop/client';

/* ═══════════════════════════ 1. Tvar odpovede ═════════════════════════════ */

/**
 * Stav katalógu tak, ako ho číta UI a agregátor stavu. Dátumy idú ako ISO
 * reťazce (JSON nemá dátum) a čísla ostávajú číslami — vety o katalógu skladá
 * `@/lib/status/blockers`, nie táto route.
 */
export interface CatalogStatusView {
  loadedProducts: number;
  shopTotalProducts: number | null;
  percent: number | null;
  complete: boolean;
  /** `true` = katalóg je celý, ale beží nad ním nový (obnovovací) prechod. */
  refreshing: boolean;
  lastFetchedAt: string | null;
  lastReadAt: string | null;
  /** Pokrok AKTUÁLNEHO prechodu — nie „koľko z katalógu appka má". */
  pagesDone: number;
  pagesTotal: number | null;
  /** Koľko stránok appke CHÝBA. Pri obnove `0` — nechýba nič. */
  pagesLeft: number | null;
  perPage: number;
  /** Zdieľaný denný rozpočet ANONYMNÝCH čítaní (A4) — nie zápisový (K2). */
  reads: {
    day: string;
    limit: number;
    used: number;
    remaining: number;
    exhausted: boolean;
    resetAt: string;
    minuteLimit: number;
    usedThisMinute: number;
    /** `false` = počítadlo sa nedalo prečítať, čísla sú fail-closed domnienka. */
    known: boolean;
  };
  /** Prečo sa nečíta: `rate_limited` | `daily_budget` | `error` | `catalog_complete`. */
  waiting: CatalogSyncStatus['waiting'];
  nextBatchAt: string | null;
  estimatedDaysLeft: number | null;
  estimatedFinishAt: string | null;
  /** KÓD poslednej chyby behu (I1) — nikdy obsah odpovede shopu. */
  lastError: string | null;
}

/** `CatalogSyncStatus` (dátumy) → JSON pohľad (ISO reťazce). */
export function toCatalogStatusView(status: CatalogSyncStatus): CatalogStatusView {
  const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());
  return {
    loadedProducts: status.loadedProducts,
    shopTotalProducts: status.shopTotalProducts,
    percent: status.percent,
    complete: status.complete,
    refreshing: status.refreshing,
    lastFetchedAt: iso(status.lastFetchedAt),
    lastReadAt: iso(status.lastReadAt),
    pagesDone: status.pagesDone,
    pagesTotal: status.pagesTotal,
    pagesLeft: status.pagesLeft,
    perPage: status.perPage,
    reads: {
      day: status.reads.day,
      limit: status.reads.limit,
      used: status.reads.used,
      remaining: status.reads.remaining,
      exhausted: status.reads.exhausted,
      resetAt: status.reads.resetAt.toISOString(),
      minuteLimit: status.reads.minuteLimit,
      usedThisMinute: status.reads.usedThisMinute,
      known: status.reads.known,
    },
    waiting: status.waiting,
    nextBatchAt: iso(status.nextBatchAt),
    estimatedDaysLeft: status.estimatedDaysLeft,
    estimatedFinishAt: iso(status.estimatedFinishAt),
    lastError: status.lastError,
  };
}

/* ═══════════════════════════ 2. Závislosti ════════════════════════════════ */

export interface CatalogSyncRouteDeps {
  /** Prepis celého behu — testy nevolajú shop ani DB. */
  run?: (deps: CatalogRunnerDeps, opts: { restart: boolean }) => Promise<CatalogRunReport>;
  runnerDeps?: Partial<CatalogRunnerDeps>;
  /** Zdroj stavu pre GET (a pre `catalog` v odpovedi POST-u). */
  status?: Pick<CatalogRepoExt, 'syncStatus'>;
  routeDeps?: RouteDeps;
}

const bodySchema = z
  .object({
    /** `true` = zahodiť pokrok a načítať odznova od stránky 1 (A2). */
    restart: z.boolean().optional(),
  })
  .optional();

/* ═══════════════════════════ 3. GET — stav ════════════════════════════════ */

/**
 * A5 — stav katalógu bez toho, aby sa čokoľvek spustilo. Toto je pole, ktoré
 * číta agregátor stavu (`catalog`); `lastRun` je navyše, aby sa v Nastaveniach
 * dalo ukázať, čo urobil posledný beh.
 */
export function createCatalogSyncStatusRoute(deps: CatalogSyncRouteDeps = {}): NextRouteHandler {
  return defineRoute(
    {
      method: 'GET',
      auth: 'session',
      handler: async () => {
        const source = deps.status ?? defaultCatalogRepo;
        return {
          catalog: toCatalogStatusView(await source.syncStatus()),
          lastRun: lastCatalogRun(),
        };
      },
    },
    deps.routeDeps,
  );
}

/* ═══════════════════════════ 4. POST — dávka ══════════════════════════════ */

export function createCatalogSyncRoute(deps: CatalogSyncRouteDeps = {}): NextRouteHandler {
  const run =
    deps.run ??
    ((d: CatalogRunnerDeps, opts: { restart: boolean }) =>
      runCatalogSyncNow(d, opts.restart ? { restart: true } : {}));

  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      body: bodySchema,
      // Jeden beh za minútu na IP. Katalóg sa nezosynchronizuje rýchlejšie tým,
      // že sa tlačidlo stlačí päťkrát.
      rateLimit: { limit: 2, windowMs: 60_000, bucket: 'catalog-sync' },
      handler: async (ctx) => {
        // ENV a doména shopu sa čítajú AŽ TU, vo funkcii — na module scope by
        // eager `env.*` zlomilo `next build` (route factory beží pri kompilácii).
        const runnerDeps: CatalogRunnerDeps = {
          shopClient:
            deps.runnerDeps?.shopClient ??
            // A3 — 429 nesmie klient opakovať; pauzu drží celý beh (viď politiku).
            createShopClientFromSettings(defaultSettingsRepo, {
              policy: { ...CATALOG_READ_RETRY_POLICY },
            }),
          catalog: deps.runnerDeps?.catalog ?? defaultCatalogRepo,
          // Súbežnosť cez DVA module grafy: `running` v runneri je premenná
          // TOHTO grafu, tick schedulera beží vo svojom (`instrumentation`).
          // Sľub „dva behy naraz odmietne" drží až DB lock.
          lock: deps.runnerDeps?.lock ?? (() => tryAcquireLock(CATALOG_SYNC_LOCK_NAME, 0)),
          ...(deps.runnerDeps?.audit !== undefined ? { audit: deps.runnerDeps.audit } : {}),
          ...(deps.runnerDeps?.logger !== undefined ? { logger: deps.runnerDeps.logger } : {}),
        };

        const report = await run(runnerDeps, { restart: ctx.body?.restart === true });
        const source = deps.status ?? defaultCatalogRepo;

        return {
          outcome: report.outcome,
          sync: report.sync,
          /** Kedy sa oplatí skúsiť znova (pauza, polnoc UTC). */
          resumeAt: report.resumeAt === undefined || report.resumeAt === null
            ? null
            : report.resumeAt.toISOString(),
          /** A5 — stav PO behu, aby UI nemuselo hneď volať GET. */
          catalog: toCatalogStatusView(await source.syncStatus()),
          /** Posledný známy beh (aj keď tento skončil na `already_running`). */
          lastRun: lastCatalogRun(),
        };
      },
    },
    deps.routeDeps,
  );
}

export const GET = createCatalogSyncStatusRoute();
export const POST = createCatalogSyncRoute();
