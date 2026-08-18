/**
 * Aura Zľavy — ČO JE ZA `product:read` A KÓD PRODUKTU PRE VYBRANÉ PRODUKTY
 * (kontrakt UI, body 20, 25 a 27).
 *
 * DVE VECI, KTORÉ PATRIA K SEBE
 * -----------------------------
 *  A. **Priznanie, čo appka nevie a prečo.** `GET /api/products/search` (presné
 *     filtre: kategórie, výrobcovia, dodávatelia, „len zlacnené") a
 *     `GET /api/categories` vyžadujú scope `product:read`. Appka ho nemá.
 *     Doteraz sa to prejavovalo mlčaním — filter sa jednoducho nedal použiť
 *     a nikto nevedel prečo. Odteraz o každej takej funkcii vieme povedať tri
 *     stavy, nie dva: **má · nemá · nevieme** (`ShopCapabilityState`).
 *  B. **Kód produktu (`reference`).** Je len v `getFull`, teda tiež za
 *     `product:read`, a doťahuje sa VÝHRADNE pre vybrané produkty (bod 20).
 *     Nikdy pre celý katalóg — to je 41 082 volaní a dokumentácia shopu
 *     hromadné sťahovanie výslovne zakazuje.
 *
 * ČO SA V TOMTO MODULE NESMIE POKAZIŤ
 * -----------------------------------
 *  1. **„Nevieme" sa nikdy nesmie stať „nemá".** `recallScopes()` vracia
 *     `scopes: null`, kým sa kľúč neoveril — a poslať vtedy používateľa pýtať
 *     si oprávnenie, ktoré kľúč možno dávno má, je horšia škoda než mlčanie.
 *     Preto `hasShopScope()` a jeho tri stavy, nie `includes()`.
 *  2. **Strop je tvrdý a malý.** `CODE_LOOKUP_MAX` je 10 a nedá sa prekročiť
 *     parametrom.
 *  3. **`getFull` míňa rozpočet ZÁPISOVÉHO kľúča.** Shop rozpočtuje volania
 *     s kľúčom NA KĽÚČ, nie podľa toho, či ide o čítanie alebo o zápis. Kým
 *     appka nemá samostatný kľúč na `product:read`, každé dotiahnutie kódu
 *     ukrojí z tej istej kvóty, z ktorej zapisuje fronta bežiaca týždne (K2).
 *     Preto sa doťahuje len na vyžiadanie, len pre výber a len po desiatkach.
 *  4. **Modul NIKDY nehádže.** Kód produktu je doplnok; keď sa nedá prečítať,
 *     tabuľka sa musí zobraziť bez neho.
 *  5. **Do logu ani do výsledku nejde nič z kľúča** (I1) — len KÓD chyby.
 *
 * Vlastník: V15 (hľadanie).
 */
import type { Logger, SecretRef, ShopCtx, Ulid, UtcDate } from '@/contracts';

import type { ApiKeyRepository } from '@/lib/repo/api-key.repo';
import {
  hasShopScope,
  missingScopeSentence,
  type ShopClientV5,
  type ShopScope,
} from '@/lib/shop/client';
import { newOperationId } from '@/lib/shop/correlation';
import { isShopRequestError } from '@/lib/shop/errors';

/* ═══════════════ 1. Čo appka smie — tri stavy, nikdy dva ══════════════════ */

/**
 * `available` — kľúč to oprávnenie preukázateľne má.
 * `locked`    — shop povedal, že ho nemá (meraný fakt).
 * `unknown`   — kľúč sa zatiaľ neoveril, alebo sa `whoami` nedalo prečítať.
 */
export type ShopCapabilityState = 'available' | 'locked' | 'unknown';

export interface ShopCapability {
  readonly state: ShopCapabilityState;
  /** Oprávnenie, ktoré funkcia potrebuje — to isté slovo, aké patrí správcovi shopu. */
  readonly requires: ShopScope;
  /** Veta pre používateľa. `null` len vtedy, keď funkcia funguje. */
  readonly note: string | null;
}

