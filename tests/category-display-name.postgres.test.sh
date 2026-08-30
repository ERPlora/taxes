#!/usr/bin/env bash
# The PRESENTABLE name of a fiscal category travels through the CONTRACT (taxes#38) — runs against
# a REAL Postgres in Docker.
#
# WHY THIS EXISTS. taxes#30 translated the category name in PRESENTATION, over the canonical key,
# inside this module's own Web Component. That fixed the three screens of `taxes` and nothing else:
# the category is chosen mostly OUTSIDE — `inventory` (product form, CSV importer) and `sales`
# (the "Departamento (IVA)" selector of the till, the cart line, the PRINTED receipt) — and there
# the seeded English name was still what the user read.
#
# It cannot be fixed in the consumer: a module is its own repo and its own bundle, no module
# imports another's code (ADR-0043), and the i18n catalogue does not travel either — `t()` resolves
# against the JSON the WC inlines from ITS OWN `locales/*.json`. Copying the key→label map into
# every consumer would create N lists of the canonical keys in N repos, and the next category added
# here would silently come out in English over there. So the translation must leave this module
# through the only door that crosses a module boundary: the QUERY.
#
# WHAT IS UNDER TEST — the door itself:
#   · `taxes.categories.list` / `.get` project `display_name` and `display_description`, already
#     resolved to the language of whoever is asking;
#   · `taxes.rules.list` projects `tax_category_display_name`, so a consumer that only reads rules
#     (inventory shows "Product — generic · 21 %") does not need a second round trip;
#   · the labels live in ONE place — `taxes_category_label`, planted by migration 005 — and the
#     canonical key list stays exactly where the seed already put it;
#   · the stored value never changes: `key` is still the identity, `name` still travels untouched.
#
# LANGUAGE RESOLUTION mirrors the shell (`apps/web/src/i18n/index.ts#bootHubLanguage`): the
# personal override in `hub_user_pref` wins, then the hub default in `hub_settings.language`, and
# then — the step taxes#40 got wrong — the CORE'S DEFAULT for that setting, which is `es`
# (`hub/crates/runtime/src/settings.rs`, key `language`). Resolving it server-side is what lets a
# consumer read a column instead of carrying a catalogue.
#
# THE STATE THIS TEST EXISTS FOR (taxes#40): a hub that was just provisioned has NO row in
# `hub_settings` for `language` — the settings layer applies the default when READING, it never
# writes it — and no `hub_user_pref` row either. That is every hub on its first day, and it was the
# one case not covered here: the assertion that used to sit below expected English for it, which is
# precisely the regression. `/api/hub/context` answers `"language":"es"` for that same hub, so
# English was the one answer nobody in the product agreed with.
#
# Usage: tests/category-display-name.postgres.test.sh
#   Uses the `erplora-test-pg-5433` container by default (override: TAXES_TEST_PG_CONTAINER).
#   Creates a scratch database and DROPS it at the end, pass or fail.
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${TAXES_TEST_PG_CONTAINER:-erplora-test-pg-5433}"
DB="taxes_display_name_test_$$"
HUB_ID="hub-test"
USER_ES="u-spanish"
USER_EN="u-english"
USER_NONE="u-no-preference"
# Nobody ever opened Settings for this one: it gets NO `hub_user_pref` row (taxes#40).
USER_FRESH="u-never-opened-settings"
NOW="2026-08-18T12:00:00Z"

psql_db() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }
psql_admin() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres "$@"; }

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() { # assert_eq <label> <expected> <actual>
  if [ "$2" != "$3" ]; then fail "$1 — expected [$2], got [$3]"; fi
  echo "  ok: $1 = $2"
}
assert_ne() { # assert_ne <label> <forbidden> <actual>
  if [ "$2" = "$3" ]; then fail "$1 — got the forbidden value [$3]"; fi
  echo "  ok: $1 ≠ $2 (got [$3])"
}

# ── Setup: container up + scratch database ────────────────────────────────────────────────
if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  docker start "$CONTAINER" >/dev/null 2>&1 || fail "container $CONTAINER not available (docker)"
  for _ in $(seq 1 15); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
fi
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 || fail "Postgres in $CONTAINER not ready"

