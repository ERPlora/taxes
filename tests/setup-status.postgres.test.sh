#!/usr/bin/env bash
# Setup-status query contract test (taxes#19) — runs against a REAL Postgres in Docker.
#
# What is under test: `queries/setup_status.sql`, the ONE row that answers "is this hub's tax
# configuration good enough to price a sale?". The runtime (hub#369 / ADR-0222) runs it through
# the dispatcher for the `setup` block of `module.json` and feeds the first row to
# `configured_when`, so every column asserted here is a published contract.
#
# CONFIGURED means: at least one ACTIVE, currently VALID, ROOT tax rule whose country is the
# hub's fiscal country (`hub_settings.country_code`, ADR-0085 — it lives in the CORE, not in this
# module). Each qualifier is here because dropping it produces a wrong answer:
#
#   · country must MATCH        — a French hub carrying only the Spanish baseline resolves nothing
#                                 at sale time and the caller falls back to a guessed rate. Rows
#                                 existing is not the same as rows that APPLY (taxes#7/#18 seeded
#                                 and backfilled the ES baseline; that is the "rows exist" half).
#   · root (`parent_id IS NULL`)— a component (equivalence surcharge) never resolves on its own:
#                                 the engine picks a root rule and then expands its components.
#   · currently valid           — a rate whose `valid_to` is in the past prices nothing TODAY.
#   · active / not deleted      — a deactivated rule does not apply to new operations.
#
# And, deliberately, NOT restricted to `operation_class='subject'` nor to `tax_type='vat'`: a
# physiotherapist selling only VAT-exempt treatments (E1) is correctly configured, and a Canary
# hub charges IGIC. Narrowing either one would invent a false "you are missing your taxes".
#
# The hub with NO `country_code` row is the trap this test pins down: `hub_settings` only gets a
# row when somebody SAVES settings, and the runtime resolves the country from its own default
# ('ES', `settings::country_code_of`) until then. Reporting such a hub as pending would be the
# false pending that `architecture/hub/setup-status.md` §5.3 forbids — and hardcoding 'ES' here
# would plant a country inside an international module. So: no stated country ⇒ we cannot say a
# rule does NOT apply, and any active root rule counts.
#
# Mirrors how the runtime executes a declarative query (crates/runtime/src/queries.rs): the SQL
# runs as-is with the system params bound (`:hub_id`, `:now` — here substituted, as psql has no
# named binds).
#
# Usage: tests/setup-status.postgres.test.sh
#   Uses the `erplora-test-pg-5433` container by default (override: TAXES_TEST_PG_CONTAINER).
#   Creates a scratch database and DROPS it at the end, pass or fail.
set -euo pipefail

MODULE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${TAXES_TEST_PG_CONTAINER:-erplora-test-pg-5433}"
DB="taxes_setup_status_test_$$"
HUB_ID="hub-test"
OTHER_HUB="hub-neighbour"
NOW="2026-08-07T12:00:00Z"
TODAY="2026-08-07"
QUERY_SQL="$MODULE_DIR/queries/setup_status.sql"

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

[ -f "$QUERY_SQL" ] || fail "queries/setup_status.sql does not exist yet (this is the RED state)"

