#!/usr/bin/env python3
"""Rules that ALREADY overlapped before the guard are FLAGGED, and the owner can fix them from the
row (taxes#68, out of taxes#66).

WHY. taxes#66 closed the door for NEW overlaps: `commands/_rule_overlap_assert.sql` refuses to
create, reactivate, end or bulk-insert a rule that would leave two ACTIVE root rules of the same
slot (hub, country, region, tax category) in force on the same day. But on purpose it only looks at
the row each command writes: pairs saved BEFORE that guard are still in `taxes_rule`, both listed as
in force, and the till charges whichever starts later — without the owner ever seeing it.

No data migration touches them (which of the two the owner meant is theirs to decide). Instead
`taxes.rules.list` exposes `overlaps` (1/0), computed with the SAME predicate as the assert, so the
screen marks the row and the assistant can filter by it (`f_overlaps=1`); and the two ways out that
already exist — «Set end date» (`taxes.rules.end`) and «Deactivate» — clear the flag.

This battery runs the module's OWN files (the query through the list engine's wrapper, the commands'
statements in one transaction), binds substituted the way the runtime's driver binds them (an
omitted `:name` is NULL), against a real Postgres with the module's own migrations. The overlapping
rows are seeded with a plain INSERT on purpose: they are the rows the guard never saw.

Usage: tests/overlapping_rules_are_flagged.postgres.test.py   (exit 0 = green)
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

QUERY = "taxes.rules.list"
HUB = "hub-under-test"
OTHER_HUB = "hub-next-door"
USER = "u-owner"
SEEDED_AT = "2026-09-01T10:00:00Z"
CATEGORY = "product.generic"
OTHER_CATEGORY = "product.reduced"

PARAM = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)", re.IGNORECASE)
IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")
UNIQUE = re.compile(r'violates unique constraint "([^"]+)"')
# A SELECT statement (the per-hub write lock of taxes#69) prints no tag, only its row footer; the
# dispatcher counts it as the rows it returned, as sqlx's `rows_affected` does.
TAG = re.compile(r"^(?:INSERT \d+ (\d+)|UPDATE (\d+)|DELETE (\d+)|\((\d+) rows?\))$")
DB = f"taxes_overlap_flag_{os.getpid()}_{uuid.uuid4().hex[:6]}"

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
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


# ── Postgres plumbing ────────────────────────────────────────────────────────────────────────


def psql_raw(args: list[str], db: str | None = None, stdin: str | None = None):
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
    return subprocess.run(cmd + args, input=stdin, capture_output=True, text=True)


def psql(args: list[str], db: str | None = None, stdin: str | None = None) -> str:
    res = psql_raw(args, db, stdin)
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


# The two CORE tables `rules_list.sql` reads to resolve the caller's language, verbatim from the
# system migrations (`crates/runtime/src/system_migrations.rs` v4 and v7).
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
    for hub in (HUB, OTHER_HUB):
        for key in (CATEGORY, OTHER_CATEGORY):
            execute(
                "INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active,"
                " is_deleted, created_by, updated_by, created_at, updated_at) VALUES ("
                + ",".join(
                    literal(v)
                    for v in (
                        f"{hub}|taxcat|{key}",
                        hub,
                        key,
                        key,
                        "",
                        0,
                        1,
                        0,
                        USER,
                        USER,
                        SEEDED_AT,
                        SEEDED_AT,
                    )
                )
                + ")"
            )


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
    out = psql(["-c", sql], db=DB).strip().splitlines()
    tag = out[-1] if out else ""
    match = re.match(r"^(?:UPDATE|INSERT \d+|DELETE)\s+(\d+)$", tag.strip())
    if not match:
        raise RuntimeError(f"unexpected command tag from psql: {tag!r}")
    return int(match.group(1))


def strip_comments(sql: str) -> str:
    return "\n".join(
        line for line in sql.splitlines() if not line.strip().startswith("--")
    )


def bind(sql: str, params: dict) -> str:
    """One pass over the `:name` placeholders; an omitted param binds NULL, as the driver does."""
    return PARAM.sub(lambda m: literal(params.get(m.group(1))), sql)


# ── the rows the guard never saw ─────────────────────────────────────────────────────────────


def seed(
    rule_id: str,
    *,
    hub: str = HUB,
    country: str = "ES",
    region: str | None = None,
    category: str = CATEGORY,
    rate: float = 21,
    valid_from: str | None = None,
    valid_to: str | None = None,
    parent: str | None = None,
    active: int = 1,
    deleted: int = 0,
) -> None:
    """A row the way it sits in a hub that saved it BEFORE taxes#66: straight into the table."""
    execute(
        "INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct,"
        " tax_type, operation_class, exempt_reason, regime_key, parent_id, component_label,"
        " valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)"
        " VALUES ("
        + ",".join(
            literal(v)
            for v in (
                rule_id,
                hub,
                country,
                region,
                category,
                rate,
                "surcharge" if parent else "vat",
                "subject",
                None,
                None,
                parent,
                "RE" if parent else None,
                valid_from,
                valid_to,
                active,
                deleted,
                USER,
                USER,
                SEEDED_AT,
                SEEDED_AT,
            )
        )
        + ")"
    )


