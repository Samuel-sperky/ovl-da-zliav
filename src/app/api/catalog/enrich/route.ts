/**
 * Aura Zľavy — `GET`/`POST /api/catalog/enrich`
 * (KONTRAKT-V4-2026-08-28 §2b: D118 body 1 a 2, D119, D120; I1, I11).
 *
 * Dve polovice tej istej veci, rovnako ako pri `/api/catalog/sync`:
 *
 *  - **GET** — KDE STOJÍ DÁVKA obohacovania a PREČO: pokrok, dnešný diel
 *    a hlavne dôvod pauzy (`catalog_enrich_state`, migrácia 0014). Nič
 *    nespúšťa, na shop neodošle ani jeden request (K8).
 *  - **POST** — obohatenie JEDNÉHO produktu na dopyt (nižšie).
 *
 * PREČO GET PRIBUDOL AŽ 31. 8. 2026
 * ---------------------------------
 * Dávka si od migrácie 0014 zapisovala pauzu aj jej dôvod a nečítal to NIKTO:
 * `grep -rn loadEnrichState src/` vracal výhradne engine
 * (`lib/engine/catalog-enrich.ts`) a repozitár. Dávka teda mohla stáť tri
 * týždne s `pause_reason = 'ip_banned'` a človek to zistil jedine `SELECT`-om
 * do databázy — presne to, čo I11 zakazuje: appka VIE, že stojí, a nepovie to.
 *
 * PREČO PRÁVE TU A NIE V `/api/status`
 * ------------------------------------
 * `/api/status` má v hlavičke vypísaný rozpočet dotazov na požiadavku a vetu
 * „nič z toho sa tu nesmie pridať" — volá ho každá obrazovka pri každom
 * obnovení. Stav dávky je naopak vec dvoch miest (stavový pás Prehľadu a sekcia
 * Nastavení), takže patrí k tej ceste, ktorá už obohacovanie vlastní. Do
 * `/api/catalog/sync` nepatrí tiež: to je ZOZNAMOVÝ prechod nad
 * `catalog_sync_state` a nad anonymnou dráhou rozpočtu, kdežto dávka žije
 * v inej tabuľke a míňa dráhu `product_read`. Dve rôzne veci, dva stavy.
 *
 * ROZPOČET DOTAZOV GETU: TRI, VŠETKY PO INDEXE
 *   - `catalog_enrich_state` (`id = 1`, jeden riadok),
 *   - `COUNT(*)` nad `catalog_cache` (`totalRows()`),
 *   - `catalog_sync_state` (`id = 1`, jeden riadok — kvôli `shopTotal`).
 * `syncStatus()` sa tu ZÁMERNE nevolá, hoci by dve z týchto čísel dal naraz:
 * ťahá k nim aj celý stav čítacieho rozpočtu, teda ďalšie dotazy, ktoré táto
 * odpoveď nepotrebuje.
 *
 * Obohatenie JEDNÉHO produktu NA DOPYT: používateľ otvoril detail, appka
 * dotiahne `GET /api/products/getFull` a uloží ho do `catalog_cache` (stĺpce
 * z migrácie 0014). Odpoveď nesie celý obohatený riadok, aby panel nemusel
 * hneď volať druhú cestu.
 *
 * PREČO JE TO IDEMPOTENTNÉ A LACNÉ
 * --------------------------------
 * Kvóta kľúča je ~200 volaní na UTC deň a `getFull` je volanie NA PRODUKT.
 * Keby každé otvorenie panela znamenalo request, preklikanie päťdesiatich
 * riadkov by minulo štvrtinu dennej kvóty a nočná dávka by nestihla nič. Route
 * preto NIČ NEVOLÁ, keď je riadok dosť svieži — hranicu (a jej odôvodnenie)
 * drží `ENRICH_FRESH_MS` v `@/lib/engine/catalog-enrich`. Výsledok `fresh` NIE
 * JE chyba: znamená „v DB máš platné čísla a nezaplatil si za ne".
 *
 * PREČO `POST`, KEĎ JE TO ČÍTANIE ZO SHOPU
 * ----------------------------------------
 * Lokálne to čítanie NIE JE — mení riadok v `catalog_cache`. Metóda `POST` má
 * preto Origin check (D72) a lokálneho actora (I14) od `defineRoute`, rovnako
 * ako každá iná mutácia. Naopak `GET /api/catalog/reduction-check` je čítanie,
 * ktoré neukladá nič — sú to dve rôzne cesty s dvoma rôznymi cenami a nezlievajú
 * sa.
 *
 * ČO TÁTO ROUTE NIE JE
 * --------------------
 *  1. **Nie je to zápis do shopu.** Nesie sa výhradne `getProductFull`; I3
 *     (dry-run + potvrdenie) ani I13 (`WRITES_ENABLED`) sa jej netýkajú, lebo
 *     v eshope nemení nič a nemá čím. `confirmed: true` sa tu preto NEVYŽADUJE
 *     a jeho pridanie by bránu I3 len rozmazalo na cesty, ktoré ju nepotrebujú
 *     (D106 menuje štyri uvoľňujúce mutácie a táto medzi nimi nie je).
 *  2. **Nie je to hromadné obohatenie.** Telo prijme JEDEN `productId` a pole
 *     neprijme vôbec. Katalóg má 41 348 produktov; plošný prechod je ~207 dní
 *     (`enrichDaysNeeded()` to povie číslom). Dávku na pozadí vlastní
 *     `runEnrichBatch()`, nie táto cesta.
 *  3. **Nie je to obchádzka rezervy kvóty.** Dávka do posledných ~50 čítaní dňa
 *     nesmie — táto route smie, pretože ona je ten, pre koho sa rezerva drží
 *     (spolu s canary a sondou kľúča).
 *
 * Vlastník: V4 (obohacovanie).
 */
