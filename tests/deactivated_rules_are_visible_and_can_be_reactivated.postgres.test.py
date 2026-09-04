#!/usr/bin/env python3
"""A deactivated tax rule can be SEEN and brought BACK, and the keystone never sees it (taxes#52).

`commands/rule_deactivate.sql` has always had a way out of the catalogue and no way back in:
`queries/rules_list.sql` ended in `AND r.is_active = 1`, so the moment a rule was deactivated it
left the screen for good — and there is no command to undo it either. Whatever was deactivated by
mistake could only be recovered through the database. taxes#53 had already removed the dead «Active»
filter box from the three screens (a filter the server could not honour); this closes the hole it
named.

## The shape of the fix, and why it is THIS one

The scope is widened with the idiom `services.services.list` already ships (services#44):

    AND (r.is_active = 1 OR COALESCE(CAST(:include_archived AS TEXT), '0') IN ('1', 'true'))

Absent = NULL = default scope. That is not a stylistic choice: `hub/crates/runtime/src/queries.rs`
(`required_binds`, hub#1086) marks a `:bind` optional ONLY when its every appearance sits inside the
first argument of a `COALESCE` — there is a unit test named `coalesce_wrapped_bind_is_optional`
carrying this very sentence, and a sibling (`bind_in_both_places_is_required`) proving a second,
unprotected appearance would make the parameter MANDATORY for every caller. Which is the whole
point: `taxes.calculate` — the keystone of ADR-0069, declared `reads: ["taxes.rules.list"]` — must
keep working without passing anything, and keep receiving the active rules and only those. A tax
engine that suddenly resolved a deactivated rate would put a wrong rate on a real invoice.

## What this battery holds down

1. **The control.** The deactivated rules ARE in the table (asserted against raw SQL) and still do
   not come back by default — so «they do not appear» means «the query excludes them», not «the
   seed forgot them». Without this, every other count below is worthless.
2. **The keystone's read is unchanged.** No parameter → exactly the active rules.
3. **Asking for them explicitly brings them, and only them.** `include_archived` + `is_active = 0`.
4. **The parameter arrives as a STRING.** An HTML `<select>` sends `"0"`/`"1"`, a command sends
   numbers; the `CAST(... AS TEXT)` is what accepts both. Asserted for `1`, `"1"` and `"true"`, and
   also that anything else (`"0"`, absent) leaves the default scope alone — a widening that
   triggered on any value would silently ship deactivated rates to the engine.
5. **The neighbour's rules.** Widening the scope must not widen the HUB: `include_archived` in the
   hub next door answers with ITS rules, never ours.
6. **The way back really writes.** `commands/rule_activate.sql` reactivates the row of THIS hub and
   no other, and touches 0 rows when there was nothing to bring back — which is what makes the
   manifest's `expect_rows` fire instead of answering a silent OK over an untouched row.
7. **The round trip closes.** After reactivating, the rule is back in the DEFAULT scope, which is
   the only proof that it is usable by the engine again.

WHAT IS REPRODUCED of the list engine, and only that: the base SELECT wrapped as a derived table
(`SELECT sub.*, COUNT(*) OVER() AS _total FROM ( base ) AS sub`) plus the per-column condition the
engine emits FOR THE OP THE MANIFEST DECLARES. Reading the manifest is deliberate: drop the
`is_active` filter from `list.filters` and this battery goes red instead of silently filtering
nothing (hub#1182).

Usage: tests/deactivated_rules_are_visible_and_can_be_reactivated.postgres.test.py  (exit 0 = green)
  Uses the `erplora-test-pg-5433` container by default (override: TAXES_TEST_PG_CONTAINER — the
  gate injects its per-run container under that same name, derived from the manifest id).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text(encoding="utf-8"))
CONTAINER = os.environ.get("TAXES_TEST_PG_CONTAINER", "erplora-test-pg-5433")

QUERY = "taxes.rules.list"
ACTIVATE = "taxes.rules.activate"
HUB = "hub-under-test"
OTHER_HUB = "hub-next-door"
USER = "u-owner"
NOW = "2026-09-04T10:00:00Z"

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
PARAM = re.compile(r":([a-z_][a-z0-9_]*)", re.IGNORECASE)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"  ✗ {msg}")


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def check(what: str, expected, got) -> None:
    if expected == got:
        ok(f"{what}: {got!r}")
    else:
        fail(f"{what}: expected {expected!r}, got {got!r}")


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


# ── Postgres plumbing ────────────────────────────────────────────────────────────────────────

DB = f"taxes_archived_scope_{os.getpid()}_{uuid.uuid4().hex[:6]}"


def psql(args: list[str], db: str | None = None, stdin: str | None = None) -> str:
    cmd = [
        "docker",
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-X",
    ]
    if db:
        cmd += ["-d", db]
    res = subprocess.run(cmd + args, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    return res.stdout


def container_available() -> bool:
    try:
        subprocess.run(
            ["docker", "inspect", CONTAINER], capture_output=True, check=True, text=True
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


# The two CORE tables this query reads, verbatim from the system migrations
# (`crates/runtime/src/system_migrations.rs` v4 and v7): the language is resolved from them, and
# without them the query does not even prepare.
CORE_TABLES = """
CREATE TABLE hub_settings (
  hub_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (hub_id, key));
