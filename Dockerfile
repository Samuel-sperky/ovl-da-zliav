# Aura Zľavy — multi-stage Dockerfile (BUILD-SPEC §10, D98)
# Výsledný kontajner: Next.js standalone, non-root uid 10050, read-only rootfs
# (read_only + tmpfs rieši compose). Žiadne tajomstvo sa NESMIE dostať do
# obrazu (I1) — master key, session key a DB heslá sa bind-mountujú za behu.

# ── 1. deps ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. build ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build nesmie vyžadovať reálne ENV — env.ts sa vyhodnocuje až za behu.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 3. runner ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Non-root user s fixným uid/gid 10050 (D98) — rovnaký uid musí vlastniť
# secrets/master.key na hoste (chmod 400, D61).
RUN addgroup -g 10050 ovlzliav && adduser -D -u 10050 -G ovlzliav ovlzliav

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Next.js standalone výstup (next.config.ts: output:'standalone')
COPY --from=build --chown=10050:10050 /app/.next/standalone ./
COPY --from=build --chown=10050:10050 /app/.next/static ./.next/static
COPY --from=build --chown=10050:10050 /app/public ./public

# Migrácie + skripty pre entrypoint (D88)
COPY --from=build --chown=10050:10050 /app/db/migrations ./db/migrations
COPY --from=build --chown=10050:10050 /app/scripts ./scripts
# migrate.ts importuje `mariadb` — standalone trace ho obsahuje (src/db/pool.ts),
# ale pre istotu skopírujeme driver explicitne.
COPY --from=deps --chown=10050:10050 /app/node_modules/mariadb ./node_modules/mariadb
# seed-admin.ts importuje `argon2` (natívny addon s musl prebuildom) — standalone
# trace skriptov nepokrýva, preto explicitne aj s runtime závislosťami (§E krok 0b).
COPY --from=deps --chown=10050:10050 /app/node_modules/argon2 ./node_modules/argon2
COPY --from=deps --chown=10050:10050 /app/node_modules/@phc ./node_modules/@phc
COPY --from=deps --chown=10050:10050 /app/node_modules/node-gyp-build ./node_modules/node-gyp-build
COPY --from=deps --chown=10050:10050 /app/node_modules/node-addon-api ./node_modules/node-addon-api

RUN chmod +x /app/scripts/entrypoint.sh

USER 10050

EXPOSE 3000

ENTRYPOINT ["/app/scripts/entrypoint.sh"]
