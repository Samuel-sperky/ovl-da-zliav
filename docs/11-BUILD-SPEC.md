# Aura Zľavy (ovl-da-zliav) — BUILD SPEC

**Verzia:** 1.0 · **Dátum:** 2026-08-05
**Nadradený dokument:** `docs/10-KONTRAKT.md` (rozhodnutia D/R/I). Tento dokument
opisuje **ako** sa to postaví. Pri rozpore platí KONTRAKT.

Stack (R3): Node 22 · Next.js 16 App Router, `output: 'standalone'` · React 19 ·
TypeScript strict · MariaDB 11.4 · zod · jose · argon2 · vitest · Playwright.
Balíčkovač: `npm` (lockfile v repe).

---

## 1. Štruktúra priečinkov

```
ovl-da-zliav/
├── package.json                       # A0 — VŠETKY závislosti projektu, nikto iný needituje
├── package-lock.json
├── tsconfig.json
├── next.config.ts                     # output: 'standalone', poweredByHeader: false
├── eslint.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── .env.example                        # bez tajomstiev (I1)
├── .gitignore                          # .env, secrets/, backups/, .next/
├── .gitleaks.toml
├── docker-compose.yml
├── docker-compose.override.example.yml
├── Dockerfile
├── Caddyfile.example
├── docs/                               # 00..02, 10..12, 20-BACKLOG-SHOP-API.md, 21-RUNBOOKY.md
├── db/
│   └── migrations/
│       ├── 0001_core.sql
│       ├── 0002_api_key.sql
│       ├── 0003_allowlist_catalog.sql
│       ├── 0004_campaigns.sql
│       ├── 0005_campaign_items.sql
│       ├── 0006_audit_log.sql
│       ├── 0007_login_attempts.sql
│       └── 0008_grants.sql
├── scripts/
│   ├── migrate.ts                      # runner (spúšťaný entrypointom migračným userom)
│   ├── seed-admin.ts                    # prvé heslo (argon2id), interaktívne
│   ├── gen-master-key.ts                # 32 B random → secrets/master.key, chmod 400
│   ├── backup.sh                        # mysqldump bez api_key, rotácia 14 d
│   ├── restore-test.sh
│   ├── check-compose-bind.ts            # CI: žiadne ports: na app/db (I5)
│   └── entrypoint.sh
├── src/
│   ├── env.ts                           # zod schéma ENV, fail-fast (D93)
│   ├── version.ts                        # APP_VERSION → User-Agent (D58)
│   ├── db/
│   │   ├── pool.ts                       # mariadb pool, retry pripájania (D91)
│   │   ├── tx.ts                         # withTransaction()
│   │   └── advisory-lock.ts              # GET_LOCK/RELEASE_LOCK (D88)
│   ├── lib/
│   │   ├── crypto/
│   │   │   ├── master-key.ts             # čítanie súboru, kontrola práv (D61)
│   │   │   ├── secret-box.ts             # AES-256-GCM encrypt/decrypt/wipeBuffer (D64)
│   │   │   └── preview-token.ts          # HS256 JWT pre dry-run sadu (O2)
│   │   ├── log/
│   │   │   ├── logger.ts                 # JSON na stdout (D92)
│   │   │   └── redact.ts                 # centrálny redaktor (D66, I1)
│   │   ├── audit/
│   │   │   ├── events.ts                 # enum event_type
│   │   │   └── write.ts                  # appendAudit() — jediná cesta do audit_log (I4)
│   │   ├── auth/
│   │   │   ├── password.ts               # argon2id (D68)
│   │   │   ├── session.ts                # jose JWT, 8 h abs + 30 min idle (D69)
│   │   │   ├── sudo.ts                   # 15 min okno (D70)
│   │   │   └── lockout.ts                # 5/15 min + exponenciálny lockout (D71)
│   │   ├── http/
│   │   │   ├── define-route.ts           # pipeline auth→rateLimit→origin→zod→handler
│   │   │   ├── errors.ts                 # AppError, HTTP mapovanie
│   │   │   └── responses.ts              # ok()/fail() tvar odpovedí appky
│   │   ├── shop/
│   │   │   ├── client.ts                 # getProducts/getProduct/batchGetProducts/setReduction/probeKey
│   │   │   ├── schemas.ts                # zod schémy odpovedí shopu (D54)
│   │   │   ├── errors.ts                 # taxonómia retryable/terminal (D41)
│   │   │   ├── retry.ts                  # 429/500/network politiky (D42, D43)
│   │   │   ├── correlation.ts            # operation_id / request_id (D58)
│   │   │   └── messages.sk.ts            # kód → slovenská veta (D47)
│   │   ├── domain/
│   │   │   ├── dates.ts                  # Europe/Bratislava, 3 mesiace, polnočná hrana (D29,D31,D59)
│   │   │   ├── percent.ts                # 1–30 celé čísla (D11)
│   │   │   ├── campaign-rules.ts         # from≥dnes, 1-dňová, prekryv, predĺženie (D27,D28,D30)
│   │   │   ├── status.ts                 # stavový stroj + povolené prechody (D83)
│   │   │   └── pricing.ts                # orientačná zľavnená cena (D4)
│   │   ├── repo/
│   │   │   ├── api-key.repo.ts
│   │   │   ├── users.repo.ts
│   │   │   ├── settings.repo.ts
│   │   │   ├── allowlist.repo.ts
│   │   │   ├── catalog.repo.ts
│   │   │   ├── campaigns.repo.ts
│   │   │   ├── campaign-items.repo.ts
│   │   │   ├── audit.repo.ts             # len SELECT (zápis ide cez lib/audit/write.ts)
│   │   │   └── scheduler-state.repo.ts
│   │   ├── engine/
│   │   │   ├── mutex.ts                  # globálny zápisový mutex (D37)
│   │   │   ├── guards.ts                 # I2/I9/I13 + runaway strop (D79)
│   │   │   ├── preview.ts                # dry-run zostavenie diffu (D3)
│   │   │   ├── executor.ts               # sekvenčný zápis dávky (D46, D34)
│   │   │   ├── snapshot.ts               # pre-write GET + price_at_* (D48, D39c)
│   │   │   └── reconcile.ts              # po havárii (D86)
│   │   └── scheduler/
│   │       ├── tick.ts                   # 60 s cyklus
│   │       ├── due.ts                    # výber a claim kampaní (D32, D84)
│   │       ├── ttl-wipe.ts               # 48 h wipe kľúča (D63)
│   │       ├── missed.ts                 # detekcia missed, nikdy auto-catchup (D33b)
│   │       ├── reminders.ts              # 48/24/2 h (D26)
│   │       └── boot.ts                   # jednorazový start (instrumentation hook)
│   ├── instrumentation.ts                # spustenie boot assertions + schedulera
│   ├── app/
│   │   ├── layout.tsx                    # ProductionBar + KeyTtlBadge + SchedulerBadge
│   │   ├── globals.css
│   │   ├── page.tsx                      # dashboard
│   │   ├── login/page.tsx
│   │   ├── onboarding/page.tsx
│   │   ├── produkty/page.tsx
│   │   ├── kampane/page.tsx
│   │   ├── kampane/nova/page.tsx
│   │   ├── kampane/[id]/page.tsx
│   │   ├── audit/page.tsx
│   │   ├── nastavenia/page.tsx
│   │   └── api/…                          # viď §5
│   └── components/…                       # viď §8
└── test/
    ├── setup.ts                           # blokáda fetch mimo mocku (I6)
    ├── mock-shop/
    │   ├── server.ts
    │   ├── state.ts
    │   └── fixtures.ts
    ├── helpers/db.ts                      # migrácie + truncate pre integračné testy
    ├── unit/…
    ├── integration/…
    └── e2e/…
```

---

## 2. Konvencie

- **Časy:** všetky `DATETIME` v DB sú UTC (D31). Konverzia do Europe/Bratislava
  len v `lib/domain/dates.ts` a v UI. Dátumy zliav (`date_from`, `date_to`) sú
  typu `DATE` — holé kalendárne dni bez zóny.
