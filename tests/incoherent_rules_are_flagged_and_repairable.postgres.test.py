#!/usr/bin/env python3
"""A rule saved with a rate on a class that charges no tax is FLAGGED, and the owner can repair it
(taxes#63, out of taxes#59).

WHY. taxes#62 closed the door for NEW rules: `rule_create.sql` refuses an exempt / not-subject /
reverse-charge rule with `rate_pct > 0`, and a component with a rate under such a root. But the rows
saved BEFORE that guard are still in `taxes_rule`, and `sales` keeps resolving them: the till charges
the rate, and since invoice#83 the invoice refuses to seal the sale (`invoice.quota_on_non_subject_class`).
The sale is left charged, without invoice and without a record for the AEAT — and the owner had no
way to see which rule was guilty, nor to fix it: there is no `rules.update`, and the natural key
(`ix_tax_rule_root_natural`, deactivated rows included) does not even let a twin at 0 % be created
next to the bad one.

No data migration touches those rows (a blind rewrite of a business's fiscal setup is exactly what
taxes#62 refused to do). Instead:

1. `taxes.rules.list` exposes `is_incoherent` (1/0) — the screen marks the row and the assistant can
   filter by it (`f_is_incoherent=1`).
2. `taxes.rules.repair` fixes ONE rule, chosen by the owner, in one of the two ways the mistake can
   be read:
   - `no_tax` (the default): the class was right, the rate was the mistake → the rate goes to 0;
     on a root it also clears the rates of its components (a surcharge under a tax-free root is the
     same mistake one level down).
   - `charge_tax`: the rate was right, the class was the mistake → the class goes to `subject` (and
     the exemption reason is dropped), the rate stays.
   It refuses (0 rows → `expect_rows` → `taxes.rule_not_incoherent`) a rule that is coherent, of
   another hub, or deleted: a repair that «succeeds» on nothing would hide a wrong id.

This battery runs the module's OWN files (the query through the list engine's wrapper, the command's
statement), binds substituted the way the runtime's driver binds them (an omitted `:name` is NULL),
against a real Postgres with the module's own migrations. The rows are seeded with a plain INSERT on
purpose: they are the rows the guard never saw.

Usage: tests/incoherent_rules_are_flagged_and_repairable.postgres.test.py   (exit 0 = green)
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
REPAIR = "taxes.rules.repair"
HUB = "hub-under-test"
OTHER_HUB = "hub-next-door"
USER = "u-owner"
NOW = "2026-09-23T10:00:00Z"
LATER = "2026-09-23T11:00:00Z"
CATEGORY = "product.generic"

PARAM = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)", re.IGNORECASE)
IDENT = re.compile(r"^[a-z_][a-z0-9_]*$")
DB = f"taxes_incoherent_{os.getpid()}_{uuid.uuid4().hex[:6]}"

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
        psql(
            [],
            db=DB,
            stdin=(
                "INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active,"
                " is_deleted, created_by, updated_by, created_at, updated_at) VALUES ("
                + ",".join(
                    literal(v)
                    for v in (
                        f"{hub}|taxcat|{CATEGORY}",
                        hub,
                        CATEGORY,
                        "Standard",
                        "",
                        0,
                        1,
                        0,
                        USER,
                        USER,
                        NOW,
                        NOW,
                    )
                )
                + ");"
            ),
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


def bind(sql: str, params: dict) -> str:
    return PARAM.sub(lambda m: literal(params.get(m.group(1))), sql)


def seed(
    rule_id: str,
    rate: float,
    cls: str = "subject",
    *,
    hub: str = HUB,
    parent: str | None = None,
    valid_from: str | None = None,
    exempt_reason: str | None = None,
    active: int = 1,
    deleted: int = 0,
) -> None:
    """A row the way it sits in a hub that saved it BEFORE taxes#62: straight into the table."""
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
                "ES",
                None,
                CATEGORY,
                rate,
                "surcharge" if parent else "vat",
                cls,
                exempt_reason,
                None,
                parent,
                "RE" if parent else None,
                valid_from,
                None,
                active,
                deleted,
                USER,
                USER,
                NOW,
                NOW,
            )
        )
        + ")"
    )


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


