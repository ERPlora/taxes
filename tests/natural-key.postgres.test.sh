#!/usr/bin/env bash
# Natural-key contract of `taxes_rule` (hub#576) — runs against a REAL Postgres in Docker.
#
# Contract under test: migration 004 declares the natural key the seed has ALWAYS assumed
# (`WHERE NOT EXISTS` by hub+country+category, root rules only) as a real UNIQUE index, so that
# equivalent rules coming from a blueprint/backup can be recognized and SKIPPED by the hub's
# import guard (ADR-0304) instead of silently duplicating the VAT lookup:
#
#   CREATE UNIQUE INDEX ... ON taxes_rule (hub_id, country_code, tax_category_key,
#                                          region_code, valid_from)
#     NULLS NOT DISTINCT WHERE parent_id IS NULL AND is_deleted = 0
#
#   - ROOT rules only (`parent_id IS NULL`): several COMPONENTS under one root share country,
#     region and category by design (rule_create enforces it) — they must never collide.
#   - `NULLS NOT DISTINCT`: `region_code NULL` means "whole country" and two of those ARE the
#     same jurisdiction; with default NULLS DISTINCT the index would never fire for them.
#   - `valid_from` is part of the key: a scheduled rate change is a second row with a newer
#     `valid_from` (the resolver picks the most recent one) and must stay legal.
#   - Partial on `is_deleted = 0`: a soft-deleted rule must not block re-creating its key.
#   - The migration DEDUPES first (oldest row by created_at, then id, survives; the rest are
#     soft-deleted): hubs that already suffered the silent duplication must not wedge the update.
#
# Usage: tests/natural-key.postgres.test.sh
#   Uses the `erplora-test-pg-5433` container by default (override: TAXES_TEST_PG_CONTAINER).
#   Creates a scratch database and DROPS it at the end, pass or fail.
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${TAXES_TEST_PG_CONTAINER:-erplora-test-pg-5433}"
DB="taxes_natkey_test_$$"
HUB_ID="hub-test"
MIGRATION="$MODULE_DIR/migrations/postgres/004_taxes_rule_natural_key.sql"

psql_db() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }
psql_admin() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres "$@"; }

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_eq() { # assert_eq <label> <expected> <actual>
  if [ "$2" != "$3" ]; then fail "$1 — expected [$2], got [$3]"; fi
  echo "  ok: $1 = $2"
}
q() { psql_db -tAc "$1"; }

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

[ -f "$MIGRATION" ] || fail "migration 004_taxes_rule_natural_key.sql does not exist yet"

# ── Pre-004 state: migrations 001..003 + seed, PLUS the silent duplicates 004 must clean ──
for mig in "$MODULE_DIR"/migrations/postgres/001_*.sql \
           "$MODULE_DIR"/migrations/postgres/002_*.sql \
           "$MODULE_DIR"/migrations/postgres/003_*.sql; do
  psql_db -q <"$mig"
done
sed -e "s/:hub_id/'$HUB_ID'/g" \
    -e "s/:current_user_id/'system'/g" \
    -e "s/:now/'2026-08-06T00:00:00Z'/g" \
    "$MODULE_DIR/seed/install.postgres.sql" | psql_db -q

