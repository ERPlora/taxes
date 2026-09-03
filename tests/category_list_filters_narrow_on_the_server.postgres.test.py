#!/usr/bin/env python3
"""`taxes.categories.list` narrows and orders by the description ON THE SERVER (taxes#44).

`erp-taxes-categories.ts` paints the description column with `filterable: true, filterType: 'text'`
and `sortable: true`. The manifest declared neither: `display_description` was in no `list.filters`
and in no `list.sort`. Both doors fail SILENTLY and differently, which is why both are asserted here:

  * the filter — `hub/crates/runtime/src/queries.rs#reject_undeclared_params` keeps `f_*` out of its
    422 on purpose (it names hub#1182): an undeclared `f_<col>` is DROPPED, not rejected. The user
    types in the box and gets the whole list back, indistinguishable from a filter that ran;
  * the sort — a `sort` outside `list.sort` falls back to `default_sort` (`key` here). The header
    highlights, the rows re-order by something else, and it looks like it worked.

WHAT IS REPRODUCED of the list engine, and only that: the base SELECT wrapped as a derived table
(`SELECT sub.*, COUNT(*) OVER() AS _total FROM ( base ) AS sub`), the per-column condition the
engine emits FOR THE OP THE MANIFEST DECLARES, and the ORDER BY it builds from the `list.sort`
whitelist. All three read the manifest on purpose: take the filter back out, move its op, or drop
the column from the sort whitelist, and this battery goes red — which is the whole point of it.

## The three traps this battery is built around

1. **The column shown is not the column stored.** `display_description` is a COALESCE over the
   translated label (taxes#38), so filtering `description` instead would pass the easy case and lie
   for every translated category: the user reads «Solo banquetes» and searches for it. Asserted from
   both sides — the Spanish fragment finds the row, the stored English one does NOT.
2. **A category with no translation must stay filterable.** The COALESCE falls back to the owner's
   own text for a category the seed never planted. If the filter only worked over the label table,
   the categories a business creates itself — the ones it actually looks for — would be the ones
   that cannot be found.
3. **The neighbour's rows.** Another hub with a category whose description matches must never come
   back. The filter runs in a derived table on top of the query's own `hub_id` predicate; a fix that
   moved it out would leak across tenants and still pass a single-hub test.

And the control that makes the rest mean something: WITHOUT a filter every seeded row comes back,
and the sort order is asserted against the `key` order it falls back to when the whitelist is wrong.
A battery that only ever asserts "one row" passes just as well when the query returns nothing.

Usage: tests/category_list_filters_narrow_on_the_server.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container by default (override: TAXES_TEST_PG_CONTAINER).
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

QUERY = "taxes.categories.list"
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

DB = f"taxes_category_filters_{os.getpid()}_{uuid.uuid4().hex[:6]}"


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


def order_by(requested: str) -> str:
    """The ORDER BY the engine builds: the requested column only if the whitelist concedes it, else
    `default_sort`. This is the second door — silent, and the reason clicking a header can sort by
    something else entirely."""
    whitelist = spec().get("sort") or []
    column = requested if requested in whitelist else spec().get("default_sort")
    if not column or not IDENT.match(column):
        raise RuntimeError(
            f"`{QUERY}` resolves no usable sort column for {requested!r}"
        )
    return f"ORDER BY sub.{column} ASC"


def list_page(hub: str = HUB, sort: str = "key", **filters: str) -> list[dict]:
    """`taxes.categories.list` as the runtime runs it.

    Filters are named the way they travel ON THE CABLE — `f_<col>`, which is what the SDK's
    `buildListParams` flattens them to whatever the manifest says — so the call site reads like the
    request the browser actually sends."""
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
    sql = f"SELECT sub.*, COUNT(*) OVER() AS _total FROM ( {base} ) AS sub{where} {order_by(sort)}"
    return rows(bind(sql, params))


def keys(page: list[dict]) -> list[str]:
    """The keys IN THE ORDER the page returns them — order is under test, so it is not sorted here."""
    return [str(r["key"]) for r in page]


def total(page: list[dict]) -> int:
    """The `total` of the envelope: what the pager shows, and what a filter that does not filter
    betrays first."""
    return int(page[0]["_total"]) if page else 0


# ── seed ─────────────────────────────────────────────────────────────────────────────────────

# Keys are ordered a_/b_/c_ so that the `key` order (the `default_sort` a broken whitelist falls
# back to) and the description order are DIFFERENT. If they matched, the sort assertion would pass
# on the bug.
CATEGORIES = (
    # (key, name, stored description, es label, es description)
    (
        "a_wedding",
        "Wedding catering",
        "Banquets only",
        "Catering de bodas",
        "Solo banquetes",
    ),
    (
        "b_medical",
        "Medical services",
        "Medical care",
        "Servicios médicos",
        "Asistencia sanitaria",
    ),
    # No label row at all: the owner's own category, and the COALESCE fallback under test (trap 2).
    ("c_own", "Cursos de cocina", "Everything taught in the kitchen", None, None),
)


def seed() -> None:
    values = []
    labels = []
    for key, name, description, label, label_desc in CATEGORIES:
        for hub in (HUB, OTHER_HUB):
            values.append(
                "("
                + ",".join(
                    literal(v)
                    for v in (
                        f"{hub}|taxcat|{key}",
                        hub,
                        key,
                        name,
                        description,
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
        if label is not None:
            labels.append(
                "(" + ",".join(literal(v) for v in (key, "es", label, label_desc)) + ")"
            )

    psql(
        [],
        db=DB,
        stdin=(
            "INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active,"
            " is_deleted, created_by, updated_by, created_at, updated_at) VALUES "
            + ",".join(values)
            + ";\n"
            + (
                "INSERT INTO taxes_category_label (key, lang, label, description) VALUES "
                + ",".join(labels)
                + " ON CONFLICT (key, lang) DO UPDATE SET label = EXCLUDED.label,"
                " description = EXCLUDED.description;\n"
                if labels
                else ""
            )
            + f"INSERT INTO hub_settings (hub_id, key, value, updated_at, updated_by) VALUES"
            f" ({literal(HUB)},'language','es',{literal(NOW)},'system'),"
            f" ({literal(OTHER_HUB)},'language','es',{literal(NOW)},'system');\n"
        ),
    )


# ── the battery ──────────────────────────────────────────────────────────────────────────────


def run() -> None:
    print(
        "\nControl — without a filter the whole page comes back (a broken query returns nothing):"
    )
    everything = list_page()
    check("keys with no filter", ["a_wedding", "b_medical", "c_own"], keys(everything))
    check("total with no filter", 3, total(everything))

    print("\nThe filter narrows on the server (taxes#44):")
    banquets = list_page(f_display_description="banquetes")
    check("`banquetes` finds only the catering category", ["a_wedding"], keys(banquets))
    check("`banquetes` total", 1, total(banquets))

    print("\nIt filters the text the column SHOWS, not the one it stores (trap 1):")
    # `a_wedding` stores «Banquets only» and shows «Solo banquetes». Filtering the stored column
    # instead would answer this one and fail the assertion above.
    stored = list_page(f_display_description="Banquets only")
    check(
        "the stored English description finds nothing in a Spanish hub",
        [],
        keys(stored),
    )

    print("\nA category with no translation stays filterable (trap 2):")
    own = list_page(f_display_description="kitchen")
    check("the owner's own category is found by its own text", ["c_own"], keys(own))

    print("\nThe neighbour's identical category never comes back (trap 3):")
    check("the filtered page is single-tenant", ["a_wedding"], keys(banquets))
    neighbour = list_page(hub=OTHER_HUB, f_display_description="banquetes")
    check("the other hub sees its OWN row, not ours", 1, total(neighbour))
    check(
        "and it is the other hub's row",
        [f"{OTHER_HUB}|taxcat|a_wedding"],
        [str(r["id"]) for r in neighbour],
    )

    print(
        "\nThe sort whitelist concedes the column the header paints (the second door):"
    )
    by_description = list_page(sort="display_description")
    # Description order (b «Asistencia», c «Everything», a «Solo») is deliberately NOT the `key`
    # order (a, b, c) the engine falls back to when the whitelist does not concede the column.
    check(
        "clicking the description header orders by the description",
        ["b_medical", "c_own", "a_wedding"],
        keys(by_description),
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
    print(f"PASS — `{QUERY}` filters and orders by `display_description` on the server")
    return 0


if __name__ == "__main__":
    sys.exit(main())
