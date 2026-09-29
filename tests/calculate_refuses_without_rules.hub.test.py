#!/usr/bin/env python3
"""`taxes.calculate` stops when the hub cannot read its tax rules — against the REAL kernel (taxes#82).

The rate is the one thing a tax calculation may never guess. `taxes.calculate` gets the hub's rules
from the kernel, which pre-loads the read `taxes.rules.list` before the handler runs (ADR-0069).
While that read was declared as a bare string, a read that FAILED (the database hiccuped, the query
broke) was silently OMITTED and the handler ran anyway:

  * with no rules at all it answered `no_rate` — blaming the business's configuration for what was
    an outage;
  * with `allow_missing_rate` it charged 0 %;
  * and with no pre-loaded catalogue it falls back to `payload.rules`, so the CALLER's rules decided
    the rate — exactly what `sales#21` forbids at the till.

`sales` already marks the same read `required` (`sales.complete_sale`, `sales.checkout.preview`):
the kernel then aborts the command with `read_unavailable` (hub#701). This battery proves
`taxes.calculate` behaves the same, and that it recovers once the rules are readable again:

  1. Positive control: with the rules readable, the seeded ES `product.generic` rule (21 %)
     computes 2 100 cents on 10 000.
  2. With the rules table unreachable, the command is refused with `read_unavailable` — plain, with
     `allow_missing_rate`, and with rules smuggled in the payload.
  3. With the table back, the same calculation answers 21 % again.

Only a running hub resolves `reads`, and only its database can be broken on purpose: the table is
renamed through the session the runner hands over in `ERPLORA_HUB_PSQL` (module-toolkit#405) and
renamed back in a `finally`, whatever happens in between.

Usage: `erplora test <dir> --against-hub [dev|stable|sha256:…]` (module-toolkit#110). Never on its
own: without a runtime it fails, it does not skip.
"""

import json
import os
import shlex
import subprocess
import sys
import urllib.error
import urllib.request
import uuid

BATTERY = "calculate_refuses_without_rules.hub"
BASE = (
    os.environ.get("TAXES_HUB_BASE_URL") or os.environ.get("ERPLORA_HUB_BASE_URL") or ""
).rstrip("/")
PSQL = tuple(shlex.split(os.environ.get("ERPLORA_HUB_PSQL", "")))

RULES_TABLE = "taxes_rule"
# Unique per run: a previous run that died between the two renames must not collide with this one.
HIDDEN_TABLE = f"taxes_rule_hidden_{uuid.uuid4().hex[:8]}"

# The seeded Spanish baseline (seed/install.postgres.sql): `product.generic` is 21 % VAT.
LINE = {"amount": 10_000, "tax_category_key": "product.generic", "country_code": "ES"}
# A rule the caller has no business deciding: 99 % would win if the handler fell back to it.
SMUGGLED_RULE = {
    "id": "smuggled",
    "country_code": "ES",
    "region_code": None,
    "tax_category_key": "product.generic",
    "rate_pct": 99,
    "tax_type": "vat",
    "valid_from": "2000-01-01",
    "valid_to": None,
    "is_active": 1,
}

failures: list[str] = []


def fail(label: str, detail) -> None:
    failures.append(f"{label} — {detail}")
    print(f"  FAIL: {label} — {detail}")


def request(hub_id: str, user: str, method: str, path: str, body=None):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=None if body is None else json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "x-hub-id": hub_id,
            "x-user-id": user,
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, json.loads(res.read().decode() or "null")
    except urllib.error.HTTPError as err:
        raw = err.read().decode()
        try:
            return err.code, json.loads(raw or "null")
        except json.JSONDecodeError:
            return err.code, {"raw": raw}


def runtime_hub_id() -> str:
    with urllib.request.urlopen(f"{BASE}/api/hub/context", timeout=60) as res:
        hub_id = json.loads(res.read().decode()).get("hub_id")
    if not hub_id:
        print(f"{BATTERY}: GET /api/hub/context did not say the hub_id")
        sys.exit(1)
    return hub_id


