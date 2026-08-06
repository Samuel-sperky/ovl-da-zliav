#!/usr/bin/env bash
# Aura Zľavy — jednorazová lokálna príprava (docs/13-OVERENIE.md §E, kroky 1–5).
#
# Vytvorí secrets/, vygeneruje master key, session key a DB heslá, pripraví .env
# pre Docker a Caddyfile s bcrypt hashom basic auth.
#
# BEZPEČNOSŤ: nič z toho, čo skript vyrobí, sa nesmie dostať do gitu. Všetko žije
# v `secrets/` a v `.env` — oboje je v .gitignore. Skript je idempotentný:
# existujúce tajomstvá NEPREPISUJE (inak by si stratil prístup k uloženému
# API kľúču shopu).
#
# Použitie:
#   bash scripts/setup-local.sh
#   bash scripts/setup-local.sh --basicauth-heslo 'moje-heslo'

set -euo pipefail
cd "$(dirname "$0")/.."

BASICAUTH_HESLO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --basicauth-heslo) BASICAUTH_HESLO="${2:-}"; shift 2 ;;
    *) echo "Neznámy prepínač: $1" >&2; exit 2 ;;
  esac
done

info() { printf '  %s\n' "$1"; }
krok() { printf '\n\033[1m%s\033[0m\n' "$1"; }

krok "1/6  Priečinky"
mkdir -p secrets backups
chmod 700 secrets backups
info "secrets/ a backups/ pripravené (chmod 700)"

krok "2/6  Master key a session key"
gen_hex32() { node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"; }

if [ -f secrets/master.key ]; then
  info "secrets/master.key už existuje — NEPREPISUJEM (prepis = strata uloženého API kľúča)"
else
  gen_hex32 > secrets/master.key
  chmod 400 secrets/master.key
  info "secrets/master.key vygenerovaný (32 B hex, chmod 400)"
fi

if [ -f secrets/session.key ]; then
  info "secrets/session.key už existuje — NEPREPISUJEM"
else
  gen_hex32 > secrets/session.key
  chmod 400 secrets/session.key
  info "secrets/session.key vygenerovaný"
fi

krok "3/6  Heslá databázy"
for f in db_root_password db_app_password db_mig_password; do
  if [ -f "secrets/$f" ]; then
    info "secrets/$f už existuje — NEPREPISUJEM"
  else
    node -e "process.stdout.write(require('node:crypto').randomBytes(24).toString('base64url'))" > "secrets/$f"
    chmod 600 "secrets/$f"
    info "secrets/$f vygenerované"
  fi
done

krok "3b/6  Práva pre kontajnery"
# Appka beží ako uid 10050 (non-root) a číta master.key, session.key,
# db_app_password a db_mig_password; DB init skript beží ako uid 999 (mysql)
# a číta db_mig_password. Na Linuxe/WSL s repom v linuxovom FS treba preto
# vlastníctvo a práva nastaviť; Docker Desktop na Windows práva bind mountov
# ignoruje (všetko je čitateľné), tam sa tento krok v tichosti preskočí.
chmod 644 secrets/db_mig_password 2>/dev/null || true   # 10050 aj 999; dir je 700
APP_FILES="secrets/master.key secrets/session.key secrets/db_app_password"
if [ "$(id -u)" = "0" ]; then
  chown 10050:10050 $APP_FILES secrets/db_mig_password 2>/dev/null || true
  info "vlastníctvo nastavené na uid 10050 (appka v kontajneri)"
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  sudo chown 10050:10050 $APP_FILES secrets/db_mig_password
  info "vlastníctvo nastavené na uid 10050 cez sudo"
else
  info "chown na 10050 sa nepodaril (bez root/sudo) — na Docker Desktop to nevadí;"
  info "na Linuxe spusti: sudo chown 10050:10050 $APP_FILES secrets/db_mig_password"
fi

krok "4/6  .env pre Docker"
if [ -f .env ]; then
  info ".env už existuje — NEPREPISUJEM (skontroluj ho ručne)"
else
  cp .env.example .env
  # Docker: appka beží v kontajneri, DB je na compose sieti pod menom služby.
  # WRITES_ENABLED zostáva false — zapneš ho vedome až po otestovaní dry-runu.
  sed -i.bak \
    -e 's/^NODE_ENV=.*/NODE_ENV=production/' \
    -e 's/^DB_HOST=.*/DB_HOST=ovl-zliav-db/' \
    -e 's/^PORT=.*/PORT=3000/' \
    .env && rm -f .env.bak
  chmod 600 .env
  info ".env vytvorený (NODE_ENV=production, DB_HOST=ovl-zliav-db, WRITES_ENABLED=false)"
fi

krok "5/6  Caddyfile s basic auth"
if [ -f secrets/Caddyfile ]; then
  info "secrets/Caddyfile už existuje — NEPREPISUJEM"
else
  if [ -z "$BASICAUTH_HESLO" ]; then
    printf '  Zadaj heslo pre Caddy basic auth (prvá vrstva pred appkou): '
    read -rs BASICAUTH_HESLO
    printf '\n'
  fi
  if [ -z "$BASICAUTH_HESLO" ]; then
    echo "  CHYBA: heslo je prázdne." >&2; exit 1
  fi
  # Caddy basic_auth berie výhradne bcrypt; ten vie vyrobiť sám Caddy v kontajneri.
  # Preto tu treba BEŽIACI docker daemon, nielen nainštalovanú binárku.
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    cat >&2 <<'DOCKERCHYBA'
  CHYBA: Docker nebeží — bez neho neviem vygenerovať bcrypt hash pre basic auth.

  Buď spusti Docker Desktop a pusti tento skript znova, alebo si hash vyrob
  inde a vlož ho ručne:
      docker run --rm caddy:2-alpine caddy hash-password --plaintext 'TVOJE-HESLO'
  potom:
      cp Caddyfile.example secrets/Caddyfile
  a v secrets/Caddyfile nahraď reťazec NAHRAD-BCRYPT-HASHOM tým hashom.
DOCKERCHYBA
    exit 1
  fi
  HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$BASICAUTH_HESLO" | tr -d '\r\n')"
  # Caddy vracia bcrypt v tvare $2a$14$... — čokoľvek iné je chyba, nie hash.
  case "$HASH" in
    \$2*) : ;;
    *) echo "  CHYBA: Caddy nevrátil bcrypt hash (dostal som: '${HASH:-prázdny výstup}')." >&2; exit 1 ;;
  esac
  # Hash ide priamo do Caddyfile — Caddy nevie načítať súbor do placeholdera.
  awk -v h="$HASH" '{gsub(/NAHRAD-BCRYPT-HASHOM/, h); print}' Caddyfile.example > secrets/Caddyfile
  chmod 600 secrets/Caddyfile
  unset BASICAUTH_HESLO
  info "secrets/Caddyfile vytvorený s bcrypt hashom (užívateľ: samuel)"
