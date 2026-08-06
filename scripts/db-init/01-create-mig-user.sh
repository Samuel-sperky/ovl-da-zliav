#!/bin/sh
# Aura Zľavy — vytvorenie MIGRAČNÉHO DB usera pri PRVEJ inicializácii dát (D89).
#
# MariaDB obraz cez MARIADB_USER založí len aplikačného usera `ovl_zliav_app`.
# Migrácie ale bežia ako `ovl_zliav_mig` s právami WITH GRANT OPTION (0008
# odoberá app userovi UPDATE/DELETE na audit_log — I4), a toho nemá kto
# vytvoriť. Bez tohto skriptu migrácie padnú na "access denied", appka
# fail-fast skončí a Caddy (depends_on: service_healthy) nikdy nenaštartuje.
#
# Beží VÝHRADNE pri prázdnom dátovom volume (docker-entrypoint-initdb.d).
# Ak volume vznikol ešte pred týmto skriptom: `docker compose down -v` a znova
# `up` — dáta tam žiadne nie sú, migrácie nikdy neprebehli.
set -eu

MIG_PASSWORD="$(cat /run/secrets/db_mig_password)"
DB_NAME="${MARIADB_DATABASE:-ovl_zliav}"

mariadb --protocol=socket -uroot -p"${MARIADB_ROOT_PASSWORD:-$(cat /run/secrets/db_root_password)}" <<SQL
CREATE USER IF NOT EXISTS 'ovl_zliav_mig'@'%' IDENTIFIED BY '${MIG_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO 'ovl_zliav_mig'@'%' WITH GRANT OPTION;
FLUSH PRIVILEGES;
SQL

echo "[db-init] migračný user ovl_zliav_mig vytvorený (GRANT ALL ON ${DB_NAME}.* WITH GRANT OPTION)"
