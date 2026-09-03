#!/usr/bin/env python3
"""`taxes.rules.list` narrows by jurisdiction ON THE SERVER, with the op each box deserves (taxes#48).

The rules table paints two jurisdiction boxes, and taxes#48 made them different on purpose:

  * `country_code` is a SELECT — its domain has been the closed ISO 3166-1 list since taxes#41 — so
    the manifest declares `op: eq` and the value chosen has to match whole;
  * `region_code` stays a TEXT box — `schemas/rule_create.json` gives it a `pattern`, not an `enum`,
    so ISO 3166-2 is a shape here and not a list — so the manifest keeps `op: like` and a fragment
    has to narrow.

`filter_boxes_match_the_manifest.contract.test.py` already refuses a box whose op contradicts it.
What no contract test can see is whether the pair actually NARROWS once Postgres runs it, and both
ways of getting it wrong are silent: `eq` against a box the user typed a fragment into answers with
an empty table, and `like` against a chosen code answers with somebody else's rows. Nothing raises.

## The traps this battery is built around

1. **`like` matching the code inside another value.** `ES` as a `like` fragment also matches `ESP`
   and — the one that bites — the `ES` inside a region like `ES-CN` if the condition is ever moved
   to the wrong column. The seed carries a country whose code CONTAINS another country's (`ES` and
   `ESH`), so a return to `op: like` on the country comes back with a row too many.
2. **The absent filter is not an empty filter.** The runtime's driver binds a `:name` the caller
   omitted as NULL (`DynNull`, `crates/db/src/lib.rs`), so «no filter» has to mean «no condition»,
   never «no rows». Asserted as the control that makes every other count mean something.
3. **The neighbour's rules.** Another hub with rules for the same country must never come back: the
   filter runs in a derived table on top of the query's own `hub_id` predicate.
4. **A country the enum no longer admits.** `ZZ` rows predate taxes#41 and are still in the table
   (which is why the picker keeps offering them, `jurisdiction-filter.test.ts`). Filtering for one
   has to reach it — a filter that cannot name a visible row is the hub#1182 silence again.

WHAT IS REPRODUCED of the list engine, and only that: the base SELECT wrapped as a derived table
(`SELECT sub.*, COUNT(*) OVER() AS _total FROM ( base ) AS sub`) and the per-column condition the
engine emits FOR THE OP THE MANIFEST DECLARES. It reads the manifest on purpose: move either op and
this battery goes red, which is the whole point of it.

Usage: tests/rules_jurisdiction_filter_narrows_on_the_server.postgres.test.py   (exit 0 = green)
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
HUB = "hub-under-test"
OTHER_HUB = "hub-next-door"
USER = "u-owner"
NOW = "2026-09-03T10:00:00Z"

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

DB = f"taxes_rule_filters_{os.getpid()}_{uuid.uuid4().hex[:6]}"


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


# ── the list engine, only the part under test ────────────────────────────────────────────────


def bind(sql: str, params: dict) -> str:
    """One pass over the `:name` placeholders. A param the caller omits binds as NULL, which is what
    the runtime's driver does (`DynNull`, `crates/db/src/lib.rs`) — and the reason an absent filter
    means "no condition" instead of "no rows"."""
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


def list_page(hub: str = HUB, **filters: str) -> list[dict]:
    """`taxes.rules.list` as the runtime runs it.

    Filters are named the way they travel ON THE CABLE — `f_<col>` — so the call site reads like the
    request the browser actually sends when the chosen country leaves the select."""
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
        **{f"f_{col}": value for col, value in columns.items()},
    }
    sql = (
        f"SELECT sub.*, COUNT(*) OVER() AS _total FROM ( {base} ) AS sub{where} "
        "ORDER BY sub.id ASC"
    )
    return rows(bind(sql, params))


def ids(page: list[dict]) -> list[str]:
    return sorted(str(r["id"]) for r in page)


def total(page: list[dict]) -> int:
    """The `total` of the envelope: what the pager shows, and what a filter that does not filter
    betrays first."""
    return int(page[0]["_total"]) if page else 0


# ── seed ─────────────────────────────────────────────────────────────────────────────────────

CATEGORY = "standard"

# (id, country, region). `ESH` exists so that `ES` as a LIKE fragment matches one row too many:
# it is the positive control of `op: eq` on the country. `ZZ` is the legacy code taxes#41 closed
# the door on, still sitting in tables created before it.
RULES = (
    ("r-es", "ES", None),
    ("r-es-cn", "ES", "ES-CN"),
    ("r-es-ml", "ES", "ES-ML"),
    ("r-esh", "ESH", None),
    ("r-pt", "PT", None),
    ("r-zz", "ZZ", None),
)


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
        for rule_id, country, region in RULES:
            rules.append(
                "("
                + ",".join(
                    literal(v)
                    for v in (
                        f"{hub}|{rule_id}",
                        hub,
                        country,
                        region,
                        CATEGORY,
                        21,
                        "vat",
                        1,
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
            " rate_pct, tax_type, is_active, is_deleted, created_at) VALUES "
            + ",".join(rules)
            + ";\n"
            f"INSERT INTO hub_settings (hub_id, key, value, updated_at, updated_by) VALUES"
            f" ({literal(HUB)}, 'language', 'es', {literal(NOW)}, 'system');\n"
        ),
    )


def run() -> None:
    print(
        "\nThe control — no filter is not an empty filter (the omitted param binds NULL):"
    )
    everything = list_page()
    check(
        "without a filter every rule of the hub comes back",
        [f"{HUB}|{r[0]}" for r in sorted(RULES)],
        ids(everything),
    )
    check("and the envelope counts them all", len(RULES), total(everything))

    print("\nThe country is CHOSEN, so it matches whole (`op: eq`, taxes#48):")
    spain = list_page(f_country_code="ES")
    check(
        "choosing ES returns the three Spanish rules",
        [f"{HUB}|r-es", f"{HUB}|r-es-cn", f"{HUB}|r-es-ml"],
        ids(spain),
    )
    check("and the pager agrees with them", 3, total(spain))
    # The positive control of `eq`: with `op: like` this list would carry `r-esh` as well, and the
    # owner filtering «España» would be reading a rule of Western Sahara as if it were hers.
    check(
        "and NOT the country whose code merely contains it (ESH)",
        [],
        [i for i in ids(spain) if i.endswith("r-esh")],
    )

    portugal = list_page(f_country_code="PT")
    check(
        "choosing another country returns only its rule", [f"{HUB}|r-pt"], ids(portugal)
    )

    print("\nA country the enum no longer admits is still reachable (taxes#41 legacy):")
    check(
        "filtering for ZZ finds the rule that is on screen",
        [f"{HUB}|r-zz"],
        ids(list_page(f_country_code="ZZ")),
    )

    print("\nThe region is TYPED, so a fragment narrows (`op: like`, taxes#48):")
    canaries = list_page(f_region_code="ES-CN")
    check("the whole region code finds its rule", [f"{HUB}|r-es-cn"], ids(canaries))
    fragment = list_page(f_region_code="ES-")
    check(
        "and a fragment finds every region under it — which is what a text box promises",
        [f"{HUB}|r-es-cn", f"{HUB}|r-es-ml"],
        ids(fragment),
    )

    print("\nThe two boxes narrow TOGETHER, and never past the hub:")
    check(
        "country + region cross each other",
        [f"{HUB}|r-es-ml"],
        ids(list_page(f_country_code="ES", f_region_code="ML")),
    )
    neighbour = list_page(hub=OTHER_HUB, f_country_code="ES")
    check(
        "the same filter in the hub next door returns ITS rules, never ours",
        [f"{OTHER_HUB}|r-es", f"{OTHER_HUB}|r-es-cn", f"{OTHER_HUB}|r-es-ml"],
        ids(neighbour),
    )


def main() -> int:
    if not container_available():
        print(f"FAIL — Postgres container `{CONTAINER}` not available (docker).")
        print(
            "       This battery does not degrade to a skip: an untested filter is the bug."
        )
        return 1
    create_db()
    try:
        seed()
        run()
    except RuntimeError as exc:
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
        f"PASS — `{QUERY}` narrows by country (`eq`) and by region fragment (`like`) on the server"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