# The historical bug this index closes: a bundle's seeded rules landed AGAIN under a fresh id.
psql_db -q <<SQL
INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
VALUES ('dup-product-generic', '$HUB_ID', 'ES', NULL, 'product.generic', 21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-07T00:00:00Z', '2026-08-07T00:00:00Z');
-- A user root with TWO components (multi-tax model: root + surcharges) and its own duplicate.
INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
VALUES ('root-igic', '$HUB_ID', 'ES', 'ES-CN', 'product.generic', 7, 'vat', NULL, NULL, NULL, NULL, 1, 0, 'u1', 'u1', '2026-08-06T01:00:00Z', '2026-08-06T01:00:00Z'),
       ('comp-a', '$HUB_ID', 'ES', 'ES-CN', 'product.generic', 1, 'surcharge', 'root-igic', 'AIEM A', NULL, NULL, 1, 0, 'u1', 'u1', '2026-08-06T01:00:00Z', '2026-08-06T01:00:00Z'),
       ('comp-b', '$HUB_ID', 'ES', 'ES-CN', 'product.generic', 2, 'surcharge', 'root-igic', 'AIEM B', NULL, NULL, 1, 0, 'u1', 'u1', '2026-08-06T01:00:00Z', '2026-08-06T01:00:00Z'),
       ('dup-igic', '$HUB_ID', 'ES', 'ES-CN', 'product.generic', 7, 'vat', NULL, NULL, NULL, NULL, 1, 0, 'u1', 'u1', '2026-08-06T02:00:00Z', '2026-08-06T02:00:00Z');
SQL

# ── Apply 004 ─────────────────────────────────────────────────────────────────────────────
psql_db -q <"$MIGRATION"

echo "== the index exists, unique, partial and NULLS NOT DISTINCT =="
assert_eq "unique + nulls-not-distinct index on taxes_rule" 1 \
  "$(q "SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
        WHERE c.relname = 'taxes_rule' AND i.indisunique AND i.indnullsnotdistinct
          AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%parent_id IS NULL%'
          AND pg_get_expr(i.indpred, i.indrelid) ILIKE '%is_deleted = 0%';")"

echo "== dedupe: the OLDEST equivalent root survives, the rest are soft-deleted =="
assert_eq "one live root for ES/product.generic (country-wide)" 1 \
  "$(q "SELECT count(*) FROM taxes_rule WHERE hub_id='$HUB_ID' AND country_code='ES'
        AND tax_category_key='product.generic' AND region_code IS NULL AND parent_id IS NULL
        AND valid_from='2012-09-01' AND is_deleted=0;")"
assert_eq "the seeded row is the survivor" "$HUB_ID|taxrule|ES|product.generic" \
  "$(q "SELECT id FROM taxes_rule WHERE hub_id='$HUB_ID' AND country_code='ES'
        AND tax_category_key='product.generic' AND region_code IS NULL AND parent_id IS NULL
        AND valid_from='2012-09-01' AND is_deleted=0;")"
assert_eq "the duplicate is soft-deleted (kept, not erased)" "1" \
  "$(q "SELECT is_deleted FROM taxes_rule WHERE id='dup-product-generic';")"
assert_eq "regional duplicate: the older root survives" "root-igic" \
  "$(q "SELECT id FROM taxes_rule WHERE hub_id='$HUB_ID' AND region_code='ES-CN'
        AND parent_id IS NULL AND is_deleted=0;")"
assert_eq "components are never touched by the dedupe" 2 \
  "$(q "SELECT count(*) FROM taxes_rule WHERE parent_id='root-igic' AND is_deleted=0;")"

echo "== the index rejects a NEW equivalent root (NULLs included) =="
if psql_db -qc "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, valid_from, is_active, is_deleted, created_at)
                VALUES ('dup-again', '$HUB_ID', 'ES', NULL, 'product.generic', 21, 'vat', NULL, '2012-09-01', 1, 0, '2026-08-08T00:00:00Z');" 2>/dev/null; then
  fail "an equivalent root rule (same country/category, NULL region) was inserted twice"
fi
echo "  ok: duplicate root rejected"
psql_db -qc "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, valid_from, is_active, is_deleted, created_at)
             VALUES ('all-null-1', '$HUB_ID', 'ES', NULL, 'service.generic', 21, 'vat', NULL, NULL, 1, 0, '2026-08-08T00:00:00Z');"
if psql_db -qc "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, valid_from, is_active, is_deleted, created_at)
                VALUES ('all-null-2', '$HUB_ID', 'ES', NULL, 'service.generic', 21, 'vat', NULL, NULL, 1, 0, '2026-08-08T00:00:00Z');" 2>/dev/null; then
  fail "NULLS NOT DISTINCT is not enforced: two roots with NULL region AND NULL valid_from coexist"
fi
echo "  ok: NULL = NULL for the natural key (NULLS NOT DISTINCT)"

echo "== what must STAY legal =="
# A scheduled rate change: same key, newer valid_from (the resolver picks the most recent).
psql_db -qc "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, valid_from, is_active, is_deleted, created_at)
             VALUES ('rate-change', '$HUB_ID', 'ES', NULL, 'product.generic', 23, 'vat', NULL, '2027-01-01', 1, 0, '2026-08-08T00:00:00Z');"
echo "  ok: scheduled rate change (different valid_from) accepted"
# A third component under the same root: components share the root's jurisdiction by design.
psql_db -qc "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, is_active, is_deleted, created_at)
             VALUES ('comp-c', '$HUB_ID', 'ES', 'ES-CN', 'product.generic', 3, 'surcharge', 'root-igic', 'AIEM C', 1, 0, '2026-08-08T00:00:00Z');"
echo "  ok: another component under the same root accepted"
# Soft-delete + recreate: the partial index must not count deleted rows.
psql_db -qc "UPDATE taxes_rule SET is_deleted=1, deleted_at='2026-08-08T00:00:00Z' WHERE id='rate-change';"
psql_db -qc "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, valid_from, is_active, is_deleted, created_at)
             VALUES ('rate-change-2', '$HUB_ID', 'ES', NULL, 'product.generic', 23, 'vat', NULL, '2027-01-01', 1, 0, '2026-08-08T00:00:00Z');"
echo "  ok: soft-deleted rule does not block re-creating its key"

echo "== idempotency: re-applying 004 changes nothing =="
BEFORE="$(q "SELECT count(*) || '/' || count(*) FILTER (WHERE is_deleted=0) FROM taxes_rule;")"
psql_db -q <"$MIGRATION"
AFTER="$(q "SELECT count(*) || '/' || count(*) FILTER (WHERE is_deleted=0) FROM taxes_rule;")"
assert_eq "row counts unchanged after re-apply" "$BEFORE" "$AFTER"

echo "PASS: all natural-key contract assertions green"
