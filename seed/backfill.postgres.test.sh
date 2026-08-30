#!/usr/bin/env bash
# Backfill contract test (taxes#18) — runs against a REAL Postgres in Docker.
#
# Contract under test: a hub that ALREADY had `taxes` installed (pre-v2.2 baseline, plus its
# own customizations) receives the full ES VAT baseline — including the EXEMPT categories and
# rules (service.health / service.education) — when the module update applies the pending
# migrations. Migrations get NO `:hub_id` injected (they run via `execute_batch`, see
# crates/runtime/src/migrations.rs), so the backfill migration must derive the hub ids from
# the module's own tables. Guarantees:
#   - an existing hub gains the missing categories/rules/aliases (exempt ones included)
#   - NO clobbering: manual edits, soft-deletes and repointed aliases survive untouched
#   - multi-hub legacy DBs (pre ADR-0201) are backfilled for EVERY hub with taxes data
#   - a FRESH hub (migrations, then seed) ends up with NO duplicates
#   - re-applying the backfill is idempotent (same row counts)
#
# Usage: seed/backfill.postgres.test.sh
#   Uses the `erplora-test-pg-5433` container by default (override: TAXES_TEST_PG_CONTAINER).
#   Creates scratch databases and DROPS them at the end, pass or fail.
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${TAXES_TEST_PG_CONTAINER:-erplora-test-pg-5433}"
DB_EXISTING="taxes_backfill_test_$$"
DB_FRESH="taxes_backfill_fresh_$$"

psql_db() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$1" -q; }
psql_admin() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres "$@"; }

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() { # assert_eq <label> <expected> <actual>
  if [ "$2" != "$3" ]; then fail "$1 — expected [$2], got [$3]"; fi
  echo "  ok: $1 = $2"
}

# ── Setup: container up + scratch databases ───────────────────────────────────────────────
if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
  docker start "$CONTAINER" >/dev/null 2>&1 || fail "container $CONTAINER not available (docker)"
  for _ in $(seq 1 15); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
fi
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 || fail "Postgres in $CONTAINER not ready"

