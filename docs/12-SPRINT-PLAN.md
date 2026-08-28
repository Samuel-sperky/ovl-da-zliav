# Aura Zľavy (ovl-da-zliav) — SPRINT PLÁN (max 20 agentov)

**Verzia:** 1.0 · **Dátum:** 2026-08-05
**Vstupy pre každého agenta:** `docs/10-KONTRAKT.md` (rozhodnutia + INVARIANTY),
`docs/11-BUILD-SPEC.md` (technická špecifikácia), `docs/api/sperky-api.md`.

---

## 0. Pravidlá spolupráce agentov

1. **Vlastníctvo súborov je exkluzívne.** Agent zapisuje **výhradne** do súborov
   uvedených v jeho „vlastní súbory". Do cudzieho súboru NESMIE zapísať ani
   jeden znak — ani „len import doplniť". Ak mu chýba niečo v cudzom súbore,
   nahlási to vo svojej finálnej odpovedi a implementuje to bez toho.
2. **Kontrakty pred implementáciou.** Typy a rozhrania na rozhraní modulov sú
   v `src/lib/contracts.ts` (vytvára A0). Agent proti nim programuje aj vtedy,
   keď implementácia druhej strany ešte nie je hotová.
3. **`package.json` je zamknutý.** Vytvára ho A0 s kompletnou sadou závislostí
   (KONTRAKT §J/O7). Žiadny iný agent ho nesmie meniť; ak mu závislosť chýba,
   nahlási to a vyrieši to bez novej závislosti.
4. **Prebranie vlastníctva** (súbor vytvorený ako stub v skoršej vlne a plne
   nahradený v neskoršej) je povolené len tam, kde je to výslovne uvedené —
   a nikdy medzi agentmi v tej istej vlne.
5. **Invarianty I1–I14 sú nadradené zadaniu.** Ak sa úloha nedá splniť bez
   porušenia invariantu, agent úlohu nedokončí a nahlási konflikt.
6. **Každý agent končí zeleným `npm run typecheck`** nad svojimi súbormi
   a testami, ktoré vlastní.

## 1. Vlny

| Vlna | Úlohy | Poznámka |
| --- | --- | --- |
| **0** | `A0` | **Sám.** Skeleton, ENV, kontrakty, DB schéma a migrácie. Nikto iný nesmie začať skôr. |
| **1** | `A1` `A2` `A3` `A4` `A5` `A6` `A7` `A8` | 8 paralelných agentov — základné moduly, disjunktné priečinky. |
| **2** | `A9` `A10` `A13` `A14` | Engine, scheduler, UI shell, infra. |
| **3** | `A11` `A12` `A15` `A16` `A17` `A18` | Route-y, UI stránky, bezpečnostné testy, e2e + CI. |
| **4** | `A19` | **Sám.** Integračné overenie a oprava zvyškov. |

```
vlna 0        vlna 1                       vlna 2              vlna 3                    vlna 4
 A0  ──┬──►  A1 crypto ─────────────┬──►  A9 engine  ───┬──►  A11 routes auth/key ──┬──► A19
       ├──►  A2 log/audit ──────────┤     A10 scheduler │     A12 routes campaigns  │
       ├──►  A3 shop client ────────┤     A13 UI shell ─┼──►  A15 UI kampane        │
       ├──►  A4 auth ───────────────┤     A14 infra ────┘     A16 UI ostatné        │
       ├──►  A5 http pipeline ──────┤                          A17 sec. testy       │
       ├──►  A6 mock shop ──────────┤                          A18 e2e + CI ────────┘
       ├──►  A7 domain logika ──────┤
       └──►  A8 repozitáre ─────────┘
```

---

## A0 — Skeleton, ENV, kontrakty, DB schéma a migrácie

**Vlna:** 0 (sám) · **Závisí na:** — 

**Vytvorí:** `package.json` (kompletná sada závislostí: `next@16`, `react@19`,
`react-dom@19`, `typescript`, `zod`, `jose`, `argon2`, `mariadb`, `ulid`,
`@date-fns/tz` alebo `date-fns-tz`, `vitest`, `@vitest/coverage-v8`,
`@playwright/test`, `eslint`, `@types/*`), `package-lock.json`, `tsconfig.json`
(strict, paths `@/*`), `next.config.ts` (`output:'standalone'`,
`poweredByHeader:false`), `eslint.config.mjs`, `vitest.config.ts`,
`playwright.config.ts` (stub), `.gitignore`, `.env.example`,
`src/env.ts` (zod schéma podľa BUILD-SPEC §11), `src/version.ts`,
`src/contracts.ts` (type-only rozhrania: `SecretRef`, `Logger`, `Redactor`,
`AuditInput`, `ShopClient`, `CampaignStatus`, `ItemStatus`, repo rozhrania),
`src/instrumentation.ts` (boot assertions §11), `src/db/pool.ts`, `src/db/tx.ts`,
`src/db/advisory-lock.ts`, `db/migrations/0001..0008*.sql`, `scripts/migrate.ts`,
`scripts/gen-master-key.ts`, `scripts/seed-admin.ts`,
`src/lib/scheduler/boot.ts` (stub `startScheduler()` = no-op),
`src/app/layout.tsx` + `src/app/globals.css` + `src/app/page.tsx` (minimálne
placeholdery), `test/setup.ts` (globálny fetch guard I6), `test/helpers/db.ts`.

**Vlastní súbory:** všetky vyššie uvedené.
**Prebranie vlastníctva neskôr:** `src/app/layout.tsx`, `globals.css`,
`page.tsx` → A13; `src/lib/scheduler/boot.ts` → A10; `playwright.config.ts` → A18.

**Akceptačné kritérium:** `npm ci && npm run typecheck && npm run build`
prejde; `npm run migrate` proti čistej MariaDB 11.4 vytvorí všetkých 11 tabuliek
v poradí z BUILD-SPEC §3 vrátane CHECK constraintov a grantov; opakované
spustenie migrácií je no-op; zmena checksumu existujúcej migrácie spôsobí
fail-fast; `test/setup.ts` zhodí test pri `fetch` na iný host než localhost.

**Ako sa overí:** `npm run typecheck`, `npm run build`,
`docker run --rm mariadb:11.4` + `npm run migrate` 2×, `SHOW CREATE TABLE` pre
`audit_log` a `products_allowlist` (existencia `uq_allowlist_slot`
a `ck_allowlist_slot_active`), `npm run test -- test/setup` (guard test).

**PROMPT:**
> Postav skeleton projektu Aura Zľavy podľa `docs/11-BUILD-SPEC.md` §1, §2, §3
> a §11 — konfiguráciu, `src/env.ts` so zod schémou, `src/contracts.ts`
> s type-only rozhraniami pre všetky moduly, DB pool a numerované migrácie
> `0001`–`0008` vrátane grantov. Si prvý agent a všetci ostatní stavajú na tvojich
> kontraktoch, preto `src/contracts.ts` musí pokryť rozhrania crypto, loggera,
> redaktora, auditu, shop klienta, domain stavov a repozitárov, a `package.json`
> musí obsahovať kompletnú sadu závislostí pre celý projekt — nikto iný ho už
> nesmie meniť. Rešpektuj invarianty: `audit_log` dostane pre app usera len
> `SELECT, INSERT` (I4), `products_allowlist` vynúti maximálne 10 aktívnych
> záznamov cez `slot` UNIQUE 1–10 (I2), `MAX_PRODUCTS_PER_OPERATION` aj
> `ALLOWLIST_MAX` majú v zod schéme strop 10, `API_KEY_TTL_HOURS` strop 48,
> boot assertion vyžaduje `PUBLIC_BIND=127.0.0.1` a fail-fast pri chybe (I5, I14),
> a `test/setup.ts` musí globálne zhodiť každý test, ktorý by volal iný host než
> lokálny mock (I6). Neimplementuj žiadnu business logiku ani UI — len skeleton,
> schému a kontrakty; `src/app/*` a `src/lib/scheduler/boot.ts` nechaj ako
> minimálne stuby, ktoré neskoršie vlny prevezmú.

---

## A1 — Crypto modul, master key a repozitár API kľúča

**Vlna:** 1 · **Závisí na:** A0

**Vytvorí:** `src/lib/crypto/master-key.ts` (načítanie súboru, kontrola dĺžky
a práv), `src/lib/crypto/secret-box.ts` (AES-256-GCM podľa BUILD-SPEC §7,
`SecretRef` implementácia s `wipeBuffer`), `src/lib/crypto/preview-token.ts`
(HS256 JWT, TTL 15 min, `payloadHash`, jednorazovosť), 
`src/lib/repo/api-key.repo.ts` (uloženie, `loadForUse()` s lazy TTL kontrolou,
`wipe(reason)` podľa §7), `test/unit/crypto.spec.ts`,
`test/unit/preview-token.spec.ts`.

**Vlastní súbory:** `src/lib/crypto/**`, `src/lib/repo/api-key.repo.ts`,
`test/unit/crypto.spec.ts`, `test/unit/preview-token.spec.ts`.

