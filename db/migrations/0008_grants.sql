-- 0008_grants.sql — granty aplikačného DB usera (BUILD-SPEC §3; D89; INVARIANT I4)
--
-- Spúšťa migračný user. `{{APP_USER}}` a `{{DB_NAME}}` interpoluje runner ako
-- IDENTIFIKÁTORY podľa whitelistu `^[a-z_][a-z0-9_]{2,31}$` — nič iné sa
-- do SQL nedostane.
--
-- INVARIANT I4: `audit_log` dostane VÝHRADNE `SELECT, INSERT`. Žiadny
-- `UPDATE`/`DELETE` grant, takže audit je append-only aj keby sa aplikačný kód
-- pomýlil. Aplikačný user zároveň NEMÁ žiadne DDL právo (D89).
--
-- POZOR — dve požiadavky na prvý setup (patria do docs/21-RUNBOOKY.md, A14):
--   1) aplikačný DB user musí existovať PREDTÝM (vytvára ho compose cez
--      `MARIADB_USER`, resp. setup skript). Migrácia užívateľov nevytvára —
--      nesmela by pri tom poznať heslo (I1);
--   2) migračný user musí mať práva na tejto DB `WITH GRANT OPTION`, inak
--      MariaDB odmietne REVOKE/GRANT s chybou 1044 a štart appky sa preruší:
--        GRANT ALL PRIVILEGES ON `ovl_zliav`.* TO 'ovl_zliav_mig'@'%' WITH GRANT OPTION;
--
-- `-- @tolerate-errno:` je direktíva runnera: uvedené MariaDB chyby sa pri danom
-- príkaze ignorujú. Používa sa len tam, kde je chyba dôsledkom čistého stavu
-- (REVOKE bez existujúceho grantu) alebo chýbajúceho práva RELOAD.

-- @tolerate-errno: 1141, 1147
REVOKE ALL PRIVILEGES ON `{{DB_NAME}}`.* FROM '{{APP_USER}}'@'%';

GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.users              TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.settings           TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.scheduler_state    TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.api_key            TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.products_allowlist TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.catalog_cache      TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.campaigns          TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.campaign_items     TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.login_attempts     TO '{{APP_USER}}'@'%';
GRANT SELECT, INSERT                 ON `{{DB_NAME}}`.audit_log          TO '{{APP_USER}}'@'%';  -- I4
GRANT SELECT                         ON `{{DB_NAME}}`._migrations        TO '{{APP_USER}}'@'%';

-- @tolerate-errno: 1227, 1045
FLUSH PRIVILEGES;
