-- Canonical seed of the `taxes` module (ADR-0085). Per-hub IDEMPOTENT DML: the installer
-- applies it after migrating, with :hub_id/:now/:current_user_id injected. Re-runnable
-- without duplicating (WHERE NOT EXISTS by the natural key) and it NEVER updates existing
-- rows — a hub's manual edits survive a re-install (contract the taxes#18 backfill relies
-- on). Canonical categories (is_system=1) + shipped aliases (source='shipped') + the full
-- Spain VAT baseline (general 21 / reduced 10 / super-reduced 4 / exempt — taxes#7).

-- ── Canonical categories ──
INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|restaurant.food'), :hub_id, 'restaurant.food', 'Restaurant — food', '', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'restaurant.food');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|restaurant.drink'), :hub_id, 'restaurant.drink', 'Restaurant — drink', '', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'restaurant.drink');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|restaurant.alcohol'), :hub_id, 'restaurant.alcohol', 'Restaurant — alcohol', '', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'restaurant.alcohol');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|restaurant.delivery'), :hub_id, 'restaurant.delivery', 'Restaurant — delivery', '', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'restaurant.delivery');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|service.generic'), :hub_id, 'service.generic', 'Service — generic', '', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'service.generic');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|product.generic'), :hub_id, 'product.generic', 'Product — generic', '', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'product.generic');

-- ── Shipped aliases (external text → canonical key) ──
INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|food'), :hub_id, 'food', 'restaurant.food', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'food');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|prepared_food'), :hub_id, 'prepared_food', 'restaurant.food', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'prepared_food');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|meal'), :hub_id, 'meal', 'restaurant.food', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'meal');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|pizza'), :hub_id, 'pizza', 'restaurant.food', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'pizza');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|drink'), :hub_id, 'drink', 'restaurant.drink', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'drink');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|beverage'), :hub_id, 'beverage', 'restaurant.drink', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'beverage');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|soft_drink'), :hub_id, 'soft_drink', 'restaurant.drink', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'soft_drink');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|alcohol'), :hub_id, 'alcohol', 'restaurant.alcohol', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'alcohol');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|beer'), :hub_id, 'beer', 'restaurant.alcohol', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'beer');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|wine'), :hub_id, 'wine', 'restaurant.alcohol', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'wine');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|delivery'), :hub_id, 'delivery', 'restaurant.delivery', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'delivery');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|service'), :hub_id, 'service', 'service.generic', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'service');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|product'), :hub_id, 'product', 'product.generic', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'product');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|goods'), :hub_id, 'goods', 'product.generic', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'goods');

-- ── Spain VAT rules (phase 1, ADR-0072): region NULL = whole country, valid since 2012-09-01 ──
INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|product.generic'), :hub_id, 'ES', NULL, 'product.generic', 21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'product.generic' AND parent_id IS NULL AND region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|service.generic'), :hub_id, 'ES', NULL, 'service.generic', 21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'service.generic' AND parent_id IS NULL AND region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|restaurant.food'), :hub_id, 'ES', NULL, 'restaurant.food', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'restaurant.food' AND parent_id IS NULL AND region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|restaurant.drink'), :hub_id, 'ES', NULL, 'restaurant.drink', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'restaurant.drink' AND parent_id IS NULL AND region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|restaurant.delivery'), :hub_id, 'ES', NULL, 'restaurant.delivery', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'restaurant.delivery' AND parent_id IS NULL AND region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|restaurant.alcohol'), :hub_id, 'ES', NULL, 'restaurant.alcohol', 21, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'restaurant.alcohol' AND parent_id IS NULL AND region_code IS NULL);

-- ── Spain VAT-EXEMPT services (hub#292 / ADR-0185) ───────────────────────────────────────────
-- The beauty vertical invoices these daily and until now they had no way to be declared: a 0%
-- category reaches the AEAT as "subject and not exempt at 0%", which is a different thing. The
-- rule now carries its qualification (`exempt`) and the cause in the AEAT vocabulary (`E1` =
-- exempt under article 20 of Law 37/1992).
--
-- Note: the exemption belongs to the SERVICE, not to the business — art. 20.Uno.3 exempts
-- healthcare assistance provided by medical or health professionals, and art. 20.Uno.9 regulated
-- teaching. A haircut or a product sale is NOT exempt: they stay at 21% via
-- `service.generic`/`product.generic`. That is why these are SEPARATE categories and not a
-- change to the existing ones.
INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|service.health'), :hub_id, 'service.health', 'Service — healthcare (VAT exempt)', 'Assistance provided by medical or health professionals — art. 20.Uno.3 (ES)', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'service.health');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|service.education'), :hub_id, 'service.education', 'Service — education (VAT exempt)', 'Regulated teaching and training — art. 20.Uno.9 (ES)', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'service.education');

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, operation_class, exempt_reason, regime_key, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|service.health'), :hub_id, 'ES', NULL, 'service.health', 0, 'vat', 'exempt', 'E1', '01', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'service.health' AND parent_id IS NULL AND region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, operation_class, exempt_reason, regime_key, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|service.education'), :hub_id, 'ES', NULL, 'service.education', 0, 'vat', 'exempt', 'E1', '01', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'service.education' AND parent_id IS NULL AND region_code IS NULL);

-- Shipped aliases for the CSV import.
INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|health'), :hub_id, 'health', 'service.health', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'health');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|training'), :hub_id, 'training', 'service.education', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'training');

-- ── Spain VAT: REDUCED 10% and SUPER-REDUCED 4% generic product categories (taxes#7) ─────────
-- A hospitality hub registers products outside the restaurant catalog (bread, staples, books,
-- pharmacy). Without these, such a product resolves no rule and the VAT calculation degrades to
-- the fallback. Until now they were only planted by the hub's supplementary seed (hub#107,
-- `crates/server/seeds/es_iva.sql`), so the module alone left the ES baseline incomplete; the
-- module is now self-contained. SAME natural keys and ids as that supplementary seed, so both
-- compose without duplicating whichever runs first.
INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|product.super_reduced'), :hub_id, 'product.super_reduced', 'Product — super-reduced (bread, books, basics)', '', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'product.super_reduced');

INSERT INTO taxes_category (id, hub_id, key, name, description, is_system, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxcat|product.reduced'), :hub_id, 'product.reduced', 'Product — reduced (food staples, pharmacy)', '', 1, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category WHERE hub_id = :hub_id AND key = 'product.reduced');

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|product.reduced'), :hub_id, 'ES', NULL, 'product.reduced', 10, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'product.reduced' AND parent_id IS NULL AND region_code IS NULL);

INSERT INTO taxes_rule (id, hub_id, country_code, region_code, tax_category_key, rate_pct, tax_type, parent_id, component_label, valid_from, valid_to, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxrule|ES|product.super_reduced'), :hub_id, 'ES', NULL, 'product.super_reduced', 4, 'vat', NULL, NULL, '2012-09-01', NULL, 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_rule WHERE hub_id = :hub_id AND country_code = 'ES' AND tax_category_key = 'product.super_reduced' AND parent_id IS NULL AND region_code IS NULL);

-- No IGIC (Canary Islands) or IPSI (Ceuta/Melilla) rules are seeded: the module can already
-- express them (`tax_type` = 'igic'/'ipsi' + `region_code`), but the concrete per-category rates
-- depend on the business and its heading, and seeding a made-up number is worse than seeding
-- none — the hub would take it as valid and declare it. They are created from Settings → Taxes.
