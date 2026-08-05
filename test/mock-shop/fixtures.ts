/**
 * Aura Zľavy — FIXTURES pre mock shop (BUILD-SPEC §12).
 *
 * Dáta sú odpísané z príkladov v `docs/api/sperky-api.md`, aby smoke test mohol
 * porovnať odpoveď mocku s dokumentáciou 1 : 1.
 *
 * INVARIANT I1: žiadna fixture nesmie vyzerať ako reálny kľúč poskytovateľa
 * (`sk_live_…`, `AKIA…`, `ghp_…`). Preto majú všetky kľúče tvar
 * `fake-shop-key-XXXX` — nezachytí ich ani gitleaks, ani push protection.
 *
 * Vlastník: A6.
 */
import {
  DEFAULT_MOCK_API_KEY,
  type MockApiKey,
  type MockProduct,
  type MockShopStateOptions,
} from './state';

/* ═════════════════════════════ 1. Kľúče (I1) ═══════════════════════════════ */

/** Platný kľúč so scope `product:edit` — jediný scope, ktorý appka smie mať (I8). */
export const VALID_API_KEY = DEFAULT_MOCK_API_KEY;

/** Kľúč, ktorý mock nepozná → 401 `unauthorized`. */
export const UNKNOWN_API_KEY = 'fake-shop-key-unknown-9999';

/** Kľúč bez `product:edit` → 403 `forbidden` na `setReduction`. */
export const NO_SCOPE_API_KEY = 'fake-shop-key-noscope-0002';

export const DEFAULT_KEYS: MockApiKey[] = [
  { key: VALID_API_KEY, scopes: ['product:edit'] },
  { key: NO_SCOPE_API_KEY, scopes: [] },
];

/* ═════════════════════════════ 2. Produkty ═════════════════════════════════ */

/** Produkt z príkladu `GET /api/products/get?id=123` v API dokumentácii. */
export const PRODUCT_123: MockProduct = {
  id: 123,
  name: 'Product name',
  price: 19.99,
  has_attributes: true,
  description: '<p>Full HTML description</p>',
  description_short: 'Short description',
  attributes: [
    {
      id_product_attribute: 45,
      price_impact: 2.5,
      reference: 'SKU-RED-M',
      ean13: '1234567890123',
      quantity: 12,
      is_default: true,
      values: ['Red', 'M'],
    },
  ],
};

/** Jednoduchý produkt bez variantov (D20 — varianty sa v UI len značia). */
export const PRODUCT_124: MockProduct = {
  id: 124,
  name: 'Náramok Aura strieborný',
  price: 34.5,
  has_attributes: false,
  description: '<p>Strieborný náramok</p>',
  description_short: 'Strieborný náramok',
};

/**
 * Presne 10 produktov — maximum allowlistu (I2). ID-á sú 201–210, aby sa
 * nemýlili s produktmi z dokumentácie.
 */
export const TEN_PRODUCTS: MockProduct[] = Array.from({ length: 10 }, (_, i) => ({
  id: 201 + i,
  name: `Šperk ${i + 1}`,
  price: Number((10 + i * 5.25).toFixed(2)),
  has_attributes: i % 3 === 0,
  description_short: `Testovací šperk číslo ${i + 1}`,
}));

/** Produkt, ktorý v shope neexistuje — pre `not found` cesty (D40). */
export const MISSING_PRODUCT_ID = 999_999;

/** Default katalóg mocku. */
export const DEFAULT_PRODUCTS: MockProduct[] = [PRODUCT_123, PRODUCT_124, ...TEN_PRODUCTS];

/** Katalóg s daným počtom produktov — na test paginácie (`per_page` strop 100). */
export function manyProducts(count: number, startId = 1000): MockProduct[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    name: `Produkt ${startId + i}`,
    price: Number((5 + (i % 40) * 1.5).toFixed(2)),
    has_attributes: false,
  }));
}

/* ═════════════════════════ 3. Predvolený stav mocku ════════════════════════ */

export const DEFAULT_STATE_OPTIONS: MockShopStateOptions = {
  products: DEFAULT_PRODUCTS,
  keys: DEFAULT_KEYS,
};

/* ══════════════════ 4. Očakávané tvary odpovedí (smoke test) ═══════════════ */

/** Presné telá transportných chýb podľa tabuľky v API dokumentácii. */
export const TRANSPORT_ERROR_BODIES = {
  invalid_input: { error: 'invalid_input' },
  unauthorized: { error: 'unauthorized' },
  forbidden: { error: 'forbidden' },
  batch_not_allowed: { error: 'batch_not_allowed' },
  unknown_controller: { error: 'unknown_controller' },
  invalid_action: { error: 'invalid_action' },
  method_not_allowed: { error: 'method_not_allowed' },
  rate_limited: { error: 'rate_limited' },
  request_failed: { error: 'request_failed' },
} as const;

/** Tvar, ktorý neprejde zod schémou klienta → `schema_drift` (D54). */
export const GARBAGE_BODY = { nonsense: true, data: 'not-a-list' } as const;
