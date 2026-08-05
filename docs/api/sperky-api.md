# Sperky API

Base URL: `https://<shop-domain>/api/<controller>/<action>`

All responses are JSON. Requests are dispatched to a verb-prefixed method on a
controller — e.g. `GET /api/products` calls `getIndex()`, `POST
/api/products/setReduction` calls `postSetReduction()`. If an action exists only
under a different HTTP verb you get `405 method_not_allowed`; an unknown
action gets `404 invalid_action`; an unknown controller slug gets `404
unknown_controller`.

## Authentication

Two independent identity schemes are recognized on every request:

1. **API key** (required for privileged endpoints). Send it as either:
   - `X-Api-Key: <key>` header, or
   - `Authorization: Bearer <key>` header

   Each key is bound to one or more **scopes** (e.g. `orders:read`,
   `product:edit`). An action that requires a scope your key doesn't have
   returns `403 forbidden`. Keys are issued out-of-band — contact the shop
   maintainer to obtain one.

2. **Cookie-based identity** (browser/session only) — used internally by the
   storefront and admin; not applicable to external API callers.

Endpoints that need neither (public catalog reads) work with no
authentication at all.

## Rate limiting

Every request is throttled:

- **With a valid API key:** 300 requests / 60s, budgeted per key.
- **Without one:** 300 requests / 60s, budgeted per source IP.

Exceeding the budget returns `429 rate_limited` with a `Retry-After` header
(seconds until the window resets). If the request is a genuine error, treat a
`429` as retryable; do not hard-fail on it.

## Response shape

Actions built on the shared response helpers return one of two shapes:

**Success:**

```json
{ "ok": true, "...": "..." }
```

**Error** — returned with a non-200 HTTP status matching the failure:

```json
{ "ok": false, "errors": ["invalid_dates", "invalid_reduction"] }
```

`errors` is always an array, even for a single failure, so you can always
iterate it without a type check.

Some older/simpler endpoints instead return a bare data object (no `ok` key)
on success, or `{"error": "..."}` on a transport-level failure (auth, rate
limit, malformed payload, unhandled server error) — see the per-endpoint
sections below and the table at the bottom for exactly which shape applies.

Common transport-level errors, not specific to any one endpoint:

| Status | Body                                                              | Meaning                                                                          |
| ------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 400    | `{"error":"invalid_input"}`                                       | Malformed/oversized request payload                                              |
| 401    | `{"error":"unauthorized"}`                                        | Missing/invalid identity where required                                          |
| 403    | `{"error":"forbidden"}`                                           | API key present but missing the required scope                                   |
| 403    | `{"error":"batch_not_allowed"}`                                   | Action isn't opted in to be called via `/api/batch`                              |
| 403    | `{"error":"cross_origin_denied"}` / `{"error":"origin_required"}` | Cookie-based write from an unrecognized origin (not relevant to API-key callers) |
| 404    | `{"error":"unknown_controller"}` / `{"error":"invalid_action"}`   | Bad route                                                                        |
| 405    | `{"error":"method_not_allowed"}`                                  | Action exists under a different HTTP verb                                        |
| 429    | `{"error":"rate_limited"}`                                        | Rate limit exceeded (see `Retry-After` header)                                   |
| 500    | `{"error":"request_failed"}`                                      | Unhandled server error (logged server-side)                                      |

## Pagination

Every list endpoint shares the same pagination handling (`App\Classes\Paginator`,
via the `paginate()`/`paginateInto()` helpers on the base API controller), so
this behavior is identical across the whole API:

- `page` (1-based, default 1)
- `per_page` (default 50, capped at 100)

and always returns:

```json
{ "data": [...], "page": 1, "per_page": 50, "total": 1234 }
```

`total` reflects the full result set (all pages), not just the returned page.

---

## Products — `/api/products`

### `GET /api/products` — list products

Public, no auth required.

**Query params:** `page`, `per_page`, `id_lang` (optional, defaults to shop's
default language)

**Response:**

