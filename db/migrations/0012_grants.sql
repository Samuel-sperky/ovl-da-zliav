-- 0012_grants.sql — granty pre objekty pridané v 0010 (INVARIANT I4; K11 bod 1)
--
-- `0008_grants.sql` menuje KONKRÉTNE tabuľky, nie `{{DB_NAME}}`.*, takže nová
-- tabuľka `campaign_tiers` by pre aplikačného usera neexistovala. Grant sa
-- preto dopĺňa TU — 0008 sa needituje ani o medzeru, lebo runner overuje
-- SHA-256 checksum každej už aplikovanej migrácie a zmena by zhodila štart
-- appky (D88, I14).
--
-- `campaign_items`, `campaigns`, `catalog_cache` a `settings` už granty z 0008
-- majú a MariaDB ich udeluje na úrovni tabuľky, nie stĺpca — nové stĺpce z
-- 0010/0011 teda žiadny ďalší grant nepotrebujú.
--
-- INVARIANT I4 sa nemení: `audit_log` má stále výhradne `SELECT, INSERT`.
-- Táto migrácia mu žiadne právo nepridáva ani neodoberá, a aplikačný user
-- naďalej nemá žiadne DDL (D89).
--
-- `-- @tolerate-errno:` je direktíva runnera (viď 0008): 1227/1045 pri
-- `FLUSH PRIVILEGES` je dôsledok chýbajúceho práva RELOAD, nie chyba schémy.

GRANT SELECT, INSERT, UPDATE, DELETE ON `{{DB_NAME}}`.campaign_tiers TO '{{APP_USER}}'@'%';

-- @tolerate-errno: 1227, 1045
FLUSH PRIVILEGES;
