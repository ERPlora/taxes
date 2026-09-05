#!/usr/bin/env python3
"""Manifest contract test (taxes#19) — `module.json` must parse the way the RUNTIME parses it.

Why this file exists, and why it exists NOW: until hub#369 the `setup` block was cargo the Hub
only transported (the browser read it from the raw `module.json`), so a typo there degraded a
widget. It is not cargo any more — `crates/runtime/src/manifest.rs` deserializes it into
`SetupDef`, and `Manifest::load` is the FIRST thing `installer::install` does. A wrong JSON type
in `setup` no longer breaks a checklist: it makes the published module **impossible to install on
any hub**. That is exactly how `tables` shipped a boolean `catch_up` (tables#28) and closed the
door on itself; `erplora validate` did not catch it because it re-implements a subset of the JSON
Schema by hand instead of applying it.

Three layers, all in this one file, no services needed:

  1. TYPE CONTRACT (always, zero dependencies). Mirrors the serde model of
     `hub/crates/runtime/src/manifest.rs`: every block declared here must carry the JSON type the
     runtime deserializes it into, plus the rules the schema cannot express (the setup query has
     to be a query this module actually declares, the permission has to be one it owns, the
     reserved slot is the one the core assigned).

  2. CANONICAL JSON SCHEMA (when reachable). `hub/schemas/module.schema.json` ITSELF — the source
     of truth, no re-implementation, no drift. Unreachable is reported as SKIPPED, never as a pass.

  3. DECLARED FILES EXIST. Every path the manifest points at (migrations, seed, query/command SQL,
     JSON Schemas, the WASM handler, the UI bundle) must be in the package. A manifest that points
     at a file the zip does not carry breaks on the hub, not here.

Usage: tests/manifest.contract.test.py   (exit 0 = green)
"""

import json
import os
import pathlib
import subprocess
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST_PATH = MODULE_DIR / "module.json"

# `enum CatchUp` in hub/crates/runtime/src/manifest.rs (`#[serde(rename_all = "lowercase")]`).
CATCH_UP_VALUES = ("collapse", "skip")

# Dialects the runtime knows about (`struct Migrations`).
SQL_DIALECTS = ("sqlite", "postgres")

# The slot the CORE reserved for this module in the onboarding checklist
# (`architecture/hub/setup-status.md` §6). The scale belongs to the core: 10 = your apps,
# 40 = your business details, 80 = your team, and 20 is the gap left for "your taxes" — sell
# first, invoice after. Picking another number would jump the queue in a list this module does
# not own.
RESERVED_SETUP_ORDER = 20

# Top-level blocks of the contract. The canonical schema declares `additionalProperties: false`;
# here an unknown key is only a warning, so that a manifest using a block newer than this list
# does not turn red for no reason (layer 2 is the strict one). Extend when the contract grows.
KNOWN_TOP_LEVEL = {
    "id",
    "errors",
    "name",
    "version",
    "description",
    "depends_on",
    "permissions",
    "role_permissions",
    "navigation",
    "migrations",
    "seed",
    "queries",
    "commands",
    "events",
    "agent",
    "ai_context",
    "scheduled_tasks",
    "widgets",
    "settings",
    "static_files",
    "provides_slots",
    "ui",
    "notify",
    "network",
    "capabilities",
    "setup",
}

# Keys `SetupDef` deserializes. `key` is NOT one of them on purpose: the core derives it as
# `<module_id>.setup` so a manifest cannot rename itself out of the core-owned blocking list.
SETUP_KEYS = {
    "query",
    "params",
    "configured_when",
    "title",
    "description",
    "icon",
    "route",
    "permission",
    "countries",
    "order",
    "required",
}

JSON_TYPE_NAME = {
    bool: "boolean",
    int: "number",
    float: "number",
    str: "string",
    list: "array",
    dict: "object",
    type(None): "null",
}

failures: list[str] = []
warnings: list[str] = []
notes: list[str] = []


def type_name(value) -> str:
    return JSON_TYPE_NAME.get(type(value), type(value).__name__)


