# Taxes — Screens

The module contributes three tabs to the hub navigation: **Categories**, **Tax Rules** and
**Aliases**. It has no settings tab — the hub's country and region live in the hub settings, not
here.

## Categories

The canonical fiscal categories (`taxes.categories.list`, 50 rows per page). This is the list a
product or a service points at. Requires `taxes.view_tax`.

- **Search** by key, name or description.
- **Sort** by key, name, system flag or active flag. Default: key, ascending.
- **Filter** by key, name, system flag or active flag.

Each row shows the **key** — the stable string such as `restaurant.food` that everything else
references — plus its name and whether it is a **system** category (seeded at install, not
deletable) or one this hub added.

**System categories are shown in the hub's language.** They are seeded with an English name because
that is the source language of the data (ADR-0055), and the screens translate that label from the
category's key: a Spanish hub reads «Producto — general», never «Product — generic». The stored name
is not touched, and neither are the categories you create — those are yours and show exactly the text
you typed.

### Add a category

1. Open **Categories** and create a new one.
2. Give it a **key**: lowercase, starting with a letter, using letters, digits, dots and
   underscores — for example `product.books`. It must be unique in the hub.
3. Give it a readable name and, optionally, a description. Yours are shown exactly as you type
   them: only the seeded system categories carry a translated label.
4. Save.

A new category has no rate until you create a rule for it. Requires `taxes.manage_tax`.

## Tax Rules

Where the percentage lives (`taxes.rules.list`, 50 rows per page). Requires `taxes.view_tax`.

The three screens follow the effective permission: with `taxes.view_tax` only (the `employee` role)
they are **read-only** — no «+» in the bar, no *Deactivate* action, and a short notice explains why.
`taxes.manage_tax` (manager/admin) turns the full surface on. The runtime enforces the same
permission on every command regardless of what the screen shows.

- **Search** by country, region or category.
- **Sort** by country, region, category, rate, tax type, validity dates or active flag. Default:
  category, ascending.
- **Filter** by country, region, category, rate range, tax type, parent rule or active flag.

The list includes **components** as well as root rules — see [concepts.md](concepts.md).

### Create a rule

1. Open **Tax Rules** and create a new one.
2. Set the **country** (two letters, e.g. `ES`) and, if the rate differs inside the country, the
   **region** (e.g. `ES-CN` for the Canary Islands). Leave the region empty to cover the whole
   country.
3. Pick the **category** the rule applies to.
4. Enter the **rate** as a percentage between 0 and 100.
5. Pick the **tax type**: `vat`, `igic`, `ipsi`, `surcharge`, `sales_tax`, `withholding`, `excise` or
   `import_duty`. Default `vat`.
6. Optionally set **valid from** and **valid to** dates. Leaving them empty means "always".
7. Optionally set the **fiscal qualification**: whether the operation is `subject` (the default),
   `subject_reverse`, `exempt`, `not_subject` or `not_subject_location`. The **exemption reason**
   field only appears for an exempt rule (an opaque code of the jurisdiction, e.g. `E1` in Spain);
   the **regime** is optional. Any qualification other than *Subject* charges no tax, so the rate is
   set to 0 and locked. The list shows the qualification next to the rate, and can be filtered by it.
8. Save.

Requires `taxes.manage_tax`.

### Add a second tax on the same base (a component)

Some jurisdictions charge two taxes on the same amount — Spanish *recargo de equivalencia* on top of
VAT, for example.

1. Create the main rule first (VAT 21 %). That is the **root**.
2. Create a second rule for the same country, region and category. Once those three are set, the
   **Root rule** selector offers the root rules that match them and are valid today — pick the
   VAT 21 % one. Set the type to `surcharge` and the rate to the extra percentage (5,2 %). Ids are
   never typed: a rule that would be rejected by the server (other country, region or category,
   or already a component) is simply not offered.
3. Give it a **component label** so the breakdown can name it.

Both then apply to the same base and the sale shows a combined rate. Components must be created one
at a time.

### Set up a Canary Islands (IGIC) or Ceuta / Melilla (IPSI) hub

