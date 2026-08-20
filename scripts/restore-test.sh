#!/bin/sh
# Aura Zľavy — restore test zálohy (D90, runbook docs/21-RUNBOOKY.md).
#
# Obnoví najnovšiu (alebo zadanú) zálohu do DOČASNEJ databázy
# `ovl_zliav_restore_test` v bežiacom DB kontajneri, skontroluje počet riadkov
# `audit_log` a overí, že tabuľka `api_key` v zálohe NIE JE (D76, I1).
# Dočasnú DB na konci zmaže.
#
# Použitie: scripts/restore-test.sh [cesta-k-zalohe.sql.gz]
set -eu

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
DB_CONTAINER="${DB_CONTAINER:-ovl-zliav-db}"
TEST_DB="ovl_zliav_restore_test"

BACKUP="${1:-}"
if [ -z "$BACKUP" ]; then
  BACKUP="$(ls -1t "$BACKUP_DIR"/ovl_zliav-*.sql.gz 2>/dev/null | head -n 1 || true)"
fi
if [ -z "$BACKUP" ] || [ ! -f "$BACKUP" ]; then
  echo "[restore-test] žiadna záloha nenájdená v $BACKUP_DIR" >&2
  exit 1
fi
echo "[restore-test] testujem zálohu: $BACKUP"

# 1. Záloha NESMIE obsahovať tabuľku api_key (D76, I1) — fail-closed kontrola.
if gzip -dc "$BACKUP" | grep -qi 'CREATE TABLE.*`api_key`'; then
  echo "[restore-test] CHYBA: záloha obsahuje tabuľku api_key — porušenie D76/I1!" >&2
  exit 1
fi
echo "[restore-test] OK: api_key v zálohe nie je."

run_sql() {
  docker exec -i "$DB_CONTAINER" sh -c '
    exec mariadb --user=root --password="$(cat /run/secrets/db_root_password)" '"$*"'
  '
}

# 2. Obnova do dočasnej DB.
printf 'DROP DATABASE IF EXISTS %s; CREATE DATABASE %s CHARACTER SET utf8mb4;\n' "$TEST_DB" "$TEST_DB" | run_sql
gzip -dc "$BACKUP" | run_sql "$TEST_DB"
echo "[restore-test] obnova do $TEST_DB prebehla."

# 3. Kontrola audit_log.
ROWS="$(printf 'SELECT COUNT(*) FROM %s.audit_log;\n' "$TEST_DB" | run_sql --skip-column-names --batch)"
echo "[restore-test] audit_log riadkov: $ROWS"
if [ -z "$ROWS" ]; then
  echo "[restore-test] CHYBA: audit_log sa nepodarilo prečítať." >&2
  exit 1
fi

# 4. Upratanie.
printf 'DROP DATABASE %s;\n' "$TEST_DB" | run_sql
echo "[restore-test] OK — záloha je obnoviteľná, dočasná DB zmazaná."
