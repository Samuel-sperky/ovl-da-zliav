-- 0010_fronta_a_pasma.sql — fronta, pásma a rozsah (KONTRAKT V3: K1, K2, K3, K5)
--
-- Prečo vôbec: pôvodná schéma bola postavená na vete „max 10 produktov".
-- Reálne použitie je 5–10 tisíc produktov na jednu zľavu, takže:
--   * zápis prestáva byť akcia a stáva sa frontou → nový stav `queued` (K2),
--   * počítadlá TINYINT (max 255) prestávajú stačiť → INT UNSIGNED,
--   * strop 10 000 položiek musí byť aj v DB, nielen v kóde (K1 bod 3),
--   * jedna zľava má viac pásiem s rôznym percentom → `campaign_tiers` (K3),
--   * percento sa rozhoduje pri POTVRDENÍ, nie pri zápise → `campaign_items.percent`
--     (K3). Executor pásma nikdy nevyhodnocuje; berie hotové číslo z položky.
--
-- POZOR pri ALTER na ENUM (MariaDB): `MODIFY COLUMN` musí vymenovať VŠETKY
-- doterajšie hodnoty, inak sa existujúce riadky prepíšu na prázdny reťazec.
-- Nová hodnota `queued` sa preto pridáva na KONIEC pôvodného zoznamu z 0004.
--
-- Migrácia musí prejsť aj na DB, ktorá už má dáta — preto sa `percent`
-- pridáva s dočasným DEFAULT, dopĺňa sa z `campaigns.percent` a až potom
-- dostane CHECK a stratí DEFAULT (aby ho zapisovateľ musel vždy uviesť).
--
-- POZOR na následok: po tejto migrácii `INSERT INTO campaign_items` BEZ stĺpca
-- `percent` zlyhá. Je to zámer (K3 — percento sa rozhoduje pri potvrdení),
-- takže `campaign-items.repo.ts` ho musí začať zapisovať.
--
-- POZOR 2: DDL v MariaDB implicitne commituje, takže transakcia runnera tu
-- nechráni pred polovičným stavom. Keď migrácia padne uprostred, zostane
-- čiastočne zmenená schéma a riadok v `_migrations` NIE JE — upratanie je
-- manuálne, presne ako hovorí D88 o rollbacku.

-- ── campaigns: stav fronty, veľké počítadlá, tvrdý strop, príznak meškania ──

ALTER TABLE campaigns
  MODIFY COLUMN status ENUM('draft','scheduled','needs_key','running',
                            'done','partial','failed','missed','cancelled','lapsed',
                            'queued')
                 NOT NULL DEFAULT 'draft';

ALTER TABLE campaigns
  MODIFY COLUMN items_total     INT UNSIGNED NOT NULL DEFAULT 0,
  MODIFY COLUMN items_ok        INT UNSIGNED NOT NULL DEFAULT 0,
  MODIFY COLUMN items_failed    INT UNSIGNED NOT NULL DEFAULT 0,
  MODIFY COLUMN items_uncertain INT UNSIGNED NOT NULL DEFAULT 0;

-- K1 bod 3: aplikačná validácia sama o sebe nikdy nestačila.
ALTER TABLE campaigns
  ADD CONSTRAINT ck_campaigns_items_total CHECK (items_total <= 10000);

-- K5: fronta nestihla dobehnúť do `date_from`. Nie je to chyba zápisu, je to
-- fakt o čase — okno (`date_to`) sa kvôli tomu NIKDY neskracuje (I7).
ALTER TABLE campaigns
  ADD COLUMN late TINYINT(1) NOT NULL DEFAULT 0 AFTER status_reason;

-- Fronta sa vyberá podľa stavu a času štartu.
ALTER TABLE campaigns
  ADD KEY ix_campaigns_queue (status, date_from);

-- ── campaign_items: poradie na desaťtisíce a percento na položke ────────────

