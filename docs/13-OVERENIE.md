# Aura Zľavy (ovl-da-zliav) — PROTOKOL INTEGRAČNÉHO OVERENIA

**Úloha:** A19 (vlna 4, sám) · **Dátum overenia:** 2026-08-05
**Overovaný stav:** branch `claude/local-eshop-discount-app-qm5fzg`, po commite
`d326c6a` (A0–A18 hotové) + 4 opravy z tohto overenia (viď §A.2).

> Tento dokument je **protokol, nie marketing**. Čo neprešlo, je napísané tak,
> ako to je. Verdikt je na konci (§G).

---

## VERDIKT NA ZAČIATOK

**PRIPRAVENÉ S VÝHRADAMI.**

Statická kontrola, unit + integračné testy (614 testov, z toho integračné proti
reálnej MariaDB) a **produkčný Next.js standalone build** sú zelené a všetkých
14 invariantov má doložený dôkaz. Počas overenia sa však našla **jedna vážna
chyba, ktorú testy nemohli odhaliť**, pretože bola vo *výstupe bundlera*, nie
v zdrojáku (§A.2, oprava č. 3) — bez nej appka na prvej obrazovke po nasadení
padala na HTTP 500. Je opravená a overená na skutočnom produkčnom builde.

Nedokončené zostávajú **dve veci, ktoré sa v tomto prostredí fyzicky nedali
dobehnúť**: Docker build a beh stacku (nie je docker daemon) a 16 z 20
Playwright e2e scenárov (príčina je známa, izolovaná a je v testovacom
harnesse, nie v aplikácii — §D.2). Obe musí Samuel prejsť u seba.

---

## 0. Prostredie overenia

| Vec | Hodnota |
| --- | --- |
| Node | v22.22.2 |
| Next.js | 16.3.0 (Turbopack) |
| MariaDB (lokálna, pre integračné testy) | 10.11.14 (**nie 11.4** — viď §D.6) |
| Docker CLI | 29.3.1, **daemon nedostupný** (`/var/run/docker.sock` neexistuje) |
| Chromium pre Playwright | predinštalovaný rev. 1194; `@playwright/test` 1.62 chce 1234, download blokuje proxy |
| Sieť | výhradne cez agent proxy; `cdn.playwright.dev` zamietnutý (403 `host not permitted`) |

DB schémy použité pri overení: `ovl_zliav_test` (vitest), `ovl_zliav_e2e`
(e2e harness + manuálne HTTP overenie).

---

## A. STATICKÉ OVERENIE

### A.1 Výsledky

| # | Príkaz | Výsledok | Poznámka |
| --- | --- | --- | --- |
| 1 | `npx tsc --noEmit` | ✅ **PREŠLO** (exit 0) | žiadna chyba |
| 2 | `npm run lint` (`eslint .`) | ✅ **PREŠLO** (exit 0) | *pôvodne padalo — 2 chyby, opravené, viď A.2* |
| 3 | `npm run build` (`next build`, `output:'standalone'`) | ✅ **PREŠLO** (exit 0) | *pôvodne padalo — opravené, viď A.2* |
| 4 | `npx vitest run` | ✅ **PREŠLO** — **38 súborov / 614 testov**, 0 zlyhaných, 0 preskočených | integračné testy bežali proti **skutočnej** MariaDB, nie proti mocku DB (overené: `test/integration/repo.spec.ts` = 24 testov prešlo, `describe.skipIf(!available)` sa neaktivoval) |
| 5 | `npm run check-compose-bind` | ✅ **PREŠLO** | „jediný publikovaný port je 127.0.0.1:3070:3070 na ovl-zliav-caddy (I5)" |
| 6 | `npm audit --audit-level=high` | ✅ **PREŠLO** — `found 0 vulnerabilities` | CI to má ako blokujúce (D99) |
| 7 | `gitleaks detect` | ⚠️ **NESPUSTENÉ** — binárka nie je v prostredí | CI ju spúšťa v kontejneri `zricethezav/gitleaks:v8.28.0` ako blokujúci krok; nahradené ručným grepom (§B, I1) |
| 8 | `docker compose config` | ✅ **PREŠLO** (exit 0) | vyžadovalo obídenie chýbajúceho `.env` — viď §C.1 |
| 9 | `npx playwright test` | ❌ **NEPREŠLO** — 4 prešli / 16 zlyhalo | príčina izolovaná, je v harnesse — viď §D.2 |
| 10 | `docker compose build` / `up -d` | ❌ **NESPUSTITEĽNÉ** — chýba docker daemon | viď §C.2 |

`npm ci` sa nespúšťal odznova (`node_modules` z A0 je konzistentný
s `package-lock.json`; `npm audit` aj build nad ním prešli). Čistý `npm ci`
beží v CI (`.github/workflows/ci.yml`, každý job).

### A.2 Opravené počas overenia

Sprint plán dáva A19 právo na **minimálne** opravy kdekoľvek, ale výhradne
také, ktoré odstraňujú zlyhanie buildu / typecheku / testu. Nič iné sa
nemenilo — žiadna nová funkcia, žiadny refaktor. Celkovo 4 zmeny v 4 súboroch,
`git diff --stat`: `16 insertions, 7 deletions`.

#### Oprava 1 — `src/lib/engine/executor.ts` (vlastník A9): nepoužitý import
`npm run lint` padal:
```
src/lib/engine/executor.ts
  44:3  error  'ItemStatus' is defined but never used  @typescript-eslint/no-unused-vars
```
Odstránený `ItemStatus` zo zoznamu type-only importov z `@/contracts`.
Typ sa v súbore nikde nepoužíval. Bez funkčného dopadu.

#### Oprava 2 — `test/integration/repo.spec.ts` (vlastník A8): nepoužitý import
Tá istá lint chyba pre `AllowlistError`. Test na riadku 139 kontroluje chybu
podľa **stringu** `name: 'AllowlistError'`, nie podľa konštruktora, takže
import bol naozaj mŕtvy. Odstránený z importu, telo testu nezmenené.

#### Oprava 3 — `src/lib/repo/api-key.repo.ts` (vlastník A1): **VÁŽNA — bundler zahodil null-guardy**

**Toto je najdôležitejšie zistenie celého overenia.** Zaslúži si celý §A.3.

#### Oprava 4 — `src/app/api/campaigns/_shared.ts` (vlastník A12): eager ENV lámalo `next build`