fi

krok "6/6  Kontrola, že do gitu nič neuniklo"
if git rev-parse --git-dir >/dev/null 2>&1; then
  UNIK="$(git status --porcelain --untracked-files=all 2>/dev/null | grep -E 'secrets/|^\?\? \.env$' || true)"
  if [ -n "$UNIK" ]; then
    echo "  VAROVANIE: git vidí tieto súbory — NESMÚ sa commitnúť:" >&2
    echo "$UNIK" >&2
    exit 1
  fi
  info "git nevidí ani secrets/, ani .env — v poriadku"
fi

cat <<'HOTOVO'

Príprava hotová. Ďalej:

  1. docker compose up -d --build
     (ak si stack skúšal už PRED opravou migračného usera, raz spusti
      `docker compose down -v` — init skript DB beží len na prázdnom volume;
      dáta neprídu nazmar, migrácie dovtedy nikdy neprebehli)
  2. docker compose exec ovl-zliav-app node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/seed-admin.ts
     (interaktívne si vypýta meno a heslo do appky — heslo min. 12 znakov;
      spúšťaj v NORMÁLNOM termináli — maskovanie hesla potrebuje skutočné TTY,
      cez rúru/skript sa preruší)
  3. Otvor http://localhost:3070  (funguje aj http://127.0.0.1:3070)
     - najprv basic auth (užívateľ "samuel" + heslo z kroku 5)
     - potom login do appky (účet z bodu 2)
     (HTTP bez TLS je vedomá voľba — appka žije len na 127.0.0.1 za basic auth;
      Secure cookie na localhoste funguje, prehliadače mu dôverujú)
  4. V appke prejdi onboarding: doména shopu -> API kľúč -> allowlist (max 10 ID).

ZÁPISY SÚ ZATIAĽ VYPNUTÉ (WRITES_ENABLED=false v .env) — appka fyzicky nemôže
zmeniť cenu v shope. Preklikaj si dry-run naprázdno; zápisy zapni až vtedy, keď
si istý, a to zmenou WRITES_ENABLED=true + docker compose up -d.
HOTOVO
