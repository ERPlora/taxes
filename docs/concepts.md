# Taxes — Concepts

The things people get wrong on their first day.

## Two entities: the category and the rule

This separation is the whole design, and confusing them is the root of most questions.

- **A category** is *what kind of thing this is*, fiscally. `restaurant.food`, `service.generic`,
  `product.generic`. It is a **stable string** and it is what a product or a service stores.
- **A rule** is *what that costs, here, now*. It is keyed by country + region + category + validity
  dates, and it carries the percentage.

**A product never stores a percentage.** It stores a category key. That is why raising VAT is one
edit to one rule instead of a mass update of ten thousand products — and why a product created in
Spain still makes sense if you also sell in France.

## The rate comes from the hub's country, not the customer's

The rule is resolved with **the country and region the hub sells from**, taken from the hub's fiscal
identity. It is not taken from the customer's address and it is not taken from what the till
proposes.

If no rule matches with a region, the engine falls back to the country-wide rule (the one with no
region). A Canary Islands hub therefore needs its own regional rules, or it will silently price with
the national ones.

## Root rules and components: two taxes on one base

A rule with no parent is a **root** — the main tax, e.g. VAT 21 %. A rule that points at a root is a
**component** — an extra tax charged **on the same base**, e.g. *recargo de equivalencia* 5,2 %.

- Both apply to the same base; components do not stack on top of the tax.
- The sale sees a **combined rate** (21 + 5,2 = 26,2) and a breakdown listing each component.
- The **fiscal qualification always comes from the root**. A surcharge adds an amount to the same
  operation; it does not turn half the line into a different kind of operation.

## The rate is not the whole answer — the qualification is

Every rule also carries how the operation is qualified:

| `operation_class` | Meaning |
|---|---|
| `subject` | Normal taxable operation (the default) |
| `subject_reverse` | Taxable, but the buyer self-assesses (reverse charge) |
| `exempt` | Exempt, with a legal reason |
| `not_subject` | Outside the scope of the tax |
| `not_subject_location` | Outside scope because the place of supply is elsewhere |

Plus an **exemption reason** and a **regime key** when the jurisdiction requires them.

This lives on the **rule**, not on the category, and that is deliberate: the rule is already keyed by
country, region, category and validity — exactly the tuple in which this changes. A medical treatment
is exempt in Spain and need not be somewhere else.

These codes travel **opaque**. This module never interprets them; the country's compliance module
does.

## `igic` and `ipsi` are tax families, not regimes

The tax type says which tax it is: `vat`, `igic` (Canary Islands), `ipsi` (Ceuta and Melilla),
`surcharge`, `sales_tax`, `withholding`, `excise`, `import_duty`.

A hub in the Canary Islands does **not** charge VAT — it charges IGIC. Whoever files the return needs
to know which of the two it was, so this is modelled as a different tax, not as a special case of
VAT.

## Rules are deactivated, never deleted

There is no delete. Deactivating a rule stops it applying to **new** transactions, and everything
already issued keeps the rate and qualification it froze at the time.

This is the point: **a sale or an invoice snapshots its tax on the line.** Changing or retiring a rule
tomorrow cannot alter a document from yesterday. The line stores the category, the resolved rate, the
country, the region and the rule that produced it.

If a rate changes on a date, do not edit the old rule. Set its **valid to** and create a new one with
the new **valid from**. The history stays correct.

## System categories cannot be deleted

The six categories seeded at install are marked as system. They are the vocabulary the rest of the
product speaks; removing one would orphan every product pointing at it. Categories you add yourself
are ordinary.

Also, a rule points at a category with a **restrict** rule: you cannot remove a category that still
has rules. Components, on the other hand, disappear with their root — deleting a root cascades to the
taxes hanging off it.

## Gross or net: the amount charged never moves

When you compute tax on a **net** amount, the base is the amount and the tax is added on top, so
everything adds up by construction.

When you compute on a **gross** amount — the normal case at a B2C till, where the price on the shelf
is what the customer pays — the engine works backwards: the base is the gross divided by one plus the
combined rate, rounded to the cent, and **the tax is the difference** between the gross and that base.

That is why the total you charge is never off by a cent after a breakdown: the tax absorbs the
rounding, not the price.

## Rounding is HALF_UP, on exact decimals, to the cent

All money is **integer cents**, and every intermediate multiplication is done in exact decimal
arithmetic before being rounded HALF_UP to the cent. There is no floating-point money anywhere in
this module.

## Aliases exist for imports, not for selling

An alias maps free external text to a canonical key. It is used when data comes from outside — a CSV
column that says `pizza`. Nothing in the selling path uses aliases; a product always stores a real
key.

An alias is `shipped` (came with the module) or `learned` (you taught it during an import). Aliases
are matched lowercased and trimmed, and each one is unique per hub.

## No rate found is an error, not a zero

If nothing matches the category, country, region and date, the calculation **fails** with a
"no rate" error rather than quietly charging 0 %. A caller can explicitly ask for 0 % to be used
instead, but that has to be asked for. Silent zero VAT is a fine you notice months later.
