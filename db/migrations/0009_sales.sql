-- 0009_sales.sql — predajnosť produktov z objednávok
-- (KONTRAKT-PREDAJNOST-2026-08-06, rozhodnutia P1–P7, invariant I8')
--
-- INVARIANT I8' (bod 3): z objednávok sa ukladajú VÝHRADNE súčty predaných
-- kusov po produkte a dni. V tejto migrácii preto NEEXISTUJE tabuľka ani
-- stĺpec pre objednávku, jej id, krajinu, sumu ani akýkoľvek zákaznícky údaj.
-- Vynucuje to test/unit/no-orders-scope.spec.ts, ktorý grepuje DDL.
--
-- P5: druhý kľúč (`orders:read`) žije v EXISTUJÚCEJ tabuľke `api_key` s novým
-- stĺpcom `kind`, nie vo vlastnej tabuľke. Dôvod: jedna cesta pre šifrovanie,
-- TTL, audit a wipe znamená, že panic button (D63) a zákaz logovania (I1)
-- platia na oba kľúče automaticky, bez druhej neotestovanej cesty.
-- D76: `api_key` je aj naďalej vylúčená zo záloh — teraz to chráni oba kľúče.

-- ── api_key: z jedného záznamu na jeden záznam NA DRUH kľúča ────────────────
-- Singleton CHECK padá, na jeho miesto prichádza UNIQUE na `kind`: kľúčov je
-- najviac tolko, kolko je druhov, a viac ich nemôže vzniknúť ani omylom.
ALTER TABLE api_key
  ADD COLUMN kind ENUM('shop_write','orders_read') NOT NULL DEFAULT 'shop_write' AFTER id;

-- @tolerate-errno: 1091, 3940
ALTER TABLE api_key DROP CONSTRAINT ck_api_key_singleton;

ALTER TABLE api_key MODIFY COLUMN id TINYINT UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE api_key ADD CONSTRAINT uq_api_key_kind UNIQUE (kind);

-- Existujúci záznam (ak nejaký je) je zápisový kľúč do shopu.
UPDATE api_key SET kind = 'shop_write' WHERE kind IS NULL OR kind = '';

-- ── Súčty predaja po produkte a dni (P4) ───────────────────────────────────
-- `units_sold` je počet KUSOV. Peniaze tu zámerne nie sú: `total_paid` je za
-- celú objednávku, nie za položku, takže obrat na produkt sa priradiť NEDÁ.
CREATE TABLE product_sales_daily (
  product_id   INT UNSIGNED NOT NULL,
  sale_day     DATE         NOT NULL,
  units_sold   INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (product_id, sale_day),
  KEY ix_sales_day (sale_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Stav synchronizácie po dňoch (P6, P7) ──────────────────────────────────
-- Deň v minulosti je po dokončení uzavretý (`date_add` je čas vzniku, dozadu
-- sa nedopĺňa). Dnešný a včerajší deň sa prepočítavajú znova — upsert je
-- idempotentný. `orders_seen` je POČET, nie odkaz na objednávku.
CREATE TABLE sales_sync_state (
  sale_day      DATE        NOT NULL PRIMARY KEY,
  orders_seen   INT UNSIGNED NOT NULL DEFAULT 0,
  status        ENUM('pending','partial','complete') NOT NULL DEFAULT 'pending',
  requests_used INT UNSIGNED NOT NULL DEFAULT 0,
  last_error    VARCHAR(200) NULL,          -- kód chyby, NIKDY obsah odpovede (I1)
  started_at    DATETIME(3) NULL,
  finished_at   DATETIME(3) NULL,
  updated_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Granty pre aplikačného usera (D89 — appka nemá žiadne DDL právo) ───────
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.product_sales_daily TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.sales_sync_state    TO '{{APP_USER}}'@'%';

-- @tolerate-errno: 1227, 1045
FLUSH PRIVILEGES;