CREATE TABLE hub_user_pref (
  hub_id TEXT NOT NULL, user_id TEXT NOT NULL, language TEXT NOT NULL DEFAULT '',
  theme_mode TEXT NOT NULL DEFAULT '', theme_palette TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL, PRIMARY KEY (hub_id, user_id));
"""


def create_db() -> None:
    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    psql([], db=DB, stdin=CORE_TABLES)
    for rel in (MANIFEST.get("migrations") or {}).get("postgres", []):
        path = rel if isinstance(rel, str) else rel["file"]
        psql([], db=DB, stdin=(MODULE_DIR / path).read_text(encoding="utf-8"))


def drop_db() -> None:
    try:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}" WITH (FORCE)'])
    except RuntimeError as exc:  # pragma: no cover - diagnostics only
        print(f"  ! could not drop {DB}: {exc}")


def rows(sql: str) -> list[dict]:
    out = psql(
        ["-tAc", f"SELECT COALESCE(json_agg(t), '[]'::json) FROM ({sql}) t"], db=DB
    )
    return json.loads(out.strip() or "[]")


def execute(sql: str) -> int:
    """Runs a statement and returns the number of rows it touched (`UPDATE n`)."""
    out = psql(["-c", sql], db=DB).strip().splitlines()
    tag = out[-1] if out else ""
    match = re.match(r"^(?:UPDATE|INSERT \d+|DELETE)\s+(\d+)$", tag.strip())
    if not match:
        raise RuntimeError(f"unexpected command tag from psql: {tag!r}")
    return int(match.group(1))


# ── the list engine, only the part under test ────────────────────────────────────────────────


def bind(sql: str, params: dict) -> str:
    """One pass over the `:name` placeholders. A param the caller omits binds as NULL, which is what
    the runtime's driver does (`DynNull`, `crates/db/src/lib.rs`) — and the reason an absent
    `include_archived` means «default scope» instead of «no rows»."""
    return PARAM.sub(lambda m: literal(params.get(m.group(1))), sql)


def spec() -> dict:
    return MANIFEST["queries"][QUERY].get("list") or {}


def condition(column: str, value: str) -> str:
    """The condition the engine emits for this column, given the op THE MANIFEST declares."""
    filters = spec().get("filters") or {}
    op = (filters.get(column) or {}).get("op")
    if not IDENT.match(column):
        raise RuntimeError(f"{column} is not a plain identifier")
    if op == "eq":
        return f"CAST(sub.{column} AS TEXT) = CAST(:f_{column} AS TEXT)"
    if op == "like":
        return (
            f"CAST(sub.{column} AS TEXT) LIKE '%' || CAST(:f_{column} AS TEXT) || '%'"
        )
    raise RuntimeError(
        f"`{QUERY}` declares no usable filter for `{column}` (op={op!r}): the runtime drops "
        f"`f_{column}` and the caller is filtering nothing (hub#1182)"
    )


_ABSENT = object()


def list_page(hub: str = HUB, include_archived=_ABSENT, **filters) -> list[dict]:
    """`taxes.rules.list` as the runtime runs it.

    Filters travel the way they do ON THE CABLE — `f_<col>` — so the call site reads like the request
    the browser sends. `include_archived` is NOT a filter: it is a plain bind of the query (the
    scope), and leaving it out has to bind NULL, exactly like the driver does for a parameter the
    caller never sent."""
    base = (MODULE_DIR / MANIFEST["queries"][QUERY]["sql"]).read_text(encoding="utf-8")
    base = base.strip().rstrip(";").rstrip()
    columns = {}
    for param, value in filters.items():
        if not param.startswith("f_"):
            raise RuntimeError(f"{param!r} is not a filter: they travel as `f_<col>`")
        columns[param[2:]] = value
    conds = [condition(col, value) for col, value in columns.items()]
    where = f" WHERE {' AND '.join(conds)}" if conds else ""
    params = {
        "hub_id": hub,
        "current_user_id": USER,
        **({} if include_archived is _ABSENT else {"include_archived": include_archived}),
        **{f"f_{col}": value for col, value in columns.items()},
    }
    sql = (
        f"SELECT sub.*, COUNT(*) OVER() AS _total FROM ( {base} ) AS sub{where} "
        "ORDER BY sub.id ASC"
    )
    return rows(bind(sql, params))


def activate(rule_id: str, hub: str = HUB) -> int:
    """`taxes.rules.activate` as the runtime runs it: the module's own statement, bound."""
    sql = (MODULE_DIR / MANIFEST["commands"][ACTIVATE]["sql"][0]).read_text(
        encoding="utf-8"
    )
    return execute(
        bind(sql, {"rule_id": rule_id, "hub_id": hub, "current_user_id": USER, "now": NOW})
    )