**Akceptačné kritérium:** roundtrip encrypt/decrypt funguje; zmena jediného
bitu ciphertextu/IV/AAD spôsobí chybu autentifikácie; `loadForUse()` po
`expires_at` nevráti kľúč a spustí wipe; wipe najprv prepíše ciphertext
náhodnými bajtmi, potom riadok zmaže a zapíše audit `key_wiped`; `SecretRef`
po `release()` obsahuje vynulovaný buffer; preview token s pozmeneným
`payloadHash` alebo po 15 min je odmietnutý.

**Ako sa overí:** `npm run test -- test/unit/crypto test/unit/preview-token`
+ integračný test wipe procedúry proti testovacej DB.

**PROMPT:**
> Implementuj crypto vrstvu Aura Zľavy podľa `docs/11-BUILD-SPEC.md` §7 a
> rozhraní v `src/contracts.ts`: master key zo súboru (kontrola dĺžky aj práv,
> fail-fast), AES-256-GCM secret box s formátom `ciphertext|iv|auth_tag` a AAD
> `ovl_zliav:api_key:v1`, singleton repozitár `api_key` a podpísaný preview token
> pre dry-run sadu. Invarianty, ktoré tvoj kód drží: API kľúč sa NESMIE nikdy
> dostať do logu, auditu, odpovede ani do error message (I1) — preto plaintext
> existuje výhradne ako `Buffer` vnútri `SecretRef` a po `release()` je prepísaný
> `fill(0)`; TTL 48 h sa kontroluje **lazy pri každom prístupe** a wipe prepíše
> ciphertext náhodnými dátami pred `DELETE` (D63); žiadna in-memory cache
> dešifrovaného kľúča neexistuje (D64). Preview token je nosič invariantu I3
> (žiadny zápis bez potvrdenia), preto musí obsahovať SHA-256 hash kanonickej
> sady parametrov a `price_at_preview` per produkt a musí byť jednorazový.
> Nepíš do žiadneho iného súboru než do svojich; audit zapisuj cez rozhranie
> z `src/contracts.ts`, implementáciu dodáva A2.

---

## A2 — Logger, centrálny redaktor a append-only audit

**Vlna:** 1 · **Závisí na:** A0

**Vytvorí:** `src/lib/log/logger.ts` (štruktúrovaný JSON na stdout, `LOG_LEVEL`),
`src/lib/log/redact.ts` (maskovanie hlavičiek + denylist polí + substring scan
podľa BUILD-SPEC §6), `src/lib/audit/events.ts` (enum `event_type` podľa §3),
`src/lib/audit/write.ts` (`appendAudit()` — **jediná** cesta zápisu do
`audit_log`, vždy cez `redact()`), `src/lib/repo/audit.repo.ts` (výhradne
`SELECT` s filtrami a pagináciou), `test/unit/redact.spec.ts`.

**Vlastní súbory:** `src/lib/log/**`, `src/lib/audit/**`,
`src/lib/repo/audit.repo.ts`, `test/unit/redact.spec.ts`.

**Akceptačné kritérium:** `redact()` zamaskuje `authorization`, `x-api-key`,
`cookie` a polia `apiKey/api_key/key/token/password/secret` v ľubovoľnej hĺbke
vnorenia vrátane polí; ak sa v serializovanom výstupe nachádza aktuálny kľúč
alebo jeho posledných 8 znakov, nahradí ho a zaloguje `redaction_hit`;
`audit.repo.ts` neobsahuje žiadny `UPDATE` ani `DELETE`; `appendAudit()`
nikdy nehodí výnimku smerom do volajúceho toku (audit sa nesmie stať dôvodom
zlyhania zápisu, ale zlyhanie sa zaloguje).

**Ako sa overí:** `npm run test -- test/unit/redact`;
`grep -rn "UPDATE\|DELETE" src/lib/repo/audit.repo.ts` je prázdny.

**PROMPT:**
> Implementuj logovanie a audit pre Aura Zľavy podľa `docs/11-BUILD-SPEC.md`
> §3 (tabuľka `audit_log`, zoznam `event_type`), §6 (redakcia) a §10 (JSON na
> stdout) a proti rozhraniam v `src/contracts.ts`. Tvoj `redact()` je jediná
> obrana invariantu I1 (kľúč nikdy v logoch ani v audite) — musí maskovať
> hlavičky aj polia z denylistu do ľubovoľnej hĺbky a navyše robiť substring
> scan na aktuálne uložený kľúč a jeho posledných 8 znakov; `appendAudit()`
> je jediná cesta do `audit_log` a musí redaktorom prechádzať vždy, bez
> vypínateľného flagu. Invariant I4: audit je append-only, takže v tvojich
> súboroch NESMIE byť žiadny `UPDATE` ani `DELETE` nad `audit_log` a
> `audit.repo.ts` je čisto čítací. Prevádzkové logy idú na stdout, audit do DB —
> tieto dva kanály sa nesmú miešať (D92). Zapisuj len do svojich súborov.

---

## A3 — API klient voči shopu (taxonómia chýb, retry, korelácia)

**Vlna:** 1 · **Závisí na:** A0

**Vytvorí:** `src/lib/shop/client.ts` (`listProducts`, `getProduct`,
`batchGetProducts`, `setReduction`, `probeKey`, `canary`),
`src/lib/shop/schemas.ts` (zod schémy odpovedí, obe tvarové konvencie shopu),
`src/lib/shop/errors.ts` (`ShopErrorKind` taxonómia), `src/lib/shop/retry.ts`,
`src/lib/shop/correlation.ts` (ULID `operation_id`/`request_id`),
`src/lib/shop/messages.sk.ts` (kód → slovenská veta + odporúčanie),
`test/unit/shop-errors.spec.ts`, `test/unit/shop-retry.spec.ts`.

**Vlastní súbory:** `src/lib/shop/**`, `test/unit/shop-errors.spec.ts`,
`test/unit/shop-retry.spec.ts`.

**Akceptačné kritérium:** taxonómia presne podľa BUILD-SPEC §6 (429/500/network/
timeout_before = retryable, 400/401/403/404/schema_drift = terminal,
timeout_after = `uncertain` + presne 1 identický resend); 429 čaká
`min(Retry-After, 90 s)` max 3×, 500/network backoff 2/4/8 s max 3×; timeouty
10 s čítanie / 30 s zápis; HTTP 200 s `ok:false` nikdy nie je úspech; HTTP 200
s tvarom, ktorý neprejde zod, je `schema_drift`; `batchGetProducts` pri
`batch_not_allowed` alebo chybe batchu spadne na jednotlivé GETy; `X-Api-Key`
sa posiela **len** pri `setReduction` a `probeKey`.

**Ako sa overí:** `npm run test -- test/unit/shop-*` (fake fetch, bez siete);
neskôr integračne proti mocku od A6 v úlohe A9.

**PROMPT:**
> Napíš api-client voči shopu podľa `docs/api/sperky-api.md` a
> `docs/11-BUILD-SPEC.md` §6, proti rozhraniu `ShopClient` v `src/contracts.ts`.
> Celá taxonómia chýb, retry politika a timeouty musia byť na jednom mieste
> v tvojom module (D41) a musia zvládnuť obe tvarové konvencie shopu
> (`{ok:false,errors:[…]}` aj `{error:"…"}`) — HTTP 200 s `ok:false` sa NIKDY
> nesmie vyhodnotiť ako úspech, a HTTP 200 s neočekávaným tvarom je
> `schema_drift`, teda „stav neistý", nie úspech (D54). Invarianty: API kľúč
> dostávaš výhradne ako `SecretRef` a plaintext nesmie opustiť moment odoslania
> requestu (I1, D64); `X-Api-Key` posielaj len pri `setReduction` a pri sonde
> `probeKey` s `reduction=0` (čítanie je verejné, D48, D53); NESMIE existovať
> žiadna funkcia, ktorá ruší zľavu alebo posiela `to` v minulosti (I7); žiadne
> volanie na `/api/order` (I8). Každý request nesie `User-Agent
> aura-zlavy/<verzia>` a `request_id` v rámci `operation_id` (D58) a tvoje testy
> bežia s fake fetch, nikdy proti reálnej doméne (I6).

---

## A4 — Autentifikácia, session, sudo mode, lockout

> **ZRUŠENÉ 27. 8. 2026 (D99, D100, D104).** Celý tento agent je história:
> prihlásenie, session, sudo aj lockout sú zmazané z kódu, nie vypnuté
> prepínačom. Zmazané sú `src/lib/auth/{password,session,sudo,lockout,
> lockout-policy}.ts`, `src/lib/repo/login-attempts.repo.ts`
> aj `test/unit/auth.spec.ts`; `src/lib/repo/users.repo.ts` zostal ako čítacia
> cesta k `users` (D101) a namiesto session je `src/lib/auth/local-actor.ts`
> (D102). Znenie nižšie NEPLATÍ a je tu len pre históriu.

**Vlna:** 1 · **Závisí na:** A0

**Vytvorí:** `src/lib/auth/password.ts` (argon2id, min 12 znakov),
`src/lib/auth/session.ts` (jose JWT, cookie `ovl_zliav_session`, 8 h absolútna
+ 30 min idle, `httpOnly`/`Secure`/`SameSite=Strict`), `src/lib/auth/sudo.ts`
(15 min okno), `src/lib/auth/lockout.ts` (5 pokusov / 15 min per IP +
exponenciálny lockout), `src/lib/repo/users.repo.ts`,
`src/lib/repo/login-attempts.repo.ts`, `test/unit/auth.spec.ts`.

