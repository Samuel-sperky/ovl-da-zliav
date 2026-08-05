-- 0004_campaigns.sql — kampane = joby (BUILD-SPEC §3, §4; KONTRAKT O1)
--
-- `status` je JEDINÝ zdroj pravdy o životnom cykle. UI stavy „aktívna"
-- a „expirovaná" sú derivované z `status` a dátumov okna (§4).
-- Stav `missed` sa NIKDY nedostane do `running` automaticky (odchýlka D33b).
-- `confirmed_at` + `confirm_payload_hash` sú nosiče invariantu I3.

CREATE TABLE campaigns (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operation_id        CHAR(26)     NOT NULL,             -- ULID, korelácia (D58)
  name                VARCHAR(191) NOT NULL,
  kind                ENUM('new','extend','overwrite','retry') NOT NULL DEFAULT 'new',
  parent_campaign_id  INT UNSIGNED NULL,                 -- pôvod pri extend/overwrite/retry
  percent             TINYINT UNSIGNED NOT NULL,         -- 1..30 (D11, I9)
  date_from           DATE NOT NULL,
  date_to             DATE NOT NULL,
  date_from_original  DATE NULL,                         -- ak sa posunul (D25)
  mode                ENUM('eager','scheduled') NOT NULL,-- D22
  status              ENUM('draft','scheduled','needs_key','running',
                           'done','partial','failed','missed','cancelled','lapsed')
                      NOT NULL DEFAULT 'draft',
  status_reason       VARCHAR(255) NULL,
  fire_at             DATETIME(3) NULL,                  -- UTC, = date_from 00:05 Bratislava (D32)
  scheduled_at        DATETIME(3) NULL,
  needs_key_since     DATETIME(3) NULL,
  claimed_at          DATETIME(3) NULL,
  started_at          DATETIME(3) NULL,
  finished_at         DATETIME(3) NULL,
  items_total         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  items_ok            TINYINT UNSIGNED NOT NULL DEFAULT 0,
  items_failed        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  items_uncertain     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  confirmed_at        DATETIME(3) NULL,                  -- dry-run potvrdenie (I3)
  confirm_payload_hash CHAR(64)   NULL,                  -- SHA-256 potvrdenej sady (I3, O2)
  sudo_at             DATETIME(3) NULL,                  -- D70
  result_ack_at       DATETIME(3) NULL,                  -- notifikačný panel (D17, O6)
  created_by          INT UNSIGNED NOT NULL,
  created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_campaigns_user   FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_campaigns_parent FOREIGN KEY (parent_campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT,
  CONSTRAINT ck_campaigns_percent CHECK (percent BETWEEN 1 AND 30),
  CONSTRAINT ck_campaigns_window  CHECK (date_to >= date_from),
  KEY ix_campaigns_status_fire (status, fire_at),
  KEY ix_campaigns_window (date_from, date_to),
  KEY ix_campaigns_ack (result_ack_at),
  UNIQUE KEY uq_campaigns_operation (operation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
