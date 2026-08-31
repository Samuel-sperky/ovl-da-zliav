-- 0016_stav_citania_trzby.sql — „tento deň sme prečítali a objednávky NEBOLI"
-- (KONTRAKT-V4-2026-08-28 §2b → D117; invariant I11) · 31. 8. 2026
--
-- PREČO VÔBEC
-- -----------
-- Migrácia 0014 §3 dala tržbe eshopu tabuľku `shop_revenue_daily` s kľúčom
-- `(revenue_day, currency)`. Mena je časť kľúča zámerne: súčet dvoch mien do
-- jedného čísla by bol nezmysel vydávaný za tržbu. Má to však dôsledok, ktorý
-- 0014 aj hlavička `src/lib/engine/sales-sync.ts` priznali nahlas a nechali
-- otvorený:
--
--   **Deň bez jedinej objednávky nemá menu, takže nemá ako dostať riadok.**
--
-- Čítacia strana (`GET /api/insights/revenue-daily`) taký deň vidí ako
-- `missing`, teda „nevieme" — hoci sme ho dočítali a vieme, že sa v ňom
-- nepredalo nič. Je to nepresnosť v BEZPEČNOM smere (I11 zakazuje vydávať
-- neznáme za nulu, nie naopak), ale znamená, že appka nikdy nepovie „v tento
-- deň sa nepredalo nič".
--
-- ČO SA TU **NEROBÍ** A PREČO
-- ---------------------------
--  1. **Chýbajúci deň NEDOSTANE nulový riadok v `shop_revenue_daily`.** To by
--     bolo presne to zakázané: nulu by dostal aj deň, ktorý sa NIKDY nesťahoval,
--     a rozdiel medzi „nula" a „nevieme" by zmizol (I11). Riadok tam naďalej
--     znamená „v tejto mene v tento deň objednávky BOLI".
--  2. **Mena sa pre prázdny deň NEVYMYSLÍ** — ani z nastavení. Mena v tabuľke
--     tržby je MERANÁ vlastnosť objednávok, nie konfigurácia; `settings` navyše
--     žiadnu menu nemá (`grep currency db/migrations/*.sql` mimo 0014 je prázdny)
--     a doplnená by bola ľudský odhad vydávaný za meranie. Deň bez objednávok
--     nemá menu ani v realite, takže „0.00 EUR" by tvrdilo viac, než sme videli.
--
-- ČO SA TU ROBÍ
-- -------------
-- Príznak PREČÍTANOSTI DŇA sa oddeľuje od sumy — presne tým vzorom, ktorý v tomto
-- repe už raz vyriešil tú istú otázku pre KUSY (migrácia 0009, zhrnuté v 0014 §4):
--
--   · `product_sales_daily`  (hodnoty, riedka)  +  `sales_sync_state`  (stav dňa)
--   · `shop_revenue_daily`   (hodnoty, riedka)  +  `shop_revenue_read_state` (tu)
--
-- 0014 §4 výslovne varuje pred zavedením DRUHÉHO, konkurenčného mechanizmu —
-- preto sa tu zrkadlí ten zabehnutý a nie nič nové.
--
-- Stav je na ÚROVNI DŇA a menu zámerne NEPOZNÁ. Odpovedá totiž na otázku
-- „prečítali sme zoznam objednávok tohto dňa?", ktorá s menou nemá nič spoločné
-- — a práve preto ju uvedie aj deň, v ktorom žiadna mena nevznikla.
--
-- **DEŇ S VIAC MENAMI**: jeden riadok stavu, N riadkov hodnôt. „Prečítané, nič
-- sa nepredalo" je tvrdenie o CELOM DNI, takže je dobre definované bez ohľadu
-- na počet mien. A pre jednotlivý menový rad platí to isté, čo 0014 §4 hovorí
-- o produktoch: deň prečítaný DOČÍTA a bez riadku tejto meny znamená MERANÚ nulu
-- pre túto menu („čítali sme celý deň, v tejto mene nebolo nič"). Deň prečítaný
-- len ČIASTOČNE nehovorí o nule nič — dolná hranica `≥ 0` je prázdna veta, nie
-- priznanie, a čítacia strana ho preto naďalej vyhlási za „nevieme".
--
-- ČO SA TU NESMIE POKAZIŤ
-- -----------------------
--  1. **Riadok vznikne LEN pre deň, z ktorého sa naozaj prečítala aspoň jedna
--     strana zoznamu.** Predvyplnenie dní dopredu by z celého okna urobilo
--     „prečítané, nič sa nepredalo" a to je tá istá lož ako nula (I11).
--  2. **`day_complete` hovorí o ZOZNAME objednávok, nie o položkách.** To druhé
--     je `sales_sync_state.status` (0009) a sú to dva rôzne fakty — zoznam môže
--     byť celý a položky nie, aj naopak (0014 §3, „dva fakty, dva stĺpce").
--     Táto migrácia do `sales_sync_state` nesiaha ani o medzeru.
--  3. **`last_error` je KÓD chyby, NIKDY obsah odpovede shopu** (I1) — rovnaké
--     pravidlo ako v `sales_sync_state` (0009) a `catalog_sync_state` (0013).
--  4. **Žiadny zákaznícky údaj** (I8' bod 3): `orders_seen` je POČET objednávok
--     dňa, presne v tej istej triede ako rovnomenný stĺpec z 0009. Žiadne id
--     objednávky, žiadny produkt, nič o kupujúcom. Guard
--     `test/unit/no-orders-scope.spec.ts` túto migráciu skenuje a **nepotreboval
--     ani jeden nový záznam v `ALLOWED_DDL_IDENTIFIERS`** — diera teda
--     nevznikla, zoznam výnimiek zostal presne taký, aký bol.
--
-- POZOR NA POLOVIČNÝ BEH (rovnaké varovanie ako v hlavičke 0013)
-- -------------------------------------------------------------
-- DDL v MariaDB implicitne commituje, takže transakcia migračného runnera tu
-- pred polovičným stavom NECHRÁNI. Preto je každý príkaz idempotentný
-- (`CREATE TABLE IF NOT EXISTS`, `GRANT`) a opakovaný beh je no-op, nie chyba.
--
-- `-- @tolerate-errno:` je direktíva runnera (viď 0008): 1227/1045 pri
-- `FLUSH PRIVILEGES` je dôsledok chýbajúceho práva RELOAD, nie chyba schémy.
--
-- Vlastník: sales-sync (V4, denná tržba).

-- ── 1. Prečítanosť dňa v tržbe eshopu, oddelená od sumy (D117, I11) ────────
CREATE TABLE IF NOT EXISTS shop_revenue_read_state (
  -- Deň podľa hodín SHOPU (`date_add`), rovnako ako `shop_revenue_daily`.
  -- Appka ho neprepočítava do UTC. Žiadne sentinely — `DATE`.
  revenue_day    DATE         NOT NULL PRIMARY KEY,
  -- 1 = prečítali sme VŠETKY strany zoznamu objednávok za tento deň, takže
  -- suma v `shop_revenue_daily` je celý deň a jej absencia je MERANÁ nula.
  -- 0 = čítanie sa nedočítalo; suma je dolná hranica a o nule netvrdíme NIČ.
  day_complete   TINYINT(1)   NOT NULL DEFAULT 0,
  -- POČET objednávok, ktoré beh v tomto dni videl. Nie odkaz na objednávku
  -- (I8' bod 3) — tá istá trieda ako `sales_sync_state.orders_seen` z 0009.
  -- `0` pri `day_complete = 1` je práve to, čo táto migrácia prináša: MERANÝ
  -- fakt „prečítané, nepredalo sa nič".
  orders_seen    INT UNSIGNED NOT NULL DEFAULT 0,
  -- Koľko strán zoznamu sa za deň prečítalo. Diagnostika, nie kurzor.
  pages_read     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- KÓD chyby, NIKDY obsah odpovede shopu (I1).
  last_error     VARCHAR(200) NULL,
  first_read_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                              ON UPDATE CURRENT_TIMESTAMP(3),
  -- Graf sa pýta „posledných N dní a ktoré z nich sú dočítané" jedným dotazom.
  KEY ix_revenue_read_complete (day_complete, revenue_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Granty pre aplikačného usera (D89 — appka nemá žiadne DDL právo) ────
-- Vzor je 0012/0013/0014: 0008 menuje KONKRÉTNE tabuľky, takže nová tabuľka by
-- pre aplikačného usera neexistovala. Staršie migrácie sa needitujú ani o
-- medzeru — runner overuje SHA-256 checksum už aplikovaných migrácií (D88, I14).
--
-- INVARIANT I4 sa nemení: `audit_log` má stále výhradne `SELECT, INSERT`.
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.shop_revenue_read_state TO '{{APP_USER}}'@'%';

-- @tolerate-errno: 1227, 1045
FLUSH PRIVILEGES;