**Vlastní súbory:** ~~`src/lib/auth/**`~~ (dnes len `local-actor.ts`),
`src/lib/repo/users.repo.ts`, ~~`src/lib/repo/login-attempts.repo.ts`~~,
~~`test/unit/auth.spec.ts`~~ — zrušené 27. 8. 2026 (D99).

**Akceptačné kritérium:** heslo pod 12 znakov je odmietnuté; argon2id hash sa
verifikuje; session token exspiruje absolútne po 8 h aj po 30 min nečinnosti
a idle sa obnovuje pri každom požiadaní; cookie má všetky tri atribúty;
`sudo.ts` vracia „vyžaduje heslo" ak posledná autentifikácia je starším než
15 min; lockout prežije restart procesu (stav v `login_attempts`) a exponenciálne
predlžuje blokádu; každý pokus (úspešný aj neúspešný) generuje audit event.

**Ako sa overí:** `npm run test -- test/unit/auth` + integračný test lockoutu
proti testovacej DB (5 zlyhaní → 6. pokus zamietnutý aj po reštarte modulu).

**PROMPT:**
> Implementuj autentifikačnú vrstvu Aura Zľavy podľa `docs/10-KONTRAKT.md`
> D68–D71 a `docs/11-BUILD-SPEC.md` §1/§11: argon2id heslá (min 12 znakov, bez
> zložitostných pravidiel), jose JWT session v cookie `ovl_zliav_session` s 8 h
> absolútnou platnosťou a 30 min idle timeoutom, sudo okno 15 minút a
> brute-force lockout 5 pokusov / 15 min s exponenciálnym predlžovaním.
> Sudo mód je priamou súčasťou invariantu I3 (žiadny zápis bez potvrdenia) —
> API musí vedieť jednoznačne odpovedať, či je sudo okno platné, a pri
> pochybnosti odpovedá „nie". Lockout NESMIE žiť v pamäti procesu: stav patrí do
> tabuľky `login_attempts`, aby restart appky nezmazal blokádu (KONTRAKT §J/O4).
> Žiadne 2FA (D73) a žiadna CAPTCHA (D71); cookie musí byť `httpOnly`, `Secure`
> a `SameSite=Strict`, čo je zároveň prvá vrstva CSRF obrany (D72). Zapisuj len
> do svojich súborov, audit volaj cez rozhranie z `src/contracts.ts`.

---

## A5 — HTTP pipeline `defineRoute()`

**Vlna:** 1 · **Závisí na:** A0

**Vytvorí:** `src/lib/http/define-route.ts` (pipeline auth → lockout/rateLimit →
Origin check → zod → handler → error mapping; režimy `auth: 'none' | 'session' | 'sudo'`),
`src/lib/http/errors.ts` (`AppError`, mapovanie na HTTP status a kódy),
`src/lib/http/responses.ts` (`ok()`/`fail()` tvar `{ok:true,data}` /
`{ok:false,error:{code,message,detail?}}`), `test/unit/define-route.spec.ts`.

**Vlastní súbory:** `src/lib/http/**`, `test/unit/define-route.spec.ts`.

**Akceptačné kritérium:** mutácia (POST/PUT/DELETE) bez zodpovedajúceho
`Origin` je odmietnutá 403 ešte pred handlerom; `auth:'sudo'` bez platného sudo
okna vracia 401 s kódom `sudo_required`; neplatný zod vstup vracia 400 so
zoznamom polí; neodchytená výnimka sa nikdy nedostane do odpovede ako
stacktrace a nikdy neobsahuje hodnoty z denylistu redaktora; pipeline zaloguje
každé volanie s `request_id`.

**Ako sa overí:** `npm run test -- test/unit/define-route` (tabuľkové testy pre
všetky kombinácie auth × metóda × origin × zod).

**PROMPT:**
> Postav `defineRoute()` pipeline pre Next.js 16 route handlery podľa
> `docs/11-BUILD-SPEC.md` §5 a rozhraní v `src/contracts.ts`: poradie auth →
> lockout/rateLimit → Origin check → zod validácia → handler → mapovanie chýb,
> s režimami `none`/`session`/`sudo`. Origin check na všetkých mutáciách je druhá
> vrstva CSRF obrany a je povinný (D72); `auth:'sudo'` musí zlyhať fail-closed,
> keď sudo okno nie je preukázateľne platné (I3). Chybové odpovede nesmú nikdy
> obsahovať stacktrace ani hodnoty, ktoré by mohli nesť API kľúč — všetko ide
> cez redaktor z `src/lib/log/redact.ts` (I1). Jednotný tvar odpovedí je
> `{ok:true,data}` / `{ok:false,error:{code,message,detail?}}`; slovenské hlášky
> pre chyby shopu neduplikuj, tie vlastní A3. Zapisuj len do svojich súborov.

---

## A6 — Mock shop server a testovacie helpery

**Vlna:** 1 · **Závisí na:** A0

**Vytvorí:** `test/mock-shop/server.ts` (node:http na ephemeral porte,
endpointy `GET /api/products`, `GET /api/products/get`,
`POST /api/products/setReduction`, `POST /api/batch`),
`test/mock-shop/state.ts` (programovateľné scenáre `failNth`, `delay`,
`unauthorizedAfter`, `forbidden`, `rateLimit`, `returnGarbage`, `hangWrite`,
`changePrice`, `recordedRequests[]`), `test/mock-shop/fixtures.ts`,
`test/helpers/mock.ts` (start/stop + `SHOP_BASE_URL_OVERRIDE`),
`test/helpers/factories.ts` (kampane, položky, allowlist).

**Vlastní súbory:** `test/mock-shop/**`, `test/helpers/mock.ts`,
`test/helpers/factories.ts`.

**Akceptačné kritérium:** mock verne reprodukuje kontrakt z
`docs/api/sperky-api.md` vrátane HTTP statusov, `Retry-After`, tvarov
`{ok:false,errors:[]}` aj `{error:"…"}`, `batch_not_allowed` pre `setReduction`,
`invalid_item` pre malformed položku, validácií `0 < reduction ≤ 30`,
`to ≥ from` a okna ≤ 3 mesiace; `recordedRequests[]` zaznamená hlavičky
(vrátane `X-Api-Key`) a timestampy, aby sa dalo overiť tempo 250 ms aj redakcia;
mock beží výhradne na `127.0.0.1`.

**Ako sa overí:** vlastný smoke test, ktorý pre každý endpoint porovná odpoveď
s príkladmi v `docs/api/sperky-api.md`.

**PROMPT:**
> Napíš mock shop server a testovacie helpery pre Aura Zľavy podľa
> `docs/api/sperky-api.md` a `docs/11-BUILD-SPEC.md` §12. Mock musí byť verný do
> úrovne HTTP statusov a tvarov chýb (obe konvencie shopu, `Retry-After`,
> `batch_not_allowed` pre `setReduction`, `invalid_item` v slote batchu)
> a programovateľný — potrebujeme z neho vyrobiť rate limit, 401 po n-tom
> requeste, 403, HTTP 200 s nesmyslným tvarom, vis pri zápise (timeout po
> odoslaní) aj zmenu ceny medzi dvoma GETmi. Invariant I6 je tvoja hlavná
> zodpovednosť: mock beží len na `127.0.0.1`, testy nikdy nesmú siahnuť na
> reálnu doménu, a `recordedRequests[]` musí uchovávať hlavičky aj timestampy,
> aby iné úlohy vedeli overiť redakciu kľúča (I1) a sekvenčné tempo 250 ms (I10).
> Nepíš žiadny produkčný kód v `src/` — vlastníš výhradne `test/mock-shop/**`
> a dva helper súbory.

---

## A7 — Domain logika: dátumy, percentá, pravidlá kampaní, stavový stroj

**Vlna:** 1 · **Závisí na:** A0

**Vytvorí:** `src/lib/domain/dates.ts` (Europe/Bratislava, `fire_at` z
`date_from` + `SCHEDULER_FIRE_TIME`, kalendárne „+3 mesiace", zamrznutie ±60 s
okolo polnoci, formát DD.MM.YYYY), `src/lib/domain/percent.ts` (celé čísla 1–30),
`src/lib/domain/campaign-rules.ts` (`from ≥ dnes`, `to ≥ from`, jednodňová zľava,
prekryv budúcich kampaní, sémantika predĺženia a prepisu),
`src/lib/domain/status.ts` (stavový stroj podľa BUILD-SPEC §4 + `assertTransition`),
`src/lib/domain/pricing.ts` (orientačná zľavnená cena),
`test/unit/dates.spec.ts`, `test/unit/percent.spec.ts`,
`test/unit/campaign-rules.spec.ts`, `test/unit/status.spec.ts`.

**Vlastní súbory:** `src/lib/domain/**`, uvedené štyri unit testy.