def psql(sql: str) -> str:
    done = subprocess.run(
        [*PSQL, "-tAc", sql], capture_output=True, text=True, timeout=60, check=False
    )
    if done.returncode != 0:
        raise AssertionError(
            f"psql `{sql}` exited {done.returncode}: {done.stderr.strip()}"
        )
    return done.stdout.strip()


def calculate(hub_id: str, user: str, extra: dict | None = None):
    return request(
        hub_id,
        user,
        "POST",
        "/api/command",
        {"name": "taxes.calculate", "payload": {**LINE, **(extra or {})}},
    )


def result_of(body) -> dict:
    data = (body or {}).get("data") or {}
    return data.get("result") if isinstance(data.get("result"), dict) else data


def expect_rate(label: str, status: int, body) -> None:
    if status != 200 or not (body or {}).get("ok"):
        fail(
            label,
            f"expected 21 % on 10 000, the command answered HTTP {status}: {body}",
        )
        return
    result = result_of(body)
    if result.get("tax") != 2_100 or result.get("tax_rule_id") in (
        None,
        "",
        "smuggled",
    ):
        fail(label, f"expected tax 2100 from a seeded rule, got {result}")
    else:
        print(f"  ok: {label} → tax {result['tax']} ({result.get('tax_rate_pct')} %)")


def expect_read_unavailable(label: str, status: int, body) -> None:
    error = (body or {}).get("error") or {} if isinstance(body, dict) else {}
    if status == 200:
        fail(
            label,
            f"expected refusal `read_unavailable`, the command SUCCEEDED: {result_of(body)}",
        )
    elif error.get("code") != "read_unavailable":
        fail(
            label,
            f"expected code [read_unavailable], got [{error.get('code')}] (HTTP {status}: {body})",
        )
    else:
        print(f"  ok: {label} refused with `read_unavailable` (HTTP {status})")


def main() -> int:
    if not BASE:
        print(
            f"{BATTERY}: no runtime at the other end (ERPLORA_HUB_BASE_URL is empty)."
        )
        print(
            "Run it with `erplora test <dir> --against-hub`; this is a failure, not a skip."
        )
        return 1
    if not PSQL:
        print(
            f"{BATTERY}: hub_psql_missing — ERPLORA_HUB_PSQL is empty. The runner has to hand over "
            "a session on the hub's database; without it the read cannot be broken on purpose."
        )
        return 1

    hub_id = runtime_hub_id()
    user = f"u-{uuid.uuid4().hex[:8]}"
    # The session must open THIS hub's database, or renaming the table proves nothing.
    seeded = psql(f"SELECT count(*) FROM {RULES_TABLE} WHERE hub_id = '{hub_id}'")
    if not seeded.isdigit() or int(seeded) == 0:
        print(
            f"{BATTERY}: ERPLORA_HUB_PSQL shows no `{RULES_TABLE}` rows for hub {hub_id} ({seeded!r})"
        )
        return 1

    print("\n1 · rules readable: the seeded rule decides the rate (positive control)")
    expect_rate("calculate with the rules readable", *calculate(hub_id, user))

    print(
        "\n2 · rules unreadable: the calculation stops instead of guessing (taxes#82)"
    )
    psql(f"ALTER TABLE {RULES_TABLE} RENAME TO {HIDDEN_TABLE}")
    try:
        expect_read_unavailable("calculate", *calculate(hub_id, user))
        expect_read_unavailable(
            "calculate with allow_missing_rate",
            *calculate(hub_id, user, {"allow_missing_rate": True}),
        )
        expect_read_unavailable(
            "calculate with rules in the payload",
            *calculate(hub_id, user, {"rules": [SMUGGLED_RULE]}),
        )
    finally:
        psql(f"ALTER TABLE {HIDDEN_TABLE} RENAME TO {RULES_TABLE}")

    print("\n3 · rules readable again: the calculation recovers")
    expect_rate("calculate after the rules came back", *calculate(hub_id, user))

    if failures:
        print(f"\n{BATTERY}: RED — {len(failures)} failure(s):")
        for line in failures:
            print(f"  - {line}")
        return 1
    print(f"\n{BATTERY}: GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
