#!/usr/bin/env python3
"""Every filter box of this module has to mean what it looks like (taxes#44, ERPlora/hub#1182).

A column header carries a promise: a free-text box says «type a piece of it», a dropdown says
«choose one of these». The manifest is what actually happens — `op: "like"` narrows by fragment,
`op: "eq"` demands the whole value, and a column the `list` block never declares is a box that does
**nothing at all**. When the two disagree the user gets no error: the list simply empties, or the
typing is ignored, and there is nothing on screen to explain it.

The runtime is explicit about the silence. `hub/crates/runtime/src/queries.rs`
(`reject_undeclared_params`) keeps the `f_*` namespace OUT of its 422 on purpose, naming hub#1182:
an undeclared `f_<col>` is dropped, not rejected, because turning it into an error would swap «the
filter does nothing» for «the table breaks». What fixes it is declaring the filter here. The sort
whitelist is a second, quieter door in the same file: a `sort` outside `list.sort` falls back to
`default_sort`, so the header sorts by something else entirely and looks like it worked.

taxes#44 came out of the hub#1182 sweep of the 27 module repos with ONE column named
(`display_description`). Fixing that one by hand and moving on is what leaves the next one alive:
this same check, run over every table of the module, finds three more boxes that already lie. So it
lives here, reads EVERY table, and stays. Same gate as `inventory` (inventory#74).

## The rules, and why each one

| The box says | The manifest must say | Because |
|---|---|---|
| `filterType: 'text'` | `op: 'like'` | a free-text box invites a fragment; `eq` empties the list unless the user types the value whole |
| `filterType: 'select'` | `op: 'eq'` | a closed domain is CHOSEN, and the value chosen is exact — `like` would silently match one value inside another |
| `filterType: 'range'` / `'daterange'` | `op: 'range'` | two bounds need the operator that takes two bounds |
| `filterable: true` | the column IS in `list.filters` | otherwise the runtime drops the `f_<col>` parameter and the box does nothing (hub#1182) |
| `sortable: true` | the column IS in `list.sort` | the sort whitelist is a SECOND door: a header outside it does not sort, silently |

The pairs (screen → query) are DISCOVERED from the source, not listed here: a new table has to be
covered by this gate the day it is written, without anybody remembering to add it.

THE CUT. A column is read from its OWN `{…}` object and no further (taxes#54). The slice used to be
`split("key: '")`, and the slice of the LAST column ran to the end of the file — methods, comments
and docstrings included —, so a `filterType: '…'` merely NAMED down there was read as a box that
column painted and the gate failed on a filter nobody had drawn. False RED, not false green: loud
rather than silent, but it still cost the next person who wrote such a comment a full triage.
`parser_reads_one_column_at_a_time` pins it, with every case putting the poison AFTER the last
column, which is the one place the old cut reached.

REMAPS. A screen may legitimately paint a box on one key and send another. None of the three tables
of this module does that today, so `REMAPPED` is empty — it is kept because the day one does, the
declaration is where it gets checked, instead of the gate being weakened to let it through.

Usage: tests/filter_boxes_match_the_manifest.contract.test.py   (exit 0 = green)
  No Postgres, no Docker: it reads the manifest and the Web Components.
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text(encoding="utf-8"))

#: What the manifest has to declare for each kind of box the table paints.
EXPECTED_OP = {
    "text": "like",
    "select": "eq",
    "range": "range",
    "daterange": "range",
}

#: Why each one, in the words the failure message uses.
WHY = {
    "text": "a free-text box invites a FRAGMENT; with `eq` anything short of the whole value empties the list",
    "select": "a closed domain is CHOSEN, so the match is exact; `like` would match the value inside another one",
    "range": "two bounds need the operator that takes two bounds",
    "daterange": "two bounds need the operator that takes two bounds",
}

#: `(query, painted column) -> the filters the screen really writes`. See REMAPS above.
REMAPPED: dict[tuple[str, str], tuple[str, ...]] = {}

#: How many list screens this module has today (categories, aliases, rules). The floor is the check
#: on the check: if the discovery stops finding them, a broken sweep would pass by knowing nothing.
SCREENS_TODAY = 3

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def components():
    """Every Web Component of the module that drives a paginated `list` query, and its query.

    Discovered, never listed: `createListController(erplora(), '<query>', …)` is the one way a
    screen binds itself to a list, so a new table cannot be born outside this gate.
    """
    found = []
    for path in sorted((MODULE_DIR / "ui/components").rglob("*.ts")):
        if path.name.endswith(".test.ts"):
            continue
        src = path.read_text(encoding="utf-8")
        for query in re.findall(
            r"createListController[^(]*\(\s*erplora\(\)\s*,\s*'([^']+)'", src
        ):
            found.append((path, query, src))
    return found


#: A column whose object never closes. The source could not be read, and a gate that cannot read
#: its input has to say so instead of sweeping half a file and calling it green (taxes#54).
UNCLOSED = object()


def _string_end(src: str, i: int, quote: str) -> int | None:
    """Index just past the `'…'`/`"…"` literal opening at `i`; `None` if it never closes on its line.

    A brace inside quotes is text, not structure. A quote that does not close before the newline is
    a read the scanner cannot trust, and that is reported (UNCLOSED), never guessed.
    """
    i += 1
    while i < len(src):
        char = src[i]
        if char == "\\":
            i += 2
            continue
        if char == quote:
            return i + 1
        if char == "\n":
            return None
        i += 1
    return None


def _template_end(src: str, i: int) -> int | None:
    """Index just past the closing backtick of the template literal opening at `i`; `None` if it never closes.

    Its text may hold any brace it likes; only a `${…}` is code, and that code is scanned like the
    rest of the column (so an inner template — a Lit `render` — nests cleanly).
    """
    i += 1
    while i < len(src):
        char = src[i]
        if char == "\\":
            i += 2
            continue
        if char == "`":
            return i + 1
        if char == "$" and src.startswith("{", i + 1):
            close = _closing_brace(src, i + 2)
            if close is None:
                return None
            i = close + 1
            continue
        i += 1
    return None


def _closing_brace(src: str, start: int) -> int | None:
    """Index of the `}` that closes the object already open before `start`; `None` if it never closes.

    Braces are balanced, so the nested objects a column legitimately carries (`options: [{…}]`) do
    not end it early. Strings, template literals and comments are skipped whole: a brace written as
    TEXT — `header: '}'`, a `${…}` with a template inside, a `}` in a remark — is not structure, and
    an apostrophe in a comment does not open a string.
    """
    depth = 0
    i = start
    n = len(src)
    while i < n:
        char = src[i]
        if char == "/" and src.startswith("/", i + 1):
            newline = src.find("\n", i)
            i = n if newline < 0 else newline
            continue
        if char == "/" and src.startswith("*", i + 1):
            close = src.find("*/", i + 2)
            if close < 0:
                return None
            i = close + 2
            continue
        if char in "'\"":
            after = _string_end(src, i, char)
            if after is None:
                return None
            i = after
            continue
        if char == "`":
            after = _template_end(src, i)
            if after is None:
                return None
            i = after
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            if depth == 0:
                return i
            depth -= 1
        i += 1
    return None


def _column_body(src: str, start: int) -> str | None:
    """The text of ONE column object: from `start` up to the `}` that closes it, and no further.

    `None` means the object never closed — a parse failure, never a green. Braces inside strings,
    template literals and comments are text, not structure: see `_closing_brace`.
    """
    close = _closing_brace(src, start)
    return None if close is None else src[start:close]


def declared_columns(src: str):
    """`(column, filterType|None, filterable, sortable)` for every column the component paints.

    Each column is read from ITS OWN `{…}` object. The cut used to be `src.split("key: '")`, whose
    last slice ran to the end of the file: see `parser_reads_one_column_at_a_time` (taxes#54).
    """
    out = []
    for match in re.finditer(r"key: '([^']*)'", src):
        body = _column_body(src, match.end())
        if body is None:
            out.append((match.group(1), UNCLOSED, False, False))
            continue
        kind = re.search(r"filterType: '(\w+)'", body)
        out.append(
            (
                match.group(1),
                kind.group(1) if kind else None,
                "filterable: true" in body,
                "sortable: true" in body,
            )
        )
    return out


#: The check on the CUT (taxes#54). Every case puts the poison AFTER the last column, which is the
#: one place a slice that runs to the end of the file reaches: a comment, a docstring or a method
#: that merely NAMES `filterType: '…'` or `filterable: true` is not a box anybody painted. A gate
#: that goes back to cutting until EOF turns these red, and so does one that cuts too early and
#: stops at the first nested `}`.
PARSER_CASES: tuple[tuple[str, str, list], ...] = (
    (
        "a `filterType` named BELOW the array is nobody's box",
        """
    const columns = [
      { key: 'name', header: h('name'), filterable: true, filterType: 'text' },
      { key: 'is_active', header: h('active'), sortable: true },
    ];
  }

  /** `ok-data-table` paints a `filterType: 'text'` as an `ion-input` with no dropdown. */
  private get help(): string { return ''; }
