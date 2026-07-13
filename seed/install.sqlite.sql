-- Seed canónico del módulo `taxes` (ADR-0085). DML IDEMPOTENTE por hub: el instalador lo
-- aplica tras migrar con :hub_id/:now/:current_user_id inyectados. Re-ejecutable sin
-- duplicar (WHERE NOT EXISTS por la clave natural). Categorías canónicas (is_system=1) +
-- alias de fábrica (source='shipped') + reglas IVA España (ADR-0072 fase 1).
-- Mismo SQL en SQLite y Postgres (TEXT + || estándar).

-- ── Categorías canónicas ──
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

-- ── Alias de fábrica (texto externo → key canónica) ──
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

-- ── Reglas IVA España (fase 1, ADR-0072): región NULL = todo el país, vigentes desde 2012-09-01 ──
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
