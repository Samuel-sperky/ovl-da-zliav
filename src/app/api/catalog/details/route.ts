/**
 * Aura Zľavy — DOŤAHOVANIE DETAILOV PRODUKTOV (`POST /api/catalog/details`).
 *
 * PREČO TÁTO CESTA EXISTUJE
 * -------------------------
 * Zrkadlo katalógu má 41 220 riadkov a všetky prišli z `GET /api/products`
 * (`source='list'`), ktorý vracia iba `{id, name, price, has_attributes}`.
 * Kód produktu (`reference`), EAN ani sklad v ňom teda nie sú ANI RAZ — nie sú
 * to chýbajúce údaje, sú to údaje, ktoré appka nikdy nemala. Táto cesta ich
 * doťahuje pre riadky, ktoré si niekto naozaj pozrel.
 *
 * ČO SA TU NESMIE POKAZIŤ
 * -----------------------
 *
 * 1. **Doťahuje sa len to, na čo sa niekto pozerá.** Stránka tabuľky je 50
 *    riadkov = dve dávky po 25. Celý katalóg by bol 1 649 dávok, teda niekoľko
 *    dní z rozpočtu, ktorý appka zdieľa s načítavaním katalógu a sťahovaním
 *    objednávok. `DETAIL_FILL_MAX` je strop a nemá sa dvíhať; keď treba viac,
 *    treba viac stránok, nie väčšiu dávku.
 *
 * 2. **Rozpočet rozhoduje, nie snaha.** Keď na dávku nie je miesto, cesta
 *    NEDOPLNÍ a povie to (`outcome`, `notFilledReason`). Nikdy nevráti staré
 *    číslo ako nové a nikdy nečaká, kým sa rozpočet obnoví.
 *
 * 3. **`get` verzus `getFull` sa rozhoduje na JEDNOM mieste** — v
 *    `chooseDetailRoute()`. Bez scope `product:read` sa ide verejným `get`,
 *    ktorý dá kód a sklad len pre varianty; so scope `getFull`, ktorý ich dá
 *    pre každý produkt aj s maržou a dodávateľom. Cesta, ktorou riadok prišiel,
 *    ide v odpovedi von, lebo bez nej sa nedá odlíšiť „produkt kód nemá" od
 *    „nemali sme kľúč".
 *
 * 4. **Odpoveď nesie riadky, nie len súhrn.** UI po doplnení nesmie musieť
 *    volať druhýkrát — to by z jednej stránky spravilo tri požiadavky.
 *
 * Vlastník: doťahovanie detailov, 19. 8. 2026.
 */
import { z } from 'zod';

import {
  DETAIL_FILL_MAX,
  fillProductDetails,
  type ProductDetailsResult,
} from '@/lib/catalog/product-details';
import { defineRoute, type NextRouteHandler, type RouteDeps } from '@/lib/http/define-route';
import { apiKeyRepo as defaultApiKeyRepo } from '@/lib/repo/api-key.repo';
import { catalogRepo as defaultCatalogRepo } from '@/lib/repo/catalog.repo';
import { settingsRepo as defaultSettingsRepo } from '@/lib/repo/settings.repo';
import { createShopClientFromSettings } from '@/lib/shop/client';

import { withRouteErrors } from '../../campaigns/_shared';

const bodySchema = z.object({
  /**
   * ID zo stránky, ktorú má používateľ pred sebou. Strop je zámerne rovnaký
   * ako `DETAIL_FILL_MAX` — väčšia dávka by minula denný rozpočet za pár
   * obrazoviek.
   */
  productIds: z.array(z.number().int().positive()).min(1).max(DETAIL_FILL_MAX),
  /** Doplniť aj riadky, ktoré už detail majú. Používa sa pri ručnej obnove. */
  force: z.boolean().optional(),
});

export interface CatalogDetailsDeps {
  readonly catalogRepo?: typeof defaultCatalogRepo;
  readonly apiKeyRepo?: typeof defaultApiKeyRepo;
  readonly settingsRepo?: typeof defaultSettingsRepo;
  readonly shopClient?: Parameters<typeof fillProductDetails>[1]['shop'];
}

export function createCatalogDetailsPost(
  overrides: CatalogDetailsDeps = {},
  routeDeps: RouteDeps = {},
): NextRouteHandler {
  const catalog = overrides.catalogRepo ?? defaultCatalogRepo;
  const apiKey = overrides.apiKeyRepo ?? defaultApiKeyRepo;
  const settings = overrides.settingsRepo ?? defaultSettingsRepo;
  const shop =
    overrides.shopClient ?? createShopClientFromSettings({ get: () => settings.get() });

  return defineRoute(
    {
      method: 'POST',
      auth: 'session',
      body: bodySchema,
      handler: (ctx) =>
        withRouteErrors(async () => {
          const productIds = [...new Set(ctx.body.productIds)].sort((a, b) => a - b);

          const result: ProductDetailsResult = await fillProductDetails(productIds, {
            shop,
            catalog,
            apiKey,
            ...(ctx.body.force === true ? { force: true } : {}),
          });

          /*
           * Riadky sa čítajú AŽ PO doplnení a pre všetky vyžiadané ID — aj pre
           * tie, ktoré sa doplniť nepodarilo. UI tak dostane aj dôvod, prečo je
           * niektorá bunka prázdna, a nemusí sa pýtať druhýkrát.
           */
          const rows = await catalog.detailsFor(productIds);

          return {
            route: result.route,
            outcome: result.outcome,
            capability: result.capability,
            filled: result.filled,
            alreadyDetailed: result.alreadyDetailed,
            notInShop: result.notInShop,
            notFilled: result.notFilled,
            notFilledReason: result.notFilledReason,
            readsUsed: result.readsUsed,
            reads: result.reads,
            at: result.at,
            error: result.error,
            rows: productIds.map((id) => rows.get(id) ?? null),
          };
        }),
    },
    routeDeps,
  );
}

export const POST = createCatalogDetailsPost();
