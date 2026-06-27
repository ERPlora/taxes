-- Alias de categoría activos del hub (shipped + learned). Runtime inyecta :hub_id.
SELECT id, alias, tax_category_key, source, is_active
FROM taxes_category_alias
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
