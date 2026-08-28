/**
 * Aura Zľavy — `GET /api/catalog/reduction-check`
 * (KONTRAKT-API-V5-2026-08-13: bod A2, rozhodnutie R2, zmena invariantu I11).
 *
 * Jediná cesta, ktorou sa obrazovka pýta: **je zľava v eshope naozaj taká, akú
 * sme ju zapísali?** Doteraz sa to opýtať nedalo a appka preto v 17 miestach
 * hovorila „podľa vlastných zápisov". `GET /api/products/getFull` vracia
 * `reduction_percent`, `reduction_from` a `reduction_to`, teda skutočnosť; táto
 * route ju postaví vedľa vlastného záznamu a vráti výrok.
 *
 * TRI VECI, NA KTORÝCH TÁTO ROUTE STOJÍ
 * -------------------------------------
 *  1. **Tri výroky, nikdy dva.** `match` · `differs` · `unknown`. Tretí je ten
 *     najdôležitejší: keď sa `getFull` nedá prečítať (chýba oprávnenie, minutý
 *     rozpočet, výpadok), NESMIE to vyzerať ako „sedí". Preto má KAŽDÉ vyžiadané
 *     ID svoj riadok — aj to, na ktoré sa vôbec nepozrelo — a nikdy nie prázdny.
 *  2. **Nič sa nespúšťa samo** (kontrakt UI, bod 4). Overenie stojí čítanie
 *     s kľúčom, teda z tej istej kvóty, z ktorej zapisuje fronta bežiaca týždne.
 *     Volá sa výhradne z akcie človeka, výhradne pre označené riadky alebo pre
 *     jeden otvorený produkt, a odpoveď vždy nesie čas (`at`) aj cenu
 *     (`readsUsed`, `reads`).
 *  3. **Rozdiel je NÁLEZ, nie chyba.** Route nehovorí, prečo rozdiel vznikol
 *     (P8) — vracia hodnoty oboch strán, druh rozdielu a zoznam dostupných
 *     krokov (`nextStep`). Vetu k tomu píše obrazovka.
 *
 * PREČO NIE SÚČASŤ `/api/catalog/search`
 * --------------------------------------
 * Hľadanie číta zrkadlo a je zadarmo; overenie je platené volanie na kľúč. Zliať
 * ich do jednej cesty by znamenalo, že rozpočet kľúča ukrajuje každé preklikanie
 * tabuľky. Sú to dve rôzne otázky s dvoma rôznymi cenami, preto dve cesty.
 *
 * KDE SA `capability.note` SMIE VYKRESLIŤ
 * ---------------------------------------
 * VÝHRADNE v Nastaveniach → Zamknuté funkcie (`components/settings/LockedFeatures.tsx`),
 * rovnako ako pri hľadaní (kontrakt UI, bod 18). Detail produktu a detail zľavy
 * kreslia `verdict` a `unknownCause`; to nie je mlčanie, ale priznanie na mieste.
 *
 * Vlastník: V16 (overenie skutočnosti).
 */
import { z } from 'zod';

import type { DateOnly } from '@/contracts';

/*
 * `readBudgetView` sa ZÁMERNE dováža z `/api/catalog/search` a neopisuje sa:
 * obe cesty hlásia ten istý rozpočet a druhý tvar toho istého čísla by sa po
 * prvej zmene rozišiel — a obrazovka by mala dva rôzne „koľko dnes ostáva".
 * Import je len mapovacia funkcia; handler druhej cesty sa tým nespúšťa.
 */
import { readBudgetView, type ReadBudgetView } from '@/app/api/catalog/search/route';
import {
  OWN_WRITES_LOOKBACK,
  REDUCTION_CHECK_MAX,
  checkReductionsInShop,
  type ProductReductionCheck,
  type ReductionCheckDeps,
  type ReductionCheckOutcome,
} from '@/lib/catalog/reduction-check';
import type {
  OwnReductionState,
  ReductionDifferenceKind,
  ReductionNextStep,
  ReductionSummary,
  ReductionUnknownCause,
  ReductionVerdict,
} from '@/lib/catalog/reduction-compare';
import type { ShopCapability } from '@/lib/catalog/product-codes';
import { LOGIC_TIME_ZONE, todayInZone } from '@/lib/domain/dates';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import {
  apiKeyRepo as defaultApiKeyRepo,
  type ApiKeyRepository,
} from '@/lib/repo/api-key.repo';
import { insightsRepo as defaultInsightsRepo } from '@/lib/repo/insights.repo';
import { anonReadBudget } from '@/lib/repo/read-budget.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings, type ShopClientV5 } from '@/lib/shop/client';
import type { ReadBudget } from '@/lib/shop/read-budget';