Nothing is seeded for these territories on purpose: the per-category rates depend on the business
and its heading, and a made-up number would be taken as valid and declared. They are created from
this screen (Settings → Taxes → Tax Rules), one rule per category the hub sells:

1. Make sure the hub's **fiscal identity** (Settings → Business) has country `ES` and region
   `ES-CN` (Canary Islands), `ES-CE` (Ceuta) or `ES-ML` (Melilla) — the engine resolves the rule
   with the region the hub sells from, and a regional rule wins over the national one.
2. Create a rule per category with **country** `ES`, the same **region** code, the **rate** the
   territory applies (e.g. IGIC general 7 %, reduced 3 %, zero 0 %) and **tax type** `igic` (or
   `ipsi`). Leave the qualification as *Subject* unless the operation is exempt.
3. Do **not** delete or deactivate the national VAT rules: they simply never match a hub whose
   region is set, and they keep working if the region is cleared.

Whoever files the return then sees IGIC/IPSI, not VAT, on every line — the tax type travels with the
snapshot the sale freezes.

### Create a whole country's rates at once

You can create several rules in one call — this is how "create the 2026 Spanish VAT rates" works when
you ask the assistant. Up to **100 rules** per call; invalid rows are skipped without aborting the
rest. **Components are not created this way**; add them individually afterwards.

### Retire a rule

Deactivate it. It stops applying to new transactions, and everything already issued keeps the rate it
froze. There is no "delete a rule" — see [concepts.md](concepts.md). Requires `taxes.manage_tax`.

### Repair a rule marked «must be 0 % for this class»

A rule whose class charges no tax — **exempt**, **not subject** or **reverse charge** — cannot carry
a rate, and since taxes#62 the screen refuses to save one. Rules saved before that check may still
have one (or a component with a rate hanging from such a rule). The till charges that rate, and the
invoice then refuses the sale, so it stays **charged without an invoice**.

The screen marks those rules: a warning above the table counts them across the whole hub, and the
rate of each one reads «21.00% · must be 0 % for this class». To fix one:

1. Tap **Repair** on the marked row (the action only appears on a page that has one).
2. Choose what you meant:
   - **No tax (0 %)** — the class was right: the rate becomes 0 %. On a root rule, its components'
     rates go to 0 % too.
   - **Charge the rate** — the rate was right: the rule becomes **subject** and the exemption reason
     is dropped. Only offered when the rule's own class is the problem.
3. New sales of that category are invoiced normally. Past sales and issued invoices do not change.

Requires `taxes.manage_tax`. The assistant can do the same (`taxes.rules.repair`) — ask it «why is
this sale not invoiced?».

## Aliases

The translation table that lets a CSV import understand words that are not canonical keys
(`taxes.aliases.list`, 50 rows per page). Requires `taxes.view_tax`.

- **Search** by alias or category.
- **Sort** by alias, category, source or active flag. Default: alias, ascending.
- **Filter** by alias, category, source or active flag.

Each alias maps an external text to a canonical key — `prepared_food`, `food`, `pizza` and `meal` all
map to `restaurant.food`. The **source** says where it came from: `shipped` (seeded with the module)
or `learned` (taught during an import).

### How an alias gets learned

1. You import a product CSV in `inventory`. Its tax column says something like `comida`.
2. The importer asks this module to resolve that text.
3. If there is no alias for it, the hub asks you which category it means.
4. Your answer is persisted as a `learned` alias, and every future import understands it.

You can also add one by hand. Requires `taxes.manage_tax`.

## Calculating a tax

The module exposes a pure calculation used by the till and by invoices — it writes nothing. Give it
an amount in cents, a category, a country and optionally a region, a date and whether the amount is
gross or net; it returns the base, the tax, the total, the combined rate, the fiscal qualification
and the per-component breakdown. Requires `taxes.calculate_tax`, which even an employee has.

## First-run setup

Taxes contributes a **required** setup step called **"Your taxes"**: *Set the VAT rates for the
country you sell in, so the till can price a sale.* It points at the Tax Rules screen and is
considered done once at least one active, currently valid root rule matches the hub's fiscal country.
It needs `taxes.manage_tax`.

Zero matching rules means the till cannot price a sale — that is why the step is required and why it
comes early.
