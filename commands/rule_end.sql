-- Sets the last day a tax rule is in force (`valid_to`), so an owner can schedule a rate change:
-- end the rule in force the day before the next one starts, then create the new rule from that day
-- with `taxes.rules.create`. Dates are inclusive ISO text, compared as text (ADR-0007 §1) — the
-- day itself still applies.
--
-- The WHERE clause is what makes `expect_rows` honest: a rule of another hub, an already-deleted
-- one, or an end date BEFORE the rule's own start (`valid_from <= :valid_to` fails) touches 0 rows,
-- so the command reports `taxes.rule_end_invalid` instead of a silent no-op on a row that did not
-- move. `COALESCE(valid_from, '') = ''` covers an open-ended `valid_from` (valid since forever, so
-- any end date is on or after it).
--
-- Pushing the new end date into the next rule of the same slot is NOT refused here: that is the job
-- of the later `commands/_rule_overlap_assert.sql` statement of this same command, which rolls the
-- whole transaction back (including this UPDATE) with `taxes.rule_overlaps` when the row this
-- command just wrote now overlaps an active rule of the same country, region and tax category.
--
-- Issued invoices keep the tax they froze on their line (ADR-0085): ending a rule never touches a
-- document already emitted, only which rate applies to transactions from here on.
--
-- NULL-safe equality is spelled with COALESCE, not `IS NOT DISTINCT FROM` — the hub's
-- table-ownership guard anchors on `FROM`, and that form trips it.
UPDATE taxes_rule
SET valid_to = :valid_to,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :rule_id AND hub_id = :hub_id AND is_deleted = 0
  AND (COALESCE(valid_from, '') = '' OR valid_from <= :valid_to);
