-- Creates a tax rule. The runtime injects :new_id, :hub_id, :current_user_id, :now.
-- A ROOT rule carries :parent_id NULL; a COMPONENT (the recargo de equivalencia, e.g.) hangs from
-- its root through :parent_id.
--
-- THE INSERT IS CONDITIONAL (taxes#9). It used to take whatever `:parent_id` arrived, checking
-- nothing: not that the parent existed, nor that it belonged to this hub, nor that it was a ROOT,
-- nor that it shared jurisdiction and category with the child.
--
-- That is not cosmetic: the combined rate is the SUM of the components of the resolved root
-- (`rule_components`). A component hanging from a root of another jurisdiction **adds its points to
-- a tax that is not its own**, and that combined rate is what gets charged and declared.
--
-- It is the other half of hub#600: that one closed the READ side (the SDK no longer resolves a rule
-- of another region when none applies). This one closes the WRITE side — building an incoherent
-- hierarchy by hand.
--
-- The conditions (1-3 only apply when there is a parent):
--   1. the parent exists, belongs to THIS hub and is alive;
--   2. the parent is a ROOT (empty `parent_id`) — a component of a component would add twice and
--      nests a hierarchy the resolver does not model: it only looks one level down;
--   3. it shares `country_code`, `region_code` and `tax_category_key` with it;
--   4. with or without a parent, the validity range cannot run backwards;
--   5. a rule that charges no tax cannot carry a rate (taxes#59). `subject_reverse`, `exempt`,
--      `not_subject` and `not_subject_location` reach the AEAT WITHOUT a quota (S2/E*/N1/N2); with a
--      rate the till would charge it and the invoice would refuse to seal the sale
--      (`invoice.quota_on_non_subject_class`, invoice#83). Same for a component with a rate hanging
--      from such a root: its points would add a quota to an operation qualified as tax-free.
--
-- If any of that fails, the SELECT returns no row and the INSERT affects 0. The command declares
-- `expect_rows: {op: min, n: 1}`, so that is NOT a silent success: it rolls the transaction back and
-- returns `taxes.rule_incoherent`.
INSERT INTO taxes_rule
  (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type,
   operation_class, exempt_reason, regime_key,
   parent_id, component_label, valid_from, valid_to, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT
  :new_id, :hub_id, :country_code, :region_code, :tax_category_key, :rate_pct, COALESCE(:tax_type, 'vat'),
  COALESCE(:operation_class, 'subject'), :exempt_reason, :regime_key,
  :parent_id, :component_label, :valid_from, :valid_to, 1,
  0, :current_user_id, :current_user_id, :now, :now
WHERE
  -- A full validity range has to run forwards. Dates are ISO, so they compare as text (ADR-0007 §1).
  (COALESCE(:valid_from, '') = '' OR COALESCE(:valid_to, '') = '' OR :valid_from <= :valid_to)
  -- No rate on a class that charges no tax (taxes#59).
  AND (COALESCE(:operation_class, 'subject') = 'subject' OR :rate_pct = 0)
  AND (
    -- Root: no parent to check. The normal case.
    COALESCE(NULLIF(:parent_id, ''), '') = ''
    -- Component: the parent rules, and it has to be coherent.
    OR EXISTS (
         SELECT 1 FROM taxes_rule p
         WHERE p.id = :parent_id
           AND p.hub_id = :hub_id
           AND p.is_deleted = 0
           AND COALESCE(NULLIF(p.parent_id, ''), '') = ''
           AND p.country_code = :country_code
           AND COALESCE(p.region_code, '') = COALESCE(:region_code, '')
           AND p.tax_category_key = :tax_category_key
           -- No rate under a root that charges no tax (taxes#59).
           AND (p.operation_class = 'subject' OR :rate_pct = 0)
       )
  );