import { z } from 'zod';

import type { CatalogEnrichmentRecord } from '@/contracts';

/*
 * `readBudgetView` sa ZÁMERNE dováža z `/api/catalog/search` a neopisuje sa:
 * všetky tri cesty hlásia ten istý rozpočet a druhý tvar toho istého čísla by
 * sa po prvej zmene rozišiel. Import je len mapovacia funkcia; handler druhej
 * cesty sa tým nespúšťa.
 */
import { readBudgetView, type ReadBudgetView } from '@/app/api/catalog/search/route';
import type {
  EnrichBatchStateWire,
  EnrichCoverageWire,
  EnrichPauseCode,
  EnrichStatePayload,
} from '@/lib/catalog/enrich-view';
import type { ShopCapability } from '@/lib/catalog/product-codes';
import { todayInZone } from '@/lib/domain/dates';
import {
  ENRICH_FRESH_MS,
  enrichDaysNeeded,
  enrichProductOnDemand,
  type EnrichCatalogRepo,
  type EnrichOneOutcome,
} from '@/lib/engine/catalog-enrich';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { apiKeyRepo as defaultApiKeyRepo, type ApiKeyRepository } from '@/lib/repo/api-key.repo';
import {
  catalogRepo as defaultCatalogRepo,
  type CatalogEnrichState,
  type CatalogRepoExt,
} from '@/lib/repo/catalog.repo';
import { productReadBudget } from '@/lib/repo/read-budget.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings, type ShopClientV5 } from '@/lib/shop/client';
import { READ_BUDGET_TIME_ZONE, type ReadBudget } from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Zod pre telo ═════════════════════════════ */

/**
 * JEDEN produkt, nikdy pole.
 *
 * `z.number().int().positive()` a nič viac: zoznam by z tejto cesty urobil
 * hromadné čítanie, ktoré si `getFull` pri 41 348 produktoch nemôže dovoliť
 * (bod 2 doc-bloku). Kto potrebuje viac riadkov, dostane ich z dávky.
 */