def ids(page: list[dict]) -> list[str]:
    return sorted(str(r["id"]) for r in page)


def total(page: list[dict]) -> int:
    """The `total` of the envelope: what the pager shows, and what a scope that widened when it
    should not have betrays first."""
    return int(page[0]["_total"]) if page else 0


# ── seed ─────────────────────────────────────────────────────────────────────────────────────

CATEGORY = "standard"

# (id, country, valid_from, is_active). The ES pair is the real story of the issue: the rate of one
# year is deactivated when the next one comes in — `ix_tax_rule_root_natural` (migration 004) keys
# roots on (hub, country, category, region, valid_from), so the two coexist and the deactivated one
# still HOLDS its natural key, which is why bringing it back can never collide.
RULES = (
    ("r-es-2025", "ES", "2025-01-01", 0),
    ("r-es-2026", "ES", "2026-01-01", 1),
    ("r-fr", "FR", None, 0),
    ("r-pt", "PT", None, 1),
)

ACTIVE = sorted(r[0] for r in RULES if r[3] == 1)
DEACTIVATED = sorted(r[0] for r in RULES if r[3] == 0)


def seed() -> None:
    categories = []
    rules = []
    for hub in (HUB, OTHER_HUB):
        categories.append(
            "("
            + ",".join(
                literal(v)
                for v in (
                    f"{hub}|taxcat|{CATEGORY}",
                    hub,
                    CATEGORY,
                    "Standard rate",
                    "",
                    0,
                    1,
                    0,
                    "system",
                    "system",
                    NOW,
                    NOW,
                )
            )
            + ")"
        )
        for rule_id, country, valid_from, is_active in RULES:
            rules.append(
                "("
                + ",".join(
                    literal(v)
                    for v in (
                        f"{hub}|{rule_id}",
                        hub,
                        country,
                        None,
                        CATEGORY,
                        21,
                        "vat",
                        valid_from,
                        is_active,
                        0,
                        NOW,
                    )
                )
                + ")"
            )

    psql(
        [],
        db=DB,
        stdin=(
            "INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active,"
            " is_deleted, created_by, updated_by, created_at, updated_at) VALUES "
            + ",".join(categories)
            + ";\n"
            "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key,"
            " rate_pct, tax_type, valid_from, is_active, is_deleted, created_at) VALUES "
            + ",".join(rules)
            + ";\n"
            f"INSERT INTO hub_settings (hub_id, key, value, updated_at, updated_by) VALUES"
            f" ({literal(HUB)}, 'language', 'es', {literal(NOW)}, 'system');\n"
        ),
    )


def in_hub(rule_ids: list[str], hub: str = HUB) -> list[str]:
    return sorted(f"{hub}|{r}" for r in rule_ids)