- **Peniaze:** `DECIMAL(10,2)`, v TS ako `string` z drivera → `Number` len na
  zobrazenie. Nikdy nepočítať s float pri porovnávaní.
- **ID korelácie:** `operation_id` a `request_id` = ULID (26 znakov, `CHAR(26)`).
- **Charset:** `utf8mb4` / `utf8mb4_unicode_ci`, `ENGINE=InnoDB`.
- **Zod:** každý vstup route a každá odpoveď shopu má schému. Neznámy kľúč
  v odpovedi shopu = `passthrough` OK, chýbajúci/zle typovaný povinný kľúč =
  `uncertain` (D54).
- **Odpovede appky:** `{ ok: true, data: … }` / `{ ok: false, error: { code, message, detail? } }`.

---

## 3. DB schéma

DB `ovl_zliav`, dva DB useri (D89):

| User | Práva |
| --- | --- |
| `ovl_zliav_mig` | plné DDL + DML na `ovl_zliav` (len pre `scripts/migrate.ts`) |
| `ovl_zliav_app` | `SELECT, INSERT, UPDATE, DELETE` na všetky tabuľky **okrem** `audit_log`, kde má výhradne `SELECT, INSERT`; **žiadne** DDL |

### Poradie vytvárania (kvôli FK)

`_migrations` → `users` → `settings` → `scheduler_state` → `api_key` →
`products_allowlist` → `catalog_cache` → `campaigns` → `campaign_items` →
`audit_log` → `login_attempts` → granty.

### 0001_core.sql

`_migrations` vytvára runner sám pred aplikovaním čohokoľvek:

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  id          INT UNSIGNED    NOT NULL PRIMARY KEY,
  name        VARCHAR(191)    NOT NULL,
  checksum    CHAR(64)        NOT NULL,
  applied_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
```

```sql
CREATE TABLE users (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(64)   NOT NULL,
  password_hash  VARCHAR(255)  NOT NULL,          -- argon2id (D68)
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_login_at  DATETIME(3)   NULL,
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB;

-- singleton konfigurácia (D80, D79, D22)
CREATE TABLE settings (
  id                       TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  shop_domain              VARCHAR(191) NULL,      -- vždy https://…, bez trailing slash
  shop_domain_confirmed_at DATETIME(3)  NULL,      -- canary GET prešiel (D55)
  eager_write_default      TINYINT(1)   NOT NULL DEFAULT 1,  -- D22a: default ZAPNUTÉ
  writes_locked            TINYINT(1)   NOT NULL DEFAULT 0,  -- runaway zámok (D79)
  writes_locked_reason     VARCHAR(191) NULL,
  writes_locked_at         DATETIME(3)  NULL,
  onboarding_done_at       DATETIME(3)  NULL,
  updated_at               DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT ck_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB;
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
) ENGINE=InnoDB;
INSERT INTO scheduler_state (id) VALUES (1);
```

### 0002_api_key.sql

Singleton. Wipe = `UPDATE ciphertext = RANDOM_BYTES(len)` → `DELETE` (D63).
Táto tabuľka je **vylúčená zo záloh** (D76, I1).

```sql
CREATE TABLE api_key (
  id            TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  ciphertext    VARBINARY(512) NOT NULL,   -- AES-256-GCM
  iv            VARBINARY(12)  NOT NULL,
  auth_tag      VARBINARY(16)  NOT NULL,
  key_version   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  last4         CHAR(4)        NOT NULL,   -- jediné, čo smie ísť do UI (D65)
  created_at    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at    DATETIME(3)    NOT NULL,   -- created_at + API_KEY_TTL_HOURS (48)
  verify_status ENUM('unverified','valid','invalid','forbidden') NOT NULL DEFAULT 'unverified',
  verified_at   DATETIME(3)    NULL,
  last_used_at  DATETIME(3)    NULL,
  CONSTRAINT ck_api_key_singleton CHECK (id = 1)
) ENGINE=InnoDB;
```

### 0003_allowlist_catalog.sql

`slot` vynucuje strop 10 aktívnych záznamov na úrovni DB (I2): aktívny záznam
má `slot` 1–10 s UNIQUE, odobraný má `slot = NULL` (MariaDB dovolí viac NULL).

```sql
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
) ENGINE=InnoDB;

