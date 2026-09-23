#!/usr/bin/env python3
"""A rule that charges no tax cannot be saved with a rate (taxes#59).

WHY. `taxes.rules.create` accepted `operation_class: "subject_reverse"` (or `exempt`, `not_subject`,
`not_subject_location`) together with `rate_pct: 21`. The rule saved fine, the till charged 21 % on
every sale of that category, and the invoice then refused to seal it (`invoice.quota_on_non_subject_class`,
invoice#83) because it would declare a quota on an operation that carries none — a reverse-charge
line with a quota is rejected by the AEAT. The mistake surfaced at the till, not on the screen where
it was made.

The same money leaks through a COMPONENT: a surcharge with a rate hanging from an exempt root adds
its points to a combined rate whose qualification says «no tax».

WHERE THE DOOR IS. `commands/rule_create.sql` is a conditional INSERT gated by `expect_rows` (min 1
→ `taxes.rule_incoherent`). This battery runs THAT file, binds substituted the way the runtime's
driver binds them (an omitted `:name` is NULL), against a real Postgres with the module's own
migrations, and reads the affected-row count: 0 is the refusal the runtime turns into the error.

What it holds down:
1. The control: a normal `subject` 21 % root is inserted (a guard that refused everything would
   pass every other line).
2. Each non-subject class with a rate > 0 is refused; the same class at 0 % is accepted.
3. A component with a rate under a non-subject root is refused; under a `subject` root it is not.

Usage: tests/non_subject_rule_charges_no_tax.postgres.test.py   (exit 0 = green)
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
RULE_CREATE = (MODULE_DIR / "commands" / "rule_create.sql").read_text(encoding="utf-8")

HUB = "hub-under-test"
USER = "u-owner"
NOW = "2026-09-23T10:00:00Z"
CATEGORY = "product.generic"
NON_SUBJECT_CLASSES = (
    "subject_reverse",
    "exempt",
    "not_subject",
    "not_subject_location",
)

PARAM = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)", re.IGNORECASE)
DB = f"taxes_non_subject_{os.getpid()}_{uuid.uuid4().hex[:6]}"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"  ✗ {msg}")


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


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


def create_db() -> None:
    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    for rel in (MANIFEST.get("migrations") or {}).get("postgres", []):
        path = rel if isinstance(rel, str) else rel["file"]
        psql([], db=DB, stdin=(MODULE_DIR / path).read_text(encoding="utf-8"))
    psql(
        [],
        db=DB,
        stdin=(
            "INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active,"
            " is_deleted, created_by, updated_by, created_at, updated_at) VALUES ("
            + ",".join(
                literal(v)
                for v in (
                    f"{HUB}|taxcat|{CATEGORY}",
                    HUB,
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


def create_rule(**payload) -> int:
    """Run `rule_create.sql` with the runtime's injected binds; return the affected-row count."""
    params = {
        "country_code": "ES",
        "tax_category_key": CATEGORY,
        "hub_id": HUB,
        "current_user_id": USER,
        "now": NOW,
        "new_id": f"r-{uuid.uuid4().hex[:10]}",
    }
    params.update(payload)
    sql = PARAM.sub(lambda m: literal(params.get(m.group(1))), RULE_CREATE)
    out = psql(["-c", sql], db=DB)
    match = re.search(r"INSERT 0 (\d+)", out)
    if not match:
        raise RuntimeError(f"no INSERT tag in psql output: {out!r}")
    return int(match.group(1))


def expect(what: str, expected: int, got: int) -> None:
    if expected == got:
        ok(f"{what}: {'inserted' if got else 'refused'}")
    else:
        fail(
            f"{what}: expected {'insert' if expected else 'refusal'}, got {got} row(s)"
        )


def run() -> None:
    print("\nThe control — a normal subject rule still saves:")
    subject_root = f"r-subject-{uuid.uuid4().hex[:6]}"
    expect(
        "subject 21 %",
        1,
        create_rule(new_id=subject_root, rate_pct=21, operation_class="subject"),
    )
    expect(
        "absent class (defaults to subject) 10 %",
        1,
        create_rule(rate_pct=10, valid_from="2027-01-01"),
    )

    print("\nA class that charges no tax cannot carry a rate:")
    for i, cls in enumerate(NON_SUBJECT_CLASSES):
        expect(
            f"{cls} at 21 %",
            0,
            create_rule(
                rate_pct=21, operation_class=cls, valid_from=f"2030-0{i + 1}-01"
            ),
        )
        expect(
            f"{cls} at 0.01 %",
            0,
            create_rule(
                rate_pct=0.01, operation_class=cls, valid_from=f"2030-0{i + 1}-02"
            ),
        )
        expect(
            f"{cls} at 0 %",
            1,
            create_rule(
                rate_pct=0, operation_class=cls, valid_from=f"2030-0{i + 1}-03"
            ),
        )

    print("\nA component cannot add a rate to a root that charges no tax:")
    exempt_root = f"r-exempt-{uuid.uuid4().hex[:6]}"
    expect(
        "exempt root at 0 %",
        1,
        create_rule(
            new_id=exempt_root,
            rate_pct=0,
            operation_class="exempt",
            exempt_reason="E1",
            valid_from="2031-01-01",
        ),
    )
    expect(
        "surcharge 5.2 % under the exempt root",
        0,
        create_rule(
            rate_pct=5.2,
            tax_type="surcharge",
            parent_id=exempt_root,
            valid_from="2031-01-01",
        ),
    )
    expect(
        "surcharge 5.2 % under the subject root (control)",
        1,
        create_rule(rate_pct=5.2, tax_type="surcharge", parent_id=subject_root),
    )


def main() -> int:
    if not container_available():
        print(f"FAIL — Postgres container `{CONTAINER}` not available (docker).")
        print(
            "       This battery does not degrade to a skip: an untested guard is the bug."
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
        "PASS — `taxes.rules.create` refuses a rate on a rule (or under a root) that charges no tax"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