const enrichBodySchema = z.object({
  productId: z.number().int().positive(),
});

/* ═══════════════════════════ 2. Závislosti ════════════════════════════════ */

export interface EnrichRouteDeps {
  /** VÝHRADNE `getFull` — zápis zľavy sa sem nedá podstrčiť. */
  shop?: Pick<ShopClientV5, 'getProductFull'>;
  apiKey?: Pick<ApiKeyRepository, 'loadForUse' | 'recallScopes'>;
  catalog?: EnrichCatalogRepo;
  /**
   * Zdieľané počítadlo čítaní zo shopu (A4) — dráha `product_read`.
   *
   * `getFull` je čítanie S KĽÚČOM a shop ho účtuje NA KĽÚČ, takže od
   * 31. 8. 2026 má vlastnú dráhu (`productReadBudget`, ~160/UTC deň po
   * rezerve). Dovtedy sa účtovalo do `anon`, teda do stropu NA IP, z ktorého
   * žije dvojdňová synchronizácia katalógu — obohacovanie si tak bralo cudzí
   * strop a zároveň sa škrtilo na cudzom čísle. Rovnakú zmenu dostalo
   * `/api/catalog/reduction-check`.
   */
  reads?: Pick<ReadBudget, 'reserve' | 'status'>;
  /** Sviežosť v ms. Slúži testom; podlahu drží samotný engine. */
  freshMs?: number;
  now?: () => Date;
  routeDeps?: RouteDeps;
}

/* ═══════════════════════════ 3. Tvar odpovede ═════════════════════════════ */

/**
 * Obohatenie pre obrazovku. KAŽDÉ pole smie byť `null` a `null` znamená
 * VÝHRADNE „nevieme" — obrazovka ho kreslí ako pomlčku, nikdy ako nulu (I11).
 *
 * `enrichedAt === null` znamená, že sa produkt nikdy neobohatil, takže sú `null`
 * všetky polia. Pri vyplnenom `enrichedAt` je `null` odpoveď SHOPU („o tomto
 * poli nič nevie"). Sú to dve rôzne vety a UI ich má rozlíšiť.
 */
export interface EnrichmentView {
  productId: number;
  reference: string | null;
  ean13: string | null;
  purchasePrice: number | null;
  margin: number | null;
  marginPercent: number | null;
  sellPriceWithVat: number | null;
  /** ISO string, alebo `null` = shop o žiadnej objednávke nevie. */
  lastTimeInOrder: string | null;
  qty: number | null;
  qtyInOrders: number | null;
  supplier: string | null;
  /** Stav zľavy PODĽA SHOPU v čase `enrichedAt`, nie posledný vlastný zápis. */
  reductionPercent: number | null;
  reductionFrom: string | null;
  reductionTo: string | null;
  active: boolean | null;
  categories: number[] | null;
  enrichedAt: string | null;
  enrichAttemptedAt: string | null;
  enrichPriority: number;
}

