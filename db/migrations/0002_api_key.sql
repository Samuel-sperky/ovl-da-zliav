-- 0002_api_key.sql — singleton záznam API kľúča shopu (BUILD-SPEC §3, §7)
--
-- INVARIANT I1: v tejto tabuľke je kľúč VÝHRADNE zašifrovaný (AES-256-GCM
-- master keyom zo súboru). Do UI ide len `last4` (D65), do auditu nikdy nič
-- z tejto tabuľky (D50).
-- D76: tabuľka je VYLÚČENÁ zo záloh (`mysqldump --ignore-table=ovl_zliav.api_key`).
-- D63: wipe = UPDATE ciphertext = RANDOM_BYTES(...) -> DELETE -> audit `key_wiped`.

CREATE TABLE api_key (
  id            TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  ciphertext    VARBINARY(512) NOT NULL,   -- AES-256-GCM
  iv            VARBINARY(12)  NOT NULL,
  auth_tag      VARBINARY(16)  NOT NULL,
  key_version   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  last4         CHAR(4)        NOT NULL,   -- jediné, čo smie ísť do UI (D65)
  created_at    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3)    NOT NULL,   -- created_at + API_KEY_TTL_HOURS (48, R2)
  verify_status ENUM('unverified','valid','invalid','forbidden') NOT NULL DEFAULT 'unverified',
  verified_at   DATETIME(3)    NULL,
  last_used_at  DATETIME(3)    NULL,
  CONSTRAINT ck_api_key_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