**Akceptačné kritérium:** tabuľka prechodov z BUILD-SPEC §4 je implementovaná
1 : 1 vrátane zakázaných prechodov (`missed → running` bez nového potvrdenia
hodí výnimku; prechod do `running` bez `confirmed_at`/`confirm_payload_hash`
hodí výnimku); `dates.ts` správne rieši DST prechod (marec/október) pri prepočte
`fire_at`; `+3 mesiace` je kalendárne (31.1. + 3M = 30.4.), nie 90 dní;
`percent.ts` odmietne `0`, `31`, `12.5`, `"15"`; `campaign-rules.ts` odmietne
`from` v minulosti a označí prekryv dvoch budúcich kampaní na tom istom produkte.

**Ako sa overí:** `npm run test -- test/unit/dates test/unit/percent
test/unit/campaign-rules test/unit/status` s fixnutým systémovým časom.

**PROMPT:**
> Implementuj domain logiku Aura Zľavy podľa `docs/10-KONTRAKT.md` D11, D25,
> D27–D32, D59, D83 a tabuľky prechodov v `docs/11-BUILD-SPEC.md` §4. Všetka
> dátumová logika beží v Europe/Bratislava, časové pečiatky sú UTC, „+3 mesiace"
> je kalendárne (nie 90 dní) a `fire_at` je `date_from` 00:05 bratislavského času
> prevedené do UTC, korektne aj cez DST hranicu. Invarianty, ktoré musí tvoj kód
> vynútiť ako čisté funkcie: percento je celé číslo 1–30, `to ≥ from`,
> `from ≥ dnes` a okno ≤ 3 mesiace sa validujú lokálne pred akýmkoľvek volaním
> API (I9); stavový stroj NESMIE dovoliť prechod do `running` bez potvrdenia
> (`confirmed_at` + `confirm_payload_hash`, I3) a NESMIE existovať žiadna cesta
> `missed → running` bez nového potvrdenia, ani žiadna konštanta typu
> „catch-up okno" (odchýlka D33b). Píš to ako čisté funkcie bez prístupu do DB
> a bez volaní siete; DB prácu robia repozitáre (A8).

---

## A8 — Repozitáre (settings, allowlist, catalog, campaigns, items, scheduler_state)

**Vlna:** 1 · **Závisí na:** A0

**Vytvorí:** `src/lib/repo/settings.repo.ts`, `allowlist.repo.ts`
(vrátane obsadzovania/uvoľňovania `slot`), `catalog.repo.ts`,
`campaigns.repo.ts` (vrátane atomického `claim()`), `campaign-items.repo.ts`,
`scheduler-state.repo.ts` (heartbeat), `test/integration/repo.spec.ts`.

**Vlastní súbory:** uvedené repozitáre (bez `api-key.repo.ts` = A1, bez
`users.repo.ts`/`login-attempts.repo.ts` = A4, bez `audit.repo.ts` = A2),
`test/integration/repo.spec.ts`.

**Akceptačné kritérium:** `allowlist.repo.addProduct()` pri 10 obsadených
slotoch zlyhá (chyba DB constraintu je preložená na doménovú chybu
`allowlist_full`) a odobranie uvolní slot; `campaigns.repo.claim(id)` je
implementovaný ako jediný `UPDATE … WHERE id=? AND status IN ('scheduled','needs_key')`
a vracia `false` pri `affectedRows=0`; dva paralelné `claim()` na tú istú kampaň
uspejú presne raz; `settings` a `scheduler_state` sa správajú ako singleton
(nikdy nevytvoria druhý riadok); žiadny repozitár nezapisuje do `audit_log`.

**Ako sa overí:** `npm run test -- test/integration/repo` proti testovacej
MariaDB s migráciami z A0 (helper `test/helpers/db.ts`).

**PROMPT:**
> Implementuj repozitáre nad schémou z `docs/11-BUILD-SPEC.md` §3 proti
> rozhraniam v `src/contracts.ts` — settings (singleton), allowlist (vrátane
> správy `slot`), catalog cache, campaigns (vrátane atomického `claim()`),
> campaign_items a scheduler_state heartbeat. Invariant I2: allowlist má
> maximálne 10 aktívnych záznamov a DB constraint na `slot` je posledná poistka —
> tvoja metóda musí porušenie preložiť na jasnú doménovú chybu, nikdy ho
> nesmie „obísť" uvolnením cudzieho slotu. `claim()` je jediná obrana proti
> dvojitému spusteniu kampane (D84): presne jeden `UPDATE` s podmienkou na
> status, návratová hodnota podľa `affectedRows`, žiadny `SELECT … then UPDATE`.
> Do `audit_log` nesmieš zapisovať vôbec (vlastní to A2, invariant I4), rovnako
> nesmieš mazať ani prepisovať auditné záznamy. Nepíš business logiku
> (validácie a stavový stroj vlastní A7) ani volania na shop.

---

## A9 — Engine: dry-run, guardy, sekvenčný executor, snapshoty, reconcile

**Vlna:** 2 · **Závisí na:** A1, A2, A3, A6, A7, A8

**Vytvorí:** `src/lib/engine/mutex.ts` (in-process semafor + `GET_LOCK`),
`src/lib/engine/guards.ts` (allowlist, strop 10, percento/okno, `WRITES_ENABLED`
+ `NODE_ENV`, `writes_locked`, runaway 60/h), `src/lib/engine/preview.ts`
(zostavenie diff sady + `previewToken` + warnings),
`src/lib/engine/snapshot.ts` (pre-write GET, `price_at_preview`/`price_at_write`,
`price_mismatch`), `src/lib/engine/executor.ts` (sekvenčná dávka podľa
BUILD-SPEC §9), `src/lib/engine/reconcile.ts`, `test/unit/guards.spec.ts`,
`test/integration/executor.spec.ts`, `test/integration/sequential-writes.spec.ts`,
`test/integration/runaway-lock.spec.ts`, `test/integration/deviation-39.spec.ts`,
`test/integration/redaction.spec.ts`.

**Vlastní súbory:** `src/lib/engine/**` + uvedených 6 testov.

**Akceptačné kritérium:** dávka 10 produktov ide sériovo s pauzou ≥ 250 ms
(overené timestampmi mocku), nikdy paralelne; zlyhanie 3. produktu nezastaví
zvyšok a kampaň skončí `partial`; 401/403 uprostred dávky wipne kľúč, zvyšok
označí `interrupted` a kampaň prejde do `needs_key`; `not_found` zablokuje len
daný produkt a označí ho v allowliste; timeout po odoslaní pošle presne jeden
identický resend a rozhodne podľa druhej odpovede; `SIGTERM` dobehne aktuálny
produkt; zmena ceny medzi preview a write zápis **nezastaví**, ale uloží
`price_at_preview ≠ price_at_write` a `price_mismatch=1`; 61. zápis v hodine
zamkne zápisy; zápis bez platného preview tokenu je odmietnutý a na mock
nedorazí žiadny request; `test/integration/redaction.spec.ts` dokáže, že kľúč
nie je nikde v DB ani v logoch.

**Ako sa overí:** `npm run test -- test/integration/executor
test/integration/sequential-writes test/integration/runaway-lock
test/integration/deviation-39 test/integration/redaction test/unit/guards`.

**PROMPT:**
> Implementuj zápisový engine Aura Zľavy podľa `docs/11-BUILD-SPEC.md` §9
> a rozhodnutí D34–D37, D39c, D45–D50, D77, D79, D85, D86 v `docs/10-KONTRAKT.md`.
> Executor je jediné miesto v celej appke, ktoré volá `setReduction` — musí ísť
> prísne sekvenčne s pauzou 250 ms (`Promise.all` nad zápismi je zakázaný, I10),
> pod globálnym mutexom (I12) a za guardmi, ktoré fail-closed odmietnu čokoľvek
> mimo aktívneho allowlistu, viac než 10 produktov, neplatné percento/okno,
> `WRITES_ENABLED≠true`, zamknuté zápisy a prekročený runaway strop 60/h
> (I2, I9, I12, I13). Žiadny zápis nesmie prebehnúť bez platného, jednorazového
> preview tokenu a sudo okna (I3), a v kóde NESMIE existovať cesta, ktorá by
> zľavu rušila alebo posielala `to` v minulosti (I7). Odchýlku D39c implementuj
> presne: povinný pre-write `GET /products/get` zostáva, zmena ceny zápis
> **nezastaví**, ale `price_at_preview`, `price_at_write` a `price_mismatch`
> sa povinne uložia a nezhoda sa nesmie stratiť. Napíš aj integračný test, ktorý
> po celom write flow dokáže, že API kľúč nie je v `audit_log`, `campaign_items`
> ani v zachytenom stdout logu (I1).

---

## A10 — Scheduler: tick, claim, TTL wipe, missed, reminders, heartbeat

**Vlna:** 2 · **Závisí na:** A1, A2, A3, A7, A8, A9

**Vytvorí:** `src/lib/scheduler/tick.ts`, `due.ts`, `ttl-wipe.ts`, `missed.ts`,
`reminders.ts`, a **prevezme** `src/lib/scheduler/boot.ts` (stub od A0),
`test/integration/scheduler.spec.ts`, `test/integration/deviation-33.spec.ts`,
`test/integration/ttl-wipe.spec.ts`, `test/integration/reconcile.spec.ts`.

**Vlastní súbory:** `src/lib/scheduler/**` + uvedené 4 testy.

