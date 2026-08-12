-- 0013_katalog_pokracovanie.sql — dvojdňový beh synchronizácie katalógu
-- (KONTRAKT-DOKONCENIE-2026-08-12: A2, A4, A5; KONTRAKT V3: K7)
--
-- PREČO VÔBEC
-- -----------
-- Shop hlási 41 082 produktov. Po 100 na stránku je to 411 čítaní, ale anonymný
-- strop je 30/min a **300 za UTC deň** (`docs/api/sperky-api-v4.md`, zrkadlené
-- v `src/lib/shop/rate-limits.ts`). Celý katalóg sa teda do jedného dňa NEZMESTÍ
-- — je to dvojdňový beh. Doteraz žil pokrok len v pamäti procesu, takže po
-- prerušení (429, polnoc, vypnutý počítač) sa začínalo znova od stránky 1 a
-- chvost katalógu sa neprečítal NIKDY. Preto sú tu dve tabuľky:
--
--   * `catalog_sync_state` — kde beh skončil a prečo stojí (A2),
--   * `shop_read_budget`   — koľko čítaní za UTC deň už odišlo (A4). Počítadlo
--     je ZDIEĽANÉ: katalóg aj synchronizácia predajnosti si oň pýtajú cez
--     `src/lib/shop/read-budget.ts`, takže si navzájom nekradnú rozpočet.
--
-- ČO SA TU NESMIE POKAZIŤ
-- -----------------------
--  1. **Toto NIE JE zápisový rozpočet (K2).** Zápisov do shopu sa tieto tabuľky
--     netýkajú — tie sa naďalej počítajú z `audit_log` (`write_attempt`) a majú
--     vlastnú kvótu na kľúč. Keby sa sem niekedy začali účtovať zápisy, ticho by
--     ukradli rozpočet fronte, ktorá beží týždne.
--  2. **`last_error` je KÓD, nikdy obsah odpovede shopu** (I1) — rovnaké
--     pravidlo ako v `sales_sync_state` (0009).
--  3. **`catalog_sync_state` je singleton.** Jeden katalóg = jeden pokrok;
--     druhý riadok by znamenal dva behy, ktoré si prepisujú stránky.
--
-- POZOR NA POLOVIČNÝ BEH (rovnaké varovanie ako v hlavičke 0010)
-- -------------------------------------------------------------
-- DDL v MariaDB implicitne commituje, takže transakcia migračného runnera tu
-- pred polovičným stavom NECHRÁNI: keď migrácia padne uprostred, schéma je
-- čiastočne zmenená a riadok v `_migrations` nie je — pri ďalšom štarte sa celá
-- spustí ZNOVA. Preto je každý príkaz tejto migrácie idempotentný
-- (`CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`, `GRANT`) a opakovaný beh je
-- no-op, nie chyba. Nič sa tu neupratuje ručne (D88).
--
-- Vlastník: V7 (katalóg).

-- ── 1. Pokrok synchronizácie katalógu (A2) ─────────────────────────────────
-- Jediný riadok (`id = 1`). `last_page` je posledná stránka, ktorá sa ÚSPEŠNE
-- zapísala do `catalog_cache` — nie posledná, o ktorú sme požiadali. Beh
-- pokračuje od `last_page + 1`, takže prerušenie stojí najviac jednu stránku.
--
-- `per_page` je súčasťou pokroku zámerne: číslo stránky má význam len voči
-- veľkosti stránky. Keby sa `per_page` zmenilo a `last_page` ostalo, beh by
-- preskočil (alebo zopakoval) kus katalógu — appka to preto vyhodnotí ako nový
-- prechod od stránky 1.
CREATE TABLE IF NOT EXISTS catalog_sync_state (
  id            TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
  per_page      SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  last_page     INT UNSIGNED     NOT NULL DEFAULT 0,
  -- Koľko produktov hlási shop (`total` zo zoznamu). NULL = zatiaľ nevieme;
  -- appka si toto číslo NIKDY nedopočítava sama (I11).
  shop_total    INT UNSIGNED     NULL,
  -- Koľko riadkov zapísal AKTUÁLNY prechod (nie koľko má tabuľka celkovo —
  -- to je `SELECT COUNT(*) FROM catalog_cache`).
  rows_written  INT UNSIGNED     NOT NULL DEFAULT 0,
  -- 1 = prechod dočítal katalóg po koniec. Ďalší prechod začne od stránky 1.
  completed     TINYINT(1)       NOT NULL DEFAULT 0,
  started_at    DATETIME(3)      NULL,
  -- Kedy sa naposledy naozaj čítalo zo shopu (meraný fakt, nie odhad — P7).
  last_read_at  DATETIME(3)      NULL,
  finished_at   DATETIME(3)      NULL,
  -- Dokedy beh stojí: `Retry-After` po 429 (A3), alebo polnoc UTC pri minutom
  -- dennom rozpočte (A4). NULL = nič nebráni pokračovaniu.
  paused_until  DATETIME(3)      NULL,
  pause_reason  VARCHAR(32)      NULL,
  -- KÓD chyby, NIKDY obsah odpovede shopu (I1).
  last_error    VARCHAR(200)     NULL,
  updated_at    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                 ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT ck_catalog_sync_state_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Riadok musí existovať skôr, než ho appka prvýkrát prečíta. `INSERT IGNORE`
-- prežije aj opakovaný beh migrácie (viď varovanie o polovičnom behu vyššie).
INSERT IGNORE INTO catalog_sync_state (id) VALUES (1);

-- ── 2. Zdieľaný denný rozpočet ČÍTANÍ zo shopu (A4) ────────────────────────
-- Jeden riadok na (dráhu, UTC deň). Dráha = rozpočtová vetva shopu:
--   * `anon`   — čítania BEZ kľúča (katalóg), strop 300/UTC deň na zdrojovú IP,
--   * `orders` — čítania S objednávkovým kľúčom (predajnosť), 200/UTC deň na kľúč.
-- Dráhy sa NESMÚ zlievať do jedného čísla: majú rôzne stropy aj rôzne
-- rozpočtové okno na strane shopu.
--
-- Prečo v DB a nie v pamäti: beh katalógu trvá dva dni a musí prežiť reštart
-- appky. Počítadlo v pamäti by sa po reštarte vynulovalo a appka by strop
-- prekročila presne vtedy, keď je najbližšie k banu.
--
-- Deň je UTC deň (`YYYY-MM-DD`), lebo strop resetuje SHOP o polnoci UTC — nie
-- appka o polnoci v Bratislave (D31 hovorí o zóne logiky, toto je zóna shopu).
CREATE TABLE IF NOT EXISTS shop_read_budget (
  lane        VARCHAR(24)  NOT NULL,
  utc_day     DATE         NOT NULL,
  reads_used  INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                           ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (lane, utc_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Granty pre aplikačného usera (D89 — appka nemá žiadne DDL právo) ────
-- Vzor je `0012_grants.sql`: 0008 menuje KONKRÉTNE tabuľky, takže nová tabuľka
-- by pre aplikačného usera neexistovala. Staršie migrácie sa needitujú ani
-- o medzeru — runner overuje SHA-256 checksum už aplikovaných migrácií (D88, I14).
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.catalog_sync_state TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.shop_read_budget   TO '{{APP_USER}}'@'%';

-- @tolerate-errno: 1227, 1045
FLUSH PRIVILEGES;