```json
{
 "data": [
  {
   "id": 123,
   "name": "Product name",
   "price": 19.99,
   "has_attributes": false
  }
 ],
 "page": 1,
 "per_page": 50,
 "total": 240
}
```

### `GET /api/products/get?id=123` — one product

Public, no auth required.

**Query params:** `id` (required), `id_lang` (optional)

**Response (success):**

```json
{
 "ok": true,
 "id": 123,
 "name": "Product name",
 "price": 19.99,
 "description": "<p>Full HTML description</p>",
 "description_short": "Short description",
 "has_attributes": true,
 "attributes": [
  {
   "id_product_attribute": 45,
   "price_impact": 2.5,
   "reference": "SKU-RED-M",
   "ean13": "1234567890123",
   "quantity": 12,
   "is_default": true,
   "values": ["Red", "M"]
  }
 ]
}
```

**Errors:** `{"ok":false,"errors":["no id"]}` (400) · `{"ok":false,"errors":["not found"]}` (404)

### `POST /api/products/setReduction` — set a time-limited % reduction

Requires API key with scope **`product:edit`**.

Sets `reduction_percent` / `reduction_from` / `reduction_to` on the product
(clears any fixed `reduction_price`). Constraints:

- `reduction` must be `> 0` and `<= 30` (percent, not a fraction — send `15` for 15%)
- `to` must be on or after `from`
- the `from`–`to` window must not exceed 3 months

**Body params (form or JSON):**

| Field       | Type   | Notes                  |
| ----------- | ------ | ---------------------- |
| `id`        | int    | Product id             |
| `from`      | string | `YYYY-MM-DD`           |
| `to`        | string | `YYYY-MM-DD`           |
| `reduction` | number | Percent, `0 < x <= 30` |

**Response (success):**

```json
{ "ok": true, "id": 123 }
```

**Response (error):**

```json
{ "ok": false, "errors": ["invalid_dates", "invalid_reduction"] }
```

possible error codes: `not found` (404), `invalid_dates`, `invalid_reduction`,
`range_too_long` (400, may appear combined in one response) · `forbidden` (403,
missing/invalid scope)

**Example:**

```bash
curl -X POST 'https://shop.example/api/products/setReduction' \
  -H 'X-Api-Key: <your-key>' \
  -d 'id=123&from=2026-08-05&to=2026-09-05&reduction=15'
```

---

## Orders — `/api/order`

All actions require API key with scope **`orders:read`** (orders carry
customer data).

### `GET /api/order` — list orders

**Query params:**

- `page`, `per_page`
- `date_from`, `date_to` — filter on `date_add`, `YYYY-MM-DD`
- `country` — ISO country code of the delivery address
- `total_min`, `total_max` — filter on `total_paid`

**Response:**

```json
{
 "data": [
  {
   "id": 456,
   "date_add": "2026-08-01 10:22:00",
   "total_paid": 59.9,
   "currency": "EUR"
  }
 ],
 "page": 1,
 "per_page": 50,
 "total": 12
}
```

### `GET /api/order/get?id=456` — one order + its line items

**Response (success):**

```json
{
 "ok": true,
 "id": 456,
 "date_add": "2026-08-01 10:22:00",
 "total_paid": 59.9,
 "currency": "EUR",
 "products": [{ "id": 123, "qty": 2 }],
 "country": "Slovakia",
 "country_iso": "SK"
}
```

**Errors:** `{"ok":false,"error":"no id"}` (400) · `{"ok":false,"error":"not found"}` (200 — note: this endpoint predates the `errors[]`/status-code convention above, so it currently returns HTTP 200 with `ok:false` and a singular `error` string)

---

## Cart — `/api/cart`

Public — reflects the caller's own session cart (from the `id_cart` cookie).
No auth required; an API-key caller with no cart cookie gets an empty cart
back rather than an error.

### `GET /api/cart/cartContents` — current cart contents

**Response:**