-- I10 (deterministické sekvenčné poradie) zostáva, len sa zmestí viac než 255.
ALTER TABLE campaign_items
  MODIFY COLUMN position INT UNSIGNED NOT NULL;

-- K3: percento rozhodnuté pri potvrdení. Zabraňuje tomu, aby sa produkt medzi
-- potvrdením a zápisom presunul do iného pásma.
ALTER TABLE campaign_items
  ADD COLUMN percent TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER product_id;

-- Dopln existujúce riadky z hlavičky kampane (dovtedy bolo percento len tam).
UPDATE campaign_items i
  JOIN campaigns c ON c.id = i.campaign_id
   SET i.percent = c.percent;

-- I9 sa neoslabuje, ale utrojnásobuje (K3).
ALTER TABLE campaign_items
  ADD CONSTRAINT ck_items_percent CHECK (percent BETWEEN 1 AND 30);

-- DEFAULT bol len pomôcka na dopnenie; zapisovateľ musí percento vždy uviesť.
ALTER TABLE campaign_items
  ALTER COLUMN percent DROP DEFAULT;

-- ── campaign_tiers: pásma jednej zľavy (K3) ────────────────────────────────
-- `rule` je JSON LEN na zobrazenie a zopakovanie filtra. Pri zápise sa
-- NEVYHODNOCUJE — executor berie percento z `campaign_items.percent`.
CREATE TABLE campaign_tiers (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  campaign_id  INT UNSIGNED NOT NULL,
  ord          TINYINT UNSIGNED NOT NULL,          -- poradie pásma v zľave, 1..n
  label        VARCHAR(191) NOT NULL,              -- napr. „0 predaných za 360 dní"
  percent      TINYINT UNSIGNED NOT NULL,          -- 1..30 (K3, I9)
  rule         JSON NULL,                          -- len na zobrazenie, nie na zápis
  items_count  INT UNSIGNED NOT NULL DEFAULT 0,    -- kolko produktov padlo do pásma
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_tiers_campaign FOREIGN KEY (campaign_id)
    REFERENCES campaigns(id) ON DELETE RESTRICT,
  CONSTRAINT ck_tiers_percent CHECK (percent BETWEEN 1 AND 30),
  UNIQUE KEY uq_tiers_campaign_ord (campaign_id, ord),
  KEY ix_tiers_campaign (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── settings: režim rozsahu a denný rozpočet ───────────────────────────────
-- K1 bod 1 (fail-closed): predvolený režim je `pilot`. Chýbajúca, nečitateľná
-- alebo neznáma hodnota sa v kóde číta ako `pilot` — nikdy ako `plny`.
-- K2: `daily_write_budget` je PLÁNOVANÁ rýchlosť. Skutočná spotreba sa počíta
-- výhradne z auditu (`write_attempt` za UTC deň) — žiadny paralelný stĺpec,
-- ktorý by sa mohol rozísť.
ALTER TABLE settings
  ADD COLUMN scope_mode ENUM('pilot','plny') NOT NULL DEFAULT 'pilot'
    AFTER eager_write_default,
  ADD COLUMN max_products_per_campaign INT UNSIGNED NOT NULL DEFAULT 10000
    AFTER scope_mode,
  ADD COLUMN daily_write_budget SMALLINT UNSIGNED NOT NULL DEFAULT 200
    AFTER max_products_per_campaign;

-- Strop na jednu zľavu sa nesmie nastaviť nad tvrdý DB strop z `campaigns`.
ALTER TABLE settings
  ADD CONSTRAINT ck_settings_max_products CHECK (max_products_per_campaign BETWEEN 1 AND 10000);

-- Rozpočet je konfigurovateľný NADOL; 200/deň je strop shopu, nie náš.
ALTER TABLE settings
  ADD CONSTRAINT ck_settings_daily_budget CHECK (daily_write_budget BETWEEN 1 AND 200);
