# Taxes — Overview

## What this module does

Taxes is the fiscal layer of the whole hub. It holds three things: the **canonical categories** that
products and services point at, the **rules** that say what percentage applies to a category in a
given country and region, and the **engine** that resolves and computes the tax at the moment of
sale. Every other module delegates "how much tax and why" here instead of duplicating VAT logic.

It answers more than the rate. It also says **how the operation is qualified** — subject, exempt,
not subject, reverse charge — under which regime and for what legal reason. A rate alone is not
enough to declare an invoice.

## What this module does NOT do

- **It does not store the hub's fiscal identity.** The country, region, tax mode, currency and
  timezone the hub sells under live in the hub settings; this module only reads them.
- **It does not decide the tax of a product.** The product decides which **category** it belongs to;
  this module decides what that category costs, here, today.
- **It does not build the tax breakdown of an invoice.** It computes a line; grouping lines into a
  fiscal breakdown belongs to `invoice`.
- **It does not translate legal codes.** Exemption reasons and regime keys travel **opaque** — they
  are jurisdiction codes, and this module is multi-country. Turning them into an XML declaration is
  the job of the country's compliance module (`verifactu` for Spain).
- **It does not talk to any tax authority.**

## Modules it connects to

**Depends on nothing.** It installs alone and is free of any third-party API cost.

**Everything else depends on it.** `inventory`, `services` and `sales` all declare `taxes` as a
dependency, so installing any of them installs Taxes automatically.

- `inventory` and `services` store a `tax_category_key` on every product and service, and the hub
  **validates that key against this module before writing** — that is what replaces a physical
  foreign key between modules.
- `sales` and `invoice` resolve the rate through the rule catalogue this module publishes, and freeze
  the result on the line.

**Events it emits**

| Event | When |
|---|---|
| `taxes.category.created` | a fiscal category is created |
| `taxes.rule.created` | a tax rule is created |
| `taxes.rule.deactivated` | a rule is deactivated |
| `taxes.rule.activated` | a deactivated rule is brought back |
| `taxes.rule.repaired` | an incoherent rule is repaired (rate to 0 %, or made subject) |
| `taxes.alias.created` | an import alias is learned |

**Events it listens to** — none.

## What you get out of the box

Installing the module seeds the hub, and the seed is safe to re-run: it never overwrites a row you
edited.

- **6 canonical categories**, marked as system: `restaurant.food`, `restaurant.drink`,
  `restaurant.alcohol`, `restaurant.delivery`, `service.generic`, `product.generic`.
- **14 shipped aliases** so a CSV import understands words like `food`, `prepared_food` or `pizza`.
- **The Spanish VAT baseline**: general 21 %, reduced 10 %, super-reduced 4 %, and exempt.

## Where its numbers come from

- **Amounts are integer cents** (ADR-0123). You pass `10000` for 100,00 € and get cents back.
- **Rates are percentages**, between 0 and 100, stored on the rule.
- **Rounding is HALF_UP to the cent**, done on exact decimals — never on floating point.
