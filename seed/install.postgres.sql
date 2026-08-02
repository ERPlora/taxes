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

-- ── Servicios EXENTOS de IVA en España (hub#292 / ADR-0185) ──────────────────────────────────
-- El vertical de estética los factura a diario y hasta ahora no tenían forma de declararse: una
-- categoría al 0 % sale a la AEAT como «sujeta y no exenta al 0 %», que es otra cosa. Ahora la
-- regla lleva su calificación (`exempt`) y la causa en el vocabulario de la AEAT (`E1` = exenta
-- por el artículo 20 de la Ley 37/1992).
--
-- Ojo: la exención es de la PRESTACIÓN, no del negocio — el art. 20.Uno.3º exime los servicios de
-- asistencia sanitaria prestados por profesionales médicos o sanitarios, y el 20.Uno.9º la
-- enseñanza reglada. Un corte de pelo o una venta de producto NO están exentos: siguen al 21 %
-- por `service.generic`/`product.generic`. Por eso son categorías APARTE y no un cambio de las
-- que ya existen.
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

-- Alias de fábrica para la importación por CSV.
INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|health'), :hub_id, 'health', 'service.health', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'health');

INSERT INTO taxes_category_alias (id, hub_id, alias, tax_category_key, source, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
SELECT (:hub_id || '|taxalias|training'), :hub_id, 'training', 'service.education', 'shipped', 1, 0, :current_user_id, :current_user_id, :now, :now
WHERE NOT EXISTS (SELECT 1 FROM taxes_category_alias WHERE hub_id = :hub_id AND alias = 'training');

-- NO se siembran reglas de IGIC (Canarias) ni de IPSI (Ceuta/Melilla): el módulo ya sabe
-- expresarlas (`tax_type` = 'igic'/'ipsi' + `region_code`), pero los tipos concretos por categoría
-- dependen del negocio y de su epígrafe, y sembrar un número inventado es peor que no sembrar
-- ninguno — el hub lo daría por bueno y lo declararía. Se crean desde Ajustes → Impuestos.
