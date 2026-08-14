# SPERKY API

Production base URL: `https://sperky-eshop.sk`

## Acceptable use

Do not misuse the API or use it for automated scanning, scraping, bulk data harvesting, or attempts
to bypass rate limits and access controls. Automated protections may ban abusive clients for up to
one day. Misuse may result in a permanent ban and revocation of the associated API key.

If you need complex or aggregated data, such as statistics, do not try to construct it by scraping
the API. It is usually safer and more efficient for us to implement the required data access
directly. Contact the maintainer at delaja@fedorco.sk to discuss your requirements.

## API key

Copy the key from **Tools → API keys** when it is created or rerolled. It is
shown once and cannot be recovered afterward:

```text
<copy-once-key-from-admin-console>
```

Orders auth scope: `orders:read`

Send it either as:

```http
X-Api-Key: <copy-once-key-from-admin-console>
```

or:

```http
Authorization: Bearer <copy-once-key-from-admin-console>
```

## Orders endpoints

Important: the route is singular `order`, not `orders`.

### List orders

`GET /api/order`

Query params:

- `page`: 1-based, default `1`
- `per_page`: default `50`, max `100`

Example:

```bash
curl -s -H 'X-Api-Key: <copy-once-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/order?page=1&per_page=3'
```

Response shape:

```json
{
  "result": {
    "data": [
      {
        "id": 1763435,
        "date_add": "2026-07-28 12:29:28",
        "total_paid": 64.15,
        "currency": "EUR"
      }
    ],
    "page": 1,
    "per_page": 3,
    "total": 1763422
  }
}
```

Fields returned for each order:

- `id`
- `date_add`
- `total_paid`
- `currency` (ISO code, e.g. `"EUR"`)

Optional filters (query params), any combination:

- `date_from`, `date_to`: `YYYY-MM-DD`, inclusive, filters on `date_add`
- `country`: delivery address country ISO code, e.g. `SK`
- `total_min`, `total_max`: filters on `total_paid`

```bash
curl -s -H 'X-Api-Key: ...' 'https://sperky-eshop.sk/api/order?country=SK&total_min=100&date_from=2026-01-01'
```

### Get one order

`GET /api/order/get?id=<id>`

Example:

```bash
curl -s -H 'X-Api-Key: <copy-once-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/order/get?id=1763435'
```

Response shape:

```json
{
  "result": {
    "ok": true,
    "id": 1763435,
    "date_add": "2026-07-28 12:29:28",
    "total_paid": 64.15,
    "currency": "EUR",
    "products": [
      { "id": 30582, "qty": 1 }
    ],
    "country": "Slovinsko",
    "country_iso": "SI"
  }
}
```

Fields returned:

- `ok`
- `id`
- `date_add`
- `total_paid`
- `currency` (ISO code)
- `products` — each item has `id` and `qty`
- `country`
- `country_iso`

Order errors:

```json
{ "result": { "ok": false, "error": "not found" } }
```

```json
{ "result": { "ok": false, "error": "no id" } }
```

## Products endpoints

Products API is public. No API key is required.

### List products

`GET /api/products`

Query params:

- `page`: 1-based, default `1`
- `per_page`: default `50`, max `100`
- `id_lang`: optional, defaults to the shop default language

Example:

```bash
curl -s 'https://sperky-eshop.sk/api/products?page=1&per_page=3'
```

Response shape:

```json
{
  "result": {
    "data": [
      {
        "id": 22,
        "name": "Náramok z chirurgickej ocele...",
        "price": 20.666667,
        "has_attributes": false
      }
    ],
    "page": 1,
    "per_page": 3,
    "total": 40483
  }
}
```

Fields returned for each product:

- `id`
- `name`
- `price`
- `has_attributes`

### Get one product

`GET /api/products/get?id=<id>`

Query params:

- `id`: required product id
- `id_lang`: optional language id

Example:

```bash
curl -s 'https://sperky-eshop.sk/api/products/get?id=49'
```

Response shape:

```json
{
  "result": {
    "ok": true,
    "id": 49,
    "name": "...",
    "price": 12.3,
    "description": "<h3>...</h3>",
    "description_short": "...",
    "has_attributes": true,
    "attributes": [
      {
        "id_product_attribute": 112,
        "price_impact": 0,
        "reference": "C16.19",
        "ean13": "1020738",
        "quantity": 0,
        "is_default": false,
        "values": ["Oranzova - Zlta"]
      }
    ]
  }
}
```

Fields returned:

- `ok`
- `id`
- `name`
- `price`
- `description`
- `description_short`
- `has_attributes`
- `attributes`

