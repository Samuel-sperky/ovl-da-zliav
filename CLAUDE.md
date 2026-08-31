@AGENTS.md

# Aura Zľavy — orientácia

Lokálna appka na časovo obmedzené percentuálne zľavy v eshope Šperky.
**Píše do PRODUKČNÉHO shopu bez stagingu.** Invarianty I1–I14 v
`docs/10-KONTRAKT.md` sú nadradené všetkému ostatnému; keď si nie si istý,
invariant vyhráva.

Beží na `http://localhost:3070` za Caddy (HTTP bez TLS je vedomá voľba,
6. 8. 2026; v prehliadači používaj `localhost`, nie `127.0.0.1` — dôvod je HSTS,
viď README). Prvý setup: `docs/21-RUNBOOKY.md` → R1, na Windows **R1w**
(tri pasce: konce riadkov, práva tajomstiev v named volume, BOM v `.ps1`).

**Prihlásenie neexistuje** (D98–D100, 27. 8. 2026): Caddy `basic_auth`, app
session aj sudo sú zrušené a zmazané z kódu. Nehľadaj `/login`, `auth: 'session'`
ani sudo okno — a nepridávaj ich späť. Invariant I3 preto po D100 znie **„žiadny
zápis bez dry-runu + potvrdenia"**; dry-run ani potvrdenie sa oslabiť NESMÚ (to
je jediné, čo pred produkčným eshopom zostalo). Čísla D98–D100 sú v
`docs/10-KONTRAKT.md` obsadené dvakrát — pozri kolíziu v jeho úvode.

**Potvrdenie NIE JE prihlásenie a neruš ho** (D106, 28. 8. 2026): štyri
uvoľňujúce mutácie majú bránu vo forme `confirmed: true` —
`PUT /api/settings/domain`, `POST /api/settings/scope-mode` (len pri UVOĽNENÍ),
`POST /api/settings/unlock-writes` a literál `KLUC UNIKOL` v `DELETE /api/key`.
Sprísnenie rozsahu je zámerne VOĽNÉ; tú asymetriu nezarovnávaj. Vzniklo to
preto, že heslo v tele bolo pri týchto akciách jediná brána a jeho zmazaním sa
z nich stal jeden tichý POST — pri doméne dokonca cesta k **vyneseniu
produkčného API kľúča bez prístupu k `secrets/`** (canary číta bez kľúča, takže
cudzí host si ju uspokojí sám). Rozbor: `KONTRAKT-BEZ-LOGINU-2026-08-27.md` §3b.

## Kde čo žije

- `src/lib/shop/client.ts` — klient shopu pre katalóg a `setReduction`.
  `setReduction` volá VÝHRADNE `src/lib/engine/executor.ts` (test to grepuje).