/**
 * Stav jednej funkcie podľa toho, čo si appka pamätá o kľúči.
 *
 * Veta sa NESKLADÁ tu — berie sa z `missingScopeSentence()`, ktorá je jediným
 * miestom, kde sa hovorí o chýbajúcom oprávnení. Druhá formulácia tej istej
 * veci by sa od nej po prvej zmene rozišla.
 */
export function shopCapability(
  scopes: readonly ShopScope[] | null | undefined,
  scope: ShopScope,
): ShopCapability {
  const has = hasShopScope(scopes, scope);
  if (has === true) return { state: 'available', requires: scope, note: null };
  return {
    state: has === null ? 'unknown' : 'locked',
    requires: scope,
    note: missingScopeSentence(scope, has === false),
  };
}

/**
 * Funkcie, ktoré čakajú na `product:read`. Zoznam je zámerne TU a nie v UI:
 * keď oprávnenie pribudne, prestanú byť zamknuté všetky naraz a obrazovka sa
 * nemusí meniť.
 */
export interface ShopCapabilities {
  /** Presné filtre eshopu: kategórie, výrobcovia, dodávatelia, „len zlacnené". */
  readonly exactFilters: ShopCapability;
  /** Zoznam kategórií — bez neho sa filter podľa kategórie nedá ani ponúknuť. */
  readonly categories: ShopCapability;
  /** Kód produktu (`reference`) pre vybrané produkty. */
  readonly productCode: ShopCapability;
}

/**
 * Scopes z pamäte repozitára kľúča.
 *
 * `recallScopes()` je v `ApiKeyRepository` NEPOVINNÁ metóda (kontrakt `ApiKeyRepo`
 * o scopes nevie a in-memory fakes v cudzích testoch ju neimplementujú). Jej
 * absencia znamená presne to isté ako `scopes: null` — **nevieme**. Nikdy nie
 * „kľúč to oprávnenie nemá": z chýbajúcej metódy v teste by sa inak stalo
 * tvrdenie o produkčnom kľúči.
 */
export function recalledScopes(
  repo: Pick<ApiKeyRepository, 'recallScopes'>,
): readonly ShopScope[] | null {
  return repo.recallScopes?.().scopes ?? null;
}

export function shopCapabilities(
  scopes: readonly ShopScope[] | null | undefined,
): ShopCapabilities {
  const capability = shopCapability(scopes, 'product:read');
  return { exactFilters: capability, categories: capability, productCode: capability };
}

/* ═══════════════════════ 2. Kód produktu (bod 20) ═════════════════════════ */

/**
 * Tvrdý strop ID na jedno volanie. Nedá sa prekročiť parametrom.
 *
 * Je nízky zámerne: `getFull` ide s kľúčom, a shop rozpočtuje volania s kľúčom
 * na kľúč — teda z tej istej kvóty, z ktorej zapisuje fronta. Kým appka nemá
 * samostatný kľúč na čítanie, je každý dotiahnutý kód jeden nezapísaný produkt.
 */
export const CODE_LOOKUP_MAX = 10;

export interface ProductCodeEntry {
  readonly productId: number;
  /** Kód produktu zo shopu. `null` = shop ho pri tomto produkte nevedie. */
  readonly reference: string | null;
  /** Kód variantu — produkt s variantmi má kód na každom z nich. */
  readonly variantReferences: readonly string[];
}

/**
 * Ako dopadlo doťahovanie kódov.
 *
 * `locked` a `unknown_scope` sa nezlievajú z toho istého dôvodu ako všade
 * inde: prvé je „shop povedal nie", druhé je „nepýtali sme sa".
 */
export type ProductCodeOutcome =
  | 'done'
  | 'no_ids'
  | 'locked'
  | 'unknown_scope'
  | 'no_key'
  | 'failed';

export interface ProductCodeResult {
  readonly outcome: ProductCodeOutcome;
  readonly capability: ShopCapability;
  readonly codes: readonly ProductCodeEntry[];
  /** ID, na ktoré sa nedostalo — strop jedného volania alebo zastavenie na chybe. */
  readonly skippedIds: readonly number[];
  /** KÓD chyby (I1). `null` = nič nespadlo. */
  readonly error: string | null;
  /** Kedy sa čítalo. Konkrétny čas, nikdy „pred chvíľou" (kontrakt bod 10). */
  readonly at: UtcDate;
}