```json
{
 "id_cart": 789,
 "count": 3,
 "products": [
  {
   "id_product": 123,
   "id_product_attribute": 45,
   "name": "Product name",
   "reference": "SKU-RED-M",
   "quantity": 2,
   "unit_price": 19.99,
   "total": 39.98
  }
 ],
 "totals": {
  "products": 39.98,
  "shipping": 3.9,
  "discounts": 0,
  "total": 43.88
 }
}
```

An empty/nonexistent cart returns `{"id_cart":0,"count":0,"products":[],"totals":null}`.

---

## Batch — `/api/batch`

### `POST /api/batch` — run up to 25 requests in one call

Public endpoint (each sub-request is authorized on its own — see below).

Each item runs the target endpoint in-process (no network round-trip) with
the exact same behavior as calling it directly: its own auth, its own
rate-limit hit, its own scope check, its own response shape. **Batching does
not reduce your rate-limit cost** — 25 items still spend 25 hits (plus 1 for
the batch call itself) against your budget. A failing item never aborts the
batch; it just carries its own error in its slot. Items run one after
another, so wall time is roughly the sum of all items — batch for
convenience/atomicity of the call, not for parallelism.

**Not every action is batchable.** Each action has to opt in server-side;
an action that hasn't opted in returns `{"ok":false,"error":"batch_not_allowed"}`
(403) in its slot instead of running. This exists so a heavy/uncached action
can't be fanned out 25x for free just because it's reachable. Currently
opted in: `GET /api/products/get`, `GET /api/order/get`. List/index endpoints,
writes, and single-item-per-caller actions like `GET /api/cart/cartContents`
(there's nothing to fan out — it's always just the caller's own one cart) are
not batchable by default.

**Body:**

| Field      | Type  | Notes                  |
| ---------- | ----- | ---------------------- |
| `requests` | array | 1–25 items (see below) |

Each item:

| Field        | Type   | Notes                                                                              |
| ------------ | ------ | ---------------------------------------------------------------------------------- |
| `controller` | string | Route slug — same as the URL segment, e.g. `products`, `order`                     |
| `action`     | string | Action name, e.g. `get`, `setReduction`, `index`                                   |
| `method`     | string | HTTP verb to dispatch under. Default `GET`                                         |
| `data`       | object | Params for that action — becomes its query string (GET) or POST body (other verbs) |

You cannot nest a batch inside a batch (`controller: "batch"` is rejected per-item).

**Response:**

```json
{
 "ok": true,
 "results": [
  { "ok": true, "id": 123, "name": "Product name", "...": "..." },
  { "ok": false, "errors": ["not found"] }
 ]
}
```

`results` is positional — `results[i]` is the response for `requests[i]`,
in the exact shape that endpoint would return standalone (including its own
HTTP-status-specific error shape; the batch call itself is always 200 as
long as the envelope itself is well-formed).

**Errors:** `{"ok":false,"errors":["no_requests"]}` (400, empty/missing `requests`)
· `{"ok":false,"errors":["too_many_requests"]}` (400, over 25 items)
· a malformed item (missing `controller`/`action`) resolves to
`{"ok":false,"error":"invalid_item"}` in its own slot rather than failing the batch.

**Example — two reads across different endpoints in one call:**

```bash
curl -X POST 'https://shop.example/api/batch' \
  -H 'X-Api-Key: <your-key>' \
  -d 'requests[0][controller]=products&requests[0][action]=get&requests[0][data][id]=123' \
  -d 'requests[1][controller]=order&requests[1][action]=get&requests[1][data][id]=456'
```

(Only the actions listed as "currently opted in" above are batchable today —
writes like `setReduction` aren't yet, so a batch item calling it gets
`{"ok":false,"error":"batch_not_allowed"}` in its slot instead of running.)

---

## Scopes reference

| Scope          | Grants                            |
| -------------- | --------------------------------- |
| `orders:read`  | All `/api/order/*` actions        |
| `product:edit` | `POST /api/products/setReduction` |

Contact the shop maintainer to have a key issued for a given scope.