`npm run build` padal — a **buildovalo sa naposledy v A0, takže to nikto
nezachytil**:
```
Error: Failed to collect configuration for /api/allowlist
  [cause] EnvError: Neplatná konfigurácia ENV (2 chýb):
    - DB_PASSWORD_FILE: DB_PASSWORD_FILE je v produkcii povinný … — D89.
    - DB_MIGRATION_PASSWORD_FILE: … — D89.
      at src/env.ts:197  (loadEnv)
      at src/app/api/campaigns/_shared.ts:138
      at src/app/api/allowlist/route.ts:27
```
**Príčina:** `src/env.ts` je zámerne navrhnutý tak, aby `import` nikdy nespustil
zod validáciu (lazy `Proxy`, komentár *„samotný `import` nikdy nezhodí build ani
statickú analýzu Next.js"*), a `Dockerfile` to má napísané ako predpoklad:
*„Build nesmie vyžadovať reálne ENV — env.ts sa vyhodnocuje až za behu."*
Lenže **všetky** route moduly registrujú handler na module scope
(`export const GET = createAllowlistGet()`), čím sa `resolveRoutesDeps()` volá
už pri kompilácii, a ten čítal `env.LOGIC_TIMEZONE` a `env.SCHEDULER_FIRE_TIME`
**eagerly** → lazy Proxy sa spustil počas `next build` (fáza *collect page
data*, ktorá beží s `NODE_ENV=production`) → zod si vyžiadal produkčné
`DB_*_PASSWORD_FILE`, ktoré pri builde neexistujú (a **ani v Docker builde
existovať nesmú**, I1).

**Oprava (minimálna, sémanticky identická):** obe polia sú teraz gettery, takže
ENV sa vyhodnotí až pri requeste:
```ts
get timeZone(): string { return overrides.timeZone ?? env.LOGIC_TIMEZONE; },
get fireTime(): string { return overrides.fireTime ?? env.SCHEDULER_FIRE_TIME; },
```
Typ `ResolvedRoutesDeps` sa nemenil (getter spĺňa `timeZone: string`).
Po oprave build prejde a vygeneruje `.next/standalone/server.js`.

> **Dôsledok pre CI:** `next build` musí byť v CI blokujúci — je (job na riadku
> 122 `.github/workflows/ci.yml`). Keby A18 CI naozaj bežalo, chyba by sa
> odhalila. Tento build zlyhával 4 vlny.

### A.3 Oprava 3 podrobne — Turbopack zahodil `if (!row)` guardy v repozitári API kľúča

**Symptóm (v produkčnom builde, nie v testoch):**
```
GET /api/key  ->  500
{"ok":false,"error":{"code":"internal_error","message":"Nastala neočakávaná chyba…"}}
log: {"msg":"http_request","path":"/api/key","userId":1,"httpStatus":500,"errorName":"TypeError"}
```
Deterministicky, pri každom volaní, **vždy keď nie je uložený API kľúč** — čo je
presne stav pri prvom setupe, po expirácii TTL a po panic buttone. Ostatné
route-y (`/api/settings`, `/api/campaigns`, `/api/allowlist`, `/api/audit`,
`/api/notifications`, `/api/auth/session`, `/api/health`) aj všetky HTML
stránky vracali 200.

**Ako sa to našlo:** `docker compose up` nešlo, tak sa spustil priamo
`node .next/standalone/server.js` s produkčným ENV proti reálnej MariaDB
a prešli sa všetky route-y `curl`-om.

**Root cause.** Zdroják je správny:
```ts
async getMeta(conn?: Queryable): Promise<ApiKeyMeta> {
  const row = await selectRow(conn);
  if (!row) return { ...ABSENT_META };      // ← tento riadok
  if (isExpired(row)) { … }
```
Turbopack ho **vyhodnotil ako staticky nepravdivú podmienku a zahodil**.
V dev chunku je to vidieť doslova:
```js
async getMeta (conn) {
    const row = await selectRow(conn);
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    // Lazy TTL kontrola aj tu (D63): …
    if (isExpired(row)) { … }
```
a v produkčnom (minifikovanom) chunku guard chýba úplne:
```js
async getMeta(e){let t=await f(e);if(m(t))return await _.wipe("ttl_expired"),{...c};…}
```
Preto `isExpired(null)` → `TypeError: Cannot read properties of null (reading
'expires_at')` (stack získaný dočasnou diagnostikou v `toAppError`, ktorá bola
následne **vrátená do pôvodného stavu**).

Zdroják je čistý ASCII (`od -c` na riadku 299), v súbore nie je ani jeden
`process.env`, `typeof` ani `import.meta`, takže niet čo legitímne foldovať.
Ide o **defekt statického analyzátora Turbopacku/SWC v Next.js 16.3.0**.

**Zasiahnuté boli 3 guardy — všetky v `src/lib/repo/api-key.repo.ts`:**

| Miesto | Zdroják | Čo z toho ostalo v builde | Dôsledok |
| --- | --- | --- | --- |
| `getMeta()` | `if (!row) return {...ABSENT_META};` | zahodené | `GET /api/key` → 500 vždy, keď nie je kľúč |
| `loadForUse()` | `if (!row) return null;` | zahodené | namiesto čistého `null` (= „nie je kľúč" → `needs_key`, D21) vyletí `TypeError` — engine/scheduler dostane nečakanú výnimku namiesto fail-closed cesty |
| `SecretRef` (vnútro `loadForUse`) | `if (!fresh) throw new ApiKeyError('unavailable', …)` | zahodené | kľúč wipnutý medzi `loadForUse()` a zápisom → `TypeError` namiesto `ApiKeyError('unavailable')` |

**Prečo to 614 testov nezachytilo:** vitest kompiluje cez Vite/esbuild, ktorý
guardy zachová. Chyba existuje **výhradne v artefakte, ktorý sa nasadzuje**.
Žiadny test v repe nespúšťa HTTP volanie proti *zbuildovanej* appke.

**Oprava (3 tokeny, sémanticky identická, overená):**
```diff
-      if (!row) return { ...ABSENT_META };
+      if (row === null) return { ...ABSENT_META };
-      if (!row) return null;
+      if (row === null) return null;
-        if (!fresh) {
+        if (fresh === null) {
```
`row === null` analyzátor **nefolduje**. Overené na troch úrovniach:
1. produkčný chunk teraz obsahuje `async getMeta(e){let t=await f(e);if(null===t)return{...c};…}`;
2. `GET /api/key` na `node .next/standalone/server.js` vracia
   `200 {"present":false,"last4":null,…}`;
3. inventúra celého `src/**` po oprave: **žiadny** ďalší náš guard nie je
   zahodený (scan dev chunkov na marker `TURBOPACK compile-time falsy` mimo
   `node_modules`: ostali len legitímne foldy — `NEXT_RUNTIME` v
   `src/instrumentation.ts`, interné Next.js runtime chunky a `detectRoot()`
   z knižnice `ulid`).

**Trvalé odporúčanie (nie je súčasťou opravy):** pridať test, ktorý ide HTTP-om
proti **zbuildovanej** appke (aspoň `GET /api/health` + `GET /api/key` bez
uloženého kľúča). Bez neho môže rovnaká trieda chyby prejsť znova pri
akomkoľvek upgrade Next.js (D100).

---

## B. INVARIANTY I1–I14 — ako sú vynútené a čím overené

Legenda: ✅ = overené v tomto behu · ⚠️ = overené len staticky/testom, nie na
živom Docker stacku.

### I1 — API kľúč nikdy v repe, logoch, audite ani v UI ✅

**Vynútené:** centrálny `redact()` (`src/lib/log/redact.ts`) — maskovanie
hlavičiek + denylist polí do ľubovoľnej hĺbky + substring scan na aktuálny kľúč
a jeho posledné 8 znakov; `appendAudit()` je jediná cesta do `audit_log`
a redaktorom prechádza vždy, bez vypínateľného flagu; plaintext existuje len
ako `Buffer` v `SecretRef` a po `release()` je `fill(0)`; `GET /api/key` vracia
výhradne `last4` + časy + `verifyStatus`; chybové odpovede nikdy neobsahujú
stacktrace (`src/lib/http/define-route.ts`, `failWith` loguje len `errorName`).

**Čím overené:**

1. **Grep na tajomstvá v repe** (zadaný príkaz):
   ```
   $ git grep -nE 'sk_live_|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN'
   .github/workflows/ci.yml:147:  … git grep -nIE 'sk_live_[A-Za-z0-9]|AKIA…'
   .gitleaks.toml:23:            regex = '''['"](sk_live_|sk_test_|AKIA|…'''
   test/mock-shop/fixtures.ts:8:  * (`sk_live_…`, `AKIA…`, `ghp_…`). Preto majú všetky kľúče tvar
   ```
   **Tri zásahy, všetky sú samotné detekčné pravidlá a komentár** — žiadne
   tajomstvo. Trackované tajomstvo v repe = 0.
2. **Blokujúci test na redakciu EXISTUJE a je blokujúci** (explicitne
   požadované):
   - `test/unit/redact.spec.ts` — **27 testov** (hlavičky, denylist do hĺbky,
     polia, substring scan, `redaction_hit`);
   - `test/integration/redaction.spec.ts` — *„celý write flow neprepustí kľúč
     mimo hlavičky na shop"*, dokazuje po celom zápisovom flow, že kľúč nie je
     v `audit_log`, `campaign_items` ani v zachytenom stdout logu;
   - `test/integration/health.spec.ts` → `describe('/api/health — I1: nič
     citlivé v odpovedi')`, 8 testov.
   Všetky sú v default `include: ['test/**/*.spec.ts']` vitest configu
   (`exclude` obsahuje len `test/e2e/**`, `node_modules`, `.next`), teda
   **bežia v `npm run test` a ich zlyhanie zhodí CI job** — nie sú za žiadnym
   flagom ani `skipIf`.
3. **Živý dôkaz na produkčnom builde** — `/api/health` bez auth:
   ```
   {"ok":true,"data":{"status":"ok","db":true,"key":"***REDACTED***",
    "scheduler":{…},"writesEnabled":false,"writesLocked":false,"version":"0.1.0"}}
   ```
   Celé pole `key` je redigované; grep odpovede na `last4|apiKey|api_key|token|
   password|secret|authorization` → **0 zásahov**.
4. **Žiadna reálna doména shopu ani kľúč v repe:** `.env.example` obsahuje len
   cesty na `/run/secrets/*`, žiadnu hodnotu; jediné domény v zdrojoch a testoch
   sú `*.example`, `shop.example.sk` (placeholder v UI) a `shop.e2e.invalid`
   (RFC 2606 — neexistujúci host).
5. ⚠️ `gitleaks detect` sa nespustil (binárka chýba). CI ho má ako blokujúci
   krok. **Samuel to musí spustiť raz lokálne** — príkaz v §E.10.

### I2 — Max 10 produktov, fail-closed ✅ (vrátane DB-level)

**Vynútené na 3 nezávislých úrovniach:**
1. **ENV schéma** — `MAX_PRODUCTS_PER_OPERATION: intFromString({min:1, max:10})`,
   `ALLOWLIST_MAX: … max:10` (`src/env.ts:93-94`). Vyššiu hodnotu sa nedá
   nakonfigurovať.
2. **Guardy pred volaním shopu** — `src/lib/engine/guards.ts`, `describe('allowlist
   (I2, fail-closed)')` v `test/unit/guards.spec.ts` (18 testov v súbore).
3. **DB constraint — posledná poistka** (`db/migrations/0003_allowlist_catalog.sql`).

**DB-level overený naživo** (zadaná požiadavka), `SHOW CREATE TABLE
products_allowlist` na migrovanej schéme:
```sql
UNIQUE KEY `uq_allowlist_slot` (`slot`),
UNIQUE KEY `uq_allowlist_active` (`product_id`,`removed_at`),
CONSTRAINT `ck_allowlist_slot`        CHECK (`slot` is null or `slot` between 1 and 10),
CONSTRAINT `ck_allowlist_slot_active` CHECK (`removed_at` is null = (`slot` is not null))
```
Potom **priamy pokus obísť aplikačnú validáciu** aplikačným DB userom (10 slotov
obsadených, vkladám 11.):
```
INSERT … VALUES (911, 11);   → ERROR 4025: CONSTRAINT `ck_allowlist_slot` failed
INSERT … VALUES (911, NULL); → ERROR 4025: CONSTRAINT `ck_allowlist_slot_active` failed
INSERT … VALUES (911, 5);    → ERROR 1062: Duplicate entry '5' for key 'uq_allowlist_slot'
SELECT COUNT(*) WHERE removed_at IS NULL → 10
```
**Všetky tri cesty na 11. aktívny záznam sú zavreté na úrovni DB.** Ďalej:
`test/integration/allowlist-cap.spec.ts` (12 testov), `test/unit/env.spec.ts`
(`describe('I2 — stropy 10 produktov sa nedajú zvýšiť konfiguráciou')`).

### I3 — Žiadny zápis bez potvrdenia ✅

**Vynútené:** jednorazový podpísaný `previewToken` (HS256, TTL 15 min, SHA-256
hash kanonickej sady parametrov + `price_at_preview` per produkt) + platné sudo
okno + `confirmed_at`/`confirm_payload_hash` v DB; stavový stroj
(`src/lib/domain/status.ts`) hodí výnimku pri prechode do `running` bez
potvrdenia; `defineRoute({auth:'sudo'})` je fail-closed.

**Čím overené:**
- `test/integration/no-write-without-confirm.spec.ts` — **11 testov**, každý
  overuje aj to, že **na mock neprišiel ani jeden request**: chýbajúci token,
  nezmyselný token, expirovaný token, token podpísaný **cudzím** secretom, už
  použitý token (409 `preview_token_used` — jednorazovosť), bez sudo okna
  (401 `sudo_required`), a `execute`/`retry-failed`/`extend` s tokenom pre
  **inú** sadu (iné produkty / iné percento / iné `to`).
- `test/unit/status.spec.ts` — zakázané prechody 1 : 1 podľa BUILD-SPEC §4.
- **Živý dôkaz** na produkčnom builde:
  ```
  POST /api/campaigns  (bez previewTokenu)
  → {"ok":false,"error":{"code":"validation_failed","detail":{"fields":[
     {"path":"previewToken","code":"invalid_type"},{"path":"name",…},
     {"path":"acknowledgements",…}]}}}
  ```
  Token, meno kampane aj potvrdenia sú **povinné polia zod schémy**, takže sa
  k handleru vôbec nedostane.

### I4 — Audit je append-only ✅ (vrátane DB grantov)

**Vynútené:** `db/migrations/0008_grants.sql:35`
```sql
GRANT SELECT, INSERT ON `{{DB_NAME}}`.audit_log TO '{{APP_USER}}'@'%';  -- I4
```
(všetky ostatné tabuľky majú `SELECT, INSERT, UPDATE, DELETE`, `_migrations` len
`SELECT`).

**Čím overené:**
- **Živý test grantov** aplikačným DB userom na migrovanej schéme:
  ```
  UPDATE audit_log SET event_type='x' WHERE id=1;
    → ERROR 1142: UPDATE command denied to user 'ovl_zliav_app'…`audit_log`
  DELETE FROM audit_log WHERE id=1;
    → ERROR 1142: DELETE command denied to user 'ovl_zliav_app'…`audit_log`
  SELECT COUNT(*) FROM audit_log;  → OK
  ```
- `grep -niE "update|delete" src/lib/repo/audit.repo.ts` → **prázdne**.
- `test/integration/audit-append-only.spec.ts` — 14 testov, vrátane
  `describe('I4 — v kóde neexistuje mutácia auditu')`.

### I5 — Bind len na 127.0.0.1 ✅

**Vynútené:** `docker-compose.yml` — jediné `ports:` je
`"127.0.0.1:3070:3070"` na `ovl-zliav-caddy`; `ovl-zliav-app` aj `ovl-zliav-db`
majú namiesto portov komentár „ŽIADNE ports: (I5, D96)"; boot assertion na
`PUBLIC_BIND`; CI kontrola.

**Čím overené:**
- `npm run check-compose-bind` → *„OK — jediný publikovaný port je
  127.0.0.1:3070:3070 na ovl-zliav-caddy (I5)"*; v CI ako samostatný krok.
- `test/unit/compose-bind.spec.ts` (v 614 zelených).
- `test/unit/env.spec.ts` → `describe('I5 — PUBLIC_BIND musí byť presne 127.0.0.1')`.
- **Živý fail-fast na zbuildovanom artefakte** (viď aj I14):
  ```
  $ PUBLIC_BIND=0.0.0.0 node .next/standalone/server.js
  {"level":"error","msg":"boot_assertions_failed","count":1,"problems":
   ["[§11.1] PUBLIC_BIND: PUBLIC_BIND musí byť presne \"127.0.0.1\" (I5, D78)"]}
  exit=1
  ```
- ⚠️ **Neoverené:** `curl http://127.0.0.1:3000` z hosta musí zlyhať pri
  bežiacom stacku — vyžaduje Docker (§C.2, §E.9).

### I6 — Testy len proti mocku ✅

**Vynútené:** `test/setup.ts` obaľuje globálny `fetch` guardom; povolené hosty sú
výhradne `['127.0.0.1','localhost','::1','[::1]']`; mock shop beží na
ephemeral porte na `127.0.0.1`; e2e harness používa `SHOP_BASE_URL_OVERRIDE` na
mock a doménu `https://shop.e2e.invalid` (RFC 2606); `src/env.ts` **zakazuje**
`SHOP_BASE_URL_OVERRIDE` v produkcii.

**Čím overené:** `test/setup.spec.ts` → `describe('I6 — fetch guard')`:
„povolí lokálne hosty", **„odmietne reálnu doménu shopu"**
(`isAllowedTestUrl('https://sperky-eshop.sk/api/products') === false`),
„fetch na nepovolený host hodí výnimku a zaznamená porušenie".
`setupFiles: ['./test/setup.ts']` platí pre **všetky** vitest súbory, takže guard
sa nedá obísť. V CI aj v e2e je adresa shopu vždy `127.0.0.1`.

### I7 — Žiadne rušenie zľavy ✅ (overené grepom, ako zadané)

```
$ git grep -niE 'clearReduction|cancelReduction|removeReduction|resetReduction|deleteReduction' -- src/
(žiadny výstup)
```
Ani jedna funkcia rušiaca zľavu v shope neexistuje. `to` v minulosti je
odmietnuté **lokálne pred odoslaním**: `src/lib/shop/client.ts:267`
`if (params.to < today) return fail('local_to_in_past');`, plus guard
`src/lib/engine/guards.ts:60 toInPast: 'to_in_past'`.

`test/unit/no-clear-reduction.spec.ts` to overuje **dvoma nezávislými
spôsobmi**: (1) grep skutočných zdrojov `src/**` s **odstránenými komentármi**
(komentár smie invariant vysvetľovať, kód ho smie len dodržať), (2)
behaviorálne — reálny `checkWriteWindow()` odmietne `to` v minulosti bez toho,
aby sa čokoľvek poslalo na shop. V UI je e2e scenár
*„I7: v UI neexistuje akcia, ktorá by zľavu v shope rušila"* (zlyháva
z dôvodu §D.2, nie kvôli I7).

### I8 — Len scope `product:edit` ✅ (overené grepom, ako zadané)

```
$ git grep -nE '/api/order|orders:read|order:read' -- src/ scripts/ db/
src/contracts.ts:360: * alebo posiela `to` v minulosti (I7), ani nič pod `/api/order` (I8).
```
**Jediný zásah je komentár v `contracts.ts`**, ktorý invariant popisuje.
Žiadne volanie `/api/order`, žiadny `orders:read`, žiadna tabuľka ani stĺpec
so zákazníckymi dátami. `test/unit/no-orders-scope.spec.ts` grepuje zdroje
`src/**` **aj DB schému** `db/migrations/**` s odstránenými komentármi.

### I9 — Lokálna validácia pred API ✅

**Vynútené:** `src/lib/domain/percent.ts` (celé číslo 1–30),
`src/lib/domain/campaign-rules.ts` (`to ≥ from`, `from ≥ dnes`, okno ≤ 3 mesiace
kalendárne), `src/lib/domain/dates.ts` (Europe/Bratislava, DST, „+3 mesiace"
kalendárne); UI validuje pred odoslaním (`PercentInput`, `DateRangePicker`);
shop klient odmieta lokálne (`local_invalid_reduction`, `local_to_in_past` —
vidno ich v logoch z testov).

**Čím overené:** `test/unit/percent.spec.ts`, `test/unit/dates.spec.ts`,
`test/unit/campaign-rules.spec.ts` (všetky v 614 zelených) + `guards.spec.ts`.

### I10 — Sekvenčný determinizmus zápisu ✅

**Vynútené:** `src/lib/engine/executor.ts` — jediné miesto, ktoré volá
`setReduction`; pauza `SHOP_WRITE_PAUSE_MS` (default 250 ms) medzi zápismi,
nie po poslednom (riadok 687), komentár na riadku 402 *„Sekvenčná dávka (I10,
D46). ŽIADNY Promise.all."*

```
$ git grep -n "Promise.all\|Promise.allSettled" -- src/lib/engine/ src/lib/scheduler/
src/lib/engine/executor.ts:14: *  ani jeden `Promise.all` nad zápismi neexistuje a existovať nesmie.
src/lib/engine/executor.ts:402: /* 6. Sekvenčná dávka (I10, D46). ŽIADNY Promise.all. */
```
**Dva zásahy, oba komentáre.** Žiadny `Promise.all` v engine ani scheduleri.

**Čím overené:** `test/integration/sequential-writes.spec.ts` →
`describe('I10 — sekvenčné zápisy s pauzou 250 ms')` — meria sa cez
`recordedRequests[]` timestampy mocku, nie cez mock vlastnej implementácie.

### I11 — Nikdy netvrdiť, že poznáme stav zľavy v shope ✅

**Vynútené:** `src/components/ui/SelfWriteBadge.tsx` — badge *„podľa vlastného
zápisu z DD.MM. — shop môže mať iný stav"*; použitý v `AllowlistGrid`,
`Dashboard`, `page.tsx`; `globals.css:130` má preň vlastný outline+kurzíva štýl,
aby bol vizuálne odlíšený od tvrdenia o stave.
`GET /api/allowlist` vracia „posledný VLASTNÝ zápis", nie stav shopu
(komentár v `src/app/api/allowlist/route.ts`).
**Čím overené:** grep výskytov + build stránok prejde (všetky HTML stránky
vracajú 200 na živom produkčnom builde). E2e vizuálne overenie zlyháva z §D.2.

### I12 — Globálny mutex a runaway strop ✅

**Vynútené:** `src/lib/engine/mutex.ts` — in-process semafor **plus** DB poistka
`SELECT GET_LOCK('ovl_zliav_write', 0)` (`WRITE_LOCK_NAME` v `src/version.ts`);
runaway strop 60/h sa počíta **dotazom nad `audit_log`** (append-only, teda
neobíditeľné — O3) a pri prekročení zamkne zápisy fail-closed.

**Čím overené:** `test/integration/runaway-lock.spec.ts` (4 testy,
`describe('D79 — runaway strop 60/h')`), `test/unit/guards.spec.ts` →
`describe('runaway strop 60/h (D79, I12)')`, `describe('writes_locked (D79)')`;
`test/integration/repo.spec.ts` — dva paralelné `claim()` na tú istú kampaň
uspejú **presne raz**.

### I13 — Dve env poistky pre ostrý zápis ✅

**Vynútené:** `src/env.ts` → `writesAllowedByEnv(e) = e.NODE_ENV === 'production'
&& e.WRITES_ENABLED === true`; `src/lib/engine/guards.ts` to vyhodnocuje ako
**prvý** guard (riadok 7: *„1. env poistky"*, riadky 84-85, hláška na 138:
*„Ostrý zápis je vypnutý — vyžaduje NODE_ENV=production a WRITES_ENABLED=true
(I13). Prebehol by len dry-run."*). `WRITES_ENABLED` má default **`false`**.

**Čím overené:** `test/unit/guards.spec.ts` →
`describe('checkWritesEnabled (I13, D77)')`; `test/unit/env.spec.ts`.
**Živý dôkaz:** `/api/health` na produkčnom builde bez `WRITES_ENABLED` hlási
`"writesEnabled":false`. Poistka nie je obíditeľná testovacím flagom —
`executorFlagsFromEnv` číta výhradne ENV, testy si podávajú `executorFlags`
ako **injektovanú závislosť route/executora**, nie ako produkčný prepínač.

### I14 — Fail-fast pri boote ✅

**Vynútené:** `src/instrumentation.ts` → `src/instrumentation-node.ts` (boot
assertions §11, poradie normatívne), `scripts/entrypoint.sh` (migrácie
migračným userom, pri nenulovom exite appka nenabehne), `EnvError` vypíše
**všetky** chyby naraz (D93).

**Čím overené — naživo na zbuildovanom `.next/standalone/server.js`:**
```
A) PUBLIC_BIND=0.0.0.0
   {"level":"error","msg":"boot_assertions_failed","count":1,
    "problems":["[§11.1] PUBLIC_BIND: PUBLIC_BIND musí byť presne \"127.0.0.1\" (I5, D78)"]}
   exit=1                                    ← proces skončil, appka nebeží
B) MASTER_KEY_FILE=/nonexistent/master.key
   {"level":"error","msg":"boot_assertions_failed","count":1,
    "problems":["[§11.5] Master key sa nedá prečítať: /nonexistent/master.key (D61, I14)."]}
   exit=1
```
Pri korektnej konfigurácii: `boot_start` → `boot_ok` → `/api/health` 200.
Ďalej `test/integration/boot-assertions.spec.ts` — 15 testov v 3 skupinách
(konfigurácia I2/I5/I6/I14, master key D61/I1/I14, migrácie D88/I14).

**Súhrn:** 14/14 invariantov má doložený dôkaz. I5 má jednu časť
(nedosiahnuteľnosť portu 3000 z hosta) overiteľnú len na živom Docker stacku.

---

## C. DOCKER

### C.1 `docker compose config` ✅ PREŠLO

Prvý pokus zlyhal:
```
env file /home/user/ovl-da-zliav/.env not found
```
`.env` je (správne) gitignorovaný a v repe nie je — `docker-compose.yml` má
`env_file: [./.env]`. Compose vyžaduje jeho existenciu už pri validácii.
**Bez oslabenia bezpečnosti** som ho neviedol do repa; validácia prebehla
s prázdnym `.env` v scratchpade a `--project-directory`:
```sh
docker compose -f docker-compose.yml --project-directory <scratchpad> config
→ exit 0, validná konfigurácia
```
Overené v jej výstupe: `read_only: true`, `cap_drop: [ALL]`,
`security_opt: [no-new-privileges:true]`, `user: 10050:10050`,
`stop_grace_period: 30s`, `tmpfs: [/tmp, /app/.next/cache]`,
`logging: json-file max-size 10m / max-file 5`, service names `ovl-zliav-app`,
`ovl-zliav-db`, `ovl-zliav-caddy` (nie `app`/`db`/`caddy` — pasca R10),
jediné `ports:` = `127.0.0.1:3070:3070` na Caddy.

`npm run check-compose-bind` (≡ `scripts/check-compose-bind.ts`) → **OK**.

### C.2 `docker compose build` / `up -d` ❌ NESPUSTITEĽNÉ v tomto prostredí

```
$ docker compose build ovl-zliav-app
failed to connect to the docker API at unix:///var/run/docker.sock;
check if the path is correct and if the daemon is running:
dial unix /var/run/docker.sock: connect: no such file or directory
```
Docker **CLI** je (29.3.1), **daemon nie**. Nešlo teda postaviť image ani
spustiť stack.

**Nerobil som žiadnu obchádzku, ktorá by oslabila bezpečnosť** — konkrétne som
NEvytvoril `.env` v repe, NEvygeneroval master key do repa, NEspustil nič
s `WRITES_ENABLED=true`, NEspustil appku bez boot assertions a NEotvoril žiadny
port mimo `127.0.0.1`.

**Čo som namiesto toho urobil, aby to nebolo len „nespustené":** spustil som
**skutočný produkčný artefakt** `node .next/standalone/server.js` s
`NODE_ENV=production`, s DB heslami zo súborov (`DB_PASSWORD_FILE`, D89), s
master key a session key zo súborov, proti reálnej MariaDB, na `127.0.0.1`.
Toto pokrýva všetko okrem samotného Dockeru a Caddy:

| Overené na produkčnom standalone builde | Výsledok |
| --- | --- |
| boot assertions + fail-fast | ✅ `boot_start` → `boot_ok`; a `exit=1` pri zlom `PUBLIC_BIND` / chýbajúcom master key |
| `GET /api/health` (bez auth, pre docker healthcheck) | ✅ **200**, `{"status":"ok","db":true,"key":"***REDACTED***",…}` |
| všetky API route-y + všetky HTML stránky | ✅ 200 (po oprave §A.3 už aj `/api/key`) |
| login → session cookie (`httpOnly`, `Secure`, `SameSite=Strict`) | ✅ |
| CSRF: mutácia bez `Origin` | ✅ `403 origin_missing` |
| I3: `POST /api/campaigns` bez `previewToken` | ✅ odmietnuté zod schémou |
| migrácie + granty + CHECK constrainty | ✅ (viď I2, I4) |

**Čo MUSÍ Samuel spustiť u seba** (nedá sa to nahradiť):
```sh
docker compose config                        # už validované, ale nech si potvrdí
docker compose build ovl-zliav-app           # NIKDY neoverené — pozor na §D.1
docker compose up -d
docker compose ps                            # všetky healthy
curl -k https://localhost:3070/api/health    # 200 + {"status":"ok"}  (po basic auth)
curl http://127.0.0.1:3000                   # MUSÍ zlyhať (I5)
docker compose logs ovl-zliav-app | head -30 # boot_ok, žiadne boot_assertions_failed
docker inspect ovl-zliav-app | grep -i -E 'master|password|api.?key'   # nesmie nič vypísať (I1)
```

---

## D. ODLOŽENÉ A NEDOKONČENÉ

Priamo, bez obalu.

### D.1 Docker image sa NIKDY nepostavil — ani raz, ani v A14 ⚠️ RIZIKO

`Dockerfile` je napísaný a `docker compose config` je validný, ale
`docker build` neprebehol v žiadnej vlne (A14 ho nemohol spustiť, A19 tiež nie).
**Neoverené predpoklady, ktoré môžu padnúť pri prvom builde u Samuela:**
- `npm ci` v `deps` stage potrebuje sieť a **kompiláciu native modulu `argon2`**
  na `node:22-alpine` (musl). Ak chýbajú build tooly, `npm ci` padne. Ak sa to
  stane, treba do `deps` stage pridať `RUN apk add --no-cache python3 make g++`
  (alebo prejsť na `node:22-bookworm-slim`). **Toto je najpravdepodobnejšie
  miesto zlyhania prvého buildu.**
- `COPY --from=build /app/public ./public` — priečinok `public/` **v repe
  neexistuje**; `COPY` neexistujúceho zdroja je v Dockeri chyba. Buď ho treba
  vytvoriť (`mkdir -p public && touch public/.gitkeep`), alebo ten `COPY`
  vypustiť. **Neopravoval som to** (`Dockerfile` vlastní A14, a nešlo to overiť
  bez daemona), ale je to takmer isté zlyhanie.
- `scripts/*.ts` sa v runneri spúšťajú Node type-strippingom bez devDependencies
  — u `migrate.ts` to je pokryté explicitným `COPY node_modules/mariadb`, ale
  `seed-admin.ts` importuje **`argon2`**, ktorý sa do runnera nekopíruje.
  `npm run seed-admin` v kontejneri (runbook R1 krok 8) tak pravdepodobne padne
  na `ERR_MODULE_NOT_FOUND: argon2`. Rovnaká trieda problému.

### D.2 Playwright e2e: 4 z 20 prešli ❌

Dva samostatné dôvody:

**(a) Chýbajúci browser (prostredie, nie kód).** `@playwright/test@1.62`
požaduje Chromium rev. **1234**, prostredie má predinštalovaný rev. **1194**,
a download je zablokovaný proxy:
```
Error: Download failed: server returned code 403 body 'request rejected: host not permitted'
URL: https://cdn.playwright.dev/builds/cft/151.0.7922.34/linux64/chrome-linux64.zip
```
Obišiel som to override configom v scratchpade (`launchOptions.executablePath:
'/opt/pw-browsers/chromium'`) — **`playwright.config.ts` v repe som nemenil**
(vlastní A18). Po tom už browser štartuje a testy naozaj bežia.

**(b) Skutočná príčina 16 zlyhaní: helper `api()` neposiela session cookie.**
13 zo 16 zlyhaní má identickú chybu, z `test/e2e/fixtures.ts:361`
(`storeApiKey`), ostatné 3 sú následné `toBeVisible` pády toho istého pôvodu:
```
Error: {"ok":false,"error":{"code":"unauthorized",
        "message":"Chýba session cookie — prihlás sa (D69).","detail":{"reason":"missing"}}}
Received: 401
```
Izoloval som to vlastným probe testom po úspešnom UI logine:
```
COOKIES  [{"name":"ovl_zliav_session","domain":"127.0.0.1","httpOnly":true,
           "secure":true,"sameSite":"Strict",…}]
fetch() z prehliadača      /api/settings -> 200
page.request.fetch()       /api/settings -> 401
```
**Mechanizmus:** session cookie je (správne, D69) `Secure`. Harness servuje
appku na **plain HTTP** `http://127.0.0.1:3131`. Chromium považuje `127.0.0.1`
za trustworthy origin, takže cookie posiela — preto všetky requesty z prehliadača
fungujú. Playwright `APIRequestContext` (`page.request`) atribút `Secure`
vynucuje striktne a cez `http://` cookie **neposiela**. Helper `api()`
v `fixtures.ts` používa práve `page.request.fetch`, takže každý API krok
scenárov je neautentizovaný.

**Toto NIE JE chyba aplikácie.** Tá istá sekvencia cez `curl` proti produkčnému
buildu funguje (`PUT /api/key` → 200, `GET /api/key` → 200). Je to chyba
testovacieho harnessu A18 a treba ju opraviť jednou z troch cestí:
1. helper `api()` prepísať na `page.evaluate(fetch)` (cookie rieši prehliadač), **alebo**
2. `api()` nech si cookie pripojí ručne z `page.context().cookies()` do hlavičky
   `Cookie`, **alebo**
3. harness servovať cez HTTPS (najbližšie produkcii za Caddy).

**Ktoré 4 testy prešli:** `audit.spec.ts:92` (I4 — audit sa z UI nedá upraviť),
`audit.spec.ts:109` (dátumový filter), `onboarding.spec.ts:21` (4 kroky
v pevnom poradí), `onboarding.spec.ts:53` (kľúč → allowlist → dry-run).
Beh je mierne flaky — množina prechádzajúcich testov sa medzi behmi menila.

**Dôsledok:** akceptačné kritérium A19 č. 3 (`npx playwright test` zelené) **nie
je splnené** a body akceptačného kritéria č. 6 (manuálny prechod: onboarding →
dry-run → zápis → čiastočné zlyhanie → retry → audit s nezhodou cien →
expirácia kľúča → read-only → nový kľúč → dopálenie `needs_key` → `missed`
zostane `missed`) **nie sú overené end-to-end cez UI**. Ich serverová
polovica je pokrytá integračnými testami (`deviation-33`, `deviation-39`,
`ttl-wipe`, `routes-*`, `no-write-without-confirm`, `reconcile`, `scheduler`) —
tie sú zelené. Neoverená je teda **UI vrstva týchto scenárov**.

### D.3 Ručný scenár z akceptačného kritéria č. 6 — prešiel len čiastočne ⚠️

Prešlo naživo (HTTP proti produkčnému buildu, viď §C.2 tabuľka): boot, health,
login, session cookie, CSRF, odmietnutie zápisu bez `previewToken`, uloženie
kľúča (`PUT /api/key` → 200), načítanie metadát kľúča.
Neprešlo klikaním v UI: celý ostatný tok (§D.2).

### D.4 `gitleaks detect` nespustený ⚠️

Binárka nie je v prostredí a nedá sa dotiahnuť (proxy). Nahradené ručným
grepom (§B, I1) — bez nálezu. **Samuel to musí spustiť raz** (§E.10).

### D.5 `PUT /api/key` uloží kľúč aj keď sonda neprebehne — pozorovanie, nie chyba

Pri live teste proti domene `https://shop.e2e.invalid` (neexistujúci host) sonda
`setReduction reduction=0` skončila sieťovou chybou a route kľúč **aj tak
uložila**, s `verifyStatus: "unverified"`:
```
PUT /api/key → 200 {"last4":"aaaa","expiresAt":"…","verifyStatus":"unverified"}
```
Je to obhájiteľné (neúspešná sonda ≠ neplatný kľúč; 401/403 zo shopu kľúč
korektne **odmietnu** — pokryté testami `routes-key.spec.ts`), a I1 ani I3 to
neporušuje. Ale akceptačné kritérium A11 znie *„overí kľúč sondou"*, takže to
tu je explicitne napísané: **kľúč sa dá uložiť neoverený a UI musí tento stav
odlíšiť** (`KeyTtlBadge`/`ApiKeyForm` majú `verifyStatus` k dispozícii).
Rozhodnutie ponechávam Samuelovi — kód som nemenil.

### D.6 Integračné testy bežali proti MariaDB 10.11, nie 11.4 ⚠️

`docker-compose.yml` a akceptačné kritérium A0 predpisujú **`mariadb:11.4`**.
V tomto prostredí je dostupná len 10.11.14. Všetko podstatné (CHECK constrainty,
`RANDOM_BYTES()`, `GET_LOCK`, granty, `datetime(3)`) na 10.11 funguje, takže
614 testov je zelených, ale **schéma nebola nikdy overená na 11.4**.
`.github/workflows/ci.yml` používa service container — Samuel si má overiť, že
je v ňom naozaj `mariadb:11.4`.

### D.7 Chýbajúca observabilita 500-tiek — prispelo k tomu, že §A.3 prežila 4 vlny

`defineRoute()` do logu **zámerne** nedáva ani `message`, ani stacktrace
(komentár: *„Message chyby do logu nedávame — mohla by nesť vstup (I1)"*),
takže z produkčného 500 sa dá vyčítať iba `"errorName":"TypeError"`.
Diagnostika chyby §A.3 preto vyžadovala dočasnú inštrumentáciu `toAppError()`
(už vrátenú). To je pre I1 správne rozhodnutie, ale prevádzkovo je to slepé.
**Návrh (neimplementoval som):** logovať `error.stack` **prehnaný cez
`redact()`** — redaktor už existuje a presne na toto je stavaný.

### D.8 Verzia `APP_VERSION` je duplikovaná na dvoch miestach

`package.json` `"version": "0.1.0"` a `src/version.ts` `APP_VERSION = '0.1.0'`
s komentárom *„musí sa rovnať `version` v `package.json`"* — synchronizované
ručne, bez testu. Pri bumpe verzie je to tichá pasca (dostane sa do
`User-Agent`, ktorý shop vidí, D58).

### D.9 Čo NIE JE odložené (aby bolo jasné)

Hotové a overené: všetky moduly A0–A18 existujú, 614 testov zelených, 14/14
invariantov doložených, runbooky R1–R7 napísané (`docs/21-RUNBOOKY.md`),
backlog na maintainera shopu (`docs/20-BACKLOG-SHOP-API.md`), CI pipeline
so všetkými blokujúcimi krokmi vrátane `check-compose-bind`, `gitleaks`
a `npm audit --audit-level=high`, zálohovanie s `--ignore-table=…api_key` (D76).

---

## E. ČO MUSÍ SAMUEL UROBIŤ PRED PRVÝM OSTRÝM ZÁPISOM

Postup je poradie, nie zoznam želaní. **Až do kroku 12 zostáva
`WRITES_ENABLED=false`** — appka vtedy fyzicky nemôže zapísať do shopu (I13).

### 0. Najprv opraviť to, čo A19 nesmel opraviť (5 minút)

```sh
# (a) public/ musí existovať, inak padne COPY v Dockerfile (§D.1)
mkdir -p public && touch public/.gitkeep

# (b) argon2 do runner stage — inak `npm run seed-admin` v kontejneri padne (§D.1)
#     do Dockerfile, k existujúcemu COPY node_modules/mariadb, pridaj:
#     COPY --from=deps --chown=10050:10050 /app/node_modules/argon2 ./node_modules/argon2
```
Ak `docker compose build` padne na `npm ci` pri kompilácii `argon2`, pridaj do
`deps` stage `RUN apk add --no-cache python3 make g++`.

### 1. Priečinky a práva

```sh
cd /cesta/k/ovl-da-zliav
mkdir -p secrets backups
chmod 700 secrets backups
```

### 2. Master key (D61, I14)

```sh
npm ci
npm run gen-master-key                 # → secrets/master.key, 32 B hex, chmod 400
```
Overenie: `ls -l secrets/master.key` musí byť `-r--------` a **64 hex znakov**.
Kľúč **nikam neopisuj** — pri jeho strate sa uložený API kľúč nedá dešifrovať
(a to je v poriadku, zadáš nový).

### 3. Session key + DB heslá (D69, D89)

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" > secrets/session.key
chmod 400 secrets/master.key secrets/session.key
sudo chown 10050:10050 secrets/master.key secrets/session.key   # uid appky v kontejneri

for f in db_root_password db_app_password db_mig_password; do
  node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))" > "secrets/$f"
  chmod 600 "secrets/$f"
done
```

### 4. `.env`

```sh
cp .env.example .env
```
Skontroluj a **nechaj tak**: `WRITES_ENABLED=false`, `PUBLIC_BIND=127.0.0.1`,
`NODE_ENV=production`, `DB_HOST=ovl-zliav-db`, `API_KEY_TTL_HOURS=48`,
`MAX_PRODUCTS_PER_OPERATION=10`, `ALLOWLIST_MAX=10`.
**Doména shopu do `.env` NEPATRÍ** — zadáva sa v UI (D80).
**API kľúč do `.env` NEPATRÍ** (I1). `SHOP_BASE_URL_OVERRIDE` nesmie byť
nastavený — zod ho v produkcii odmietne (I6).

### 5. Caddy + bcrypt hash pre basic auth (D94, D97)

```sh
cp Caddyfile.example secrets/Caddyfile
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'TVOJE-BASICAUTH-HESLO' \
  > secrets/basicauth.hash
chmod 600 secrets/Caddyfile secrets/basicauth.hash
```
Hash vlož do `secrets/Caddyfile` (ten je mimo gitu — v repe smie byť len
`Caddyfile.example` **bez** hashu). Overenie: `git status` nesmie ukázať nič
zo `secrets/`.

### 6. Spustiť stack

```sh
docker compose config                 # musí prejsť
docker compose build ovl-zliav-app    # tu čakaj problémy z kroku 0
docker compose up -d
docker compose ps                     # ovl-zliav-db a ovl-zliav-app = healthy
docker compose logs ovl-zliav-app | head -40
```
V logu musí byť `boot_start` a `boot_ok`. Ak vidíš
`boot_assertions_failed`, appka **správne** nenabehla — prečítaj `problems[]`
a oprav konfiguráciu. To isté pri `migrations`: pri zlyhaní migrácií sa appka
nespustí (D88, I14).

### 7. Overiť bind (I5) a health

```sh
curl -k https://localhost:3070/api/health     # 200, {"status":"ok","db":true,…} (po basic auth)
curl http://127.0.0.1:3000                    # MUSÍ zlyhať — connection refused
docker inspect ovl-zliav-app | grep -iE 'master|password|api.?key'   # nesmie nič vypísať (I1)
```

### 8. Trust root certifikátu Caddy (D94, runbook R2)

```sh
docker compose cp ovl-zliav-caddy:/data/caddy/pki/authorities/local/root.crt .
# Linux:
sudo cp root.crt /usr/local/share/ca-certificates/ovl-zliav-root.crt && sudo update-ca-certificates
# Windows: dvojklik root.crt → Install Certificate → Local Machine
#          → Trusted Root Certification Authorities → Finish, reštart prehliadača
rm root.crt
```

### 9. Seed admina (interaktívne, heslo min 12 znakov)

```sh
docker compose exec ovl-zliav-app \
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /app/scripts/seed-admin.ts
```
Heslo si zapamätaj / daj do password manažéra. Nikam ho neopisuj do repa.
Zvoľ meno používateľa (otvorený bod §F.2). argon2id parametre sú
`m=19456 KiB, t=2, p=1` (§F.1).
*(Ak to padne na `argon2`, si preskočil krok 0b.)*

### 10. Kontrola, že v repe nie je tajomstvo (I1)

```sh
docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.28.0 detect --source=/repo --redact --verbose
git grep -nE 'sk_live_|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|-----BEGIN'
git status --short          # secrets/ ani .env sa NESMÚ objaviť
```

### 11. Nastaviť doménu shopu (D55, D80) a vložiť API kľúč

V UI (`https://localhost:3070`, prihlás sa) prejdi **onboarding**:

1. **Doména** — len `https://`, vyžaduje heslo, pred uložením prebehne
   **canary GET**. Bez úspešného canary sa doména neuloží (D55).
2. **API kľúč** — vlož ho **výhradne tu, v UI**. Nikdy do `.env`, nikdy do
   `docker-compose.yml`, nikdy do commitu (I1). Kľúč musí mať scope
   **`product:edit`** a **nič viac** (I8). Appka ho overí sondou
   `setReduction reduction=0` (nikdy nič nezapíše, D53) a uloží zašifrovaný
   s **TTL 48 h** (R2). Po expirácii ho vložíš znova — to je zámer, nie chyba.
   Skontroluj, že `verifyStatus` je `valid`, nie `unverified` (§D.5).
3. **Allowlist — 10 product ID.** Zadáš ich v UI (v repe žiadne nie sú, §F.3).
   Jedenásty produkt appka odmietne na troch úrovniach (I2). Product ID si
   pred zadaním over v shope — appka ich nevie uhádnuť a `not_found` zablokuje
   len daný produkt.
4. **Testovací dry-run.** Onboarding **končí dry-runom, nie zápisom** (D20).
   V dry-run tabuľke skontroluj názvy produktov, ceny a orientačnú zľavnenú
   cenu (je orientačná — shop zaokrúhľuje inak, D4).

### 12. Až teraz zapnúť ostré zápisy (I13)

```sh
# v .env:  WRITES_ENABLED=true
docker compose up -d ovl-zliav-app
curl -k https://localhost:3070/api/health     # "writesEnabled": true
```
Prvý ostrý zápis urob na **jednom** produkte, s malou zľavou a krátkym oknom,
a hneď skontroluj shop ručne. Appka ti nikdy nepovie, aký je skutočný stav
zľavy v shope — vie len, čo sama zapísala (I11). **Zľavu nemožno zrušiť** (I7),
len prepísať inou kampaňou alebo nechať vypršať — preto ten prvý zápis rob
s vedomím, že je nevratný.

### 13. Zálohy (D90)

```sh
crontab -e
15 3 * * * /cesta/k/ovl-da-zliav/scripts/backup.sh >> /var/log/ovl-zliav-backup.log 2>&1
```
Do 7 dní spusti **restore test** (runbook R4) — záloha, ktorú si nikdy
neobnovil, nie je záloha. `backup.sh` vynecháva tabuľku `api_key` (D76), takže
po restore treba kľúč vložiť znova.

### 14. Panic button — vedieť to PREDTÝM, než to bude treba

Ak kľúč unikne: v UI *Nastavenia → Panic button*, heslo + opíš presne
`KLUC UNIKOL`. Appka kľúč wipne, zruší čakajúce kampane a zobrazí runbook.
**Skutočnú revokáciu kľúča robí maintainer shopu — appka to za teba nespraví**
(D67, runbook R5).

---

## F. OTVORENÉ BODY

### Z `docs/12-SPRINT-PLAN.md` §3

| # | Bod | Ako je to teraz vyriešené | Čo treba od Samuela |
| --- | --- | --- | --- |
| **F.1** | Presné argon2id parametre „podľa sperky-ai" (D68) — čísla nie sú v tomto repe | **Použité OWASP odporúčanie: `memoryCost = 19 456 KiB (19 MiB)`, `timeCost = 2`, `parallelism = 1`, typ `argon2id`.** Definované na dvoch miestach a **musia sa rovnať**: `src/lib/auth/password.ts:47-49` (verifikácia + hashovanie v appke) a `scripts/seed-admin.ts:27-29` (seed admina). `MIN_PASSWORD_LENGTH = 12`, bez zložitostných pravidiel (D68). Typ je pevne `argon2.argon2id` a **nedá sa prepnúť**. | Zisti čísla zo sperky-ai. Ak sú iné, zmeň ich **na oboch miestach naraz**. Zmena parametrov **neinvaliduje** existujúce hashe (argon2 si parametre nesie v hashi), takže prechod je bezpečný; nové heslá sa budú hashovať novými parametrami. |
| **F.2** | Meno admin používateľa a prvé heslo | Nikde v repe nie je žiadne meno ani heslo. `scripts/seed-admin.ts` sa spúšťa **interaktívne** pri prvom setupe (§E.9). | Zvoľ meno + heslo (min 12 znakov) pri seede. Do repa sa nedostane nič. |
| **F.3** | Konkrétne product ID prvej desiatky allowlistu | V repe **nie je ani jedno** reálne product ID. Zadávajú sa v UI pri onboardingu; strop 10 drží ENV + guard + DB (I2). | Priprav si 10 ID z shopu a over ich pred zadaním. Odobranie produktu s naplánovanou kampaňou je blokované 409 `campaign_planned` (D40) — najprv zruš kampaň. |
| **F.4** | Verzia pre `User-Agent` (`aura-zlavy/<verzia>`) | `APP_VERSION = '0.1.0'` v `src/version.ts`, `"version": "0.1.0"` v `package.json`, `userAgent()` skladá `aura-zlavy/0.1.0`. V kontejneri sa dá prebiť cez `APP_VERSION` v ENV bez rebuildu. | Potvrď, že shop `aura-zlavy/0.1.0` v `User-Agent` akceptuje. **Pozor na §D.8** — verzia je na dvoch miestach bez testu na ich zhodu; pri bumpe zmeň obe. |

### Z `docs/10-KONTRAKT.md` §J (dorozhodnuté fail-closed smerom)

Všetkých 7 bodov je implementovaných tak, ako §J predpisuje — potvrdené počas
overenia:

| # | Bod | Stav |
| --- | --- | --- |
| **O1** | Kampaň **je** job; jeden `status` s 10 lifecycle hodnotami, UI stavy „aktívna"/„expirovaná" sa **derivujú** | ✅ `CAMPAIGN_STATUSES` + `deriveCampaignView()` v `src/lib/domain/status.ts`; derivát sa neukladá do DB |
| **O2** | Prenos dry-run sady do zápisu podpísaným `preview_token` (JWT, TTL 15 min, hash parametrov + `price_at_preview`) | ✅ `src/lib/crypto/preview-token.ts`; 11 testov v `no-write-without-confirm.spec.ts` (I3) |
| **O3** | Heartbeat + tick metriky v `scheduler_state`, write lock v `settings`, runaway počítadlo **dotazom nad `audit_log`** | ✅ tabuľky existujú a majú granty; runaway je neobíditeľné, lebo `audit_log` je append-only (I4) |
| **O4** | Brute-force lockout v tabuľke `login_attempts`, in-memory zakázané | ✅ `login_attempts` má `SELECT,INSERT,UPDATE,DELETE`; lockout prežije restart (`test/unit/auth.spec.ts`) |
| **O5** | V kontejneri appka počúva na `0.0.0.0` **internej** compose siete, localhost-only garantuje publikovaný mapping Caddy + CI kontrola + startup assertion na `PUBLIC_BIND` | ✅ `HOSTNAME: 0.0.0.0` + `PUBLIC_BIND: 127.0.0.1` v compose; assertion overená naživo (I5, I14). ⚠️ dosiahnuteľnosť z hosta neoverená bez Dockeru |
| **O6** | Notifikačný panel bez ďalšej tabuľky — stĺpec `result_ack_at` na `campaigns` | ✅ `GET /api/notifications` + `POST /api/campaigns/[id]/ack` |
| **O7** | `package.json` vlastní A0, nikto iný ho nesmie meniť | ✅ **A19 ho nemenil.** `npm audit` = 0 zraniteľností |

### Otvorené body, ktoré pridalo toto overenie

| # | Bod | Kam patrí |
| --- | --- | --- |
| **F.5** | Docker image sa nikdy nepostavil; `public/` chýba, `argon2` sa nekopíruje do runnera (§D.1) | **blokuje prvé nasadenie** — krok E.0 |
| **F.6** | E2e helper `api()` neposiela `Secure` cookie cez plain HTTP (§D.2) | A18 — bez toho nie je e2e použiteľné ako regresná sieť |
| **F.7** | Chýba test, ktorý ide HTTP-om proti **zbuildovanej** appke (bez neho môže trieda chyby §A.3 prejsť znova pri upgrade Next.js) | A18/CI — najdôležitejšia trvalá poistka z tohto overenia |
| **F.8** | Stacktrace 500-tiek sa neloguje vôbec (§D.7); návrh: `error.stack` prehnaný cez `redact()` | A5 |
| **F.9** | `PUT /api/key` uloží kľúč aj pri neúspešnej sonde ako `unverified` (§D.5) | A11 — rozhodnutie Samuela |
| **F.10** | Integračné testy nikdy nebežali proti MariaDB **11.4** (§D.6) | CI |
| **F.11** | `APP_VERSION` duplikované bez testu na zhodu s `package.json` (§D.8) | A0 |

---

## G. ZÁVER

**Verdikt: PRIPRAVENÉ S VÝHRADAMI.**

Systém je konzistentný celok: 14/14 invariantov je vynútených a doložených,
statická kontrola aj 614 testov sú zelené, produkčný build sa vyrába
a **skutočný produkčný artefakt naozaj nabehne, obslúži všetky route-y
a korektne sa zabije pri zlej konfigurácii**. Bezpečnostné jadro — kľúč nikde
v repe/logoch/audite, append-only audit vynútený DB grantmi, strop 10 produktov
vynútený až na úrovni DB constraintov, žiadna cesta k zápisu bez jednorazového
potvrdenia, dve nezávislé env poistky, bind len na localhost — drží a je
overené zvonku, nie mockom vlastnej implementácie.

Výhrady sú tri a všetky sú konkrétne:

1. **Docker image sa nikdy nepostavil** a v `Dockerfile` sú dva takmer isté
   dôvody zlyhania prvého buildu (§D.1). Prvý `docker compose build` bude
   pravdepodobne vyžadovať dve malé úpravy — sú popísané v kroku E.0.
2. **E2e testy nie sú funkčná regresná sieť** (§D.2). Príčina je izolovaná
   a je v harnesse, nie v appke, ale kým sa neopraví, UI vrstva kritických
   scenárov nie je automaticky chránená.
3. **Chyba typu §A.3 mohla vzniknúť len preto, že nič netestuje zbuildovanú
   appku.** Je opravená, ale poistka proti jej opakovaniu (F.7) zatiaľ
   neexistuje — a pri každom upgrade Next.js (D100) je to reálne riziko.

Ostrý zápis do produkčného shopu je nevratný (I7) a appka nikdy nepozná
skutočný stav zľavy v shope (I11). Preto: prejdi §E po krokoch, prvý ostrý
zápis urob na jednom produkte a skontroluj ho v shope ručne.

---

*Protokol vypracoval agent A19 (vlna 4). Vlastní výhradne tento súbor;
zmeny v štyroch cudzích súboroch sú vymenované v §A.2 a boli povolené
mandátom A19 (odstránenie zlyhania lintu, buildu a miscompilácie).
Žiadny `git commit` ani `git push` A19 nespustil.*

---

## Dodatok — oprava e2e a smoke test buildu

*Dopísané po protokole, samostatná úloha: odstrániť dva konkrétne nedostatky —
nefunkčné e2e (§D.2, F.6) a chýbajúci test nad zbuildovanou appkou (F.7).
Rozsah zmien: e2e harness + testy, nová smoke suita, CI job, `package.json` len
o jeden skript — a **päť opráv v `src/**`**, pretože po sfunkčnení e2e sa
ukázalo, že štyri zo zlyhaní neboli chyby harnessu, ale skutočné chyby appky.*

### 1. E2e: harness servuje appku cez HTTPS (cesta „a")

**Príčina zlyhaní bola presne tá z §D.2:** session cookie je (správne, D69)
`Secure`, harness servoval `http://127.0.0.1:3131`, a Playwright
`APIRequestContext` (`page.request`) `Secure` cookie cez `http://` neposiela.

**Zvolená cesta: (a) — HTTPS harness.** Dôvody:
- je bližšie produkcii (appka beží za Caddy s TLS), takže e2e testuje ten istý
  režim cookie ako ostrá prevádzka;
- opravuje príčinu na jednom mieste, nie symptóm v každom helperi — `api()`
  zostal na `page.request` a funguje aj `page.evaluate(fetch)`, aj `page.goto`;
- v tomto prostredí sa ukázala ako spoľahlivá (opakované behy bez flake).

Konkrétne:
- `test/e2e/serve.ts` → `ensureTlsCert()` vygeneruje self-signed cert
  (`openssl req -x509 …`, SAN `IP:127.0.0.1`) do gitignorovaného `secrets/`
  (`secrets/e2e-tls.key`, `secrets/e2e-tls.pem`; `.gitignore` má `secrets/`,
  `*.key`, `*.pem`). `next dev` sa spúšťa s `--experimental-https
  --experimental-https-key/--experimental-https-cert`, takže **nesťahuje
  `mkcert` zo siete** (v tomto prostredí by to proxy zamietla).
- `test/e2e/config.ts` → `APP_BASE_URL` je `https://127.0.0.1:3131`.
- `playwright.config.ts` → `use.ignoreHTTPSErrors: true` (len self-signed cert,
  nič iné sa neoslabuje).
- health probe harnessu ide cez `node:https` s `rejectUnauthorized:false`
  **len pre tento jeden request** — `NODE_TLS_REJECT_UNAUTHORIZED` sa nikde
  nenastavuje.
- `playwright.config.ts` navyše rešpektuje `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
  (cesta k už nainštalovanému Chromiu) — obchádzka pre prostredia bez prístupu
  na `cdn.playwright.dev` (§0). Bez tejto premennej sa nič nemení.

**Aplikácia sa neoslabila:** cookie je stále `HttpOnly; Secure; SameSite=Strict`
(overuje to aj nový smoke test, viď §3), CSRF kontrola `Origin` = `Host` platí
naďalej, `SHOP_BASE_URL_OVERRIDE` je v produkcii stále zakázaný.

### 2. Chyby harnessu, ktoré sa objavili až po sfunkčnení cookie

- `test/e2e/fixtures.ts` — `seedCampaign()`/`seedAuditRow()` čítali id cez
  **samostatný** `SELECT LAST_INSERT_ID()` nad **poolom**, takže hodnota mohla
  prísť z iného spojenia (padalo FK `fk_items_campaign`). Nahradené
  `insertId`-om z výsledku INSERT-u (`db.insert()`).
- `test/e2e/onboarding.spec.ts` — `getByRole('alert')` trafilo aj
  `ProductionBar` (má tiež `role="alert"`) → strict mode violation. Zúžené na
  `getByTestId('domain-form').getByRole('alert')`.

### 3. Smoke test nad zbuildovanou appkou (F.7)

Nové súbory: `test/smoke/harness.ts`, `test/smoke/build-smoke.spec.ts`,
`vitest.smoke.config.ts`. Spúšťanie: **`npm run test:build`** (jediná zmena
v `package.json` — nový skript, žiadna nová závislosť).
`vitest.config.ts` má `test/smoke/**` v `exclude`, takže `npm run test`
(614 testov) sa nespomalí. V CI je to samostatný job **`build-smoke`, ktorý beží
na pull requestoch** (`.github/workflows/ci.yml`) s MariaDB 11.4 service
containerom a vlastnou schémou `ovl_zliav_smoke`.

Čo robí: `next build` → `node .next/standalone/server.js` s `NODE_ENV=production`,
DB heslami zo **súborov** (D89), master keyom a session secretom zo súborov
(D61, D69), proti reálnej MariaDB, na `127.0.0.1`, **bez**
`SHOP_BASE_URL_OVERRIDE` a **bez** domény shopu v `settings` (I6 — appka nemá
kam volať), `WRITES_ENABLED=false` (I13). 8 testov:

| # | Overuje |
| --- | --- |
| 1 | build vyrobil `.next/standalone/server.js`, v logu je `boot_ok` a žiadne `boot_assertions_failed` |
| 2 | `GET /api/health` = 200 bez auth; `key` je presne `{present:false, expiresAt:null}`; v celej odpovedi nie je `last4`, `apiKey`, `authorization`, `password`, `secret`, `token`, `master` ani heslo admina (I1); `writesEnabled:false` (I13) |
| 3 | login flow prejde a `Set-Cookie` má `HttpOnly` + `Secure` + `SameSite=Strict` + `Path=/` (D69) |
| 4 | `GET /api/key` bez session = 401 (fail-closed) |
| 5 | **`GET /api/key` s session a BEZ uloženého kľúča = 200, `present:false`, `last4:null`** — presne tá regresia z §A.3, ktorá padala na 500 len v zbuildovanej appke |
| 6 | `POST /api/campaigns` bez `previewToken`/`acknowledgements` = 4xx (I3) |
| 7 | mutácia bez hlavičky `Origin` = 403 `origin_missing` (CSRF, D72) |
| 8 | `PUBLIC_BIND=0.0.0.0` na zbuildovanom artefakte = `boot_assertions_failed` + **exit 1** (I5, I14) |

Poznámka k DB: schému si smoke test vytvorí sám, len ak má `DB_ROOT_PASSWORD`
(tak to je v CI). Lokálne, kde migračný user nemá `CREATE DATABASE`, použije
existujúcu schému (`SMOKE_DB_NAME` / `DB_NAME`, default `ovl_zliav_e2e`) a jej
dáta pred behom vyčistí. `SMOKE_REUSE_BUILD=1` preskočí build — výhradne pomôcka
pri ladení samotného testu, nie default.

### 4. Skutočné chyby aplikácie, ktoré e2e po oprave odhalilo (5 zmien v `src/**`)

Boli to **chyby appky, nie testov** — každá bola v produkčnej ceste a testy nad
zdrojákom ich nevideli, pretože žiadny z nich nešiel cez UI ani cez celý shell.

1. **`src/lib/log/redact.ts` + `HealthReport.key` — celá hlavička UI tvrdila
   „kľúč chýba"**, aj keď kľúč platil, a natrvalo svietil režim len na čítanie.
   Príčina: telo každej odpovede prechádza `redact()` (I1) a `key` je meno
   z denylistu, takže sa dvojica `{present, expiresAt}` maskovala celá na
   `***REDACTED***` — hoci BUILD-SPEC §5 predpisuje, že `GET /api/health` má
   vracať `key:{present,expiresAt}`. (V protokole §B/I1 bod 3 je to omylom
   uvedené ako *dôkaz* redakcie; `test/integration/health.spec.ts` to má
   poznačené ako „nahlásené A11/A19".) Oprava: **úzka výnimka** — pod
   denylistovým menom sa prepustí VÝHRADNE plain objekt s presne poľami
   `{present, expiresAt}` a hodnotami `boolean|number|null|Date|string`;
   všetko ostatné (vrátane stringu, extra poľa, vnoreného objektu) sa maskuje
   celé ako doteraz, stringy vnútri navyše stále prechádzajú inline aj
   substring scanom na aktuálny kľúč. Pokryté 6 novými testami
   v `test/unit/redact.spec.ts` (I1 sa neoslabuje: kľúč je vždy string/Buffer,
   na ten sa výnimka nikdy nevzťahuje).
2. **`src/instrumentation-node.ts` + `src/lib/repo/api-key.repo.ts` — audit
   kľúča sa NIKDY nezapisoval do `audit_log`.** `configureApiKeyRepo()` (podľa
   vlastnej dokumentácie „MUSÍ sa zavolať pri boote") nevolal nikto, takže
   `key_stored`, `key_verified`, `key_wiped` aj `key_panic_wipe` končili len ako
   log `audit_fallback`. **Po panic buttone (D67) tak neexistoval žiadny trvalý
   dôkaz, že kľúč bol wipnutý** — a runbook R5 sa oň opiera. Oprava: (a) wiring
   pri boote v `instrumentation-node.ts`, (b) — a to je to podstatné — repo si
   writer dotiahne aj samo (`await import('@/lib/audit/write')`), pretože
   Next.js kompiluje `instrumentation` do vlastného module grafu a singleton
   z bootu **nie je ten istý objekt**, aký vidia route handlery (samotný wiring
   pri boote problém neopravil, meraný stav bol stále `audit_fallback`).
   Jediná cesta do `audit_log` zostáva `appendAudit()` z A2 (I4).
3. **`src/lib/engine/preview.ts` + `src/app/api/campaigns/preview/route.ts` —
   „Zopakovať zlyhané" (D15, D16) bolo v UI nepoužiteľné.** Dry-run opakovania
   vždy skončil blokátorom `future_overlap`: kontrola prekryvu (D28) počítala aj
   **rodičovskú** kampaň (rovnaké produkty, rovnaké okno, stav `partial` je
   v dotaze) a `parentCampaignId` sa z route do `buildPreview()` vôbec
   neposielal. Oprava: `PreviewInput.parentCampaignId` sa forwarduje a rodič sa
   z prekryvu vylučuje; prekryv s **inými** kampaňami blokuje naďalej.
4. **`src/components/campaigns/NewCampaignWizard.tsx` — jednodňová zľava (D30)
   sa nedala vytvoriť vôbec.** Preview vrátil blokátor
   `one_day_not_acknowledged`, pri blokátore sa `ConfirmPanel` nevykreslí — a
   potvrdenie „naozaj 1 deň?" je práve v ňom. Slepá ulička. Oprava: pri
   `from === to` posiela sprievodca do **dry-runu** `oneDayAcknowledged: true`
   (dry-run nič nezapisuje). **Záväzné potvrdenie sa neobchádza:**
   `POST /api/campaigns` stále vyžaduje `acknowledgements.oneDay` a kontroluje
   ho ešte pred spálením preview tokenu (I3, D30) — presne to overuje e2e test
   „D30: jednodňová zľava sa nepotvrdí bez explicitného ‚naozaj 1 deň'".

Žiadna z týchto zmien nemení kontrakt §5, nezavádza závislosť a neoslabuje
invariant. Ostatné body §D a §F zostávajú v platnosti nezmenené.

### 5. Nový stav (skutočné čísla, po zmenách)

| Príkaz | Výsledok |
| --- | --- |
| `npx tsc --noEmit` | ✅ exit 0 |
| `npm run lint` | ✅ exit 0 |
| `npx vitest run` | ✅ **38 súborov / 620 testov** (614 + 6 nových k redakcii), 0 zlyhaných |
| `npx playwright test` | ✅ **20/20** (predtým 4/20); opakovaný beh rovnako 20/20 |
| `npm run test:build` (smoke nad buildom) | ✅ **8/8**, vrátane `next build` a behu `node .next/standalone/server.js` |

E2e beh v tomto prostredí vyžaduje `PLAYWRIGHT_CHROMIUM_EXECUTABLE`
(predinštalovaný Chromium rev. 1194 namiesto 1234 — §0/§D.2a); v CI to netreba,
tam `npx playwright install` funguje.

### 6. Čo zostáva neoverené (nezmenené oproti §D/§F)

- Docker build a beh stacku (§D.1, F.5) — stále bez daemona; **smoke test
  Docker nenahrádza**, spúšťa `node .next/standalone/server.js` priamo.
- `gitleaks detect` (§D.4), MariaDB **11.4** lokálne (§D.6) — smoke aj e2e tu
  bežali proti 10.11.14; v CI je 11.4.
- Nedosiahnuteľnosť portu 3000 z hosta (I5, §B/I5) — vyžaduje Docker.
- F.8 (stacktrace 500-tiek sa neloguje), F.9 (`unverified` kľúč), F.11
  (`APP_VERSION` na dvoch miestach) — vedomé, neriešené.
- Oprava č. 3 (retry/prekryv) a č. 4 (jednodňová zľava) sú pokryté e2e testami,
  ale **nemajú vlastný unit/integračný test** — pri prípadnej regresii ich
  zachytí až Playwright.
- Boot audit event `boot` sa stále nezapisuje (`TODO(A2/A10)`
  v `src/instrumentation-node.ts`) — nesúvisí s wiringom kľúča, ostáva otvorené.

### Oprava naviac — automatické nájdenie Chromia pre e2e

Dodatok vyššie uvádzal `npx playwright test` = 20/20, ale to platilo **len
s ručne nastavenou** premennou `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Bez nej padlo
všetkých 20 testov na `browserType.launch: Executable doesn't exist at
…chromium_headless_shell-1234/…` — `@playwright/test` 1.62 chce revíziu 1234,
prostredie má 1194, a `cdn.playwright.dev` je za proxy nedostupný, takže
`npx playwright install` ju nemá odkiaľ stiahnuť.

E2e, ktoré prejdú len s premennou, o ktorej nikto nevie, nie sú regresná sieť.
`playwright.config.ts` preto Chromium hľadá sám: explicitná premenná → najnovšia
revízia `chromium-*` v `PLAYWRIGHT_BROWSERS_PATH` (predvolene `/opt/pw-browsers`)
bez ohľadu na očakávanú revíziu → štandardné správanie Playwrightu.

Overené: `npx playwright test` bez akejkoľvek premennej = **20/20 passed**
(52,8 s).