**Akceptačné kritérium:** poradie krokov ticku je presne podľa BUILD-SPEC §9
(heartbeat → TTL wipe → reconcile pri prvom ticku → missed → due/claim →
reminders → heartbeat); expirovaný kľúč je wipnutý aj keď sa appky nikto
nedotkne; kampaň s `fire_at ≤ now` bez platného kľúča prejde do `needs_key`
(nie `failed`); kampaň s `fire_at` starším než 5 min prejde do `missed` a
**žiadny počet ďalších tickov ju nespustí**; `writes_locked` alebo
`WRITES_ENABLED≠true` vedie na `needs_key` s dôvodom `writes_disabled`;
zamrznutie ±60 s okolo polnoci preskočí fire do ďalšieho ticku; výnimka v ticku
nezhodí proces, ale zapíše sa do `scheduler_state.last_error`; heartbeat sa
aktualizuje každý tick.

**Ako sa overí:** `npm run test -- test/integration/scheduler
test/integration/deviation-33 test/integration/ttl-wipe
test/integration/reconcile` s riadeným časom a fake tickom.

**PROMPT:**
> Implementuj in-process scheduler Aura Zľavy podľa `docs/11-BUILD-SPEC.md` §9
> a rozhodnutí D21–D26, D32, D33b, D63, D82–D87. Poradie krokov v ticku je
> normatívne a TTL wipe kľúča musí byť **prvý** krok, aby žiadny ďalší krok
> nepoužil expirovaný kľúč. Odchýlka D33b je najtvrdšia požiadavka tejto úlohy:
> zmeškaný fire ide do `missed` a v tvojom kóde NESMIE existovať žiadna
> konštanta ani cesta, ktorá by ho spustila automaticky — dopáliť ho môže
> výhradne manuálna akcia s novým potvrdením. Chýbajúci alebo neplatný kľúč
> znamená `needs_key`, nie `failed` (D21), a rovnako fail-closed sa chová
> `writes_locked` alebo `WRITES_ENABLED≠true` (I13). Použi atomický `claim()`
> z `campaigns.repo` (D84), zápis deleguj výhradne na `engine/executor` (nikdy
> nevolaj shop priamo) a každý tick zapíš heartbeat; výnimka v ticku nesmie
> zhodiť proces. Prevezmi `src/lib/scheduler/boot.ts` po A0 a nechaj ho
> vypnuteľný cez `SCHEDULER_ENABLED=false`.

---

## A11 — Route-y: auth, settings, kľúč, health

**Vlna:** 3 · **Závisí na:** A1, A2, A3, A4, A5, A8, A10

**Vytvorí:** ~~`src/app/api/auth/login/route.ts`, `logout/route.ts`,
`session/route.ts`, `sudo/route.ts`~~ — celý `src/app/api/auth/` je zmazaný
27. 8. 2026 (D99, D100); `src/app/api/settings/route.ts`,
`settings/domain/route.ts`, `settings/test-connection/route.ts`,
`settings/eager-write-default/route.ts`, `settings/unlock-writes/route.ts`;
`src/app/api/key/route.ts` (GET/PUT/DELETE); `src/app/api/health/route.ts`;
`test/integration/routes-auth.spec.ts`, `routes-key.spec.ts`,
`routes-settings.spec.ts`.

**Vlastní súbory:** ~~`src/app/api/auth/**`~~ (zmazané 27. 8. 2026 — D99,
vrátane `test/integration/routes-auth.spec.ts`), `src/app/api/settings/**`,
`src/app/api/key/**`, `src/app/api/health/**` + zvyšné 2 testy.

**Akceptačné kritérium:** presné dodržanie tabuľky v BUILD-SPEC §5 (cesty,
metódy, auth režimy, zod vstupy, výstupy); `GET /api/key` nikdy nevráti viac než
`last4` + časy + `verifyStatus`; `PUT /api/key` overí kľúč sondou `reduction=0`,
uloží ho zašifrovaný s TTL 48 h a následne spustí dopálenie kampaní v stave
`needs_key`, ktoré sú stále vo svojom okne; `DELETE /api/key` (panic button)
vyžaduje heslo + literál `KLUC UNIKOL`, wipne kľúč, zruší čakajúce kampane a
vráti runbook; `PUT /api/settings/domain` prijme len `https://` URL, vyžaduje
heslo a pred uložením spustí canary GET; `/api/health` je dostupný bez auth
a neobsahuje `last4` ani nič citlivé.

**Ako sa overí:** `npm run test -- test/integration/routes-*` proti mocku +
manuálny `curl` na `/api/health` v kontejneri.

**PROMPT:**
> Implementuj route-y pre autentifikáciu, nastavenia, správu API kľúča a health
> presne podľa tabuľky v `docs/11-BUILD-SPEC.md` §5, vždy cez `defineRoute()`
> od A5 a bez vlastnej business logiky (volaj `lib/*` moduly). Tvoje route-y sú
> jediná cesta, kadiaľ kľúč vstupuje do systému, preto: `PUT /api/key` ho overí
> sondou `setReduction` s `reduction=0` (nikdy nič nezapíše, D53), uloží
> zašifrovaný s TTL 48 h a potom nechá dopáliť kampane v stave `needs_key`
> (D24); `GET /api/key` vracia výhradne posledné 4 znaky, časy a verify status —
> celý kľúč sa NESMIE vrátiť nikdy a nikam (I1, D65); `DELETE /api/key` je panic
> button, ktorý wipne kľúč, zruší čakajúce kampane a zobrazí runbook (D67).
> `PUT /api/settings/domain` prijíma len `https://` doménu, vyžaduje heslo
> a pred uložením overí canary GET (D55, D80); `/api/health` beží bez auth
> (potrebuje ho docker healthcheck), ale NESMIE prezradiť nič citlivé.
> Nezasahuj do `src/app/api/campaigns/**` ani do UI — tie vlastnia A12 a A15/A16.

---

## A12 — Route-y: kampane, allowlist, katalóg, audit, notifikácie

**Vlna:** 3 · **Závisí na:** A2, A5, A7, A8, A9, A10

**Vytvorí:** `src/app/api/campaigns/route.ts` (GET, POST),
`campaigns/preview/route.ts`, `campaigns/[id]/route.ts`,
`campaigns/[id]/execute/route.ts`, `campaigns/[id]/retry-failed/route.ts`,
`campaigns/[id]/extend/preview/route.ts`, `campaigns/[id]/extend/route.ts`,
`campaigns/[id]/cancel/route.ts`, `campaigns/[id]/ack/route.ts`;
`src/app/api/allowlist/route.ts`, `allowlist/[productId]/route.ts`,
`allowlist/[productId]/mark-unknown/route.ts`;
`src/app/api/catalog/refresh/route.ts`; `src/app/api/audit/route.ts`,
`audit/[id]/route.ts`; `src/app/api/notifications/route.ts`;
`test/integration/routes-campaigns.spec.ts`,
`test/integration/no-write-without-confirm.spec.ts`.

**Vlastní súbory:** `src/app/api/campaigns/**`, `src/app/api/allowlist/**`,
`src/app/api/catalog/**`, `src/app/api/audit/**`,
`src/app/api/notifications/**` + uvedené 2 testy.

**Akceptačné kritérium:** presné dodržanie tabuľky v BUILD-SPEC §5;
`POST /api/campaigns` bez platného `previewToken`, s expirovaným tokenom alebo
s tokenom pre inú sadu parametrov vráti 4xx a na mock neodošle **ani jeden**
request; `mode='eager'` zapíše okamžite, `mode='scheduled'` len naplánuje;
`execute` funguje len zo stavov `needs_key`/`missed` a vyžaduje nový
`previewToken`; `DELETE /api/allowlist/[id]` vráti 409 `campaign_planned`, ak
na produkte existuje `scheduled`/`needs_key`/`missed` kampaň; `POST /api/allowlist`
vráti 409 pri 10 obsadených slotoch; `GET /api/audit/[id]` obsahuje príznak
`priceMismatch`; `GET /api/campaigns` vracia aj derivované UI stavy „aktívna"
a „expirovaná".

**Ako sa overí:** `npm run test -- test/integration/routes-campaigns
test/integration/no-write-without-confirm` proti mocku.

**PROMPT:**
> Implementuj route-y pre kampane, allowlist, katalóg, audit a notifikácie presne
> podľa tabuľky v `docs/11-BUILD-SPEC.md` §5, cez `defineRoute()` od A5, bez
> vlastnej zápisovej logiky — dry-run zostavuje `engine/preview`, zápis vykonáva
> `engine/executor`, prechody stavov validuje `domain/status`. Invariant I3 je
> jadro tejto úlohy: `POST /api/campaigns`, `execute`, `retry-failed` a `extend`
> vyžadujú platný jednorazový `previewToken` so zhodným hashom parametrov a sudo
> okno, inak vracajú 4xx a nesmú vyslať ani jeden request na shop — napíš na to
> aj explicitný test. Ďalej platí: `execute` sa dá vyvolať len zo stavov
> `needs_key`/`missed` a je **jediná** cesta, ako sa zmeškaná kampaň dopáli
> (odchýlka D33b); odobranie produktu z allowlistu je blokované, kým na ňom
> existujú plánované kampane (D40); pridanie 11. produktu je odmietnuté (I2).
> Nezasahuj do `src/app/api/auth|settings|key|health` (vlastní A11) ani do UI.