def expect(path: str, value, kind, enum: tuple | None = None) -> bool:
    """Assert the JSON type of `value`. `True`/`False` never pass as a number or a string:
    in Python `bool` is a subclass of `int`, in JSON it is a type of its own — and confusing
    the two is exactly the bug this file guards against."""
    ok = isinstance(value, kind) and not (isinstance(value, bool) and kind is not bool)
    if not ok:
        failures.append(
            f"{path}: expected {kind.__name__}, got {type_name(value)} ({value!r})"
        )
        return False
    if enum is not None and value not in enum:
        failures.append(f"{path}: {value!r} is not one of {list(enum)}")
        return False
    return True


def field(
    path: str,
    obj: dict,
    key: str,
    kind,
    required: bool = False,
    enum: tuple | None = None,
):
    """Check one key of an object. Absent (or `null`, which serde reads as `None` for an
    `Option<T>`) is fine unless the field is required."""
    if key not in obj or obj[key] is None:
        if required:
            failures.append(f"{path}.{key}: missing, and the runtime requires it")
        return None
    expect(f"{path}.{key}", obj[key], kind, enum)
    return obj[key]


def string_array(path: str, value) -> None:
    if not expect(path, value, list):
        return
    for i, item in enumerate(value):
        expect(f"{path}[{i}]", item, str)


# ── Layer 1: the type contract, mirroring `struct Manifest` ──────────────────────────────


def check_identity(m: dict) -> None:
    field("", m, "id", str, required=True)
    field("", m, "name", str, required=True)
    field("", m, "version", str, required=True)
    field("", m, "description", str)

    if m.get("id") != MODULE_DIR.name:
        failures.append(
            f"id: {m.get('id')!r} does not match the module folder {MODULE_DIR.name!r}"
        )

    # The release bot bumps module.json and package.json together; a mismatch means a half-applied
    # release, and the marketplace publishes whatever module.json says.
    pkg_path = MODULE_DIR / "package.json"
    if pkg_path.exists():
        pkg_version = json.loads(pkg_path.read_text()).get("version")
        if pkg_version != m.get("version"):
            failures.append(
                f"version: module.json says {m.get('version')!r}, package.json says {pkg_version!r}"
            )


def check_permissions(m: dict) -> None:
    string_array("depends_on", m.get("depends_on", []))
    string_array("permissions", m.get("permissions", []))

    roles = m.get("role_permissions", {})
    if expect("role_permissions", roles, dict):
        for role, perms in roles.items():
            string_array(f"role_permissions.{role}", perms)


def check_navigation(m: dict) -> None:
    nav = m.get("navigation", [])
    if not expect("navigation", nav, list):
        return
    for i, entry in enumerate(nav):
        path = f"navigation[{i}]"
        if not expect(path, entry, dict):
            continue
        field(path, entry, "id", str, required=True)
        field(path, entry, "label", str, required=True)
        field(path, entry, "component", str, required=True)
        field(path, entry, "icon", str)


def check_sql_blocks(m: dict) -> None:
    for block in ("migrations", "seed"):
        value = m.get(block, {})
        if not expect(block, value, dict):
            continue
        for dialect, files in value.items():
            if dialect not in SQL_DIALECTS:
                failures.append(f"{block}.{dialect}: unknown SQL dialect {dialect!r}")
                continue
            string_array(f"{block}.{dialect}", files)

    queries = m.get("queries", {})
    if expect("queries", queries, dict):
        for name, q in queries.items():
            path = f"queries.{name}"
            if not expect(path, q, dict):
                continue
            field(path, q, "permission", str, required=True)
            field(path, q, "sql", str, required=True)
            field(path, q, "schema", str)
            field(path, q, "expose_api", bool)
            if not name.startswith(f"{m.get('id')}."):
                failures.append(
                    f"{path}: a query name must be namespaced by the module id"
                )
            if "list" in q and expect(f"{path}.list", q["list"], dict):
                spec = q["list"]
                string_array(f"{path}.list.search", spec.get("search", []))
                string_array(f"{path}.list.sort", spec.get("sort", []))
                field(f"{path}.list", spec, "default_sort", str)
                field(f"{path}.list", spec, "default_dir", str)
                field(f"{path}.list", spec, "page_size", int)

    commands = m.get("commands", {})
    if expect("commands", commands, dict):
        for name, c in commands.items():
            path = f"commands.{name}"
            if not expect(path, c, dict):
                continue
            field(path, c, "permission", str, required=True)
            field(path, c, "schema", str)
            field(path, c, "transaction", bool)
            field(path, c, "internal", bool)
            field(path, c, "expose_api", bool)
            field(path, c, "min_affected_rows", int)
            string_array(f"{path}.sql", c.get("sql", []))
            string_array(f"{path}.emit", c.get("emit", []))
            string_array(f"{path}.reads", c.get("reads", []))
            if "handler" in c and expect(f"{path}.handler", c["handler"], dict):
                h = c["handler"]
                field(f"{path}.handler", h, "type", str, required=True)
                field(f"{path}.handler", h, "file", str, required=True)
                field(f"{path}.handler", h, "function", str, required=True)


