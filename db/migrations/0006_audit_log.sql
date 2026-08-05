-- 0006_audit_log.sql — append-only audit (BUILD-SPEC §3; D74, D75; INVARIANT I4)
--
-- INVARIANT I4: append-only je vynútené GRANTMI (0008_grants.sql) — aplikačný
-- DB user má na túto tabuľku VÝHRADNE `SELECT, INSERT`. Audit sa nemaže ani
-- nerotuje NIKDY (D75).
-- INVARIANT I1: `before_snapshot` / `after_snapshot` prechádzajú redaktorom
-- (D66) — API kľúč sa tu NESMIE objaviť v žiadnej forme (D50).
--
-- Zoznam `event_type` hodnôt je v `src/lib/audit/events.ts` (A2). Stĺpec je
-- VARCHAR (nie ENUM) úmyselne: pridanie nového event typu nesmie vyžadovať
-- migráciu meniacu append-only tabuľku.
--
-- Runaway strop (D79) sa počíta odtiaľto:
--   SELECT COUNT(*) FROM audit_log
--   WHERE event_type IN ('write_ok','write_uncertain')
--     AND ts >= UTC_TIMESTAMP(3) - INTERVAL 1 HOUR;

CREATE TABLE audit_log (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ts                DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),  -- UTC
  actor             ENUM('user','scheduler','system') NOT NULL,
  user_id           INT UNSIGNED NULL,
  event_type        VARCHAR(48) NOT NULL,
  ok                TINYINT(1) NULL,
  campaign_id       INT UNSIGNED NULL,
  campaign_item_id  INT UNSIGNED NULL,
  product_id        INT UNSIGNED NULL,
  operation_id      CHAR(26) NULL,
  request_id        CHAR(26) NULL,
  http_status       SMALLINT UNSIGNED NULL,
  before_snapshot   JSON NULL,     -- name, price, last_own_write, reduction_unverifiable (D48)
  after_snapshot    JSON NULL,     -- payload + raw odpoveď + status (D50)
  message           VARCHAR(1000) NULL,
  ip                VARCHAR(45) NULL,
  user_agent        VARCHAR(255) NULL,
  CONSTRAINT fk_audit_user     FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_audit_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT,
  KEY ix_audit_ts (ts),
  KEY ix_audit_event_ts (event_type, ts),
  KEY ix_audit_product_ts (product_id, ts),
  KEY ix_audit_campaign (campaign_id),
  KEY ix_audit_operation (operation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