---

## A13 — UI shell, dizajnové primitívy a dashboard

**Vlna:** 2 · **Závisí na:** A0 (API kontrakt čítaj z BUILD-SPEC §5, nečakaj na A11/A12)

**Vytvorí (a preberá od A0):** `src/app/layout.tsx`, `src/app/globals.css`,
`src/app/page.tsx` (dashboard); `src/components/layout/ProductionBar.tsx`,
`KeyTtlBadge.tsx`, `SchedulerBadge.tsx`, `WriteModeBadge.tsx`,
`ReadOnlyNotice.tsx`, `Nav.tsx`; `src/components/ui/StatusBadge.tsx`,
`Countdown.tsx`, `ErrorMessage.tsx`, `PriceHint.tsx`, `SelfWriteBadge.tsx`,
`VariantWarning.tsx`, `RunbookPanel.tsx`, `SudoPrompt.tsx`, `Table.tsx`,
`Button.tsx`; `src/components/dashboard/**` (KeyCard, AlertsBanner,
UnackedResults, CampaignsMini, AllowlistGrid); `src/lib/ui/format.ts`
(DD.MM.YYYY, desatinná čiarka, EUR).

**Vlastní súbory:** všetky vyššie uvedené (`src/app/layout.tsx`,
`src/app/globals.css`, `src/app/page.tsx` preberá od A0).

**Akceptačné kritérium:** `ProductionBar` je viditeľný na každej stránke a
obsahuje reálnu doménu; `KeyTtlBadge` má štyri vizuálne stavy (chýba, > 6 h,
≤ 6 h, ≤ 1 h) a odpočítava; `SchedulerBadge` sčervená pri heartbeat starším
než 3 min; `WriteModeBadge` zobrazí „ZÁPISY VYPNUTÉ (dev)" a „ZÁPISY ZAMKNUTÉ";
dashboard zobrazuje agregovaný banner s `needs_key` **aj** `missed` s rovnakou
vizuálnou váhou, neodklikané výsledky kampaní a 10 kariet allowlistu, každú
s badge „podľa vlastného zápisu z DD.MM."; pri chýbajúcom kľúči je UI read-only
so zakázanými zápisovými akciami a tooltipom; všetky dátumy DD.MM.YYYY.

**Ako sa overí:** `npm run build` + Playwright smoke od A18 (dashboard rendruje
všetky štyri badge stavy zo stubovaných dát).

**PROMPT:**
> Postav UI shell a dashboard Aura Zľavy podľa `docs/11-BUILD-SPEC.md` §8
> a rozhodnutí D1, D5–D8, D10, D14, D17, D87. Dáta čítaj z API kontraktu
> popísaného v §5 — nečakaj na A11/A12, kontrakt je normatívny. UI musí trvalo
> a nezameniteľne komunikovať, že ide o produkčný shop (červený pruh s doménou)
> a musí priznávať, že skutočný stav zľavy v shope nepoznáme: každý produkt
> nesie badge „podľa vlastného zápisu z DD.MM. — shop môže mať iný stav"
> a nikde sa nesmie tvrdiť, že appka pozná stav shopu (I11). Stavy `needs_key`
> a `missed` musia mať na dashboarde rovnakú naliehavosť (odchýlka D33b), po
> expirácii kľúča prechádza UI do read-only režimu namiesto blokády (D10),
> a orientačná zľavnená cena sa zobrazuje vždy s upozornením na zaokrúhlenie
> shopu (D4). Vlastníš `src/app/layout.tsx`, `globals.css`, `page.tsx`
> a `src/components/{layout,ui,dashboard}/**` — do `src/app/kampane|audit|nastavenia`
> ani do `src/app/api` nezasahuj.

---

## A14 — Docker, compose, Caddy, hardening, zálohy, runbooky

**Vlna:** 2 · **Závisí na:** A0

**Vytvorí:** `Dockerfile` (multi-stage, standalone, non-root uid 10050),
`docker-compose.yml`, `docker-compose.override.example.yml`, `Caddyfile.example`,
`scripts/entrypoint.sh`, `scripts/backup.sh`, `scripts/restore-test.sh`,
`scripts/check-compose-bind.ts`, `.gitleaks.toml`, `README.md` (prepis),
`docs/20-BACKLOG-SHOP-API.md` (obsah z KONTRAKT §I),
`docs/21-RUNBOOKY.md` (prvý setup, trust root certu, upgrade podľa D100,
restore test, panic button runbook, rotácia master key),
`test/unit/compose-bind.spec.ts`.

**Vlastní súbory:** všetky vyššie uvedené (`.gitignore` vlastní A0).

**Akceptačné kritérium:** `docker compose config` je validný; **žiadna** služba
okrem `ovl-zliav-caddy` nemá `ports:` a Caddy publikuje výhradne
`127.0.0.1:3050:3050`; service names sú `ovl-zliav-app`, `ovl-zliav-db`,
`ovl-zliav-caddy` (nikdy `app`/`db`/`caddy`); app kontajner má `read_only: true`,
`tmpfs`, `cap_drop: [ALL]`, `no-new-privileges`, non-root user
a `stop_grace_period: 30s`; entrypoint spustí migrácie migračným userom a pri
nenulovom exite appku nespustí; `backup.sh` používa
`--ignore-table=ovl_zliav.api_key` a rotuje 14 dní; `Caddyfile.example`
neobsahuje žiadny hash ani tajomstvo, len placeholder; `check-compose-bind.ts`
zlyhá, ak niekto pridá `ports:` na app alebo db.

**Ako sa overí:** `docker compose config`, `npm run test -- test/unit/compose-bind`,
`docker compose up -d` + `curl -k https://localhost:3050/api/health` (200)
+ `curl http://127.0.0.1:3000` z hosta (musí zlyhať), `grep -r` v repe na
absenciu tajomstiev.

**PROMPT:**
> Postav prevádzkovú vrstvu Aura Zľavy podľa `docs/11-BUILD-SPEC.md` §10 a §11
> a rozhodnutí D85, D88–D100: Dockerfile (multi-stage, Next.js standalone,
> non-root uid 10050), `docker-compose.yml`, `Caddyfile.example`, entrypoint
> s fail-fast migráciami, zálohovací a restore skript, gitleaks konfiguráciu
> a runbooky. Pozor na pascu z rodiny stackov: service names MUSIA byť
> `ovl-zliav-app`, `ovl-zliav-db`, `ovl-zliav-caddy` — názvy `app`/`db`/`caddy`
> sú zakázané, inak network alias koliduje s iným stackom. Invariant I5: jediný
> publikovaný port je `127.0.0.1:3050` na Caddy, `ovl-zliav-app` a `ovl-zliav-db`
> NESMÚ mať `ports:` vôbec, a napíš k tomu test `check-compose-bind.ts`, ktorý to
> v CI vynúti. Invariant I1: v repe nesmie skončiť žiadne tajomstvo — Caddyfile
> s bcrypt hashom, master key, session key a DB heslá žijú v `secrets/` mimo
> gitu, v repe je len `.example`; záloha DB musí vynechať tabuľku `api_key` (D76).
> Vytvor aj `docs/20-BACKLOG-SHOP-API.md` s obsahom sekcie I z `docs/10-KONTRAKT.md`
> a `docs/21-RUNBOOKY.md` s postupmi prvého setupu, trust root certu, upgradu
> a panic buttonu.

---

## A15 — UI kampaní: zoznam, vytvorenie, dry-run, potvrdenie, detail

**Vlna:** 3 · **Závisí na:** A7, A13 (API kontrakt z BUILD-SPEC §5)

**Vytvorí:** `src/app/kampane/page.tsx`, `src/app/kampane/nova/page.tsx`,
`src/app/kampane/[id]/page.tsx`; `src/components/campaigns/DryRunTable.tsx`,
`ItemsTable.tsx`, `PercentInput.tsx`, `DateRangePicker.tsx`,
`ConfirmPanel.tsx`, `CampaignFilters.tsx`, `ExtendDialog.tsx`,
`RetryFailedButton.tsx`, `AuditTrail.tsx`.

**Vlastní súbory:** `src/app/kampane/**`, `src/components/campaigns/**`.