def check_events_and_slots(m: dict) -> None:
    events = m.get("events", {})
    if expect("events", events, dict):
        listen = events.get("listen", {})
        if expect("events.listen", listen, dict):
            for topic, listener in listen.items():
                path = f"events.listen.{topic}"
                if expect(path, listener, dict):
                    field(path, listener, "command", str, required=True)
        string_array("events.emits", events.get("emits", []))

    slots = m.get("provides_slots", [])
    if expect("provides_slots", slots, list):
        for i, slot in enumerate(slots):
            path = f"provides_slots[{i}]"
            if not expect(path, slot, dict):
                continue
            field(path, slot, "slot", str, required=True)
            field(path, slot, "component", str, required=True)
            field(path, slot, "permission", str)
            field(path, slot, "priority", int)

    if "ui" in m and expect("ui", m["ui"], dict):
        field("ui", m["ui"], "entry", str, required=True)

    if "agent" in m and expect("agent", m["agent"], dict):
        field("agent", m["agent"], "description", str, required=True)
        string_array("agent.keywords", m["agent"].get("keywords", []))


def check_scheduled_tasks(m: dict) -> None:
    tasks = m.get("scheduled_tasks", [])
    if not expect("scheduled_tasks", tasks, list):
        return
    for i, task in enumerate(tasks):
        path = f"scheduled_tasks[{i}]"
        if not expect(path, task, dict):
            continue
        field(path, task, "name", str, required=True)
        field(path, task, "command", str, required=True)
        field(path, task, "cron", str, required=True)
        field(path, task, "payload", dict)
        if "catch_up" in task:
            if isinstance(task["catch_up"], bool):
                failures.append(
                    f"{path}.catch_up: {task['catch_up']!r} is a boolean — the contract is the "
                    f"string enum {list(CATCH_UP_VALUES)} (ADR-0011)"
                )
            else:
                expect(f"{path}.catch_up", task["catch_up"], str, CATCH_UP_VALUES)


