#!/usr/bin/env python3
"""Two overlapping tax rules saved AT THE SAME TIME can never both be kept (taxes#69).

taxes#66 refuses a rule whose dates run into another active rule of the same slot (hub, country,
region, tax category): `commands/_rule_overlap_assert.sql` looks for the other rule after the write.
But it runs in READ COMMITTED, so it only sees rules that are already COMMITTED. Two people (or the
assistant and a person) saving «PT · general 23 % from 2020» and «PT · general 25 % from 2027» in
the same instant each run their check while the other one is still open, neither sees the other,
and both commit — the very state taxes#66 exists to prevent. The unique index on the natural key
does not help: it includes `valid_from`, and two overlapping ranges rarely start the same day.

The fix serialises every write that can create an overlap per hub (`commands/_rule_write_lock.sql`
as the FIRST statement of each such command): the second writer waits until the first commits,
and then its own check sees the first rule and refuses with `taxes.rule_overlaps` — the same notice
the owner gets from taxes#66.

This battery proves it with TWO REAL, CONCURRENT Postgres sessions — not two sequential calls,
which the taxes#66 battery already covers and which can never reproduce a race:

  session A: BEGIN + the statements of the first command, and it stays OPEN;
  session B: BEGIN + the statements of the second command + COMMIT;
  then A commits, and we look at what B answered and what the table kept.

1. **The case of the issue**: two `taxes.rules.create` whose dates overlap → one kept, the other
   refused with `taxes.rule_overlaps`.
2. **Every door that can create an overlap takes the same lock**: the bulk import
   (`taxes._insert_rule`), bringing a rule back (`taxes.rules.activate`) and moving an end date
   (`taxes.rules.end`) racing a `taxes.rules.create`.
3. **Tenancy**: a hub never waits for the hub next door — the other hub's writer commits while the
   first transaction is still open, and both hubs keep their rule.
4. **Rules that do not overlap are still saved**, even when written at the same time.

Usage: tests/concurrent_overlapping_rules_are_refused.postgres.test.py  (exit 0 = green)
  Uses the `erplora-test-pg-5433` container by default (override: TAXES_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail.
"""

import importlib.util
import os
import pathlib
import queue
import subprocess
import sys
import threading
import uuid

HERE = pathlib.Path(__file__).resolve().parent
# Loading the taxes#66 battery must not leave a `__pycache__/` in the module tree.
sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location(
    "taxes_overlap_battery", HERE / "overlapping_rules_are_refused.postgres.test.py"
)
base = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(base)
# Own scratch database: the helpers of the taxes#66 battery read their module global `DB`.
base.DB = f"taxes_race_{os.getpid()}_{uuid.uuid4().hex[:6]}"

MANIFEST = base.MANIFEST
CODE = base.CODE
HUB = base.HUB
OTHER_HUB = base.OTHER_HUB
check, fail, ok, literal = base.check, base.fail, base.ok, base.literal

# How long session B gets to finish while session A is still open. A writer that is NOT serialised
# answers in milliseconds; a serialised one never answers until A commits.
WAIT_S = 3.0