def repair(rule_id: str, hub: str = HUB, **payload) -> int:
    """`taxes.rules.repair` as the runtime runs it: the module's own statement, bound."""
    cmd = MANIFEST["commands"].get(REPAIR)
    if not cmd:
        raise RuntimeError(f"`{REPAIR}` is not declared in module.json")
    sql = (MODULE_DIR / cmd["sql"][0]).read_text(encoding="utf-8")
    return execute(
        bind(
            sql,
            {
                "rule_id": rule_id,
                "hub_id": hub,
                "current_user_id": USER,
                "now": LATER,
                **payload,
            },
        )
    )


def stored(rule_id: str) -> dict:
    found = rows(
        "SELECT ROUND(rate_pct::numeric, 4)::float AS rate, operation_class AS cls, exempt_reason, is_active, updated_at"
        f" FROM taxes_rule WHERE id = {literal(rule_id)}"
    )
    return found[0] if found else {}


def flag(page: dict[str, dict], rule_id: str):
    row = page.get(rule_id)
    return None if row is None else int(row["is_incoherent"])


def run() -> None:
    # One family per validity date, so the root natural key never collides.
    seed("ok-root", 21, valid_from="2026-01-01")
    seed("ok-comp", 5.2, parent="ok-root")
    seed("bad-exempt", 21, "exempt", valid_from="2026-02-01", exempt_reason="E1")
    seed("bad-exempt-comp", 5.2, parent="bad-exempt")
    seed("zero-exempt", 0, "exempt", valid_from="2026-03-01", exempt_reason="E1")
    seed("zero-exempt-comp", 1.4, parent="zero-exempt")
    seed(
        "bad-not-subject",
        10,
        "not_subject",
        valid_from="2026-04-01",
        exempt_reason="E2",
    )
    seed("bad-reverse", 21, "subject_reverse", valid_from="2026-05-01")
    seed("bad-archived", 21, "not_subject_location", valid_from="2026-06-01", active=0)
    seed("bad-deleted", 21, "exempt", valid_from="2026-07-01", deleted=1)
    seed("foreign-bad", 21, "exempt", hub=OTHER_HUB, valid_from="2026-02-01")
    # A root that lives in ANOTHER hub, and a component here that names its id: the neighbour's
    # classification must never leak into this hub's answer (every JOIN carries the hub_id, pm#89).
    seed("foreign-exempt-root", 0, "exempt", hub=OTHER_HUB, valid_from="2026-09-01")
    seed("orphan-comp", 5.2, parent="foreign-exempt-root")

    print("\nThe list says which rules are incoherent:")
    page = list_page(include_archived=1)
    check("subject root 21 % (control)", 0, flag(page, "ok-root"))
    check("surcharge 5.2 % under a subject root (control)", 0, flag(page, "ok-comp"))
    check("exempt root 21 %", 1, flag(page, "bad-exempt"))
    check(
        "surcharge 5.2 % under the exempt 21 % root", 1, flag(page, "bad-exempt-comp")
    )
    check("exempt root at 0 % (coherent)", 0, flag(page, "zero-exempt"))
    check(
        "surcharge 1.4 % under the exempt 0 % root", 1, flag(page, "zero-exempt-comp")
    )
    check("not-subject root 10 %", 1, flag(page, "bad-not-subject"))
    check("reverse-charge root 21 %", 1, flag(page, "bad-reverse"))
    check(
        "deactivated not-subject-location 21 % (still flagged once shown)",
        1,
        flag(page, "bad-archived"),
    )
    check("the neighbour's rule never shows up", None, flag(page, "foreign-bad"))
    check(
        "a component naming the neighbour's tax-free root is judged by THIS hub only",
        0,
        flag(page, "orphan-comp"),
    )

    print("\nThe flag is a filter the assistant can ask for:")
    only_bad = list_page(f_is_incoherent="1")
    check(
        "active incoherent rules",
        [
            "bad-exempt",
            "bad-exempt-comp",
            "bad-not-subject",
            "bad-reverse",
            "zero-exempt-comp",
        ],
        sorted(only_bad),
    )

    print("\nA repair on something that is fine is refused, never a silent success:")
    check("repair of a coherent root", 0, repair("ok-root"))
    check("repair of a coherent component", 0, repair("ok-comp"))
    check("repair of a coherent exempt 0 % root", 0, repair("zero-exempt"))
    check("repair of a deleted rule", 0, repair("bad-deleted"))
    check("repair of the neighbour's rule from this hub", 0, repair("foreign-bad"))
    check(
        "the neighbour's rule keeps its rate", 21.0, stored("foreign-bad").get("rate")
    )
    check("repair of an unknown id", 0, repair("does-not-exist"))
    check("repair of that orphan component is refused too", 0, repair("orphan-comp"))
    check("the coherent root keeps its rate", 21.0, stored("ok-root").get("rate"))
    check("the coherent component keeps its rate", 5.2, stored("ok-comp").get("rate"))

    print(
        "\n`no_tax` (the default): the class was right, the rate goes to 0 — the root AND its components:"
    )
    check(
        "repair of the exempt 21 % root touches root + component",
        2,
        repair("bad-exempt"),
    )
    root, comp = stored("bad-exempt"), stored("bad-exempt-comp")
    check("root rate", 0.0, root.get("rate"))
    check("root class kept", "exempt", root.get("cls"))
    check("root exemption reason kept", "E1", root.get("exempt_reason"))
    check("root stays active", 1, root.get("is_active"))
    check("root carries the repair's timestamp", LATER, root.get("updated_at"))
    check("component rate", 0.0, comp.get("rate"))
    check(
        "the other family's component is untouched", 5.2, stored("ok-comp").get("rate")
    )
    check(
        "the other family's surcharge under the exempt 0 % root is untouched",
        1.4,
        stored("zero-exempt-comp").get("rate"),
    )
    page = list_page()
    check("the repaired root is no longer flagged", 0, flag(page, "bad-exempt"))
    check("its component is no longer flagged", 0, flag(page, "bad-exempt-comp"))
    check("repairing it twice is refused", 0, repair("bad-exempt"))

    print("\nA component under a tax-free root is repaired on its own:")
    check(
        "explicit no_tax on the surcharge under the exempt 0 % root",
        1,
        repair("zero-exempt-comp", mode="no_tax"),
    )
    check("its rate", 0.0, stored("zero-exempt-comp").get("rate"))
    check(
        "the root it hangs from is untouched",
        "exempt",
        stored("zero-exempt").get("cls"),
    )

    print("\n`charge_tax`: the rate was right, the class goes to subject:")
    check(
        "charge_tax on the not-subject 10 % root",
        1,
        repair("bad-not-subject", mode="charge_tax"),
    )
    ns = stored("bad-not-subject")
    check("rate kept", 10.0, ns.get("rate"))
    check("class is subject", "subject", ns.get("cls"))
    check("exemption reason dropped", None, ns.get("exempt_reason"))
    check("no longer flagged", 0, flag(list_page(), "bad-not-subject"))

    print("\n`charge_tax` cannot fix a subject component whose ROOT is the problem:")
    seed("zero-exempt-2", 0, "exempt", valid_from="2026-08-01")
    seed("zero-exempt-2-comp", 1.4, parent="zero-exempt-2")
    check(
        "charge_tax on that component is refused",
        0,
        repair("zero-exempt-2-comp", mode="charge_tax"),
    )
    check("its rate is untouched", 1.4, stored("zero-exempt-2-comp").get("rate"))

    print("\nA deactivated incoherent rule can be repaired before it is brought back:")
    check("no_tax on the deactivated rule", 1, repair("bad-archived"))
    archived = stored("bad-archived")
    check("its rate", 0.0, archived.get("rate"))
    check(
        "it stays deactivated (repair is not reactivation)",
        0,
        archived.get("is_active"),
    )

    print("\nThe command's refusal is a named error, not a silent success:")
    gate = (MANIFEST["commands"].get(REPAIR) or {}).get("expect_rows") or {}
    check("expect_rows op", "min", gate.get("op"))
    check("expect_rows n", 1, gate.get("n"))
    check("expect_rows error", "taxes.rule_not_incoherent", gate.get("error"))


def main() -> int:
    if not container_available():
        print(f"FAIL — Postgres container `{CONTAINER}` not available (docker).")
        print(
            "       This battery does not degrade to a skip: an untested repair is the bug."
        )
        return 1
    create_db()
    try:
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
        "PASS — incoherent rules are flagged by `taxes.rules.list` and repaired by `taxes.rules.repair`"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