""",
        [("name", "text", True, False), ("is_active", None, False, True)],
    ),
    (
        "a `filterable: true` named BELOW the array does not turn the last column into a box",
        """
    const columns = [
      { key: 'code', header: h('code'), sortable: true },
      { key: 'is_active', header: h('active') },
    ];
  }

  // The `is_system` column of the other table is `filterable: true` and `sortable: true`.
""",
        [("code", None, False, True), ("is_active", None, False, False)],
    ),
    (
        "a column that nests objects is read whole, PAST the nesting, up to ITS OWN closing brace",
        # What the column declares sits AFTER the `options` array on purpose: an attribute written
        # before the nesting is still visible to a cut that stops at the first `}`, so it would not
        # tell the two apart. Only a positive placed past the nested region does.
        """
    const columns = [
      {
        key: 'is_active',
        header: h('active'),
        options: [
          { value: '1', label: h('yes') },
          { value: '0', label: h('no') },
        ],
        filterable: true,
        filterType: 'select',
        sortable: true,
        format: (r) => String(r.is_active),
      },
    ];
  }

  // Below the array: filterType: 'range' belongs to no column at all.
""",
        [("is_active", "select", True, True)],
    ),
    (
        "a column whose object never closes is UNREADABLE, not a slice of whatever came after",
        "    const columns = [\n      { key: 'orphan', filterable: true, filterType: 'text'\n",
        [("orphan", UNCLOSED, False, False)],
    ),
    (
        "a brace inside a STRING is text, not the end of the column (rv taxes#58)",
        # The permissive direction: a cut that stops at the `}` inside `header` never sees the
        # `filterable`/`filterType` written after it, and the column drops out of the sweep with
        # nobody the wiser. The old EOF cut did see them, so this is the one regression the balance
        # could introduce, and it has to stay red for a scanner that counts braces inside quotes.
        """
    const columns = [
      { key: 'unit', header: '}', filterable: true, filterType: 'text' },
      { key: 'note', header: "{", sortable: true },
    ];
  }

  // Below the array: filterType: 'range' belongs to no column at all.
