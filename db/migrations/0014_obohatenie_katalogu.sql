-- 0014_obohatenie_katalogu.sql — obohatenie katalógu z `getFull`, priorita
-- obohacovania, stav dávky a DENNÁ TRŽBA ESHOPU
-- (KONTRAKT-V4-2026-08-28 §2b: D116, D117, D118, D119; invariant I11)
--
-- Dátum: 28. 8. 2026. Vlastník: V4 (schéma).
--
-- PREČO VÔBEC
-- -----------
-- Sonda 28. 8. 2026 zmerala tri veci, ktoré túto migráciu celú tvarujú:
--
--  1. `GET /api/products/getFull` (scope `product:read`) vracia na PRODUKTOVEJ
--     úrovni referenciu, nákupnú cenu, maržu, sklad, posledný predaj, dodávateľa,
--     kategórie a stav zľavy. Doteraz nič z toho v zrkadle katalógu nebolo —
--     žilo len v `raw` tých riadkov, ktoré niekto ručne doťahoval.
--  2. Kvóta kľúča je ~20/min a ~200/deň, `getFull` NIE JE batchovateľný. Katalóg
--     má 41 348 produktov, takže plošné obohatenie = ~207 dní. Preto sa
--     obohacuje PRIORITIZOVANE a na dopyt (D118) a preto tu je poradie fronty,
--     nie „spusti to nad všetkým".
--  3. **Ceny položiek objednávky API NEVRACIA** (`order/get` → `{id, qty}`).
--     Tržba v eurách preto existuje VÝHRADNE na úrovni celého eshopu (D117) —
--     odtiaľ `shop_revenue_daily` a jej varovanie v sekcii 4.
--
-- ČO SA TU NESMIE POKAZIŤ
-- -----------------------
--  1. **NULL je „nevieme", nikdy nula** (I11). Každý stĺpec z `getFull` je
--     NULLABLE a BEZ defaultu. Neobohatený produkt má na obrazovke pomlčku;
--     `DEFAULT 0` by z chýbajúcej marže urobil nulovú maržu a z chýbajúceho
--     skladu vypredaný produkt. Toto je najčastejšia chyba tohto repa a raz sa
--     už dostala do produkcie.
--  2. **`margin` a `margin_percent` si appka NEPOČÍTA.** Shop ich posiela
--     hotové (`margin = sell_price - purchase_price`, `margin_percent` na 2
--     desatiny). Ukladajú sa TAK, AKO PRIŠLI. Keby si ich appka počítala sama
--     a shop zmenil definíciu (DPH, nákupná cena s dopravou), appka by ticho
--     klamala a nikto by to nezachytil.
--  3. **`last_error` a `pause_reason` sú KÓDY, nikdy obsah odpovede shopu**
--     (I1) — rovnaké pravidlo ako v `sales_sync_state` (0009) a
--     `catalog_sync_state` (0013).
--  4. **Nové počítadlo kvóty sa TU NEZAKLADÁ.** Koľko čítaní za UTC deň už
--     odišlo, drží ZDIEĽANÝ `shop_read_budget` (0013) — obohacovanie si berie
--     vlastnú dráhu `product_read` (kvóta kľúča, ~200/deň), aby si s katalógom
--     (`anon`) a s predajnosťou (`orders`) nekradli rozpočet. Druhé počítadlo na
--     to isté by znamenalo, že appka pri bane nevie, ktoré z dvoch čísel platí.
--
-- POZOR NA POLOVIČNÝ BEH (rovnaké varovanie ako v hlavičkách 0010 a 0013)
-- ----------------------------------------------------------------------
-- DDL v MariaDB implicitne commituje, takže transakcia migračného runnera pred
-- polovičným stavom NECHRÁNI: keď migrácia padne uprostred, schéma je čiastočne
-- zmenená a riadok v `_migrations` nie je — pri ďalšom štarte sa celá spustí
-- ZNOVA. Preto je každý príkaz idempotentný (`ADD COLUMN IF NOT EXISTS`,
-- `ADD KEY IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`) a
-- opakovaný beh je no-op, nie chyba. Nič sa tu neupratuje ručne (D88).

