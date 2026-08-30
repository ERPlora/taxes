-- Taxes · the natural key of a ROOT rule becomes a real UNIQUE index (hub#576).
--
-- The seed and the backfill have ALWAYS assumed this key (`WHERE NOT EXISTS` by
-- hub+country+category over root, country-or-region scoped rules) but nothing enforced it. That
-- gap is why the hub's export EXCLUDED `taxes_rule` from blueprints: an equivalent rule arriving
-- from another hub carries a different `id`, the id-based import guard never fires, and the VAT
-- lookup silently becomes ambiguous. With the key declared, the hub's import guard (ADR-0304)
-- reads it from the catalog and SKIPS equivalent rows — so the rules can finally travel in a
-- blueprint (per-country tax_rules next to the products, hub#576).
--
-- Shape of the key, and why each piece:
--   * (hub_id, country_code, tax_category_key, region_code, valid_from) — the jurisdiction and
--     the validity start. `valid_from` IS identity: a scheduled rate change is a second row with
--     a newer `valid_from` (the resolver picks the most recent) and must stay legal.
--   * ROOT rules only (`parent_id IS NULL`): several COMPONENTS under one root share country,
--     region and category BY DESIGN (`rule_create` enforces that coherence, taxes#9) — the
--     multi-tax model ("IVA 21 + RE 5,2") must never collide with itself.
--   * NULLS NOT DISTINCT: `region_code NULL` means "whole country" and `valid_from NULL` means
--     "since forever" — two of those are THE SAME rule, which is exactly what default
--     NULLS DISTINCT would fail to see. (Postgres 15+; the fleet pins postgres:18.)
--   * Partial on `is_deleted = 0`: a soft-deleted rule must not block re-creating its key.
--
-- DEDUPE FIRST: hubs that already suffered the silent duplication (a bundle's rules landing
-- again under a fresh id) would otherwise wedge this migration. The OLDEST row per key survives
-- (created_at, then id — deterministic); the rest are SOFT-deleted, never erased: sales snapshot
-- their rates (ADR-0085), nothing references a rule by FK except its components. Components of a
-- soft-deleted duplicate root are left in place on purpose: the resolver only reads components of
-- the root it RESOLVES, so they simply stop counting — deleting them would be guessing.
--
-- Audit timestamps are a FIXED ISO-8601 literal (the date this migration shipped): migrations
-- have no `:now` and the portable "ERPlora SQL" subset (ADR-0007) bans dialect date functions;
-- a deterministic value also keeps re-runs byte-identical.

UPDATE taxes_rule r
SET is_deleted = 1,
    deleted_at = '2026-08-14T00:00:00Z',
    updated_by = 'system',
    updated_at = '2026-08-14T00:00:00Z'
WHERE r.is_deleted = 0
  AND r.parent_id IS NULL
  AND EXISTS (
    SELECT 1 FROM taxes_rule k
    WHERE k.hub_id = r.hub_id
      AND k.country_code = r.country_code
      AND k.tax_category_key = r.tax_category_key
      -- NULL-safe equality, spelled out: `IS NOT DISTINCT FROM` reads nicer but its `FROM`
      -- keyword trips the hub's migration ownership guard (tables_touched anchors on FROM).
      AND (k.region_code = r.region_code OR (k.region_code IS NULL AND r.region_code IS NULL))
      AND (k.valid_from = r.valid_from OR (k.valid_from IS NULL AND r.valid_from IS NULL))
      AND k.parent_id IS NULL
      AND k.is_deleted = 0
      AND (k.created_at < r.created_at OR (k.created_at = r.created_at AND k.id < r.id))
  );

CREATE UNIQUE INDEX IF NOT EXISTS ix_tax_rule_root_natural
  ON taxes_rule (hub_id, country_code, tax_category_key, region_code, valid_from)
  NULLS NOT DISTINCT
  WHERE parent_id IS NULL AND is_deleted = 0;
