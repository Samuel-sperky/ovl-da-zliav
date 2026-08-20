-- 0005_campaign_items.sql — položky dávky, jedna per produkt (BUILD-SPEC §3)
--
-- `position` nesie invariant I10 (deterministické sekvenčné poradie zápisu).
-- `price_at_preview` / `price_at_write` / `price_mismatch` sú POVINNÁ protiváha
-- odchýlky D39c — nezhoda sa NESMIE potichu zahodiť ani agregovať do „OK".
-- `sent_payload` a `raw_response` sú redigované (I1, D50, D66) — API kľúč sa
-- do nich NESMIE dostať v žiadnej forme.

CREATE TABLE campaign_items (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id           INT UNSIGNED NOT NULL,
  product_id            INT UNSIGNED NOT NULL,
  position              TINYINT UNSIGNED NOT NULL,          -- deterministické poradie (I10)
  status                ENUM('pending','skipped','ok','failed','uncertain',
                             'interrupted','not_found','blocked') NOT NULL DEFAULT 'pending',
  attempt_count         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  name_at_write         VARCHAR(255) NULL,
  price_at_preview      DECIMAL(10,2) NULL,                 -- D39c protiváha
  price_at_write        DECIMAL(10,2) NULL,                 -- D39c protiváha
  price_mismatch        TINYINT(1) NOT NULL DEFAULT 0,       -- príznak nezhody (D39c bod 3)
  has_attributes        TINYINT(1) NOT NULL DEFAULT 0,       -- D60
  reduction_unverifiable TINYINT(1) NOT NULL DEFAULT 1,      -- D48 flag, kým nebude B1
  request_id            CHAR(26) NULL,                       -- D58
  http_status           SMALLINT UNSIGNED NULL,
  error_code            VARCHAR(64) NULL,
  error_message         VARCHAR(500) NULL,                   -- slovenská veta (D47)
  sent_payload          JSON NULL,                           -- bez kľúča (I1)
  raw_response          JSON NULL,                           -- redigované (D50, D66)
  started_at            DATETIME(3) NULL,
  finished_at           DATETIME(3) NULL,
  CONSTRAINT fk_items_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_items_campaign_product (campaign_id, product_id),
  KEY ix_items_product (product_id),
  KEY ix_items_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