""",
        [("unit", "text", True, False), ("note", None, False, True)],
    ),
    (
        "an apostrophe in a COMMENT inside the column is prose, not an open string",
        # The other way round: once quotes are honoured, a `'` in a comment must not swallow the
        # rest of the object, or the fix for the false red hands out a new one.
        """
    const columns = [
      {
        key: 'owner',
        // the user's choice, kept as they typed it
        /* and a block comment with a stray } and a ' too */
        filterable: true,
        filterType: 'text',
      },
    ];
  }
""",
        [("owner", "text", True, False)],
    ),
    (
        "a template literal is read whole: `${…}` nests code, and its own text may hold a brace",
        # `ok-data-table` renders are Lit templates: a `${…}` can hold another template, and that
        # inner template's text can hold a `}`. The column ends at ITS brace, not at that one.
        """
    const columns = [
      {
        key: 'state',
        render: (r) => html`<b>${r.ok ? html`<i>}</i>` : ''}</b>`,
        format: (r) => `{${r.state}}`,
        filterable: true,
        filterType: 'select',
      },
    ];
  }
""",
        [("state", "select", True, False)],
    ),
    (
        "a quote that never closes on its line makes the column UNREADABLE, not a body pieced together from the lines below",
        # A stray `'` (a regex literal, say) is a read the scanner cannot trust. Carrying the string
        # across the newline would resync on the apostrophe in the comment below and hand `left`
        # the `filterable` of a column that is not its own — with the sweep still green.
        """
    const columns = [
      { key: 'left', header: 'unterminated
        filterable: true, filterType: 'text' },
      { key: 'right', sortable: true },
      // the user's choice
    ];
  }