class Session:
    """One live psql session inside the test container, fed statement by statement."""

    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [
                "docker",
                "exec",
                "-i",
                base.CONTAINER,
                "psql",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-X",
                "-q",
                "-d",
                base.DB,
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.lines: queue.Queue = queue.Queue()
        self.stderr: list[str] = []
        threading.Thread(target=self._pump_out, daemon=True).start()
        threading.Thread(target=self._pump_err, daemon=True).start()

    def _pump_out(self) -> None:
        for line in self.proc.stdout:
            self.lines.put(line.strip())
        self.lines.put(None)

    def _pump_err(self) -> None:
        for line in self.proc.stderr:
            self.stderr.append(line)

    def send(self, sql: str, marker: str) -> None:
        self.proc.stdin.write(sql + f"\n\\echo {marker}\n")
        self.proc.stdin.flush()

    def reached(self, marker: str, timeout: float) -> bool:
        """True if the session printed `marker` within `timeout` (it ran everything before it)."""
        try:
            while True:
                line = self.lines.get(timeout=timeout)
                if line is None:
                    return False
                if line == marker:
                    return True
        except queue.Empty:
            return False

    def finish(self) -> str:
        """Closes the session and returns what the transaction answered: `ok` or the violated index."""
        self.proc.stdin.close()
        self.proc.wait(timeout=30)
        err = "".join(self.stderr)
        if self.proc.returncode == 0:
            return "ok"
        match = base.UNIQUE.search(err)
        if not match:
            raise RuntimeError(f"a session failed outside any gate: {err.strip()}")
        return f"index:{match.group(1)}"


def statements(command: str, params: dict, hub: str) -> str:
    """The statements of `command`, bound the way the dispatcher binds them, as one script."""
    bound = {**params, "hub_id": hub, "current_user_id": base.USER, "now": base.tick()}
    body = [
        base.bind(
            base.strip_comments((base.MODULE_DIR / f).read_text(encoding="utf-8")),
            bound,
        )
        .strip()
        .rstrip(";")
        for f in MANIFEST["commands"][command]["sql"]
    ]
    return ";\n".join(body) + ";"


def renamed(command: str, answer: str) -> str:
    """The code the dispatcher answers: `on_unique` of the command renames a unique violation."""
    if not answer.startswith("index:"):
        return answer
    index = answer.split(":", 1)[1]
    mapping = MANIFEST["commands"][command].get("on_unique") or {}
    return mapping.get(index, f"db:{index}")


def race(first: tuple, second: tuple) -> tuple[str, bool, str]:
    """Runs `first` in an OPEN transaction, `second` fully (up to COMMIT) meanwhile, then commits
    `first`. Returns (what `first` answered, whether `second` finished while `first` was still
    open, what `second` answered)."""
    cmd_a, params_a, hub_a, *by_a = first
    cmd_b, params_b, hub_b, *by_b = second
    a, b = Session(), Session()
    try:
        a.send("BEGIN;\n" + statements(cmd_a, params_a, hub_a), "A_WROTE")
        if not a.reached("A_WROTE", 30):
            raise RuntimeError(
                f"session A never finished its statements: {''.join(a.stderr)}"
            )
        b.send("BEGIN;\n" + statements(cmd_b, params_b, hub_b) + "\nCOMMIT;", "B_DONE")
        b_went_through = b.reached("B_DONE", WAIT_S)
        a.send("COMMIT;", "A_DONE")
        answer_a = a.finish()
        answer_b = b.finish()
    finally:
        for s in (a, b):
            if s.proc.poll() is None:
                s.proc.kill()
    # A bulk row (`taxes._insert_rule`) is renamed by the command that emitted it
    # (`taxes.rules.bulk_create`), as the dispatcher does: an optional 4th item names it.
    return (
        renamed((by_a or [cmd_a])[0], answer_a),
        b_went_through,
        renamed((by_b or [cmd_b])[0], answer_b),
    )


def rule(**payload) -> dict:
    return {"new_id": base.fresh_id(), **payload}


def kept(country: str, key: str, hub: str = HUB) -> list:
    return [
        r["rate_pct"]
        for r in base.rows(
            "SELECT rate_pct FROM taxes_rule WHERE hub_id = "
            + literal(hub)
            + " AND country_code = "
            + literal(country)
            + " AND tax_category_key = "
            + literal(key)
            + " AND is_deleted = 0 AND is_active = 1 ORDER BY rate_pct"
        )
    ]


def scenario() -> None:
    print("\nThe case of the issue: two overlapping rules saved at the same time")
    got_a, b_through, got_b = race(
        (
            "taxes.rules.create",
            rule(
                country_code="PT",
                tax_category_key="general",
                rate_pct=23,
                valid_from="2020-01-01",
            ),
            HUB,
        ),
        (
            "taxes.rules.create",
            rule(
                country_code="PT",
                tax_category_key="general",
                rate_pct=25,
                valid_from="2027-01-01",
            ),
            HUB,
        ),
    )
    check("the first one is saved", "ok", got_a)
    check(
        "the second one waits for the first instead of slipping past its check",
        False,
        b_through,
    )
    check("and is refused with the notice of taxes#66", CODE, got_b)
    check("only one PT · general rule is kept", [23], kept("PT", "general"))

    print("\nThe bulk import races a single create")
    got_a, b_through, got_b = race(
        (
            "taxes.rules.create",
            rule(
                country_code="FR",
                tax_category_key="general",
                rate_pct=20,
                valid_from="2020-01-01",
            ),
            HUB,
        ),
        (
            "taxes._insert_rule",
            {
                "id": base.fresh_id(),
                "country_code": "FR",
                "tax_category_key": "general",
                "rate_pct": 21,
                "valid_from": "2027-01-01",
            },
            HUB,
            "taxes.rules.bulk_create",
        ),
    )
    check("the create is saved", "ok", got_a)
    check("the import row waits", False, b_through)
    check("and is refused", CODE, got_b)
    check("only one FR · general rule is kept", [20], kept("FR", "general"))

    print("\nBringing a rule back races a create over its dates")
    base.run(
        "taxes.rules.create",
        {
            "new_id": "it-old",
            "country_code": "IT",
            "tax_category_key": "general",
            "rate_pct": 22,
            "valid_from": "2020-01-01",
        },
        HUB,
    )
    base.run("taxes.rules.deactivate", {"rule_id": "it-old"}, HUB)
    got_a, b_through, got_b = race(
        (
            "taxes.rules.create",
            rule(
                country_code="IT",
                tax_category_key="general",
                rate_pct=24,
                valid_from="2027-01-01",
            ),
            HUB,
        ),
        ("taxes.rules.activate", {"rule_id": "it-old"}, HUB),
    )
    check("the create is saved", "ok", got_a)
    check("bringing the old rule back waits", False, b_through)
    check("and is refused", CODE, got_b)
    check("only the new IT · general rule is active", [24], kept("IT", "general"))

    print("\nMoving an end date races a create that starts inside it")
    base.run(
        "taxes.rules.create",
        {
            "new_id": "de-old",
            "country_code": "DE",
            "tax_category_key": "general",
            "rate_pct": 19,
            "valid_from": "2020-01-01",
            "valid_to": "2025-12-31",
        },
        HUB,
    )
    got_a, b_through, got_b = race(
        (
            "taxes.rules.create",
            rule(
                country_code="DE",
                tax_category_key="general",
                rate_pct=21,
                valid_from="2026-06-01",
            ),
            HUB,
        ),
        ("taxes.rules.end", {"rule_id": "de-old", "valid_to": "2026-12-31"}, HUB),
    )
    check("the create is saved", "ok", got_a)
    check("moving the end date waits", False, b_through)
    check("and is refused", CODE, got_b)
    old_end = base.rows("SELECT valid_to FROM taxes_rule WHERE id = 'de-old'")
    check("the old rule keeps its end date", [{"valid_to": "2025-12-31"}], old_end)

    print("\nTenancy: the hub next door never waits for this one")
    got_a, b_through, got_b = race(
        (
            "taxes.rules.create",
            rule(
                country_code="NL",
                tax_category_key="general",
                rate_pct=21,
                valid_from="2020-01-01",
            ),
            HUB,
        ),
        (
            "taxes.rules.create",
            rule(
                country_code="NL",
                tax_category_key="general",
                rate_pct=9,
                valid_from="2027-01-01",
            ),
            OTHER_HUB,
        ),
    )
    check("this hub saves its rule", "ok", got_a)
    check(
        "the other hub commits while this hub's transaction is still open",
        True,
        b_through,
    )
    check("and keeps its own rule", "ok", got_b)
    check("this hub keeps its NL rule", [21], kept("NL", "general"))
    check("the other hub keeps its NL rule", [9], kept("NL", "general", OTHER_HUB))

    print("\nRules that do not overlap are still saved when written at the same time")
    got_a, _, got_b = race(
        (
            "taxes.rules.create",
            rule(
                country_code="BE",
                tax_category_key="general",
                rate_pct=21,
                valid_from="2020-01-01",
                valid_to="2026-12-31",
            ),
            HUB,
        ),
        (
            "taxes.rules.create",
            rule(
                country_code="BE",
                tax_category_key="general",
                rate_pct=22,
                valid_from="2027-01-01",
            ),
            HUB,
        ),
    )
    check("the rule until 2026-12-31 is saved", "ok", got_a)
    check("the contiguous one from 2027-01-01 is saved too", "ok", got_b)
    check("both BE · general rules are kept", [21, 22], kept("BE", "general"))


def main() -> int:
    if not base.container_available():
        print(f"FAIL — Postgres container `{base.CONTAINER}` not available (docker).")
        print(
            "       This battery does not degrade to a skip: two rates in force on one day is the bug."
        )
        return 1
    base.create_db()
    try:
        base.seed()
        scenario()
    except (
        RuntimeError,
        KeyError,
        StopIteration,
        ValueError,
        subprocess.TimeoutExpired,
    ) as exc:
        fail(f"{type(exc).__name__}: {exc}")
    finally:
        base.drop_db()

    failures = base.failures
    print()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — two overlapping rules saved at the same time: one is kept, the other refused (taxes#69)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
