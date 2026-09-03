#!/usr/bin/env python3
"""Jurisdiction contract of `taxes.rules.create` / `taxes.rules.bulk_create` (taxes#41).

WHY. `country_code` only declared `minLength: 2, maxLength: 2`, so **`ZZ` was a valid country**.
`ZZ` is not a country: ISO 3166-1 leaves it USER-ASSIGNED, and no hub will ever carry it as its
fiscal identity. The rule was created, listed and counted — and never matched anything. The owner
read the rules screen, saw a row, believed VAT was configured, and the till kept resolving no rate
for what the business sells. The damage is not corruption, it is SILENCE, which is why nothing
ever reported it.

The rest of this command's contract was already closed (taxes#9): `rate_pct` has a real 0..100
range, a backwards validity range comes back `taxes.rule_incoherent`, an unknown category dies on
the FK. The jurisdiction — the OTHER half of the key the resolver looks a rule up by
(`country + region + category`, ADR-0085) — was the one field nobody was checking.

WHERE THE DOOR IS. `crates/runtime/src/commands.rs` compiles the declared schema and calls
`validate_against` (line 437) BEFORE the handler branch (line 452), so this one JSON file is the
door for BOTH shapes of the command: the declarative SQL one (`taxes.rules.create`) and the WASM
one (`taxes.rules.bulk_create`). Closing it in `rule_create.json` alone would leave the bug
reachable through the batch the ASSISTANT uses ("create the 2026 Spain VAT rates") — its handler
check is the same `len() == 2` this issue is about. Hence: both schemas, one list.

WHERE THE LIST COMES FROM. The 249 officially assigned ISO 3166-1 alpha-2 codes, taken from
tzdata's `iso3166.tab` and cross-checked against CLDR (`Intl.DisplayNames`, which knows all 249 —
and also knows `ZZ`, `EU`, `EZ`, `UN` and `XK`, which is exactly why CLDR could not be the source).

REGION. `region_code` gets the shape the CORE already enforces for the very same concept in
`crates/runtime/src/settings.rs::validate_region`: ISO 3166-2, `ES-CN` — country, hyphen, 1..3
alphanumerics. Mirroring it matters more than the pattern itself: a region the hub can never hold
is the same silence as a country it can never hold.

Usage: tests/rule_jurisdiction.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
RULE_CREATE = MODULE_DIR / "schemas" / "rule_create.json"
BULK_CREATE = MODULE_DIR / "schemas" / "rules_bulk_create.json"

# ISO 3166-1 assigns 249 alpha-2 codes. The number is part of the contract: a list that silently
# loses entries stops being "every country" and starts being "the countries somebody remembered".
ISO_3166_1_COUNT = 249

# Codes ISO 3166-1 deliberately does NOT assign. `ZZ` is the one the issue was filed with; `AA`,
# `QM`..`QZ`, `XA`..`XZ` are the user-assigned ranges, and `EU`/`UN` are not countries at all.
NOT_COUNTRIES = ("ZZ", "XX", "AA", "QQ", "XK", "EU", "UN", "EZ")

# A spread that would catch a list truncated at either end or missing the overseas entries.
REAL_COUNTRIES = ("ES", "PT", "FR", "DE", "IT", "US", "GB", "MA", "AD", "AQ", "TF", "ZW")

# `validate_region` in crates/runtime/src/settings.rs: len 4..=6, byte 2 is `-`, first two
# alphabetic, the rest alphanumeric — after uppercasing.
CORE_REGION_RE = r"^[A-Z]{2}-[A-Z0-9]{1,3}$"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)
    print(f"  FAIL: {msg}")


def ok(msg: str) -> None:
    print(f"  ok: {msg}")


# ── A validator for the three keywords under test ────────────────────────────────────────────
#
# Deliberately NOT a JSON Schema implementation: the module's batteries run on a bare python3 (no
# `jsonschema` on the gate's runner), and re-implementing a spec is how a test starts disagreeing
# with the runtime it claims to mirror. It applies `enum`, `pattern` and `maximum`/`minimum` to
# named properties and nothing else — enough to ASK THE PAYLOAD THE ISSUE SENT and get the answer
# the runtime's compiled schema would give, and small enough to be obviously right.
def violations(schema: dict, payload: dict) -> list[str]:
    out: list[str] = []
    for key, value in payload.items():
        prop = schema.get("properties", {}).get(key)
        if not isinstance(prop, dict):
            continue
        if "enum" in prop and value not in prop["enum"]:
            out.append(f"{key}: {value!r} is not one of the {len(prop['enum'])} allowed values")
        if "pattern" in prop and isinstance(value, str) and not re.search(prop["pattern"], value):
            out.append(f"{key}: {value!r} does not match {prop['pattern']!r}")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if "maximum" in prop and value > prop["maximum"]:
                out.append(f"{key}: {value} is greater than the maximum of {prop['maximum']}")
            if "minimum" in prop and value < prop["minimum"]:
                out.append(f"{key}: {value} is less than the minimum of {prop['minimum']}")
    return out


def country_enum(schema: dict, where: str) -> list:
    prop = schema.get("properties", {}).get("country_code")
    if not isinstance(prop, dict):
        fail(f"{where}: `country_code` is not a declared property")
        return []
    enum = prop.get("enum")
    if not isinstance(enum, list):
        fail(
            f"{where}: `country_code` declares no `enum`, so any two characters pass — this is the "
            f"hole taxes#41 reports (got: {json.dumps({k: v for k, v in prop.items() if k != 'description'})})"
        )
        return []
    return enum


def check_country_is_a_closed_list(schema: dict, where: str) -> list:
    enum = country_enum(schema, where)
    if not enum:
        return []

    if len(enum) != ISO_3166_1_COUNT:
        fail(f"{where}: `country_code.enum` has {len(enum)} entries, ISO 3166-1 assigns {ISO_3166_1_COUNT}")
    else:
        ok(f"{where}: `country_code.enum` carries the {ISO_3166_1_COUNT} assigned ISO 3166-1 codes")

    if len(set(enum)) != len(enum):
        fail(f"{where}: `country_code.enum` repeats entries")

    malformed = [c for c in enum if not (isinstance(c, str) and re.fullmatch(r"[A-Z]{2}", c))]
    if malformed:
        fail(f"{where}: `country_code.enum` holds non alpha-2 uppercase entries: {malformed[:5]}")
    else:
        ok(f"{where}: every entry is an uppercase alpha-2 code")

    if enum != sorted(enum):
        fail(f"{where}: `country_code.enum` is not sorted — a diff on it stops being readable")

    present = [c for c in NOT_COUNTRIES if c in enum]
    if present:
        fail(f"{where}: `country_code.enum` accepts codes ISO 3166-1 does not assign: {present}")
    else:
        ok(f"{where}: none of {', '.join(NOT_COUNTRIES)} is accepted")

    absent = [c for c in REAL_COUNTRIES if c not in enum]
    if absent:
        fail(f"{where}: `country_code.enum` is missing real countries: {absent}")
    else:
        ok(f"{where}: real countries ({', '.join(REAL_COUNTRIES[:4])}…) are accepted")

    return enum


def check_region_mirrors_the_core(schema: dict, where: str) -> None:
    prop = schema.get("properties", {}).get("region_code")
    if not isinstance(prop, dict):
        fail(f"{where}: `region_code` is not a declared property")
        return
    pattern = prop.get("pattern")
    if pattern != CORE_REGION_RE:
        fail(
            f"{where}: `region_code.pattern` must be the core's ISO 3166-2 shape "
            f"{CORE_REGION_RE!r} (settings.rs::validate_region); got {pattern!r}"
        )
        return
    ok(f"{where}: `region_code` carries the core's ISO 3166-2 pattern")

    for good in ("ES-CN", "ES-ML", "PT-30", "FR-IDF"):
        if not re.search(pattern, good):
            fail(f"{where}: `region_code` refuses the real subdivision {good}")
    for bad in ("Canarias", "CN", "es-cn", "ES_CN", "ES-", "ES-CNCN"):
        if re.search(pattern, bad):
            fail(f"{where}: `region_code` still accepts {bad!r}")
    ok(f"{where}: ES-CN passes; 'Canarias', 'CN', 'es-cn' do not")

    # `null` and «absent» must keep meaning «the whole country» (migration 004) — a pattern that
    # forced a region would break every rule the seed installs.
    if "null" not in prop.get("type", []):
        fail(f"{where}: `region_code` must stay nullable — NULL means «the whole country»")
    else:
        ok(f"{where}: `region_code` is still nullable (NULL = whole country)")


# ── The payload the issue was filed with ─────────────────────────────────────────────────────
def check_the_reported_payload(schema: dict, where: str) -> None:
    zz = {
        "country_code": "ZZ",
        "tax_category_key": "qa.custom",
        "rate_pct": 10,
        "tax_type": "vat",
        "valid_from": "2026-01-01",
    }
    if not violations(schema, zz):
        fail(f"{where}: the payload taxes#41 reports is still ACCEPTED (country_code 'ZZ')")
    else:
        ok(f"{where}: the reported payload is refused — {violations(schema, zz)[0]}")

    # The POSITIVE CONTROL. `rate_pct: 999` is refused TODAY (the issue says so, and taxes#9 put
    # the `maximum` there). If this line ever goes quiet, the checker above stopped checking and
    # every «refused» it prints is worthless.
    if not violations(schema, {"country_code": "ES", "tax_category_key": "qa.custom", "rate_pct": 999}):
        fail(f"{where}: POSITIVE CONTROL BROKEN — `rate_pct: 999` is not caught, so this file proves nothing")
    else:
        ok(f"{where}: positive control alive (`rate_pct: 999` still caught)")

    # And the rule a real Spanish hub creates has to keep working.
    real = {"country_code": "ES", "region_code": "ES-CN", "tax_category_key": "product.generic", "rate_pct": 21}
    if violations(schema, real):
        fail(f"{where}: a real ES/ES-CN rule is refused: {violations(schema, real)}")
    else:
        ok(f"{where}: a real ES (and ES-CN) rule still passes")


def main() -> int:
    rule_create = json.loads(RULE_CREATE.read_text())
    bulk = json.loads(BULK_CREATE.read_text())
    # The batch declares the same fields one level down, inside `rules[]`.
    bulk_item = bulk["properties"]["rules"]["items"]

    print("taxes.rules.create — schemas/rule_create.json")
    enum_create = check_country_is_a_closed_list(rule_create, "rule_create")
    check_region_mirrors_the_core(rule_create, "rule_create")
    check_the_reported_payload(rule_create, "rule_create")

    print("taxes.rules.bulk_create — schemas/rules_bulk_create.json (rules[])")
    enum_bulk = check_country_is_a_closed_list(bulk_item, "rules_bulk_create")
    check_region_mirrors_the_core(bulk_item, "rules_bulk_create")
    check_the_reported_payload(bulk_item, "rules_bulk_create")

    print("the two doors declare ONE list")
    if enum_create and enum_bulk and enum_create != enum_bulk:
        only_create = sorted(set(enum_create) - set(enum_bulk))
        only_bulk = sorted(set(enum_bulk) - set(enum_create))
        fail(f"the two schemas disagree on the countries: only in create {only_create[:5]}, only in bulk {only_bulk[:5]}")
    elif enum_create and enum_bulk:
        ok("both commands accept exactly the same countries")

    print()
    if failures:
        print(f"✗ {len(failures)} failure(s)")
        return 1
    print("✓ jurisdiction contract green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
