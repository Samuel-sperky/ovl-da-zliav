-- 0007_login_attempts.sql — brute-force lockout (BUILD-SPEC §3; D71, KONTRAKT O4)
--
-- Stav lockoutu MUSÍ prežiť restart procesu, preto žije v DB a nie v pamäti (O4).

CREATE TABLE login_attempts (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username  VARCHAR(64) NOT NULL,
  ip        VARCHAR(45) NOT NULL,
  success   TINYINT(1) NOT NULL,
  ts        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_attempts_ip_ts (ip, ts),
  KEY ix_attempts_user_ts (username, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