# ── the runtime, only the parts under test ───────────────────────────────────────────────────


def list_page(hub: str = HUB, **params) -> dict[str, dict]:
    """`taxes.rules.list` as the runtime runs it (`crates/runtime/src/queries.rs`), keyed by id."""
    base = (MODULE_DIR / MANIFEST["queries"][QUERY]["sql"]).read_text(encoding="utf-8")
    base = base.strip().rstrip(";").rstrip()
    filters = {k[2:]: v for k, v in params.items() if k.startswith("f_")}
    conds = []
    declared = (MANIFEST["queries"][QUERY].get("list") or {}).get("filters") or {}
    for col in filters:
        if not IDENT.match(col) or (declared.get(col) or {}).get("op") != "eq":
            raise RuntimeError(
                f"`{QUERY}` declares no `eq` filter for `{col}`: the runtime would drop it (hub#1182)"
            )
        conds.append(f"CAST(sub.{col} AS TEXT) = CAST(:f_{col} AS TEXT)")
    where = f" WHERE {' AND '.join(conds)}" if conds else ""
    sql = f"SELECT sub.*, COUNT(*) OVER() AS _total FROM ( {base} ) AS sub{where} ORDER BY sub.id ASC"
    return {
        str(r["id"]): r
        for r in rows(bind(sql, {"hub_id": hub, "current_user_id": USER, **params}))
    }


_clock = [0]


def command(name: str, hub: str = HUB, **payload) -> str:
    """Runs the statements of command `name` in ONE transaction, as the dispatcher does.

    Returns `ok`, the `expect_rows` error, or the code `on_unique` gives the violated index."""
    cmd = MANIFEST["commands"][name]
    _clock[0] += 1
    bound = {
        **payload,
        "hub_id": hub,
        "current_user_id": USER,
        "now": f"2026-09-26T12:00:{_clock[0]:02d}Z",
    }
    body = [
        bind(strip_comments((MODULE_DIR / f).read_text(encoding="utf-8")), bound)
        .strip()
        .rstrip(";")
        for f in cmd["sql"]
    ]
    script = "BEGIN;\n" + ";\n".join(body) + ";\n"
    dry = psql_raw(["-q", "-v", "QUIET=0"], db=DB, stdin=script + "ROLLBACK;\n")
    if dry.returncode != 0:
        match = UNIQUE.search(dry.stderr)
        if not match:
            raise RuntimeError(
                f"`{name}` failed outside any gate: {dry.stderr.strip()}"
            )
        return (cmd.get("on_unique") or {}).get(match.group(1), f"db:{match.group(1)}")
    counts = [
        int(next(g for g in t.groups() if g is not None))
        for t in (TAG.match(l.strip()) for l in dry.stdout.splitlines())
        if t
    ]
    expect = cmd.get("expect_rows")
    if expect:
        anchor = expect.get("statement")
        affected = counts[cmd["sql"].index(anchor)] if anchor else sum(counts)
        if affected < expect["n"]:
            return expect["error"]
    psql([], db=DB, stdin=script + "COMMIT;\n")
    return "ok"


def flags(page: dict[str, dict]) -> dict[str, int]:
    missing = [rid for rid, r in page.items() if "overlaps" not in r]
    if missing:
        raise RuntimeError(
            f"`{QUERY}` returns no `overlaps` column (rows {missing[:3]})"
        )
    return {rid: int(r["overlaps"]) for rid, r in page.items()}


# ── the scenario ─────────────────────────────────────────────────────────────────────────────