def run() -> None:
    print("\nThe control — the deactivated rules ARE in the table, and still do not come back:")
    seeded_off = sorted(
        str(r["id"])
        for r in rows(
            f"SELECT id FROM taxes_rule WHERE hub_id = {literal(HUB)} AND is_active = 0"
        )
    )
    check("the seed really planted them", in_hub(DEACTIVATED), seeded_off)
    default = list_page()
    check(
        "and the default answer carries only the active ones",
        in_hub(ACTIVE),
        ids(default),
    )
    check("the pager counts only those too", len(ACTIVE), total(default))

    print("\nThe keystone (ADR-0069) reads it WITHOUT the parameter and must not notice (taxes#52):")
    # `taxes.calculate` declares `reads: ["taxes.rules.list"]` and passes no scope. The bind is
    # optional (`coalesce_wrapped_bind_is_optional`, hub#1086); were it required, the engine would
    # stop resolving rates at all — and were it widening by default, it would resolve a rate the
    # business retired, onto a real invoice.
    check(
        "an omitted `include_archived` is the DEFAULT scope, not an empty answer",
        ids(default),
        ids(list_page(include_archived=None)),
    )

    print("\nAsking for the deactivated ones brings them — and only them:")
    archived = list_page(include_archived=1, f_is_active="0")
    check("the ones that had vanished are reachable", in_hub(DEACTIVATED), ids(archived))
    check("and the pager agrees with them", len(DEACTIVATED), total(archived))
    still_active = list_page(include_archived=1, f_is_active="1")
    check(
        "and the same widened scope, asked for the active ones, answers those",
        in_hub(ACTIVE),
        ids(still_active),
    )
    check(
        "with the scope widened and no filter, the screen can show both",
        in_hub(ACTIVE + DEACTIVATED),
        ids(list_page(include_archived=1)),
    )

    print("\nThe parameter arrives as a STRING from a <select>, and only a true value widens:")
    check(
        'the "1" a select sends widens exactly like the number 1',
        ids(archived),
        ids(list_page(include_archived="1", f_is_active="0")),
    )
    check(
        '"true" widens as well',
        ids(archived),
        ids(list_page(include_archived="true", f_is_active="0")),
    )
    check(
        '"0" does NOT widen — the default scope is kept',
        in_hub(ACTIVE),
        ids(list_page(include_archived="0")),
    )
    check(
        "and neither does an empty string (a cleared filter box)",
        in_hub(ACTIVE),
        ids(list_page(include_archived="")),
    )

    print("\nWidening the SCOPE never widens the HUB:")
    check(
        "the hub next door sees its own deactivated rules, never ours",
        in_hub(DEACTIVATED, OTHER_HUB),
        ids(list_page(hub=OTHER_HUB, include_archived=1, f_is_active="0")),
    )

    print("\nThe way back writes, and writes in ONE hub (`taxes.rules.activate`):")
    check("reactivating a deactivated rule touches its row", 1, activate(f"{HUB}|r-es-2025"))
    check(
        "the rule of the hub next door keeps the state it had",
        [f"{OTHER_HUB}|r-es-2025"],
        sorted(
            str(r["id"])
            for r in rows(
                f"SELECT id FROM taxes_rule WHERE hub_id = {literal(OTHER_HUB)}"
                " AND is_active = 0 AND id LIKE '%r-es-2025'"
            )
        ),
    )
    check(
        "a rule that was already active is touched 0 times — that is what `expect_rows` turns into"
        " an error instead of a silent OK",
        0,
        activate(f"{HUB}|r-pt"),
    )
    check(
        "and a rule of another hub cannot be reached by id",
        0,
        activate(f"{OTHER_HUB}|r-fr"),
    )

    print("\nThe round trip closes — what came back is usable by the engine again:")
    check(
        "the reactivated rule is in the DEFAULT scope, where the keystone reads",
        in_hub(sorted(ACTIVE + ["r-es-2025"])),
        ids(list_page()),
    )
    check(
        "and only the one still deactivated needs the widened scope",
        in_hub(["r-fr"]),
        ids(list_page(include_archived=1, f_is_active="0")),
    )

    print("\nThe manifest keeps the way back honest:")
    cmd = MANIFEST["commands"].get(ACTIVATE) or {}
    expect = cmd.get("expect_rows") or {}
    check(f"`{ACTIVATE}` demands at least one row", ("min", 1), (expect.get("op"), expect.get("n")))
    check(
        "and names the error the screen can act on",
        "taxes.rule_not_deactivated",
        expect.get("error"),
    )
    check(
        "it is guarded by the same permission as deactivating",
        MANIFEST["commands"]["taxes.rules.deactivate"].get("permission"),
        cmd.get("permission"),
    )
    check(
        "and it announces itself, so the screens listening refresh",
        True,
        "taxes.rule.activated" in (cmd.get("emit") or [])
        and "taxes.rule.activated" in (MANIFEST.get("events", {}).get("emits") or []),
    )


def main() -> int:
    if not container_available():
        print(f"FAIL — Postgres container `{CONTAINER}` not available (docker).")
        print(
            "       This battery does not degrade to a skip: a rule nobody can bring back is the bug."
        )
        return 1
    create_db()
    try:
        seed()
        run()
    except (RuntimeError, KeyError) as exc:
        fail(str(exc))
    finally:
        drop_db()

    print()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS — deactivated rules are reachable on demand, `{ACTIVATE}` brings them back, and the"
        " keystone's read is untouched"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