cleanup() {
  psql_admin -c "DROP DATABASE IF EXISTS $DB_EXISTING WITH (FORCE);" >/dev/null 2>&1 || true
  psql_admin -c "DROP DATABASE IF EXISTS $DB_FRESH WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT
psql_admin -c "CREATE DATABASE $DB_EXISTING;" >/dev/null
psql_admin -c "CREATE DATABASE $DB_FRESH;" >/dev/null

# Migrations an old hub already had applied when v2.2.1 shipped (schema only, no data).
OLD_MIGRATIONS="001_init.sql 002_fiscal_qualification.sql"

apply_old_migrations() { # apply_old_migrations <db>
  for name in $OLD_MIGRATIONS; do
    psql_db "$1" <"$MODULE_DIR/migrations/postgres/$name"
  done
}

apply_pending_migrations() { # apply_pending_migrations <db> — what a module UPDATE applies
  local applied_any=0
  for mig in "$MODULE_DIR"/migrations/postgres/*.sql; do
    local base
    base="$(basename "$mig")"
    case " $OLD_MIGRATIONS " in
      *" $base "*) continue ;;
    esac
    psql_db "$1" <"$mig"
    applied_any=1
  done
  [ "$applied_any" = 1 ] || fail "no pending migration to apply — the taxes#18 backfill migration does not exist yet"
}

bind_seed() { # same binding the runtime does in apply_module_seed
  sed -e "s/:hub_id/'$1'/g" \
      -e "s/:current_user_id/'system'/g" \
      -e "s/:now/'2026-08-06T00:00:00Z'/g" \
      "$MODULE_DIR/seed/install.postgres.sql"
}

# ══ Scenario 1: an EXISTING hub (installed pre-v2.2, with customizations) gets backfilled ══
apply_old_migrations "$DB_EXISTING"

# State of a hub installed BEFORE the exempt categories existed (the pre-#20 seed subset),
# plus real-world customizations the backfill must NOT touch:
#   - the product.generic ES rule was manually edited to 15% (rate customization)
#   - the restaurant.delivery category was soft-deleted by the hub (must not resurrect)
#   - the 'service' alias was repointed to a hub-created category (must keep pointing there)
#   - a hub-created category + rule (custom.special at 7%) must survive untouched
# A second hub (hub-b) shares the DB (legacy pre ADR-0201) and must be backfilled too.
psql_db "$DB_EXISTING" <<'SQL'
INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at) VALUES
  ('hub-a|taxcat|restaurant.food',     'hub-a', 'restaurant.food',     'Restaurant — food',     '', 1, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxcat|restaurant.drink',    'hub-a', 'restaurant.drink',    'Restaurant — drink',    '', 1, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxcat|restaurant.alcohol',  'hub-a', 'restaurant.alcohol',  'Restaurant — alcohol',  '', 1, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxcat|restaurant.delivery', 'hub-a', 'restaurant.delivery', 'Restaurant — delivery', '', 1, 1, 1, 'system', 'user-1', '2026-07-01T00:00:00Z', '2026-07-15T00:00:00Z'),
  ('hub-a|taxcat|service.generic',     'hub-a', 'service.generic',     'Service — generic',     '', 1, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxcat|product.generic',     'hub-a', 'product.generic',     'Product — generic',     '', 1, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('cat-custom-uuid',                  'hub-a', 'custom.special',      'My special category',   '', 0, 1, 0, 'user-1', 'user-1', '2026-07-02T00:00:00Z', '2026-07-02T00:00:00Z');

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at) VALUES
  ('hub-a|taxrule|ES|product.generic',     'hub-a', 'ES', NULL, 'product.generic',     15, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'user-1', '2026-07-01T00:00:00Z', '2026-07-15T00:00:00Z'),
  ('hub-a|taxrule|ES|service.generic',     'hub-a', 'ES', NULL, 'service.generic',     21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxrule|ES|restaurant.food',     'hub-a', 'ES', NULL, 'restaurant.food',     10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxrule|ES|restaurant.drink',    'hub-a', 'ES', NULL, 'restaurant.drink',    10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxrule|ES|restaurant.delivery', 'hub-a', 'ES', NULL, 'restaurant.delivery', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxrule|ES|restaurant.alcohol',  'hub-a', 'ES', NULL, 'restaurant.alcohol',  21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('rule-custom-uuid',                     'hub-a', 'ES', NULL, 'custom.special',       7, 'vat', NULL, NULL, '2026-07-02', NULL, 1, 0, 'user-1', 'user-1', '2026-07-02T00:00:00Z', '2026-07-02T00:00:00Z');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at) VALUES
  ('hub-a|taxalias|food',    'hub-a', 'food',    'restaurant.food', 'shipped', 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-a|taxalias|service', 'hub-a', 'service', 'custom.special',  'shipped', 1, 0, 'system', 'user-1', '2026-07-01T00:00:00Z', '2026-07-15T00:00:00Z');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at) VALUES
  ('hub-b|taxcat|product.generic', 'hub-b', 'product.generic', 'Product — generic', '', 1, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
  ('hub-b|taxcat|service.generic', 'hub-b', 'service.generic', 'Service — generic', '', 1, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at) VALUES
  ('hub-b|taxrule|ES|product.generic', 'hub-b', 'ES', NULL, 'product.generic', 21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
SQL

# The module UPDATE applies the pending migrations (this is where the backfill must live).
apply_pending_migrations "$DB_EXISTING"

q() { psql_admin -d "$DB_EXISTING" -tAc "$1"; }
ROOT_A="hub_id='hub-a' AND country_code='ES' AND parent_id IS NULL AND region_code IS NULL AND is_active=1 AND is_deleted=0"

echo "== existing hub: the exempt baseline arrives =="
assert_eq "service.health category (system)" 1 \
  "$(q "SELECT count(*) FROM taxes_category WHERE hub_id='hub-a' AND key='service.health' AND is_system=1 AND is_deleted=0;")"
assert_eq "service.education category (system)" 1 \
  "$(q "SELECT count(*) FROM taxes_category WHERE hub_id='hub-a' AND key='service.education' AND is_system=1 AND is_deleted=0;")"
assert_eq "exempt rules (E1, regime 01, 0%)" 2 \
  "$(q "SELECT count(*) FROM taxes_rule WHERE $ROOT_A AND operation_class='exempt' AND exempt_reason='E1' AND regime_key='01' AND rate_pct=0;")"
assert_eq "exempt rule id follows <hub>|taxrule|ES|<key>" "hub-a|taxrule|ES|service.health" \
  "$(q "SELECT id FROM taxes_rule WHERE $ROOT_A AND tax_category_key='service.health';")"

echo "== existing hub: the rest of the #20 baseline arrives too (10% / 4% products) =="
assert_eq "product.reduced rule at 10%" 1 \
  "$(q "SELECT count(*) FROM taxes_rule WHERE $ROOT_A AND tax_category_key='product.reduced' AND rate_pct=10;")"
assert_eq "product.super_reduced rule at 4%" 1 \
  "$(q "SELECT count(*) FROM taxes_rule WHERE $ROOT_A AND tax_category_key='product.super_reduced' AND rate_pct=4;")"
assert_eq "system categories complete (10)" 10 \
  "$(q "SELECT count(*) FROM taxes_category WHERE hub_id='hub-a' AND is_system=1;")"
assert_eq "health/training aliases arrive" 2 \
  "$(q "SELECT count(*) FROM taxes_category_alias WHERE hub_id='hub-a' AND alias IN ('health','training');")"

echo "== existing hub: customizations survive (no clobber) =="
assert_eq "manually edited rate stays at 15" 15 \
  "$(q "SELECT rate_pct::int FROM taxes_rule WHERE id='hub-a|taxrule|ES|product.generic';")"
assert_eq "no duplicate product.generic rule" 1 \
  "$(q "SELECT count(*) FROM taxes_rule WHERE hub_id='hub-a' AND country_code='ES' AND tax_category_key='product.generic' AND parent_id IS NULL AND region_code IS NULL;")"
assert_eq "soft-deleted category not resurrected nor duplicated" "1|1" \
  "$(q "SELECT count(*) || '|' || max(is_deleted) FROM taxes_category WHERE hub_id='hub-a' AND key='restaurant.delivery';")"
assert_eq "repointed alias keeps its target" "custom.special" \
  "$(q "SELECT tax_category_key FROM taxes_category_alias WHERE hub_id='hub-a' AND alias='service';")"
assert_eq "no duplicate 'service' alias" 1 \
  "$(q "SELECT count(*) FROM taxes_category_alias WHERE hub_id='hub-a' AND alias='service';")"
assert_eq "hub-created rule untouched (7%)" 7 \
  "$(q "SELECT rate_pct::int FROM taxes_rule WHERE id='rule-custom-uuid';")"

echo "== multi-hub legacy DB: every hub with taxes data is backfilled =="
assert_eq "hub-b gains the exempt rules too" 2 \
  "$(q "SELECT count(*) FROM taxes_rule WHERE hub_id='hub-b' AND country_code='ES' AND parent_id IS NULL AND region_code IS NULL AND operation_class='exempt' AND exempt_reason='E1';")"
assert_eq "hub-b system categories complete (10)" 10 \
  "$(q "SELECT count(*) FROM taxes_category WHERE hub_id='hub-b' AND is_system=1;")"

echo "== idempotency: re-applying the backfill changes nothing =="
BEFORE="$(q "SELECT (SELECT count(*) FROM taxes_category) || '/' || (SELECT count(*) FROM taxes_rule) || '/' || (SELECT count(*) FROM taxes_category_alias);")"
apply_pending_migrations "$DB_EXISTING"
AFTER="$(q "SELECT (SELECT count(*) FROM taxes_category) || '/' || (SELECT count(*) FROM taxes_rule) || '/' || (SELECT count(*) FROM taxes_category_alias);")"
assert_eq "row counts unchanged after re-apply" "$BEFORE" "$AFTER"

# ══ Scenario 2: a FRESH hub (all migrations, then the seed) ends up with NO duplicates ══
for mig in "$MODULE_DIR"/migrations/postgres/*.sql; do
  psql_db "$DB_FRESH" <"$mig"
done
bind_seed "hub-new" | psql_db "$DB_FRESH"

qf() { psql_admin -d "$DB_FRESH" -tAc "$1"; }
ROOT_NEW="hub_id='hub-new' AND country_code='ES' AND parent_id IS NULL AND region_code IS NULL"

echo "== fresh hub: migration + seed compose without duplicating =="
assert_eq "categories: one row per key (10)" "10|10" \
  "$(qf "SELECT count(*) || '|' || count(DISTINCT key) FROM taxes_category WHERE hub_id='hub-new';")"
assert_eq "ES root rules: one per category (10)" "10|10" \
  "$(qf "SELECT count(*) || '|' || count(DISTINCT tax_category_key) FROM taxes_rule WHERE $ROOT_NEW;")"
assert_eq "aliases: one row per alias (16)" "16|16" \
  "$(qf "SELECT count(*) || '|' || count(DISTINCT alias) FROM taxes_category_alias WHERE hub_id='hub-new';")"
assert_eq "fresh hub has the exempt rules" 2 \
  "$(qf "SELECT count(*) FROM taxes_rule WHERE $ROOT_NEW AND operation_class='exempt' AND exempt_reason='E1';")"

echo "PASS: all backfill contract assertions green"
