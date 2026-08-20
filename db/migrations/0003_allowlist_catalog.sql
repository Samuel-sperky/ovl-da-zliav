-- 0003_allowlist_catalog.sql — allowlist 10 produktov + cache katalógu (BUILD-SPEC §3)
--
-- INVARIANT I2: `slot` vynucuje strop 10 AKTÍVNYCH záznamov na úrovni DB.
-- Aktívny záznam má `slot` 1–10 s UNIQUE, odobraný má `slot = NULL`
-- (MariaDB dovolí viac NULL hodnôt v UNIQUE indexe). Jedenásty aktívny záznam
-- teda zlyhá aj vtedy, keď niekto obíde aplikačnú validáciu.

CREATE TABLE products_allowlist (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  product_id   INT UNSIGNED NOT NULL,
  slot         TINYINT UNSIGNED NULL,
  label        VARCHAR(191) NULL,
  shop_status  ENUM('ok','not_found','unknown') NOT NULL DEFAULT 'unknown',  -- D49, D38
  status_note  VARCHAR(191) NULL,
  added_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  removed_at   DATETIME(3) NULL,
  UNIQUE KEY uq_allowlist_slot (slot),
  UNIQUE KEY uq_allowlist_active (product_id, removed_at),
  KEY ix_allowlist_product (product_id),
  CONSTRAINT ck_allowlist_slot CHECK (slot IS NULL OR (slot BETWEEN 1 AND 10)),
  CONSTRAINT ck_allowlist_slot_active CHECK ((removed_at IS NULL) = (slot IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cache `name`/`price`: obnovuje sa pri otvorení zápisového formulára a manuálne
-- (D57). Žiadny background polling katalógu neexistuje.
-- POZOR (I11): tu NIE JE stav zľavy — shop ho cez API nevracia (backlog B1).
CREATE TABLE catalog_cache (
  product_id      INT UNSIGNED NOT NULL PRIMARY KEY,
  name            VARCHAR(255) NULL,
  price           DECIMAL(10,2) NULL,
  has_attributes  TINYINT(1)   NOT NULL DEFAULT 0,   -- D60
  source          ENUM('list','get','batch') NOT NULL,
  fetched_at      DATETIME(3)  NOT NULL,
  raw             JSON NULL                          -- redigované (D66, I1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
