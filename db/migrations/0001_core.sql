-- 0001_core.sql — users, settings, scheduler_state (BUILD-SPEC §3)
-- Tabuľku `_migrations` vytvára runner sám pred aplikovaním čohokoľvek.
-- Poradie kvôli FK: _migrations -> users -> settings -> scheduler_state -> ...

CREATE TABLE users (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(64)   NOT NULL,
  password_hash  VARCHAR(255)  NOT NULL,          -- argon2id (D68)
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_login_at  DATETIME(3)   NULL,
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- singleton konfigurácia (D80, D79, D22)
CREATE TABLE settings (
  id                       TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  shop_domain              VARCHAR(191) NULL,      -- vždy https://…, bez trailing slash (D80)
  shop_domain_confirmed_at DATETIME(3)  NULL,      -- canary GET prešiel (D55)
  eager_write_default      TINYINT(1)   NOT NULL DEFAULT 1,  -- D22a: default ZAPNUTÉ
  writes_locked            TINYINT(1)   NOT NULL DEFAULT 0,  -- runaway zámok (D79)
  writes_locked_reason     VARCHAR(191) NULL,
  writes_locked_at         DATETIME(3)  NULL,
  onboarding_done_at       DATETIME(3)  NULL,
  updated_at               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT ck_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO settings (id) VALUES (1);

-- heartbeat schedulera (D87, O3)
CREATE TABLE scheduler_state (
  id                    TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  last_tick_at          DATETIME(3) NULL,
  last_tick_duration_ms INT UNSIGNED NULL,
  tick_count            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_error            VARCHAR(500) NULL,
  updated_at            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT ck_sched_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO scheduler_state (id) VALUES (1);
