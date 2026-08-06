-- Taxes · backfill of the ES VAT baseline for hubs that ALREADY had the module (taxes#18).
--
-- The v2.2.x seed (seed/install.postgres.sql) plants the full Spain baseline — including the
-- VAT-EXEMPT categories/rules (service.health / service.education, hub#292 / ADR-0185) — but the
-- installer only guarantees it for the runtime versions that wire module seeds (hub#178): a hub
-- pinned to an older runtime digest updates the module, gains the 002 columns, and never gains
-- the rows. Result: an operating salon cannot invoice an exempt healthcare service without
-- hand-crafting the category, the rule and the E1 cause. Migrations, unlike seeds, have been
-- applied by EVERY runtime since day one — this file is the delivery vehicle that reaches them.
--
-- Migrations run through `execute_batch` with NO parameter injection (there is no `:hub_id`
-- here — crates/runtime/src/migrations.rs), so the hubs to backfill are DERIVED from the
-- module's own tables: any hub_id that already has taxes data. Consequences by construction:
--   * a FRESH install is a no-op (001 just created the tables, they are empty; the seed that
--     runs right after migrations plants everything — no duplicates);
--   * legacy multi-hub DBs (pre ADR-0201) are backfilled for every hub in one pass;
--   * same guards as the seed (`WHERE NOT EXISTS` by natural key), same stable ids
--     (`<hub>|taxcat|<key>` / `<hub>|taxrule|ES|<key>` / `<hub>|taxalias|<alias>`), and it
--     NEVER updates existing rows — a hub's manual edits, soft-deletes and repointed aliases
--     survive untouched (contract fixed by seed/backfill.postgres.test.sh).
--
-- No IGIC/IPSI rates are backfilled, same reasoning as the seed: a made-up number would be
-- declared to the tax agency as if it were valid. Those are created from Settings → Taxes.
--
-- Audit timestamps are a FIXED ISO-8601 literal (the date this migration shipped): migrations
-- have no `:now` and the portable "ERPlora SQL" subset (ADR-0007) bans dialect date functions;
-- a deterministic value also keeps re-runs byte-identical.

CREATE TEMP TABLE _taxes_backfill_hubs AS
SELECT hub_id FROM taxes_category
UNION
SELECT hub_id FROM taxes_rule
UNION
SELECT hub_id FROM taxes_category_alias;

-- ── Categories (append-only: only the ones the hub is missing) ──
INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|restaurant.food', h.hub_id, 'restaurant.food', 'Restaurant — food', '', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'restaurant.food');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|restaurant.drink', h.hub_id, 'restaurant.drink', 'Restaurant — drink', '', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'restaurant.drink');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|restaurant.alcohol', h.hub_id, 'restaurant.alcohol', 'Restaurant — alcohol', '', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'restaurant.alcohol');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|restaurant.delivery', h.hub_id, 'restaurant.delivery', 'Restaurant — delivery', '', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'restaurant.delivery');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|service.generic', h.hub_id, 'service.generic', 'Service — generic', '', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'service.generic');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|product.generic', h.hub_id, 'product.generic', 'Product — generic', '', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'product.generic');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|service.health', h.hub_id, 'service.health', 'Service — healthcare (VAT exempt)', 'Assistance provided by medical or health professionals — art. 20.Uno.3 (ES)', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'service.health');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|service.education', h.hub_id, 'service.education', 'Service — education (VAT exempt)', 'Regulated teaching and training — art. 20.Uno.9 (ES)', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'service.education');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|product.super_reduced', h.hub_id, 'product.super_reduced', 'Product — super-reduced (bread, books, basics)', '', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'product.super_reduced');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxcat|product.reduced', h.hub_id, 'product.reduced', 'Product — reduced (food staples, pharmacy)', '', 1, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category c WHERE c.hub_id = h.hub_id AND c.key = 'product.reduced');