cleanup() { psql_admin -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql_admin -c "CREATE DATABASE $DB;" >/dev/null

# ── The hub as the runtime builds it: system tables first, then the module ────────────────
# `hub_settings` and `hub_user_pref` verbatim from the system migrations
# (crates/runtime/src/system_migrations.rs v4 and v7): the queries read the language from them.
psql_db -q <<'SQL'
CREATE TABLE hub_settings (
  hub_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (hub_id, key));
CREATE TABLE hub_user_pref (
  hub_id TEXT NOT NULL, user_id TEXT NOT NULL, language TEXT NOT NULL DEFAULT '',
  theme_mode TEXT NOT NULL DEFAULT '', theme_palette TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL, PRIMARY KEY (hub_id, user_id));
SQL

for mig in "$MODULE_DIR"/migrations/postgres/*.sql; do
  psql_db -q <"$mig"
done

# Same binding the runtime does in apply_module_seed.
sed -e "s/:hub_id/'$HUB_ID'/g" -e "s/:current_user_id/'system'/g" -e "s/:now/'$NOW'/g" \
  "$MODULE_DIR/seed/install.postgres.sql" | psql_db -q

# The hub speaks Spanish; one user overrides to English, another has no preference at all.
psql_db -q <<SQL
INSERT INTO hub_settings (hub_id, key, value, updated_at, updated_by)
  VALUES ('$HUB_ID','language','es','$NOW','system');
INSERT INTO hub_user_pref (hub_id, user_id, language, updated_at)
  VALUES ('$HUB_ID','$USER_ES','es','$NOW'), ('$HUB_ID','$USER_EN','en','$NOW'),
         ('$HUB_ID','$USER_NONE','','$NOW');
SQL

# A category the OWNER created: no canonical key, so nothing to translate — its name must survive.
psql_db -qc "INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at) VALUES ('$HUB_ID|taxcat|catering_bodas','$HUB_ID','catering_bodas','Catering de bodas','Solo banquetes',0,1,0,'system','system','$NOW','$NOW');"

# ── Running a declarative query the way the runtime does (queries.rs) ─────────────────────
# The SQL runs as-is with the system params bound (`:hub_id`, `:current_user_id`, `:now` — here
# substituted, as psql has no named binds), wrapped in the subquery the list engine builds.
run_query() { # run_query <file> <user_id> <select-expression> [extra where]
  local file="$1" user="$2" expr="$3" where="${4:-}"
  sed -e "s/:hub_id/'$HUB_ID'/g" -e "s/:current_user_id/'$user'/g" -e "s/:now/'$NOW'/g" \
      -e "s/:key/'product.generic'/g" "$MODULE_DIR/$file" \
    | sed -e 's/;[[:space:]]*$//' \
    | { printf 'SELECT %s FROM (' "$expr"; cat; printf ') AS sub %s;' "$where"; } \
    | psql_db -tA
}
cat_col() { # cat_col <user_id> <column> <category key>
  run_query queries/categories_list.sql "$1" "$2" "WHERE sub.key = '$3'"
}

echo "== the presentable name arrives already resolved, in the language of who is asking =="
assert_eq "es user · product.generic" "Producto — general" "$(cat_col "$USER_ES" display_name product.generic)"
assert_eq "es user · restaurant.food" "Restauración — comida" "$(cat_col "$USER_ES" display_name restaurant.food)"
assert_eq "en user · product.generic" "Product — generic" "$(cat_col "$USER_EN" display_name product.generic)"

echo "== no personal preference ⇒ the hub's language decides (bootHubLanguage) =="
assert_eq "no-pref user follows the Spanish hub" "Producto — general" "$(cat_col "$USER_NONE" display_name product.generic)"
psql_db -qc "UPDATE hub_settings SET value='en' WHERE hub_id='$HUB_ID' AND key='language';"
assert_eq "the hub switches to English and so does the column" "Product — generic" "$(cat_col "$USER_NONE" display_name product.generic)"
assert_eq "the personal override still wins" "Producto — general" "$(cat_col "$USER_ES" display_name product.generic)"

echo "== a BRAND-NEW hub: no language row anywhere, and the catalogue is STILL not in English (taxes#40) =="
# The state of every hub on its first day. `hub_settings` has no `language` row (the core applies
# its default `es` when reading, it never persists it) and `$USER_FRESH` has no `hub_user_pref` row
# either. Answering English here is what put the Spanish shell and the fiscal catalogue in two
# different languages on the same screen.
psql_db -qc "DELETE FROM hub_settings WHERE hub_id='$HUB_ID' AND key='language';"
assert_eq "fresh hub · categories.list" "Producto — general" "$(cat_col "$USER_FRESH" display_name product.generic)"
assert_eq "fresh hub · the legal description too" \
  "Asistencia prestada por profesionales médicos o sanitarios — art. 20.Uno.3 (ES)" \
  "$(cat_col "$USER_FRESH" display_description service.health)"
FRESH_UNTRANSLATED="$(run_query queries/categories_list.sql "$USER_FRESH" "count(*)" "WHERE sub.is_system = 1 AND sub.display_name = sub.name")"
assert_eq "fresh hub · canonical categories still reading in English" 0 "$FRESH_UNTRANSLATED"
assert_eq "fresh hub · categories.get (the importer's FK check)" "Producto — general" \
  "$(run_query queries/category_get.sql "$USER_FRESH" display_name)"
assert_eq "fresh hub · rules.list (what inventory and sales read)" "Producto — general" \
  "$(run_query queries/rules_list.sql "$USER_FRESH" "DISTINCT sub.tax_category_display_name" "WHERE sub.tax_category_key = 'product.generic'")"
assert_eq "fresh hub · a personal override still outranks the default" "Product — generic" \
  "$(cat_col "$USER_EN" display_name product.generic)"
psql_db -qc "INSERT INTO hub_settings (hub_id, key, value, updated_at, updated_by) VALUES ('$HUB_ID','language','es','$NOW','system');"

echo "== every canonical category is translated: not one comes out in the seeded English =="
UNTRANSLATED="$(run_query queries/categories_list.sql "$USER_ES" "count(*)" "WHERE sub.is_system = 1 AND sub.display_name = sub.name")"
assert_eq "system categories still reading in English" 0 "$UNTRANSLATED"
SYSTEM_TOTAL="$(run_query queries/categories_list.sql "$USER_ES" "count(*)" "WHERE sub.is_system = 1")"
[ "$SYSTEM_TOTAL" -ge 6 ] || fail "expected the seeded canonical categories, got [$SYSTEM_TOTAL]"
echo "  ok: $SYSTEM_TOTAL canonical categories, all translated"

echo "== the legal description of an exempt category is translated too =="
assert_ne "service.health description in Spanish" \
  "$(cat_col "$USER_EN" display_description service.health)" \
  "$(cat_col "$USER_ES" display_description service.health)"

echo "== a category the owner created is HERS: it comes out with its own text =="
assert_eq "user category keeps its name" "Catering de bodas" "$(cat_col "$USER_ES" display_name catering_bodas)"
assert_eq "user category keeps its description" "Solo banquetes" "$(cat_col "$USER_ES" display_description catering_bodas)"

echo '== the stored value does not change: key is still the identity and name still travels =='
assert_eq "the canonical key is untouched" "product.generic" "$(cat_col "$USER_ES" key product.generic)"
assert_eq "the raw name is still there for whoever wants it" "Product — generic" "$(cat_col "$USER_ES" name product.generic)"

echo "== taxes.categories.get answers with the same column (the importer validates the FK there) =="
GET_NAME="$(run_query queries/category_get.sql "$USER_ES" display_name)"
assert_eq "categories.get · product.generic" "Producto — general" "$GET_NAME"

echo "== taxes.rules.list carries the category name, so a rules-only consumer needs no second call =="
RULE_NAME="$(run_query queries/rules_list.sql "$USER_ES" "DISTINCT sub.tax_category_display_name" "WHERE sub.tax_category_key = 'product.generic'")"
assert_eq "rules.list · product.generic" "Producto — general" "$RULE_NAME"
RULE_NAME_EN="$(run_query queries/rules_list.sql "$USER_EN" "DISTINCT sub.tax_category_display_name" "WHERE sub.tax_category_key = 'product.generic'")"
assert_eq "rules.list · product.generic (en)" "Product — generic" "$RULE_NAME_EN"

echo "== the answer is still scoped to the hub asking =="
NEIGHBOUR="$(sed -e "s/:hub_id/'hub-neighbour'/g" -e "s/:current_user_id/'$USER_ES'/g" -e "s/:now/'$NOW'/g" "$MODULE_DIR/queries/categories_list.sql" \
  | sed -e 's/;[[:space:]]*$//' | { printf 'SELECT count(*) FROM ('; cat; printf ') AS sub;'; } | psql_db -tA)"
assert_eq "a neighbour hub sees none of these categories" 0 "$NEIGHBOUR"

echo
echo "PASS — the presentable name of a category travels through the contract, in one list"