CREATE TABLE catalog_cache (
  product_id      INT UNSIGNED NOT NULL PRIMARY KEY,
  name            VARCHAR(255) NULL,
  price           DECIMAL(10,2) NULL,
  has_attributes  TINYINT(1)   NOT NULL DEFAULT 0,   -- D60
  source          ENUM('list','get','batch') NOT NULL,
  fetched_at      DATETIME(3)  NOT NULL,
  raw             JSON NULL                            -- redigované (D66)
) ENGINE=InnoDB;
```

### 0004_campaigns.sql

```sql
CREATE TABLE campaigns (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  operation_id        CHAR(26)     NOT NULL,             -- ULID, korelácia (D58)
  name                VARCHAR(191) NOT NULL,
  kind                ENUM('new','extend','overwrite','retry') NOT NULL DEFAULT 'new',
  parent_campaign_id  INT UNSIGNED NULL,                 -- pôvod pri extend/overwrite/retry
  percent             TINYINT UNSIGNED NOT NULL,         -- 1..30 (D11)
  date_from           DATE NOT NULL,
  date_to             DATE NOT NULL,
  date_from_original  DATE NULL,                          -- ak sa posunul (D25)
  mode                ENUM('eager','scheduled') NOT NULL,-- D22
  status              ENUM('draft','scheduled','needs_key','running',
                           'done','partial','failed','missed','cancelled','lapsed')
                      NOT NULL DEFAULT 'draft',
  status_reason       VARCHAR(255) NULL,
  fire_at             DATETIME(3) NULL,                   -- UTC, = date_from 00:05 Bratislava (D32)
  scheduled_at        DATETIME(3) NULL,
  needs_key_since     DATETIME(3) NULL,
  claimed_at          DATETIME(3) NULL,
  started_at          DATETIME(3) NULL,
  finished_at         DATETIME(3) NULL,
  items_total         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  items_ok            TINYINT UNSIGNED NOT NULL DEFAULT 0,
  items_failed        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  items_uncertain     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  confirmed_at        DATETIME(3) NULL,                   -- dry-run potvrdenie (I3)
  confirm_payload_hash CHAR(64)   NULL,                   -- SHA-256 potvrdenej sady (I3, O2)
  sudo_at             DATETIME(3) NULL,                   -- D70
  result_ack_at       DATETIME(3) NULL,                   -- notifikačný panel (D17, O6)
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
) ENGINE=InnoDB;
```

### 0005_campaign_items.sql

```sql
CREATE TABLE campaign_items (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id           INT UNSIGNED NOT NULL,
  product_id            INT UNSIGNED NOT NULL,
  position              TINYINT UNSIGNED NOT NULL,          -- deterministické poradie (I10)
  status                ENUM('pending','skipped','ok','failed','uncertain',
                             'interrupted','not_found','blocked') NOT NULL DEFAULT 'pending',
  attempt_count         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  name_at_write         VARCHAR(255) NULL,
  price_at_preview      DECIMAL(10,2) NULL,                  -- D39c protiváha
  price_at_write        DECIMAL(10,2) NULL,                  -- D39c protiváha
  price_mismatch        TINYINT(1) NOT NULL DEFAULT 0,        -- príznak nezhody (D39c bod 3)
  has_attributes        TINYINT(1) NOT NULL DEFAULT 0,        -- D60
  reduction_unverifiable TINYINT(1) NOT NULL DEFAULT 1,       -- D48 flag, kým nebude B1
  request_id            CHAR(26) NULL,                        -- D58
  http_status           SMALLINT UNSIGNED NULL,
  error_code            VARCHAR(64) NULL,
  error_message         VARCHAR(500) NULL,                    -- slovenská veta (D47)
  sent_payload          JSON NULL,                            -- bez kľúča (I1)
  raw_response          JSON NULL,                            -- redigované (D50, D66)
  started_at            DATETIME(3) NULL,
  finished_at           DATETIME(3) NULL,
  CONSTRAINT fk_items_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_items_campaign_product (campaign_id, product_id),
  KEY ix_items_product (product_id),
  KEY ix_items_status (status)
) ENGINE=InnoDB;
```

### 0006_audit_log.sql

Append-only (I4, D74). `event_type` hodnoty sú v `src/lib/audit/events.ts`:
`login_ok`, `login_fail`, `lockout`, `logout`, `sudo_ok`, `sudo_fail`,
`key_stored`, `key_verified`, `key_wiped`, `key_panic_wipe`,
`domain_changed`, `allowlist_added`, `allowlist_removed`, `allowlist_marked_unknown`,
`catalog_refreshed`, `canary_ok`, `canary_fail`,
`campaign_created`, `campaign_confirmed`, `campaign_cancelled`,
`campaign_claimed`, `campaign_needs_key`, `campaign_missed`, `campaign_lapsed`,
`campaign_from_shifted`, `campaign_finished`,
`write_attempt`, `write_ok`, `write_failed`, `write_uncertain`, `write_skipped`,
`schema_drift`, `writes_locked`, `writes_unlocked`, `reconcile_uncertain`,
`migration_applied`, `boot`, `shutdown`.

```sql
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
) ENGINE=InnoDB;
```

Runaway strop (D79) sa počíta z tejto tabuľky:

```sql
SELECT COUNT(*) FROM audit_log
WHERE event_type IN ('write_ok','write_uncertain') AND ts >= UTC_TIMESTAMP(3) - INTERVAL 1 HOUR;
```

### 0007_login_attempts.sql

```sql
CREATE TABLE login_attempts (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username  VARCHAR(64) NOT NULL,
  ip        VARCHAR(45) NOT NULL,
  success   TINYINT(1) NOT NULL,
  ts        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_attempts_ip_ts (ip, ts),
  KEY ix_attempts_user_ts (username, ts)
) ENGINE=InnoDB;
```

### 0008_grants.sql

Spúšťa migračný user; hodnoty mien userov prichádzajú z ENV a runner ich
interpoluje ako identifikátory (whitelist `^[a-z_][a-z0-9_]{2,31}$`).

```sql
REVOKE ALL PRIVILEGES ON ovl_zliav.* FROM '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.users             TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.settings          TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.scheduler_state   TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.api_key           TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.products_allowlist TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.catalog_cache     TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.campaigns         TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.campaign_items    TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON ovl_zliav.login_attempts    TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT                 ON ovl_zliav.audit_log         TO '{{APP_USER}}'@'%';  -- I4
FLUSH PRIVILEGES;
```

### Migračný runner (`scripts/migrate.ts`)

1. Pripoj sa migračným userom, `SELECT GET_LOCK('ovl_zliav_migrate', 30)` (D88).
2. `CREATE TABLE IF NOT EXISTS _migrations`.
3. Načítaj `db/migrations/*.sql` v poradí podľa číselného prefixu, spočítaj
   SHA-256; ak je záznam v `_migrations` a checksum sa nezhoduje → **fail-fast**.
3. Aplikuj chýbajúce v jednej transakcii per súbor, zapíš do `_migrations`,
   zapíš audit `migration_applied`.
4. `RELEASE_LOCK`. Nenulový exit kód ⇒ entrypoint nespustí appku (I14).

---

## 4. Stavový stroj kampaní (D83, O1)

`status` je jediný zdroj pravdy o životnom cykle. UI stavy „aktívna" a
„expirovaná" sú **derivované**: `status='done' AND dnes ≤ date_to` = aktívna;
`status IN ('done','partial') AND dnes > date_to` = expirovaná.

| Z | Do | Spúšťač prechodu | Povinný vedľajší efekt |
| --- | --- | --- | --- |
| — | `draft` | `POST /api/campaigns/preview` uloží náhľad? Nie — draft vzniká až pri `POST /api/campaigns` bez potvrdenia (interný stav v transakcii) | `operation_id`, položky `pending` |
| `draft` | `scheduled` | Vytvorenie s `mode='scheduled'` + platný `preview_token` + potvrdenie | `confirmed_at`, `confirm_payload_hash`, `fire_at` = `date_from` 00:05 Bratislava → UTC; audit `campaign_created` |
| `draft` | `running` | Vytvorenie s `mode='eager'` (kľúč platný) — zápis ide okamžite (D22) | `sudo_at`, claim, audit `campaign_created` + `campaign_claimed` |
| `scheduled` | `running` | Tick nájde `fire_at ≤ now`, kľúč platný, canary OK; atomický claim (D84) | `claimed_at`, `started_at`, audit `campaign_claimed` |
| `scheduled` | `needs_key` | Tick nájde `fire_at ≤ now`, ale kľúč chýba/expiroval/`verify_status≠valid` (D21) | `needs_key_since`, audit `campaign_needs_key`, banner na dashboarde |
| `scheduled` | `missed` | Tick nájde `fire_at` starší než `now − 5 min` **a** dôvodom nebola absencia kľúča (napr. kontajner bol vypnutý) (D33b) | audit `campaign_missed`; **NIKDY** automatický prechod do `running` |
| `scheduled` | `cancelled` | `POST /api/campaigns/[id]/cancel` alebo panic button (D67) | `status_reason`, audit `campaign_cancelled` |
| `needs_key` | `running` | Uloženie nového platného kľúča → automatické dopálenie, ak `date_to ≥ dnes` (D23, D24); pri `date_from < dnes` sa `date_from` posunie na dnes | `date_from_original`, audit `campaign_from_shifted`, claim |
| `needs_key` | `lapsed` | `date_to < dnes` v momente vyhodnotenia (D25) | audit `campaign_lapsed`, žiadny zápis |
| `needs_key` | `cancelled` | Ručné zrušenie / panic button | audit `campaign_cancelled` |
| `missed` | `running` | **Výhradne** manuálna akcia `POST /api/campaigns/[id]/execute` s novým dry-run potvrdením + sudo (D33b bod 3, I3) | nový `confirm_payload_hash`, prípadný posun `date_from` |
| `missed` | `lapsed` | `date_to < dnes` pri manuálnom pokuse | audit `campaign_lapsed` |
| `missed` | `cancelled` | Ručné zrušenie | audit `campaign_cancelled` |
| `running` | `done` | Všetky položky `ok` alebo `skipped` (D36) | `finished_at`, `items_*`, audit `campaign_finished` |
| `running` | `partial` | Aspoň jedna `ok` a aspoň jedna `failed`/`uncertain`/`not_found`/`interrupted` (D34) | to isté + `result_ack_at = NULL` (D17) |
| `running` | `failed` | Žiadna položka `ok` | to isté; ak dôvod bol 401/403 → predtým wipe kľúča (D51, D52) |
| `running` | `needs_key` | Počas dávky prišlo 401/403 → wipe kľúča a zastavenie (D51, D52) | zvyšné položky `interrupted`, audit `key_wiped` |
| `running` | `running` | `SIGTERM` — dokončí aktuálny produkt (D85) | zvyšok `interrupted`, po štarte reconcile (D86) |
| `running` | `partial`/`failed` | Reconcile pri štarte pre nedokončený beh, keď už NIE JE čo dopísať (D86) | položky, ktorých zápis mohol odísť, sú `uncertain`, audit `reconcile_uncertain` |
| `running` | `queued` | Reconcile pri štarte a kampaň má ešte nezapísané položky (D86 + K2, K6) | položky bez `request_id` zostávajú `pending` (do shopu neodišli), **žiadny** `finished_at`, audit `reconcile_uncertain` |
| `done`/`partial`/`failed`/`missed`/`lapsed` | (bez zmeny) | `POST /api/campaigns/[id]/ack` | `result_ack_at` (zmizne z notifikačného panelu) |
| `partial`/`failed` | nová kampaň `kind='retry'` | „Zopakovať zlyhané" (D15, D16) — pôvodná kampaň stav nemení | nová kampaň s `parent_campaign_id`, len zlyhané produkty |

Zakázané prechody (asserted v `lib/domain/status.ts`, porušenie = throw):
akýkoľvek prechod do `running` bez `confirmed_at` a bez `confirm_payload_hash`
(I3); `missed → running` bez nového potvrdenia (D33b); čokoľvek z terminálnych
stavov `done`/`cancelled`/`lapsed` okrem `ack`.

---

## 5. API route-y appky

Všetky pod `defineRoute()` (auth → lockout/rateLimit → Origin check → zod →
handler → error mapping). `auth: 'session'` = platná session; `auth: 'sudo'` =
session + sudo okno < 15 min (D70); `auth: 'none'` len login a health.
Každá mutácia MUSÍ mať Origin check (D72). Odpovede: `{ok:true,data}` / `{ok:false,error}`.

| Cesta | Metóda | Auth | Zod vstup | Výstup |
| --- | --- | --- | --- | --- |
| `/api/health` | GET | none | — | `{status:'ok'\|'degraded', db, key:{present,expiresAt}, scheduler:{lastTickAt,ageSec}, writesEnabled, writesLocked, version}` — nikdy `last4`, nikdy detaily kľúča |
| `/api/auth/login` | POST | none | `{username:string(1..64), password:string(12..200)}` | `{user:{id,username}}`; 429 pri lockoute (D71) |
| `/api/auth/logout` | POST | session | — | `{}` |
| `/api/auth/session` | GET | session | — | `{username, absoluteExpiresAt, idleExpiresAt, sudoUntil}` |
| `/api/auth/sudo` | POST | session | `{password:string}` | `{sudoUntil}` (D70) |
| `/api/settings` | GET | session | — | `{shopDomain, domainConfirmedAt, eagerWriteDefault, writesLocked, writesLockedReason, onboardingDoneAt}` |
| `/api/settings/domain` | PUT | sudo | `{domain: z.string().url().startsWith('https://'), password:string}` | `{shopDomain, canary:{ok,total}}` — canary GET pred uložením (D55, D80) |
| `/api/settings/test-connection` | POST | session | — | `{ok, httpStatus, total, latencyMs}` (D55) |
| `/api/settings/eager-write-default` | PUT | session | `{enabled:boolean}` | `{eagerWriteDefault}` (D22) |
| `/api/settings/unlock-writes` | POST | sudo | `{password:string}` | `{writesLocked:false}` (D79) |
| `/api/key` | GET | session | — | `{present, last4, savedAt, expiresAt, secondsLeft, verifyStatus}` (D65) |
| `/api/key` | PUT | sudo | `{apiKey: z.string().min(16).max(256)}` | `{last4, expiresAt, verifyStatus}` — sonda `reduction=0` (D53), potom auto-dopálenie `needs_key` kampaní (D24) |
| `/api/key` | DELETE | sudo | `{password:string, confirm: z.literal('KLUC UNIKOL')}` | `{wiped:true, cancelledCampaigns:n, runbookUrl}` — panic button (D67) |
| `/api/allowlist` | GET | session | — | `[{productId,slot,label,shopStatus,name,price,hasAttributes,lastOwnWrite:{percent,from,to,at}\|null}]` (D7) |
| `/api/allowlist` | POST | session | `{productId:z.number().int().positive(), label?:string}` | `{productId,slot}`; 409 ak by `slot` prekročil 10 (I2) |
| `/api/allowlist/[productId]` | DELETE | session | — | `{removed:true}`; 409 `campaign_planned` ak existuje `scheduled`/`needs_key`/`missed` kampaň (D40) |
| `/api/allowlist/[productId]/mark-unknown` | POST | session | — | `{shopStatus:'unknown'}` (D38) |
| `/api/catalog/refresh` | POST | session | `{productIds?: number[].max(10)}` | `{items:[…], via:'batch'\|'single', staleCount}` (D56, D57) |
| `/api/campaigns` | GET | session | query `{status?, page?, perPage?}` | `{data:[…], page, perPage, total}` + derivované UI stavy (D14) |
| `/api/campaigns/preview` | POST | session | `{productIds:number[].min(1).max(10), percent:int(1..30), from:'YYYY-MM-DD', to:'YYYY-MM-DD', kind:'new'\|'overwrite'\|'extend'\|'retry', parentCampaignId?:number}` | `{previewToken, items:[{productId,name,price,discountedPrice,hasAttributes,lastOwnWrite,warnings[]}], warnings:{keyExpiresBeforeStart,oneDayWindow,overwrite:[…],hasAttributes:[…]}, blockers:[…]}` (D3, D4, D60) |
| `/api/campaigns` | POST | sudo | `{previewToken:string, name:string, mode:'eager'\|'scheduled', acknowledgements:{irreversible:true, oneDay?:true}}` | `{campaignId, status}` — pri `mode='eager'` rovno spustí zápis (D2, D22, I3) |
| `/api/campaigns/[id]` | GET | session | — | kampaň + položky + audit stopa |
| `/api/campaigns/[id]/execute` | POST | sudo | `{previewToken:string}` | `{status, items:[…]}` — manuálne dopálenie `needs_key`/`missed` (D33b, I3) |
| `/api/campaigns/[id]/retry-failed` | POST | sudo | `{previewToken:string}` | `{campaignId}` — vytvorí kampaň `kind='retry'` (D15, D16, D36) |
| `/api/campaigns/[id]/extend/preview` | POST | session | `{to:'YYYY-MM-DD'}` | ako `/preview`, `from` a `percent` zamknuté (D19, D27) |
| `/api/campaigns/[id]/extend` | POST | sudo | `{previewToken:string}` | `{campaignId}` |
| `/api/campaigns/[id]/cancel` | POST | session | `{reason?:string}` | `{status:'cancelled'}` — len z `draft`/`scheduled`/`needs_key`/`missed` |
| `/api/campaigns/[id]/ack` | POST | session | — | `{acked:true}` (D17, O6) |
| `/api/audit` | GET | session | query `{productId?, campaignId?, eventType?, from?, to?, ok?, page?, perPage?}` | `{data:[…], page, perPage, total}` (D18) |
| `/api/audit/[id]` | GET | session | — | plný záznam vrátane `before_snapshot`/`after_snapshot` + príznak `priceMismatch` (D18, D39c) |
| `/api/notifications` | GET | session | — | `{unacked:[{campaignId,name,status,finishedAt}]}` (D17) |

Poznámky:
- `/api/health` je verejný v rámci compose siete (potrebuje ho docker
  healthcheck), ale nikdy nevracia nič citlivé (I1).
- Route handlery NESMÚ obsahovať zápisovú logiku — volajú `lib/engine/*`.
- Každý `previewToken` je jednorazový: po použití sa jeho `jti` zapíše do
  `campaigns.confirm_payload_hash` a druhé použitie sa odmietne.

---

## 6. Kontrakt api-clienta voči shopu (`src/lib/shop/`)

Base URL = `settings.shop_domain` (vždy https, bez trailing slash, D80).
Hlavičky pri každom volaní: `User-Agent: aura-zlavy/<APP_VERSION>`,
`Accept: application/json`, `X-Request-Id: <request_id>`; `X-Api-Key` **len** pri
zápise a sonde (čítanie je verejné — R2/D48).

### Funkcie

```ts
type Ctx = { operationId: string; requestId?: string };

listProducts(p:{page?:number; perPage?:number}, ctx:Ctx): Promise<{data:ProductListItem[]; page:number; perPage:number; total:number}>
getProduct(id:number, ctx:Ctx): Promise<ProductDetail>                        // GET /api/products/get?id=
batchGetProducts(ids:number[], ctx:Ctx): Promise<Map<number, ProductDetail | ShopError>>  // POST /api/batch, max 25, fallback na getProduct (D56)
setReduction(p:{id:number; from:string; to:string; reduction:number}, key:SecretRef, ctx:Ctx): Promise<SetReductionResult>
probeKey(key:SecretRef, ctx:Ctx): Promise<'valid'|'invalid'|'forbidden'|'unknown'>  // reduction=0 sonda (D53)
canary(ctx:Ctx): Promise<{ok:boolean; total:number; latencyMs:number}>         // GET /api/products?per_page=1 (D55)
```

`SecretRef` je callback `() => Promise<{ value: Buffer; release(): void }>`;
klient kľúč dešifruje priamo pred odoslaním a v `finally` volá `release()`,
ktoré urobí `Buffer.fill(0)` (D64, I1). Plaintext kľúč sa NESMIE objaviť ako
`string` v žiadnej premennej mimo tohto scope.

### Taxonómia chýb (D41)

```ts
type ShopErrorKind =
  | 'rate_limited'      // 429 → retryable, Retry-After, strop 90 s, max 3 (D42)
  | 'server_error'      // 500 → retryable, backoff 2/4/8 s, max 3 (D43)
  | 'network'           // DNS/connect/reset → retryable ako server_error
  | 'timeout_before'    // timeout pred odoslaním → retryable
  | 'timeout_after'     // timeout po odoslaní → 'uncertain', 1× identický resend (D45)
  | 'bad_request'       // 400 (invalid_dates, invalid_reduction, range_too_long) → terminal
  | 'unauthorized'      // 401 → terminal + wipe kľúča (D51)
  | 'forbidden'         // 403 → terminal + wipe kľúča, hláška o scope (D52)
  | 'not_found'         // 404 / "not found" → terminal, len tento produkt (D49)
  | 'schema_drift'      // HTTP 200, ale zod odpovede neprešiel → 'uncertain' + eskalácia (D54)
  | 'batch_not_allowed' // 403 v slote batchu → fallback na jednotlivé GETy (D56)
```

Klient normalizuje **obe** tvarové konvencie shopu: `{ok:false, errors:[…]}`
aj `{error:"…"}` aj `{ok:false, error:"…"}` (order/get) — mapovanie je v
`schemas.ts` a `errors.ts`. HTTP 200 s `ok:false` sa **nikdy** nepovažuje za
úspech.

### Retry politika (D42, D43, D44, D45)

| Situácia | Politika |
| --- | --- |
| 429 | `min(Retry-After, 90 s)`, max 3 pokusy, potom `rate_limited` do reportu |
| 500 / network / timeout_before | backoff 2 s → 4 s → 8 s, max 3 pokusy |
| timeout_after (zápis) | stav `uncertain`, **presne 1** identický resend, výsledok druhej odpovede je konečný |
| 400 / 401 / 403 / 404 / schema_drift | žiadny retry |
| Timeouty | čítanie 10 s, zápis 30 s (`AbortSignal.timeout`) |
| Tempo dávky | prísne sekvenčne, pauza 250 ms medzi zápismi (I10) |

Retry sa počíta **per request**; nad tým už žiadna ďalšia vrstva opakovania
neexistuje (D34).

### Korelácia a redakcia (D58, D66)

- `operation_id` (ULID) vzniká raz per operácia/kampaň, `request_id` per HTTP
  volanie; oboje ide do `campaign_items`, `audit_log` a do logu.
- Pred akýmkoľvek logovaním/ukladaním prechádza payload aj odpoveď funkciou
  `redact()`: maskuje hlavičky `authorization`, `x-api-key`, `cookie` a polia
  z denylistu (`apiKey`, `api_key`, `key`, `token`, `password`, `secret`),
  a navyše **substring scan**: ak sa v serializovanom výstupe nachádza aktuálne
  uložený kľúč (alebo jeho posledných 8 znakov), redaktor ho nahradí
  `***REDACTED***` a zapíše `logger.error('redaction_hit')`.

---

## 7. Crypto modul (`src/lib/crypto/`)

### Master key (D61)

- Súbor, cesta v `MASTER_KEY_FILE` (default `/run/secrets/master.key`),
  bind-mount `:ro`, `chmod 400`, vlastník = uid appky.
- Obsah: 64 hex znakov (32 B) alebo base64. Pri boote sa načíta raz do
  `Buffer`, skontroluje sa dĺžka a `fs.statSync().mode & 0o077 === 0`
  (inak fail-fast, I14). Master key sa NESMIE logovať ani vystaviť v `/api/health`.
- `scripts/gen-master-key.ts` ho vygeneruje a nastaví práva.

### Formát uloženého záznamu (`secret-box.ts`)

```
algoritmus : aes-256-gcm
key        : master key (32 B) — bez KDF, súbor je už náhodný
iv         : 12 B crypto.randomBytes, unikátne pre každý zápis
aad        : Buffer.from(`ovl_zliav:api_key:v${key_version}`)
tag        : 16 B GCM auth tag
uloženie   : api_key.ciphertext | api_key.iv | api_key.auth_tag (VARBINARY)
```

```ts
encryptApiKey(plain: Buffer): {ciphertext:Buffer; iv:Buffer; authTag:Buffer; keyVersion:number}
decryptApiKey(rec): Buffer          // volá sa výhradne z SecretRef
wipeBuffer(b: Buffer): void         // b.fill(0)
```

### TTL a wipe (D63, R2)

- `expires_at = created_at + API_KEY_TTL_HOURS` (48).
- **Lazy kontrola:** každé `loadApiKey()` najprv porovná `expires_at` s `now`;
  pri expirácii nevráti kľúč a spustí wipe.
- **Tick kontrola:** `scheduler/ttl-wipe.ts` beží každú minútu aj bez aktivity.
- **Wipe procedúra** (v jednej transakcii):
  1. `UPDATE api_key SET ciphertext = RANDOM_BYTES(LENGTH(ciphertext)), iv = RANDOM_BYTES(12), auth_tag = RANDOM_BYTES(16) WHERE id = 1`
  2. `DELETE FROM api_key WHERE id = 1`
  3. `appendAudit({event_type:'key_wiped', actor, message: reason})`
  4. In-memory: žiadna cache neexistuje (D64), takže niet čo invalidovať.
- Wipe dôvody: `ttl_expired`, `http_401`, `http_403`, `panic_button`,
  `replaced_by_new_key`.
- Panic button navyše: `cancel` všetkých `scheduled`/`needs_key`/`missed`
  kampaní + audit `key_panic_wipe` + runbook v UI (D67).

### Preview token (O2)

HS256 JWT (jose), secret zo `SESSION_SECRET_FILE`, TTL 15 min, claims:
`{jti, sub:userId, kind, productIds, percent, from, to, pricesAtPreview:{[id]:string}, payloadHash}`.
`payloadHash` = SHA-256 kanonického JSON `{productIds sorted, percent, from, to, kind}`.
Zápis bez platného tokenu, s expirovaným tokenom alebo s tokenom, ktorého
`payloadHash` nesúhlasí s požadovanou operáciou, MUSÍ byť odmietnutý (I3).

---

## 8. UI moduly

Bez externého UI frameworku: React 19 server/client komponenty + CSS Modules.
Jazyk UI je slovenčina, formát dátumu `DD.MM.YYYY`, desatinná čiarka.

### Layout (vždy prítomné)

| Komponent | Popis | Ref. |
| --- | --- | --- |
| `ProductionBar` | trvalý červený pruh „PRODUKCIA — <doména>" | D6 |
| `KeyTtlBadge` | odpočet TTL, farba: neutrál > 6 h, výstraha ≤ 6 h, kritická ≤ 1 h, „chýba" | D5 |
| `SchedulerBadge` | „scheduler beží / naposledy pred X min" (červená > 3 min) | D87 |
| `WriteModeBadge` | „ZÁPISY VYPNUTÉ (dev)" keď `writesEnabled=false`, „ZÁPISY ZAMKNUTÉ" pri runaway | D77, D79 |
| `ReadOnlyNotice` | pri chýbajúcom kľúči: read-only režim + inline výzva | D10 |

### Stránky

| Cesta | Obsah | Stavy |
| --- | --- | --- |
| `/login` | formulár, hláška o lockoute so zostávajúcim časom | idle / submitting / locked |
| `/onboarding` | checklist 1 doména → 2 kľúč → 3 allowlist → 4 testovací dry-run; kroky sa odomykajú postupne, koniec = dry-run, nie zápis | per-krok pending/done/error |
| `/` dashboard | `KeyCard` (last4, uložené, odpočet, verify status), `AlertsBanner` (agregované `needs_key` + `missed`), `UnackedResults` (D17), `CampaignsMini`, `AllowlistGrid` (10 kariet s cenou a badge „podľa vlastného zápisu z DD.MM.") | loading / empty / ok / degraded |
| `/produkty` | tabuľka allowlistu, pridanie/odobranie, „obnoviť z shopu", „označiť stav ako neznámy"; blokácia odobrania s vysvetlením | ok / blocked / not_found |
| `/kampane` | tabuľka s filtrom podľa plnej sady stavov, farebné badge | ok / empty |
| `/kampane/nova` | krok 1: výber produktov (len allowlist), percento (pole + čipy), okno (pickery + presety), výklad hraníc dňa; krok 2: `DryRunTable` (diff per produkt + orientačná cena + warnings) + `ConfirmPanel` (veta o nevratnosti, checkbox pri 1-dňovej zľave, prepínač eager write default ON, sudo heslo ak > 15 min) | draft → preview → confirming → writing → result |
| `/kampane/[id]` | detail, `ItemsTable` (✓/✗/neistý, slovenská hláška + raw kód), „Zopakovať zlyhané", „Predĺžiť", „Zrušiť", `AuditTrail` | podľa stavu kampane |
| `/audit` | filtre (produkt, dátum, typ, výsledok), tabuľka, detail drawer so `before/after` snapshotom a príznakom `priceMismatch` („rozhodoval si nad inou cenou") | ok / empty |
| `/nastavenia` | doména (zmena vyžaduje heslo) + „Otestovať spojenie", kľúč (vloženie/rotácia), eager write default, odomknutie zápisov, **panic button** s potvrdením textom „KLUC UNIKOL" a runbookom | ok / sudo required / locked |

### Zdieľané komponenty

`DryRunTable`, `ItemsTable`, `StatusBadge`, `PercentInput`, `DateRangePicker`,
`ConfirmPanel`, `SudoPrompt`, `Countdown`, `SelfWriteBadge` („podľa vlastného
zápisu z DD.MM."), `PriceHint` (orientačná cena + upozornenie na zaokrúhlenie),
`VariantWarning`, `ErrorMessage` (slovenská veta + rozbaľovací raw kód),
`RunbookPanel`.

Dáta sa čítajú server komponentmi; mutácie idú cez `fetch` na `/api/*`
z klientských komponentov (kvôli jednotnej pipeline a auditu). Žiadny Server
Action nesmie zapisovať do shopu — zápis vždy cez route + `lib/engine`.

---

## 9. Scheduler (`src/lib/scheduler/`)

Beží in-process (D82). Spúšťa sa z `src/instrumentation.ts` po úspešných
boot assertions; `SCHEDULER_ENABLED=false` ho vypne (pre testy a dev).

### Tick (každých `SCHEDULER_TICK_MS`, default 60 000 ms)

Poradie krokov je normatívne:

1. **Heartbeat začiatok** — zmeria `t0`.
2. **TTL wipe** (`ttl-wipe.ts`): ak `api_key.expires_at ≤ now` → wipe procedúra
   (§7). Beží ako prvé, aby žiadny ďalší krok nepoužil expirovaný kľúč (D63).
3. **Reconcile pri prvom ticku po štarte** (`reconcile.ts`, D86): kampane
   v `running` bez `finished_at` → per položka porovnať s `audit_log`
   (`write_ok` s rovnakým `request_id` = potvrdené OK). Položka, ktorej zápis
   MOHOL odísť (má `request_id`, teda aj `write_attempt`), je `uncertain` na
   manuálne rozhodnutie; položka, ktorá sa ani nezačala zapisovať (`pending`
   bez `request_id`), zostáva `pending`. Kampaň s nezapísanými položkami sa
   vracia do `queued` a dopíše sa vo fronte (K2, K6) — zavrieť ju ako
   `partial`/`failed` s `finished_at` by pri 40-dňovej fronte stratilo zvyšok
   zápisov. Audit `reconcile_uncertain` v oboch prípadoch.
4. **Missed detekcia** (`missed.ts`, D33b): `status='scheduled' AND fire_at < now − 5 min`
   → `missed` + audit. **Žiadny automatický catch-up.**
5. **Due výber a claim** (`due.ts`, D32, D84): `status='scheduled' AND fire_at ≤ now`
   (a nie v zamrznutom okne ±60 s okolo polnoci, D59) → per kampaň:
   - ak `now` je v ±60 s okolo polnoci Bratislava → preskočiť do ďalšieho ticku;
   - ak kľúč chýba/expirovaný/`verify_status≠'valid'` → `needs_key` + audit (D21);
   - ak `writes_locked` alebo `WRITES_ENABLED≠true` → `needs_key` s dôvodom
     `writes_disabled` (fail-closed, I13);
   - canary GET (D55); pri zlyhaní → `needs_key` s dôvodom `shop_unreachable`;
   - atomický claim `UPDATE campaigns SET status='running', claimed_at=... WHERE id=? AND status='scheduled'`;
     pokračovať len pri `affectedRows=1`;
   - prepočítať dátumy na aktuálny deň (D59), posunúť `date_from` ak treba (D25);
   - `engine/executor.ts` vykoná dávku (mutex, I12).
6. **Reminders** (`reminders.ts`, D26): pre `scheduled` kampane počítať
   `fire_at − now` a označiť pripomienkové pásma 48/24/2 h; UI si ich číta
   z `/api/notifications` a dashboard bannera. Pripomienka sa nikam neposiela
   (bez SMTP, D17).
7. **Heartbeat konec** — `UPDATE scheduler_state SET last_tick_at=UTC_TIMESTAMP(3), last_tick_duration_ms=…, tick_count=tick_count+1, last_error=…`.

Tick je chránený in-process flagom (jeden tick naraz) a každá výnimka sa
zaloguje do `scheduler_state.last_error` bez zhodenia procesu.

### Executor dávky (`engine/executor.ts`)

```
acquireMutex()                                        // D37, I12
guards: writesEnabled && !writesLocked                // I13
guards: runawayCount < RUNAWAY_LIMIT_PER_HOUR         // D79 → inak lock + audit
guards: každý productId je v aktívnom allowlistě      // I2, fail-closed
guards: percent 1..30, to≥from, window ≤ 3 mesiace    // I9
for (item of items sorted by position) {              // I10
  GET /products/get                                    // D48 povinné
  if not_found → item.status='not_found'; allowlist.shop_status='not_found'; continue   // D49
  price_at_write = detail.price; price_mismatch = price_at_preview !== price_at_write    // D39c (neblokuje)
  if (kind==='retry' && už existuje write_ok s identickými parametrami) → 'skipped'      // D36
  audit write_attempt
  POST /products/setReduction  (SecretRef, retry politika §6)
  → ok            : item.status='ok';        audit write_ok
  → uncertain     : item.status='uncertain'; audit write_uncertain
  → 401/403       : wipeKey(reason); zvyšok 'interrupted'; kampaň → needs_key; break     // D51, D52
  → schema_drift  : item.status='uncertain'; audit schema_drift
  → iná chyba     : item.status='failed';    audit write_failed
  sleep(250 ms)                                                                          // D46
  if (SIGTERM prijatý) { zvyšok 'interrupted'; break }                                   // D85
}
prepočítaj items_* a nastav done | partial | failed; result_ack_at = NULL
releaseMutex()
```

Mutex je in-process semafor **plus** DB poistka: `SELECT GET_LOCK('ovl_zliav_write', 0)`
(aby ani omylom spustená druhá inštancia nezapisovala súbežne).

---

## 10. Docker, compose, Caddy, hardening

### `docker-compose.yml`

> **Pasca (R10):** service names MUSIA byť unikátne v rámci celej rodiny
> stackov — `ovl-zliav-app`, `ovl-zliav-db`, `ovl-zliav-caddy`. Názvy `app`,
> `db`, `web`, `caddy` sú **zakázané**, inak network alias koliduje s iným
> stackom a Caddy začne servírovať cudziu appku.

```yaml
name: ovl-zliav

services:
  ovl-zliav-db:
    image: mariadb:11.4
    container_name: ovl-zliav-db
    restart: unless-stopped
    # ŽIADNE ports: (I5, D96)
    environment:
      MARIADB_DATABASE: ovl_zliav
      MARIADB_ROOT_PASSWORD_FILE: /run/secrets/db_root_password
      MARIADB_USER: ovl_zliav_app
      MARIADB_PASSWORD_FILE: /run/secrets/db_app_password
    volumes:
      - ovl-zliav-db-data:/var/lib/mysql
      - ./secrets/db_root_password:/run/secrets/db_root_password:ro
      - ./secrets/db_app_password:/run/secrets/db_app_password:ro
    healthcheck:
      test: ["CMD", "mariadb-admin", "ping", "-h", "127.0.0.1", "--silent"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    networks: [ovl-zliav-net]
    security_opt: ["no-new-privileges:true"]

  ovl-zliav-app:
    build: .
    container_name: ovl-zliav-app
    restart: unless-stopped
    # ŽIADNE ports: — dostupná len cez ovl-zliav-caddy (I5, D96)
    depends_on:
      ovl-zliav-db:
        condition: service_healthy
    env_file: [./.env]
    environment:
      NODE_ENV: production
      HOSTNAME: 0.0.0.0          # vnútri kontajnera; localhost-only garantuje publikovaný mapping Caddy (O5)
      PORT: "3000"
      PUBLIC_BIND: 127.0.0.1     # kontrolované boot assertion (D78)
      DB_HOST: ovl-zliav-db
    volumes:
      - ./secrets/master.key:/run/secrets/master.key:ro      # chmod 400 (D61)
      - ./secrets/session.key:/run/secrets/session.key:ro
      - ./secrets/db_app_password:/run/secrets/db_app_password:ro
      - ./secrets/db_mig_password:/run/secrets/db_mig_password:ro
    user: "10050:10050"                                       # non-root (D98)
    read_only: true
    tmpfs: ["/tmp", "/app/.next/cache"]
    cap_drop: ["ALL"]
    security_opt: ["no-new-privileges:true"]
    stop_grace_period: 30s                                    # D85
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 40s
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }              # D92
    networks: [ovl-zliav-net]

  ovl-zliav-caddy:
    image: caddy:2-alpine
    container_name: ovl-zliav-caddy
    restart: unless-stopped
    depends_on:
      ovl-zliav-app:
        condition: service_healthy
    ports:
      - "127.0.0.1:3070:3070"      # JEDINÝ publikovaný port (R4, D96, I5)
    volumes:
      - ./secrets/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./secrets/basicauth.hash:/etc/caddy/basicauth.hash:ro   # bcrypt mimo gitu (D97)
      - ovl-zliav-caddy-data:/data
      - ovl-zliav-caddy-config:/config
    security_opt: ["no-new-privileges:true"]
    networks: [ovl-zliav-net]

volumes:
  ovl-zliav-db-data:
  ovl-zliav-caddy-data:
  ovl-zliav-caddy-config:

networks:
  ovl-zliav-net:
    driver: bridge
```

### `Caddyfile.example`

Repo obsahuje **len** example; reálny `secrets/Caddyfile` s hashom je mimo gitu (D97).

```caddyfile
{
  admin off
  # ak by sa v budúcnosti pridal reverse proxy/tunel, doplniť:
  # servers { trusted_proxies static private_ranges }
}

localhost:3070 {
  tls internal                                   # D94

  basic_auth {                                   # D97
    samuel {$OVL_ZLIAV_BASICAUTH_HASH}           # hodnota z /etc/caddy/basicauth.hash
  }

  header {                                       # D95
    Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "no-referrer"
    Strict-Transport-Security "max-age=31536000"
    -Server
  }

  encode gzip
  reverse_proxy ovl-zliav-app:3000
}
```

Návod na trust root certu (`docs/21-RUNBOOKY.md`): `docker compose cp
ovl-zliav-caddy:/data/caddy/pki/authorities/local/root.crt .` → import do
Windows „Trusted Root Certification Authorities" (D94).

### `Dockerfile` (multi-stage, standalone)

1. `deps` — `npm ci`.
2. `build` — `npm run build` (Next.js standalone).
3. `runner` — `node:22-alpine`, `addgroup -g 10050 && adduser -u 10050`,
   kopíruje `.next/standalone`, `.next/static`, `public`, `db/migrations`,
   `scripts/`; `USER 10050`; `ENTRYPOINT ["/app/scripts/entrypoint.sh"]`.

`entrypoint.sh`: (1) čaká na DB (retry, D91), (2) spustí `scripts/migrate.ts`
migračným userom — pri chybe exit ≠ 0 (D88, I14), (3) `exec node server.js`.

### Ostatné hardening body

- `.gitignore`: `.env`, `secrets/`, `backups/`, `.next/`, `*.key`, `*.hash` (I1).
- `.gitleaks.toml` s pravidlom na tvar shop API kľúča; CI blokujúci (D99).
- `scripts/backup.sh`: `mysqldump --ignore-table=ovl_zliav.api_key` (D76, D90),
  gzip do `./backups/`, rotácia 14 dní, `restore-test.sh` obnoví do temp DB
  a skontroluje počet riadkov `audit_log`.

---

## 11. ENV premenné a zod schéma (`src/env.ts`)

Fail-fast pri boote s vymenovaním všetkých chýb naraz (D93, I14).

| Premenná | Typ / default | Účel |
| --- | --- | --- |
| `NODE_ENV` | `'development'\|'test'\|'production'` | poistka zápisu (D77) |
| `WRITES_ENABLED` | `'true'\|'false'`, default `'false'` | druhá poistka zápisu (D77, I13) |
| `PUBLIC_BIND` | string, MUSÍ byť `127.0.0.1` | boot assertion (D78, I5) |
| `PORT` | int, default 3000 | interný port appky |
| `APP_VERSION` | string | User-Agent `aura-zlavy/<verzia>` (D58) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | string / int 3306 / `ovl_zliav` | pripojenie |
| `DB_USER` / `DB_PASSWORD_FILE` | `ovl_zliav_app` / cesta | app user (D89) |
| `DB_MIGRATION_USER` / `DB_MIGRATION_PASSWORD_FILE` | `ovl_zliav_mig` / cesta | migrácie (D89) |
| `MASTER_KEY_FILE` | cesta, default `/run/secrets/master.key` | AES master key (D61) |
| `SESSION_SECRET_FILE` | cesta | JWT session + preview token (D69, O2) |
| `API_KEY_TTL_HOURS` | int, default 48, max 48 | TTL kľúča (R2) — hodnota > 48 je chyba |
| `SESSION_ABSOLUTE_HOURS` | int, default 8 | D69 |
| `SESSION_IDLE_MINUTES` | int, default 30 | D69 |
| `SUDO_WINDOW_MINUTES` | int, default 15 | D70 |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | 5 / 15 | D71 |
| `SCHEDULER_ENABLED` | bool, default `true` | D82 |
| `SCHEDULER_TICK_MS` | int, default 60000 | D82 |
| `SCHEDULER_FIRE_TIME` | `HH:mm`, default `00:05` | D32 |
| `LOGIC_TIMEZONE` | string, default `Europe/Bratislava` | D31 |
| `SHOP_TIMEOUT_READ_MS` | int, default 10000 | D44 |
| `SHOP_TIMEOUT_WRITE_MS` | int, default 30000 | D44 |
| `SHOP_WRITE_PAUSE_MS` | int, default 250 | D46 |
| `SHOP_RETRY_MAX` | int, default 3 | D42, D43 |
| `SHOP_RETRY_AFTER_CAP_S` | int, default 90 | D42 |
| `MAX_PRODUCTS_PER_OPERATION` | int, default 10, **max 10** | I2 — vyššia hodnota je chyba configu |
| `ALLOWLIST_MAX` | int, default 10, **max 10** | I2 |
| `RUNAWAY_LIMIT_PER_HOUR` | int, default 60 | D79 |
| `MIDNIGHT_FREEZE_SECONDS` | int, default 60 | D59 |
| `LOG_LEVEL` | `'debug'\|'info'\|'warn'\|'error'`, default `'info'` | D92 |
| `SHOP_BASE_URL_OVERRIDE` | optional URL, **povolené len ak `NODE_ENV!=='production'`** | mock v testoch (I6) |

Doména shopu **nie je** ENV premenná — žije v `settings.shop_domain`, zadáva sa
v UI (R5, D80). `SHOP_BASE_URL_OVERRIDE` existuje výhradne pre testy a v
produkcii je jeho prítomnosť fail-fast chyba.

### Boot assertions (`src/instrumentation.ts`)

1. `env.ts` parse → fail-fast (D93).
2. `PUBLIC_BIND === '127.0.0.1'` inak `process.exit(1)` (D78, I5).
3. `NODE_ENV==='production' && SHOP_BASE_URL_OVERRIDE` → exit (I6).
4. `MAX_PRODUCTS_PER_OPERATION ≤ 10 && ALLOWLIST_MAX ≤ 10` inak exit (I2).
5. Master key čitateľný, správna dĺžka a práva (D61).
6. DB dosiahnuteľná, `_migrations` obsahuje všetky súbory z `db/migrations`
   (inak exit — migrácie mal spustiť entrypoint) (D88).
7. Audit `boot`, potom start schedulera (D82).

---

## 12. Testovacia stratégia a mock shop

### Vrstvy

| Vrstva | Nástroj | Čo pokrýva |
| --- | --- | --- |
| Unit | vitest | `domain/dates`, `domain/percent`, `campaign-rules`, `status` (povolené/zakázané prechody), `crypto/secret-box`, `log/redact`, `shop/errors`, `shop/retry` |
| Integračné | vitest + reálna MariaDB + mock shop | migrácie, repozitáre, `engine/executor` (OK / partial / 401 wipe / not_found / uncertain / SIGTERM), scheduler tick (needs_key, missed, TTL wipe, claim race), route-y cez `defineRoute` |
| E2E | Playwright | login → onboarding → allowlist → dry-run → potvrdenie → výsledok; read-only režim po expirácii; audit filter; panic button |
| Bezpečnostné | vitest + CI | redaction test (I1), bind/compose test (I5), „no real host" guard (I6), gitleaks, `npm audit` |

### Povinné testy vyplývajúce z invariantov

| Test | Overuje |
| --- | --- |
| `test/integration/redaction.spec.ts` | po celom write flow s kľúčom `TESTKEY-abc123…` neobsahuje žiadny riadok `audit_log`, `campaign_items`, ani zachytený stdout log tento kľúč ani jeho posledných 8 znakov (I1, D66) |
| `test/unit/guards.spec.ts` | product ID mimo allowlistu, 11 produktov, percento 0/31/12,5, okno 4 mesiace, `from` v minulosti — všetko odmietnuté **pred** volaním klienta (I2, I9) |
| `test/integration/no-write-without-confirm.spec.ts` | `POST /api/campaigns` bez `previewToken`, s expirovaným tokenom a s tokenom pre inú sadu → 4xx a **nula** requestov na mock (I3) |
| `test/integration/audit-append-only.spec.ts` | pokus o `UPDATE`/`DELETE` na `audit_log` app userom → chyba grantu (I4) |
| `test/unit/compose-bind.spec.ts` | `docker-compose.yml`: `ovl-zliav-app` a `ovl-zliav-db` nemajú `ports:`, `ovl-zliav-caddy` publikuje výhradne `127.0.0.1:3070:3070`; service names nie sú `app`/`db`/`caddy` (I5, R10) |
| `test/setup.ts` guard | globálny `fetch` wrapper zhodí test pri hostname ≠ `127.0.0.1`/`localhost` (I6) |
| `test/unit/no-clear-reduction.spec.ts` | grep zdrojov: žiadny `setReduction` s `to` v minulosti, žiadna funkcia `clearReduction`/`cancelReduction` voči shopu (I7) |
| `test/unit/no-orders-scope.spec.ts` | grep zdrojov: žiadny výskyt `/api/order` ani `orders:read` (I8) |
| `test/integration/sequential-writes.spec.ts` | mock zaznamená timestampy: zápisy sú sériové s odstupom ≥ 250 ms, nikdy prekrývajúce sa (I10) |
| `test/integration/runaway-lock.spec.ts` | 61. zápis v hodine zamkne `settings.writes_locked` a ďalší pokus je odmietnutý (I12, D79) |
| `test/integration/deviation-33.spec.ts` | kampaň s `fire_at` pred 30 min pri „vypnutom" scheduleri skončí v `missed` a **žiadny** tick ju nespustí (D33b) |
| `test/integration/deviation-39.spec.ts` | zmena ceny medzi preview a write zápis nezastaví, ale `price_at_preview ≠ price_at_write` a `price_mismatch=1` (D39c) |

### Mock shop server (`test/mock-shop/`)

Samostatný `node:http` server na ephemeral porte, plne programovateľný.
Implementuje podmnožinu z `docs/api/sperky-api.md`:

- `GET /api/products` — paginácia, `data/page/per_page/total`.
- `GET /api/products/get?id=` — `{ok:true,…}` / `{ok:false,errors:['not found']}` (404).
- `POST /api/products/setReduction` — kontroluje `X-Api-Key`/`Authorization`,
  scope, validuje `reduction 0<x≤30`, `to≥from`, okno ≤ 3 mesiace; vracia
  `{ok:true,id}` alebo `{ok:false,errors:[…]}` s korektným HTTP statusom.
- `POST /api/batch` — max 25, positional `results`, `batch_not_allowed` pre
  `setReduction`, `invalid_item` pre malformed položku.
- Transportné chyby a rate limit: `{error:'…'}` tvar + `Retry-After`.

Programovateľné scenáre (`state.ts`): `failNth(n, kind)`, `delay(ms)`,
`unauthorizedAfter(n)`, `forbidden()`, `rateLimit(retryAfter)`,
`returnGarbage()` (schema drift), `hangWrite()` (timeout po odoslaní),
`changePrice(id, newPrice)` (pre D39c), `recordedRequests[]` s timestampmi
a hlavičkami (na overenie redakcie a tempa).

### CI (`.github/workflows/ci.yml`)

- `push`: `npm ci` → `lint` → `typecheck` → `vitest run` (s MariaDB service
  containerom) → `next build` → `gitleaks` → `npm audit --audit-level=high`.
- `pull_request`: navyše `playwright test` (app + mock shop, `WRITES_ENABLED=true`,
  `NODE_ENV=production`, `SHOP_BASE_URL_OVERRIDE` na mock — povolené len mimo
  reálneho deployu).
- Krok `compose-bind` spúšťa `scripts/check-compose-bind.ts` (I5).
- Job zlyhá pri akomkoľvek high/critical náleze (D99).