def check_setup(m: dict) -> None:
    """The onboarding-checklist item this module contributes (ADR-0063, extended by hub#369).

    Everything asserted here is a rule the JSON Schema cannot state: that the query is one this
    module really declares, that the permission is one it really owns, and that the slot is the
    one the core handed out.
    """
    if "setup" not in m:
        failures.append(
            "setup: missing — without it `taxes` contributes no item to `hub.setup.status`, "
            "and a hub whose VAT rules do not match its country is asked for nothing"
        )
        return
    setup = m["setup"]
    if not expect("setup", setup, dict):
        return

    query = field("setup", setup, "query", str, required=True)
    field("setup", setup, "params", dict)
    title = field("setup", setup, "title", str, required=True)
    field("setup", setup, "description", str)
    field("setup", setup, "icon", str)
    route = field("setup", setup, "route", str, required=True)
    permission = field("setup", setup, "permission", str)
    order = field("setup", setup, "order", int)

    # `required` maps to 🔴 functional / 🟡 recommended and NEVER to ⛔ blocking (the core owns
    # that list). It is declared explicitly because since hub#369 a `false` is no longer omitted
    # from the checklist — leaving it implicit hides which of the two the module meant.
    if "required" not in setup:
        failures.append(
            "setup.required: declare it explicitly — `false` is no longer omitted from the "
            "checklist (hub#369), so the level this module claims must be written down"
        )
    else:
        expect("setup.required", setup["required"], bool)

    if "key" in setup:
        failures.append(
            "setup.key: must NOT be declared — the core derives it as `<module_id>.setup` so a "
            "manifest cannot rename itself out of the blocking list it does not own"
        )
    for unknown in sorted(set(setup) - SETUP_KEYS):
        failures.append(
            f"setup.{unknown}: not part of the contract, and the canonical schema declares "
            f"`additionalProperties: false` — the module would not install"
        )

    # The query has to be this module's own, and it has to exist: the runtime runs it through the
    # dispatcher, and a name nothing declares is a `QueryNotFound` that silently drops the item.
    if isinstance(query, str):
        if not query.startswith(f"{m.get('id')}."):
            failures.append(f"setup.query: {query!r} does not belong to this module")
        elif query not in (m.get("queries") or {}):
            failures.append(f"setup.query: {query!r} is not declared in `queries`")

    checks = setup.get("configured_when")
    if expect("setup.configured_when", checks, list):
        if not checks:
            failures.append(
                "setup.configured_when: empty means `having a row is the whole condition`, "
                "which for a COUNT query is always true — the item could never be pending"
            )
        for i, check in enumerate(checks):
            path = f"setup.configured_when[{i}]"
            if not expect(path, check, dict):
                continue
            field(path, check, "field", str, required=True)
            has = [
                k for k in ("truthy", "equals") if k in check and check[k] is not None
            ]
            if len(has) != 1:
                failures.append(
                    f"{path}: needs EXACTLY one of `truthy`/`equals` (has {has or 'neither'}); "
                    f"a check with neither never passes, so the item could never be done"
                )
            if "truthy" in check and check["truthy"] is not None:
                expect(f"{path}.truthy", check["truthy"], bool)
            for unknown in sorted(set(check) - {"field", "truthy", "equals"}):
                failures.append(f"{path}.{unknown}: not part of the contract")

    if isinstance(permission, str) and permission not in (m.get("permissions") or []):
        failures.append(
            f"setup.permission: {permission!r} is not one of this module's `permissions`"
        )
    if isinstance(route, str) and not route.startswith("/"):
        failures.append(f"setup.route: {route!r} is not an absolute route")
    if order is not None and order != RESERVED_SETUP_ORDER:
        failures.append(
            f"setup.order: {order} is not the slot the core reserved for `taxes` "
            f"({RESERVED_SETUP_ORDER}) — the scale belongs to the core, not to the module"
        )

    countries = setup.get("countries")
    if countries is not None and expect("setup.countries", countries, list):
        for i, code in enumerate(countries):
            if expect(f"setup.countries[{i}]", code, str) and len(code) != 2:
                failures.append(
                    f"setup.countries[{i}]: {code!r} is not an ISO-3166-1 alpha-2 code"
                )

    # English is the source language and every visible string ships with its Spanish translation
    # (ADR-0055). The runtime sends the manifest value as the fallback; the shell translates by
    # these keys.
    for key in ("title", "description"):
        if not setup.get(key):
            continue
        for lang in ("en", "es"):
            path = MODULE_DIR / "locales" / f"{lang}.json"
            if not path.exists():
                failures.append(f"locales/{lang}.json: missing")
                continue
            value = (json.loads(path.read_text()).get("setup") or {}).get(key)
            if not value:
                failures.append(
                    f"locales/{lang}.json: no `setup.{key}` — visible text ships in English "
                    f"AND Spanish, never hardcoded in one language only"
                )
            elif lang == "es" and value == setup[key]:
                failures.append(
                    f"locales/es.json: `setup.{key}` is still the English source string"
                )
    if isinstance(title, str) and not title.strip():
        failures.append("setup.title: empty")


def check_unknown_top_level(m: dict) -> None:
    for key in sorted(set(m) - KNOWN_TOP_LEVEL):
        warnings.append(
            f"{key}: not a block this test knows about — the canonical schema declares "
            f"`additionalProperties: false`, so either it is a typo or this list is stale"
        )


# ── Layer 2: the canonical JSON Schema, when it is reachable ─────────────────────────────


def schema_knows_the_setup_contract(schema: dict) -> bool:
    """Does this copy of the schema post-date hub#369? `countries`/`order` arrived with it, and
    the block declares `additionalProperties: false` — so an older copy would reject a manifest
    that is CORRECT against the contract. A false red is worse than a skip."""
    setup = (schema.get("properties") or {}).get("setup") or {}
    return "countries" in (setup.get("properties") or {})


def hub_checkout() -> pathlib.Path | None:
    # Dev workspace layout: <root>/modules-workspace/modules/<id>/ next to <root>/hub/.
    hub = MODULE_DIR.parents[2] / "hub"
    return hub if (hub / "schemas" / "module.schema.json").exists() else None