**Akceptačné kritérium:** vytvorenie kampane je striktne dvojkrokové (dry-run →
samostatné tlačidlo „Zapísať do PRODUKCIE") a v UI neexistuje žiadna cesta
k jednokrokovému zápisu; `PercentInput` prijme len celé čísla 1–30 a ponúka čipy
5/10/15/20/25/30; `DateRangePicker` má presety 7/14/30 dní a „do konca mesiaca"
a pod poľami je výklad „platí od 00:00 dňa OD do 23:59 dňa DO, čas shopu";
`ConfirmPanel` obsahuje vetu o nevratnosti, prepínač eager write (default
zapnutý), potvrdenie pri jednodňovej zľave, diff starý→nový pri prepise
a `SudoPrompt`, ak je od poslednej autentifikácie viac než 15 min; `DryRunTable`
zobrazuje orientačnú cenu s upozornením a varovanie pri `has_attributes`;
`ItemsTable` zobrazuje ✓/✗/neistý per produkt so slovenskou hláškou a raw kódom
a tlačidlo „Zopakovať zlyhané", ktoré vždy prechádza novým dry-runom.

**Ako sa overí:** `npm run build` + Playwright scenáre od A18 (dvojkrok, sudo,
retry, predĺženie).

**PROMPT:**
> Postav UI kampaní Aura Zľavy podľa `docs/11-BUILD-SPEC.md` §8 a rozhodnutí
> D2, D3, D11–D16, D19, D22, D27, D28, D60, D70. Zápis do produkcie je vždy
> dvojkrokový: dry-run diff tabuľka → samostatné tlačidlo „Zapísať do PRODUKCIE",
> a v UI NESMIE existovať žiadna skratka, ktorá by tento krok obišla (I3) —
> vrátane akcie „Zopakovať zlyhané", ktorá musí prejsť novým dry-run potvrdením
> (D16). Lokálne validuj percento (celé číslo 1–30) a okno (`to ≥ from`,
> `from ≥ dnes`, ≤ 3 mesiace) ešte pred odoslaním na server (I9), nikdy sa
> nespoliehaj na chybu z API. Eager write („zapísať hneď s budúcim `from`") je
> default **zapnutý** a potvrdenie musí jasne povedať, že takýto zápis sa už nedá
> zrušiť, len prepísať (D22, odchýlka D33b ho robí hlavnou cestou); rušenie zľavy
> v shope UI NESMIE ponúkať vôbec (I7) — zrušiť sa dá len naplánovaná kampaň.
> Nepoužívaj Server Action na zápis; mutácie posielaj na `/api/campaigns/*` podľa
> §5. Vlastníš `src/app/kampane/**` a `src/components/campaigns/**`.

---

## A16 — UI: login, onboarding, produkty, audit, nastavenia, panic button

**Vlna:** 3 · **Závisí na:** A13 (API kontrakt z BUILD-SPEC §5)

**Vytvorí:** ~~`src/app/login/page.tsx`~~ (zmazané 27. 8. 2026 — D99),
`src/app/onboarding/page.tsx`,
`src/app/produkty/page.tsx`, `src/app/audit/page.tsx`,
`src/app/nastavenia/page.tsx`; `src/components/products/**` (AllowlistTable,
AddProductForm, RefreshButton, MarkUnknownButton);
`src/components/audit/**` (AuditFilters, AuditTable, AuditDetailDrawer);
`src/components/settings/**` (DomainForm, ApiKeyForm, EagerWriteToggle,
UnlockWritesForm, PanicButton).

**Vlastní súbory:** uvedené stránky a komponenty.

**Akceptačné kritérium:** onboarding vedie krokmi 1 doména → 2 kľúč →
3 allowlist → 4 testovací dry-run a končí dry-runom, nie zápisom; `ApiKeyForm`
nikdy nezobrazí kľúč (len `last4`, čas uloženia a odpočet) a po uložení
informuje o dopálených kampaniach; `DomainForm` prijme len `https://` a vyžaduje
heslo + zobrazí výsledok canary testu; `PanicButton` vyžaduje heslo a opísanie
`KLUC UNIKOL`, po vykonaní zobrazí runbook; allowlist blokuje pridanie 11.
produktu a odobranie produktu s plánovanou kampaňou s vysvetlením prečo;
audit má filtre podľa produktu, dátumu, typu a výsledku a detail zobrazuje
`before/after` snapshot a pri nezhode cien príznak „rozhodoval si nad inou cenou".

**Ako sa overí:** `npm run build` + Playwright scenáre od A18 (onboarding,
read-only režim, audit filter, panic button).

**PROMPT:**
> Postav zvyšné stránky Aura Zľavy podľa `docs/11-BUILD-SPEC.md` §8 a rozhodnutí
> D7, D18, D20, D38, D40, D65, D67, D79, D80: login, onboarding checklist,
> správu allowlistu, audit log s filtrami a nastavenia vrátane panic buttonu.
> Onboarding musí ísť v poradí doména → kľúč → allowlist → **testovací dry-run**
> a NESMIE končiť ostrým zápisom (D20). Formulár API kľúča nikdy nezobrazí celý
> kľúč — len posledné 4 znaky, čas uloženia a odpočet do expirácie (I1, D65);
> panic button vyžaduje heslo a opísanie textu `KLUC UNIKOL` a po vykonaní
> zobrazí runbook, že skutočná revokácia je na strane maintainera shopu (D67).
> Allowlist musí fail-closed brániť pridaniu 11. produktu a odobraniu produktu
> s naplánovanou kampaňou, a to s vysvetlením dôvodu (I2, D40); v audit detaile
> musí byť pri nezhode `price_at_preview` a `price_at_write` viditeľný príznak
> „rozhodoval si nad inou cenou" (odchýlka D39c). Nikde netvrď, že appka pozná
> skutočný stav zľavy v shope (I11). Vlastníš uvedené stránky a
> `src/components/{products,audit,settings}/**`.

---

## A17 — Bezpečnostné a invariantné testy (cross-cutting)

**Vlna:** 3 · **Závisí na:** A0–A10, A14

**Vytvorí:** `test/unit/env.spec.ts`, `test/unit/no-clear-reduction.spec.ts`,
`test/unit/no-orders-scope.spec.ts`, `test/integration/migrations.spec.ts`,
`test/integration/audit-append-only.spec.ts`,
`test/integration/boot-assertions.spec.ts`, `test/integration/health.spec.ts`,
`test/integration/allowlist-cap.spec.ts`.

**Vlastní súbory:** uvedené testy (nikdy zdrojové súbory `src/**`).

**Akceptačné kritérium:** každý invariant I1–I14 má aspoň jeden test, ktorý ho
overuje **z vonku** (nie mockom vlastnej implementácie): zod ENV odmietne
`MAX_PRODUCTS_PER_OPERATION=11`, `ALLOWLIST_MAX=11`, `API_KEY_TTL_HOURS=72`
a `PUBLIC_BIND=0.0.0.0`; grep zdrojov nenájde `clearReduction`/`cancelReduction`
voči shopu ani `setReduction` s dátumom v minulosti (I7), ani `/api/order`
či `orders:read` (I8); app DB user nedokáže `UPDATE`/`DELETE` na `audit_log`
(I4); migrácie sú idempotentné a checksum-chránené; 11. aktívny záznam
v allowliste zlyhá na DB constrainte aj pri obídení aplikačnej validácie (I2);
`/api/health` neobsahuje `last4` ani žiadnu hodnotu z denylistu redaktora.

**Ako sa overí:** `npm run test -- test/unit/env test/unit/no-clear-reduction
test/unit/no-orders-scope test/integration/migrations
test/integration/audit-append-only test/integration/boot-assertions
test/integration/health test/integration/allowlist-cap`.

**PROMPT:**
> Napíš cross-cutting bezpečnostné testy, ktoré overujú invarianty I1–I14
> z `docs/10-KONTRAKT.md` §H a testovaciu maticu z `docs/11-BUILD-SPEC.md` §12.
> Testuj **z vonku**: skutočnú zod ENV schému, skutočnú DB s grantmi, skutočné
> zdrojové súbory (grep) a skutočnú `/api/health` odpoveď — nikdy nemockuj to,
> čo máš overiť. Povinné testy: app DB user nesmie mať `UPDATE`/`DELETE` na
> `audit_log` (I4); v zdrojoch nesmie existovať žiadna funkcia rušiaca zľavu ani
> `setReduction` s `to` v minulosti (I7) a žiadna referencia na `/api/order`
> alebo `orders:read` (I8); ENV schéma musí odmietnuť strop nad 10 produktov,
> TTL nad 48 h a `PUBLIC_BIND` iný než `127.0.0.1` (I2, I5, R2); jedenásty
> aktívny záznam v allowliste musí zlyhať aj keď obídeš aplikačnú validáciu a
> vložíš ho priamo do DB (I2). Nepíš ani neupravuj žiadny súbor v `src/**` —
> ak test odhalí chybu, zlyhaj a nahlás ju vo finálnej odpovedi.

---

## A18 — Playwright e2e a CI pipeline

**Vlna:** 3 · **Závisí na:** A11, A12, A13, A15, A16 (kontrakt), A14, A6

**Vytvorí (a preberá):** `playwright.config.ts` (od A0), `test/e2e/onboarding.spec.ts`,
`test/e2e/write-flow.spec.ts`, `test/e2e/readonly-after-expiry.spec.ts`,
`test/e2e/partial-failure-retry.spec.ts`, `test/e2e/audit.spec.ts`,
`test/e2e/panic-button.spec.ts`, `test/e2e/fixtures.ts`,
`.github/workflows/ci.yml`.

**Vlastní súbory:** `playwright.config.ts`, `test/e2e/**`,
`.github/workflows/ci.yml`.

**Akceptačné kritérium:** e2e scenáre pokrývajú: onboarding od nuly po testovací
dry-run; celý zápisový flow vrátane sudo re-auth a dvojkrokového potvrdenia;
read-only režim po expirácii kľúča; čiastočné zlyhanie a „Zopakovať zlyhané";
audit filter + detail s príznakom nezhody cien; panic button. CI na push spustí
`lint`, `typecheck`, `vitest run` (s MariaDB service containerom), `next build`,
`gitleaks` a `npm audit --audit-level=high` a job zlyhá pri high/critical náleze;
CI na PR spustí navyše Playwright; e2e beží výhradne proti mock shopu
(`SHOP_BASE_URL_OVERRIDE` na `127.0.0.1`).

**Ako sa overí:** `npx playwright test` lokálne; `act` alebo skutočný CI run
na feature branchi.

**PROMPT:**
> Napíš Playwright e2e scenáre a CI pipeline pre Aura Zľavy podľa
> `docs/11-BUILD-SPEC.md` §12 a rozhodnutia D99. Scenáre musia pokryť onboarding,
> celý dvojkrokový zápisový flow so sudo re-auth, read-only režim po expirácii
> kľúča, čiastočné zlyhanie s „Zopakovať zlyhané", audit filter s detailom
> a panic button. Invariant I6 je nepodkročiteľný: e2e aj CI bežia **výhradne**
> proti mock shopu na `127.0.0.1` a v žiadnej konfigurácii sa nesmie objaviť
> reálna doména shopu ani reálny API kľúč (I1) — do CI dávaj len syntetické
> hodnoty. CI musí na push spustiť lint, typecheck, vitest s MariaDB service
> containerom, `next build`, `gitleaks` a `npm audit --audit-level=high`
> s blokujúcim výsledkom, a spustiť `scripts/check-compose-bind.ts` (I5).
> Vlastníš `playwright.config.ts` (preberáš stub od A0), `test/e2e/**`
> a `.github/workflows/ci.yml` — do `src/**` ani do iných testov nezasahuj.

---

## A19 — Integračné overenie celého systému

**Vlna:** 4 (sám) · **Závisí na:** A0–A18

**Vytvorí:** `docs/13-OVERENIE.md` (protokol overenia: čo prešlo, čo nie,
zoznam invariantov s dôkazom). Má právo robiť **minimálne** opravy v ľubovoľnom
súbore, ale výhradne také, ktoré odstraňujú zlyhanie buildu, typecheku alebo
testu — žiadne nové funkcie, žiadny refaktor.

**Vlastní súbory:** `docs/13-OVERENIE.md` + krátkodobo právo opravy kdekoľvek
(je sám vo vlne).

**Akceptačné kritérium:**
1. `npm ci` čistý; `npm run lint`, `npm run typecheck`, `npm run build` zelené.
2. `npm run test` (unit + integračné) zelené vrátane všetkých testov
   z invariantnej matice (§12 BUILD-SPEC).
3. `npx playwright test` zelené proti mocku.
4. `docker compose up -d` nabehne, `curl -k https://localhost:3050/api/health`
   vráti 200 so `status:'ok'`, a `curl http://127.0.0.1:3000` z hosta **zlyhá**.
5. `gitleaks detect` bez nálezu; `grep -ri` v repe nenájde reálnu doménu shopu
   ani žiadny API kľúč.
6. Manuálny prechod: onboarding → allowlist 10 produktov → dry-run → zápis
   proti mocku → čiastočné zlyhanie → retry → audit detail s príznakom nezhody
   cien → expirácia kľúča (posun času) → read-only → nový kľúč → dopálenie
   `needs_key` kampane → zmeškaná kampaň zostane `missed` a nespustí sa sama.
7. Protokol v `docs/13-OVERENIE.md` uvádza ku každému invariantu I1–I14 test
   alebo príkaz, ktorý ho dokazuje.

**Ako sa overí:** protokol + výstupy príkazov priložené v jeho finálnej odpovedi.

**PROMPT:**
> Si posledný agent — over, že Aura Zľavy je konzistentný celok, a zapíš
> protokol do `docs/13-OVERENIE.md`. Spusti v tomto poradí `npm ci`,
> `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test`,
> `npx playwright test`, `docker compose up -d` + `curl -k
> https://localhost:3050/api/health`, `gitleaks detect`, a prejdi manuálny
> scenár od onboardingu po dopálenie kampane v stave `needs_key` a overenie, že
> zmeškaná kampaň zostane `missed` a nespustí sa sama (odchýlka D33b). Ku každému
> invariantu I1–I14 z `docs/10-KONTRAKT.md` §H uveď v protokole konkrétny test
> alebo príkaz, ktorý ho dokazuje — obzvlášť I1 (kľúč nikde v repe, logoch ani
> audite), I3 (žiadny zápis bez potvrdenia), I5 (jediný publikovaný port
> `127.0.0.1:3050`) a I6 (testy len proti mocku). Opravovať smieš len to, čo
> bráni zelenému buildu/typecheku/testu — žiadne nové funkcie ani refaktor;
> všetko ostatné, čo nájdeš, zapíš ako zistenie do protokolu a do svojej
> finálnej odpovede.

---

## 2. Zhrnutie vlastníctva súborov (kontrola kolízií)

| Cesta | Vlastník |
| --- | --- |
| `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `.gitignore`, `.env.example` | A0 |
| `src/env.ts`, `src/version.ts`, `src/contracts.ts`, `src/instrumentation.ts`, `src/db/**` | A0 |
| `db/migrations/**`, `scripts/migrate.ts`, `scripts/gen-master-key.ts`, `scripts/seed-admin.ts` | A0 |
| `test/setup.ts`, `test/helpers/db.ts` | A0 |
| `src/lib/crypto/**`, `src/lib/repo/api-key.repo.ts` | A1 |
| `src/lib/log/**`, `src/lib/audit/**`, `src/lib/repo/audit.repo.ts` | A2 |
| `src/lib/shop/**` | A3 |
| `src/lib/auth/**` (od 27. 8. 2026 len `local-actor.ts`, D102), `src/lib/repo/users.repo.ts`; ~~`src/lib/repo/login-attempts.repo.ts`~~ zmazané (D99) | A4 |
| `src/lib/http/**` | A5 |
| `test/mock-shop/**`, `test/helpers/mock.ts`, `test/helpers/factories.ts` | A6 |
| `src/lib/domain/**` | A7 |
| `src/lib/repo/{settings,allowlist,catalog,campaigns,campaign-items,scheduler-state}.repo.ts` | A8 |
| `src/lib/engine/**` | A9 |
| `src/lib/scheduler/**` (`boot.ts` prebrané od A0) | A10 |
| `src/app/api/{settings,key,health}/**`; ~~`src/app/api/auth/**`~~ zmazané 27. 8. 2026 (D99, D100) | A11 |
| `src/app/api/{campaigns,allowlist,catalog,audit,notifications}/**` | A12 |
| `src/app/{layout.tsx,globals.css,page.tsx}`, `src/components/{layout,ui,dashboard}/**`, `src/lib/ui/format.ts` | A13 |
| `Dockerfile`, `docker-compose*.yml`, `Caddyfile.example`, `scripts/{entrypoint.sh,backup.sh,restore-test.sh,check-compose-bind.ts}`, `.gitleaks.toml`, `README.md`, `docs/20-*`, `docs/21-*` | A14 |
| `src/app/kampane/**`, `src/components/campaigns/**` | A15 |
| `src/app/{login,onboarding,produkty,audit,nastavenia}/**`, `src/components/{products,audit,settings}/**` | A16 |
| `test/unit/{env,no-clear-reduction,no-orders-scope}.spec.ts`, `test/integration/{migrations,audit-append-only,boot-assertions,health,allowlist-cap}.spec.ts` | A17 |
| `playwright.config.ts` (prebrané od A0), `test/e2e/**`, `.github/workflows/ci.yml` | A18 |
| `docs/13-OVERENIE.md` | A19 |

Testy, ktoré vlastní implementačná úloha (nie A17/A18): `test/unit/crypto*`,
`preview-token` (A1); `redact` (A2); `shop-*` (A3); `auth` (A4);
`define-route` (A5); `dates`/`percent`/`campaign-rules`/`status` (A7);
`repo` (A8); `guards`, `executor`, `sequential-writes`, `runaway-lock`,
`deviation-39`, `redaction` (A9); `scheduler`, `deviation-33`, `ttl-wipe`,
`reconcile` (A10); `routes-auth`/`routes-key`/`routes-settings` (A11);
`routes-campaigns`, `no-write-without-confirm` (A12); `compose-bind` (A14).

## 3. Otvorené body pre Samuela (neblokujú implementáciu)

| # | Bod | Predvolené správanie |
| --- | --- | --- |
| 1 | Presné argon2id parametre „podľa sperky-ai" (D68) — nemáme ich čísla v tomto repe. | A4 použije OWASP odporúčanie (m=19456 KiB, t=2, p=1) a zapíše to do `docs/13-OVERENIE.md` na neskoršie zladenie. |
| 2 | Meno admin používateľa a prvé heslo. | `scripts/seed-admin.ts` sa spustí interaktívne pri prvom setupe; nič sa nezapisuje do repa. |
| 3 | Konkrétne product ID prvej desiatky allowlistu. | Zadá sa v UI pri onboardingu; v repe nie sú žiadne ID. |
| 4 | Verzia pre `User-Agent` (`aura-zlavy/<verzia>`). | `APP_VERSION` z `package.json`, začína na `0.1.0`. |
