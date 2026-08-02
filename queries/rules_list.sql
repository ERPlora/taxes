-- TODAS las reglas de tipo activas del hub, INCLUIDOS los componentes (parent_id != NULL).
-- Es la lectura que el keystone (ADR-0069) pre-carga para `sales.complete_sale`/`taxes.calculate`:
-- el handler resuelve la regla raíz por país+región+categoría+fecha y expande sus componentes.
-- Runtime inyecta :hub_id.
SELECT id, country_code, region_code, tax_category_key, rate_pct, tax_type,
       operation_class, exempt_reason, regime_key,
       parent_id, component_label, valid_from, valid_to, is_active
FROM taxes_rule
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