-- ── Spain VAT rules (same natural keys and stable ids as the seed) ──
INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|product.generic', h.hub_id, 'ES', NULL, 'product.generic', 21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'product.generic' AND r.parent_id IS NULL AND r.region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|service.generic', h.hub_id, 'ES', NULL, 'service.generic', 21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'service.generic' AND r.parent_id IS NULL AND r.region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|restaurant.food', h.hub_id, 'ES', NULL, 'restaurant.food', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'restaurant.food' AND r.parent_id IS NULL AND r.region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|restaurant.drink', h.hub_id, 'ES', NULL, 'restaurant.drink', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'restaurant.drink' AND r.parent_id IS NULL AND r.region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|restaurant.delivery', h.hub_id, 'ES', NULL, 'restaurant.delivery', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'restaurant.delivery' AND r.parent_id IS NULL AND r.region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|restaurant.alcohol', h.hub_id, 'ES', NULL, 'restaurant.alcohol', 21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'restaurant.alcohol' AND r.parent_id IS NULL AND r.region_code IS NULL);

-- The headline of taxes#18: the VAT-EXEMPT rules (qualification `exempt`, cause `E1` = art. 20
-- of Law 37/1992, general regime `01`) that existing hubs never received.
INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, operation_class, exempt_reason, regime_key, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|service.health', h.hub_id, 'ES', NULL, 'service.health', 0, 'vat', 'exempt', 'E1', '01', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'service.health' AND r.parent_id IS NULL AND r.region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, operation_class, exempt_reason, regime_key, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|service.education', h.hub_id, 'ES', NULL, 'service.education', 0, 'vat', 'exempt', 'E1', '01', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'service.education' AND r.parent_id IS NULL AND r.region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|product.reduced', h.hub_id, 'ES', NULL, 'product.reduced', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'product.reduced' AND r.parent_id IS NULL AND r.region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxrule|ES|product.super_reduced', h.hub_id, 'ES', NULL, 'product.super_reduced', 4, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule r WHERE r.hub_id = h.hub_id AND r.country_code = 'ES' AND r.tax_category_key = 'product.super_reduced' AND r.parent_id IS NULL AND r.region_code IS NULL);

-- ── Shipped aliases (guarded by (hub_id, alias): a repointed alias is never touched) ──
INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|food', h.hub_id, 'food', 'restaurant.food', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'food');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|prepared_food', h.hub_id, 'prepared_food', 'restaurant.food', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'prepared_food');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|meal', h.hub_id, 'meal', 'restaurant.food', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'meal');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|pizza', h.hub_id, 'pizza', 'restaurant.food', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'pizza');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|drink', h.hub_id, 'drink', 'restaurant.drink', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'drink');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|beverage', h.hub_id, 'beverage', 'restaurant.drink', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'beverage');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|soft_drink', h.hub_id, 'soft_drink', 'restaurant.drink', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'soft_drink');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|alcohol', h.hub_id, 'alcohol', 'restaurant.alcohol', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'alcohol');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|beer', h.hub_id, 'beer', 'restaurant.alcohol', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'beer');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|wine', h.hub_id, 'wine', 'restaurant.alcohol', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'wine');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|delivery', h.hub_id, 'delivery', 'restaurant.delivery', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'delivery');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|service', h.hub_id, 'service', 'service.generic', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'service');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|product', h.hub_id, 'product', 'product.generic', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'product');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|goods', h.hub_id, 'goods', 'product.generic', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'goods');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|health', h.hub_id, 'health', 'service.health', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'health');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT h.hub_id || '|taxalias|training', h.hub_id, 'training', 'service.education', 'shipped', 1, 0, 'system', 'system', '2026-08-06T00:00:00Z', '2026-08-06T00:00:00Z'
FROM _taxes_backfill_hubs h
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias a WHERE a.hub_id = h.hub_id AND a.alias = 'training');

DROP TABLE _taxes_backfill_hubs;