cleanup() { psql_admin -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql_admin -c "CREATE DATABASE $DB;" >/dev/null

# ── The hub as the runtime builds it: system tables first, then the module ────────────────
# `hub_settings` verbatim from system migration v4 (crates/runtime/src/system_migrations.rs).
# The query reads the hub's fiscal country from it, so the test must carry the real shape.
psql_db -q <<'SQL'
CREATE TABLE hub_settings (
  hub_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (hub_id, key));
SQL

for mig in "$MODULE_DIR"/migrations/postgres/*.sql; do
  psql_db -q <"$mig"
done

# Same binding the runtime does in apply_module_seed.
bind_seed() {
  sed -e "s/:hub_id/'$HUB_ID'/g" \
      -e "s/:current_user_id/'system'/g" \
      -e "s/:now/'$NOW'/g" \
      "$MODULE_DIR/seed/install.postgres.sql"
}
bind_seed | psql_db -q

# The query, bound the way `system_params` binds it.
run_status() { # run_status <hub_id> → the value of one column
  local hub="$1" column="$2"
  sed -e "s/:hub_id/'$hub'/g" -e "s/:now/'$NOW'/g" "$QUERY_SQL" \
    | sed -e 's/;[[:space:]]*$//' \
    | { printf 'SELECT %s FROM (' "$column"; cat; printf ') AS s;'; } \
    | psql_db -tA
}
matching() { run_status "$1" matching_rules; }
rows_returned() { # the query MUST answer with exactly one row, always
  sed -e "s/:hub_id/'$1'/g" -e "s/:now/'$NOW'/g" "$QUERY_SQL" \
    | sed -e 's/;[[:space:]]*$//' \
    | { printf 'SELECT count(*) FROM ('; cat; printf ') AS s;'; } \
    | psql_db -tA
}

echo "== a hub with no stated country is NOT reported as pending (no false pending) =="
# hub_settings is empty: this is a hub nobody has saved settings for yet, and the runtime is
# resolving its country from the default. The ES baseline the seed planted must count.
assert_eq "one row, always" 1 "$(rows_returned "$HUB_ID")"
BASE="$(matching "$HUB_ID")"
[ "$BASE" -gt 0 ] || fail "seeded ES baseline with no country row — expected matching_rules > 0, got [$BASE]"
echo "  ok: matching_rules = $BASE with no country_code row"

echo "== the country the hub states is the country that has to match =="
psql_db -qc "INSERT INTO hub_settings (hub_id, key, value, updated_at, updated_by) VALUES ('$HUB_ID','country_code','ES','$NOW','system');"
assert_eq "ES hub with the ES baseline" "$BASE" "$(matching "$HUB_ID")"
assert_eq "the row reports the hub's country" "ES" "$(run_status "$HUB_ID" country_code)"

psql_db -qc "UPDATE hub_settings SET value='FR' WHERE hub_id='$HUB_ID' AND key='country_code';"
assert_eq "a French hub carrying only ES rules is NOT configured" 0 "$(matching "$HUB_ID")"
assert_eq "one row even when nothing matches" 1 "$(rows_returned "$HUB_ID")"

psql_db -qc "UPDATE hub_settings SET value=' es ' WHERE hub_id='$HUB_ID' AND key='country_code';"
assert_eq "the match is case- and whitespace-insensitive" "$BASE" "$(matching "$HUB_ID")"
psql_db -qc "UPDATE hub_settings SET value='ES' WHERE hub_id='$HUB_ID' AND key='country_code';"

echo "== a component alone never counts: it cannot resolve a rate by itself =="
ROOT_ID="$HUB_ID|taxrule|ES|product.generic"
psql_db -qc "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, operation_class, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at) VALUES ('r-surcharge','$HUB_ID','ES',NULL,'product.generic',5.2,'surcharge','subject','$ROOT_ID','Equivalence surcharge','2012-09-01',NULL,1,0,'system','system','$NOW','$NOW');"
assert_eq "adding a component does not change the count" "$BASE" "$(matching "$HUB_ID")"
psql_db -qc "DELETE FROM taxes_rule WHERE id='r-surcharge';"

echo "== only rules that apply TODAY count =="
psql_db -qc "UPDATE taxes_rule SET valid_to='2020-12-31' WHERE hub_id='$HUB_ID';"
assert_eq "every rule expired ⇒ not configured" 0 "$(matching "$HUB_ID")"
psql_db -qc "UPDATE taxes_rule SET valid_to='$TODAY' WHERE id='$ROOT_ID';"
assert_eq "valid_to = today is still valid (inclusive, like the engine)" 1 "$(matching "$HUB_ID")"
psql_db -qc "UPDATE taxes_rule SET valid_from='2099-01-01', valid_to=NULL WHERE id='$ROOT_ID';"
assert_eq "a rule that starts in the future does not count yet" 0 "$(matching "$HUB_ID")"
# The UI writes '' for an empty date field (commands/rule_create.sql binds it raw), and empty
# means "no limit", exactly as the engine reads it — not "expired in year zero".
psql_db -qc "UPDATE taxes_rule SET valid_from='', valid_to='' WHERE id='$ROOT_ID';"
assert_eq "empty validity dates mean no limit" 1 "$(matching "$HUB_ID")"
psql_db -qc "UPDATE taxes_rule SET valid_from='2012-09-01', valid_to=NULL WHERE hub_id='$HUB_ID';"

echo "== deactivated and soft-deleted rules do not count =="
psql_db -qc "UPDATE taxes_rule SET is_active=0 WHERE hub_id='$HUB_ID';"
assert_eq "all rules deactivated ⇒ not configured" 0 "$(matching "$HUB_ID")"
psql_db -qc "UPDATE taxes_rule SET is_active=1 WHERE hub_id='$HUB_ID';"
psql_db -qc "UPDATE taxes_rule SET is_deleted=1, deleted_at='$NOW' WHERE hub_id='$HUB_ID';"
assert_eq "all rules soft-deleted ⇒ not configured" 0 "$(matching "$HUB_ID")"
psql_db -qc "UPDATE taxes_rule SET is_deleted=0, deleted_at=NULL WHERE hub_id='$HUB_ID';"

echo "== an EXEMPT-only business is configured: 0 % with a cause is a resolved rate =="
psql_db -qc "UPDATE taxes_rule SET is_active=0 WHERE hub_id='$HUB_ID' AND tax_category_key <> 'service.health';"
EXEMPT="$(matching "$HUB_ID")"
assert_eq "only the exempt healthcare rule is active" 1 "$EXEMPT"
assert_eq "and it is indeed exempt" "exempt" "$(psql_db -tAc "SELECT operation_class FROM taxes_rule WHERE hub_id='$HUB_ID' AND tax_category_key='service.health' AND is_active=1;")"
psql_db -qc "UPDATE taxes_rule SET is_active=1 WHERE hub_id='$HUB_ID';"

echo "== the answer is scoped to the hub asking =="
psql_db -qc "INSERT INTO hub_settings (hub_id, key, value, updated_at, updated_by) VALUES ('$OTHER_HUB','country_code','ES','$NOW','system');"
assert_eq "a neighbour hub with no rules of its own is not configured" 0 "$(matching "$OTHER_HUB")"
assert_eq "and it still gets its one row" 1 "$(rows_returned "$OTHER_HUB")"

echo
echo "PASS — taxes.rules.status answers what the setup block promises"