def load_canonical_schema() -> tuple[dict | None, str]:
    override = os.environ.get("ERPLORA_MODULE_SCHEMA")
    if override:
        path = pathlib.Path(override)
        if not path.exists():
            return None, f"ERPLORA_MODULE_SCHEMA points at {path}, which does not exist"
        return json.loads(path.read_text()), f"canonical schema applied: {path}"

    hub = hub_checkout()
    if hub is None:
        return (
            None,
            "hub/schemas/module.schema.json not found (set ERPLORA_MODULE_SCHEMA)",
        )

    path = hub / "schemas" / "module.schema.json"
    schema = json.loads(path.read_text())
    if schema_knows_the_setup_contract(schema):
        return schema, f"canonical schema applied: {path}"

    # The checkout is parked on a branch older than the contract. The schema is still versioned
    # in that repo, so read the one that DEFINES the contract instead of failing against a copy
    # that predates it.
    for ref in ("origin/develop", "origin/main"):
        try:
            raw = subprocess.run(
                ["git", "-C", str(hub), "show", f"{ref}:schemas/module.schema.json"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        except (OSError, subprocess.CalledProcessError):
            continue
        candidate = json.loads(raw)
        if schema_knows_the_setup_contract(candidate):
            return candidate, (
                f"canonical schema applied from {ref} — the hub working copy at {path} "
                f"predates hub#369 and does not know the `setup` contract yet"
            )
    return None, (
        f"SKIPPED canonical schema: no copy reachable from {hub} knows the hub#369 `setup` "
        f"contract (set ERPLORA_MODULE_SCHEMA to one that does)"
    )


def check_against_canonical_schema(m: dict) -> None:
    try:
        import jsonschema
    except ImportError:
        notes.append(
            "SKIPPED canonical schema: `jsonschema` is not installed (pip install jsonschema)"
        )
        return

    schema, note = load_canonical_schema()
    notes.append(note)
    if schema is None:
        return

    validator = jsonschema.Draft202012Validator(schema)
    for err in sorted(validator.iter_errors(m), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in err.absolute_path) or "<root>"
        failures.append(f"[schema] {where}: {err.message}")


# ── Layer 3: everything the manifest points at is in the package ─────────────────────────


def check_declared_files_exist(m: dict) -> None:
    declared: list[tuple[str, str]] = []

    for block in ("migrations", "seed"):
        for dialect, files in (m.get(block) or {}).items():
            if isinstance(files, list):
                declared += [
                    (f"{block}.{dialect}", f) for f in files if isinstance(f, str)
                ]

    for name, q in (m.get("queries") or {}).items():
        for key in ("sql", "schema"):
            if isinstance(q, dict) and isinstance(q.get(key), str):
                declared.append((f"queries.{name}.{key}", q[key]))

    for name, c in (m.get("commands") or {}).items():
        if not isinstance(c, dict):
            continue
        for rel in c.get("sql") or []:
            if isinstance(rel, str):
                declared.append((f"commands.{name}.sql", rel))
        if isinstance(c.get("schema"), str):
            declared.append((f"commands.{name}.schema", c["schema"]))
        handler = c.get("handler")
        if isinstance(handler, dict) and isinstance(handler.get("file"), str):
            declared.append((f"commands.{name}.handler.file", handler["file"]))

    if isinstance(m.get("ui"), dict) and isinstance(m["ui"].get("entry"), str):
        declared.append(("ui.entry", m["ui"]["entry"]))

    for where, rel in declared:
        if not (MODULE_DIR / rel).exists():
            failures.append(f"{where}: declares `{rel}`, which is not in the package")


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def main() -> int:
    raw = MANIFEST_PATH.read_text()
    try:
        manifest = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"FAILED — module.json is not valid JSON: {exc}")
        return 1

    check_identity(manifest)
    check_permissions(manifest)
    check_navigation(manifest)
    check_sql_blocks(manifest)
    check_events_and_slots(manifest)
    check_scheduled_tasks(manifest)
    check_setup(manifest)
    check_unknown_top_level(manifest)
    check_against_canonical_schema(manifest)
    check_declared_files_exist(manifest)

    for note in notes:
        print(f"  · {note}")
    for warning in warnings:
        print(f"  ! {warning}")
    print()

    if failures:
        print(f"FAILED — {len(failures)} contract violation(s) in module.json:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS — module.json v{manifest.get('version')} parses the way the runtime parses it"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