export interface EnrichResponse {
  outcome: EnrichOneOutcome;
  productId: number;
  /**
   * `true` = `getFull` sa NEVOLAL, lebo riadok bol dosť svieži. Nie je to chyba
   * a UI to nemá hlásiť ako problém — je to úspora kvóty.
   */
  fresh: boolean;
  /** Stav oprávnenia `product:read`. `note` patrí VÝHRADNE do `LockedFeatures`. */
  capability: ShopCapability;
  /** Riadok po obohatení. `null` = nedal sa prečítať. */
  enrichment: EnrichmentView | null;
  /** Ako dlho sa riadok považuje za svieži (ms) — aby UI vedelo, čo `fresh` znamená. */
  freshMs: number;
  readsUsed: number;
  reads: ReadBudgetView | null;
  /** Kedy sa smie skúsiť znova. `null` = hneď / nevieme. */
  resumeAt: string | null;
  at: string;
  /** KÓD chyby (I1), nikdy telo odpovede shopu. */
  error: string | null;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function enrichmentView(record: CatalogEnrichmentRecord): EnrichmentView {
  return {
    productId: record.productId,
    reference: record.reference,
    ean13: record.ean13,
    purchasePrice: record.purchasePrice,
    margin: record.margin,
    marginPercent: record.marginPercent,
    sellPriceWithVat: record.sellPriceWithVat,
    lastTimeInOrder: iso(record.lastTimeInOrder),
    qty: record.qty,
    qtyInOrders: record.qtyInOrders,
    supplier: record.supplier,
    reductionPercent: record.reductionPercent,
    reductionFrom: iso(record.reductionFrom),
    reductionTo: iso(record.reductionTo),
    active: record.active,
    categories: record.categories === null ? null : [...record.categories],
    enrichedAt: iso(record.enrichedAt),
    enrichAttemptedAt: iso(record.enrichAttemptedAt),
    enrichPriority: record.enrichPriority,
  };
}

/* ═══════════════════════════ 4. Route ═════════════════════════════════════ */

export function createCatalogEnrichRoute(deps: EnrichRouteDeps = {}): NextRouteHandler {
  const apiKey = deps.apiKey ?? defaultApiKeyRepo;
  const catalog = deps.catalog ?? defaultCatalogRepo;
  const reads = deps.reads ?? productReadBudget;
  const now = deps.now ?? ((): Date => new Date());
  // Klient sa zostavuje až keď je naozaj treba: `settings.shop_domain` sa číta
  // lazy a brána sviežosti ho vo väčšine volaní vôbec nepotrebuje (D80).
  const shop = (): Pick<ShopClientV5, 'getProductFull'> =>
    deps.shop ?? createShopClientFromSettings(defaultSettingsRepo);

  return defineRoute(
    {
      method: 'POST',
      body: enrichBodySchema,
      /*
       * Okenný limit per IP. Nie je to obrana proti používateľovi, ale proti
       * obrazovke, ktorá by panel otvárala v cykle: brána sviežosti volania
       * do shopu utne, ale KAŽDÉ volanie stále znamená dotaz do vlastnej DB.
       * 30/min je viac, než sa dá naklikať rukou.
       */
      rateLimit: { limit: 30, windowMs: 60_000, bucket: 'catalog-enrich' },
      handler: async (ctx) => {
        const productId = ctx.body.productId;

        const result = await enrichProductOnDemand(productId, {
          shop: shop(),
          apiKey,
          catalog,
          reads,
          logger: ctx.log,
          now,
          ...(deps.freshMs !== undefined ? { freshMs: deps.freshMs } : {}),
        });

        /*
         * Riadok sa čerstvo prečíta AŽ TU, a to zámerne aj pri neúspechu: panel
         * má ukázať to, čo v DB naozaj leží (typicky staršie obohatenie alebo
         * samé `null`), nie prázdno. Prázdno by sa na obrazovke ľahko nakreslilo
         * ako nula, a to je presne chyba, ktorú I11 zakazuje.
         */
        let enrichment: EnrichmentView | null = null;
        try {
          const record = (await catalog.enrichmentFor([productId])).get(productId) ?? null;
          // Turbopack tu už raz zahodil `if (!record)` ako compile-time falsy.
          if (record !== null) enrichment = enrichmentView(record);
        } catch (cause) {
          ctx.log.warn('catalog_enrich_read_back_failed', {
            productId,
            error: cause instanceof Error ? cause.name : 'unknown',
          });
        }

        const response: EnrichResponse = {
          outcome: result.outcome,
          productId: result.productId,
          fresh: result.outcome === 'fresh',
          capability: result.capability,
          enrichment,
          freshMs: deps.freshMs ?? ENRICH_FRESH_MS,
          readsUsed: result.readsUsed,
          reads: readBudgetView(result.reads),
          resumeAt: iso(result.resumeAt),
          at: result.at.toISOString(),
          error: result.error,
        };
        return response;
      },
    },
    deps.routeDeps,
  );
}

/* ═════════════════ 5. GET — kde stojí dávka a PREČO (D118 bod 2) ══════════ */

export interface EnrichStateRouteDeps {
  /**
   * Zdroj faktov. Predvolene PRODUKČNÝ singleton — v tomto repe už raz
   * integračný test s fake závislosťou zamaskoval, že produkčné zapojenie vôbec
   * nefunguje, takže `deps` sú tu pre testy, nie pre prevádzku.
   */
  catalog?: Pick<CatalogRepoExt, 'loadEnrichState' | 'totalRows' | 'loadSyncProgress'>;
  now?: () => Date;
  routeDeps?: RouteDeps;
}

/** `CatalogEnrichState` → JSON pohľad. Dátumy ako ISO, tri stavy zachované. */
function enrichStateWire(state: CatalogEnrichState, todayUtc: string, at: Date): EnrichBatchStateWire {
  /*
   * Nechala po sebe dávka AKÚKOĽVEK stopu? Riadok v tabuľke sám o sebe stopa
   * NIE JE — zakladá ho migrácia 0014 (`INSERT IGNORE … VALUES (1)`) a
   * `updated_at` má `DEFAULT CURRENT_TIMESTAMP`, takže na čerstvej inštalácii
   * vyzerá ako práve zapísaný. Preto sa pýtame na polia, ktoré vie nastaviť
   * jedine beh dávky.
   */
  const everRan =
    state.startedAt !== null ||
    state.batchDay !== null ||
    state.lastReadAt !== null ||
    state.pauseReason !== null ||
    state.enrichedTotal > 0;

  /*
   * Stojí dávka PRÁVE TERAZ? Vyhodnocuje sa TU, na serveri, ktorý má rovnaké
   * hodiny ako databáza — nie v prehliadači. `pausedUntil === null` pri
   * vyplnenom dôvode znamená „stojí, kým nezasiahne človek" (D120), takže je to
   * pauza, nie chýbajúci údaj.
   */
  const paused =
    state.pauseReason !== null &&
    (state.pausedUntil === null || state.pausedUntil.getTime() > at.getTime());

  const pauseReason: EnrichPauseCode | null = state.pauseReason;

  return {
    everRan,
    batchDay: state.batchDay,
    /*
     * I11 — počítadlo platí VÝHRADNE pre `batch_day`. Keď dávka dnes nebežala,
     * je to číslo z iného dňa a vydávať ho za dnešok by bolo tvrdenie, ktoré
     * nikto nemeral. `null` = „dnes nebežala", nie nula.
     */
    enrichedToday: state.batchDay === todayUtc ? state.enrichedToday : null,
    dailyTarget: state.dailyTarget,
    startedAt: iso(state.startedAt),
    lastReadAt: iso(state.lastReadAt),
    pauseReason,
    pausedUntil: iso(state.pausedUntil),
    paused,
    /*
     * Ktorú pauzu čakanie NEVYLIEČI. `ip_banned` odblokuje správca shopu
     * (`docs/60`), `no_key` vyrieši vloženie kľúča; ostatné tri sa uvoľnia samy.
     */
    waitsForHuman: paused && (pauseReason === 'ip_banned' || pauseReason === 'no_key'),
    // I1/K10 — von ide príznak, nikdy kód chyby.
    failedLastTime: state.lastError !== null,
    updatedAt: iso(state.updatedAt),
  };
}

export function createCatalogEnrichStateRoute(deps: EnrichStateRouteDeps = {}): NextRouteHandler {
  const catalog = deps.catalog ?? defaultCatalogRepo;
  const now = deps.now ?? ((): Date => new Date());

  return defineRoute(
    {
      method: 'GET',
      /*
       * Žiadny `rateLimit`: je to čítanie, ktoré Prehľad aj Nastavenia robia pri
       * každom obnovení, a okenný limit by zhasol práve tú vetu, ktorá hovorí,
       * že dávka stojí. Rovnaký dôvod ako v `/api/status`.
       */
      handler: async (ctx): Promise<EnrichStatePayload> => {
        const at = now();
        // Deň sa počíta v zóne SHOPU (UTC) a cez `Intl` — nikdy
        // `toISOString().slice(0, 10)` (D31) a nikdy v lokálnej zóne: kvótu
        // resetuje shop o polnoci UTC, rovnako ako `batch_day` v dávke.
        const todayUtc = todayInZone(at, READ_BUDGET_TIME_ZONE);
        const unreadable: string[] = [];

        /*
         * Každé čítanie zvlášť a fail-closed: keď sa jedno nedá prečítať, vypadne
         * jeho blok a jeho meno je v `unreadable`. Dopísať sem „keď nevieme,
         * pošli nulu" by znamenalo, že appka klame práve vtedy, keď má databáza
         * problém (rovnaké pravidlo ako v `/api/status`).
         */
        let state: CatalogEnrichState | null = null;
        try {
          state = await catalog.loadEnrichState();
        } catch (cause) {
          unreadable.push('enrich');
          ctx.log.warn('catalog_enrich_state_unreadable', {
            error: cause instanceof Error ? cause.name : 'unknown',
          });
        }

        let catalogProducts: number | null = null;
        try {
          catalogProducts = await catalog.totalRows();
        } catch (cause) {
          unreadable.push('catalog');
          ctx.log.warn('catalog_total_rows_unreadable', {
            error: cause instanceof Error ? cause.name : 'unknown',
          });
        }

        let shopTotalProducts: number | null = null;
        try {
          // `shopTotal` je `null`, kým to shop nepovedal — appka si ho
          // NEDOPOČÍTAVA z počtu riadkov (I11).
          shopTotalProducts = (await catalog.loadSyncProgress()).shopTotal;
        } catch (cause) {
          unreadable.push('sync');
          ctx.log.warn('catalog_sync_progress_unreadable', {
            error: cause instanceof Error ? cause.name : 'unknown',
          });
        }

        // Turbopack tu už raz zahodil `if (!state)` ako compile-time falsy.
        const enriched = state === null ? null : state.enrichedTotal;
        const remaining =
          enriched === null || catalogProducts === null
            ? null
            : Math.max(0, catalogProducts - enriched);
        const percent =
          enriched === null || catalogProducts === null || catalogProducts === 0
            ? null
            : Math.round((enriched / catalogProducts) * 1000) / 10;

        const coverage: EnrichCoverageWire = {
          enriched,
          catalogProducts,
          shopTotalProducts,
          remaining,
          percent,
          /*
           * Dni počíta ENGINE (`enrichDaysNeeded`), nie táto route. Dva odhady
           * toho istého v jednom paneli sa už raz rozišli o deň (nález review
           * z 12. 8.) a jeden z nich potom klamal.
           */
          estimatedDaysLeft:
            remaining === null || state === null
              ? null
              : enrichDaysNeeded(remaining, state.dailyTarget),
        };

        const payload: EnrichStatePayload = {
          state: state === null ? null : enrichStateWire(state, todayUtc, at),
          coverage,
          unreadable,
          at: at.toISOString(),
        };

        ctx.log.debug('catalog_enrich_state_read', {
          paused: payload.state?.paused ?? null,
          reason: payload.state?.pauseReason ?? null,
          unreadable: unreadable.length,
        });
        return payload;
      },
    },
    deps.routeDeps,
  );
}

export const GET = createCatalogEnrichStateRoute();
export const POST = createCatalogEnrichRoute();
