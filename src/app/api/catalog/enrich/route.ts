/**
 * Aura Zľavy — `POST /api/catalog/enrich`
 * (KONTRAKT-V4-2026-08-28 §2b: D118 bod 1, D119, D120; I1, I11).
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
import type { ShopCapability } from '@/lib/catalog/product-codes';
import {
  ENRICH_FRESH_MS,
  enrichProductOnDemand,
  type EnrichCatalogRepo,
  type EnrichOneOutcome,
} from '@/lib/engine/catalog-enrich';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { apiKeyRepo as defaultApiKeyRepo, type ApiKeyRepository } from '@/lib/repo/api-key.repo';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { anonReadBudget } from '@/lib/repo/read-budget.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings, type ShopClientV5 } from '@/lib/shop/client';
import type { ReadBudget } from '@/lib/shop/read-budget';

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
   * Zdieľané počítadlo čítaní zo shopu (A4).
   *
   * Dnes je to anonymná dráha, hoci `getFull` je čítanie S KĽÚČOM a shop ho
   * účtuje NA KĽÚČ — vlastná dráha (`product_read`) v `ReadLane` zatiaľ nie je
   * a založiť ju je zmena v `src/lib/shop/read-budget.ts`, ktorý táto vlna
   * nevlastní (DB migráciu si nevyžiada, `shop_read_budget.lane` je `VARCHAR`).
   * Je to konzervatívne — odpočíta sa viac, než sa v shope minulo — takže z toho
   * nemôže vzniknúť ban, len o niečo pomalšia synchronizácia katalógu. Rovnaké
   * dočasné napojenie má `/api/catalog/reduction-check`.
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
  const reads = deps.reads ?? anonReadBudget;
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

export const POST = createCatalogEnrichRoute();
