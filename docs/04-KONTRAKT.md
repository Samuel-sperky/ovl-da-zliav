# OVL-DA-ZLIAV — Kontrakt a sprint plán („Aura Zľavy")

**Dátum:** 2026-08-18
**Repo:** `ovl-da-zliav` · **Zobrazovaný názov v UI:** „Aura Zľavy"
**Stack:** Laravel (PHP 8.4) + Blade + Livewire · **MariaDB 11.4** (kontajner `ovl-zliav-db`)
**Beh:** lokálne `127.0.0.1:3050`, bez Caddy, kontajner `ovl-zliav-app`, cookie `ovl_zliav_session`
**Cieľ zápisu:** produkčný `https://sperky-eshop.sk` (žiadny staging)
**Podklady (v poradí priority):** `03-ODPOVEDE.md` > `02-DOTAZNIK.md` (riadok „Návrh:") > `01-ROZHODNUTIA.md` > `api/sperky-api.md`

> Tento dokument je záväzný kontrakt pre implementáciu. Odpovede zadávateľa (`03-ODPOVEDE.md`) majú prednosť pred defaultmi. Nezodpovedané body idú podľa navrhnutého defaultu z dotazníka.

---

## 1) Účel a rozsah

### Čo appka robí
„Aura Zľavy" je lokálny operátorský nástroj na **riadené nasadzovanie percentuálnych zliav** na produkty eshopu `sperky-eshop.sk` cez jeho API. Umožňuje:

- **Vyhľadať a vybrať produkty** (fuzzy `searchIndex`, filtrovaný `search`, priame `id`/CSV import).
- **Zostaviť dávku zmien** („košík zmien") s jedným % + oknom na celú dávku a s override na jednotlivom riadku.
- **Spustiť povinný dry-run** — diff tabuľku „pred → po" s maržou po zľave, konfliktmi a varovaniami.
- **Zapísať naostro** až po dvojkrokovom potvrdení (nad strop prepis počtu N / kontrolného slova), throttlovane, s read-after-write overením a plným auditom.
- **Plánovať kampane** (koncept → armovanie so zmrazením + snapshotom → scheduler s re-validáciou driftu tesne pred zápisom).
- **Rušiť zľavy** (`clearReduction`) rovnakým chráneným tokom, vrátane núdzového zrušenia všetkých appkou nasadených zliav.
- **Radiť „čo zlevniť"** (ležiaky) z agregátov objednávok — len návrh, vždy cez dry-run.
- **Auditovať** každý zásah (append-only + hash-reťaz, snapshot pred/po, redigovaná odpoveď) a exportovať do CSV/JSON.

### Čo appka výslovne NErobí
- **Nemení fixné cenové akcie** — na eshope existujú len percentuálne zľavy (Q18); `setReduction` neprepisuje žiadnu cudziu fixnú akciu (rizikový bod A uzavretý).
- **Nezapisuje atomicky ani nerobí rollback** — pri čiastočnom zlyhaní iba kompenzuje zo snapshotu.
- **Nemaže API kľúč** — kľúč žije v `.env`, appka ho nikdy sama neodstráni.
- **Neukladá PII z objednávok** — žiadne `total_paid` na objednávku, žiadne `country`/`country_iso` viazané na osobu, žiadne identifikátory objednávok; len agregáty na produkt.
- **Neposkytuje UI na prezeranie jednotlivých objednávok** — len agregované pohľady.
- **Nezapisuje premeškané okná ticho spätne** — ponúkne dobehnúť alebo zrušiť.
- **Nedelí okno > 3 mesiace automaticky** — tvrdo odmietne s hláškou (žiadne reťazenie okien vo v1).
- **Nerieši varianty samostatne** — `setReduction` je na produkt; % platí na celý produkt vrátane variantov.
- **Neregistruje účty ani reset hesla e-mailom** — jeden lokálny operátor.
- **Nebeží garantovane 24/7** — lokálny stroj; kampaň sa spustí len keď PC beží (heartbeat + kontrola premeškaných okien).

---

## 2) Bezpečnostný model

### Dry-run ako povinný default
Každá operácia meniaca cenu (`setReduction`, `clearReduction`) beží **najprv ako dry-run**. Appka nikdy nezapíše bez toho, aby operátor videl presný diff a explicitne potvrdil. Dry-run nepotrebuje sieť pre výpočet odhadu ceny (`price × (1 − %/100)`); skutočnú cenu potvrdí `getFull` až po zápise (zaokrúhľovanie je na strane shopu).

### Stropy a kill-switch (Q45 — všetky tri poistky)
- **Strop na dávku** (konfigurovateľný) — max. počet produktov v jednej dávke.
- **Denný strop** zapísaných produktov — zladený s `whoami.remaining.per_day`.
- **Globálny kill-switch / maintenance flag** — blokuje všetky reálne zápisy (manuál aj scheduler); scheduler beží len ak je kampaň armovaná, kľúč platný a kill-switch vypnutý.
- **Núdzové zrušenie** všetkých appkou nasadených zliav jedným tokom (cez `clearReduction`, evidované appkou, chránené potvrdením a auditom).
- Viditeľný indikátor **„PRODUKCIA"** v UI.

### Min-margin guard (Q25 — tvrdý blok)
Dry-run počíta post-zľavovú maržu z `getFull`. Položky pod konfigurovateľným minimom marže (**default 15 %**) sú **tvrdo zablokované**. Prejsť sa dá len explicitným **override s povinným dôvodom**, ktorý sa zapíše do auditu.

### Potvrdzovacia frikcia (Q5 — dvojkrok)
- Tlačidlo sa mení z „Zobraziť náhľad" na červené „Zapísať naostro (N produktov)".
- Nad konfigurovateľný strop (default **50**) treba **prepísať počet N alebo kontrolné slovo** + zobrazené počítadlo.

### Rate a throttling
Zápisy (`setReduction`/`clearReduction`) **nie sú batchable** → N produktov = N requestov 1:1. Idú cez **jeden queue worker** s `WithoutOverlapping`, throttlované z **`whoami.remaining` (`per_minute` aj `per_day`)** cez centrálny token-bucket (Laravel `RateLimiter`). Pri vyčerpaní `release()` s oneskorením; `429/rate_limited` rešpektuje `Retry-After` + exponenciálny backoff.

### API kľúč (Q41)
- Len v `.env` (`chmod 600`, mimo gitu), **nikdy nelogovať, nikdy do auditu**.
- V UI maskovaný (posledné 4 znaky).
- `key_set_at` v DB (nie kľúč) → UI pripomienka rotácie po 48 h (výrazná pri < 24 h).
- Ak `expires_at = null`, 48 h pripomienka sa riadi lokálnym `key_set_at`.
- Pred uložením requestu/odpovede odstrániť auth hlavičky (`X-Api-Key`, `Authorization`) a zákaznícke polia.

### Autentifikácia (Q38)
- Vlastný **lokálny login** (Laravel auth), **jeden účet**, **hash hesla v `.env`**.
- **Auto-zámok** po nečinnosti; **re-auth pred reálnym zápisom**.
- Žiadna registrácia, žiadny reset cez e-mail.
- Dátový model a UI pripravené na budúcu rolu „read-only" (v1 jeden operátor s plnými právami).

### Ochrana lokálneho HTTP (Q39)
- Middleware validuje **`Host`** (len `127.0.0.1`/`localhost:3050`) a **`Origin`/`Referer`** pri stavových požiadavkách — cudzie odmietnuť (obrana proti DNS-rebinding/CSRF).
- **`VerifyCsrfToken`** na všetkých write routách.
- Cookie `ovl_zliav_session`: **`HttpOnly` + `SameSite=Strict`**, krátka životnosť.
- **`Secure` flag vypnutý** (plain `http://127.0.0.1` by cookie nepustil) — kompenzované Host/Origin kontrolou.

### Fail-closed politika
- Bez úspešného `whoami` pingu je zápis zablokovaný.
- `403 forbidden` počas behu = **fail-closed** (zastaviť, upozorniť), nikdy neretryovať donekonečna.
- Po expiry kľúča → read-only režim (verejné katalógové čítanie funguje ďalej).

---

## 3) Použitie API

Base URL v `.env`; auth cez `X-Api-Key` (alt. `Authorization: Bearer`). Cieľ = produkčný `https://sperky-eshop.sk`.

| Endpoint | Verb | Účel v appke | Scope | Poznámka |
|---|---|---|---|---|
| `/api/whoami` | GET | Štart + pred každou dávkou: dostupnosť, `scopes`, `expires_at`, `remaining` | ktorýkoľvek platný kľúč | Zdroj rate budgetu (`per_minute`, `per_day`); `per_day` môže byť `null`; fail-closed bez pingu |
| `/api/products` | GET | Jednoduché stránkovanie katalógu | verejné | Vracia `id,name,price,has_attributes` |
| `/api/products/get` | GET | Rozpoznanie čistého čísla ako `id`, verejný fallback detailu | verejné | Menej polí, bez marže |
| `/api/products/searchIndex` | GET | Fuzzy/relevance vyhľadávanie (Meili), okamžité | verejné | Vracia len `id[]`; **nie je batchable**; len filtre `active`/`price` |
| `/api/products/search` | GET | Filtrovaný/sortovaný výber (kategórie, cena, `onlyDiscounted`) | `product:read` | Vracia len `id[]`; **nie je batchable** |
| `/api/products/getFull` | GET | **Zdroj pravdy** pre náhľad, snapshot pred/po, re-validáciu, read-after-write | `product:read` | **Batchovateľný cez `/api/batch`**; max. počet na batch doc neuvádza → konzervatívna dávka, pri `batch_not_allowed`/`403` degradovať na sekvenčné |
| `/api/categories` | GET | Číselník kategórií pre filtre | `product:read` | `id` zodpovedajú `getFull.categories` |
| `/api/products/setReduction` | POST | Nastavenie percentuálnej zľavy | `product:edit` | **Jednotlivo**, 1:1 rate-cost; `reduction 0–30`, okno ≤ 3 mes.; `409 blocked_by_flash_sale` = skip |
| `/api/products/clearReduction` | POST | Zrušenie zľavy / kompenzácia / núdzové zrušenie | `product:edit` | **Jednotlivo**; rovnaké `409` obmedzenie ako `setReduction` |
| `/api/order` | GET | Agregácia predajnosti pre odporúčania | `orders:read` | Len agregáty na produkt, PII zahodiť po agregácii |
| `/api/order/get` | GET | Doplnenie položiek objednávky pri agregácii | `orders:read` | `HTTP 200 + ok:false + error` (singulárny) — ošetriť; žiadne PII neukladať |

### Normalizácia odpovedí (Q37)
Jediný **normalizér** mapuje všetky tvary na kanonický `{success, data, errorCodes[]}`:
- **rozbaliť `result` obal, ak je prítomný**, inak čítať top-level;
- zjednotiť singulárny `error` aj `errors[]`;
- ošetriť `200 + ok:false` (napr. `order/get`, `setReduction` chyby bez obalu);
- tolerantné parsovanie (ignorovať neznáme polia, validovať povinné), logovať neznáme error kódy (bez PII).

### Retry politika (Q35)
- HTTP klient (Guzzle): connect-timeout ~5 s, request-timeout ~15 s.
- Retry **len** na `429 rate_limited` (podľa `Retry-After`) a `5xx request_failed` (exponenciálny backoff, max pokusov).
- `4xx` okrem `429` **neretryovať**: `400 invalid_input/invalid_dates/invalid_reduction/range_too_long`, `403 forbidden/batch_not_allowed`, `404`, `405 method_not_allowed`.
- `409 blocked_by_flash_sale` → **skip** položky (`skipped_flash_sale`), pokračovať v dávke.

### Pre-flight validácia (Q29)
Pred akýmkoľvek volaním tvrdo (UI **aj** server-side): `0 < reduction ≤ 30` (krok 0,5 %; nulu/prázdne odmietnuť — pre nulu `clearReduction`), `to ≥ from`, okno ≤ 3 mesiace, formát `YYYY-MM-DD`. Nevalidnú položku vôbec neposielať.

---

## 4) Dátový model (MariaDB)

Cudzie kľúče a `operation_id` prepájajú kampaň → operáciu → položku → audit → snapshot.

### `settings`
Prevádzkové parametre editovateľné v UI (`.env` fallback), zmeny auditované: strop dávky, denný strop, min. marža (default 15 %), rate rezerva, TTL retencie (90 d), kill-switch flag, `key_set_at`, SMTP, TZ (`Europe/Bratislava`), tolerancia driftu, kontrolné slovo/strop potvrdenia (default 50).

### `products_cache`
Cache katalógu (~5 min TTL na `search`/`searchIndex`): `id`, `name`, `price`, `has_attributes`, `fetched_at`. Nikdy nie autorita o zľave — stav zľavy sa berie živo z `getFull`.

### `campaigns`
`id`, `name`, typ množiny (statický `id[]` / uložený filter), `reduction`, `from`, `to`, **stav** (`koncept/armovaná/beží/hotová/zrušená`), zmrazený rozvinutý zoznam pri armovaní, potvrdený dry-run snapshot, aktér, timestampy (UTC).

### `operations` (dávka)
`id`, zdroj (`manual`/`scheduler`), `campaign_id?`, typ (`set`/`clear`/`compensate`), dry-run vs. reálne, súhrn (počty), aktér, timestampy.

### `operation_items` (položka + stavový automat)
`id`, `operation_id`, `product_id`, `from`, `to`, `reduction`, override (%, dôvod), **stav**:

```
pending → dry_run_ok → awaiting_confirm → queued → sent → verified
vetvy: failed · compensated · skipped_flash_sale · skipped_low_margin · uncertain
```

Dedup kľúč (`id`, `from`, `to`, `reduction`). Prechody logované do auditu. Deterministické poradie zápisu podľa `product_id` vzostupne (Q30).

### `audit_log` (append-only, hash-reťaz)
Jeden riadok = jedna operácia. Obsah: aktér, zdroj, timestamp (UTC + pásmo shopu), dry-run/reálne, akcia, `product_id`, `operation_id`, väzba na pred/po snapshot, zaslané parametre (**bez kľúča**), redigovaná odpoveď, výsledok, override marže + dôvod, **`hash_prev` + `hash_self`** (tamper-evidencia), **`schema_version`**. Žiadne `UPDATE`/`DELETE` z appky. Bez PII — natrvalo.

### `snapshots`
`getFull` JSON tesne **pred** a **po** zápise, naviazané na `operation_item`: `reduction_percent/from/to`, `margin`, `margin_percent`, `sell_price_with_vat`, `active`, `qty` + vypočítaný diff kľúčových polí, `schema_version`. TTL ~90 dní.

### `api_responses` (redigované)
Uložené odpovede API bez auth hlavičiek a bez zákazníckych polí — len to, čo treba na audit zmeny ceny. TTL ~90 dní.

### `order_aggregates` (bez PII, TTL 90 d)
Agregáty na produkt pre odporúčania: predané ks, `qty_in_orders`, `last_time_in_order`, rýchlosť predaja. **Žiadne** `total_paid` na objednávku, `country`, ani identifikátory objednávok. Surové riadky po agregácii zahodiť. Auto-mazanie po 90 dňoch, export pred čistkou.

---

## 5) Kľúčové toky

### (a) Manuálna dávka
1. **Výber** produktov (search/filter/`id`/CSV) → perzistentný košík zmien; jedno % + okno, override na riadku.
2. **Dry-run**: batch `getFull` (pred-stav), výpočet marže po zľave, detekcia konfliktov/flash sale/nízkej marže/neaktívnych → **diff tabuľka „pred → po"** so súhrnom.
3. Min-margin **tvrdý blok** (override s dôvodom → audit); konflikt cudzej zľavy default = Preskočiť.
4. **Potvrdenie** (dvojkrok; nad 50 prepis N/slova) + re-auth.
5. **Throttlovaný zápis**: joby do `database` queue, jeden worker, `WithoutOverlapping`, tempo z `whoami.remaining`, deterministické poradie.
6. **Read-after-write**: po každom zápise `getFull`, overiť `reduction_percent/from/to`; nezhoda = drift/`uncertain`.
7. **Audit** každého prechodu + snapshot pred/po.
8. **Kompenzácia pri čiastočnom zlyhaní** (Q23): operátor volí „Dokončiť zvyšné" alebo „Vrátiť už zapísané cez `clearReduction`" (do stavu zo snapshotu), obe s náhľadom a auditom.

### (b) Kampaň
1. **Koncept**: názov + množina (statická `id[]` / uložený filter) + `reduction` + okno + stav `koncept`.
2. **Armovanie**: dynamická množina sa **rozvinie a zmrazí**; uloží sa potvrdený dry-run snapshot; kontrola **prekryvu okna** na tom istom produkte → **blokovať** (zlúčiť/upraviť/zrušiť jednu); kontrola `expires_at` vs. čas behu → blokovať/varovať; stav `armovaná` = explicitný súhlas pre scheduler.
3. **Scheduler** (`schedule:work`): v čase behu **re-validácia driftu cez `getFull`** (marža pod prah, flash sale, `active=false`); rizikové položky **pozastaviť + notifikovať**, zvyšok **zapísať**; premeškané okná nikdy nezapísať ticho spätne.
4. **Zápis** rovnakým throttlovaným tokom + read-after-write + audit. Prirodzený koniec = spoľahnúť sa na `reduction_to` (žiadny zápis).

### (c) Reconciliation sweep (Q52)
Naplánovaný job porovná posledný známy stav aktívnych/nedávnych položiek s `getFull`, označí drift na vyriešenie (dopĺňa read-after-write). Po expirácii okna rieši reziduálnu zľavu cez `clearReduction`.

### (d) Núdzové zrušenie
Jedno tlačidlo → zostaví operáciu `clear` nad **všetkými appkou nasadenými aktívnymi zľavami**, prejde dry-runom, potvrdením a throttlovaným zápisom; `409` položky preskočí a nahlási; plne auditované.

---

## 6) GDPR

- **Ukladá sa:** agregáty na produkt (predané ks, `qty_in_orders`, `last_time_in_order`, rýchlosť predaja), snapshoty `getFull` (cenové/maржové polia produktu, bez zákazníckych dát), redigované odpovede API, audit zmien cien.
- **Neukladá sa:** `total_paid` na objednávku, `country`/`country_iso` viazané na osobu, identifikátory objednávok s PII, žiadne surové riadky objednávok po agregácii, žiadny API kľúč.
- **Retencia:** audit **natrvalo** (bez PII); agregáty a snapshoty **~90 dní** s auto-mazaním.
- **Obmedzenie účelu:** volania `order/*` viazané **výhradne** na funkciu odporúčaní; žiadne UI na jednotlivé objednávky.
- **Export:** audit + snapshoty do CSV **aj** JSON s filtrom (dátum, produkt, aktér, dry-run/reálne), bez PII; **automatický export pred spustením GDPR čistky** agregátov.

---

## 7) Nasadenie

- **`docker-compose.yml`**: `ovl-zliav-app` + `ovl-zliav-db` (**MariaDB 11.4**), sieť, volume pre DB.
- **Entrypoint pod ľahkým supervízorom** (s6/supervisord) v `ovl-zliav-app`, tri procesy:
  - web (`php-fpm`/`artisan serve`) na porte **3050**,
  - `php artisan queue:work` (jeden worker, `database` driver nad MariaDB),
  - `php artisan schedule:work`.
- **`.env.example`** so všetkými kľúčmi: base URL, API kľúč placeholder, TZ (`Europe/Bratislava`), hash hesla operátora, DB pripojenie na `ovl-zliav-db`, stropy (dávka, denný, min. marža, potvrdenie), cookie/session nastavenia.
- **Migrácie pri štarte** kontajnera (`migrate --force`); auditné/snapshot tabuľky len **aditívne** zmeny, `schema_version` na čitateľnosť starých záznamov (Q56).
- **Zálohy DB**: `mysqldump`/`mariadb-dump` denne + pred každou migráciou, zálohy mimo repozitára, retencia N dní, overená obnova (Q57).
- Zdokumentovať, že **stroj musí bežať v čase kampane** (lokálna appka nemá garantovaný 24/7 beh); heartbeat panel varuje pri zastaranom stave.

---

## 8) Testovacia stratégia

- **Mock API klient** (fake HTTP handler) pokrývajúci **všetky tvary a kódy**: `result` obal, top-level chyby, `setReduction`/`clearReduction` `{"ok":false,"errors":[...]}`, `order/get` `200+ok:false`, `409 blocked_by_flash_sale`, `429 rate_limited` + `Retry-After`, `range_too_long`, `invalid_reduction`, `403 forbidden`, čiastočné zlyhanie dávky, drift pri read-after-write.
- **Dry-run testovateľný bez siete** (čistý výpočet odhadu ceny/marže).
- **Žiadne reálne volania v CI** — všetky testy proti mocku.
- Gate testy: dry-run vs. reálny zápis, min-margin blok + override, prekryv kampaní, kompenzácia, hash-reťaz auditu, normalizér, rate-limiter, pre-flight validácia.
- Reálny beh len manuálne (opatrne, malá vzorka) pred produkčným ostrým nasadením.

---

## 9) SPRINT PLÁN

11 balíčkov pre paralelných implementačných agentov. **Vlna 0** (P1) je základ bez závislostí; ostatné vlny bežia paralelne podľa závislostí.

### P1 — Skeleton + config + Docker
- **Dodá:** Laravel 12/PHP 8.4 skeleton, Livewire, `docker-compose.yml` (`ovl-zliav-app` + `ovl-zliav-db` MariaDB 11.4), entrypoint/supervisord (web:3050 + queue:work + schedule:work), `.env.example`, `config/sperky.php` (base URL, stropy, TZ), skeleton `settings` čítania.
- **Súbory:** `docker-compose.yml`, `docker/entrypoint.sh`, `docker/supervisord.conf`, `.env.example`, `config/sperky.php`, `composer.json`.
- **Závislosti:** žiadne (vlna 0).
- **DoD:** `docker compose up` naštartuje 3 procesy, web odpovie na `127.0.0.1:3050`, `.env.example` kompletný.

### P2 — DB migrácie + modely
- **Dodá:** migrácie a Eloquent modely pre `settings`, `products_cache`, `campaigns`, `operations`, `operation_items` (stavový automat), `audit_log` (hash-reťaz + `schema_version`), `snapshots`, `api_responses`, `order_aggregates`; FK a `operation_id` väzby; enum stavov; aditívna migračná politika.
- **Súbory:** `database/migrations/*`, `app/Models/*`, `app/Enums/ItemState.php`.
- **Závislosti:** P1.
- **DoD:** `migrate` prejde na MariaDB, modely + vzťahy pokryté factory/unit testom, stavový automat vynucuje povolené prechody.

### P3 — API klient + normalizér + rate-limiter
- **Dodá:** Guzzle klient (timeouty, auth hlavička z `.env`), **normalizér** (`result` obal, `error`/`errors[]`, `200+ok:false`) → `{success,data,errorCodes[]}`, retry (429/5xx, `Retry-After`, backoff), token-bucket z `whoami.remaining` (per_minute+per_day), `/api/batch` getFull wrapper s degradáciou na sekvenčné, `whoami` health-check, redakcia hlavičiek.
- **Súbory:** `app/Services/Api/SperkyClient.php`, `ResponseNormalizer.php`, `RateBudget.php`, `WhoamiService.php`, `app/Services/Api/Contracts/*`.
- **Závislosti:** P1 (+ P2 pre `settings`/redakciu do `api_responses`).
- **DoD:** mock handler pokrýva všetky tvary/kódy, normalizér zjednotí odpovede, rate-limiter throttluje podľa `remaining`, žiadny kľúč v logoch.

### P4 — Dry-run + dávkový engine + kompenzácia
- **Dodá:** dry-run výpočet (odhad ceny/marže z `getFull`), diff builder „pred → po", pre-flight validácia (0–30, krok 0,5, okno ≤ 3 mes.), min-margin **tvrdý blok** + override, detekcia konfliktu cudzej zľavy (default skip), throttlované joby (`WithoutOverlapping`, deterministické poradie), read-after-write, dedup, kompenzačný tok (dokončiť/vrátiť), `409` skip.
- **Súbory:** `app/Services/Batch/DryRunService.php`, `DiffBuilder.php`, `MarginGuard.php`, `app/Jobs/ApplyReductionJob.php`, `ClearReductionJob.php`, `CompensationService.php`, `app/Rules/*`.
- **Závislosti:** P2, P3.
- **DoD:** dry-run bez siete, min-margin blok + override auditovaný, čiastočné zlyhanie ponúkne kompenzáciu zo snapshotu, read-after-write deteguje drift.

### P5 — Kampane + scheduler + drift
- **Dodá:** model kampane (statická/dynamická množina), armovanie (rozvinutie + zmrazenie + uložený dry-run snapshot), **blokovanie prekryvu** okna, kontrola `expires_at` vs. beh, `schedule:work` úlohy s re-validáciou driftu cez `getFull` (pozastaviť rizikové + notifikovať, zvyšok zapísať), kontrola premeškaných okien (dobehnúť/zrušiť, nikdy ticho), heartbeat evidencia.
- **Súbory:** `app/Services/Campaign/*`, `app/Console/Kernel.php` (schedule), `app/Jobs/RunCampaignJob.php`, `DriftRevalidator.php`, `HeartbeatService.php`.
- **Závislosti:** P4.
- **DoD:** armovanie zmrazí množinu + zablokuje prekryv, scheduler re-validuje pred zápisom, premeškané okno sa nikdy nezapíše ticho spätne.

### P6 — Audit + snapshoty + export
- **Dodá:** append-only zápis auditu s hash-reťazou (`hash_prev`/`hash_self`), snapshot pred/po naviazaný na `operation_item` + diff, redakcia odpovedí do `api_responses`, verifikátor integrity reťaze, export CSV/JSON s filtrom (bez PII), automatický export pred GDPR čistkou.
- **Súbory:** `app/Services/Audit/AuditRecorder.php`, `HashChain.php`, `SnapshotService.php`, `app/Services/Export/AuditExporter.php`.
- **Závislosti:** P2 (+ P3 pre redakciu).
- **DoD:** každý prechod stavu zapíše audit, hash-reťaz overiteľná, žiadny kľúč/PII v exporte, export beží pred čistkou.

### P7 — Auth + bezpečnostný middleware
- **Dodá:** lokálny login (jeden účet, hash v `.env`), auto-zámok, re-auth pred zápisom, Host/Origin middleware, CSRF na write routách, cookie `ovl_zliav_session` (`HttpOnly`+`SameSite=Strict`, bez `Secure`), globálny kill-switch middleware, denný strop guard, fail-closed na `403`.
- **Súbory:** `app/Http/Middleware/VerifyLocalHost.php`, `RequireReauthForWrite.php`, `KillSwitch.php`, `DailyCapGuard.php`, `app/Http/Controllers/Auth/*`, `config/session.php`.
- **Závislosti:** P1 (+ P2 pre `settings`/kill-switch flag).
- **DoD:** cudzí Origin/Host odmietnutý, zápis vyžaduje re-auth, kill-switch zablokuje manuál aj scheduler, cookie bez Secure funguje na http.

### P8 — UI dashboard + vyhľadávanie + dry-run tabuľka (Livewire)
- **Dodá:** 3-pásmový dashboard (aktívne/expirujúce/naplánované) + stavový prúžok kľúča a rate-limitu, fuzzy + filtrované vyhľadávanie s košíkom zmien (jedno % + override na riadku), dry-run diff tabuľka so súhrnom a varovaniami, dvojkrokové potvrdenie (prepis N/slova nad 50), živý priebeh dávky s pollingom + núdzový stop, rýchle akcie na riadku, widget kľúča + bannery, prehliadač auditu, onboarding sprievodca (doména → kľúč → whoami ping → heslo → TZ), heartbeat panel. Plne responzívne + WCAG 2.1 AA.
- **Súbory:** `app/Livewire/*` (Dashboard, ProductSearch, ChangeCart, DryRunTable, BatchProgress, AuditBrowser, Onboarding, KeyWidget), `resources/views/livewire/*`, `resources/css/*`.
- **Závislosti:** P4, P6, P7 (+ P3 pre vyhľadávanie, P5 pre kampane).
- **DoD:** dashboard číta 3 pásma, dry-run tabuľka „pred→po" so súhrnom, dvojkrok nad 50 vynútený, priebeh + stop funguje, WCAG AA (kontrast, klávesnica, focus, stav nielen farbou), responzívne.

### P9 — Odporúčania + GDPR agregácie
- **Dodá:** agregácia `order/*` na produkt (predané ks, `qty_in_orders`, `last_time_in_order`, rýchlosť) **bez PII**, návrhový pohľad „čo zlevniť" (ležiaky + pravidlá `margin ≥ X`, `qty > 0`, `last_time_in_order` do N dní), založenie kampane z návrhu (vždy dry-run), TTL 90 d auto-mazanie + export pred čistkou.
- **Súbory:** `app/Services/Recommend/*`, `app/Jobs/AggregateOrdersJob.php`, `app/Jobs/PurgeExpiredAggregatesJob.php`, `app/Livewire/Recommendations.php`.
- **Závislosti:** P3, P2 (+ P8 pre pohľad, P4 pre založenie kampane cez dry-run).
- **DoD:** agregácia neukladá žiadne PII, návrh vždy prechádza dry-runom, čistka po 90 d s predchádzajúcim exportom.

### P10 — i18n + SK formáty + error mapping
- **Dodá:** SK reťazce v Laravel `lang/` (nie natvrdo v Blade), centrálny prekladač error kód → SK veta + odporúčaná akcia (zdieľaný UI + notifikáciami + auditom), SK formáty (`19,99 €`, `-15 %`, `DD.MM.YYYY`, TZ `Europe/Bratislava`, UTC uloženie).
- **Súbory:** `lang/sk/*`, `app/Services/I18n/ErrorTranslator.php`, `app/Support/Format.php`, Blade helpery/direktívy.
- **Závislosti:** P1 (konzumuje ho P8/P9); error kódy z P3.
- **DoD:** žiadny natvrdo napísaný SK text v Blade, každý API error kód má SK preklad + akciu, formáty peňazí/dátumov/percent podľa SK konvencie.

### P11 — Testy
- **Dodá:** mock API klient so všetkými tvarmi/kódmi, feature/kontraktné testy (dry-run gate, min-margin, prekryv, kompenzácia, drift, hash-reťaz, normalizér, rate-limiter, pre-flight), CI konfigurácia **bez reálnych volaní**.
- **Súbory:** `tests/Feature/*`, `tests/Unit/*`, `tests/Support/FakeSperkyApi.php`, `.github/workflows/ci.yml`.
- **Závislosti:** priebežne P2–P10 (finalizácia po nich).
- **DoD:** CI zelené bez siete, mock pokrýva každý tvar/kód, edge-cases (409/429/200+ok:false/čiastočné zlyhanie/drift) otestované.

### Poradie a vlny
- **Vlna 0:** P1.
- **Vlna 1 (paralelne po P1):** P2, P7, P10.
- **Vlna 2 (paralelne):** P3 (po P1/P2), P6 (po P2).
- **Vlna 3:** P4 (po P2/P3), P9 (po P2/P3).
- **Vlna 4:** P5 (po P4).
- **Vlna 5:** P8 (po P4/P5/P6/P7).
- **Priebežne/finálne:** P11.