export interface ProductCodeDeps {
  /** VÝHRADNE `getFull` — zápis sa sem nedá podstrčiť. */
  readonly shop: Pick<ShopClientV5, 'getProductFull'>;
  /**
   * Kľúč a pamäť jeho scopes. `recallScopes()` sa používa ZÁMERNE namiesto
   * `whoami`: overenie kľúča je samostatné volanie so samostatnou cenou
   * a hľadanie produktov nie je dôvod ho spúšťať.
   */
  readonly apiKey: Pick<ApiKeyRepository, 'loadForUse' | 'recallScopes'>;
  readonly logger?: Logger;
  readonly now?: () => UtcDate;
  readonly operationId?: Ulid;
  /** Koľko ID naraz. Strop `CODE_LOOKUP_MAX`. */
  readonly limit?: number;
}

function errorCode(error: unknown): string {
  if (isShopRequestError(error)) return error.shopError.code ?? error.shopError.kind;
  if (error instanceof Error && error.name.length > 0) return `local_${error.name}`;
  return 'local_unknown';
}

/**
 * Dotiahne kód produktu pre VYBRANÉ produkty (bod 20).
 *
 * Volania idú SEKVENČNE. Nie kvôli I10 (to je o zápisoch), ale preto, že
 * paralelné čítania s kľúčom by minútový strop kľúča (20/min) vyčerpali naraz
 * a shop by odmietol aj zápis, ktorý práve beží.
 *
 * @returns report; NIKDY nehádže.
 */
export async function resolveProductCodes(
  productIds: readonly number[],
  deps: ProductCodeDeps,
): Promise<ProductCodeResult> {
  const now = deps.now ?? ((): UtcDate => new Date());
  const log = deps.logger;
  const ctx: ShopCtx = { operationId: deps.operationId ?? newOperationId() };
  const limit = Math.max(0, Math.min(CODE_LOOKUP_MAX, Math.trunc(deps.limit ?? CODE_LOOKUP_MAX)));

  const unique = [...new Set(productIds.filter((id) => Number.isInteger(id) && id > 0))];
  const capability = shopCapability(recalledScopes(deps.apiKey), 'product:read');

  const report = (
    outcome: ProductCodeOutcome,
    patch: Partial<ProductCodeResult> = {},
  ): ProductCodeResult => ({
    outcome,
    capability,
    codes: [],
    skippedIds: [],
    error: null,
    at: now(),
    ...patch,
  });

  if (unique.length === 0) return report('no_ids');
  if (capability.state === 'unknown') return report('unknown_scope', { skippedIds: unique });
  if (capability.state === 'locked') return report('locked', { skippedIds: unique });

  let key: SecretRef | null;
  try {
    key = await deps.apiKey.loadForUse();
  } catch (cause) {
    // Expirovaný alebo wipnutý kľúč (`ApiKeyError`) nie je chyba hľadania —
    // je to dôvod povedať „nedá sa", nie spadnúť.
    return report('no_key', { skippedIds: unique, error: errorCode(cause) });
  }
  if (key === null) return report('no_key', { skippedIds: unique });

  const planned = unique.slice(0, limit);
  const codes: ProductCodeEntry[] = [];
  let error: string | null = null;

  for (const productId of planned) {
    try {
      const full = await deps.shop.getProductFull(productId, key, ctx);
      const variantReferences = (full.attributes ?? [])
        .map((attribute) => attribute.reference)
        .filter((reference): reference is string => typeof reference === 'string' && reference.length > 0);
      codes.push({
        productId: full.id,
        reference:
          typeof full.reference === 'string' && full.reference.length > 0 ? full.reference : null,
        variantReferences,
      });
    } catch (cause) {
      // Zastavenie na prvej chybe je vedomé: ďalšie ID narazí na to isté
      // (odmietnutý kľúč, limit, výpadok) a každý ďalší pokus ukrojí z kvóty,
      // ktorú potrebuje fronta.
      error = errorCode(cause);
      log?.warn('product_code_read_failed', { productId, error });
      break;
    }
  }

  const done = new Set(codes.map((entry) => entry.productId));
  const skippedIds = unique.filter((id) => !done.has(id));

  return report(error === null ? 'done' : 'failed', { codes, skippedIds, error });
}