-- ── 1. Obohatenie zrkadla katalógu z `getFull` (D116, D118, D119) ───────────
-- Prečo do `catalog_cache` a nie do vlastnej tabuľky (rozhodnuté 28. 8. 2026):
-- fronta obohacovania musí vedieť poradie aj pre produkt, ktorý obohatený ešte
-- NIE JE — teda pre všetkých 41 348. Vo vlastnej tabuľke by taký produkt riadok
-- nemal, priorita by nemala kde byť a výber „ktorý ďalší" by bol `LEFT JOIN …
-- WHERE x IS NULL` nad celým zrkadlom, teda presne ten full scan, ktorý
-- rozhodnutie B zakazuje. Zrkadlo má riadok pre každý produkt, takže je to
-- jedno miesto, jeden index a žiadny JOIN.
--
-- Zoznamový prechod synchronizácie tieto stĺpce NEPREPISUJE — `upsertMany()`
-- vypisuje stĺpce menovite a ani jeden z nich v tom zozname nie je. Obohatenie
-- teda prežije každý ďalší prechod katalógu (rovnaký zámer ako `SQL_KEEP_DETAIL`
-- v `catalog.repo.ts`, len tu je zdarma).
ALTER TABLE catalog_cache
  -- D116: kód produktu. Človek pozná „ref · názov", appka `product_id`.
  -- Referencia je preto všade, kde bolo id — a keď chýba, je pomlčka (I11).
  ADD COLUMN IF NOT EXISTS reference           VARCHAR(64)    NULL,
  -- D119: EAN z `getFull`. Na úrovni PRODUKTU (varianty majú vlastný v `raw`).
  ADD COLUMN IF NOT EXISTS ean13               VARCHAR(20)    NULL,
  -- D117: nákupná cena. Jediný podklad marže, ktorý API vôbec dáva.
  ADD COLUMN IF NOT EXISTS purchase_price      DECIMAL(10,2)  NULL,
  -- D117: marža v EUR TAK, AKO JU POSLAL SHOP. Appka ju NEPOČÍTA (viď bod 2
  -- v hlavičke). To isté platí pre `margin_percent`.
  ADD COLUMN IF NOT EXISTS margin              DECIMAL(10,2)  NULL,
  ADD COLUMN IF NOT EXISTS margin_percent      DECIMAL(7,2)   NULL,
  -- D117: cena s DPH. `price` v tejto tabuľke je `sell_price` BEZ DPH (shop
  -- hovorí „same value as price"), takže `sell_price` sa tu zámerne NEDUPLIKUJE
  -- — dva stĺpce s tým istým číslom sú dva zdroje pravdy.
  ADD COLUMN IF NOT EXISTS sell_price_with_vat DECIMAL(10,2)  NULL,
  -- D119: dátum poslednej objednávky s týmto produktom, alebo NULL keď žiadna
  -- nebola. DATETIME a nie DATE: nevieme, či shop pošle aj čas, a orezanie by
  -- bola strata údaja. Prázdna hodnota = „shop o žiadnej objednávke nevie",
  -- a to je iná veta než „nemáme obohatené" — tú hovorí `enriched_at IS NULL`.
  ADD COLUMN IF NOT EXISTS last_time_in_order  DATETIME       NULL,
  -- D119: sklad. SIGNED zámerne — shop vie viesť aj zápornú zásobu a hodnota sa
  -- ukladá tak, ako prišla. `0` je platná nula (vypredané), `NULL` je nevieme.
  ADD COLUMN IF NOT EXISTS qty                 INT            NULL,
  -- D119: koľko kusov produktu bolo kedy objednané. Toto je podklad obrátkovosti
  -- namiesto tisícov `order/get` volaní — jeden request na produkt (D119).
  ADD COLUMN IF NOT EXISTS qty_in_orders       INT            NULL,
  -- D116: dodávateľ. Text zo shopu, žiadny náš slovník.
  ADD COLUMN IF NOT EXISTS supplier            VARCHAR(191)   NULL,
  -- D116: stav zľavy PODĽA SHOPU. Prvý raz v histórii appky (backlog B1 sa
  -- `getFull`-om čiastočne zavrel), a preto POZOR: `campaign_items` naďalej
  -- hovorí „posledný VLASTNÝ zápis" (I11) a tieto tri stĺpce hovoria „takto to
  -- videl shop v čase `enriched_at`". Sú to dve rôzne vety a nesmú sa zliať.
  -- Všetky tri sú NULL naraz, keď zľava nebeží — aj keď nie sme obohatení.
  ADD COLUMN IF NOT EXISTS reduction_percent   DECIMAL(5,2)   NULL,
  ADD COLUMN IF NOT EXISTS reduction_from      DATETIME       NULL,
  ADD COLUMN IF NOT EXISTS reduction_to        DATETIME       NULL,
  -- D116: je produkt v shope zapnutý. `NULL` = nevieme (I11), nie „vypnutý".
  ADD COLUMN IF NOT EXISTS active              TINYINT(1)     NULL,
  -- D116: pole id kategórií tak, ako prišlo. JSON, lebo je to zoznam a appka
  -- nad ním nefiltruje (filter `category` zostáva zamknutý, viď `LOCKED_FILTERS`).
  ADD COLUMN IF NOT EXISTS categories          JSON           NULL,
  -- D118: kedy sa riadok naposledy ÚSPEŠNE obohatil. `NULL` = nikdy, a to je
  -- jediná pravda o neobohatenom produkte: všetky stĺpce vyššie sú vtedy NULL
  -- ako „nevieme", nie ako „shop nič nevie".
  ADD COLUMN IF NOT EXISTS enriched_at         DATETIME(3)    NULL,
  -- D118: kedy sme sa o obohatenie naposledy POKÚSILI (aj neúspešne). Bez tohto
  -- stĺpca by jeden produkt, na ktorom `getFull` opakovane padá, zjedol celú
  -- dennú kvótu — fronta ho vyberá znova a znova, lebo `enriched_at` mu zostáva
  -- NULL. S ním ide na konec poradia a zvyšok katalógu sa hýbe.
  ADD COLUMN IF NOT EXISTS enrich_attempted_at DATETIME(3)    NULL,
  -- D118: poradie vo fronte obohacovania. `1` = povolený zoznam, `2` = produkt
  -- v aktívnej/plánovanej kampani, `3` = ostatné. NOT NULL s defaultom zámerne:
  -- toto NIE JE údaj zo shopu, ale VLASTNÉ číslo appky, takže „nevieme" pri ňom
  -- nemá zmysel — nový produkt patrí do zvyšku katalógu, kým sa nedokáže inak.
  -- Prečo STĹPEC a nie výpočet v dotaze: poradie sa musí dať vyčítať z indexu.
  -- Dopočítavanie z `products_allowlist` a `campaign_items` pri každom dotaze
  -- znamená filesort nad 41 348 riadkami pri každom tiku dávky; naopak prepis
  -- tohto stĺpca je zopár riadkov (allowlist má strop 10, I2) a beží len keď sa
  -- allowlist alebo kampane naozaj zmenia (`refreshEnrichPriority()`).
  ADD COLUMN IF NOT EXISTS enrich_priority     TINYINT UNSIGNED NOT NULL DEFAULT 3;

-- Indexy pre 41 348 riadkov. Bez nich je každé triedenie full scan + filesort.
ALTER TABLE catalog_cache
  -- D116: hľadanie a triedenie podľa referencie („ref · názov" všade).
  ADD KEY IF NOT EXISTS ix_catalog_reference (reference),
  -- D119: „posledný predaj" ako stĺpec zoznamu aj ako triedenie ležiakov.
  ADD KEY IF NOT EXISTS ix_catalog_last_order (last_time_in_order),
  -- D119: sklad ako filter/triedenie (odomkne zamknutý filter `stock`).
  ADD KEY IF NOT EXISTS ix_catalog_qty (qty),
  -- D118 — FRONTA OBOHACOVANIA. Poradie stĺpcov nie je kozmetika:
  -- `enriched_at` je PRVÝ, lebo dotaz fronty ho má v `WHERE … IS NULL` (to je
  -- pre index rovnocenné s rovnosťou), a až za ním nasledujú presne tie stĺpce,
  -- v akých ide `ORDER BY`. Takto je výber ďalšej dávky range scan nad indexom
  -- BEZ filesortu. Pri opačnom poradí (`enrich_priority` prvý) by `IS NULL`
  -- nebolo vedúca podmienka, index by sa použil len na triedenie a fronta by
  -- prechádzala celé zrkadlo. Leading `enriched_at` zároveň pokrýva samostatné
  -- filtrovanie a triedenie podľa čerstvosti obohatenia, takže vlastný index na
  -- `enriched_at` by bol duplikát platený pri každom zápise.
  ADD KEY IF NOT EXISTS ix_catalog_enrich_queue
    (enriched_at, enrich_priority, enrich_attempted_at, product_id);

-- ── 2. Stav dávky obohacovania (D118, D120) ────────────────────────────────
-- Singleton (`id = 1`), vzor `catalog_sync_state` z 0013: jedna dávka = jeden
-- pokrok; druhý riadok by znamenal dve dávky, ktoré si prepisujú kurzor.
--
-- ROZDIEL OPROTI `shop_read_budget`, KTORÝ SA NESMIE ZLIAŤ
-- `shop_read_budget` (0013, dráha `product_read`) hovorí, koľko REQUESTOV za UTC
-- deň už odišlo — teda čo si vzala kvóta. `enriched_today` tu hovorí, koľko
-- produktov sa naozaj OBOHATILO. Sú to dve rôzne čísla: neúspešný `getFull`
-- kvótu spotrebuje a produkt neobohatí. Keby sa zliali, appka by pri bane
-- tvrdila, že obohatila 150 produktov, hoci obohatila nula.
CREATE TABLE IF NOT EXISTS catalog_enrich_state (
  id                TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
  -- D118: UTC deň, ku ktorému platí `enriched_today`. Deň je UTC, lebo kvótu
  -- resetuje SHOP o polnoci UTC — nie appka o polnoci v Bratislave (D31 hovorí
  -- o zóne logiky, toto je zóna shopu; rovnaký dôvod ako v `shop_read_budget`).
  -- `NULL` = dávka dnes ešte nebežala.
  batch_day         DATE             NULL,
  -- D118: koľko produktov sa v `batch_day` naozaj obohatilo (nie koľko
  -- requestov odišlo — to je `shop_read_budget`).
  enriched_today    INT UNSIGNED     NOT NULL DEFAULT 0,
  -- D118: koľko produktov má dávka za deň obohatiť (~150; zvyšok kvóty zostáva
  -- na canary, sondy a obohatenie na dopyt). V DB, aby sa dal zmeniť bez
  -- redeployu appky a aby bolo v audite vidieť, s akým stropom dávka bežala.
  daily_target      SMALLINT UNSIGNED NOT NULL DEFAULT 150,
  -- D118: kde dávka stojí — posledné product_id, ktoré sa spracovalo. Je to
  -- DIAGNOSTIKA a nie kurzor: poradie určuje `ix_catalog_enrich_queue` a
  -- `enriched_at`, takže dávka po prerušení pokračuje sama a nič nepreskočí.
  last_product_id   INT UNSIGNED     NULL,
  -- D118: koľko produktov obohatila dávka od svojho začiatku (naprieč dňami).
  enriched_total    INT UNSIGNED     NOT NULL DEFAULT 0,
  started_at        DATETIME(3)      NULL,
  -- Kedy sa naposledy naozaj čítalo zo shopu (meraný fakt, nie odhad — P7).
  last_read_at      DATETIME(3)      NULL,
  -- D120: dokedy dávka stojí. `NULL` PRI VYPLNENOM `pause_reason` znamená
  -- „stojí, kým do toho nezasiahne človek" — presne prípad `ip_banned`, kde
  -- shop žiadny čas obnovenia nedáva a odblokovanie IP je akcia používateľa.
  paused_until      DATETIME(3)      NULL,
  -- D120: PREČO dávka stojí, ako KÓD. Hodnoty: `rate_limited` · `daily_budget`
  -- · `ip_banned` · `no_key` · `error`. `ip_banned` je tu zámerne ako DÔVOD
  -- PAUZY a nie ako chyba, ktorá sa zahodí: shop vracia `ip_banned` na všetko
  -- vrátane verejného čítania, appka to má POVEDAŤ a NEMENIŤ dáta (D120).
  -- Keby to bola len `last_error`, ďalší tik by sa o kvótu pokúsil znova.
  pause_reason      VARCHAR(32)      NULL,
  -- KÓD chyby, NIKDY obsah odpovede shopu (I1).
  last_error        VARCHAR(200)     NULL,
  updated_at        DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                     ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT ck_catalog_enrich_state_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Riadok musí existovať skôr, než ho appka prvýkrát prečíta. `INSERT IGNORE`
-- prežije aj opakovaný beh migrácie (viď varovanie o polovičnom behu vyššie).
INSERT IGNORE INTO catalog_enrich_state (id) VALUES (1);

-- ── 3. Denná tržba ESHOPU (D117) ───────────────────────────────────────────
--
-- POZOR: TOTO NIE JE TRŽBA NA PRODUKT A NIKDY NEBUDE.
--
-- `GET /api/order` vracia za objednávku len `id, date_add, total_paid,
-- currency`; `GET /api/order/get` vracia položky ako `{id, qty}` — teda BEZ
-- ceny. Rozdeliť `total_paid` medzi položky sa preto NESMIE: v sume je poštovné,
-- zľavy a kupóny, takže akékoľvek rozdelenie by bolo VYMYSLENÉ číslo vydávané
-- za obrat produktu (I11). Per produkt existujú výhradne KUSY —
-- `product_sales_daily` (0009) a `qty_in_orders` z `getFull` (D119).
--
-- Tabuľka aj stĺpce sú preto pomenované tak, aby sa to nedalo pomýliť:
-- `shop_revenue_daily` (nie `sales_*`), `revenue_day`, `total_paid_sum`.
-- Keby sem niekedy niekto pridal `product_id`, porušuje D117 aj I11.
CREATE TABLE IF NOT EXISTS shop_revenue_daily (
  -- D117: deň podľa HODÍN SHOPU — `date_add` prichádza v čase shopu a appka ho
  -- neprepočítava (deň sa berie z dátumovej časti, nikdy cez UTC prevod; D31
  -- hovorí o zóne logiky, tu ide o zónu zdroja). `DATE`, žiadne sentinely.
  revenue_day     DATE          NOT NULL,
  -- D117: mena tak, ako prišla (ISO kód). JE ČASŤOU KĽÚČA zámerne: súčet dvoch
  -- mien do jedného čísla by bol nezmysel vydávaný za tržbu. Každá mena má
  -- vlastný riadok a obrazovka ich nesmie sčítať.
  currency        CHAR(3)       NOT NULL,
  -- D117: SÚČET `total_paid` objednávok dňa. Riadok existuje IBA pre deň, ktorý
  -- sa naozaj čítal, takže `NOT NULL` tu neklame: nula znamená „čítali sme a
  -- objednávky za tento deň neboli", kým „deň sa nečítal" znamená ŽIADNY riadok.
  -- Rozdiel medzi tým dvojím je celý zmysel `day_complete` nižšie.
  total_paid_sum  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  -- D117: koľko objednávok do súčtu vstúpilo. Je to POČET, nie odkaz na
  -- objednávku — žiadny zákaznícky údaj (I8' bod 3, rovnako ako 0009).
  orders_count    INT UNSIGNED  NOT NULL DEFAULT 0,
  -- D117: 1 = STIAHLI SME VŠETKY STRANY objednávok za tento deň, takže súčet je
  -- celý deň. 0 = súčet je zatiaľ len DOLNÁ HRANICA. Bez tohto príznaku by
  -- posledný (rozbehnutý) deň vždy vyzeral ako prudký pokles tržieb — graf by
  -- kreslil pád, ktorý sa nestal. Obrazovka musí nedokončený deň PRIZNAŤ.
  --
  -- Je to VLASTNÝ príznak a NIE `sales_sync_state.status` (0009): tá tabuľka
  -- hovorí o stiahnutí POLOŽIEK objednávok (`order/get` na každú objednávku),
  -- kým tu ide o zoznam objednávok (`GET /api/order`, 100 na stranu). Zoznam
  -- môže byť dočítaný a položky nie — a naopak. Dva fakty, dva stĺpce.
  day_complete    TINYINT(1)    NOT NULL DEFAULT 0,
  -- Koľko strán zoznamu sa za deň prečítalo. Diagnostika rozpočtu, nie kurzor.
  pages_read      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  first_seen_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (revenue_day, currency),
  -- Graf tržieb ide „posledných N dní zoradených podľa dňa" — a chce vedieť,
  -- ktoré z nich sú neúplné, bez druhého dotazu.
  KEY ix_revenue_complete (day_complete, revenue_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Rozlíšenie „0 predaných" od „tento deň sa nesťahoval" (I11) ─────────
-- ZISTENÉ 28. 8. 2026 PRI PÍSANÍ TEJTO MIGRÁCIE: rozlíšenie v schéme UŽ JE a
-- zaviedla ho 0009, takže tu sa nič nepridáva a nič sa nemení. Píše sa to sem
-- preto, aby to nikto nemusel odvodzovať znova a aby sa nezaviedol druhý,
-- konkurenčný mechanizmus:
--
--   · `product_sales_daily` má riadok LEN pre (produkt, deň) s predajom.
--   · `sales_sync_state` má riadok pre KAŽDÝ deň, ktorý sa sťahoval, so
--     `status` `pending` / `partial` / `complete`.
--
-- Z toho platí presne toto a nič iné:
--   `sales_sync_state.status = 'complete'` a žiadny riadok v
--   `product_sales_daily`  ⇒ produkt sa v ten deň NEPREDAL (platná nula).
--   Deň BEZ riadku v `sales_sync_state`, alebo so `status` `pending`/`partial`
--   ⇒ NEVIEME (pomlčka), a `partial` je navyše len DOLNÁ HRANICA, nikdy súčet.
--
-- Čítacia strana to musí povedať nahlas — samotný `SUM(units_sold)` nad oknom
-- ticho sčíta stiahnuté aj nestiahnuté dni do jedného čísla. Preto k tejto
-- migrácii patrí `coverageFor()` v `src/lib/repo/sales.repo.ts`: vracia pokrytie
-- okna po dňoch, aby obrazovka vedela medzeru priznať namiesto toho, aby
-- vydávala nedostatok dát za pokles predaja.

-- ── 5. Granty pre aplikačného usera (D89 — appka nemá žiadne DDL právo) ────
-- Vzor je 0012/0013: 0008 menuje KONKRÉTNE tabuľky, takže nová tabuľka by pre
-- aplikačného usera neexistovala. Staršie migrácie sa needitujú ani o medzeru —
-- runner overuje SHA-256 checksum už aplikovaných migrácií (D88, I14).
--
-- Nové STĹPCE v `catalog_cache` žiadny grant nepotrebujú: MariaDB udeľuje práva
-- na úrovni tabuľky a `catalog_cache` ich má z 0008.
--
-- INVARIANT I4 sa nemení: `audit_log` má stále výhradne `SELECT, INSERT`.
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.catalog_enrich_state TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.shop_revenue_daily   TO '{{APP_USER}}'@'%';

-- @tolerate-errno: 1227, 1045
FLUSH PRIVILEGES;
