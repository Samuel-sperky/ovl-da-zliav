# Aura Zľavy (ovl-da-zliav) — jednokontajnerová appka (web + queue + scheduler)
FROM php:8.4-cli-bookworm

# Systémové závislosti a PHP rozšírenia
RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libzip-dev libicu-dev libonig-dev supervisor \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql bcmath intl zip pcntl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Node (pre build assetov cez Vite)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Najprv závislosti (lepšia cache)
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --no-scripts --no-autoloader

COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Zdroj
COPY . .

RUN composer dump-autoload --optimize \
    && npm run build \
    && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 3050

ENTRYPOINT ["/app/docker/entrypoint.sh"]
