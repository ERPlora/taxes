-- Repairs ONE incoherent rule, chosen by the owner (taxes#63). The runtime injects :hub_id,
-- :current_user_id and :now.
--
-- Incoherent = a rate on a rule that charges no tax: its own class is not `subject`, or it is a
-- component hanging from a root whose class is not (same conditions as `rule_create.sql` §5 and the
-- `is_incoherent` column of `queries/rules_list.sql`). taxes#62 refuses them on create; this is the
-- way out for the rows saved BEFORE that guard. They are never rewritten blindly: the owner sees the
-- flag and picks the reading of the mistake.
--
-- `:mode` (optional, default `no_tax`):
--   · `no_tax`     — the class was right, the RATE was the mistake: the rate goes to 0. On a root it
--                    also clears the rates of its components (a surcharge under a tax-free root is the
--                    same mistake one level down).
--   · `charge_tax` — the rate was right, the CLASS was the mistake: the class goes to `subject` and
--                    the exemption reason is dropped; the rate stays. Only for a rule whose OWN class
--                    is the problem: a subject component under a tax-free root cannot be fixed by
--                    changing the component.
--
-- It updates in place instead of «deactivate + twin at 0 %»: `ix_tax_rule_root_natural` keys roots by
-- (hub, country, category, region, valid_from) INCLUDING deactivated rows, so the twin could not be
-- created. Issued invoices keep their snapshot (ADR-0085) and completed sales their lines, so the
-- past is untouched; only new sales resolve the repaired rule. `updated_by`/`updated_at` say who.
--
-- `:mode` is read ONCE, inside the COALESCE: that is the only shape of OPTIONAL bind the runtime
-- recognises (hub#1086); a second bare appearance would make it mandatory for every caller.
--
-- Nothing to repair — coherent, deleted, of another hub or unknown — matches no row, and the command
-- declares `expect_rows: {op: min, n: 1}`: that is `taxes.rule_not_incoherent`, never a silent success.
WITH m AS (SELECT COALESCE(CAST(:mode AS TEXT), 'no_tax') AS mode)
UPDATE taxes_rule r
SET rate_pct        = CASE WHEN (SELECT mode FROM m) = 'charge_tax' THEN r.rate_pct ELSE 0 END,
    operation_class = CASE WHEN (SELECT mode FROM m) = 'charge_tax' THEN 'subject' ELSE r.operation_class END,
    exempt_reason   = CASE WHEN (SELECT mode FROM m) = 'charge_tax' THEN NULL ELSE r.exempt_reason END,
    updated_by      = :current_user_id,
    updated_at      = :now
WHERE r.hub_id = :hub_id
  AND r.is_deleted = 0
  AND r.rate_pct > 0
  AND (
    -- The chosen rule itself.
    (r.id = :rule_id
     AND (r.operation_class <> 'subject'
          OR ((SELECT mode FROM m) = 'no_tax'
              AND EXISTS (SELECT 1 FROM taxes_rule p
                          WHERE p.id = r.parent_id AND p.hub_id = r.hub_id
                            AND p.is_deleted = 0 AND p.operation_class <> 'subject'))))
    -- `no_tax` on a tax-free root also clears its components. Only when the root itself is being
    -- repaired (it has a rate): the subqueries read the table as it was before this statement.
    OR ((SELECT mode FROM m) = 'no_tax'
        AND r.parent_id = :rule_id
        AND EXISTS (SELECT 1 FROM taxes_rule p
                    WHERE p.id = :rule_id AND p.hub_id = :hub_id AND p.is_deleted = 0
                      AND COALESCE(NULLIF(p.parent_id, ''), '') = ''
                      AND p.operation_class <> 'subject' AND p.rate_pct > 0))
  );
