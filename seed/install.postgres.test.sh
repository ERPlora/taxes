#!/usr/bin/env bash
# Seed contract test (taxes#7) — runs against a REAL Postgres in Docker.
#
# Contract under test: a fresh Spanish hub that installs `taxes` gets the FULL ES VAT
# baseline from the module seed ALONE (no hub-side supplementary seed needed):
#   - general 21% (product.generic, service.generic, restaurant.alcohol)
#   - reduced 10% (restaurant.food/drink/delivery, product.reduced)
#   - super-reduced 4% (product.super_reduced)
#   - exempt rules (service.health, service.education — operation_class='exempt')
# Plus the guarantees the future backfill (taxes#18) relies on:
#   - idempotency: re-applying the seed never duplicates rows (WHERE NOT EXISTS by natural key)
#   - no clobbering: the seed NEVER updates existing rows (a hub's manual edits survive)
#   - stable id contract: rule ids are `<hub_id>|taxrule|<CC>|<category_key>`
#
# Mirrors the runtime's `apply_module_seed` (crates/runtime/src/seed.rs): migrations first,
# then the seed with `:hub_id` / `:now` / `:current_user_id` bound (here: substituted).
#
# Usage: seed/install.postgres.test.sh
#   Uses the `erplora-test-pg-5433` container by default (override: TAXES_TEST_PG_CONTAINER).
#   Creates a scratch database and DROPS it at the end, pass or fail.
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${TAXES_TEST_PG_CONTAINER:-erplora-test-pg-5433}"
DB="taxes_seed_test_$$"
HUB_ID="hub-test"

psql_db() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }
psql_admin() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres "$@"; }

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() { # assert_eq <label> <expected> <actual>
  if [ "$2" != "$3" ]; then fail "$1 — expected [$2], got [$3]"; fi
  echo "  ok: $1 = $2"
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

# ── Install: migrations, then the seed with runtime params bound ──────────────────────────
for mig in "$MODULE_DIR"/migrations/postgres/*.sql; do
  psql_db -q <"$mig"
done

# Same binding the runtime does in apply_module_seed: the seed is written by the system.
bind_seed() {
  sed -e "s/:hub_id/'$HUB_ID'/g" \
      -e "s/:current_user_id/'system'/g" \
      -e "s/:now/'2026-08-06T00:00:00Z'/g" \
      "$MODULE_DIR/seed/install.postgres.sql"
}
bind_seed | psql_db -q

echo "== baseline: a fresh ES hub has the full VAT baseline from the module seed alone =="
q() { psql_db -tAc "$1"; }
ROOT="hub_id='$HUB_ID' AND country_code='ES' AND parent_id IS NULL AND region_code IS NULL AND is_active=1 AND is_deleted=0"

assert_eq "general 21% rules" 3 "$(q "SELECT count(*) FROM taxes_rule WHERE $ROOT AND rate_pct=21;")"
assert_eq "reduced 10% rules (incl. product.reduced)" 4 "$(q "SELECT count(*) FROM taxes_rule WHERE $ROOT AND rate_pct=10;")"
assert_eq "super-reduced 4% rule" 1 "$(q "SELECT count(*) FROM taxes_rule WHERE $ROOT AND rate_pct=4;")"
assert_eq "exempt rules" 2 "$(q "SELECT count(*) FROM taxes_rule WHERE $ROOT AND operation_class='exempt' AND exempt_reason='E1';")"
assert_eq "category product.super_reduced (system)" 1 "$(q "SELECT count(*) FROM taxes_category WHERE hub_id='$HUB_ID' AND key='product.super_reduced' AND is_system=1;")"
assert_eq "category product.reduced (system)" 1 "$(q "SELECT count(*) FROM taxes_category WHERE hub_id='$HUB_ID' AND key='product.reduced' AND is_system=1;")"
assert_eq "4% rule targets product.super_reduced" "product.super_reduced" \
  "$(q "SELECT tax_category_key FROM taxes_rule WHERE $ROOT AND rate_pct=4;")"

echo "== id contract (taxes#18 backfill relies on it) =="
assert_eq "rule id follows <hub>|taxrule|<CC>|<key>" "$HUB_ID|taxrule|ES|product.super_reduced" \
  "$(q "SELECT id FROM taxes_rule WHERE $ROOT AND tax_category_key='product.super_reduced';")"

echo "== idempotency: re-applying the seed neither duplicates nor updates =="
BEFORE="$(q "SELECT (SELECT count(*) FROM taxes_category) || '/' || (SELECT count(*) FROM taxes_rule) || '/' || (SELECT count(*) FROM taxes_category_alias);")"
# Simulate a hub's manual edit — the seed must NOT clobber it (same gotcha as ADR-0037 seeds).
psql_db -qc "UPDATE taxes_rule SET rate_pct=15 WHERE id='$HUB_ID|taxrule|ES|product.generic';"
bind_seed | psql_db -q
AFTER="$(q "SELECT (SELECT count(*) FROM taxes_category) || '/' || (SELECT count(*) FROM taxes_rule) || '/' || (SELECT count(*) FROM taxes_category_alias);")"
assert_eq "row counts unchanged after re-apply" "$BEFORE" "$AFTER"
assert_eq "manual edit survives re-apply" 15 "$(q "SELECT rate_pct::int FROM taxes_rule WHERE id='$HUB_ID|taxrule|ES|product.generic';")"

echo "PASS: all seed contract assertions green"
