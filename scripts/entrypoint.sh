#!/bin/sh
# Aura Zľavy — entrypoint kontajnera (BUILD-SPEC §10, D88, D91, I14).
#
# 1. Čaká na DB (retry, D91).
# 2. Spustí migrácie MIGRAČNÝM userom (scripts/migrate.ts, D88, D89).
#    Nenulový exit = appka sa NESPUSTÍ (fail-fast, I14).
# 3. exec node server.js (Next.js standalone).
#
# INVARIANT I1: skript nikdy nevypisuje obsah súborov s tajomstvami.
set -eu

DB_HOST="${DB_HOST:-ovl-zliav-db}"
DB_PORT="${DB_PORT:-3306}"

echo "[entrypoint] čakám na DB ${DB_HOST}:${DB_PORT}..."
i=0
until node -e "
  const net = require('node:net');
  const s = net.connect({ host: process.env.DB_HOST || 'ovl-zliav-db', port: Number(process.env.DB_PORT || 3306) });
  s.on('connect', () => { s.end(); process.exit(0); });
  s.on('error', () => process.exit(1));
  setTimeout(() => process.exit(1), 3000);
" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "[entrypoint] DB nedostupná po ${i} pokusoch — FAIL-FAST (I14)" >&2
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] DB dostupná."

echo "[entrypoint] spúšťam migrácie migračným userom (D88, D89)..."
if ! node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON /app/scripts/migrate.ts; then
  echo "[entrypoint] MIGRÁCIE ZLYHALI — appka sa nespustí (I14). Rollback je manuálny (D88)." >&2
  exit 1
fi
echo "[entrypoint] migrácie OK."

echo "[entrypoint] štartujem appku (Next.js standalone)."
exec node /app/server.js