Each `attributes[]` item (a variant / combination) contains:

- `id_product_attribute`
- `price_impact`
- `reference`
- `ean13`
- `quantity`
- `is_default`
- `values`

If a product has no combinations, it returns:

```json
{
  "result": {
    "ok": true,
    "has_attributes": false,
    "attributes": []
  }
}
```

Product errors:

```json
{ "result": { "ok": false, "error": "not found" } }
```

```json
{ "result": { "ok": false, "error": "no id" } }
```

### Get one product (full, key required)

`GET /api/products/getFull?id=<id>`

Same response shape as `GET /api/products/get`, plus back-office fields. Requires an API key with the `product:read` scope.

Query params:

- `id`: required product id
- `id_lang`: optional language id

Example:

```bash
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/products/getFull?id=49'
```

Additional fields returned (on top of everything `get` returns):

- `ean13`
- `reference`
- `purchase_price`
- `margin` — `sell_price - purchase_price`
- `margin_percent` — margin as a percentage of `sell_price`, 2 decimals
- `sell_price` — same value as `price`, tax excluded
- `sell_price_with_vat` — `sell_price` with VAT applied
- `active`
- `date_add`
- `last_time_in_order` — date of the most recent order containing this product, or `null`
- `qty` — stock quantity
- `qty_in_orders` — total quantity of this product ever ordered, across all orders
- `supplier` — supplier name, or `null`
- `reduction_percent`, `reduction_from`, `reduction_to` — the product's active
  percentage reduction, or all three `null` if none is currently active
- `categories` — array of category ids this product is assigned to

### Set a reduction (key required)

`POST /api/products/setReduction`

Sets a time-limited percentage reduction on a product. Requires an API key with the `product:edit` scope.

Body params (form-encoded):

- `id`: required product id
- `from`: `YYYY-MM-DD`
- `to`: `YYYY-MM-DD`
- `reduction`: percent, `0`–`30`

Reduction window is capped at 3 months. Refused (`409`) if the product is currently on an active TurboSaleUltimate flash sale — that mechanism owns the reduction fields while it's running.

Example:

```bash
curl -s -X POST -H 'X-Api-Key: <api-key-from-admin-console>' \
  -d 'id=49&from=2026-08-14&to=2026-09-14&reduction=15' \
  'https://sperky-eshop.sk/api/products/setReduction'
```

Response shape:

```json
{ "result": { "ok": true, "id": 49 } }
```

Errors:

```json
{ "ok": false, "errors": ["invalid_dates"] }
{ "ok": false, "errors": ["invalid_reduction"] }
{ "ok": false, "errors": ["range_too_long"] }
```

```json
{ "ok": false, "errors": ["blocked_by_flash_sale"] }
```