""",
        [("left", UNCLOSED, False, False), ("right", None, False, True)],
    ),
)


def parser_reads_one_column_at_a_time() -> list[str]:
    """The check on the cut: what a column declares has to come from ITS OWN object.

    taxes#54. The slice used to be `src.split("key: '")`, so the slice of the LAST column ran to the
    end of the file — methods, docstrings and comments included — and a `filterType: '…'` written
    anywhere below the array was read as a box that column painted. The gate then failed on a filter
    nobody had drawn: a false RED, loud instead of silent, but it still costs the next person who
    writes such a comment a full triage (#53 dodged it by rewording a docstring).

    It is ruled out on synthetic sources on purpose: the poison has to sit AFTER the last column,
    and no real component is obliged to keep a comment like that around for the gate's benefit.
    """
    broken = []
    for name, src, expected in PARSER_CASES:
        got = declared_columns(src)
        if got != expected:
            broken.append(f"{name}\n      expected {expected}\n      got      {got}")
    return broken


def check(path, query, src) -> None:
    screen = path.relative_to(MODULE_DIR)
    spec = MANIFEST["queries"].get(query)
    if spec is None:
        fail(f"{screen} drives `{query}`, which the manifest does not declare")
        return
    block = spec.get("list") or {}
    if not block:
        fail(f"`{query}` has no `list` block, but {screen} paginates it")
        return
    filters = block.get("filters") or {}
    sortable_whitelist = set(block.get("sort") or [])

    for column, kind, filterable, sortable in declared_columns(src):
        if kind is UNCLOSED:
            fail(
                f"{screen} declares a `{column}` column whose object never closes: this gate cannot "
                f"tell what box it paints, and a gate that cannot read does not get to pass"
            )
            continue
        remap = REMAPPED.get((query, column))
        if remap:
            # The box does not feed its own key: check the columns it really writes instead.
            for target in remap:
                if target not in filters:
                    fail(
                        f"{screen} routes the `{column}` box to `{target}`, which `{query}` does not "
                        f"declare as a filter: the runtime drops `f_{target}` and that choice does nothing"
                    )
        elif filterable and column not in filters:
            fail(
                f"{screen} paints a filter box on `{column}` but `{query}` declares no filter for it: "
                f"the runtime drops the parameter and the box does nothing (hub#1182)"
            )
        elif kind:
            op = (filters.get(column) or {}).get("op")
            expected = EXPECTED_OP.get(kind)
            if expected is None:
                fail(
                    f"{screen} paints `{column}` as `filterType: '{kind}'`, which this gate does not know — teach it"
                )
            elif op != expected:
                fail(
                    f"{screen} paints `{column}` as `filterType: '{kind}'` but `{query}` filters it with "
                    f"`op: {op!r}` (expected `{expected}`) — {WHY[kind]}"
                )
        if sortable and column not in sortable_whitelist:
            fail(
                f"{screen} paints `{column}` as sortable but `{query}` does not whitelist it in `list.sort`: "
                f"clicking that header does nothing"
            )


def an_unreadable_column_stops_the_gate() -> str | None:
    """A column the gate could not parse has to fail IN ITS OWN WORDS (taxes#54).

    Without its own branch the sentinel leaks into the filter-type message and the screen reads
    «paints `orphan` as `filterType: '<object object at 0x…>'` — teach it», which sends the next
    person hunting for a filter type nobody ever wrote instead of for the brace that never closed.
    """
    listed = [q for q, spec in MANIFEST["queries"].items() if (spec or {}).get("list")]
    if not listed:
        return "no query of this module declares a `list` block, so this check cannot run"

    global failures
    kept, failures = failures, []
    try:
        check(MODULE_DIR / "ui/components/never-written.ts", listed[0], "{ key: 'orphan', ")
        got = list(failures)
    finally:
        failures = kept

    if len(got) != 1 or "never closes" not in got[0]:
        return f"expected exactly one «never closes» failure, got {got}"
    return None


def main() -> int:
    misread = parser_reads_one_column_at_a_time()
    if misread:
        print(f"FAIL ({len(misread)}): this gate misreads a column declaration, so its sweep means nothing:")
        for m in misread:
            print(f"  - {m}")
        return 1

    leaked = an_unreadable_column_stops_the_gate()
    if leaked:
        print(f"FAIL: an unreadable column does not stop this gate cleanly: {leaked}")
        return 1

    pairs = components()
    if len(pairs) < SCREENS_TODAY:
        print(
            f"FAIL: only {len(pairs)} list screen(s) discovered; this module has at least "
            f"{SCREENS_TODAY} (categories, aliases, rules). The discovery is broken, and a broken "
            "sweep passes."
        )
        return 1

    for path, query, src in pairs:
        check(path, query, src)

    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1

    covered = ", ".join(sorted({q for _, q, _ in pairs}))
    print(
        f"OK: every filter box and every sortable header of {len(pairs)} screen(s) matches what "
        f"the manifest concedes ({covered})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