def run() -> None:
    # The pair the issue describes: 21 % open-ended since forever and, on top of it, 23 % from 2027.
    seed("es-old", rate=21)
    seed("es-new", rate=23, valid_from="2027-01-01")
    # Contiguous ranges are the LEGAL way to change a rate: never flagged.
    seed("pt-old", country="PT", rate=23, valid_to="2026-12-31")
    seed("pt-new", country="PT", rate=24, valid_from="2027-01-01")
    # Inclusive bounds: ending on the day the next one starts IS an overlap (both in force that day).
    seed(
        "fr-old", country="FR", rate=20, valid_from="2026-01-01", valid_to="2026-12-31"
    )
    seed("fr-new", country="FR", rate=21, valid_from="2026-12-31")
    # An open start (NULL) and an open end stored as '' against a bounded range inside them: the
    # open side has no date to compare, so it is the «open» branch that has to catch it. ('' as a
    # START would slip through by text order — '' sorts first —, '' as an END would not.)
    seed("gr-open", country="GR", rate=24, valid_from=None, valid_to="")
    seed("gr-bounded", country="GR", rate=13, valid_from="2026-01-01", valid_to="2026-06-30")
    # Region: empty and NULL both mean «the whole country», so they share the slot…
    seed("it-null", country="IT", region=None, rate=22)
    seed("it-empty", country="IT", region="", rate=23, valid_from="2026-06-01")
    # …and a region is a slot of its own, next to the whole-country rule.
    seed("es-canarias", region="ES-CN", rate=7)
    # Another category of the same country is another slot.
    seed("es-reduced", category=OTHER_CATEGORY, rate=10)
    # An archived rule and a deleted one are not in force: they overlap nothing.
    seed("de-live", country="DE", rate=19)
    seed("de-archived", country="DE", rate=16, valid_from="2026-01-01", active=0)
    seed("de-deleted", country="DE", rate=7, valid_from="2026-02-01", deleted=1)
    # A component shares its root's slot BY DESIGN (taxes#9): neither is flagged for it.
    seed("nl-root", country="NL", rate=21)
    seed("nl-comp", country="NL", rate=5.2, parent="nl-root")
    # Tenancy: the hub next door has an overlapping twin in the same slot as `be-live`.
    seed("be-live", country="BE", rate=21)
    seed("be-next-door", hub=OTHER_HUB, country="BE", rate=6, valid_from="2026-01-01")
    seed(
        "be-next-door-2", hub=OTHER_HUB, country="BE", rate=12, valid_from="2026-03-01"
    )

    print(
        "\nThe list says which active root rules overlap another one (and nothing else):"
    )
    got = flags(list_page())
    expected = {
        "es-old": 1,
        "es-new": 1,
        "pt-old": 0,
        "pt-new": 0,
        "fr-old": 1,
        "fr-new": 1,
        "gr-open": 1,
        "gr-bounded": 1,
        "it-null": 1,
        "it-empty": 1,
        "es-canarias": 0,
        "es-reduced": 0,
        "de-live": 0,
        "nl-root": 0,
        "nl-comp": 0,
        "be-live": 0,
    }
    for rid, flag in expected.items():
        check(f"overlaps[{rid}]", flag, got.get(rid))
    check(
        "archived and deleted rules are not in the default list",
        [],
        [r for r in ("de-archived", "de-deleted") if r in got],
    )

    print("\nAn archived rule, shown with include_archived, is not flagged either:")
    archived = flags(list_page(include_archived=1))
    check("overlaps[de-archived]", 0, archived.get("de-archived"))
    check("overlaps[de-live] with archived in view", 0, archived.get("de-live"))

    print("\nTenancy: the other hub's pair is flagged THERE, and never leaks here:")
    theirs = flags(list_page(hub=OTHER_HUB))
    check(
        "the other hub sees only its rows",
        ["be-next-door", "be-next-door-2"],
        sorted(theirs),
    )
    check("overlaps[be-next-door] in its own hub", 1, theirs.get("be-next-door"))

    print("\nThe assistant (and the screen) can filter by it:")
    only = list_page(f_overlaps=1)
    check(
        "f_overlaps=1 returns exactly the overlapping rules",
        sorted(["es-old", "es-new", "fr-old", "fr-new", "gr-open", "gr-bounded", "it-null", "it-empty"]),
        sorted(only),
    )

    print("\nThe ways out that already exist clear the flag:")
    check(
        "end es-old the day before es-new starts",
        "ok",
        command("taxes.rules.end", rule_id="es-old", valid_to="2026-12-31"),
    )
    after_end = flags(list_page())
    check("overlaps[es-old] after the end date", 0, after_end.get("es-old"))
    check("overlaps[es-new] after the end date", 0, after_end.get("es-new"))
    check(
        "deactivate fr-new", "ok", command("taxes.rules.deactivate", rule_id="fr-new")
    )
    check(
        "overlaps[fr-old] once its twin is deactivated",
        0,
        flags(list_page()).get("fr-old"),
    )
    # Ending a rule on a day that still runs into its twin is refused by the #66 guard — the flag
    # does not invite a fix the server would reject.
    check(
        "ending it-null on a day still inside it-empty's range is refused",
        "taxes.rule_overlaps",
        command("taxes.rules.end", rule_id="it-null", valid_to="2026-06-30"),
    )
    check("…and it-null stays flagged", 1, flags(list_page()).get("it-null"))


def contract() -> None:
    print(
        "\nThe manifest declares the filter and tells the assistant what the flag means:"
    )
    q = MANIFEST["queries"][QUERY]
    check(
        "list.filters.overlaps.op",
        "eq",
        ((q.get("list") or {}).get("filters") or {}).get("overlaps", {}).get("op"),
    )
    ai = (q.get("ai") or {}).get("description", "")
    check("ai description mentions `overlaps`", True, "overlaps" in ai)
    sql = (MODULE_DIR / q["sql"]).read_text(encoding="utf-8")
    binds = sorted(set(PARAM.findall(strip_comments(sql))))
    # A shared query: other batteries (and `sales`/`inventory`) bind only these. A new mandatory
    # bind would break every one of them.
    check(
        "rules_list.sql binds nothing new",
        ["current_user_id", "hub_id", "include_archived"],
        binds,
    )


def main() -> int:
    if not container_available():
        print(f"FAIL — Postgres container `{CONTAINER}` not available (docker).")
        print(
            "       This battery does not degrade to a skip: an untested flag is the bug."
        )
        return 1
    create_db()
    try:
        contract()
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
        "PASS — rules that already overlapped are flagged by `taxes.rules.list` and cleared by end/deactivate"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