(HTTP `409` for the flash-sale case, `400` for validation errors, `404` if the product doesn't exist.)

### Clear a reduction (key required)

`POST /api/products/clearReduction`

Removes a product's active reduction. Requires an API key with the `product:edit` scope. Same flash-sale restriction as `setReduction`.

Body params (form-encoded):

- `id`: required product id

Example:

```bash
curl -s -X POST -H 'X-Api-Key: <api-key-from-admin-console>' \
  -d 'id=49' \
  'https://sperky-eshop.sk/api/products/clearReduction'
```

Response shape:

```json
{ "result": { "ok": true, "id": 49 } }
```

Errors: `{ "ok": false, "errors": ["blocked_by_flash_sale"] }` (`409`), or `not found` (`404`).

### Search products (key required)

`GET /api/products/search`

Filtered, paginated, sortable product search by name/reference, price range, categories, manufacturers, suppliers, and feature filters. Returns matching product ids only (call `GET /api/products/getFull?id=<id>` for details). Requires an API key with the `product:read` scope.

Not batchable via `/api/batch` — search once for ids, then batch `getFull` calls for the ids you actually want data for.

Query params:

- `search`: string — matched against product reference/name
- `minPrice`, `maxPrice`: number
- `categories[]`: int[]
- `manufacturers[]`: int[]
- `suppliers[]`: int[]
- `filters[groupId][]`: int[] — feature filter ids per group (see admin product search UI)
- `onlyDiscounted`: bool
- `sortBy`: one of `id` (default), `name`, `price`, `date_add`
- `sortDir`: `asc` (default) or `desc`
- `id_lang`: optional language id
- `page`: 1-based, default `1`
- `per_page`: default `50`, max `100`

Example:

```bash
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  -G --data-urlencode 'search=náramok' --data-urlencode 'minPrice=10' --data-urlencode 'maxPrice=30' \
  --data-urlencode 'sortBy=price' --data-urlencode 'sortDir=desc' \
  --data-urlencode 'page=1' --data-urlencode 'per_page=20' \
  'https://sperky-eshop.sk/api/products/search'
```

Response shape:

```json
{
  "result": {
    "ok": true,
    "data": [49, 112, 618],
    "page": 1,
    "per_page": 20,
    "total": 1523
  }
}
```

### Search products via Meilisearch (public)

`GET /api/products/searchIndex`

Relevance/fuzzy text search against the Meilisearch product index — unlike `search` above, matches typos and word order, and ranks by relevance instead of a fixed sort column. No API key required, same as `getIndex`/`get`.

Narrower than `search`: only `active`/`price` are filterable in the index, so there's no category/manufacturer/supplier/feature filter support here, and no caller-chosen sort — results always stay in Meilisearch's own relevance ranking. Returns matching product ids only (call `GET /api/products/getFull?id=<id>` for details).

Not batchable via `/api/batch`, same as `search`.

Query params:

- `search`: string — free-text query, fuzzy-matched against name/description/reference/categories
- `minPrice`, `maxPrice`: number
- `page`: 1-based, default `1`
- `per_page`: default `50`, max `100`

Example:

```bash
curl -s -G --data-urlencode 'search=náramok' --data-urlencode 'minPrice=10' --data-urlencode 'maxPrice=30' \
  'https://sperky-eshop.sk/api/products/searchIndex'
```

Response shape: same as `search` — `{ok, data: [id, id, ...], page, per_page, total}`.

## Categories endpoint

`GET /api/categories`

Active categories, flat list. Requires an API key with the `product:read` scope (same one `getFull`/`search` use). The `id`s here are what `getFull`'s `categories` field returns.

Query params:

- `id_lang`: optional, defaults to the shop default language

Example:

```bash
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/categories'
```

Response shape:

```json
{
  "result": {
    "ok": true,
    "data": [
      { "id": 1, "name": "Titulka", "id_parent": 0, "level_depth": 0 },
      { "id": 2, "name": "Oceľové šperky", "id_parent": 1, "level_depth": 1 }
    ]
  }
}
```

## Whoami endpoint

`GET /api/whoami`

Introspection for the calling API key — useful to check which key you're using and what it's allowed to do, without guessing from error responses. Requires any valid API key, no particular scope.

Example:

```bash
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/whoami'
```

Response shape:

```json
{
  "result": {
    "ok": true,
    "id": 20,
    "name": "my-integration",
    "owner": "Jane Doe",
    "expires_at": null,
    "scopes": ["product:read", "product:edit"],
    "remaining": { "per_minute": 59, "per_day": 9987 }
  }
}
```

`owner` and `expires_at` are `null` when the key has no employee owner / no expiry set. `remaining` is this key's rate-limit budget left after the current request; `per_day` is `null` if the key has no daily quota.

## Common error responses

No or wrong key, or missing `orders:read` scope:

```json
{"error":"forbidden"}
```

Unknown controller:

```json
{"error":"unknown_controller"}
```

Invalid action:

```json
{"error":"invalid_action"}
```

Wrong HTTP method:

```json
{"error":"method_not_allowed"}
```

Rate limited:

```json
{"error":"rate_limited"}
```

## Quick curl reference

```bash
# orders list
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/order'

# order detail
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/order/get?id=1'

# orders list with bearer auth
curl -s -H 'Authorization: Bearer <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/order'

# products list
curl -s 'https://sperky-eshop.sk/api/products'

# product detail
curl -s 'https://sperky-eshop.sk/api/products/get?id=49'

# product detail, full (key required)
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/products/getFull?id=49'

# product search (key required)
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  -G --data-urlencode 'search=náramok' \
  'https://sperky-eshop.sk/api/products/search'

# product search via Meilisearch (public)
curl -s -G --data-urlencode 'search=náramok' \
  'https://sperky-eshop.sk/api/products/searchIndex'

# set a reduction (key required)
curl -s -X POST -H 'X-Api-Key: <api-key-from-admin-console>' \
  -d 'id=49&from=2026-08-14&to=2026-09-14&reduction=15' \
  'https://sperky-eshop.sk/api/products/setReduction'

# clear a reduction (key required)
curl -s -X POST -H 'X-Api-Key: <api-key-from-admin-console>' \
  -d 'id=49' \
  'https://sperky-eshop.sk/api/products/clearReduction'

# categories list (key required)
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/categories'

# whoami (key required, any scope)
curl -s -H 'X-Api-Key: <api-key-from-admin-console>' \
  'https://sperky-eshop.sk/api/whoami'
```
