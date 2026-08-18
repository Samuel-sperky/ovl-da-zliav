#!/usr/bin/env bash
# Aura Zľavy — entrypoint: príprava + supervízor (web + queue + scheduler)
set -euo pipefail

cd /app

# APP_KEY vygeneruj, ak chýba
if ! grep -q '^APP_KEY=base64:' .env 2>/dev/null; then
    php artisan key:generate --force || true
fi

# Počkaj na DB a spusti migrácie (idempotentne)
echo "[entrypoint] čakám na databázu a migrujem…"
php artisan migrate --force || {
    echo "[entrypoint] migrácia zlyhala — DB ešte nebeží? skúšam ešte raz o 5 s"
    sleep 5
    php artisan migrate --force
}

# Cache konfigurácie/route/view pre produkciu
php artisan config:cache || true
php artisan route:cache || true
php artisan view:cache || true

echo "[entrypoint] štartujem supervízor (web:3050 + queue + scheduler)"
exec supervisord -c /app/docker/supervisord.conf -n