- `src/lib/shop/orders-client.ts` — JEDINÝ modul, ktorý smie volať `/api/order`
  (invariant I8'). Obsahuje aj sondu objednávkového kľúča.
- `src/lib/engine/sales-sync.ts` + `src/lib/repo/sales.repo.ts` — synchronizácia
  predajov a jej zápisová strana. `src/lib/sales/insights.ts` je čítacia strana.
- `src/lib/sales/sync-runner.ts` — spúšťač synchronizácie. Existuje preto, aby
  objednávkový kľúč nebol v `scheduler/boot.ts`: zápisová cesta o ňom nesmie
  vedieť (I8' bod 4).
- `src/lib/auth/local-actor.ts` — jediné miesto, ktoré vie, KTO zapisuje. Appka
  nemá prihlásenie, ale DB to vyžaduje (FK `campaigns.created_by` a
  `audit_log.user_id` na `users(id)`, `ON DELETE RESTRICT`), takže každý zápis aj
  audit riadok sa pripisuje lokálnemu actorovi `samuel` (id 1) — D102,
  27. 8. 2026. Tabuľka `users` a jej jediný riadok zostávajú, schéma sa nemenila
  (D101, žiadna migrácia).
- `src/lib/http/define-route.ts` — routy majú `ctx.actor` (`{ id, username }`),
  nie `ctx.claims`, a vlastnosť `auth:` v `RouteDefinition` **neexistuje**
  (D103, 27. 8. 2026). Keď ju niekde uvidíš, je to zabudnuté miesto — typecheck
  ho ukáže.
- Repozitáre sú v `src/lib/repo/`, nie v `src/lib/db/`. Raw parametrizované SQL,
  žiadne ORM. Migrácie sú numerované a checksumované — už aplikovanú migráciu
  NIKDY needituj, pridaj novú.
- Dva kľúče shopu žijú v jednej tabuľke `api_key` rozlíšené stĺpcom `kind`
  (`shop_write` 48 h / `orders_read` 30 dní). Jedna cesta pre šifrovanie, TTL,
  audit a wipe, takže panic button a zákaz logovania platia na oba automaticky.
- `src/lib/engine/catalog-enrich.ts` — obohacovanie katalógu z `getFull`
  (referencia, nákupná cena, marža, sklad, `qty_in_orders`, `last_time_in_order`,
  dodávateľ, kategórie). `runEnrichBatch()` beží v poradí priority
  (`catalog_cache.enrich_priority`: 1 = povolený zoznam, 2 = produkty
  v kampaniach, 3 = zvyšok), strop `ENRICH_MAX_PER_RUN = 150`, rezerva kvóty
  `ENRICH_QUOTA_RESERVE = 50`, sviežosť `ENRICH_FRESH_MS = 6 h`. Pauzy majú
  DÔVOD: `ip_banned`, `rate_limited`, `daily_budget`, `no_key` — pri odmietnutí
  shopom sa žiadny produkt neoznačí ako obohatený (D118, D120). Cesta „na dopyt"
  (jeden produkt) je `POST /api/catalog/enrich`.
- `src/lib/scheduler/enrich-runner.ts` — spúšťač obohacovania: rozhoduje „je
  čas?", drží odstup medzi dávkami a súbežnosť (dve vrstvy — `running` v module
  a zámok v DB, lebo `instrumentation` má vlastný module graf). `catalog-enrich.ts`
  sa sám nikdy nespustí; členenie je zámerne to isté ako `catalog-runner.ts`
  a `lib/sales/sync-runner.ts`.
- `src/lib/ui/product-label.ts` — JEDINÉ miesto, kde sa produkt pomenúva:
  `productLabel({ productId, reference, name })` → „ref · názov", chýbajúca
  referencia je pomlčka, nikdy nie vymyslené číslo (D116, K6). Používaj ho
  všade, kde predtým stálo samotné `product_id`.
- `src/lib/repo/presets.repo.ts` — pomenované presety zliav (filter + pásma +
  trvanie, `MAX_PRESETS = 20`), UI v `src/components/campaigns/DiscountPresets.tsx`,
  routy `src/app/api/presets/route.ts` a `.../[presetId]/route.ts`. Spustenie
  presetu **nie je výnimka z I3** — vždy ide nanovo cez dry-run + potvrdenie
  (D112, K7).
- Čítacie endpointy pre obrazovky V4 (žiadne volanie shopu na render ceste, K8):
  `src/app/api/insights/{product-kpi,top-products,revenue-daily,sales-daily,timeline,catalog-prices,activity}/route.ts`,
  `src/app/api/insights/product/[productId]/route.ts` a
  `src/app/api/insights/campaign/[id]/{performance,items}/route.ts`.
  `discount-depth` medzi nimi UŽ NIE JE (31. 8. 2026): route nemala konzumenta
  ani test, jej plánovaný domov (mini bar G2 na `/produkty`) obrazovka vedome
  odmietla (`products/catalog-api.ts` — značky majú ukazovať naklikaný výber,
  nie allowlist) a ten istý repozitárny dotaz `insightsRepo.discountDepth()`
  živí štyri iné routy. Keď ju budeš potrebovať, je to nová obrazovka, nie
  obnovený súbor.
- Migrácia `db/migrations/0014_obohatenie_katalogu.sql` (APLIKOVANÁ,
  checksum-uzamknutá — needituj ju, pridaj novú) rozšírila `catalog_cache`
  o obohatené stĺpce (všetky NULLABLE = „nevieme") a `enrich_priority`
  (NOT NULL DEFAULT 3) a pridala dve tabuľky: `catalog_enrich_state` (stav
  dávky obohacovania, dôvod pauzy) a `shop_revenue_daily` (denná tržba
  eshopu — pozri D117 nižšie). `0015_presety_zliav.sql` pridala tabuľku
  `discount_presets` (D112) a `0016_stav_citania_trzby.sql` tabuľku
  `shop_revenue_read_state` (rozlíši „deň prečítaný a nepredalo sa nič" od „deň
  sme nečítali"). Všetky tri sú APLIKOVANÉ a checksum-uzamknuté; kontrolný
  dotaz je `SELECT id, name FROM _migrations` (nie `schema_migrations`, ten tu
  neexistuje).
- Rezerva zápisov žije vo `src/lib/engine/budget.ts`: čítania sa z denného
  rozpočtu odpočítavajú LEN NAD `WRITE_QUOTA_RESERVE` (`min(rozpočet, 40)`,
  odvodené ako 200 − 160). Rezerva na strane čítaní (`ENRICH_QUOTA_RESERVE`)
  je iná vec a chráni sondy a canary.

## Pasce, ktoré tu už raz prežili do produkcie

- **Agentov report nie je dôkaz.** Integračné testy s fake závislosťou
  zamaskovali, že produkčný wiring vôbec nefunguje (scheduler nikdy nezapisoval).
  Vždy over aspoň jednu cestu s PRODUKČNÝM adaptérom.
- **Turbopack** už zahodil null-guard (`if (!row)` vyhodnotil ako compile-time
  falsy) — porovnávaj explicitne (`row === null`).
- **Next.js `instrumentation`** sa kompiluje do vlastného module grafu, takže
  singleton z bootu NIE JE ten istý objekt, aký vidí route handler. Registruj
  veci v module, ktorý ich naozaj používa.
- **MariaDB a dátumové sentinely**: `new Date(8.64e15)` sa skráti s warningom a
  porovnanie potom vracia vždy `false`. Nepoužívaj ich.
- **Eager `env.*` na module scope** láme `next build` (route factory sa volá pri
  kompilácii). Čítaj ENV vo funkcii.
- Deň počítaj cez `Intl.DateTimeFormat` s `timeZone`, nikdy v UTC — testy inak
  flakujú len medzi 22:00 a 24:00 UTC.
- `git worktree` vnútri repa (`.claude/worktrees`) by lint zosnímkoval; je to
  v `eslint.config.mjs` ignorované, po zlúčení worktree odstráň.
- **Jedna testovacia MariaDB pre celý repo.** Keď proti nej pustia vitest dva
  procesy naraz (dva agenti, dve sessions), `truncateAll()` sa pobijú a balík
  padá so signatúrou `SqlError 1062 Duplicate entry '1' for key 'PRIMARY' —
  INSERT INTO settings (id) VALUES (1)`. Nie je to race v kóde a nie je to pád
  tvrdenia. **Žiadny report z `npm test` nie je dôkaz, ak súčasne beží iný
  vitest** — over `ps | grep vitest` a beh zopakuj v izolácii.
- **Kvóta kľúča je ~20/min a ~200/deň, katalóg má 41 348 produktov.** Celoplošné
  `getFull` je teda **~207 dní** — plošné obohacovanie sa NEDÁ a nikdy ho
  nenavrhuj. Preto je prioritizované a na dopyt (D118), a neobohatený produkt má
  pomlčku, nie nulu ani odhad.
- **Batch NEZNIŽUJE kvótu.** 25 položiek = 25 hitov (plus 1 za samotné batch
  volanie), a `getFull` medzi batchovateľnými akciami vôbec **nie je**
  (opted-in sú len `products/get` a `order/get`). Dôkaz:
  `docs/api/sperky-api-v4.md` §Batch. „Zbatchujeme to" nie je optimalizácia.
- **Ceny položiek objednávky API NEVRACIA** (`order/get` → `products: [{id, qty}]`).
  Tržba v € existuje preto len na úrovni eshopu (denná suma `total_paid`,
  tabuľka `shop_revenue_daily`), per produkt sú to **výhradne kusy** (D117).
  Rozdeľovať `total_paid` medzi položky je ZAKÁZANÉ — poštovné, zľavy a kupóny
  by z toho urobili vymyslené číslo (I11).
- **API je zabanované na IP.** Shop vracia `{"error":"ip_banned"}` na všetko —
  aj na verejné čítanie katalógu bez kľúča. Nikdy nevolaj `sperky-eshop.sk`;
  stavia sa a testuje výhradne proti mock shopu (I6) a fetch guard v
  `test/setup.ts` púšťa len loopback. Odblokovanie je akcia Samuela (`docs/60`).
- **Čítania a zápisy delia JEDEN kľúč a JEDEN denný strop.** Bez rezervy vedelo
  čítanie vyžrať kvótu a appka stratila schopnosť ZAPÍSAŤ — `checkDailyBudget()`
  odmietol celú frontu. Preto `WRITE_QUOTA_RESERVE` = `min(rozpočet, 40)`,
  odvodené ako 200 − 160 (strop dráhy `product_read`). Nová čítacia cesta MUSÍ
  ísť cez rezervačnú dráhu; inak `remainingToday()` ohlási plný rozpočet a
  fronta spadne do 429 uprostred dávky.
- **Grep nad priečinkom A nepovie nič o diere v priečinku B.** Mutačné overenie
  K7 (31. 8. 2026) našlo, že dvaja „strážcovia" presetov boli grepy nad
  `src/app/api/presets/` na `setReduction`, kým brána dry-runu a potvrdenia
  stojí v `POST /api/campaigns` — skratka `presetId` v tele kampane nechala
  102 tvrdení zelených. Test, ktorý stráži hranicu, musí siahať na tú stranu,
  kde brána naozaj je (`test/integration/preset-nie-je-zapisova-cesta.spec.ts`).
- **Model môže byť správny a dostať nepravdivý vstup.** D121 (produkt
  s neznámym predajom sa do pásiem nezaradí) fungoval v klientskom modeli, kým
  server posielal `unitsSold: 0` namiesto `null` — takže `soldBucketOf(0)` dal
  legitímne vedro `none` s 30 % zľavou na tisícoch produktov. Nenašlo to 3756
  testov, ale preklik v prehliadači: route `/api/catalog/search` nemala ŽIADNY
  test a ten, ktorý to „kryl", meral repozitár, nie prepis na odpoveď.
  Trojstavovosť overuj na TELE ODPOVEDE, nie len na modeli.
- **`src/db/pool.ts` a UTC.** Docblock tam kedysi tvrdil, že „všetky `DATETIME`
  sú v DB v UTC". Nie sú: `timezone: 'Z'` prekladá hodnoty len na hranici poolu,
  v stĺpcoch sú **lokálne hodiny procesu**. Dotaz, ktorý porovnáva surový stĺpec
  s `UTC_TIMESTAMP()` alebo s UTC reťazcom, je preto tichá chyba. Chovanie sa
  zámerne nemení (prepnutie by prepísalo význam už uložených dátumov) — čítaj
  dnešný docblock v `src/db/pool.ts`.
- **Čo test vyňal z kontroly, nestráži NIKTO.** `nastavenia-v12.spec.ts` si
  kotvu `odhlasenie` vyňal zo zoznamu identifikátorov s tým, že „kryje ju e2e";
  e2e ju nekryla, a keď D99 zmazalo `SignOut.tsx`, rozcestník Nastavení mesiac
  ponúkal odkaz do prázdna. Našiel to preklik v prehliadači. Keď v teste píšeš
  výnimku, napíš k nej aj to, kto tú vec stráži namiesto neho.

## Príkazy

`npm run typecheck` · `npm run lint` · `npm run test` · `npm run e2e` ·
`npm run check-compose-bind` (invariant I5) · `scripts/backup.sh` ·
`scripts/sync-secrets-volume.ps1` (Windows, po každej rotácii master key).

Na Windows padá **nula** testov. Do 24. 8. 2026 ich padalo päť (`chmod 400` na
NTFS vyjde ako 444) a táto veta hovorila o deviatich — commit `a16e355` to
zavrel tým, že maska zakázaných bitov je odteraz podľa platformy. **Keď ti test
padne, je to SKUTOČNÝ pád, nie prostredie.**

Do 27. 8. 2026 tu bola jedna výnimka: v git worktree padol KAŽDÝ integračný test
route-ov už pri importe, lebo `argon2.glibc.node` blokuje Windows Application
Control. **D104 argon2 odstránilo** (`grep argon2 package.json` je prázdny),
takže táto trieda bolesti zmizla a „padá to len vo worktree" už nie je alibi.
