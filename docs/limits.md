# Taxes — Limits and troubleshooting

## Errors you will actually see

| Error | What happened | What to do |
|---|---|---|
| `no_rate` | No active, currently valid rule matches this category, country, region and date | Create the rule, or check the product's category and the hub's fiscal country |
| Amount required | The calculation was called without an amount | The amount is mandatory and must be **integer cents** |
| Category key rejected | The key does not match the required shape or already exists | Keys are lowercase, start with a letter and may contain letters, digits, dots and underscores; they are unique per hub |
| Rate rejected | The percentage is outside 0–100 | A rate above 100 is not a rate. Combined rates are computed from components; do not store the sum |
| Category cannot be removed | Rules still point at it | Retire the rules first — the reference is protected on purpose |

When Sales cannot resolve a line it surfaces this as `sales.no_tax_rule` or
`sales.tax_rate_out_of_range`; the cause is here.

## Caps and sizes

| Limit | Value |
|---|---|
| Rules created per bulk call | 100 |
| Rows per page (categories, rules, aliases) | 50 |
| Maximum rows a paginated request may ask for | 500 |
| Rate | 0–100 % |
| Country code | exactly 2 characters |
| Region code | up to 10 characters |
| Category key | up to 80 characters, pattern `^[a-z][a-z0-9_.]*$` |
| Component label | up to 120 characters |
| Exemption reason, regime key | up to 10 characters each |

In a bulk creation, **invalid rows are skipped and the rest still go through** — check the result
rather than assuming all 100 landed. Components cannot be created in bulk.

## Permissions per action

| To do this | You need |
|---|---|
| See categories, rules and aliases | `taxes.view_tax` |
| Create a category, create, deactivate, reactivate or repair a rule, create an alias | `taxes.manage_tax` |
| Calculate a tax | `taxes.calculate_tax` |

By role: **admin** has everything. **manager** has all three. **employee** can **see and calculate**
but cannot manage — an employee cannot create a category, a rule or an alias.

Note that calculating is deliberately available to an employee: every sale needs it.

## Dependencies — what breaks if something is missing

**Taxes depends on nothing.** It is the bottom of the stack.

**You cannot uninstall Taxes while `inventory`, `services` or `sales` are installed.** All three
declare it as a dependency and installing any of them installs it. Without it:

- no product or service can validate its tax category;
- no sale line can resolve a rate, so the till refuses to charge;
- no invoice can build a fiscal breakdown.

It is free of any third-party cost, so the automatic installation has no billing implication.

**The hub's fiscal identity is a hard input.** The country and region come from the hub settings. If
they are wrong or unset, rules will not match even though they exist.

## When something looks wrong

**"The till says there is no tax rule."** In this order: does the hub's fiscal **country** match the
country on your rules? Does the product's **category** have a rule at all? Is the rule **active** and
**currently valid** (check `valid_from` / `valid_to`)? Is it a **root** rule — a lone component with
no parent never resolves on its own?

**"The rate is right for the mainland but wrong in the Canary Islands."** Regional rules must exist
explicitly. With no regional rule, the engine falls back to the country-wide one and charges the
national rate. And remember the Canaries charge **IGIC**, not VAT — that is a different tax type.

**"I changed the VAT and old invoices did not change."** Correct, and required. Every line freezes its
own tax when the document is issued. If you wanted the old documents to change, the answer is a
rectifying invoice, not editing a rule.

**"I changed the VAT and new sales still use the old rate."** The old rule is probably still active.
Deactivate it, or close it with a `valid_to` and create the new one with a `valid_from`.

**"The surcharge is being charged on top of the VAT amount."** It is not. A component applies to the
**same base** as its root. Check that the component's parent is set — a component with no parent is
just another root rule and will not combine.

**"A total is off by one cent."** On a gross amount the base is rounded and the tax is taken as the
difference, so the amount charged never moves. If a figure looks off, check whether you are comparing
against a net-based calculation of the same price.

**"I cannot delete a category."** System categories are never deletable, and any category with rules
pointing at it is protected. Deactivate it instead.

**"An import keeps asking me what a tax column means."** The answer is stored as a learned alias only
if it was actually saved. Check the Aliases screen; add it by hand if it is missing.
