#!/bin/sh
# Aura Zľavy — denná záloha DB (D76, D90, I1).
#
# - mysqldump BEZ tabuľky `api_key` (D76, I1 — kľúč nesmie byť v zálohe),
# - gzip do ./backups/, rotácia 14 dní,
# - spúšťať denne (host cron), napr.: 15 3 * * * /path/to/repo/scripts/backup.sh
#
# Restore test: scripts/restore-test.sh (runbook v docs/21-RUNBOOKY.md).
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
DB_CONTAINER="${DB_CONTAINER:-ovl-zliav-db}"
DB_NAME="${DB_NAME:-ovl_zliav}"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/ovl_zliav-$STAMP.sql.gz"

# `--ignore-table=api_key` chráni OBA kľúče, a to bez ďalšej zmeny (P5, D76, I1):
# druhý kľúč (`orders_read`) nedostal vlastnú tabuľku, žije ako ĎALŠÍ RIADOK
# v tej istej `api_key` (rozlíšený stĺpcom `kind`, migrácia 0009). Vylúčenie je
# na úrovni TABUĽKY, takže sa vzťahuje na každý riadok bez ohľadu na druh —
# a bude platiť aj pre prípadný tretí druh kľúča. Overené: v dumpe nesmie byť
# ani INSERT INTO api_key, ani CREATE TABLE api_key.
#
# Root heslo číta mysqldump vnútri kontajnera zo secret súboru — heslo sa
# NIKDY neobjaví v argumentoch procesu na hoste ani v tomto skripte (I1).
docker exec "$DB_CONTAINER" sh -c '
  exec mariadb-dump \
    --user=root \
    --password="$(cat /run/secrets/db_root_password)" \
    --single-transaction \
    --routines=false \
    --ignore-table='"$DB_NAME"'.api_key \
    '"$DB_NAME"'
' | gzip > "$OUT"

chmod 600 "$OUT"
echo "[backup] zapísané: $OUT ($(du -h "$OUT" | cut -f1))"

# Rotácia: zmaž zálohy staršie než 14 dní (D90).
find "$BACKUP_DIR" -name 'ovl_zliav-*.sql.gz' -type f -mtime +"$RETENTION_DAYS" -print -delete |
  sed 's/^/[backup] rotácia — zmazané: /' || true

echo "[backup] hotovo."