/* ═══════════════════════════ 1. Zod pre query ═════════════════════════════ */

/** Jedna hodnota alebo zoznam oddelený čiarkou (`?productIds=18342,21170`). */
const csvQuery = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value): string[] => {
    if (value === undefined) return [];
    const parts = Array.isArray(value) ? value : [value];
    return parts.flatMap((part) => part.split(',')).map((s) => s.trim()).filter((s) => s.length > 0);
  });

const checkQuerySchema = z.object({
  /** Produkty, ktoré sa majú overiť. Nad strop `REDUCTION_CHECK_MAX` sa nepozerá. */
  productIds: csvQuery,
  /**
   * Deň, voči ktorému sa porovnáva. Slúži VÝHRADNE na to, aby sa dal overiť
   * budúci deň okna; predvolený je dnešok v logickom pásme (D31). Nezmyselná
   * hodnota spadne na dnešok — nikdy nespôsobí chybu celej odpovede.
   */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/* ═══════════════════════════ 2. Závislosti ════════════════════════════════ */

export interface ReductionCheckRouteDeps {
  /** VÝHRADNE `getFull` — zápis ani rušenie zľavy sa sem nedá podstrčiť. */
  shop?: Pick<ShopClientV5, 'getProductFull'>;
  apiKey?: Pick<ApiKeyRepository, 'loadForUse' | 'recallScopes'>;
  /** História VLASTNÝCH zápisov na produkt. */
  ownWrites?: ReductionCheckDeps['ownWrites'];
  /**
   * Zdieľané počítadlo čítaní zo shopu (A4).
   *
   * POZOR — je to DOČASNÉ napojenie a v reporte je to napísané nahlas: `getFull`
   * je čítanie S KĽÚČOM, takže shop ho účtuje NA KĽÚČ, kým `anon` dráha je
   * rozpočtovaná na IP. Vlastná dráha (`product`) v `ReadLane` zatiaľ nie je a
   * založiť ju je zmena v `src/lib/shop/read-budget.ts`, ktorý táto vetva
   * nevlastní (DB migráciu si nevyžiada — `shop_read_budget.lane` je
   * `VARCHAR(24)`). Dovtedy sa účtuje do anonymnej dráhy: je to konzervatívne
   * (odpočíta sa viac, než sa v shope minulo), takže z toho nemôže vzniknúť ban
   * — len o niečo pomalšia synchronizácia katalógu. Kým chýba oprávnenie
   * `product:read`, sa aj tak neminie ani jedno čítanie: overenie skončí na
   * bráne oprávnenia PRED rezerváciou.
   */
  reads?: Pick<ReadBudget, 'reserve' | 'status'>;
  now?: () => Date;
  routeDeps?: RouteDeps;
}

/* ═══════════════════════════ 3. Tvar odpovede ═════════════════════════════ */

/**
 * Jeden overený produkt.
 *
 * Nesie OBE strany, nie len výsledok: obrazovka musí vedieť napísať „my 10 %,
 * eshop 15 %", nie iba „nesedí". `own` aj `shop` sú preto celé stavy vrátane
 * dôvodu, prečo je niektorý z nich neznámy.
 */
export interface ProductReductionView {
  productId: number;
  /** `match` · `differs` · `unknown`. `unknown` sa NIKDY nekreslí ako `match`. */
  verdict: ReductionVerdict;
  /** Čo o produkte hovoria VLASTNÉ zápisy k dňu `day`. */
  own: OwnReductionState;
  /** Čo o ňom hlási eshop. `unknown` je medzera v poznaní, nie „bez zľavy". */
  shop: ProductReductionCheck['shop'];
  /** V čom sa strany rozchádzajú. Prázdne pri `match` aj pri `unknown`. */
  differences: ReductionDifferenceKind[];
  /** Prečo je výrok `unknown`. Vyplnené VÝHRADNE pri `unknown`. */
  unknownCause: ReductionUnknownCause | null;
  /** `true` = eshop odpovedal na produkt, ktorého vlastný zápis skončil ako D45. */
  resolvesUncertainWrite: boolean;
  /** Kód dostupného kroku; vetu k nemu píše obrazovka (P8 — nie je to rada). */
  nextStep: ReductionNextStep;
  /** Kedy sa eshopu naozaj pýtalo (ISO). `null` = nepýtalo sa. */
  checkedAt: string | null;
  /** KÓD chyby čítania (I1). `'not found'` = eshop taký produkt nemá. */
  error: string | null;
}

export interface ReductionCheckResponse {
  /**
   * `done` · `no_ids` · `locked` · `unknown_scope` · `no_key` · `budget_day` ·
   * `budget_minute` · `budget_unknown` · `failed`.
   */
  outcome: ReductionCheckOutcome;
  /** Stav oprávnenia `product:read`. `note` patrí VÝHRADNE do `LockedFeatures`. */
  capability: ShopCapability;
  /** Deň, voči ktorému sa porovnávalo — bez neho je výrok nečitateľný. */
  day: DateOnly;
  /** Riadok pre KAŽDÉ vyžiadané ID do stropu. Nikdy sa žiadne nevynechá. */
  products: ProductReductionView[];
  /** Počty po výrokoch. `unknown` je vlastné číslo, nikdy súčasť `match`. */
  summary: ReductionSummary;
  /** ID nad strop — na tie sa vôbec nepozeralo. */
  skipped: number[];
  /** Strop jedného overenia; obrazovka podľa neho vie, koľko riadkov ponúknuť. */
  limit: number;
  /** Koľko čítaní zo shopu toto overenie minulo. */
  readsUsed: number;
  reads: ReadBudgetView | null;
  /** Kedy overenie prebehlo (ISO) — konkrétny čas (kontrakt UI, bod 10). */
  at: string;
  /** KÓD chyby, ktorá beh zastavila (I1). `null` = nič nespadlo. */
  error: string | null;
  /**
   * Čo sa tu porovnáva. Konštanta; je tu preto, aby sa nedalo prehliadnuť, že
   * na rozdiel od `/api/catalog/search` (`discountSource: 'own_writes'`) je toto
   * MERANÝ stav eshopu vedľa vlastného záznamu, nie len vlastný záznam.
   */
  comparedWith: 'shop_getfull';
}

function productView(row: ProductReductionCheck): ProductReductionView {
  return {
    productId: row.productId,
    verdict: row.verdict,
    own: row.own,
    shop: row.shop,
    differences: [...row.differences],
    unknownCause: row.unknownCause,
    resolvesUncertainWrite: row.resolvesUncertainWrite,
    nextStep: row.nextStep,
    checkedAt: row.checkedAt === null ? null : row.checkedAt.toISOString(),
    error: row.error,
  };
}

/* ═══════════════════════════ 4. Route ═════════════════════════════════════ */

export function createReductionCheckRoute(deps: ReductionCheckRouteDeps = {}): NextRouteHandler {
  const apiKey = deps.apiKey ?? defaultApiKeyRepo;
  const ownWrites =
    deps.ownWrites ?? ((productId: number) => defaultInsightsRepo.productWrites(productId, OWN_WRITES_LOOKBACK));
  const reads = deps.reads ?? anonReadBudget;
  const now = deps.now ?? ((): Date => new Date());
  // Klient sa zostavuje až keď je naozaj treba: `settings.shop_domain` sa číta
  // lazy a brána oprávnenia ho vo väčšine volaní vôbec nepotrebuje (D80).
  const shop = (): Pick<ShopClientV5, 'getProductFull'> =>
    deps.shop ?? createShopClientFromSettings(defaultSettingsRepo);

  return defineRoute(
    {
      method: 'GET',
      query: checkQuerySchema,
      handler: async (ctx) => {
        const productIds = ctx.query.productIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0);

        const day: DateOnly = ctx.query.day ?? todayInZone(now(), LOGIC_TIME_ZONE);

        const result = await checkReductionsInShop(productIds, {
          shop: shop(),
          apiKey,
          ownWrites,
          reads,
          day,
          logger: ctx.log,
          now,
        });

        const response: ReductionCheckResponse = {
          outcome: result.outcome,
          capability: result.capability,
          day: result.day,
          products: result.products.map(productView),
          summary: result.summary,
          skipped: [...result.skippedIds],
          limit: REDUCTION_CHECK_MAX,
          readsUsed: result.readsUsed,
          reads: readBudgetView(result.reads),
          at: result.at.toISOString(),
          error: result.error,
          comparedWith: 'shop_getfull',
        };
        return response;
      },
    },
    deps.routeDeps,
  );
}

export const GET = createReductionCheckRoute();
