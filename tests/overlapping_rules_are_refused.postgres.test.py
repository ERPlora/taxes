#!/usr/bin/env python3
"""Two ACTIVE rules for the same slot can never be in force on the same day (taxes#66).

A slot is what the resolver keys on: the hub, the country, the region (empty = whole country) and
the tax category. Until taxes#66 nothing stopped the owner from saving «PT · general 23 %» with no
end date and, on top of it, «PT · general 25 % from 2027-01-01»: from that day on two rules were
valid for the same thing, the screen listed both as in force, and which one the till charged was
decided by a tie-break the owner never sees (`erplora_guest_sdk::tax`: newest `valid_from` wins).

The market does not allow it either. Oracle E-Business Tax refuses a tax-rate period that overlaps
another one of the same rate code, Dynamics 365 refuses overlapping value intervals on a sales tax
code, and SAP never leaves two condition records valid at once for the same key. The refusal lives
in the COMMAND — the screen is only one caller; the API, the assistant and the bulk import are the
others — and it carries its own code, `taxes.rule_overlaps`, so the screen can put it on the date
field instead of a generic «could not be created».

What this battery holds down, running each command's statements the way the dispatcher does (one
transaction, `expect_rows` evaluated, a unique violation renamed through the command's `on_unique`,
hub#2081):

1. **The case of the issue is refused**: an open-ended rule plus a later one in the same slot.
2. **A range inside another one is refused**, and so is one starting the same day.
3. **Contiguous ranges are allowed** — one ends 2026-12-31, the next starts 2027-01-01. That is the
   legal way to change a rate, and a guard that refused it would make the change impossible.
4. **Other slots are not overlaps**: another category, another region, a component hanging from
   the root (the recargo de equivalencia shares the slot BY DESIGN).
5. **A deactivated rule does not count** — and reactivating it while another one covers its dates
   is refused with the same code (`taxes.rules.activate` is the second door).
6. **The bulk door is closed too** (`taxes.rules.bulk_create` → `taxes._insert_rule`).
7. **Tenancy**: the same rule in the hub next door is not an overlap, and the hub next door can
   still save its own.
8. **Legacy overlaps are not touched**: rows that already overlap before the guard stay as they are
   (nothing is deleted), and they do not block unrelated writes.
9. **The migration reverses**: dropping the gate table and applying it again leaves the guard
   working.
10. **The refusal speaks**: the code is declared in `errors` and translated in `en` and `es`, and
    the module asks for a core that knows `on_unique`.

Usage: tests/overlapping_rules_are_refused.postgres.test.py  (exit 0 = green)
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

CODE = "taxes.rule_overlaps"
# The end date the owner gave is before the rule's own start, or the rule is not of this hub.
END_INVALID = "taxes.rule_end_invalid"
HUB = "hub-under-test"
OTHER_HUB = "hub-next-door"
USER = "u-owner"
# First core that renames a unique violation through `on_unique` (hub#2081, merged 2026-09-25 as
# hub#2092). No tag up to v1.1.29 (2026-09-19) carries it, and those cores REFUSE a manifest with an
# unknown command field, so the floor is the first release cut after it: v1.1.30.
ON_UNIQUE_CORE = (1, 1, 30)

PARAM = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)", re.IGNORECASE)
UNIQUE = re.compile(r'violates unique constraint "([^"]+)"')
# A SELECT statement (the per-hub write lock of taxes#69) prints no tag, only its row footer; the
# dispatcher counts it as the rows it returned, as sqlx's `rows_affected` does.
TAG = re.compile(r"^(?:INSERT \d+ (\d+)|UPDATE (\d+)|DELETE (\d+)|\((\d+) rows?\))$")

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

DB = f"taxes_overlap_{os.getpid()}_{uuid.uuid4().hex[:6]}"


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


def migration_files() -> list[str]:
    return [
        m if isinstance(m, str) else m["file"]
        for m in MANIFEST["migrations"]["postgres"]
    ]


def create_db() -> None:
    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    for rel in migration_files():
        psql([], db=DB, stdin=(MODULE_DIR / rel).read_text(encoding="utf-8"))


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


# ── the dispatcher, only the part under test ─────────────────────────────────────────────────


def strip_comments(sql: str) -> str:
    return "\n".join(
        line for line in sql.splitlines() if not line.strip().startswith("--")
    )


def bind(sql: str, params: dict) -> str:
    """One pass over the `:name` placeholders; an omitted param binds NULL, as the driver does."""
    return PARAM.sub(lambda m: literal(params.get(m.group(1))), sql)


_clock = [0]
_ids = [0]


def tick() -> str:
    """A fresh `:now` per command, as the runtime binds it: a guard pinned to «the rows THIS
    command wrote» must not be fooled by a shared timestamp."""
    _clock[0] += 1
    return f"2026-09-26T10:{_clock[0] // 60:02d}:{_clock[0] % 60:02d}Z"


def fresh_id() -> str:
    _ids[0] += 1
    return f"rule-{_ids[0]:03d}"


def run(
    statements_of: str, params: dict, hub: str, renamed_by: str | None = None
) -> str:
    """Runs the statements of command `statements_of` in ONE transaction, as the dispatcher does.

    Returns `ok`, the `expect_rows` error, or the code `on_unique` of `renamed_by` (defaults to the
    same command) gives the violated index. Anything else is a failure of the battery itself."""
    cmd = MANIFEST["commands"][statements_of]
    bound = {**params, "hub_id": hub, "current_user_id": USER, "now": tick()}
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
                f"`{statements_of}` failed outside any gate: {dry.stderr.strip()}"
            )
        mapping = (
            MANIFEST["commands"][renamed_by or statements_of].get("on_unique") or {}
        )
        return mapping.get(match.group(1), f"db:{match.group(1)}")
    counts = []
    for line in dry.stdout.splitlines():
        tag = TAG.match(line.strip())
        if tag:
            counts.append(int(next(g for g in tag.groups() if g is not None)))
    if len(counts) != len(body):
        raise RuntimeError(
            f"expected {len(body)} command tags from psql, got {dry.stdout!r}"
        )
    expect = cmd.get("expect_rows")
    if expect:
        anchor = expect.get("statement")
        affected = counts[cmd["sql"].index(anchor)] if anchor else sum(counts)
        if affected < expect["n"]:
            return expect["error"]
    psql([], db=DB, stdin=script + "COMMIT;\n")
    return "ok"


def create(hub: str = HUB, **payload) -> tuple[str, str]:
    rule_id = fresh_id()
    return run("taxes.rules.create", {"new_id": rule_id, **payload}, hub), rule_id


def bulk_insert(hub: str = HUB, **payload) -> str:
    """One row of `taxes.rules.bulk_create`: the handler emits a `taxes._insert_rule` operation."""
    return run(
        "taxes._insert_rule",
        {"id": fresh_id(), **payload},
        hub,
        renamed_by="taxes.rules.bulk_create",
    )


def deactivate(rule_id: str, hub: str = HUB) -> None:
    run("taxes.rules.deactivate", {"rule_id": rule_id}, hub)


def activate(rule_id: str, hub: str = HUB) -> str:
    return run("taxes.rules.activate", {"rule_id": rule_id}, hub)


def end(rule_id: str, valid_to: str, hub: str = HUB) -> str:
    return run("taxes.rules.end", {"rule_id": rule_id, "valid_to": valid_to}, hub)


def count(hub: str = HUB) -> int:
    return len(
        rows(
            f"SELECT id FROM taxes_rule WHERE hub_id = {literal(hub)} AND is_deleted = 0"
        )
    )


# ── seed ─────────────────────────────────────────────────────────────────────────────────────

CATEGORIES = ("general", "reduced", "legacy")


def seed() -> None:
    values = []
    for hub in (HUB, OTHER_HUB):
        for key in CATEGORIES:
            values.append(
                "("
                + ",".join(
                    literal(v)
                    for v in (
                        f"{hub}|{key}",
                        hub,
                        key,
                        key,
                        "",
                        0,
                        1,
                        0,
                        "system",
                        "system",
                        "2026-01-01T00:00:00Z",
                        "2026-01-01T00:00:00Z",
                    )
                )
                + ")"
            )
    psql(
        [],
        db=DB,
        stdin="INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active,"
        " is_deleted, created_by, updated_by, created_at, updated_at) VALUES "
        + ",".join(values)
        + ";\n",
    )
    # Two rules that ALREADY overlap, saved before the guard existed. They must survive untouched.
    legacy = []
    # Plus one DELETED rule: a row that is no longer a rule must never count as an overlap.
    for rule_id, rate, valid_from, country, key, is_deleted in (
        ("legacy-a", 21, "2020-01-01", "ES", "legacy", 0),
        ("legacy-b", 22, "2024-01-01", "ES", "legacy", 0),
        ("deleted-lu", 15, "2000-01-01", "LU", "general", 1),
    ):
        legacy.append(
            "("
            + ",".join(
                literal(v)
                for v in (
                    rule_id,
                    HUB,
                    country,
                    None,
                    key,
                    rate,
                    "vat",
                    valid_from,
                    None,
                    1,
                    is_deleted,
                    "2026-01-01T00:00:00Z",
                    "2026-01-01T00:00:00Z",
                )
            )
            + ")"
        )
    psql(
        [],
        db=DB,
        stdin="INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct,"
        " tax_type, valid_from, valid_to, is_active, is_deleted, created_at, updated_at) VALUES "
        + ",".join(legacy)
        + ";\n",
    )


# ── the story ────────────────────────────────────────────────────────────────────────────────


def scenario() -> None:
    print(
        "\nThe case of the issue (taxes#66): an open rule, then a later one in the same slot:"
    )
    got, pt_23 = create(
        country_code="PT",
        tax_category_key="general",
        rate_pct=23,
        valid_from="2020-01-01",
    )
    check("PT · general 23 % with no end date is saved", "ok", got)
    before = count()
    got, _ = create(
        country_code="PT",
        tax_category_key="general",
        rate_pct=25,
        valid_from="2027-01-01",
    )
    check("PT · general 25 % from 2027-01-01 is REFUSED as an overlap", CODE, got)
    check("and nothing was written", before, count())
    got, _ = create(
        country_code="PT",
        tax_category_key="general",
        rate_pct=25,
        valid_from="2020-01-01",
    )
    check("a second rule starting the SAME day is the same overlap", CODE, got)
    got, _ = create(
        country_code="PT",
        tax_category_key="general",
        rate_pct=25,
        valid_to="2019-12-31",
    )
    check(
        "a rule with no start that runs up to the day before is contiguous, and saved",
        "ok",
        got,
    )
    got, _ = create(
        country_code="PT",
        tax_category_key="general",
        rate_pct=25,
        valid_from="2019-12-31",
        valid_to="2020-01-01",
    )
    check("a rule running ONE day into the open one is refused", CODE, got)

    print(
        "\nClosed ranges: inside is refused, contiguous is the legal way to change a rate:"
    )
    got, _ = create(
        country_code="PT",
        tax_category_key="reduced",
        rate_pct=13,
        valid_from="2020-01-01",
        valid_to="2026-12-31",
    )
    check("PT · reduced 13 % until 2026-12-31", "ok", got)
    got, _ = create(
        country_code="PT",
        tax_category_key="reduced",
        rate_pct=15,
        valid_from="2027-01-01",
    )
    check("PT · reduced 15 % from 2027-01-01 (the next day) is saved", "ok", got)
    got, _ = create(
        country_code="PT",
        tax_category_key="reduced",
        rate_pct=6,
        valid_from="2026-06-01",
        valid_to="2026-06-30",
    )
    check("a month inside the 13 % range is refused", CODE, got)
    got, _ = create(
        country_code="PT",
        tax_category_key="reduced",
        rate_pct=6,
        valid_from="2026-12-31",
        valid_to="2026-12-31",
    )
    check(
        "the single last day of the 13 % range is refused (ends are inclusive)",
        CODE,
        got,
    )

    print("\nOther slots are not overlaps:")
    got, _ = create(
        country_code="PT",
        region_code="PT-20",
        tax_category_key="general",
        rate_pct=16,
        valid_from="2020-01-01",
    )
    check("the Azores (a region) next to the whole-country rule", "ok", got)
    got, _ = create(
        country_code="ES",
        tax_category_key="general",
        rate_pct=21,
        valid_from="2020-01-01",
    )
    check("another country", "ok", got)
    got, _ = create(
        country_code="PT",
        tax_category_key="general",
        rate_pct=5.2,
        valid_from="2020-01-01",
        parent_id=pt_23,
        component_label="RE",
    )
    check("a component hanging from the 23 % root shares its slot by design", "ok", got)

    print(
        "\nA deactivated rule does not count — and cannot come back on top of another one:"
    )
    got, fr_old = create(
        country_code="FR",
        tax_category_key="general",
        rate_pct=19.6,
        valid_from="2000-01-01",
    )
    check("FR · general 19.6 % open", "ok", got)
    deactivate(fr_old)
    got, _ = create(
        country_code="FR",
        tax_category_key="general",
        rate_pct=20,
        valid_from="2014-01-01",
    )
    check("with it deactivated, FR · general 20 % is saved", "ok", got)
    check(
        "reactivating the 19.6 % on top of the 20 % is refused", CODE, activate(fr_old)
    )
    check(
        "and it stays deactivated",
        [0],
        [
            r["is_active"]
            for r in rows(
                f"SELECT is_active FROM taxes_rule WHERE id = {literal(fr_old)}"
            )
        ],
    )
    got, it_old = create(
        country_code="IT",
        tax_category_key="general",
        rate_pct=21,
        valid_from="2000-01-01",
        valid_to="2013-09-30",
    )
    deactivate(it_old)
    check(
        "reactivating a rule nothing else covers is still allowed",
        "ok",
        activate(it_old),
    )

    print("\nEdges seen from the other side, and rows that are not rules any more:")
    got, _ = create(
        country_code="GR",
        tax_category_key="general",
        rate_pct=24,
        valid_from="2027-01-01",
    )
    check("GR · general 24 % from 2027-01-01", "ok", got)
    got, _ = create(
        country_code="GR",
        tax_category_key="general",
        rate_pct=23,
        valid_from="2026-06-01",
        valid_to="2027-01-01",
    )
    check(
        "a new rule ENDING the very day the existing one starts is refused (inclusive)",
        CODE,
        got,
    )
    got, _ = create(
        country_code="NL",
        tax_category_key="general",
        rate_pct=19,
        valid_to="2026-12-31",
    )
    check("NL · general 19 % with no start, until 2026-12-31", "ok", got)
    got, _ = create(
        country_code="NL",
        tax_category_key="general",
        rate_pct=21,
        valid_from="2026-06-01",
        valid_to="2026-08-31",
    )
    check("a closed summer inside the no-start rule is refused", CODE, got)
    got, be_old = create(
        country_code="BE",
        tax_category_key="general",
        rate_pct=19,
        valid_from="2000-01-01",
        valid_to="2013-12-31",
    )
    check("BE · general 19 % until 2013-12-31", "ok", got)
    got, _ = create(
        country_code="BE",
        tax_category_key="general",
        rate_pct=1,
        parent_id=be_old,
        component_label="RE",
    )
    check("with a dateless component hanging from it", "ok", got)
    got, _ = create(
        country_code="BE",
        tax_category_key="general",
        rate_pct=21,
        valid_from="2014-01-01",
    )
    check(
        "the next BE root is saved: another root's component is not a competing rule",
        "ok",
        got,
    )
    got, _ = create(
        country_code="LU",
        tax_category_key="general",
        rate_pct=17,
        valid_from="2015-01-01",
    )
    check(
        "LU · general 17 % is saved over a DELETED rule of the same slot",
        "ok",
        got,
    )

    print(
        "\nScheduling a rate change: end the rule in force, then add the next one (`taxes.rules.end`):"
    )
    got, at_old = create(
        country_code="AT",
        tax_category_key="general",
        rate_pct=20,
        valid_from="2016-01-01",
    )
    check("AT · general 20 % open since 2016", "ok", got)
    got, _ = create(
        country_code="AT",
        tax_category_key="general",
        rate_pct=22,
        valid_from="2027-01-01",
    )
    check("AT · general 22 % from 2027 is refused while the 20 % is open", CODE, got)
    check(
        "the 20 % is ended on 2026-12-31",
        "ok",
        end(at_old, "2026-12-31"),
    )
    check(
        "and its end date is stored",
        ["2026-12-31"],
        [
            r["valid_to"]
            for r in rows(
                f"SELECT valid_to FROM taxes_rule WHERE id = {literal(at_old)}"
            )
        ],
    )
    got, _ = create(
        country_code="AT",
        tax_category_key="general",
        rate_pct=22,
        valid_from="2027-01-01",
    )
    check(
        "now AT · general 22 % from 2027-01-01 is saved: the change is scheduled",
        "ok",
        got,
    )
    check(
        "pushing the 20 % end into the 22 % range is refused as an overlap",
        CODE,
        end(at_old, "2027-06-30"),
    )
    check(
        "an end date before the rule's own start is refused",
        END_INVALID,
        end(at_old, "2015-12-31"),
    )
    got, one_day = create(
        country_code="AT",
        tax_category_key="reduced",
        rate_pct=10,
        valid_from="2026-05-01",
    )
    check(
        "a rule can end on the very day it starts (a one-day rate, ends are inclusive)",
        "ok",
        end(one_day, "2026-05-01"),
    )
    check(
        "a DELETED rule cannot be given an end date",
        END_INVALID,
        end("deleted-lu", "2030-12-31"),
    )
    check(
        "the hub next door cannot end our rule",
        END_INVALID,
        end(at_old, "2025-12-31", hub=OTHER_HUB),
    )
    check(
        "and after every refusal the stored end date is still 2026-12-31",
        ["2026-12-31"],
        [
            r["valid_to"]
            for r in rows(
                f"SELECT valid_to FROM taxes_rule WHERE id = {literal(at_old)}"
            )
        ],
    )

    print("\nThe bulk door (`taxes.rules.bulk_create` → `taxes._insert_rule`):")
    check(
        "a bulk row overlapping PT · general is refused with the same code",
        CODE,
        bulk_insert(
            country_code="PT",
            tax_category_key="general",
            rate_pct=25,
            valid_from="2027-01-01",
        ),
    )
    check(
        "a bulk row in a free slot is saved",
        "ok",
        bulk_insert(
            country_code="DE",
            tax_category_key="general",
            rate_pct=19,
            valid_from="2007-01-01",
        ),
    )

    print("\nTenancy — the hub next door is another world:")
    got, _ = create(
        hub=OTHER_HUB,
        country_code="PT",
        tax_category_key="general",
        rate_pct=23,
        valid_from="2020-01-01",
    )
    check(
        "the hub next door saves its own PT · general 23 %, ours does not block it",
        "ok",
        got,
    )
    got, _ = create(
        hub=OTHER_HUB,
        country_code="PT",
        tax_category_key="general",
        rate_pct=25,
        valid_from="2027-01-01",
    )
    check("and ITS own overlap is refused there too", CODE, got)

    print("\nLegacy overlaps are left alone (nothing is deleted):")
    legacy = rows(
        "SELECT id, is_active, is_deleted, valid_to FROM taxes_rule WHERE id LIKE 'legacy-%' ORDER BY id"
    )
    check(
        "the two rules that already overlapped are still there, active and unchanged",
        [
            {"id": "legacy-a", "is_active": 1, "is_deleted": 0, "valid_to": None},
            {"id": "legacy-b", "is_active": 1, "is_deleted": 0, "valid_to": None},
        ],
        legacy,
    )
    got, _ = create(
        country_code="ES",
        tax_category_key="reduced",
        rate_pct=10,
        valid_from="2012-09-01",
    )
    check("they do not block a write in another slot", "ok", got)
    got, _ = create(
        country_code="ES",
        tax_category_key="legacy",
        rate_pct=23,
        valid_from="2030-01-01",
    )
    check("but a NEW rule on top of them is refused", CODE, got)

    print("\nThe migration reverses and re-applies:")
    gate_file = next(f for f in migration_files() if "overlap" in f)
    psql(["-c", "DROP TABLE IF EXISTS taxes__gate"], db=DB)
    psql([], db=DB, stdin=(MODULE_DIR / gate_file).read_text(encoding="utf-8"))
    psql([], db=DB, stdin=(MODULE_DIR / gate_file).read_text(encoding="utf-8"))
    got, _ = create(
        country_code="PT",
        tax_category_key="general",
        rate_pct=25,
        valid_from="2027-01-01",
    )
    check("after down + up (twice: idempotent) the guard still refuses", CODE, got)


def contract() -> None:
    print("\nThe refusal speaks:")
    for code in (CODE, END_INVALID):
        check(
            f"`{code}` is declared in `errors`",
            True,
            code in (MANIFEST.get("errors") or {}),
        )
        for lang in ("en", "es"):
            catalog = json.loads(
                (MODULE_DIR / "locales" / f"{lang}.json").read_text(encoding="utf-8")
            )
            text = (catalog.get("errors") or {}).get(code, "")
            check(f"and translated in `{lang}`", True, bool(text.strip()))
    ending = MANIFEST["commands"].get("taxes.rules.end") or {}
    check(
        "ending a rule is a public door with the manage permission",
        ("taxes.manage_tax", True),
        (ending.get("permission"), bool(ending.get("expose_api"))),
    )
    schema_file = MODULE_DIR / (ending.get("schema") or "schemas/rule_end.json")
    schema = (
        json.loads(schema_file.read_text(encoding="utf-8"))
        if schema_file.is_file()
        else {}
    )
    check(
        "its payload requires the rule and the end date",
        ["rule_id", "valid_to"],
        sorted(schema.get("required") or []),
    )
    check(
        "it announces `taxes.rule.ended`, declared in `events.emits`",
        (["taxes.rule.ended"], True),
        (ending.get("emit"), "taxes.rule.ended" in ((MANIFEST.get("events") or {}).get("emits") or [])),
    )
    floor = (
        (MANIFEST.get("compatibility") or {}).get("min_erplora_version") or "0.0.0"
    ).split(".")
    check(
        f"the module asks for a core that knows `on_unique` (>= {'.'.join(map(str, ON_UNIQUE_CORE))})",
        True,
        tuple(int(x) for x in floor[:3]) >= ON_UNIQUE_CORE,
    )


def main() -> int:
    if not container_available():
        print(f"FAIL — Postgres container `{CONTAINER}` not available (docker).")
        print(
            "       This battery does not degrade to a skip: two rates in force on one day is the bug."
        )
        return 1
    create_db()
    try:
        seed()
        scenario()
    except (RuntimeError, KeyError, StopIteration, ValueError) as exc:
        fail(f"{type(exc).__name__}: {exc}")
    finally:
        drop_db()
    contract()

    print()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — overlapping rules are refused on every door, contiguous ones are saved (taxes#66)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
