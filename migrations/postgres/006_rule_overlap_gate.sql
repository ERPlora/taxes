-- Taxes · overlap gate for ACTIVE root tax rules of the same slot (taxes#66).
--
-- Purpose: `commands/_rule_overlap_assert.sql` — a later statement of `taxes.rules.create`,
-- `taxes.rules.activate` and `taxes._insert_rule` — inserts TWO identical rows into this table
-- ONLY when the write it just made overlaps another ACTIVE root rule of the same slot (same hub,
-- country, region, tax category, both roots, both active, in force on an overlapping day). The
-- second row then violates the UNIQUE index below, Postgres raises a 23505, and the runtime's
-- `on_unique` map (hub#2081) renames it to the domain error `taxes.rule_overlaps` — rolling back
-- the whole command transaction, including the write the assert is guarding.
--
-- This table NEVER holds a row: the only INSERT that ever reaches it lives inside a transaction
-- that is always rolled back by the violation it causes. This migration is purely additive — no
-- existing table, column, index or row is touched, and no other migration here touches
-- `taxes_rule` either — so rows that already overlapped before this guard shipped are left
-- exactly as they were.
--
-- Idempotent: both statements use IF NOT EXISTS, so applying this file twice in a row (the test
-- battery does, to prove the migration reverses and re-applies cleanly) is a no-op the second
-- time.
--
-- Reverse: DROP TABLE IF EXISTS taxes__gate;
CREATE TABLE IF NOT EXISTS taxes__gate (
    gate TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS taxes_rule_overlaps ON taxes__gate (gate);
