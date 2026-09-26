-- Refuses two ACTIVE root tax rules of the same slot being in force on the same day (taxes#66).
--
-- The market does not allow it either: Oracle E-Business Tax refuses a tax-rate period that
-- overlaps another one of the same rate code, Dynamics 365 refuses overlapping value intervals on
-- a sales tax code, and SAP never leaves two condition records valid at the same time for the same
-- key. Until this guard, ERPlora let the owner save «PT · general 23 %» open-ended and, on top of
-- it, «PT · general 25 % from 2027-01-01»: from that day two rules were valid for the same slot,
-- both listed as in force, and which one the till charged was decided by a tie-break the owner
-- never sees.
--
-- Runs as a LATER statement of the SAME command, after the write (`commands/rule_create.sql`,
-- `commands/rule_activate.sql` or `commands/_insert_rule.sql`). `me.updated_at = :now` pins the
-- check to "the row THIS command just wrote" — the runtime binds `:now` once per command, the
-- pattern `commands/_appointment_overlap_assert.sql` (module appointments) uses. A command whose
-- write did not apply — an incoherent rule rejected by `rule_create`'s own WHERE, or
-- `rule_activate`'s UPDATE touching 0 rows because the rule was already active or belongs to
-- another hub — leaves no row with that `:now`, so the gate stays green and this statement is a
-- no-op, never a false positive.
--
-- WHY A UNIQUE INDEX AND NOT A CHECK (the `appointments__gate` shape): the runtime renames only a
-- UNIQUE violation into a module code (`on_unique`, hub#2081); a CHECK violation would reach the
-- owner as a bare database error. So the literal 'rule_overlaps' is selected TWICE (from a two-row
-- constant set) only when an overlap EXISTS: no overlap -> 0 rows -> nothing happens; overlap -> 2
-- identical rows -> the second violates the UNIQUE index on `taxes__gate(gate)` -> 23505 -> the
-- command's `on_unique` maps it to `taxes.rule_overlaps` -> the whole command transaction rolls
-- back, INCLUDING the row this command's own write just inserted or updated.
-- `taxes__gate` itself never keeps a row: the only INSERT that ever reaches it happens inside a
-- transaction that is always rolled back by the violation.
--
-- Legacy rows that already overlapped before this guard shipped are NEVER touched by it: `me` is
-- restricted to the row THIS command wrote (`me.updated_at = :now`), so an old overlapping pair
-- sitting untouched in the table never enters the EXISTS and never blocks an unrelated write.
--
-- NULL-safe equality is spelled with COALESCE, as in migration 004: `IS NOT DISTINCT FROM` trips
-- the hub's table-ownership guard, which anchors on `FROM`.
--
-- Slot = same hub, country, region (empty = whole country), tax category, both ROOTS (a component
-- shares its root's slot BY DESIGN, taxes#9, and never collides with it here) and both ACTIVE.
-- Validity is inclusive ISO text: empty/NULL `valid_from` = since forever, empty/NULL `valid_to` =
-- forever (dates compare as text, ADR-0007 §1). Contiguous ranges (one ends 2026-12-31, the next
-- starts 2027-01-01) do NOT overlap — that is the legal way to change a rate, and a guard that
-- refused it would make the change impossible.
--
-- No binds besides :hub_id and :now — everything else comes from the row the write just produced.
INSERT INTO taxes__gate (gate)
SELECT 'rule_overlaps'
FROM (SELECT 1 AS n UNION ALL SELECT 2 AS n) AS twice
WHERE EXISTS (
  SELECT 1
  FROM taxes_rule me
  JOIN taxes_rule o
    ON o.hub_id = me.hub_id
   AND o.id <> me.id
   AND o.is_deleted = 0
   AND o.is_active = 1
   AND COALESCE(NULLIF(o.parent_id, ''), '') = ''
   AND o.country_code = me.country_code
   AND COALESCE(o.region_code, '') = COALESCE(me.region_code, '')
   AND o.tax_category_key = me.tax_category_key
   AND (COALESCE(o.valid_from, '') = '' OR COALESCE(me.valid_to, '') = '' OR o.valid_from <= me.valid_to)
   AND (COALESCE(me.valid_from, '') = '' OR COALESCE(o.valid_to, '') = '' OR me.valid_from <= o.valid_to)
  WHERE me.hub_id = :hub_id
    AND me.updated_at = :now
    AND me.is_deleted = 0 AND me.is_active = 1
    AND COALESCE(NULLIF(me.parent_id, ''), '') = ''
);
