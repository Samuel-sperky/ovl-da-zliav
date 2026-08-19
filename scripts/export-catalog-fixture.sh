#!/bin/sh
# Aura Zľavy — EXPORT KATALÓGU DO E2E FIXTURE (kontrakt UX/dizajn 19. 8. 2026).
#
# Prečo to existuje: snímky obrazoviek sa doteraz robili proti e2e prostrediu
# (shop.e2e.invalid), kde je katalóg PRÁZDNY. Každá obrazovka na nich vyzerala
# prázdno a hustota — ako sa appka správa pri 41 220 produktoch s priemerným
# názvom 64 znakov a najdlhším 117 — sa nikdy neposudzovala. Dizajn schválený
# na prázdnej tabuľke nie je schválený.
#
# Číta sa cez `docker exec`, NIE zo siete: kontajner ovl-zliav-db zámerne nemá
# publikovaný port (invariant I5) a tento skript to neobchádza.
#
# Výstup je MIMO gitu — je to 41 tisíc názvov produktov z produkčného eshopu
# (~3,5 MB). V repe zostáva len reálna vzorka pre CI (--vzorka).
#
# Použitie:
#   sh scripts/export-catalog-fixture.sh              # plný katalóg
#   sh scripts/export-catalog-fixture.sh --vzorka     # 500 riadkov, do gitu

set -eu

DB_CONTAINER="${DB_CONTAINER:-ovl-zliav-db}"
OUT_DIR="test/e2e/fixtures"

if [ "${1:-}" = "--vzorka" ]; then
  OUT="$OUT_DIR/katalog-vzorka.ndjson"
  # Každý n-tý riadok, nie prvých 500: prvých 500 podľa ID sú najstaršie
  # produkty s kratšími názvami a vzorka by tvrdila, že sa názvy do stĺpca
  # pohodlne zmestia.
  WHERE="WHERE product_id % (SELECT GREATEST(1, FLOOR(COUNT(*) / 500)) FROM catalog_cache c2) = 0"
  LIMIT="LIMIT 500"
else
  OUT="$OUT_DIR/katalog.ndjson"
  WHERE=""
  LIMIT=""
fi

mkdir -p "$OUT_DIR"

# JSON_OBJECT skladá riadok priamo v DB — bez medzikroku cez CSV, ktorý by sa
# rozsypal na čiarkach a úvodzovkách v názvoch produktov.
SQL="SELECT JSON_OBJECT(
       'id', product_id,
       'n', name,
       'p', CAST(price AS DOUBLE),
       'a', has_attributes = 1,
       's', shop_status,
       'src', source)
     FROM catalog_cache $WHERE ORDER BY product_id $LIMIT;"

docker exec "$DB_CONTAINER" sh -c \
  "mariadb -uroot -p\"\$(cat /run/secrets/db_root_password)\" ovl_zliav -N --raw -B -e \"$SQL\"" \
  > "$OUT"

RIADKOV=$(wc -l < "$OUT" | tr -d ' ')
echo "✓ $RIADKOV riadkov → $OUT"
